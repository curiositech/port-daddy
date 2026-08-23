/**
 * Parley trigger — the pure structural entry gate for ADR-0129.
 *
 * ConflictSignal records what happened at a lifecycle checkpoint. Evaluation
 * mode is deliberately outside that envelope: diagnostic callers may run
 * cost/limit what-if evaluations, while automatic callers always use immutable
 * server policy.
 *
 *     convene  ⇔  confidenceProxy · waste · |unresolved|  >  parleyCost
 *
 * During bootstrap, signal confidence is an uncalibrated structural proxy,
 * not a failure probability; magnitude is |unresolved|. Durable signal and
 * outcome telemetry supports later calibration. No prose or keyword classifier
 * participates in admission.
 */

import { createHash } from 'node:crypto';
import type { ThreadDigest } from './discourse-lineage.js';
import type { TrustTier } from './fleet/trust.js';

export const CONFLICT_SIGNAL_SCHEMA_VERSION = 1 as const;

export const CONFLICT_SIGNAL_KINDS = Object.freeze([
  'conversational_contradiction',
  'claim_overlap',
  'semantic_surface_conflict',
  'decision_contradiction',
  'task_convergence',
] as const);

export type ConflictSignalKind = (typeof CONFLICT_SIGNAL_KINDS)[number];

export const PARLEY_SHAPES = Object.freeze([
  'debate-with-judge',
  'contract-net',
] as const);

export type ParleyShape = (typeof PARLEY_SHAPES)[number];

export const PARLEY_CHECKPOINTS = Object.freeze([
  'conversation',
  'claim',
  'session_begin',
  'session_takeover',
  'continuation_accept',
  'quorum_vote',
  'guard_receipt',
] as const);

export type ParleyCheckpoint = (typeof PARLEY_CHECKPOINTS)[number];
export type ParleyEvaluationMode = 'diagnostic' | 'automatic';

/**
 * Server-owned anti-griefing ceilings, measured in JavaScript string code
 * units. These admit normal multi-agent fan-in and full file/symbol references
 * while bounding policy work and the memory retained for one signal. Inputs
 * over a ceiling are refused; producers and the gate never truncate them.
 */
export const CONFLICT_SIGNAL_LIMITS = Object.freeze({
  maxParties: 32,
  maxEvidenceRefs: 256,
  maxSignalIdChars: 128,
  maxSurfaceChars: 1024,
  maxReasonChars: 2048,
  maxPartyChars: 128,
  maxEvidenceRefChars: 512,
} as const);

export const CONFLICT_SIGNAL_PRODUCERS = Object.freeze({
  messagingDiagnostic: 'port-daddy:messaging-lineage-diagnostic',
  tubeDiagnostic: 'port-daddy:tube-lineage-diagnostic',
  conversationConflict: 'port-daddy:conversation-conflict',
  claimConflict: 'port-daddy:claim-conflict',
  sessionBeginConvergence: 'port-daddy:session-begin-convergence',
  sessionTakeoverConflict: 'port-daddy:session-takeover-conflict',
  continuationConflict: 'port-daddy:continuation-conflict',
  quorumVoteConflict: 'port-daddy:quorum-vote-conflict',
  guardReceiptConflict: 'port-daddy:guard-receipt-conflict',
} as const);

export type ConflictSignalProducer =
  (typeof CONFLICT_SIGNAL_PRODUCERS)[keyof typeof CONFLICT_SIGNAL_PRODUCERS];

type DiagnosticSignalProducer =
  | typeof CONFLICT_SIGNAL_PRODUCERS.messagingDiagnostic
  | typeof CONFLICT_SIGNAL_PRODUCERS.tubeDiagnostic;

export interface ConflictSignalProvenance {
  /** Server-owned producer identity; user input must never populate this. */
  readonly producer: ConflictSignalProducer;
  /** Existing fleet trust vocabulary; admitted Parley signals must be INTERNAL. */
  readonly trustTier: TrustTier;
  /** Epoch milliseconds at which the trusted producer created this signal. */
  readonly producedAt: number;
}

