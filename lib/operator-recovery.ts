/**
 * Provenance-bound operator recovery for daemon and host restarts.
 *
 * `harbor_events` is the authority. The two local tables below are disposable
 * projections: one makes one-shot consumption enforceable across SQLite
 * connections, the other caches the public key whose signed FleetBar process
 * provenance is recorded in the ledger. Neither can mint authority on its own.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { isAbsolute, join, resolve } from 'node:path';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import type { DatabaseInstance } from './sqlite-runtime.js';
import type { ActorSouls, IssuedBodyCredential } from './actor-souls.js';
import type {
  createSessions,
  OperatorRecoveryBindReceipt,
  OperatorRecoveryClaimChange as SessionRecoveryClaim,
} from './sessions.js';
import {
  appendEvent,
  canonicalJson,
  ensureEventLedgerSchema,
  type HarborPayload,
} from './agent-harbor/event-ledger.js';
import { keychainSecretStore, type SecretStore } from './macaroon/store.js';
import { addFirstPartyCaveat, create as createMacaroon } from './macaroon/macaroon.js';
import {
  branchCaveat,
  expiresCaveat,
  opCaveat,
  repoCaveat,
  sessionCaveat,
} from './macaroon/caveats.js';
import { verifyPushGrantPreferKernel } from './macaroon-ffi.js';
import type { Macaroon } from './macaroon/types.js';
import {
  runOperatorEnrollmentHelper,
  type RunOperatorEnrollmentHelperOptions,
  type VerifiedOperatorEnrollmentCandidate,
  type VerifiedOperatorEnrollmentActivation,
} from './operator-presence-helper.js';
import {
  acquireContextSlotLock,
  contextSlotLockPath,
  ContextSlotLockError,
  type ContextSlotLockLease,
} from './context-slot-lock.js';

export const OPERATOR_RECOVERY_EVENT_SCHEMA = 'pd.agent-harbor.operator-recovery-event.v0';
export const OPERATOR_RECOVERY_DECISION_SCHEMA = 'pd.operator-recovery-decision.v0';
export const OPERATOR_ENROLLMENT_BOOTSTRAP_SCHEMA = 'pd.operator-enrollment-bootstrap.v0';
const MAX_CHALLENGE_TTL_MS = 5 * 60_000;
const DEFAULT_CHALLENGE_TTL_MS = 2 * 60_000;
const RECOVERED_BODY_TTL_MS = 7 * 24 * 60 * 60_000;
export const DEFAULT_MAX_ACTIVE_RECOVERIES_PER_PROJECT_ACTOR = 20;
/** Exact ceiling shared with the native operator-presence verifier. */
export const MAX_OPERATOR_RECOVERY_SIGNING_PAYLOAD_BYTES = 64 * 1024;
const PROSPECTIVE_SECURE_ENCLAVE_DEVICE_KEY_ID = `se-p256:${'0'.repeat(64)}`;
const ACTIVE_RECOVERY_STATUSES = ['pending', 'approved', 'custody-pending'] as const;
const RECOVERY_STATUSES = [
  ...ACTIVE_RECOVERY_STATUSES,
  'denied',
  'expired',
  'revoked',
  'consumed',
] as const;

export const OPERATOR_RECOVERY_EVENT_KINDS = [
  'challenge-created',
  'enrollment-pinned',
  'enrollment-activated',
  'approved',
  'denied',
  'expired',
  'drift-refused',
  'replay-refused',
  'grant-minted',
  'grant-consumed',
  'grant-revoked',
  'session-bound',
  'context-custody-installed',
] as const;
export type OperatorRecoveryEventKind = (typeof OPERATOR_RECOVERY_EVENT_KINDS)[number];

export interface OperatorRecoveryClaimChange {
  nodeId: string;
  disposition: 'transfer' | 'release';
}

export interface FrozenOperatorRecoveryClaim extends OperatorRecoveryClaimChange {
  id: number;
  repoId: string;
  worldKind: 'worktree' | 'ref' | 'commit' | 'harbor';
  worldId: string;
  gitOid: string | null;
  selectorKind: 'repo' | 'directory' | 'file' | 'symbol' | 'range';
  filePath: string;
  startLine: number | null;
  endLine: number | null;
  symbol: string | null;
  symbolPath: string | null;
  sessionId: string;
  purpose: string;
  agentId: string | null;
  phase: string;
  mode: 'S' | 'X' | 'IS' | 'IX' | 'SIX';
  intent: string | null;
  claimedAt: number;
  releasedAt: null;
  observedBy: string | null;
  confidence: number;
  legacySessionFileId: number | null;
}

export interface CreateOperatorRecoveryChallengeInput {
  harbor?: string;
  intendedAgentId: string;
  project: string;
  worktree: string;
  branch: string;
  predecessorSessionId: string;
  sessionIntent: string;
  actorId: string;
  claims: OperatorRecoveryClaimChange[];
  contextSlot?: string | null;
  expiresAt?: number;
}

export type OperatorRecoveryDecision = 'approve' | 'deny' | 'revoke';

export interface SignedOperatorRecoveryDecisionInput {
  recoveryId: string;
  decision: OperatorRecoveryDecision;
  /** Echoed by FleetBar and checked against the daemon-selected pin. */
  deviceKeyId: string;
  publicKeyX963Base64: string;
  signatureDerBase64: string;
  challengeDigest: string;
}

export interface OperatorPresenceVerificationInput {
  deviceKeyId: string;
  publicKeyX963Base64: string;
  signatureDerBase64: string;
  canonicalPayload: Uint8Array;
  expectedChallengeDigest: string;
}

export type OperatorPresenceVerificationResult =
  | { ok: true }
  | { ok: false; code: string; reason: string };

/** P-256 verification is supplied only by pd-anchor; there is no TS fallback. */
export interface OperatorPresenceSignatureVerifier {
  verify(input: OperatorPresenceVerificationInput):
    | OperatorPresenceVerificationResult
    | Promise<OperatorPresenceVerificationResult>;
}

export class OperatorRecoveryError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus = 409,
  ) {
    super(message);
    this.name = 'OperatorRecoveryError';
  }
}

interface RecoveryCommon {
  recoveryId: string;
  actionHash: string;
  harbor: string;
  intendedAgentId: string;
  project: string;
  worktree: string;
  branch: string;
  predecessorSessionId: string;
  sessionIntent: string;
  actorId: string;
  daemonGeneration: string;
  nonce: string;
  expiresAt: number;
  bodyExpiresAt: number;
  jtiDigest: string;
  contextSlot: string | null;
  priorContextDigest: string | null;
  claims: FrozenOperatorRecoveryClaim[];
  deviceKeyId?: string;
  enrollmentEventId?: string;
  enrollmentActivationEventId?: string;
}

interface RecoveryEvent extends RecoveryCommon {
  schema: typeof OPERATOR_RECOVERY_EVENT_SCHEMA;
  eventId: string;
  ledgerSeq: number;
  kind: OperatorRecoveryEventKind;
  occurredAt: string;
  predecessorEventIds: string[];
  successorSessionId?: string | null;
  [key: string]: unknown;
}

interface RecoveryState {
  common: RecoveryCommon;
  events: RecoveryEvent[];
  status: 'pending' | 'approved' | 'custody-pending' | 'denied' | 'expired' | 'revoked' | 'consumed';
  lastEventId: string;
  terminalAuthorityEventId: string | null;
  successorSessionId: string | null;
  bodyCredentialId: string | null;
  bodyEnvelopeDigest: string | null;
  enrollmentActivated: boolean;
}

interface EnrollmentProjectionRow {
  device_key_id: string;
  public_key_x963_base64: string;
  public_key_digest: string;
  pinned_event_id: string;
  process_identity: string;
  response_digest: string;
  activation_nonce_digest: string;
  activation_event_id: string | null;
  activation_command_digest: string | null;
  activation_receipt_digest: string | null;
  activated_at: number | null;
  pinned_at: number;
  revoked_at: number | null;
}

type SessionsManager = ReturnType<typeof createSessions>;
type EnrollmentHelperRunner = (
  options: RunOperatorEnrollmentHelperOptions,
) => ReturnType<typeof runOperatorEnrollmentHelper>;

export interface OperatorRecoveryDeps {
  db: DatabaseInstance;
  actorSouls: ActorSouls;
  sessions: SessionsManager;
  daemonGeneration: string;
  signatureVerifier?: OperatorPresenceSignatureVerifier | null;
  /** Testable boundary; production defaults to the canonical pd-anchor verifier. */
  verifyGrant?: typeof verifyPushGrantPreferKernel;
  runEnrollmentHelper?: EnrollmentHelperRunner | null;
  fleetBarExecutablePath?: string | null;
  secrets?: SecretStore;
  now?: () => number;
  resolveGitBranch?: (canonicalWorktree: string) => string;
  /** Bounded loopback-intent queue. Exact retries are admitted before this cap. */
  maxActiveRecoveriesPerProjectActor?: number;
  /** Canonical 0600, exact-slot-only context custody. Plaintext never crosses HTTP. */
  installRecoveredContext?: (input: {
    canonicalWorktree: string;
    contextSlot: string;
    intendedAgentId: string;
    successorSessionId: string;
    sessionIntent: string;
    project: string;
    actorId: string;
    credential: string;
    issuedAt: number;
    expiresAt: number;
    recoveryId: string;
    daemonGeneration: string;
    custodyDaemonGeneration: string;
    expectedContextDigest: string;
    expectedPriorContextDigest: string | null;
    /** Called under the exact-slot lock immediately before publication. */
    assertPublicationAuthorized: () => void;
  }) => RecoveredContextCustodyReceipt;
}

export interface RecoveredContextCustodyReceipt {
  contextSlot: string;
  contextPath: string;
  mode: 0o600;
  contentDigest: string;
}

function hashBytes(bytes: Uint8Array | string): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function cleanString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value !== value.trim()) {
    throw new OperatorRecoveryError(
      'OPERATOR_RECOVERY_VALIDATION',
      `${field} must be a non-empty, already-canonical string`,
      400,
    );
  }
  return value;
}

function nullableString(value: unknown, field: string): string | null {
  if (value == null) return null;
  return cleanString(value, field);
}

function canonicalContextSlot(value: unknown): string | null {
  const slot = nullableString(value, 'contextSlot');
  if (!slot) return null;
  const normalized = slot
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'default';
  if (normalized !== slot) {
    throw new OperatorRecoveryError(
      'OPERATOR_RECOVERY_CONTEXT_SLOT_NOT_CANONICAL',
      `contextSlot must already use its canonical filesystem form (${normalized})`,
      400,
    );
  }
  return slot;
}

function canonicalBase64(value: unknown, field: string): Buffer {
  const encoded = cleanString(value, field);
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length === 0 || bytes.toString('base64') !== encoded) {
    throw new OperatorRecoveryError(
      'OPERATOR_RECOVERY_SIGNATURE_INVALID',
      `${field} must be canonical base64`,
      401,
    );
  }
  return bytes;
}

function canonicalSignedDecisionRequest(input: SignedOperatorRecoveryDecisionInput): {
  recoveryId: string;
  decision: OperatorRecoveryDecision;
  signature: Buffer;
  publicKey: Buffer;
  digest: string;
} {
  const recoveryId = cleanString(input.recoveryId, 'recoveryId');
  const decision = cleanString(input.decision, 'decision') as OperatorRecoveryDecision;
  if (!['approve', 'deny', 'revoke'].includes(decision)) {
    throw new OperatorRecoveryError(
      'OPERATOR_RECOVERY_VALIDATION',
      'decision must be approve, deny, or revoke',
      400,
    );
  }
  const deviceKeyId = cleanString(input.deviceKeyId, 'deviceKeyId');
  const publicKeyX963Base64 = cleanString(input.publicKeyX963Base64, 'publicKeyX963Base64');
  const signatureDerBase64 = cleanString(input.signatureDerBase64, 'signatureDerBase64');
  const challengeDigest = cleanString(input.challengeDigest, 'challengeDigest');
  if (!/^sha256:[0-9a-f]{64}$/.test(challengeDigest)) {
    throw new OperatorRecoveryError(
      'OPERATOR_RECOVERY_VALIDATION',
      'challengeDigest must be a canonical SHA-256 digest',
      400,
    );
  }
  const publicKey = canonicalBase64(publicKeyX963Base64, 'publicKeyX963Base64');
  const signature = canonicalBase64(signatureDerBase64, 'signatureDerBase64');
  return {
    recoveryId,
    decision,
    signature,
    publicKey,
    digest: hashBytes(canonicalJson({
      recoveryId,
      decision,
      deviceKeyId,
      publicKeyX963Base64,
      signatureDerBase64,
      challengeDigest,
    })),
  };
}

function canonicalWorktree(input: string): string {
  const requested = cleanString(input, 'worktree');
  if (!isAbsolute(requested)) {
    throw new OperatorRecoveryError(
      'OPERATOR_RECOVERY_WORKTREE_NOT_CANONICAL',
      'worktree must be an absolute canonical path',
      400,
    );
  }
  let actual: string;
  try {
    actual = realpathSync.native(resolve(requested));
  } catch {
    throw new OperatorRecoveryError(
      'OPERATOR_RECOVERY_WORKTREE_NOT_FOUND',
      'worktree must exist before an operator recovery challenge is created',
      400,
    );
  }
  if (actual !== requested) {
    throw new OperatorRecoveryError(
      'OPERATOR_RECOVERY_WORKTREE_NOT_CANONICAL',
      `worktree must use its canonical path (${actual})`,
      400,
    );
  }
  return actual;
}

function freezeContextOccupant(worktree: string, contextSlot: string): string | null {
  const projectContextDir = join(worktree, '.portdaddy');
  const contextDir = join(projectContextDir, 'contexts');
  const contextPath = join(contextDir, `${contextSlot}.json`);
  for (const directory of [projectContextDir, contextDir]) {
    if (!existsSync(directory)) return null;
    const stat = lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_CONTEXT_CUSTODY_UNSAFE',
        'the signed context-slot ancestry must contain only real directories',
        503,
      );
    }
  }
  if (!existsSync(contextPath)) return null;
  const contextStat = lstatSync(contextPath);
  if (contextStat.isSymbolicLink() || !contextStat.isFile() || contextStat.size > 1024 * 1024) {
    throw new OperatorRecoveryError(
      'OPERATOR_RECOVERY_CONTEXT_CUSTODY_UNSAFE',
      'the signed context-slot occupant must be a bounded regular file',
      503,
    );
  }
  return hashBytes(readFileSync(contextPath));
}

function removeRecoveryContextOrphans(contextDir: string, contextSlot: string): void {
  const prefix = `.${contextSlot}.operator-recovery.`;
  let removed = false;
  for (const name of readdirSync(contextDir)) {
    if (!name.startsWith(prefix)) continue;
    const suffix = name.slice(prefix.length);
    if (!/^[a-f0-9]{64}\.[1-9][0-9]*\.[a-f0-9]{32}\.tmp$/.test(suffix)) continue;
    const path = join(contextDir, name);
    const stat = lstatSync(path);
    const currentUid = typeof process.getuid === 'function' ? process.getuid() : null;
    if (
      stat.isSymbolicLink() ||
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.size > 1024 * 1024 ||
      (currentUid !== null && stat.uid !== currentUid)
    ) {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_CONTEXT_CUSTODY_UNSAFE',
        'a recovery-owned context temporary file could not be retired safely',
        503,
      );
    }
    rmSync(path);
    removed = true;
  }
  if (removed) {
    const directoryDescriptor = openSync(contextDir, 'r');
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  }
}

function sortClaims(claims: FrozenOperatorRecoveryClaim[]): FrozenOperatorRecoveryClaim[] {
  return [...claims].sort((left, right) => (
    left.nodeId < right.nodeId ? -1 : left.nodeId > right.nodeId ? 1 : 0
  ));
}

function computeFrozenScopeDigest(scope: Pick<
  RecoveryCommon,
  'harbor' | 'intendedAgentId' | 'project' | 'worktree' | 'branch' |
  'predecessorSessionId' | 'sessionIntent' | 'actorId' | 'contextSlot' |
  'priorContextDigest' | 'claims'
>): string {
  return hashBytes(canonicalJson({
    kind: 'operator-recovery-frozen-scope-v1',
    harbor: scope.harbor,
    intendedAgentId: scope.intendedAgentId,
    project: scope.project,
    worktree: scope.worktree,
    branch: scope.branch,
    predecessorSessionId: scope.predecessorSessionId,
    sessionIntent: scope.sessionIntent,
    actorId: scope.actorId,
    contextSlot: scope.contextSlot,
    priorContextDigest: scope.priorContextDigest,
    claims: sortClaims(scope.claims),
  }));
}

function actionCoordinates(common: Omit<RecoveryCommon, 'actionHash'>) {
  return {
    recoveryId: common.recoveryId,
    harbor: common.harbor,
    intendedAgentId: common.intendedAgentId,
    project: common.project,
    worktree: common.worktree,
    branch: common.branch,
    predecessorSessionId: common.predecessorSessionId,
    sessionIntent: common.sessionIntent,
    actorId: common.actorId,
    daemonGeneration: common.daemonGeneration,
    nonce: common.nonce,
    expiresAt: common.expiresAt,
    bodyExpiresAt: common.bodyExpiresAt,
    jtiDigest: common.jtiDigest,
    contextSlot: common.contextSlot,
    priorContextDigest: common.priorContextDigest,
    ...(common.deviceKeyId ? { deviceKeyId: common.deviceKeyId } : {}),
    ...(common.enrollmentEventId ? { enrollmentEventId: common.enrollmentEventId } : {}),
    ...(common.enrollmentActivationEventId
      ? { enrollmentActivationEventId: common.enrollmentActivationEventId }
      : {}),
    claims: sortClaims(common.claims),
  };
}

function computeActionHash(common: Omit<RecoveryCommon, 'actionHash'>): string {
  return hashBytes(canonicalJson({ kind: 'rebind-session', ...actionCoordinates(common) }));
}

function signingEnvelope(common: RecoveryCommon, decision: OperatorRecoveryDecision) {
  if (
    !common.deviceKeyId ||
    !common.enrollmentEventId ||
    !common.enrollmentActivationEventId
  ) {
    throw new OperatorRecoveryError(
      'OPERATOR_RECOVERY_ENROLLMENT_REQUIRED',
      'no provenance-pinned FleetBar enrollment is bound to this recovery',
      503,
    );
  }
  return {
    schema: OPERATOR_RECOVERY_DECISION_SCHEMA,
    decision,
    actionHash: common.actionHash,
    ...actionCoordinates(common),
  };
}

function signingPayload(common: RecoveryCommon, decision: OperatorRecoveryDecision) {
  const bytes = Buffer.from(canonicalJson(signingEnvelope(common, decision)), 'utf8');
  if (bytes.byteLength > MAX_OPERATOR_RECOVERY_SIGNING_PAYLOAD_BYTES) {
    throw new OperatorRecoveryError(
      'OPERATOR_RECOVERY_SIGNING_PAYLOAD_TOO_LARGE',
      `canonical operator decision exceeds ${MAX_OPERATOR_RECOVERY_SIGNING_PAYLOAD_BYTES} bytes`,
      413,
    );
  }
  return {
    bytes,
    bytesBase64: bytes.toString('base64'),
    digest: hashBytes(bytes),
  };
}

interface ReservedEnrollmentCoordinates {
  deviceKeyId: string;
  enrollmentEventId: string;
  enrollmentActivationEventId: string;
}

function reserveFirstEnrollmentCoordinates(common: RecoveryCommon): ReservedEnrollmentCoordinates {
  const enrollmentEventId = `operator-recovery:${common.recoveryId}:enrollment-pinned:${randomBytes(8).toString('hex')}`;
  const enrollmentActivationEventId = `operator-recovery:${common.recoveryId}:enrollment-activated:${randomBytes(8).toString('hex')}`;
  const recovery = 'recovery-[0-9a-f]{24}';
  if (
    !new RegExp(`^operator-recovery:${recovery}:enrollment-pinned:[0-9a-f]{16}$`).test(enrollmentEventId)
    || !new RegExp(`^operator-recovery:${recovery}:enrollment-activated:[0-9a-f]{16}$`).test(enrollmentActivationEventId)
  ) {
    throw new OperatorRecoveryError(
      'OPERATOR_RECOVERY_ENROLLMENT_ID_INVALID',
      'generated enrollment identifiers did not match their fixed canonical grammar',
      500,
    );
  }
  return {
    deviceKeyId: PROSPECTIVE_SECURE_ENCLAVE_DEVICE_KEY_ID,
    enrollmentEventId,
    enrollmentActivationEventId,
  };
}

