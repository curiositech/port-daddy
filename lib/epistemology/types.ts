/**
 * Project Epistemology: Core Type Definitions
 * 
 * Implements versioned Claim Envelopes, Contradiction Ladder representations,
 * and Parley Packets for cross-project multi-agent collaboration.
 */

export type EpistemicKind = 'fact' | 'hypothesis' | 'preference' | 'decision' | 'obligation';

export type AuthorityStatus = 'draft' | 'proposed' | 'principal_approved' | 'revoked';

export type WitnessClass = 'witnessed' | 'reported' | 'derived' | 'inferred' | 'porthole_capture';

export type DisclosurePolicy = 'public' | 'harbor_internal' | 'private_owner_only';

export type PropositionType =
  | 'type_constraint'
  | 'state_invariant'
  | 'contract_behavior'
  | 'resource_bound'
  | 'freeform';

export interface EvidenceReceipt {
  witnessClass: WitnessClass;
  digest: string;
  uri: string;
  portholeSessionId?: string;
  portholeTimestampMs?: number;
  witnessIdentity?: string;
}

export interface ClaimScope {
  repository: string;
  branch?: string;
  commitSha?: string;
  paths: string[];
}

export interface ClaimIssuer {
  principalId: string;
  agentId: string;
  agentGeneration?: number;
  model?: string;
  harness?: string;
}

export interface ClaimConfidence {
  score: number; // 0.0 - 1.0
  sampleCount?: number;
  calibrationTier?: string;
}

export interface StructuredProposition {
  type: PropositionType;
  property?: string;
  value?: unknown;
  nullable?: boolean;
  expression?: string;
  parameters?: Record<string, unknown>;
}

export interface ClaimEnvelope<T = StructuredProposition> {
  schema: 'pd.epistemology.claim-envelope.v0';
  claimId: string;
  kind: EpistemicKind;
  subject: string;
  proposition: T;
  scope: ClaimScope;
  assumptions: string[];
  evidence: EvidenceReceipt[];
  issuer: ClaimIssuer;
  observationTime: string;
  ttlSeconds?: number;
  confidence?: ClaimConfidence;
  authority: AuthorityStatus;
  dependencies?: string[];
  supersedes?: string | null;
  disclosurePolicy?: DisclosurePolicy;
}

export type LadderLevel = 0 | 1 | 2 | 3 | 4;

export interface IncompatiblePropositionSummary {
  claimId: string;
  subject: string;
  summary: string;
  sourceRepository: string;
  assumptions?: string[];
}

export interface ConsequenceOption {
  option: string;
  favorsClaimId?: string | null;
  impact: string;
  affectedWork: string[];
}

export interface QuiescentStateInstructions {
  pausedTaskIds: string[];
  safeIndependentTaskIds: string[];
  timeoutSeconds?: number;
}

export interface ParleyPacketResolution {
  status: 'pending' | 'resolved' | 'rejected';
  chosenOption?: string;
  approvedBy?: string;
  resolutionTimestamp?: string;
  newDecisionClaimId?: string;
}

export interface ParleyPacket {
  schema: 'pd.epistemology.parley-packet.v0';
  packetId: string;
  incidentId: string;
  ladderLevel: LadderLevel;
  conflictingClaimIds: string[];
  incompatiblePropositions: IncompatiblePropositionSummary[];
  unsatisfiableCore: string[];
  consequenceMatrix: ConsequenceOption[];
  authorizedDecisionMakers: string[];
  quiescentState: QuiescentStateInstructions;
  resolution?: ParleyPacketResolution;
}

export interface VerificationRejection {
  claimId: string;
  reason: string;
  ladderLevel: LadderLevel;
}

export interface MergeVerificationResult {
  success: boolean;
  ladderLevelTrapped?: LadderLevel;
  admittedClaims: ClaimEnvelope[];
  rejectedClaims: VerificationRejection[];
  parleyPacket?: ParleyPacket;
}
