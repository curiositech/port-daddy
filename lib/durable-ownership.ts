/**
 * Canonical durable ownership and delayed-takeover authority.
 *
 * AgentNode is the durable work owner. Actor souls authenticate the concrete
 * body asking the daemon to act; display aliases and session agent_id values do
 * not become ownership. The roadmap assignee remains the current-owner read
 * projection. This module adds the append-only history and the exact one-shot
 * transition that projection previously lacked.
 *
 * Porthole/Grand Harbor boundary: the signed receipts emitted here are causal
 * evidence that Porthole may replay. Porthole presence, recordings, and CRDT
 * state never authorize a takeover.
 */

import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readlinkSync,
  readSync,
  realpathSync,
  type BigIntStats,
} from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { DatabaseInstance } from './sqlite-runtime.js';
import {
  buildHandoffSuccessorBrief,
  HANDOFF_SUCCESSOR_BRIEF_SCHEMA,
  sanitizeHandoffCapsule,
  type GitleaksRunner,
  type HandoffCapsuleV0,
  type HandoffSuccessorBriefV0,
} from './handoff-capsule.js';
import { createClaimForest } from './claim-forest.js';
import { getWorktreeInfo, listWorktrees } from './worktree.js';

export const OWNERSHIP_EPOCH_SCHEMA = 'pd.agent-harbor.durable-ownership-epoch.v0' as const;
export const TAKEOVER_GRANT_SCHEMA = 'pd.agent-harbor.durable-takeover-grant.v0' as const;
export const TAKEOVER_RECEIPT_SCHEMA = 'pd.agent-harbor.durable-takeover-receipt.v0' as const;
export const SUCCESSOR_BRIEF_SCHEMA = 'pd.agent-harbor.ownership-successor-brief.v0' as const;
export const ANCHOR_REPAIR_SCHEMA = 'pd.agent-harbor.durable-anchor-repair.v0' as const;

const DEFAULT_TTL_MS = 5 * 60_000;
const MIN_TTL_MS = 10_000;
const MAX_TTL_MS = 15 * 60_000;
const DEFAULT_STALE_AFTER_MS = 24 * 60 * 60_000;
const MAX_BRIEF_BYTES = 256 * 1024;
const HASH_RE = /^sha256:[a-f0-9]{64}$/;
const COMMIT_RE = /^[0-9a-f]{40,64}$/i;

export type OwnershipCause = 'assignment' | 'voluntary-handoff' | 'operator-takeover';
export type OwnershipState = 'current' | 'stale' | 'abandoned' | 'transferred';
export type TakeoverAuthorityKind = 'current-owner' | 'operator';
export type TakeoverGrantState = 'active' | 'consumed' | 'expired';
export type TakeoverReceiptKind = 'issued' | 'rejected' | 'expired' | 'consumed';

export interface DurableReceiptSigner {
  /** Public daemon signing-key identifier. */
  keyId: string;
  /** Sign the raw bytes represented by a lowercase SHA-256 hex digest. */
  signDigest(digestHex: string): Promise<string>;
  /** Verify against the daemon's pinned public key; never a key from storage. */
  verifyDigest(digestHex: string, signature: string): boolean;
}

export interface SignedFact {
  contentHash: string;
  signature: {
    algorithm: 'ed25519';
    keyId: string;
    value: string;
  };
}

export interface ExactWorkBinding {
  repoId: string;
  worktreeId: string;
  worktreeRoot: string;
  /** Canonical filesystem identity, distinct from the historical path hash. */
  worktreeRealpath: string;
  worktreePhysicalId: string;
  gitDirRealpath: string;
  gitDirPhysicalId: string;
  repoCommonDir: string;
  branch: string;
  remote: string;
  head: string;
  base: string;
  dirtyTreeHash: string;
  dirtyPaths: string[];
  prUrls: string[];
}

export type CanonicalGitWorkspaceIdentity = Pick<
  ExactWorkBinding,
  | 'repoId'
  | 'worktreeId'
  | 'worktreeRoot'
  | 'worktreeRealpath'
  | 'worktreePhysicalId'
  | 'gitDirRealpath'
  | 'gitDirPhysicalId'
  | 'repoCommonDir'
  | 'branch'
  | 'remote'
  | 'head'
  | 'base'
>;

export interface ExactClaimBinding {
  claimNodeId: string;
  filePath: string;
  selectorKind: 'file' | 'symbol' | 'range' | 'directory' | 'repo';
  startLine: number | null;
  endLine: number | null;
  symbol: string | null;
  symbolPath: string | null;
  worldKind: 'worktree' | 'ref' | 'commit' | 'harbor';
  worldId: string;
  claimedAt: number;
  mode: 'S' | 'X' | 'IS' | 'IX' | 'SIX';
  contentHash: string | null;
  /** retain is used only by an ownership snapshot; grants require transfer or release. */
  disposition: 'retain' | 'transfer' | 'release';
}

/** An explicit new node, never an in-place rewrite of a historical world. */
export interface AnchorRepairClaimMapping {
  sourceClaimNodeId: string;
  successorClaimNodeId: string | null;
}

/**
 * A restricted lease transfer carried by the EXISTING signed takeover grant.
 * The source anchor is recorded history; only the enclosing grant's freshly
 * probed workBinding describes the physical destination. Neither stale
 * metadata nor this unsigned shape confers authority on its own.
 */
export interface SameOwnerAnchorRepair {
  schema: typeof ANCHOR_REPAIR_SCHEMA;
  idempotencyKey: string;
  requestHash: string;
  sourceWorktreeId: string;
  sourceWorktreeRoot: string;
  sourceLineageHash: string;
  targetWorktreeId: string;
  claimNodeMappings: AnchorRepairClaimMapping[];
}

export interface EvidenceCitation {
  source: 'porthole' | 'logbook' | 'roadmap' | 'receipt' | 'artifact';
  ref: string;
  label: string;
  contentHash: string | null;
}

export interface DigestEntry {
  id: string;
  at: number | null;
  text: string;
  sourceRef: string | null;
}

export interface OwnershipSuccessorBrief {
  schema: typeof SUCCESSOR_BRIEF_SCHEMA;
  briefingId: string;
  generatedAt: number;
  predecessorAgentNodeId: string;
  successorAgentNodeId: string;
  sourceSessionId: string;
  successorSessionId: string;
  roadmap: {
    itemId: string;
    slug: string;
    status: string;
    summary: string;
    remit: string;
  };
  exactWork: ExactWorkBinding;
  /** Existing sanitized Agent Harbor handoff projection; historical context only. */
  handoff: HandoffSuccessorBriefV0;
  plans: DigestEntry[];
  roadmapNotes: DigestEntry[];
  unresolvedQuestions: DigestEntry[];
  evidence: EvidenceCitation[];
  claims: ExactClaimBinding[];
  knownGaps: string[];
  omittedSources: string[];
  hiddenReasoningAvailable: false;
  contentHash: string;
}

export interface SessionOwnershipWitness {
  sessionId: string;
  agentNodeId: string | null;
  actorId: string | null;
  identityVerified: boolean;
  worktreeId: string | null;
  metadataWorktreeId: string | null;
  status: string;
  durable: boolean;
  lineageHash: string | null;
}

export interface SuccessorSessionWitness extends SessionOwnershipWitness {
  agentNodeId: string;
  actorId: string;
  identityVerified: true;
  status: 'active';
  durable: true;
}

/**
 * Signed evidence about gaps in a predecessor session created before durable
 * AgentNode/session binding existed. This never grants authority: only an
 * authenticated operator's exact one-shot takeover grant can do that.
 */
export interface PredecessorEvidenceGap {
  sourceSessionId: string;
  observedActorId: string | null;
  lineageHash: string;
  recordedByActorId: string;
  knownGaps: string[];
}

export interface OwnershipEpoch extends SignedFact {
  schema: typeof OWNERSHIP_EPOCH_SCHEMA;
  epochId: string;
  roadmapItemId: string;
  roadmapSlug: string;
  harbor: string;
  epochNumber: number;
  ownerAgentNodeId: string;
  priorEpochId: string | null;
  priorOwnerAgentNodeId: string | null;
  cause: OwnershipCause;
  sourceSessionId: string | null;
  successorSessionId: string | null;
  takeoverGrantId: string | null;
  workBinding: ExactWorkBinding;
  claimBindings: ExactClaimBinding[];
  claimSetHash: string;
  briefingHash: string | null;
  reason: string;
  authoredByAgentNodeId: string;
  authorizedActorId: string;
  createdAt: number;
}

export interface DurableTakeoverGrant extends SignedFact {
  schema: typeof TAKEOVER_GRANT_SCHEMA;
  grantId: string;
  roadmapItemId: string;
  roadmapSlug: string;
  harbor: string;
  predecessorEpochId: string;
  predecessorAgentNodeId: string;
  successorAgentNodeId: string;
  issuerAgentNodeId: string | null;
  /** Verified actor that authorized issuance (current owner or operator). */
  authorizedActorId: string;
  /** Verified actor stamped on the exact successor session; sole acceptor. */
  successorActorId: string;
  authorityKind: TakeoverAuthorityKind;
  /** Recent, action-bound proof for delayed operator takeover; null for voluntary handoff. */
  operatorPresenceReceipt: OperatorPresenceReceipt | null;
  reason: string;
  sourceSessionId: string;
  successorSessionId: string;
  sourceWitnessCanonical: boolean;
  sourceWitness: SessionOwnershipWitness;
  successorWitness: SuccessorSessionWitness;
  predecessorEvidenceGap: PredecessorEvidenceGap | null;
  workBinding: ExactWorkBinding;
  claimBindings: ExactClaimBinding[];
  claimSetHash: string;
  briefing: OwnershipSuccessorBrief;
  briefingHash: string;
  nonceHash: string;
  issuedAt: number;
  expiresAt: number;
  /** Absent on historical/generic grants so their signed bytes stay unchanged. */
  anchorRepair?: SameOwnerAnchorRepair;
}

/**
 * Grant lifecycle is a projection over immutable signed receipts. Lifecycle
 * fields deliberately do not live in DurableTakeoverGrant: changing them
 * would make a previously signed fact lie about the bytes that were signed.
 */
export interface DurableTakeoverGrantView {
  grant: DurableTakeoverGrant;
  state: TakeoverGrantState;
  consumedAt: number | null;
  consumedEpochId: string | null;
  receipts: DurableTakeoverReceipt[];
}

export interface DurableTakeoverReceipt extends SignedFact {
  schema: typeof TAKEOVER_RECEIPT_SCHEMA;
  receiptId: string;
  grantId: string;
  kind: TakeoverReceiptKind;
  at: number;
  details: Record<string, unknown>;
}

export interface TakeoverDisposition {
  successorSessionId: string;
  transferredClaimNodeIds: string[];
  releasedClaimNodeIds: string[];
  preservedClaimNodeIds: string[];
  /** Source ids above remain historical; these mappings identify new nodes. */
  claimNodeMappings?: AnchorRepairClaimMapping[];
}

export interface OwnershipProjection {
  roadmapItemId: string;
  roadmapSlug: string;
  currentOwner: string | null;
  currentEpoch: OwnershipEpoch | null;
  currentState: OwnershipState | null;
  priorOwners: Array<{ agentNodeId: string; epochId: string; epochNumber: number }>;
  epochs: OwnershipEpoch[];
  activeGrantId: string | null;
}

export type DurableOwnershipFailureCode =
  | 'VALIDATION_ERROR'
  | 'ROADMAP_ITEM_NOT_FOUND'
  | 'OWNER_MISMATCH'
  | 'AGENT_NODE_NOT_FOUND'
  | 'EPOCH_NOT_FOUND'
  | 'EPOCH_CONFLICT'
  | 'AUTHORITY_REQUIRED'
  | 'OPERATOR_PRESENCE_REQUIRED'
  | 'GRANT_NOT_FOUND'
  | 'GRANT_CONFLICT'
  | 'GRANT_ALREADY_CONSUMED'
  | 'GRANT_EXPIRED'
  | 'GRANT_BINDING_MISMATCH'
  | 'SESSION_IDENTITY_UNVERIFIED'
  | 'SESSION_AGENT_NODE_MISMATCH'
  | 'SUCCESSOR_ADMISSION_REQUIRED'
  | 'SUCCESSOR_ADMISSION_INVALID'
  | 'SESSION_WORKTREE_SPLIT'
  | 'PREDECESSOR_NOT_STALE'
  | 'PREDECESSOR_EVIDENCE_GAP_REQUIRED'
  | 'CLAIM_SET_MISMATCH'
  | 'BRIEFING_INVALID'
  | 'SIGNER_UNAVAILABLE'
  | 'SIGNED_FACT_INVALID'
  | 'ENACTMENT_REJECTED'
  | 'STORE_UNAVAILABLE';

export class DurableOwnershipError extends Error {
  constructor(
    message: string,
    readonly code: DurableOwnershipFailureCode,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'DurableOwnershipError';
  }
}

interface RoadmapRow {
  id: string;
  slug: string;
  harbor: string;
  assignee_id: string | null;
  summary_md: string;
  description_md: string | null;
  notes_json: string;
  status: string;
}

interface EpochRow {
  epoch_id: string;
  roadmap_item_id: string;
  roadmap_slug: string;
  harbor: string;
  epoch_number: number;
  owner_agent_node_id: string;
  prior_epoch_id: string | null;
  prior_owner_agent_node_id: string | null;
  cause: OwnershipCause;
  source_session_id: string | null;
  successor_session_id: string | null;
  takeover_grant_id: string | null;
  work_binding_json: string;
  claim_bindings_json: string;
  claim_set_hash: string;
  briefing_hash: string | null;
  reason: string;
  authored_by_agent_node_id: string;
  authorized_actor_id: string;
  created_at: number;
  content_hash: string;
  signature_algorithm: 'ed25519';
  signature_key_id: string;
  signature_value: string;
}

interface GrantRow {
  grant_id: string;
  roadmap_item_id: string;
  roadmap_slug: string;
  harbor: string;
  predecessor_epoch_id: string;
  predecessor_agent_node_id: string;
  successor_agent_node_id: string;
  issuer_agent_node_id: string | null;
  authorized_actor_id: string;
  successor_actor_id: string;
  authority_kind: TakeoverAuthorityKind;
  operator_presence_receipt_json: string | null;
  reason: string;
  source_session_id: string;
  successor_session_id: string;
  source_witness_canonical: 0 | 1;
  source_witness_json: string;
  successor_witness_json: string;
  predecessor_evidence_gap_json: string | null;
  work_binding_json: string;
  claim_bindings_json: string;
  claim_set_hash: string;
  briefing_json: string;
  briefing_hash: string;
  nonce_hash: string;
  issued_at: number;
  expires_at: number;
  content_hash: string;
  signature_algorithm: 'ed25519';
  signature_key_id: string;
  signature_value: string;
  anchor_repair_json?: string | null;
}

interface ReceiptRow {
  receipt_id: string;
  grant_id: string;
  kind: TakeoverReceiptKind;
  at: number;
  details_json: string;
  content_hash: string;
  signature_algorithm: 'ed25519';
  signature_key_id: string;
  signature_value: string;
}

interface OwnershipEventRow {
  event_id: string;
  epoch_id: string;
  roadmap_item_id: string;
  kind: string;
  state: OwnershipState;
  authored_by_agent_node_id: string | null;
  authorized_actor_id: string;
  occurred_at: number;
  details_json: string;
  caused_by_event_id: string | null;
  content_hash: string;
  signature_algorithm: 'ed25519';
  signature_key_id: string;
  signature_value: string;
}

interface DurableOwnershipKernelDeps {
  signer: DurableReceiptSigner;
  agentNodeExists: (agentNodeId: string) => boolean;
  now?: () => number;
}

export interface VerifiedOwnershipActor {
  actorId: string;
  soulClass: 'newcomer' | 'graduated' | 'operator' | 'unknown';
}

export interface OperatorPresenceReceipt {
  receiptId: string;
  daemonGeneration: string;
  actorId: string;
  action: 'durable-ownership-takeover';
  harbor: string;
  roadmapSlug: string;
  predecessorEpochId: string;
  sourceSessionId: string;
  successorSessionId: string;
  successorActorId: string;
  claimSetHash: string;
  verifiedAt: number;
  expiresAt: number;
}

export interface OperatorPresenceIntent {
  actorId: string;
  harbor: string;
  roadmapSlug: string;
  predecessorEpochId: string;
  sourceSessionId: string;
  successorSessionId: string;
  successorActorId: string;
  claimSetHash: string;
}

export interface RequestedClaimDisposition {
  claimNodeId: string;
  disposition: 'transfer' | 'release';
}

export interface PrepareDurableTakeoverRequest {
  roadmapSlug: string;
  harbor: string;
  successorSessionId: string;
  reason: string;
  claimDispositions: RequestedClaimDisposition[];
  /** Opaque proof consumed only by the daemon's operator-presence verifier. */
  operatorPresenceProof?: string;
  ttlMs?: number;
}

export interface AcceptDurableTakeoverRequest {
  sourceSessionId: string;
  grantId: string;
  nonce: string;
}

/**
 * Same-owner consent is deliberately a different method, not a permissive
 * flag on generic takeover. Callers retain a fresh 32-byte base64url nonce so
 * ambiguous preparation can be read back with the same idempotency key.
 * Identity and physical work bindings are always daemon-derived.
 */
export interface PrepareSameOwnerAnchorRepairRequest {
  roadmapSlug: string;
  harbor: string;
  successorSessionId: string;
  reason: string;
  claimDispositions: RequestedClaimDisposition[];
  idempotencyKey: string;
  nonce: string;
  ttlMs?: number;
}

export interface BootstrapCanonicalOwnershipRequest {
  roadmapSlug: string;
  harbor: string;
  sourceSessionId: string;
  reason: string;
}

export interface DurableOwnershipServiceDeps extends DurableOwnershipKernelDeps {
  repoRoot: string;
  getAgentNode?: (agentNodeId: string) => {
    agentNodeId: string;
    identity?: string;
    profile?: {
      remit?: string;
      lifecycle?: 'ready' | 'paused' | 'retired';
      revision?: number;
      scope?: { key?: string; repoRoot?: string | null };
      origin?: {
        kind?: string;
        sourceSessionId?: string | null;
        sourceAgentId?: string | null;
        sourceAdapter?: string | null;
        handoffEpisodeId?: number | null;
      };
    };
    ledgerSeq?: number;
  } | null;
  /** Canonical note-store read; production supplies sessions.getNotes so encrypted notes are decrypted there. */
  readSessionNotes?: (sessionId: string) => Array<{
    id: number;
    content: string;
    type: string;
    createdAt: number;
  }>;
  /** Trusted daemon composition probe used by hermetic tests; never populated from request data. */
  workBindingProbe?: (sessionId: string) => ExactWorkBinding;
  staleAfterMs?: number;
  gitleaksRunner?: GitleaksRunner;
  /**
   * Generic recent-presence boundary. Verification consumes the proof before
   * grant issuance, so a failed issuance requires a new human step-up rather
   * than making an ambiguous proof replayable.
   */
  verifyAndConsumeOperatorPresence?: (
    proof: string,
    intent: OperatorPresenceIntent,
  ) => OperatorPresenceReceipt | null | Promise<OperatorPresenceReceipt | null>;
}

export interface BootstrapOwnershipInput {
  roadmapSlug: string;
  harbor: string;
  ownerAgentNodeId: string;
  authoredByAgentNodeId: string;
  authorizedActorId: string;
  sourceSessionId?: string | null;
  workBinding: ExactWorkBinding;
  claimBindings?: ExactClaimBinding[];
  reason: string;
}

export interface BuildSuccessorBriefInput {
  generatedAt?: number;
  predecessorAgentNodeId: string;
  successorAgentNodeId: string;
  sourceSessionId: string;
  successorSessionId: string;
  roadmap: OwnershipSuccessorBrief['roadmap'];
  exactWork: ExactWorkBinding;
  handoff: HandoffSuccessorBriefV0;
  plans?: DigestEntry[];
  roadmapNotes?: DigestEntry[];
  unresolvedQuestions?: DigestEntry[];
  evidence?: EvidenceCitation[];
  claims?: ExactClaimBinding[];
  knownGaps?: string[];
  omittedSources?: string[];
}

interface IssueTakeoverInput {
  roadmapSlug: string;
  harbor: string;
  predecessorEpochId: string;
  predecessorAgentNodeId: string;
  successorAgentNodeId: string;
  /** Trusted adapter-derived values; never deserialize these from a request body. */
  trustedIssuerAgentNodeId: string | null;
  trustedAuthorizedActorId: string;
  successorActorId: string;
  authorityKind: TakeoverAuthorityKind;
  operatorPresenceReceipt: OperatorPresenceReceipt | null;
  reason: string;
  sourceSessionId: string;
  successorSessionId: string;
  sourceWitness: SessionOwnershipWitness;
  successorWitness: SuccessorSessionWitness;
  predecessorEvidenceGap?: PredecessorEvidenceGap | null;
  workBinding: ExactWorkBinding;
  claimBindings: ExactClaimBinding[];
  briefing: OwnershipSuccessorBrief;
  ttlMs?: number;
  anchorRepair?: SameOwnerAnchorRepair;
  /** Only the restricted repair path accepts a caller-retained nonce. */
  nonce?: string;
}

interface ConsumeTakeoverInput {
  grantId: string;
  nonce: string;
  /** Verified transport actor; never deserialize from a request body. */
  trustedAuthorizedActorId: string;
  workBinding: ExactWorkBinding;
  claimBindings: ExactClaimBinding[];
  sourceWitness: SessionOwnershipWitness;
  successorWitness: SuccessorSessionWitness;
  /**
   * Runs inside the same SQLite IMMEDIATE transaction as grant consumption,
   * roadmap reassignment, epoch append, and receipt append. It must perform
   * only synchronous writes against this same DB handle and throw on any
   * mismatch. No network, filesystem, Porthole, or notification side effects.
   */
  enact: (at: number) => TakeoverDisposition;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Strict canonical JSON for authority hashes. Unsupported or ambiguous JSON
 * values are rejected so two distinct in-memory facts cannot collapse onto
 * the same signed bytes.
 */
export function canonicalOwnershipJson(value: unknown): string {
  const normalize = (input: unknown, path = '$'): unknown => {
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input;
    if (typeof input === 'number') {
      if (!Number.isFinite(input) || Object.is(input, -0)) {
        throw new DurableOwnershipError(`${path} contains a non-canonical number`, 'VALIDATION_ERROR', 400);
      }
      return input;
    }
    if (Array.isArray(input)) {
      return input.map((item, index) => {
        if (item === undefined) {
          throw new DurableOwnershipError(`${path}[${index}] is undefined`, 'VALIDATION_ERROR', 400);
        }
        return normalize(item, `${path}[${index}]`);
      });
    }
    if (!isPlainObject(input) || (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)) {
      throw new DurableOwnershipError(`${path} contains an unsupported value`, 'VALIDATION_ERROR', 400);
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
      const item = input[key];
      if (item === undefined) {
        throw new DurableOwnershipError(`${path}.${key} is undefined`, 'VALIDATION_ERROR', 400);
      }
      out[key] = normalize(item, `${path}.${key}`);
    }
    return out;
  };
  return JSON.stringify(normalize(value));
}

function sha256(value: string | Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function parseSignedJson<T>(value: string, field: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new DurableOwnershipError(`${field} contains malformed signed JSON`, 'SIGNED_FACT_INVALID', 503);
  }
}

function parseJsonOr<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function text(value: unknown, field: string, maxBytes = 4096): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new DurableOwnershipError(`${field} is required`, 'VALIDATION_ERROR', 400);
  }
  const normalized = value.trim();
  if (/\0|\r|\n/.test(normalized) || Buffer.byteLength(normalized, 'utf8') > maxBytes) {
    throw new DurableOwnershipError(`${field} is invalid`, 'VALIDATION_ERROR', 400);
  }
  return normalized;
}