function withEnrollmentCoordinates(
  common: RecoveryCommon,
  enrollment: ReservedEnrollmentCoordinates,
): RecoveryCommon {
  const withoutHash: Omit<RecoveryCommon, 'actionHash'> = {
    ...common,
    deviceKeyId: enrollment.deviceKeyId,
    enrollmentEventId: enrollment.enrollmentEventId,
    enrollmentActivationEventId: enrollment.enrollmentActivationEventId,
  };
  return { ...withoutHash, actionHash: computeActionHash(withoutHash) };
}

function deriveJti(rootKey: Buffer, recoveryId: string, nonce: string): string {
  return `operator-recovery-${createHmac('sha256', rootKey)
    .update(`${recoveryId}\0${nonce}`)
    .digest('hex')}`;
}

function defaultResolveGitBranch(worktree: string): string {
  return execFileSync('git', ['-C', worktree, 'rev-parse', '--abbrev-ref', 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 5_000,
  }).trim();
}

interface RecoveryContextMaterial {
  recoveryId: string;
  canonicalWorktree: string;
  contextSlot: string;
  intendedAgentId: string;
  successorSessionId: string;
  sessionIntent: string;
  project: string;
  actorId: string;
  credential: string;
  issuedAt: number;
  expiresAt: number;
}

interface RecoveryBodyEnvelope extends RecoveryContextMaterial {
  schema: 'pd.operator-recovery-body-envelope.v1';
  daemonGeneration: string;
  actionHash: string;
  bodyCredentialId: string;
  branch: string;
  priorContextDigest: string | null;
}

function bodyEnvelopeKey(rootKey: Buffer): Buffer {
  return createHmac('sha256', rootKey)
    .update('pd.operator-recovery-body-envelope.v1\0aes-256-gcm', 'utf8')
    .digest();
}

function recoveredContextBytes(input: RecoveryContextMaterial): Buffer {
  const record = {
    agentId: cleanString(input.intendedAgentId, 'intendedAgentId'),
    sessionId: cleanString(input.successorSessionId, 'successorSessionId'),
    purpose: cleanString(input.sessionIntent, 'sessionIntent'),
    identity: cleanString(input.project, 'project'),
    startedAt: input.issuedAt,
    contextSlot: cleanString(input.contextSlot, 'contextSlot'),
    recoveryId: cleanString(input.recoveryId, 'recoveryId'),
    credentialExpiresAt: input.expiresAt,
    credential: cleanString(input.credential, 'credential'),
  };
  cleanString(input.actorId, 'actorId');
  if (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= input.issuedAt) {
    throw new OperatorRecoveryError(
      'OPERATOR_RECOVERY_CONTEXT_CUSTODY_INVALID',
      'recovered body expiry is invalid',
      500,
    );
  }
  return Buffer.from(JSON.stringify(record, null, 2), 'utf8');
}

export function operatorRecoveryContextDigest(input: RecoveryContextMaterial): string {
  return hashBytes(recoveredContextBytes(input));
}

function sealBodyEnvelope(rootKey: Buffer, envelope: RecoveryBodyEnvelope) {
  const iv = randomBytes(12);
  const aad = Buffer.from(`${envelope.recoveryId}\0${envelope.actionHash}`, 'utf8');
  const cipher = createCipheriv('aes-256-gcm', bodyEnvelopeKey(rootKey), iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(canonicalJson(envelope), 'utf8')),
    cipher.final(),
  ]);
  const serialized = canonicalJson({
    schema: 'pd.operator-recovery-sealed-body.v1',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  });
  return { serialized, digest: hashBytes(serialized) };
}

function openBodyEnvelope(
  rootKey: Buffer,
  recoveryId: string,
  actionHash: string,
  serialized: string,
): RecoveryBodyEnvelope {
  let sealed: Record<string, unknown>;
  try {
    sealed = JSON.parse(serialized) as Record<string, unknown>;
  } catch {
    throw new OperatorRecoveryError(
      'OPERATOR_RECOVERY_BODY_ENVELOPE_INVALID',
      'sealed body envelope is not valid JSON',
      503,
    );
  }
  if (sealed.schema !== 'pd.operator-recovery-sealed-body.v1') {
    throw new OperatorRecoveryError(
      'OPERATOR_RECOVERY_BODY_ENVELOPE_INVALID',
      'sealed body envelope has the wrong schema',
      503,
    );
  }
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      bodyEnvelopeKey(rootKey),
      canonicalBase64(sealed.iv, 'bodyEnvelope.iv'),
    );
    decipher.setAAD(Buffer.from(`${recoveryId}\0${actionHash}`, 'utf8'));
    decipher.setAuthTag(canonicalBase64(sealed.tag, 'bodyEnvelope.tag'));
    const plaintext = Buffer.concat([
      decipher.update(canonicalBase64(sealed.ciphertext, 'bodyEnvelope.ciphertext')),
      decipher.final(),
    ]);
    const envelope = JSON.parse(plaintext.toString('utf8')) as RecoveryBodyEnvelope;
    if (
      envelope.schema !== 'pd.operator-recovery-body-envelope.v1' ||
      envelope.recoveryId !== recoveryId ||
      envelope.actionHash !== actionHash
    ) {
      throw new Error('body envelope scope mismatch');
    }
    return envelope;
  } catch (error) {
    if (error instanceof OperatorRecoveryError) throw error;
    throw new OperatorRecoveryError(
      'OPERATOR_RECOVERY_BODY_ENVELOPE_INVALID',
      'sealed body envelope authentication failed',
      503,
    );
  }
}

/**
 * Install a recovered body in exactly one signed context slot. This does not
 * update the legacy `.portdaddy/current.json` compatibility pointer: doing so
 * would disclose the body to unrelated shells. The random same-directory file
 * and rename provide an atomic owner-only publication.
 */
export function installOperatorRecoveryContext(input: RecoveryContextMaterial & {
  recoveryId: string;
  daemonGeneration: string;
  custodyDaemonGeneration: string;
  expectedContextDigest: string;
  expectedPriorContextDigest: string | null;
  assertPublicationAuthorized?: () => void;
}): RecoveredContextCustodyReceipt {
  const worktree = canonicalWorktree(input.canonicalWorktree);
  const contextSlot = canonicalContextSlot(input.contextSlot);
  if (!contextSlot) {
    throw new OperatorRecoveryError(
      'OPERATOR_RECOVERY_CONTEXT_SLOT_REQUIRED',
      'contextSlot is required for exact-slot custody',
      400,
    );
  }
  const projectContextDir = join(worktree, '.portdaddy');
  mkdirSync(projectContextDir, { recursive: true, mode: 0o700 });
  if (
    realpathSync.native(projectContextDir) !== resolve(projectContextDir) ||
    !statSync(projectContextDir).isDirectory()
  ) {
    throw new OperatorRecoveryError(
      'OPERATOR_RECOVERY_CONTEXT_CUSTODY_UNSAFE',
      'the project context root is not a canonical directory',
      503,
    );
  }
  const contextDir = join(projectContextDir, 'contexts');
  mkdirSync(contextDir, { recursive: true, mode: 0o700 });
  if (realpathSync.native(contextDir) !== resolve(contextDir) || !statSync(contextDir).isDirectory()) {
    throw new OperatorRecoveryError(
      'OPERATOR_RECOVERY_CONTEXT_CUSTODY_UNSAFE',
      'the exact context directory is not a canonical directory',
      503,
    );
  }
  chmodSync(contextDir, 0o700);
  const contextPath = join(contextDir, `${contextSlot}.json`);
  const lockPath = contextSlotLockPath(contextDir, contextSlot);
  const bytes = recoveredContextBytes({ ...input, contextSlot });
  const contentDigest = hashBytes(bytes);
  if (contentDigest !== input.expectedContextDigest) {
    throw new OperatorRecoveryError(
      'OPERATOR_RECOVERY_CONTEXT_CUSTODY_MISMATCH',
      'the expected exact-slot content digest changed before publication',
      503,
    );
  }
  const lockRecord = {
    schema: 'pd.operator-recovery-context-lock.v1',
    recoveryId: cleanString(input.recoveryId, 'recoveryId'),
    daemonGeneration: cleanString(input.custodyDaemonGeneration, 'custodyDaemonGeneration'),
    contextSlot,
    writer: 'operator-recovery',
  };
  let lockLease: ContextSlotLockLease | null = null;
  try {
    lockLease = acquireContextSlotLock(lockPath, lockRecord);
  } catch (error) {
    if (error instanceof ContextSlotLockError && error.code === 'CONTEXT_SLOT_BUSY') {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_CONTEXT_SLOT_BUSY',
        'the exact context slot is already held by another custody writer',
        409,
      );
    }
    if (error instanceof OperatorRecoveryError) throw error;
    throw new OperatorRecoveryError(
      'OPERATOR_RECOVERY_CONTEXT_CUSTODY_UNSAFE',
      'the exact context-slot lock could not be created safely',
      503,
    );
  }
  const recoveryDigest = hashBytes(input.recoveryId).slice('sha256:'.length);
  const temporaryPath = join(
    contextDir,
    `.${contextSlot}.operator-recovery.${recoveryDigest}.${process.pid}.${randomBytes(16).toString('hex')}.tmp`,
  );
  const assertPublicationAuthorized = () => {
    if (input.assertPublicationAuthorized) {
      input.assertPublicationAuthorized();
    } else if (Date.now() >= input.expiresAt) {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_BODY_EXPIRED',
        'the recovered body expired before exact-slot publication',
        410,
      );
    }
  };
  try {
    removeRecoveryContextOrphans(contextDir, contextSlot);
    const currentDigest = freezeContextOccupant(worktree, contextSlot);
    if (currentDigest === contentDigest) {
      const existingMode = statSync(contextPath).mode & 0o777;
      if (existingMode !== 0o600) {
        throw new OperatorRecoveryError(
          'OPERATOR_RECOVERY_CONTEXT_CUSTODY_READBACK_FAILED',
          'the already-published exact context slot is not owner-only',
          503,
        );
      }
      assertPublicationAuthorized();
      return { contextSlot, contextPath, mode: 0o600, contentDigest };
    }
    if (currentDigest !== input.expectedPriorContextDigest) {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_CONTEXT_OCCUPANT_DRIFTED',
        'the exact context-slot occupant changed after operator approval',
        409,
      );
    }
    const temporaryDescriptor = openSync(temporaryPath, 'wx', 0o600);
    try {
      writeFileSync(temporaryDescriptor, bytes, 'utf8');
      fsyncSync(temporaryDescriptor);
    } finally {
      closeSync(temporaryDescriptor);
    }
    chmodSync(temporaryPath, 0o600);
    // The slot lock is held across both digest observations and publication.
    // A cooperating current-context writer cannot enter between this final CAS
    // and rename, closing the former check/replace TOCTOU window.
    assertPublicationAuthorized();
    if (freezeContextOccupant(worktree, contextSlot) !== currentDigest) {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_CONTEXT_OCCUPANT_DRIFTED',
        'the exact context-slot occupant changed during custody publication',
        409,
      );
    }
    renameSync(temporaryPath, contextPath);
    const fileDescriptor = openSync(contextPath, 'r');
    try {
      fsyncSync(fileDescriptor);
    } finally {
      closeSync(fileDescriptor);
    }
    const directoryDescriptor = openSync(contextDir, 'r');
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  } finally {
    lockLease?.release();
  }
  const readback = readFileSync(contextPath);
  const mode = statSync(contextPath).mode & 0o777;
  if (mode !== 0o600 || hashBytes(readback) !== contentDigest) {
    throw new OperatorRecoveryError(
      'OPERATOR_RECOVERY_CONTEXT_CUSTODY_READBACK_FAILED',
      'the exact context slot failed owner-only content readback',
      503,
    );
  }
  return { contextSlot, contextPath, mode: 0o600, contentDigest };
}

function assertSafeEventExtra(extra: Record<string, unknown>): void {
  const forbidden = new Set([
    'jti',
    'macaroonidentifier',
    'identifier',
    'signature',
    'signaturederbase64',
    'credential',
    'grant',
    'rootkey',
  ]);
  const inspect = (value: unknown, path: string): void => {
    if (typeof value === 'string' && value.includes('pdab1.')) {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_LEDGER_SECRET_REFUSED',
        `operator recovery event attempted to persist credential material at ${path}`,
        500,
      );
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => inspect(entry, `${path}[${index}]`));
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [field, nested] of Object.entries(value as Record<string, unknown>)) {
      if (forbidden.has(field.toLowerCase())) {
        throw new OperatorRecoveryError(
          'OPERATOR_RECOVERY_LEDGER_SECRET_REFUSED',
          `operator recovery event attempted to persist forbidden field ${path}.${field}`,
          500,
        );
      }
      inspect(nested, `${path}.${field}`);
    }
  };
  inspect(extra, 'event');
}

