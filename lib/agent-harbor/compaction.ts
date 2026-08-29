/**
 * Agent Harbor M6 — the Longshoreman compactor (ADR-0097 phase 1;
 * binder ch04 "How Longshoremen compact Voyagers"; ch07 M6 gate lines 1–2:
 * "force context threshold and see compaction packet; resume successor from
 * packet and transcript").
 *
 * Produces a CompactionPacket (schemas/agent-harbor/v0/
 * compaction-packet.schema.json — frozen, ADR-0097) when context pressure
 * crosses the ch04 thresholds. The packet is the payload of a first-class
 * `compaction_packet` transcript event appended to the SAME append-only
 * session ledger it summarizes — the original transcript is never mutated,
 * and `sourceTranscript{headEventId, headHash, throughSequence}` pins the
 * packet to the exact transcript prefix it covers so a successor's resume is
 * verifiable against the per-session hash chain (F0 TranscriptEvent).
 *
 * THE CITED-COMPACTION RULE (ch04, executable here, not a comment):
 *   "The packet must cite source events. A compaction that cannot be traced
 *    back is too easy to hallucinate." / "The validator fails uncited factual
 *    claims and warns when active obligations are missing."
 * `validateCompactionPacket` IS that validator: it fails any factual claim
 * without a resolvable citation (and, given a ledger, verifies the cited
 * transcript events actually exist in the cited session), enforces the
 * ADR-0097 §2 cross-field citation rules the frozen keyword subset cannot
 * express (kind=transcript-event ⇒ transcriptEventId, kind=file ⇒ fileRef,
 * kind=claim ⇒ claimRef), and warns — without failing — when active
 * obligations known to the caller are missing from the packet. Its verdict is
 * embedded in the packet's `validator` block; `buildCompactionPacket` throws
 * rather than emit a packet that failed, and `resumeFromPacket` refuses
 * `passed: false` (consumers must refuse an unvalidated packet).
 *
 * Skill grafts honored (cited in the M6 compaction PR):
 *   - context-economics-for-agent-swarms: the packet is compaction-for-agents
 *     AND legibility-for-humans; legibility-with-zoom means every excerpt is
 *     a lens onto the ledger (citation first, convenience text second), never
 *     a replacement for it — which is why recursive-summarization collapse is
 *     detectable: the chain of `sourceTranscript` pins always leads back to
 *     raw events.
 *   - always-on-agent-inputs: the packet is the successor's primary input;
 *     `resumeFromPacket` returns a bounded bootstrap (packet + cited
 *     transcript prefix handles), not an unbudgeted transcript dump.
 *   - agent-compliance-conformance: a packet's embedded validator verdict is
 *     a self-report; resume re-runs the validator and re-verifies the hash
 *     pins against the ledger — a forged `passed: true` cannot move policy.
 *   - agent-interchange-formats: schema-first envelope with the v0 const
 *     discriminator; tolerant reader (unknown packet fields ride along);
 *     cross-field rules enforced by this normative module, the same pattern
 *     as ADR-0095's witnessing invariant and ADR-0096's macaroon authorityRef.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseInstance } from '../sqlite-runtime.js';
import { supportsInteractiveCompactionPacketProvider } from '../squid/hook-shape.js';
import {
  appendEvent,
  type AppendResult,
  type HarborPayload,
  type LedgerRow,
  verifySessionChain,
} from './event-ledger.js';
import { assertAgainstSchema } from './schema-validate.js';
import {
  assessContextEnvelope,
  classifyPressure,
  type ContextEnvelope,
  type PressureAssessment,
} from './context-pressure.js';

// ─────────────────────────────────────────────────────────────────────────────
// Contract-mirroring types (the frozen schema wins on any disagreement)
// ─────────────────────────────────────────────────────────────────────────────

export const CITATION_KINDS = ['transcript-event', 'file', 'claim'] as const;
export type CitationKind = (typeof CITATION_KINDS)[number];

export interface Citation {
  kind: CitationKind;
  transcriptEventId?: string;
  span?: { start?: number; end?: number };
  fileRef?: string;
  claimRef?: string;
  sessionId?: string;
  [extra: string]: unknown;
}

export interface FactualClaim {
  claimId?: string | null;
  text: string;
  confidence?: number;
  citations: Citation[];
  [extra: string]: unknown;
}

export interface Obligation {
  obligationId?: string | null;
  text: string;
  status: 'open' | 'blocked' | 'in-progress' | 'done';
  citations?: Citation[];
  [extra: string]: unknown;
}

export interface Decision {
  text: string;
  rationale?: string;
  citations?: Citation[];
  [extra: string]: unknown;
}

export interface CompactionPacket {
  schema: 'pd.agent-harbor.compaction-packet.v0';
  packetId: string;
  agentNodeId: string;
  sessionId: string;
  runId?: string | null;
  createdAt: string;
  createdBy: { kind: 'longshoreman' | 'self' | 'daemon' | 'operator'; agentNodeId?: string | null };
  trigger: {
    kind: 'context-threshold' | 'operator-request' | 'successor-handoff' | 'checkpoint' | 'session-end';
    pressure?: number;
    contextEnvelopeRef?: string | null;
  };
  identity: { role?: string; task: string; successCriteria?: string[]; operatorInstructions?: string[] };
  obligations: Obligation[];
  factualClaims: FactualClaim[];
  omittedKnownRisks?: Array<{ text: string; reason?: string }>;
  workspace?: { worktree?: string | null; files?: string[]; claims?: string[]; diffSummary?: string | null };
  commandsRun?: Array<{ command: string; exitCode?: number | null; resultSummary?: string; transcriptEventId?: string | null }>;
  reviewState?: { prRef?: string | null; ciState?: string | null; unresolvedThreads?: number };
  /**
   * Optional interactive-adapter proof. The event is re-read on resume; this
   * is an opaque coverage receipt, never a copied tool transcript or output.
   */
  interactiveToolPairCoverage?: {
    receiptEventId: string;
    provider: string;
    sessionId: string;
    observationId: string;
    coveredThroughLedgerSeq: number;
    coverageRef: string;
  };
  blockers?: string[];
  decisions?: Decision[];
  transcriptExcerpts?: Array<{ citation: Citation; excerpt?: string }>;
  nextAction: { recommendation: string; safetyConstraints?: string[]; budgetRemaining?: number | null };
  sourceTranscript: { headEventId: string; headHash: string; throughSequence?: number };
  validator: PacketValidatorResult;
  transcriptEventId?: string | null;
  [extra: string]: unknown;
}

/** The embedded ch04 validator block shape (frozen `validator` property). */
export interface PacketValidatorResult {
  passed: boolean;
  validatedBy?: string | null;
  uncitedClaimCount: number;
  missingObligationWarnings: string[];
  /** Runtime detail (tolerant-reader extra field): why validation failed. */
  errors?: string[];
  [extra: string]: unknown;
}

export class CompactionValidationError extends Error {
  code = 'COMPACTION_VALIDATION' as const;
  constructor(
    message: string,
    public readonly result: PacketValidatorResult,
  ) {
    super(message);
  }
}

export class ResumeVerificationError extends Error {
  code = 'RESUME_VERIFICATION' as const;
}

// ─────────────────────────────────────────────────────────────────────────────
// Citation cross-field validation (ADR-0097 §2 — runtime-enforced because the
// frozen fail-closed keyword subset has no oneOf/if)
// ─────────────────────────────────────────────────────────────────────────────

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/** Structural cross-field checks for one citation. Returns error strings. */
export function validateCitation(citation: Citation, path: string): string[] {
  const errors: string[] = [];
  if (!CITATION_KINDS.includes(citation.kind)) {
    errors.push(`${path}: unknown citation kind ${JSON.stringify(citation.kind)}`);
    return errors;
  }
  if (citation.kind === 'transcript-event' && !nonEmptyString(citation.transcriptEventId)) {
    errors.push(`${path}: kind "transcript-event" requires transcriptEventId (ADR-0097 §2)`);
  }
  if (citation.kind === 'file' && !nonEmptyString(citation.fileRef)) {
    errors.push(`${path}: kind "file" requires fileRef (ADR-0097 §2)`);
  }
  if (citation.kind === 'claim' && !nonEmptyString(citation.claimRef)) {
    errors.push(`${path}: kind "claim" requires claimRef (ADR-0097 §2)`);
  }
  const span = citation.span;
  if (span && typeof span.start === 'number' && typeof span.end === 'number' && span.end < span.start) {
    errors.push(`${path}: span end ${span.end} precedes start ${span.start}`);
  }
  return errors;
}