/** The sole signal envelope accepted by `shouldConvene`. */
export interface ConflictSignal {
  readonly schemaVersion: typeof CONFLICT_SIGNAL_SCHEMA_VERSION;
  readonly signalId: string;
  readonly kind: ConflictSignalKind;
  readonly checkpoint: ParleyCheckpoint;
  readonly shape: ParleyShape;
  readonly parties: readonly string[];
  /** Exact shared resource: conversation, file, symbol, decision, or task set. */
  readonly surface: string;
  /** Structural unresolved count. A single exact claim overlap is magnitude 1. */
  readonly magnitude: number;
  /** Uncalibrated structural confidence proxy in [0,1] used by the bootstrap heuristic. */
  readonly confidence: number;
  readonly reason: string;
  readonly evidenceRefs: readonly string[];
  readonly provenance: ConflictSignalProvenance;
}

export interface ParleyCosts {
  /** Downstream waste if one unresolved conflict ships (USD or any consistent unit). */
  wastePerUnresolved: number;
  /** Cost of convening + running the parley, in the SAME unit as waste. */
  parleyCost: number;
}

export interface ParleyLimits {
  /** Parley rounds already run on this surface. Default 0. */
  priorRounds?: number;
  /** Diagnostic-only max-round override. Automatic mode ignores it. */
  maxRounds?: number;
  /** Depth of the envelope delegation chain. Default 0. */
  delegationDepth?: number;
  /** Diagnostic-only max-depth override. Automatic mode ignores it. */
  maxDelegationDepth?: number;
}

export interface DiagnosticParleyEvaluationOptions {
  readonly mode: 'diagnostic';
  readonly costs?: ParleyCosts;
  readonly limits?: ParleyLimits;
}

export interface AutomaticParleyEvaluationOptions {
  readonly mode: 'automatic';
  /** Automatic lifecycle authority is durable server state, never caller input. */
  readonly costs?: never;
  readonly limits?: never;
}

export type ParleyEvaluationOptions =
  | DiagnosticParleyEvaluationOptions
  | AutomaticParleyEvaluationOptions;

export type ParleyTermination = 'max-rounds' | 'delegation-depth';

export interface ParleyDecision {
  convene: boolean;
  /** The protocol shape to run when `convene` is true. */
  shape?: ParleyShape;
  /** Null only when a hostile runtime shape supplied an unknown checkpoint. */
  checkpoint: ParleyCheckpoint | null;
  signalId: string;
  /** Whether the signal passed runtime and checkpoint structural policy. */
  policyCleared: boolean;
  /** Signal magnitude used as the structural unresolved count. */
  unresolved: number;
  /** Bootstrap heuristic: confidence proxy · waste · unresolved count. */
  expectedWaste: number;
  /** Heuristic score minus parleyCost. Positive means convening is worth it. */
  margin: number;
  /** Set when a hard limit refused the parley regardless of economics. */
  terminated: ParleyTermination | null;
  /** One-line human-readable rationale. */
  reason: string;
}

interface KindPolicy {
  readonly shape: ParleyShape;
  readonly minConfidence: number;
  readonly minMagnitude: number;
}

interface CheckpointPolicy {
  readonly costs: Readonly<ParleyCosts>;
  readonly limits: Readonly<Required<Pick<ParleyLimits, 'maxRounds' | 'maxDelegationDepth'>>>;
  readonly automaticProducers: readonly ConflictSignalProducer[];
  readonly diagnosticProducers: readonly ConflictSignalProducer[];
  readonly kinds: Readonly<Partial<Record<ConflictSignalKind, Readonly<KindPolicy>>>>;
}

const DEFAULT_COSTS = Object.freeze({ wastePerUnresolved: 2, parleyCost: 1 });
const DEFAULT_LIMITS = Object.freeze({ maxRounds: 2, maxDelegationDepth: 4 });
const NO_DIAGNOSTIC_PRODUCERS = Object.freeze([] as ConflictSignalProducer[]);
const CONVERSATION_DIAGNOSTIC_PRODUCERS = Object.freeze([
  CONFLICT_SIGNAL_PRODUCERS.messagingDiagnostic,
  CONFLICT_SIGNAL_PRODUCERS.tubeDiagnostic,
]);

function kindPolicy(shape: ParleyShape): Readonly<KindPolicy> {
  return Object.freeze({ shape, minConfidence: 0.8, minMagnitude: 1 });
}

