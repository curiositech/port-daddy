/**
 * Agent Harbor read-only blackboard (binder ch05 "Blackboard"; ch04 "Transcript
 * search and blackboard"; ADR-0097 §5 + Implementation Matrix phase 4 — the M6
 * slice of the M6/M8 split).
 *
 * Ch05 is explicit about the split this module honors:
 *
 *   "Milestone 6 should ship a read-only/search blackboard over transcript and
 *    memory facts; active conflict/parley write semantics belong in Milestone 8."
 *
 * So this module is a READ MODEL ONLY: a read-time projection over ledger facts
 * (harbor_events) plus the daemon's live coordination truth (session file
 * claims), aggregated into BlackboardItem cards
 * (schemas/agent-harbor/v0/blackboard-item.schema.json — the frozen M6
 * contract). There is NO write path here — no POST, no ack, no parley, no
 * mutation of any card. Explicit `blackboard_item` transcript events that
 * Longshoremen have already appended to the ledger are *read* and surfaced;
 * appending them is the transcript ingestion path's business, not this
 * module's. M8 introduces write/parley semantics under its own ADR.
 *
 * Card families (mission scope — active claims, conflict warnings, recent
 * compaction/receipt events — plus ch05's "explicit assertions"):
 *
 *   asserted        — ledger transcript events with kind `blackboard_item`
 *                     whose payloadJson is a BlackboardItem (ch05:
 *                     "Longshoremen write to the blackboard"; the ledger event
 *                     IS the write, this is the read). Latest assertion per
 *                     itemId wins (supersession happens in the ledger, never
 *                     by mutating a card). Invalid assertions are dropped and
 *                     counted — never silently, never crashing the board.
 *   active-claim    — unreleased file/region claims held by active sessions
 *                     (session_files ⋈ sessions), the daemon's live claim
 *                     truth (ch05 "contested files" input; ch04 blackboard
 *                     memory: "do not duplicate this" substrate).
 *   contested-file  — the conflict warning: the same path claimed by two or
 *                     more distinct active sessions. Purely structural overlap
 *                     — semantic conflict *prediction* is M8's
 *                     semantic-conflict-predictor, not this card.
 *   transcript-episode — recent `compaction_packet` transcript events (ch05
 *                     "important transcript episodes"; ADR-0097: the packet is
 *                     the payload of the first-class compaction_packet event).
 *   work-receipt    — recent work-receipt ledger facts (ch05 "recent
 *                     decisions" / receipts lane on the operator surface).
 *
 * Legibility discipline (legibility-for-agentic-systems, DIGEST-WITH-ZOOM):
 * every card is a lens, never a replacement — `citations` (minItems 1 in the
 * frozen schema) point at the ledger fact, file, or claim the card was derived
 * from, so an operator surface can always zoom from the card to the ground
 * truth in one hop. Cards synthesized here are deterministic projections of
 * structured state (the skill's D4 "trust the digest" case) and carry
 * confidence 1; asserted cards keep whatever confidence their Longshoreman
 * asserted.
 *
 * Freshness: this view reads the ledger directly at its head (no materialized
 * checkpoint to fall behind), so per-card `projection.stale` is false with
 * lastLedgerSeq = headSeq at read time. Claim cards derive from live
 * operational tables (not the ledger); their ledger seqs are null — an honest
 * "not a ledger-checkpointed fact" rather than a fabricated sequence.
 *
 * Fail-closed contract guard: every card synthesized by this module is
 * validated against the frozen blackboard-item schema before it is returned
 * (assertAgainstSchema) — if this projection drifts off the M6 contract it
 * throws instead of shipping a drifted shape.
 */

import { createHash } from 'node:crypto';
import type { DatabaseInstance } from '../sqlite-runtime.js';
import { ensureEventLedgerSchema, ledgerHeadSeq } from './event-ledger.js';
import { assertAgainstSchema, validateAgainstSchema } from './schema-validate.js';

export const BLACKBOARD_ITEM_SCHEMA = 'pd.agent-harbor.blackboard-item.v0';

/** Read filter — all optional, all narrowing (tolerant reader on the way in). */
export interface BlackboardFilter {
  /** Exact card kind (open string per the frozen schema). */
  kind?: string;
  sessionId?: string;
  agentNodeId?: string;
  /** Max cards returned after sorting (default 100, max 500). */
  limit?: number;
  /** Per event family (assertions / compactions / receipts) scan depth. */
  recentLimit?: number;
}