function narrative(value: unknown, field: string, maxBytes = 32 * 1024): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new DurableOwnershipError(`${field} is required`, 'VALIDATION_ERROR', 400);
  }
  const normalized = value.trim();
  if (normalized.includes('\0') || Buffer.byteLength(normalized, 'utf8') > maxBytes) {
    throw new DurableOwnershipError(`${field} is invalid`, 'VALIDATION_ERROR', 400);
  }
  return normalized;
}

function validateOperatorPresenceReceipt(
  value: OperatorPresenceReceipt | null,
  intent: OperatorPresenceIntent,
  at: number,
): OperatorPresenceReceipt {
  if (!value || !isPlainObject(value)) {
    throw new DurableOwnershipError(
      'operator takeover requires a recent action-bound operator-presence receipt',
      'OPERATOR_PRESENCE_REQUIRED',
      403,
    );
  }
  const receipt: OperatorPresenceReceipt = {
    receiptId: text(value.receiptId, 'operatorPresenceReceipt.receiptId'),
    daemonGeneration: text(value.daemonGeneration, 'operatorPresenceReceipt.daemonGeneration'),
    actorId: text(value.actorId, 'operatorPresenceReceipt.actorId'),
    action: value.action === 'durable-ownership-takeover'
      ? value.action
      : (() => { throw new DurableOwnershipError('operator presence action is invalid', 'OPERATOR_PRESENCE_REQUIRED', 403); })(),
    harbor: text(value.harbor, 'operatorPresenceReceipt.harbor'),
    roadmapSlug: text(value.roadmapSlug, 'operatorPresenceReceipt.roadmapSlug'),
    predecessorEpochId: text(value.predecessorEpochId, 'operatorPresenceReceipt.predecessorEpochId'),
    sourceSessionId: text(value.sourceSessionId, 'operatorPresenceReceipt.sourceSessionId'),
    successorSessionId: text(value.successorSessionId, 'operatorPresenceReceipt.successorSessionId'),
    successorActorId: text(value.successorActorId, 'operatorPresenceReceipt.successorActorId'),
    claimSetHash: text(value.claimSetHash, 'operatorPresenceReceipt.claimSetHash'),
    verifiedAt: Number(value.verifiedAt),
    expiresAt: Number(value.expiresAt),
  };
  const expected = {
    actorId: intent.actorId,
    action: 'durable-ownership-takeover',
    harbor: intent.harbor,
    roadmapSlug: intent.roadmapSlug,
    predecessorEpochId: intent.predecessorEpochId,
    sourceSessionId: intent.sourceSessionId,
    successorSessionId: intent.successorSessionId,
    successorActorId: intent.successorActorId,
    claimSetHash: intent.claimSetHash,
  };
  const actual = {
    actorId: receipt.actorId,
    action: receipt.action,
    harbor: receipt.harbor,
    roadmapSlug: receipt.roadmapSlug,
    predecessorEpochId: receipt.predecessorEpochId,
    sourceSessionId: receipt.sourceSessionId,
    successorSessionId: receipt.successorSessionId,
    successorActorId: receipt.successorActorId,
    claimSetHash: receipt.claimSetHash,
  };
  if (canonicalOwnershipJson(actual) !== canonicalOwnershipJson(expected)) {
    throw new DurableOwnershipError('operator presence receipt scope does not match the takeover', 'OPERATOR_PRESENCE_REQUIRED', 403);
  }
  if (
    !Number.isSafeInteger(receipt.verifiedAt)
    || !Number.isSafeInteger(receipt.expiresAt)
    || receipt.verifiedAt > at + 5_000
    || receipt.expiresAt <= at
    || receipt.expiresAt <= receipt.verifiedAt
    || receipt.expiresAt - receipt.verifiedAt > 5 * 60_000
  ) {
    throw new DurableOwnershipError('operator presence receipt is stale or invalid', 'OPERATOR_PRESENCE_REQUIRED', 403);
  }
  return receipt;
}

function sortedUnique(values: string[], field: string): string[] {
  if (!Array.isArray(values)) {
    throw new DurableOwnershipError(`${field} must be an array`, 'VALIDATION_ERROR', 400);
  }
  return Array.from(new Set(values.map((value, index) => text(value, `${field}[${index}]`, 4096)))).sort();
}

export function normalizeExactWorkBinding(value: ExactWorkBinding): ExactWorkBinding {
  if (!isPlainObject(value)) {
    throw new DurableOwnershipError('workBinding is required', 'VALIDATION_ERROR', 400);
  }
  const head = text(value.head, 'workBinding.head', 128).toLowerCase();
  const base = text(value.base, 'workBinding.base', 128).toLowerCase();
  if (!COMMIT_RE.test(head) || !COMMIT_RE.test(base)) {
    throw new DurableOwnershipError('workBinding head/base must be exact commit ids', 'VALIDATION_ERROR', 400);
  }
  const dirtyTreeHash = text(value.dirtyTreeHash, 'workBinding.dirtyTreeHash', 80).toLowerCase();
  if (!HASH_RE.test(dirtyTreeHash)) {
    throw new DurableOwnershipError('workBinding.dirtyTreeHash must be sha256', 'VALIDATION_ERROR', 400);
  }
  return {
    repoId: text(value.repoId, 'workBinding.repoId'),
    worktreeId: text(value.worktreeId, 'workBinding.worktreeId'),
    worktreeRoot: text(value.worktreeRoot, 'workBinding.worktreeRoot', 16 * 1024),
    worktreeRealpath: text(value.worktreeRealpath, 'workBinding.worktreeRealpath', 16 * 1024),
    worktreePhysicalId: text(value.worktreePhysicalId, 'workBinding.worktreePhysicalId', 256),
    gitDirRealpath: text(value.gitDirRealpath, 'workBinding.gitDirRealpath', 16 * 1024),
    gitDirPhysicalId: text(value.gitDirPhysicalId, 'workBinding.gitDirPhysicalId', 256),
    repoCommonDir: text(value.repoCommonDir, 'workBinding.repoCommonDir', 16 * 1024),
    branch: text(value.branch, 'workBinding.branch'),
    remote: text(value.remote, 'workBinding.remote', 16 * 1024),
    head,
    base,
    dirtyTreeHash,
    dirtyPaths: sortedUnique(value.dirtyPaths ?? [], 'workBinding.dirtyPaths'),
    prUrls: sortedUnique(value.prUrls ?? [], 'workBinding.prUrls'),
  };
}

function normalizeClaim(binding: ExactClaimBinding): ExactClaimBinding {
  if (!isPlainObject(binding)) {
    throw new DurableOwnershipError('claim binding must be an object', 'VALIDATION_ERROR', 400);
  }
  const selectorKinds = new Set(['file', 'symbol', 'range', 'directory', 'repo']);
  const worldKinds = new Set(['worktree', 'ref', 'commit', 'harbor']);
  const modes = new Set(['S', 'X', 'IS', 'IX', 'SIX']);
  const dispositions = new Set(['retain', 'transfer', 'release']);
  if (!selectorKinds.has(binding.selectorKind)) {
    throw new DurableOwnershipError('claim selectorKind is invalid', 'VALIDATION_ERROR', 400);
  }
  if (!worldKinds.has(binding.worldKind)) {
    throw new DurableOwnershipError('claim worldKind is invalid', 'VALIDATION_ERROR', 400);
  }
  if (!modes.has(binding.mode)) {
    throw new DurableOwnershipError('claim mode is invalid', 'VALIDATION_ERROR', 400);
  }
  if (!dispositions.has(binding.disposition)) {
    throw new DurableOwnershipError('claim disposition is invalid', 'VALIDATION_ERROR', 400);
  }
  const claimNodeId = text(binding.claimNodeId, 'claimNodeId');
  const filePath = binding.selectorKind === 'repo'
    ? (typeof binding.filePath === 'string' ? binding.filePath.trim() : '')
    : text(binding.filePath, 'filePath', 16 * 1024);
  const contentHash = binding.contentHash == null ? null : text(binding.contentHash, 'contentHash', 80).toLowerCase();
  if (contentHash !== null && !HASH_RE.test(contentHash)) {
    throw new DurableOwnershipError('claim contentHash must be sha256', 'VALIDATION_ERROR', 400);
  }
  if (!Number.isInteger(binding.claimedAt) || binding.claimedAt < 0) {
    throw new DurableOwnershipError('claim claimedAt must be an epoch millisecond', 'VALIDATION_ERROR', 400);
  }
  const startLine = binding.startLine ?? null;
  const endLine = binding.endLine ?? null;
  if (
    (startLine !== null && (!Number.isInteger(startLine) || startLine < 1))
    || (endLine !== null && (!Number.isInteger(endLine) || endLine < 1))
    || (startLine !== null && endLine !== null && startLine > endLine)
  ) {
    throw new DurableOwnershipError('claim line range is invalid', 'VALIDATION_ERROR', 400);
  }
  if (binding.selectorKind === 'range' && (startLine === null || endLine === null)) {
    throw new DurableOwnershipError('range claims require startLine and endLine', 'VALIDATION_ERROR', 400);
  }
  if (binding.selectorKind === 'symbol' && !binding.symbol?.trim() && !binding.symbolPath?.trim()) {
    throw new DurableOwnershipError('symbol claims require symbol or symbolPath', 'VALIDATION_ERROR', 400);
  }
  return {
    claimNodeId,
    filePath,
    selectorKind: binding.selectorKind,
    startLine,
    endLine,
    symbol: binding.symbol?.trim() || null,
    symbolPath: binding.symbolPath?.trim() || null,
    worldKind: binding.worldKind,
    worldId: text(binding.worldId, 'claim worldId'),
    claimedAt: binding.claimedAt,
    mode: binding.mode,
    contentHash,
    disposition: binding.disposition,
  };
}

export function normalizeClaimBindings(bindings: ExactClaimBinding[]): ExactClaimBinding[] {
  if (!Array.isArray(bindings)) {
    throw new DurableOwnershipError('claimBindings must be an array', 'VALIDATION_ERROR', 400);
  }
  const normalized = bindings.map(normalizeClaim).sort((a, b) => (
    a.claimNodeId < b.claimNodeId ? -1 : a.claimNodeId > b.claimNodeId ? 1 : 0
  ));
  if (new Set(normalized.map((binding) => binding.claimNodeId)).size !== normalized.length) {
    throw new DurableOwnershipError('claimBindings contains duplicate claimNodeId values', 'VALIDATION_ERROR', 400);
  }
  return normalized;
}

export function exactClaimSetHash(bindings: ExactClaimBinding[]): string {
  return sha256(canonicalOwnershipJson(normalizeClaimBindings(bindings)));
}

function validateClaimWorktreeBinding(
  bindings: ExactClaimBinding[],
  workBinding: ExactWorkBinding,
): ExactClaimBinding[] {
  const drifted = bindings.filter(binding =>
    binding.worldKind === 'worktree' && binding.worldId !== workBinding.worktreeId,
  );
  if (drifted.length > 0) {
    throw new DurableOwnershipError(
      `worktree claims are not bound to exact worktree ${workBinding.worktreeId}: ${drifted.map(binding => binding.claimNodeId).join(', ')}`,
      'CLAIM_SET_MISMATCH',
      409,
    );
  }
  return bindings;
}

function validateTakeoverDispositions(bindings: ExactClaimBinding[]): ExactClaimBinding[] {
  const retained = bindings.filter(binding => binding.disposition === 'retain');
  if (retained.length > 0) {
    throw new DurableOwnershipError(
      `takeover grants require an explicit transfer or release disposition: ${retained.map(binding => binding.claimNodeId).join(', ')}`,
      'CLAIM_SET_MISMATCH',
      409,
    );
  }
  return bindings;
}

/**
 * Keep the repair exception out of generic claim/world validation. Its intent
 * is to sign the OLD claim addresses alongside a separately probed NEW world.
 * @param bindings Stored source claims, never caller-authored claim facts.
 * @param workBinding Verified destination workspace.
 * @param repair Restricted repair extension, absent for every ordinary handoff.
 * @returns Canonical claim snapshot or a fail-closed domain error.
 */
function validateGrantClaims(
  bindings: ExactClaimBinding[],
  workBinding: ExactWorkBinding,
  repair?: SameOwnerAnchorRepair,
): ExactClaimBinding[] {
  const claims = normalizeClaimBindings(bindings);
  if (!repair) return validateClaimWorktreeBinding(claims, workBinding);
  if (claims.some(claim => claim.worldKind !== 'worktree' || claim.worldId !== repair.sourceWorktreeId)) {
    throw new DurableOwnershipError('repair claims must name only the exact recorded source world', 'CLAIM_SET_MISMATCH', 409);
  }
  return claims;
}

/**
 * Validate signed repair semantics without trusting an actor alias or a path
 * hash as physical evidence. Its purpose is an additional restriction, not another
 * authority mode: both bodies must already belong to the SAME node and actor.
 * @param repair Proposed signed extension, including a complete node mapping.
 * @param grant Existing takeover facts to which the extension must be bound.
 * @returns Canonical extension suitable for signing and storage read-back.
 */
function normalizeAnchorRepair(
  repair: SameOwnerAnchorRepair,
  grant: Pick<DurableTakeoverGrant, 'predecessorAgentNodeId' | 'successorAgentNodeId'
    | 'issuerAgentNodeId' | 'authorizedActorId' | 'successorActorId' | 'authorityKind'
    | 'sourceWitness' | 'successorWitness' | 'workBinding' | 'claimBindings'>,
): SameOwnerAnchorRepair {
  if (!isPlainObject(repair) || repair.schema !== ANCHOR_REPAIR_SCHEMA) {
    throw new DurableOwnershipError('invalid anchor repair schema', 'VALIDATION_ERROR', 400);
  }
  const fields = new Set(['schema', 'idempotencyKey', 'requestHash', 'sourceWorktreeId',
    'sourceWorktreeRoot', 'sourceLineageHash', 'targetWorktreeId', 'claimNodeMappings']);
  if (Object.keys(repair).some(key => !fields.has(key))) {
    throw new DurableOwnershipError('unknown anchor repair field', 'VALIDATION_ERROR', 400);
  }
  const sourceWorktreeId = text(repair.sourceWorktreeId, 'anchorRepair.sourceWorktreeId');
  const targetWorktreeId = text(repair.targetWorktreeId, 'anchorRepair.targetWorktreeId');
  const sourceWorktreeRoot = text(repair.sourceWorktreeRoot, 'anchorRepair.sourceWorktreeRoot', 16 * 1024);
  if (
    grant.authorityKind !== 'current-owner'
    || grant.issuerAgentNodeId !== grant.predecessorAgentNodeId
    || grant.predecessorAgentNodeId !== grant.successorAgentNodeId
    || grant.authorizedActorId !== grant.successorActorId
    || grant.sourceWitness.actorId !== grant.authorizedActorId
    || grant.successorWitness.actorId !== grant.authorizedActorId
  ) {
    throw new DurableOwnershipError('repair requires exact same-AgentNode and same-actor consent', 'AUTHORITY_REQUIRED', 403);
  }
  if (
    sourceWorktreeId === targetWorktreeId
    || sourceWorktreeId !== grant.sourceWitness.worktreeId
    || sourceWorktreeId !== grant.sourceWitness.metadataWorktreeId
    || targetWorktreeId !== grant.workBinding.worktreeId
    || sourceWorktreeRoot !== grant.workBinding.worktreeRoot
    || !HASH_RE.test(repair.sourceLineageHash)
    || repair.sourceLineageHash !== grant.sourceWitness.lineageHash
  ) {
    throw new DurableOwnershipError('repair is not bound to the exact recorded anchor and physical destination', 'GRANT_BINDING_MISMATCH', 409);
  }
  const idempotencyKey = text(repair.idempotencyKey, 'anchorRepair.idempotencyKey', 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(idempotencyKey) || !HASH_RE.test(repair.requestHash)) {
    throw new DurableOwnershipError('repair idempotency binding is invalid', 'VALIDATION_ERROR', 400);
  }
  if (!Array.isArray(repair.claimNodeMappings) || repair.claimNodeMappings.length > 5000) {
    throw new DurableOwnershipError('repair claim mapping exceeds its bound', 'VALIDATION_ERROR', 400);
  }
  const claims = validateTakeoverDispositions(validateGrantClaims(grant.claimBindings, grant.workBinding, repair));
  const mappings = repair.claimNodeMappings.map(mapping => {
    if (!isPlainObject(mapping) || Object.keys(mapping).some(key => key !== 'sourceClaimNodeId' && key !== 'successorClaimNodeId')) {
      throw new DurableOwnershipError('invalid repair claim-node mapping', 'VALIDATION_ERROR', 400);
    }
    return {
      sourceClaimNodeId: text(mapping.sourceClaimNodeId, 'sourceClaimNodeId'),
      successorClaimNodeId: mapping.successorClaimNodeId === null
        ? null : text(mapping.successorClaimNodeId, 'successorClaimNodeId'),
    };
  }).sort((a, b) => a.sourceClaimNodeId.localeCompare(b.sourceClaimNodeId));
  const destinations = mappings.flatMap(mapping => mapping.successorClaimNodeId ? [mapping.successorClaimNodeId] : []);
  if (
    mappings.length !== claims.length
    || new Set(mappings.map(mapping => mapping.sourceClaimNodeId)).size !== mappings.length
    || new Set(destinations).size !== destinations.length
    || claims.some((claim, index) => mappings[index]?.sourceClaimNodeId !== claim.claimNodeId
      || (claim.disposition === 'release') !== (mappings[index]?.successorClaimNodeId === null)
      || mappings[index]?.successorClaimNodeId === claim.claimNodeId)
  ) {
    throw new DurableOwnershipError('repair must map every source claim exactly once to a new node or explicit release', 'CLAIM_SET_MISMATCH', 409);
  }
  return {
    schema: ANCHOR_REPAIR_SCHEMA, idempotencyKey, requestHash: repair.requestHash,
    sourceWorktreeId, sourceWorktreeRoot, sourceLineageHash: repair.sourceLineageHash,
    targetWorktreeId, claimNodeMappings: mappings,
  };
}

/**
 * Require a canonical 256-bit caller-retained nonce for recoverable preparation.
 * The purpose is safe idempotent read-back, not authentication; verified actor
 * identity and the daemon signature are still mandatory.
 * @param value Nonce generated once by the caller for this logical operation.
 * @returns Canonical nonce, without storing or logging its cleartext.
 */
function anchorRepairNonce(value: unknown): string {
  const nonce = text(value, 'nonce', 43);
  if (!/^[A-Za-z0-9_-]{43}$/.test(nonce) || Buffer.from(nonce, 'base64url').toString('base64url') !== nonce) {
    throw new DurableOwnershipError('repair nonce must encode exactly 32 bytes as base64url', 'VALIDATION_ERROR', 400);
  }
  return nonce;
}

/**
 * Derive the destination snapshot shared by signing and transaction read-back.
 * Its purpose is to prevent a receipt from asserting source addresses as live
 * successor claims, or reporting an insert that the database silently ignored.
 * @param grant Verified repair grant containing the immutable source mapping.
 * @param at Exact lease-transfer timestamp signed into the successor epoch.
 * @returns Canonical retained destination claims, excluding explicit releases.
 */
function anchorRepairSuccessorClaims(grant: DurableTakeoverGrant, at: number): ExactClaimBinding[] {
  if (!grant.anchorRepair) throw new DurableOwnershipError('repair mapping required', 'VALIDATION_ERROR', 400);
  const destinations = new Map(grant.anchorRepair.claimNodeMappings.map(mapping => [mapping.sourceClaimNodeId, mapping.successorClaimNodeId]));
  return normalizeClaimBindings(grant.claimBindings.filter(claim => claim.disposition === 'transfer').map(claim => ({
    ...claim, claimNodeId: destinations.get(claim.claimNodeId)!, worldId: grant.anchorRepair!.targetWorktreeId,
    claimedAt: at, disposition: 'retain' as const,
  })));
}

function normalizeDigestEntries(values: DigestEntry[] | undefined, field: string): DigestEntry[] {
  if (values === undefined) return [];
  if (!Array.isArray(values) || values.length > 200) {
    throw new DurableOwnershipError(`${field} must contain at most 200 entries`, 'BRIEFING_INVALID', 400);
  }
  return values.map((entry, index) => ({
    id: text(entry.id, `${field}[${index}].id`),
    at: entry.at == null ? null : Number(entry.at),
    text: narrative(entry.text, `${field}[${index}].text`, 16 * 1024),
    sourceRef: entry.sourceRef == null ? null : text(entry.sourceRef, `${field}[${index}].sourceRef`, 16 * 1024),
  }));
}

function normalizeHandoffBrief(value: HandoffSuccessorBriefV0): HandoffSuccessorBriefV0 {
  if (!isPlainObject(value) || value.schema !== HANDOFF_SUCCESSOR_BRIEF_SCHEMA) {
    throw new DurableOwnershipError(
      `handoff must use ${HANDOFF_SUCCESSOR_BRIEF_SCHEMA}`,
      'BRIEFING_INVALID',
      400,
    );
  }
  const rejectHiddenReasoningKeys = (input: unknown): void => {
    if (Array.isArray(input)) {
      input.forEach(rejectHiddenReasoningKeys);
      return;
    }
    if (!isPlainObject(input)) return;
    for (const [key, nested] of Object.entries(input)) {
      if (/^(reasoning|chainOfThought|hiddenReasoning|thinking)$/i.test(key)) {
        throw new DurableOwnershipError(
          'handoff brief must not claim or carry hidden reasoning',
          'BRIEFING_INVALID',
          400,
        );
      }
      rejectHiddenReasoningKeys(nested);
    }
  };
  rejectHiddenReasoningKeys(value);
  let normalized: HandoffSuccessorBriefV0;
  try {
    normalized = JSON.parse(canonicalOwnershipJson(value)) as HandoffSuccessorBriefV0;
  } catch {
    throw new DurableOwnershipError('handoff brief must be JSON serializable', 'BRIEFING_INVALID', 400);
  }
  if (
    !isPlainObject(normalized.lineage)
    || typeof normalized.lineage.sourceSessionId !== 'string'
    || typeof normalized.lineage.capsuleId !== 'string'
    || !/^[a-f0-9]{64}$/i.test(normalized.lineage.contentHash ?? '')
    || !isPlainObject(normalized.durableIdentity)
    || !isPlainObject(normalized.workspace)
  ) {
    throw new DurableOwnershipError('handoff brief lineage or workspace is invalid', 'BRIEFING_INVALID', 400);
  }
  return normalized;
}

/**
 * Build a compact, selectively digested briefing. It accepts durable summaries
 * and citations only; raw provider transcripts and hidden reasoning are not an
 * input surface.
 */