function checkpointPolicy(
  kinds: CheckpointPolicy['kinds'],
  automaticProducers: readonly ConflictSignalProducer[],
  diagnosticProducers: readonly ConflictSignalProducer[] = NO_DIAGNOSTIC_PRODUCERS,
): Readonly<CheckpointPolicy> {
  return Object.freeze({
    costs: DEFAULT_COSTS,
    limits: DEFAULT_LIMITS,
    automaticProducers: Object.freeze([...automaticProducers]),
    diagnosticProducers: Object.freeze([...diagnosticProducers]),
    kinds: Object.freeze(kinds),
  });
}

/** Deeply frozen server-owned policy for every ADR-0129 lifecycle checkpoint. */
export const PARLEY_CHECKPOINT_POLICIES: Readonly<Record<ParleyCheckpoint, Readonly<CheckpointPolicy>>> = Object.freeze({
  conversation: checkpointPolicy({
    conversational_contradiction: kindPolicy('debate-with-judge'),
  }, [CONFLICT_SIGNAL_PRODUCERS.conversationConflict], CONVERSATION_DIAGNOSTIC_PRODUCERS),
  claim: checkpointPolicy({
    claim_overlap: kindPolicy('contract-net'),
  }, [CONFLICT_SIGNAL_PRODUCERS.claimConflict]),
  session_begin: checkpointPolicy({
    task_convergence: kindPolicy('contract-net'),
  }, [CONFLICT_SIGNAL_PRODUCERS.sessionBeginConvergence]),
  session_takeover: checkpointPolicy({
    semantic_surface_conflict: kindPolicy('debate-with-judge'),
  }, [CONFLICT_SIGNAL_PRODUCERS.sessionTakeoverConflict]),
  continuation_accept: checkpointPolicy({
    semantic_surface_conflict: kindPolicy('debate-with-judge'),
  }, [CONFLICT_SIGNAL_PRODUCERS.continuationConflict]),
  quorum_vote: checkpointPolicy({
    decision_contradiction: kindPolicy('debate-with-judge'),
  }, [CONFLICT_SIGNAL_PRODUCERS.quorumVoteConflict]),
  guard_receipt: checkpointPolicy({
    semantic_surface_conflict: kindPolicy('debate-with-judge'),
  }, [CONFLICT_SIGNAL_PRODUCERS.guardReceiptConflict]),
});

export interface ConversationalDiagnosticSignalInput {
  readonly channel: string;
  readonly conversationId?: string;
  readonly digest: ThreadDigest;
  readonly producer: DiagnosticSignalProducer;
  /** Injectable for deterministic tests; production callers use Date.now(). */
  readonly producedAt?: number;
}

export interface ConflictSignalIdentityInput {
  readonly checkpoint: ParleyCheckpoint;
  readonly kind: ConflictSignalKind;
  readonly surface: string;
  readonly parties: readonly string[];
  readonly evidenceRefs: readonly string[];
}

function canonicalStringSet(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()))].sort();
}

/** Shared producer-stable identity implementation for diagnostic and G2 producers. */
export function conflictSignalId(input: ConflictSignalIdentityInput): string {
  const canonicalParties = canonicalStringSet(input.parties);
  const canonicalEvidenceRefs = canonicalStringSet(input.evidenceRefs);
  const structuralIdentity = JSON.stringify([
    CONFLICT_SIGNAL_SCHEMA_VERSION,
    input.checkpoint,
    input.kind,
    input.surface.trim(),
    canonicalParties,
    canonicalEvidenceRefs,
  ]);
  const digest = createHash('sha256').update(structuralIdentity, 'utf8').digest('hex');
  return `parley-signal:v1:${digest}`;
}