export interface BlackboardReadResult {
  /** BlackboardItem-shaped cards, severity-major then recency ordering. */
  items: Array<Record<string, unknown>>;
  /**
   * Explicit `blackboard_item` assertions that failed frozen-schema validation
   * and were dropped. Surfaced as a count so a bad Longshoreman is visible,
   * not silently absorbed (honest-green discipline).
   */
  droppedInvalid: number;
  /** Ledger head at read time — the board's freshness anchor. */
  headSeq: number;
  /** ISO timestamp of this read (the board is a snapshot, not a subscription). */
  generatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────

function s(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** session_files timestamps are epoch millis (lib/sessions.ts uses Date.now()). */
function epochToIso(v: unknown): string {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
    // Tolerate second-resolution rows from older writers.
    const ms = v < 1_000_000_000_000 ? v * 1000 : v;
    return new Date(ms).toISOString();
  }
  return new Date(0).toISOString();
}

function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 12);
}

const SEVERITY_RANK: Record<string, number> = { critical: 3, high: 2, warning: 1, info: 0 };

function severityRank(item: Record<string, unknown>): number {
  const sev = s(item.severity);
  return sev !== null && sev in SEVERITY_RANK ? SEVERITY_RANK[sev] : 0;
}

/** Freshness envelope for ledger-derived cards: read at head, so never stale. */
function ledgerFreshness(headSeq: number): Record<string, unknown> {
  return { stale: false, lastLedgerSeq: headSeq, headSeq };
}

/** Freshness for cards derived from live (non-ledger) operational tables. */
function liveFreshness(): Record<string, unknown> {
  return { stale: false, lastLedgerSeq: null, headSeq: null };
}

function tableExists(db: DatabaseInstance, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
  return row !== undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Family 1 — explicit assertions: ledger blackboard_item transcript events
// ─────────────────────────────────────────────────────────────────────────────

interface AssertedRow {
  ledger_seq: number;
  event_id: string;
  session_id: string | null;
  agent_node_id: string | null;
  occurred_at: string | null;
  ingested_at: string;
  payload_json: string;
}

function readAssertedItems(
  db: DatabaseInstance,
  recentLimit: number,
  nowIso: string,
  headSeq: number,
): { items: Array<Record<string, unknown>>; dropped: number } {
  const nowMs = Date.parse(nowIso);
  const rows = db
    .prepare(
      `SELECT ledger_seq, event_id, session_id, agent_node_id, occurred_at, ingested_at, payload_json
       FROM harbor_events
       WHERE stream_type = 'transcript-event' AND kind = 'blackboard_item'
       ORDER BY ledger_seq DESC LIMIT ?`,
    )
    .all(recentLimit) as AssertedRow[];

  // Latest assertion per itemId wins (rows arrive newest-first). Status
  // transitions live in the ledger: a re-assertion with status=resolved is the
  // resolution — this reader never mutates anything.
  const byItemId = new Map<string, Record<string, unknown>>();
  let dropped = 0;

  for (const row of rows) {
    let envelope: Record<string, unknown>;
    try {
      envelope = JSON.parse(row.payload_json) as Record<string, unknown>;
    } catch {
      dropped += 1;
      continue;
    }
    const payload = envelope.payloadJson;
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      dropped += 1;
      continue;
    }
    const item: Record<string, unknown> = { ...(payload as Record<string, unknown>) };

    // The card must zoom back to the ledger event that asserted it. Tolerant
    // augment: keep the asserter's citations and add the carrying event if the
    // asserter did not already cite it.
    const citations = Array.isArray(item.citations) ? [...(item.citations as unknown[])] : [];
    const citesCarrier = citations.some(
      (c) =>
        c !== null &&
        typeof c === 'object' &&
        (c as Record<string, unknown>).transcriptEventId === row.event_id,
    );
    if (!citesCarrier) {
      citations.push({
        kind: 'transcript-event',
        transcriptEventId: row.event_id,
        ...(row.session_id ? { sessionId: row.session_id } : {}),
      });
    }
    item.citations = citations;
    item.projection = ledgerFreshness(headSeq);

    // Read-model TTL semantics (frozen schema: "the projection marks
    // status=expired when passed") — a status transition computed at read
    // time, not a write. Compare numerically (Date.parse), not
    // lexicographically: asserters may use any ISO-8601 variant (offsets,
    // fractional-second widths) and string order lies across variants. An
    // unparseable expiresAt never expires a card — misclassifying a live
    // warning as expired is the worse failure.
    const expiresAt = s(item.expiresAt);
    if (item.status === 'active' && expiresAt !== null) {
      const expiresMs = Date.parse(expiresAt);
      if (Number.isFinite(expiresMs) && expiresMs <= nowMs) {
        item.status = 'expired';
      }
    }

    const verdict = validateAgainstSchema('blackboard-item', item);
    if (!verdict.valid) {
      dropped += 1;
      continue;
    }
    const itemId = s(item.itemId);
    if (itemId === null) {
      dropped += 1;
      continue;
    }
    if (!byItemId.has(itemId)) byItemId.set(itemId, item);
  }

  return { items: [...byItemId.values()], dropped };
}

