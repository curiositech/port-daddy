/**
 * Harbor Editor dead-replica recovery.
 *
 * Recovery evidence comes only from a daemon-owned typed receipt ledger. Session
 * notes are never parsed as operation evidence. The public state machine is:
 *
 *   request -> prepare -> canonical replay validation -> finalize
 *
 * The production daemon deliberately fails closed until it is given both a
 * canonical Rust Loro authority and an authoritative project/harbor/worktree
 * scope authority. Test doubles may exercise the state machine, but cannot make
 * the default runtime claim that opaque bytes or caller metadata were verified.
 */

import type Database from 'better-sqlite3';
import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const EDITOR_TOKEN_PREFIX = 'edrec_';
const EDITOR_TOKEN_TTL_MS = 15 * 60 * 1_000;
const DECIMAL_PEER_ID = /^(0|[1-9][0-9]*)$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const MAX_OPERATION_COUNT = 500;
const MAX_OPERATION_BYTES = 20 * 1024 * 1024;
const MAX_REPLAY_BYTES = 20 * 1024 * 1024;
const MAX_BASE_FILE_BYTES = 20 * 1024 * 1024;
const DEFAULT_PROVENANCE_DRAIN_BATCH_SIZE = 32;
const DEFAULT_PROVENANCE_DRAIN_INTERVAL_MS = 30_000;

export interface EditorReleasedClaim {
  claimId: string;
  filePath: string;
  startLine: number | null;
  endLine: number | null;
  symbol: string | null;
  symbolPath: string | null;
  claimedAt: number;
  releasedAt: number | null;
}

export interface EditorRecoveryScope {
  sessionId: string;
  status: 'active' | 'abandoned';
  agentId: string;
  actorId: string;
  project: string;
  harbor: string;
  worktreeId: string;
  worktreeRoot: string;
  worktreeVerified: true;
  worktreeRootDevice: string;
  worktreeRootInode: string;
  completedAt: number | null;
  claims: EditorReleasedClaim[];
}

export interface EditorRecoveryScopeAuthority {
  resolveSession(sessionId: string): EditorRecoveryScope | null;
  authorizeSalvage(input: {
    actorId: string;
    dead: EditorRecoveryScope;
    acting: EditorRecoveryScope;
  }): { allowed: boolean; reason?: string };
}

export interface CanonicalLoroOperationReceipt {
  validatorId: string;
  receipt: string;
  peerId: string;
  sequence: number;
  operationHash: string;
  stateHash: string;
}

export interface CanonicalLoroReplayReceipt {
  validatorId: string;
  receipt: string;
  operationDigest: string;
  finalStateHash: string;
  highWaterSequence: number;
  operationCount: number;
}

export interface CanonicalLoroAbandonmentReceipt {
  validatorId: string;
  receipt: string;
  peerId: string;
  highWaterSequence: number;
  highWaterHash: string;
  operationCount: number;
  finalStateHash: string;
}

export interface CanonicalLoroAuthority {
  validateOperation(input: {
    authorActorId: string;
    authorAgentId: string;
    authorSessionId: string;
    canonicalPath: string;
    sequence: number;
    bytes: Buffer;
    previousStateHash: string | null;
  }): CanonicalLoroOperationReceipt;
  validateReplay(input: {
    preparationId: string;
    canonicalPath: string;
    peerId: string;
    baseFileHash: string;
    highWaterSequence: number;
    operations: Array<{ sequence: number; operationHash: string; bytes: Buffer }>;
  }): CanonicalLoroReplayReceipt;
  /**
   * Compare the supplied receipt stream with independently captured canonical
   * Rust terminal state. An implementation must never derive its expected
   * high-water mark solely from `operations`; without that independent state,
   * it must reject the call.
   */
  validateAbandonment(input: {
    authorActorId: string;
    authorAgentId: string;
    authorSessionId: string;
    canonicalPath: string;
    abandonedAt: number;
    operations: Array<{
      sequence: number;
      operationHash: string;
      bytes: Buffer;
      stateHash: string;
    }>;
  }): CanonicalLoroAbandonmentReceipt;
}

export interface EditorResolvedSymbol {
  symbolPath: string;
  symbol: string;
  startLine: number;
  endLine: number;
}

export interface EditorSymbolResolutionWitness {
  witnessId: string;
  canonicalPath: string;
  fileContentHash: string;
  symbolPath: string;
  parserGeneration: string;
  authorityGeneration: string;
}

export interface EditorSymbolResolutionLease {
  witness: Readonly<EditorSymbolResolutionWitness>;
  matches: readonly Readonly<EditorResolvedSymbol>[];
  validate(transactionDb: Database.Database): { valid: boolean; error?: string };
  release(): void;
}

export interface EditorSymbolAuthority {
  /**
   * Resolve outside the write transaction but return only an opaque witness
   * bound to exact bytes and parser/authority generations. The design intent is
   * that no unleased symbol array can cross an await and authorize a claim.
   */
  resolveFresh(input: Readonly<{
    canonicalPath: string;
    fileContentHash: string;
    symbolPath: string;
  }>): Promise<Readonly<EditorSymbolResolutionWitness>>;
  /**
   * Acquire a transaction-scoped authority lease for the opaque witness. The
   * implementation must keep the resolution authoritative until `release`;
   * a best-effort late comparison does not satisfy this contract.
   */
  acquireResolutionLease(
    transactionDb: Database.Database,
    witness: Readonly<EditorSymbolResolutionWitness>,
  ): { success: boolean; lease?: EditorSymbolResolutionLease; error?: string };
}

export interface EditorFileMutationLease {
  leaseId: string;
  generation: string;
  validate(transactionDb: Database.Database): { valid: boolean; error?: string };
  consume(transactionDb: Database.Database, input: Readonly<{
    stableClaimId: string;
    successorSessionId: string;
    worktreeId: string;
    worktreeRoot: string;
    worktreeRootDevice: string;
    worktreeRootInode: string;
    canonicalPath: string;
    canonicalDevice: string;
    canonicalInode: string;
    canonicalContentHash: string;
  }>): { success: boolean; error?: string };
  release(input: Readonly<{ committed: boolean }>): void;
}

export interface EditorFileMutationAuthority {
  /**
   * Acquire the daemon's generation lease inside the finalization transaction.
   * Cooperative editor mutations must remain excluded until the lease is
   * consumed in that transaction and released after commit or rollback.
   */
  acquireFinalizationLease(transactionDb: Database.Database, input: Readonly<{
    successorSessionId: string;
    successorActorId: string;
    project: string;
    harbor: string;
    worktreeId: string;
    worktreeRoot: string;
    worktreeRootDevice: string;
    worktreeRootInode: string;
    canonicalPath: string;
    canonicalDevice: string;
    canonicalInode: string;
    contentHash: string;
  }>): { success: boolean; lease?: EditorFileMutationLease; error?: string };
}

/**
 * Dependency on P3's canonical claim authority. Its implementation owns stable
 * claim IDs and hard first-granted conflict rejection. P3.5 never duplicates
 * claim storage or overlap policy.
 */
export interface EditorClaimTransferAuthority {
  /**
   * This mutation is called inside P3.5's better-sqlite3 transaction. A P3
   * adapter must participate on that same canonical connection and must leave
   * no claim mutation behind when the surrounding transaction rolls back.
   */
  transferReleasedClaim(transactionDb: Database.Database, input: Readonly<{
    releasedClaimId: string;
    abandonmentReceiptId: number;
    deadSessionId: string;
    deadAgentId: string;
    deadActorId: string;
    successorSessionId: string;
    successorAgentId: string;
    successorActorId: string;
    project: string;
    harbor: string;
    worktreeId: string;
    worktreeRoot: string;
    worktreeRootDevice: string;
    worktreeRootInode: string;
    canonicalPath: string;
    canonicalDevice: string;
    canonicalInode: string;
    canonicalContentHash: string;
    symbolParserGeneration: string;
    symbolAuthorityGeneration: string;
    fileMutationLeaseId: string;
    fileMutationGeneration: string;
    resolvedSymbol: Readonly<EditorResolvedSymbol>;
  }>): {
    success: boolean;
    stableClaimId?: string;
    error?: string;
    conflicts?: unknown[];
  };
}

interface EditorRecoveryPublicationResult {
  success: boolean;
  error?: string;
  publicationId?: string;
}

export interface EditorRecoveryProvenancePublisher {
  /**
   * Implementations MUST atomically deduplicate `idempotencyKey` at the sink.
   * If that contract cannot be met, leave this dependency unwired so the
   * canonical outbox remains durably pending.
   */
  publish(input: Readonly<{
    outboxId: number;
    provenanceRecordId: number;
    sessionId: string;
    eventType: 'harbor.editor.recovery.provenance';
    payload: string;
    idempotencyKey: string;
  }>): EditorRecoveryPublicationResult | Promise<EditorRecoveryPublicationResult>;
}

export interface EditorRecoveryProvenanceDrainScheduler {
  scheduleStartup(run: () => Promise<void>): void;
  schedulePeriodic(run: () => Promise<void>, intervalMs: number): { dispose(): void };
}

export interface EditorRecoveryCleanupDiagnostic {
  phase: 'prepare_symbol_release' | 'finalize_file_close' | 'finalize_symbol_release' | 'finalize_mutation_release';
  error: string;
}

export interface EditorRecoveryFailure {
  success: false;
  httpStatus: 400 | 401 | 403 | 404 | 409 | 410 | 422 | 503;
  code: string;
  error: string;
  conflicts?: unknown[];
}

export interface RecordEditorOperationInput {
  sessionId: string;
  filePath: string;
  sequence: number;
  bytes: Buffer;
}

export interface SealEditorAbandonmentInput {
  sessionId: string;
  filePath: string;
}

export interface RequestEditorRecoveryInput {
  deadSessionId: string;
  requesterSessionId: string;
  filePath: string;
  requestedByActorId: string;
}

export interface PrepareEditorRecoveryInput {
  token: string;
  successorSessionId: string;
  preparedByActorId: string;
}

export interface ValidateEditorReplayInput {
  preparationId: string;
  successorSessionId: string;
  validatedByActorId: string;
}

export interface FinalizeEditorRecoveryInput {
  token: string;
  preparationId: string;
  successorSessionId: string;
  finalizedByActorId: string;
}

interface CanonicalFile {
  canonicalPath: string;
  worktreeRoot: string;
  worktreeRootDevice: string;
  worktreeRootInode: string;
  device: string;
  inode: string;
  contentHash: string;
}

interface SealedEditorReleasedClaim extends EditorReleasedClaim {
  startLine: number;
  endLine: number;
  symbol: string;
  symbolPath: string;
  releasedAt: number;
  worktreeId: string;
  worktreeRoot: string;
  worktreeRootDevice: string;
  worktreeRootInode: string;
  canonicalPath: string;
  canonicalDevice: string;
  canonicalInode: string;
}

interface OperationRow {
  id: number;
  author_actor_id: string;
  author_agent_id: string;
  author_session_id: string;
  project: string;
  harbor: string;
  worktree_id: string;
  worktree_root: string;
  worktree_root_device: string;
  worktree_root_inode: string;
  canonical_path: string;
  file_device: string;
  file_inode: string;
  base_file_hash: string;
  peer_id: string;
  sequence: number;
  operation_hash: string;
  operation_bytes: Buffer;
  state_hash: string;
  validator_id: string;
  validator_receipt: string;
  created_at: number;
}

interface AbandonmentRow {
  id: number;
  session_id: string;
  author_actor_id: string;
  author_agent_id: string;
  project: string;
  harbor: string;
  worktree_id: string;
  worktree_root: string;
  worktree_root_device: string;
  worktree_root_inode: string;
  canonical_path: string;
  file_device: string;
  file_inode: string;
  base_file_hash: string;
  peer_id: string;
  high_water_sequence: number;
  high_water_hash: string;
  final_state_hash: string;
  operation_digest: string;
  validator_id: string;
  validator_receipt: string;
  operation_count: number;
  claim_json: string;
  abandoned_at: number;
  sealed_at: number;
}

interface TokenRow {
  token: string;
  abandonment_id: number;
  generation: number;
  requester_session_id: string;
  requested_by_actor_id: string;
  created_at: number;
  expires_at: number;
  consumed_at: number | null;
  consumed_by_actor_id: string | null;
  successor_session_id: string | null;
  superseded_at: number | null;
}

interface PreparationRow {
  id: string;
  token: string;
  abandonment_id: number;
  successor_session_id: string;
  prepared_by_actor_id: string;
  symbol_path: string;
  symbol: string;
  start_line: number;
  end_line: number;
  file_content_hash: string;
  prepared_at: number;
  finalized_at: number | null;
  provenance_record_id: number | null;
}

interface ReplayReceiptRow {
  id: number;
  preparation_id: string;
  validator_id: string;
  validator_receipt: string;
  operation_digest: string;
  final_state_hash: string;
  high_water_sequence: number;
  operation_count: number;
  validated_at: number;
}

interface ProvenanceRow {
  id: number;
  preparation_id: string;
  successor_session_id: string;
  event_type: 'harbor.editor.recovery.provenance';
  payload_json: string;
  created_at: number;
}

interface ProvenanceOutboxRow {
  id: number;
  provenance_record_id: number;
  successor_session_id: string;
  event_type: 'harbor.editor.recovery.provenance';
  payload_json: string;
  idempotency_key: string;
  created_at: number;
}

interface ProvenancePublicationRow {
  id: number;
  outbox_id: number;
  publication_id: string;
  published_at: number;
}

export type EditorPathVerificationPhase =
  | 'after-root-open'
  | 'after-file-open'
  | 'after-file-read';

interface VerifiedSealedEvidence {
  operations: OperationRow[];
  operationDigest: string;
  highWater: OperationRow;
}

type Result<T> = T | EditorRecoveryFailure;

class EditorRecoveryAbort extends Error {
  constructor(readonly failure: EditorRecoveryFailure) {
    super(failure.error);
  }
}

function failure(
  httpStatus: EditorRecoveryFailure['httpStatus'],
  code: string,
  error: string,
  conflicts?: unknown[],
): EditorRecoveryFailure {
  return { success: false, httpStatus, code, error, ...(conflicts ? { conflicts } : {}) };
}