export function createOperatorRecovery(deps: OperatorRecoveryDeps) {
  const { db, actorSouls, sessions, daemonGeneration } = deps;
  const maxActiveRecoveriesPerProjectActor = deps.maxActiveRecoveriesPerProjectActor
    ?? DEFAULT_MAX_ACTIVE_RECOVERIES_PER_PROJECT_ACTOR;
  if (
    !Number.isSafeInteger(maxActiveRecoveriesPerProjectActor)
    || maxActiveRecoveriesPerProjectActor <= 0
    || maxActiveRecoveriesPerProjectActor > 500
  ) {
    throw new OperatorRecoveryError(
      'OPERATOR_RECOVERY_ACTIVE_LIMIT_INVALID',
      'maxActiveRecoveriesPerProjectActor must be a positive safe integer no greater than 500',
      500,
    );
  }
  const now = deps.now ?? Date.now;
  const secrets = deps.secrets ?? keychainSecretStore;
  const resolveGitBranch = deps.resolveGitBranch ?? defaultResolveGitBranch;
  const runEnrollment = deps.runEnrollmentHelper === undefined
    ? runOperatorEnrollmentHelper
    : deps.runEnrollmentHelper;
  ensureEventLedgerSchema(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS operator_recovery_projection (
      recovery_id TEXT PRIMARY KEY,
      scope_digest TEXT,
      harbor TEXT,
      project TEXT,
      actor_id TEXT,
      predecessor_session_id TEXT,
      status TEXT NOT NULL,
      action_hash TEXT NOT NULL,
      jti_digest TEXT NOT NULL UNIQUE,
      device_key_id TEXT,
      enrollment_event_id TEXT,
      enrollment_activation_event_id TEXT,
      consumed_at INTEGER,
      terminal_authority_event_id TEXT,
      secret_retirement_pending INTEGER NOT NULL DEFAULT 0,
      envelope_retirement_pending INTEGER NOT NULL DEFAULT 0,
      body_envelope_digest TEXT,
      body_credential_id TEXT,
      successor_session_id TEXT,
      context_installed_at INTEGER,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS operator_recovery_enrollments (
      device_key_id TEXT NOT NULL,
      public_key_x963_base64 TEXT NOT NULL,
      public_key_digest TEXT NOT NULL,
      pinned_event_id TEXT PRIMARY KEY,
      process_identity TEXT NOT NULL,
      response_digest TEXT NOT NULL,
      activation_nonce_digest TEXT NOT NULL,
      activation_event_id TEXT,
      activation_command_digest TEXT,
      activation_receipt_digest TEXT,
      activated_at INTEGER,
      pinned_at INTEGER NOT NULL,
      revoked_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_operator_recovery_enrollment_active
      ON operator_recovery_enrollments(revoked_at, activated_at DESC, pinned_at DESC);
  `);
  const projectionColumns = new Set(
    (db.prepare('PRAGMA table_info(operator_recovery_projection)').all() as Array<{ name: string }>)
      .map((column) => column.name),
  );
  const projectionMigrations: Record<string, string> = {
    scope_digest: 'TEXT',
    harbor: 'TEXT',
    project: 'TEXT',
    actor_id: 'TEXT',
    predecessor_session_id: 'TEXT',
    secret_retirement_pending: 'INTEGER NOT NULL DEFAULT 0',
    envelope_retirement_pending: 'INTEGER NOT NULL DEFAULT 0',
    body_envelope_digest: 'TEXT',
    body_credential_id: 'TEXT',
    successor_session_id: 'TEXT',
    context_installed_at: 'INTEGER',
    enrollment_activation_event_id: 'TEXT',
  };
  for (const [column, definition] of Object.entries(projectionMigrations)) {
    if (!projectionColumns.has(column)) {
      db.prepare(`ALTER TABLE operator_recovery_projection ADD COLUMN ${column} ${definition}`).run();
    }
  }
  const enrollmentColumns = db.prepare('PRAGMA table_info(operator_recovery_enrollments)').all() as
    Array<{ name: string; pk: number }>;
  if (enrollmentColumns.find((column) => column.name === 'device_key_id')?.pk === 1) {
    // This unreleased draft briefly keyed the disposable projection by device.
    // Recreate it by immutable pin event instead, then refill it from the ledger
    // below. Concurrent first-use recoveries may legitimately select the same
    // Secure Enclave key without invalidating each other's signed event id.
    db.exec(`
      DROP TABLE operator_recovery_enrollments;
      CREATE TABLE operator_recovery_enrollments (
        device_key_id TEXT NOT NULL,
        public_key_x963_base64 TEXT NOT NULL,
        public_key_digest TEXT NOT NULL,
        pinned_event_id TEXT PRIMARY KEY,
        process_identity TEXT NOT NULL,
        response_digest TEXT NOT NULL,
        activation_nonce_digest TEXT NOT NULL,
        activation_event_id TEXT,
        activation_command_digest TEXT,
        activation_receipt_digest TEXT,
        activated_at INTEGER,
        pinned_at INTEGER NOT NULL,
        revoked_at INTEGER
      );
      CREATE INDEX idx_operator_recovery_enrollment_active
        ON operator_recovery_enrollments(revoked_at, activated_at DESC, pinned_at DESC);
    `);
  }
  const currentEnrollmentColumns = new Set(
    (db.prepare('PRAGMA table_info(operator_recovery_enrollments)').all() as Array<{ name: string }>)
      .map((column) => column.name),
  );
  const enrollmentMigrations: Record<string, string> = {
    activation_nonce_digest: 'TEXT',
    activation_event_id: 'TEXT',
    activation_command_digest: 'TEXT',
    activation_receipt_digest: 'TEXT',
    activated_at: 'INTEGER',
  };
  for (const [column, definition] of Object.entries(enrollmentMigrations)) {
    if (!currentEnrollmentColumns.has(column)) {
      db.prepare(`ALTER TABLE operator_recovery_enrollments ADD COLUMN ${column} ${definition}`).run();
    }
  }
  db.exec(`
    DROP INDEX IF EXISTS idx_operator_recovery_enrollment_active;
    CREATE INDEX idx_operator_recovery_enrollment_active
      ON operator_recovery_enrollments(revoked_at, activated_at DESC, pinned_at DESC);
  `);

  const rootAccount = (recoveryId: string) => `macaroon/operator-recovery/${recoveryId}/root`;
  const bodyEnvelopeAccount = (recoveryId: string) => `macaroon/operator-recovery/${recoveryId}/body-envelope`;

  function invalidLedger(reason: string): never {
    throw new OperatorRecoveryError(
      'OPERATOR_RECOVERY_LEDGER_INVALID',
      `operator recovery ledger validation failed: ${reason}`,
      500,
    );
  }

  function validatedClaims(value: unknown): FrozenOperatorRecoveryClaim[] {
    if (!Array.isArray(value)) invalidLedger('claims must be an array');
    const seen = new Set<string>();
    const claims = value.map((entry, index) => {
      if (!entry || typeof entry !== 'object') invalidLedger(`claim ${index} is not an object`);
      const claim = entry as Record<string, unknown>;
      if (
        !Number.isSafeInteger(claim.id) ||
        typeof claim.nodeId !== 'string' || claim.nodeId.length === 0 ||
        (claim.disposition !== 'transfer' && claim.disposition !== 'release') ||
        typeof claim.repoId !== 'string' || claim.repoId.length === 0 ||
        !['worktree', 'ref', 'commit', 'harbor'].includes(String(claim.worldKind)) ||
        typeof claim.worldId !== 'string' || claim.worldId.length === 0 ||
        (claim.gitOid !== null && typeof claim.gitOid !== 'string') ||
        !['repo', 'directory', 'file', 'symbol', 'range'].includes(String(claim.selectorKind)) ||
        typeof claim.filePath !== 'string' || claim.filePath.length === 0 ||
        (claim.startLine !== null && !Number.isSafeInteger(claim.startLine)) ||
        (claim.endLine !== null && !Number.isSafeInteger(claim.endLine)) ||
        (claim.symbol !== null && typeof claim.symbol !== 'string') ||
        (claim.symbolPath !== null && typeof claim.symbolPath !== 'string') ||
        typeof claim.sessionId !== 'string' || claim.sessionId.length === 0 ||
        typeof claim.purpose !== 'string' || claim.purpose.length === 0 ||
        (claim.agentId !== null && typeof claim.agentId !== 'string') ||
        typeof claim.phase !== 'string' || claim.phase.length === 0 ||
        !['S', 'X', 'IS', 'IX', 'SIX'].includes(String(claim.mode)) ||
        (claim.intent !== null && typeof claim.intent !== 'string') ||
        !Number.isSafeInteger(claim.claimedAt) ||
        claim.releasedAt !== null ||
        (claim.observedBy !== null && typeof claim.observedBy !== 'string') ||
        typeof claim.confidence !== 'number' || !Number.isFinite(claim.confidence) ||
        claim.confidence < 0 || claim.confidence > 1 ||
        (claim.legacySessionFileId !== null && !Number.isSafeInteger(claim.legacySessionFileId)) ||
        seen.has(claim.nodeId)
      ) invalidLedger(`claim ${index} is malformed or duplicated`);
      seen.add(claim.nodeId);
      const frozen: FrozenOperatorRecoveryClaim = {
        id: claim.id as number,
        nodeId: claim.nodeId,
        disposition: claim.disposition as 'transfer' | 'release',
        repoId: claim.repoId,
        worldKind: claim.worldKind as FrozenOperatorRecoveryClaim['worldKind'],
        worldId: claim.worldId,
        gitOid: claim.gitOid as string | null,
        selectorKind: claim.selectorKind as FrozenOperatorRecoveryClaim['selectorKind'],
        filePath: claim.filePath,
        startLine: claim.startLine as number | null,
        endLine: claim.endLine as number | null,
        symbol: claim.symbol as string | null,
        symbolPath: claim.symbolPath as string | null,
        sessionId: claim.sessionId,
        purpose: claim.purpose,
        agentId: claim.agentId as string | null,
        phase: claim.phase,
        mode: claim.mode as FrozenOperatorRecoveryClaim['mode'],
        intent: claim.intent as string | null,
        claimedAt: claim.claimedAt as number,
        releasedAt: null,
        observedBy: claim.observedBy as string | null,
        confidence: claim.confidence,
        legacySessionFileId: claim.legacySessionFileId as number | null,
      };
      return frozen;
    });
    const sorted = sortClaims(claims);
    if (canonicalJson(claims) !== canonicalJson(sorted)) invalidLedger('claims are not canonically ordered');
    return sorted;
  }

  function immutableEventCoordinates(event: RecoveryEvent) {
    return {
      recoveryId: event.recoveryId,
      harbor: event.harbor,
      intendedAgentId: event.intendedAgentId,
      project: event.project,
      worktree: event.worktree,
      branch: event.branch,
      predecessorSessionId: event.predecessorSessionId,
      sessionIntent: event.sessionIntent,
      actorId: event.actorId,
      daemonGeneration: event.daemonGeneration,
      nonce: event.nonce,
      expiresAt: event.expiresAt,
      bodyExpiresAt: event.bodyExpiresAt,
      jtiDigest: event.jtiDigest,
      contextSlot: event.contextSlot ?? null,
      priorContextDigest: event.priorContextDigest ?? null,
      claims: event.claims,
    };
  }

  function validateRecoveryEvents(events: RecoveryEvent[]): RecoveryEvent[] {
    if (events.length === 0) return events;
    const challenge = events[0];
    if (challenge.kind !== 'challenge-created' || challenge.predecessorEventIds.length !== 0) {
      invalidLedger('the first event must be challenge-created with no predecessor');
    }
    if (
      typeof challenge.eventId !== 'string' || challenge.eventId.length === 0 ||
      typeof challenge.recoveryId !== 'string' || challenge.recoveryId.length === 0 ||
      typeof challenge.actionHash !== 'string' ||
      typeof challenge.harbor !== 'string' ||
      typeof challenge.intendedAgentId !== 'string' ||
      typeof challenge.project !== 'string' ||
      typeof challenge.worktree !== 'string' ||
      typeof challenge.branch !== 'string' ||
      typeof challenge.predecessorSessionId !== 'string' ||
      typeof challenge.sessionIntent !== 'string' ||
      typeof challenge.actorId !== 'string' ||
      typeof challenge.daemonGeneration !== 'string' ||
      typeof challenge.nonce !== 'string' ||
      !Number.isSafeInteger(challenge.expiresAt) ||
      !Number.isSafeInteger(challenge.bodyExpiresAt) ||
      typeof challenge.jtiDigest !== 'string' ||
      typeof challenge.contextSlot !== 'string' ||
      (challenge.priorContextDigest !== null && typeof challenge.priorContextDigest !== 'string')
    ) invalidLedger('challenge coordinates are incomplete or malformed');
    challenge.claims = validatedClaims(challenge.claims);
    if (challenge.claims.some((claim) => claim.sessionId !== challenge.predecessorSessionId)) {
      invalidLedger('claim descriptor names a different predecessor session');
    }
    assertSafeEventExtra(challenge);
    const immutable = canonicalJson(immutableEventCoordinates(challenge));
    const preliminary: Omit<RecoveryCommon, 'actionHash'> = {
      recoveryId: challenge.recoveryId,
      harbor: challenge.harbor,
      intendedAgentId: challenge.intendedAgentId,
      project: challenge.project,
      worktree: challenge.worktree,
      branch: challenge.branch,
      predecessorSessionId: challenge.predecessorSessionId,
      sessionIntent: challenge.sessionIntent,
      actorId: challenge.actorId,
      daemonGeneration: challenge.daemonGeneration,
      nonce: challenge.nonce,
      expiresAt: challenge.expiresAt,
      bodyExpiresAt: challenge.bodyExpiresAt,
      jtiDigest: challenge.jtiDigest,
      contextSlot: challenge.contextSlot,
      priorContextDigest: challenge.priorContextDigest,
      claims: challenge.claims,
    };
    if (challenge.actionHash !== computeActionHash(preliminary)) {
      invalidLedger('challenge action hash does not match its canonical scope');
    }

    let phase: 'unenrolled' | 'activation-pending' | 'pending' | 'approved-half' |
      'approved' | 'bound-half' | 'custody-pending' | 'terminal' = 'unenrolled';
    let boundActionHash: string | null = null;
    let selectedDevice: string | null = null;
    let enrollmentEventId: string | null = null;
    let enrollmentActivationEventId: string | null = null;
    let activationNonceDigest: string | null = null;
    let enrollmentResponseDigest: string | null = null;
    let successorSessionId: string | null = null;
    let bodyCredentialId: string | null = null;
    let bodyEnvelopeDigest: string | null = null;
    let consumedReceipt: RecoveryEvent | null = null;
    const eventIds = new Set<string>();
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      event.claims = validatedClaims(event.claims);
      assertSafeEventExtra(event);
      if (event.recoveryId !== challenge.recoveryId || eventIds.has(event.eventId)) {
        invalidLedger(`event ${index} has a different recovery or duplicate id`);
      }
      eventIds.add(event.eventId);
      if (canonicalJson(immutableEventCoordinates(event)) !== immutable) {
        invalidLedger(`event ${index} changed immutable recovery coordinates`);
      }
      if (index > 0) {
        const previous = events[index - 1];
        if (
          !Array.isArray(event.predecessorEventIds) ||
          event.predecessorEventIds.length !== 1 ||
          event.predecessorEventIds[0] !== previous.eventId
        ) invalidLedger(`event ${index} does not extend the exact predecessor`);
      }
      if (index === 0) continue;

      const isAudit = event.kind === 'drift-refused' || event.kind === 'replay-refused';
      if (isAudit) {
        if (event.actionHash !== (boundActionHash ?? challenge.actionHash)) {
          invalidLedger(`audit event ${index} changed action hash`);
        }
        continue;
      }
      if (event.kind === 'expired') {
        if (phase === 'bound-half' || phase === 'terminal') invalidLedger('expiry is out of order');
        phase = 'terminal';
        continue;
      }
      if (event.kind === 'enrollment-pinned') {
        if (
          phase !== 'unenrolled' ||
          typeof event.deviceKeyId !== 'string' ||
          typeof event.enrollmentEventId !== 'string' ||
          typeof event.enrollmentActivationEventId !== 'string' ||
          typeof event.activationNonceDigest !== 'string' ||
          !/^sha256:[0-9a-f]{64}$/.test(event.activationNonceDigest) ||
          typeof event.responseDigest !== 'string' ||
          !/^sha256:[0-9a-f]{64}$/.test(event.responseDigest)
        ) invalidLedger('enrollment pin is missing or out of order');
        let authoritativePin = event;
        if (event.eventId !== event.enrollmentEventId) {
          const pin = db.prepare(`
            SELECT payload_json FROM harbor_events
            WHERE stream_type = 'operator-recovery-event' AND event_id = ?
          `).get(event.enrollmentEventId) as { payload_json: string } | undefined;
          let pinned: Record<string, unknown> | null = null;
          try { pinned = pin ? JSON.parse(pin.payload_json) as Record<string, unknown> : null; } catch {}
          if (
            pinned?.kind !== 'enrollment-pinned' ||
            pinned?.eventId !== event.enrollmentEventId ||
            pinned?.enrollmentEventId !== event.enrollmentEventId ||
            pinned?.deviceKeyId !== event.deviceKeyId ||
            pinned?.enrollmentActivationEventId !== event.enrollmentActivationEventId ||
            pinned?.responseDigest !== event.responseDigest
          ) invalidLedger('selected enrollment does not reference an immutable pin event');
          authoritativePin = pinned as RecoveryEvent;
          const sourceRecoveryId = typeof pinned.recoveryId === 'string'
            ? pinned.recoveryId
            : invalidLedger('selected enrollment pin has no source recovery');
          const sourceEvents = eventsFor(sourceRecoveryId);
          const activation = sourceEvents.find((source) => (
            source.eventId === event.enrollmentActivationEventId
          ));
          if (
            activation?.kind !== 'enrollment-activated' ||
            activation.enrollmentEventId !== event.enrollmentEventId ||
            activation.enrollmentActivationEventId !== event.enrollmentActivationEventId ||
            activation.deviceKeyId !== event.deviceKeyId
          ) invalidLedger('selected enrollment does not reference an activated immutable pin');
        }
        if (
          typeof authoritativePin.publicKeyX963Base64 !== 'string' ||
          typeof authoritativePin.publicKeyDigest !== 'string' ||
          !/^sha256:[0-9a-f]{64}$/.test(authoritativePin.publicKeyDigest) ||
          authoritativePin.deviceKeyId !== `se-p256:${authoritativePin.publicKeyDigest.slice('sha256:'.length)}`
        ) invalidLedger('enrollment pin has an invalid device-key binding');
        let publicKey: Buffer;
        try {
          publicKey = canonicalBase64(
            authoritativePin.publicKeyX963Base64,
            'publicKeyX963Base64',
          );
        } catch {
          return invalidLedger('enrollment pin public key is not canonical base64');
        }
        if (hashBytes(publicKey) !== authoritativePin.publicKeyDigest) {
          invalidLedger('enrollment pin public-key digest does not match its bytes');
        }
        const withEnrollment: Omit<RecoveryCommon, 'actionHash'> = {
          ...preliminary,
          deviceKeyId: event.deviceKeyId,
          enrollmentEventId: event.enrollmentEventId,
          enrollmentActivationEventId: event.enrollmentActivationEventId,
        };
        boundActionHash = computeActionHash(withEnrollment);
        if (event.actionHash !== boundActionHash) invalidLedger('enrollment action hash is invalid');
        selectedDevice = event.deviceKeyId;
        enrollmentEventId = event.enrollmentEventId;
        enrollmentActivationEventId = event.enrollmentActivationEventId;
        activationNonceDigest = event.activationNonceDigest;
        enrollmentResponseDigest = event.responseDigest;
        phase = event.eventId === event.enrollmentEventId ? 'activation-pending' : 'pending';
        continue;
      }
      if (event.kind === 'enrollment-activated') {
        if (
          phase !== 'activation-pending' ||
          event.eventId !== enrollmentActivationEventId ||
          event.deviceKeyId !== selectedDevice ||
          event.enrollmentEventId !== enrollmentEventId ||
          event.enrollmentActivationEventId !== enrollmentActivationEventId ||
          event.activationNonceDigest !== activationNonceDigest ||
          event.responseDigest !== enrollmentResponseDigest ||
          typeof event.activationCommandDigest !== 'string' ||
          !/^sha256:[0-9a-f]{64}$/.test(event.activationCommandDigest) ||
          typeof event.activationReceiptDigest !== 'string' ||
          !/^sha256:[0-9a-f]{64}$/.test(event.activationReceiptDigest) ||
          event.actionHash !== boundActionHash
        ) invalidLedger('enrollment activation proof is missing, changed, or out of order');
        phase = 'pending';
        continue;
      }
      if (
        !boundActionHash ||
        event.actionHash !== boundActionHash ||
        event.deviceKeyId !== selectedDevice ||
        event.enrollmentEventId !== enrollmentEventId ||
        event.enrollmentActivationEventId !== enrollmentActivationEventId
      ) invalidLedger(`event ${index} is not bound to the selected enrollment`);
      if (
        ['approved', 'denied', 'grant-revoked'].includes(event.kind)
        && (
          typeof event.signatureDigest !== 'string'
          || !/^sha256:[0-9a-f]{64}$/.test(event.signatureDigest)
          || typeof event.signedRequestDigest !== 'string'
          || !/^sha256:[0-9a-f]{64}$/.test(event.signedRequestDigest)
        )
      ) invalidLedger(`decision event ${index} lacks its exact signed-request digest`);
      if (event.kind === 'approved') {
        if (phase !== 'pending') invalidLedger('approved is out of order');
        phase = 'approved-half';
      } else if (event.kind === 'grant-minted') {
        if (phase !== 'approved-half') invalidLedger('grant-minted is out of order');
        phase = 'approved';
      } else if (event.kind === 'denied') {
        if (phase !== 'pending') invalidLedger('denied is out of order');
        phase = 'terminal';
      } else if (event.kind === 'grant-revoked') {
        if (phase !== 'approved') invalidLedger('grant-revoked is out of order');
        phase = 'terminal';
      } else if (event.kind === 'grant-consumed') {
        if (phase !== 'approved') invalidLedger('grant-consumed is out of order');
        const expectedTransferred = challenge.claims
          .filter((claim) => claim.disposition === 'transfer')
          .map((claim) => claim.nodeId)
          .sort();
        const expectedReleased = challenge.claims
          .filter((claim) => claim.disposition === 'release')
          .map((claim) => claim.nodeId)
          .sort();
        const transferred = Array.isArray(event.transferredClaimNodeIds)
          ? event.transferredClaimNodeIds
          : null;
        const released = Array.isArray(event.releasedClaimNodeIds)
          ? event.releasedClaimNodeIds
          : null;
        if (
          typeof event.successorSessionId !== 'string' ||
          typeof event.bodyCredentialId !== 'string' ||
          typeof event.bodyEnvelopeDigest !== 'string' ||
          !/^sha256:[0-9a-f]{64}$/.test(event.bodyEnvelopeDigest) ||
          event.credentialProfile !== 'session-body-v1' ||
          !Number.isSafeInteger(event.boundAt) ||
          !Number.isSafeInteger(event.bodyIssuedAt) ||
          event.bodyExpiresAt !== challenge.bodyExpiresAt ||
          Number(event.bodyIssuedAt) >= Number(event.bodyExpiresAt) ||
          !transferred || !transferred.every((value) => typeof value === 'string') ||
          !released || !released.every((value) => typeof value === 'string') ||
          canonicalJson([...transferred].sort()) !== canonicalJson(expectedTransferred) ||
          canonicalJson([...released].sort()) !== canonicalJson(expectedReleased)
        ) invalidLedger('grant-consumed lacks sealed successor custody coordinates');
        successorSessionId = event.successorSessionId;
        bodyCredentialId = event.bodyCredentialId;
        bodyEnvelopeDigest = event.bodyEnvelopeDigest;
        consumedReceipt = event;
        phase = 'bound-half';
      } else if (event.kind === 'session-bound') {
        if (
          phase !== 'bound-half' ||
          !consumedReceipt ||
          event.successorSessionId !== successorSessionId ||
          event.bodyCredentialId !== bodyCredentialId ||
          event.bodyEnvelopeDigest !== bodyEnvelopeDigest ||
          event.boundAt !== consumedReceipt.boundAt ||
          event.bodyIssuedAt !== consumedReceipt.bodyIssuedAt ||
          event.bodyExpiresAt !== consumedReceipt.bodyExpiresAt ||
          event.credentialProfile !== consumedReceipt.credentialProfile ||
          event.canonicalActorVerified !== true
        ) invalidLedger('session-bound differs from the consumed grant');
        phase = 'custody-pending';
      } else if (event.kind === 'context-custody-installed') {
        if (
          phase !== 'custody-pending' ||
          event.successorSessionId !== successorSessionId ||
          event.bodyCredentialId !== bodyCredentialId ||
          event.bodyEnvelopeDigest !== bodyEnvelopeDigest
        ) invalidLedger('context custody differs from the bound successor');
        phase = 'terminal';
      } else {
        invalidLedger(`event ${index} has no legal state transition`);
      }
    }
    if (phase === 'approved-half' || phase === 'bound-half') {
      invalidLedger('authority ledger ends in a partial transaction');
    }
    return events;
  }

  function eventsFor(recoveryId: string): RecoveryEvent[] {
    const rows = db.prepare(`
      SELECT ledger_seq, payload_json
      FROM harbor_events
      WHERE stream_type = 'operator-recovery-event'
        AND json_extract(payload_json, '$.recoveryId') = ?
      ORDER BY ledger_seq ASC
    `).all(recoveryId) as Array<{ ledger_seq: number; payload_json: string }>;
    const events = rows.map((row) => {
      let parsed: Partial<RecoveryEvent>;
      try {
        parsed = JSON.parse(row.payload_json) as Partial<RecoveryEvent>;
      } catch {
        return invalidLedger(`ledger sequence ${row.ledger_seq} is not JSON`);
      }
      if (
        parsed.schema !== OPERATOR_RECOVERY_EVENT_SCHEMA ||
        typeof parsed.recoveryId !== 'string' ||
        parsed.recoveryId !== recoveryId ||
        typeof parsed.eventId !== 'string' ||
        typeof parsed.kind !== 'string' ||
        !OPERATOR_RECOVERY_EVENT_KINDS.includes(parsed.kind as OperatorRecoveryEventKind) ||
        !Array.isArray(parsed.predecessorEventIds)
      ) return invalidLedger(`ledger sequence ${row.ledger_seq} has the wrong recovery schema`);
      return { ...parsed, ledgerSeq: row.ledger_seq } as RecoveryEvent;
    });
    return validateRecoveryEvents(events);
  }

  function stateFor(recoveryId: string): RecoveryState {
    const events = eventsFor(recoveryId);
    const challenge = events.find((event) => event.kind === 'challenge-created');
    if (!challenge) {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_NOT_FOUND',
        'operator recovery challenge not found',
        404,
      );
    }
    const enrollment = [...events].reverse().find((event) => event.kind === 'enrollment-pinned');
    const enrollmentActivation = [...events].reverse().find((event) => (
      event.kind === 'enrollment-activated' &&
      event.enrollmentEventId === enrollment?.enrollmentEventId
    ));
    const enrollmentActivationEventId = typeof enrollmentActivation?.enrollmentActivationEventId === 'string'
      ? enrollmentActivation.enrollmentActivationEventId
      : typeof enrollment?.enrollmentActivationEventId === 'string'
        ? enrollment.enrollmentActivationEventId
        : undefined;
    const enrollmentActivated = Boolean(
      enrollmentActivation ||
      (enrollment && enrollment.eventId !== enrollment.enrollmentEventId),
    );
    const common: RecoveryCommon = {
      recoveryId: challenge.recoveryId,
      actionHash: enrollment?.actionHash ?? challenge.actionHash,
      harbor: challenge.harbor,
      intendedAgentId: challenge.intendedAgentId,
      project: challenge.project,
      worktree: challenge.worktree,
      branch: challenge.branch,
      predecessorSessionId: challenge.predecessorSessionId,
      sessionIntent: challenge.sessionIntent,
      actorId: challenge.actorId,
      daemonGeneration: challenge.daemonGeneration,
      nonce: challenge.nonce,
      expiresAt: challenge.expiresAt,
      bodyExpiresAt: challenge.bodyExpiresAt,
      jtiDigest: challenge.jtiDigest,
      contextSlot: challenge.contextSlot ?? null,
      priorContextDigest: challenge.priorContextDigest ?? null,
      claims: challenge.claims,
      ...(enrollment?.deviceKeyId ? { deviceKeyId: enrollment.deviceKeyId } : {}),
      ...(enrollment?.enrollmentEventId ? { enrollmentEventId: enrollment.enrollmentEventId } : {}),
      ...(enrollmentActivationEventId ? { enrollmentActivationEventId } : {}),
    };
    const has = (kind: OperatorRecoveryEventKind) => events.some((event) => event.kind === kind);
    const status: RecoveryState['status'] = has('context-custody-installed')
      ? 'consumed'
      : has('expired')
        ? 'expired'
        : has('session-bound') || has('grant-consumed')
          ? 'custody-pending'
          : has('grant-revoked')
        ? 'revoked'
          : has('denied')
            ? 'denied'
            : has('grant-minted') || has('approved')
              ? 'approved'
              : 'pending';
    const terminal = [...events].reverse().find((event) => event.kind === 'context-custody-installed')
      ?? [...events].reverse().find((event) => event.kind === 'grant-revoked')
      ?? [...events].reverse().find((event) => event.kind === 'denied')
      ?? [...events].reverse().find((event) => event.kind === 'expired');
    const bound = [...events].reverse().find((event) => event.kind === 'session-bound');
    return {
      common,
      events,
      status,
      lastEventId: events.at(-1)!.eventId,
      terminalAuthorityEventId: terminal?.eventId ?? null,
      successorSessionId: typeof bound?.successorSessionId === 'string'
        ? bound.successorSessionId
        : null,
      bodyCredentialId: typeof bound?.bodyCredentialId === 'string'
        ? bound.bodyCredentialId
        : null,
      bodyEnvelopeDigest: typeof bound?.bodyEnvelopeDigest === 'string'
        ? bound.bodyEnvelopeDigest
        : null,
      enrollmentActivated,
    };
  }

  function appendRecoveryEvent(
    common: RecoveryCommon,
    kind: OperatorRecoveryEventKind,
    extra: Record<string, unknown> = {},
    predecessorEventIds: string[] = [],
    fixedEventId?: string,
  ) {
    assertSafeEventExtra(extra);
    const occurredAt = new Date(now()).toISOString();
    const eventId = fixedEventId
      ?? `operator-recovery:${common.recoveryId}:${kind}:${randomBytes(8).toString('hex')}`;
    const payload: HarborPayload = {
      ...extra,
      schema: OPERATOR_RECOVERY_EVENT_SCHEMA,
      eventId,
      recoveryId: common.recoveryId,
      actionHash: common.actionHash,
      harbor: common.harbor,
      intendedAgentId: common.intendedAgentId,
      project: common.project,
      worktree: common.worktree,
      branch: common.branch,
      predecessorSessionId: common.predecessorSessionId,
      sessionIntent: common.sessionIntent,
      actorId: common.actorId,
      daemonGeneration: common.daemonGeneration,
      nonce: common.nonce,
      expiresAt: common.expiresAt,
      bodyExpiresAt: common.bodyExpiresAt,
      jtiDigest: common.jtiDigest,
      contextSlot: common.contextSlot,
      priorContextDigest: common.priorContextDigest,
      claims: sortClaims(common.claims),
      ...(common.deviceKeyId ? { deviceKeyId: common.deviceKeyId } : {}),
      ...(common.enrollmentEventId ? { enrollmentEventId: common.enrollmentEventId } : {}),
      ...(common.enrollmentActivationEventId
        ? { enrollmentActivationEventId: common.enrollmentActivationEventId }
        : {}),
      kind,
      occurredAt,
      predecessorEventIds,
    };
    const result = appendEvent(db, { streamType: 'operator-recovery-event', payload });
    return { ...result, eventId, payload: { ...payload, ledgerSeq: result.ledgerSeq } as RecoveryEvent };
  }

  function publicState(state: RecoveryState) {
    const canSign = Boolean(
      state.enrollmentActivated &&
      state.common.deviceKeyId &&
      state.common.enrollmentEventId &&
      state.common.enrollmentActivationEventId,
    );
    const pending = state.status === 'pending' && canSign;
    const approved = state.status === 'approved' && canSign;
    const approve = pending ? signingPayload(state.common, 'approve') : null;
    const deny = pending ? signingPayload(state.common, 'deny') : null;
    const revoke = approved ? signingPayload(state.common, 'revoke') : null;
    const hasBoundSuccessor = Boolean(
      state.successorSessionId && state.bodyCredentialId && state.bodyEnvelopeDigest,
    );
    const binding = hasBoundSuccessor
      ? bindingReceiptForState(state)
      : null;
    const bodyCredential = hasBoundSuccessor
      ? bodyCredentialReceiptForState(state)
      : null;
    const custody = state.status === 'consumed' ? custodyReceiptForState(state) : null;
    return {
      recoveryId: state.common.recoveryId,
      status: state.status,
      scope: {
        actionHash: state.common.actionHash,
        harbor: state.common.harbor,
        intendedAgentId: state.common.intendedAgentId,
        project: state.common.project,
        worktree: state.common.worktree,
        branch: state.common.branch,
        predecessorSessionId: state.common.predecessorSessionId,
        sessionIntent: state.common.sessionIntent,
        actorId: state.common.actorId,
        daemonGeneration: state.common.daemonGeneration,
        nonce: state.common.nonce,
        expiresAt: state.common.expiresAt,
        bodyExpiresAt: state.common.bodyExpiresAt,
        jtiDigest: state.common.jtiDigest,
        contextSlot: state.common.contextSlot,
        priorContextDigest: state.common.priorContextDigest,
        deviceKeyId: state.common.deviceKeyId ?? null,
        enrollmentEventId: state.common.enrollmentEventId ?? null,
        enrollmentActivationEventId: state.common.enrollmentActivationEventId ?? null,
        claims: sortClaims(state.common.claims),
      },
      signing: pending ? {
        approve: { challengeBytesBase64: approve!.bytesBase64, challengeDigest: approve!.digest },
        deny: { challengeBytesBase64: deny!.bytesBase64, challengeDigest: deny!.digest },
        revoke: null,
      } : approved ? {
        approve: null,
        deny: null,
        revoke: { challengeBytesBase64: revoke!.bytesBase64, challengeDigest: revoke!.digest },
      } : null,
      successorSessionId: state.successorSessionId,
      ...(binding ? { binding } : {}),
      ...(bodyCredential ? { bodyCredential } : {}),
      ...(custody ? { custody } : {}),
      receipt: {
        ledgerSequences: state.events.map((event) => event.ledgerSeq),
        eventIds: state.events.map((event) => event.eventId),
        terminalAuthorityEventId: state.terminalAuthorityEventId,
        terminalEventId: state.events.at(-1)?.eventId ?? null,
      },
      events: state.events.map((event) => {
        const { publicKeyX963Base64: _publicKey, ledgerSeq, ...safe } = event;
        return { ...safe, ledgerSeq };
      }),
    };
  }

  function bindingReceiptForState(state: RecoveryState): OperatorRecoveryBindReceipt | null {
    const consumed = [...state.events].reverse().find((event) => event.kind === 'grant-consumed');
    const bound = [...state.events].reverse().find((event) => event.kind === 'session-bound');
    if (!consumed || !bound || !state.successorSessionId) return null;
    if (
      !Array.isArray(consumed.transferredClaimNodeIds) ||
      !consumed.transferredClaimNodeIds.every((value) => typeof value === 'string') ||
      !Array.isArray(consumed.releasedClaimNodeIds) ||
      !consumed.releasedClaimNodeIds.every((value) => typeof value === 'string')
    ) return null;
    const transferredClaimNodeIds = consumed.transferredClaimNodeIds as string[];
    const releasedClaimNodeIds = consumed.releasedClaimNodeIds as string[];
    if (
      !Number.isSafeInteger(consumed.boundAt) ||
      bound.boundAt !== consumed.boundAt
    ) return null;
    return {
      predecessorSessionId: state.common.predecessorSessionId,
      successorSessionId: state.successorSessionId,
      actorId: state.common.actorId,
      intendedAgentId: state.common.intendedAgentId,
      transferredClaimNodeIds,
      releasedClaimNodeIds,
      boundAt: Number(consumed.boundAt),
    };
  }

  function bodyCredentialReceiptForState(state: RecoveryState) {
    if (!state.bodyCredentialId || !state.successorSessionId) return null;
    const consumed = [...state.events].reverse().find((event) => event.kind === 'grant-consumed');
    const bound = [...state.events].reverse().find((event) => event.kind === 'session-bound');
    if (
      !consumed || !bound ||
      consumed.credentialProfile !== 'session-body-v1' ||
      bound.credentialProfile !== 'session-body-v1' ||
      !Number.isSafeInteger(consumed.bodyIssuedAt) ||
      !Number.isSafeInteger(consumed.bodyExpiresAt) ||
      bound.bodyIssuedAt !== consumed.bodyIssuedAt ||
      bound.bodyExpiresAt !== consumed.bodyExpiresAt
    ) return null;
    return {
      bodyId: state.bodyCredentialId,
      actorId: state.common.actorId,
      intendedAgentId: state.common.intendedAgentId,
      scopeProfile: 'session-body-v1' as const,
      scope: {
        harbor: state.common.harbor,
        sessionId: state.successorSessionId,
        project: state.common.project,
        canonicalWorktree: state.common.worktree,
        branch: state.common.branch,
      },
      issuedAt: Number(consumed.bodyIssuedAt),
      expiresAt: Number(consumed.bodyExpiresAt),
    };
  }

  function custodyReceiptForState(state: RecoveryState) {
    const installed = [...state.events].reverse()
      .find((event) => event.kind === 'context-custody-installed');
    if (
      !installed ||
      installed.successorSessionId !== state.successorSessionId ||
      installed.bodyCredentialId !== state.bodyCredentialId ||
      installed.bodyEnvelopeDigest !== state.bodyEnvelopeDigest ||
      typeof installed.contextMode !== 'number' ||
      installed.contextMode !== 0o600 ||
      !state.common.contextSlot
    ) return null;
    return {
      installed: true as const,
      contextSlot: state.common.contextSlot,
      canonicalWorktree: state.common.worktree,
      mode: installed.contextMode,
    };
  }

  function completedPublicResponse(state: RecoveryState) {
    const binding = bindingReceiptForState(state);
    const bodyCredential = bodyCredentialReceiptForState(state);
    const custody = custodyReceiptForState(state);
    if (state.status !== 'consumed' || !binding || !bodyCredential || !custody) {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_BINDING_READBACK_FAILED',
        'the terminal recovery receipt cannot be reconstructed from canonical state',
        503,
      );
    }
    return { ...publicState(state), binding, bodyCredential, custody };
  }

  function eventTimestamp(event: RecoveryEvent | undefined, fallback: number): number {
    if (!event) return fallback;
    const parsed = Date.parse(event.occurredAt);
    return Number.isSafeInteger(parsed) ? parsed : fallback;
  }

  /**
   * Rebuild both disposable projections from the append-only ledger. This runs
   * under IMMEDIATE so another daemon/process can never observe a half-rebuilt
   * one-shot gate. Projection rows cannot create or preserve authority that is
   * absent from `harbor_events`.
   */
  function rebuildProjectionsFromLedger(): void {
    const transaction = db.transaction(() => {
      db.exec(`
        DROP INDEX IF EXISTS uq_operator_recovery_active_scope;
        DROP INDEX IF EXISTS uq_operator_recovery_active_predecessor;
        DROP INDEX IF EXISTS idx_operator_recovery_active_project_actor;
      `);
      const rawRows = db.prepare(`
        SELECT ledger_seq, payload_json
        FROM harbor_events
        WHERE stream_type = 'operator-recovery-event'
        ORDER BY ledger_seq ASC
      `).all() as Array<{ ledger_seq: number; payload_json: string }>;
      const parsed = rawRows.map((row) => {
        try {
          const event = JSON.parse(row.payload_json) as Partial<RecoveryEvent>;
          if (
            event.schema !== OPERATOR_RECOVERY_EVENT_SCHEMA ||
            typeof event.recoveryId !== 'string' ||
            typeof event.eventId !== 'string' ||
            typeof event.kind !== 'string' ||
            !OPERATOR_RECOVERY_EVENT_KINDS.includes(event.kind as OperatorRecoveryEventKind)
          ) return invalidLedger(`ledger sequence ${row.ledger_seq} cannot be projected`);
          return { ...event, ledgerSeq: row.ledger_seq } as RecoveryEvent;
        } catch {
          return invalidLedger(`ledger sequence ${row.ledger_seq} cannot be parsed`);
        }
      });

      const recoveryIds = [...new Set(parsed.map((event) => event.recoveryId))];
      const validated = recoveryIds.flatMap((recoveryId) => eventsFor(recoveryId));

      db.prepare('DELETE FROM operator_recovery_enrollments').run();
      const activationsByPin = new Map<string, RecoveryEvent>();
      for (const event of validated) {
        if (
          event.kind === 'enrollment-activated' &&
          typeof event.enrollmentEventId === 'string' &&
          typeof event.enrollmentActivationEventId === 'string' &&
          event.eventId === event.enrollmentActivationEventId
        ) {
          activationsByPin.set(event.enrollmentEventId, event);
        }
      }
      for (const event of validated) {
        if (
          event.kind !== 'enrollment-pinned' ||
          typeof event.deviceKeyId !== 'string' ||
          typeof event.enrollmentEventId !== 'string' ||
          event.eventId !== event.enrollmentEventId ||
          typeof event.publicKeyX963Base64 !== 'string' ||
          typeof event.publicKeyDigest !== 'string' ||
          typeof event.processIdentity !== 'string' ||
          typeof event.responseDigest !== 'string'
        ) continue;
        const activation = activationsByPin.get(event.enrollmentEventId);
        db.prepare(`
          INSERT INTO operator_recovery_enrollments (
            device_key_id, public_key_x963_base64, public_key_digest,
            pinned_event_id, process_identity, response_digest,
            activation_nonce_digest,
            activation_event_id, activation_command_digest,
            activation_receipt_digest, activated_at, pinned_at, revoked_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
          ON CONFLICT(pinned_event_id) DO UPDATE SET
            device_key_id = excluded.device_key_id,
            public_key_x963_base64 = excluded.public_key_x963_base64,
            public_key_digest = excluded.public_key_digest,
            process_identity = excluded.process_identity,
            response_digest = excluded.response_digest,
            activation_nonce_digest = excluded.activation_nonce_digest,
            activation_event_id = excluded.activation_event_id,
            activation_command_digest = excluded.activation_command_digest,
            activation_receipt_digest = excluded.activation_receipt_digest,
            activated_at = excluded.activated_at,
            pinned_at = excluded.pinned_at,
            revoked_at = NULL
        `).run(
          event.deviceKeyId,
          event.publicKeyX963Base64,
          event.publicKeyDigest,
          event.enrollmentEventId,
          event.processIdentity,
          event.responseDigest,
          event.activationNonceDigest,
          activation?.eventId ?? null,
          activation?.activationCommandDigest ?? null,
          activation?.activationReceiptDigest ?? null,
          activation ? eventTimestamp(activation, now()) : null,
          eventTimestamp(event, now()),
        );
      }

      db.prepare('DELETE FROM operator_recovery_projection').run();
      for (const recoveryId of recoveryIds) {
        const state = stateFor(recoveryId);
        const consumed = state.events.find((event) => event.kind === 'grant-consumed');
        const installed = state.events.find((event) => event.kind === 'context-custody-installed');
        const terminalAuthority = state.events.find((event) => (
          event.eventId === state.terminalAuthorityEventId
        ));
        const rootPendingEvent = [...state.events].reverse().find((event) => (
          event.code === 'OPERATOR_RECOVERY_SECRET_RETIREMENT_PENDING'
        ));
        const rootCompletedEvent = [...state.events].reverse().find((event) => (
          event.code === 'OPERATOR_RECOVERY_SECRET_RETIREMENT_COMPLETED'
        ));
        const envelopePendingEvent = [...state.events].reverse().find((event) => (
          event.code === 'OPERATOR_RECOVERY_ENVELOPE_RETIREMENT_PENDING'
        ));
        const envelopeCompletedEvent = [...state.events].reverse().find((event) => (
          event.code === 'OPERATOR_RECOVERY_ENVELOPE_RETIREMENT_COMPLETED'
        ));
        const retirementPending = (
          pending: RecoveryEvent | undefined,
          completed: RecoveryEvent | undefined,
        ) => (
          (pending?.ledgerSeq ?? -1) > (completed?.ledgerSeq ?? -1) ||
          (terminalAuthority?.ledgerSeq ?? -1) > (completed?.ledgerSeq ?? -1)
        );
        db.prepare(`
          INSERT INTO operator_recovery_projection (
            recovery_id, scope_digest, harbor, project, actor_id, predecessor_session_id,
            status, action_hash, jti_digest,
            device_key_id, enrollment_event_id, enrollment_activation_event_id, consumed_at,
            terminal_authority_event_id, secret_retirement_pending,
            envelope_retirement_pending, body_envelope_digest,
            body_credential_id, successor_session_id, context_installed_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          recoveryId,
          computeFrozenScopeDigest(state.common),
          state.common.harbor,
          state.common.project,
          state.common.actorId,
          state.common.predecessorSessionId,
          state.status,
          state.common.actionHash,
          state.common.jtiDigest,
          state.common.deviceKeyId ?? null,
          state.common.enrollmentEventId ?? null,
          state.common.enrollmentActivationEventId ?? null,
          consumed ? eventTimestamp(consumed, now()) : null,
          state.terminalAuthorityEventId,
          retirementPending(rootPendingEvent, rootCompletedEvent) ? 1 : 0,
          retirementPending(envelopePendingEvent, envelopeCompletedEvent) ? 1 : 0,
          state.bodyEnvelopeDigest,
          state.bodyCredentialId,
          state.successorSessionId,
          installed ? eventTimestamp(installed, now()) : null,
          eventTimestamp(state.events.at(-1), now()),
        );
      }
      const incomplete = db.prepare(`
        SELECT recovery_id
        FROM operator_recovery_projection
        WHERE status IN ('pending', 'approved', 'custody-pending')
          AND (
            scope_digest IS NULL OR harbor IS NULL OR project IS NULL OR
            actor_id IS NULL OR predecessor_session_id IS NULL
          )
        LIMIT 1
      `).get() as { recovery_id: string } | undefined;
      if (incomplete) invalidLedger(`active recovery ${incomplete.recovery_id} has incomplete admission coordinates`);
      const duplicateScope = db.prepare(`
        SELECT scope_digest
        FROM operator_recovery_projection
        WHERE status IN ('pending', 'approved', 'custody-pending')
        GROUP BY scope_digest HAVING COUNT(*) > 1
        LIMIT 1
      `).get() as { scope_digest: string } | undefined;
      if (duplicateScope) invalidLedger('multiple active recoveries claim the same frozen scope');
      const duplicatePredecessor = db.prepare(`
        SELECT harbor, predecessor_session_id
        FROM operator_recovery_projection
        WHERE status IN ('pending', 'approved', 'custody-pending')
        GROUP BY harbor, predecessor_session_id HAVING COUNT(*) > 1
        LIMIT 1
      `).get() as { harbor: string; predecessor_session_id: string } | undefined;
      if (duplicatePredecessor) invalidLedger('multiple active recoveries claim the same predecessor');
      db.exec(`
        CREATE UNIQUE INDEX uq_operator_recovery_active_scope
          ON operator_recovery_projection(scope_digest)
          WHERE status IN ('pending', 'approved', 'custody-pending');
        CREATE UNIQUE INDEX uq_operator_recovery_active_predecessor
          ON operator_recovery_projection(harbor, predecessor_session_id)
          WHERE status IN ('pending', 'approved', 'custody-pending');
        CREATE INDEX idx_operator_recovery_active_project_actor
          ON operator_recovery_projection(harbor, project, actor_id, status)
          WHERE status IN ('pending', 'approved', 'custody-pending');
      `);
    });
    transaction.immediate();
  }

  function getActiveEnrollment(): EnrollmentProjectionRow | null {
    return (db.prepare(`
      SELECT * FROM operator_recovery_enrollments
      WHERE revoked_at IS NULL
        AND activation_event_id IS NOT NULL
        AND activation_command_digest IS NOT NULL
        AND activation_receipt_digest IS NOT NULL
        AND activated_at IS NOT NULL
      ORDER BY activated_at DESC, pinned_at DESC, pinned_event_id DESC
      LIMIT 1
    `).get() as EnrollmentProjectionRow | undefined) ?? null;
  }

  function normalizeCreateRequest(input: CreateOperatorRecoveryChallengeInput) {
    const harbor = cleanString(input.harbor ?? actorSouls.constants.defaultHarbor, 'harbor');
    const intendedAgentId = cleanString(input.intendedAgentId, 'intendedAgentId');
    const project = cleanString(input.project, 'project');
    const worktree = canonicalWorktree(input.worktree);
    const branch = cleanString(input.branch, 'branch');
    const predecessorSessionId = cleanString(input.predecessorSessionId, 'predecessorSessionId');
    const sessionIntent = cleanString(input.sessionIntent, 'sessionIntent');
    const actorId = cleanString(input.actorId, 'actorId');
    const contextSlot = canonicalContextSlot(input.contextSlot);
    if (!contextSlot) {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_CONTEXT_SLOT_REQUIRED',
        'contextSlot is required so the recovered credential has exactly one bounded custodian',
        400,
      );
    }
    if (!Array.isArray(input.claims)) {
      throw new OperatorRecoveryError('OPERATOR_RECOVERY_VALIDATION', 'claims must be an exhaustive array', 400);
    }
    const requested = new Map<string, OperatorRecoveryClaimChange>();
    for (const candidate of input.claims) {
      const nodeId = cleanString(candidate?.nodeId, 'claims[].nodeId');
      if (
        (candidate.disposition !== 'transfer' && candidate.disposition !== 'release') ||
        requested.has(nodeId)
      ) {
        throw new OperatorRecoveryError(
          'OPERATOR_RECOVERY_VALIDATION',
          'claim node ids must be unique and each disposition must be transfer or release',
          400,
        );
      }
      requested.set(nodeId, { nodeId, disposition: candidate.disposition });
    }
    return {
      harbor,
      intendedAgentId,
      project,
      worktree,
      branch,
      predecessorSessionId,
      sessionIntent,
      actorId,
      contextSlot,
      requested: [...requested.values()].sort((left, right) => left.nodeId.localeCompare(right.nodeId)),
    };
  }

  function freezeLiveScope(input: CreateOperatorRecoveryChallengeInput) {
    const normalized = normalizeCreateRequest(input);
    const {
      harbor,
      intendedAgentId,
      project,
      worktree,
      branch,
      predecessorSessionId,
      sessionIntent,
      actorId,
      contextSlot,
    } = normalized;
    const priorContextDigest = freezeContextOccupant(worktree, contextSlot);
    const requested = new Map(normalized.requested.map((claim) => [claim.nodeId, claim]));
    if (!actorSouls.getSoul(actorId, harbor)) {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_ACTOR_MISMATCH',
        'the durable actor named by this recovery does not exist in the bound harbor',
      );
    }
    const detail = sessions.get(predecessorSessionId) as Record<string, unknown>;
    if (detail.success !== true) {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_PREDECESSOR_NOT_FOUND',
        'predecessor session does not exist',
        404,
      );
    }
    const session = detail.session as Record<string, unknown>;
    const metadata = session.metadata as Record<string, unknown> | null;
    const identity = metadata?.identity as Record<string, unknown> | undefined;
    const worktreeBinding = metadata?.worktree as Record<string, unknown> | undefined;
    if (
      session.status !== 'active' ||
      session.agentId !== intendedAgentId ||
      session.identityProject !== project ||
      identity?.verified !== true ||
      identity.actorId !== actorId ||
      worktreeBinding?.root !== worktree ||
      worktreeBinding?.branch !== branch
    ) {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_DRIFTED',
        'predecessor identity, owner, project, worktree, or branch differs from the requested recovery',
      );
    }
    const live = (Array.isArray(detail.files) ? detail.files : []) as Array<Record<string, unknown>>;
    const active = live.filter((claim) => claim.releasedAt === null);
    if (active.length !== requested.size || active.some((claim) => !requested.has(String(claim.nodeId)))) {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_DRIFTED',
        'the request is not an exhaustive map of the predecessor active claims',
      );
    }
    const claims: FrozenOperatorRecoveryClaim[] = active.map((claim) => {
      const nodeId = String(claim.nodeId);
      const choice = requested.get(nodeId)!;
      return {
        id: Number(claim.id),
        nodeId,
        disposition: choice.disposition,
        repoId: cleanString(claim.repoId, 'claim.repoId'),
        worldKind: claim.worldKind as FrozenOperatorRecoveryClaim['worldKind'],
        worldId: cleanString(claim.worldId, 'claim.worldId'),
        gitOid: typeof claim.gitOid === 'string' ? claim.gitOid : null,
        selectorKind: claim.selectorKind as FrozenOperatorRecoveryClaim['selectorKind'],
        filePath: cleanString(claim.filePath, 'claim.filePath'),
        startLine: typeof claim.startLine === 'number' ? claim.startLine : null,
        endLine: typeof claim.endLine === 'number' ? claim.endLine : null,
        symbol: typeof claim.symbol === 'string' ? claim.symbol : null,
        symbolPath: typeof claim.symbolPath === 'string' ? claim.symbolPath : null,
        sessionId: cleanString(claim.sessionId, 'claim.sessionId'),
        purpose: cleanString(claim.purpose, 'claim.purpose'),
        agentId: typeof claim.agentId === 'string' ? claim.agentId : null,
        phase: cleanString(claim.phase, 'claim.phase'),
        mode: claim.mode as FrozenOperatorRecoveryClaim['mode'],
        intent: typeof claim.intent === 'string' ? claim.intent : null,
        claimedAt: Number(claim.claimedAt),
        releasedAt: null,
        observedBy: typeof claim.observedBy === 'string' ? claim.observedBy : null,
        confidence: Number(claim.confidence),
        legacySessionFileId: typeof claim.legacySessionFileId === 'number'
          ? claim.legacySessionFileId
          : null,
      };
    });
    return {
      harbor,
      intendedAgentId,
      project,
      worktree,
      branch,
      predecessorSessionId,
      sessionIntent,
      actorId,
      contextSlot,
      priorContextDigest,
      claims: validatedClaims(sortClaims(claims)),
    };
  }

  type NormalizedCreateRequest = ReturnType<typeof normalizeCreateRequest>;

  function normalizedRequestMatchesState(
    normalized: NormalizedCreateRequest,
    state: RecoveryState,
  ): boolean {
    const expectedClaims = normalized.requested.map((claim) => ({
      nodeId: claim.nodeId,
      disposition: claim.disposition,
    }));
    const actualClaims = sortClaims(state.common.claims).map((claim) => ({
      nodeId: claim.nodeId,
      disposition: claim.disposition,
    }));
    return state.common.harbor === normalized.harbor
      && state.common.intendedAgentId === normalized.intendedAgentId
      && state.common.project === normalized.project
      && state.common.worktree === normalized.worktree
      && state.common.branch === normalized.branch
      && state.common.predecessorSessionId === normalized.predecessorSessionId
      && state.common.sessionIntent === normalized.sessionIntent
      && state.common.actorId === normalized.actorId
      && state.common.contextSlot === normalized.contextSlot
      && canonicalJson(actualClaims) === canonicalJson(expectedClaims);
  }

  function activeRecoveryForPredecessor(
    normalized: NormalizedCreateRequest,
  ): RecoveryState | null {
    const row = db.prepare(`
      SELECT recovery_id
      FROM operator_recovery_projection
      WHERE harbor = ? AND predecessor_session_id = ?
        AND status IN ('pending', 'approved', 'custody-pending')
      ORDER BY updated_at DESC, recovery_id DESC
      LIMIT 1
    `).get(
      normalized.harbor,
      normalized.predecessorSessionId,
    ) as { recovery_id: string } | undefined;
    return row ? stateFor(row.recovery_id) : null;
  }

  function exactExistingOrConflict(
    normalized: NormalizedCreateRequest,
  ): RecoveryState | null {
    const existing = activeRecoveryForPredecessor(normalized);
    if (!existing) return null;
    if (normalizedRequestMatchesState(normalized, existing)) return existing;
    throw new OperatorRecoveryError(
      'OPERATOR_RECOVERY_PREDECESSOR_CONFLICT',
      `predecessor already has active recovery ${existing.common.recoveryId} (${existing.status})`,
      409,
    );
  }

  function assertLiveScope(common: RecoveryCommon): void {
    if (common.daemonGeneration !== daemonGeneration) {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_GENERATION_DRIFTED',
        'the daemon generation changed after the challenge was created',
      );
    }
    const currentWorktree = canonicalWorktree(common.worktree);
    let currentBranch: string;
    try {
      currentBranch = resolveGitBranch(currentWorktree);
    } catch {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_BRANCH_UNVERIFIABLE',
        'the daemon could not verify the live git branch for this recovery',
      );
    }
    if (currentBranch !== common.branch) {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_DRIFTED',
        'the live git branch differs from the signed recovery',
      );
    }
    const live = freezeLiveScope({
      harbor: common.harbor,
      intendedAgentId: common.intendedAgentId,
      project: common.project,
      worktree: common.worktree,
      branch: common.branch,
      predecessorSessionId: common.predecessorSessionId,
      sessionIntent: common.sessionIntent,
      actorId: common.actorId,
      claims: common.claims.map(({ nodeId, disposition }) => ({ nodeId, disposition })),
      contextSlot: common.contextSlot,
      expiresAt: common.expiresAt,
    });
    if (live.priorContextDigest !== common.priorContextDigest) {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_CONTEXT_OCCUPANT_DRIFTED',
        'the exact context-slot occupant changed after the recovery intent was frozen',
      );
    }
  }

  function preliminaryCommon(
    frozen: ReturnType<typeof freezeLiveScope>,
    expiresAt: number,
    rootKey: Buffer,
  ): RecoveryCommon {
    const recoveryId = `recovery-${randomBytes(12).toString('hex')}`;
    const nonce = randomBytes(18).toString('base64url');
    const jtiDigest = hashBytes(deriveJti(rootKey, recoveryId, nonce));
    const withoutHash: Omit<RecoveryCommon, 'actionHash'> = {
      recoveryId,
      ...frozen,
      daemonGeneration,
      nonce,
      expiresAt,
      bodyExpiresAt: now() + RECOVERED_BODY_TTL_MS,
      jtiDigest,
    };
    return { ...withoutHash, actionHash: computeActionHash(withoutHash) };
  }

  function bindEnrollment(
    initial: RecoveryCommon,
    enrollment: EnrollmentProjectionRow,
    predecessorEventId: string,
    extra: Record<string, unknown>,
  ): RecoveryCommon {
    const fresh = stateFor(initial.recoveryId);
    if (
      fresh.status !== 'pending' ||
      fresh.common.deviceKeyId ||
      fresh.lastEventId !== predecessorEventId ||
      now() >= fresh.common.expiresAt ||
      fresh.common.daemonGeneration !== daemonGeneration
    ) {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_ENROLLMENT_EXPIRED',
        'the recovery changed, expired, or crossed daemon generation before enrollment selection',
        410,
      );
    }
    if (
      !enrollment.activation_event_id ||
      !enrollment.activation_command_digest ||
      !enrollment.activation_receipt_digest ||
      !enrollment.activated_at
    ) {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_ENROLLMENT_NOT_ACTIVATED',
        'the selected FleetBar enrollment has no durable activation proof',
        503,
      );
    }
    const withoutHash: Omit<RecoveryCommon, 'actionHash'> = {
      ...fresh.common,
      deviceKeyId: enrollment.device_key_id,
      enrollmentEventId: enrollment.pinned_event_id,
      enrollmentActivationEventId: enrollment.activation_event_id,
    };
    const bound = { ...withoutHash, actionHash: computeActionHash(withoutHash) };
    signingPayload(bound, 'approve');
    appendRecoveryEvent(bound, 'enrollment-pinned', {
      ...extra,
      activationNonceDigest: enrollment.activation_nonce_digest,
      activationCommandDigest: enrollment.activation_command_digest,
      activationReceiptDigest: enrollment.activation_receipt_digest,
      selectedExistingEnrollment: true,
    }, [predecessorEventId]);
    const updated = db.prepare(`
      UPDATE operator_recovery_projection
      SET action_hash = ?, device_key_id = ?, enrollment_event_id = ?,
          enrollment_activation_event_id = ?, updated_at = ?
      WHERE recovery_id = ? AND status = 'pending' AND consumed_at IS NULL
    `).run(
      bound.actionHash,
      enrollment.device_key_id,
      enrollment.pinned_event_id,
      enrollment.activation_event_id,
      now(),
      bound.recoveryId,
    );
    if (Number(updated.changes ?? 0) !== 1) {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_ENROLLMENT_REPLAYED',
        'the pending recovery could not select exactly one enrollment',
      );
    }
    return bound;
  }

  async function pinFirstEnrollment(
    initial: RecoveryCommon,
    challengeEventId: string,
    reserved: ReservedEnrollmentCoordinates,
  ) {
    if (!runEnrollment || !deps.fleetBarExecutablePath) {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_ENROLLMENT_HELPER_UNAVAILABLE',
        'no signed FleetBar helper is available to pin operator presence',
        503,
      );
    }
    const bootstrap = Buffer.from(canonicalJson({
      schema: OPERATOR_ENROLLMENT_BOOTSTRAP_SCHEMA,
      ...actionCoordinates(initial),
      challengeEventId,
    }), 'utf8');
    const request = {
      protocolVersion: 2 as const,
      operation: 'enroll' as const,
      requestId: initial.recoveryId,
      nonce: initial.nonce,
      daemonGeneration,
      bootstrapId: challengeEventId,
      expiresAtMs: initial.expiresAt,
      challengeBytesBase64: bootstrap.toString('base64'),
      challengeDigest: hashBytes(bootstrap),
    };
    await runEnrollment({
      executablePath: deps.fleetBarExecutablePath,
      request,
      commitVerifiedEnrollment: async (candidate: VerifiedOperatorEnrollmentCandidate) => {
        const transaction = db.transaction(() => {
          const fresh = stateFor(initial.recoveryId);
          if (fresh.status !== 'pending' || fresh.common.deviceKeyId) {
            throw new OperatorRecoveryError(
              'OPERATOR_RECOVERY_ENROLLMENT_REPLAYED',
              'this recovery already selected an operator enrollment',
            );
          }
          if (now() >= fresh.common.expiresAt || daemonGeneration !== fresh.common.daemonGeneration) {
            throw new OperatorRecoveryError(
              'OPERATOR_RECOVERY_ENROLLMENT_EXPIRED',
              'the recovery expired or daemon generation changed during enrollment',
              410,
            );
          }
          if (!/^se-p256:[0-9a-f]{64}$/.test(candidate.response.deviceKeyId)) {
            throw new OperatorRecoveryError(
              'OPERATOR_RECOVERY_ENROLLMENT_ID_INVALID',
              'FleetBar returned a non-canonical Secure Enclave device-key identifier',
              401,
            );
          }
          const enrollmentEventId = reserved.enrollmentEventId;
          const activationEventId = reserved.enrollmentActivationEventId;
          const activationNonce = randomBytes(18).toString('base64url');
          const activationNonceDigest = hashBytes(activationNonce);
          const row: EnrollmentProjectionRow = {
            device_key_id: candidate.response.deviceKeyId,
            public_key_x963_base64: candidate.response.publicKeyX963Base64,
            public_key_digest: candidate.response.keyDigest,
            pinned_event_id: enrollmentEventId,
            process_identity: candidate.processTrust.identity,
            response_digest: candidate.responseDigest,
            activation_nonce_digest: activationNonceDigest,
            activation_event_id: null,
            activation_command_digest: null,
            activation_receipt_digest: null,
            activated_at: null,
            pinned_at: now(),
            revoked_at: null,
          };
          db.prepare(`
            INSERT INTO operator_recovery_enrollments (
              device_key_id, public_key_x963_base64, public_key_digest,
              pinned_event_id, process_identity, response_digest, activation_nonce_digest,
              activation_event_id, activation_command_digest, activation_receipt_digest,
              activated_at, pinned_at, revoked_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, NULL)
            ON CONFLICT(pinned_event_id) DO UPDATE SET
              device_key_id = excluded.device_key_id,
              public_key_x963_base64 = excluded.public_key_x963_base64,
              public_key_digest = excluded.public_key_digest,
              process_identity = excluded.process_identity,
              response_digest = excluded.response_digest,
              activation_nonce_digest = excluded.activation_nonce_digest,
              activation_event_id = NULL,
              activation_command_digest = NULL,
              activation_receipt_digest = NULL,
              activated_at = NULL,
              pinned_at = excluded.pinned_at,
              revoked_at = NULL
          `).run(
            row.device_key_id,
            row.public_key_x963_base64,
            row.public_key_digest,
            row.pinned_event_id,
            row.process_identity,
            row.response_digest,
            row.activation_nonce_digest,
            row.pinned_at,
          );
          const withoutHash: Omit<RecoveryCommon, 'actionHash'> = {
            ...fresh.common,
            deviceKeyId: row.device_key_id,
            enrollmentEventId,
            enrollmentActivationEventId: activationEventId,
          };
          const bound = { ...withoutHash, actionHash: computeActionHash(withoutHash) };
          signingPayload(bound, 'approve');
          appendRecoveryEvent(
            bound,
            'enrollment-pinned',
            {
              publicKeyX963Base64: row.public_key_x963_base64,
              publicKeyDigest: row.public_key_digest,
              responseDigest: row.response_digest,
              activationNonceDigest,
              processIdentity: row.process_identity,
              processPid: candidate.processTrust.pid,
              notarized: candidate.processTrust.notarized,
              hardenedRuntime: candidate.processTrust.hardened_runtime,
              debugPrivileges: candidate.processTrust.debug_privileges,
              unsafeDyldEnvironment: candidate.processTrust.unsafe_dyld_environment,
            },
            [fresh.lastEventId],
            enrollmentEventId,
          );
          const selected = db.prepare(`
            UPDATE operator_recovery_projection
            SET action_hash = ?, device_key_id = ?, enrollment_event_id = ?,
                enrollment_activation_event_id = ?, updated_at = ?
            WHERE recovery_id = ? AND status = 'pending' AND consumed_at IS NULL
          `).run(
            bound.actionHash,
            row.device_key_id,
            enrollmentEventId,
            activationEventId,
            now(),
            bound.recoveryId,
          );
          if (Number(selected.changes ?? 0) !== 1) {
            throw new OperatorRecoveryError(
              'OPERATOR_RECOVERY_ENROLLMENT_REPLAYED',
              'the pending recovery could not pin exactly one enrollment',
            );
          }
          return { enrollmentEventId, activationEventId, activationNonce };
        });
        return transaction.immediate();
      },
      commitVerifiedActivation: async (activation: VerifiedOperatorEnrollmentActivation) => {
        const transaction = db.transaction(() => {
          const fresh = stateFor(initial.recoveryId);
          const receipt = activation.receipt;
          if (
            fresh.status !== 'pending' ||
            fresh.enrollmentActivated ||
            !fresh.common.deviceKeyId ||
            !fresh.common.enrollmentEventId ||
            !fresh.common.enrollmentActivationEventId ||
            receipt.deviceKeyId !== fresh.common.deviceKeyId ||
            receipt.enrollmentEventId !== fresh.common.enrollmentEventId ||
            receipt.activationEventId !== fresh.common.enrollmentActivationEventId
          ) {
            throw new OperatorRecoveryError(
              'OPERATOR_RECOVERY_ENROLLMENT_ACTIVATION_REPLAYED',
              'this recovery activation proof is missing, changed, or already committed',
            );
          }
          if (now() >= fresh.common.expiresAt || daemonGeneration !== fresh.common.daemonGeneration) {
            throw new OperatorRecoveryError(
              'OPERATOR_RECOVERY_ENROLLMENT_EXPIRED',
              'the recovery expired or daemon generation changed during activation',
              410,
            );
          }
          const pinned = db.prepare(`
            SELECT * FROM operator_recovery_enrollments
            WHERE pinned_event_id = ? AND device_key_id = ? AND revoked_at IS NULL
          `).get(
            fresh.common.enrollmentEventId,
            fresh.common.deviceKeyId,
          ) as EnrollmentProjectionRow | undefined;
          if (
            !pinned ||
            pinned.activation_event_id !== null ||
            pinned.response_digest !== receipt.responseDigest ||
            pinned.activation_nonce_digest !== hashBytes(receipt.activationNonce)
          ) {
            throw new OperatorRecoveryError(
              'OPERATOR_RECOVERY_ENROLLMENT_ACTIVATION_DRIFTED',
              'the activation receipt does not match the exact inactive pin',
            );
          }
          appendRecoveryEvent(
            fresh.common,
            'enrollment-activated',
            {
              responseDigest: receipt.responseDigest,
              activationNonceDigest: pinned.activation_nonce_digest,
              activationCommandDigest: receipt.activationCommandDigest,
              activationReceiptDigest: activation.receiptDigest,
              activationProcessIdentity: activation.processTrust.identity,
              activationProcessPid: activation.processTrust.pid,
              notarized: activation.processTrust.notarized,
              hardenedRuntime: activation.processTrust.hardened_runtime,
              debugPrivileges: activation.processTrust.debug_privileges,
              unsafeDyldEnvironment: activation.processTrust.unsafe_dyld_environment,
            },
            [fresh.lastEventId],
            fresh.common.enrollmentActivationEventId,
          );
          const updated = db.prepare(`
            UPDATE operator_recovery_enrollments
            SET activation_event_id = ?, activation_command_digest = ?,
                activation_receipt_digest = ?, activated_at = ?
            WHERE pinned_event_id = ? AND device_key_id = ?
              AND activation_event_id IS NULL AND revoked_at IS NULL
          `).run(
            fresh.common.enrollmentActivationEventId,
            receipt.activationCommandDigest,
            activation.receiptDigest,
            now(),
            fresh.common.enrollmentEventId,
            fresh.common.deviceKeyId,
          );
          if (Number(updated.changes ?? 0) !== 1) {
            throw new OperatorRecoveryError(
              'OPERATOR_RECOVERY_ENROLLMENT_ACTIVATION_REPLAYED',
              'the exact inactive enrollment pin was not activated once',
            );
          }
        });
        transaction.immediate();
      },
    });
  }

  async function createChallenge(input: CreateOperatorRecoveryChallengeInput) {
    const ts = now();
    const normalized = normalizeCreateRequest(input);
    const earlyExisting = exactExistingOrConflict(normalized);
    if (earlyExisting && earlyExisting.common.expiresAt > ts) return publicState(earlyExisting);
    let frozen: ReturnType<typeof freezeLiveScope>;
    try {
      frozen = freezeLiveScope(input);
    } catch (error) {
      // An exact concurrent winner may have consumed or otherwise changed the
      // predecessor between normalization and live freezing. Its canonical
      // receipt wins; a different request remains a typed conflict.
      const racedExisting = exactExistingOrConflict(normalized);
      if (racedExisting) return publicState(racedExisting);
      throw error;
    }
    const expiresAt = input.expiresAt ?? ts + DEFAULT_CHALLENGE_TTL_MS;
    if (
      !Number.isSafeInteger(expiresAt) ||
      expiresAt <= ts ||
      expiresAt - ts > MAX_CHALLENGE_TTL_MS
    ) {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_VALIDATION',
        `expiresAt must be within ${MAX_CHALLENGE_TTL_MS}ms of creation`,
        400,
      );
    }
    const rootKey = randomBytes(32);
    const common = preliminaryCommon(frozen, expiresAt, rootKey);
    const activeEnrollment = getActiveEnrollment();
    const reservedEnrollment: ReservedEnrollmentCoordinates = activeEnrollment ? {
      deviceKeyId: activeEnrollment.device_key_id,
      enrollmentEventId: activeEnrollment.pinned_event_id,
      enrollmentActivationEventId: activeEnrollment.activation_event_id!,
    } : reserveFirstEnrollmentCoordinates(common);
    const prospectiveBound = withEnrollmentCoordinates(common, reservedEnrollment);
    // Exact, fully shaped native envelope validation is the last operation
    // before *any* write, including expiry sweeps. First enrollment uses the
    // actual preallocated event ids and a fixed-grammar Secure Enclave key id,
    // so the prospective byte count is the eventual byte count.
    signingPayload(prospectiveBound, 'approve');
    signingPayload(prospectiveBound, 'deny');
    signingPayload(prospectiveBound, 'revoke');
    sweepExpiredRecoveries();
    const scopeDigest = computeFrozenScopeDigest(frozen);
    let challengeEventId = '';
    try {
      const transaction = db.transaction(() => {
        const existing = exactExistingOrConflict(normalized);
        if (existing) return { kind: 'existing' as const, recoveryId: existing.common.recoveryId };
        const sameScope = db.prepare(`
          SELECT recovery_id
          FROM operator_recovery_projection
          WHERE scope_digest = ?
            AND status IN ('pending', 'approved', 'custody-pending')
          LIMIT 1
        `).get(scopeDigest) as { recovery_id: string } | undefined;
        if (sameScope) {
          const state = stateFor(sameScope.recovery_id);
          if (normalizedRequestMatchesState(normalized, state)) {
            return { kind: 'existing' as const, recoveryId: state.common.recoveryId };
          }
          throw new OperatorRecoveryError(
            'OPERATOR_RECOVERY_PREDECESSOR_CONFLICT',
            `frozen scope already has active recovery ${state.common.recoveryId} (${state.status})`,
            409,
          );
        }
        const activeCount = db.prepare(`
          SELECT COUNT(*) AS count
          FROM operator_recovery_projection
          WHERE harbor = ? AND project = ? AND actor_id = ?
            AND status IN ('pending', 'approved', 'custody-pending')
        `).get(
          frozen.harbor,
          frozen.project,
          frozen.actorId,
        ) as { count: number };
        if (Number(activeCount.count) >= maxActiveRecoveriesPerProjectActor) {
          throw new OperatorRecoveryError(
            'OPERATOR_RECOVERY_ACTIVE_LIMIT',
            `this actor already has ${maxActiveRecoveriesPerProjectActor} active recoveries in the project`,
            429,
          );
        }
        db.prepare(`
          INSERT INTO operator_recovery_projection (
            recovery_id, scope_digest, harbor, project, actor_id, predecessor_session_id,
            status, action_hash, jti_digest, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
        `).run(
          common.recoveryId,
          scopeDigest,
          frozen.harbor,
          frozen.project,
          frozen.actorId,
          frozen.predecessorSessionId,
          common.actionHash,
          common.jtiDigest,
          ts,
        );
        challengeEventId = appendRecoveryEvent(common, 'challenge-created').eventId;
        return { kind: 'created' as const, recoveryId: common.recoveryId };
      });
      const admission = transaction.immediate();
      if (admission.kind === 'existing') {
        return publicState(stateFor(admission.recoveryId));
      }
      // Journal the bounded intent before touching the external secret store.
      // A process death can therefore never leave an undiscoverable Keychain
      // root: restart reconciliation can derive and retire the deterministic
      // account from the immutable challenge event.
      if (
        !secrets.put(rootAccount(common.recoveryId), rootKey.toString('hex')) ||
        secrets.get(rootAccount(common.recoveryId)) !== rootKey.toString('hex')
      ) {
        recordRefusal(
          stateFor(common.recoveryId),
          'expired',
          'OPERATOR_RECOVERY_SECRET_STORE_UNAVAILABLE',
          'daemon secret custody could not durably bind the recovery intent',
        );
        throw new OperatorRecoveryError(
          'OPERATOR_RECOVERY_SECRET_STORE_UNAVAILABLE',
          'daemon secret custody is unavailable; the recovery intent was terminated',
          503,
        );
      }
      if (activeEnrollment) {
        const selection = db.transaction(() => {
          bindEnrollment(common, activeEnrollment, challengeEventId, {
            selectedExistingEnrollment: true,
            publicKeyDigest: activeEnrollment.public_key_digest,
            processIdentity: activeEnrollment.process_identity,
            responseDigest: activeEnrollment.response_digest,
          });
        });
        selection.immediate();
      } else {
        await pinFirstEnrollment(common, challengeEventId, reservedEnrollment);
      }
      return publicState(stateFor(common.recoveryId));
    } catch (error) {
      const events = eventsFor(common.recoveryId);
      const current = events.length > 0 ? stateFor(common.recoveryId) : null;
      if (
        current
        && ['pending', 'approved', 'custody-pending'].includes(current.status)
      ) {
        recordRefusal(
          current,
          'expired',
          typeof (error as { code?: unknown })?.code === 'string'
            ? String((error as { code: string }).code)
            : 'OPERATOR_RECOVERY_ENROLLMENT_FAILED',
          `operator enrollment failed closed; diagnosticDigest=${hashBytes(
            error instanceof Error ? error.message : String(error),
          )}`,
        );
      }
      throw error;
    }
  }

  function expireRecoveryInsideTransaction(
    fresh: RecoveryState,
    code: string,
    reason: string,
  ): ReturnType<typeof appendRecoveryEvent> {
    if (!['pending', 'approved', 'custody-pending'].includes(fresh.status)) {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_EXPIRY_RACE',
        'recovery authority reached an incompatible terminal before expiry committed',
      );
    }
    const event = appendRecoveryEvent(
      fresh.common,
      'expired',
      { code, reason },
      [fresh.lastEventId],
    );
    if (fresh.bodyCredentialId) {
      actorSouls.revokeBodyCredential({
        harbor: fresh.common.harbor,
        actorId: fresh.common.actorId,
        bodyCredentialId: fresh.bodyCredentialId,
        revokedAt: now(),
      });
    }
    const changed = db.prepare(`
      UPDATE operator_recovery_projection
      SET status = 'expired', terminal_authority_event_id = ?,
          secret_retirement_pending = 1, envelope_retirement_pending = 1,
          updated_at = ?
      WHERE recovery_id = ? AND status IN ('pending', 'approved', 'custody-pending')
    `).run(event.eventId, now(), fresh.common.recoveryId);
    if (changed.changes !== 1) {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_EXPIRY_RACE',
        'recovery authority changed while expiry was committing',
      );
    }
    return event;
  }

  function recordRefusal(
    state: RecoveryState,
    kind: 'expired' | 'drift-refused' | 'replay-refused',
    code: string,
    reason: string,
  ) {
    let terminalized = false;
    const transaction = db.transaction(() => {
      const fresh = stateFor(state.common.recoveryId);
      if (kind === 'expired' && fresh.status === 'expired') return null;
      if (kind === 'expired') {
        const event = expireRecoveryInsideTransaction(fresh, code, reason);
        terminalized = true;
        return event;
      }
      return appendRecoveryEvent(
        fresh.common,
        kind,
        { code, reason },
        [fresh.lastEventId],
      );
    });
    const result = transaction.immediate();
    if (terminalized) {
      retireEnvelopeSecret(state.common.recoveryId, `${code}: terminal expiry`);
      retireRootSecret(state.common.recoveryId, `${code}: terminal expiry`);
    }
    return result;
  }

  function retireRecoverySecret(
    recoveryId: string,
    account: string,
    projectionColumn: 'secret_retirement_pending' | 'envelope_retirement_pending',
    pendingCode: string,
    completedCode: string,
    label: string,
    reason: string,
  ): boolean {
    let deletionUnconfirmed = false;
    try {
      secrets.del(account);
    } catch {
      deletionUnconfirmed = true;
    }
    let remains = true;
    try {
      remains = secrets.get(account) !== null;
    } catch {
      deletionUnconfirmed = true;
    }
    remains ||= deletionUnconfirmed;
    const transaction = db.transaction(() => {
      const prior = db.prepare(`
        SELECT ${projectionColumn} AS pending
        FROM operator_recovery_projection
        WHERE recovery_id = ?
      `).get(recoveryId) as { pending: number } | undefined;
      db.prepare(`
        UPDATE operator_recovery_projection
        SET ${projectionColumn} = ?, updated_at = ?
        WHERE recovery_id = ?
      `).run(remains ? 1 : 0, now(), recoveryId);
      if (remains) {
        const state = stateFor(recoveryId);
        const latestRetirement = [...state.events].reverse().find((event) => (
          event.code === pendingCode || event.code === completedCode
        ));
        if (latestRetirement?.code !== pendingCode) {
          appendRecoveryEvent(
            state.common,
            'drift-refused',
            {
              code: pendingCode,
              reason: `${reason}; durable ${label} retirement will retry on daemon startup`,
            },
            [state.lastEventId],
          );
        }
      } else if (!remains && prior?.pending === 1) {
        const state = stateFor(recoveryId);
        appendRecoveryEvent(
          state.common,
          'drift-refused',
          {
            code: completedCode,
            reason: `${reason}; previously pending ${label} retirement is now complete`,
          },
          [state.lastEventId],
        );
      }
    });
    transaction.immediate();
    return !remains;
  }

  function retireRootSecret(recoveryId: string, reason: string): boolean {
    return retireRecoverySecret(
      recoveryId,
      rootAccount(recoveryId),
      'secret_retirement_pending',
      'OPERATOR_RECOVERY_SECRET_RETIREMENT_PENDING',
      'OPERATOR_RECOVERY_SECRET_RETIREMENT_COMPLETED',
      'grant-key',
      reason,
    );
  }

  function retireEnvelopeSecret(recoveryId: string, reason: string): boolean {
    return retireRecoverySecret(
      recoveryId,
      bodyEnvelopeAccount(recoveryId),
      'envelope_retirement_pending',
      'OPERATOR_RECOVERY_ENVELOPE_RETIREMENT_PENDING',
      'OPERATOR_RECOVERY_ENVELOPE_RETIREMENT_COMPLETED',
      'body-envelope',
      reason,
    );
  }

  /**
   * Compare-and-delete an envelope that never became ledger authority. The
   * external store operation deliberately runs while this connection holds an
   * IMMEDIATE writer transaction. A concurrent consume therefore either waits
   * and stages after cleanup, or commits first and makes this cleanup a no-op;
   * a rolled-back loser can never delete the winner's envelope.
   */
  function discardUncommittedEnvelope(
    recoveryId: string,
    expectedDigest: string | null,
    reason: string,
  ): boolean {
    const transaction = db.transaction(() => {
      const row = db.prepare(`
        SELECT status, body_envelope_digest AS digest,
               envelope_retirement_pending AS pending
        FROM operator_recovery_projection
        WHERE recovery_id = ?
      `).get(recoveryId) as {
        status: RecoveryState['status'];
        digest: string | null;
        pending: number;
      } | undefined;
      if (!row || !['pending', 'approved'].includes(row.status) || row.digest !== null) return true;
      const account = bodyEnvelopeAccount(recoveryId);
      let serialized: string | null = null;
      let deletionUnconfirmed = false;
      try {
        serialized = secrets.get(account);
      } catch {
        deletionUnconfirmed = true;
      }
      if (expectedDigest && serialized && hashBytes(serialized) !== expectedDigest) {
        deletionUnconfirmed = true;
      } else if (serialized) {
        try { secrets.del(account); } catch { deletionUnconfirmed = true; }
      }
      let remains = deletionUnconfirmed;
      try { remains ||= secrets.get(account) !== null; } catch { remains = true; }
      db.prepare(`
        UPDATE operator_recovery_projection
        SET envelope_retirement_pending = ?, updated_at = ?
        WHERE recovery_id = ? AND status IN ('pending', 'approved')
          AND body_envelope_digest IS NULL
      `).run(remains ? 1 : 0, now(), recoveryId);
      if (remains && row.pending !== 1) {
        const state = stateFor(recoveryId);
        appendRecoveryEvent(
          state.common,
          'drift-refused',
          {
            code: 'OPERATOR_RECOVERY_ENVELOPE_RETIREMENT_PENDING',
            reason: `${reason}; uncommitted body-envelope retirement will retry`,
          },
          [state.lastEventId],
        );
      } else if (!remains && row.pending === 1) {
        const state = stateFor(recoveryId);
        appendRecoveryEvent(
          state.common,
          'drift-refused',
          {
            code: 'OPERATOR_RECOVERY_ENVELOPE_RETIREMENT_COMPLETED',
            reason: `${reason}; uncommitted body-envelope retirement completed`,
          },
          [state.lastEventId],
        );
      }
      return !remains;
    });
    return transaction.immediate();
  }

  function assertEnrollment(common: RecoveryCommon, input: SignedOperatorRecoveryDecisionInput) {
    if (
      !common.deviceKeyId ||
      !common.enrollmentEventId ||
      !common.enrollmentActivationEventId
    ) {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_ENROLLMENT_REQUIRED',
        'the recovery has no provenance-pinned operator enrollment',
        503,
      );
    }
    const enrollment = db.prepare(`
      SELECT * FROM operator_recovery_enrollments
      WHERE device_key_id = ? AND pinned_event_id = ?
        AND activation_event_id = ?
        AND activation_command_digest IS NOT NULL
        AND activation_receipt_digest IS NOT NULL
        AND activated_at IS NOT NULL
        AND revoked_at IS NULL
    `).get(
      common.deviceKeyId,
      common.enrollmentEventId,
      common.enrollmentActivationEventId,
    ) as EnrollmentProjectionRow | undefined;
    if (!enrollment) {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_PROVENANCE_UNPINNED',
        'the selected FleetBar enrollment is missing, changed, or revoked',
        401,
      );
    }
    if (
      input.deviceKeyId !== enrollment.device_key_id ||
      input.publicKeyX963Base64 !== enrollment.public_key_x963_base64 ||
      hashBytes(Buffer.from(input.publicKeyX963Base64, 'base64')) !== enrollment.public_key_digest
    ) {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_DEVICE_DRIFTED',
        'decision key material differs from the daemon-selected enrollment',
        401,
      );
    }
    return enrollment;
  }

  function committedDecisionForState(state: RecoveryState): OperatorRecoveryDecision | null {
    if (state.status === 'approved' || state.status === 'custody-pending' || state.status === 'consumed') {
      return 'approve';
    }
    if (state.status === 'denied') return 'deny';
    if (state.status === 'revoked') return 'revoke';
    return null;
  }

  /**
   * A terminal response may be redelivered only for the byte-identical signed
   * request that originally committed it. The immutable ledger carries a
   * digest of every signed request coordinate. Disposable enrollment
   * projections, live predecessor state, and secret custody are deliberately
   * irrelevant after authority terminalizes.
   */
  function isExactCommittedDecisionRetry(
    state: RecoveryState,
    input: SignedOperatorRecoveryDecisionInput,
  ): boolean {
    const decision = committedDecisionForState(state);
    if (decision !== input.decision) return false;
    const eventKind = decision === 'approve'
      ? 'approved'
      : decision === 'deny'
        ? 'denied'
        : 'grant-revoked';
    const authorityEvent = [...state.events].reverse().find((event) => event.kind === eventKind);
    if (
      typeof authorityEvent?.signatureDigest !== 'string'
      || typeof authorityEvent?.signedRequestDigest !== 'string'
    ) return false;
    try {
      const request = canonicalSignedDecisionRequest(input);
      return request.digest === authorityEvent.signedRequestDigest
        && hashBytes(request.signature) === authorityEvent.signatureDigest;
    } catch {
      return false;
    }
  }

  function refuseNonExactDecisionRetry(state: RecoveryState): never {
    recordRefusal(
      state,
      'replay-refused',
      'OPERATOR_RECOVERY_DECISION_REPLAYED',
      'terminal decision may be redelivered only for its exact signed request',
    );
    throw new OperatorRecoveryError(
      'OPERATOR_RECOVERY_DECISION_REPLAYED',
      'challenge already has a different or non-identical terminal decision',
    );
  }

  /**
   * Reconstruct the one-shot grant inside the daemon from ledger-bound state.
   * The macaroon is never an HTTP bearer. It exists only long enough for the
   * canonical verifier and atomic session binder to consume it.
   */
  function grantForState(state: RecoveryState): Macaroon {
    const recoveryId = state.common.recoveryId;
    const rootKeyHex = secrets.get(rootAccount(recoveryId));
    if (!rootKeyHex) {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_GRANT_KEY_UNAVAILABLE',
        'recovery secret custody is unavailable or revoked',
        503,
      );
    }
    const rootKey = Buffer.from(rootKeyHex, 'hex');
    const jti = deriveJti(rootKey, recoveryId, state.common.nonce);
    if (hashBytes(jti) !== state.common.jtiDigest) {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_GRANT_DRIFTED',
        'recovery grant identifier digest no longer matches the signed scope',
        500,
      );
    }
    let grant = createMacaroon(rootKey, jti, `pd://daemon/operator-recovery/${recoveryId}`);
    grant = addFirstPartyCaveat(grant, opCaveat('api-call'));
    grant = addFirstPartyCaveat(grant, repoCaveat(state.common.project));
    grant = addFirstPartyCaveat(grant, branchCaveat(state.common.branch));
    grant = addFirstPartyCaveat(grant, expiresCaveat(state.common.expiresAt));
    grant = addFirstPartyCaveat(grant, sessionCaveat(state.common.sessionIntent));
    return grant;
  }

  async function decide(input: SignedOperatorRecoveryDecisionInput) {
    // Normalize the complete signed request before reading authority state or
    // writing a refusal. Exact retries are keyed by this one immutable digest.
    const canonicalRequest = canonicalSignedDecisionRequest(input);
    const recoveryId = canonicalRequest.recoveryId;
    const state = stateFor(recoveryId);
    // `approved` is terminal for another approve/deny, but still exposes the
    // one valid revoke transition until consumption.
    const committedDecision = state.status === 'approved' && input.decision === 'revoke'
      ? null
      : committedDecisionForState(state);
    if (committedDecision) {
      if (!isExactCommittedDecisionRetry(state, input)) {
        refuseNonExactDecisionRetry(state);
      }
      if (committedDecision === 'approve' && state.status === 'approved') {
        return { ...publicState(state), grant: grantForState(state) };
      }
      return publicState(state);
    }
    if (state.status === 'expired') {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_GRANT_EXPIRED',
        'the recovery challenge is already expired',
        410,
      );
    }
    if (input.decision === 'approve' || input.decision === 'deny') {
      if (state.status !== 'pending') {
        recordRefusal(state, 'replay-refused', 'OPERATOR_RECOVERY_DECISION_REPLAYED', 'challenge already has a terminal decision');
        throw new OperatorRecoveryError('OPERATOR_RECOVERY_DECISION_REPLAYED', 'challenge already has a terminal decision');
      }
    } else if (input.decision === 'revoke') {
      if (state.status !== 'approved') {
        throw new OperatorRecoveryError('OPERATOR_RECOVERY_REVOKE_INVALID', 'only an unused approved grant can be revoked');
      }
    } else {
      throw new OperatorRecoveryError('OPERATOR_RECOVERY_VALIDATION', 'decision must be approve, deny, or revoke', 400);
    }
    if (now() >= state.common.expiresAt) {
      recordRefusal(state, 'expired', 'OPERATOR_RECOVERY_GRANT_EXPIRED', 'challenge expired before decision');
      throw new OperatorRecoveryError('OPERATOR_RECOVERY_GRANT_EXPIRED', 'challenge expired before decision', 410);
    }
    let enrollment: EnrollmentProjectionRow;
    try {
      assertLiveScope(state.common);
      enrollment = assertEnrollment(state.common, input);
    } catch (error) {
      const code = typeof (error as { code?: unknown })?.code === 'string'
        ? String((error as { code: string }).code)
        : 'OPERATOR_RECOVERY_DRIFTED';
      recordRefusal(
        stateFor(recoveryId),
        'drift-refused',
        code,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
    const verifier = deps.signatureVerifier;
    if (!verifier) {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_SIGNATURE_VERIFIER_UNAVAILABLE',
        'native operator-presence signature verification is unavailable',
        503,
      );
    }
    const payload = signingPayload(state.common, input.decision);
    if (input.challengeDigest !== payload.digest) {
      recordRefusal(state, 'drift-refused', 'OPERATOR_RECOVERY_CHALLENGE_DRIFTED', 'challenge digest did not match the daemon bytes');
      throw new OperatorRecoveryError('OPERATOR_RECOVERY_CHALLENGE_DRIFTED', 'challenge digest did not match the daemon bytes');
    }
    const signature = canonicalRequest.signature;
    let verification: OperatorPresenceVerificationResult;
    try {
      verification = await verifier.verify({
        deviceKeyId: enrollment.device_key_id,
        publicKeyX963Base64: enrollment.public_key_x963_base64,
        signatureDerBase64: input.signatureDerBase64,
        canonicalPayload: payload.bytes,
        expectedChallengeDigest: payload.digest,
      });
    } catch (error) {
      const diagnosticDigest = hashBytes(error instanceof Error ? error.message : String(error));
      recordRefusal(
        stateFor(recoveryId),
        'drift-refused',
        'OPERATOR_RECOVERY_SIGNATURE_INVALID',
        `native signature verifier failed closed; diagnosticDigest=${diagnosticDigest}`,
      );
      const failure = new OperatorRecoveryError(
        'OPERATOR_RECOVERY_SIGNATURE_INVALID',
        'native operator-presence signature verification failed closed',
        401,
      );
      Object.assign(failure, { diagnosticDigest });
      throw failure;
    }
    if (!verification.ok) {
      const diagnosticDigest = hashBytes(verification.reason);
      recordRefusal(
        state,
        'drift-refused',
        'OPERATOR_RECOVERY_SIGNATURE_INVALID',
        `native signature verification refused; diagnosticDigest=${diagnosticDigest}`,
      );
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_SIGNATURE_INVALID',
        'native operator-presence signature verification refused the decision',
        401,
      );
    }

    const grant = input.decision === 'approve' ? grantForState(state) : null;
    const signatureDigest = hashBytes(signature);
    const signedRequestDigest = canonicalRequest.digest;
    const transaction = db.transaction(() => {
      const fresh = stateFor(recoveryId);
      if (input.decision === 'approve' || input.decision === 'deny') {
        if (fresh.status !== 'pending') {
          if (isExactCommittedDecisionRetry(fresh, input)) return 'redelivered' as const;
          throw new OperatorRecoveryError('OPERATOR_RECOVERY_DECISION_REPLAYED', 'challenge was decided concurrently');
        }
      } else if (fresh.status !== 'approved') {
        if (isExactCommittedDecisionRetry(fresh, input)) return 'redelivered' as const;
        throw new OperatorRecoveryError('OPERATOR_RECOVERY_DECISION_REPLAYED', 'grant changed before revocation');
      }
      assertLiveScope(fresh.common);
      assertEnrollment(fresh.common, input);
      if (now() >= fresh.common.expiresAt) {
        expireRecoveryInsideTransaction(
          fresh,
          'OPERATOR_RECOVERY_GRANT_EXPIRED',
          'challenge expired before the signed decision committed',
        );
        return 'expired' as const;
      }
      if (input.decision === 'deny') {
        const denied = appendRecoveryEvent(
          fresh.common,
          'denied',
          { signatureDigest, signedRequestDigest },
          [fresh.lastEventId],
        );
        db.prepare(`
          UPDATE operator_recovery_projection
          SET status = 'denied', terminal_authority_event_id = ?,
              secret_retirement_pending = 1, envelope_retirement_pending = 1,
              updated_at = ?
          WHERE recovery_id = ? AND status = 'pending'
        `).run(denied.eventId, now(), recoveryId);
      } else if (input.decision === 'revoke') {
        const revoked = appendRecoveryEvent(
          fresh.common,
          'grant-revoked',
          { signatureDigest, signedRequestDigest },
          [fresh.lastEventId],
        );
        db.prepare(`
          UPDATE operator_recovery_projection
          SET status = 'revoked', terminal_authority_event_id = ?,
              secret_retirement_pending = 1, envelope_retirement_pending = 1,
              updated_at = ?
          WHERE recovery_id = ? AND status = 'approved' AND consumed_at IS NULL
        `).run(revoked.eventId, now(), recoveryId);
      } else {
        const approved = appendRecoveryEvent(
          fresh.common,
          'approved',
          { signatureDigest, signedRequestDigest },
          [fresh.lastEventId],
        );
        const minted = appendRecoveryEvent(
          fresh.common,
          'grant-minted',
          { macaroonDigest: hashBytes(canonicalJson(grant!)) },
          [approved.eventId],
        );
        const changed = db.prepare(`
          UPDATE operator_recovery_projection
          SET status = 'approved', updated_at = ?
          WHERE recovery_id = ? AND status = 'pending' AND consumed_at IS NULL
        `).run(now(), recoveryId);
        if (changed.changes !== 1 || minted.duplicate) {
          throw new OperatorRecoveryError('OPERATOR_RECOVERY_DECISION_REPLAYED', 'challenge was decided concurrently');
        }
      }
      return 'committed' as const;
    });
    let decisionOutcome: 'committed' | 'expired' | 'redelivered';
    try {
      decisionOutcome = transaction.immediate();
    } catch (error) {
      const code = typeof (error as { code?: unknown })?.code === 'string'
        ? String((error as { code: string }).code)
        : 'OPERATOR_RECOVERY_DECISION_FAILED';
      if (code.includes('REPLAY')) {
        const fresh = stateFor(recoveryId);
        if (isExactCommittedDecisionRetry(fresh, input)) {
          if (input.decision === 'approve' && fresh.status === 'approved') {
            return { ...publicState(fresh), grant: grantForState(fresh) };
          }
          return publicState(fresh);
        }
        recordRefusal(
          fresh,
          'replay-refused',
          code,
          error instanceof Error ? error.message : String(error),
        );
      }
      throw error;
    }
    if (decisionOutcome === 'redelivered') {
      const fresh = stateFor(recoveryId);
      if (input.decision === 'approve' && fresh.status === 'approved') {
        return { ...publicState(fresh), grant: grantForState(fresh) };
      }
      return publicState(fresh);
    }
    if (decisionOutcome === 'expired') {
      retireEnvelopeSecret(recoveryId, 'challenge expired during signed decision');
      retireRootSecret(recoveryId, 'challenge expired during signed decision');
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_GRANT_EXPIRED',
        'challenge expired before the signed decision committed',
        410,
      );
    }
    if (input.decision !== 'approve') {
      retireEnvelopeSecret(recoveryId, `signed ${input.decision}`);
      retireRootSecret(recoveryId, `signed ${input.decision}`);
    }
    return { ...publicState(stateFor(recoveryId)), ...(grant ? { grant } : {}) };
  }

  function authorizeConsumeInsideTransaction(state: RecoveryState, grant: Macaroon): RecoveryState {
    const fresh = stateFor(state.common.recoveryId);
    if (fresh.status === 'consumed' || fresh.status === 'custody-pending') {
      throw new OperatorRecoveryError('OPERATOR_RECOVERY_GRANT_REPLAYED', 'recovery grant was already consumed');
    }
    if (fresh.status === 'revoked') {
      throw new OperatorRecoveryError('OPERATOR_RECOVERY_GRANT_REVOKED', 'recovery grant was revoked');
    }
    if (fresh.status === 'expired') {
      throw new OperatorRecoveryError('OPERATOR_RECOVERY_GRANT_EXPIRED', 'recovery grant expired', 410);
    }
    if (fresh.status !== 'approved') {
      throw new OperatorRecoveryError('OPERATOR_RECOVERY_GRANT_NOT_APPROVED', 'recovery has no approved grant');
    }
    if (now() >= fresh.common.expiresAt) {
      throw new OperatorRecoveryError('OPERATOR_RECOVERY_GRANT_EXPIRED', 'recovery grant expired', 410);
    }
    assertLiveScope(fresh.common);
    if (hashBytes(grant.identifier) !== fresh.common.jtiDigest) {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_GRANT_DRIFTED',
        'presented grant identifier differs from the signed recovery',
        401,
      );
    }
    const rootKeyHex = secrets.get(rootAccount(fresh.common.recoveryId));
    if (!rootKeyHex) {
      throw new OperatorRecoveryError('OPERATOR_RECOVERY_GRANT_KEY_UNAVAILABLE', 'grant key is unavailable or was revoked', 401);
    }
    let verdict: ReturnType<typeof verifyPushGrantPreferKernel>;
    try {
      verdict = (deps.verifyGrant ?? verifyPushGrantPreferKernel)({
        grant,
        rootKeyHex,
        discharges: [],
        ctx: {
          op: 'api-call',
          repo: fresh.common.project,
          branch: fresh.common.branch,
          session: fresh.common.sessionIntent,
          nowMs: now(),
        },
        caveatKeys: {},
      });
    } catch (error) {
      const failure = new OperatorRecoveryError(
        'OPERATOR_RECOVERY_GRANT_INVALID',
        'recovery grant verification failed closed',
        401,
      );
      Object.assign(failure, {
        diagnosticDigest: hashBytes(error instanceof Error ? error.message : String(error)),
      });
      throw failure;
    }
    if (!verdict.authorized) {
      const failure = new OperatorRecoveryError(
        'OPERATOR_RECOVERY_GRANT_INVALID',
        'recovery grant failed canonical verification',
        401,
      );
      Object.assign(failure, { diagnosticDigest: hashBytes(verdict.reason) });
      throw failure;
    }
    const winner = db.prepare(`
      UPDATE operator_recovery_projection
      SET consumed_at = ?, updated_at = ?
      WHERE recovery_id = ? AND status = 'approved' AND consumed_at IS NULL
    `).run(now(), now(), fresh.common.recoveryId);
    if (winner.changes !== 1) {
      throw new OperatorRecoveryError('OPERATOR_RECOVERY_GRANT_REPLAYED', 'another process consumed the recovery grant first');
    }
    return fresh;
  }

  function loadPendingBodyEnvelope(state: RecoveryState): RecoveryBodyEnvelope {
    if (
      state.status !== 'custody-pending' ||
      !state.successorSessionId ||
      !state.bodyCredentialId ||
      !state.bodyEnvelopeDigest
    ) {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_CUSTODY_NOT_PENDING',
        'the recovery has no restartable body custody handoff',
      );
    }
    const rootKeyHex = secrets.get(rootAccount(state.common.recoveryId));
    const serialized = secrets.get(bodyEnvelopeAccount(state.common.recoveryId));
    if (!rootKeyHex || !serialized || hashBytes(serialized) !== state.bodyEnvelopeDigest) {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_BODY_ENVELOPE_UNAVAILABLE',
        'the restartable body envelope is missing or differs from its ledger digest',
        503,
      );
    }
    const envelope = openBodyEnvelope(
      Buffer.from(rootKeyHex, 'hex'),
      state.common.recoveryId,
      state.common.actionHash,
      serialized,
    );
    if (
      envelope.bodyCredentialId !== state.bodyCredentialId ||
      envelope.successorSessionId !== state.successorSessionId ||
      envelope.actorId !== state.common.actorId ||
      envelope.intendedAgentId !== state.common.intendedAgentId ||
      envelope.project !== state.common.project ||
      envelope.canonicalWorktree !== state.common.worktree ||
      envelope.branch !== state.common.branch ||
      envelope.contextSlot !== state.common.contextSlot ||
      envelope.priorContextDigest !== state.common.priorContextDigest ||
      envelope.expiresAt !== state.common.bodyExpiresAt
      || envelope.daemonGeneration !== state.common.daemonGeneration
    ) {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_BODY_ENVELOPE_DRIFTED',
        'the restartable body envelope differs from the signed recovery or session receipt',
        503,
      );
    }
    const credentialVerdict = actorSouls.verifyCredentialUse(envelope.credential, {
      harbor: state.common.harbor,
      context: {
        action: 'session.note.write',
        resource: {
          sessionId: envelope.successorSessionId,
          intendedAgentId: envelope.intendedAgentId,
          project: envelope.project,
          canonicalWorktree: envelope.canonicalWorktree,
          branch: envelope.branch,
          status: 'active',
        },
      },
    });
    if (
      !credentialVerdict.ok ||
      credentialVerdict.actorId !== state.common.actorId ||
      credentialVerdict.bodyCredentialId !== state.bodyCredentialId
    ) {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_BODY_ENVELOPE_INVALID',
        'the staged body no longer verifies for the exact successor resource',
        503,
      );
    }
    const successor = sessions.get(envelope.successorSessionId) as Record<string, any>;
    const successorMetadata = successor.session?.metadata as Record<string, any> | undefined;
    const successorWorktree = successorMetadata?.worktree as Record<string, unknown> | undefined;
    let liveBranch: string;
    try {
      if (canonicalWorktree(state.common.worktree) !== state.common.worktree) throw new Error();
      liveBranch = resolveGitBranch(state.common.worktree);
    } catch {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_BRANCH_UNVERIFIABLE',
        'the daemon could not verify the live recovery worktree during custody',
        503,
      );
    }
    if (
      successor.success !== true ||
      successor.session?.status !== 'active' ||
      successor.session?.agentId !== envelope.intendedAgentId ||
      successor.session?.identityProject !== envelope.project ||
      successorMetadata?.identity?.verified !== true ||
      successorMetadata?.identity?.actorId !== envelope.actorId ||
      successorMetadata?.operatorRecovery?.recoveryId !== state.common.recoveryId ||
      successorMetadata?.operatorRecovery?.actionHash !== state.common.actionHash ||
      successorWorktree?.root !== state.common.worktree ||
      successorWorktree?.branch !== state.common.branch ||
      liveBranch !== state.common.branch
    ) {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_SUCCESSOR_DRIFTED',
        'the staged body no longer points at the exact bound successor',
        503,
      );
    }
    return envelope;
  }

  function completePendingCustody(recoveryId: string) {
    const initial = stateFor(recoveryId);
    if (initial.status === 'consumed') {
      return { state: publicState(initial), bodyCredential: null, custody: null };
    }
    if (!deps.installRecoveredContext) {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_CONTEXT_CUSTODY_UNAVAILABLE',
        'exact-slot 0600 context custody is unavailable; the sealed body remains retryable',
        503,
      );
    }
    if (now() >= initial.common.bodyExpiresAt) {
      recordRefusal(
        initial,
        'expired',
        'OPERATOR_RECOVERY_BODY_EXPIRED',
        'sealed successor custody expired before exact-slot installation',
      );
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_BODY_EXPIRED',
        'the sealed successor body expired before exact-slot installation',
        410,
      );
    }
    let envelope: RecoveryBodyEnvelope;
    let expectedContextDigest: string;
    let custody: RecoveredContextCustodyReceipt;
    try {
      envelope = loadPendingBodyEnvelope(initial);
      expectedContextDigest = hashBytes(recoveredContextBytes(envelope));
      custody = deps.installRecoveredContext({
        ...envelope,
        custodyDaemonGeneration: daemonGeneration,
        expectedContextDigest,
        expectedPriorContextDigest: envelope.priorContextDigest,
        assertPublicationAuthorized: () => {
          const live = stateFor(recoveryId);
          if (now() >= live.common.bodyExpiresAt) {
            throw new OperatorRecoveryError(
              'OPERATOR_RECOVERY_BODY_EXPIRED',
              'the sealed successor body expired before exact-slot publication',
              410,
            );
          }
          if (
            live.status !== 'custody-pending' ||
            live.bodyCredentialId !== envelope.bodyCredentialId ||
            live.bodyEnvelopeDigest !== initial.bodyEnvelopeDigest
          ) {
            throw new OperatorRecoveryError(
              'OPERATOR_RECOVERY_CUSTODY_DRIFTED',
              'the sealed successor custody authority changed before exact-slot publication',
            );
          }
          // Re-read sealed custody, successor identity, and live branch while
          // the exact context-slot kernel lease is held.
          loadPendingBodyEnvelope(live);
        },
      });
      const expectedPath = join(
        initial.common.worktree,
        '.portdaddy',
        'contexts',
        `${initial.common.contextSlot}.json`,
      );
      if (
        custody.contextSlot !== initial.common.contextSlot ||
        custody.contextPath !== expectedPath ||
        custody.mode !== 0o600 ||
        custody.contentDigest !== expectedContextDigest
      ) {
        throw new OperatorRecoveryError(
          'OPERATOR_RECOVERY_CONTEXT_CUSTODY_MISMATCH',
          'exact-slot custody returned a different slot, path, mode, or content digest',
          503,
        );
      }
    } catch (custodyError) {
      const after = stateFor(recoveryId);
      if ((custodyError as { code?: unknown })?.code === 'OPERATOR_RECOVERY_BODY_EXPIRED') {
        recordRefusal(
          after,
          'expired',
          'OPERATOR_RECOVERY_BODY_EXPIRED',
          'sealed successor custody expired before exact-slot publication',
        );
        throw new OperatorRecoveryError(
          'OPERATOR_RECOVERY_BODY_EXPIRED',
          'the sealed successor body expired before exact-slot publication',
          410,
        );
      }
      const diagnostic = hashBytes(
        custodyError instanceof Error ? custodyError.message : String(custodyError),
      );
      recordRefusal(
        after,
        'drift-refused',
        'OPERATOR_RECOVERY_CONTEXT_CUSTODY_FAILED',
        `exact-slot custody failed; diagnosticDigest=${diagnostic}`,
      );
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_CONTEXT_CUSTODY_FAILED',
        'successor binding is safe in sealed custody and will retry after the exact-slot failure is repaired',
        503,
      );
    }

    if (now() >= initial.common.bodyExpiresAt) {
      recordRefusal(
        stateFor(recoveryId),
        'expired',
        'OPERATOR_RECOVERY_BODY_EXPIRED',
        'sealed successor custody expired before its authority receipt committed',
      );
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_BODY_EXPIRED',
        'the sealed successor body expired before its authority receipt committed',
        410,
      );
    }

    const transaction = db.transaction(() => {
      const fresh = stateFor(recoveryId);
      if (fresh.status === 'consumed') return 'already-installed' as const;
      if (
        fresh.status !== 'custody-pending' ||
        fresh.bodyCredentialId !== envelope.bodyCredentialId ||
        fresh.bodyEnvelopeDigest !== initial.bodyEnvelopeDigest
      ) {
        throw new OperatorRecoveryError(
          'OPERATOR_RECOVERY_CUSTODY_DRIFTED',
          'recovery authority changed before exact-slot custody could commit',
        );
      }
      if (now() >= fresh.common.bodyExpiresAt) {
        expireRecoveryInsideTransaction(
          fresh,
          'OPERATOR_RECOVERY_BODY_EXPIRED',
          'sealed successor custody expired before its authority receipt committed',
        );
        return 'expired' as const;
      }
      const winner = db.prepare(`
        UPDATE operator_recovery_projection
        SET context_installed_at = ?, updated_at = ?
        WHERE recovery_id = ? AND status = 'custody-pending' AND context_installed_at IS NULL
      `).run(now(), now(), recoveryId);
      if (winner.changes !== 1) return 'already-installed' as const;
      const installed = appendRecoveryEvent(
        fresh.common,
        'context-custody-installed',
        {
          successorSessionId: envelope.successorSessionId,
          bodyCredentialId: envelope.bodyCredentialId,
          bodyEnvelopeDigest: fresh.bodyEnvelopeDigest,
          contextContentDigest: custody.contentDigest,
          contextMode: custody.mode,
        },
        [fresh.lastEventId],
        `operator-recovery:${recoveryId}:context-custody-installed`,
      );
      db.prepare(`
        UPDATE operator_recovery_projection
        SET status = 'consumed', terminal_authority_event_id = ?,
            secret_retirement_pending = 1, envelope_retirement_pending = 1,
            updated_at = ?
        WHERE recovery_id = ? AND context_installed_at IS NOT NULL
      `).run(installed.eventId, now(), recoveryId);
      return 'installed' as const;
    });
    const custodyOutcome = transaction.immediate();
    if (custodyOutcome === 'expired') {
      retireEnvelopeSecret(recoveryId, 'sealed successor custody expired during commit');
      retireRootSecret(recoveryId, 'sealed successor custody expired during commit');
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_BODY_EXPIRED',
        'the sealed successor body expired before its authority receipt committed',
        410,
      );
    }
    retireEnvelopeSecret(recoveryId, 'exact-slot custody installed');
    retireRootSecret(recoveryId, 'exact-slot custody installed');
    return {
      state: publicState(stateFor(recoveryId)),
      bodyCredential: {
        bodyId: envelope.bodyCredentialId,
        actorId: envelope.actorId,
        intendedAgentId: envelope.intendedAgentId,
        scopeProfile: 'session-body-v1' as const,
        scope: {
          harbor: initial.common.harbor,
          sessionId: envelope.successorSessionId,
          project: envelope.project,
          canonicalWorktree: envelope.canonicalWorktree,
          branch: envelope.branch,
        },
        issuedAt: envelope.issuedAt,
        expiresAt: envelope.expiresAt,
      },
      custody: {
        installed: true,
        contextSlot: custody.contextSlot,
        canonicalWorktree: initial.common.worktree,
        mode: custody.mode,
      },
    };
  }

  function consume(recoveryIdInput: string, grant: Macaroon) {
    const recoveryId = cleanString(recoveryIdInput, 'recoveryId');
    if (!grant || typeof grant !== 'object') {
      throw new OperatorRecoveryError('OPERATOR_RECOVERY_VALIDATION', 'grant is required', 400);
    }
    if (!discardUncommittedEnvelope(recoveryId, null, 'pre-consume orphan reconciliation')) {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_ENVELOPE_RETIREMENT_PENDING',
        'a prior uncommitted body envelope must be retired before this grant can be consumed',
        503,
      );
    }
    const initial = stateFor(recoveryId);
    if (!deps.installRecoveredContext) {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_CONTEXT_CUSTODY_UNAVAILABLE',
        'exact-slot 0600 context custody is unavailable; the approved grant remains unused',
        503,
      );
    }
    let body!: IssuedBodyCredential;
    let bodyIssued = false;
    let bodyEnvelopeStaged = false;
    let bodyEnvelopeDigest = '';
    try {
      const result = sessions.bindOperatorRecovery({
        recoveryId,
        actionHash: initial.common.actionHash,
        actorId: initial.common.actorId,
        intendedAgentId: initial.common.intendedAgentId,
        project: initial.common.project,
        canonicalWorktree: initial.common.worktree,
        branch: initial.common.branch,
        predecessorSessionId: initial.common.predecessorSessionId,
        sessionIntent: initial.common.sessionIntent,
        claimChanges: initial.common.claims as SessionRecoveryClaim[],
        daemonGeneration: initial.common.daemonGeneration,
        now: now(),
        authorize: () => { authorizeConsumeInsideTransaction(initial, grant); },
        beforeCommit: (bound: OperatorRecoveryBindReceipt) => {
          const fresh = stateFor(recoveryId);
          body = actorSouls.issueBodyCredential({
            actorId: fresh.common.actorId,
            harbor: fresh.common.harbor,
            profile: 'session-body-v1',
            scope: {
              intendedAgentId: fresh.common.intendedAgentId,
              successorSessionId: bound.successorSessionId,
              project: fresh.common.project,
              canonicalWorktree: fresh.common.worktree,
              branch: fresh.common.branch,
              recoveryId,
              contextSlot: fresh.common.contextSlot,
              issuedDaemonGeneration: fresh.common.daemonGeneration,
            },
            expiresAt: fresh.common.bodyExpiresAt,
          });
          bodyIssued = true;
          const rootKeyHex = secrets.get(rootAccount(recoveryId));
          if (!rootKeyHex) {
            throw new OperatorRecoveryError(
              'OPERATOR_RECOVERY_GRANT_KEY_UNAVAILABLE',
              'the recovery root disappeared before body custody was staged',
              503,
            );
          }
          const bodyEnvelope: RecoveryBodyEnvelope = {
            schema: 'pd.operator-recovery-body-envelope.v1',
            recoveryId,
            daemonGeneration: fresh.common.daemonGeneration,
            actionHash: fresh.common.actionHash,
            bodyCredentialId: body.bodyCredentialId,
            canonicalWorktree: fresh.common.worktree,
            contextSlot: fresh.common.contextSlot!,
            priorContextDigest: fresh.common.priorContextDigest,
            intendedAgentId: fresh.common.intendedAgentId,
            successorSessionId: bound.successorSessionId,
            sessionIntent: fresh.common.sessionIntent,
            project: fresh.common.project,
            branch: fresh.common.branch,
            actorId: fresh.common.actorId,
            credential: body.credential,
            issuedAt: body.issuedAt,
            expiresAt: body.expiresAt!,
          };
          const sealed = sealBodyEnvelope(Buffer.from(rootKeyHex, 'hex'), bodyEnvelope);
          if (
            !secrets.put(bodyEnvelopeAccount(recoveryId), sealed.serialized) ||
            secrets.get(bodyEnvelopeAccount(recoveryId)) !== sealed.serialized
          ) {
            throw new OperatorRecoveryError(
              'OPERATOR_RECOVERY_BODY_ENVELOPE_STORE_UNAVAILABLE',
              'restartable body custody could not be durably staged',
              503,
            );
          }
          bodyEnvelopeStaged = true;
          bodyEnvelopeDigest = sealed.digest;
          const consumed = appendRecoveryEvent(
            fresh.common,
            'grant-consumed',
            {
              successorSessionId: bound.successorSessionId,
              bodyCredentialId: body.bodyCredentialId,
              bodyEnvelopeDigest,
              credentialProfile: body.profile,
              bodyIssuedAt: body.issuedAt,
              bodyExpiresAt: body.expiresAt,
              boundAt: bound.boundAt,
              transferredClaimNodeIds: bound.transferredClaimNodeIds,
              releasedClaimNodeIds: bound.releasedClaimNodeIds,
            },
            [fresh.lastEventId],
          );
          const boundEvent = appendRecoveryEvent(
            fresh.common,
            'session-bound',
            {
              successorSessionId: bound.successorSessionId,
              bodyCredentialId: body.bodyCredentialId,
              bodyEnvelopeDigest,
              canonicalActorVerified: true,
              credentialProfile: body.profile,
              bodyIssuedAt: body.issuedAt,
              bodyExpiresAt: body.expiresAt,
              boundAt: bound.boundAt,
            },
            [consumed.eventId],
          );
          db.prepare(`
            UPDATE operator_recovery_projection
            SET status = 'custody-pending', terminal_authority_event_id = NULL,
                body_envelope_digest = ?, body_credential_id = ?,
                successor_session_id = ?, envelope_retirement_pending = 0,
                updated_at = ?
            WHERE recovery_id = ? AND consumed_at IS NOT NULL
          `).run(
            bodyEnvelopeDigest,
            body.bodyCredentialId,
            bound.successorSessionId,
            now(),
            recoveryId,
          );
        },
      }) as Record<string, unknown>;
      if (result.success !== true || !bodyIssued) {
        throw new OperatorRecoveryError(
          'OPERATOR_RECOVERY_BINDING_READBACK_FAILED',
          'session binder returned no committed body receipt',
        );
      }
      completePendingCustody(recoveryId);
      return completedPublicResponse(stateFor(recoveryId));
    } catch (error) {
      const code = typeof (error as { code?: unknown })?.code === 'string'
        ? String((error as { code: string }).code)
        : 'OPERATOR_RECOVERY_BINDING_FAILED';
      const reason = error instanceof Error ? error.message : String(error);
      const suppliedDiagnostic = typeof (error as { diagnosticDigest?: unknown })?.diagnosticDigest === 'string'
        ? String((error as { diagnosticDigest: string }).diagnosticDigest)
        : hashBytes(reason);
      const safeReason = `recovery consume refused; diagnosticDigest=${suppliedDiagnostic}`;
      const after = stateFor(recoveryId);
      if (bodyEnvelopeStaged && after.status === 'approved') {
        discardUncommittedEnvelope(
          recoveryId,
          bodyEnvelopeDigest,
          'rolled-back body custody staging',
        );
      }
      if (code.includes('REPLAY')) {
        recordRefusal(after, 'replay-refused', code, safeReason);
      } else if (code.includes('EXPIRED')) {
        recordRefusal(after, 'expired', code, safeReason);
      } else if (after.status !== 'consumed' && after.status !== 'custody-pending') {
        recordRefusal(after, 'drift-refused', code, safeReason);
      }
      throw error;
    }
  }

  /**
   * Canonical operator action: verify the signed decision and, on approval,
   * immediately consume the daemon-internal grant. HTTP/UI callers never see
   * or replay a macaroon. A lost response is idempotent: consumed state is
   * returned, while a committed custody handoff is completed from its sealed
   * envelope.
   */
  async function decideAndConsume(input: SignedOperatorRecoveryDecisionInput) {
    const recoveryId = cleanString(input.recoveryId, 'recoveryId');
    if (input.decision === 'approve') {
      const existing = stateFor(recoveryId);
      if (existing.status === 'consumed') {
        await decide(input);
        return completedPublicResponse(existing);
      }
      if (existing.status === 'custody-pending') {
        await decide(input);
        completePendingCustody(recoveryId);
        return completedPublicResponse(stateFor(recoveryId));
      }
    }

    const decided = await decide(input);
    if (input.decision !== 'approve') return decided;
    if (decided.status === 'consumed') return completedPublicResponse(stateFor(recoveryId));
    if (decided.status === 'custody-pending') {
      completePendingCustody(recoveryId);
      return completedPublicResponse(stateFor(recoveryId));
    }
    const grant = (decided as typeof decided & { grant?: Macaroon | null }).grant;
    if (!grant) {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_GRANT_KEY_UNAVAILABLE',
        'the signed approval committed without an internal one-shot grant',
        503,
      );
    }
    return consume(recoveryId, grant);
  }

  function get(recoveryId: string) {
    const canonicalRecoveryId = cleanString(recoveryId, 'recoveryId');
    sweepExpiredRecoveries(canonicalRecoveryId);
    return publicState(stateFor(canonicalRecoveryId));
  }

  function list(options: { status?: RecoveryState['status']; limit?: number } = {}) {
    sweepExpiredRecoveries();
    if (options.status !== undefined && !RECOVERY_STATUSES.includes(options.status)) {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_VALIDATION',
        'status must be a canonical operator-recovery state',
        400,
      );
    }
    const requestedLimit = options.limit ?? 100;
    if (!Number.isSafeInteger(requestedLimit) || requestedLimit <= 0) {
      throw new OperatorRecoveryError(
        'OPERATOR_RECOVERY_VALIDATION',
        'limit must be a positive safe integer',
        400,
      );
    }
    const rows = db.prepare(`
      WITH latest AS (
        SELECT json_extract(payload_json, '$.recoveryId') AS recovery_id,
               MAX(ledger_seq) AS last_seq
        FROM harbor_events
        WHERE stream_type = 'operator-recovery-event'
        GROUP BY recovery_id
      )
      SELECT projection.recovery_id
      FROM operator_recovery_projection AS projection
      JOIN latest USING (recovery_id)
      WHERE (? IS NULL OR projection.status = ?)
      ORDER BY CASE
        WHEN projection.status IN ('pending', 'approved', 'custody-pending') THEN 0
        ELSE 1
      END, latest.last_seq DESC
      LIMIT ?
    `).all(
      options.status ?? null,
      options.status ?? null,
      Math.min(requestedLimit, 500),
    ) as Array<{ recovery_id: string }>;
    const recoveries = rows.map((row) => publicState(stateFor(row.recovery_id)));
    return { success: true, count: recoveries.length, recoveries, daemonGeneration };
  }

  function retryPendingSecretRetirements() {
    const rows = db.prepare(`
      SELECT recovery_id,
             status,
             body_envelope_digest AS body_digest,
             secret_retirement_pending AS root_pending,
             envelope_retirement_pending AS envelope_pending
      FROM operator_recovery_projection
      WHERE secret_retirement_pending = 1 OR envelope_retirement_pending = 1
    `).all() as Array<{
      recovery_id: string;
      status: RecoveryState['status'];
      body_digest: string | null;
      root_pending: number;
      envelope_pending: number;
    }>;
    for (const row of rows) {
      try {
        if (row.envelope_pending === 1) {
          if (['pending', 'approved'].includes(row.status) && row.body_digest === null) {
            discardUncommittedEnvelope(row.recovery_id, null, 'daemon startup retry');
          } else {
            retireEnvelopeSecret(row.recovery_id, 'daemon startup retry');
          }
        }
        if (row.root_pending === 1) {
          retireRootSecret(row.recovery_id, 'daemon startup retry');
        }
      } catch {
        // The durable pending bit + ledger event remains the exact retry truth.
      }
    }
  }

  function reconcileUncommittedEnvelopes() {
    const rows = db.prepare(`
      SELECT recovery_id
      FROM operator_recovery_projection
      WHERE status IN ('pending', 'approved') AND body_envelope_digest IS NULL
      ORDER BY updated_at ASC
    `).all() as Array<{ recovery_id: string }>;
    for (const row of rows) {
      try {
        discardUncommittedEnvelope(
          row.recovery_id,
          null,
          'daemon restart reconciled possible uncommitted body-envelope custody',
        );
      } catch {
        // discardUncommittedEnvelope records a credential-free durable retry bit
        // whenever the external store cannot confirm deletion.
      }
    }
  }

  function reconcileMissingRecoveryRoots() {
    const rows = db.prepare(`
      SELECT recovery_id
      FROM operator_recovery_projection
      WHERE status IN ('pending', 'approved')
      ORDER BY updated_at ASC
    `).all() as Array<{ recovery_id: string }>;
    for (const row of rows) {
      try {
        if (secrets.get(rootAccount(row.recovery_id)) !== null) continue;
        recordRefusal(
          stateFor(row.recovery_id),
          'expired',
          'OPERATOR_RECOVERY_GRANT_KEY_UNAVAILABLE',
          'daemon restart found no root secret for the unconsumed recovery',
        );
      } catch (error) {
        if (error instanceof OperatorRecoveryError && error.code === 'OPERATOR_RECOVERY_LEDGER_INVALID') {
          throw error;
        }
        // A transient store read failure is not evidence that the root is
        // absent. Leave the bounded recovery untouched and fail closed later.
      }
    }
  }

  function expirePriorGenerationRecoveries() {
    const rows = db.prepare(`
      SELECT recovery_id
      FROM operator_recovery_projection
      WHERE status IN ('pending', 'approved')
      ORDER BY updated_at ASC
    `).all() as Array<{ recovery_id: string }>;
    for (const row of rows) {
      const initial = stateFor(row.recovery_id);
      if (initial.common.daemonGeneration === daemonGeneration) continue;
      recordRefusal(
        initial,
        'expired',
        'OPERATOR_RECOVERY_GENERATION_DRIFTED',
        'daemon restart retired unconsumed authority from the prior generation',
      );
    }
  }

  function reconcilePendingCustody() {
    if (!deps.installRecoveredContext) return;
    const rows = db.prepare(`
      SELECT recovery_id
      FROM operator_recovery_projection
      WHERE status = 'custody-pending' AND context_installed_at IS NULL
      ORDER BY updated_at ASC
    `).all() as Array<{ recovery_id: string }>;
    for (const row of rows) {
      try {
        completePendingCustody(row.recovery_id);
      } catch {
        // The sealed envelope plus custody-pending ledger receipt remains the
        // restart-safe retry truth. completePendingCustody records a safe,
        // digest-only refusal for operator inspection.
      }
    }
  }

  function sweepExpiredRecoveries(onlyRecoveryId?: string) {
    const rows = db.prepare(`
      SELECT recovery_id
      FROM operator_recovery_projection
      WHERE status IN ('pending', 'approved', 'custody-pending')
        AND (? IS NULL OR recovery_id = ?)
      ORDER BY updated_at ASC
    `).all(onlyRecoveryId ?? null, onlyRecoveryId ?? null) as Array<{ recovery_id: string }>;
    for (const row of rows) {
      const initial = stateFor(row.recovery_id);
      const custodyExpiry = initial.status === 'custody-pending';
      const expiresAt = custodyExpiry ? initial.common.bodyExpiresAt : initial.common.expiresAt;
      if (now() < expiresAt) continue;
      recordRefusal(
        initial,
        'expired',
        custodyExpiry ? 'OPERATOR_RECOVERY_BODY_EXPIRED' : 'OPERATOR_RECOVERY_GRANT_EXPIRED',
        custodyExpiry
          ? 'sealed successor custody expired before exact-slot installation'
          : 'daemon retired an expired, unconsumed recovery',
      );
    }
  }

  rebuildProjectionsFromLedger();
  expirePriorGenerationRecoveries();
  reconcileMissingRecoveryRoots();
  reconcileUncommittedEnvelopes();
  sweepExpiredRecoveries();
  reconcilePendingCustody();
  retryPendingSecretRetirements();

  return {
    createChallenge,
    decide,
    decideAndConsume,
    consume,
    get,
    list,
    daemonGeneration,
    signingPayloadForTests: signingPayload,
  };
}

export type OperatorRecovery = ReturnType<typeof createOperatorRecovery>;