/** Central adapter shared by the route and CLI diagnostic surfaces. */
export function buildConversationalDiagnosticSignal(
  input: ConversationalDiagnosticSignalInput,
): ConflictSignal {
  const producedAt = input.producedAt ?? Date.now();
  const parties = canonicalStringSet(input.digest.participants);
  const evidenceRefs = canonicalStringSet(
    input.digest.unresolvedContradictions.map(
      (edge) => `tube-message:${edge.from}:contradicts:${edge.to}`,
    ),
  );
  const surface = input.conversationId
    ? `tube-channel:${input.channel}:conversation:${input.conversationId}`
    : `tube-channel:${input.channel}`;
  const checkpoint = 'conversation' as const;
  const kind = 'conversational_contradiction' as const;

  return {
    schemaVersion: CONFLICT_SIGNAL_SCHEMA_VERSION,
    signalId: conflictSignalId({
      checkpoint,
      kind,
      surface,
      parties,
      evidenceRefs,
    }),
    kind,
    checkpoint,
    shape: 'debate-with-judge',
    parties,
    surface,
    magnitude: evidenceRefs.length,
    confidence: 1,
    reason: `${evidenceRefs.length} structurally unresolved conversational contradiction(s)`,
    evidenceRefs,
    provenance: {
      producer: input.producer,
      trustTier: 'INTERNAL',
      producedAt,
    },
  };
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isCheckpoint(value: unknown): value is ParleyCheckpoint {
  return typeof value === 'string'
    && (PARLEY_CHECKPOINTS as readonly string[]).includes(value);
}

function isKind(value: unknown): value is ConflictSignalKind {
  return typeof value === 'string'
    && (CONFLICT_SIGNAL_KINDS as readonly string[]).includes(value);
}

function isShape(value: unknown): value is ParleyShape {
  return typeof value === 'string'
    && (PARLEY_SHAPES as readonly string[]).includes(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function refusal(signal: unknown, reason: string): ParleyDecision {
  const record = isRecord(signal) ? signal : null;
  const checkpoint = isCheckpoint(record?.checkpoint) ? record.checkpoint : null;
  return {
    convene: false,
    checkpoint,
    signalId: isNonEmptyString(record?.signalId) ? record.signalId : '',
    policyCleared: false,
    unresolved: 0,
    expectedWaste: 0,
    margin: 0,
    terminated: null,
    reason: `checkpoint policy refused signal: ${reason}`,
  };
}

interface ValidatedSignal {
  readonly signal: ConflictSignal;
  readonly policy: Readonly<CheckpointPolicy>;
  readonly kindPolicy: Readonly<KindPolicy>;
}

function validateSignal(value: unknown): ValidatedSignal | string {
  if (!isRecord(value)) return 'conflict signal must be an object';
  if (value.schemaVersion !== CONFLICT_SIGNAL_SCHEMA_VERSION) {
    return `unsupported conflict signal schema version ${String(value.schemaVersion)}`;
  }
  if (!isCheckpoint(value.checkpoint)) {
    return `unknown lifecycle checkpoint ${String(value.checkpoint)}`;
  }
  if (!isKind(value.kind)) return `unknown conflict signal kind ${String(value.kind)}`;
  if (!isShape(value.shape)) return `unknown parley shape ${String(value.shape)}`;
  if (!isNonEmptyString(value.signalId)) return 'conflict signal identity is empty';
  if (value.signalId.length > CONFLICT_SIGNAL_LIMITS.maxSignalIdChars) {
    return `conflict signal identity exceeds ${CONFLICT_SIGNAL_LIMITS.maxSignalIdChars} characters`;
  }
  if (!isNonEmptyString(value.surface)) return 'conflict signal surface is empty';
  if (value.surface.length > CONFLICT_SIGNAL_LIMITS.maxSurfaceChars) {
    return `conflict signal surface exceeds ${CONFLICT_SIGNAL_LIMITS.maxSurfaceChars} characters`;
  }
  if (!isNonEmptyString(value.reason)) return 'conflict signal reason is empty';
  if (value.reason.length > CONFLICT_SIGNAL_LIMITS.maxReasonChars) {
    return `conflict signal reason exceeds ${CONFLICT_SIGNAL_LIMITS.maxReasonChars} characters`;
  }
  if (!Array.isArray(value.evidenceRefs) || value.evidenceRefs.length === 0) {
    return 'conflict signal evidence is empty or malformed';
  }
  if (value.evidenceRefs.length > CONFLICT_SIGNAL_LIMITS.maxEvidenceRefs) {
    return `conflict signal evidence exceeds ${CONFLICT_SIGNAL_LIMITS.maxEvidenceRefs} references`;
  }
  if (!value.evidenceRefs.every(isNonEmptyString)) {
    return 'conflict signal evidence is empty or malformed';
  }
  if (value.evidenceRefs.some((ref) => ref.length > CONFLICT_SIGNAL_LIMITS.maxEvidenceRefChars)) {
    return `conflict signal evidence reference exceeds ${CONFLICT_SIGNAL_LIMITS.maxEvidenceRefChars} characters`;
  }
  const distinctEvidenceRefs = new Set(value.evidenceRefs.map((ref) => ref.trim()));
  if (distinctEvidenceRefs.size !== value.evidenceRefs.length) {
    return 'conflict signal contains duplicate evidence references after whitespace normalization';
  }
  if (!Array.isArray(value.parties)) {
    return 'conflict signal parties are malformed';
  }
  if (value.parties.length > CONFLICT_SIGNAL_LIMITS.maxParties) {
    return `conflict signal parties exceed ${CONFLICT_SIGNAL_LIMITS.maxParties}`;
  }
  if (!value.parties.every(isNonEmptyString)) return 'conflict signal parties are malformed';
  if (value.parties.some((party) => party.length > CONFLICT_SIGNAL_LIMITS.maxPartyChars)) {
    return `conflict signal party exceeds ${CONFLICT_SIGNAL_LIMITS.maxPartyChars} characters`;
  }
  const distinctParties = new Set(value.parties.map((party) => party.trim()));
  if (distinctParties.size < 2) return 'conflict signal needs at least two distinct nonempty parties';
  if (distinctParties.size !== value.parties.length) {
    return 'conflict signal contains duplicate parties after whitespace normalization';
  }
  const expectedSignalId = conflictSignalId({
    checkpoint: value.checkpoint,
    kind: value.kind,
    surface: value.surface,
    parties: value.parties,
    evidenceRefs: value.evidenceRefs,
  });
  if (value.signalId !== expectedSignalId) {
    return 'conflict signal identity does not match its structural fields';
  }
  if (!isNonNegativeInteger(value.magnitude)) return 'conflict signal magnitude must be a nonnegative integer';
  if (typeof value.confidence !== 'number'
    || !Number.isFinite(value.confidence)
    || value.confidence < 0
    || value.confidence > 1) {
    return 'conflict signal confidence must be finite and within [0,1]';
  }
  if (!isRecord(value.provenance)) return 'conflict signal provenance is absent';
  if (value.provenance.trustTier !== 'INTERNAL') return 'conflict signal provenance is not INTERNAL';
  if (!isNonNegativeInteger(value.provenance.producedAt) || value.provenance.producedAt === 0) {
    return 'conflict signal production time is malformed';
  }
  if (!(Object.values(CONFLICT_SIGNAL_PRODUCERS) as string[]).includes(String(value.provenance.producer))) {
    return `unknown conflict signal producer ${String(value.provenance.producer)}`;
  }

  const checkpoint = value.checkpoint;
  const kind = value.kind;
  const policy = PARLEY_CHECKPOINT_POLICIES[checkpoint];
  const admittedKind = policy.kinds[kind];
  if (!admittedKind) return `${kind} is not admitted at ${checkpoint}`;
  if (value.shape !== admittedKind.shape) {
    return `${kind} requires ${admittedKind.shape}, not ${value.shape}`;
  }
  if (value.magnitude < admittedKind.minMagnitude) {
    return `${kind} magnitude ${value.magnitude} is below ${admittedKind.minMagnitude}`;
  }
  if (value.confidence < admittedKind.minConfidence) {
    return `${kind} confidence ${value.confidence} is below ${admittedKind.minConfidence}`;
  }

  return {
    signal: value as unknown as ConflictSignal,
    policy,
    kindPolicy: admittedKind,
  };
}

function validateOptions(value: unknown): ParleyEvaluationOptions | string {
  if (!isRecord(value)) return 'evaluation options must be an object';
  if (value.mode !== 'diagnostic' && value.mode !== 'automatic') {
    return `unknown evaluation mode ${String(value.mode)}`;
  }
  if (value.mode === 'automatic'
    && (Object.prototype.hasOwnProperty.call(value, 'costs')
      || Object.prototype.hasOwnProperty.call(value, 'limits'))) {
    return 'automatic evaluation does not accept caller costs or lifecycle limits';
  }
  if (value.costs !== undefined) {
    if (!isRecord(value.costs)) return 'diagnostic costs must be an object';
    if (!isFiniteNonNegative(value.costs.wastePerUnresolved)
      || !isFiniteNonNegative(value.costs.parleyCost)) {
      return 'diagnostic costs must be finite and nonnegative';
    }
  }
  if (value.limits !== undefined) {
    if (!isRecord(value.limits)) return 'parley limits must be an object';
    if (value.limits.priorRounds !== undefined && !isNonNegativeInteger(value.limits.priorRounds)) {
      return 'prior rounds must be a nonnegative integer';
    }
    if (value.limits.delegationDepth !== undefined && !isNonNegativeInteger(value.limits.delegationDepth)) {
      return 'delegation depth must be a nonnegative integer';
    }
    if (value.limits.maxRounds !== undefined && !isNonNegativeInteger(value.limits.maxRounds)) {
      return 'diagnostic max rounds must be a nonnegative integer';
    }
    if (value.limits.maxDelegationDepth !== undefined
      && !isNonNegativeInteger(value.limits.maxDelegationDepth)) {
      return 'diagnostic max delegation depth must be a nonnegative integer';
    }
  }
  return value as unknown as ParleyEvaluationOptions;
}

/** Decide whether one structural signal should convene a parley. */
export function shouldConvene(
  signal: ConflictSignal,
  options: ParleyEvaluationOptions,
): ParleyDecision {
  const validatedSignal = validateSignal(signal);
  if (typeof validatedSignal === 'string') return refusal(signal, validatedSignal);

  const validatedOptions = validateOptions(options);
  if (typeof validatedOptions === 'string') return refusal(signal, validatedOptions);

  const { policy } = validatedSignal;
  const modeProducers = validatedOptions.mode === 'automatic'
    ? policy.automaticProducers
    : policy.diagnosticProducers;
  if (!modeProducers.includes(validatedSignal.signal.provenance.producer)) {
    return refusal(
      signal,
      `producer ${validatedSignal.signal.provenance.producer} is not allowed for ${validatedOptions.mode} ${validatedSignal.signal.checkpoint} evaluation`,
    );
  }

  const limits = validatedOptions.limits ?? {};
  const maxRounds = validatedOptions.mode === 'diagnostic'
    ? (limits.maxRounds ?? policy.limits.maxRounds)
    : policy.limits.maxRounds;
  const maxDepth = validatedOptions.mode === 'diagnostic'
    ? (limits.maxDelegationDepth ?? policy.limits.maxDelegationDepth)
    : policy.limits.maxDelegationDepth;
  const unresolved = validatedSignal.signal.magnitude;
  const costs = validatedOptions.mode === 'diagnostic' && validatedOptions.costs
    ? validatedOptions.costs
    : policy.costs;
  const expectedWaste = validatedSignal.signal.confidence * costs.wastePerUnresolved * unresolved;
  const margin = expectedWaste - costs.parleyCost;
  const base = {
    checkpoint: validatedSignal.signal.checkpoint,
    signalId: validatedSignal.signal.signalId,
    unresolved,
    expectedWaste,
    margin,
  };

  // Hard termination beats economics after the envelope has safely validated.
  if ((limits.priorRounds ?? 0) >= maxRounds) {
    return {
      ...base,
      convene: false,
      policyCleared: false,
      terminated: 'max-rounds',
      reason: `already ran ${limits.priorRounds} parley round(s) (max ${maxRounds}) — escalate to the operator instead`,
    };
  }
  if ((limits.delegationDepth ?? 0) > maxDepth) {
    return {
      ...base,
      convene: false,
      policyCleared: false,
      terminated: 'delegation-depth',
      reason: `delegation depth ${limits.delegationDepth} exceeds ${maxDepth} — likely ping-pong; escalate instead`,
    };
  }

  if (margin > 0) {
    return {
      ...base,
      convene: true,
      shape: validatedSignal.signal.shape,
      policyCleared: true,
      terminated: null,
      reason: `bootstrap waste score ${expectedWaste.toFixed(2)} > parley cost ${costs.parleyCost.toFixed(2)} across ${unresolved} unresolved conflict(s)`,
    };
  }

  return {
    ...base,
    convene: false,
    policyCleared: true,
    terminated: null,
    reason: `bootstrap waste score ${expectedWaste.toFixed(2)} ≤ parley cost ${costs.parleyCost.toFixed(2)} — coordinating costs more than the conflict; proceed`,
  };
}
