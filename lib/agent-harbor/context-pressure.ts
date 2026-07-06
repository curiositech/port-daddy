/**
 * Agent Harbor M6 — context-pressure tracking (ADR-0097 phase 1;
 * binder ch04 "Context pressure"; ch07 M6 gate line 1: "force context
 * threshold and see compaction packet").
 *
 * The frozen F0 ContextEnvelope (schemas/agent-harbor/v0/
 * context-envelope.schema.json, ADR-0095 — NOT modified here) is context
 * pressure *accounting*; this module is the ch04 threshold policy that reads
 * it. The CompactionPacket (ADR-0097) is the *continuation artifact* pressure
 * triggers — built by lib/agent-harbor/compaction.ts, joined back to the
 * envelope through `trigger.contextEnvelopeRef`.
 *
 * Ch04 default thresholds (normative here, frozen as constants + tests):
 *   - 0.60  start preparing compaction candidates;
 *   - 0.75  Longshoreman builds a cited memory packet;
 *   - 0.85  warn the operator or agent before broad new work;
 *   - 0.92  require compaction or successor creation before next major action.
 *
 * "Hard behavior should be tied to this envelope, not vague token estimates"
 * (ch04) — so every assessment starts from a schema-validated envelope, and
 * the daemon treats "context almost full" as an operational event, not an
 * agent's private problem.
 *
 * Skill grafts honored (cited in the M6 compaction PR):
 *   - context-economics-for-agent-swarms: tokens are COGS and the legibility
 *     lens at once; thresholds fire on the used/window ratio *before* the
 *     degradation cascade (lost-in-the-middle, context rot), never after.
 *     The droppable-ref accounting below is the per-agent budget lever.
 *   - always-on-agent-inputs: pressure is an *input trigger* — the reactive
 *     wake-up condition for a Longshoreman — so the assessment names the
 *     action, not just a number.
 *   - agent-interchange-formats: tolerant reader — unknown envelope fields
 *     ride along; the envelope self-identifies via its `schema` const; a
 *     reported `pressure` label that disagrees with the computed band is
 *     surfaced as drift, never silently overwritten.
 *   - agent-compliance-conformance: the envelope's own `pressure` /
 *     `compactionNeeded` self-report is never trusted as the trigger — the
 *     ratio is recomputed from `usedTokensEstimate`/`windowTokens` and
 *     disagreement is reported (self-attestation must not move policy).
 */

import { randomUUID } from 'node:crypto';
import type { DatabaseInstance } from '../sqlite-runtime.js';
import { readEvents } from './event-ledger.js';
import { assertAgainstSchema } from './schema-validate.js';

// ─────────────────────────────────────────────────────────────────────────────
// Thresholds (binder ch04, normative)
// ─────────────────────────────────────────────────────────────────────────────

/** Ch04 default thresholds as used/window ratios. Frozen by test. */
export const CONTEXT_PRESSURE_THRESHOLDS = {
  /** 60%: start preparing compaction candidates. */
  prepare: 0.6,
  /** 75%: Longshoreman builds a cited memory packet. */
  compact: 0.75,
  /** 85%: warn the operator or agent before broad new work. */
  warn: 0.85,
  /** 92%: require compaction or successor creation before next major action. */
  require: 0.92,
} as const;

/** Planner-facing bands — the frozen ContextEnvelope `pressure` enum values. */
export type PressureBand = 'low' | 'medium' | 'high' | 'critical';

/** The ch04 action ladder, one step per threshold. */
export const PRESSURE_ACTIONS = [
  'none',
  'prepare_compaction',
  'build_compaction_packet',
  'warn_before_broad_work',
  'require_compaction_or_successor',
] as const;
export type PressureAction = (typeof PRESSURE_ACTIONS)[number];

export interface PressureAssessment {
  /** used/window, clamped to [0, 1] — safe to copy into CompactionPacket.trigger.pressure. */
  ratio: number;
  /** used/window without clamping (can exceed 1 when the estimate overflows the window). */
  rawRatio: number;
  /** Planner-facing band matching the frozen ContextEnvelope pressure enum. */
  band: PressureBand;
  /** Highest ch04 action whose threshold the ratio crossed. */
  action: PressureAction;
  /** The numeric threshold that fired (null below 0.60). */
  thresholdCrossed: number | null;
  /** True at or above the 0.75 Longshoreman threshold. */
  compactionNeeded: boolean;
  /** True at or above the 0.92 hard gate: no major action before compaction/successor. */
  successorRequired: boolean;
}

/**
 * Classify a used/window token ratio against the ch04 thresholds.
 *
 * Fail-closed: a non-positive or non-finite window means the tracker cannot
 * prove headroom exists, so pressure is critical — the same posture as the
 * ledger's refusal to persist an unverifiable hash.
 */
