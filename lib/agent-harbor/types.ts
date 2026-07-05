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
] as const;
export type AdapterKind = (typeof ADAPTER_KINDS)[number];

/** Model-tier policy per agent-run.schema.json body.modelTier (ch18 C2 work order). */
export const MODEL_TIERS = ['fast', 'mid', 'strong', 'local', 'custom'] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

export const LAUNCH_MODES = ['native', 'hooked', 'proxy', 'observed', 'unmanaged'] as const;
export type LaunchMode = (typeof LAUNCH_MODES)[number];

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

/** The five required negative probe kinds (compliance-probe-result.schema.json). */
export const NEGATIVE_PROBE_KINDS = [
  'forged-level',
  'direct-mcp-bypass',
  'disabled-hook-after-launch',
  'forged-heartbeat',
  'observed-to-controlled',
] as const;
export type NegativeProbeKind = (typeof NEGATIVE_PROBE_KINDS)[number];

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

/** Order of a ladder level; -1 for unknown/null. Mirrors compliance-invariants.mjs. */
export function complianceOrder(level: string | null | undefined): number {
  return COMPLIANCE_LADDER.indexOf((level ?? '') as ComplianceLevel);
}

export function fidelityOrder(level: string | null | undefined): number {
  return TRANSCRIPT_FIDELITY_LADDER.indexOf((level ?? '') as TranscriptFidelity);
}