export function buildOwnershipSuccessorBrief(input: BuildSuccessorBriefInput): OwnershipSuccessorBrief {
  const generatedAt = input.generatedAt ?? Date.now();
  const briefingId = `obrief_${randomUUID()}`;
  const draft: Omit<OwnershipSuccessorBrief, 'contentHash'> = {
    schema: SUCCESSOR_BRIEF_SCHEMA,
    briefingId,
    generatedAt,
    predecessorAgentNodeId: text(input.predecessorAgentNodeId, 'predecessorAgentNodeId'),
    successorAgentNodeId: text(input.successorAgentNodeId, 'successorAgentNodeId'),
    sourceSessionId: text(input.sourceSessionId, 'sourceSessionId'),
    successorSessionId: text(input.successorSessionId, 'successorSessionId'),
    roadmap: {
      itemId: text(input.roadmap.itemId, 'roadmap.itemId'),
      slug: text(input.roadmap.slug, 'roadmap.slug'),
      status: text(input.roadmap.status, 'roadmap.status'),
      summary: narrative(input.roadmap.summary, 'roadmap.summary', 16 * 1024),
      remit: narrative(input.roadmap.remit, 'roadmap.remit', 32 * 1024),
    },
    exactWork: normalizeExactWorkBinding(input.exactWork),
    handoff: normalizeHandoffBrief(input.handoff),
    plans: normalizeDigestEntries(input.plans, 'plans'),
    roadmapNotes: normalizeDigestEntries(input.roadmapNotes, 'roadmapNotes'),
    unresolvedQuestions: normalizeDigestEntries(input.unresolvedQuestions, 'unresolvedQuestions'),
    evidence: (input.evidence ?? []).map((citation, index) => ({
      source: citation.source,
      ref: text(citation.ref, `evidence[${index}].ref`, 16 * 1024),
      label: narrative(citation.label, `evidence[${index}].label`, 4096),
      contentHash: citation.contentHash == null ? null : text(citation.contentHash, `evidence[${index}].contentHash`, 80),
    })),
    claims: normalizeClaimBindings(input.claims ?? []),
    knownGaps: sortedUnique(input.knownGaps ?? [], 'knownGaps'),
    omittedSources: sortedUnique(input.omittedSources ?? [], 'omittedSources'),
    hiddenReasoningAvailable: false,
  };
  const encoded = canonicalOwnershipJson(draft);
  if (Buffer.byteLength(encoded, 'utf8') > MAX_BRIEF_BYTES) {
    throw new DurableOwnershipError('successor briefing exceeds 256 KiB', 'BRIEFING_INVALID', 413);
  }
  return { ...draft, contentHash: sha256(encoded) };
}

function validateBriefing(
  briefing: OwnershipSuccessorBrief,
  predecessorAgentNodeId: string,
  successorAgentNodeId: string,
  sourceSessionId: string,
  successorSessionId: string,
  workBinding: ExactWorkBinding,
  claims: ExactClaimBinding[],
): OwnershipSuccessorBrief {
  if (!briefing || briefing.schema !== SUCCESSOR_BRIEF_SCHEMA || briefing.hiddenReasoningAvailable !== false) {
    throw new DurableOwnershipError('successor briefing schema is invalid', 'BRIEFING_INVALID', 400);
  }
  const expected = buildOwnershipSuccessorBrief({
    generatedAt: briefing.generatedAt,
    predecessorAgentNodeId: briefing.predecessorAgentNodeId,
    successorAgentNodeId: briefing.successorAgentNodeId,
    sourceSessionId: briefing.sourceSessionId,
    successorSessionId: briefing.successorSessionId,
    roadmap: briefing.roadmap,
    exactWork: briefing.exactWork,
    handoff: briefing.handoff,
    plans: briefing.plans,
    roadmapNotes: briefing.roadmapNotes,
    unresolvedQuestions: briefing.unresolvedQuestions,
    evidence: briefing.evidence,
    claims: briefing.claims,
    knownGaps: briefing.knownGaps,
    omittedSources: briefing.omittedSources,
  });
  // Keep the caller's stable briefingId while recomputing its canonical hash.
  const { contentHash: _expectedContentHash, ...expectedWithoutHash } = expected;
  const canonicalDraft = { ...expectedWithoutHash, briefingId: briefing.briefingId };
  const expectedHash = sha256(canonicalOwnershipJson(canonicalDraft));
  const mismatches = [
    briefing.predecessorAgentNodeId !== predecessorAgentNodeId ? 'predecessorAgentNodeId' : null,
    briefing.successorAgentNodeId !== successorAgentNodeId ? 'successorAgentNodeId' : null,
    briefing.sourceSessionId !== sourceSessionId ? 'sourceSessionId' : null,
    briefing.successorSessionId !== successorSessionId ? 'successorSessionId' : null,
    briefing.handoff.lineage.sourceSessionId !== sourceSessionId ? 'handoff.lineage.sourceSessionId' : null,
    briefing.handoff.durableIdentity.agentId !== successorAgentNodeId ? 'handoff.durableIdentity.agentId' : null,
    briefing.handoff.workspace.worktreeId !== workBinding.worktreeId ? 'handoff.workspace.worktreeId' : null,
    briefing.handoff.workspace.repoRoot !== workBinding.worktreeRoot ? 'handoff.workspace.repoRoot' : null,
    briefing.handoff.workspace.branch !== workBinding.branch ? 'handoff.workspace.branch' : null,
    briefing.handoff.workspace.gitHead?.toLowerCase() !== workBinding.head ? 'handoff.workspace.gitHead' : null,
    canonicalOwnershipJson(normalizeExactWorkBinding(briefing.exactWork)) !== canonicalOwnershipJson(workBinding) ? 'exactWork' : null,
    exactClaimSetHash(briefing.claims) !== exactClaimSetHash(claims) ? 'claims' : null,
    briefing.contentHash !== expectedHash ? 'contentHash' : null,
  ].filter(Boolean);
  if (mismatches.length > 0) {
    throw new DurableOwnershipError(`successor briefing mismatch: ${mismatches.join(', ')}`, 'BRIEFING_INVALID', 409);
  }
  return briefing;
}

