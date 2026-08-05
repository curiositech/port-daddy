/**
 * Steward Eureka & Coordination Digest — Session Intelligence WS-2/WS-3
 * consumer.
 *
 * This module adds NO new detection. It composes the two orphaned
 * session-intel tools that already existed with no scheduler and no
 * consumer:
 *   - WS-3 (miner.js / ledger.js / suggestions.js) — coordination hits/misses.
 *   - WS-2 (eureka-arc-detector.mjs) — failure→failure→success arcs.
 *
 * The one piece of real logic here is the single-expert-oracle guard: an
 * eureka arc from ONE session is an anecdote (ACTA's "Single Expert
 * Validation Gap" — see skills/expert-task-analysis and the CDM literature
 * survey in docs/research/offline-counterfactual-cdm-for-agent-transcripts.html
 * §2.4). Only arcs whose (tool, signature) pair recurs across at least
 * `minSessions` DISTINCT sessions are surfaced as digest-worthy; everything
 * else is counted but held back, structurally, not by prompting anything not
 * to overreact to a single session.
 *
 * Mining runs locally (it is the only thing with filesystem access to
 * ~/.claude/projects and the local daemon store), but judgment does not:
 * `toIngestFindings`/`deepRedact`/`uploadDigest` shape and redact the
 * findings, then POST them to relay's authenticated ingest endpoint
 * (POST /v1/session-intel/ingest — apps/relay/src/session-intel.ts). Every
 * cycle also writes exactly one LOCAL ledger entry, ALL QUIET included, per
 * the solely-responsible-agent mandatory-ledger rule — a missing entry is
 * itself a finding for the next cycle to notice, independent of whether the
 * upload succeeded.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { detectArcsFromText } from './eureka-arc-detector.mjs';

const require = createRequire(import.meta.url);
const { loadFromSqlite } = require('./data-source.js');
const { mine } = require('./miner.js');
const { appendEntries, readLedger, defaultLedgerPath } = require('./ledger.js');
const { redactString } = require('./redact.js');
const { rankSuggestions } = require('./suggestions.js');

function defaultDigestLedgerPath() {
  return (
    process.env.PD_SESSION_INTEL_DIGEST_LEDGER ||
    path.join(os.homedir(), '.port-daddy', 'session-intel', 'steward-digest-ledger.jsonl')
  );
}

function isoDate(now) {
  return new Date(now).toISOString().slice(0, 10); // YYYY-MM-DD
}

/** Recursively collect .jsonl transcripts under ~/.claude/projects. */
function collectTranscripts(root) {
  const out = [];
  const walk = (dir) => {
    let ents = [];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p);
    }
  };
  walk(root);
  return out;
}

/**
 * Scan transcripts for eureka arcs and group by (tool, signature) across
 * DISTINCT sessions. Returns { recurring, singleSession } — recurring only
 * includes groups with >= minSessions distinct sessionIds.
 */
function collectEurekaArcs(opts = {}) {
  const root = opts.transcriptRoot || path.join(os.homedir(), '.claude', 'projects');
  const minSessions = opts.minSessions || 2;
  // `sources` (in-memory {sessionId, text} pairs) takes precedence over disk
  // reads — this is what the selftest uses, so coverage never has to write
  // throwaway files anywhere, this repo's /tmp policy included.
  const sources = opts.sources || (opts.files || collectTranscripts(root)).map((file) => ({
    sessionId: path.basename(file, '.jsonl'),
    text: (() => {
      try {
        return fs.readFileSync(file, 'utf8');
      } catch {
        return null;
      }
    })(),
  }));

  const groups = new Map(); // groupKey -> { tool, signature, sessions:Set, examples:[] }
  for (const { sessionId, text } of sources) {
    if (text == null) continue;
    let arcs;
    try {
      arcs = detectArcsFromText(text, { fallbackSessionId: sessionId });
    } catch {
      continue; // malformed transcript — skip, never throw the whole digest away for one bad file
    }
    for (const arc of arcs) {
      const gid = `${arc.tool}::${arc.signature}`;
      let g = groups.get(gid);
      if (!g) {
        g = { id: gid, tool: arc.tool, signature: arc.signature, sessions: new Set(), examples: [] };
        groups.set(gid, g);
      }
      g.sessions.add(arc.sessionId);
      if (g.examples.length < 3) g.examples.push({ sessionId: arc.sessionId, failCount: arc.failCount, whatChangedDelta: arc.whatChangedDelta, excerpt: arc.excerpt });
    }
  }

  const all = [...groups.values()].map((g) => ({
    id: g.id,
    tool: g.tool,
    signature: g.signature,
    distinctSessionCount: g.sessions.size,
    sessions: [...g.sessions],
    examples: g.examples,
  }));
  all.sort((a, b) => b.distinctSessionCount - a.distinctSessionCount);

  return {
    recurring: all.filter((g) => g.distinctSessionCount >= minSessions),
    singleSession: all.filter((g) => g.distinctSessionCount < minSessions),
  };
}

/**
 * Build one cycle's digest: WS-3 coordination suggestions (already
 * recurrence-aware by construction — see suggestions.js groupIdFor) plus
 * WS-2 recurring eureka arcs.
 *
 * `opts.db` is REQUIRED for the coordination-suggestion half -- this
 * function does no auto-discovery itself; omit `db` and you get an
 * eureka-arc-only digest (coordinationSource stays null), which is a valid,
 * intentional mode (see steward-digest-cli.mjs's "Building eureka-only
 * digest" fallback). The CLI's `discoverSources()` is what auto-discovers
 * the first daemon store under ~/.port-daddy and passes it in as `db` --
 * that discovery lives at the CLI layer, not here, so this module stays
 * usable without any filesystem-scanning side effect of its own.
 */
