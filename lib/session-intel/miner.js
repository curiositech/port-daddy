'use strict';
// miner.js — mine coordination HITS & MISSES from STRUCTURED port-daddy signals.
//
// HARD RULE (operator, non-negotiable): NO keyword-based NLP. Every verdict here
// is derived from structured facts — claim windows, note TYPE fields, session
// lifecycle status, timestamps — never by scanning note body text for words.
// Excerpts are carried only as evidence and are REDACTED at ingest (see redact.js)
// before they ever reach the ledger.
//
// Detectors (each emits ledger entries { key, kind, verdict, severity,
// observation, excerpt, suggestedChange, signals, refs, createdAt }):
//   1. claim-conflict  (miss) — two sessions hold overlapping-in-TIME claims on the
//                               same file; region overlap = high severity.
//   2. abandoned        (miss) — session lifecycle status == 'abandoned'; holding
//                               unreleased claims escalates severity (orphaned work).
//   3. handoff          (hit)  — a note of TYPE handoff/takeover, then a later claim
//                               by a different session on the handed-off file scope.
//   4. duplicate-work   (miss) — two sessions edit the same file in SEQUENCE within
//                               a short window with no bridging handoff/takeover note.
//   5. note-hygiene     (hit/miss) — did a scope note precede a session's first claim?
//
// Pure: records in → entries out. No I/O, no clock (createdAt is derived from the
// evidence timestamps so runs are deterministic and idempotent).

const { redactExcerpt, redactString } = require('./redact.js');

// Keys whose string values are NOT prose/paths and must be left byte-exact.
// `sha256` is a 64-hex content hash (the generic long-hex rule would otherwise
// eat it); `type`/`source`/`verdict`/`kind`/`severity` are controlled enums.
const NO_REDACT_KEYS = new Set(['sha256', 'type', 'source', 'verdict', 'kind', 'severity']);

// Deep-redact every string in a mined entry AT INGEST — structured path fields
// (filePath/symbolPath, refs.file, signals.file, openClaims[]) and derived strings
// (observation, suggestedChange, key) all flow through redactString, so an
// absolute home path or a stray secret can never reach the append-only ledger,
// regardless of which detector built the entry or how a future excerpt is shaped.
function sanitizeEntry(node, key) {
  if (typeof node === 'string') return key && NO_REDACT_KEYS.has(key) ? node : redactString(node);
  if (Array.isArray(node)) return node.map((v) => sanitizeEntry(v, key));
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = sanitizeEntry(v, k);
    return out;
  }
  return node;
}

const HANDOFF_TYPES = new Set(['handoff', 'takeover']);
const DUP_WINDOW_MS = 48 * 3600 * 1000; // "didn't know someone just did this"

function sessionEnd(s) {
  return s.completedAt || s.updatedAt || s.createdAt || 0;
}
function claimEnd(claim, s) {
  return claim.releasedAt || sessionEnd(s) || claim.claimedAt || 0;
}
function regionsOverlap(a, b) {
  // Line-region overlap. If either lacks line info, treat as whole-file (overlaps).
  if (a.startLine == null || a.endLine == null || b.startLine == null || b.endLine == null) {
    return true;
  }
  return a.startLine <= b.endLine && b.startLine <= a.endLine;
}
function shortId(id) {
  if (!id) return id;
  const m = /-([0-9a-f]{6,})$/.exec(id);
  return m ? id.slice(0, 40) + '…' + m[1].slice(0, 6) : id;
}

// Build a redacted evidence excerpt from a note (or a synthetic claim summary).
function noteExcerpt(note) {
  if (!note) return null;
  const r = redactExcerpt(note.content, { maxLen: 400 });
  return {
    source: 'note',
    noteId: note.id,
    sessionId: note.sessionId,
    type: note.type,
    at: note.createdAt,
    text: r.text,
    sha256: r.sha256,
    redactionCount: r.redactionCount,
  };
}