function ensureColumn(db: DatabaseInstance, table: string, column: string, type: string): void {
  const exists = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  if (!exists) return;
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((entry) => entry.name === column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`).run();
  }
}

/**
 * Extend the existing ownership ledger without rewriting historical facts.
 * The design keeps repair grants in the same signature and transaction domain.
 * @param db Ownership database whose schema is initialized or upgraded.
 */
export function ensureDurableOwnershipSchema(db: DatabaseInstance): void {
  ensureColumn(db, 'sessions', 'is_durable', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'sessions', 'agent_node_id', 'TEXT');
  ensureColumn(db, 'session_files', 'agent_node_id', 'TEXT');
  ensureColumn(db, 'claim_forest_claims', 'agent_node_id', 'TEXT');
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_agent_node ON sessions(agent_node_id, status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_session_files_agent_node ON session_files(agent_node_id, released_at);
    CREATE INDEX IF NOT EXISTS idx_claim_forest_claims_agent_node ON claim_forest_claims(agent_node_id, released_at);

    CREATE TABLE IF NOT EXISTS roadmap_ownership_epochs (
      epoch_id TEXT PRIMARY KEY,
      roadmap_item_id TEXT NOT NULL REFERENCES roadmap_items(id),
      roadmap_slug TEXT NOT NULL,
      harbor TEXT NOT NULL,
      epoch_number INTEGER NOT NULL CHECK(epoch_number >= 1),
      owner_agent_node_id TEXT NOT NULL,
      prior_epoch_id TEXT REFERENCES roadmap_ownership_epochs(epoch_id),
      prior_owner_agent_node_id TEXT,
      cause TEXT NOT NULL CHECK(cause IN ('assignment','voluntary-handoff','operator-takeover')),
      source_session_id TEXT,
      successor_session_id TEXT,
      takeover_grant_id TEXT,
      work_binding_json TEXT NOT NULL,
      claim_bindings_json TEXT NOT NULL,
      claim_set_hash TEXT NOT NULL,
      briefing_hash TEXT,
      reason TEXT NOT NULL,
      authored_by_agent_node_id TEXT NOT NULL,
      authorized_actor_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      signature_algorithm TEXT NOT NULL,
      signature_key_id TEXT NOT NULL,
      signature_value TEXT NOT NULL,
      UNIQUE(roadmap_item_id, epoch_number)
    );
    CREATE INDEX IF NOT EXISTS idx_roadmap_ownership_epochs_item
      ON roadmap_ownership_epochs(roadmap_item_id, epoch_number DESC);
    CREATE INDEX IF NOT EXISTS idx_roadmap_ownership_epochs_owner
      ON roadmap_ownership_epochs(owner_agent_node_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS roadmap_ownership_events (
      event_id TEXT PRIMARY KEY,
      epoch_id TEXT NOT NULL REFERENCES roadmap_ownership_epochs(epoch_id),
      roadmap_item_id TEXT NOT NULL REFERENCES roadmap_items(id),
      kind TEXT NOT NULL CHECK(kind IN ('assigned','stale-marked','abandoned','handoff-issued','taken-over','claims-transferred','briefing-attached')),
      state TEXT NOT NULL CHECK(state IN ('current','stale','abandoned','transferred')),
      authored_by_agent_node_id TEXT,
      authorized_actor_id TEXT NOT NULL,
      occurred_at INTEGER NOT NULL,
      details_json TEXT NOT NULL,
      caused_by_event_id TEXT,
      content_hash TEXT NOT NULL,
      signature_algorithm TEXT NOT NULL,
      signature_key_id TEXT NOT NULL,
      signature_value TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_roadmap_ownership_events_epoch
      ON roadmap_ownership_events(epoch_id, occurred_at);

    CREATE TABLE IF NOT EXISTS durable_takeover_grants (
      grant_id TEXT PRIMARY KEY,
      roadmap_item_id TEXT NOT NULL REFERENCES roadmap_items(id),
      roadmap_slug TEXT NOT NULL,
      harbor TEXT NOT NULL,
      predecessor_epoch_id TEXT NOT NULL REFERENCES roadmap_ownership_epochs(epoch_id),
      predecessor_agent_node_id TEXT NOT NULL,
      successor_agent_node_id TEXT NOT NULL,
      issuer_agent_node_id TEXT,
      authorized_actor_id TEXT NOT NULL,
      successor_actor_id TEXT NOT NULL,
      authority_kind TEXT NOT NULL CHECK(authority_kind IN ('current-owner','operator')),
      operator_presence_receipt_json TEXT,
      reason TEXT NOT NULL,
      source_session_id TEXT NOT NULL,
      successor_session_id TEXT NOT NULL,
      source_witness_canonical INTEGER NOT NULL CHECK(source_witness_canonical IN (0,1)),
      source_witness_json TEXT NOT NULL,
      successor_witness_json TEXT NOT NULL,
      predecessor_evidence_gap_json TEXT,
      work_binding_json TEXT NOT NULL,
      claim_bindings_json TEXT NOT NULL,
      claim_set_hash TEXT NOT NULL,
      briefing_json TEXT NOT NULL,
      briefing_hash TEXT NOT NULL,
      nonce_hash TEXT NOT NULL,
      issued_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      signature_algorithm TEXT NOT NULL,
      signature_key_id TEXT NOT NULL,
      signature_value TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_durable_takeover_grants_epoch
      ON durable_takeover_grants(predecessor_epoch_id, expires_at DESC);

    CREATE TABLE IF NOT EXISTS durable_takeover_receipts (
      receipt_id TEXT PRIMARY KEY,
      grant_id TEXT NOT NULL REFERENCES durable_takeover_grants(grant_id),
      kind TEXT NOT NULL CHECK(kind IN ('issued','rejected','expired','consumed')),
      at INTEGER NOT NULL,
      details_json TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      signature_algorithm TEXT NOT NULL,
      signature_key_id TEXT NOT NULL,
      signature_value TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_durable_takeover_receipts_grant
      ON durable_takeover_receipts(grant_id, at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_durable_takeover_terminal_receipt
      ON durable_takeover_receipts(grant_id)
      WHERE kind IN ('expired','consumed');

    CREATE TRIGGER IF NOT EXISTS roadmap_ownership_epochs_no_update
    BEFORE UPDATE ON roadmap_ownership_epochs BEGIN
      SELECT RAISE(ABORT, 'roadmap ownership epochs are append-only');
    END;
    CREATE TRIGGER IF NOT EXISTS roadmap_ownership_epochs_no_delete
    BEFORE DELETE ON roadmap_ownership_epochs BEGIN
      SELECT RAISE(ABORT, 'roadmap ownership epochs are append-only');
    END;
    CREATE TRIGGER IF NOT EXISTS roadmap_ownership_events_no_update
    BEFORE UPDATE ON roadmap_ownership_events BEGIN
      SELECT RAISE(ABORT, 'roadmap ownership events are append-only');
    END;
    CREATE TRIGGER IF NOT EXISTS roadmap_ownership_events_no_delete
    BEFORE DELETE ON roadmap_ownership_events BEGIN
      SELECT RAISE(ABORT, 'roadmap ownership events are append-only');
    END;
    CREATE TRIGGER IF NOT EXISTS durable_takeover_receipts_no_update
    BEFORE UPDATE ON durable_takeover_receipts BEGIN
      SELECT RAISE(ABORT, 'durable takeover receipts are append-only');
    END;
    CREATE TRIGGER IF NOT EXISTS durable_takeover_receipts_no_delete
    BEFORE DELETE ON durable_takeover_receipts BEGIN
      SELECT RAISE(ABORT, 'durable takeover receipts are append-only');
    END;
    CREATE TRIGGER IF NOT EXISTS durable_takeover_grants_no_update
    BEFORE UPDATE ON durable_takeover_grants BEGIN
      SELECT RAISE(ABORT, 'durable takeover grants are immutable');
    END;
    CREATE TRIGGER IF NOT EXISTS durable_takeover_grants_no_delete
    BEFORE DELETE ON durable_takeover_grants BEGIN
      SELECT RAISE(ABORT, 'durable takeover grants are immutable');
    END;
  `);
  ensureColumn(db, 'durable_takeover_grants', 'operator_presence_receipt_json', 'TEXT');
  ensureColumn(db, 'durable_takeover_grants', 'anchor_repair_json', 'TEXT');
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_durable_anchor_repair_idempotency
    ON durable_takeover_grants(authorized_actor_id, json_extract(anchor_repair_json, '$.idempotencyKey'))
    WHERE anchor_repair_json IS NOT NULL;
  `);
}

function rowToEpoch(row: EpochRow): OwnershipEpoch {
  return {
    schema: OWNERSHIP_EPOCH_SCHEMA,
    epochId: row.epoch_id,
    roadmapItemId: row.roadmap_item_id,
    roadmapSlug: row.roadmap_slug,
    harbor: row.harbor,
    epochNumber: row.epoch_number,
    ownerAgentNodeId: row.owner_agent_node_id,
    priorEpochId: row.prior_epoch_id,
    priorOwnerAgentNodeId: row.prior_owner_agent_node_id,
    cause: row.cause,
    sourceSessionId: row.source_session_id,
    successorSessionId: row.successor_session_id,
    takeoverGrantId: row.takeover_grant_id,
    workBinding: parseSignedJson<ExactWorkBinding>(row.work_binding_json, 'ownership epoch work binding'),
    claimBindings: parseSignedJson<ExactClaimBinding[]>(row.claim_bindings_json, 'ownership epoch claim bindings'),
    claimSetHash: row.claim_set_hash,
    briefingHash: row.briefing_hash,
    reason: row.reason,
    authoredByAgentNodeId: row.authored_by_agent_node_id,
    authorizedActorId: row.authorized_actor_id,
    createdAt: row.created_at,
    contentHash: row.content_hash,
    signature: {
      algorithm: row.signature_algorithm,
      keyId: row.signature_key_id,
      value: row.signature_value,
    },
  };
}

/**
 * Rehydrate stored signed facts without inventing new fields on old grants.
 * The purpose of omitting an absent repair extension is signature compatibility.
 * @param row Persisted grant; JSON remains subject to signed-domain validation.
 * @returns Grant with precisely the optional facts that were originally signed.
 */
function rowToGrant(row: GrantRow): DurableTakeoverGrant {
  return {
    schema: TAKEOVER_GRANT_SCHEMA,
    grantId: row.grant_id,
    roadmapItemId: row.roadmap_item_id,
    roadmapSlug: row.roadmap_slug,
    harbor: row.harbor,
    predecessorEpochId: row.predecessor_epoch_id,
    predecessorAgentNodeId: row.predecessor_agent_node_id,
    successorAgentNodeId: row.successor_agent_node_id,
    issuerAgentNodeId: row.issuer_agent_node_id,
    authorizedActorId: row.authorized_actor_id,
    successorActorId: row.successor_actor_id,
    authorityKind: row.authority_kind,
    operatorPresenceReceipt: row.operator_presence_receipt_json
      ? parseSignedJson<OperatorPresenceReceipt>(row.operator_presence_receipt_json, 'operator presence receipt')
      : null,
    reason: row.reason,
    sourceSessionId: row.source_session_id,
    successorSessionId: row.successor_session_id,
    sourceWitnessCanonical: row.source_witness_canonical === 1,
    sourceWitness: parseSignedJson<SessionOwnershipWitness>(row.source_witness_json, 'source session witness'),
    successorWitness: parseSignedJson<SuccessorSessionWitness>(row.successor_witness_json, 'successor session witness'),
    predecessorEvidenceGap: row.predecessor_evidence_gap_json
      ? parseSignedJson<PredecessorEvidenceGap>(row.predecessor_evidence_gap_json, 'predecessor evidence gap')
      : null,
    workBinding: parseSignedJson<ExactWorkBinding>(row.work_binding_json, 'takeover work binding'),
    claimBindings: parseSignedJson<ExactClaimBinding[]>(row.claim_bindings_json, 'takeover claim bindings'),
    claimSetHash: row.claim_set_hash,
    briefing: parseSignedJson<OwnershipSuccessorBrief>(row.briefing_json, 'successor briefing'),
    briefingHash: row.briefing_hash,
    nonceHash: row.nonce_hash,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    ...(row.anchor_repair_json ? {
      anchorRepair: parseSignedJson<SameOwnerAnchorRepair>(row.anchor_repair_json, 'anchor repair'),
    } : {}),
    contentHash: row.content_hash,
    signature: {
      algorithm: row.signature_algorithm,
      keyId: row.signature_key_id,
      value: row.signature_value,
    },
  };
}

function rowToReceipt(row: ReceiptRow): DurableTakeoverReceipt {
  return {
    schema: TAKEOVER_RECEIPT_SCHEMA,
    receiptId: row.receipt_id,
    grantId: row.grant_id,
    kind: row.kind,
    at: row.at,
    details: parseSignedJson<Record<string, unknown>>(row.details_json, 'takeover receipt details'),
    contentHash: row.content_hash,
    signature: {
      algorithm: row.signature_algorithm,
      keyId: row.signature_key_id,
      value: row.signature_value,
    },
  };
}

function rowToEvent(row: OwnershipEventRow) {
  return {
    eventId: row.event_id,
    epochId: row.epoch_id,
    roadmapItemId: row.roadmap_item_id,
    kind: row.kind,
    state: row.state,
    authoredByAgentNodeId: row.authored_by_agent_node_id,
    authorizedActorId: row.authorized_actor_id,
    occurredAt: row.occurred_at,
    details: parseSignedJson<Record<string, unknown>>(row.details_json, 'ownership event details'),
    causedByEventId: row.caused_by_event_id,
    contentHash: row.content_hash,
    signature: {
      algorithm: row.signature_algorithm,
      keyId: row.signature_key_id,
      value: row.signature_value,
    },
  };
}

function validateSessionWitness(
  witness: SessionOwnershipWitness,
  predecessorAgentNodeId: string,
  authorizedActorId: string,
  authorityKind: TakeoverAuthorityKind,
  predecessorEvidenceGap: PredecessorEvidenceGap | null,
): boolean {
  if (!witness || witness.sessionId.trim() === '') {
    throw new DurableOwnershipError('source session witness is required', 'VALIDATION_ERROR', 400);
  }
  const split = !witness.worktreeId
    || !witness.metadataWorktreeId
    || witness.worktreeId !== witness.metadataWorktreeId;
  const canonical = !split
    && witness.identityVerified
    && witness.actorId !== null
    && witness.agentNodeId === predecessorAgentNodeId
    && witness.durable;
  if (authorityKind === 'current-owner' && witness.actorId !== authorizedActorId) {
    throw new DurableOwnershipError(
      'verified caller is not the actor bound to the current owner session',
      'AUTHORITY_REQUIRED',
      403,
    );
  }
  if (canonical) {
    if (predecessorEvidenceGap !== null) {
      throw new DurableOwnershipError(
        'canonical predecessor witness must not carry a compatibility gap attestation',
        'VALIDATION_ERROR',
        400,
      );
    }
    return true;
  }

  if (authorityKind !== 'operator' || !predecessorEvidenceGap) {
    if (split) throw new DurableOwnershipError('session column and metadata name different worktrees', 'SESSION_WORKTREE_SPLIT', 409);
    if (!witness.identityVerified || !witness.actorId) {
      throw new DurableOwnershipError('source session lacks verified actor identity', 'SESSION_IDENTITY_UNVERIFIED', 409);
    }
    throw new DurableOwnershipError('source session is not bound to the predecessor AgentNode', 'SESSION_AGENT_NODE_MISMATCH', 409);
  }
  if (
    predecessorEvidenceGap.sourceSessionId !== witness.sessionId
    || predecessorEvidenceGap.recordedByActorId !== authorizedActorId
    || !HASH_RE.test(predecessorEvidenceGap.lineageHash)
    || witness.lineageHash !== predecessorEvidenceGap.lineageHash
    || predecessorEvidenceGap.knownGaps.length === 0
  ) {
    throw new DurableOwnershipError(
      'operator takeover of incomplete predecessor metadata requires signed gap evidence bound to the exact terminal session and lineage hash',
      'PREDECESSOR_EVIDENCE_GAP_REQUIRED',
      409,
    );
  }
  // The false value is evidence quality, not a second authority mode. The
  // authenticated operator and exact one-shot grant remain the sole authority.
  return false;
}

function validateSuccessorWitness(
  witness: SuccessorSessionWitness,
  successorAgentNodeId: string,
  successorActorId: string,
  sourceSessionId: string,
  workBinding: ExactWorkBinding,
): SuccessorSessionWitness {
  if (!witness || witness.sessionId === sourceSessionId) {
    throw new DurableOwnershipError('successor session must be distinct from the predecessor', 'VALIDATION_ERROR', 400);
  }
  if (
    witness.status !== 'active'
    || witness.durable !== true
    || witness.identityVerified !== true
    || witness.agentNodeId !== successorAgentNodeId
    || witness.actorId !== successorActorId
  ) {
    throw new DurableOwnershipError(
      'successor session is not an active durable session bound to the expected AgentNode and actor',
      'SESSION_AGENT_NODE_MISMATCH',
      409,
    );
  }
  if (
    !witness.worktreeId
    || !witness.metadataWorktreeId
    || witness.worktreeId !== witness.metadataWorktreeId
    || witness.worktreeId !== workBinding.worktreeId
  ) {
    throw new DurableOwnershipError(
      'successor session is not bound to the exact source worktree',
      'SESSION_WORKTREE_SPLIT',
      409,
    );
  }
  return witness;
}

function sameWorkBinding(a: ExactWorkBinding, b: ExactWorkBinding): boolean {
  return canonicalOwnershipJson(normalizeExactWorkBinding(a)) === canonicalOwnershipJson(normalizeExactWorkBinding(b));
}

/**
 * Verify that enactment accounted for every granted claim exactly once.
 * This design forbids partial transfers and unsigned repair destination maps.
 * @param disposition Claim writer's result inside the ownership transaction.
 * @param grant Verified consent specifying the complete source claim set.
 * @returns Canonical disposition, or an error that rolls back enactment.
 */
function assertExactDisposition(disposition: TakeoverDisposition, grant: DurableTakeoverGrant): TakeoverDisposition {
  if (disposition.successorSessionId !== grant.successorSessionId) {
    throw new DurableOwnershipError('enactment returned the wrong successor session', 'ENACTMENT_REJECTED', 409);
  }
  const transferred = sortedUnique(disposition.transferredClaimNodeIds, 'transferredClaimNodeIds');
  const released = sortedUnique(disposition.releasedClaimNodeIds, 'releasedClaimNodeIds');
  const preserved = sortedUnique(disposition.preservedClaimNodeIds, 'preservedClaimNodeIds');
  const overlap = transferred.filter((id) => released.includes(id));
  if (overlap.length > 0) {
    throw new DurableOwnershipError('one claim cannot be both transferred and released', 'ENACTMENT_REJECTED', 409);
  }
  const expectedTransferred = grant.claimBindings
    .filter((binding) => binding.disposition === 'transfer')
    .map((binding) => binding.claimNodeId)
    .sort();
  const expectedReleased = grant.claimBindings
    .filter((binding) => binding.disposition === 'release')
    .map((binding) => binding.claimNodeId)
    .sort();
  const granted = [...expectedTransferred, ...expectedReleased].sort();
  if (
    canonicalOwnershipJson(expectedTransferred) !== canonicalOwnershipJson(transferred)
    || canonicalOwnershipJson(expectedReleased) !== canonicalOwnershipJson(released)
  ) {
    throw new DurableOwnershipError('enactment did not dispose exactly the granted claim set', 'CLAIM_SET_MISMATCH', 409);
  }
  if (preserved.some((id) => granted.includes(id))) {
    throw new DurableOwnershipError('preserved claims must be outside the granted set', 'CLAIM_SET_MISMATCH', 409);
  }
  if (grant.anchorRepair && (
    preserved.length !== 0
    || canonicalOwnershipJson(disposition.claimNodeMappings) !== canonicalOwnershipJson(grant.anchorRepair.claimNodeMappings)
  )) {
    throw new DurableOwnershipError('repair enactment differs from the signed complete node mapping', 'CLAIM_SET_MISMATCH', 409);
  }
  return {
    successorSessionId: disposition.successorSessionId,
    transferredClaimNodeIds: transferred,
    releasedClaimNodeIds: released,
    preservedClaimNodeIds: preserved,
    ...(grant.anchorRepair ? { claimNodeMappings: grant.anchorRepair.claimNodeMappings } : {}),
  };
}

function createDurableOwnershipKernel(db: DatabaseInstance, deps: DurableOwnershipKernelDeps) {
  ensureDurableOwnershipSchema(db);
  const now = deps.now ?? Date.now;
  const selectRoadmap = db.prepare(`
    SELECT id, slug, harbor, assignee_id, summary_md, description_md, notes_json, status
    FROM roadmap_items WHERE slug = ? AND harbor = ? AND deleted_at IS NULL
  `);
  const selectEpoch = db.prepare('SELECT * FROM roadmap_ownership_epochs WHERE epoch_id = ?');
  const selectCurrentEpoch = db.prepare(`
    SELECT * FROM roadmap_ownership_epochs
    WHERE roadmap_item_id = ? ORDER BY epoch_number DESC LIMIT 1
  `);
  const selectEpochs = db.prepare(`
    SELECT * FROM roadmap_ownership_epochs
    WHERE roadmap_item_id = ? ORDER BY epoch_number DESC
  `);
  const selectCurrentEvent = db.prepare(`
    SELECT * FROM roadmap_ownership_events
    WHERE epoch_id = ? ORDER BY occurred_at DESC, rowid DESC LIMIT 1
  `);
  const selectGrant = db.prepare('SELECT * FROM durable_takeover_grants WHERE grant_id = ?');
  const selectGrantsForEpoch = db.prepare(`
    SELECT * FROM durable_takeover_grants
    WHERE predecessor_epoch_id = ?
    ORDER BY issued_at DESC, grant_id DESC
  `);
  const selectTerminalReceipt = db.prepare(`
    SELECT * FROM durable_takeover_receipts
    WHERE grant_id = ? AND kind IN ('expired','consumed')
    ORDER BY at DESC, rowid DESC LIMIT 1
  `);
  const selectReceipts = db.prepare(`
    SELECT * FROM durable_takeover_receipts WHERE grant_id = ? ORDER BY at, rowid
  `);

  function assertSignedFact<T extends SignedFact>(fact: T, kind: string): T {
    const { contentHash, signature, ...unsigned } = fact;
    let expectedHash: string;
    try {
      expectedHash = sha256(canonicalOwnershipJson(unsigned));
    } catch {
      throw new DurableOwnershipError(`${kind} contains non-canonical signed data`, 'SIGNED_FACT_INVALID', 503);
    }
    let signatureValid = false;
    try {
      signatureValid = signature?.algorithm === 'ed25519'
        && signature.keyId === deps.signer.keyId
        && contentHash === expectedHash
        && deps.signer.verifyDigest(expectedHash.slice('sha256:'.length), signature.value);
    } catch {
      signatureValid = false;
    }
    if (!signatureValid) {
      throw new DurableOwnershipError(
        `${kind} failed canonical hash or daemon signature verification`,
        'SIGNED_FACT_INVALID',
        503,
      );
    }
    return fact;
  }

  function invalidSignedFact(kind: string, error: unknown): never {
    if (error instanceof DurableOwnershipError && error.code === 'SIGNED_FACT_INVALID') throw error;
    throw new DurableOwnershipError(
      `${kind} failed signed-domain validation${error instanceof Error ? `: ${error.message}` : ''}`,
      'SIGNED_FACT_INVALID',
      503,
    );
  }

  function verifiedEpoch(row: EpochRow): OwnershipEpoch {
    const epoch = assertSignedFact(rowToEpoch(row), 'ownership epoch');
    try {
      if (epoch.schema !== OWNERSHIP_EPOCH_SCHEMA) throw new Error('schema mismatch');
      const workBinding = normalizeExactWorkBinding(epoch.workBinding);
      const claims = validateClaimWorktreeBinding(normalizeClaimBindings(epoch.claimBindings), workBinding);
      if (canonicalOwnershipJson(workBinding) !== canonicalOwnershipJson(epoch.workBinding)) throw new Error('non-canonical work binding');
      if (canonicalOwnershipJson(claims) !== canonicalOwnershipJson(epoch.claimBindings)) throw new Error('non-canonical claim bindings');
      if (epoch.claimSetHash !== exactClaimSetHash(claims)) throw new Error('claim set hash mismatch');
      return epoch;
    } catch (error) {
      return invalidSignedFact('ownership epoch', error);
    }
  }

  /**
   * Check cryptographic integrity and domain constraints before using a grant.
   * The intent is to treat stored repair fields as untrusted until both checks pass.
   * @param row Stored signed grant, including optional historical repair facts.
   * @returns Verified canonical grant, or a fail-closed signed-fact error.
   */
  function verifiedGrant(row: GrantRow): DurableTakeoverGrant {
    const grant = assertSignedFact(rowToGrant(row), 'takeover grant');
    try {
      if (grant.schema !== TAKEOVER_GRANT_SCHEMA) throw new Error('schema mismatch');
      const workBinding = normalizeExactWorkBinding(grant.workBinding);
      const claims = validateTakeoverDispositions(
        validateGrantClaims(grant.claimBindings, workBinding, grant.anchorRepair),
      );
      if (canonicalOwnershipJson(workBinding) !== canonicalOwnershipJson(grant.workBinding)) throw new Error('non-canonical work binding');
      if (canonicalOwnershipJson(claims) !== canonicalOwnershipJson(grant.claimBindings)) throw new Error('non-canonical claim bindings');
      if (grant.claimSetHash !== exactClaimSetHash(claims)) throw new Error('claim set hash mismatch');
      const briefing = validateBriefing(
        grant.briefing,
        grant.predecessorAgentNodeId,
        grant.successorAgentNodeId,
        grant.sourceSessionId,
        grant.successorSessionId,
        workBinding,
        claims,
      );
      if (grant.briefingHash !== briefing.contentHash) throw new Error('briefing hash mismatch');
      const sourceCanonical = validateSessionWitness(
        grant.sourceWitness,
        grant.predecessorAgentNodeId,
        grant.authorizedActorId,
        grant.authorityKind,
        grant.predecessorEvidenceGap,
      );
      if (sourceCanonical !== grant.sourceWitnessCanonical) throw new Error('source witness canonical flag mismatch');
      validateSuccessorWitness(
        grant.successorWitness,
        grant.successorAgentNodeId,
        grant.successorActorId,
        grant.sourceSessionId,
        workBinding,
      );
      if (grant.anchorRepair) {
        const repair = normalizeAnchorRepair(grant.anchorRepair, grant);
        if (canonicalOwnershipJson(repair) !== canonicalOwnershipJson(grant.anchorRepair)) {
          throw new Error('non-canonical anchor repair binding');
        }
        if (grant.predecessorEvidenceGap !== null || !grant.sourceWitnessCanonical || grant.operatorPresenceReceipt !== null) {
          throw new Error('anchor repair cannot use predecessor gaps or operator override authority');
        }
      } else if (grant.predecessorAgentNodeId === grant.successorAgentNodeId) {
        throw new Error('generic takeover requires a different successor AgentNode');
      }
      const presenceIntent: OperatorPresenceIntent = {
        actorId: grant.authorizedActorId,
        harbor: grant.harbor,
        roadmapSlug: grant.roadmapSlug,
        predecessorEpochId: grant.predecessorEpochId,
        sourceSessionId: grant.sourceSessionId,
        successorSessionId: grant.successorSessionId,
        successorActorId: grant.successorActorId,
        claimSetHash: grant.claimSetHash,
      };
      if (grant.authorityKind === 'operator') {
        validateOperatorPresenceReceipt(grant.operatorPresenceReceipt, presenceIntent, grant.issuedAt);
      } else if (grant.operatorPresenceReceipt !== null) {
        throw new Error('voluntary handoff carries operator presence');
      }
      if (!HASH_RE.test(grant.nonceHash) || grant.expiresAt <= grant.issuedAt) throw new Error('invalid nonce hash or expiry');
      return grant;
    } catch (error) {
      return invalidSignedFact('takeover grant', error);
    }
  }

  function verifiedReceipt(row: ReceiptRow): DurableTakeoverReceipt {
    const receipt = assertSignedFact(rowToReceipt(row), 'takeover receipt');
    if (
      receipt.schema !== TAKEOVER_RECEIPT_SCHEMA
      || !['issued', 'rejected', 'expired', 'consumed'].includes(receipt.kind)
      || !isPlainObject(receipt.details)
    ) {
      return invalidSignedFact('takeover receipt', new Error('schema or details mismatch'));
    }
    return receipt;
  }

  function verifiedEvent(row: OwnershipEventRow) {
    const event = assertSignedFact(rowToEvent(row), 'ownership event');
    if (!isPlainObject(event.details) || !['current', 'stale', 'abandoned', 'transferred'].includes(event.state)) {
      return invalidSignedFact('ownership event', new Error('state or details mismatch'));
    }
    return event;
  }

  function grantView(row: GrantRow, at = now()): DurableTakeoverGrantView {
    const grant = verifiedGrant(row);
    const receipts = (selectReceipts.all(row.grant_id) as ReceiptRow[]).map(verifiedReceipt);
    const terminal = [...receipts].reverse().find((receipt) => receipt.kind === 'consumed' || receipt.kind === 'expired');
    const consumedEpochId = terminal?.kind === 'consumed' && typeof terminal.details.successorEpochId === 'string'
      ? terminal.details.successorEpochId
      : null;
    return {
      grant,
      state: terminal?.kind === 'consumed'
        ? 'consumed'
        : terminal?.kind === 'expired' || row.expires_at <= at
          ? 'expired'
          : 'active',
      consumedAt: terminal?.kind === 'consumed' ? terminal.at : null,
      consumedEpochId,
      receipts,
    };
  }

  function activeGrantForEpoch(epochId: string, at = now()): GrantRow | undefined {
    return (selectGrantsForEpoch.all(epochId) as GrantRow[])
      .find(row => grantView(row, at).state === 'active');
  }

  function verifiedTerminalReceipt(grantId: string): DurableTakeoverReceipt | null {
    const row = selectTerminalReceipt.get(grantId) as ReceiptRow | undefined;
    return row ? verifiedReceipt(row) : null;
  }

  function roadmap(slug: string, harbor: string): RoadmapRow {
    const row = selectRoadmap.get(slug, harbor) as RoadmapRow | undefined;
    if (!row) throw new DurableOwnershipError('roadmap item not found', 'ROADMAP_ITEM_NOT_FOUND', 404);
    return row;
  }

  function requireAgentNode(agentNodeId: string, field: string): string {
    const id = text(agentNodeId, field);
    if (!deps.agentNodeExists(id)) {
      throw new DurableOwnershipError(`${field} is not a durable AgentNode`, 'AGENT_NODE_NOT_FOUND', 404);
    }
    return id;
  }

  async function signFact<T extends Record<string, unknown>>(unsigned: T): Promise<T & SignedFact> {
    const encoded = canonicalOwnershipJson(unsigned);
    const contentHash = sha256(encoded);
    let value: string;
    try {
      value = await deps.signer.signDigest(contentHash.slice('sha256:'.length));
    } catch {
      throw new DurableOwnershipError('daemon receipt signer unavailable', 'SIGNER_UNAVAILABLE', 503);
    }
    if (!value || typeof value !== 'string') {
      throw new DurableOwnershipError('daemon receipt signer returned no signature', 'SIGNER_UNAVAILABLE', 503);
    }
    const signed = {
      ...unsigned,
      contentHash,
      signature: { algorithm: 'ed25519', keyId: text(deps.signer.keyId, 'signer.keyId'), value },
    } as T & SignedFact;
    if (!deps.signer.verifyDigest(contentHash.slice('sha256:'.length), value)) {
      throw new DurableOwnershipError('daemon signer self-verification failed', 'SIGNER_UNAVAILABLE', 503);
    }
    return signed;
  }

  /**
   * Append the signed ownership epoch and require exactly one persisted row.
   * The purpose is to reject even silent SQLite insert suppression atomically.
   * @param epoch Already signed epoch in the caller's ownership transaction.
   */
  function insertEpoch(epoch: OwnershipEpoch): void {
    const inserted = db.prepare(`
      INSERT INTO roadmap_ownership_epochs (
        epoch_id, roadmap_item_id, roadmap_slug, harbor, epoch_number,
        owner_agent_node_id, prior_epoch_id, prior_owner_agent_node_id, cause,
        source_session_id, successor_session_id, takeover_grant_id,
        work_binding_json, claim_bindings_json, claim_set_hash, briefing_hash, reason,
        authored_by_agent_node_id, authorized_actor_id, created_at, content_hash,
        signature_algorithm, signature_key_id, signature_value
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      epoch.epochId, epoch.roadmapItemId, epoch.roadmapSlug, epoch.harbor, epoch.epochNumber,
      epoch.ownerAgentNodeId, epoch.priorEpochId, epoch.priorOwnerAgentNodeId, epoch.cause,
      epoch.sourceSessionId, epoch.successorSessionId, epoch.takeoverGrantId,
      canonicalOwnershipJson(epoch.workBinding), canonicalOwnershipJson(epoch.claimBindings),
      epoch.claimSetHash, epoch.briefingHash, epoch.reason,
      epoch.authoredByAgentNodeId, epoch.authorizedActorId, epoch.createdAt, epoch.contentHash,
      epoch.signature.algorithm, epoch.signature.keyId, epoch.signature.value,
    );
    if (inserted.changes !== 1) throw new DurableOwnershipError('ownership epoch was not appended', 'STORE_UNAVAILABLE', 503);
  }

  /**
   * Append the signed lifecycle event with an explicit write-count witness.
   * This design prevents a receipt from claiming an event that was never stored.
   * @param event Already signed lifecycle transition and its causal details.
   */
  function insertEvent(event: SignedFact & {
    eventId: string;
    epochId: string;
    roadmapItemId: string;
    kind: string;
    state: OwnershipState;
    authoredByAgentNodeId: string | null;
    authorizedActorId: string;
    occurredAt: number;
    details: Record<string, unknown>;
    causedByEventId: string | null;
  }): void {
    const inserted = db.prepare(`
      INSERT INTO roadmap_ownership_events (
        event_id, epoch_id, roadmap_item_id, kind, state,
        authored_by_agent_node_id, authorized_actor_id, occurred_at,
        details_json, caused_by_event_id, content_hash,
        signature_algorithm, signature_key_id, signature_value
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.eventId, event.epochId, event.roadmapItemId, event.kind, event.state,
      event.authoredByAgentNodeId, event.authorizedActorId, event.occurredAt,
      canonicalOwnershipJson(event.details), event.causedByEventId, event.contentHash,
      event.signature.algorithm, event.signature.keyId, event.signature.value,
    );
    if (inserted.changes !== 1) throw new DurableOwnershipError('ownership event was not appended', 'STORE_UNAVAILABLE', 503);
  }

  /**
   * Persist a signed receipt or fail the surrounding ownership transaction.
   * The rationale is that an unrecorded outcome is not a completed transfer.
   * @param receipt Signed issuance, rejection, expiry, or consumption fact.
   */
  function insertReceipt(receipt: DurableTakeoverReceipt): void {
    const inserted = db.prepare(`
      INSERT INTO durable_takeover_receipts (
        receipt_id, grant_id, kind, at, details_json, content_hash,
        signature_algorithm, signature_key_id, signature_value
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      receipt.receiptId, receipt.grantId, receipt.kind, receipt.at,
      canonicalOwnershipJson(receipt.details), receipt.contentHash,
      receipt.signature.algorithm, receipt.signature.keyId, receipt.signature.value,
    );
    if (inserted.changes !== 1) throw new DurableOwnershipError('ownership receipt was not appended', 'STORE_UNAVAILABLE', 503);
  }

  async function makeReceipt(
    grantId: string,
    kind: TakeoverReceiptKind,
    at: number,
    details: Record<string, unknown>,
  ): Promise<DurableTakeoverReceipt> {
    return signFact({
      schema: TAKEOVER_RECEIPT_SCHEMA,
      receiptId: `otrcpt_${randomUUID()}`,
      grantId,
      kind,
      at,
      details,
    }) as Promise<DurableTakeoverReceipt>;
  }

  async function bootstrap(input: BootstrapOwnershipInput): Promise<{ epoch: OwnershipEpoch; idempotent: boolean }> {
    const owner = requireAgentNode(input.ownerAgentNodeId, 'ownerAgentNodeId');
    const author = requireAgentNode(input.authoredByAgentNodeId, 'authoredByAgentNodeId');
    const item = roadmap(text(input.roadmapSlug, 'roadmapSlug'), text(input.harbor, 'harbor'));
    if (item.assignee_id !== owner) {
      throw new DurableOwnershipError('roadmap assignee is not the requested canonical owner', 'OWNER_MISMATCH', 409);
    }
    const workBinding = normalizeExactWorkBinding(input.workBinding);
    const claims = validateClaimWorktreeBinding(normalizeClaimBindings(input.claimBindings ?? []), workBinding);
    const sourceSessionId = input.sourceSessionId ?? null;
    const existing = selectCurrentEpoch.get(item.id) as EpochRow | undefined;
    if (existing) {
      const epoch = verifiedEpoch(existing);
      if (
        existing.owner_agent_node_id === owner
        && existing.source_session_id === sourceSessionId
        && existing.successor_session_id === sourceSessionId
        && sameWorkBinding(epoch.workBinding, workBinding)
        && epoch.claimSetHash === exactClaimSetHash(claims)
        && canonicalOwnershipJson(epoch.claimBindings) === canonicalOwnershipJson(claims)
      ) {
        return { epoch, idempotent: true };
      }
      throw new DurableOwnershipError('roadmap item already has a different ownership epoch', 'EPOCH_CONFLICT', 409);
    }
    const createdAt = now();
    const epoch = await signFact({
      schema: OWNERSHIP_EPOCH_SCHEMA,
      epochId: `oepoch_${randomUUID()}`,
      roadmapItemId: item.id,
      roadmapSlug: item.slug,
      harbor: item.harbor,
      epochNumber: 1,
      ownerAgentNodeId: owner,
      priorEpochId: null,
      priorOwnerAgentNodeId: null,
      cause: 'assignment' as const,
      sourceSessionId,
      successorSessionId: sourceSessionId,
      takeoverGrantId: null,
      workBinding,
      claimBindings: claims,
      claimSetHash: exactClaimSetHash(claims),
      briefingHash: null,
      reason: narrative(input.reason, 'reason'),
      authoredByAgentNodeId: author,
      authorizedActorId: text(input.authorizedActorId, 'authorizedActorId'),
      createdAt,
    }) as OwnershipEpoch;
    const assigned = await signFact({
      eventId: `oevt_${randomUUID()}`,
      epochId: epoch.epochId,
      roadmapItemId: item.id,
      kind: 'assigned',
      state: 'current' as const,
      authoredByAgentNodeId: author,
      authorizedActorId: epoch.authorizedActorId,
      occurredAt: createdAt,
      details: { ownerAgentNodeId: owner, claimSetHash: epoch.claimSetHash },
      causedByEventId: null,
    });
    try {
      db.transaction(() => {
        const live = selectCurrentEpoch.get(item.id) as EpochRow | undefined;
        if (live) throw new DurableOwnershipError('ownership epoch was created concurrently', 'EPOCH_CONFLICT', 409);
        insertEpoch(epoch);
        insertEvent(assigned);
      }).immediate();
      return { epoch, idempotent: false };
    } catch (error) {
      if (error instanceof DurableOwnershipError) throw error;
      throw new DurableOwnershipError((error as Error).message, 'STORE_UNAVAILABLE', 503);
    }
  }

  async function expireDue(at = now()): Promise<void> {
    const rows = db.prepare(`
      SELECT * FROM durable_takeover_grants
      WHERE expires_at <= ?
      ORDER BY expires_at, grant_id
    `).all(at) as GrantRow[];
    for (const row of rows) {
      const view = grantView(row, at);
      if (view.receipts.some(receipt => receipt.kind === 'expired' || receipt.kind === 'consumed')) continue;
      const receipt = await makeReceipt(view.grant.grantId, 'expired', at, { expiresAt: view.grant.expiresAt });
      try {
        db.transaction(() => {
          if (!verifiedTerminalReceipt(view.grant.grantId)) insertReceipt(receipt);
        }).immediate();
      } catch (error) {
        // A concurrent consumer/expirer may have won the terminal receipt.
        // Any other persistence failure is an audit failure and must surface.
        if (!verifiedTerminalReceipt(view.grant.grantId)) {
          throw new DurableOwnershipError(
            `failed to persist takeover expiry receipt: ${(error as Error).message}`,
            'STORE_UNAVAILABLE',
            503,
          );
        }
      }
    }
  }

  /**
   * Sign and append a grant using facts captured by the trusted coordinator.
   * The design signs before locking, then rechecks authority and expiry on write.
   * @param input Exact canonical witnesses and explicit claim dispositions.
   * @returns Signed grant, caller-held nonce, and its persisted issuance receipt.
   */
  async function issue(input: IssueTakeoverInput): Promise<{
    grant: DurableTakeoverGrant;
    nonce: string;
    receipt: DurableTakeoverReceipt;
    idempotent?: boolean;
    state?: TakeoverGrantState;
  }> {
    if (input.anchorRepair) {
      const replay = replayAnchorRepairPreparation(
        input.anchorRepair.idempotencyKey, input.anchorRepair.requestHash,
        anchorRepairNonce(input.nonce), input.trustedAuthorizedActorId,
      );
      if (replay) return replay;
    }
    await expireDue();
    const predecessor = requireAgentNode(input.predecessorAgentNodeId, 'predecessorAgentNodeId');
    const successor = requireAgentNode(input.successorAgentNodeId, 'successorAgentNodeId');
    const issuer = input.trustedIssuerAgentNodeId === null
      ? null
      : requireAgentNode(input.trustedIssuerAgentNodeId, 'trustedIssuerAgentNodeId');
    if (predecessor === successor && !input.anchorRepair) {
      throw new DurableOwnershipError('successor must be a different AgentNode', 'VALIDATION_ERROR', 400);
    }
    if (input.authorityKind === 'current-owner' && issuer !== predecessor) {
      throw new DurableOwnershipError('current-owner handoff must be issued by the current owner', 'AUTHORITY_REQUIRED', 403);
    }
    if (input.authorityKind === 'operator' && issuer !== null) {
      throw new DurableOwnershipError(
        'operator takeover is attributed to its verified actor and must not impersonate an AgentNode issuer',
        'AUTHORITY_REQUIRED',
        403,
      );
    }
    const item = roadmap(text(input.roadmapSlug, 'roadmapSlug'), text(input.harbor, 'harbor'));
    const current = selectCurrentEpoch.get(item.id) as EpochRow | undefined;
    if (!current || current.epoch_id !== input.predecessorEpochId) {
      throw new DurableOwnershipError('predecessor epoch is not current', 'EPOCH_CONFLICT', 409);
    }
    verifiedEpoch(current);
    if (current.owner_agent_node_id !== predecessor || item.assignee_id !== predecessor) {
      throw new DurableOwnershipError('roadmap owner and predecessor epoch disagree', 'OWNER_MISMATCH', 409);
    }
    const predecessorEvidenceGap = input.predecessorEvidenceGap ?? null;
    const sourceWitnessCanonical = validateSessionWitness(
      input.sourceWitness,
      predecessor,
      text(input.trustedAuthorizedActorId, 'trustedAuthorizedActorId'),
      input.authorityKind,
      predecessorEvidenceGap,
    );
    if (input.sourceWitness.sessionId !== input.sourceSessionId) {
      throw new DurableOwnershipError('source session witness does not match the grant', 'GRANT_BINDING_MISMATCH', 409);
    }
    const workBinding = normalizeExactWorkBinding(input.workBinding);
    const successorActorId = text(input.successorActorId, 'successorActorId');
    const successorWitness = validateSuccessorWitness(
      input.successorWitness,
      successor,
      successorActorId,
      input.sourceSessionId,
      workBinding,
    );
    if (successorWitness.sessionId !== input.successorSessionId) {
      throw new DurableOwnershipError('successor session witness does not match the grant', 'GRANT_BINDING_MISMATCH', 409);
    }
    const claims = validateTakeoverDispositions(
      validateGrantClaims(input.claimBindings, workBinding, input.anchorRepair),
    );
    const anchorRepair = input.anchorRepair ? normalizeAnchorRepair(input.anchorRepair, {
      predecessorAgentNodeId: predecessor, successorAgentNodeId: successor,
      issuerAgentNodeId: issuer, authorizedActorId: input.trustedAuthorizedActorId,
      successorActorId, authorityKind: input.authorityKind,
      sourceWitness: input.sourceWitness, successorWitness, workBinding, claimBindings: claims,
    }) : undefined;
    if (anchorRepair && (predecessorEvidenceGap !== null || !sourceWitnessCanonical || input.operatorPresenceReceipt !== null)) {
      throw new DurableOwnershipError('anchor repair cannot borrow operator or compatibility authority', 'AUTHORITY_REQUIRED', 403);
    }
    const claimSetHash = exactClaimSetHash(claims);
    const briefing = validateBriefing(
      input.briefing,
      predecessor,
      successor,
      input.sourceSessionId,
      input.successorSessionId,
      workBinding,
      claims,
    );
    const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
    if (!Number.isFinite(ttlMs) || ttlMs < MIN_TTL_MS || ttlMs > MAX_TTL_MS) {
      throw new DurableOwnershipError(`ttlMs must be between ${MIN_TTL_MS} and ${MAX_TTL_MS}`, 'VALIDATION_ERROR', 400);
    }
    const active = activeGrantForEpoch(current.epoch_id, now());
    if (active) {
      if (anchorRepair) {
        const replay = replayAnchorRepairPreparation(
          anchorRepair.idempotencyKey, anchorRepair.requestHash, anchorRepairNonce(input.nonce), input.trustedAuthorizedActorId,
        );
        if (replay) return replay;
      }
      throw new DurableOwnershipError('current epoch already has an active takeover grant', 'GRANT_CONFLICT', 409);
    }

    const grantId = `otgrant_${randomUUID()}`;
    const nonce = anchorRepair ? anchorRepairNonce(input.nonce) : randomBytes(32).toString('base64url');
    const nonceHash = sha256(nonce);
    const issuedAt = now();
    const expiresAt = issuedAt + Math.floor(ttlMs);
    const presenceIntent: OperatorPresenceIntent = {
      actorId: text(input.trustedAuthorizedActorId, 'trustedAuthorizedActorId'),
      harbor: item.harbor,
      roadmapSlug: item.slug,
      predecessorEpochId: current.epoch_id,
      sourceSessionId: text(input.sourceSessionId, 'sourceSessionId'),
      successorSessionId: text(input.successorSessionId, 'successorSessionId'),
      successorActorId,
      claimSetHash,
    };
    const operatorPresenceReceipt = input.authorityKind === 'operator'
      ? validateOperatorPresenceReceipt(input.operatorPresenceReceipt, presenceIntent, issuedAt)
      : null;
    if (input.authorityKind === 'current-owner' && input.operatorPresenceReceipt !== null) {
      throw new DurableOwnershipError(
        'voluntary handoff must not carry operator authority',
        'VALIDATION_ERROR',
        400,
      );
    }
    const unsigned = {
      schema: TAKEOVER_GRANT_SCHEMA,
      grantId,
      roadmapItemId: item.id,
      roadmapSlug: item.slug,
      harbor: item.harbor,
      predecessorEpochId: current.epoch_id,
      predecessorAgentNodeId: predecessor,
      successorAgentNodeId: successor,
      issuerAgentNodeId: issuer,
      authorizedActorId: text(input.trustedAuthorizedActorId, 'trustedAuthorizedActorId'),
      successorActorId,
      authorityKind: input.authorityKind,
      operatorPresenceReceipt,
      reason: narrative(input.reason, 'reason'),
      sourceSessionId: text(input.sourceSessionId, 'sourceSessionId'),
      successorSessionId: text(input.successorSessionId, 'successorSessionId'),
      sourceWitnessCanonical,
      sourceWitness: input.sourceWitness,
      successorWitness,
      predecessorEvidenceGap,
      workBinding,
      claimBindings: claims,
      claimSetHash,
      briefing,
      briefingHash: briefing.contentHash,
      nonceHash,
      issuedAt,
      expiresAt,
      ...(anchorRepair ? { anchorRepair } : {}),
    };
    const grant = await signFact(unsigned) as DurableTakeoverGrant;
    const receipt = await makeReceipt(grantId, 'issued', issuedAt, {
      predecessorEpochId: grant.predecessorEpochId,
      predecessorAgentNodeId: predecessor,
      successorAgentNodeId: successor,
      issuedByActorId: grant.authorizedActorId,
      successorActorId,
      sourceSessionId: grant.sourceSessionId,
      successorSessionId: grant.successorSessionId,
      operatorPresenceReceiptId: operatorPresenceReceipt?.receiptId ?? null,
      sourceWitnessCanonical,
      workBindingHash: sha256(canonicalOwnershipJson(workBinding)),
      claimSetHash,
      briefingHash: briefing.contentHash,
      expiresAt,
      ...(anchorRepair ? { anchorRepair } : {}),
    });
    const handoffEvent = await signFact({
      eventId: `oevt_${randomUUID()}`,
      epochId: current.epoch_id,
      roadmapItemId: item.id,
      kind: 'handoff-issued',
      state: (() => {
        const row = selectCurrentEvent.get(current.epoch_id) as OwnershipEventRow | undefined;
        return row ? verifiedEvent(row).state : 'current';
      })(),
      authoredByAgentNodeId: issuer,
      authorizedActorId: grant.authorizedActorId,
      occurredAt: issuedAt,
      details: { grantId, successorAgentNodeId: successor, claimSetHash, briefingHash: briefing.contentHash, expiresAt },
      causedByEventId: null,
    });

    try {
      db.transaction(() => {
        const liveItem = selectRoadmap.get(item.slug, item.harbor) as RoadmapRow | undefined;
        const liveEpoch = selectCurrentEpoch.get(item.id) as EpochRow | undefined;
        if (!liveItem || liveItem.assignee_id !== predecessor || liveEpoch?.epoch_id !== current.epoch_id) {
          throw new DurableOwnershipError('ownership changed before grant issuance', 'EPOCH_CONFLICT', 409);
        }
        verifiedEpoch(liveEpoch);
        if (now() >= expiresAt) {
          throw new DurableOwnershipError('grant expired while its signatures were being prepared', 'GRANT_EXPIRED', 409);
        }
        if (activeGrantForEpoch(current.epoch_id, issuedAt)) {
          throw new DurableOwnershipError('current epoch already has an active takeover grant', 'GRANT_CONFLICT', 409);
        }
        db.prepare(`
          INSERT INTO durable_takeover_grants (
            grant_id, roadmap_item_id, roadmap_slug, harbor, predecessor_epoch_id,
            predecessor_agent_node_id, successor_agent_node_id, issuer_agent_node_id,
            authorized_actor_id, successor_actor_id, authority_kind, operator_presence_receipt_json,
            reason, source_session_id,
            successor_session_id, source_witness_canonical, source_witness_json,
            successor_witness_json, predecessor_evidence_gap_json, work_binding_json, claim_bindings_json,
            claim_set_hash, briefing_json, briefing_hash, nonce_hash, issued_at,
            expires_at, content_hash,
            signature_algorithm, signature_key_id, signature_value, anchor_repair_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          grant.grantId, grant.roadmapItemId, grant.roadmapSlug, grant.harbor, grant.predecessorEpochId,
          grant.predecessorAgentNodeId, grant.successorAgentNodeId, grant.issuerAgentNodeId,
          grant.authorizedActorId, grant.successorActorId, grant.authorityKind,
          grant.operatorPresenceReceipt ? canonicalOwnershipJson(grant.operatorPresenceReceipt) : null,
          grant.reason, grant.sourceSessionId,
          grant.successorSessionId, grant.sourceWitnessCanonical ? 1 : 0, canonicalOwnershipJson(grant.sourceWitness),
          canonicalOwnershipJson(grant.successorWitness),
          grant.predecessorEvidenceGap ? canonicalOwnershipJson(grant.predecessorEvidenceGap) : null,
          canonicalOwnershipJson(grant.workBinding), canonicalOwnershipJson(grant.claimBindings),
          grant.claimSetHash, canonicalOwnershipJson(grant.briefing), grant.briefingHash,
          grant.nonceHash, grant.issuedAt, grant.expiresAt, grant.contentHash,
          grant.signature.algorithm, grant.signature.keyId, grant.signature.value,
          grant.anchorRepair ? canonicalOwnershipJson(grant.anchorRepair) : null,
        );
        insertReceipt(receipt);
        insertEvent(handoffEvent);
      }).immediate();
      return { grant, nonce, receipt, ...(anchorRepair ? { idempotent: false, state: 'active' as const } : {}) };
    } catch (error) {
      if (anchorRepair) {
        // The unique actor/key index arbitrates concurrent duplicate delivery.
        // Read back this exact operation only; never retry a changed intent.
        const replay = replayAnchorRepairPreparation(
          anchorRepair.idempotencyKey, anchorRepair.requestHash, nonce, grant.authorizedActorId,
        );
        if (replay) return replay;
      }
      if (error instanceof DurableOwnershipError) throw error;
      throw new DurableOwnershipError((error as Error).message, 'STORE_UNAVAILABLE', 503);
    }
  }

  /**
   * Read back an already accepted preparation without signing or issuing again.
   * Motivation: ambiguous transport acceptance must not consume a second grant
   * or reinterpret new work as the original consent.
   * @param key Caller-retained logical operation id, scoped to verified actor.
   * @param requestHash Canonical hash of the original request fields.
   * @param nonce Caller-retained nonce; never recovered from daemon storage.
   * @param actorId Verified caller, not a body-supplied alias.
   * @returns Original signed preparation/state, or null when never admitted.
   */
  function replayAnchorRepairPreparation(key: string, requestHash: string, nonce: string, actorId: string) {
    const row = db.prepare(`
      SELECT * FROM durable_takeover_grants
      WHERE authorized_actor_id = ? AND json_extract(anchor_repair_json, '$.idempotencyKey') = ?
      LIMIT 1
    `).get(actorId, key) as GrantRow | undefined;
    if (!row) return null;
    const view = grantView(row);
    if (view.grant.anchorRepair?.requestHash !== requestHash || view.grant.nonceHash !== sha256(nonce)) {
      throw new DurableOwnershipError('idempotency key was already bound to different repair consent', 'GRANT_CONFLICT', 409);
    }
    const receipt = view.receipts.find(candidate => candidate.kind === 'issued');
    if (!receipt) throw new DurableOwnershipError('repair preparation lacks its signed issued receipt', 'STORE_UNAVAILABLE', 503);
    return { grant: view.grant, nonce, receipt, idempotent: true, state: view.state };
  }

  async function reject(grant: DurableTakeoverGrant, code: DurableOwnershipFailureCode, message: string): Promise<never> {
    const receipt = await makeReceipt(grant.grantId, 'rejected', now(), { code, reason: message });
    try {
      insertReceipt(receipt);
    } catch (error) {
      throw new DurableOwnershipError(
        `takeover rejected (${code}) but its audit receipt could not be persisted: ${(error as Error).message}`,
        'STORE_UNAVAILABLE',
        503,
      );
    }
    throw new DurableOwnershipError(message, code, 409);
  }

  /**
   * Consume consent and enact one atomic ownership transition with signed proof.
   * The intent is all-or-nothing claims, epoch, lifecycle events, and receipt;
   * repair retries read the original outcome instead of repeating the writes.
   * @param input Verified caller and freshly captured grant-bound witnesses.
   * @returns Committed epoch and disposition, or the identical repair replay.
   */
  async function consume(input: ConsumeTakeoverInput): Promise<{
    grant: DurableTakeoverGrant;
    epoch: OwnershipEpoch;
    receipt: DurableTakeoverReceipt;
    disposition: TakeoverDisposition;
    idempotent?: boolean;
  }> {
    await expireDue();
    const row = selectGrant.get(text(input.grantId, 'grantId')) as GrantRow | undefined;
    if (!row) throw new DurableOwnershipError('takeover grant not found', 'GRANT_NOT_FOUND', 404);
    const lifecycle = grantView(row);
    const grant = lifecycle.grant;
    if (grant.anchorRepair) {
      const replay = replayAnchorRepairConsumption(input.grantId, input.nonce, input.trustedAuthorizedActorId);
      if (replay) return replay;
    }
    if (lifecycle.state === 'consumed') return reject(grant, 'GRANT_ALREADY_CONSUMED', 'takeover grant was already consumed');
    if (lifecycle.state === 'expired') return reject(grant, 'GRANT_EXPIRED', 'takeover grant expired');
    if (sha256(text(input.nonce, 'nonce', 4096)) !== grant.nonceHash) {
      return reject(grant, 'GRANT_BINDING_MISMATCH', 'takeover nonce does not match the grant');
    }
    if (text(input.trustedAuthorizedActorId, 'trustedAuthorizedActorId') !== grant.successorActorId) {
      return reject(grant, 'AUTHORITY_REQUIRED', 'verified caller does not match the takeover grant actor');
    }
    const workBinding = normalizeExactWorkBinding(input.workBinding);
    const claims = validateGrantClaims(input.claimBindings, workBinding, grant.anchorRepair);
    if (!sameWorkBinding(workBinding, grant.workBinding)) {
      return reject(grant, 'GRANT_BINDING_MISMATCH', 'exact work binding drifted');
    }
    if (exactClaimSetHash(claims) !== grant.claimSetHash) {
      return reject(grant, 'CLAIM_SET_MISMATCH', 'exact claim snapshot drifted');
    }
    const sourceWitnessCanonical = validateSessionWitness(
      input.sourceWitness,
      grant.predecessorAgentNodeId,
      grant.authorizedActorId,
      grant.authorityKind,
      grant.predecessorEvidenceGap,
    );
    if (
      sourceWitnessCanonical !== grant.sourceWitnessCanonical
      || canonicalOwnershipJson(input.sourceWitness) !== canonicalOwnershipJson(grant.sourceWitness)
    ) {
      return reject(grant, 'GRANT_BINDING_MISMATCH', 'source session witness drifted');
    }
    try {
      validateSuccessorWitness(
        input.successorWitness,
        grant.successorAgentNodeId,
        grant.successorActorId,
        grant.sourceSessionId,
        grant.workBinding,
      );
    } catch (error) {
      const verdict = error instanceof DurableOwnershipError
        ? error
        : new DurableOwnershipError('successor session witness is invalid', 'GRANT_BINDING_MISMATCH', 409);
      return reject(grant, verdict.code, verdict.message);
    }
    if (canonicalOwnershipJson(input.successorWitness) !== canonicalOwnershipJson(grant.successorWitness)) {
      return reject(grant, 'GRANT_BINDING_MISMATCH', 'successor session witness drifted');
    }

    const at = now();
    const nextEpochId = `oepoch_${randomUUID()}`;
    const predecessorEpochRow = selectEpoch.get(grant.predecessorEpochId) as EpochRow | undefined;
    if (!predecessorEpochRow) throw new DurableOwnershipError('predecessor epoch not found', 'EPOCH_NOT_FOUND', 404);
    const nextEpochNumber = verifiedEpoch(predecessorEpochRow).epochNumber;
    const epochClaims: ExactClaimBinding[] = grant.anchorRepair
      ? anchorRepairSuccessorClaims(grant, at)
      : grant.claimBindings;
    const canonicalEpochClaims = normalizeClaimBindings(epochClaims);
    const epoch = await signFact({
      schema: OWNERSHIP_EPOCH_SCHEMA,
      epochId: nextEpochId,
      roadmapItemId: grant.roadmapItemId,
      roadmapSlug: grant.roadmapSlug,
      harbor: grant.harbor,
      epochNumber: nextEpochNumber + 1,
      ownerAgentNodeId: grant.successorAgentNodeId,
      priorEpochId: grant.predecessorEpochId,
      priorOwnerAgentNodeId: grant.predecessorAgentNodeId,
      cause: grant.authorityKind === 'operator' ? 'operator-takeover' : 'voluntary-handoff',
      sourceSessionId: grant.sourceSessionId,
      successorSessionId: grant.successorSessionId,
      takeoverGrantId: grant.grantId,
      workBinding: grant.workBinding,
      claimBindings: canonicalEpochClaims,
      claimSetHash: exactClaimSetHash(canonicalEpochClaims),
      briefingHash: grant.briefingHash,
      reason: grant.reason,
      authoredByAgentNodeId: grant.successorAgentNodeId,
      authorizedActorId: grant.authorizedActorId,
      createdAt: at,
    }) as OwnershipEpoch;
    const receipt = await makeReceipt(grant.grantId, 'consumed', at, {
      predecessorEpochId: grant.predecessorEpochId,
      successorEpochId: epoch.epochId,
      predecessorAgentNodeId: grant.predecessorAgentNodeId,
      successorAgentNodeId: grant.successorAgentNodeId,
      successorActorId: grant.successorActorId,
      sourceSessionId: grant.sourceSessionId,
      successorSessionId: grant.successorSessionId,
      claimSetHash: grant.claimSetHash,
      briefingHash: grant.briefingHash,
      sourceWitnessCanonical: grant.sourceWitnessCanonical,
      knownGaps: grant.predecessorEvidenceGap?.knownGaps ?? grant.briefing.knownGaps,
      ...(grant.anchorRepair ? {
        operation: 'same-owner-anchor-repair',
        anchorRepair: grant.anchorRepair,
        successorClaimSetHash: epoch.claimSetHash,
        disposition: {
          successorSessionId: grant.successorSessionId,
          transferredClaimNodeIds: grant.claimBindings.filter(claim => claim.disposition === 'transfer').map(claim => claim.claimNodeId).sort(),
          releasedClaimNodeIds: grant.claimBindings.filter(claim => claim.disposition === 'release').map(claim => claim.claimNodeId).sort(),
          preservedClaimNodeIds: [],
          claimNodeMappings: grant.anchorRepair.claimNodeMappings,
        },
      } : {}),
    });
    const takenOverEvent = await signFact({
      eventId: `oevt_${randomUUID()}`,
      epochId: grant.predecessorEpochId,
      roadmapItemId: grant.roadmapItemId,
      kind: 'taken-over',
      state: 'transferred' as const,
      authoredByAgentNodeId: grant.issuerAgentNodeId,
      authorizedActorId: grant.authorizedActorId,
      occurredAt: at,
      details: { grantId: grant.grantId, successorEpochId: epoch.epochId, successorAgentNodeId: grant.successorAgentNodeId },
      causedByEventId: null,
    });
    const assignedEvent = await signFact({
      eventId: `oevt_${randomUUID()}`,
      epochId: epoch.epochId,
      roadmapItemId: grant.roadmapItemId,
      kind: 'assigned',
      state: 'current' as const,
      authoredByAgentNodeId: grant.successorAgentNodeId,
      authorizedActorId: grant.authorizedActorId,
      occurredAt: at,
      details: { grantId: grant.grantId, predecessorEpochId: grant.predecessorEpochId, briefingHash: grant.briefingHash },
      causedByEventId: takenOverEvent.eventId,
    });

    let disposition!: TakeoverDisposition;
    try {
      db.transaction(() => {
        const liveGrant = selectGrant.get(grant.grantId) as GrantRow | undefined;
        const liveItem = selectRoadmap.get(grant.roadmapSlug, grant.harbor) as RoadmapRow | undefined;
        const liveEpoch = selectCurrentEpoch.get(grant.roadmapItemId) as EpochRow | undefined;
        if (!liveGrant || verifiedTerminalReceipt(grant.grantId)) {
          throw new DurableOwnershipError('grant lost its active one-shot state', 'GRANT_ALREADY_CONSUMED', 409);
        }
        verifiedGrant(liveGrant);
        if (liveGrant.expires_at <= now()) {
          throw new DurableOwnershipError('takeover grant expired before enactment', 'GRANT_EXPIRED', 409);
        }
        if (
          !liveItem
          || liveItem.assignee_id !== grant.predecessorAgentNodeId
          || liveEpoch?.epoch_id !== grant.predecessorEpochId
        ) {
          throw new DurableOwnershipError('roadmap owner or epoch changed before enactment', 'EPOCH_CONFLICT', 409);
        }
        verifiedEpoch(liveEpoch);

        disposition = assertExactDisposition(input.enact(at), grant);
        if (liveGrant.expires_at <= now()) {
          throw new DurableOwnershipError('takeover grant expired during enactment', 'GRANT_EXPIRED', 409);
        }

        const ownerChanged = db.prepare(`
          UPDATE roadmap_items SET assignee_id = ?, last_touched_at = ?
          WHERE id = ? AND assignee_id = ?
        `).run(grant.successorAgentNodeId, at, grant.roadmapItemId, grant.predecessorAgentNodeId).changes;
        if (ownerChanged !== 1) {
          throw new DurableOwnershipError('roadmap owner transition lost its compare-and-swap', 'EPOCH_CONFLICT', 409);
        }
        insertEpoch(epoch);
        insertEvent(takenOverEvent);
        insertEvent(assignedEvent);
        insertReceipt(receipt);
      }).immediate();
    } catch (error) {
      if (grant.anchorRepair) {
        const replay = replayAnchorRepairConsumption(grant.grantId, input.nonce, input.trustedAuthorizedActorId);
        if (replay) return replay;
      }
      const verdict = error instanceof DurableOwnershipError
        ? error
        : new DurableOwnershipError((error as Error).message, 'ENACTMENT_REJECTED', 409);
      const rejected = await makeReceipt(grant.grantId, 'rejected', now(), {
        code: verdict.code,
        reason: verdict.message,
      });
      try {
        insertReceipt(rejected);
      } catch (receiptError) {
        throw new DurableOwnershipError(
          `takeover enactment failed (${verdict.code}) and its audit receipt could not be persisted: ${(receiptError as Error).message}`,
          'STORE_UNAVAILABLE',
          503,
        );
      }
      throw verdict;
    }
    return { grant, epoch, receipt, disposition, ...(grant.anchorRepair ? { idempotent: false } : {}) };
  }

  /**
   * Recover an ambiguously accepted repair from the same signed receipt store.
   * Purpose: duplicate delivery is a read, never a second ownership transition.
   * @param grantId Exact grant whose outcome is requested.
   * @param nonce Original retained nonce, still required after consumption.
   * @param actorId Verified same-owner actor requesting the read-back.
   * @returns Verified terminal outcome, or null while the grant is not consumed.
   */
  function replayAnchorRepairConsumption(grantId: string, nonce: string, actorId: string) {
    const row = selectGrant.get(grantId) as GrantRow | undefined;
    if (!row) return null;
    const view = grantView(row);
    const grant = view.grant;
    if (!grant.anchorRepair || view.state !== 'consumed') return null;
    if (actorId !== grant.authorizedActorId || actorId !== grant.successorActorId || sha256(nonce) !== grant.nonceHash) {
      throw new DurableOwnershipError('repair read-back requires the original actor and nonce', 'AUTHORITY_REQUIRED', 403);
    }
    const receipt = view.receipts.find(candidate => candidate.kind === 'consumed');
    const epochRow = receipt ? selectEpoch.get(receipt.details.successorEpochId) as EpochRow | undefined : undefined;
    if (!receipt || !epochRow) {
      throw new DurableOwnershipError('consumed repair is missing its signed terminal outcome', 'STORE_UNAVAILABLE', 503);
    }
    const epoch = verifiedEpoch(epochRow);
    if (
      epoch.takeoverGrantId !== grant.grantId || epoch.priorEpochId !== grant.predecessorEpochId
      || epoch.ownerAgentNodeId !== grant.successorAgentNodeId
      || epoch.successorSessionId !== grant.successorSessionId
      || receipt.details.successorClaimSetHash !== epoch.claimSetHash
      || canonicalOwnershipJson(receipt.details.anchorRepair) !== canonicalOwnershipJson(grant.anchorRepair)
    ) {
      throw new DurableOwnershipError('repair receipt and ownership epoch disagree', 'SIGNED_FACT_INVALID', 503);
    }
    const disposition = assertExactDisposition(receipt.details.disposition as TakeoverDisposition, grant);
    return { grant, epoch, receipt, disposition, idempotent: true };
  }

  async function markState(input: {
    epochId: string;
    state: 'stale' | 'abandoned';
    reason: string;
    authoredByAgentNodeId: string;
    authorizedActorId: string;
  }): Promise<void> {
    const row = selectEpoch.get(text(input.epochId, 'epochId')) as EpochRow | undefined;
    if (!row) throw new DurableOwnershipError('ownership epoch not found', 'EPOCH_NOT_FOUND', 404);
    verifiedEpoch(row);
    const author = requireAgentNode(input.authoredByAgentNodeId, 'authoredByAgentNodeId');
    const event = await signFact({
      eventId: `oevt_${randomUUID()}`,
      epochId: row.epoch_id,
      roadmapItemId: row.roadmap_item_id,
      kind: input.state === 'stale' ? 'stale-marked' : 'abandoned',
      state: input.state,
      authoredByAgentNodeId: author,
      authorizedActorId: text(input.authorizedActorId, 'authorizedActorId'),
      occurredAt: now(),
      details: { reason: narrative(input.reason, 'reason') },
      causedByEventId: null,
    });
    insertEvent(event);
  }

  function getProjection(roadmapSlug: string, harbor: string): OwnershipProjection {
    const item = roadmap(roadmapSlug, harbor);
    const epochs = (selectEpochs.all(item.id) as EpochRow[]).map(verifiedEpoch);
    const currentEpoch = epochs[0] ?? null;
    const currentState = currentEpoch
      ? (() => {
          const row = selectCurrentEvent.get(currentEpoch.epochId) as OwnershipEventRow | undefined;
          return row ? verifiedEvent(row).state : 'current';
        })()
      : null;
    const activeGrant = currentEpoch ? activeGrantForEpoch(currentEpoch.epochId, now()) : undefined;
    return {
      roadmapItemId: item.id,
      roadmapSlug: item.slug,
      currentOwner: item.assignee_id,
      currentEpoch,
      currentState,
      priorOwners: epochs.slice(1).map((epoch) => ({
        agentNodeId: epoch.ownerAgentNodeId,
        epochId: epoch.epochId,
        epochNumber: epoch.epochNumber,
      })),
      epochs,
      activeGrantId: activeGrant?.grant_id ?? null,
    };
  }

  function getGrant(grantId: string): DurableTakeoverGrantView | null {
    const row = selectGrant.get(grantId) as GrantRow | undefined;
    if (!row) return null;
    return grantView(row);
  }

  return {
    bootstrap,
    issue,
    consume,
    replayAnchorRepairPreparation,
    replayAnchorRepairConsumption,
    markState,
    getProjection,
    getGrant,
    expireDue,
  };
}

type DurableOwnershipKernel = ReturnType<typeof createDurableOwnershipKernel>;

interface CanonicalSessionRow {
  id: string;
  purpose: string;
  status: string;
  phase: string | null;
  agent_id: string | null;
  agent_node_id: string | null;
  worktree_id: string | null;
  identity_project: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  metadata: string | null;
  is_durable: number | null;
}

interface SessionNoteFact {
  id: number;
  content: string;
  type: string;
  created_at: number;
}

function metadataObject(raw: string | null): Record<string, unknown> {
  const parsed = raw ? parseJsonOr<unknown>(raw, null) : null;
  return isPlainObject(parsed) ? parsed : {};
}

function nestedObject(value: unknown, key: string): Record<string, unknown> | null {
  return isPlainObject(value) && isPlainObject(value[key]) ? value[key] as Record<string, unknown> : null;
}

function stampedSessionActor(metadata: Record<string, unknown>): string | null {
  const identity = nestedObject(metadata, 'identity');
  return identity?.verified === true && typeof identity.actorId === 'string' && identity.actorId.trim()
    ? identity.actorId.trim()
    : null;
}

function metadataWorktree(metadata: Record<string, unknown>): { id: string | null; root: string | null } {
  const worktree = nestedObject(metadata, 'worktree');
  return {
    id: typeof worktree?.id === 'string' && worktree.id.trim() ? worktree.id.trim() : null,
    root: typeof worktree?.root === 'string' && worktree.root.trim() ? worktree.root.trim() : null,
  };
}

function sessionLineageHash(row: CanonicalSessionRow): string {
  return sha256(canonicalOwnershipJson({
    id: row.id,
    purpose: row.purpose,
    status: row.status,
    phase: row.phase,
    agentId: row.agent_id,
    agentNodeId: row.agent_node_id,
    worktreeId: row.worktree_id,
    identityProject: row.identity_project,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    durable: row.is_durable === 1,
    metadataHash: sha256(row.metadata ?? ''),
  }));
}

function sessionWitness(row: CanonicalSessionRow): SessionOwnershipWitness {
  const metadata = metadataObject(row.metadata);
  const actorId = stampedSessionActor(metadata);
  const worktree = metadataWorktree(metadata);
  return {
    sessionId: row.id,
    agentNodeId: row.agent_node_id,
    actorId,
    identityVerified: actorId !== null,
    worktreeId: row.worktree_id,
    metadataWorktreeId: worktree.id,
    status: row.status,
    durable: row.is_durable === 1,
    lineageHash: sessionLineageHash(row),
  };
}

function gitText(root: string, args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 32 * 1024 * 1024,
    }).trim();
  } catch {
    throw new DurableOwnershipError(
      `cannot capture exact git fact: git ${args.join(' ')}`,
      'GRANT_BINDING_MISMATCH',
      409,
    );
  }
}

function gitBytes(root: string, args: string[]): Buffer {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'buffer',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    }) as Buffer;
  } catch {
    throw new DurableOwnershipError(
      `cannot capture exact git fact: git ${args.join(' ')}`,
      'GRANT_BINDING_MISMATCH',
      409,
    );
  }
}

function nulPaths(bytes: Buffer): string[] {
  return bytes.toString('utf8').split('\0').filter(Boolean);
}

function repoIdFromRemote(remote: string): string {
  return remote
    .replace(/^git@([^:]+):/, '$1/')
    .replace(/^https?:\/\//, '')
    .replace(/\.git$/, '')
    .replace(/\/$/, '');
}

function canonicalPhysicalPath(path: string): { realpath: string; physicalId: string } {
  try {
    const realpath = realpathSync(path);
    const stat = lstatSync(realpath, { bigint: true });
    return {
      realpath,
      physicalId: sha256(canonicalOwnershipJson({
        device: stat.dev.toString(),
        inode: stat.ino.toString(),
      })),
    };
  } catch {
    throw new DurableOwnershipError(
      `cannot resolve physical workspace identity for ${path}`,
      'GRANT_BINDING_MISMATCH',
      409,
    );
  }
}

/**
 * Hash an untracked regular file without loading it into daemon memory or
 * following a path that was swapped to a symlink after lstat. The before/open
 * and after witnesses make a racing replacement or in-place edit fail closed.
 */
function hashUntrackedRegularFile(absolute: string, before: BigIntStats): string {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(
      absolute,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
    );
    const opened = fstatSync(descriptor, { bigint: true });
    if (
      !opened.isFile()
      || opened.dev !== before.dev
      || opened.ino !== before.ino
      || opened.mode !== before.mode
      || opened.size !== before.size
      || opened.mtimeNs !== before.mtimeNs
      || opened.ctimeNs !== before.ctimeNs
    ) {
      throw new DurableOwnershipError(
        'untracked file changed identity before exact hashing',
        'GRANT_BINDING_MISMATCH',
        409,
      );
    }
    const digest = createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let bytesRead = 0;
    do {
      bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) digest.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
    const after = fstatSync(descriptor, { bigint: true });
    if (
      after.dev !== opened.dev
      || after.ino !== opened.ino
      || after.mode !== opened.mode
      || after.size !== opened.size
      || after.mtimeNs !== opened.mtimeNs
      || after.ctimeNs !== opened.ctimeNs
    ) {
      throw new DurableOwnershipError(
        'untracked file changed during exact hashing',
        'GRANT_BINDING_MISMATCH',
        409,
      );
    }
    return `sha256:${digest.digest('hex')}`;
  } catch (error) {
    if (error instanceof DurableOwnershipError) throw error;
    throw new DurableOwnershipError(
      `cannot safely hash untracked file ${absolute}`,
      'GRANT_BINDING_MISMATCH',
      409,
    );
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

/**
 * Capture the repository/worktree identity shared by AgentRun admission and
 * signed ownership grants. Paths alone are not sufficient: a deleted and
 * recreated worktree may reuse the same path-derived worktree id. The physical
 * root and git-dir identities make that replacement observable and fail closed.
 */
export function captureCanonicalGitWorkspace(
  worktreeRootInput: string,
): CanonicalGitWorkspaceIdentity {
  const info = getWorktreeInfo(worktreeRootInput);
  if (!info?.branch) {
    throw new DurableOwnershipError(
      'workspace is not an attached branch worktree',
      'GRANT_BINDING_MISMATCH',
      409,
    );
  }
  const worktree = canonicalPhysicalPath(info.root);
  const gitDirRaw = gitText(info.root, ['rev-parse', '--git-dir']);
  const commonDirRaw = gitText(info.root, ['rev-parse', '--git-common-dir']);
  const gitDir = canonicalPhysicalPath(isAbsolute(gitDirRaw) ? gitDirRaw : resolve(info.root, gitDirRaw));
  const commonDir = realpathSync(isAbsolute(commonDirRaw) ? commonDirRaw : resolve(info.root, commonDirRaw));
  const remote = gitText(info.root, ['remote', 'get-url', 'origin']);
  const head = gitText(info.root, ['rev-parse', 'HEAD']).toLowerCase();
  let base = '';
  for (const candidate of [
    ['merge-base', 'HEAD', '@{upstream}'],
    ['merge-base', 'HEAD', 'origin/HEAD'],
  ]) {
    try {
      base = execFileSync('git', candidate, {
        cwd: info.root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim().toLowerCase();
      if (base) break;
    } catch {
      // Fall through to the next daemon-derived base candidate.
    }
  }
  if (!base) {
    base = gitText(info.root, ['rev-list', '--max-parents=0', 'HEAD'])
      .split(/\s+/)[0]
      ?.toLowerCase() ?? '';
  }
  if (!COMMIT_RE.test(head) || !COMMIT_RE.test(base)) {
    throw new DurableOwnershipError(
      'workspace HEAD/base are not exact commit ids',
      'GRANT_BINDING_MISMATCH',
      409,
    );
  }
  return {
    repoId: repoIdFromRemote(remote),
    worktreeId: info.id,
    worktreeRoot: info.root,
    worktreeRealpath: worktree.realpath,
    worktreePhysicalId: worktree.physicalId,
    gitDirRealpath: gitDir.realpath,
    gitDirPhysicalId: gitDir.physicalId,
    repoCommonDir: commonDir,
    branch: info.branch,
    remote,
    head,
    base,
  };
}

function extractPrUrls(...values: unknown[]): string[] {
  const found = new Set<string>();
  const pattern = /https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+/g;
  for (const value of values) {
    let encoded = '';
    try {
      encoded = typeof value === 'string' ? value : JSON.stringify(value);
    } catch {
      continue;
    }
    for (const match of encoded.match(pattern) ?? []) found.add(match);
  }
  return [...found].sort();
}

function resolveSessionWorktreeRoot(row: CanonicalSessionRow, repoRoot: string): string {
  if (!row.worktree_id) {
    throw new DurableOwnershipError('session has no daemon-bound worktree id', 'SESSION_WORKTREE_SPLIT', 409);
  }
  const metadata = metadataObject(row.metadata);
  const metadataRoot = metadataWorktree(metadata).root;
  const candidates = [
    ...(metadataRoot ? [metadataRoot] : []),
    ...listWorktrees(repoRoot).filter(candidate => candidate.id === row.worktree_id).map(candidate => candidate.root),
  ];
  for (const candidate of Array.from(new Set(candidates))) {
    const info = getWorktreeInfo(candidate);
    if (info?.id === row.worktree_id && resolve(info.root) === resolve(candidate)) return info.root;
  }
  throw new DurableOwnershipError(
    `daemon cannot resolve session worktree ${row.worktree_id} to a live exact root`,
    'SESSION_WORKTREE_SPLIT',
    409,
  );
}

function captureExactWorkBinding(
  row: CanonicalSessionRow,
  repoRoot: string,
  citationSources: unknown[] = [],
): ExactWorkBinding {
  const worktreeRoot = resolveSessionWorktreeRoot(row, repoRoot);
  const workspace = captureCanonicalGitWorkspace(worktreeRoot);
  if (workspace.worktreeId !== row.worktree_id) {
    throw new DurableOwnershipError('session worktree is detached or changed identity', 'SESSION_WORKTREE_SPLIT', 409);
  }

  const trackedPaths = nulPaths(gitBytes(worktreeRoot, ['diff', '--name-only', '-z', 'HEAD', '--']));
  const untrackedPaths = nulPaths(gitBytes(worktreeRoot, ['ls-files', '--others', '--exclude-standard', '-z']));
  const dirtyPaths = Array.from(new Set([...trackedPaths, ...untrackedPaths])).sort();
  const untracked = untrackedPaths.sort().map(path => {
    const absolute = resolve(worktreeRoot, path);
    const root = resolve(worktreeRoot);
    if (absolute !== root && !absolute.startsWith(`${root}/`)) {
      throw new DurableOwnershipError('git returned an out-of-worktree path', 'GRANT_BINDING_MISMATCH', 409);
    }
    const stat = lstatSync(absolute, { bigint: true });
    if (!stat.isSymbolicLink() && !stat.isFile()) {
      throw new DurableOwnershipError(
        `untracked path is neither a regular file nor a symbolic link: ${path}`,
        'GRANT_BINDING_MISMATCH',
        409,
      );
    }
    const contentHash = stat.isSymbolicLink()
      ? sha256(Buffer.from(readlinkSync(absolute)))
      : hashUntrackedRegularFile(absolute, stat);
    return { path, mode: Number(stat.mode), contentHash };
  });
  const status = gitBytes(worktreeRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const diff = gitBytes(worktreeRoot, ['diff', '--binary', '--no-ext-diff', 'HEAD', '--']);
  const dirtyTreeHash = sha256(canonicalOwnershipJson({
    status: status.toString('base64'),
    diff: diff.toString('base64'),
    untracked,
  }));
  return normalizeExactWorkBinding({
    ...workspace,
    dirtyTreeHash,
    dirtyPaths,
    prUrls: extractPrUrls(metadataObject(row.metadata), ...citationSources),
  });
}

function ownershipGapFacts(witness: SessionOwnershipWitness, expectedAgentNodeId: string): string[] {
  const gaps: string[] = [];
  if (witness.agentNodeId !== expectedAgentNodeId) gaps.push('The predecessor session lacks the current owner AgentNode binding.');
  if (!witness.identityVerified || !witness.actorId) gaps.push('The predecessor session lacks a verified actor identity stamp.');
  if (!witness.durable) gaps.push('The predecessor session predates or lacks durable lifecycle binding.');
  if (!witness.worktreeId || !witness.metadataWorktreeId) gaps.push('The predecessor session lacks a complete worktree witness.');
  else if (witness.worktreeId !== witness.metadataWorktreeId) gaps.push('The predecessor session column and metadata name different worktrees.');
  if (witness.status === 'active') gaps.push('The predecessor session is still marked active; staleness is evidence only, not authority.');
  return gaps;
}

function boundedUtf8(value: string, maxBytes = 16 * 1024): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  let end = Math.min(value.length, maxBytes);
  while (end > 0 && Buffer.byteLength(value.slice(0, end), 'utf8') > maxBytes) end -= 1;
  return value.slice(0, end);
}

function roadmapDigestEntries(raw: string): DigestEntry[] {
  const value = parseJsonOr<unknown>(raw, []);
  if (!Array.isArray(value)) return [];
  return value.slice(-100).flatMap((entry, index) => {
    if (typeof entry === 'string' && entry.trim()) {
      return [{ id: `roadmap-note-${index + 1}`, at: null, text: boundedUtf8(entry.trim()), sourceRef: null }];
    }
    if (!isPlainObject(entry)) return [];
    const body = typeof entry.text === 'string'
      ? entry.text
      : typeof entry.content === 'string'
        ? entry.content
        : typeof entry.note === 'string'
          ? entry.note
          : null;
    if (!body?.trim()) return [];
    const timestamp = typeof entry.at === 'number' && Number.isFinite(entry.at)
      ? entry.at
      : typeof entry.createdAt === 'number' && Number.isFinite(entry.createdAt)
        ? entry.createdAt
        : null;
    return [{
      id: typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : `roadmap-note-${index + 1}`,
      at: timestamp,
      text: boundedUtf8(body.trim()),
      sourceRef: typeof entry.sourceRef === 'string' && entry.sourceRef.trim() ? entry.sourceRef.trim() : null,
    }];
  });
}

function evidenceFromText(entries: DigestEntry[]): EvidenceCitation[] {
  const evidence = new Map<string, EvidenceCitation>();
  for (const entry of entries) {
    for (const match of entry.text.match(/(?:porthole|logbook):\/\/[^\s)\]}>,]+/gi) ?? []) {
      const source = match.toLowerCase().startsWith('porthole://') ? 'porthole' : 'logbook';
      evidence.set(match, {
        source,
        ref: match,
        label: `Citation retained from ${entry.sourceRef ?? entry.id}`,
        contentHash: sha256(entry.text),
      });
    }
  }
  return [...evidence.values()];
}

function buildCanonicalBriefing(input: {
  now: number;
  item: RoadmapRow;
  currentEpoch: OwnershipEpoch;
  sourceRow: CanonicalSessionRow;
  sourceWitness: SessionOwnershipWitness;
  successorWitness: SuccessorSessionWitness;
  predecessorAgentNodeId: string;
  successorAgentNodeId: string;
  workBinding: ExactWorkBinding;
  claims: ExactClaimBinding[];
  notes: SessionNoteFact[];
  notesAvailable: boolean;
  getAgentNode?: DurableOwnershipServiceDeps['getAgentNode'];
  gitleaksRunner?: GitleaksRunner;
}): OwnershipSuccessorBrief {
  const sessionEntries = input.notes.map(note => ({
    id: `session-note-${note.id}`,
    at: note.created_at,
    text: boundedUtf8(note.content.trim() || '(empty durable note)'),
    sourceRef: `session-note:${note.id}`,
    type: note.type.toLowerCase(),
  }));
  const plans = sessionEntries
    .filter(entry => ['plan', 'todo', 'todo_list', 'checklist'].includes(entry.type))
    .map(({ type: _type, ...entry }) => entry);
  const decisions = sessionEntries.filter(entry => entry.type === 'decision');
  const blockers = sessionEntries.filter(entry => entry.type === 'blocker');
  const questions = sessionEntries
    .filter(entry => entry.type === 'question' || /\?\s*$/.test(entry.text))
    .map(({ type: _type, ...entry }) => entry);
  const roadmapNotes = roadmapDigestEntries(input.item.notes_json);
  const ordinaryNotes = sessionEntries
    .filter(entry => !['plan', 'todo', 'todo_list', 'checklist', 'decision', 'question'].includes(entry.type));
  const evidence = evidenceFromText([...roadmapNotes, ...sessionEntries]);
  evidence.unshift({
    source: 'receipt',
    ref: `ownership-epoch:${input.currentEpoch.epochId}`,
    label: `Signed ownership epoch ${input.currentEpoch.epochNumber}`,
    contentHash: input.currentEpoch.contentHash,
  });
  for (const claim of input.claims) {
    if (!claim.contentHash) continue;
    evidence.push({
      source: 'artifact',
      ref: `claim:${claim.claimNodeId}`,
      label: `${claim.selectorKind} claim for ${claim.filePath || '(repository)'}`,
      contentHash: claim.contentHash,
    });
  }
  const sourceMetadata = metadataObject(input.sourceRow.metadata);
  const adapter = typeof sourceMetadata.adapter === 'string' && sourceMetadata.adapter.trim()
    ? sourceMetadata.adapter.trim()
    : 'port-daddy-session-ledger';
  const transcriptRef = typeof sourceMetadata.transcriptRef === 'string' && sourceMetadata.transcriptRef.trim()
    ? sourceMetadata.transcriptRef.trim()
    : null;
  const knownGaps = ownershipGapFacts(input.sourceWitness, input.predecessorAgentNodeId);
  if (!input.notesAvailable) knownGaps.push('The canonical note store was unavailable; no session-note text was included.');
  if (!evidence.some(item => item.source === 'porthole')) knownGaps.push('No Porthole citation was present in the predecessor append-only notes.');
  if (!evidence.some(item => item.source === 'logbook')) knownGaps.push('No Logbook citation was present in the predecessor append-only notes.');
  knownGaps.push('No hidden model reasoning is available or claimed.');
  const successorProfile = input.getAgentNode?.(input.successorAgentNodeId)?.profile;
  const remit = input.item.description_md?.trim()
    || successorProfile?.remit?.trim()
    || input.item.summary_md;
  const rawCapsule = {
    schema: 'pd.agent-harbor.handoff-capsule.v0',
    capsuleId: `capsule_${randomUUID()}`,
    capturedAt: new Date(input.now).toISOString(),
    source: {
      adapter,
      sessionId: input.sourceRow.id,
      agentId: input.predecessorAgentNodeId,
      workflowId: null,
      transcriptRef,
    },
    target: { adapter: null, agentId: input.successorAgentNodeId },
    identity: {
      project: input.sourceRow.identity_project,
      projectDir: input.workBinding.worktreeRoot,
      harbor: input.item.harbor,
    },
    workspace: {
      cwd: input.workBinding.worktreeRoot,
      repoRoot: input.workBinding.worktreeRoot,
      branch: input.workBinding.branch,
      worktreeId: input.workBinding.worktreeId,
      gitHead: input.workBinding.head,
      dirtyFiles: input.workBinding.dirtyPaths,
    },
    telos: input.item.summary_md,
    // Session notes have no per-note author column. Keep them in the
    // coordination lane instead of pretending they are operator turns or
    // reconstructing private reasoning.
    operatorTurns: [],
    decisions: decisions.map(entry => ({
      id: entry.id,
      at: entry.at === null ? null : new Date(entry.at).toISOString(),
      text: entry.text,
      source: 'coordination',
    })),
    coordination: [...blockers, ...ordinaryNotes].slice(-100).map(entry => ({
      id: entry.id,
      at: entry.at === null ? null : new Date(entry.at).toISOString(),
      text: entry.text,
      kind: entry.type === 'blocker' ? 'blocker' : 'note',
    })),
    artifacts: input.claims.map(claim => ({
      path: claim.filePath || input.workBinding.worktreeRoot,
      kind: claim.selectorKind,
      summary: `${claim.disposition} ${claim.mode} claim ${claim.claimNodeId}`,
      sourceBlockId: claim.claimNodeId,
    })),
    tail: [],
  };
  const capsule = sanitizeHandoffCapsule(rawCapsule, {
    tokenBudget: 12_000,
    ...(input.gitleaksRunner ? { gitleaksRunner: input.gitleaksRunner } : {}),
  });
  const handoff = buildHandoffSuccessorBrief(
    capsule,
    `Continue roadmap item ${input.item.slug} from its signed ownership grant and revalidate all exact facts before acting.`,
    input.successorAgentNodeId,
  );
  return buildOwnershipSuccessorBrief({
    generatedAt: input.now,
    predecessorAgentNodeId: input.predecessorAgentNodeId,
    successorAgentNodeId: input.successorAgentNodeId,
    sourceSessionId: input.sourceRow.id,
    successorSessionId: input.successorWitness.sessionId,
    roadmap: {
      itemId: input.item.id,
      slug: input.item.slug,
      status: input.item.status,
      summary: input.item.summary_md,
      remit,
    },
    exactWork: input.workBinding,
    handoff,
    plans,
    roadmapNotes: [
      ...roadmapNotes,
      ...ordinaryNotes.map(({ type: _type, ...entry }) => entry),
    ],
    unresolvedQuestions: questions,
    evidence,
    claims: input.claims,
    knownGaps,
    omittedSources: [
      'Provider-private chain of thought',
      'Raw transcripts not represented by a cited, sanitized handoff artifact',
    ],
  });
}

function sessionIsCanonicallyBound(
  witness: SessionOwnershipWitness,
  expectedAgentNodeId: string,
): boolean {
  return witness.agentNodeId === expectedAgentNodeId
    && witness.identityVerified
    && witness.actorId !== null
    && witness.durable
    && witness.worktreeId !== null
    && witness.metadataWorktreeId === witness.worktreeId;
}

/**
 * Public durable-ownership coordinator.
 *
 * Request callers name only the roadmap item, successor session, reason, and
 * exact claim dispositions. Every authority-bearing fact (actor, AgentNode,
 * session lineage, git state, claims, and briefing) is captured from daemon
 * stores here. The lower-level kernel is intentionally not exported.
 * @param db Existing coordination and append-only ownership database.
 * @param deps Daemon-owned actor, roster, signing, clock, and workspace services.
 * @returns Coordinator that derives authority from canonical evidence.
 */
export function createDurableOwnershipService(db: DatabaseInstance, deps: DurableOwnershipServiceDeps) {
  const kernel: DurableOwnershipKernel = createDurableOwnershipKernel(db, deps);
  const claimForest = createClaimForest(db);
  claimForest.backfillFromSessionFiles();
  const now = deps.now ?? Date.now;
  const staleAfterMs = deps.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  if (!Number.isFinite(staleAfterMs) || staleAfterMs < 60_000) {
    throw new DurableOwnershipError('staleAfterMs must be at least one minute', 'VALIDATION_ERROR', 400);
  }

  const selectSession = db.prepare(`
    SELECT id, purpose, status, phase, agent_id, agent_node_id, worktree_id,
           identity_project, created_at, updated_at, completed_at, metadata, is_durable
    FROM sessions WHERE id = ?
  `);
  const selectRoadmap = db.prepare(`
    SELECT id, slug, harbor, assignee_id, summary_md, description_md, notes_json, status
    FROM roadmap_items WHERE slug = ? AND harbor = ? AND deleted_at IS NULL
  `);

  function roadmapRow(slug: string, harbor: string): RoadmapRow {
    const row = selectRoadmap.get(text(slug, 'roadmapSlug'), text(harbor, 'harbor')) as RoadmapRow | undefined;
    if (!row) throw new DurableOwnershipError('roadmap item not found', 'ROADMAP_ITEM_NOT_FOUND', 404);
    return row;
  }

  function getSession(sessionId: string): CanonicalSessionRow {
    const row = selectSession.get(text(sessionId, 'sessionId')) as CanonicalSessionRow | undefined;
    if (!row) throw new DurableOwnershipError('session not found', 'GRANT_BINDING_MISMATCH', 404);
    return row;
  }

  function canonicalAgentRunNodes(sessionId: string): string[] {
    const table = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'harbor_events'",
    ).get();
    if (!table) return [];
    return (db.prepare(`
      SELECT DISTINCT agent_node_id
      FROM harbor_events
      WHERE stream_type = 'agent-run' AND session_id = ? AND agent_node_id IS NOT NULL
      ORDER BY agent_node_id
    `).all(sessionId) as Array<{ agent_node_id: string }>).map(row => row.agent_node_id);
  }

  /**
   * Materialize an already authoritative AgentRun/session join into the
   * sessions and claim read models. This does not mint authority: a missing or
   * ambiguous AgentRun fails closed, and any non-null disagreement aborts.
   */
  function bindSessionFromCanonicalRun(
    initial: CanonicalSessionRow,
    options: { required: boolean; expectedAgentNodeId?: string },
  ): CanonicalSessionRow {
    let agentNodeId = initial.agent_node_id;
    const eventNodes = canonicalAgentRunNodes(initial.id);
    if (eventNodes.length > 1) {
      throw new DurableOwnershipError(
        'session has AgentRun facts for multiple AgentNodes',
        'SESSION_AGENT_NODE_MISMATCH',
        409,
      );
    }
    if (agentNodeId && eventNodes.length === 1 && eventNodes[0] !== agentNodeId) {
      throw new DurableOwnershipError(
        'session AgentNode column disagrees with its canonical AgentRun',
        'SESSION_AGENT_NODE_MISMATCH',
        409,
      );
    }
    agentNodeId ??= eventNodes[0] ?? null;
    if (!agentNodeId) {
      if (options.required) {
        throw new DurableOwnershipError(
          'session has no canonical AgentNode or daemon-authored AgentRun binding',
          'SESSION_AGENT_NODE_MISMATCH',
          409,
        );
      }
      return initial;
    }
    if (options.expectedAgentNodeId && agentNodeId !== options.expectedAgentNodeId) {
      throw new DurableOwnershipError(
        'session is bound to a different AgentNode than the ownership epoch',
        'SESSION_AGENT_NODE_MISMATCH',
        409,
      );
    }
    if (!deps.agentNodeExists(agentNodeId)) {
      throw new DurableOwnershipError('session AgentNode is not on the durable roster', 'AGENT_NODE_NOT_FOUND', 404);
    }

    db.transaction(() => {
      const live = selectSession.get(initial.id) as CanonicalSessionRow | undefined;
      if (!live) throw new DurableOwnershipError('session disappeared during AgentNode binding', 'STORE_UNAVAILABLE', 503);
      if (live.agent_node_id && live.agent_node_id !== agentNodeId) {
        throw new DurableOwnershipError('session AgentNode changed during binding', 'SESSION_AGENT_NODE_MISMATCH', 409);
      }
      const mismatchedLegacy = db.prepare(`
        SELECT COUNT(*) AS count FROM session_files
        WHERE session_id = ? AND agent_node_id IS NOT NULL AND agent_node_id != ?
      `).get(initial.id, agentNodeId) as { count: number };
      const mismatchedForest = db.prepare(`
        SELECT COUNT(*) AS count FROM claim_forest_claims
        WHERE session_id = ? AND agent_node_id IS NOT NULL AND agent_node_id != ?
      `).get(initial.id, agentNodeId) as { count: number };
      if (mismatchedLegacy.count > 0 || mismatchedForest.count > 0) {
        throw new DurableOwnershipError(
          'session claims disagree with the canonical AgentNode binding',
          'SESSION_AGENT_NODE_MISMATCH',
          409,
        );
      }
      db.prepare('UPDATE sessions SET agent_node_id = ? WHERE id = ? AND agent_node_id IS NULL')
        .run(agentNodeId, initial.id);
      db.prepare('UPDATE session_files SET agent_node_id = ? WHERE session_id = ? AND agent_node_id IS NULL')
        .run(agentNodeId, initial.id);
      db.prepare('UPDATE claim_forest_claims SET agent_node_id = ? WHERE session_id = ? AND agent_node_id IS NULL')
        .run(agentNodeId, initial.id);
    }).immediate();
    return getSession(initial.id);
  }

  function exactWork(row: CanonicalSessionRow, citations: unknown[] = []): ExactWorkBinding {
    const binding = deps.workBindingProbe
      ? normalizeExactWorkBinding(deps.workBindingProbe(row.id))
      : captureExactWorkBinding(row, deps.repoRoot, citations);
    if (binding.worktreeId !== row.worktree_id) {
      throw new DurableOwnershipError(
        'captured work binding does not match the daemon session worktree',
        'SESSION_WORKTREE_SPLIT',
        409,
      );
    }
    return binding;
  }

  function exactWorkForRoadmap(row: CanonicalSessionRow, item: RoadmapRow): ExactWorkBinding {
    // Keep issuance and consumption on one daemon-derived citation surface.
    // The roadmap note and session metadata are the only mutable stores from
    // which a PR URL may enter the exact work binding.
    return exactWork(row, [item.notes_json, row.metadata]);
  }

  function exactClaims(
    sessionId: string,
    dispositions?: RequestedClaimDisposition[],
  ): ExactClaimBinding[] {
    const active = claimForest.listClaimsForSession(sessionId)
      .filter(claim => claim.releasedAt === null);
    let dispositionByNode: Map<string, 'transfer' | 'release'> | null = null;
    if (dispositions !== undefined) {
      if (!Array.isArray(dispositions)) {
        throw new DurableOwnershipError('claimDispositions must be an array', 'VALIDATION_ERROR', 400);
      }
      dispositionByNode = new Map();
      for (const [index, raw] of dispositions.entries()) {
        if (!isPlainObject(raw)) {
          throw new DurableOwnershipError(`claimDispositions[${index}] must be an object`, 'VALIDATION_ERROR', 400);
        }
        const unknown = Object.keys(raw).find(key => key !== 'claimNodeId' && key !== 'disposition');
        if (unknown) {
          throw new DurableOwnershipError(
            `claimDispositions[${index}] contains unknown field ${unknown}`,
            'VALIDATION_ERROR',
            400,
          );
        }
        const claimNodeId = text(raw.claimNodeId, `claimDispositions[${index}].claimNodeId`);
        if (raw.disposition !== 'transfer' && raw.disposition !== 'release') {
          throw new DurableOwnershipError(
            `claimDispositions[${index}].disposition must be transfer or release`,
            'VALIDATION_ERROR',
            400,
          );
        }
        if (dispositionByNode.has(claimNodeId)) {
          throw new DurableOwnershipError('claimDispositions contains duplicate claimNodeId values', 'VALIDATION_ERROR', 400);
        }
        dispositionByNode.set(claimNodeId, raw.disposition);
      }
      const activeIds = active.map(claim => claim.nodeId).sort();
      const requestedIds = [...dispositionByNode.keys()].sort();
      if (canonicalOwnershipJson(activeIds) !== canonicalOwnershipJson(requestedIds)) {
        throw new DurableOwnershipError(
          'claimDispositions must explicitly transfer or release every active predecessor claim and no others',
          'CLAIM_SET_MISMATCH',
          409,
        );
      }
    }
    return normalizeClaimBindings(active.map(claim => ({
      claimNodeId: claim.nodeId,
      filePath: claim.filePath,
      selectorKind: claim.selectorKind,
      startLine: claim.startLine,
      endLine: claim.endLine,
      symbol: claim.symbol,
      symbolPath: claim.symbolPath,
      worldKind: claim.worldKind,
      worldId: claim.worldId,
      claimedAt: claim.claimedAt,
      mode: claim.mode,
      contentHash: claim.contentHash,
      disposition: dispositionByNode?.get(claim.nodeId) ?? 'retain',
    })));
  }

  /**
   * Authorize exact ownership/briefing projection from already verified,
   * signed facts. Operators are handled by the transport; this method answers
   * whether an ordinary actor is a historical/current owner or grant party.
   */
  function actorCanReadDetails(roadmapSlug: string, harbor: string, actorId: string): boolean {
    const normalizedActor = text(actorId, 'actorId');
    const projection = kernel.getProjection(roadmapSlug, harbor);
    if (projection.epochs.some(epoch => epoch.authorizedActorId === normalizedActor)) return true;
    const grantIds = new Set<string>();
    if (projection.activeGrantId) grantIds.add(projection.activeGrantId);
    for (const epoch of projection.epochs) {
      if (epoch.takeoverGrantId) grantIds.add(epoch.takeoverGrantId);
    }
    for (const grantId of grantIds) {
      const view = kernel.getGrant(grantId);
      if (
        view
        && (view.grant.authorizedActorId === normalizedActor || view.grant.successorActorId === normalizedActor)
      ) return true;
    }
    return false;
  }

  function assertNoSuccessorClaimOverlap(successorSessionId: string, claims: ExactClaimBinding[]): void {
    const successorNodeIds = new Set(
      claimForest.listClaimsForSession(successorSessionId)
        .filter(claim => claim.releasedAt === null)
        .map(claim => claim.nodeId),
    );
    const overlap = claims
      .filter(claim => claim.disposition === 'transfer' && successorNodeIds.has(claim.claimNodeId))
      .map(claim => claim.claimNodeId);
    if (overlap.length > 0) {
      throw new DurableOwnershipError(
        `successor already holds claims selected for transfer: ${overlap.join(', ')}`,
        'CLAIM_SET_MISMATCH',
        409,
      );
    }
  }

  function canonicalNotes(sessionId: string): { notes: SessionNoteFact[]; available: boolean } {
    if (!deps.readSessionNotes) return { notes: [], available: false };
    try {
      const notes = deps.readSessionNotes(sessionId).slice(-500).map(note => ({
        id: note.id,
        content: boundedUtf8(note.content),
        type: note.type,
        created_at: note.createdAt,
      }));
      return { notes, available: true };
    } catch {
      return { notes: [], available: false };
    }
  }

  function verifiedActor(actor: VerifiedOwnershipActor): VerifiedOwnershipActor {
    if (!actor || typeof actor.actorId !== 'string' || !actor.actorId.trim() || actor.soulClass === 'unknown') {
      throw new DurableOwnershipError('a verified daemon actor is required', 'AUTHORITY_REQUIRED', 403);
    }
    return { actorId: actor.actorId.trim(), soulClass: actor.soulClass };
  }

  function assertSuccessorSession(
    row: CanonicalSessionRow,
    sourceSessionId: string,
    workBinding: ExactWorkBinding,
  ): SuccessorSessionWitness {
    const witness = sessionWitness(row);
    if (
      row.id === sourceSessionId
      || row.status !== 'active'
      || row.is_durable !== 1
      || !row.agent_node_id
      || !witness.actorId
      || !witness.identityVerified
      || witness.worktreeId !== workBinding.worktreeId
      || witness.metadataWorktreeId !== workBinding.worktreeId
    ) {
      throw new DurableOwnershipError(
        'successor must be a distinct active durable session with exact AgentNode, actor, and worktree bindings',
        'SESSION_AGENT_NODE_MISMATCH',
        409,
      );
    }
    const record = deps.getAgentNode?.(row.agent_node_id);
    if (record?.profile?.lifecycle === 'retired') {
      throw new DurableOwnershipError('retired AgentNode cannot become current owner', 'AGENT_NODE_NOT_FOUND', 409);
    }
    return witness as SuccessorSessionWitness;
  }

  /**
   * A takeover consumes identity already admitted by the daemon planner. It
   * must never turn a caller-selected roster id into a canonical AgentRun.
   * The append-only AgentRun is the durable body-to-node admission witness;
   * the session and its verified actor are merely the live body projection.
   * The intent of read-only repair validation is never to create admission.
   * @param initial Successor session read from the canonical session store.
   * @param workBinding Independently captured physical worktree and exact Git state.
   * @param harbor Roadmap scope in which the existing admission must be valid.
   * @param materialize Whether ordinary takeover may project an existing admission;
   * repair passes false and requires the session column to be bound already.
   * @returns Successor whose actor, AgentRun, AgentNode, and workspace agree.
   */
  function bindAdmittedSuccessor(
    initial: CanonicalSessionRow,
    workBinding: ExactWorkBinding,
    harbor: string,
    materialize = true,
  ): CanonicalSessionRow {
    const rows = db.prepare(`
      SELECT agent_node_id, session_id, payload_json
      FROM harbor_events
      WHERE stream_type = 'agent-run' AND session_id = ?
      ORDER BY ledger_seq
    `).all(initial.id) as Array<{
      agent_node_id: string | null;
      session_id: string | null;
      payload_json: string;
    }>;
    if (rows.length === 0) {
      throw new DurableOwnershipError(
        'successor session has no daemon-admitted AgentRun',
        'SUCCESSOR_ADMISSION_REQUIRED',
        409,
      );
    }

    const witness = sessionWitness(initial);
    const nodes = new Set<string>();
    for (const row of rows) {
      let payload: Record<string, unknown>;
      try {
        const decoded = JSON.parse(row.payload_json) as unknown;
        if (!isPlainObject(decoded)) throw new Error('not an object');
        payload = decoded;
      } catch {
        throw new DurableOwnershipError(
          'successor AgentRun admission is malformed',
          'SUCCESSOR_ADMISSION_INVALID',
          503,
        );
      }
      const agentNodeId = typeof payload.agentNodeId === 'string' ? payload.agentNodeId : '';
      const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : '';
      const bodyId = typeof payload.bodyId === 'string' ? payload.bodyId : '';
      const workspace = isPlainObject(payload.workspace) ? payload.workspace : null;
      const admission = isPlainObject(payload.admission) ? payload.admission : null;
      const record = agentNodeId ? deps.getAgentNode?.(agentNodeId) : null;
      const origin = record?.profile?.origin;
      const scope = record?.profile?.scope;
      const expectedRepo = scope?.repoRoot ?? workBinding.worktreeRoot;
      if (
        payload.schema !== 'pd.agent-harbor.agent-run.v0'
        || !agentNodeId
        || row.agent_node_id !== agentNodeId
        || row.session_id !== initial.id
        || sessionId !== initial.id
        || !initial.agent_id
        || bodyId !== initial.agent_id
        || !workspace
        || !admission
        || admission.kind !== 'verified-session-promotion'
        || !witness.actorId
        || admission.authorizedActorId !== witness.actorId
        || admission.harbor !== harbor
        || origin?.kind !== 'session-promotion'
        || origin.sourceSessionId !== initial.id
        || origin.sourceAgentId !== initial.agent_id
        || admission.sourceAdapter !== origin.sourceAdapter
        || admission.handoffEpisodeId !== origin.handoffEpisodeId
        || admission.profileRevision !== record?.profile?.revision
        || admission.profileLedgerSeq !== record?.ledgerSeq
        || workspace.repo !== expectedRepo
        || workspace.repoId !== workBinding.repoId
        || workspace.repoScopeKey !== scope?.key
        || workspace.repoCommonDir !== workBinding.repoCommonDir
        || workspace.worktree !== workBinding.worktreeRoot
        || workspace.worktreeId !== workBinding.worktreeId
        || workspace.worktreeRealpath !== workBinding.worktreeRealpath
        || workspace.worktreePhysicalId !== workBinding.worktreePhysicalId
        || workspace.gitDirRealpath !== workBinding.gitDirRealpath
        || workspace.gitDirPhysicalId !== workBinding.gitDirPhysicalId
        || workspace.branch !== workBinding.branch
        || workspace.headCommit !== workBinding.head
        || workspace.baseCommit !== workBinding.base
      ) {
        throw new DurableOwnershipError(
          'successor AgentRun does not exactly bind the session body, AgentNode, and worktree',
          'SUCCESSOR_ADMISSION_INVALID',
          409,
        );
      }
      nodes.add(agentNodeId);
    }
    if (nodes.size !== 1) {
      throw new DurableOwnershipError(
        'successor session has admissions for multiple AgentNodes',
        'SESSION_AGENT_NODE_MISMATCH',
        409,
      );
    }
    const [agentNodeId] = [...nodes];
    if (!deps.agentNodeExists(agentNodeId)) {
      throw new DurableOwnershipError('successor AgentNode is not on the durable roster', 'AGENT_NODE_NOT_FOUND', 404);
    }
    if (!materialize) {
      if (initial.agent_node_id !== agentNodeId) {
        throw new DurableOwnershipError('repair successor has not been canonically materialized', 'SUCCESSOR_ADMISSION_REQUIRED', 409);
      }
      return initial;
    }
    return bindSessionFromCanonicalRun(initial, { required: true, expectedAgentNodeId: agentNodeId });
  }

  /**
   * Inspect a repair without fixing identity columns or touching old claims.
   * The design admits only an already canonical same-owner successor at the
   * recorded source ROOT, whose physical identity is independently re-probed.
   * A new alias, a roster lookup, or a mismatched metadata id is not authority.
   * @param source Exact historical owner session; its old world is preserved.
   * @param successor Already admitted, empty destination session.
   * @param item Canonical roadmap projection used for citations and scope.
   * @param actorId Verified transport actor consenting to its own lease repair.
   * @param ownerAgentNodeId Signed current epoch's canonical owner.
   * @returns Verified witnesses and freshly captured destination Git state.
   */
  function inspectSameOwnerAnchorRepair(
    source: CanonicalSessionRow,
    successor: CanonicalSessionRow,
    item: RoadmapRow,
    actorId: string,
    ownerAgentNodeId: string,
  ) {
    const sourceWitness = sessionWitness(source);
    const successorIdentity = sessionWitness(successor);
    if (
      sourceWitness.actorId !== actorId || successorIdentity.actorId !== actorId
      || source.agent_node_id !== ownerAgentNodeId || successor.agent_node_id !== ownerAgentNodeId
      || !sessionIsCanonicallyBound(sourceWitness, ownerAgentNodeId)
      || !sessionIsCanonicallyBound(successorIdentity, ownerAgentNodeId)
    ) {
      throw new DurableOwnershipError('repair requires two real canonical sessions of the same AgentNode and verified actor', 'AUTHORITY_REQUIRED', 403);
    }
    const sourceNodes = canonicalAgentRunNodes(source.id);
    if (sourceNodes.length !== 1 || sourceNodes[0] !== ownerAgentNodeId) {
      throw new DurableOwnershipError('repair source lacks one canonical AgentRun witness', 'SESSION_AGENT_NODE_MISMATCH', 409);
    }
    const workBinding = exactWork(successor, [item.notes_json, source.metadata, successor.metadata]);
    const recordedRoot = metadataWorktree(metadataObject(source.metadata)).root;
    if (
      !recordedRoot || recordedRoot !== workBinding.worktreeRoot
      || source.worktree_id === workBinding.worktreeId
    ) {
      throw new DurableOwnershipError('repair must resolve the recorded root into a different independently probed worktree id', 'SESSION_WORKTREE_SPLIT', 409);
    }
    // Validation only: never let preparation materialize identity or claims.
    bindAdmittedSuccessor(successor, workBinding, item.harbor, false);
    const successorWitness = assertSuccessorSession(successor, source.id, workBinding);
    if (exactClaims(successor.id).length !== 0) {
      throw new DurableOwnershipError('repair successor already holds claims', 'CLAIM_SET_MISMATCH', 409);
    }
    return { sourceWitness, successorWitness, workBinding, recordedRoot };
  }

  /**
   * Prepare explicit same-owner repair in the existing signed takeover ledger.
   * Motivation: a stale anchor must not require abandoning work first, but
   * neither may it become generic cross-world or cross-owner takeover power.
   * All side effects here are append-only grant/receipt facts; sessions and
   * claims change only when the exact consent is consumed atomically.
   * @param request Bounded intent plus retained idempotency key and nonce.
   * @param caller Already verified transport identity; aliases are insufficient.
   * @returns Signed grant, compact briefing and safe idempotent read-back state.
   */
  async function prepareSameOwnerAnchorRepair(
    request: PrepareSameOwnerAnchorRepairRequest,
    caller: VerifiedOwnershipActor,
  ) {
    const actor = verifiedActor(caller);
    if (!isPlainObject(request) || Object.keys(request).some(key => ![
      'roadmapSlug', 'harbor', 'successorSessionId', 'reason', 'claimDispositions',
      'idempotencyKey', 'nonce', 'ttlMs',
    ].includes(key))) {
      throw new DurableOwnershipError('unknown or invalid repair request field', 'VALIDATION_ERROR', 400);
    }
    const idempotencyKey = text(request.idempotencyKey, 'idempotencyKey', 128);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(idempotencyKey)) {
      throw new DurableOwnershipError('invalid repair idempotency key', 'VALIDATION_ERROR', 400);
    }
    const nonce = anchorRepairNonce(request.nonce);
    if (!Array.isArray(request.claimDispositions) || request.claimDispositions.length > 5000) {
      throw new DurableOwnershipError('claimDispositions exceeds the bounded repair contract', 'VALIDATION_ERROR', 400);
    }
    const requestHash = sha256(canonicalOwnershipJson({
      roadmapSlug: text(request.roadmapSlug, 'roadmapSlug'), harbor: text(request.harbor, 'harbor'),
      successorSessionId: text(request.successorSessionId, 'successorSessionId'),
      reason: narrative(request.reason, 'reason'),
      claimDispositions: [...request.claimDispositions].sort((a, b) => String(a?.claimNodeId).localeCompare(String(b?.claimNodeId))),
      ttlMs: request.ttlMs ?? DEFAULT_TTL_MS, nonceHash: sha256(nonce),
    }));
    const replay = kernel.replayAnchorRepairPreparation(idempotencyKey, requestHash, nonce, actor.actorId);
    if (replay) return replay;

    const item = roadmapRow(request.roadmapSlug, request.harbor);
    const projection = kernel.getProjection(item.slug, item.harbor);
    const current = projection.currentEpoch;
    if (!current) throw new DurableOwnershipError('repair requires a real canonical ownership epoch', 'EPOCH_NOT_FOUND', 409);
    if (projection.currentOwner !== current.ownerAgentNodeId) {
      throw new DurableOwnershipError('roadmap and signed epoch owners disagree', 'OWNER_MISMATCH', 409);
    }
    const source = getSession(current.successorSessionId ?? current.sourceSessionId ?? '');
    const successor = getSession(request.successorSessionId);
    const inspected = inspectSameOwnerAnchorRepair(source, successor, item, actor.actorId, current.ownerAgentNodeId);
    const { sourceWitness, successorWitness, workBinding } = inspected;
    if (workBinding.repoId !== current.workBinding.repoId || workBinding.repoCommonDir !== current.workBinding.repoCommonDir) {
      throw new DurableOwnershipError('anchor repair cannot move work to a different repository', 'GRANT_BINDING_MISMATCH', 409);
    }
    const claims = exactClaims(source.id, request.claimDispositions);
    const anchorRepair: SameOwnerAnchorRepair = {
      schema: ANCHOR_REPAIR_SCHEMA, idempotencyKey, requestHash,
      sourceWorktreeId: source.worktree_id!, sourceWorktreeRoot: inspected.recordedRoot,
      sourceLineageHash: sourceWitness.lineageHash!, targetWorktreeId: workBinding.worktreeId,
      claimNodeMappings: claimForest.planAnchorRepairClaimMappings(source.id, claims, workBinding.worktreeId),
    };
    const notes = canonicalNotes(source.id);
    const originalBriefing = buildCanonicalBriefing({
      now: now(), item, currentEpoch: current, sourceRow: source, sourceWitness, successorWitness,
      predecessorAgentNodeId: current.ownerAgentNodeId, successorAgentNodeId: current.ownerAgentNodeId,
      workBinding, claims, notes: notes.notes, notesAvailable: notes.available,
      getAgentNode: deps.getAgentNode, gitleaksRunner: deps.gitleaksRunner,
    });
    const briefing = buildOwnershipSuccessorBrief({
      ...originalBriefing,
      knownGaps: [...originalBriefing.knownGaps,
        `Recorded source world ${source.worktree_id} is historical, not physical-workspace proof; explicit repair targets ${workBinding.worktreeId}.`],
    });
    return kernel.issue({
      roadmapSlug: item.slug, harbor: item.harbor, predecessorEpochId: current.epochId,
      predecessorAgentNodeId: current.ownerAgentNodeId, successorAgentNodeId: current.ownerAgentNodeId,
      trustedIssuerAgentNodeId: current.ownerAgentNodeId, trustedAuthorizedActorId: actor.actorId,
      successorActorId: actor.actorId, authorityKind: 'current-owner', operatorPresenceReceipt: null,
      reason: request.reason, sourceSessionId: source.id, successorSessionId: successor.id,
      sourceWitness, successorWitness, predecessorEvidenceGap: null,
      workBinding, claimBindings: claims, briefing, ttlMs: request.ttlMs, anchorRepair, nonce,
    });
  }

  async function bootstrapCanonical(
    request: BootstrapCanonicalOwnershipRequest,
    caller: VerifiedOwnershipActor,
  ) {
    const actor = verifiedActor(caller);
    const item = roadmapRow(request.roadmapSlug, request.harbor);
    let source = bindSessionFromCanonicalRun(getSession(request.sourceSessionId), { required: true });
    const witness = sessionWitness(source);
    if (
      source.status !== 'active'
      || !source.agent_node_id
      || !sessionIsCanonicallyBound(witness, source.agent_node_id)
    ) {
      throw new DurableOwnershipError(
        'initial ownership requires an active durable session with canonical AgentNode, actor, and worktree bindings',
        'SESSION_AGENT_NODE_MISMATCH',
        409,
      );
    }
    if (item.assignee_id !== source.agent_node_id) {
      throw new DurableOwnershipError('roadmap owner and source session AgentNode disagree', 'OWNER_MISMATCH', 409);
    }
    if (witness.actorId !== actor.actorId) {
      throw new DurableOwnershipError('caller is not the actor bound to the owner session', 'AUTHORITY_REQUIRED', 403);
    }
    const workBinding = exactWorkForRoadmap(source, item);
    const claims = exactClaims(source.id);
    return kernel.bootstrap({
      roadmapSlug: item.slug,
      harbor: item.harbor,
      ownerAgentNodeId: source.agent_node_id,
      authoredByAgentNodeId: source.agent_node_id,
      authorizedActorId: actor.actorId,
      sourceSessionId: source.id,
      workBinding,
      claimBindings: claims,
      reason: request.reason,
    });
  }

  async function prepareTakeover(
    request: PrepareDurableTakeoverRequest,
    caller: VerifiedOwnershipActor,
  ) {
    const actor = verifiedActor(caller);
    const item = roadmapRow(request.roadmapSlug, request.harbor);
    const projection = kernel.getProjection(item.slug, item.harbor);
    const current = projection.currentEpoch;
    if (!current || !projection.currentOwner) {
      throw new DurableOwnershipError('roadmap item has no canonical ownership epoch', 'EPOCH_NOT_FOUND', 409);
    }
    if (current.ownerAgentNodeId !== projection.currentOwner) {
      throw new DurableOwnershipError('roadmap owner and current ownership epoch disagree', 'OWNER_MISMATCH', 409);
    }
    const sourceSessionId = current.successorSessionId ?? current.sourceSessionId;
    if (!sourceSessionId) {
      throw new DurableOwnershipError('current ownership epoch has no source session', 'EPOCH_CONFLICT', 409);
    }
    const authorityKind: TakeoverAuthorityKind = actor.soulClass === 'operator' ? 'operator' : 'current-owner';
    let source = bindSessionFromCanonicalRun(getSession(sourceSessionId), {
      required: authorityKind === 'current-owner',
      expectedAgentNodeId: authorityKind === 'current-owner' ? current.ownerAgentNodeId : undefined,
    });
    const sourceWitness = sessionWitness(source);
    if (authorityKind === 'current-owner' && sourceWitness.actorId !== actor.actorId) {
      throw new DurableOwnershipError('caller is not the actor bound to the current owner session', 'AUTHORITY_REQUIRED', 403);
    }
    if (
      authorityKind === 'operator'
      && source.status === 'active'
      && source.updated_at > now() - staleAfterMs
    ) {
      throw new DurableOwnershipError(
        'operator takeover requires terminal or stale predecessor evidence',
        'PREDECESSOR_NOT_STALE',
        409,
      );
    }

    const workBinding = exactWorkForRoadmap(source, item);
    const claims = exactClaims(source.id, request.claimDispositions);
    const successor = bindAdmittedSuccessor(
      getSession(request.successorSessionId),
      workBinding,
      item.harbor,
    );
    const successorWitness = assertSuccessorSession(successor, source.id, workBinding);
    const successorAgentNodeId = successorWitness.agentNodeId;
    if (successorAgentNodeId === current.ownerAgentNodeId) {
      throw new DurableOwnershipError('successor must be a different AgentNode', 'VALIDATION_ERROR', 400);
    }
    assertNoSuccessorClaimOverlap(successor.id, claims);
    const claimSetHash = exactClaimSetHash(claims);
    let operatorPresenceReceipt: OperatorPresenceReceipt | null = null;
    if (authorityKind === 'operator') {
      if (!deps.verifyAndConsumeOperatorPresence || !request.operatorPresenceProof?.trim()) {
        throw new DurableOwnershipError(
          'operator takeover requires a recent action-bound presence proof; no verifier is available',
          'OPERATOR_PRESENCE_REQUIRED',
          403,
        );
      }
      const intent: OperatorPresenceIntent = {
        actorId: actor.actorId,
        harbor: item.harbor,
        roadmapSlug: item.slug,
        predecessorEpochId: current.epochId,
        sourceSessionId: source.id,
        successorSessionId: successor.id,
        successorActorId: successorWitness.actorId,
        claimSetHash,
      };
      let receipt: OperatorPresenceReceipt | null;
      try {
        receipt = await deps.verifyAndConsumeOperatorPresence(request.operatorPresenceProof.trim(), intent);
      } catch {
        throw new DurableOwnershipError(
          'operator presence verifier is unavailable',
          'OPERATOR_PRESENCE_REQUIRED',
          503,
        );
      }
      operatorPresenceReceipt = validateOperatorPresenceReceipt(receipt, intent, now());
    }
    const notes = canonicalNotes(source.id);
    const briefing = buildCanonicalBriefing({
      now: now(),
      item,
      currentEpoch: current,
      sourceRow: source,
      sourceWitness,
      successorWitness,
      predecessorAgentNodeId: current.ownerAgentNodeId,
      successorAgentNodeId,
      workBinding,
      claims,
      notes: notes.notes,
      notesAvailable: notes.available,
      getAgentNode: deps.getAgentNode,
      gitleaksRunner: deps.gitleaksRunner,
    });
    const predecessorEvidenceGap = sessionIsCanonicallyBound(sourceWitness, current.ownerAgentNodeId)
      ? null
      : {
          sourceSessionId: source.id,
          observedActorId: sourceWitness.actorId,
          lineageHash: sourceWitness.lineageHash as string,
          recordedByActorId: actor.actorId,
          knownGaps: ownershipGapFacts(sourceWitness, current.ownerAgentNodeId),
        };
    return kernel.issue({
      roadmapSlug: item.slug,
      harbor: item.harbor,
      predecessorEpochId: current.epochId,
      predecessorAgentNodeId: current.ownerAgentNodeId,
      successorAgentNodeId,
      trustedIssuerAgentNodeId: authorityKind === 'current-owner' ? current.ownerAgentNodeId : null,
      trustedAuthorizedActorId: actor.actorId,
      successorActorId: successorWitness.actorId,
      authorityKind,
      operatorPresenceReceipt,
      reason: request.reason,
      sourceSessionId: source.id,
      successorSessionId: successor.id,
      sourceWitness,
      successorWitness,
      predecessorEvidenceGap,
      workBinding,
      claimBindings: claims,
      briefing,
      ttlMs: request.ttlMs,
    });
  }

  /**
   * Revalidate and move exact claims within the kernel's ownership transaction.
   * The purpose is to preserve old-world provenance while new nodes, session
   * transitions, and signed outcomes either all persist or all roll back.
   * @param grant Verified explicit takeover or same-owner repair consent.
   * @param capturedSource Pre-signing source used for lineage compare-and-swap.
   * @param capturedSuccessor Pre-signing successor used for lineage comparison.
   * @param acceptedAt Repair timestamp already signed into the destination epoch.
   * @returns Exact transferred/released source ids and any new-world node mapping.
   */
  function enactTakeover(
    grant: DurableTakeoverGrant,
    capturedSource: CanonicalSessionRow,
    capturedSuccessor: CanonicalSessionRow,
    acceptedAt?: number,
  ): TakeoverDisposition {
    const source = getSession(grant.sourceSessionId);
    const successor = getSession(grant.successorSessionId);
    if (
      sessionLineageHash(source) !== sessionLineageHash(capturedSource)
      || sessionLineageHash(successor) !== sessionLineageHash(capturedSuccessor)
    ) {
      throw new DurableOwnershipError('session lineage changed before enactment', 'GRANT_BINDING_MISMATCH', 409);
    }
    const item = roadmapRow(grant.roadmapSlug, grant.harbor);
    const liveWork = grant.anchorRepair
      ? inspectSameOwnerAnchorRepair(source, successor, item, grant.authorizedActorId, grant.predecessorAgentNodeId).workBinding
      : exactWorkForRoadmap(source, item);
    if (!sameWorkBinding(liveWork, grant.workBinding)) {
      throw new DurableOwnershipError('exact git state changed before enactment', 'GRANT_BINDING_MISMATCH', 409);
    }
    assertNoSuccessorClaimOverlap(successor.id, grant.claimBindings);
    const transferredAt = acceptedAt ?? now();
    const disposition = claimForest.transferExactClaims({
      grantId: grant.grantId,
      sourceSessionId: source.id,
      successorSessionId: successor.id,
      predecessorAgentNodeId: grant.predecessorAgentNodeId,
      successorAgentNodeId: grant.successorAgentNodeId,
      successorAgentId: successor.agent_id,
      allowUnboundPredecessor: !grant.sourceWitnessCanonical,
      bindings: grant.claimBindings,
      transferredAt,
      ...(grant.anchorRepair ? { anchorRepair: grant.anchorRepair } : {}),
    });
    if (grant.anchorRepair) {
      if (exactClaims(source.id).length !== 0
        || exactClaimSetHash(exactClaims(successor.id)) !== exactClaimSetHash(anchorRepairSuccessorClaims(grant, transferredAt))) {
        throw new DurableOwnershipError('actual successor claims differ from the signed repaired epoch', 'CLAIM_SET_MISMATCH', 409);
      }
      const afterClaims = exactWork(successor, [item.notes_json, source.metadata, successor.metadata]);
      if (!sameWorkBinding(afterClaims, grant.workBinding)) {
        throw new DurableOwnershipError('physical workspace changed during claim repair', 'GRANT_BINDING_MISMATCH', 409);
      }
    }
    const sourceMetadata = {
      ...metadataObject(source.metadata),
      ownership: {
        state: 'transferred',
        grantId: grant.grantId,
        successorSessionId: successor.id,
        successorAgentNodeId: grant.successorAgentNodeId,
        transferredAt,
      },
    };
    const successorMetadata = {
      ...metadataObject(successor.metadata),
      ownership: {
        state: 'current',
        grantId: grant.grantId,
        predecessorSessionId: source.id,
        predecessorAgentNodeId: grant.predecessorAgentNodeId,
        briefingHash: grant.briefingHash,
        acceptedAt: transferredAt,
      },
    };
    const sourceUpdate = db.prepare(`
      UPDATE sessions
      SET status = CASE WHEN status = 'active' THEN 'abandoned' ELSE status END,
          phase = CASE WHEN status = 'active' THEN 'abandoned' ELSE phase END,
          completed_at = CASE WHEN status = 'active' THEN ? ELSE completed_at END,
          updated_at = ?, metadata = ?
      WHERE id = ? AND updated_at = ? AND status = ? AND metadata IS ?
    `).run(
      transferredAt,
      transferredAt,
      canonicalOwnershipJson(sourceMetadata),
      source.id,
      source.updated_at,
      source.status,
      source.metadata,
    );
    const successorUpdate = db.prepare(`
      UPDATE sessions SET updated_at = ?, metadata = ?
      WHERE id = ? AND updated_at = ? AND status = 'active' AND metadata IS ?
    `).run(
      transferredAt,
      canonicalOwnershipJson(successorMetadata),
      successor.id,
      successor.updated_at,
      successor.metadata,
    );
    if (sourceUpdate.changes !== 1 || successorUpdate.changes !== 1) {
      throw new DurableOwnershipError('session transition lost its compare-and-swap', 'GRANT_BINDING_MISMATCH', 409);
    }
    return disposition;
  }

  /**
   * Accept ordinary successor takeover through the canonical evidence path.
   * Its design rejects repair grants here so anchor changes remain explicit.
   * @param request Source-bound grant id and caller-retained nonce.
   * @param caller Actor resolved by the daemon's credential verifier.
   * @returns Atomic ownership transition and persisted signed receipt.
   */
  async function acceptTakeover(
    request: AcceptDurableTakeoverRequest,
    caller: VerifiedOwnershipActor,
  ) {
    const actor = verifiedActor(caller);
    const view = kernel.getGrant(text(request.grantId, 'grantId'));
    if (!view) throw new DurableOwnershipError('takeover grant not found', 'GRANT_NOT_FOUND', 404);
    const grant = view.grant;
    if (grant.anchorRepair) {
      throw new DurableOwnershipError('anchor repair requires its explicit acceptance method', 'VALIDATION_ERROR', 400);
    }
    if (request.sourceSessionId !== grant.sourceSessionId) {
      throw new DurableOwnershipError('route source session does not match the grant', 'GRANT_BINDING_MISMATCH', 409);
    }
    if (actor.actorId !== grant.successorActorId) {
      throw new DurableOwnershipError('only the actor bound to the successor session may accept', 'AUTHORITY_REQUIRED', 403);
    }
    const source = bindSessionFromCanonicalRun(getSession(grant.sourceSessionId), {
      required: grant.sourceWitnessCanonical,
      expectedAgentNodeId: grant.sourceWitnessCanonical ? grant.predecessorAgentNodeId : undefined,
    });
    const successor = bindSessionFromCanonicalRun(getSession(grant.successorSessionId), {
      required: true,
      expectedAgentNodeId: grant.successorAgentNodeId,
    });
    const item = roadmapRow(grant.roadmapSlug, grant.harbor);
    const workBinding = exactWorkForRoadmap(source, item);
    const claimBindings = exactClaims(
      source.id,
      grant.claimBindings.map(claim => ({
        claimNodeId: claim.claimNodeId,
        disposition: claim.disposition as 'transfer' | 'release',
      })),
    );
    const sourceWitness = sessionWitness(source);
    const successorWitness = assertSuccessorSession(successor, source.id, workBinding);
    return kernel.consume({
      grantId: grant.grantId,
      nonce: request.nonce,
      trustedAuthorizedActorId: actor.actorId,
      workBinding,
      claimBindings,
      sourceWitness,
      successorWitness,
      enact: () => enactTakeover(grant, source, successor),
    });
  }

  /**
   * Consume an exact repair using the existing single SQLite ownership writer.
   * The intent is all-or-nothing transfer of both legacy and forest claims,
   * session provenance, roadmap epoch and signed receipt. No retries, identity
   * minting, live daemon restarts or predecessor-abandonment pre-step occur.
   * @param request Exact source/grant/nonce received from preparation.
   * @param caller Verified actor consenting to its own already canonical lease.
   * @returns Signed new epoch and explicit node mapping, or the same prior outcome.
   */
  async function acceptSameOwnerAnchorRepair(request: AcceptDurableTakeoverRequest, caller: VerifiedOwnershipActor) {
    const actor = verifiedActor(caller);
    const view = kernel.getGrant(text(request.grantId, 'grantId'));
    if (!view) throw new DurableOwnershipError('repair grant not found', 'GRANT_NOT_FOUND', 404);
    const grant = view.grant;
    if (!grant.anchorRepair || request.sourceSessionId !== grant.sourceSessionId) {
      throw new DurableOwnershipError('request does not name its exact anchor repair grant', 'GRANT_BINDING_MISMATCH', 409);
    }
    const nonce = anchorRepairNonce(request.nonce);
    if (actor.actorId !== grant.authorizedActorId || actor.actorId !== grant.successorActorId) {
      throw new DurableOwnershipError('repair requires the exact consenting owner actor', 'AUTHORITY_REQUIRED', 403);
    }
    const replay = kernel.replayAnchorRepairConsumption(grant.grantId, nonce, actor.actorId);
    if (replay) return replay;
    const source = getSession(grant.sourceSessionId);
    const successor = getSession(grant.successorSessionId);
    const item = roadmapRow(grant.roadmapSlug, grant.harbor);
    const inspected = inspectSameOwnerAnchorRepair(source, successor, item, actor.actorId, grant.predecessorAgentNodeId);
    const claims = exactClaims(source.id, grant.claimBindings.map(claim => ({
      claimNodeId: claim.claimNodeId, disposition: claim.disposition as 'transfer' | 'release',
    })));
    return kernel.consume({
      grantId: grant.grantId, nonce, trustedAuthorizedActorId: actor.actorId,
      workBinding: inspected.workBinding, claimBindings: claims,
      sourceWitness: inspected.sourceWitness, successorWitness: inspected.successorWitness,
      enact: at => enactTakeover(grant, source, successor, at),
    });
  }

  return {
    bootstrapCanonical,
    prepareTakeover,
    acceptTakeover,
    prepareSameOwnerAnchorRepair,
    acceptSameOwnerAnchorRepair,
    getGrant: kernel.getGrant,
    actorCanReadDetails,
    getProjection: kernel.getProjection,
    expireDue: kernel.expireDue,
    capabilities: Object.freeze({
      operatorPresenceVerifier: Boolean(deps.verifyAndConsumeOperatorPresence),
      successorAdmission: 'preexisting-daemon-agent-run' as const,
      sameOwnerAnchorRepair: 'explicit-same-agent-node-and-actor' as const,
    }),
  };
}

export type DurableOwnershipService = ReturnType<typeof createDurableOwnershipService>;