function isFailure<T>(result: Result<T>): result is EditorRecoveryFailure {
  return (result as EditorRecoveryFailure).success === false;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hashBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function hasTraversal(input: string): boolean {
  return input.split(/[\\/]+/).includes('..');
}

interface BigIntStatLike {
  dev: bigint;
  ino: bigint;
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

interface CanonicalRootHandle {
  fd: number;
  path: string;
  device: string;
  inode: string;
}

interface CanonicalFileHandle extends CanonicalFile {
  root: CanonicalRootHandle;
  fileFd: number;
  baseline: BigIntStatLike;
}

/**
 * Opens the authority-witnessed worktree root without following a terminal
 * symlink. The design purpose is to turn root identity into an OS descriptor
 * capability rather than a path string that can be replaced after `stat`.
 *
 * @param scope authoritative session scope containing the prior root witness
 * @param hook optional hostile-test race injector, never wired by production
 * @returns an open verified root handle or a fail-closed recovery error
 */
function openCanonicalRoot(
  scope: EditorRecoveryScope,
  hook?: (phase: EditorPathVerificationPhase) => void,
): Result<CanonicalRootHandle> {
  const worktreeRoot = scope.worktreeRoot;
  if (
    !isAbsolute(worktreeRoot)
    || hasTraversal(worktreeRoot)
    || resolve(worktreeRoot) !== worktreeRoot
    || scope.worktreeVerified !== true
    || !isNonEmptyString(scope.worktreeRootDevice)
    || !isNonEmptyString(scope.worktreeRootInode)
  ) {
    return failure(422, 'EDITOR_RECOVERY_PATH_INVALID', 'the worktree root and its witnessed device/inode must be absolute, normalized, traversal-free canonical identity');
  }

  let rootFd: number | null = null;
  try {
    rootFd = openSync(
      worktreeRoot,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_DIRECTORY,
    );
    const descriptor = fstatSync(rootFd, { bigint: true }) as BigIntStatLike;
    if (!descriptor.isDirectory()) {
      closeSync(rootFd);
      return failure(422, 'EDITOR_RECOVERY_PATH_NOT_DIRECTORY', 'the authoritative editor worktree root must be a directory');
    }
    hook?.('after-root-open');
    const pathIdentity = lstatSync(worktreeRoot, { bigint: true }) as BigIntStatLike;
    const canonicalRoot = realpathSync.native(worktreeRoot);
    if (
      canonicalRoot !== worktreeRoot
      || pathIdentity.isSymbolicLink()
      || !pathIdentity.isDirectory()
      || String(pathIdentity.dev) !== String(descriptor.dev)
      || String(pathIdentity.ino) !== String(descriptor.ino)
      || String(descriptor.dev) !== scope.worktreeRootDevice
      || String(descriptor.ino) !== scope.worktreeRootInode
    ) {
      closeSync(rootFd);
      return failure(409, 'EDITOR_RECOVERY_ROOT_IDENTITY_DRIFT', 'the worktree root descriptor no longer matches its authoritative path and witnessed device/inode');
    }
    return {
      fd: rootFd,
      path: canonicalRoot,
      device: String(descriptor.dev),
      inode: String(descriptor.ino),
    };
  } catch {
    if (rootFd !== null) closeSync(rootFd);
    return failure(422, 'EDITOR_RECOVERY_PATH_UNRESOLVED', 'the authoritative editor worktree root could not be opened without following links');
  }
}

/**
 * Re-checks both the still-open root descriptor and the path currently naming
 * it. This second witness is why an ordinary directory rename-and-replacement
 * cannot be accepted merely because both old and new roots are directories.
 *
 * @param root open root descriptor captured before file validation
 * @param scope authoritative root witness supplied by the scope authority
 * @returns null when identity is stable, otherwise a fail-closed error
 */
function verifyRootIdentity(
  root: CanonicalRootHandle,
  scope: EditorRecoveryScope,
): EditorRecoveryFailure | null {
  try {
    const descriptor = fstatSync(root.fd, { bigint: true }) as BigIntStatLike;
    const pathIdentity = lstatSync(root.path, { bigint: true }) as BigIntStatLike;
    if (
      !descriptor.isDirectory()
      || pathIdentity.isSymbolicLink()
      || !pathIdentity.isDirectory()
      || realpathSync.native(root.path) !== root.path
      || String(descriptor.dev) !== root.device
      || String(descriptor.ino) !== root.inode
      || String(pathIdentity.dev) !== root.device
      || String(pathIdentity.ino) !== root.inode
      || root.device !== scope.worktreeRootDevice
      || root.inode !== scope.worktreeRootInode
    ) {
      return failure(409, 'EDITOR_RECOVERY_ROOT_IDENTITY_DRIFT', 'the worktree root was replaced while editor evidence was being verified');
    }
    return null;
  } catch {
    return failure(409, 'EDITOR_RECOVERY_ROOT_IDENTITY_DRIFT', 'the worktree root identity could not be revalidated through its descriptor');
  }
}

function readDescriptorBytes(fileFd: number, size: bigint): Buffer {
  if (size < 0n || size > BigInt(MAX_BASE_FILE_BYTES)) {
    throw new Error('editor recovery base file exceeds the descriptor read limit');
  }
  const bytes = Buffer.alloc(Number(size));
  let offset = 0;
  while (offset < bytes.length) {
    const count = readSync(fileFd, bytes, offset, bytes.length - offset, offset);
    if (count === 0) throw new Error('editor recovery file ended during descriptor read');
    offset += count;
  }
  return bytes;
}

function closeCanonicalFileHandle(handle: CanonicalFileHandle): void {
  try {
    closeSync(handle.fileFd);
  } finally {
    closeSync(handle.root.fd);
  }
}

function verifyCanonicalFileHandle(
  handle: CanonicalFileHandle,
  scope: EditorRecoveryScope,
): EditorRecoveryFailure | null {
  try {
    const beforeRead = fstatSync(handle.fileFd, { bigint: true }) as BigIntStatLike;
    const namedBefore = lstatSync(handle.canonicalPath, { bigint: true }) as BigIntStatLike;
    const rootFailureBefore = verifyRootIdentity(handle.root, scope);
    if (rootFailureBefore) return rootFailureBefore;
    if (
      !beforeRead.isFile()
      || namedBefore.isSymbolicLink()
      || !namedBefore.isFile()
      || realpathSync.native(handle.canonicalPath) !== handle.canonicalPath
      || String(beforeRead.dev) !== String(handle.baseline.dev)
      || String(beforeRead.ino) !== String(handle.baseline.ino)
      || String(beforeRead.size) !== String(handle.baseline.size)
      || String(beforeRead.mtimeNs) !== String(handle.baseline.mtimeNs)
      || String(beforeRead.ctimeNs) !== String(handle.baseline.ctimeNs)
      || String(namedBefore.dev) !== handle.device
      || String(namedBefore.ino) !== handle.inode
    ) {
      return failure(409, 'EDITOR_RECOVERY_FILE_IDENTITY_DRIFT', 'the recovered file descriptor or path changed after it was opened');
    }

    const bytes = readDescriptorBytes(handle.fileFd, beforeRead.size);
    const afterRead = fstatSync(handle.fileFd, { bigint: true }) as BigIntStatLike;
    const namedAfter = lstatSync(handle.canonicalPath, { bigint: true }) as BigIntStatLike;
    const rootFailureAfter = verifyRootIdentity(handle.root, scope);
    if (rootFailureAfter) return rootFailureAfter;
    if (
      !afterRead.isFile()
      || namedAfter.isSymbolicLink()
      || !namedAfter.isFile()
      || realpathSync.native(handle.canonicalPath) !== handle.canonicalPath
      || String(afterRead.dev) !== String(handle.baseline.dev)
      || String(afterRead.ino) !== String(handle.baseline.ino)
      || String(afterRead.size) !== String(handle.baseline.size)
      || String(afterRead.mtimeNs) !== String(handle.baseline.mtimeNs)
      || String(afterRead.ctimeNs) !== String(handle.baseline.ctimeNs)
      || String(namedAfter.dev) !== handle.device
      || String(namedAfter.ino) !== handle.inode
      || hashBytes(bytes) !== handle.contentHash
    ) {
      return failure(409, 'EDITOR_RECOVERY_FILE_IDENTITY_DRIFT', 'the recovered file was replaced or mutated while its descriptor remained authoritative');
    }
    return null;
  } catch {
    return failure(409, 'EDITOR_RECOVERY_FILE_IDENTITY_DRIFT', 'the recovered file descriptor and path identity could not be revalidated');
  }
}

/**
 * Opens the candidate only through an `O_NOFOLLOW` file descriptor while an
 * `O_DIRECTORY|O_NOFOLLOW` root descriptor remains open. Callers that mutate
 * authority may retain this disposable handle, revalidate it at their final
 * transaction boundary, and close it only after commit or rollback.
 *
 * @param scope authoritative scope and prior root device/inode witness
 * @param filePath absolute canonical candidate path beneath the witnessed root
 * @param hook optional hostile-test race injector, never wired by production
 * @returns a retained descriptor-bound file handle or fail-closed error
 */
function openCanonicalFileHandle(
  scope: EditorRecoveryScope,
  filePath: string,
  hook?: (phase: EditorPathVerificationPhase) => void,
): Result<CanonicalFileHandle> {
  const root = openCanonicalRoot(scope, hook);
  if (isFailure(root)) return root;
  let fileFd: number | null = null;
  let keepOpen = false;
  try {
    if (!isAbsolute(filePath) || hasTraversal(filePath) || resolve(filePath) !== filePath) {
      return failure(422, 'EDITOR_RECOVERY_PATH_INVALID', 'worktree root and file path must be absolute, traversal-free paths');
    }
    const canonicalPath = realpathSync.native(filePath);
    if (canonicalPath !== filePath) {
      return failure(422, 'EDITOR_RECOVERY_SYMLINK_REJECTED', 'editor recovery rejects symlinked or aliased worktree paths');
    }
    const within = relative(root.path, canonicalPath);
    if (!within || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) {
      return failure(403, 'EDITOR_RECOVERY_PATH_OUTSIDE_WORKTREE', 'the recovered file must remain inside the authoritative worktree root');
    }

    fileFd = openSync(canonicalPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const before = fstatSync(fileFd, { bigint: true }) as BigIntStatLike;
    if (!before.isFile()) {
      return failure(422, 'EDITOR_RECOVERY_PATH_NOT_FILE', 'the recovered path must resolve to a regular file');
    }
    hook?.('after-file-open');
    const namedBefore = lstatSync(canonicalPath, { bigint: true }) as BigIntStatLike;
    if (
      namedBefore.isSymbolicLink()
      || !namedBefore.isFile()
      || String(namedBefore.dev) !== String(before.dev)
      || String(namedBefore.ino) !== String(before.ino)
    ) {
      return failure(409, 'EDITOR_RECOVERY_FILE_IDENTITY_DRIFT', 'the recovered file path no longer names the opened descriptor');
    }

    const bytes = readDescriptorBytes(fileFd, before.size);
    hook?.('after-file-read');
    const handle: CanonicalFileHandle = {
      canonicalPath,
      worktreeRoot: root.path,
      worktreeRootDevice: root.device,
      worktreeRootInode: root.inode,
      device: String(before.dev),
      inode: String(before.ino),
      contentHash: hashBytes(bytes),
      root,
      fileFd,
      baseline: before,
    };
    const identityFailure = verifyCanonicalFileHandle(handle, scope);
    if (identityFailure) return identityFailure;
    keepOpen = true;
    return handle;
  } catch {
    return failure(422, 'EDITOR_RECOVERY_PATH_UNRESOLVED', 'the authoritative editor path could not be opened and revalidated safely');
  } finally {
    if (!keepOpen) {
      if (fileFd !== null) closeSync(fileFd);
      closeSync(root.fd);
    }
  }
}

function canonicalFile(
  scope: EditorRecoveryScope,
  filePath: string,
  hook?: (phase: EditorPathVerificationPhase) => void,
): Result<CanonicalFile> {
  const handle = openCanonicalFileHandle(scope, filePath, hook);
  if (isFailure(handle)) return handle;
  try {
    return {
      canonicalPath: handle.canonicalPath,
      worktreeRoot: handle.worktreeRoot,
      worktreeRootDevice: handle.worktreeRootDevice,
      worktreeRootInode: handle.worktreeRootInode,
      device: handle.device,
      inode: handle.inode,
      contentHash: handle.contentHash,
    };
  } finally {
    closeCanonicalFileHandle(handle);
  }
}

function sameScope(a: EditorRecoveryScope, b: EditorRecoveryScope): boolean {
  return a.project === b.project
    && a.harbor === b.harbor
    && a.worktreeId === b.worktreeId
    && a.worktreeRoot === b.worktreeRoot
    && a.worktreeRootDevice === b.worktreeRootDevice
    && a.worktreeRootInode === b.worktreeRootInode;
}

function sameFile(row: AbandonmentRow, file: CanonicalFile): boolean {
  return row.canonical_path === file.canonicalPath
    && row.worktree_root === file.worktreeRoot
    && row.worktree_root_device === file.worktreeRootDevice
    && row.worktree_root_inode === file.worktreeRootInode
    && row.file_device === file.device
    && row.file_inode === file.inode
    && row.base_file_hash === file.contentHash;
}

function operationDigest(rows: OperationRow[]): string {
  const hash = createHash('sha256');
  for (const row of rows) hash.update(`${row.sequence}:${row.operation_hash}\n`);
  return hash.digest('hex');
}

function parseClaim(row: AbandonmentRow): Result<SealedEditorReleasedClaim> {
  try {
    const claim = JSON.parse(row.claim_json) as Partial<SealedEditorReleasedClaim>;
    if (
      !claim || typeof claim !== 'object'
      || !isNonEmptyString(claim.claimId)
      || !isNonEmptyString(claim.filePath)
      || !isNonEmptyString(claim.symbolPath)
      || !isNonEmptyString(claim.symbol)
      || typeof claim.startLine !== 'number' || !Number.isSafeInteger(claim.startLine) || claim.startLine < 1
      || typeof claim.endLine !== 'number' || !Number.isSafeInteger(claim.endLine) || claim.endLine < claim.startLine
      || typeof claim.claimedAt !== 'number' || !Number.isSafeInteger(claim.claimedAt) || claim.claimedAt < 0
      || typeof claim.releasedAt !== 'number' || !Number.isSafeInteger(claim.releasedAt) || claim.releasedAt < claim.claimedAt
      || !isNonEmptyString(claim.worktreeId)
      || !isNonEmptyString(claim.worktreeRoot)
      || !isNonEmptyString(claim.worktreeRootDevice)
      || !isNonEmptyString(claim.worktreeRootInode)
      || !isNonEmptyString(claim.canonicalPath)
      || !isNonEmptyString(claim.canonicalDevice)
      || !isNonEmptyString(claim.canonicalInode)
    ) {
      return failure(409, 'EDITOR_RECOVERY_CLAIM_STALE', 'the sealed released claim is missing its canonical identity binding');
    }
    return claim as SealedEditorReleasedClaim;
  } catch {
    return failure(409, 'EDITOR_RECOVERY_CLAIM_STALE', 'the sealed released claim is not valid typed evidence');
  }
}

export function createEditorRecovery(
  db: Database.Database,
  deps: {
    scopeAuthority?: EditorRecoveryScopeAuthority | null;
    canonicalLoro?: CanonicalLoroAuthority | null;
    symbolAuthority?: EditorSymbolAuthority | null;
    claimTransferAuthority?: EditorClaimTransferAuthority | null;
    fileMutationAuthority?: EditorFileMutationAuthority | null;
    provenancePublisher?: EditorRecoveryProvenancePublisher | null;
    provenanceDrainScheduler?: EditorRecoveryProvenanceDrainScheduler | null;
    provenanceDrainBatchSize?: number;
    provenanceDrainIntervalMs?: number;
    cleanupDiagnosticReporter?: ((diagnostic: Readonly<EditorRecoveryCleanupDiagnostic>) => void) | null;
    pathVerificationHook?: ((phase: EditorPathVerificationPhase) => void) | null;
    /** Hostile-test seam invoked inside IMMEDIATE immediately before receipt insertion. */
    replayReceiptPersistenceHook?: (() => void) | null;
    /** Hostile-test seam invoked after finalization writes and before the retained-fd recheck. */
    finalizationMutationHook?: (() => void) | null;
    /** Hostile-test seam invoked after the final fd check while mutation leases remain held. */
    afterFinalDescriptorCheckHook?: (() => void) | null;
    /** Hostile-test seam invoked immediately before append-only projection-attempt evidence. */
    provenanceAttemptPersistenceHook?: (() => void) | null;
    /** Hostile-test seam invoked after sink success and before the local publication receipt. */
    provenancePublicationReceiptPersistenceHook?: (() => void) | null;
    now?: () => number;
  },
) {
  const now = deps.now ?? Date.now;

  /**
   * Records a cleanup failure without allowing cleanup code or its reporter to
   * reverse an already committed API result.
   *
   * @param diagnostics response-local diagnostics surfaced to the caller
   * @param phase exact cleanup operation that failed
   * @param error thrown cleanup value
   */
  function recordCleanupDiagnostic(
    diagnostics: EditorRecoveryCleanupDiagnostic[],
    phase: EditorRecoveryCleanupDiagnostic['phase'],
    error: unknown,
  ): void {
    const diagnostic = Object.freeze({
      phase,
      error: error instanceof Error ? error.message : String(error),
    });
    diagnostics.push(diagnostic);
    try {
      deps.cleanupDiagnosticReporter?.(diagnostic);
    } catch {
      // Diagnostics must not introduce a second commit-ambiguity failure.
    }
  }

  // These tables have never shipped on main. Reconstruct the exact current
  // schema idempotently; do not migrate or preserve an intermediate PR schema.
  db.exec(`
    CREATE TABLE IF NOT EXISTS editor_operation_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author_actor_id TEXT NOT NULL,
      author_agent_id TEXT NOT NULL,
      author_session_id TEXT NOT NULL,
      project TEXT NOT NULL,
      harbor TEXT NOT NULL,
      worktree_id TEXT NOT NULL,
      worktree_root TEXT NOT NULL,
      worktree_root_device TEXT NOT NULL,
      worktree_root_inode TEXT NOT NULL,
      canonical_path TEXT NOT NULL,
      file_device TEXT NOT NULL,
      file_inode TEXT NOT NULL,
      base_file_hash TEXT NOT NULL CHECK(length(base_file_hash) = 64),
      peer_id TEXT NOT NULL,
      sequence INTEGER NOT NULL CHECK(sequence >= 0),
      operation_hash TEXT NOT NULL CHECK(length(operation_hash) = 64),
      operation_bytes BLOB NOT NULL,
      state_hash TEXT NOT NULL CHECK(length(state_hash) = 64),
      validator_id TEXT NOT NULL,
      validator_receipt TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(author_session_id, canonical_path, peer_id, sequence),
      UNIQUE(author_session_id, canonical_path, operation_hash)
    );

    CREATE TABLE IF NOT EXISTS editor_abandonment_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      author_actor_id TEXT NOT NULL,
      author_agent_id TEXT NOT NULL,
      project TEXT NOT NULL,
      harbor TEXT NOT NULL,
      worktree_id TEXT NOT NULL,
      worktree_root TEXT NOT NULL,
      worktree_root_device TEXT NOT NULL,
      worktree_root_inode TEXT NOT NULL,
      canonical_path TEXT NOT NULL,
      file_device TEXT NOT NULL,
      file_inode TEXT NOT NULL,
      base_file_hash TEXT NOT NULL CHECK(length(base_file_hash) = 64),
      peer_id TEXT NOT NULL,
      high_water_sequence INTEGER NOT NULL CHECK(high_water_sequence >= 0),
      high_water_hash TEXT NOT NULL CHECK(length(high_water_hash) = 64),
      final_state_hash TEXT NOT NULL CHECK(length(final_state_hash) = 64),
      operation_digest TEXT NOT NULL CHECK(length(operation_digest) = 64),
      validator_id TEXT NOT NULL,
      validator_receipt TEXT NOT NULL,
      operation_count INTEGER NOT NULL CHECK(operation_count > 0),
      claim_json TEXT NOT NULL,
      abandoned_at INTEGER NOT NULL,
      sealed_at INTEGER NOT NULL,
      UNIQUE(session_id, canonical_path)
    );

    CREATE TABLE IF NOT EXISTS editor_recovery_tokens (
      token TEXT PRIMARY KEY CHECK(length(token) = 70 AND substr(token, 1, 6) = 'edrec_'),
      abandonment_id INTEGER NOT NULL REFERENCES editor_abandonment_receipts(id),
      generation INTEGER NOT NULL CHECK(generation > 0),
      requester_session_id TEXT NOT NULL,
      requested_by_actor_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      consumed_at INTEGER,
      consumed_by_actor_id TEXT,
      successor_session_id TEXT,
      superseded_at INTEGER,
      UNIQUE(abandonment_id, generation)
    );

    CREATE TABLE IF NOT EXISTS editor_recovery_preparations (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL UNIQUE REFERENCES editor_recovery_tokens(token),
      abandonment_id INTEGER NOT NULL REFERENCES editor_abandonment_receipts(id),
      successor_session_id TEXT NOT NULL,
      prepared_by_actor_id TEXT NOT NULL,
      symbol_path TEXT NOT NULL,
      symbol TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      file_content_hash TEXT NOT NULL,
      prepared_at INTEGER NOT NULL,
      finalized_at INTEGER,
      provenance_record_id INTEGER
    );

    CREATE TABLE IF NOT EXISTS editor_replay_validation_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      preparation_id TEXT NOT NULL UNIQUE REFERENCES editor_recovery_preparations(id),
      validator_id TEXT NOT NULL,
      validator_receipt TEXT NOT NULL,
      operation_digest TEXT NOT NULL CHECK(length(operation_digest) = 64),
      final_state_hash TEXT NOT NULL CHECK(length(final_state_hash) = 64),
      high_water_sequence INTEGER NOT NULL CHECK(high_water_sequence >= 0),
      operation_count INTEGER NOT NULL CHECK(operation_count > 0),
      validated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS editor_recovery_provenance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      preparation_id TEXT NOT NULL UNIQUE REFERENCES editor_recovery_preparations(id),
      successor_session_id TEXT NOT NULL,
      event_type TEXT NOT NULL CHECK(event_type = 'harbor.editor.recovery.provenance'),
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS editor_recovery_provenance_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provenance_record_id INTEGER NOT NULL UNIQUE REFERENCES editor_recovery_provenance(id),
      successor_session_id TEXT NOT NULL,
      event_type TEXT NOT NULL CHECK(event_type = 'harbor.editor.recovery.provenance'),
      payload_json TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS editor_recovery_provenance_publications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      outbox_id INTEGER NOT NULL UNIQUE REFERENCES editor_recovery_provenance_outbox(id),
      publication_id TEXT NOT NULL,
      published_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS editor_recovery_provenance_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      outbox_id INTEGER NOT NULL REFERENCES editor_recovery_provenance_outbox(id),
      attempted_at INTEGER NOT NULL,
      error TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS editor_recovery_one_live_token
      ON editor_recovery_tokens(abandonment_id)
      WHERE consumed_at IS NULL AND superseded_at IS NULL;

    CREATE TRIGGER IF NOT EXISTS editor_operation_receipts_no_update
      BEFORE UPDATE ON editor_operation_receipts
      BEGIN SELECT RAISE(ABORT, 'editor operation receipts are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS editor_operation_receipts_no_delete
      BEFORE DELETE ON editor_operation_receipts
      BEGIN SELECT RAISE(ABORT, 'editor operation receipts are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS editor_operation_receipts_no_post_seal
      BEFORE INSERT ON editor_operation_receipts
      WHEN EXISTS (
        SELECT 1 FROM editor_abandonment_receipts
        WHERE session_id = NEW.author_session_id
          AND canonical_path = NEW.canonical_path
      )
      BEGIN SELECT RAISE(ABORT, 'sealed editor operation streams are terminal'); END;
    CREATE TRIGGER IF NOT EXISTS editor_abandonment_receipts_no_update
      BEFORE UPDATE ON editor_abandonment_receipts
      BEGIN SELECT RAISE(ABORT, 'editor abandonment receipts are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS editor_abandonment_receipts_no_delete
      BEFORE DELETE ON editor_abandonment_receipts
      BEGIN SELECT RAISE(ABORT, 'editor abandonment receipts are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS editor_replay_validation_receipts_no_update
      BEFORE UPDATE ON editor_replay_validation_receipts
      BEGIN SELECT RAISE(ABORT, 'editor replay receipts are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS editor_replay_validation_receipts_no_delete
      BEFORE DELETE ON editor_replay_validation_receipts
      BEGIN SELECT RAISE(ABORT, 'editor replay receipts are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS editor_recovery_provenance_no_update
      BEFORE UPDATE ON editor_recovery_provenance
      BEGIN SELECT RAISE(ABORT, 'editor recovery provenance is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS editor_recovery_provenance_no_delete
      BEFORE DELETE ON editor_recovery_provenance
      BEGIN SELECT RAISE(ABORT, 'editor recovery provenance is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS editor_recovery_provenance_outbox_no_update
      BEFORE UPDATE ON editor_recovery_provenance_outbox
      BEGIN SELECT RAISE(ABORT, 'editor recovery provenance outbox is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS editor_recovery_provenance_outbox_no_delete
      BEFORE DELETE ON editor_recovery_provenance_outbox
      BEGIN SELECT RAISE(ABORT, 'editor recovery provenance outbox is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS editor_recovery_provenance_publications_no_update
      BEFORE UPDATE ON editor_recovery_provenance_publications
      BEGIN SELECT RAISE(ABORT, 'editor recovery provenance publications are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS editor_recovery_provenance_publications_no_delete
      BEFORE DELETE ON editor_recovery_provenance_publications
      BEGIN SELECT RAISE(ABORT, 'editor recovery provenance publications are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS editor_recovery_provenance_attempts_no_update
      BEFORE UPDATE ON editor_recovery_provenance_attempts
      BEGIN SELECT RAISE(ABORT, 'editor recovery provenance attempts are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS editor_recovery_provenance_attempts_no_delete
      BEFORE DELETE ON editor_recovery_provenance_attempts
      BEGIN SELECT RAISE(ABORT, 'editor recovery provenance attempts are append-only'); END;
  `);

  const getLatestOperation = db.prepare(`
    SELECT * FROM editor_operation_receipts
    WHERE author_session_id = ? AND canonical_path = ?
    ORDER BY sequence DESC LIMIT 1
  `);
  const getOperationAtSequence = db.prepare(`
    SELECT * FROM editor_operation_receipts
    WHERE author_session_id = ? AND canonical_path = ? AND sequence = ?
  `);
  const insertOperation = db.prepare(`
    INSERT INTO editor_operation_receipts (
      author_actor_id, author_agent_id, author_session_id, project, harbor,
      worktree_id, worktree_root, worktree_root_device, worktree_root_inode,
      canonical_path, file_device, file_inode,
      base_file_hash, peer_id, sequence, operation_hash, operation_bytes,
      state_hash, validator_id, validator_receipt, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const listOperations = db.prepare(`
    SELECT * FROM editor_operation_receipts
    WHERE author_session_id = ? AND canonical_path = ?
    ORDER BY sequence ASC
  `);
  const insertAbandonment = db.prepare(`
    INSERT INTO editor_abandonment_receipts (
      session_id, author_actor_id, author_agent_id, project, harbor, worktree_id,
      worktree_root, worktree_root_device, worktree_root_inode, canonical_path,
      file_device, file_inode, base_file_hash,
      peer_id, high_water_sequence, high_water_hash, final_state_hash,
      operation_digest, validator_id, validator_receipt, operation_count,
      claim_json, abandoned_at, sealed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const getAbandonment = db.prepare(`
    SELECT * FROM editor_abandonment_receipts WHERE session_id = ? AND canonical_path = ?
  `);
  const getAbandonmentById = db.prepare(`SELECT * FROM editor_abandonment_receipts WHERE id = ?`);
  const getToken = db.prepare(`SELECT * FROM editor_recovery_tokens WHERE token = ?`);
  const getLatestTokenForAbandonment = db.prepare(`
    SELECT * FROM editor_recovery_tokens
    WHERE abandonment_id = ?
    ORDER BY generation DESC LIMIT 1
  `);
  const insertToken = db.prepare(`
    INSERT INTO editor_recovery_tokens (
      token, abandonment_id, generation, requester_session_id,
      requested_by_actor_id, created_at, expires_at, consumed_at,
      consumed_by_actor_id, successor_session_id, superseded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)
  `);
  const supersedeExpiredToken = db.prepare(`
    UPDATE editor_recovery_tokens
    SET superseded_at = ?
    WHERE token = ?
      AND consumed_at IS NULL
      AND superseded_at IS NULL
      AND expires_at <= ?
  `);
  const insertPreparation = db.prepare(`
    INSERT INTO editor_recovery_preparations (
      id, token, abandonment_id, successor_session_id, prepared_by_actor_id,
      symbol_path, symbol, start_line, end_line, file_content_hash, prepared_at,
      finalized_at, provenance_record_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
  `);
  const getPreparation = db.prepare(`SELECT * FROM editor_recovery_preparations WHERE id = ?`);
  const getPreparationForToken = db.prepare(`SELECT * FROM editor_recovery_preparations WHERE token = ?`);
  const getReplayReceipt = db.prepare(`SELECT * FROM editor_replay_validation_receipts WHERE preparation_id = ?`);
  const insertReplayReceipt = db.prepare(`
    INSERT INTO editor_replay_validation_receipts (
      preparation_id, validator_id, validator_receipt, operation_digest,
      final_state_hash, high_water_sequence, operation_count, validated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(preparation_id) DO NOTHING
  `);
  const consumeToken = db.prepare(`
    UPDATE editor_recovery_tokens
    SET consumed_at = ?, consumed_by_actor_id = ?, successor_session_id = ?
    WHERE token = ?
      AND consumed_at IS NULL
      AND superseded_at IS NULL
      AND expires_at > ?
  `);
  const finalizePreparation = db.prepare(`
    UPDATE editor_recovery_preparations
    SET finalized_at = ?, provenance_record_id = ?
    WHERE id = ? AND finalized_at IS NULL
  `);
  const insertProvenance = db.prepare(`
    INSERT INTO editor_recovery_provenance (
      preparation_id, successor_session_id, event_type, payload_json, created_at
    ) VALUES (?, ?, 'harbor.editor.recovery.provenance', ?, ?)
  `);
  const getProvenance = db.prepare(`SELECT * FROM editor_recovery_provenance WHERE id = ?`);
  const insertProvenanceOutbox = db.prepare(`
    INSERT INTO editor_recovery_provenance_outbox (
      provenance_record_id, successor_session_id, event_type, payload_json,
      idempotency_key, created_at
    ) VALUES (?, ?, 'harbor.editor.recovery.provenance', ?, ?, ?)
  `);
  const getProvenanceOutbox = db.prepare(`SELECT * FROM editor_recovery_provenance_outbox WHERE id = ?`);
  const listPendingProvenanceOutbox = db.prepare(`
    SELECT outbox.* FROM editor_recovery_provenance_outbox outbox
    LEFT JOIN editor_recovery_provenance_publications published ON published.outbox_id = outbox.id
    WHERE published.outbox_id IS NULL
    ORDER BY outbox.id ASC
    LIMIT ?
  `);
  const getProvenancePublication = db.prepare(`
    SELECT * FROM editor_recovery_provenance_publications WHERE outbox_id = ?
  `);
  const insertProvenancePublication = db.prepare(`
    INSERT OR IGNORE INTO editor_recovery_provenance_publications (
      outbox_id, publication_id, published_at
    ) VALUES (?, ?, ?)
  `);
  const insertProvenanceAttempt = db.prepare(`
    INSERT INTO editor_recovery_provenance_attempts (outbox_id, attempted_at, error)
    VALUES (?, ?, ?)
  `);

  function requiredAuthorities(options: {
    canonical?: boolean;
    symbol?: boolean;
    claim?: boolean;
    fileMutation?: boolean;
  } = {}): EditorRecoveryFailure | null {
    if (!deps.scopeAuthority) {
      return failure(503, 'EDITOR_SCOPE_AUTHORITY_UNAVAILABLE', 'daemon-authoritative project, harbor, and worktree scope is not wired; recovery is fail-closed');
    }
    if (options.canonical && !deps.canonicalLoro) {
      return failure(503, 'CANONICAL_LORO_AUTHORITY_UNAVAILABLE', 'the canonical Rust Loro validation contract is not wired; recovery is fail-closed');
    }
    if (options.symbol && (
      !deps.symbolAuthority
      || typeof deps.symbolAuthority.resolveFresh !== 'function'
      || typeof deps.symbolAuthority.acquireResolutionLease !== 'function'
    )) {
      return failure(503, 'EDITOR_SYMBOL_AUTHORITY_UNAVAILABLE', 'content-bound symbol resolution and its transaction lease are not wired; recovery is fail-closed');
    }
    if (options.claim && (!deps.claimTransferAuthority || typeof deps.claimTransferAuthority.transferReleasedClaim !== 'function')) {
      return failure(503, 'EDITOR_CLAIM_AUTHORITY_UNAVAILABLE', 'P3 stable claim IDs and hard conflict rejection are not wired; recovery is fail-closed');
    }
    if (options.fileMutation && (
      !deps.fileMutationAuthority
      || typeof deps.fileMutationAuthority.acquireFinalizationLease !== 'function'
    )) {
      return failure(503, 'EDITOR_FILE_MUTATION_AUTHORITY_UNAVAILABLE', 'the daemon file-mutation lease/generation authority is not wired; recovery is fail-closed');
    }
    return null;
  }

  function requiredPublicAuthorities(): EditorRecoveryFailure | null {
    return requiredAuthorities({ canonical: true, symbol: true, claim: true, fileMutation: true });
  }

  /**
   * Requests an opaque content-bound symbol witness without allowing an
   * authority exception or rejected promise to escape as an unclassified 500.
   *
   * @param input exact descriptor-derived path/hash and sealed symbol path
   * @returns the opaque witness or an explicit fail-closed dependency result
   */
  async function resolveSymbolResolutionWitness(
    input: Parameters<EditorSymbolAuthority['resolveFresh']>[0],
  ): Promise<Result<Readonly<EditorSymbolResolutionWitness>>> {
    try {
      return await deps.symbolAuthority!.resolveFresh(input);
    } catch (error) {
      return failure(
        503,
        'EDITOR_SYMBOL_AUTHORITY_UNAVAILABLE',
        error instanceof Error ? error.message : 'the content-bound symbol authority rejected witness resolution',
      );
    }
  }

  /**
   * Converts an out-of-transaction opaque symbol witness into an authority
   * lease held by the active SQLite transaction. The purpose is to forbid an
   * unbound parser result from surviving an await and authorizing a claim.
   *
   * @param witness opaque witness minted by the symbol authority
   * @param file exact descriptor-verified file identity in the transaction
   * @param symbolPath sealed symbol path that must be re-resolved
   * @returns a held lease or a fail-closed authority-drift result
   */
  function acquireSymbolResolutionLease(
    witness: Readonly<EditorSymbolResolutionWitness>,
    file: CanonicalFile,
    symbolPath: string,
  ): Result<EditorSymbolResolutionLease> {
    if (!db.inTransaction) throw new Error('symbol resolution leases require the active editor recovery transaction');
    if (
      !witness
      || typeof witness !== 'object'
      || !isNonEmptyString(witness.witnessId)
      || witness.canonicalPath !== file.canonicalPath
      || witness.fileContentHash !== file.contentHash
      || witness.symbolPath !== symbolPath
      || !isNonEmptyString(witness.parserGeneration)
      || !isNonEmptyString(witness.authorityGeneration)
    ) {
      return failure(409, 'EDITOR_SYMBOL_AUTHORITY_DRIFT', 'the symbol witness is not bound to the exact live path, bytes, parser generation, and authority generation');
    }
    let acquired: ReturnType<EditorSymbolAuthority['acquireResolutionLease']>;
    try {
      acquired = deps.symbolAuthority!.acquireResolutionLease(db, witness);
    } catch (error) {
      return failure(409, 'EDITOR_SYMBOL_AUTHORITY_DRIFT', error instanceof Error ? error.message : 'the symbol authority could not acquire its transaction lease');
    }
    const lease = acquired.lease;
    if (
      !acquired.success
      || !lease
      || lease.witness.witnessId !== witness.witnessId
      || lease.witness.canonicalPath !== witness.canonicalPath
      || lease.witness.fileContentHash !== witness.fileContentHash
      || lease.witness.symbolPath !== witness.symbolPath
      || lease.witness.parserGeneration !== witness.parserGeneration
      || lease.witness.authorityGeneration !== witness.authorityGeneration
      || !Array.isArray(lease.matches)
      || typeof lease.validate !== 'function'
      || typeof lease.release !== 'function'
    ) {
      try { lease?.release(); } catch { /* A failed lease cannot authorize recovery. */ }
      return failure(409, 'EDITOR_SYMBOL_AUTHORITY_DRIFT', acquired.error ?? 'the symbol authority did not retain the exact witnessed parser generation');
    }
    const current = validateSymbolResolutionLease(lease);
    if (current) {
      try { lease.release(); } catch { /* The original drift error remains authoritative. */ }
      return current;
    }
    return lease;
  }

  /**
   * Revalidates a held symbol lease without replacing it with a late parser
   * comparison. Its design intent is that the authority itself promises the
   * witnessed generation stayed frozen through the protected mutation.
   *
   * @param lease retained transaction-scoped symbol authority lease
   * @returns null while authoritative, otherwise a fail-closed drift result
   */
  function validateSymbolResolutionLease(
    lease: EditorSymbolResolutionLease,
  ): EditorRecoveryFailure | null {
    try {
      const current = lease.validate(db);
      if (!db.inTransaction || !current.valid) {
        return failure(409, 'EDITOR_SYMBOL_AUTHORITY_DRIFT', current.error ?? 'the content-bound symbol authority generation changed during recovery');
      }
      return null;
    } catch (error) {
      return failure(409, 'EDITOR_SYMBOL_AUTHORITY_DRIFT', error instanceof Error ? error.message : 'the symbol authority lease could not be revalidated');
    }
  }

  /**
   * Acquires the daemon-enforced file mutation generation inside the same
   * transaction that transfers the claim. The lease is deliberately retained
   * beyond the callback and released only after commit or rollback.
   *
   * @param input exact live scope, descriptor identity, and successor owner
   * @returns a held mutation lease or a fail-closed conflict result
   */
  function acquireFileMutationLease(
    input: Parameters<EditorFileMutationAuthority['acquireFinalizationLease']>[1],
  ): Result<EditorFileMutationLease> {
    if (!db.inTransaction) throw new Error('file mutation leases require the active editor recovery transaction');
    let acquired: ReturnType<EditorFileMutationAuthority['acquireFinalizationLease']>;
    try {
      acquired = deps.fileMutationAuthority!.acquireFinalizationLease(db, input);
    } catch (error) {
      return failure(409, 'EDITOR_FILE_MUTATION_LEASE_CONFLICT', error instanceof Error ? error.message : 'the daemon file-mutation authority could not acquire its transaction lease');
    }
    const lease = acquired.lease;
    if (
      !acquired.success
      || !lease
      || !isNonEmptyString(lease.leaseId)
      || !isNonEmptyString(lease.generation)
      || typeof lease.validate !== 'function'
      || typeof lease.consume !== 'function'
      || typeof lease.release !== 'function'
    ) {
      try { lease?.release({ committed: false }); } catch { /* The acquisition failure remains authoritative. */ }
      return failure(409, 'EDITOR_FILE_MUTATION_LEASE_CONFLICT', acquired.error ?? 'the daemon file-mutation authority did not return a held generation lease');
    }
    const current = validateFileMutationLease(lease);
    if (current) {
      try { lease.release({ committed: false }); } catch { /* The original drift error remains authoritative. */ }
      return current;
    }
    return lease;
  }

  /**
   * Checks that cooperative daemon mutations remain excluded by the same held
   * generation lease. This check complements descriptor identity; it does not
   * claim SQLite can stop an unrelated process from writing the filesystem.
   *
   * @param lease retained daemon mutation-generation lease
   * @returns null while held, otherwise a fail-closed lease-drift result
   */
  function validateFileMutationLease(
    lease: EditorFileMutationLease,
  ): EditorRecoveryFailure | null {
    try {
      const current = lease.validate(db);
      if (!db.inTransaction || !current.valid) {
        return failure(409, 'EDITOR_FILE_MUTATION_AUTHORITY_DRIFT', current.error ?? 'the daemon file-mutation generation changed during finalization');
      }
      return null;
    } catch (error) {
      return failure(409, 'EDITOR_FILE_MUTATION_AUTHORITY_DRIFT', error instanceof Error ? error.message : 'the daemon file-mutation lease could not be revalidated');
    }
  }

  function resolveActingScope(
    sessionId: string,
    actorId: string,
    dead: EditorRecoveryScope,
  ): Result<EditorRecoveryScope> {
    const acting = deps.scopeAuthority!.resolveSession(sessionId);
    if (!acting) return failure(404, 'EDITOR_SESSION_NOT_FOUND', 'the acting editor session was not found by the scope authority');
    if (acting.status !== 'active') return failure(409, 'EDITOR_SESSION_NOT_ACTIVE', 'the acting editor session must be active');
    if (acting.actorId !== actorId) return failure(403, 'EDITOR_SESSION_ACTOR_MISMATCH', 'the verified caller does not own the acting editor session');
    if (!sameScope(dead, acting)) {
      return failure(403, 'EDITOR_RECOVERY_SCOPE_MISMATCH', 'recovery cannot cross project, harbor, worktree, or worktree-root boundaries');
    }
    const capability = deps.scopeAuthority!.authorizeSalvage({ actorId, dead, acting });
    if (!capability.allowed) {
      return failure(403, 'EDITOR_SALVAGE_CAPABILITY_REQUIRED', capability.reason ?? 'the verified actor lacks editor salvage capability in this harbor');
    }
    return acting;
  }

  function validateTokenRow(token: string): Result<TokenRow> {
    if (!token || !token.startsWith(EDITOR_TOKEN_PREFIX)) {
      return failure(404, 'EDITOR_RECOVERY_TOKEN_INVALID', 'the editor recovery capability is unknown');
    }
    const row = getToken.get(token) as TokenRow | undefined;
    if (!row) return failure(404, 'EDITOR_RECOVERY_TOKEN_INVALID', 'the editor recovery capability is unknown');
    if (row.consumed_at !== null) return failure(409, 'EDITOR_RECOVERY_ALREADY_FINALIZED', 'the editor recovery capability was already finalized');
    if (row.superseded_at !== null) return failure(410, 'EDITOR_RECOVERY_TOKEN_EXPIRED', 'the editor recovery capability was superseded after expiry');
    if (row.expires_at <= now()) return failure(410, 'EDITOR_RECOVERY_TOKEN_EXPIRED', 'the editor recovery capability expired');
    return row;
  }

  function scopeFromAbandonment(row: AbandonmentRow): Result<EditorRecoveryScope> {
    const current = deps.scopeAuthority!.resolveSession(row.session_id);
    if (!current || current.status !== 'abandoned' || current.completedAt !== row.abandoned_at) {
      return failure(409, 'EDITOR_ABANDONMENT_STALE', 'the terminal abandonment authority no longer matches the sealed receipt');
    }
    const currentRoot = openCanonicalRoot(current, deps.pathVerificationHook ?? undefined);
    if (isFailure(currentRoot)) return currentRoot;
    const rootFailure = verifyRootIdentity(currentRoot, current);
    closeSync(currentRoot.fd);
    if (rootFailure) return rootFailure;
    if (
      current.actorId !== row.author_actor_id
      || current.agentId !== row.author_agent_id
      || current.project !== row.project
      || current.harbor !== row.harbor
      || current.worktreeId !== row.worktree_id
      || currentRoot.path !== row.worktree_root
      || currentRoot.device !== row.worktree_root_device
      || currentRoot.inode !== row.worktree_root_inode
    ) {
      return failure(409, 'EDITOR_ABANDONMENT_SCOPE_DRIFT', 'the abandoned editor scope changed after the high-water receipt was sealed');
    }
    return current;
  }

  function releasedClaimForFile(
    scope: EditorRecoveryScope,
    file: CanonicalFile,
  ): Result<EditorReleasedClaim> {
    const released: EditorReleasedClaim[] = [];
    for (const claim of scope.claims) {
      if (claim.releasedAt !== scope.completedAt || claim.releasedAt == null) continue;
      let normalizedClaimPath: string | null = null;
      let realClaimPath: string | null = null;
      try {
        normalizedClaimPath = resolve(claim.filePath);
        realClaimPath = realpathSync.native(normalizedClaimPath);
      } catch {
        // An unrelated stale claim cannot authorize this file.
      }
      if (normalizedClaimPath !== file.canonicalPath && realClaimPath !== file.canonicalPath) continue;
      if (
        !isAbsolute(claim.filePath)
        || hasTraversal(claim.filePath)
        || claim.filePath !== file.canonicalPath
        || normalizedClaimPath !== file.canonicalPath
        || realClaimPath !== file.canonicalPath
      ) {
        return failure(422, 'EDITOR_RECOVERY_CLAIM_PATH_INVALID', 'the released claim must name the exact canonical file path without traversal or aliases');
      }
      released.push(claim);
    }
    if (released.length !== 1) {
      return failure(409, 'EDITOR_RECOVERY_RELEASED_CLAIM_COUNT', 'exactly one explicitly released claim tied to the abandonment is required');
    }
    const claim = released[0];
    if (
      !claim.claimId || !claim.symbolPath || !claim.symbol
      || typeof claim.startLine !== 'number' || !Number.isSafeInteger(claim.startLine) || claim.startLine < 1
      || typeof claim.endLine !== 'number' || !Number.isSafeInteger(claim.endLine) || claim.endLine < claim.startLine
      || !Number.isSafeInteger(claim.claimedAt) || claim.claimedAt < 0
      || typeof claim.releasedAt !== 'number' || !Number.isSafeInteger(claim.releasedAt) || claim.releasedAt < claim.claimedAt
    ) {
      return failure(409, 'EDITOR_RECOVERY_SYMBOL_CLAIM_REQUIRED', 'the abandonment must release one stable-ID, fully resolved symbolPath claim');
    }
    return claim;
  }

  function bindReleasedClaim(
    claim: EditorReleasedClaim,
    scope: EditorRecoveryScope,
    file: CanonicalFile,
  ): SealedEditorReleasedClaim {
    return {
      ...claim,
      startLine: claim.startLine!,
      endLine: claim.endLine!,
      symbol: claim.symbol!,
      symbolPath: claim.symbolPath!,
      releasedAt: claim.releasedAt!,
      filePath: file.canonicalPath,
      worktreeId: scope.worktreeId,
      worktreeRoot: file.worktreeRoot,
      worktreeRootDevice: file.worktreeRootDevice,
      worktreeRootInode: file.worktreeRootInode,
      canonicalPath: file.canonicalPath,
      canonicalDevice: file.device,
      canonicalInode: file.inode,
    };
  }

  function verifySealedClaim(
    row: AbandonmentRow,
    scope: EditorRecoveryScope,
    file: CanonicalFile,
  ): Result<SealedEditorReleasedClaim> {
    const claim = parseClaim(row);
    if (isFailure(claim)) return claim;
    if (
      claim.releasedAt !== row.abandoned_at
      || claim.worktreeId !== row.worktree_id
      || claim.worktreeRoot !== row.worktree_root
      || claim.worktreeRootDevice !== row.worktree_root_device
      || claim.worktreeRootInode !== row.worktree_root_inode
      || claim.filePath !== row.canonical_path
      || claim.canonicalPath !== row.canonical_path
      || claim.canonicalDevice !== row.file_device
      || claim.canonicalInode !== row.file_inode
      || claim.worktreeId !== scope.worktreeId
      || claim.worktreeRoot !== file.worktreeRoot
      || claim.worktreeRootDevice !== file.worktreeRootDevice
      || claim.worktreeRootInode !== file.worktreeRootInode
      || claim.canonicalPath !== file.canonicalPath
      || claim.canonicalDevice !== file.device
      || claim.canonicalInode !== file.inode
    ) {
      return failure(409, 'EDITOR_RECOVERY_CLAIM_STALE', 'the sealed released claim no longer matches the exact worktree and file identity');
    }
    const current = releasedClaimForFile(scope, file);
    if (isFailure(current)) return current;
    if (
      current.claimId !== claim.claimId
      || current.filePath !== claim.filePath
      || current.startLine !== claim.startLine
      || current.endLine !== claim.endLine
      || current.symbol !== claim.symbol
      || current.symbolPath !== claim.symbolPath
      || current.claimedAt !== claim.claimedAt
      || current.releasedAt !== claim.releasedAt
    ) {
      return failure(409, 'EDITOR_RECOVERY_CLAIM_STALE', 'the authoritative released claim changed after the abandonment receipt was sealed');
    }
    return claim;
  }

  function verifySealedEvidence(row: AbandonmentRow): Result<VerifiedSealedEvidence> {
    const operations = listOperations.all(row.session_id, row.canonical_path) as OperationRow[];
    if (
      operations.length === 0
      || operations.length !== row.operation_count
      || operations.length > MAX_OPERATION_COUNT
      || operations.reduce((total, operation) => total + operation.operation_bytes.length, 0) > MAX_REPLAY_BYTES
    ) {
      return failure(409, 'EDITOR_OPERATION_LEDGER_INVALID', 'the sealed operation count or bounded replay evidence no longer matches');
    }

    for (let index = 0; index < operations.length; index++) {
      const operation = operations[index];
      if (
        operation.sequence !== index
        || operation.author_actor_id !== row.author_actor_id
        || operation.author_agent_id !== row.author_agent_id
        || operation.author_session_id !== row.session_id
        || operation.project !== row.project
        || operation.harbor !== row.harbor
        || operation.worktree_id !== row.worktree_id
        || operation.worktree_root !== row.worktree_root
        || operation.worktree_root_device !== row.worktree_root_device
        || operation.worktree_root_inode !== row.worktree_root_inode
        || operation.canonical_path !== row.canonical_path
        || operation.file_device !== row.file_device
        || operation.file_inode !== row.file_inode
        || operation.base_file_hash !== row.base_file_hash
        || operation.peer_id !== row.peer_id
        || !SHA256_HEX.test(operation.operation_hash)
        || hashBytes(operation.operation_bytes) !== operation.operation_hash
        || !SHA256_HEX.test(operation.state_hash)
        || !operation.validator_id
        || !operation.validator_receipt
      ) {
        return failure(409, 'EDITOR_OPERATION_LEDGER_INVALID', 'the sealed operation sequence, scope, hashes, or canonical receipts no longer match');
      }
    }

    const highWater = operations.at(-1)!;
    const digest = operationDigest(operations);
    if (
      !SHA256_HEX.test(row.high_water_hash)
      || !SHA256_HEX.test(row.final_state_hash)
      || !SHA256_HEX.test(row.operation_digest)
      || highWater.sequence !== row.high_water_sequence
      || highWater.operation_hash !== row.high_water_hash
      || highWater.state_hash !== row.final_state_hash
      || digest !== row.operation_digest
    ) {
      return failure(409, 'EDITOR_OPERATION_LEDGER_INVALID', 'the sealed digest, high-water mark, or terminal state no longer matches the complete operation stream');
    }
    return { operations, operationDigest: digest, highWater };
  }

  function verifyReplayReceipt(
    row: ReplayReceiptRow,
    abandonment: AbandonmentRow,
    evidence: VerifiedSealedEvidence,
  ): Result<ReplayReceiptRow> {
    if (
      !row.validator_id
      || !row.validator_receipt
      || !SHA256_HEX.test(row.operation_digest)
      || !SHA256_HEX.test(row.final_state_hash)
      || row.operation_digest !== evidence.operationDigest
      || row.operation_digest !== abandonment.operation_digest
      || row.final_state_hash !== abandonment.final_state_hash
      || row.high_water_sequence !== evidence.highWater.sequence
      || row.high_water_sequence !== abandonment.high_water_sequence
      || row.operation_count !== evidence.operations.length
      || row.operation_count !== abandonment.operation_count
    ) {
      return failure(409, 'EDITOR_REPLAY_RECEIPT_STALE', 'the replay receipt no longer matches the exact sealed digest, count, high-water mark, and terminal state');
    }
    return row;
  }

  /**
   * Checks a freshly computed Rust replay receipt against transaction-local
   * evidence. Its design purpose is to prevent an expensive validation result
   * from authorizing rows that changed before the immediate write transaction.
   *
   * @param receipt canonical Rust result computed before opening SQLite write scope
   * @param abandonment live sealed abandonment row read inside the transaction
   * @param evidence live operation stream and digest read inside the transaction
   * @returns the receipt on exact agreement or a fail-closed validation error
   */
  function verifyComputedReplayReceipt(
    receipt: CanonicalLoroReplayReceipt,
    abandonment: AbandonmentRow,
    evidence: VerifiedSealedEvidence,
  ): Result<CanonicalLoroReplayReceipt> {
    if (
      !receipt.validatorId
      || !receipt.receipt
      || !SHA256_HEX.test(receipt.finalStateHash)
      || receipt.operationDigest !== evidence.operationDigest
      || receipt.operationDigest !== abandonment.operation_digest
      || receipt.finalStateHash !== abandonment.final_state_hash
      || receipt.highWaterSequence !== abandonment.high_water_sequence
      || receipt.highWaterSequence !== evidence.highWater.sequence
      || receipt.operationCount !== abandonment.operation_count
      || receipt.operationCount !== evidence.operations.length
    ) {
      return failure(422, 'CANONICAL_LORO_REPLAY_REJECTED', 'the canonical Rust contract did not attest the exact live complete replay');
    }
    return receipt;
  }

  function validateResolvedSymbol(
    row: AbandonmentRow,
    matches: readonly Readonly<EditorResolvedSymbol>[],
    prepared?: PreparationRow,
  ): Result<EditorResolvedSymbol> {
    const claim = parseClaim(row);
    if (isFailure(claim)) return claim;
    if (matches.length === 0) return failure(409, 'EDITOR_RECOVERY_SYMBOL_DELETED', 'the released symbolPath no longer resolves');
    if (matches.length !== 1) return failure(409, 'EDITOR_RECOVERY_SYMBOL_AMBIGUOUS', 'the released symbolPath resolves ambiguously');
    const symbol = matches[0];
    if (
      symbol.symbolPath !== claim.symbolPath
      || symbol.symbol !== claim.symbol
      || symbol.startLine !== claim.startLine
      || symbol.endLine !== claim.endLine
    ) {
      return failure(409, 'EDITOR_RECOVERY_SYMBOL_DRIFT', 'the released symbol claim drifted since abandonment');
    }
    if (prepared && (
      symbol.symbolPath !== prepared.symbol_path
      || symbol.symbol !== prepared.symbol
      || symbol.startLine !== prepared.start_line
      || symbol.endLine !== prepared.end_line
    )) {
      return failure(409, 'EDITOR_RECOVERY_SYMBOL_DRIFT', 'the symbol claim drifted after replay preparation');
    }
    return { ...symbol };
  }

  async function recordOperationReceipt(input: RecordEditorOperationInput): Promise<Result<{ success: true; receiptId: number; duplicate: boolean }>> {
    const unavailable = requiredAuthorities({ canonical: true });
    if (unavailable) return unavailable;
    if (!Number.isSafeInteger(input.sequence) || input.sequence < 0 || !Buffer.isBuffer(input.bytes) || input.bytes.length === 0) {
      return failure(400, 'EDITOR_OPERATION_INVALID', 'a non-empty operation and non-negative safe sequence are required');
    }
    if (input.sequence >= MAX_OPERATION_COUNT) return failure(422, 'EDITOR_OPERATION_LEDGER_TOO_LARGE', 'the recovery operation ledger exceeds the bounded replay limit');
    if (input.bytes.length > MAX_OPERATION_BYTES) return failure(422, 'EDITOR_OPERATION_TOO_LARGE', 'the editor operation exceeds the recovery ledger limit');
    const scope = deps.scopeAuthority!.resolveSession(input.sessionId);
    if (!scope || scope.status !== 'active') return failure(409, 'EDITOR_OPERATION_SESSION_INACTIVE', 'operations can only be receipted for an active authoritative editor session');
    const file = canonicalFile(scope, input.filePath, deps.pathVerificationHook ?? undefined);
    if (isFailure(file)) return file;

    const existing = getOperationAtSequence.get(scope.sessionId, file.canonicalPath, input.sequence) as OperationRow | undefined;
    const bytesHash = hashBytes(input.bytes);
    if (existing) {
      if (
        existing.author_actor_id !== scope.actorId
        || existing.author_agent_id !== scope.agentId
        || existing.project !== scope.project
        || existing.harbor !== scope.harbor
        || existing.worktree_id !== scope.worktreeId
        || existing.worktree_root !== file.worktreeRoot
        || existing.worktree_root_device !== file.worktreeRootDevice
        || existing.worktree_root_inode !== file.worktreeRootInode
        || existing.file_device !== file.device
        || existing.file_inode !== file.inode
        || existing.base_file_hash !== file.contentHash
        || hashBytes(existing.operation_bytes) !== existing.operation_hash
      ) {
        return failure(409, 'EDITOR_OPERATION_SCOPE_DRIFT', 'the authoritative author, scope, file, or stored receipt changed before this retry');
      }
      if (existing.operation_hash === bytesHash) return { success: true, receiptId: existing.id, duplicate: true };
      return failure(409, 'EDITOR_OPERATION_SEQUENCE_COLLISION', 'a different operation already owns this daemon sequence');
    }

    const latest = getLatestOperation.get(scope.sessionId, file.canonicalPath) as OperationRow | undefined;
    const expectedSequence = latest ? latest.sequence + 1 : 0;
    if (input.sequence !== expectedSequence) {
      return failure(409, 'EDITOR_OPERATION_SEQUENCE_GAP', `the next daemon-owned operation sequence is ${expectedSequence}`);
    }
    if (latest && (
      latest.author_actor_id !== scope.actorId
      || latest.author_agent_id !== scope.agentId
      || latest.project !== scope.project
      || latest.harbor !== scope.harbor
      || latest.worktree_id !== scope.worktreeId
      || latest.worktree_root !== file.worktreeRoot
      || latest.worktree_root_device !== file.worktreeRootDevice
      || latest.worktree_root_inode !== file.worktreeRootInode
      || latest.file_device !== file.device
      || latest.file_inode !== file.inode
      || latest.base_file_hash !== file.contentHash
    )) {
      return failure(409, 'EDITOR_OPERATION_SCOPE_DRIFT', 'the authoritative author, scope, or base file changed within the operation stream');
    }

    const canonical = deps.canonicalLoro!.validateOperation({
      authorActorId: scope.actorId,
      authorAgentId: scope.agentId,
      authorSessionId: scope.sessionId,
      canonicalPath: file.canonicalPath,
      sequence: input.sequence,
      bytes: input.bytes,
      previousStateHash: latest?.state_hash ?? null,
    });
    if (
      !canonical.validatorId
      || !canonical.receipt
      || !DECIMAL_PEER_ID.test(canonical.peerId)
      || canonical.sequence !== input.sequence
      || canonical.operationHash !== bytesHash
      || !SHA256_HEX.test(canonical.stateHash)
    ) {
      return failure(422, 'CANONICAL_LORO_OPERATION_REJECTED', 'the canonical Rust contract did not attest the exact operation, PeerID, sequence, and hash');
    }

    const inserted = insertOperation.run(
      scope.actorId, scope.agentId, scope.sessionId, scope.project, scope.harbor,
      scope.worktreeId, file.worktreeRoot, file.worktreeRootDevice, file.worktreeRootInode,
      file.canonicalPath, file.device, file.inode,
      file.contentHash, canonical.peerId, canonical.sequence, canonical.operationHash,
      input.bytes, canonical.stateHash, canonical.validatorId, canonical.receipt, now(),
    );
    return { success: true, receiptId: Number(inserted.lastInsertRowid), duplicate: false };
  }

  async function sealAbandonment(input: SealEditorAbandonmentInput): Promise<Result<{ success: true; abandonmentId: number; highWaterSequence: number }>> {
    const unavailable = requiredAuthorities({ canonical: true });
    if (unavailable) return unavailable;
    const scope = deps.scopeAuthority!.resolveSession(input.sessionId);
    if (!scope || scope.status !== 'abandoned' || scope.completedAt == null) {
      return failure(409, 'EDITOR_SESSION_NOT_ABANDONED', 'a terminal authoritative abandonment is required');
    }
    const file = canonicalFile(scope, input.filePath, deps.pathVerificationHook ?? undefined);
    if (isFailure(file)) return file;
    const existing = getAbandonment.get(scope.sessionId, file.canonicalPath) as AbandonmentRow | undefined;
    if (existing) {
      const currentScope = scopeFromAbandonment(existing);
      if (isFailure(currentScope)) return currentScope;
      if (!sameFile(existing, file)) {
        return failure(409, 'EDITOR_RECOVERY_FILE_DRIFT', 'the authoritative file changed after the abandonment receipt was sealed');
      }
      const evidence = verifySealedEvidence(existing);
      if (isFailure(evidence)) return evidence;
      const existingClaim = verifySealedClaim(existing, currentScope, file);
      if (isFailure(existingClaim)) return existingClaim;
      return { success: true, abandonmentId: existing.id, highWaterSequence: existing.high_water_sequence };
    }
    const releasedClaim = releasedClaimForFile(scope, file);
    if (isFailure(releasedClaim)) return releasedClaim;
    const claim = bindReleasedClaim(releasedClaim, scope, file);

    const operations = listOperations.all(scope.sessionId, file.canonicalPath) as OperationRow[];
    if (operations.length === 0) return failure(409, 'EDITOR_OPERATION_LEDGER_EMPTY', 'no canonical operation receipts exist for the abandoned editor');
    if (operations.length > MAX_OPERATION_COUNT) return failure(422, 'EDITOR_OPERATION_LEDGER_TOO_LARGE', 'the recovery operation ledger exceeds the bounded replay limit');
    if (operations.reduce((total, operation) => total + operation.operation_bytes.length, 0) > MAX_REPLAY_BYTES) {
      return failure(422, 'EDITOR_OPERATION_LEDGER_TOO_LARGE', 'the recovery operation ledger exceeds the bounded replay byte limit');
    }
    const peerId = operations[0].peer_id;
    for (let index = 0; index < operations.length; index++) {
      const operation = operations[index];
      if (
        operation.sequence !== index
        || operation.peer_id !== peerId
        || operation.author_actor_id !== scope.actorId
        || operation.author_agent_id !== scope.agentId
        || operation.project !== scope.project
        || operation.harbor !== scope.harbor
        || operation.worktree_id !== scope.worktreeId
        || operation.worktree_root !== file.worktreeRoot
        || operation.worktree_root_device !== file.worktreeRootDevice
        || operation.worktree_root_inode !== file.worktreeRootInode
        || operation.file_device !== file.device
        || operation.file_inode !== file.inode
        || operation.base_file_hash !== file.contentHash
        || hashBytes(operation.operation_bytes) !== operation.operation_hash
      ) {
        return failure(409, 'EDITOR_OPERATION_LEDGER_INVALID', 'the typed operation ledger is incomplete, corrupt, or scope-inconsistent');
      }
    }
    const highWater = operations.at(-1)!;
    const terminal = deps.canonicalLoro!.validateAbandonment({
      authorActorId: scope.actorId,
      authorAgentId: scope.agentId,
      authorSessionId: scope.sessionId,
      canonicalPath: file.canonicalPath,
      abandonedAt: scope.completedAt,
      operations: operations.map(operation => ({
        sequence: operation.sequence,
        operationHash: operation.operation_hash,
        bytes: operation.operation_bytes,
        stateHash: operation.state_hash,
      })),
    });
    if (
      !terminal.validatorId
      || !terminal.receipt
      || !DECIMAL_PEER_ID.test(terminal.peerId)
      || terminal.peerId !== peerId
      || terminal.highWaterSequence !== highWater.sequence
      || terminal.highWaterHash !== highWater.operation_hash
      || terminal.operationCount !== operations.length
      || !SHA256_HEX.test(terminal.finalStateHash)
      || terminal.finalStateHash !== highWater.state_hash
    ) {
      return failure(422, 'CANONICAL_LORO_ABANDONMENT_REJECTED', 'the canonical Rust contract did not attest the complete terminal operation high-water mark');
    }
    const inserted = insertAbandonment.run(
      scope.sessionId, scope.actorId, scope.agentId, scope.project, scope.harbor,
      scope.worktreeId, file.worktreeRoot, file.worktreeRootDevice, file.worktreeRootInode,
      file.canonicalPath, file.device, file.inode,
      file.contentHash, peerId, terminal.highWaterSequence, terminal.highWaterHash,
      terminal.finalStateHash, operationDigest(operations), terminal.validatorId,
      terminal.receipt, terminal.operationCount, JSON.stringify(claim),
      scope.completedAt, now(),
    );
    return { success: true, abandonmentId: Number(inserted.lastInsertRowid), highWaterSequence: highWater.sequence };
  }

  async function requestEvidence(input: RequestEditorRecoveryInput): Promise<Result<Record<string, unknown>>> {
    const unavailable = requiredPublicAuthorities();
    if (unavailable) return unavailable;
    const dead = deps.scopeAuthority!.resolveSession(input.deadSessionId);
    if (!dead || dead.status !== 'abandoned') return failure(404, 'EDITOR_ABANDONMENT_NOT_FOUND', 'the authoritative abandoned editor session was not found');
    const file = canonicalFile(dead, input.filePath, deps.pathVerificationHook ?? undefined);
    if (isFailure(file)) return file;
    const abandonment = getAbandonment.get(dead.sessionId, file.canonicalPath) as AbandonmentRow | undefined;
    if (!abandonment) return failure(409, 'EDITOR_ABANDONMENT_NOT_SEALED', 'the daemon has no terminal high-water receipt for this editor path');
    const currentDead = scopeFromAbandonment(abandonment);
    if (isFailure(currentDead)) return currentDead;
    if (!sameFile(abandonment, file)) return failure(409, 'EDITOR_RECOVERY_FILE_DRIFT', 'the authoritative file changed after abandonment');
    const evidence = verifySealedEvidence(abandonment);
    if (isFailure(evidence)) return evidence;
    const releasedClaim = verifySealedClaim(abandonment, currentDead, file);
    if (isFailure(releasedClaim)) return releasedClaim;
    const acting = resolveActingScope(input.requesterSessionId, input.requestedByActorId, currentDead);
    if (isFailure(acting)) return acting;

    const issue = db.transaction((): Result<Record<string, unknown>> => {
      const issuedAt = now();
      const existing = getLatestTokenForAbandonment.get(abandonment.id) as TokenRow | undefined;
      if (existing && existing.consumed_at !== null) {
        return failure(409, 'EDITOR_RECOVERY_ALREADY_FINALIZED', 'the abandoned editor was already recovered');
      }
      if (existing && existing.superseded_at === null && existing.expires_at > issuedAt) {
        if (existing.requested_by_actor_id !== input.requestedByActorId || existing.requester_session_id !== input.requesterSessionId) {
          return failure(409, 'EDITOR_RECOVERY_ALREADY_REQUESTED', 'another verified salvager already owns this recovery capability');
        }
        return {
          success: true,
          token: existing.token,
          expires_at: existing.expires_at,
          recovery: recoverySummary(abandonment),
        };
      }
      if (existing && existing.superseded_at === null) {
        if (supersedeExpiredToken.run(issuedAt, existing.token, issuedAt).changes !== 1) {
          throw new Error('expired editor recovery token did not rotate atomically');
        }
      }
      const token = `${EDITOR_TOKEN_PREFIX}${randomBytes(32).toString('hex')}`;
      const generation = (existing?.generation ?? 0) + 1;
      const expiresAt = issuedAt + EDITOR_TOKEN_TTL_MS;
      insertToken.run(
        token, abandonment.id, generation, input.requesterSessionId,
        input.requestedByActorId, issuedAt, expiresAt,
      );
      return {
        success: true,
        token,
        expires_at: expiresAt,
        recovery: recoverySummary(abandonment),
      };
    });
    return issue.immediate();
  }

  async function prepareForReplay(input: PrepareEditorRecoveryInput): Promise<Result<Record<string, unknown>>> {
    const unavailable = requiredPublicAuthorities();
    if (unavailable) return unavailable;
    const token = validateTokenRow(input.token);
    if (isFailure(token)) return token;
    const abandonment = getAbandonmentById.get(token.abandonment_id) as AbandonmentRow | undefined;
    if (!abandonment) return failure(409, 'EDITOR_ABANDONMENT_NOT_SEALED', 'the terminal abandonment receipt is missing');
    const dead = scopeFromAbandonment(abandonment);
    if (isFailure(dead)) return dead;
    const acting = resolveActingScope(input.successorSessionId, input.preparedByActorId, dead);
    if (isFailure(acting)) return acting;
    const file = canonicalFile(dead, abandonment.canonical_path, deps.pathVerificationHook ?? undefined);
    if (isFailure(file)) return file;
    if (!sameFile(abandonment, file)) return failure(409, 'EDITOR_RECOVERY_FILE_DRIFT', 'the authoritative file changed after abandonment');
    const evidence = verifySealedEvidence(abandonment);
    if (isFailure(evidence)) return evidence;
    const claim = verifySealedClaim(abandonment, dead, file);
    if (isFailure(claim)) return claim;
    const symbolWitness = await resolveSymbolResolutionWitness(Object.freeze({
      canonicalPath: file.canonicalPath,
      fileContentHash: file.contentHash,
      symbolPath: claim.symbolPath,
    }));
    if (isFailure(symbolWitness)) return symbolWitness;

    let symbolLease: EditorSymbolResolutionLease | null = null;
    const prepare = db.transaction((): Result<Record<string, unknown>> => {
      const liveUnavailable = requiredPublicAuthorities();
      if (liveUnavailable) return liveUnavailable;
      const liveToken = validateTokenRow(input.token);
      if (isFailure(liveToken)) return liveToken;
      const liveAbandonment = getAbandonmentById.get(liveToken.abandonment_id) as AbandonmentRow | undefined;
      if (!liveAbandonment) return failure(409, 'EDITOR_ABANDONMENT_NOT_SEALED', 'the terminal abandonment receipt is missing');
      const liveDead = scopeFromAbandonment(liveAbandonment);
      if (isFailure(liveDead)) return liveDead;
      const liveActing = resolveActingScope(input.successorSessionId, input.preparedByActorId, liveDead);
      if (isFailure(liveActing)) return liveActing;
      const liveFile = canonicalFile(liveDead, liveAbandonment.canonical_path, deps.pathVerificationHook ?? undefined);
      if (isFailure(liveFile)) return liveFile;
      if (!sameFile(liveAbandonment, liveFile)) {
        return failure(409, 'EDITOR_RECOVERY_FILE_DRIFT', 'the authoritative file changed during symbol re-resolution');
      }
      const liveEvidence = verifySealedEvidence(liveAbandonment);
      if (isFailure(liveEvidence)) return liveEvidence;
      const liveClaim = verifySealedClaim(liveAbandonment, liveDead, liveFile);
      if (isFailure(liveClaim)) return liveClaim;
      const acquiredSymbolLease = acquireSymbolResolutionLease(symbolWitness, liveFile, liveClaim.symbolPath);
      if (isFailure(acquiredSymbolLease)) return acquiredSymbolLease;
      symbolLease = acquiredSymbolLease;
      const existing = getPreparationForToken.get(liveToken.token) as PreparationRow | undefined;
      const liveSymbol = validateResolvedSymbol(liveAbandonment, acquiredSymbolLease.matches, existing);
      if (isFailure(liveSymbol)) return liveSymbol;
      if (existing) {
        if (
          existing.abandonment_id !== liveAbandonment.id
          || existing.successor_session_id !== liveActing.sessionId
          || existing.prepared_by_actor_id !== liveActing.actorId
          || existing.file_content_hash !== liveFile.contentHash
        ) {
          return failure(409, 'EDITOR_RECOVERY_ALREADY_PREPARED', 'another verified successor or stale file identity owns this replay preparation');
        }
        const leaseFailure = validateSymbolResolutionLease(acquiredSymbolLease);
        if (leaseFailure) return leaseFailure;
        return preparedResponse(existing, liveAbandonment, liveEvidence.operations);
      }
      const id = `edprep_${randomBytes(24).toString('hex')}`;
      insertPreparation.run(
        id, liveToken.token, liveAbandonment.id, liveActing.sessionId, liveActing.actorId,
        liveSymbol.symbolPath, liveSymbol.symbol, liveSymbol.startLine, liveSymbol.endLine,
        liveFile.contentHash, now(),
      );
      const prepared = getPreparation.get(id) as PreparationRow;
      const leaseFailure = validateSymbolResolutionLease(acquiredSymbolLease);
      if (leaseFailure) return leaseFailure;
      return preparedResponse(prepared, liveAbandonment, liveEvidence.operations);
    });
    const cleanupDiagnostics: EditorRecoveryCleanupDiagnostic[] = [];
    let result: Result<Record<string, unknown>>;
    try {
      result = prepare.immediate();
    } finally {
      try {
        (symbolLease as EditorSymbolResolutionLease | null)?.release();
      } catch (error) {
        recordCleanupDiagnostic(cleanupDiagnostics, 'prepare_symbol_release', error);
      }
    }
    return cleanupDiagnostics.length > 0 && !isFailure(result)
      ? { ...result, cleanup_diagnostics: cleanupDiagnostics }
      : result;
  }

  async function validatePreparedReplay(input: ValidateEditorReplayInput): Promise<Result<Record<string, unknown>>> {
    const unavailable = requiredPublicAuthorities();
    if (unavailable) return unavailable;
    const preparation = getPreparation.get(input.preparationId) as PreparationRow | undefined;
    if (!preparation) return failure(404, 'EDITOR_REPLAY_PREPARATION_NOT_FOUND', 'the replay preparation was not found');
    if (preparation.successor_session_id !== input.successorSessionId || preparation.prepared_by_actor_id !== input.validatedByActorId) {
      return failure(403, 'EDITOR_REPLAY_PREPARATION_ACTOR_MISMATCH', 'the verified successor does not own this replay preparation');
    }
    if (preparation.finalized_at !== null) {
      return failure(409, 'EDITOR_RECOVERY_ALREADY_FINALIZED', 'the replay preparation was already finalized');
    }
    const token = validateTokenRow(preparation.token);
    if (isFailure(token)) return token;
    if (token.abandonment_id !== preparation.abandonment_id) {
      return failure(409, 'EDITOR_REPLAY_PREPARATION_STALE', 'the replay preparation no longer belongs to the token abandonment');
    }
    const abandonment = getAbandonmentById.get(preparation.abandonment_id) as AbandonmentRow | undefined;
    if (!abandonment || abandonment.id !== token.abandonment_id) {
      return failure(409, 'EDITOR_ABANDONMENT_NOT_SEALED', 'the terminal abandonment receipt is missing or no longer bound to this token');
    }
    const dead = scopeFromAbandonment(abandonment);
    if (isFailure(dead)) return dead;
    const acting = resolveActingScope(input.successorSessionId, input.validatedByActorId, dead);
    if (isFailure(acting)) return acting;
    const file = canonicalFile(dead, abandonment.canonical_path, deps.pathVerificationHook ?? undefined);
    if (isFailure(file)) return file;
    if (!sameFile(abandonment, file) || file.contentHash !== preparation.file_content_hash) {
      return failure(409, 'EDITOR_RECOVERY_FILE_DRIFT', 'the authoritative file changed before canonical replay');
    }
    const evidence = verifySealedEvidence(abandonment);
    if (isFailure(evidence)) return evidence;
    const releasedClaim = verifySealedClaim(abandonment, dead, file);
    if (isFailure(releasedClaim)) return releasedClaim;

    // Canonical Rust validation is deliberately outside SQLite's write
    // transaction. The immediate transaction below treats this only as a
    // candidate receipt and validates it again against freshly read live rows.
    const receipt = deps.canonicalLoro!.validateReplay({
      preparationId: preparation.id,
      canonicalPath: abandonment.canonical_path,
      peerId: abandonment.peer_id,
      baseFileHash: abandonment.base_file_hash,
      highWaterSequence: abandonment.high_water_sequence,
      operations: evidence.operations.map(operation => ({
        sequence: operation.sequence,
        operationHash: operation.operation_hash,
        bytes: operation.operation_bytes,
      })),
    });
    const initiallyVerified = verifyComputedReplayReceipt(receipt, abandonment, evidence);
    if (isFailure(initiallyVerified)) return initiallyVerified;

    const persist = db.transaction((): Result<Record<string, unknown>> => {
      const liveUnavailable = requiredPublicAuthorities();
      if (liveUnavailable) return liveUnavailable;
      const livePreparation = getPreparation.get(input.preparationId) as PreparationRow | undefined;
      if (!livePreparation) {
        return failure(404, 'EDITOR_REPLAY_PREPARATION_NOT_FOUND', 'the replay preparation disappeared before receipt persistence');
      }
      if (
        livePreparation.successor_session_id !== input.successorSessionId
        || livePreparation.prepared_by_actor_id !== input.validatedByActorId
      ) {
        return failure(403, 'EDITOR_REPLAY_PREPARATION_ACTOR_MISMATCH', 'the verified successor no longer owns this replay preparation');
      }
      if (livePreparation.finalized_at !== null) {
        return failure(409, 'EDITOR_RECOVERY_ALREADY_FINALIZED', 'the replay preparation was finalized during canonical validation');
      }
      const liveToken = validateTokenRow(livePreparation.token);
      if (isFailure(liveToken)) return liveToken;
      if (liveToken.abandonment_id !== livePreparation.abandonment_id) {
        return failure(409, 'EDITOR_REPLAY_PREPARATION_STALE', 'the replay preparation no longer belongs to the live token abandonment');
      }
      const liveAbandonment = getAbandonmentById.get(livePreparation.abandonment_id) as AbandonmentRow | undefined;
      if (!liveAbandonment || liveAbandonment.id !== liveToken.abandonment_id) {
        return failure(409, 'EDITOR_ABANDONMENT_NOT_SEALED', 'the live terminal abandonment is missing or no longer bound to this token');
      }
      const liveDead = scopeFromAbandonment(liveAbandonment);
      if (isFailure(liveDead)) return liveDead;
      const liveActing = resolveActingScope(input.successorSessionId, input.validatedByActorId, liveDead);
      if (isFailure(liveActing)) return liveActing;
      const liveFile = canonicalFile(liveDead, liveAbandonment.canonical_path, deps.pathVerificationHook ?? undefined);
      if (isFailure(liveFile)) return liveFile;
      if (!sameFile(liveAbandonment, liveFile) || liveFile.contentHash !== livePreparation.file_content_hash) {
        return failure(409, 'EDITOR_RECOVERY_FILE_DRIFT', 'the descriptor-bound file changed during canonical replay validation');
      }
      const liveEvidence = verifySealedEvidence(liveAbandonment);
      if (isFailure(liveEvidence)) return liveEvidence;
      const liveClaim = verifySealedClaim(liveAbandonment, liveDead, liveFile);
      if (isFailure(liveClaim)) return liveClaim;
      const liveComputed = verifyComputedReplayReceipt(receipt, liveAbandonment, liveEvidence);
      if (isFailure(liveComputed)) return liveComputed;

      const existing = getReplayReceipt.get(livePreparation.id) as ReplayReceiptRow | undefined;
      if (existing) {
        const verified = verifyReplayReceipt(existing, liveAbandonment, liveEvidence);
        return isFailure(verified) ? verified : replayReceiptResponse(verified);
      }

      const validatedAt = now();
      deps.replayReceiptPersistenceHook?.();
      insertReplayReceipt.run(
        livePreparation.id, receipt.validatorId, receipt.receipt, receipt.operationDigest,
        receipt.finalStateHash, receipt.highWaterSequence, receipt.operationCount, validatedAt,
      );
      const persisted = getReplayReceipt.get(livePreparation.id) as ReplayReceiptRow | undefined;
      if (!persisted) throw new Error('editor replay receipt insert or unique-conflict winner was not readable in its immediate transaction');
      const verified = verifyReplayReceipt(persisted, liveAbandonment, liveEvidence);
      return isFailure(verified) ? verified : replayReceiptResponse(verified);
    });
    return persist.immediate();
  }

  /**
   * Projects one committed provenance outbox row through an explicitly
   * idempotent sink. The publisher call is intentionally outside every SQLite
   * transaction; a crash before the local publication receipt is repaired by
   * retrying the same stable idempotency key.
   *
   * @param outboxId committed editor recovery provenance outbox identifier
   * @returns truthful published or pending delivery state
   */
  async function publishProvenanceOutboxRow(outboxId: number): Promise<Record<string, unknown>> {
    const pending = (reason: string, details: Record<string, unknown> = {}): Record<string, unknown> => ({
      id: outboxId,
      status: 'pending',
      reason,
      ...details,
    });
    const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);
    let row: ProvenanceOutboxRow | undefined;
    try {
      row = getProvenanceOutbox.get(outboxId) as ProvenanceOutboxRow | undefined;
    } catch (error) {
      return pending(`committed provenance outbox read failed: ${errorMessage(error)}`);
    }
    if (!row) return pending('committed provenance outbox row is temporarily unreadable');
    let existing: ProvenancePublicationRow | undefined;
    try {
      existing = getProvenancePublication.get(row.id) as ProvenancePublicationRow | undefined;
    } catch (error) {
      return pending(`local provenance publication receipt read failed: ${errorMessage(error)}`);
    }
    if (existing) {
      return {
        id: row.id,
        status: 'published',
        publication_id: existing.publication_id,
        published_at: existing.published_at,
      };
    }
    if (!deps.provenancePublisher) {
      return pending('idempotent provenance publisher unavailable');
    }

    let published: EditorRecoveryPublicationResult;
    try {
      published = await deps.provenancePublisher.publish(Object.freeze({
        outboxId: row.id,
        provenanceRecordId: row.provenance_record_id,
        sessionId: row.successor_session_id,
        eventType: row.event_type,
        payload: row.payload_json,
        idempotencyKey: row.idempotency_key,
      }));
    } catch (error) {
      published = {
        success: false,
        error: error instanceof Error ? error.message : 'the idempotent provenance publisher threw an unknown error',
      };
    }
    if (!published.success || !isNonEmptyString(published.publicationId)) {
      const error = published.error ?? 'the idempotent provenance publisher did not return a stable publication ID';
      try {
        deps.provenanceAttemptPersistenceHook?.();
        insertProvenanceAttempt.run(row.id, now(), error);
        return pending(error);
      } catch (attemptError) {
        return pending(`${error}; append-only attempt evidence persistence failed: ${errorMessage(attemptError)}`);
      }
    }

    let receipt: ProvenancePublicationRow;
    try {
      const recordPublication = db.transaction((): ProvenancePublicationRow => {
        const already = getProvenancePublication.get(row.id) as ProvenancePublicationRow | undefined;
        if (already) return already;
        deps.provenancePublicationReceiptPersistenceHook?.();
        insertProvenancePublication.run(row.id, published.publicationId!, now());
        const persisted = getProvenancePublication.get(row.id) as ProvenancePublicationRow | undefined;
        if (!persisted) throw new Error('editor recovery provenance publication receipt was not persisted');
        return persisted;
      });
      receipt = recordPublication.immediate();
    } catch (receiptError) {
      const reason = `provenance sink accepted the idempotency key but local publication receipt persistence failed: ${errorMessage(receiptError)}`;
      try {
        deps.provenanceAttemptPersistenceHook?.();
        insertProvenanceAttempt.run(row.id, now(), reason);
        return pending(reason, { sink_publication_id: published.publicationId });
      } catch (attemptError) {
        return pending(
          `${reason}; append-only attempt evidence persistence failed: ${errorMessage(attemptError)}`,
          { sink_publication_id: published.publicationId },
        );
      }
    }
    return {
      id: row.id,
      status: 'published',
      publication_id: receipt.publication_id,
      published_at: receipt.published_at,
    };
  }

  /**
   * Retries one bounded batch of durably pending provenance projections using
   * stable keys. The purpose is to let a daemon-owned sink drain the outbox
   * without weakening canonical recovery or inventing at-least-once note writes.
   *
   * @returns aggregate count and per-row delivery truth
   */
  async function publishPendingProvenance(
    limit = DEFAULT_PROVENANCE_DRAIN_BATCH_SIZE,
  ): Promise<Record<string, unknown>> {
    const boundedLimit = Number.isSafeInteger(limit)
      ? Math.max(1, Math.min(100, limit))
      : DEFAULT_PROVENANCE_DRAIN_BATCH_SIZE;
    const pending = listPendingProvenanceOutbox.all(boundedLimit) as ProvenanceOutboxRow[];
    const deliveries: Record<string, unknown>[] = [];
    for (const row of pending) deliveries.push(await publishProvenanceOutboxRow(row.id));
    return {
      success: true,
      attempted: pending.length,
      published: deliveries.filter(delivery => delivery.status === 'published').length,
      pending: deliveries.filter(delivery => delivery.status !== 'published').length,
      deliveries,
    };
  }

  const provenanceDrainBatchSize = Number.isSafeInteger(deps.provenanceDrainBatchSize)
    ? Math.max(1, Math.min(100, deps.provenanceDrainBatchSize!))
    : DEFAULT_PROVENANCE_DRAIN_BATCH_SIZE;
  const provenanceDrainIntervalMs = Number.isSafeInteger(deps.provenanceDrainIntervalMs)
    ? Math.max(1_000, deps.provenanceDrainIntervalMs!)
    : DEFAULT_PROVENANCE_DRAIN_INTERVAL_MS;
  let provenanceDrainDisposed = false;
  let provenanceDrainInFlight: Promise<void> | null = null;
  let provenanceDrainLastError: string | null = null;
  let periodicProvenanceDrain: { dispose(): void } | null = null;

  /**
   * Executes one bounded, single-flight drain pass. Scheduled failures remain
   * observable through `getProvenanceDrainStatus`; individual sink failures
   * remain durable pending rows with append-only attempt evidence.
   *
   * @returns after the current or joined drain pass has finished
   */
  async function runProvenanceDrain(): Promise<void> {
    if (!deps.provenancePublisher || provenanceDrainDisposed) return;
    if (provenanceDrainInFlight) return provenanceDrainInFlight;
    provenanceDrainInFlight = (async () => {
      try {
        await publishPendingProvenance(provenanceDrainBatchSize);
        provenanceDrainLastError = null;
      } catch (error) {
        provenanceDrainLastError = error instanceof Error ? error.message : 'the provenance drain failed unexpectedly';
      }
    })().finally(() => {
      provenanceDrainInFlight = null;
    });
    return provenanceDrainInFlight;
  }

  if (deps.provenancePublisher && deps.provenanceDrainScheduler) {
    deps.provenanceDrainScheduler.scheduleStartup(runProvenanceDrain);
    periodicProvenanceDrain = deps.provenanceDrainScheduler.schedulePeriodic(
      runProvenanceDrain,
      provenanceDrainIntervalMs,
    );
  }

  /**
   * Returns process-local liveness truth for the bounded committed-outbox
   * drain without claiming that a missing publisher projected any row.
   *
   * @returns publisher, scheduler, and most recent unexpected drain state
   */
  function getProvenanceDrainStatus(): Record<string, unknown> {
    return {
      publisher_available: !!deps.provenancePublisher,
      scheduled: !!deps.provenancePublisher && !!deps.provenanceDrainScheduler && !provenanceDrainDisposed,
      running: provenanceDrainInFlight !== null,
      batch_size: provenanceDrainBatchSize,
      interval_ms: provenanceDrainIntervalMs,
      last_error: provenanceDrainLastError,
    };
  }

  /**
   * Stops future drains and joins a pass already using this service's database.
   * The design purpose is to let route shutdown own timer and database lifetime
   * without closing SQLite under an in-flight restart repair.
   *
   * @returns after the periodic handle is disposed and any active pass finishes
   */
  async function dispose(): Promise<void> {
    provenanceDrainDisposed = true;
    try {
      periodicProvenanceDrain?.dispose();
    } catch (error) {
      provenanceDrainLastError = error instanceof Error ? error.message : 'the provenance scheduler could not be disposed';
    }
    periodicProvenanceDrain = null;
    if (provenanceDrainInFlight) await provenanceDrainInFlight;
  }

  async function finalizeRecovery(input: FinalizeEditorRecoveryInput): Promise<Result<Record<string, unknown>>> {
    const unavailable = requiredPublicAuthorities();
    if (unavailable) return unavailable;
    const token = validateTokenRow(input.token);
    if (isFailure(token)) return token;
    const preparation = getPreparation.get(input.preparationId) as PreparationRow | undefined;
    if (!preparation || preparation.token !== token.token) return failure(404, 'EDITOR_REPLAY_PREPARATION_NOT_FOUND', 'the replay preparation does not belong to this editor token');
    if (preparation.successor_session_id !== input.successorSessionId || preparation.prepared_by_actor_id !== input.finalizedByActorId) {
      return failure(403, 'EDITOR_REPLAY_PREPARATION_ACTOR_MISMATCH', 'the verified successor does not own this replay preparation');
    }
    if (preparation.finalized_at !== null) return failure(409, 'EDITOR_RECOVERY_ALREADY_FINALIZED', 'this replay was already finalized');
    if (preparation.provenance_record_id !== null) {
      return failure(409, 'EDITOR_RECOVERY_PROVENANCE_STALE', 'an unfinalized preparation cannot already own canonical provenance');
    }
    const replayReceipt = getReplayReceipt.get(preparation.id) as ReplayReceiptRow | undefined;
    if (!replayReceipt) return failure(409, 'EDITOR_REPLAY_RECEIPT_REQUIRED', 'canonical replay must succeed before any token, claim, or provenance effect');
    const abandonment = getAbandonmentById.get(preparation.abandonment_id) as AbandonmentRow | undefined;
    if (!abandonment) return failure(409, 'EDITOR_ABANDONMENT_NOT_SEALED', 'the terminal abandonment receipt is missing');
    const evidence = verifySealedEvidence(abandonment);
    if (isFailure(evidence)) return evidence;
    const verifiedReplay = verifyReplayReceipt(replayReceipt, abandonment, evidence);
    if (isFailure(verifiedReplay)) return verifiedReplay;
    const dead = scopeFromAbandonment(abandonment);
    if (isFailure(dead)) return dead;
    const acting = resolveActingScope(input.successorSessionId, input.finalizedByActorId, dead);
    if (isFailure(acting)) return acting;
    const before = canonicalFile(dead, abandonment.canonical_path, deps.pathVerificationHook ?? undefined);
    if (isFailure(before)) return before;
    if (!sameFile(abandonment, before) || before.contentHash !== preparation.file_content_hash) {
      return failure(409, 'EDITOR_RECOVERY_FILE_DRIFT', 'the authoritative file changed before claim transfer');
    }
    const claim = verifySealedClaim(abandonment, dead, before);
    if (isFailure(claim)) return claim;
    const symbolWitness = await resolveSymbolResolutionWitness(Object.freeze({
      canonicalPath: before.canonicalPath,
      fileContentHash: before.contentHash,
      symbolPath: claim.symbolPath,
    }));
    if (isFailure(symbolWitness)) return symbolWitness;

    let finalizationFile: CanonicalFileHandle | null = null;
    let finalizationSymbolLease: EditorSymbolResolutionLease | null = null;
    let finalizationMutationLease: EditorFileMutationLease | null = null;
    let transactionCommitted = false;
    const transaction = db.transaction((): Record<string, unknown> => {
      const liveUnavailable = requiredPublicAuthorities();
      if (liveUnavailable) throw new EditorRecoveryAbort(liveUnavailable);
      const liveToken = validateTokenRow(input.token);
      if (isFailure(liveToken)) throw new EditorRecoveryAbort(liveToken);
      const livePreparation = getPreparation.get(input.preparationId) as PreparationRow | undefined;
      if (!livePreparation || livePreparation.token !== liveToken.token) {
        throw new EditorRecoveryAbort(failure(404, 'EDITOR_REPLAY_PREPARATION_NOT_FOUND', 'the replay preparation does not belong to this editor token'));
      }
      if (
        livePreparation.successor_session_id !== input.successorSessionId
        || livePreparation.prepared_by_actor_id !== input.finalizedByActorId
      ) {
        throw new EditorRecoveryAbort(failure(403, 'EDITOR_REPLAY_PREPARATION_ACTOR_MISMATCH', 'the verified successor does not own this replay preparation'));
      }
      if (livePreparation.finalized_at !== null) {
        throw new EditorRecoveryAbort(failure(409, 'EDITOR_RECOVERY_ALREADY_FINALIZED', 'this replay was finalized concurrently'));
      }
      if (livePreparation.provenance_record_id !== null) {
        throw new EditorRecoveryAbort(failure(409, 'EDITOR_RECOVERY_PROVENANCE_STALE', 'canonical provenance exists without a finalized preparation'));
      }
      const liveAbandonment = getAbandonmentById.get(livePreparation.abandonment_id) as AbandonmentRow | undefined;
      if (!liveAbandonment || liveAbandonment.id !== liveToken.abandonment_id) {
        throw new EditorRecoveryAbort(failure(409, 'EDITOR_ABANDONMENT_NOT_SEALED', 'the terminal abandonment receipt is missing'));
      }
      const liveDead = scopeFromAbandonment(liveAbandonment);
      if (isFailure(liveDead)) throw new EditorRecoveryAbort(liveDead);
      const liveActing = resolveActingScope(input.successorSessionId, input.finalizedByActorId, liveDead);
      if (isFailure(liveActing)) throw new EditorRecoveryAbort(liveActing);
      const liveFile = openCanonicalFileHandle(liveDead, liveAbandonment.canonical_path, deps.pathVerificationHook ?? undefined);
      if (isFailure(liveFile)) throw new EditorRecoveryAbort(liveFile);
      finalizationFile = liveFile;
      if (!sameFile(liveAbandonment, liveFile) || liveFile.contentHash !== livePreparation.file_content_hash) {
        throw new EditorRecoveryAbort(failure(409, 'EDITOR_RECOVERY_FILE_DRIFT', 'the authoritative file changed before the atomic claim transfer'));
      }
      const liveEvidence = verifySealedEvidence(liveAbandonment);
      if (isFailure(liveEvidence)) throw new EditorRecoveryAbort(liveEvidence);
      const releasedClaim = verifySealedClaim(liveAbandonment, liveDead, liveFile);
      if (isFailure(releasedClaim)) throw new EditorRecoveryAbort(releasedClaim);
      const liveReplay = getReplayReceipt.get(livePreparation.id) as ReplayReceiptRow | undefined;
      if (!liveReplay) {
        throw new EditorRecoveryAbort(failure(409, 'EDITOR_REPLAY_RECEIPT_REQUIRED', 'the canonical replay receipt disappeared before finalization'));
      }
      const currentReplay = verifyReplayReceipt(liveReplay, liveAbandonment, liveEvidence);
      if (isFailure(currentReplay)) throw new EditorRecoveryAbort(currentReplay);
      const acquiredSymbolLease = acquireSymbolResolutionLease(symbolWitness, liveFile, releasedClaim.symbolPath);
      if (isFailure(acquiredSymbolLease)) throw new EditorRecoveryAbort(acquiredSymbolLease);
      finalizationSymbolLease = acquiredSymbolLease;
      const liveSymbol = validateResolvedSymbol(liveAbandonment, acquiredSymbolLease.matches, livePreparation);
      if (isFailure(liveSymbol)) throw new EditorRecoveryAbort(liveSymbol);
      const acquiredMutationLease = acquireFileMutationLease(Object.freeze({
        successorSessionId: liveActing.sessionId,
        successorActorId: liveActing.actorId,
        project: liveDead.project,
        harbor: liveDead.harbor,
        worktreeId: liveDead.worktreeId,
        worktreeRoot: liveFile.worktreeRoot,
        worktreeRootDevice: liveFile.worktreeRootDevice,
        worktreeRootInode: liveFile.worktreeRootInode,
        canonicalPath: liveFile.canonicalPath,
        canonicalDevice: liveFile.device,
        canonicalInode: liveFile.inode,
        contentHash: liveFile.contentHash,
      }));
      if (isFailure(acquiredMutationLease)) throw new EditorRecoveryAbort(acquiredMutationLease);
      finalizationMutationLease = acquiredMutationLease;

      const claimed = deps.claimTransferAuthority!.transferReleasedClaim(db, Object.freeze({
        releasedClaimId: releasedClaim.claimId,
        abandonmentReceiptId: liveAbandonment.id,
        deadSessionId: liveDead.sessionId,
        deadAgentId: liveDead.agentId,
        deadActorId: liveDead.actorId,
        successorSessionId: liveActing.sessionId,
        successorAgentId: liveActing.agentId,
        successorActorId: liveActing.actorId,
        project: liveDead.project,
        harbor: liveDead.harbor,
        worktreeId: liveDead.worktreeId,
        worktreeRoot: liveFile.worktreeRoot,
        worktreeRootDevice: liveFile.worktreeRootDevice,
        worktreeRootInode: liveFile.worktreeRootInode,
        canonicalPath: liveFile.canonicalPath,
        canonicalDevice: liveFile.device,
        canonicalInode: liveFile.inode,
        canonicalContentHash: liveFile.contentHash,
        symbolParserGeneration: acquiredSymbolLease.witness.parserGeneration,
        symbolAuthorityGeneration: acquiredSymbolLease.witness.authorityGeneration,
        fileMutationLeaseId: acquiredMutationLease.leaseId,
        fileMutationGeneration: acquiredMutationLease.generation,
        resolvedSymbol: Object.freeze({ ...liveSymbol }),
      }));
      if (!claimed.success || !claimed.stableClaimId) {
        throw new EditorRecoveryAbort(failure(409, 'EDITOR_RECOVERY_CLAIM_CONFLICT', claimed.error ?? 'the released symbol claim could not be transferred', claimed.conflicts));
      }
      const operationIds = liveEvidence.operations.map(row => row.id);
      const finalizedAt = now();
      const provenancePayload = JSON.stringify({
        v: 2,
        kind: 'harbor.editor.recovery.provenance',
        abandonment_receipt_id: liveAbandonment.id,
        replay_validation_receipt_id: currentReplay.id,
        operation_receipt_ids: operationIds,
        dead: {
          session_id: liveDead.sessionId,
          actor_id: liveDead.actorId,
          peer_id: liveAbandonment.peer_id,
          high_water_sequence: liveAbandonment.high_water_sequence,
        },
        successor: { session_id: liveActing.sessionId, actor_id: liveActing.actorId },
        scope: {
          project: liveAbandonment.project,
          harbor: liveAbandonment.harbor,
          worktree_id: liveAbandonment.worktree_id,
          worktree_root: liveAbandonment.worktree_root,
          worktree_root_device: liveAbandonment.worktree_root_device,
          worktree_root_inode: liveAbandonment.worktree_root_inode,
          canonical_path: liveAbandonment.canonical_path,
          canonical_device: liveAbandonment.file_device,
          canonical_inode: liveAbandonment.file_inode,
          canonical_content_hash: liveFile.contentHash,
        },
        claim: liveSymbol,
        stable_claim_id: claimed.stableClaimId,
        symbol_authority: {
          parser_generation: acquiredSymbolLease.witness.parserGeneration,
          authority_generation: acquiredSymbolLease.witness.authorityGeneration,
        },
        file_mutation_authority: {
          lease_id: acquiredMutationLease.leaseId,
          generation: acquiredMutationLease.generation,
        },
        finalized_at: finalizedAt,
      });
      const insertedProvenance = insertProvenance.run(
        livePreparation.id,
        liveActing.sessionId,
        provenancePayload,
        finalizedAt,
      );
      const provenanceId = Number(insertedProvenance.lastInsertRowid);
      const provenance = getProvenance.get(provenanceId) as ProvenanceRow | undefined;
      if (!provenance) throw new Error('canonical editor recovery provenance was not readable in its transaction');
      const idempotencyKey = `harbor.editor.recovery.provenance:${livePreparation.id}`;
      const insertedOutbox = insertProvenanceOutbox.run(
        provenance.id,
        liveActing.sessionId,
        provenance.payload_json,
        idempotencyKey,
        finalizedAt,
      );
      const outboxId = Number(insertedOutbox.lastInsertRowid);
      const outbox = getProvenanceOutbox.get(outboxId) as ProvenanceOutboxRow | undefined;
      if (!outbox) throw new Error('editor recovery provenance outbox row was not readable in its transaction');
      if (consumeToken.run(finalizedAt, liveActing.actorId, liveActing.sessionId, liveToken.token, finalizedAt).changes !== 1) {
        throw new EditorRecoveryAbort(failure(409, 'EDITOR_RECOVERY_ALREADY_FINALIZED', 'the editor recovery capability was finalized concurrently'));
      }
      if (finalizePreparation.run(finalizedAt, provenance.id, livePreparation.id).changes !== 1) {
        throw new Error('editor replay preparation did not finalize exactly once');
      }
      deps.finalizationMutationHook?.();
      const finalIdentityFailure = verifyCanonicalFileHandle(liveFile, liveDead);
      if (finalIdentityFailure) throw new EditorRecoveryAbort(finalIdentityFailure);
      if (!sameFile(liveAbandonment, liveFile) || liveFile.contentHash !== livePreparation.file_content_hash) {
        throw new EditorRecoveryAbort(failure(409, 'EDITOR_RECOVERY_FILE_DRIFT', 'the retained descriptor identity changed before the finalization transaction could commit'));
      }
      deps.afterFinalDescriptorCheckHook?.();
      const symbolLeaseFailure = validateSymbolResolutionLease(acquiredSymbolLease);
      if (symbolLeaseFailure) throw new EditorRecoveryAbort(symbolLeaseFailure);
      const mutationLeaseFailure = validateFileMutationLease(acquiredMutationLease);
      if (mutationLeaseFailure) throw new EditorRecoveryAbort(mutationLeaseFailure);
      const consumedMutationLease = acquiredMutationLease.consume(db, Object.freeze({
        stableClaimId: claimed.stableClaimId,
        successorSessionId: liveActing.sessionId,
        worktreeId: liveDead.worktreeId,
        worktreeRoot: liveFile.worktreeRoot,
        worktreeRootDevice: liveFile.worktreeRootDevice,
        worktreeRootInode: liveFile.worktreeRootInode,
        canonicalPath: liveFile.canonicalPath,
        canonicalDevice: liveFile.device,
        canonicalInode: liveFile.inode,
        canonicalContentHash: liveFile.contentHash,
      }));
      if (!consumedMutationLease.success) {
        throw new EditorRecoveryAbort(failure(409, 'EDITOR_FILE_MUTATION_AUTHORITY_DRIFT', consumedMutationLease.error ?? 'the daemon file-mutation generation could not be consumed with the transferred claim'));
      }
      return {
        success: true,
        finalized_at: finalizedAt,
        provenance_record_id: provenance.id,
        provenance_outbox_id: outbox.id,
        replay_validation_receipt_id: currentReplay.id,
        recovery: recoverySummary(liveAbandonment),
        inherited_by: { actor_id: liveActing.actorId, session_id: liveActing.sessionId },
        claim: { ...liveSymbol, stable_claim_id: claimed.stableClaimId },
      };
    });
    let committed: Record<string, unknown> | null = null;
    let aborted: EditorRecoveryFailure | null = null;
    const cleanupDiagnostics: EditorRecoveryCleanupDiagnostic[] = [];
    try {
      committed = transaction.immediate();
      transactionCommitted = true;
    } catch (error) {
      if (error instanceof EditorRecoveryAbort) aborted = error.failure;
      else throw error;
    } finally {
      try {
        if (finalizationFile) closeCanonicalFileHandle(finalizationFile);
      } catch (error) {
        recordCleanupDiagnostic(cleanupDiagnostics, 'finalize_file_close', error);
      }
      try {
        (finalizationSymbolLease as EditorSymbolResolutionLease | null)?.release();
      } catch (error) {
        recordCleanupDiagnostic(cleanupDiagnostics, 'finalize_symbol_release', error);
      }
      try {
        (finalizationMutationLease as EditorFileMutationLease | null)?.release({ committed: transactionCommitted });
      } catch (error) {
        recordCleanupDiagnostic(cleanupDiagnostics, 'finalize_mutation_release', error);
      }
    }
    if (aborted) return aborted;
    if (!committed) throw new Error('editor recovery finalization returned without a committed result');
    const outboxId = committed.provenance_outbox_id;
    if (typeof outboxId !== 'number') throw new Error('committed editor recovery did not return its provenance outbox ID');
    const response = { ...committed };
    delete response.provenance_outbox_id;
    let provenanceOutbox: Record<string, unknown>;
    try {
      provenanceOutbox = await publishProvenanceOutboxRow(outboxId);
    } catch (error) {
      provenanceOutbox = {
        id: outboxId,
        status: 'pending',
        reason: `post-commit provenance projection failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    return {
      ...response,
      ...(cleanupDiagnostics.length > 0 ? { cleanup_diagnostics: cleanupDiagnostics } : {}),
      provenance_outbox: provenanceOutbox,
    };
  }

  function recoverySummary(row: AbandonmentRow): Record<string, unknown> {
    return {
      kind: 'editor_replica',
      status: 'recoverable',
      file_path: row.canonical_path,
      dead_replica: {
        session_id: row.session_id,
        agent_id: row.author_agent_id,
        actor_id: row.author_actor_id,
        peer_id: row.peer_id,
      },
      scope: {
        project: row.project,
        harbor: row.harbor,
        worktree_id: row.worktree_id,
        worktree_root: row.worktree_root,
        worktree_root_device: row.worktree_root_device,
        worktree_root_inode: row.worktree_root_inode,
      },
      evidence: {
        abandonment_receipt_id: row.id,
        abandonment_validator_id: row.validator_id,
        operation_count: row.operation_count,
        high_water_sequence: row.high_water_sequence,
        high_water_hash: row.high_water_hash,
      },
      limitation: 'complete operation log from sequence zero only',
    };
  }

  function preparedResponse(
    preparation: PreparationRow,
    abandonment: AbandonmentRow,
    operations: OperationRow[],
  ): Record<string, unknown> {
    return {
      success: true,
      preparation_id: preparation.id,
      prepared_at: preparation.prepared_at,
      recovery: recoverySummary(abandonment),
      replay: {
        peer_id: abandonment.peer_id,
        high_water_sequence: abandonment.high_water_sequence,
        operations: operations.map(operation => ({
          receipt_id: operation.id,
          sequence: operation.sequence,
          operation_hash: operation.operation_hash,
          bytes_base64: operation.operation_bytes.toString('base64'),
        })),
      },
    };
  }

  function replayReceiptResponse(row: ReplayReceiptRow): Record<string, unknown> {
    return {
      success: true,
      replay_validation: {
        receipt_id: row.id,
        preparation_id: row.preparation_id,
        validator_id: row.validator_id,
        operation_digest: row.operation_digest,
        final_state_hash: row.final_state_hash,
        high_water_sequence: row.high_water_sequence,
        operation_count: row.operation_count,
        validated_at: row.validated_at,
      },
    };
  }

  return {
    recordOperationReceipt,
    sealAbandonment,
    requestEvidence,
    prepareForReplay,
    validatePreparedReplay,
    finalizeRecovery,
    publishPendingProvenance,
    runProvenanceDrain,
    getProvenanceDrainStatus,
    dispose,
    isEditorToken(token: string): boolean {
      return token.startsWith(EDITOR_TOKEN_PREFIX) && !!getToken.get(token);
    },
  };
}

export type EditorRecovery = ReturnType<typeof createEditorRecovery>;