function mine(records, opts = {}) {
  const sessions = records.sessions || [];
  const claims = records.claims || [];
  const notes = records.notes || [];

  const byId = new Map(sessions.map((s) => [s.id, s]));
  const notesBySession = groupBy(notes, (n) => n.sessionId);
  const claimsBySession = groupBy(claims, (c) => c.sessionId);
  const claimsByFile = groupBy(claims.filter((c) => c.filePath), (c) => c.filePath);

  const entries = [];
  detectClaimConflicts(entries, { claimsByFile, byId, notesBySession });
  detectAbandoned(entries, { sessions, claimsBySession, notesBySession, claimsByFile, byId });
  detectHandoffs(entries, { notes, claims, byId, claimsByFile });
  detectDuplicateWork(entries, { claimsByFile, byId, notesBySession });
  detectNoteHygiene(entries, { sessions, claimsBySession, notesBySession });

  // Redact every string field at ingest (paths + derived strings included) BEFORE
  // the entries leave the miner for the append-only ledger.
  const sanitized = entries.map((e) => sanitizeEntry(e));
  entries.length = 0;
  entries.push(...sanitized);

  // Deterministic order: misses first (higher severity first), then hits.
  const sevRank = { high: 0, medium: 1, low: 2 };
  entries.sort((a, b) => {
    if (a.verdict !== b.verdict) return a.verdict === 'miss' ? -1 : 1;
    if (sevRank[a.severity] !== sevRank[b.severity]) return sevRank[a.severity] - sevRank[b.severity];
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  return entries;
}

// ── 1. claim conflicts ──────────────────────────────────────────────────────
function detectClaimConflicts(out, { claimsByFile, byId, notesBySession }) {
  for (const [file, fileClaims] of claimsByFile) {
    if (fileClaims.length < 2) continue;
    for (let i = 0; i < fileClaims.length; i++) {
      for (let j = i + 1; j < fileClaims.length; j++) {
        const a = fileClaims[i];
        const b = fileClaims[j];
        if (a.sessionId === b.sessionId) continue;
        const sa = byId.get(a.sessionId);
        const sb = byId.get(b.sessionId);
        if (!sa || !sb) continue;
        const aEnd = claimEnd(a, sa);
        const bEnd = claimEnd(b, sb);
        // Temporal overlap of the two claim windows (NOT mere all-time co-claim).
        if (!(a.claimedAt < bEnd && b.claimedAt < aEnd)) continue;
        const [s1, s2] = a.sessionId < b.sessionId ? [a, b] : [b, a];
        const region = regionsOverlap(a, b);
        // A handoff/takeover note in either session during the window = coordinated.
        const overlapStart = Math.max(a.claimedAt, b.claimedAt);
        const overlapEnd = Math.min(aEnd, bEnd);
        const coordinated =
          hasBridgingHandoff(notesBySession.get(a.sessionId), overlapStart, overlapEnd) ||
          hasBridgingHandoff(notesBySession.get(b.sessionId), overlapStart, overlapEnd);
        const severity = coordinated ? 'low' : region ? 'high' : 'medium';
        out.push({
          key: `conflict:${file}:${s1.sessionId}:${s2.sessionId}`,
          kind: 'claim-conflict',
          verdict: 'miss',
          severity,
          observation:
            `Two sessions held ${region ? 'region-overlapping' : 'whole-file'} claims on ` +
            `${file} at the same time` +
            (coordinated ? ' (a handoff/takeover note bridged them — coordinated)' : ' with no handoff bridging them'),
          excerpt: {
            source: 'claim-pair',
            filePath: file,
            claimA: claimRef(s1),
            claimB: claimRef(s2),
            overlapWindow: [overlapStart, overlapEnd],
          },
          suggestedChange: coordinated
            ? `Confirm the region-claim tool is used up front on ${file} so overlaps are announced before, not during, edits.`
            : `Add a region-aware claim preflight on ${file}: block/warn a second claimant whose line-range overlaps a live claim.`,
          signals: { regionOverlap: region, coordinated, file },
          refs: { sessions: [s1.sessionId, s2.sessionId], file },
          createdAt: overlapStart,
        });
      }
    }
  }
}
function claimRef(c) {
  return {
    sessionId: c.sessionId,
    startLine: c.startLine,
    endLine: c.endLine,
    symbolPath: c.symbolPath || null,
    claimedAt: c.claimedAt,
    releasedAt: c.releasedAt,
  };
}
function hasBridgingHandoff(sessionNotes, from, to) {
  if (!sessionNotes) return false;
  return sessionNotes.some((n) => HANDOFF_TYPES.has(n.type) && n.createdAt >= from - DUP_WINDOW_MS && n.createdAt <= to);
}

// ── 2. abandoned / salvage ──────────────────────────────────────────────────
function detectAbandoned(out, { sessions, claimsBySession, notesBySession, claimsByFile, byId }) {
  for (const s of sessions) {
    if (s.status !== 'abandoned') continue;
    const myClaims = claimsBySession.get(s.id) || [];
    const open = myClaims.filter((c) => c.releasedAt == null);
    // Did another session later re-claim one of the orphaned files? (someone had to redo it)
    let rePickedUp = false;
    for (const c of open) {
      const others = (claimsByFile.get(c.filePath) || []).filter(
        (o) => o.sessionId !== s.id && o.claimedAt >= (c.claimedAt || 0)
      );
      if (others.length) {
        rePickedUp = true;
        break;
      }
    }
    const severity = open.length && rePickedUp ? 'high' : open.length ? 'medium' : 'low';
    const lastNote = lastOf(notesBySession.get(s.id));
    out.push({
      key: `abandoned:${s.id}`,
      kind: 'abandoned',
      verdict: 'miss',
      severity,
      observation:
        `Session ${shortId(s.id)} was abandoned mid-task holding ${open.length} unreleased claim(s)` +
        (rePickedUp ? ', at least one of which another session later had to pick up' : ''),
      excerpt: {
        source: 'session',
        sessionId: s.id,
        openClaims: open.map((c) => c.filePath),
        lastNote: noteExcerpt(lastNote),
      },
      suggestedChange: rePickedUp
        ? `On abandonment, auto-emit a salvage handoff for the open claims (${open.map((c) => c.filePath).slice(0, 3).join(', ')}) so the next agent inherits scope instead of rediscovering it.`
        : `Prompt agents to release claims or drop a salvage note before a session goes stale (${open.length} claims left dangling here).`,
      signals: { openClaims: open.length, rePickedUp },
      refs: { sessions: [s.id], files: open.map((c) => c.filePath) },
      createdAt: sessionEnd(s),
    });
  }
}

// ── 3. successful handoffs ──────────────────────────────────────────────────
function detectHandoffs(out, { notes, claims, byId, claimsByFile }) {
  const handoffNotes = notes.filter((n) => HANDOFF_TYPES.has(n.type));
  const claimsBySession = groupBy(claims, (c) => c.sessionId);
  for (const n of handoffNotes) {
    const src = byId.get(n.sessionId);
    if (!src) continue;
    const srcFiles = new Set((claimsBySession.get(n.sessionId) || []).map((c) => c.filePath));
    // A pickup: a DIFFERENT session claims a file the handoff session held, AFTER
    // the handoff note timestamp. Structured chain — no text matching.
    let pickup = null;
    for (const f of srcFiles) {
      const cands = (claimsByFile.get(f) || [])
        .filter((c) => c.sessionId !== n.sessionId && c.claimedAt >= n.createdAt)
        .sort((a, b) => a.claimedAt - b.claimedAt);
      if (cands.length) {
        pickup = cands[0];
        break;
      }
    }
    if (!pickup && n.type !== 'takeover') continue;
    // A 'takeover' note with the taker then making its own claims also counts.
    if (!pickup && n.type === 'takeover') {
      const resumed = (claimsBySession.get(n.sessionId) || []).filter((c) => c.claimedAt >= n.createdAt);
      if (!resumed.length) continue;
      pickup = resumed[0];
    }
    out.push({
      key: `handoff:${n.id}:${pickup.sessionId}`,
      kind: 'handoff',
      verdict: 'hit',
      severity: 'low',
      observation:
        n.type === 'takeover'
          ? `A takeover note in ${shortId(n.sessionId)} was followed by real claims resuming the work — a clean recovery.`
          : `A handoff note in ${shortId(n.sessionId)} was picked up by ${shortId(pickup.sessionId)} on ${pickup.filePath} — scope transferred cleanly.`,
      excerpt: {
        source: 'handoff-chain',
        handoffNote: noteExcerpt(n),
        pickupClaim: claimRef(pickup),
      },
      suggestedChange: `Reinforce: templatize this ${n.type} → pickup pattern as the default nudge when a session with live claims goes idle.`,
      signals: { noteType: n.type, file: pickup.filePath },
      refs: { sessions: [n.sessionId, pickup.sessionId], file: pickup.filePath },
      createdAt: n.createdAt,
    });
  }
}

// ── 4. duplicate work ───────────────────────────────────────────────────────
function detectDuplicateWork(out, { claimsByFile, byId, notesBySession }) {
  for (const [file, fileClaims] of claimsByFile) {
    if (fileClaims.length < 2) continue;
    // One claim per session on this file, earliest first.
    const perSession = new Map();
    for (const c of fileClaims) {
      const cur = perSession.get(c.sessionId);
      if (!cur || c.claimedAt < cur.claimedAt) perSession.set(c.sessionId, c);
    }
    const ordered = [...perSession.values()].sort((a, b) => a.claimedAt - b.claimedAt);
    for (let i = 0; i + 1 < ordered.length; i++) {
      const a = ordered[i];
      const b = ordered[i + 1];
      const sa = byId.get(a.sessionId);
      const sb = byId.get(b.sessionId);
      if (!sa || !sb) continue;
      const aEnd = claimEnd(a, sa);
      // Sequential (b starts after a's claim window closes), within a short window.
      if (b.claimedAt < aEnd) continue; // overlap → that's a conflict, not duplicate
      const gap = b.claimedAt - aEnd;
      if (gap > DUP_WINDOW_MS) continue;
      // No handoff/takeover note bridging the two claims (no coordination).
      const bridged =
        hasBridgingHandoff(notesBySession.get(a.sessionId), a.claimedAt, b.claimedAt) ||
        hasBridgingHandoff(notesBySession.get(b.sessionId), a.claimedAt, b.claimedAt);
      if (bridged) continue;
      out.push({
        key: `duplicate:${file}:${a.sessionId}:${b.sessionId}`,
        kind: 'duplicate-work',
        verdict: 'miss',
        severity: 'medium',
        observation:
          `Two sessions edited ${file} back-to-back (${Math.round(gap / 3600000)}h apart) with no handoff note between them — likely rework.`,
        excerpt: {
          source: 'claim-pair',
          filePath: file,
          firstClaim: claimRef(a),
          secondClaim: claimRef(b),
          gapMs: gap,
        },
        suggestedChange: `Surface "this file was edited <gap>h ago by another session" on claim of ${file}, so the second agent reuses rather than redoes.`,
        signals: { gapMs: gap, file },
        refs: { sessions: [a.sessionId, b.sessionId], file },
        createdAt: b.claimedAt,
      });
    }
  }
}

// ── 5. note hygiene ─────────────────────────────────────────────────────────
function detectNoteHygiene(out, { sessions, claimsBySession, notesBySession }) {
  for (const s of sessions) {
    const myClaims = claimsBySession.get(s.id) || [];
    if (!myClaims.length) continue; // hygiene only meaningful for sessions that edited
    const firstClaimAt = Math.min(...myClaims.map((c) => c.claimedAt || Infinity));
    const myNotes = (notesBySession.get(s.id) || []).slice().sort((a, b) => a.createdAt - b.createdAt);
    const scopeNoteBefore = myNotes.find((n) => n.createdAt <= firstClaimAt);
    const hasGovernanceNote = myNotes.some((n) => n.type === 'decision' || n.type === 'warning');
    if (scopeNoteBefore) {
      out.push({
        key: `hygiene:${s.id}`,
        kind: 'note-hygiene',
        verdict: 'hit',
        severity: 'low',
        observation:
          `Session ${shortId(s.id)} posted a scope note before its first claim` +
          (hasGovernanceNote ? ' and logged a decision/warning — good hygiene.' : '.'),
        excerpt: { source: 'session', sessionId: s.id, scopeNote: noteExcerpt(scopeNoteBefore) },
        suggestedChange: `Reinforce: this scope-note-before-claim ordering is the pattern the guard should reward/default.`,
        signals: { hasGovernanceNote },
        refs: { sessions: [s.id] },
        createdAt: firstClaimAt,
      });
    } else {
      out.push({
        key: `hygiene:${s.id}`,
        kind: 'note-hygiene',
        verdict: 'miss',
        severity: 'low',
        observation: `Session ${shortId(s.id)} claimed ${myClaims.length} file(s) without posting any note beforehand — edits ran ahead of announced scope.`,
        excerpt: { source: 'session', sessionId: s.id, firstClaimAt, noteCount: myNotes.length },
        suggestedChange: `Have the guard require a scope note before the first file claim (this session skipped it).`,
        signals: { noteCount: myNotes.length, claimCount: myClaims.length },
        refs: { sessions: [s.id] },
        createdAt: firstClaimAt,
      });
    }
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────
function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (k == null) continue;
    const list = m.get(k);
    if (list) list.push(x);
    else m.set(k, [x]);
  }
  return m;
}
function lastOf(arr) {
  if (!arr || !arr.length) return null;
  return arr.slice().sort((a, b) => a.createdAt - b.createdAt).pop();
}

module.exports = { mine, sanitizeEntry, sessionEnd, claimEnd, regionsOverlap };
