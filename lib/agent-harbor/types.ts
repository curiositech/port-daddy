/**
 * Agent Harbor C2 — shared types mirroring the frozen F0 v0 contracts
 * (schemas/agent-harbor/v0/, ADR-0095). These interfaces are TypeScript
 * conveniences over the language-neutral JSON Schemas; the schemas win on any
 * disagreement, and every enum literal here is asserted against the schema
 * files by tests/unit/agent-harbor-compliance-probes.test.js so drift fails CI.
 *
 * Tolerant-reader posture (ADR-0095 §6): all object types allow extra fields.
 */

/** Frozen 7-level compliance ladder (ADR-0095 fork resolution 2). */
export const COMPLIANCE_LADDER = ['C0', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6'] as const;
export type ComplianceLevel = (typeof COMPLIANCE_LADDER)[number];

/** Transcript fidelity ladder (binder ch03; T4 = minimum for official C1). */
export const TRANSCRIPT_FIDELITY_LADDER = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5'] as const;
export type TranscriptFidelity = (typeof TRANSCRIPT_FIDELITY_LADDER)[number];

/** Body kinds per agent-run.schema.json body.kind (minus 'human', which is not probeable). */
export const ADAPTER_KINDS = [
  'claude-code',
  'codex-cli',
  'cloudflare',
  'ollama',
  'lmstudio',
  'custom-stdio',
  'custom-http',
  'spawner-child',
] as const;
export type AdapterKind = (typeof ADAPTER_KINDS)[number];

/** Model-tier policy per agent-run.schema.json body.modelTier (ch18 C2 work order). */
export const MODEL_TIERS = ['fast', 'mid', 'strong', 'local', 'custom'] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

export const LAUNCH_MODES = ['native', 'hooked', 'proxy', 'observed', 'unmanaged'] as const;
export type LaunchMode = (typeof LAUNCH_MODES)[number];

export const BODY_KINDS = [
  'claude-code',
  'codex-cli',
  'cloudflare',
  'ollama',
  'lmstudio',
  'custom-stdio',
  'custom-http',
  'spawner-child',
  'human',
] as const;
export type BodyKind = (typeof BODY_KINDS)[number];

/** Honest downgraded modes per agent-node.schema.json officialMode. */
export const OFFICIAL_MODES = [
  'official',
  'observed',
  'run-log',
  'transcripted-weak',
  'sandbox-degraded',
  'privacy-degraded',
  'unmanaged',
] as const;
export type OfficialMode = (typeof OFFICIAL_MODES)[number];

/** Control kinds per control-command.schema.json. */
export const CONTROL_KINDS = [
  'pause',
  'interrupt',
  'steer',
  'checkpoint',
  'resume',
  'retire',
  'fork',
  'kill',
] as const;
export type ControlKind = (typeof CONTROL_KINDS)[number];

export const CONTROL_STATUSES = [
  'queued',
  'delivered',
  'acknowledged',
  'failed',
  'expired',
  'unsupported',
] as const;
export type ControlStatus = (typeof CONTROL_STATUSES)[number];

/** The six required negative probe kinds (compliance-probe-result.schema.json; forged-guidance per ADR-0096). */
export const NEGATIVE_PROBE_KINDS = [
  'forged-level',
  'direct-mcp-bypass',
  'disabled-hook-after-launch',
  'forged-heartbeat',
  'observed-to-controlled',
  'forged-guidance',
] as const;
export type NegativeProbeKind = (typeof NEGATIVE_PROBE_KINDS)[number];

/**
 * Known guidance item kinds (guidance-envelope.schema.json). The schema keeps
 * `kind` an OPEN string for tolerant reading (ADR-0096): unknown kinds are
 * preserved and rendered as "unrecognized guidance (verified source)" — never
 * silently dropped, never acted on.
 */
export const KNOWN_GUIDANCE_KINDS = [
  'inbox',
  'conflict-warning',
  'skill-graft',
  'memory-packet',
  'repo-update',
] as const;
export type KnownGuidanceKind = (typeof KNOWN_GUIDANCE_KINDS)[number];

export const GUIDANCE_AUTHORITY_MODES = ['loopback', 'macaroon'] as const;
export type GuidanceAuthorityMode = (typeof GUIDANCE_AUTHORITY_MODES)[number];

export const GUIDANCE_OPERATOR_ACTIONS = [
  'fleetbar-gate-approval',
  'pd-cli',
  'console-click',
  'daemon-policy',
] as const;
export type GuidanceOperatorAction = (typeof GUIDANCE_OPERATOR_ACTIONS)[number];

export const GUIDANCE_SIG_ALGS = ['hmac-sha256', 'ed25519'] as const;
export type GuidanceSigAlg = (typeof GUIDANCE_SIG_ALGS)[number];

export const SURFACE_GATEWAY_SURFACES = ['pd-console', 'fleetbar', 'scout', 'cli', 'mcp'] as const;
export type SurfaceGatewaySurface = (typeof SURFACE_GATEWAY_SURFACES)[number];

export const SURFACE_GATEWAY_DIRECTIONS = ['surface-to-daemon', 'daemon-to-surface', 'surface-local'] as const;
export type SurfaceGatewayDirection = (typeof SURFACE_GATEWAY_DIRECTIONS)[number];

export const SURFACE_GATEWAY_MODES = ['command', 'query', 'event'] as const;
export type SurfaceGatewayMode = (typeof SURFACE_GATEWAY_MODES)[number];

export const SURFACE_GATEWAY_NOUNS = [
  'WorkIntent',
  'WorkPlan',
  'AgentNode',
  'AgentRun',
  'Body',
  'ControlCommand',
  'TranscriptEvent',
  'CapabilityDecision',
  'WorkReceipt',
  'BerthTarget',
] as const;
export type SurfaceGatewayNoun = (typeof SURFACE_GATEWAY_NOUNS)[number];

export const CAPABILITY_DECISIONS = ['allow', 'deny', 'degrade', 'unsupported', 'requires-approval'] as const;
export type CapabilityDecisionVerdict = (typeof CAPABILITY_DECISIONS)[number];

export const CAPABILITY_DECISION_DOMAINS = [
  'daemon-registry',
  'operator-selection',
  'policy',
  'lease',
  'read-only-import',
] as const;
export type CapabilityDecisionDomain = (typeof CAPABILITY_DECISION_DOMAINS)[number];

export const CAPABILITY_DECISION_SURFACES = [
  ...SURFACE_GATEWAY_SURFACES,
  'daemon',
  'operator',
] as const;
export type CapabilityDecisionSurface = (typeof CAPABILITY_DECISION_SURFACES)[number];

export const CAPABILITY_NAMES = [
  'work-intent',
  'work-plan',
  'agent-node',
  'agent-run',
  'body',
  'control-command',
  'transcript-event',
  'capability-decision',
  'work-receipt',
  'berth-target',
  'surface-gateway',
] as const;
export type CapabilityName = (typeof CAPABILITY_NAMES)[number];

export const BERTH_TARGET_TIERS = ['stable', 'dev-latest', 'codebase', 'remote'] as const;
export type BerthTargetTier = (typeof BERTH_TARGET_TIERS)[number];

export const BERTH_AUTHORITY_DOMAINS = [
  'canonical-local',
  'dev-lane',
  'worktree-lane',
  'remote-harbor',
  'read-only-import',
] as const;
export type BerthAuthorityDomain = (typeof BERTH_AUTHORITY_DOMAINS)[number];

export const BERTH_AUTHORITY_GRANTS = [
  'daemon-registry',
  'operator-selection',
  'policy',
  'lease',
  'read-only-import',
] as const;
export type BerthAuthorityGrant = (typeof BERTH_AUTHORITY_GRANTS)[number];

export const BERTH_RESOLUTION_STATES = ['resolved', 'unresolved', 'stale'] as const;
export type BerthResolutionState = (typeof BERTH_RESOLUTION_STATES)[number];

export const BERTH_RESOLUTION_SOURCES = [
  'daemon-registry',
  'operator-selection',
  'surface-default',
  'explicit-url',
  'import',
] as const;
export type BerthResolutionSource = (typeof BERTH_RESOLUTION_SOURCES)[number];

export const COST_PHASES = ['start', 'stream', 'abort', 'failure', 'finalization'] as const;
export type CostPhase = (typeof COST_PHASES)[number];

export const COST_METERS = ['tokens', 'seconds', 'storage', 'relay', 'custom'] as const;
export type CostMeter = (typeof COST_METERS)[number];

// ---------------------------------------------------------------------------
// Contract object shapes (subset views; schemas allow additional properties)
// ---------------------------------------------------------------------------

export interface ComplianceCheck {
  name: string;
  passed: boolean;
  /** False means self-report; self-reported checks cannot advance a level past C0. */
  daemonWitnessed: boolean;
  level?: ComplianceLevel | null;
  details?: string;
  [key: string]: unknown;
}

export interface NegativeProbeRecord {
  kind: NegativeProbeKind;
  targetLevel?: ComplianceLevel | null;
  /** A real, daemon-exercised fixture — not stubbed or planned. */
  present: boolean;
  /** True when the attack penetrated (the forge/bypass succeeded at the adapter boundary). */
  fired?: boolean;
  /** Required true whenever a fired forge would otherwise succeed. Never assumed. */
  downgraded?: boolean;
  observedLevel?: ComplianceLevel | null;
  details?: string;
  [key: string]: unknown;
}

export interface RemediationEntry {
  issue: string;
  action?: string;
  oneClick?: boolean;
  [key: string]: unknown;
}

export interface ComplianceProbeResult {
  schema: 'pd.agent-harbor.compliance-probe-result.v0';
  probeId: string;
  agentNodeId: string;
  bodyId?: string | null;
  adapterKind?: string;
  probedAt: string;
  complianceLevel: ComplianceLevel;
  witnessedLevel: ComplianceLevel;
  transcriptFidelity: TranscriptFidelity;
  checks: ComplianceCheck[];
  negativeProbes: NegativeProbeRecord[];
  failedChecks?: string[];
  remediation?: RemediationEntry[];
  downgrade?: {
    from?: ComplianceLevel | null;
    to?: ComplianceLevel | null;
    mode?: OfficialMode | null;
    reason?: string;
  };
  privacyImplications?: string[];
  [key: string]: unknown;
}

export interface AgentNodeView {
  schema?: 'pd.agent-harbor.agent-node.v0';
  agentNodeId: string;
  identity?: string;
  class?: 'voyager' | 'longshoreman' | 'human' | 'service';
  authority: 'local' | 'team' | 'hosted' | 'remote-worker' | 'observed';
  complianceLevel: ComplianceLevel;
  complianceProbeId?: string | null;
  transcriptFidelity?: TranscriptFidelity;
  officialMode?: OfficialMode;
  status?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export interface Body {
  schema: 'pd.agent-harbor.body.v0';
  bodyId: string;
  agentNodeId: string;
  runId?: string | null;
  kind: BodyKind;
  provider: string;
  modelTier: ModelTier;
  modelName?: string | null;
  launchMode: LaunchMode;
  adapterVersion?: string | null;
  pid?: number | null;
  remoteEndpoint?: string | null;
  status: 'planned' | 'attaching' | 'attached' | 'running' | 'paused' | 'stopped' | 'failed' | 'orphaned' | 'observed';
  attachedAt?: string | null;
  detachedAt?: string | null;
  transcriptId?: string | null;
  authorityRef?: string | null;
  [key: string]: unknown;
}

export interface ControlCommand {
  schema: 'pd.agent-harbor.control-command.v0';
  commandId: string;
  agentNodeId: string;
  sessionId?: string | null;
  runId?: string | null;
  kind: ControlKind;
  payload?: Record<string, unknown>;
  requestedBy: string;
  status: ControlStatus;
  denialReason?: string | null;
  idempotencyKey?: string;
  createdAt: string;
  deliveredAt?: string | null;
  acknowledgedAt?: string | null;
  expiresAt?: string | null;
  [key: string]: unknown;
}

export interface CapabilityDecisionAuthority {
  domain: CapabilityDecisionDomain;
  decidedBy: string;
  leaseId?: string | null;
  [key: string]: unknown;
}

export interface CapabilityDecisionEvidence {
  probeId?: string | null;
  controlCommandId?: string | null;
  berthTargetId?: string | null;
  transcriptEventId?: string | null;
  [key: string]: unknown;
}

export interface CapabilityDecision {
  schema: 'pd.agent-harbor.capability-decision.v0';
  decisionId: string;
  agentNodeId?: string | null;
  runId?: string | null;
  bodyId?: string | null;
  surface: CapabilityDecisionSurface;
  operation: string;
  capability: CapabilityName;
  decision: CapabilityDecisionVerdict;
  authority: CapabilityDecisionAuthority;
  reason: string;
  evidence?: CapabilityDecisionEvidence;
  issuedAt: string;
  expiresAt?: string | null;
  [key: string]: unknown;
}

export interface BerthTargetAuthority {
  domain: BerthAuthorityDomain;
  grantedBy: BerthAuthorityGrant;
  canCommand: boolean;
  canQuery: boolean;
  canSubscribeEvents: boolean;
  reason?: string;
  [key: string]: unknown;
}

export interface BerthTargetResolution {
  state: BerthResolutionState;
  source: BerthResolutionSource;
  resolvedAt?: string | null;
  staleReason?: string | null;
  [key: string]: unknown;
}

export interface BerthTarget {
  schema: 'pd.agent-harbor.berth-target.v0';
  targetId: string;
  tier: BerthTargetTier;
  label: string;
  url?: string | null;
  port?: number | null;
  sourceDir?: string | null;
  gitBranch?: string | null;
  gitRev?: string | null;
  canonical: boolean;
  resolution: BerthTargetResolution;
  authority: BerthTargetAuthority;
  createdAt: string;
  [key: string]: unknown;
}

export interface SurfaceGatewayProjection {
  stale: boolean;
  lastLedgerSeq?: number | null;
  headSeq?: number | null;
  [key: string]: unknown;
}

export interface SurfaceGatewayBerthAuthoritySummary {
  domain: BerthAuthorityDomain;
  canCommand: boolean;
  canQuery: boolean;
  canSubscribeEvents: boolean;
  [key: string]: unknown;
}

export interface SurfaceGatewayBerthTargetSummary {
  targetId: string;
  tier: BerthTargetTier;
  label: string;
  canonical: boolean;
  authority: SurfaceGatewayBerthAuthoritySummary;
  [key: string]: unknown;
}

export interface SurfaceGatewayEnvelope {
  schema: 'pd.agent-harbor.surface-gateway.v0';
  envelopeId: string;
  correlationId?: string | null;
  surface: SurfaceGatewaySurface;
  direction: SurfaceGatewayDirection;
  mode: SurfaceGatewayMode;
  noun: SurfaceGatewayNoun;
  operation: string;
  issuedBy: string;
  issuedAt: string;
  idempotencyKey?: string | null;
  berthTarget: SurfaceGatewayBerthTargetSummary;
  capabilityDecision?: CapabilityDecision;
  payload: Record<string, unknown>;
  projection: SurfaceGatewayProjection;
  [key: string]: unknown;
}

export interface CostAccrualEvent {
  schema: 'pd.agent-harbor.cost-accrual-event.v0';
  costEventId: string;
  agentNodeId: string;
  sessionId?: string | null;
  runId?: string | null;
  provider?: string;
  modelTier?: ModelTier | null;
  modelName?: string | null;
  meter: CostMeter;
  phase: CostPhase;
  quantity: number;
  unit?: string;
  estimatedCostUsd?: number | null;
  actualCostUsd?: number | null;
  budgetId?: string | null;
  budgetAction?: 'none' | 'warning' | 'pause' | 'kill' | null;
  idempotencyKey?: string;
  occurredAt: string;
  [key: string]: unknown;
}

export interface GuidanceItem {
  /** Open string for tolerant reading; see KNOWN_GUIDANCE_KINDS. */
  kind: string;
  ref: string;
  priority?: string;
  severity?: string;
  skills?: string[];
  [key: string]: unknown;
}

export interface GuidanceAuthority {
  mode: GuidanceAuthorityMode;
  /** The attenuated macaroon id, when mode=macaroon (ADR-0053 lineage). */
  authorityRef?: string | null;
  operatorAction?: GuidanceOperatorAction | null;
  [key: string]: unknown;
}

export interface GuidanceSig {
  alg: GuidanceSigAlg;
  /** The launch-provisioned session key id (loopback, C2 nonce challenge). */
  keyId: string;
  /** base64 signature over canonical(sessionId, agentNodeId, turnSequence, envelopeContentHash, notAfter, nonce). */
  value: string;
  [key: string]: unknown;
}

/** The signed turn-start guidance channel (guidance-envelope.schema.json, ADR-0096). */
export interface GuidanceEnvelope {
  schema: 'pd.agent-harbor.guidance-envelope.v0';
  envelopeId: string;
  agentNodeId: string;
  sessionId: string;
  turnSequence: number;
  issuedAt: string;
  notAfter: string;
  nonce: string;
  items: GuidanceItem[];
  authority: GuidanceAuthority;
  sig: GuidanceSig;
  [key: string]: unknown;
}

/** Order of a ladder level; -1 for unknown/null. Mirrors compliance-invariants.mjs. */
export function complianceOrder(level: string | null | undefined): number {
  return COMPLIANCE_LADDER.indexOf((level ?? '') as ComplianceLevel);
}

export function fidelityOrder(level: string | null | undefined): number {
  return TRANSCRIPT_FIDELITY_LADDER.indexOf((level ?? '') as TranscriptFidelity);
}