function buildDigest(opts = {}) {
  const now = opts.now || Date.now();
  const ledgerPath = opts.ledgerPath || defaultLedgerPath();
  const minSessions = opts.minSessions || 2;

  let coordinationSuggestions = [];
  let coordinationSource = null;
  if (opts.db) {
    const records = loadFromSqlite(opts.db, { project: opts.project || null });
    const entries = mine(records);
    const res = appendEntries(entries, { path: ledgerPath, now });
    coordinationSuggestions = rankSuggestions(readLedger({ path: ledgerPath }), { limit: opts.topSuggestions || 8 });
    coordinationSource = { db: opts.db, minedThisRun: res.appended, ledgerTotal: res.total };
  }

  const { recurring, singleSession } = collectEurekaArcs({
    transcriptRoot: opts.transcriptRoot,
    files: opts.transcriptFiles,
    sources: opts.transcriptSources,
    minSessions,
  });

  const allQuiet = coordinationSuggestions.length === 0 && recurring.length === 0;

  return {
    date: isoDate(now),
    coordinationSource,
    coordinationSuggestions,
    recurringEurekaArcs: recurring,
    singleSessionArcCount: singleSession.length,
    minSessionsThreshold: minSessions,
    allQuiet,
  };
}

/**
 * Persist exactly one ledger entry for this cycle. Deterministic key = date,
 * so re-running the same day is a no-op (idempotent, like WS-3's ledger).
 * ALL QUIET is a valid, expected entry — the ledger is proof of life, not
 * just a findings log.
 */
function recordDigestCycle(digest, opts = {}) {
  const digestLedgerPath = opts.digestLedgerPath || defaultDigestLedgerPath();
  const entry = {
    key: `digest:${digest.date}`,
    kind: 'steward-eureka-digest',
    verdict: digest.allQuiet ? 'all-quiet' : 'findings',
    date: digest.date,
    coordinationSuggestionCount: digest.coordinationSuggestions.length,
    recurringEurekaArcCount: digest.recurringEurekaArcs.length,
    singleSessionArcCount: digest.singleSessionArcCount,
    observation: digest.allQuiet
      ? 'No recurring coordination misses or eureka arcs this cycle.'
      : `${digest.coordinationSuggestions.length} coordination suggestion(s), ${digest.recurringEurekaArcs.length} recurring eureka arc(s) (>= ${digest.minSessionsThreshold} sessions each).`,
    suggestedChange: digest.allQuiet
      ? 'none'
      : 'Review recurringEurekaArcs / coordinationSuggestions and judge skill/prompt/roadmap worthiness by hand — this module never authors a skill itself.',
    signals: { source: 'session-intel:WS-2+WS-3', minSessionsThreshold: digest.minSessionsThreshold },
    refs: { arcIds: digest.recurringEurekaArcs.map((a) => a.id), suggestionIds: digest.coordinationSuggestions.map((s) => s.id) },
    excerpt: {},
  };
  return appendEntries([entry], { path: digestLedgerPath, now: opts.now || Date.now() });
}

/**
 * Recursively redactString() every string value in a JSON-shaped value.
 * Reuses the exact structural grammars the local coordination ledger already
 * enforces (redact.js) — no new redaction design.
 */
function deepRedact(value) {
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map(deepRedact);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = deepRedact(v);
    return out;
  }
  return value;
}

/**
 * digest → the findings[] shape relay's POST /v1/session-intel/ingest
 * expects. Every payload field is deep-redacted before it is returned —
 * this is the last local step before anything crosses the network.
 */
function toIngestFindings(digest) {
  const findings = [];
  for (const s of digest.coordinationSuggestions) {
    findings.push({
      kind: 'coordination-suggestion',
      title: s.title,
      occurrences: s.occurrences,
      sessionCount: s.affectedSessionCount,
      payload: deepRedact(s),
    });
  }
  for (const a of digest.recurringEurekaArcs) {
    findings.push({
      kind: 'recurring-eureka-arc',
      title: `${a.tool} :: ${a.signature}`,
      occurrences: a.sessions.length,
      sessionCount: a.distinctSessionCount,
      payload: deepRedact({ tool: a.tool, signature: a.signature, examples: a.examples }),
    });
  }
  return findings;
}

/**
 * POST the digest's findings to relay. Requires RELAY_OPERATOR_TOKEN in the
 * environment -- never hardcoded, never logged. Skips (not throws) when the
 * token is absent, so a local-only dry run still works without cloud access.
 */
async function uploadDigest(digest, opts = {}) {
  const relayUrl = opts.relayUrl || 'https://relay.portdaddy.dev';
  const token = opts.token ?? process.env.RELAY_OPERATOR_TOKEN;
  if (!token) {
    return { skipped: true, reason: 'RELAY_OPERATOR_TOKEN not set' };
  }
  const findings = toIngestFindings(digest);
  const fetchImpl = opts.fetch || fetch;
  const res = await fetchImpl(`${relayUrl}/v1/session-intel/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ digestDate: digest.date, findings }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { skipped: false, ok: false, status: res.status, body };
  }
  return { skipped: false, ok: true, body };
}

export {
  buildDigest,
  recordDigestCycle,
  collectEurekaArcs,
  defaultDigestLedgerPath,
  isoDate,
  deepRedact,
  toIngestFindings,
  uploadDigest,
};