// ─────────────────────────────────────────────────────────────────────────────
// Family 2 + 3 — active claims and contested-file conflict warnings
// ─────────────────────────────────────────────────────────────────────────────

interface ClaimRow {
  id: number;
  session_id: string;
  file_path: string;
  start_line: number | null;
  end_line: number | null;
  symbol: string | null;
  claimed_at: number;
  purpose: string | null;
  agent_id: string | null;
}

function readActiveClaims(db: DatabaseInstance): ClaimRow[] {
  // Same live-truth join lib/sessions.ts uses for `pd claims` — the daemon's
  // operational claim tables, not a ledger projection. Read-only.
  if (!tableExists(db, 'session_files') || !tableExists(db, 'sessions')) return [];
  return db
    .prepare(
      `SELECT sf.id, sf.session_id, sf.file_path, sf.start_line, sf.end_line,
              sf.symbol, sf.claimed_at, s.purpose, s.agent_id
       FROM session_files sf
       JOIN sessions s ON s.id = sf.session_id
       WHERE sf.released_at IS NULL AND s.status = 'active'
       ORDER BY sf.claimed_at DESC`,
    )
    .all() as ClaimRow[];
}

function claimCard(claim: ClaimRow): Record<string, unknown> {
  const region =
    claim.start_line !== null && claim.end_line !== null
      ? ` L${claim.start_line}–L${claim.end_line}`
      : '';
  const symbol = claim.symbol ? ` · ${claim.symbol}` : '';
  return {
    schema: BLACKBOARD_ITEM_SCHEMA,
    itemId: `bbi_claim_${claim.id}`,
    kind: 'active-claim',
    title: `Claim: ${claim.file_path}${region}${symbol}`,
    detail:
      `Session ${claim.session_id}` +
      (claim.purpose ? ` (${claim.purpose})` : '') +
      (claim.agent_id ? ` · agent ${claim.agent_id}` : '') +
      ` holds this claim. Claims are advisory — they announce intent, not enforce locks.`,
    subjects: [
      { kind: 'file', ref: claim.file_path },
      { kind: 'session', ref: claim.session_id },
    ],
    agentNodeId: null, // sessions.agent_id is a pd agent label, not a harbor agentNodeId — never fake a join key
    sessionId: claim.session_id,
    runId: null,
    severity: 'info',
    confidence: 1,
    status: 'active',
    supersededBy: null,
    postedAt: epochToIso(claim.claimed_at),
    updatedAt: null,
    expiresAt: null,
    assertedBy: { kind: 'projection', agentNodeId: null },
    citations: [
      { kind: 'claim', claimRef: `session-file:${claim.id}`, sessionId: claim.session_id },
    ],
    projection: liveFreshness(),
  };
}

function contestedCards(claims: ClaimRow[]): Array<Record<string, unknown>> {
  const byPath = new Map<string, ClaimRow[]>();
  for (const claim of claims) {
    const list = byPath.get(claim.file_path) ?? [];
    list.push(claim);
    byPath.set(claim.file_path, list);
  }

  const cards: Array<Record<string, unknown>> = [];
  for (const [path, rows] of byPath) {
    const sessions = [...new Set(rows.map((r) => r.session_id))];
    if (sessions.length < 2) continue;
    const latest = Math.max(...rows.map((r) => r.claimed_at));
    cards.push({
      schema: BLACKBOARD_ITEM_SCHEMA,
      itemId: `bbi_contested_${shortHash(path)}`,
      kind: 'contested-file',
      title: `Contested: ${path} claimed by ${sessions.length} active sessions`,
      detail:
        sessions
          .map((sid) => {
            const row = rows.find((r) => r.session_id === sid);
            return `${sid}${row?.purpose ? ` (${row.purpose})` : ''}`;
          })
          .join(' vs ') +
        '. Structural claim overlap only — semantic conflict prediction and parley are M8.',
      subjects: [
        { kind: 'file', ref: path },
        ...sessions.map((sid) => ({ kind: 'session', ref: sid })),
      ],
      agentNodeId: null,
      sessionId: null, // the conflict belongs to no single session
      runId: null,
      severity: sessions.length >= 3 ? 'high' : 'warning',
      confidence: 1,
      status: 'active',
      supersededBy: null,
      postedAt: epochToIso(latest),
      updatedAt: null,
      expiresAt: null,
      assertedBy: { kind: 'projection', agentNodeId: null },
      citations: rows.map((r) => ({
        kind: 'claim',
        claimRef: `session-file:${r.id}`,
        sessionId: r.session_id,
      })),
      projection: liveFreshness(),
    });
  }
  return cards;
}

