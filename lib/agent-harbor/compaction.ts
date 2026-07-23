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

import { randomUUID } from 'node:crypto';
import type { DatabaseInstance } from '../sqlite-runtime.js';
import {
  appendEvent,
  readEvents,
  type AppendResult,
  type HarborPayload,
  type LedgerRow,
  verifySessionChain,
} from './event-ledger.js';
import { assertAgainstSchema } from './schema-validate.js';
import {
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

function sessionTranscriptRows(db: DatabaseInstance, sessionId: string): LedgerRow[] {
  const rows: LedgerRow[] = [];
  const PAGE = 10_000;
  let afterSeq = 0;
  for (;;) {
    const page = readEvents(db, { streamType: 'transcript-event', sessionId, afterSeq, limit: PAGE });
    rows.push(...page);
    if (page.length < PAGE) return rows;
    afterSeq = page[page.length - 1].ledger_seq;
  }
}

/** Deterministic excerpt text from an event payload (bounded; never invents). */
function excerptFromRow(row: LedgerRow, maxChars: number): string {
  const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
  const payloadJson = (payload.payloadJson ?? {}) as Record<string, unknown>;
  const text =
    (typeof payloadJson.text === 'string' && payloadJson.text) ||
    (typeof payloadJson.message === 'string' && payloadJson.message) ||
    (typeof payloadJson.command === 'string' && payloadJson.command) ||
    JSON.stringify(payloadJson);
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

/**
 * Extract commands/tests run from the transcript (ch04 packet contents list),
 * cited by construction: each entry carries the transcript event id it came
 * from. Deterministic — reads `shell_command` events' payloadJson.command and
 * exitCode; nothing is inferred.
 */
export function extractCommandsRun(
  rows: LedgerRow[],
): NonNullable<CompactionPacket['commandsRun']> {
  const commands: NonNullable<CompactionPacket['commandsRun']> = [];
  for (const row of rows) {
    if (row.kind !== 'shell_command') continue;
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
    const payloadJson = (payload.payloadJson ?? {}) as Record<string, unknown>;
    if (!nonEmptyString(payloadJson.command)) continue;
    commands.push({
      command: payloadJson.command,
      exitCode: typeof payloadJson.exitCode === 'number' ? payloadJson.exitCode : null,
      resultSummary: typeof payloadJson.resultSummary === 'string' ? payloadJson.resultSummary : undefined,
      transcriptEventId: row.event_id,
    });
  }
  return commands;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool-call/tool-result boundary rule (ch04 "How Longshoremen compact
// Voyagers" — see docs/architecture/agent-harbor-technical-binder/
// 04-context-memory-and-skills.md, "Boundary rule" paragraph):
//
//   "a compaction range must never split a tool-call/tool-result pair. The
//    macro summarizer shifts range boundaries so a tool_use event and its
//    matching tool_result are always compacted together or left together —
//    never one without the other. This is the direct defense against the
//    orphaned-pair failure class documented in the field (claude-code
//    #14173, #40305): drop a tool_use while retaining its tool_result (or
//    the reverse) and the resulting message array is malformed, the
//    provider rejects it with a hard 400, and /clear becomes the only
//    recovery. The boundary check belongs in the validator alongside the
//    uncited-claim check."
//
// The chapter's own prose uses the Claude-API vocabulary "tool_use" /
// "tool_result"; the transcript-event kinds this ledger actually stores are
// `tool_call` and `tool_result` (transcript-event.schema.json's tool/shell
// family) paired by a shared `payloadJson.toolCallId` — the same pairing key
// memory-episodes.ts already uses (extractCommandFailure). Same rule, this
// codebase's field names.
//
// Currently moot: `buildCompactionPacket` always covers the FULL session
// prefix (session-start through the current chain head — see
// `sessionTranscriptRows`), so no interior range boundary can exist yet and
// a split cannot occur today. This function exists ahead of that need —
// load-bearing the moment any windowed/partial-range compactor is added —
// per the binder's own framing ("belongs in the validator").
// ─────────────────────────────────────────────────────────────────────────────

/** One tool_call/tool_result pair whose members fall on opposite sides of a proposed range boundary. */
export interface ToolPairBoundarySplit {
  toolCallId: string;
  toolCallEventId: string;
  toolCallSequence: number | null;
  toolResultEventId: string;
  toolResultSequence: number | null;
}

/** A proposed compaction range over transcript-event `sequence` numbers, half-open [startSeq, endSeq). */
export interface CompactionRange {
  startSeq: number;
  endSeq: number;
}

export interface ToolPairBoundaryCheck {
  /** True when no tool_call/tool_result pair is split by the range. */
  ok: boolean;
  /** Every pair split by the proposed range (empty when ok). */
  splits: ToolPairBoundarySplit[];
  /**
   * The smallest range that covers the requested range AND every split
   * pair in full (never partial) — "shifts range boundaries" per ch04.
   * Equal to the input range when ok is true. Apply this instead of the
   * proposed range to satisfy the boundary rule without dropping either
   * member of a pair.
   */
  adjustedRange: CompactionRange;
}

/**
 * Check (and compute a fix for) whether a proposed compaction range would
 * split a tool_call from its matching tool_result. Pairing is by
 * `payloadJson.toolCallId`, present on both events when the adapter tags
 * them (untagged tool events have nothing to pair against and are not this
 * validator's concern — they can't be "split" if they were never linked).
 *
 * Pure and read-only: never mutates `rows`, never appends to the ledger.
 * Pairing scans the FULL `rows` array regardless of the proposed range,
 * because a pair can only be judged split by comparing both halves against
 * the boundary — a half-visible row tells you nothing.
 */
export function checkToolPairBoundary(rows: LedgerRow[], range: CompactionRange): ToolPairBoundaryCheck {
  const pairs = new Map<string, { call?: LedgerRow; result?: LedgerRow }>();
  for (const row of rows) {
    if (row.kind !== 'tool_call' && row.kind !== 'tool_result') continue;
    let toolCallId: string | null = null;
    try {
      const outer = JSON.parse(row.payload_json) as Record<string, unknown>;
      const payloadJson = (outer.payloadJson ?? {}) as Record<string, unknown>;
      toolCallId = nonEmptyString(payloadJson.toolCallId) ? payloadJson.toolCallId : null;
    } catch {
      toolCallId = null;
    }
    if (!toolCallId) continue;
    const entry = pairs.get(toolCallId) ?? {};
    if (row.kind === 'tool_call') entry.call = row;
    else entry.result = row;
    pairs.set(toolCallId, entry);
  }

  const inRange = (seq: number | null): boolean => seq !== null && seq >= range.startSeq && seq < range.endSeq;

  const splits: ToolPairBoundarySplit[] = [];
  let adjustedStart = range.startSeq;
  let adjustedEnd = range.endSeq;

  for (const [toolCallId, { call, result }] of pairs) {
    if (!call || !result) continue; // an unmatched half is not a "split pair"
    const callIn = inRange(call.sequence);
    const resultIn = inRange(result.sequence);
    if (callIn === resultIn) continue; // both in or both out — not split

    splits.push({
      toolCallId,
      toolCallEventId: call.event_id,
      toolCallSequence: call.sequence,
      toolResultEventId: result.event_id,
      toolResultSequence: result.sequence,
    });

    const seqs = [call.sequence, result.sequence].filter((s): s is number => s !== null);
    if (seqs.length > 0) {
      adjustedStart = Math.min(adjustedStart, ...seqs);
      // endSeq is exclusive, so the widened end must clear the max sequence by one.
      adjustedEnd = Math.max(adjustedEnd, Math.max(...seqs) + 1);
    }
  }

  return {
    ok: splits.length === 0,
    splits,
    adjustedRange: { startSeq: adjustedStart, endSeq: adjustedEnd },
  };
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
  const rows = sessionTranscriptRows(db, input.sessionId);
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
  const excerptCount = Math.max(0, input.excerptCount ?? 5);
  const excerptMaxChars = Math.max(1, input.excerptMaxChars ?? 240);
  // slice(-0) === slice(0) would include the WHOLE transcript — the exact
  // opposite of "no excerpts" — so 0 must short-circuit to an empty lens set.
  const excerptRows = excerptCount === 0 ? [] : rows.slice(-excerptCount);
  const transcriptExcerpts = excerptRows.map((row) => ({
    citation: { kind: 'transcript-event' as const, transcriptEventId: row.event_id },
    excerpt: excerptFromRow(row, excerptMaxChars),
  }));

  const packetId = input.packetId ?? `cpk_${randomUUID()}`;
  const eventId = input.append === false ? null : `evt_cpk_${randomUUID()}`;
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
    commandsRun: [...extractedCommands, ...(input.commandsRun ?? [])],
    reviewState: input.reviewState,
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
  /**
   * The pinned transcript prefix, as HANDLES (event id / sequence / kind /
   * ledger seq) in replay order — the successor zooms into the ledger through
   * these, it is not handed an unbudgeted transcript dump
   * (context-economics-for-agent-swarms: legibility-with-zoom).
   */
  transcriptPrefix: Array<{ transcriptEventId: string; sequence: number | null; kind: string | null; ledgerSeq: number }>;
  /** Ready-to-attach ContextEnvelope contextRefs entry for the packet. */
  contextRef: { kind: 'compaction-packet'; ref: string; droppable: false };
  /** Re-run validator verdict (never the packet's embedded self-report alone). */
  revalidation: PacketValidatorResult;
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
    .prepare(
      "SELECT session_id, content_hash, sequence FROM harbor_events WHERE stream_type = 'transcript-event' AND event_id = ?",
    )
    .get(headEventId) as { session_id: string | null; content_hash: string | null; sequence: number | null } | undefined;
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
  const broken = verifySessionChain(db, packet.sessionId);
  if (broken) {
    throw new ResumeVerificationError(
      `refusing packet ${packet.packetId}: session ${packet.sessionId} hash chain is broken at ` +
        `${broken.brokenAtEventId} (expected prev ${JSON.stringify(broken.expectedPrev)}, got ${JSON.stringify(broken.actualPrev)})`,
    );
  }

  // Bounded prefix handles in replay order, up to and including the head.
  const rows = sessionTranscriptRows(db, packet.sessionId);
  const headIndex = rows.findIndex((r) => r.event_id === headEventId);
  const prefix = rows.slice(0, headIndex + 1).map((row) => ({
    transcriptEventId: row.event_id,
    sequence: row.sequence,
    kind: row.kind,
    ledgerSeq: row.ledger_seq,
  }));

  return {
    packet,
    sessionId: packet.sessionId,
    agentNodeId: packet.agentNodeId,
    transcriptPrefix: prefix,
    contextRef: { kind: 'compaction-packet', ref: packet.packetId, droppable: false },
    revalidation,
  };
}