/** True when a citation is structurally sound AND resolvable against the ledger (when given one). */
function citationResolves(
  citation: Citation,
  path: string,
  packetSessionId: string,
  db: DatabaseInstance | undefined,
  errors: string[],
): boolean {
  const structural = validateCitation(citation, path);
  if (structural.length > 0) {
    errors.push(...structural);
    return false;
  }
  if (db && citation.kind === 'transcript-event') {
    const expectedSession = citation.sessionId ?? packetSessionId;
    const row = db
      .prepare(
        "SELECT session_id FROM harbor_events WHERE stream_type = 'transcript-event' AND event_id = ?",
      )
      .get(citation.transcriptEventId) as { session_id: string | null } | undefined;
    if (!row) {
      errors.push(`${path}: cited transcript event ${citation.transcriptEventId} does not exist in the ledger`);
      return false;
    }
    if (row.session_id !== expectedSession) {
      errors.push(
        `${path}: cited transcript event ${citation.transcriptEventId} belongs to session ` +
          `${JSON.stringify(row.session_id)}, not the cited session ${JSON.stringify(expectedSession)}`,
      );
      return false;
    }
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// The ch04 validator — "fails uncited factual claims and warns when active
// obligations are missing"
// ─────────────────────────────────────────────────────────────────────────────

export interface ValidatePacketOptions {
  /**
   * When provided, transcript-event citations are resolved against the ledger
   * (existence + session match), not just structurally checked.
   */
  db?: DatabaseInstance;
  /**
   * Active obligations the daemon/caller knows about. Any that are not `done`
   * and are missing from the packet produce a warning (never a failure).
   */
  knownObligations?: Array<{ obligationId?: string | null; text: string; status?: Obligation['status'] }>;
  /** Recorded in the result's validatedBy. */
  validatedBy?: string;
}

/**
 * The executable ch04 packet validator (ADR-0097 §2). Fails (passed: false):
 *   - factual claims with zero citations (also schema-invalid via minItems);
 *   - citations violating the cross-field rules (kind ⇒ ref field);
 *   - citations to transcript events that do not exist in the cited session
 *     (when a ledger is provided);
 *   - obligation/decision/excerpt citations violating the same rules.
 * Warns (passed unaffected):
 *   - active known obligations missing from the packet.
 *
 * This function never mutates the packet; it returns the verdict block the
 * builder embeds under `validator`.
 */
export function validateCompactionPacket(
  packet: CompactionPacket,
  opts: ValidatePacketOptions = {},
): PacketValidatorResult {
  const errors: string[] = [];
  let uncitedClaimCount = 0;

  const claims = Array.isArray(packet.factualClaims) ? packet.factualClaims : [];
  claims.forEach((claim, i) => {
    const path = `factualClaims/${i}`;
    const citations = Array.isArray(claim.citations) ? claim.citations : [];
    if (citations.length === 0) {
      uncitedClaimCount += 1;
      errors.push(`${path}: factual claim has no citations — "a compaction that cannot be traced back is too easy to hallucinate" (ch04)`);
      return;
    }
    let resolvable = 0;
    citations.forEach((citation, j) => {
      if (citationResolves(citation, `${path}/citations/${j}`, packet.sessionId, opts.db, errors)) {
        resolvable += 1;
      }
    });
    if (resolvable === 0) {
      // Every citation on this claim is broken — the claim is effectively uncited.
      uncitedClaimCount += 1;
    }
  });

  const obligations = Array.isArray(packet.obligations) ? packet.obligations : [];
  obligations.forEach((obligation, i) => {
    (obligation.citations ?? []).forEach((citation, j) => {
      citationResolves(citation, `obligations/${i}/citations/${j}`, packet.sessionId, opts.db, errors);
    });
  });
  (packet.decisions ?? []).forEach((decision, i) => {
    (decision.citations ?? []).forEach((citation, j) => {
      citationResolves(citation, `decisions/${i}/citations/${j}`, packet.sessionId, opts.db, errors);
    });
  });
  (packet.transcriptExcerpts ?? []).forEach((excerpt, i) => {
    citationResolves(excerpt.citation, `transcriptExcerpts/${i}/citation`, packet.sessionId, opts.db, errors);
  });

  // Missing-active-obligation WARNINGS (ch04: warn, never fail).
  const missingObligationWarnings: string[] = [];
  const packetObligationIds = new Set(
    obligations.map((o) => o.obligationId).filter((id): id is string => nonEmptyString(id)),
  );
  const packetObligationTexts = new Set(obligations.map((o) => o.text));
  for (const known of opts.knownObligations ?? []) {
    if (known.status === 'done') continue;
    const matched =
      (nonEmptyString(known.obligationId) && packetObligationIds.has(known.obligationId)) ||
      packetObligationTexts.has(known.text);
    if (!matched) {
      missingObligationWarnings.push(
        `active obligation missing from packet: ${known.obligationId ?? '(no id)'} "${known.text}"`,
      );
    }
  }

  return {
    passed: errors.length === 0,
    validatedBy: opts.validatedBy ?? 'lib/agent-harbor/compaction.ts#validateCompactionPacket',
    uncitedClaimCount,
    missingObligationWarnings,
    errors,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ledger extraction helpers (cited-by-construction)
// ─────────────────────────────────────────────────────────────────────────────

/** Bounded construction limits: older evidence remains addressable by ledger handle. */
export const MAX_COMPACTION_TAIL_EVENTS = 512;
export const MAX_PACKET_COMMANDS = 64;
export const MAX_PACKET_COMMAND_CHARS = 1_024;
export const MAX_PACKET_COMMAND_RESULT_CHARS = 2_048;
export const MAX_PACKET_EXCERPTS = 32;
export const MAX_PACKET_EXCERPT_CHARS = 1_024;
export const MAX_PACKET_EVENT_PAYLOAD_BYTES = 16 * 1024;
export const MAX_COMPACTION_PACKET_BYTES = 96 * 1024;
/** Metadata envelope allowance around a packet that already fits its own cap. */
const MAX_COMPACTION_PACKET_EVENT_BYTES = MAX_COMPACTION_PACKET_BYTES + 4 * 1024;
/** One more than the accepted count lets authority fail closed on duplicate context ids. */
const MAX_INTERACTIVE_CONTEXT_CANDIDATES = 33;

/**
 * Read only the tail that can become convenience text in a packet.  Oversize
 * source payloads remain in the append-only ledger, but are replaced with an
 * empty structured payload before JavaScript sees them; a compactor must not
 * parse an arbitrary multi-megabyte tool result on a provider hook deadline.
 */
function sessionTranscriptTail(
  db: DatabaseInstance,
  sessionId: string,
  limit = MAX_COMPACTION_TAIL_EVENTS,
  throughLedgerSeq?: number,
): LedgerRow[] {
  const rows = db.prepare(`
    SELECT ledger_seq, event_id, stream_type, agent_node_id, session_id, run_id,
           sequence, kind, occurred_at, ingested_at, idempotency_key, schema_id,
           CASE WHEN LENGTH(CAST(payload_json AS BLOB)) <= ? THEN payload_json ELSE '{"payloadJson":{}}' END AS payload_json,
           content_hash, prev_hash
    FROM harbor_events
    WHERE stream_type = 'transcript-event'
      AND session_id = ?
      AND (? IS NULL OR ledger_seq <= ?)
    ORDER BY ledger_seq DESC
    LIMIT ?
  `).all(
    MAX_PACKET_EVENT_PAYLOAD_BYTES,
    sessionId,
    throughLedgerSeq ?? null,
    throughLedgerSeq ?? null,
    Math.max(1, Math.min(limit, MAX_COMPACTION_TAIL_EVENTS)),
  ) as LedgerRow[];
  return rows.reverse();
}

function boundedText(value: string, maximum: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maximum) return value;
  const suffix = '…[truncated]';
  const utf8Prefix = (input: string, budget: number): string => {
    let prefix = '';
    let used = 0;
    // `for…of` advances by Unicode code point, so no prefix ends midway
    // through a UTF-8 rune and accidentally decodes into U+FFFD bytes.
    for (const codePoint of input) {
      const bytes = Buffer.byteLength(codePoint, 'utf8');
      if (used + bytes > budget) break;
      prefix += codePoint;
      used += bytes;
    }
    return prefix;
  };
  const suffixBytes = Buffer.byteLength(suffix, 'utf8');
  // Tiny caller budgets are still strict byte budgets: retain only a complete
  // UTF-8 prefix of the suffix rather than appending a 14-byte marker.
  if (maximum <= suffixBytes) return utf8Prefix(suffix, maximum);
  return utf8Prefix(value, maximum - suffixBytes) + suffix;
}

/** Deterministic excerpt text from an event payload (bounded; never invents). */
function excerptFromRow(row: LedgerRow, maxChars: number): string {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(row.payload_json) as Record<string, unknown>;
  } catch {
    // A malformed foreign payload stays a cited ledger handle, not packet text.
  }
  const payloadJson = (payload.payloadJson ?? {}) as Record<string, unknown>;
  const text =
    (typeof payloadJson.text === 'string' && payloadJson.text) ||
    (typeof payloadJson.message === 'string' && payloadJson.message) ||
    (typeof payloadJson.command === 'string' && payloadJson.command) ||
    JSON.stringify(payloadJson);
  return boundedText(text, Math.min(Math.max(1, maxChars), MAX_PACKET_EXCERPT_CHARS));
}

/** Canonical interactive tool id forms; mirrors ContextContinuity validation. */
function toolCallId(row: LedgerRow): string | null {
  if (row.kind !== 'tool_call' && row.kind !== 'tool_result') return null;
  try {
    const outer = JSON.parse(row.payload_json) as { payloadJson?: unknown };
    const payload = outer.payloadJson;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    const fields = payload as Record<string, unknown>;
    const nested = fields.toolCall;
    const candidates = [
      fields.toolCallId,
      fields.tool_call_id,
      nested && typeof nested === 'object' && !Array.isArray(nested)
        ? (nested as Record<string, unknown>).id
        : null,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Filter a fixed-size convenience lens down to complete, correctly ordered
 * tool pairs. Non-tool rows retain their order. Tool rows without a stable id,
 * a mate in this exact lens, or a one-to-one ordering are omitted rather than
 * being separated by an excerpt/bootstrap boundary. The immutable ledger and
 * packet citations remain available for an explicit, pair-aware zoom.
 */
function omitSplitToolPairs(rows: LedgerRow[]): LedgerRow[] {
  const calls = new Map<string, number[]>();
  const results = new Map<string, number[]>();
  for (const [index, row] of rows.entries()) {
    const id = toolCallId(row);
    if (!id) continue;
    const target = row.kind === 'tool_call' ? calls : results;
    const indexes = target.get(id) ?? [];
    indexes.push(index);
    target.set(id, indexes);
  }
  return rows.filter((row, index) => {
    if (row.kind !== 'tool_call' && row.kind !== 'tool_result') return true;
    const id = toolCallId(row);
    if (!id) return false;
    const callIndexes = calls.get(id) ?? [];
    const resultIndexes = results.get(id) ?? [];
    return callIndexes.length === 1
      && resultIndexes.length === 1
      && callIndexes[0] < resultIndexes[0]
      && (row.kind === 'tool_call' ? callIndexes[0] : resultIndexes[0]) === index;
  });
}

/**
 * Extract commands/tests run from the transcript (ch04 packet contents list),
 * cited by construction: each entry carries the transcript event id it came
 * from. Deterministic — reads `shell_command` events' payloadJson.command and
 * exitCode; nothing is inferred.
 */
export function extractCommandsRun(
  rows: LedgerRow[],
  maximum = MAX_PACKET_COMMANDS,
): NonNullable<CompactionPacket['commandsRun']> {
  const commands: NonNullable<CompactionPacket['commandsRun']> = [];
  for (const row of rows) {
    if (row.kind !== 'shell_command') continue;
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(row.payload_json) as Record<string, unknown>;
    } catch {
      continue;
    }
    const payloadJson = (payload.payloadJson ?? {}) as Record<string, unknown>;
    if (!nonEmptyString(payloadJson.command)) continue;
    commands.push({
      command: boundedText(payloadJson.command, MAX_PACKET_COMMAND_CHARS),
      exitCode: typeof payloadJson.exitCode === 'number' ? payloadJson.exitCode : null,
      resultSummary: typeof payloadJson.resultSummary === 'string'
        ? boundedText(payloadJson.resultSummary, MAX_PACKET_COMMAND_RESULT_CHARS)
        : undefined,
      transcriptEventId: row.event_id,
    });
  }
  return commands.slice(-Math.max(0, Math.min(maximum, MAX_PACKET_COMMANDS)));
}

function boundedCommands(
  commands: CompactionPacket['commandsRun'] | undefined,
): NonNullable<CompactionPacket['commandsRun']> {
  return (commands ?? []).slice(-MAX_PACKET_COMMANDS).map((command) => ({
    command: boundedText(command.command, MAX_PACKET_COMMAND_CHARS),
    exitCode: command.exitCode ?? null,
    resultSummary: typeof command.resultSummary === 'string'
      ? boundedText(command.resultSummary, MAX_PACKET_COMMAND_RESULT_CHARS)
      : undefined,
    transcriptEventId: command.transcriptEventId ?? null,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// The Longshoreman builder
// ─────────────────────────────────────────────────────────────────────────────

export interface BuildPacketInput {
  sessionId: string;
  agentNodeId: string;
  runId?: string | null;
  createdBy: CompactionPacket['createdBy'];
  /**
   * Either an explicit trigger or the ContextEnvelope that fired — when the
   * envelope is given, the trigger is derived from it (kind context-threshold,
   * pressure = recomputed clamped ratio, contextEnvelopeRef = envelopeId).
   */
  trigger?: CompactionPacket['trigger'];
  contextEnvelope?: ContextEnvelope;
  identity: CompactionPacket['identity'];
  /** Compactor-authored content. Factual claims MUST arrive with citations. */
  factualClaims: FactualClaim[];
  obligations: Obligation[];
  nextAction: CompactionPacket['nextAction'];
  decisions?: Decision[];
  blockers?: string[];
  omittedKnownRisks?: CompactionPacket['omittedKnownRisks'];
  workspace?: CompactionPacket['workspace'];
  reviewState?: CompactionPacket['reviewState'];
  interactiveToolPairCoverage?: CompactionPacket['interactiveToolPairCoverage'];
  /** Merged with the commands auto-extracted from the transcript. */
  commandsRun?: CompactionPacket['commandsRun'];
  /** Active obligations known to the caller/daemon — drives the warning list. */
  knownObligations?: ValidatePacketOptions['knownObligations'];
  /** How many trailing events become cited transcriptExcerpts (default 5). */
  excerptCount?: number;
  /** Max characters per excerpt convenience copy (default 240). */
  excerptMaxChars?: number;
  /** Append the compaction_packet transcript event (default true). */
  append?: boolean;
  packetId?: string;
  /** Deterministic caller-owned event ID for crash/retry-safe packet writes. */
  eventId?: string;
  createdAt?: string;
}

export interface BuildPacketResult {
  packet: CompactionPacket;
  /** The pressure assessment behind the trigger (when envelope-derived). */
  pressure: PressureAssessment | null;
  /** Ledger append result for the compaction_packet event (null when append: false). */
  appendResult: AppendResult | null;
}

/**
 * A direct builder caller may supply an interactive ContextEnvelope, but it
 * may not detach that envelope from the durable boundary the packet will pin.
 * The coordinator writes the ContextEnvelope immediately before calling the
 * builder; checking that relationship here keeps the exported builder from
 * turning a later unrelated transcript row into an escape hatch around the
 * interactive coverage proof.
 */
function interactiveInputBoundaryError(
  contextEnvelope: ContextEnvelope | undefined,
  head: Pick<LedgerRow, 'event_id' | 'kind' | 'payload_json'>,
  expectedSessionId: string,
  expectedAgentNodeId: string,
): string | null {
  const requestedAdapter = contextEnvelope?.sourceAdapter;
  const providerMatch = typeof requestedAdapter === 'string'
    ? /^interactive:([a-z0-9-]+)$/i.exec(requestedAdapter)
    : null;
  if (!contextEnvelope || !providerMatch) return null;
  const issuanceError = interactiveProviderIssuanceError(providerMatch[1].toLowerCase());
  if (issuanceError) return issuanceError;
  try {
    assertAgainstSchema('context-envelope', contextEnvelope);
  } catch {
    return 'interactive ContextEnvelope fails the frozen context-envelope schema';
  }
  if (contextEnvelope.sessionId !== expectedSessionId || contextEnvelope.agentNodeId !== expectedAgentNodeId) {
    return 'interactive ContextEnvelope is not bound to this packet session and agent';
  }
  if (head.kind !== 'context_pressure') {
    return 'interactive ContextEnvelope must be the durable context-pressure source head';
  }
  if (!contextEnvelope.sourceEventId || contextEnvelope.sourceEventId !== head.event_id) {
    return 'interactive ContextEnvelope sourceEventId must identify the exact durable context-pressure source head';
  }
  try {
    const outer = JSON.parse(head.payload_json) as { payloadJson?: { contextEnvelope?: unknown } };
    const durable = outer.payloadJson?.contextEnvelope;
    if (!durable || typeof durable !== 'object' || Array.isArray(durable)) {
      return 'interactive context-pressure source head has no readable ContextEnvelope';
    }
    if (canonicalJson(durable) !== canonicalJson(contextEnvelope)) {
      return 'interactive ContextEnvelope does not exactly match its durable context-pressure source head';
    }
  } catch {
    return 'interactive context-pressure source head ContextEnvelope cannot be parsed';
  }
  return null;
}

/**
 * A deterministic packet event id is an idempotency key, not a hint. On a
 * retry, return the already committed packet rather than a newly constructed
 * in-memory body whose source head may have advanced while the caller crashed.
 */
interface PersistedPacketRetry {
  packet: CompactionPacket;
  appendResult: AppendResult;
}

/**
 * Resolve an existing deterministic packet before any current-tail work. A
 * missing row means the caller may proceed to construction; every other row
 * is either the exact validated packet or a fail-closed event-id collision.
 */
function persistedPacketForRetry(
  db: DatabaseInstance,
  eventId: string,
  expectedSessionId: string,
  expectedAgentNodeId: string,
): PersistedPacketRetry | null {
  const row = db.prepare(`
    SELECT ledger_seq, event_id, session_id, agent_node_id, kind, content_hash, prev_hash,
           CASE WHEN LENGTH(CAST(payload_json AS BLOB)) <= ? THEN payload_json ELSE '{}' END AS payload_json
    FROM harbor_events
    WHERE stream_type = 'transcript-event' AND event_id = ?
    LIMIT 1
  `).get(MAX_COMPACTION_PACKET_EVENT_BYTES, eventId) as {
    ledger_seq: number;
    event_id: string;
    session_id: string | null;
    agent_node_id: string | null;
    kind: string | null;
    content_hash: string | null;
    prev_hash: string | null;
    payload_json: string;
  } | undefined;
  if (!row) return null;
  if (
    row.session_id !== expectedSessionId
    || row.agent_node_id !== expectedAgentNodeId
    || row.kind !== 'compaction_packet'
  ) {
    throw new CompactionValidationError(
      `deterministic packet event ${eventId} resolves to a different durable transcript event (event-id collision)`,
      { passed: false, uncitedClaimCount: 0, missingObligationWarnings: [], errors: ['event-id collision'] },
    );
  }
  try {
    const outer = JSON.parse(row.payload_json) as { payloadJson?: CompactionPacket };
    const packet = outer.payloadJson;
    if (
      !packet
      || packet.transcriptEventId !== eventId
      || packet.sessionId !== expectedSessionId
      || packet.agentNodeId !== expectedAgentNodeId
    ) {
      throw new Error('stored payload does not identify the requested packet');
    }
    assertAgainstSchema('compaction-packet', packet);
    const verdict = validateCompactionPacket(packet, {
      db,
      validatedBy: 'lib/agent-harbor/compaction.ts#persistedPacketForRetry',
    });
    if (!verdict.passed || packet.validator?.passed !== true) {
      throw new Error((verdict.errors ?? ['stored packet validator failed']).join('; '));
    }
    if (!Number.isInteger(row.ledger_seq) || row.ledger_seq < 1) {
      throw new Error('stored packet has no durable ledger sequence');
    }
    return {
      packet,
      appendResult: {
        duplicate: true,
        ledgerSeq: row.ledger_seq,
        eventId: row.event_id,
        contentHash: row.content_hash,
        prevHash: row.prev_hash,
      },
    };
  } catch (error) {
    throw new CompactionValidationError(
      `deterministic packet event ${eventId} has no reusable validated packet payload`,
      {
        passed: false,
        uncitedClaimCount: 0,
        missingObligationWarnings: [],
        errors: [error instanceof Error ? error.message : String(error)],
      },
    );
  }
}

/**
 * A deterministic packet id is scoped to the exact interactive source
 * boundary, not merely to a session and agent. Without this check an older
 * generic packet can occupy an interactive retry key and be returned before
 * the input ContextEnvelope/coverage contract is examined.
 */
function persistedInteractiveInputBoundaryError(
  db: DatabaseInstance,
  packet: CompactionPacket,
  input: Pick<BuildPacketInput, 'contextEnvelope' | 'sessionId' | 'agentNodeId'>,
): string | null {
  const requestedAdapter = input.contextEnvelope?.sourceAdapter;
  if (typeof requestedAdapter !== 'string' || !/^interactive:[a-z0-9-]+$/i.test(requestedAdapter)) return null;
  const requested = input.contextEnvelope!;
  if (
    packet.trigger.contextEnvelopeRef !== requested.envelopeId
    || packet.sourceTranscript?.headEventId !== requested.sourceEventId
  ) {
    return 'persisted deterministic packet does not match the requested interactive ContextEnvelope boundary';
  }
  const head = db.prepare(`
    SELECT ledger_seq, event_id, stream_type, agent_node_id, session_id, run_id,
           sequence, kind, occurred_at, ingested_at, idempotency_key, schema_id,
           CASE WHEN LENGTH(CAST(payload_json AS BLOB)) <= ? THEN payload_json ELSE '{}' END AS payload_json,
           content_hash, prev_hash
    FROM harbor_events
    WHERE stream_type = 'transcript-event' AND event_id = ?
    LIMIT 1
  `).get(MAX_PACKET_EVENT_PAYLOAD_BYTES, packet.sourceTranscript.headEventId) as LedgerRow | undefined;
  if (!head) return 'persisted deterministic packet source head is absent from the ledger';
  return interactiveInputBoundaryError(requested, head, input.sessionId, input.agentNodeId);
}

/**
 * Build, validate, and (by default) record a CompactionPacket for a session.
 *
 * Fail-closed: if the ch04 validator does not pass — an uncited factual
 * claim, a citation that violates the cross-field rules, or a citation to a
 * transcript event the ledger does not hold for that session — this THROWS
 * CompactionValidationError instead of emitting a packet with
 * `validator.passed: false`. A Longshoreman never ships a packet a consumer
 * is required to refuse.
 *
 * The original transcript is read, never written: the only ledger write is
 * the APPENDED `compaction_packet` event (append-only by trigger-enforced
 * schema), whose payload is the packet itself.
 */
export function buildCompactionPacket(db: DatabaseInstance, input: BuildPacketInput): BuildPacketResult {
  // The deterministic event id is the retry boundary, not an append-time
  // optimization. Check it before reading the current tail: a crashed caller
  // can return after committing the packet while later tools keep appending.
  // Reconstructing that newer tail may exceed a packet budget or otherwise
  // fail even though the original durable packet is valid and must replay.
  if (input.append !== false && input.eventId) {
    const persisted = persistedPacketForRetry(db, input.eventId, input.sessionId, input.agentNodeId);
    if (persisted) {
      const inputBoundaryError = persistedInteractiveInputBoundaryError(db, persisted.packet, input);
      if (inputBoundaryError) {
        throw new CompactionValidationError(
          `interactive compaction packet ${persisted.packet.packetId} has no valid persisted source boundary: ${inputBoundaryError}`,
          {
            passed: false,
            uncitedClaimCount: 0,
            missingObligationWarnings: [],
            errors: [inputBoundaryError],
          },
        );
      }
      const authorityError = interactivePacketAuthorityVerificationError(db, persisted.packet);
      if (authorityError) {
        throw new CompactionValidationError(
          `interactive compaction packet ${persisted.packet.packetId} has no valid persisted source boundary: ${authorityError}`,
          {
            passed: false,
            uncitedClaimCount: 0,
            missingObligationWarnings: [],
            errors: [authorityError],
          },
        );
      }
      return {
        packet: persisted.packet,
        pressure: null,
        appendResult: persisted.appendResult,
      };
    }
  }

  const rows = sessionTranscriptTail(db, input.sessionId);
  if (rows.length === 0) {
    throw new CompactionValidationError(
      `session ${input.sessionId} has no transcript events — nothing to compact, no chain head to pin sourceTranscript to`,
      { passed: false, uncitedClaimCount: 0, missingObligationWarnings: [], errors: ['empty transcript'] },
    );
  }
  const head = rows[rows.length - 1];
  if (!head.content_hash) {
    throw new CompactionValidationError(
      `transcript head ${head.event_id} has no contentHash — cannot pin sourceTranscript`,
      { passed: false, uncitedClaimCount: 0, missingObligationWarnings: [], errors: ['unhashed transcript head'] },
    );
  }

  // Trigger: envelope-derived when an envelope is given (ch04: hard behavior
  // tied to the envelope, not vague estimates).
  let pressure: PressureAssessment | null = null;
  let trigger = input.trigger;
  if (input.contextEnvelope) {
    assertAgainstSchema('context-envelope', input.contextEnvelope);
    pressure = classifyPressure(input.contextEnvelope.windowTokens, input.contextEnvelope.usedTokensEstimate);
    trigger = trigger ?? {
      kind: 'context-threshold',
      pressure: pressure.ratio,
      contextEnvelopeRef: input.contextEnvelope.envelopeId,
    };
  }
  if (!trigger) {
    throw new CompactionValidationError('a trigger or contextEnvelope is required', {
      passed: false,
      uncitedClaimCount: 0,
      missingObligationWarnings: [],
      errors: ['missing trigger'],
    });
  }

  // Cited-by-construction extractions.
  const extractedCommands = extractCommandsRun(rows);
  const excerptCount = Math.min(MAX_PACKET_EXCERPTS, Math.max(0, input.excerptCount ?? 5));
  const excerptMaxChars = Math.min(MAX_PACKET_EXCERPT_CHARS, Math.max(1, input.excerptMaxChars ?? 240));
  // slice(-0) === slice(0) would include the WHOLE transcript — the exact
  // opposite of "no excerpts" — so 0 must short-circuit to an empty lens set.
  const excerptRows = excerptCount === 0 ? [] : omitSplitToolPairs(rows.slice(-excerptCount));
  const transcriptExcerpts = excerptRows.map((row) => ({
    citation: { kind: 'transcript-event' as const, transcriptEventId: row.event_id },
    excerpt: excerptFromRow(row, excerptMaxChars),
  }));

  const packetId = input.packetId ?? `cpk_${randomUUID()}`;
  const eventId = input.append === false ? null : input.eventId ?? `evt_cpk_${randomUUID()}`;
  const packet: CompactionPacket = {
    schema: 'pd.agent-harbor.compaction-packet.v0',
    packetId,
    agentNodeId: input.agentNodeId,
    sessionId: input.sessionId,
    runId: input.runId ?? null,
    createdAt: input.createdAt ?? new Date().toISOString(),
    createdBy: input.createdBy,
    trigger,
    identity: input.identity,
    obligations: input.obligations,
    factualClaims: input.factualClaims,
    omittedKnownRisks: input.omittedKnownRisks ?? [],
    workspace: input.workspace,
    commandsRun: [...extractedCommands, ...boundedCommands(input.commandsRun)].slice(-MAX_PACKET_COMMANDS),
    reviewState: input.reviewState,
    interactiveToolPairCoverage: input.interactiveToolPairCoverage,
    blockers: input.blockers ?? [],
    decisions: input.decisions ?? [],
    transcriptExcerpts,
    nextAction: input.nextAction,
    sourceTranscript: {
      headEventId: head.event_id,
      headHash: head.content_hash,
      ...(typeof head.sequence === 'number' ? { throughSequence: head.sequence } : {}),
    },
    // Placeholder; replaced by the real verdict below (validator is required
    // by the frozen schema, and the verdict must cover the final shape).
    validator: { passed: false, uncitedClaimCount: 0, missingObligationWarnings: [] },
    transcriptEventId: eventId,
  };
  if (packet.workspace === undefined) delete packet.workspace;
  if (packet.reviewState === undefined) delete packet.reviewState;
  if (packet.interactiveToolPairCoverage === undefined) delete packet.interactiveToolPairCoverage;

  const inputBoundaryError = interactiveInputBoundaryError(
    input.contextEnvelope,
    head,
    input.sessionId,
    input.agentNodeId,
  );
  if (inputBoundaryError) {
    throw new CompactionValidationError(
      `interactive compaction packet ${packet.packetId} has no valid source boundary: ${inputBoundaryError}`,
      {
        passed: false,
        uncitedClaimCount: 0,
        missingObligationWarnings: [],
        errors: [inputBoundaryError],
      },
    );
  }

  // An interactive coverage receipt is authority, not convenience metadata.
  // Validate it against the already durable source boundary BEFORE this packet
  // is serialized or appended. Resume repeats this check because a packet is
  // untrusted input there too, but deferring the first check would let a
  // malformed or substituted receipt become durable evidence in the interim.
  const coverageError = interactiveCoverageVerificationError(db, packet, {
    eventId: head.event_id,
    ledgerSeq: head.ledger_seq,
    sessionId: head.session_id,
    agentNodeId: head.agent_node_id,
    kind: head.kind,
    payloadJson: head.payload_json,
  });
  if (coverageError) {
    throw new CompactionValidationError(
      `interactive tool-pair coverage for compaction packet ${packet.packetId} is not valid at its source boundary: ${coverageError}`,
      {
        passed: false,
        uncitedClaimCount: 0,
        missingObligationWarnings: [],
        errors: [coverageError],
      },
    );
  }
  const derivedBoundaryError = interactiveDerivedBoundaryVerificationError(db, packet);
  if (derivedBoundaryError) {
    throw new CompactionValidationError(
      `interactive compaction packet ${packet.packetId} has no valid derived source boundary: ${derivedBoundaryError}`,
      {
        passed: false,
        uncitedClaimCount: 0,
        missingObligationWarnings: [],
        errors: [derivedBoundaryError],
      },
    );
  }

  const serializedBytes = Buffer.byteLength(JSON.stringify(packet), 'utf8');
  if (serializedBytes > MAX_COMPACTION_PACKET_BYTES) {
    throw new CompactionValidationError(
      `compaction packet for session ${input.sessionId} exceeds the ${MAX_COMPACTION_PACKET_BYTES}-byte packet budget`,
      {
        passed: false,
        uncitedClaimCount: 0,
        missingObligationWarnings: [],
        errors: [`packet byte budget exceeded: ${serializedBytes}`],
      },
    );
  }

  const verdict = validateCompactionPacket(packet, {
    db,
    knownObligations: input.knownObligations,
    validatedBy: 'lib/agent-harbor/compaction.ts#buildCompactionPacket',
  });
  packet.validator = verdict;
  if (!verdict.passed) {
    throw new CompactionValidationError(
      `compaction packet for session ${input.sessionId} failed the ch04 validator ` +
        `(${verdict.uncitedClaimCount} uncited claim(s)): ${(verdict.errors ?? []).join('; ')}`,
      verdict,
    );
  }

  // The validator adds provenance and (on a failure) diagnostic metadata to
  // the frozen packet. Budget the exact bytes that will be appended, not the
  // smaller placeholder shape used to obtain the verdict.
  const finalizedBytes = Buffer.byteLength(JSON.stringify(packet), 'utf8');
  if (finalizedBytes > MAX_COMPACTION_PACKET_BYTES) {
    throw new CompactionValidationError(
      `compaction packet for session ${input.sessionId} exceeds the ${MAX_COMPACTION_PACKET_BYTES}-byte packet budget after validation`,
      {
        passed: false,
        uncitedClaimCount: 0,
        missingObligationWarnings: [],
        errors: [`packet byte budget exceeded after validation: ${finalizedBytes}`],
      },
    );
  }

  // Contract check: the emitted packet must match the frozen schema exactly.
  assertAgainstSchema('compaction-packet', packet);

  let appendResult: AppendResult | null = null;
  if (input.append !== false) {
    const nextSequence = (typeof head.sequence === 'number' ? head.sequence : rows.length) + 1;
    const event: HarborPayload = {
      eventId: eventId as string,
      sessionId: input.sessionId,
      agentNodeId: input.agentNodeId,
      sequence: nextSequence,
      occurredAt: packet.createdAt,
      schemaVersion: 1,
      kind: 'compaction_packet',
      visibility: 'operator',
      payloadJson: packet as unknown as Record<string, unknown>,
    };
    appendResult = appendEvent(db, { streamType: 'transcript-event', payload: event });
    if (appendResult.duplicate) {
      const persisted = persistedPacketForRetry(db, appendResult.eventId, input.sessionId, input.agentNodeId);
      if (!persisted) {
        throw new CompactionValidationError(
          `deterministic packet event ${appendResult.eventId} disappeared during retry resolution`,
          { passed: false, uncitedClaimCount: 0, missingObligationWarnings: [], errors: ['missing duplicate packet'] },
        );
      }
      const inputBoundaryError = persistedInteractiveInputBoundaryError(db, persisted.packet, input);
      if (inputBoundaryError) {
        throw new CompactionValidationError(
          `interactive compaction packet ${persisted.packet.packetId} has no valid persisted source boundary: ${inputBoundaryError}`,
          {
            passed: false,
            uncitedClaimCount: 0,
            missingObligationWarnings: [],
            errors: [inputBoundaryError],
          },
        );
      }
      const authorityError = interactivePacketAuthorityVerificationError(db, persisted.packet);
      if (authorityError) {
        throw new CompactionValidationError(
          `interactive compaction packet ${persisted.packet.packetId} has no valid persisted source boundary: ${authorityError}`,
          {
            passed: false,
            uncitedClaimCount: 0,
            missingObligationWarnings: [],
            errors: [authorityError],
          },
        );
      }
      return {
        packet: persisted.packet,
        pressure,
        appendResult: persisted.appendResult,
      };
    }
  }

  return { packet, pressure, appendResult };
}

// ─────────────────────────────────────────────────────────────────────────────
// Successor resume (M6 gate line 2)
// ─────────────────────────────────────────────────────────────────────────────

export interface SuccessorBootstrap {
  packet: CompactionPacket;
  sessionId: string;
  agentNodeId: string;
  /** The last cited durable pd-plan checkpoint, never reconstructed from a raw transcript tail. */
  planCheckpoint: { transcriptEventId: string; content: string; capturedAt: string } | null;
  /**
   * The bounded tail of the pinned transcript, as HANDLES (event id /
   * sequence / kind / ledger seq) in replay order — the successor zooms into
   * the ledger through these, it is not handed an unbudgeted transcript dump
   * (context-economics-for-agent-swarms: legibility-with-zoom).
   */
  transcriptPrefix: Array<{ transcriptEventId: string; sequence: number | null; kind: string | null; ledgerSeq: number }>;
  /** True when older transcript handles remain available only by explicit ledger paging. */
  transcriptPrefixTruncated: boolean;
  /** Ready-to-attach ContextEnvelope contextRefs entry for the packet. */
  contextRef: { kind: 'compaction-packet'; ref: string; droppable: false };
  /** Re-run validator verdict (never the packet's embedded self-report alone). */
  revalidation: PacketValidatorResult;
}

/**
 * A bootstrap gives a continuation enough recent cited handles to orient, not
 * an accidentally unbounded replay list. Earlier evidence remains addressable
 * through the append-only ledger and packet citations.
 */
export const MAX_SUCCESSOR_TRANSCRIPT_HANDLES = 128;

function planCheckpointForResume(
  db: DatabaseInstance,
  sessionId: string,
  throughLedgerSeq: number,
): SuccessorBootstrap['planCheckpoint'] {
  const row = db.prepare(`
    SELECT event_id, occurred_at,
           CASE WHEN LENGTH(CAST(payload_json AS BLOB)) <= 16384 THEN payload_json ELSE '{"payloadJson":{}}' END AS payload_json
    FROM harbor_events
    WHERE stream_type = 'transcript-event'
      AND session_id = ?
      AND kind = 'plan_checkpoint'
      AND ledger_seq <= ?
    ORDER BY ledger_seq DESC
    LIMIT 1
  `).get(sessionId, throughLedgerSeq) as {
    event_id: string;
    occurred_at: string | null;
    payload_json: string;
  } | undefined;
  if (!row) return null;
  try {
    const payload = JSON.parse(row.payload_json) as { payloadJson?: { planCheckpoint?: unknown } };
    const checkpoint = payload.payloadJson?.planCheckpoint;
    if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) return null;
    const content = (checkpoint as Record<string, unknown>).content;
    if (typeof content !== 'string' || !content.trim() || Buffer.byteLength(content, 'utf8') > 16 * 1024) return null;
    const capturedAt = (checkpoint as Record<string, unknown>).capturedAt;
    return {
      transcriptEventId: row.event_id,
      content,
      capturedAt: typeof capturedAt === 'string' ? capturedAt : row.occurred_at ?? new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

interface PacketSourceHead {
  eventId: string;
  ledgerSeq: number;
  sessionId: string | null;
  agentNodeId: string | null;
  kind: string | null;
  payloadJson: string;
}

interface InteractiveEnvelopeResolution {
  interactive: boolean;
  envelope: ContextEnvelope | null;
  provider: string | null;
  error: string | null;
}

function interactiveProvider(envelope: unknown): string | null {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return null;
  const adapter = (envelope as Record<string, unknown>).sourceAdapter;
  const match = typeof adapter === 'string' ? /^interactive:([a-z0-9-]+)$/i.exec(adapter) : null;
  return match?.[1]?.toLowerCase() ?? null;
}

function interactiveProviderIssuanceError(provider: string): string | null {
  if (supportsInteractiveCompactionPacketProvider(provider)) return null;
  return `interactive:${provider} has no verified compaction-packet issuance contract in this slice`;
}

function interactiveEnvelopeBindingError(
  envelope: ContextEnvelope,
  head: PacketSourceHead,
  packet: CompactionPacket,
): string | null {
  try {
    // This is an authority boundary, not a tolerant projection: the frozen
    // schema is required before a historical row can drive a continuation.
    assessContextEnvelope(envelope);
  } catch {
    return 'interactive ContextEnvelope fails the frozen context-envelope schema';
  }
  if (head.kind !== 'context_pressure') return 'interactive packet source head is not the cited context-pressure event';
  if (head.sessionId !== packet.sessionId || head.agentNodeId !== packet.agentNodeId) {
    return 'interactive context-pressure source head is not bound to this packet session and agent';
  }
  if (envelope.sessionId !== packet.sessionId || envelope.agentNodeId !== packet.agentNodeId) {
    return 'interactive ContextEnvelope is not bound to this packet session and agent';
  }
  if (envelope.sourceEventId !== head.eventId) {
    return 'interactive ContextEnvelope sourceEventId does not identify its cited context-pressure head';
  }
  return null;
}

/**
 * Resolve interactivity from the durable ContextEnvelope reference, not an
 * optional proof field. A forged packet must not downgrade an interactive
 * boundary to generic merely by repinning its transcript head to a later tool
 * or assistant event and omitting `interactiveToolPairCoverage`.
 */
function resolveInteractiveSourceEnvelope(
  db: DatabaseInstance,
  packet: CompactionPacket,
  head: PacketSourceHead,
): InteractiveEnvelopeResolution {
  const proof = packet.interactiveToolPairCoverage;
  const envelopeRef = packet.trigger.contextEnvelopeRef;
  const direct = head.kind === 'context_pressure' ? contextEnvelopeFromPayload(head.payloadJson) : null;
  const directProvider = interactiveProvider(direct);

  if (directProvider) {
    if (typeof envelopeRef !== 'string' || !envelopeRef.trim()) {
      return { interactive: true, envelope: direct, provider: directProvider, error: 'interactive packet has no cited ContextEnvelope reference' };
    }
    if (direct?.envelopeId !== envelopeRef) {
      return { interactive: true, envelope: direct, provider: directProvider, error: 'interactive packet ContextEnvelope reference does not match its source head' };
    }
    return {
      interactive: true,
      envelope: direct,
      provider: directProvider,
      error: interactiveProviderIssuanceError(directProvider)
        ?? interactiveEnvelopeBindingError(direct, head, packet),
    };
  }

  // A proof is an assertion of interactive authority. If the cited head does
  // not resolve to the exact supported interactive ContextEnvelope, reject it
  // instead of accepting a proof that is detached from its source boundary.
  if (proof) {
    if (head.kind !== 'context_pressure') {
      return { interactive: true, envelope: null, provider: null, error: 'interactive packet source head is not the cited context-pressure event' };
    }
    if (typeof envelopeRef !== 'string' || !envelopeRef.trim()) {
      return { interactive: true, envelope: direct, provider: null, error: 'interactive packet has no cited ContextEnvelope reference' };
    }
    if (!direct) {
      return { interactive: true, envelope: null, provider: null, error: 'interactive packet source head has no readable ContextEnvelope' };
    }
    if (direct.envelopeId !== envelopeRef) {
      return { interactive: true, envelope: direct, provider: null, error: 'interactive packet ContextEnvelope reference does not match its source head' };
    }
    return { interactive: true, envelope: direct, provider: null, error: 'interactive packet source ContextEnvelope is not a supported interactive adapter' };
  }

  if (typeof envelopeRef !== 'string' || !envelopeRef.trim()) {
    return { interactive: false, envelope: null, provider: null, error: null };
  }

  // This is an exact structured-field lookup, bounded to make a duplicated
  // envelope id fail closed rather than turn recovery into an unbounded scan.
  const candidates = db.prepare(`
    SELECT event_id,
           CASE WHEN LENGTH(CAST(payload_json AS BLOB)) <= 16384 THEN payload_json ELSE '{}' END AS payload_json,
           CASE WHEN LENGTH(CAST(payload_json AS BLOB)) > 16384 THEN 1 ELSE 0 END AS payload_oversize,
           json_extract(payload_json, '$.payloadJson.contextEnvelope.sourceAdapter') AS source_adapter
    FROM harbor_events
    WHERE stream_type = 'transcript-event'
      AND session_id = ?
      AND kind = 'context_pressure'
      AND json_valid(payload_json)
      AND json_extract(payload_json, '$.payloadJson.contextEnvelope.envelopeId') = ?
    ORDER BY ledger_seq DESC
    LIMIT ?
  `).all(packet.sessionId, envelopeRef, MAX_INTERACTIVE_CONTEXT_CANDIDATES) as Array<{
    event_id: string;
    payload_json: string;
    payload_oversize: number;
    source_adapter: string | null;
  }>;
  if (candidates.length >= MAX_INTERACTIVE_CONTEXT_CANDIDATES) {
    return {
      interactive: false,
      envelope: null,
      provider: null,
      error: 'ContextEnvelope reference has too many durable candidates to verify boundedly',
    };
  }
  for (const candidate of candidates) {
    const candidateEnvelope = candidate.payload_oversize === 0
      ? contextEnvelopeFromPayload(candidate.payload_json)
      : null;
    const provider = interactiveProvider(candidateEnvelope)
      ?? (typeof candidate.source_adapter === 'string'
        ? /^interactive:([a-z0-9-]+)$/i.exec(candidate.source_adapter)?.[1]?.toLowerCase() ?? null
        : null);
    if (provider) {
      return {
        interactive: true,
        envelope: candidateEnvelope,
        provider,
        error: interactiveProviderIssuanceError(provider)
          ?? (candidate.payload_oversize === 1
            ? 'interactive ContextEnvelope reference cannot be verified within the bounded event budget'
            : 'interactive ContextEnvelope reference does not name its exact cited context-pressure source head'),
      };
    }
  }
  return { interactive: false, envelope: null, provider: null, error: null };
}

function citedInteractivePlanEventId(envelope: ContextEnvelope): string | null {
  if (!Array.isArray(envelope.contextRefs)) return null;
  const planRefs = envelope.contextRefs
    .filter((ref) => ref?.kind === 'attachment' && typeof ref.ref === 'string' && ref.ref.startsWith('pd-plan:'))
    .map((ref) => ref.ref.slice('pd-plan:'.length))
    .filter((eventId) => eventId.length > 0);
  return planRefs.length === 1 ? planRefs[0] : null;
}

/** A plan event's outer ledger session is not enough: its typed receipt must not name another session. */
function nestedPlanCheckpointSessionError(checkpoint: Record<string, unknown>, expectedSessionId: string): string | null {
  const nestedSessionId = checkpoint.sessionId;
  if (nestedSessionId === undefined || nestedSessionId === null) return null;
  if (typeof nestedSessionId === 'string' && nestedSessionId === expectedSessionId) return null;
  return 'interactive pd plan receipt nested session is not bound to this packet session';
}

interface ExactInteractivePlanLookup {
  checkpoint: SuccessorBootstrap['planCheckpoint'];
  error: string | null;
}

function exactInteractivePlanCheckpoint(
  db: DatabaseInstance,
  packet: CompactionPacket,
  head: PacketSourceHead,
  planEventId: string,
): ExactInteractivePlanLookup {
  const row = db.prepare(`
    SELECT ledger_seq, session_id, agent_node_id, kind,
           CASE WHEN LENGTH(CAST(payload_json AS BLOB)) <= 16384 THEN payload_json ELSE '{"payloadJson":{}}' END AS payload_json
    FROM harbor_events
    WHERE stream_type = 'transcript-event' AND event_id = ?
    LIMIT 1
  `).get(planEventId) as {
    ledger_seq: number;
    session_id: string | null;
    agent_node_id: string | null;
    kind: string | null;
    payload_json: string;
  } | undefined;
  if (
    !row
    || row.session_id !== packet.sessionId
    || row.agent_node_id !== packet.agentNodeId
    || row.kind !== 'plan_checkpoint'
  ) return { checkpoint: null, error: 'interactive pd plan receipt is absent or is not bound to this packet session and agent' };
  if (row.ledger_seq >= head.ledgerSeq) {
    return { checkpoint: null, error: 'interactive pd plan receipt does not precede the cited context-pressure head' };
  }
  try {
    const outer = JSON.parse(row.payload_json) as { payloadJson?: { planCheckpoint?: unknown } };
    const raw = outer.payloadJson?.planCheckpoint;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { checkpoint: null, error: 'interactive pd plan receipt is malformed' };
    }
    const checkpoint = raw as Record<string, unknown>;
    if (
      checkpoint.schema !== 'pd.plan-checkpoint.v0'
      || typeof checkpoint.content !== 'string'
      || !checkpoint.content.trim()
      || Buffer.byteLength(checkpoint.content, 'utf8') > 16 * 1024
    ) return { checkpoint: null, error: 'interactive pd plan receipt is malformed' };
    const nestedSessionError = nestedPlanCheckpointSessionError(checkpoint, packet.sessionId);
    if (nestedSessionError) return { checkpoint: null, error: nestedSessionError };
    return {
      checkpoint: {
        transcriptEventId: planEventId,
        content: checkpoint.content,
        capturedAt: typeof checkpoint.capturedAt === 'string' ? checkpoint.capturedAt : new Date(0).toISOString(),
      },
      error: null,
    };
  } catch {
    return { checkpoint: null, error: 'interactive pd plan receipt cannot be parsed' };
  }
}

function interactivePlanReceiptError(
  db: DatabaseInstance,
  packet: CompactionPacket,
  head: PacketSourceHead,
  planEventId: string,
): string | null {
  return exactInteractivePlanCheckpoint(db, packet, head, planEventId).error;
}

function interactiveBoundaryLineageError(
  packet: CompactionPacket,
  head: PacketSourceHead,
  envelope: ContextEnvelope,
  proof: NonNullable<CompactionPacket['interactiveToolPairCoverage']>,
  planEventId: string,
): string | null {
  const expectedBaseSuffix = derivedInteractiveSuffix(packet.sessionId, proof.observationId);
  if (proof.receiptEventId !== `evt_tool_coverage_${expectedBaseSuffix}`) {
    return 'interactive daemon coverage receipt is not derived from this packet session and observation';
  }
  const verified = /^evt_ctx_verified_([a-f0-9]{24})$/i.exec(head.eventId);
  if (verified) {
    const expectedVerifiedSuffix = derivedInteractiveSuffix(
      expectedBaseSuffix,
      `evt_plan_${expectedBaseSuffix}`,
      proof.receiptEventId,
    );
    if (verified[1] !== expectedVerifiedSuffix) {
      return 'interactive verified boundary is not derived from this packet session and observation receipts';
    }
    if (
      packet.packetId !== `cpk_ctx_${expectedVerifiedSuffix}`
      || packet.transcriptEventId !== `evt_cpk_${expectedVerifiedSuffix}`
    ) return 'interactive compaction packet identity is not derived from its verified context boundary';
    return null;
  }
  const base = /^evt_ctx_([a-f0-9]{24})$/i.exec(head.eventId);
  if (!base) return 'interactive base context-pressure boundary id is not deterministic';
  const suffix = base[1];
  if (
    suffix !== expectedBaseSuffix
    ||
    envelope.envelopeId !== `ctx_${suffix}`
    || envelope.sourceEventId !== head.eventId
    || proof.receiptEventId !== `evt_tool_coverage_${suffix}`
    || planEventId !== `evt_plan_${suffix}`
  ) return 'interactive base boundary does not bind its exact context, pd plan, and daemon coverage receipts';
  if (packet.trigger.contextEnvelopeRef !== envelope.envelopeId) {
    return 'interactive packet ContextEnvelope reference does not match its source head';
  }
  if (packet.packetId !== `cpk_ctx_${suffix}` || packet.transcriptEventId !== `evt_cpk_${suffix}`) {
    return 'interactive compaction packet identity is not derived from its base context boundary';
  }
  return null;
}

function interactiveCoverageVerificationError(
  db: DatabaseInstance,
  packet: CompactionPacket,
  head: PacketSourceHead,
): string | null {
  const proof = packet.interactiveToolPairCoverage;
  const resolution = resolveInteractiveSourceEnvelope(db, packet, head);
  if (resolution.error) return resolution.error;
  if (!resolution.interactive) {
    return proof ? 'interactive tool-pair coverage proof is not bound to an interactive ContextEnvelope' : null;
  }
  const envelope = resolution.envelope;
  if (!envelope || !resolution.provider) return 'interactive packet source ContextEnvelope cannot be verified';
  if (!proof) return 'interactive ContextEnvelope requires a daemon-owned tool-pair coverage proof';
  if (proof.sessionId !== packet.sessionId || !proof.receiptEventId || !proof.observationId) {
    return 'interactive tool-pair coverage proof is not bound to this packet session';
  }
  if (proof.provider.toLowerCase() !== resolution.provider) {
    return 'interactive tool-pair coverage provider does not match the cited ContextEnvelope adapter';
  }
  const planEventId = citedInteractivePlanEventId(envelope);
  if (!planEventId) return 'interactive ContextEnvelope has no single cited durable pd plan checkpoint';
  const planError = interactivePlanReceiptError(db, packet, head, planEventId);
  if (planError) return planError;
  const row = db.prepare(`
    SELECT ledger_seq, session_id, agent_node_id, kind,
           CASE WHEN LENGTH(CAST(payload_json AS BLOB)) <= 16384 THEN payload_json ELSE '{"payloadJson":{}}' END AS payload_json
    FROM harbor_events
    WHERE stream_type = 'transcript-event' AND event_id = ?
    LIMIT 1
  `).get(proof.receiptEventId) as {
    ledger_seq: number;
    session_id: string | null;
    agent_node_id: string | null;
    kind: string | null;
    payload_json: string;
  } | undefined;
  if (
    !row
    || row.session_id !== packet.sessionId
    || row.agent_node_id !== packet.agentNodeId
    || row.kind !== 'tool_pair_coverage'
  ) return 'interactive tool-pair coverage receipt is absent or is not bound to this packet session and agent';
  if (row.ledger_seq >= head.ledgerSeq) {
    return 'interactive tool-pair coverage receipt does not precede the cited context-pressure head';
  }
  if (!Number.isInteger(proof.coveredThroughLedgerSeq) || proof.coveredThroughLedgerSeq < 0 || proof.coveredThroughLedgerSeq > head.ledgerSeq) {
    return 'interactive tool-pair coverage cursor is outside the packet source boundary';
  }
  if (row.ledger_seq <= proof.coveredThroughLedgerSeq) {
    return 'interactive tool-pair coverage receipt does not follow its claimed coverage cursor';
  }
  try {
    const outer = JSON.parse(row.payload_json) as { payloadJson?: { toolPairCoverage?: unknown } };
    const raw = outer.payloadJson?.toolPairCoverage;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'interactive tool-pair coverage receipt is malformed';
    const coverage = raw as Record<string, unknown>;
    if (
      coverage.witness !== 'daemon-adapter'
      || coverage.status !== 'complete'
      || coverage.provider !== proof.provider
      || coverage.sessionId !== proof.sessionId
      || coverage.observationId !== proof.observationId
      || coverage.coverageRef !== proof.coverageRef
      || coverage.coveredThroughLedgerSeq !== proof.coveredThroughLedgerSeq
    ) return 'interactive tool-pair coverage receipt does not match the packet proof';
  } catch {
    return 'interactive tool-pair coverage receipt cannot be parsed';
  }
  const lineageError = interactiveBoundaryLineageError(packet, head, envelope, proof, planEventId);
  if (lineageError) return lineageError;
  const unseenTool = db.prepare(`
    SELECT 1 AS present
    FROM harbor_events
    WHERE stream_type = 'transcript-event'
      AND session_id = ?
      AND ledger_seq > ?
      AND ledger_seq <= ?
      AND kind IN ('tool_call', 'tool_result')
    LIMIT 1
  `).get(packet.sessionId, proof.coveredThroughLedgerSeq, head.ledgerSeq) as { present: number } | undefined;
  return unseenTool?.present === 1
    ? 'interactive tool-pair coverage left an uncited tool event before the packet boundary'
    : null;
}

function derivedInteractiveSuffix(...parts: string[]): string {
  return createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 24);
}

function contextEnvelopeFromPayload(payloadJson: string): ContextEnvelope | null {
  try {
    const outer = JSON.parse(payloadJson) as { payloadJson?: { contextEnvelope?: unknown } };
    const envelope = outer.payloadJson?.contextEnvelope;
    return envelope && typeof envelope === 'object' && !Array.isArray(envelope)
      ? envelope as ContextEnvelope
      : null;
  } catch {
    return null;
  }
}

export interface InteractiveCitedPlanCheckpointLookup {
  interactive: boolean;
  checkpoint: SuccessorBootstrap['planCheckpoint'];
  error: string | null;
}

/**
 * Read the one plan receipt cited by an interactive packet's exact durable
 * ContextEnvelope. A later plan checkpoint may be useful operationally, but
 * it is not authority to replace the plan the packet actually binds.
 */
export function interactiveCitedPlanCheckpointForPacket(
  db: DatabaseInstance,
  packet: CompactionPacket,
): InteractiveCitedPlanCheckpointLookup {
  const sourceHeadEventId = packet.sourceTranscript?.headEventId;
  if (typeof sourceHeadEventId !== 'string' || !sourceHeadEventId) {
    return { interactive: Boolean(packet.interactiveToolPairCoverage), checkpoint: null, error: 'packet sourceTranscript is incomplete' };
  }
  const head = db.prepare(`
    SELECT ledger_seq, session_id, agent_node_id, kind,
           CASE WHEN LENGTH(CAST(payload_json AS BLOB)) <= 16384 THEN payload_json ELSE '{}' END AS payload_json
    FROM harbor_events
    WHERE stream_type = 'transcript-event' AND event_id = ?
    LIMIT 1
  `).get(sourceHeadEventId) as {
    ledger_seq: number;
    session_id: string | null;
    agent_node_id: string | null;
    kind: string | null;
    payload_json: string;
  } | undefined;
  if (!head) {
    return { interactive: Boolean(packet.interactiveToolPairCoverage), checkpoint: null, error: `sourceTranscript.headEventId ${sourceHeadEventId} is not in the ledger` };
  }
  const resolution = resolveInteractiveSourceEnvelope(db, packet, {
    eventId: sourceHeadEventId,
    ledgerSeq: head.ledger_seq,
    sessionId: head.session_id,
    agentNodeId: head.agent_node_id,
    kind: head.kind,
    payloadJson: head.payload_json,
  });
  if (resolution.error) {
    return { interactive: resolution.interactive, checkpoint: null, error: resolution.error };
  }
  if (!resolution.interactive) return { interactive: false, checkpoint: null, error: null };
  if (!resolution.envelope) {
    return { interactive: true, checkpoint: null, error: 'interactive packet source ContextEnvelope cannot be verified' };
  }
  const planEventId = citedInteractivePlanEventId(resolution.envelope);
  if (!planEventId) {
    return { interactive: true, checkpoint: null, error: 'interactive ContextEnvelope has no single cited durable pd plan checkpoint' };
  }
  const exact = exactInteractivePlanCheckpoint(db, packet, {
    eventId: sourceHeadEventId,
    ledgerSeq: head.ledger_seq,
    sessionId: head.session_id,
    agentNodeId: head.agent_node_id,
    kind: head.kind,
    payloadJson: head.payload_json,
  }, planEventId);
  return { interactive: true, checkpoint: exact.checkpoint, error: exact.error };
}

/**
 * A verified interactive boundary is a deterministic clone, not merely a
 * suitably named context event. This check lives with packet verification so
 * resume, takeover, salvage, and a deferred provider replay all enforce the
 * same authority rule without relying on the writer-side coordinator.
 */
export function interactiveDerivedBoundaryVerificationError(
  db: DatabaseInstance,
  packet: CompactionPacket,
): string | null {
  const headEventId = packet.sourceTranscript?.headEventId;
  if (typeof headEventId !== 'string') return null;
  const head = db.prepare(`
    SELECT ledger_seq, session_id, agent_node_id, kind,
           CASE WHEN LENGTH(CAST(payload_json AS BLOB)) <= 16384 THEN payload_json ELSE '{}' END AS payload_json
    FROM harbor_events
    WHERE stream_type = 'transcript-event' AND event_id = ?
    LIMIT 1
  `).get(headEventId) as {
    ledger_seq: number;
    session_id: string | null;
    agent_node_id: string | null;
    kind: string | null;
    payload_json: string;
  } | undefined;
  if (!head || head.kind !== 'context_pressure') return null;
  const envelope = contextEnvelopeFromPayload(head.payload_json);
  const provider = interactiveProvider(envelope);
  if (!envelope || !provider) return null;
  const issuanceError = interactiveProviderIssuanceError(provider);
  if (issuanceError) return issuanceError;
  const verifiedMatch = /^evt_ctx_verified_([a-f0-9]{24})$/i.exec(headEventId);
  if (!verifiedMatch) return null;
  const proof = packet.interactiveToolPairCoverage;
  const coverageMatch = /^evt_tool_coverage_([a-f0-9]{24})$/i.exec(proof?.receiptEventId ?? '');
  if (!proof || !coverageMatch) return 'interactive verified boundary has no deterministic daemon coverage receipt';
  const baseSuffix = coverageMatch[1];
  const planEventId = `evt_plan_${baseSuffix}`;
  const expectedSuffix = derivedInteractiveSuffix(baseSuffix, planEventId, proof.receiptEventId);
  if (verifiedMatch[1] !== expectedSuffix) {
    return 'interactive verified boundary id is not derived from its exact plan and coverage receipts';
  }
  if (
    head.session_id !== packet.sessionId
    || head.agent_node_id !== packet.agentNodeId
    || envelope.envelopeId !== `ctx_verified_${expectedSuffix}`
    || envelope.sourceEventId !== headEventId
  ) {
    return 'interactive verified boundary is not bound to its packet session, agent, and source head';
  }
  const base = db.prepare(`
    SELECT ledger_seq, agent_node_id, kind,
           CASE WHEN LENGTH(CAST(payload_json AS BLOB)) <= 16384 THEN payload_json ELSE '{}' END AS payload_json
    FROM harbor_events
    WHERE stream_type = 'transcript-event' AND event_id = ? AND session_id = ?
    LIMIT 1
  `).get(`evt_ctx_${baseSuffix}`, packet.sessionId) as {
    ledger_seq: number;
    agent_node_id: string | null;
    kind: string | null;
    payload_json: string;
  } | undefined;
  const plan = db.prepare(`
    SELECT ledger_seq, agent_node_id, kind,
           CASE WHEN LENGTH(CAST(payload_json AS BLOB)) <= 16384 THEN payload_json ELSE '{}' END AS payload_json
    FROM harbor_events
    WHERE stream_type = 'transcript-event' AND event_id = ? AND session_id = ?
    LIMIT 1
  `).get(planEventId, packet.sessionId) as {
    ledger_seq: number;
    agent_node_id: string | null;
    kind: string | null;
    payload_json: string;
  } | undefined;
  const coverage = db.prepare(`
    SELECT ledger_seq, agent_node_id, kind
    FROM harbor_events
    WHERE stream_type = 'transcript-event' AND event_id = ? AND session_id = ?
    LIMIT 1
  `).get(proof.receiptEventId, packet.sessionId) as {
    ledger_seq: number;
    agent_node_id: string | null;
    kind: string | null;
  } | undefined;
  if (
    !base
    || base.kind !== 'context_pressure'
    || base.agent_node_id !== packet.agentNodeId
    || base.ledger_seq >= head.ledger_seq
    || !plan
    || plan.kind !== 'plan_checkpoint'
    || plan.agent_node_id !== packet.agentNodeId
    || plan.ledger_seq >= head.ledger_seq
    || !coverage
    || coverage.kind !== 'tool_pair_coverage'
    || coverage.agent_node_id !== packet.agentNodeId
    || coverage.ledger_seq >= head.ledger_seq
  ) {
    return 'interactive verified boundary is missing its preceding base context, pd plan, or daemon coverage receipt';
  }
  const baseEnvelope = contextEnvelopeFromPayload(base.payload_json);
  if (
    !baseEnvelope
    || !Array.isArray(baseEnvelope.contextRefs)
    || baseEnvelope.envelopeId !== `ctx_${baseSuffix}`
    || baseEnvelope.sourceEventId !== `evt_ctx_${baseSuffix}`
    || baseEnvelope.sessionId !== packet.sessionId
    || baseEnvelope.agentNodeId !== packet.agentNodeId
  ) {
    return 'interactive verified boundary base ContextEnvelope is malformed';
  }
  try {
    const planPayload = JSON.parse(plan.payload_json) as { payloadJson?: { planCheckpoint?: unknown } };
    const checkpoint = planPayload.payloadJson?.planCheckpoint;
    const checkpointContent = checkpoint && typeof checkpoint === 'object' && !Array.isArray(checkpoint)
      ? (checkpoint as Record<string, unknown>).content
      : null;
    if (
      !checkpoint
      || typeof checkpoint !== 'object'
      || Array.isArray(checkpoint)
      || typeof checkpointContent !== 'string'
      || !checkpointContent.trim()
    ) return 'interactive verified boundary pd plan receipt is malformed';
    const nestedSessionError = nestedPlanCheckpointSessionError(
      checkpoint as Record<string, unknown>,
      packet.sessionId,
    );
    if (nestedSessionError) return nestedSessionError;
  } catch {
    return 'interactive verified boundary pd plan receipt cannot be parsed';
  }
  const contextRefs = [...baseEnvelope.contextRefs];
  const addRef = (ref: NonNullable<ContextEnvelope['contextRefs']>[number]) => {
    if (!contextRefs.some((candidate) => candidate.kind === ref.kind && candidate.ref === ref.ref)) contextRefs.push(ref);
  };
  addRef({ kind: 'attachment', ref: `pd-plan:${planEventId}`, droppable: false });
  addRef({ kind: 'attachment', ref: `tool-pair-coverage:${proof.receiptEventId}`, droppable: false });
  const expected: ContextEnvelope = {
    ...baseEnvelope,
    envelopeId: `ctx_verified_${expectedSuffix}`,
    sourceEventId: headEventId,
    contextRefs,
  };
  return canonicalJson(envelope) === canonicalJson(expected)
    ? null
    : 'interactive verified boundary does not exactly match its base context plus plan and coverage receipts';
}

/**
 * Interactive packets are durable artifacts, not merely an inbound object a
 * caller may re-shape. Bind the resume request to the appended packet event
 * before trusting its cited context boundary or opaque coverage receipt.
 */
function interactivePacketReceiptVerificationError(
  db: DatabaseInstance,
  packet: CompactionPacket,
  sourceHeadLedgerSeq: number,
): string | null {
  if (!packet.interactiveToolPairCoverage) return null;
  if (typeof packet.transcriptEventId !== 'string' || !packet.transcriptEventId.trim()) {
    return 'interactive packet has no durable compaction-packet event reference';
  }
  const row = db.prepare(`
    SELECT ledger_seq, session_id, agent_node_id, kind,
           CASE WHEN LENGTH(CAST(payload_json AS BLOB)) <= ? THEN payload_json ELSE '{}' END AS payload_json
    FROM harbor_events
    WHERE stream_type = 'transcript-event' AND event_id = ?
    LIMIT 1
  `).get(MAX_COMPACTION_PACKET_EVENT_BYTES, packet.transcriptEventId) as {
    ledger_seq: number;
    session_id: string | null;
    agent_node_id: string | null;
    kind: string | null;
    payload_json: string;
  } | undefined;
  if (
    !row
    || row.session_id !== packet.sessionId
    || row.agent_node_id !== packet.agentNodeId
    || row.kind !== 'compaction_packet'
  ) {
    return 'interactive packet durable compaction-packet event is absent or is not bound to this packet session and agent';
  }
  if (row.ledger_seq <= sourceHeadLedgerSeq) {
    return 'interactive packet durable compaction-packet event does not follow its cited source head';
  }
  try {
    const outer = JSON.parse(row.payload_json) as { payloadJson?: CompactionPacket };
    const durable = outer.payloadJson;
    if (!durable || canonicalJson(durable) !== canonicalJson(packet)) {
      return 'interactive packet does not match its durable compaction-packet event';
    }
  } catch {
    return 'interactive packet durable compaction-packet event cannot be parsed';
  }
  return null;
}

/**
 * Bounded authority check for already-persisted packets. Writer-side checks
 * cannot protect deferred hook replay, deterministic retry, or a fresh
 * continuation from artifacts emitted by an older build, so those paths share
 * this source/head, durable-packet, coverage, and derived-boundary verifier.
 */
export function interactivePacketAuthorityVerificationError(
  db: DatabaseInstance,
  packet: CompactionPacket,
): string | null {
  const source = packet.sourceTranscript;
  if (!source || typeof source.headEventId !== 'string' || typeof source.headHash !== 'string') {
    return 'packet sourceTranscript is incomplete';
  }
  const head = db.prepare(`
    SELECT ledger_seq, session_id, agent_node_id, content_hash, sequence, kind,
           CASE WHEN LENGTH(CAST(payload_json AS BLOB)) <= 16384 THEN payload_json ELSE '{}' END AS payload_json
    FROM harbor_events
    WHERE stream_type = 'transcript-event' AND event_id = ?
    LIMIT 1
  `).get(source.headEventId) as {
    ledger_seq: number;
    session_id: string | null;
    agent_node_id: string | null;
    content_hash: string | null;
    sequence: number | null;
    kind: string | null;
    payload_json: string;
  } | undefined;
  if (!head) return `sourceTranscript.headEventId ${source.headEventId} is not in the ledger`;
  if (head.session_id !== packet.sessionId) return `source head ${source.headEventId} belongs to a different session`;
  if (head.content_hash !== source.headHash) return `sourceTranscript.headHash does not match durable source head ${source.headEventId}`;
  if (source.throughSequence !== undefined && head.sequence !== source.throughSequence) {
    return `sourceTranscript.throughSequence does not match durable source head ${source.headEventId}`;
  }
  const packetReceiptError = interactivePacketReceiptVerificationError(db, packet, head.ledger_seq);
  if (packetReceiptError) return packetReceiptError;
  const coverageError = interactiveCoverageVerificationError(db, packet, {
    eventId: source.headEventId,
    ledgerSeq: head.ledger_seq,
    sessionId: head.session_id,
    agentNodeId: head.agent_node_id,
    kind: head.kind,
    payloadJson: head.payload_json,
  });
  if (coverageError) return coverageError;
  return interactiveDerivedBoundaryVerificationError(db, packet);
}

/** Stable JSON comparison that treats omitted and undefined object members alike. */
function canonicalJson(value: unknown): string {
  const normalize = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) return candidate.map(normalize);
    if (candidate && typeof candidate === 'object') {
      return Object.fromEntries(
        Object.entries(candidate)
          .filter(([, nested]) => nested !== undefined)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, nested]) => [key, normalize(nested)]),
      );
    }
    return candidate;
  };
  return JSON.stringify(normalize(value));
}

/**
 * Verify a CompactionPacket against the original append-only transcript and
 * return the successor's bootstrap context (M6 gate: "resume successor from
 * packet and transcript").
 *
 * Refuses, fail-closed (ResumeVerificationError):
 *   - a packet whose embedded validator says passed: false (consumers must
 *     refuse an unvalidated packet — frozen schema description);
 *   - a packet that fails RE-validation against the live ledger (an embedded
 *     passed: true is a self-report, never trusted alone);
 *   - a sourceTranscript pin that does not verify: headEventId missing from
 *     the cited session, headHash differing from the ledger's contentHash,
 *     throughSequence differing from the head event's sequence;
 *   - a session whose per-session hash chain is broken (tamper evidence).
 *
 * Performs NO writes: the predecessor transcript stays byte-identical.
 */
export function resumeFromPacket(db: DatabaseInstance, packet: CompactionPacket): SuccessorBootstrap {
  assertAgainstSchema('compaction-packet', packet);

  if (packet.validator?.passed !== true) {
    throw new ResumeVerificationError(
      `refusing packet ${packet.packetId}: embedded validator.passed is ${JSON.stringify(packet.validator?.passed)} — ` +
        'a consumer must refuse an unvalidated packet (compaction-packet.schema.json)',
    );
  }

  const revalidation = validateCompactionPacket(packet, {
    db,
    validatedBy: 'lib/agent-harbor/compaction.ts#resumeFromPacket',
  });
  if (!revalidation.passed) {
    throw new ResumeVerificationError(
      `refusing packet ${packet.packetId}: re-validation against the live ledger failed: ` +
        (revalidation.errors ?? []).join('; '),
    );
  }

  // Verify the sourceTranscript pin against the ledger's hash chain.
  const { headEventId, headHash, throughSequence } = packet.sourceTranscript;
  const head = db
    .prepare(`
      SELECT ledger_seq, session_id, content_hash, sequence, kind,
             CASE WHEN LENGTH(CAST(payload_json AS BLOB)) <= 16384 THEN payload_json ELSE '{}' END AS payload_json
      FROM harbor_events
      WHERE stream_type = 'transcript-event' AND event_id = ?
    `)
    .get(headEventId) as {
      ledger_seq: number;
      session_id: string | null;
      content_hash: string | null;
      sequence: number | null;
      kind: string | null;
      payload_json: string;
    } | undefined;
  if (!head) {
    throw new ResumeVerificationError(
      `refusing packet ${packet.packetId}: sourceTranscript.headEventId ${headEventId} is not in the ledger`,
    );
  }
  if (head.session_id !== packet.sessionId) {
    throw new ResumeVerificationError(
      `refusing packet ${packet.packetId}: head event ${headEventId} belongs to session ` +
        `${JSON.stringify(head.session_id)}, not ${JSON.stringify(packet.sessionId)}`,
    );
  }
  if (head.content_hash !== headHash) {
    throw new ResumeVerificationError(
      `refusing packet ${packet.packetId}: sourceTranscript.headHash ${headHash} does not match the ledger's ` +
        `contentHash ${JSON.stringify(head.content_hash)} for ${headEventId} — the packet does not describe this transcript`,
    );
  }
  if (throughSequence !== undefined && head.sequence !== throughSequence) {
    throw new ResumeVerificationError(
      `refusing packet ${packet.packetId}: sourceTranscript.throughSequence ${throughSequence} does not match ` +
        `the head event's sequence ${JSON.stringify(head.sequence)}`,
    );
  }
  const authorityError = interactivePacketAuthorityVerificationError(db, packet);
  if (authorityError) {
    throw new ResumeVerificationError(`refusing packet ${packet.packetId}: ${authorityError}`);
  }
  const citedInteractivePlan = interactiveCitedPlanCheckpointForPacket(db, packet);
  if (citedInteractivePlan.interactive && (citedInteractivePlan.error || !citedInteractivePlan.checkpoint)) {
    throw new ResumeVerificationError(
      `refusing packet ${packet.packetId}: ${citedInteractivePlan.error ?? 'interactive packet has no exact cited pd plan checkpoint'}`,
    );
  }
  const broken = verifySessionChain(db, packet.sessionId);
  if (broken) {
    throw new ResumeVerificationError(
      `refusing packet ${packet.packetId}: session ${packet.sessionId} hash chain is broken at ` +
        `${broken.brokenAtEventId} (expected prev ${JSON.stringify(broken.expectedPrev)}, got ${JSON.stringify(broken.actualPrev)})`,
    );
  }

  // Bounded tail handles in replay order, up to and including the head. The
  // name stays `transcriptPrefix` for the frozen bootstrap shape, but it is a
  // pagination handle set rather than an implicit transcript export.
  const rows = omitSplitToolPairs(sessionTranscriptTail(
    db,
    packet.sessionId,
    MAX_SUCCESSOR_TRANSCRIPT_HANDLES,
    head.ledger_seq,
  ));
  const prefix = rows.map((row) => ({
    transcriptEventId: row.event_id,
    sequence: row.sequence,
    kind: row.kind,
    ledgerSeq: row.ledger_seq,
  }));
  const first = rows[0];
  const older = first
    ? db.prepare(`
      SELECT 1 AS present
      FROM harbor_events
      WHERE stream_type = 'transcript-event' AND session_id = ? AND ledger_seq < ?
      LIMIT 1
    `).get(packet.sessionId, first.ledger_seq) as { present: number } | undefined
    : undefined;

  return {
    packet,
    sessionId: packet.sessionId,
    agentNodeId: packet.agentNodeId,
    planCheckpoint: citedInteractivePlan.interactive
      ? citedInteractivePlan.checkpoint
      : planCheckpointForResume(db, packet.sessionId, head.ledger_seq),
    transcriptPrefix: prefix,
    transcriptPrefixTruncated: older?.present === 1,
    contextRef: { kind: 'compaction-packet', ref: packet.packetId, droppable: false },
    revalidation,
  };
}