// ─────────────────────────────────────────────────────────────────────────────
// Family 4 — recent compaction_packet transcript events
// ─────────────────────────────────────────────────────────────────────────────

interface EventRow {
  ledger_seq: number;
  event_id: string;
  session_id: string | null;
  agent_node_id: string | null;
  run_id: string | null;
  occurred_at: string | null;
  ingested_at: string;
  payload_json: string;
}

function parseJson(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function compactionCards(
  db: DatabaseInstance,
  recentLimit: number,
  headSeq: number,
): Array<Record<string, unknown>> {
  const rows = db
    .prepare(
      `SELECT ledger_seq, event_id, session_id, agent_node_id, run_id, occurred_at, ingested_at, payload_json
       FROM harbor_events
       WHERE stream_type = 'transcript-event' AND kind = 'compaction_packet'
       ORDER BY ledger_seq DESC LIMIT ?`,
    )
    .all(recentLimit) as EventRow[];

  return rows.map((row) => {
    const envelope = parseJson(row.payload_json);
    const packet =
      envelope.payloadJson && typeof envelope.payloadJson === 'object' && !Array.isArray(envelope.payloadJson)
        ? (envelope.payloadJson as Record<string, unknown>)
        : {};
    const identity =
      packet.identity && typeof packet.identity === 'object' && !Array.isArray(packet.identity)
        ? (packet.identity as Record<string, unknown>)
        : {};
    const validator =
      packet.validator && typeof packet.validator === 'object' && !Array.isArray(packet.validator)
        ? (packet.validator as Record<string, unknown>)
        : {};
    const task = s(identity.task);
    const obligations = Array.isArray(packet.obligations) ? packet.obligations.length : 0;
    const validatorFailed = validator.passed === false;

    return {
      schema: BLACKBOARD_ITEM_SCHEMA,
      itemId: `bbi_compaction_${row.event_id}`,
      kind: 'transcript-episode',
      title: task ? `Compaction packet: ${task}` : 'Compaction packet',
      detail:
        `${obligations} obligation(s) carried.` +
        (validatorFailed
          ? ' VALIDATOR FAILED — consumers must refuse this packet (ADR-0097 §2).'
          : validator.passed === true
            ? ' Validator passed.'
            : ' Validator verdict not recorded.'),
      subjects: row.session_id ? [{ kind: 'session', ref: row.session_id }] : [],
      agentNodeId: row.agent_node_id,
      sessionId: row.session_id,
      runId: row.run_id,
      severity: validatorFailed ? 'warning' : 'info',
      confidence: 1,
      status: 'active',
      supersededBy: null,
      postedAt: row.occurred_at ?? row.ingested_at,
      updatedAt: null,
      expiresAt: null,
      assertedBy: { kind: 'projection', agentNodeId: null },
      citations: [
        {
          kind: 'transcript-event',
          transcriptEventId: row.event_id,
          ...(row.session_id ? { sessionId: row.session_id } : {}),
        },
      ],
      projection: ledgerFreshness(headSeq),
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Family 5 — recent work-receipt ledger facts
// ─────────────────────────────────────────────────────────────────────────────

function receiptCards(
  db: DatabaseInstance,
  recentLimit: number,
  headSeq: number,
): Array<Record<string, unknown>> {
  const rows = db
    .prepare(
      `SELECT ledger_seq, event_id, session_id, agent_node_id, run_id, occurred_at, ingested_at, payload_json
       FROM harbor_events
       WHERE stream_type = 'work-receipt'
       ORDER BY ledger_seq DESC LIMIT ?`,
    )
    .all(recentLimit) as EventRow[];

  return rows.map((row) => {
    const payload = parseJson(row.payload_json);
    const strength = s(payload.strength) ?? 'unknown';
    const verification = s(payload.verificationStatus) ?? 'unverified';
    const prRefs = Array.isArray(payload.prRefs)
      ? payload.prRefs.filter((p): p is string => typeof p === 'string')
      : [];
    const failed = verification === 'failed';

    return {
      schema: BLACKBOARD_ITEM_SCHEMA,
      itemId: `bbi_receipt_${row.event_id}`,
      kind: 'work-receipt',
      title: `Work receipt (${strength}, ${verification})${prRefs.length > 0 ? `: ${prRefs[0]}` : ''}`,
      detail:
        `Receipt ${row.event_id} — strength ${strength}, verification ${verification}.` +
        (prRefs.length > 0 ? ` PRs: ${prRefs.join(', ')}.` : ''),
      subjects: [
        // The resolvable zoom target: GET /receipts/:id serves this ledger
        // fact directly (subjects.kind is an open string per the frozen
        // schema). The citation below stays kind `transcript-event` because
        // the frozen v0 citation enum is transcript-event | file | claim —
        // its id is the harbor_events event_id, which /receipts/:id resolves.
        { kind: 'receipt', ref: row.event_id },
        ...(row.session_id ? [{ kind: 'session', ref: row.session_id }] : []),
        ...prRefs.map((pr) => ({ kind: 'pr', ref: pr })),
      ],
      agentNodeId: row.agent_node_id,
      sessionId: row.session_id,
      runId: row.run_id,
      severity: failed ? 'warning' : 'info',
      confidence: 1,
      status: 'active',
      supersededBy: null,
      postedAt: row.occurred_at ?? row.ingested_at,
      updatedAt: null,
      expiresAt: null,
      assertedBy: { kind: 'projection', agentNodeId: null },
      // The receipt is itself a ledger fact; the citation's id resolves in
      // harbor_events (the frozen citation kinds are transcript-event | file |
      // claim; the ledger event id is the zoom target).
      citations: [
        {
          kind: 'transcript-event',
          transcriptEventId: row.event_id,
          ...(row.session_id ? { sessionId: row.session_id } : {}),
        },
      ],
      projection: ledgerFreshness(headSeq),
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// The read surface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Aggregate the read-only blackboard: one legible list of BlackboardItem cards
 * over ledger facts + live claims. Severity-major (critical → info), then
 * newest-first inside a severity band — conflicts surface above housekeeping.
 *
 * Every synthesized card is asserted against the frozen M6 schema before it
 * leaves this function; a drifted shape throws (fail closed) rather than
 * shipping. Explicit asserted items that fail validation are dropped and
 * counted in `droppedInvalid`.
 */
export function getBlackboard(
  db: DatabaseInstance,
  filter: BlackboardFilter = {},
): BlackboardReadResult {
  ensureEventLedgerSchema(db);
  const headSeq = ledgerHeadSeq(db);
  const nowIso = new Date().toISOString();
  const recentLimit = Math.max(1, Math.min(filter.recentLimit ?? 50, 200));
  const limit = Math.max(1, Math.min(filter.limit ?? 100, 500));

  const asserted = readAssertedItems(db, recentLimit, nowIso, headSeq);
  const claims = readActiveClaims(db);

  const synthesized: Array<Record<string, unknown>> = [
    ...claims.map(claimCard),
    ...contestedCards(claims),
    ...compactionCards(db, recentLimit, headSeq),
    ...receiptCards(db, recentLimit, headSeq),
  ];
  // Our own cards must match the frozen contract exactly — throw on drift.
  for (const item of synthesized) assertAgainstSchema('blackboard-item', item);

  let items = [...asserted.items, ...synthesized];

  if (filter.kind) items = items.filter((i) => i.kind === filter.kind);
  if (filter.sessionId) items = items.filter((i) => i.sessionId === filter.sessionId);
  if (filter.agentNodeId) items = items.filter((i) => i.agentNodeId === filter.agentNodeId);

  items.sort((a, b) => {
    const bySeverity = severityRank(b) - severityRank(a);
    if (bySeverity !== 0) return bySeverity;
    const aAt = s(a.postedAt) ?? '';
    const bAt = s(b.postedAt) ?? '';
    return bAt.localeCompare(aAt);
  });

  return {
    items: items.slice(0, limit),
    droppedInvalid: asserted.dropped,
    headSeq,
    generatedAt: nowIso,
  };
}