export function classifyPressure(windowTokens: number, usedTokensEstimate: number): PressureAssessment {
  const windowInvalid = !Number.isFinite(windowTokens) || windowTokens <= 0;
  const usedInvalid = !Number.isFinite(usedTokensEstimate) || usedTokensEstimate < 0;
  const rawRatio = windowInvalid || usedInvalid ? 1 : usedTokensEstimate / windowTokens;
  const ratio = Math.min(1, Math.max(0, rawRatio));

  const t = CONTEXT_PRESSURE_THRESHOLDS;
  let action: PressureAction = 'none';
  let thresholdCrossed: number | null = null;
  if (rawRatio >= t.require) {
    action = 'require_compaction_or_successor';
    thresholdCrossed = t.require;
  } else if (rawRatio >= t.warn) {
    action = 'warn_before_broad_work';
    thresholdCrossed = t.warn;
  } else if (rawRatio >= t.compact) {
    action = 'build_compaction_packet';
    thresholdCrossed = t.compact;
  } else if (rawRatio >= t.prepare) {
    action = 'prepare_compaction';
    thresholdCrossed = t.prepare;
  }

  const band: PressureBand =
    rawRatio >= t.require ? 'critical' : rawRatio >= t.compact ? 'high' : rawRatio >= t.prepare ? 'medium' : 'low';

  return {
    ratio,
    rawRatio,
    band,
    action,
    thresholdCrossed,
    compactionNeeded: rawRatio >= t.compact,
    successorRequired: rawRatio >= t.require,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Envelope assessment (frozen F0 ContextEnvelope in, policy out)
// ─────────────────────────────────────────────────────────────────────────────

/** TypeScript convenience over the frozen contract; the schema wins on disagreement. */
export interface ContextEnvelope {
  schema: 'pd.agent-harbor.context-envelope.v0';
  envelopeId: string;
  agentNodeId: string;
  sessionId: string;
  runId?: string | null;
  windowTokens: number;
  usedTokensEstimate: number;
  compactionNeeded?: boolean;
  pressure?: PressureBand | null;
  contextRefs?: Array<{ kind: string; ref: string; tokensEstimate?: number; droppable?: boolean }>;
  compactionPacketRef?: string | null;
  sourceEventId?: string | null;
  measuredAt: string;
  [extra: string]: unknown;
}

export interface EnvelopeAssessment extends PressureAssessment {
  envelopeId: string;
  sessionId: string;
  agentNodeId: string;
  runId: string | null;
  measuredAt: string;
  /**
   * Disagreements between the envelope's self-reported `pressure` /
   * `compactionNeeded` and the recomputed values. Reported, never silently
   * corrected (agent-compliance-conformance: self-report is not the trigger).
   */
  selfReportDrift: string[];
  /** Tokens reclaimable by dropping droppable contextRefs (budget lever). */
  droppableTokensEstimate: number;
}

/**
 * Validate an envelope against the frozen F0 schema and classify its pressure.
 * Throws on contract violation (fail-closed); never mutates the envelope.
 */
export function assessContextEnvelope(envelope: ContextEnvelope): EnvelopeAssessment {
  assertAgainstSchema('context-envelope', envelope);
  const assessment = classifyPressure(envelope.windowTokens, envelope.usedTokensEstimate);

  const selfReportDrift: string[] = [];
  if (envelope.pressure != null && envelope.pressure !== assessment.band) {
    selfReportDrift.push(
      `envelope reports pressure "${envelope.pressure}" but used/window = ${assessment.rawRatio.toFixed(3)} computes "${assessment.band}"`,
    );
  }
  if (typeof envelope.compactionNeeded === 'boolean' && envelope.compactionNeeded !== assessment.compactionNeeded) {
    selfReportDrift.push(
      `envelope reports compactionNeeded=${envelope.compactionNeeded} but the ch04 0.75 threshold computes ${assessment.compactionNeeded}`,
    );
  }

  let droppableTokensEstimate = 0;
  for (const ref of envelope.contextRefs ?? []) {
    if (ref.droppable === true && typeof ref.tokensEstimate === 'number' && ref.tokensEstimate > 0) {
      droppableTokensEstimate += ref.tokensEstimate;
    }
  }

  return {
    ...assessment,
    envelopeId: envelope.envelopeId,
    sessionId: envelope.sessionId,
    agentNodeId: envelope.agentNodeId,
    runId: envelope.runId ?? null,
    measuredAt: envelope.measuredAt,
    selfReportDrift,
    droppableTokensEstimate,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Envelope construction (for adapters/daemon emitting pressure facts)
// ─────────────────────────────────────────────────────────────────────────────

export interface BuildEnvelopeInput {
  agentNodeId: string;
  sessionId: string;
  runId?: string | null;
  windowTokens: number;
  usedTokensEstimate: number;
  contextRefs?: ContextEnvelope['contextRefs'];
  compactionPacketRef?: string | null;
  sourceEventId?: string | null;
  measuredAt?: string;
  envelopeId?: string;
}

/**
 * Build a schema-valid ContextEnvelope with the pressure band and
 * compactionNeeded derived from the ch04 thresholds (never self-asserted).
 */
export function buildContextEnvelope(input: BuildEnvelopeInput): ContextEnvelope {
  const assessment = classifyPressure(input.windowTokens, input.usedTokensEstimate);
  const envelope: ContextEnvelope = {
    schema: 'pd.agent-harbor.context-envelope.v0',
    envelopeId: input.envelopeId ?? `ctx_${randomUUID()}`,
    agentNodeId: input.agentNodeId,
    sessionId: input.sessionId,
    runId: input.runId ?? null,
    windowTokens: input.windowTokens,
    usedTokensEstimate: input.usedTokensEstimate,
    compactionNeeded: assessment.compactionNeeded,
    pressure: assessment.band,
    contextRefs: input.contextRefs ?? [],
    compactionPacketRef: input.compactionPacketRef ?? null,
    sourceEventId: input.sourceEventId ?? null,
    measuredAt: input.measuredAt ?? new Date().toISOString(),
  };
  assertAgainstSchema('context-envelope', envelope);
  return envelope;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ledger-derived tracking (heartbeat / context_pressure transcript events)
// ─────────────────────────────────────────────────────────────────────────────

/** Transcript kinds that may carry a context envelope (ch03 heartbeat context). */
const PRESSURE_EVENT_KINDS = new Set(['heartbeat', 'context_pressure']);

function envelopeFromPayload(payload: Record<string, unknown>): ContextEnvelope | null {
  // Tolerant reader: the envelope self-identifies via its schema const —
  // either the payloadJson IS the envelope or it nests one under
  // `contextEnvelope`. Anything else is not ours and is skipped, not crashed.
  const payloadJson = (payload.payloadJson ?? {}) as Record<string, unknown>;
  const candidates = [payloadJson, payloadJson.contextEnvelope];
  for (const candidate of candidates) {
    if (
      candidate !== null &&
      typeof candidate === 'object' &&
      !Array.isArray(candidate) &&
      (candidate as Record<string, unknown>).schema === 'pd.agent-harbor.context-envelope.v0'
    ) {
      return candidate as ContextEnvelope;
    }
  }
  return null;
}

export interface LedgerPressureReading {
  transcriptEventId: string;
  ledgerSeq: number;
  kind: string;
  assessment: EnvelopeAssessment;
}

/**
 * Derive the pressure history of a session from its append-only transcript:
 * every heartbeat / context_pressure event carrying a schema-identified
 * ContextEnvelope becomes a reading, in ledger replay order. Envelopes that
 * fail the frozen contract are skipped with a note (tolerant reader for
 * foreign payloads; fail-closed only for shapes that claim to be ours).
 */
export function pressureHistoryFromLedger(
  db: DatabaseInstance,
  sessionId: string,
): { readings: LedgerPressureReading[]; skipped: Array<{ transcriptEventId: string; reason: string }> } {
  const readings: LedgerPressureReading[] = [];
  const skipped: Array<{ transcriptEventId: string; reason: string }> = [];
  const PAGE = 10_000;
  let afterSeq = 0;
  for (;;) {
    const rows = readEvents(db, { streamType: 'transcript-event', sessionId, afterSeq, limit: PAGE });
    for (const row of rows) {
      if (!row.kind || !PRESSURE_EVENT_KINDS.has(row.kind)) continue;
      const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
      const envelope = envelopeFromPayload(payload);
      if (!envelope) continue;
      try {
        readings.push({
          transcriptEventId: row.event_id,
          ledgerSeq: row.ledger_seq,
          kind: row.kind,
          assessment: assessContextEnvelope(envelope),
        });
      } catch (err) {
        skipped.push({ transcriptEventId: row.event_id, reason: (err as Error).message });
      }
    }
    if (rows.length < PAGE) break;
    afterSeq = rows[rows.length - 1].ledger_seq;
  }
  return { readings, skipped };
}

/** Latest ledger-derived pressure reading for a session, or null. */
export function latestPressureFromLedger(db: DatabaseInstance, sessionId: string): LedgerPressureReading | null {
  const { readings } = pressureHistoryFromLedger(db, sessionId);
  return readings.length > 0 ? readings[readings.length - 1] : null;
}
