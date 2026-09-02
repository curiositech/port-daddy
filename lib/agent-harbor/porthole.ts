/**
 * Porthole — universal first-person evidence storage.
 *
 * Porthole records what an operator or embodied agent could actually observe:
 * window pixels, terminal bytes, accessibility/DOM/editor annotations, input
 * receipts, and explicit gaps. It does not infer or claim hidden reasoning.
 *
 * The metadata ledger is append-only and independently hash-chained per
 * perspective. Segment payloads are sealed before they enter a dedicated blob
 * store excluded from generic GC, using the pd-vault parity-gated
 * XChaCha20-Poly1305 implementation. Shared GC pinning is not implemented. The
 * default key source is one random harbor secret held in the OS keychain; a
 * daemon without a keystore fails closed rather than writing plaintext.
 */

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { closeSync, fsyncSync, openSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseInstance } from '../sqlite-runtime.js';
import type { BlobStore } from '../blob.js';
import { keychain, KEYCHAIN_SERVICE } from '../keychain.js';
import {
  NONCE_LEN,
  TAG_LEN,
  referenceVault,
  type SealAad,
  type VaultSealProvider,
} from '../pd-vault-ts.js';

export const PORTHOLE_PERSPECTIVE_SCHEMA = 'pd.porthole.perspective.v1' as const;
export const PORTHOLE_RECEIPT_SCHEMA = 'pd.porthole.completeness-receipt.v1' as const;
export const PORTHOLE_ENCRYPTION_SUITE = 'pd-vault-xchacha20-poly1305-v1' as const;
export const PORTHOLE_KEY_EPOCH = 1;
export const PORTHOLE_MAX_SEGMENT_BYTES = 16 * 1024 * 1024;

export type PortholePerspectiveKind =
  | 'terminal'
  | 'browser'
  | 'native-app'
  | 'cooperative-editor'
  | 'mobile'
  | 'cloud-workspace'
  | 'custom';

export type PortholeCaptureModality =
  | 'visual'
  | 'terminal'
  | 'dom'
  | 'accessibility'
  | 'editor-ops'
  | 'input'
  | 'audio'
  | 'control';

export interface PortholeCaptureSchedule {
  scheduleId: string;
  mode: 'fixed-interval';
  samplingIntervalMs: number;
  boundary: {
    kind: 'fixed-duration';
    durationMs: number;
    terminalEventKind: null;
  };
  committedAt: string;
  commitmentHash: string;
}

export interface PortholePerspective {
  schema: typeof PORTHOLE_PERSPECTIVE_SCHEMA;
  perspectiveId: string;
  stageId: string;
  streamId: string;
  harborId: string;
  participantId: string;
  actor: {
    kind: 'person' | 'agent';
    role: 'operator' | 'collaborator' | 'observer';
    personId: string | null;
  };
  agentNodeId: string | null;
  bodyId: string;
  sessionId: string;
  runId: string | null;
  surface: {
    surfaceId: string;
    kind: PortholePerspectiveKind;
    descriptor: {
      state: 'sealed';
      envelopeRef: string;
      commitment: string;
    };
  };
  capture: {
    adapter: string;
    adapterVersion: string | null;
    modalities: PortholeCaptureModality[];
    sourceClock: 'monotonic' | 'wall' | 'provider' | 'mixed';
    visibleIndicator: true;
  };
  captureSchedule: PortholeCaptureSchedule;
  privacy: {
    scope: 'device-only';
    redaction: 'adapter' | 'daemon' | 'quarantined';
    semanticPayload: 'encrypted' | 'scrubbed' | 'omitted';
    hiddenReasoningCaptured: false;
  };
  encryption: {
    suite: typeof PORTHOLE_ENCRYPTION_SUITE;
    channelId: string;
    epoch: number;
    keyCustody: 'os-keychain' | 'in-memory-test';
  };
  startedAt: string;
  retention: {
    unitType: 'perspective-channel';
    unitId: string;
    channelId: string;
    policyId: string;
    deleteAsUnit: true;
  };
  parentPerspectiveId: string | null;
}

export interface StartPerspectiveInput {
  perspectiveId?: string;
  stageId: string;
  streamId: string;
  harborId: string;
  participantId: string;
  actor: PortholePerspective['actor'];
  agentNodeId?: string | null;
  bodyId: string;
  sessionId: string;
  runId?: string | null;
  surface: PortholePerspective['surface'];
  capture: PortholePerspective['capture'] & { visibleIndicator: true };
  captureSchedule: PortholeCaptureSchedule;
  privacy?: Partial<PortholePerspective['privacy']>;
  startedAt?: string;
  retentionPolicyId?: string;
  parentPerspectiveId?: string | null;
}

export interface PortholeSegmentEnvelope {
  schema: 'pd.porthole.segment.v1';
  perspectiveId: string;
  captureIndex: number;
  capturedAt: string;
  endedAt: string | null;
  mediaType: string;
  mediaBase64: string;
  semanticOverlay: Record<string, unknown> | null;
  viewport: Record<string, unknown> | null;
  sourceRef: Record<string, unknown> | null;
  privacyReceipt: PortholePrivacyReceipt;
}

export interface PortholePrivacyReceipt {
  receiptId: string;
  policyId: string;
  pipelineVersion: string;
  targetScope: 'exact-target';
  backgroundDisposition: 'excluded';
  secretScan: 'passed' | 'quarantined';
  redactionDisposition: 'scrubbed' | 'quarantined';
  binding: {
    harborId: string;
    bodyId: string;
    stageId: string;
    perspectiveId: string;
    streamId: string;
    surfaceId: string;
    surfaceDescriptorCommitment: string;
    captureIndex: number;
    sanitizedContentHash: string;
  };
  issuer: {
    participantId: string;
    keyId: string;
  };
  contentHash: string;
  signature: {
    algorithm: 'ed25519';
    keyId: string;
    value: string;
  };
}

/**
 * Self-describing encrypted blob. Keeping the nonce and authenticated routing
 * coordinates beside the ciphertext makes a crash between blob durability and
 * ledger append recoverable without exposing any plaintext descriptor.
 */
export interface PortholeCiphertextEnvelope {
  schema: 'pd.porthole.ciphertext-envelope.v1';
  perspectiveId: string;
  captureIndex: number;
  encryptionSuite: typeof PORTHOLE_ENCRYPTION_SUITE;
  aad: SealAad;
  nonceBase64url: string;
  ciphertextBase64: string;
}

export interface PortholeSealingAadExpectation {
  perspectiveId: string;
  captureIndex: number;
  harborId: string;
  channelId: string;
  epoch: number;
}

export interface AppendSegmentInput {
  captureIndex: number;
  capturedAt: string;
  endedAt?: string | null;
  mediaType: string;
  bytes: Buffer;
  semanticOverlay?: Record<string, unknown> | null;
  viewport?: Record<string, unknown> | null;
  sourceRef?: Record<string, unknown> | null;
  privacyReceipt: PortholePrivacyReceipt;
}

export type PortholePrivacySubjectInput = Pick<
  AppendSegmentInput,
  | 'captureIndex'
  | 'capturedAt'
  | 'endedAt'
  | 'mediaType'
  | 'bytes'
  | 'semanticOverlay'
  | 'viewport'
  | 'sourceRef'
>;

export interface AppendGapInput {
  captureIndex: number;
  occurredAt?: string;
  durationMs?: number | null;
  reason:
    | 'permission-denied'
    | 'window-hidden'
    | 'window-gone'
    | 'recorder-suspended'
    | 'adapter-error'
    | 'redacted'
    | 'unknown';
  detail?: string | null;
}

export interface CompletePerspectiveInput {
  stopReason:
    | 'operator'
    | 'body-stopped'
    | 'session-ended'
    | 'permission-revoked'
    | 'adapter-failed'
    | 'retention-limit'
    | 'unknown';
  closedAt?: string;
}

export interface PortholeCompletenessReceipt {
  schema: typeof PORTHOLE_RECEIPT_SCHEMA;
  receiptId: string;
  perspectiveId: string;
  stageId: string;
  schedule: {
    scheduleId: string;
    commitmentHash: string;
  };
  streamBoundary: {
    streamId: string;
    channelId: string;
    firstCaptureIndex: number | null;
    lastCaptureIndex: number | null;
    openedAt: string;
    closedAt: string;
    terminalEventId: string;
    terminalEventCommitment: string;
  };
  status: 'complete' | 'partial' | 'failed';
  expectedCaptureCount: number;
  recordedSegmentCount: number;
  verifiedSegmentCount: number;
  unreadableSegmentCount: number;
  declaredGapCount: number;
  missingCaptureCount: number;
  chainHeadHash: string;
  encryptionSuite: typeof PORTHOLE_ENCRYPTION_SUITE;
  stopReason: CompletePerspectiveInput['stopReason'];
  issuer: {
    harborId: string;
    bodyId: string;
    participantId: string;
    signingKeyId: string;
  };
  contentHash: string;
  signature: {
    algorithm: 'ed25519';
    keyId: string;
    value: string;
  };
  issuedAt: string;
}

export interface PortholeEvent {
  eventSeq: number;
  eventId: string;
  perspectiveId: string;
  ordinal: number;
  kind:
    | 'perspective-started'
    | 'segment-recorded'
    | 'capture-gap'
    | 'perspective-completed'
    | 'completeness-receipt-issued';
  occurredAt: string;
  payload: Record<string, unknown>;
  contentHash: string;
  prevHash: string | null;
}

interface PortholeEventRow {
  event_seq: number;
  event_id: string;
  perspective_id: string;
  ordinal: number;
  kind: PortholeEvent['kind'];
  occurred_at: string;
  payload_json: string;
  content_hash: string;
  prev_hash: string | null;
}

export interface PortholeSecret {
  secret: Buffer;
  keyCustody: 'os-keychain' | 'in-memory-test';
}

export interface PortholeSecretProvider {
  getHarborSecret(harborId: string): PortholeSecret;
}

/**
 * Verification-only boundary for every Porthole Ed25519 receipt.
 *
 * Product wiring must adapt the repository's verified Rust security authority
 * at this boundary. The evidence store deliberately has no key lookup or
 * signature implementation of its own, and a signer is never allowed to
 * certify its own output.
 */
export interface PortholeVerifiedSignatureAuthority {
  verifyPrivacy(
    context: {
      harborId: string;
      bodyId: string;
      participantId: string;
      stageId: string;
      perspectiveId: string;
      streamId: string;
      surfaceId: string;
      surfaceDescriptorCommitment: string;
      captureIndex: number;
      sanitizedContentHash: string;
      receiptId: string;
      policyId: string;
      pipelineVersion: string;
      targetScope: 'exact-target';
      backgroundDisposition: 'excluded';
      secretScan: 'passed' | 'quarantined';
      redactionDisposition: 'scrubbed' | 'quarantined';
      contentHash: string;
      claimedKeyId: string;
    },
    message: Buffer,
    signature: Buffer,
  ): boolean;
  verifyCompleteness(
    context: {
      harborId: string;
      bodyId: string;
      participantId: string;
      stageId: string;
      perspectiveId: string;
      streamId: string;
      contentHash: string;
      claimedKeyId: string;
    },
    message: Buffer,
    signature: Buffer,
  ): boolean;
}

/** Signing-only authority for terminal completeness receipts. */
export interface PortholeReceiptSigner {
  readonly signingKeyId: string;
  sign(
    context: {
      harborId: string;
      bodyId: string;
      participantId: string;
      stageId: string;
      perspectiveId: string;
      streamId: string;
      contentHash: string;
    },
    message: Buffer,
  ): Buffer;
}

export interface PortholeEvidenceIssue {
  captureIndex: number;
  code: 'ciphertext-missing' | 'ciphertext-invalid' | 'privacy-quarantined';
}

export interface PortholeEvidenceVerification {
  valid: boolean;
  chronologyValid: boolean;
  chain: { valid: boolean; checked: number; error?: string };
  checkedSegmentCount: number;
  missingCiphertextCount: number;
  invalidCiphertextCount: number;
  quarantinedSegmentCount: number;
  issues: PortholeEvidenceIssue[];
}

export interface PortholeKeychainAccessor {
  available(): boolean;
  loadSecretResult(service: string, account: string):
    | { status: 'found'; value: string }
    | { status: 'missing' }
    | { status: 'unavailable' }
    | { status: 'error' };
  saveSecretIfAbsent(service: string, account: string, value: string): boolean;
}

export class PortholeError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'PORTHOLE_VALIDATION'
      | 'PORTHOLE_NOT_FOUND'
      | 'PORTHOLE_CONFLICT'
      | 'PORTHOLE_KEYSTORE_UNAVAILABLE'
      | 'PORTHOLE_DECRYPT_FAILED'
      | 'PORTHOLE_DURABILITY',
    readonly statusCode: number,
  ) {
    super(message);
  }
}

const PORTHOLE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS porthole_events (
    event_seq       INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id        TEXT NOT NULL UNIQUE,
    perspective_id  TEXT NOT NULL,
    ordinal         INTEGER NOT NULL,
    kind            TEXT NOT NULL,
    occurred_at     TEXT NOT NULL,
    payload_json    TEXT NOT NULL,
    content_hash    TEXT NOT NULL,
    prev_hash       TEXT,
    UNIQUE(perspective_id, ordinal)
  );

  CREATE INDEX IF NOT EXISTS idx_porthole_events_perspective
    ON porthole_events(perspective_id, ordinal);
  CREATE INDEX IF NOT EXISTS idx_porthole_events_kind
    ON porthole_events(kind, event_seq);

  CREATE TRIGGER IF NOT EXISTS porthole_events_no_update
    BEFORE UPDATE ON porthole_events
    BEGIN SELECT RAISE(ABORT, 'porthole_events is append-only'); END;
  CREATE TRIGGER IF NOT EXISTS porthole_events_no_delete
    BEFORE DELETE ON porthole_events
    BEGIN SELECT RAISE(ABORT, 'porthole_events is append-only'); END;
  -- REPLACE can skip DELETE triggers when recursive_triggers is OFF. Reject
  -- collisions before the replacement runs, covering every unique ledger key.
  -- https://www.sqlite.org/lang_conflict.html
  CREATE TRIGGER IF NOT EXISTS porthole_events_no_replace
    BEFORE INSERT ON porthole_events
    WHEN EXISTS (
      SELECT 1 FROM porthole_events
      WHERE event_seq = NEW.event_seq
         OR event_id = NEW.event_id
         OR (perspective_id = NEW.perspective_id AND ordinal = NEW.ordinal)
    )
    BEGIN SELECT RAISE(ABORT, 'porthole_events is append-only'); END;
`;

/**
 * Purpose: Reject executable or ambiguous object representations so commitments have one deterministic meaning.
 * @param value Candidate value to validate or encode.
 * @param path Diagnostic JSON path for rejection messages.
 * @param ancestors Current traversal ancestors used to reject cycles.
 * @returns Sorted canonical JSON, or a validation error.
 */
function canonicalJson(value: unknown, path = '$', ancestors = new WeakSet<object>()): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new PortholeError(`${path} must contain only finite JSON numbers`, 'PORTHOLE_VALIDATION', 400);
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      throw new PortholeError(`${path} contains a JSON cycle`, 'PORTHOLE_VALIDATION', 400);
    }
    ancestors.add(value);
    const ownKeys = Reflect.ownKeys(value);
    for (const key of ownKeys) {
      if (key === 'length') continue;
      if (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) {
        throw new PortholeError(`${path} contains a non-JSON array property`, 'PORTHOLE_VALIDATION', 400);
      }
    }
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(value, index)) {
        throw new PortholeError(`${path} contains a sparse array slot`, 'PORTHOLE_VALIDATION', 400);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
        throw new PortholeError(`${path}[${index}] must be a JSON data value`, 'PORTHOLE_VALIDATION', 400);
      }
    }
    const encoded = `[${value
      .map((item, index) => canonicalJson(item, `${path}[${index}]`, ancestors))
      .join(',')}]`;
    ancestors.delete(value);
    return encoded;
  }
  if (typeof value !== 'object') {
    throw new PortholeError(`${path} contains a non-JSON value`, 'PORTHOLE_VALIDATION', 400);
  }
  for (let owner: object | null = value; owner !== null; owner = Object.getPrototypeOf(owner)) {
    if (Object.hasOwn(owner, 'toJSON')) {
      throw new PortholeError(`${path} must not define a custom toJSON serializer`, 'PORTHOLE_VALIDATION', 400);
    }
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new PortholeError(`${path} must contain only plain JSON objects`, 'PORTHOLE_VALIDATION', 400);
  }
  if (ancestors.has(value)) {
    throw new PortholeError(`${path} contains a JSON cycle`, 'PORTHOLE_VALIDATION', 400);
  }
  ancestors.add(value);
  const object = value as Record<string, unknown>;
  const ownKeys = Reflect.ownKeys(object);
  if (ownKeys.some((key) => typeof key === 'symbol')) {
    throw new PortholeError(`${path} contains a symbol-keyed property`, 'PORTHOLE_VALIDATION', 400);
  }
  const descriptors = Object.getOwnPropertyDescriptors(object);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new PortholeError(`${path}.${key} must be an enumerable JSON value`, 'PORTHOLE_VALIDATION', 400);
    }
  }
  const encoded = `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key], `${path}.${key}`, ancestors)}`)
    .join(',')}}`;
  ancestors.delete(value);
  return encoded;
}

/**
 * Validates the self-describing ciphertext and its pd-vault authenticated
 * routing before any blob ingestion. The design keeps cryptography in
 * pd-vault: this function checks the exact SealAad coordinates and canonical
 * encodings a caller is about to persist, while the AEAD tag remains the
 * authority for ciphertext authenticity.
 *
 * @param value Candidate envelope produced by the pd-vault sealing boundary.
 * @param expected Ledger and perspective coordinates the envelope must bind.
 * @returns The same envelope after strict, non-coercing validation.
 */
export function validatePortholeCiphertextEnvelope(
  value: unknown,
  expected: PortholeSealingAadExpectation,
): PortholeCiphertextEnvelope {
  /**
   * Purpose: Preserve authenticated identifiers byte-for-byte; trimming would silently change the sealed coordinates.
   * @param input Typed caller input for this operation.
   * @param field Field name used in validation errors.
   * @returns The original nonempty, unpadded string.
   */
  const exactString = (input: unknown, field: string): string => {
    const result = requiredString(input, field);
    if (result !== input) {
      throw new PortholeError(`${field} must use its canonical untrimmed encoding`, 'PORTHOLE_VALIDATION', 400);
    }
    return result;
  };
  canonicalJson(expected, '$.expectedSealingAad');
  if (expected === null || typeof expected !== 'object' || Array.isArray(expected)) {
    throw new PortholeError('expected sealing coordinates must be an object', 'PORTHOLE_VALIDATION', 400);
  }
  exactString(expected.perspectiveId, 'expected.perspectiveId');
  exactString(expected.harborId, 'expected.harborId');
  exactString(expected.channelId, 'expected.channelId');
  validateCaptureIndex(expected.captureIndex);
  if (!Number.isSafeInteger(expected.epoch) || expected.epoch < 1) {
    throw new PortholeError('expected sealing epoch must be a positive integer', 'PORTHOLE_VALIDATION', 400);
  }
  canonicalJson(value, '$.ciphertextEnvelope');
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PortholeError('ciphertext envelope must be an object', 'PORTHOLE_VALIDATION', 400);
  }
  const envelope = value as Record<string, unknown>;
  const envelopeKeys = [
    'aad', 'captureIndex', 'ciphertextBase64', 'encryptionSuite',
    'nonceBase64url', 'perspectiveId', 'schema',
  ].sort();
  if (Object.keys(envelope).sort().join('\0') !== envelopeKeys.join('\0')) {
    throw new PortholeError('ciphertext envelope has unexpected or missing fields', 'PORTHOLE_VALIDATION', 400);
  }
  if (typeof envelope.captureIndex !== 'number') {
    throw new PortholeError('ciphertext envelope routing is invalid', 'PORTHOLE_VALIDATION', 400);
  }
  const captureIndex = validateCaptureIndex(envelope.captureIndex);
  exactString(envelope.perspectiveId, 'perspectiveId');
  if (
    envelope.schema !== 'pd.porthole.ciphertext-envelope.v1' ||
    envelope.encryptionSuite !== PORTHOLE_ENCRYPTION_SUITE ||
    envelope.perspectiveId !== expected.perspectiveId ||
    captureIndex !== validateCaptureIndex(expected.captureIndex)
  ) {
    throw new PortholeError('ciphertext envelope routing is invalid', 'PORTHOLE_VALIDATION', 400);
  }
  if (envelope.aad === null || typeof envelope.aad !== 'object' || Array.isArray(envelope.aad)) {
    throw new PortholeError('ciphertext envelope aad must be an object', 'PORTHOLE_VALIDATION', 400);
  }
  const aad = envelope.aad as Record<string, unknown>;
  exactString(aad.harborId, 'aad.harborId');
  exactString(aad.channelId, 'aad.channelId');
  const aadKeys = ['channelId', 'epoch', 'harborId', 'seq'];
  if (Object.keys(aad).sort().join('\0') !== aadKeys.join('\0')) {
    throw new PortholeError('ciphertext envelope aad has unexpected or missing fields', 'PORTHOLE_VALIDATION', 400);
  }
  if (
    typeof aad.epoch !== 'number' ||
    !Number.isSafeInteger(aad.epoch) ||
    aad.epoch < 1 ||
    aad.harborId !== expected.harborId ||
    aad.channelId !== expected.channelId ||
    aad.epoch !== expected.epoch ||
    aad.seq !== captureIndex
  ) {
    throw new PortholeError('ciphertext envelope authenticated routing is invalid', 'PORTHOLE_VALIDATION', 400);
  }
  const nonceText = exactString(envelope.nonceBase64url, 'nonceBase64url');
  const nonce = Buffer.from(nonceText, 'base64url');
  if (nonce.length !== NONCE_LEN || nonce.toString('base64url') !== nonceText) {
    nonce.fill(0);
    throw new PortholeError('ciphertext envelope nonce encoding is invalid', 'PORTHOLE_VALIDATION', 400);
  }
  nonce.fill(0);
  const ciphertextText = exactString(envelope.ciphertextBase64, 'ciphertextBase64');
  const ciphertext = Buffer.from(ciphertextText, 'base64');
  if (ciphertext.length <= TAG_LEN || ciphertext.toString('base64') !== ciphertextText) {
    ciphertext.fill(0);
    throw new PortholeError('ciphertext envelope ciphertext encoding is invalid', 'PORTHOLE_VALIDATION', 400);
  }
  ciphertext.fill(0);
  return value as PortholeCiphertextEnvelope;
}

/**
 * Purpose: Prefix evidence commitments with their algorithm so they cannot be mistaken for opaque identifiers.
 * @param bytes Exact bytes or text whose representation is committed.
 * @returns A sha256-prefixed lowercase digest.
 */
function sha256(bytes: string | Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

/**
 * Purpose: Use the blob store's raw hexadecimal content-address format, distinct from receipt commitments.
 * @param bytes Exact bytes or text whose representation is committed.
 * @returns A lowercase hexadecimal SHA-256 digest.
 */
function sha256Hex(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Purpose: Reject invalid UTF-8 and alternative JSON encodings before interpreting authenticated evidence.
 * @param bytes Exact bytes or text whose representation is committed.
 * @param field Field name used in validation errors.
 * @returns A plain parsed record whose serialized bytes match exactly.
 */
function parseCanonicalJson(bytes: Buffer, field: string): Record<string, unknown> {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new PortholeError(`${field} is not valid UTF-8`, 'PORTHOLE_DECRYPT_FAILED', 422);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new PortholeError(`${field} is not valid JSON`, 'PORTHOLE_DECRYPT_FAILED', 422);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new PortholeError(`${field} must be a JSON object`, 'PORTHOLE_DECRYPT_FAILED', 422);
  }
  try {
    if (canonicalJson(parsed) !== text) {
      throw new PortholeError(`${field} is not canonically encoded`, 'PORTHOLE_DECRYPT_FAILED', 422);
    }
  } catch (error) {
    if (error instanceof PortholeError && error.code === 'PORTHOLE_DECRYPT_FAILED') throw error;
    throw new PortholeError(`${field} is not canonical JSON`, 'PORTHOLE_DECRYPT_FAILED', 422);
  }
  return parsed as Record<string, unknown>;
}

/**
 * Purpose: Normalize ordinary required labels; authenticated envelope fields use stricter exactString instead.
 * @param value Candidate value to validate or encode.
 * @param field Field name used in validation errors.
 * @returns A trimmed nonempty string or a validation error.
 */
function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new PortholeError(`${field} must be a non-empty string`, 'PORTHOLE_VALIDATION', 400);
  }
  return value.trim();
}

/**
 * Purpose: Keep chronology based on real calendar instants rather than permissive Date rollover.
 * @param value Candidate value to validate or encode.
 * @param field Field name used in validation errors.
 * @returns A validated RFC 3339 timestamp, defaulting to now when omitted.
 */
function validDate(value: string | undefined, field: string): string {
  const result = value ?? new Date().toISOString();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(result);
  if (!match) {
    throw new PortholeError(`${field} must be an RFC 3339 date-time`, 'PORTHOLE_VALIDATION', 400);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[7] === undefined ? 0 : Number(match[7]);
  const offsetMinute = match[8] === undefined ? 0 : Number(match[8]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = month === 2
    ? (leapYear ? 29 : 28)
    : ([4, 6, 9, 11].includes(month) ? 30 : 31);

  // Date.parse normalizes impossible calendar values (for example February 31)
  // and accepts 24:00. Validate every RFC 3339 component before using it for
  // ordering. Leap seconds are intentionally rejected because the store's
  // chronology is backed by JavaScript epoch milliseconds and cannot represent
  // them without ambiguity.
  if (
    month < 1 || month > 12 ||
    day < 1 || day > daysInMonth ||
    hour > 23 || minute > 59 || second > 59 ||
    offsetHour > 23 || offsetMinute > 59 ||
    !Number.isFinite(Date.parse(result))
  ) {
    throw new PortholeError(`${field} must be an RFC 3339 date-time`, 'PORTHOLE_VALIDATION', 400);
  }
  return result;
}

/**
 * Purpose: Require explicit evidence time so missing timestamps cannot silently become the current time.
 * @param value Candidate value to validate or encode.
 * @param field Field name used in validation errors.
 * @returns A validated supplied timestamp.
 */
function requiredDate(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new PortholeError(`${field} must be an RFC 3339 date-time`, 'PORTHOLE_VALIDATION', 400);
  }
  return validDate(value, field);
}

/**
 * Purpose: Keep receipt hash fields algorithm-qualified and in one canonical encoding.
 * @param value Candidate value to validate or encode.
 * @param field Field name used in validation errors.
 * @returns The unchanged SHA-256 commitment.
 */
function assertSha256(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new PortholeError(`${field} must be a sha256 commitment`, 'PORTHOLE_VALIDATION', 400);
  }
  return value;
}

type CaptureScheduleCommitmentMaterial = Omit<PortholeCaptureSchedule, 'commitmentHash'>;

/**
 * Purpose: Domain-separate schedule commitments from other canonical JSON hashes.
 * @param schedule Unsigned schedule whose fields are committed.
 * @returns The commitment to the supplied unsigned schedule.
 */
export function computePortholeScheduleCommitment(
  schedule: CaptureScheduleCommitmentMaterial,
): string {
  return sha256(canonicalJson({
    domain: 'pd.porthole.capture-schedule.v1',
    schedule,
  }));
}

/**
 * Purpose: Admit only the implemented fixed-interval, fixed-duration schedule and verify its pre-capture commitment.
 * @param value Candidate value to validate or encode.
 * @param startedAt Perspective opening timestamp.
 * @returns A strict schedule matching its committed hash.
 */
function normalizeCaptureSchedule(
  value: PortholeCaptureSchedule,
  startedAt: string,
): PortholeCaptureSchedule {
  const input = JSON.parse(canonicalJson(value, '$.captureSchedule')) as Record<string, unknown>;
  const exactKeys = ['boundary', 'commitmentHash', 'committedAt', 'mode', 'samplingIntervalMs', 'scheduleId'];
  if (Object.keys(input).sort().join('\0') !== exactKeys.sort().join('\0')) {
    throw new PortholeError('captureSchedule has unknown or missing fields', 'PORTHOLE_VALIDATION', 400);
  }
  const mode = input.mode;
  if (mode !== 'fixed-interval') {
    throw new PortholeError(
      'captureSchedule.mode is not implemented; only fixed-interval is accepted',
      'PORTHOLE_VALIDATION',
      400,
    );
  }
  const samplingIntervalMs = input.samplingIntervalMs;
  if (!Number.isSafeInteger(samplingIntervalMs) || Number(samplingIntervalMs) < 1) {
    throw new PortholeError(
      'captureSchedule interval does not match its mode',
      'PORTHOLE_VALIDATION',
      400,
    );
  }
  const boundaryInput = input.boundary;
  if (boundaryInput === null || typeof boundaryInput !== 'object' || Array.isArray(boundaryInput)) {
    throw new PortholeError('captureSchedule.boundary is required', 'PORTHOLE_VALIDATION', 400);
  }
  const boundary = boundaryInput as Record<string, unknown>;
  if (Object.keys(boundary).sort().join('\0') !== ['durationMs', 'kind', 'terminalEventKind'].sort().join('\0')) {
    throw new PortholeError('captureSchedule.boundary has unknown or missing fields', 'PORTHOLE_VALIDATION', 400);
  }
  const kind = boundary.kind;
  const durationMs = boundary.durationMs;
  const terminalEventKind = boundary.terminalEventKind;
  if (
    kind !== 'fixed-duration' ||
    !Number.isSafeInteger(durationMs) ||
    Number(durationMs) < 1 ||
    terminalEventKind !== null
  ) {
    throw new PortholeError(
      'captureSchedule.boundary is not implemented; only fixed-duration is accepted',
      'PORTHOLE_VALIDATION',
      400,
    );
  }
  const committedAt = requiredDate(input.committedAt, 'captureSchedule.committedAt');
  const boundaryEnd = Date.parse(startedAt) + Number(durationMs);
  if (!Number.isSafeInteger(boundaryEnd) || !Number.isFinite(new Date(boundaryEnd).getTime())) {
    throw new PortholeError('captureSchedule boundary exceeds the timestamp range', 'PORTHOLE_VALIDATION', 400);
  }
  if (Date.parse(committedAt) > Date.parse(startedAt)) {
    throw new PortholeError(
      'captureSchedule must be committed no later than startedAt',
      'PORTHOLE_VALIDATION',
      400,
    );
  }
  const normalized: PortholeCaptureSchedule = {
    scheduleId: requiredString(input.scheduleId, 'captureSchedule.scheduleId'),
    mode,
    samplingIntervalMs: samplingIntervalMs as number,
    boundary: {
      kind: 'fixed-duration',
      durationMs: durationMs as number,
      terminalEventKind: null,
    },
    committedAt,
    commitmentHash: assertSha256(input.commitmentHash, 'captureSchedule.commitmentHash'),
  };
  const { commitmentHash, ...material } = normalized;
  if (computePortholeScheduleCommitment(material) !== commitmentHash) {
    throw new PortholeError(
      'captureSchedule commitmentHash does not match the canonical schedule',
      'PORTHOLE_VALIDATION',
      400,
    );
  }
  return normalized;
}

/**
 * Purpose: Derive completeness expectations from the immutable schedule, never from a caller's observed count.
 * @param manifest Stored perspective identity, privacy, encryption, and schedule binding.
 * @param closedAt Proposed terminal timestamp.
 * @returns The number of capture slots; rejects premature closure.
 */
function expectedCaptureCountFor(
  manifest: PortholePerspective,
  closedAt?: string,
): number {
  const schedule = manifest.captureSchedule;
  const { commitmentHash, ...material } = schedule;
  if (computePortholeScheduleCommitment(material) !== commitmentHash) {
    throw new PortholeError('capture schedule commitment is invalid', 'PORTHOLE_CONFLICT', 409);
  }
  const durationMs = schedule.boundary.durationMs;
  if (closedAt !== undefined && Date.parse(closedAt) < Date.parse(manifest.startedAt) + durationMs) {
    throw new PortholeError('fixed-duration capture closed before its committed boundary', 'PORTHOLE_CONFLICT', 409);
  }
  // A nonempty partial final interval is still an expected slot. Integer
  // arithmetic avoids rounding a very large committed duration at division.
  return Number((BigInt(durationMs) + BigInt(schedule.samplingIntervalMs) - 1n) /
    BigInt(schedule.samplingIntervalMs));
}

/**
 * Purpose: Bind each sample or explicit gap to its committed half-open time slot.
 * @param manifest Immutable opening and fixed-interval schedule.
 * @param captureIndex Zero-based slot, including a possible partial final interval.
 * @param occurred Start timestamp in milliseconds, inclusive at the slot opening.
 * @param ended End timestamp in milliseconds, allowed to equal the slot end.
 * @returns Whether the entire evidence interval fits exactly its own slot.
 */
function evidenceFitsCaptureSlot(
  manifest: PortholePerspective,
  captureIndex: number,
  occurred: number,
  ended: number,
): boolean {
  const { samplingIntervalMs, boundary } = manifest.captureSchedule;
  const opened = Date.parse(manifest.startedAt);
  const offset = captureIndex * samplingIntervalMs;
  if (!Number.isSafeInteger(captureIndex) || captureIndex < 0 ||
      !Number.isSafeInteger(offset) || offset >= boundary.durationMs) return false;
  const slotStart = opened + offset;
  const slotEnd = opened + Math.min(offset + samplingIntervalMs, boundary.durationMs);
  return Number.isFinite(occurred) && Number.isFinite(ended) &&
    occurred >= slotStart && occurred < slotEnd && ended >= occurred && ended <= slotEnd;
}

/**
 * Purpose: Prevent negative, fractional, or imprecise sequence coordinates from entering evidence bindings.
 * @param value Candidate value to validate or encode.
 * @returns The unchanged nonnegative safe integer.
 */
function validateCaptureIndex(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new PortholeError('captureIndex must be a non-negative integer', 'PORTHOLE_VALIDATION', 400);
  }
  return value;
}

/**
 * Purpose: Reject backward or out-of-bound timestamps before appending the next evidence slot.
 * @param db SQLite connection for this evidence ledger.
 * @param manifest Stored perspective identity, privacy, encryption, and schedule binding.
 * @param captureIndex Zero-based capture slot.
 * @param occurredAt Proposed event timestamp.
 * @param endedAt Optional segment end timestamp.
 * @returns Nothing; throws when the proposed event violates chronology.
 */
function assertEvidenceChronology(
  db: DatabaseInstance,
  manifest: PortholePerspective,
  captureIndex: number,
  occurredAt: string,
  endedAt: string | null,
): void {
  const occurred = Date.parse(occurredAt);
  const ended = endedAt === null ? occurred : Date.parse(endedAt);
  const opened = Date.parse(manifest.startedAt);
  if (occurred < opened) {
    throw new PortholeError('capture evidence precedes the perspective opening', 'PORTHOLE_VALIDATION', 400);
  }
  const prior = getEventByOrdinal(db, manifest.perspectiveId, captureIndex);
  if (!prior) {
    throw new PortholeError(
      `Porthole events must append in order before captureIndex ${captureIndex}. ` +
      'Record an explicit capture-gap for every missing slot.',
      'PORTHOLE_CONFLICT',
      409,
    );
  }
  if (prior && occurred < Date.parse(prior.occurredAt)) {
    throw new PortholeError('capture evidence timestamps must be monotonic', 'PORTHOLE_CONFLICT', 409);
  }
  const boundary = manifest.captureSchedule.boundary;
  if (boundary.kind === 'fixed-duration' && boundary.durationMs !== null) {
    const boundaryEnd = opened + boundary.durationMs;
    if (occurred > boundaryEnd || ended > boundaryEnd) {
      throw new PortholeError(
        'capture evidence exceeds the committed fixed-duration boundary',
        'PORTHOLE_CONFLICT',
        409,
      );
    }
  }
  if (!evidenceFitsCaptureSlot(manifest, captureIndex, occurred, ended)) {
    throw new PortholeError('capture evidence does not fit its committed capture slot', 'PORTHOLE_CONFLICT', 409);
  }
}

/**
 * Purpose: Reject truncated or alternatively encoded signatures before asking the enrolled authority to verify.
 * @param value Candidate value to validate or encode.
 * @param field Field name used in validation errors.
 * @returns A 64-byte signature buffer the caller must clear.
 */
function decodeEd25519Signature(value: unknown, field: string): Buffer {
  const encoded = requiredString(value, field);
  const signature = Buffer.from(encoded, 'base64url');
  if (signature.length !== 64 || signature.toString('base64url') !== encoded) {
    signature.fill(0);
    throw new PortholeError(`${field} is not a canonical Ed25519 signature`, 'PORTHOLE_VALIDATION', 400);
  }
  return signature;
}

type UnsignedPortholePrivacyReceipt = Omit<PortholePrivacyReceipt, 'contentHash' | 'signature'>;

/**
 * Commitment to the exact scrubbed material a privacy pipeline approved. It is
 * kept inside the encrypted segment receipt and never copied to the public
 * ledger, so it cannot become a cross-record plaintext equality oracle.
 * Purpose: Bind approval to the exact scrubbed bytes and capture metadata without publishing a plaintext equality oracle.
 * @param perspectiveId Exact perspective identifier.
 * @param input Typed caller input for this operation.
 * @returns A domain-separated subject commitment kept inside sealed evidence.
 */
export function computePortholePrivacySubjectContentHash(
  perspectiveId: string,
  input: PortholePrivacySubjectInput,
): string {
  const captureIndex = validateCaptureIndex(input.captureIndex);
  if (!Buffer.isBuffer(input.bytes) || input.bytes.length === 0) {
    throw new PortholeError('segment bytes must not be empty', 'PORTHOLE_VALIDATION', 400);
  }
  if (input.bytes.length > PORTHOLE_MAX_SEGMENT_BYTES) {
    throw new PortholeError(
      `segment exceeds ${PORTHOLE_MAX_SEGMENT_BYTES} byte limit`,
      'PORTHOLE_VALIDATION',
      413,
    );
  }
  const capturedAt = requiredDate(input.capturedAt, 'capturedAt');
  const endedAt = input.endedAt == null ? null : requiredDate(input.endedAt, 'endedAt');
  if (endedAt !== null && Date.parse(endedAt) < Date.parse(capturedAt)) {
    throw new PortholeError('endedAt must not precede capturedAt', 'PORTHOLE_VALIDATION', 400);
  }
  return sha256(canonicalJson({
    domain: 'pd.porthole.privacy-subject-content.v1',
    subject: {
      perspectiveId: requiredString(perspectiveId, 'perspectiveId'),
      captureIndex,
      capturedAt,
      endedAt,
      mediaType: requiredString(input.mediaType, 'mediaType'),
      mediaBase64: input.bytes.toString('base64'),
      semanticOverlay: input.semanticOverlay ?? null,
      viewport: input.viewport ?? null,
      sourceRef: input.sourceRef ?? null,
    },
  }));
}

/**
 * Purpose: Give unsigned privacy receipts a stable, domain-separated integrity commitment.
 * @param receipt Receipt material to validate, hash, or encode.
 * @returns The SHA-256 commitment to receipt content.
 */
export function computePortholePrivacyReceiptContentHash(
  receipt: UnsignedPortholePrivacyReceipt,
): string {
  return sha256(canonicalJson({
    domain: 'pd.porthole.privacy-receipt-content.v1',
    schema: 'pd.porthole.privacy-receipt.v1',
    receipt,
  }));
}

/**
 * Purpose: Keep signing bytes deterministic and exclude the signature itself from its message.
 * @param receipt Receipt material to validate, hash, or encode.
 * @returns Canonical domain-separated UTF-8 bytes for the verifier.
 */
export function portholePrivacyReceiptSigningMessage(receipt: PortholePrivacyReceipt): Buffer {
  const { signature, ...signed } = receipt;
  return Buffer.from(canonicalJson({
    domain: 'pd.porthole.privacy-receipt-signature.v1',
    schema: 'pd.porthole.privacy-receipt.v1',
    receipt: {
      ...signed,
      signature: {
        algorithm: signature.algorithm,
        keyId: signature.keyId,
      },
    },
  }), 'utf8');
}

/**
 * Purpose: Fail closed on unknown fields, wrong subject bindings, and an issuer not independently authorized.
 * @param value Candidate value to validate or encode.
 * @param manifest Stored perspective identity, privacy, encryption, and schedule binding.
 * @param authority Independent enrolled-signature verifier, not the issuer's signer.
 * @param expectedSubject Expected capture index and sanitized-content commitment.
 * @returns A normalized, independently verified privacy receipt.
 */
function normalizePrivacyReceipt(
  value: unknown,
  manifest: PortholePerspective,
  authority: PortholeVerifiedSignatureAuthority,
  expectedSubject: { captureIndex: number; sanitizedContentHash: string },
): PortholePrivacyReceipt {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PortholeError(
      'privacyReceipt is required before Porthole persists a segment',
      'PORTHOLE_VALIDATION',
      400,
    );
  }
  const input = JSON.parse(canonicalJson(value, '$.privacyReceipt')) as Record<string, unknown>;
  const allowedKeys = new Set([
    'receiptId',
    'policyId',
    'pipelineVersion',
    'targetScope',
    'backgroundDisposition',
    'secretScan',
    'redactionDisposition',
    'binding',
    'issuer',
    'contentHash',
    'signature',
  ]);
  const unexpected = Object.keys(input).filter((key) => !allowedKeys.has(key));
  if (unexpected.length > 0) {
    throw new PortholeError(
      `privacyReceipt contains unsupported fields: ${unexpected.join(', ')}`,
      'PORTHOLE_VALIDATION',
      400,
    );
  }
  const targetScope = input.targetScope;
  const backgroundDisposition = input.backgroundDisposition;
  const secretScan = input.secretScan;
  const redactionDisposition = input.redactionDisposition;
  if (targetScope !== 'exact-target' || backgroundDisposition !== 'excluded') {
    throw new PortholeError(
      'privacyReceipt must prove exact-target capture with background media excluded',
      'PORTHOLE_VALIDATION',
      400,
    );
  }
  if (secretScan !== 'passed' && secretScan !== 'quarantined') {
    throw new PortholeError(
      'privacyReceipt.secretScan must be passed or quarantined',
      'PORTHOLE_VALIDATION',
      400,
    );
  }
  if (redactionDisposition !== 'scrubbed' && redactionDisposition !== 'quarantined') {
    throw new PortholeError(
      'privacyReceipt.redactionDisposition must be scrubbed or quarantined',
      'PORTHOLE_VALIDATION',
      400,
    );
  }
  if (
    !(
      (secretScan === 'passed' && redactionDisposition === 'scrubbed') ||
      (secretScan === 'quarantined' && redactionDisposition === 'quarantined')
    )
  ) {
    throw new PortholeError(
      'privacyReceipt scan and redaction dispositions must both pass or both quarantine',
      'PORTHOLE_VALIDATION',
      400,
    );
  }
  const bindingInput = input.binding as Record<string, unknown> | null;
  const issuerInput = input.issuer as Record<string, unknown> | null;
  const signatureInput = input.signature as Record<string, unknown> | null;
  if (
    bindingInput === null || typeof bindingInput !== 'object' || Array.isArray(bindingInput) ||
    issuerInput === null || typeof issuerInput !== 'object' || Array.isArray(issuerInput) ||
    signatureInput === null || typeof signatureInput !== 'object' || Array.isArray(signatureInput)
  ) {
    throw new PortholeError('privacyReceipt authority fields are required', 'PORTHOLE_VALIDATION', 400);
  }
  /**
   * Purpose: Keep nested signed records closed to unknown or omitted fields.
   * @param object Nested record whose field set is frozen.
   * @param keys Exact allowed and required field names.
   * @param field Field name used in validation errors.
   * @returns Nothing; throws when the exact field set differs.
   */
  const exact = (object: Record<string, unknown>, keys: string[], field: string) => {
    if (Object.keys(object).sort().join('\0') !== [...keys].sort().join('\0')) {
      throw new PortholeError(`${field} has unknown or missing fields`, 'PORTHOLE_VALIDATION', 400);
    }
  };
  exact(bindingInput, [
    'harborId',
    'bodyId',
    'stageId',
    'perspectiveId',
    'streamId',
    'surfaceId',
    'surfaceDescriptorCommitment',
    'captureIndex',
    'sanitizedContentHash',
  ], 'privacyReceipt.binding');
  exact(issuerInput, ['participantId', 'keyId'], 'privacyReceipt.issuer');
  exact(signatureInput, ['algorithm', 'keyId', 'value'], 'privacyReceipt.signature');
  const receipt: PortholePrivacyReceipt = {
    receiptId: requiredString(input.receiptId, 'privacyReceipt.receiptId'),
    policyId: requiredString(input.policyId, 'privacyReceipt.policyId'),
    pipelineVersion: requiredString(input.pipelineVersion, 'privacyReceipt.pipelineVersion'),
    targetScope,
    backgroundDisposition,
    secretScan,
    redactionDisposition,
    binding: {
      harborId: requiredString(bindingInput.harborId, 'privacyReceipt.binding.harborId'),
      bodyId: requiredString(bindingInput.bodyId, 'privacyReceipt.binding.bodyId'),
      stageId: requiredString(bindingInput.stageId, 'privacyReceipt.binding.stageId'),
      perspectiveId: requiredString(bindingInput.perspectiveId, 'privacyReceipt.binding.perspectiveId'),
      streamId: requiredString(bindingInput.streamId, 'privacyReceipt.binding.streamId'),
      surfaceId: requiredString(bindingInput.surfaceId, 'privacyReceipt.binding.surfaceId'),
      surfaceDescriptorCommitment: assertSha256(
        bindingInput.surfaceDescriptorCommitment,
        'privacyReceipt.binding.surfaceDescriptorCommitment',
      ),
      captureIndex: validateCaptureIndex(bindingInput.captureIndex as number),
      sanitizedContentHash: assertSha256(
        bindingInput.sanitizedContentHash,
        'privacyReceipt.binding.sanitizedContentHash',
      ),
    },
    issuer: {
      participantId: requiredString(issuerInput.participantId, 'privacyReceipt.issuer.participantId'),
      keyId: requiredString(issuerInput.keyId, 'privacyReceipt.issuer.keyId'),
    },
    contentHash: assertSha256(input.contentHash, 'privacyReceipt.contentHash'),
    signature: {
      algorithm: signatureInput.algorithm as 'ed25519',
      keyId: requiredString(signatureInput.keyId, 'privacyReceipt.signature.keyId'),
      value: requiredString(signatureInput.value, 'privacyReceipt.signature.value'),
    },
  };
  const {
    contentHash: _privacyContentHash,
    signature: _privacySignature,
    ...privacyContent
  } = receipt;
  if (
    receipt.binding.harborId !== manifest.harborId ||
    receipt.binding.bodyId !== manifest.bodyId ||
    receipt.binding.stageId !== manifest.stageId ||
    receipt.binding.perspectiveId !== manifest.perspectiveId ||
    receipt.binding.streamId !== manifest.streamId ||
    receipt.binding.surfaceId !== manifest.surface.surfaceId ||
    receipt.binding.surfaceDescriptorCommitment !== manifest.surface.descriptor.commitment ||
    receipt.binding.captureIndex !== expectedSubject.captureIndex ||
    receipt.binding.sanitizedContentHash !== expectedSubject.sanitizedContentHash ||
    receipt.issuer.participantId !== manifest.participantId ||
    receipt.signature.algorithm !== 'ed25519' ||
    receipt.signature.keyId !== receipt.issuer.keyId ||
    computePortholePrivacyReceiptContentHash(privacyContent) !== receipt.contentHash ||
    canonicalJson(receipt) !== canonicalJson(input)
  ) {
    throw new PortholeError(
      'privacyReceipt authority or stream binding does not match the perspective',
      'PORTHOLE_VALIDATION',
      400,
    );
  }
  const signature = decodeEd25519Signature(receipt.signature.value, 'privacyReceipt.signature.value');
  const message = portholePrivacyReceiptSigningMessage(receipt);
  try {
    if (!authority.verifyPrivacy({
      harborId: manifest.harborId,
      bodyId: manifest.bodyId,
      participantId: manifest.participantId,
      stageId: manifest.stageId,
      perspectiveId: manifest.perspectiveId,
      streamId: manifest.streamId,
      surfaceId: manifest.surface.surfaceId,
      surfaceDescriptorCommitment: manifest.surface.descriptor.commitment,
      captureIndex: receipt.binding.captureIndex,
      sanitizedContentHash: receipt.binding.sanitizedContentHash,
      receiptId: receipt.receiptId,
      policyId: receipt.policyId,
      pipelineVersion: receipt.pipelineVersion,
      targetScope: receipt.targetScope,
      backgroundDisposition: receipt.backgroundDisposition,
      secretScan: receipt.secretScan,
      redactionDisposition: receipt.redactionDisposition,
      contentHash: receipt.contentHash,
      claimedKeyId: receipt.signature.keyId,
    }, message, signature)) {
      throw new PortholeError(
        'privacyReceipt signature is not authorized',
        'PORTHOLE_VALIDATION',
        403,
      );
    }
  } finally {
    signature.fill(0);
    message.fill(0);
  }
  return receipt;
}

/**
 * Purpose: Prevent quarantined privacy evidence from being counted as verified capture.
 * @param receipt Receipt material to validate, hash, or encode.
 * @returns Verified only when both scan and redaction passed; otherwise quarantined.
 */
function privacyReceiptState(receipt: PortholePrivacyReceipt): 'verified' | 'quarantined' {
  return receipt.secretScan === 'passed' && receipt.redactionDisposition === 'scrubbed'
    ? 'verified'
    : 'quarantined';
}

type UnsignedPortholeCompletenessReceipt = Omit<
  PortholeCompletenessReceipt,
  'contentHash' | 'signature'
>;

/**
 * Purpose: Enforce the frozen receipt shape without coercing signed fields into a different message.
 * @param value Candidate value to validate or encode.
 * @returns A canonical completeness receipt or a validation error.
 */
function normalizeCompletenessReceipt(value: unknown): PortholeCompletenessReceipt {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PortholeError('completeness receipt must be an object', 'PORTHOLE_VALIDATION', 400);
  }
  const input = JSON.parse(canonicalJson(value, '$.completenessReceipt')) as Record<string, unknown>;
  /**
   * Purpose: Keep nested signed records closed to unknown or omitted fields.
   * @param object Nested record whose field set is frozen.
   * @param keys Exact allowed and required field names.
   * @param field Field name used in validation errors.
   * @returns Nothing; throws when the exact field set differs.
   */
  const exact = (object: Record<string, unknown>, keys: string[], field: string) => {
    if (Object.keys(object).sort().join('\0') !== [...keys].sort().join('\0')) {
      throw new PortholeError(`${field} has unknown or missing fields`, 'PORTHOLE_VALIDATION', 400);
    }
  };
  exact(input, [
    'schema', 'receiptId', 'perspectiveId', 'stageId', 'schedule', 'streamBoundary',
    'status', 'expectedCaptureCount', 'recordedSegmentCount', 'verifiedSegmentCount',
    'unreadableSegmentCount', 'declaredGapCount', 'missingCaptureCount', 'chainHeadHash',
    'encryptionSuite', 'stopReason', 'issuer', 'contentHash', 'signature', 'issuedAt',
  ], 'completenessReceipt');
  /**
   * Purpose: Reject arrays and primitives where completeness requires a structured signed record.
   * @param candidate Runtime field value to validate.
   * @param field Field name used in validation errors.
   * @returns The candidate record.
   */
  const objectField = (candidate: unknown, field: string): Record<string, unknown> => {
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new PortholeError(`${field} must be an object`, 'PORTHOLE_VALIDATION', 400);
    }
    return candidate as Record<string, unknown>;
  };
  const schedule = objectField(input.schedule, 'completenessReceipt.schedule');
  const boundary = objectField(input.streamBoundary, 'completenessReceipt.streamBoundary');
  const issuer = objectField(input.issuer, 'completenessReceipt.issuer');
  const signature = objectField(input.signature, 'completenessReceipt.signature');
  exact(schedule, ['scheduleId', 'commitmentHash'], 'completenessReceipt.schedule');
  exact(boundary, [
    'streamId', 'channelId', 'firstCaptureIndex', 'lastCaptureIndex', 'openedAt',
    'closedAt', 'terminalEventId', 'terminalEventCommitment',
  ], 'completenessReceipt.streamBoundary');
  exact(issuer, ['harborId', 'bodyId', 'participantId', 'signingKeyId'], 'completenessReceipt.issuer');
  exact(signature, ['algorithm', 'keyId', 'value'], 'completenessReceipt.signature');
  /**
   * Purpose: Reject lossy or negative completeness counters before count reconciliation.
   * @param candidate Runtime field value to validate.
   * @param field Field name used in validation errors.
   * @returns The nonnegative safe integer.
   */
  const integer = (candidate: unknown, field: string): number => {
    if (!Number.isSafeInteger(candidate) || Number(candidate) < 0) {
      throw new PortholeError(`${field} must be a non-negative safe integer`, 'PORTHOLE_VALIDATION', 400);
    }
    return Number(candidate);
  };
  /**
   * Purpose: Preserve the difference between no capture boundary and capture slot zero.
   * @param candidate Runtime field value to validate.
   * @param field Field name used in validation errors.
   * @returns Null or a validated nonnegative safe index.
   */
  const nullableIndex = (candidate: unknown, field: string): number | null =>
    candidate === null ? null : integer(candidate, field);
  /**
   * Purpose: Require signed receipt timestamps to be explicit validated strings.
   * @param candidate Runtime field value to validate.
   * @param field Field name used in validation errors.
   * @returns A validated RFC 3339 timestamp.
   */
  const date = (candidate: unknown, field: string): string => {
    if (typeof candidate !== 'string') {
      throw new PortholeError(`${field} must be an RFC 3339 date-time`, 'PORTHOLE_VALIDATION', 400);
    }
    return requiredDate(candidate, field);
  };
  const status = input.status;
  if (!['complete', 'partial', 'failed'].includes(String(status))) {
    throw new PortholeError('completenessReceipt.status is invalid', 'PORTHOLE_VALIDATION', 400);
  }
  const stopReason = input.stopReason;
  if (![
    'operator', 'body-stopped', 'session-ended', 'permission-revoked',
    'adapter-failed', 'retention-limit', 'unknown',
  ].includes(String(stopReason))) {
    throw new PortholeError('completenessReceipt.stopReason is invalid', 'PORTHOLE_VALIDATION', 400);
  }
  if (input.schema !== PORTHOLE_RECEIPT_SCHEMA || input.encryptionSuite !== PORTHOLE_ENCRYPTION_SUITE) {
    throw new PortholeError('completeness receipt schema or encryption suite is invalid', 'PORTHOLE_VALIDATION', 400);
  }
  if (signature.algorithm !== 'ed25519') {
    throw new PortholeError('completeness receipt signature algorithm is invalid', 'PORTHOLE_VALIDATION', 400);
  }
  const normalized: PortholeCompletenessReceipt = {
    schema: PORTHOLE_RECEIPT_SCHEMA,
    receiptId: requiredString(input.receiptId, 'completenessReceipt.receiptId'),
    perspectiveId: requiredString(input.perspectiveId, 'completenessReceipt.perspectiveId'),
    stageId: requiredString(input.stageId, 'completenessReceipt.stageId'),
    schedule: {
      scheduleId: requiredString(schedule.scheduleId, 'completenessReceipt.schedule.scheduleId'),
      commitmentHash: assertSha256(
        schedule.commitmentHash,
        'completenessReceipt.schedule.commitmentHash',
      ),
    },
    streamBoundary: {
      streamId: requiredString(boundary.streamId, 'completenessReceipt.streamBoundary.streamId'),
      channelId: requiredString(boundary.channelId, 'completenessReceipt.streamBoundary.channelId'),
      firstCaptureIndex: nullableIndex(
        boundary.firstCaptureIndex,
        'completenessReceipt.streamBoundary.firstCaptureIndex',
      ),
      lastCaptureIndex: nullableIndex(
        boundary.lastCaptureIndex,
        'completenessReceipt.streamBoundary.lastCaptureIndex',
      ),
      openedAt: date(boundary.openedAt, 'completenessReceipt.streamBoundary.openedAt'),
      closedAt: date(boundary.closedAt, 'completenessReceipt.streamBoundary.closedAt'),
      terminalEventId: requiredString(
        boundary.terminalEventId,
        'completenessReceipt.streamBoundary.terminalEventId',
      ),
      terminalEventCommitment: assertSha256(
        boundary.terminalEventCommitment,
        'completenessReceipt.streamBoundary.terminalEventCommitment',
      ),
    },
    status: status as PortholeCompletenessReceipt['status'],
    expectedCaptureCount: integer(input.expectedCaptureCount, 'completenessReceipt.expectedCaptureCount'),
    recordedSegmentCount: integer(input.recordedSegmentCount, 'completenessReceipt.recordedSegmentCount'),
    verifiedSegmentCount: integer(input.verifiedSegmentCount, 'completenessReceipt.verifiedSegmentCount'),
    unreadableSegmentCount: integer(input.unreadableSegmentCount, 'completenessReceipt.unreadableSegmentCount'),
    declaredGapCount: integer(input.declaredGapCount, 'completenessReceipt.declaredGapCount'),
    missingCaptureCount: integer(input.missingCaptureCount, 'completenessReceipt.missingCaptureCount'),
    chainHeadHash: assertSha256(input.chainHeadHash, 'completenessReceipt.chainHeadHash'),
    encryptionSuite: PORTHOLE_ENCRYPTION_SUITE,
    stopReason: stopReason as CompletePerspectiveInput['stopReason'],
    issuer: {
      harborId: requiredString(issuer.harborId, 'completenessReceipt.issuer.harborId'),
      bodyId: requiredString(issuer.bodyId, 'completenessReceipt.issuer.bodyId'),
      participantId: requiredString(
        issuer.participantId,
        'completenessReceipt.issuer.participantId',
      ),
      signingKeyId: requiredString(
        issuer.signingKeyId,
        'completenessReceipt.issuer.signingKeyId',
      ),
    },
    contentHash: assertSha256(input.contentHash, 'completenessReceipt.contentHash'),
    signature: {
      algorithm: 'ed25519',
      keyId: requiredString(signature.keyId, 'completenessReceipt.signature.keyId'),
      value: requiredString(signature.value, 'completenessReceipt.signature.value'),
    },
    issuedAt: date(input.issuedAt, 'completenessReceipt.issuedAt'),
  };
  const first = normalized.streamBoundary.firstCaptureIndex;
  const last = normalized.streamBoundary.lastCaptureIndex;
  if (
    normalized.recordedSegmentCount !==
      normalized.verifiedSegmentCount + normalized.unreadableSegmentCount ||
    normalized.expectedCaptureCount !==
      normalized.recordedSegmentCount + normalized.declaredGapCount + normalized.missingCaptureCount ||
    (normalized.expectedCaptureCount === 0 && (first !== null || last !== null)) ||
    (normalized.expectedCaptureCount > 0 &&
      (first === null || last === null || last < first || last - first + 1 !== normalized.expectedCaptureCount)) ||
    normalized.signature.keyId !== normalized.issuer.signingKeyId ||
    Date.parse(normalized.streamBoundary.openedAt) > Date.parse(normalized.streamBoundary.closedAt) ||
    Date.parse(normalized.streamBoundary.closedAt) > Date.parse(normalized.issuedAt) ||
    (normalized.status === 'complete' &&
      (normalized.unreadableSegmentCount !== 0 ||
        normalized.declaredGapCount !== 0 ||
        normalized.missingCaptureCount !== 0)) ||
    (normalized.status === 'failed' && normalized.verifiedSegmentCount !== 0)
  ) {
    throw new PortholeError('completeness receipt cross-field semantics are invalid', 'PORTHOLE_VALIDATION', 400);
  }
  if (canonicalJson(normalized) !== canonicalJson(input)) {
    throw new PortholeError('completeness receipt is not in the frozen canonical shape', 'PORTHOLE_VALIDATION', 400);
  }
  return normalized;
}

/**
 * Purpose: Separate completeness-content hashes from privacy and schedule commitment domains.
 * @param receipt Receipt material to validate, hash, or encode.
 * @returns The unsigned completeness receipt commitment.
 */
function portholeCompletenessContentHash(
  receipt: UnsignedPortholeCompletenessReceipt,
): string {
  return sha256(canonicalJson({
    domain: 'pd.porthole.completeness-receipt-content.v1',
    receipt,
  }));
}

/**
 * Purpose: Bind the signer to the exact completeness payload and its content hash.
 * @param receipt Receipt material to validate, hash, or encode.
 * @returns Canonical domain-separated signing bytes.
 */
export function portholeCompletenessReceiptSigningMessage(
  receipt: Omit<PortholeCompletenessReceipt, 'signature'>,
): Buffer {
  return Buffer.from(canonicalJson({
    domain: 'pd.porthole.completeness-receipt-signature.v1',
    receipt,
  }), 'utf8');
}

/**
 * Purpose: Require manifest identity and schedule agreement before independent signature authorization.
 * @param receipt Receipt material to validate, hash, or encode.
 * @param manifest Stored perspective identity, privacy, encryption, and schedule binding.
 * @param authority Independent enrolled-signature verifier, not the issuer's signer.
 * @returns True only for a correctly bound authorized signature; malformed input returns false.
 */
function verifyCompletenessReceiptSignature(
  receipt: PortholeCompletenessReceipt,
  manifest: PortholePerspective,
  authority: PortholeVerifiedSignatureAuthority,
): boolean {
  try {
    const normalized = normalizeCompletenessReceipt(receipt);
    const { signature, contentHash, ...unsigned } = normalized;
    if (
      normalized.perspectiveId !== manifest.perspectiveId ||
      normalized.stageId !== manifest.stageId ||
      normalized.schedule.scheduleId !== manifest.captureSchedule.scheduleId ||
      normalized.schedule.commitmentHash !== manifest.captureSchedule.commitmentHash ||
      normalized.streamBoundary.streamId !== manifest.streamId ||
      normalized.streamBoundary.channelId !== manifest.encryption.channelId ||
      normalized.streamBoundary.openedAt !== manifest.startedAt ||
      normalized.issuer.harborId !== manifest.harborId ||
      normalized.issuer.bodyId !== manifest.bodyId ||
      normalized.issuer.participantId !== manifest.participantId ||
      portholeCompletenessContentHash(unsigned) !== contentHash ||
      normalized.streamBoundary.firstCaptureIndex !==
        (normalized.expectedCaptureCount === 0 ? null : 0)
    ) {
      return false;
    }
    const signatureBytes = decodeEd25519Signature(signature.value, 'signature.value');
    const message = portholeCompletenessReceiptSigningMessage({ ...unsigned, contentHash });
    try {
      return authority.verifyCompleteness({
        harborId: manifest.harborId,
        bodyId: manifest.bodyId,
        participantId: manifest.participantId,
        stageId: manifest.stageId,
        perspectiveId: manifest.perspectiveId,
        streamId: manifest.streamId,
        contentHash,
        claimedKeyId: signature.keyId,
      }, message, signatureBytes);
    } finally {
      signatureBytes.fill(0);
      message.fill(0);
    }
  } catch {
    return false;
  }
}

/**
 * Purpose: Serialize read-then-append decisions using an immediate transaction when the SQLite adapter provides it.
 * @param db SQLite connection for this evidence ledger.
 * @param operation Synchronous operation executed inside the transaction.
 * @returns The operation's committed result; errors roll back the transaction.
 */
function runImmediateTransaction<T>(db: DatabaseInstance, operation: () => T): T {
  const transaction = db.transaction(operation) as unknown as {
    (): T;
    immediate?: () => T;
  };
  return typeof transaction.immediate === 'function'
    ? transaction.immediate()
    : transaction();
}

export type PortholeBlobStore = Pick<BlobStore, 'put' | 'get' | 'dir'>;

/**
 * Purpose: Verify content-address read-back and fsync both ciphertext and its directory before ledger commit.
 * @param blobs Dedicated content-addressed evidence store.
 * @param blobId Expected raw SHA-256 content address.
 * @param expectedBytes Canonical ciphertext envelope bytes expected on disk.
 * @returns Nothing; throws a durability error if any witness fails.
 */
function syncAndVerifyBlob(blobs: PortholeBlobStore, blobId: string, expectedBytes: Buffer): void {
  try {
    if (blobId !== sha256Hex(expectedBytes)) {
      throw new Error('blob store returned a non-content-addressed id');
    }
    const readBack = blobs.get(blobId);
    if (!readBack) throw new Error('blob disappeared before durability verification');
    try {
      if (
        readBack.id !== blobId ||
        readBack.buffer.length !== expectedBytes.length ||
        !timingSafeEqual(readBack.buffer, expectedBytes) ||
        sha256Hex(readBack.buffer) !== blobId
      ) {
        throw new Error('blob read-back did not match its content address');
      }
    } finally {
      readBack.buffer.fill(0);
    }

    let fileDescriptor: number | undefined;
    let directoryDescriptor: number | undefined;
    try {
      fileDescriptor = openSync(join(blobs.dir, blobId), 'r');
      fsyncSync(fileDescriptor);
      closeSync(fileDescriptor);
      fileDescriptor = undefined;

      // rename(2) is not crash durable until the containing directory entry is
      // synced. This is deliberately fail-closed on the local evidence path.
      directoryDescriptor = openSync(blobs.dir, 'r');
      fsyncSync(directoryDescriptor);
      closeSync(directoryDescriptor);
      directoryDescriptor = undefined;
    } finally {
      if (fileDescriptor !== undefined) closeSync(fileDescriptor);
      if (directoryDescriptor !== undefined) closeSync(directoryDescriptor);
    }
  } catch (error) {
    if (error instanceof PortholeError) throw error;
    throw new PortholeError(
      `Porthole ciphertext was not durably persisted: ${(error as Error).message}`,
      'PORTHOLE_DURABILITY',
      500,
    );
  }
}

/**
 * Purpose: Keep arbitrary harbor labels out of Keychain account names while retaining deterministic isolation.
 * @param harborId Harbor whose key material is requested.
 * @returns A versioned account name derived from the harbor digest.
 */
function keychainAccount(harborId: string): string {
  const digest = createHash('sha256').update(harborId).digest('hex');
  return `porthole-harbor-v1:${digest}`;
}

/**
 * Purpose: Reject malformed persisted root material instead of silently replacing a key and losing old evidence.
 * @param value Candidate value to validate or encode.
 * @returns A 32-byte secret buffer owned by the caller.
 */
function parseKeychainHarborSecret(value: string): Buffer {
  const secret = Buffer.from(value, 'hex');
  if (secret.length !== 32 || secret.toString('hex') !== value.toLowerCase()) {
    secret.fill(0);
    throw new PortholeError(
      'Porthole harbor key is malformed; recording is disabled until the key is repaired',
      'PORTHOLE_KEYSTORE_UNAVAILABLE',
      503,
    );
  }
  return secret;
}

/**
 * Purpose: Make root creation depend on proven absence and confirmed create-only read-back.
 * @param accessor Keychain access seam; tests may inject a deterministic implementation.
 * @returns A fail-closed OS-Keychain-backed secret provider.
 */
export function createKeychainPortholeSecretProvider(
  accessor: PortholeKeychainAccessor = keychain,
): PortholeSecretProvider {
  return {
    /**
     * Purpose: Read or create one harbor root without overwriting a concurrent creator's value.
     * @param harborId Harbor whose key material is requested.
     * @returns The confirmed root bytes and OS-Keychain custody marker.
     */
    getHarborSecret(harborId: string): PortholeSecret {
      requiredString(harborId, 'harborId');
      if (!accessor.available()) {
        throw new PortholeError(
          'Porthole recording requires an OS keystore; refusing to persist plaintext evidence',
          'PORTHOLE_KEYSTORE_UNAVAILABLE',
          503,
        );
      }
      const account = keychainAccount(harborId);
      const existing = accessor.loadSecretResult(KEYCHAIN_SERVICE, account);
      if (existing.status === 'found') {
        return {
          secret: parseKeychainHarborSecret(existing.value),
          keyCustody: 'os-keychain',
        };
      }
      if (existing.status !== 'missing') {
        throw new PortholeError(
          'Porthole harbor key could not be read; refusing to create or replace a root key',
          'PORTHOLE_KEYSTORE_UNAVAILABLE',
          503,
        );
      }

      const secret = randomBytes(32);
      const candidate = secret.toString('hex');
      const created = accessor.saveSecretIfAbsent(KEYCHAIN_SERVICE, account, candidate);
      const confirmed = accessor.loadSecretResult(KEYCHAIN_SERVICE, account);
      if (confirmed.status !== 'found') {
        secret.fill(0);
        throw new PortholeError(
          'Could not atomically create and read back the Porthole harbor key; no evidence was stored',
          'PORTHOLE_KEYSTORE_UNAVAILABLE',
          503,
        );
      }
      if (created && confirmed.value.toLowerCase() !== candidate) {
        secret.fill(0);
        throw new PortholeError(
          'Porthole harbor key changed during creation; recording is disabled',
          'PORTHOLE_KEYSTORE_UNAVAILABLE',
          503,
        );
      }
      const winner = parseKeychainHarborSecret(confirmed.value);
      secret.fill(0);
      return { secret: winner, keyCustody: 'os-keychain' };
    },
  };
}

/**
 * Purpose: Keep deterministic test secrets isolated from the OS keystore; this is not production custody.
 * @param secret Test root bytes copied into the provider.
 * @returns A test-only provider that returns owned buffer copies.
 */
export function createInMemoryPortholeSecretProvider(secret = Buffer.alloc(32, 7)): PortholeSecretProvider {
  if (secret.length < 32) throw new Error('in-memory Porthole secret must be at least 32 bytes');
  const copy = Buffer.from(secret);
  return {
    /**
     * Purpose: Keep test callers from mutating the provider's retained root bytes.
     * @returns An owned copy with an explicit in-memory-test custody marker.
     */
    getHarborSecret(): PortholeSecret {
      return { secret: Buffer.from(copy), keyCustody: 'in-memory-test' };
    },
  };
}

/**
 * Purpose: Install the append-only DML protections and reject a schema missing required event columns.
 * @param db SQLite connection for this evidence ledger.
 * @returns Nothing; throws when required columns are absent.
 */
export function ensurePortholeSchema(db: DatabaseInstance): void {
  db.exec(PORTHOLE_SCHEMA_SQL);
  const columns = db.prepare('PRAGMA table_info(porthole_events)').all() as Array<{ name: string }>;
  const actual = new Set(columns.map((column) => column.name));
  const missing = [
    'event_seq', 'event_id', 'perspective_id', 'ordinal', 'kind', 'occurred_at',
    'payload_json', 'content_hash', 'prev_hash',
  ].filter((column) => !actual.has(column));
  if (missing.length > 0) {
    throw new Error(`porthole_events migration verification failed: missing ${missing.join(', ')}`);
  }
}

/**
 * Purpose: Centralize the storage-to-contract mapping without claiming that decoding verifies a chain.
 * @param row Persisted event row.
 * @returns The event representation with parsed payload.
 */
function rowToEvent(row: PortholeEventRow): PortholeEvent {
  return {
    eventSeq: row.event_seq,
    eventId: row.event_id,
    perspectiveId: row.perspective_id,
    ordinal: row.ordinal,
    kind: row.kind,
    occurredAt: row.occurred_at,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    contentHash: row.content_hash,
    prevHash: row.prev_hash,
  };
}

/**
 * Purpose: Resolve one immutable position in a perspective's event chain.
 * @param db SQLite connection for this evidence ledger.
 * @param perspectiveId Exact perspective identifier.
 * @param ordinal Event position inside the perspective.
 * @returns The decoded event, or null for an unoccupied ordinal.
 */
function getEventByOrdinal(db: DatabaseInstance, perspectiveId: string, ordinal: number): PortholeEvent | null {
  const row = db.prepare(
    'SELECT * FROM porthole_events WHERE perspective_id = ? AND ordinal = ?',
  ).get(perspectiveId, ordinal) as PortholeEventRow | undefined;
  return row ? rowToEvent(row) : null;
}

/**
 * Purpose: Append under the caller's write transaction after identity, ordinal, and open-state checks.
 * @param db SQLite connection for this evidence ledger.
 * @param input Typed caller input for this operation.
 * @param requireOpen Whether terminal perspectives must be rejected.
 * @returns The appended event or an identity-matching duplicate; callers must compare payloads.
 */
function appendPortholeEventLocked(
  db: DatabaseInstance,
  input: Omit<PortholeEvent, 'eventSeq' | 'contentHash' | 'prevHash'>,
  requireOpen: boolean,
): { event: PortholeEvent; duplicate: boolean } {
  if (requireOpen) assertPerspectiveOpen(db, input.perspectiveId);
  const duplicate = db.prepare('SELECT * FROM porthole_events WHERE event_id = ?').get(
    input.eventId,
  ) as PortholeEventRow | undefined;
  if (duplicate) {
    const event = rowToEvent(duplicate);
    if (
      event.perspectiveId !== input.perspectiveId ||
      event.ordinal !== input.ordinal ||
      event.kind !== input.kind
    ) {
      throw new PortholeError(
        `Porthole event id ${input.eventId} already identifies different evidence`,
        'PORTHOLE_CONFLICT',
        409,
      );
    }
    return { event, duplicate: true };
  }

  const occupied = getEventByOrdinal(db, input.perspectiveId, input.ordinal);
  if (occupied) {
    throw new PortholeError(
      `capture ordinal ${input.ordinal} already belongs to ${occupied.eventId}`,
      'PORTHOLE_CONFLICT',
      409,
    );
  }
  const prior = db.prepare(
    'SELECT ordinal, content_hash FROM porthole_events WHERE perspective_id = ? ORDER BY ordinal DESC LIMIT 1',
  ).get(input.perspectiveId) as { ordinal: number; content_hash: string } | undefined;
  const expectedOrdinal = prior ? prior.ordinal + 1 : 0;
  if (input.ordinal !== expectedOrdinal) {
    throw new PortholeError(
      `Porthole events must append in order: expected ordinal ${expectedOrdinal}, got ${input.ordinal}. ` +
      'Record an explicit capture-gap for every missing slot.',
      'PORTHOLE_CONFLICT',
      409,
    );
  }
  const prevHash = prior?.content_hash ?? null;
  const payloadJson = canonicalJson(input.payload);
  const contentHash = sha256(canonicalJson({ ...input, prevHash }));
  db.prepare(`
    INSERT INTO porthole_events (
      event_id, perspective_id, ordinal, kind, occurred_at, payload_json, content_hash, prev_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.eventId,
    input.perspectiveId,
    input.ordinal,
    input.kind,
    input.occurredAt,
    payloadJson,
    contentHash,
    prevHash,
  );
  const inserted = db.prepare('SELECT * FROM porthole_events WHERE event_id = ?').get(
    input.eventId,
  ) as PortholeEventRow;
  return { event: rowToEvent(inserted), duplicate: false };
}

/**
 * Purpose: Keep schema setup and the serialized append operation behind one internal entry point.
 * @param db SQLite connection for this evidence ledger.
 * @param input Typed caller input for this operation.
 * @param options Explicit operation dependencies and policy options.
 * @returns An append result identifying whether the event already existed.
 */
function appendPortholeEvent(
  db: DatabaseInstance,
  input: Omit<PortholeEvent, 'eventSeq' | 'contentHash' | 'prevHash'>,
  options: { requireOpen?: boolean } = {},
): { event: PortholeEvent; duplicate: boolean } {
  ensurePortholeSchema(db);
  return runImmediateTransaction(
    db,
    () => appendPortholeEventLocked(db, input, options.requireOpen === true),
  );
}

/**
 * Purpose: Require a real perspective-start event before resolving dependent evidence.
 * @param db SQLite connection for this evidence ledger.
 * @param perspectiveId Exact perspective identifier.
 * @returns The ordinal-zero start event, or a not-found error.
 */
function startEvent(db: DatabaseInstance, perspectiveId: string): PortholeEvent {
  const event = getEventByOrdinal(db, perspectiveId, 0);
  if (!event || event.kind !== 'perspective-started') {
    throw new PortholeError(`Porthole perspective ${perspectiveId} not found`, 'PORTHOLE_NOT_FOUND', 404);
  }
  return event;
}

/**
 * Purpose: Anchor operations to the stored manifest and reject a missing or noncanonical body identity.
 * @param db SQLite connection for this evidence ledger.
 * @param perspectiveId Exact perspective identifier.
 * @returns The stored perspective manifest.
 */
function manifestFor(db: DatabaseInstance, perspectiveId: string): PortholePerspective {
  const manifest = startEvent(db, perspectiveId).payload as unknown as PortholePerspective;
  if (requiredString(manifest.bodyId, 'manifest.bodyId') !== manifest.bodyId) {
    throw new PortholeError(
      'manifest.bodyId must be a canonical non-empty body identity',
      'PORTHOLE_VALIDATION',
      400,
    );
  }
  return manifest;
}

/**
 * Purpose: Keep terminal perspectives closed permanently rather than reopening immutable history.
 * @param db SQLite connection for this evidence ledger.
 * @param perspectiveId Exact perspective identifier.
 * @returns Nothing; throws after a completion event exists.
 */
function assertPerspectiveOpen(db: DatabaseInstance, perspectiveId: string): void {
  const completed = db.prepare(
    "SELECT event_id FROM porthole_events WHERE perspective_id = ? AND kind = 'perspective-completed' LIMIT 1",
  ).get(perspectiveId) as { event_id: string } | undefined;
  if (completed) {
    throw new PortholeError(
      `Porthole perspective ${perspectiveId} is complete; append-only evidence cannot reopen it`,
      'PORTHOLE_CONFLICT',
      409,
    );
  }
}

export interface PortholeStoreOptions {
  db: DatabaseInstance;
  /** Dedicated raw-evidence store; callers must exclude its ids from generic GC. */
  blobs: PortholeBlobStore;
  secrets?: PortholeSecretProvider;
  vault?: VaultSealProvider;
  signatureAuthority: PortholeVerifiedSignatureAuthority;
  receiptSigner: PortholeReceiptSigner;
}

/**
 * Purpose: Construct the unexposed evidence store with separate signing and verification authorities. A dedicated blob store excluded from generic GC is required.
 * @param options Explicit operation dependencies and policy options.
 * @returns Internal start, append, completion, read, and verification operations; no service is exposed.
 */
export function createPortholeStore(options: PortholeStoreOptions) {
  const { db, blobs } = options;
  const secrets = options.secrets ?? createKeychainPortholeSecretProvider();
  const vault = options.vault ?? referenceVault;
  const signatureAuthority = options.signatureAuthority;
  const receiptSigner = options.receiptSigner;
  if (
    !signatureAuthority ||
    typeof signatureAuthority.verifyPrivacy !== 'function' ||
    typeof signatureAuthority.verifyCompleteness !== 'function'
  ) {
    throw new PortholeError(
      'Porthole requires an injected verified signature authority',
      'PORTHOLE_VALIDATION',
      500,
    );
  }
  if (!receiptSigner || typeof receiptSigner.sign !== 'function') {
    throw new PortholeError(
      'Porthole requires an injected completeness receipt signer',
      'PORTHOLE_VALIDATION',
      500,
    );
  }
  ensurePortholeSchema(db);

  /**
   * Purpose: Freeze source identity, privacy disposition, and the committed schedule before any segment is accepted.
   * @param input Typed caller input for this operation.
   * @returns The persisted manifest; a conflicting reuse is rejected.
   */
  function start(input: StartPerspectiveInput): PortholePerspective {
    const perspectiveId = input.perspectiveId?.trim() || `pov_${randomUUID().replaceAll('-', '')}`;
    const stageId = requiredString(input.stageId, 'stageId');
    const streamId = requiredString(input.streamId, 'streamId');
    const harborId = requiredString(input.harborId, 'harborId');
    const participantId = requiredString(input.participantId, 'participantId');
    const sessionId = requiredString(input.sessionId, 'sessionId');
    const bodyId = requiredString(input.bodyId, 'bodyId');
    const runId = input.runId == null ? null : requiredString(input.runId, 'runId');
    const parentPerspectiveId = input.parentPerspectiveId == null
      ? null
      : requiredString(input.parentPerspectiveId, 'parentPerspectiveId');
    const retentionPolicyId = input.retentionPolicyId == null
      ? 'porthole-device-30d'
      : requiredString(input.retentionPolicyId, 'retentionPolicyId');
    const perspectiveKinds: readonly PortholePerspectiveKind[] = [
      'terminal',
      'browser',
      'native-app',
      'cooperative-editor',
      'mobile',
      'cloud-workspace',
      'custom',
    ];
    if (!perspectiveKinds.includes(input.surface?.kind)) {
      throw new PortholeError('surface.kind is invalid', 'PORTHOLE_VALIDATION', 400);
    }
    canonicalJson(input.surface, '$.surface');
    const surfaceId = requiredString(input.surface?.surfaceId, 'surface.surfaceId');
    if (
      input.surface.descriptor?.state !== 'sealed' ||
      typeof input.surface.descriptor !== 'object'
    ) {
      throw new PortholeError('surface.descriptor must be sealed', 'PORTHOLE_VALIDATION', 400);
    }
    const descriptorEnvelopeRef = requiredString(
      input.surface.descriptor.envelopeRef,
      'surface.descriptor.envelopeRef',
    );
    const descriptorCommitment = assertSha256(
      input.surface.descriptor.commitment,
      'surface.descriptor.commitment',
    );
    if (!input.actor || !['person', 'agent'].includes(input.actor.kind)) {
      throw new PortholeError('actor.kind is invalid', 'PORTHOLE_VALIDATION', 400);
    }
    if (!['operator', 'collaborator', 'observer'].includes(input.actor.role)) {
      throw new PortholeError('actor.role is invalid', 'PORTHOLE_VALIDATION', 400);
    }
    let agentNodeId: string | null;
    let personId: string | null;
    if (input.actor.kind === 'agent') {
      agentNodeId = requiredString(input.agentNodeId, 'agentNodeId');
      if (input.actor.personId !== null) {
        throw new PortholeError('agent actors must use personId null', 'PORTHOLE_VALIDATION', 400);
      }
      if (input.actor.role === 'operator') {
        throw new PortholeError('the operator role belongs to a person actor', 'PORTHOLE_VALIDATION', 400);
      }
      personId = null;
    } else {
      if (input.agentNodeId !== undefined && input.agentNodeId !== null) {
        throw new PortholeError('person actors must use agentNodeId null', 'PORTHOLE_VALIDATION', 400);
      }
      agentNodeId = null;
      personId = requiredString(input.actor.personId, 'actor.personId');
    }
    const adapter = requiredString(input.capture?.adapter, 'capture.adapter');
    if (input.capture.visibleIndicator !== true) {
      throw new PortholeError(
        'Porthole capture requires an operator-visible recording indicator',
        'PORTHOLE_VALIDATION',
        400,
      );
    }
    if (!Array.isArray(input.capture.modalities) || input.capture.modalities.length === 0) {
      throw new PortholeError('capture.modalities must not be empty', 'PORTHOLE_VALIDATION', 400);
    }
    // Validate the full adapter-provided object before any key or ledger write.
    // JSON.stringify/toJSON coercion is intentionally not accepted because it
    // could hash one in-memory shape and persist another.
    canonicalJson(input.capture, '$.capture');
    const sourceClock = input.capture.sourceClock;
    if (!['monotonic', 'wall', 'provider', 'mixed'].includes(sourceClock)) {
      throw new PortholeError('capture.sourceClock is invalid', 'PORTHOLE_VALIDATION', 400);
    }
    if (input.privacy?.scope !== undefined && input.privacy.scope !== 'device-only') {
      throw new PortholeError(
        'raw Porthole perspectives are device-only; build a scrubbed disclosure derivative for egress',
        'PORTHOLE_VALIDATION',
        400,
      );
    }
    const redaction = input.privacy?.redaction ?? 'adapter';
    if (!['adapter', 'daemon', 'quarantined'].includes(redaction)) {
      throw new PortholeError('privacy.redaction is invalid', 'PORTHOLE_VALIDATION', 400);
    }
    const semanticPayload = input.privacy?.semanticPayload ?? 'encrypted';
    if (!['encrypted', 'scrubbed', 'omitted'].includes(semanticPayload)) {
      throw new PortholeError('privacy.semanticPayload is invalid', 'PORTHOLE_VALIDATION', 400);
    }
    if (input.privacy?.hiddenReasoningCaptured !== undefined && input.privacy.hiddenReasoningCaptured !== false) {
      throw new PortholeError(
        'Porthole never captures hidden reasoning',
        'PORTHOLE_VALIDATION',
        400,
      );
    }

    const startedAt = validDate(input.startedAt, 'startedAt');
    const captureSchedule = normalizeCaptureSchedule(input.captureSchedule, startedAt);

    const key = secrets.getHarborSecret(harborId);
    key.secret.fill(0);
    const capture: PortholePerspective['capture'] = {
      adapter,
      adapterVersion: input.capture.adapterVersion === null
        ? null
        : requiredString(input.capture.adapterVersion, 'capture.adapterVersion'),
      modalities: input.capture.modalities.map((modality, index) =>
        requiredString(modality, `capture.modalities[${index}]`) as PortholeCaptureModality),
      sourceClock,
      visibleIndicator: true,
    };
    const allowedModalities = new Set([
      'visual', 'terminal', 'dom', 'accessibility', 'editor-ops', 'input', 'audio', 'control',
    ]);
    for (const modality of capture.modalities) {
      if (!allowedModalities.has(modality)) {
        throw new PortholeError(
          `capture modality ${modality} is invalid`,
          'PORTHOLE_VALIDATION',
          400,
        );
      }
    }

    const manifest: PortholePerspective = {
      schema: PORTHOLE_PERSPECTIVE_SCHEMA,
      perspectiveId,
      stageId,
      streamId,
      harborId,
      participantId,
      actor: {
        kind: input.actor.kind,
        role: input.actor.role,
        personId,
      },
      agentNodeId,
      bodyId,
      sessionId,
      runId,
      surface: {
        surfaceId,
        kind: input.surface.kind,
        descriptor: {
          state: 'sealed',
          envelopeRef: descriptorEnvelopeRef,
          commitment: descriptorCommitment,
        },
      },
      capture,
      captureSchedule,
      privacy: {
        scope: input.privacy?.scope ?? 'device-only',
        redaction,
        semanticPayload,
        hiddenReasoningCaptured: false,
      },
      encryption: {
        suite: PORTHOLE_ENCRYPTION_SUITE,
        channelId: `porthole:${perspectiveId}`,
        epoch: PORTHOLE_KEY_EPOCH,
        keyCustody: key.keyCustody,
      },
      retention: {
        unitType: 'perspective-channel',
        unitId: perspectiveId,
        channelId: `porthole:${perspectiveId}`,
        policyId: retentionPolicyId,
        deleteAsUnit: true,
      },
      startedAt,
      parentPerspectiveId,
    };

    const result = appendPortholeEvent(db, {
      eventId: `porthole:${perspectiveId}:started`,
      perspectiveId,
      ordinal: 0,
      kind: 'perspective-started',
      occurredAt: manifest.startedAt,
      payload: manifest as unknown as Record<string, unknown>,
    });
    if (result.duplicate && canonicalJson(result.event.payload) !== canonicalJson(manifest)) {
      throw new PortholeError(
        `Porthole perspective ${perspectiveId} already exists with a different manifest`,
        'PORTHOLE_CONFLICT',
        409,
      );
    }
    return result.event.payload as unknown as PortholePerspective;
  }

  /**
   * Purpose: Reuse pd-vault channel derivation and clear the temporary harbor root afterward.
   * @param manifest Stored perspective identity, privacy, encryption, and schedule binding.
   * @returns A derived channel-key buffer the caller must clear.
   */
  function derivePerspectiveKey(manifest: PortholePerspective): Buffer {
    const keyMaterial = secrets.getHarborSecret(manifest.harborId);
    try {
      return vault.deriveChannelKey(
        keyMaterial.secret,
        manifest.encryption.channelId,
        manifest.encryption.epoch,
      );
    } finally {
      keyMaterial.secret.fill(0);
    }
  }

  /**
   * Purpose: Authenticate ciphertext, canonical payload, and privacy binding before returning evidence.
   * @param event Stored segment event to authenticate.
   * @param manifest Stored perspective identity, privacy, encryption, and schedule binding.
   * @param channelKey Derived pd-vault channel key; caller retains cleanup ownership.
   * @returns The verified decoded segment; temporary plaintext/key-adjacent buffers are cleared.
   */
  function openSegmentEvent(
    event: PortholeEvent,
    manifest: PortholePerspective,
    channelKey: Buffer,
  ): PortholeSegmentEnvelope {
    const captureIndex = validateCaptureIndex(Number(event.payload.captureIndex));
    const blobId = requiredString(event.payload.ciphertextBlobId, 'ciphertextBlobId');
    const blob = blobs.get(blobId);
    if (!blob) {
      throw new PortholeError(
        `encrypted Porthole blob ${blobId} is missing`,
        'PORTHOLE_NOT_FOUND',
        404,
      );
    }
    let nonce: Buffer | undefined;
    let ciphertext: Buffer | undefined;
    let plaintext: Buffer | undefined;
    try {
      if (blob.id !== blobId || sha256Hex(blob.buffer) !== blobId) {
        throw new PortholeError(
          'Porthole ciphertext content address is invalid',
          'PORTHOLE_DECRYPT_FAILED',
          422,
        );
      }
      const decoded = validatePortholeCiphertextEnvelope(
        parseCanonicalJson(blob.buffer, 'Porthole ciphertext envelope'),
        {
          perspectiveId: event.perspectiveId,
          captureIndex,
          harborId: manifest.harborId,
          channelId: manifest.encryption.channelId,
          epoch: manifest.encryption.epoch,
        },
      );
      const nonceText = decoded.nonceBase64url;
      nonce = Buffer.from(nonceText, 'base64url');
      const ciphertextText = decoded.ciphertextBase64;
      ciphertext = Buffer.from(ciphertextText, 'base64');
      try {
        plaintext = vault.open(channelKey, nonce, ciphertext, {
          harborId: manifest.harborId,
          channelId: manifest.encryption.channelId,
          epoch: manifest.encryption.epoch,
          seq: captureIndex,
        });
      } catch {
        throw new PortholeError(
          'Porthole segment could not be authenticated or decrypted',
          'PORTHOLE_DECRYPT_FAILED',
          422,
        );
      }
      const segment = parseCanonicalJson(plaintext, 'Porthole segment') as unknown as PortholeSegmentEnvelope;
      if (
        segment.schema !== 'pd.porthole.segment.v1' ||
        segment.perspectiveId !== event.perspectiveId ||
        segment.captureIndex !== captureIndex ||
        segment.capturedAt !== event.payload.capturedAt ||
        segment.endedAt !== event.payload.endedAt
      ) {
        throw new PortholeError(
          'Porthole sealed segment does not match its ledger reference',
          'PORTHOLE_DECRYPT_FAILED',
          422,
        );
      }
      if (!evidenceFitsCaptureSlot(manifest, captureIndex, Date.parse(segment.capturedAt),
        Date.parse(segment.endedAt ?? segment.capturedAt))) {
        throw new PortholeError('Porthole sealed segment is outside its capture slot', 'PORTHOLE_DECRYPT_FAILED', 422);
      }
      const mediaBytes = Buffer.from(requiredString(segment.mediaBase64, 'mediaBase64'), 'base64');
      let receipt: PortholePrivacyReceipt;
      try {
        if (mediaBytes.length === 0 || mediaBytes.toString('base64') !== segment.mediaBase64) {
          throw new PortholeError(
            'Porthole sealed segment media encoding is invalid',
            'PORTHOLE_DECRYPT_FAILED',
            422,
          );
        }
        const sanitizedContentHash = computePortholePrivacySubjectContentHash(
          event.perspectiveId,
          {
            captureIndex,
            capturedAt: segment.capturedAt,
            endedAt: segment.endedAt,
            mediaType: segment.mediaType,
            bytes: mediaBytes,
            semanticOverlay: segment.semanticOverlay,
            viewport: segment.viewport,
            sourceRef: segment.sourceRef,
          },
        );
        receipt = normalizePrivacyReceipt(segment.privacyReceipt, manifest, signatureAuthority, {
          captureIndex,
          sanitizedContentHash,
        });
      } finally {
        mediaBytes.fill(0);
      }
      if (privacyReceiptState(receipt) !== event.payload.privacyReceiptState) {
        throw new PortholeError(
          'Porthole sealed segment privacy state does not match its ledger reference',
          'PORTHOLE_DECRYPT_FAILED',
          422,
        );
      }
      return { ...segment, privacyReceipt: receipt };
    } catch (error) {
      if (error instanceof PortholeError && error.code === 'PORTHOLE_NOT_FOUND') throw error;
      if (error instanceof PortholeError && error.code === 'PORTHOLE_DECRYPT_FAILED') throw error;
      throw new PortholeError(
        'Porthole segment could not be authenticated or decoded',
        'PORTHOLE_DECRYPT_FAILED',
        422,
      );
    } finally {
      blob.buffer.fill(0);
      nonce?.fill(0);
      ciphertext?.fill(0);
      plaintext?.fill(0);
    }
  }

  /**
   * Purpose: Permit idempotent retry only when the authenticated stored segment equals the proposed bytes.
   * @param event Stored segment event to authenticate.
   * @param manifest Stored perspective identity, privacy, encryption, and schedule binding.
   * @param expectedPlaintext Canonical proposed plaintext bytes for exact retry comparison.
   * @param channelKey Derived pd-vault channel key; caller retains cleanup ownership.
   * @returns Whether canonical plaintext matches exactly.
   */
  function segmentPlaintextMatches(
    event: PortholeEvent,
    manifest: PortholePerspective,
    expectedPlaintext: Buffer,
    channelKey: Buffer,
  ): boolean {
    const actual = openSegmentEvent(event, manifest, channelKey);
    const actualPlaintext = Buffer.from(canonicalJson(actual), 'utf8');
    try {
      return actualPlaintext.length === expectedPlaintext.length &&
        timingSafeEqual(actualPlaintext, expectedPlaintext);
    } finally {
      actualPlaintext.fill(0);
    }
  }

  /**
   * Purpose: Validate privacy before sealing, prove blob durability before metadata commit, and reject conflicting retries.
   * @param perspectiveId Exact perspective identifier.
   * @param input Typed caller input for this operation.
   * @returns The immutable append result after the proposed segment is checked.
   */
  function appendSegment(perspectiveId: string, input: AppendSegmentInput) {
    const manifest = manifestFor(db, perspectiveId);
    assertPerspectiveOpen(db, perspectiveId);
    const captureIndex = validateCaptureIndex(input.captureIndex);
    if (
      manifest.captureSchedule.mode === 'fixed-interval' &&
      manifest.captureSchedule.boundary.kind === 'fixed-duration'
    ) {
      const scheduledCount = expectedCaptureCountFor(manifest);
      if (captureIndex >= scheduledCount) {
        throw new PortholeError(
          `captureIndex ${captureIndex} exceeds the committed schedule boundary`,
          'PORTHOLE_CONFLICT',
          409,
        );
      }
    }
    if (!Buffer.isBuffer(input.bytes) || input.bytes.length === 0) {
      throw new PortholeError('segment bytes must not be empty', 'PORTHOLE_VALIDATION', 400);
    }
    if (input.bytes.length > PORTHOLE_MAX_SEGMENT_BYTES) {
      throw new PortholeError(
        `segment exceeds ${PORTHOLE_MAX_SEGMENT_BYTES} byte limit`,
        'PORTHOLE_VALIDATION',
        413,
      );
    }
    const capturedAt = requiredDate(input.capturedAt, 'capturedAt');
    const endedAt = input.endedAt == null ? null : requiredDate(input.endedAt, 'endedAt');
    if (endedAt !== null && Date.parse(endedAt) < Date.parse(capturedAt)) {
      throw new PortholeError(
        'endedAt must not precede capturedAt',
        'PORTHOLE_VALIDATION',
        400,
      );
    }
    assertEvidenceChronology(db, manifest, captureIndex, capturedAt, endedAt);
    const mediaType = requiredString(input.mediaType, 'mediaType');
    const sanitizedContentHash = computePortholePrivacySubjectContentHash(perspectiveId, input);
    const privacyReceipt = normalizePrivacyReceipt(input.privacyReceipt, manifest, signatureAuthority, {
      captureIndex,
      sanitizedContentHash,
    });
    const envelope: PortholeSegmentEnvelope = {
      schema: 'pd.porthole.segment.v1',
      perspectiveId,
      captureIndex,
      capturedAt,
      endedAt,
      mediaType,
      mediaBase64: input.bytes.toString('base64'),
      semanticOverlay: input.semanticOverlay ?? null,
      viewport: input.viewport ?? null,
      sourceRef: input.sourceRef ?? null,
      privacyReceipt,
    };
    const plaintext = Buffer.from(canonicalJson(envelope), 'utf8');
    const ordinal = captureIndex + 1;
    let channelKey: Buffer | undefined;
    try {
      channelKey = derivePerspectiveKey(manifest);
      const existing = getEventByOrdinal(db, perspectiveId, ordinal);
      if (existing) {
        if (
          existing.kind === 'segment-recorded' &&
          segmentPlaintextMatches(existing, manifest, plaintext, channelKey)
        ) {
          return { event: existing, duplicate: true };
        }
        throw new PortholeError(
          `captureIndex ${captureIndex} already contains different evidence`,
          'PORTHOLE_CONFLICT',
          409,
        );
      }

      const nonce = vault.randomNonce();
      const aad: SealAad = {
        harborId: manifest.harborId,
        channelId: manifest.encryption.channelId,
        epoch: manifest.encryption.epoch,
        seq: captureIndex,
      };
      const ciphertext = vault.seal(channelKey, nonce, plaintext, aad);
      const ciphertextEnvelope: PortholeCiphertextEnvelope = {
        schema: 'pd.porthole.ciphertext-envelope.v1',
        perspectiveId,
        captureIndex,
        encryptionSuite: PORTHOLE_ENCRYPTION_SUITE,
        aad,
        nonceBase64url: nonce.toString('base64url'),
        ciphertextBase64: ciphertext.toString('base64'),
      };
      validatePortholeCiphertextEnvelope(ciphertextEnvelope, {
        perspectiveId,
        captureIndex,
        harborId: manifest.harborId,
        channelId: manifest.encryption.channelId,
        epoch: manifest.encryption.epoch,
      });
      const persistedCiphertext = Buffer.from(canonicalJson(ciphertextEnvelope), 'utf8');
      let blob: ReturnType<BlobStore['put']>;
      try {
        blob = blobs.put(persistedCiphertext, {
          contentType: 'application/vnd.portdaddy.porthole-segment+encrypted',
        });
        syncAndVerifyBlob(blobs, blob.id, persistedCiphertext);
      } finally {
        persistedCiphertext.fill(0);
        ciphertext.fill(0);
      }
      const payload: Record<string, unknown> = {
        schema: 'pd.porthole.segment-ref.v1',
        perspectiveId,
        captureIndex,
        capturedAt,
        endedAt,
        ciphertextBlobId: blob.id,
        encryptionSuite: PORTHOLE_ENCRYPTION_SUITE,
        redactionState: manifest.privacy.redaction,
        privacyReceiptState: privacyReceiptState(privacyReceipt),
      };
      const result = appendPortholeEvent(db, {
        eventId: `porthole:${perspectiveId}:capture:${captureIndex}`,
        perspectiveId,
        ordinal,
        kind: 'segment-recorded',
        occurredAt: capturedAt,
        payload,
      }, { requireOpen: true });
      if (result.duplicate) {
        if (
          result.event.kind === 'segment-recorded' &&
          segmentPlaintextMatches(result.event, manifest, plaintext, channelKey)
        ) {
          return result;
        }
        throw new PortholeError(
          `captureIndex ${captureIndex} was concurrently recorded with different evidence`,
          'PORTHOLE_CONFLICT',
          409,
        );
      }
      return result;
    } finally {
      channelKey?.fill(0);
      plaintext.fill(0);
    }
  }

  /**
   * Purpose: Represent an absent capture slot explicitly without inventing a recorded segment.
   * @param perspectiveId Exact perspective identifier.
   * @param input Typed caller input for this operation.
   * @returns The immutable gap append result.
   */
  function appendGap(perspectiveId: string, input: AppendGapInput) {
    const manifest = manifestFor(db, perspectiveId);
    assertPerspectiveOpen(db, perspectiveId);
    const captureIndex = validateCaptureIndex(input.captureIndex);
    if (
      manifest.captureSchedule.mode === 'fixed-interval' &&
      manifest.captureSchedule.boundary.kind === 'fixed-duration'
    ) {
      const scheduledCount = expectedCaptureCountFor(manifest);
      if (captureIndex >= scheduledCount) {
        throw new PortholeError(
          `captureIndex ${captureIndex} exceeds the committed schedule boundary`,
          'PORTHOLE_CONFLICT',
          409,
        );
      }
    }
    const occurredAt = validDate(input.occurredAt, 'occurredAt');
    const gapReasons: readonly AppendGapInput['reason'][] = [
      'permission-denied',
      'window-hidden',
      'window-gone',
      'recorder-suspended',
      'adapter-error',
      'redacted',
      'unknown',
    ];
    if (!gapReasons.includes(input.reason)) {
      throw new PortholeError('capture gap reason is invalid', 'PORTHOLE_VALIDATION', 400);
    }
    if (input.durationMs !== undefined && input.durationMs !== null &&
        (!Number.isSafeInteger(input.durationMs) || input.durationMs < 0)) {
      throw new PortholeError(
        'durationMs must be a non-negative safe integer',
        'PORTHOLE_VALIDATION',
        400,
      );
    }
    const gapEndedAt = input.durationMs == null
      ? null
      : new Date(Date.parse(occurredAt) + input.durationMs).toISOString();
    assertEvidenceChronology(db, manifest, captureIndex, occurredAt, gapEndedAt);
    const payload: Record<string, unknown> = {
      schema: 'pd.porthole.capture-gap.v1',
      perspectiveId,
      captureIndex,
      occurredAt,
      durationMs: input.durationMs ?? null,
      reason: input.reason,
      // Free-form diagnostics can contain window titles, URLs, or secrets.
      // Seal them as a semantic segment; the public ledger records only
      // that a detail was intentionally withheld.
      detailState: input.detail ? 'withheld' : 'none',
    };
    const result = appendPortholeEvent(db, {
      eventId: `porthole:${perspectiveId}:capture:${captureIndex}`,
      perspectiveId,
      ordinal: captureIndex + 1,
      kind: 'capture-gap',
      occurredAt,
      payload,
    }, { requireOpen: true });
    if (result.duplicate && canonicalJson(result.event.payload) !== canonicalJson(payload)) {
      throw new PortholeError(
        `captureIndex ${captureIndex} already contains a different gap receipt`,
        'PORTHOLE_CONFLICT',
        409,
      );
    }
    return result;
  }

  /**
   * Purpose: Distinguish missing ciphertext, invalid evidence, and quarantine instead of calling ledger rows complete.
   * @param manifest Stored perspective identity, privacy, encryption, and schedule binding.
   * @param segments Recorded segment events to inspect.
   * @param chain Independently computed metadata-chain verdict.
   * @param chronologyValid Independent per-slot timing verdict for all segments and gaps.
   * @returns A per-segment verification report combined with the supplied chain verdict.
   */
  function inspectSegmentEvidence(
    manifest: PortholePerspective,
    segments: PortholeEvent[],
    chain: { valid: boolean; checked: number; error?: string },
    chronologyValid: boolean,
  ): PortholeEvidenceVerification {
    const issues: PortholeEvidenceIssue[] = [];
    let missingCiphertextCount = 0;
    let invalidCiphertextCount = 0;
    let quarantinedSegmentCount = 0;
    let channelKey: Buffer | undefined;
    try {
      if (segments.length > 0) channelKey = derivePerspectiveKey(manifest);
      for (const event of segments) {
        const captureIndex = Number.isSafeInteger(event.payload.captureIndex)
          ? Number(event.payload.captureIndex)
          : Math.max(0, event.ordinal - 1);
        try {
          const segment = openSegmentEvent(event, manifest, channelKey as Buffer);
          if (privacyReceiptState(segment.privacyReceipt) === 'quarantined') {
            quarantinedSegmentCount += 1;
            issues.push({ captureIndex, code: 'privacy-quarantined' });
          }
        } catch (error) {
          if (error instanceof PortholeError && error.code === 'PORTHOLE_NOT_FOUND') {
            missingCiphertextCount += 1;
            issues.push({ captureIndex, code: 'ciphertext-missing' });
          } else {
            invalidCiphertextCount += 1;
            issues.push({ captureIndex, code: 'ciphertext-invalid' });
          }
        }
      }
    } finally {
      channelKey?.fill(0);
    }
    return {
      valid: chain.valid && chronologyValid && issues.length === 0,
      chronologyValid,
      chain,
      checkedSegmentCount: segments.length,
      missingCiphertextCount,
      invalidCiphertextCount,
      quarantinedSegmentCount,
      issues,
    };
  }

  /**
   * Purpose: Recheck ordered evidence against opening, closing, and committed fixed-duration bounds.
   * @param manifest Stored perspective identity, privacy, encryption, and schedule binding.
   * @param evidenceEvents Ordered segment and gap events.
   * @param closedAt Proposed terminal timestamp.
   * @returns False for inconsistent time, index, event kind, or gap duration.
   */
  function evidenceChronologyIsValid(
    manifest: PortholePerspective,
    evidenceEvents: PortholeEvent[],
    closedAt: string,
  ): boolean {
    const opened = Date.parse(manifest.startedAt);
    const closed = Date.parse(closedAt);
    if (!Number.isFinite(opened) || !Number.isFinite(closed) || closed < opened) return false;
    const fixedBoundary = manifest.captureSchedule.boundary.kind === 'fixed-duration' &&
      manifest.captureSchedule.boundary.durationMs !== null
      ? opened + manifest.captureSchedule.boundary.durationMs
      : null;
    let previous = opened;
    let expectedIndex = 0;
    for (const event of evidenceEvents) {
      const occurred = Date.parse(event.occurredAt);
      let ended = occurred;
      const captureIndex = event.ordinal - 1;
      if (
        !Number.isFinite(occurred) ||
        occurred < previous ||
        occurred > closed ||
        (fixedBoundary !== null && occurred > fixedBoundary) ||
        !Number.isSafeInteger(event.payload.captureIndex) ||
        captureIndex !== expectedIndex ||
        Number(event.payload.captureIndex) !== captureIndex
      ) {
        return false;
      }
      if (event.kind === 'segment-recorded') {
        if (event.payload.capturedAt !== event.occurredAt) return false;
        if (event.payload.endedAt !== null) {
          if (typeof event.payload.endedAt !== 'string') return false;
          ended = Date.parse(event.payload.endedAt);
          if (
            !Number.isFinite(ended) ||
            ended < occurred ||
            ended > closed ||
            (fixedBoundary !== null && ended > fixedBoundary)
          ) {
            return false;
          }
        }
      } else if (event.kind === 'capture-gap') {
        if (event.payload.occurredAt !== event.occurredAt) return false;
        const duration = event.payload.durationMs;
        if (duration !== null) {
          if (!Number.isSafeInteger(duration) || Number(duration) < 0) return false;
          ended = occurred + Number(duration);
          if (ended > closed || (fixedBoundary !== null && ended > fixedBoundary)) return false;
        }
      } else {
        return false;
      }
      if (!evidenceFitsCaptureSlot(manifest, captureIndex, occurred, ended)) return false;
      previous = occurred;
      expectedIndex += 1;
    }
    return true;
  }

  /**
   * Purpose: Tie the signed receipt to its unique ledger event, terminal commitment, and recomputed evidence totals.
   * @param manifest Stored perspective identity, privacy, encryption, and schedule binding.
   * @param receipt Receipt material to validate, hash, or encode.
   * @returns Whether the stored receipt and its supporting evidence agree.
   */
  function storedReceiptIsValid(
    manifest: PortholePerspective,
    receipt: PortholeCompletenessReceipt,
  ): boolean {
    if (!verifyCompletenessReceiptSignature(receipt, manifest, signatureAuthority)) return false;
    const receiptRows = db.prepare(
      "SELECT * FROM porthole_events WHERE perspective_id = ? AND kind = 'completeness-receipt-issued' ORDER BY ordinal",
    ).all(manifest.perspectiveId) as PortholeEventRow[];
    if (receiptRows.length !== 1) return false;
    const receiptEvent = rowToEvent(receiptRows[0]);
    const terminalRow = db.prepare(
      'SELECT * FROM porthole_events WHERE event_id = ? AND perspective_id = ?',
    ).get(
      receipt.streamBoundary.terminalEventId,
      manifest.perspectiveId,
    ) as PortholeEventRow | undefined;
    if (!terminalRow) return false;
    const terminal = rowToEvent(terminalRow);
    if (
      terminal.kind !== 'perspective-completed' ||
      receiptEvent.eventId !== `porthole:${manifest.perspectiveId}:receipt` ||
      receiptEvent.kind !== 'completeness-receipt-issued' ||
      receiptEvent.ordinal !== terminal.ordinal + 1 ||
      receiptEvent.prevHash !== terminal.contentHash ||
      receiptEvent.occurredAt !== receipt.issuedAt ||
      canonicalJson(receiptEvent.payload) !== canonicalJson(receipt) ||
      terminal.contentHash !== receipt.streamBoundary.terminalEventCommitment ||
      terminal.contentHash !== receipt.chainHeadHash ||
      terminal.occurredAt !== receipt.streamBoundary.closedAt ||
      terminal.payload.schema !== 'pd.porthole.stream-terminal.v1' ||
      terminal.payload.stageId !== manifest.stageId ||
      terminal.payload.streamId !== manifest.streamId ||
      terminal.payload.scheduleId !== manifest.captureSchedule.scheduleId ||
      terminal.payload.scheduleCommitmentHash !== manifest.captureSchedule.commitmentHash ||
      terminal.payload.stopReason !== receipt.stopReason ||
      terminal.payload.closedAt !== receipt.streamBoundary.closedAt
    ) {
      return false;
    }
    const finalRow = db.prepare(
      'SELECT event_id FROM porthole_events WHERE perspective_id = ? ORDER BY ordinal DESC LIMIT 1',
    ).get(manifest.perspectiveId) as { event_id: string } | undefined;
    if (finalRow?.event_id !== receiptEvent.eventId) return false;
    let expectedCaptureCount: number;
    try {
      expectedCaptureCount = expectedCaptureCountFor(manifest, receipt.streamBoundary.closedAt);
    } catch {
      return false;
    }
    const expectedFirst = expectedCaptureCount === 0 ? null : 0;
    const expectedLast = expectedCaptureCount === 0 ? null : expectedCaptureCount - 1;
    const evidenceRows = db.prepare(
      'SELECT * FROM porthole_events WHERE perspective_id = ? AND ordinal > 0 AND ordinal < ? ORDER BY ordinal',
    ).all(manifest.perspectiveId, terminal.ordinal) as PortholeEventRow[];
    const evidenceEvents = evidenceRows.map(rowToEvent);
    const recordedSegmentCount = evidenceEvents.filter((event) => event.kind === 'segment-recorded').length;
    const declaredGapCount = evidenceEvents.filter((event) => event.kind === 'capture-gap').length;
    const observedCount = recordedSegmentCount + declaredGapCount;
    if (
      receipt.expectedCaptureCount !== expectedCaptureCount ||
      receipt.streamBoundary.firstCaptureIndex !== expectedFirst ||
      receipt.streamBoundary.lastCaptureIndex !== expectedLast ||
      terminal.ordinal !== observedCount + 1 ||
      receipt.recordedSegmentCount !== recordedSegmentCount ||
      receipt.declaredGapCount !== declaredGapCount ||
      receipt.missingCaptureCount !== expectedCaptureCount - observedCount ||
      !evidenceChronologyIsValid(manifest, evidenceEvents, receipt.streamBoundary.closedAt) ||
      terminal.payload.expectedCaptureCount !== expectedCaptureCount ||
      (receipt.status === 'complete' &&
        (receipt.unreadableSegmentCount !== 0 ||
          receipt.declaredGapCount !== 0 ||
          receipt.missingCaptureCount !== 0)) ||
      (receipt.status === 'failed' && receipt.verifiedSegmentCount !== 0)
    ) {
      return false;
    }
    return verifyChain(manifest.perspectiveId).valid;
  }

  /**
   * Purpose: Commit terminal evidence and its independently checked completeness receipt atomically; retries must agree.
   * @param perspectiveId Exact perspective identifier.
   * @param input Typed caller input for this operation.
   * @returns The persisted signed completeness receipt.
   */
  function complete(perspectiveId: string, input: CompletePerspectiveInput): PortholeCompletenessReceipt {
    const stopReasons: readonly CompletePerspectiveInput['stopReason'][] = [
      'operator',
      'body-stopped',
      'session-ended',
      'permission-revoked',
      'adapter-failed',
      'retention-limit',
      'unknown',
    ];
    if (!stopReasons.includes(input.stopReason)) {
      throw new PortholeError('stopReason is invalid', 'PORTHOLE_VALIDATION', 400);
    }
    const requestedClosedAt = input.closedAt === undefined
      ? undefined
      : validDate(input.closedAt, 'closedAt');
    return runImmediateTransaction(db, () => {
      const manifest = manifestFor(db, perspectiveId);
      const existingReceipt = db.prepare(
        "SELECT * FROM porthole_events WHERE perspective_id = ? AND kind = 'completeness-receipt-issued'",
      ).get(perspectiveId) as PortholeEventRow | undefined;
      if (existingReceipt) {
        const receipt = rowToEvent(existingReceipt).payload as unknown as PortholeCompletenessReceipt;
        const closedAtMatches = requestedClosedAt === undefined ||
          receipt.streamBoundary.closedAt === requestedClosedAt;
        if (
          receipt.stopReason !== input.stopReason ||
          !closedAtMatches ||
          !storedReceiptIsValid(manifest, receipt)
        ) {
          throw new PortholeError(
            `Porthole perspective ${perspectiveId} is already completed with a different receipt`,
            'PORTHOLE_CONFLICT',
            409,
          );
        }
        return receipt;
      }
      const orphanTerminal = db.prepare(
        "SELECT event_id FROM porthole_events WHERE perspective_id = ? AND kind = 'perspective-completed'",
      ).get(perspectiveId) as { event_id: string } | undefined;
      if (orphanTerminal) {
        throw new PortholeError(
          `Porthole perspective ${perspectiveId} has a terminal event without a valid signed receipt`,
          'PORTHOLE_CONFLICT',
          409,
        );
      }

      const closedAt = requestedClosedAt ?? new Date().toISOString();
      const expectedCaptureCount = expectedCaptureCountFor(manifest, closedAt);

      const rows = db.prepare(
        "SELECT * FROM porthole_events WHERE perspective_id = ? AND kind IN ('segment-recorded', 'capture-gap') ORDER BY ordinal",
      ).all(perspectiveId) as PortholeEventRow[];
      const evidenceEvents = rows.map(rowToEvent);
      const segments = evidenceEvents.filter((event) => event.kind === 'segment-recorded');
      const gaps = evidenceEvents.filter((event) => event.kind === 'capture-gap');
      const observed = segments.length + gaps.length;
      if (observed > expectedCaptureCount) {
        throw new PortholeError(
          `committed schedule allows ${expectedCaptureCount} capture slots but ${observed} were recorded`,
          'PORTHOLE_CONFLICT',
          409,
        );
      }
      if (!evidenceChronologyIsValid(manifest, evidenceEvents, closedAt)) {
        throw new PortholeError(
          'Porthole evidence chronology does not fit the committed stream boundary',
          'PORTHOLE_CONFLICT',
          409,
        );
      }
      const chain = verifyChain(perspectiveId);
      if (!chain.valid) {
        throw new PortholeError(
          'Porthole cannot issue a signed receipt over an invalid append-only chain',
          'PORTHOLE_CONFLICT',
          409,
        );
      }
      const verification = inspectSegmentEvidence(manifest, segments, chain, true);
      const unreadableSegmentCount =
        verification.missingCiphertextCount +
        verification.invalidCiphertextCount +
        verification.quarantinedSegmentCount;
      const verifiedSegmentCount =
        segments.length - unreadableSegmentCount;
      const missingCaptureCount = Math.max(0, expectedCaptureCount - observed);
      const status: PortholeCompletenessReceipt['status'] =
        verifiedSegmentCount === 0
          ? 'failed'
          : gaps.length === 0 &&
              missingCaptureCount === 0 &&
              unreadableSegmentCount === 0
            ? 'complete'
            : 'partial';
      const terminalOrdinal = (evidenceEvents.at(-1)?.ordinal ?? 0) + 1;
      const terminalEventId = `porthole:${perspectiveId}:terminal`;
      const terminal = appendPortholeEventLocked(db, {
        eventId: terminalEventId,
        perspectiveId,
        ordinal: terminalOrdinal,
        kind: 'perspective-completed',
        occurredAt: closedAt,
        payload: {
          schema: 'pd.porthole.stream-terminal.v1',
          perspectiveId,
          stageId: manifest.stageId,
          streamId: manifest.streamId,
          scheduleId: manifest.captureSchedule.scheduleId,
          scheduleCommitmentHash: manifest.captureSchedule.commitmentHash,
          expectedCaptureCount,
          stopReason: input.stopReason,
          closedAt,
        },
      }, true);
      if (terminal.duplicate) {
        throw new PortholeError('terminal event race was not idempotent', 'PORTHOLE_CONFLICT', 409);
      }
      const issuedAt = new Date(Math.max(Date.now(), Date.parse(closedAt))).toISOString();
      const unsignedReceipt: UnsignedPortholeCompletenessReceipt = {
        schema: PORTHOLE_RECEIPT_SCHEMA,
        receiptId: `povr_${randomUUID().replaceAll('-', '')}`,
        perspectiveId,
        stageId: manifest.stageId,
        schedule: {
          scheduleId: manifest.captureSchedule.scheduleId,
          commitmentHash: manifest.captureSchedule.commitmentHash,
        },
        streamBoundary: {
          streamId: manifest.streamId,
          channelId: manifest.encryption.channelId,
          firstCaptureIndex: expectedCaptureCount === 0 ? null : 0,
          lastCaptureIndex: expectedCaptureCount === 0 ? null : expectedCaptureCount - 1,
          openedAt: manifest.startedAt,
          closedAt,
          terminalEventId,
          terminalEventCommitment: terminal.event.contentHash,
        },
        status,
        expectedCaptureCount,
        recordedSegmentCount: segments.length,
        verifiedSegmentCount,
        unreadableSegmentCount,
        declaredGapCount: gaps.length,
        missingCaptureCount,
        chainHeadHash: terminal.event.contentHash,
        encryptionSuite: PORTHOLE_ENCRYPTION_SUITE,
        stopReason: input.stopReason,
        issuer: {
          harborId: manifest.harborId,
          bodyId: manifest.bodyId,
          participantId: manifest.participantId,
          signingKeyId: requiredString(receiptSigner.signingKeyId, 'receiptSigner.signingKeyId'),
        },
        issuedAt,
      };
      const contentHash = portholeCompletenessContentHash(unsignedReceipt);
      const message = portholeCompletenessReceiptSigningMessage({ ...unsignedReceipt, contentHash });
      let signatureBytes: Buffer | undefined;
      let receipt: PortholeCompletenessReceipt;
      try {
        signatureBytes = receiptSigner.sign({
          harborId: manifest.harborId,
          bodyId: manifest.bodyId,
          participantId: manifest.participantId,
          stageId: manifest.stageId,
          perspectiveId: manifest.perspectiveId,
          streamId: manifest.streamId,
          contentHash,
        }, message);
        if (!Buffer.isBuffer(signatureBytes) || signatureBytes.length !== 64) {
          throw new PortholeError(
            'Porthole receipt signer did not return an Ed25519 signature',
            'PORTHOLE_KEYSTORE_UNAVAILABLE',
            503,
          );
        }
        receipt = {
          ...unsignedReceipt,
          contentHash,
          signature: {
            algorithm: 'ed25519',
            keyId: unsignedReceipt.issuer.signingKeyId,
            value: signatureBytes.toString('base64url'),
          },
        };
      } finally {
        signatureBytes?.fill(0);
        message.fill(0);
      }
      if (!verifyCompletenessReceiptSignature(receipt, manifest, signatureAuthority)) {
        throw new PortholeError(
          'Porthole receipt failed local content-hash or Ed25519 verification',
          'PORTHOLE_CONFLICT',
          409,
        );
      }
      const result = appendPortholeEventLocked(db, {
        eventId: `porthole:${perspectiveId}:receipt`,
        perspectiveId,
        ordinal: terminalOrdinal + 1,
        kind: 'completeness-receipt-issued',
        occurredAt: receipt.issuedAt,
        payload: receipt as unknown as Record<string, unknown>,
      }, false);
      if (result.duplicate && canonicalJson(result.event.payload) !== canonicalJson(receipt)) {
        throw new PortholeError(
          `Porthole perspective ${perspectiveId} was concurrently completed with a different receipt`,
          'PORTHOLE_CONFLICT',
          409,
        );
      }
      const storedReceipt = result.event.payload as unknown as PortholeCompletenessReceipt;
      if (!storedReceiptIsValid(manifest, storedReceipt)) {
        throw new PortholeError(
          'Porthole receipt does not seal the final append-only stream boundary',
          'PORTHOLE_CONFLICT',
          409,
        );
      }
      return storedReceipt;
    });
  }

  /**
   * Purpose: Bound manifest listing and reject an invalid stored receipt rather than presenting a success-shaped summary.
   * @param limit Maximum requested listing length, clamped to 1 through 200.
   * @returns Up to 200 newest manifests with their validated terminal receipts when present.
   */
  function list(limit = 50): Array<{
    manifest: PortholePerspective;
    receipt: PortholeCompletenessReceipt | null;
  }> {
    const bounded = Math.max(1, Math.min(limit, 200));
    const starts = db.prepare(
      "SELECT * FROM porthole_events WHERE kind = 'perspective-started' ORDER BY event_seq DESC LIMIT ?",
    ).all(bounded) as PortholeEventRow[];
    return starts.map((row) => {
      const manifest = manifestFor(db, row.perspective_id);
      const completed = db.prepare(
        "SELECT * FROM porthole_events WHERE perspective_id = ? AND kind = 'completeness-receipt-issued'",
      ).get(manifest.perspectiveId) as PortholeEventRow | undefined;
      const receipt = completed
        ? rowToEvent(completed).payload as unknown as PortholeCompletenessReceipt
        : null;
      if (receipt && !storedReceiptIsValid(manifest, receipt)) {
        throw new PortholeError(
          `Porthole perspective ${manifest.perspectiveId} has an invalid signed receipt`,
          'PORTHOLE_CONFLICT',
          409,
        );
      }
      return {
        manifest,
        receipt,
      };
    });
  }

  /**
   * Purpose: Read one perspective's ordered metadata history without decrypting segment content.
   * @param perspectiveId Exact perspective identifier.
   * @returns The ordered events; this alone is not a cryptographic verification.
   */
  function events(perspectiveId: string): PortholeEvent[] {
    startEvent(db, perspectiveId);
    const rows = db.prepare(
      'SELECT * FROM porthole_events WHERE perspective_id = ? ORDER BY ordinal',
    ).all(perspectiveId) as PortholeEventRow[];
    return rows.map(rowToEvent);
  }

  /**
   * Purpose: Resolve and authenticate the exact requested capture slot using the manifest's channel key.
   * @param perspectiveId Exact perspective identifier.
   * @param captureIndex Zero-based capture slot.
   * @returns The decoded authenticated segment, or an error for missing/invalid evidence.
   */
  function readSegment(perspectiveId: string, captureIndex: number): PortholeSegmentEnvelope {
    const manifest = manifestFor(db, perspectiveId);
    const index = validateCaptureIndex(captureIndex);
    const event = getEventByOrdinal(db, perspectiveId, index + 1);
    if (!event || event.kind !== 'segment-recorded') {
      throw new PortholeError(
        `Porthole segment ${perspectiveId}/${index} not found`,
        'PORTHOLE_NOT_FOUND',
        404,
      );
    }
    let channelKey: Buffer | undefined;
    try {
      channelKey = derivePerspectiveKey(manifest);
      return openSegmentEvent(event, manifest, channelKey);
    } finally {
      channelKey?.fill(0);
    }
  }

  /**
   * Purpose: Recompute event commitments and predecessor links rather than trusting stored hash fields.
   * @param perspectiveId Exact perspective identifier.
   * @returns A chain verdict and checked count; this does not verify blob retention or signatures.
   */
  function verifyChain(perspectiveId: string): { valid: boolean; checked: number; error?: string } {
    const stream = events(perspectiveId);
    let prior: string | null = null;
    for (const event of stream) {
      if (event.prevHash !== prior) {
        return { valid: false, checked: event.ordinal, error: `prevHash mismatch at ordinal ${event.ordinal}` };
      }
      const recomputed = sha256(canonicalJson({
        eventId: event.eventId,
        perspectiveId: event.perspectiveId,
        ordinal: event.ordinal,
        kind: event.kind,
        occurredAt: event.occurredAt,
        payload: event.payload,
        prevHash: event.prevHash,
      }));
      if (recomputed !== event.contentHash) {
        return { valid: false, checked: event.ordinal, error: `contentHash mismatch at ordinal ${event.ordinal}` };
      }
      prior = event.contentHash;
    }
    return { valid: true, checked: stream.length };
  }

  /**
   * Purpose: Combine ledger-chain checks with ciphertext availability, authentication, and privacy disposition.
   * @param perspectiveId Exact perspective identifier.
   * @returns The full stored-segment verification report.
   */
  function verifyEvidence(perspectiveId: string): PortholeEvidenceVerification {
    const manifest = manifestFor(db, perspectiveId);
    const stream = events(perspectiveId);
    const segments = stream.filter((event) => event.kind === 'segment-recorded');
    const evidenceEvents = stream.filter((event) => event.kind === 'segment-recorded' || event.kind === 'capture-gap');
    const closedAt = stream.find((event) => event.kind === 'perspective-completed')?.occurredAt ??
      new Date(Date.parse(manifest.startedAt) + manifest.captureSchedule.boundary.durationMs).toISOString();
    const chronologyValid = evidenceChronologyIsValid(manifest, evidenceEvents, closedAt);
    return inspectSegmentEvidence(manifest, segments, verifyChain(perspectiveId), chronologyValid);
  }

  /**
   * Purpose: Expose missing and invalid terminal receipts as explicit negative outcomes.
   * @param perspectiveId Exact perspective identifier.
   * @returns A validity verdict with a bounded error code when invalid.
   */
  function verifyReceipt(perspectiveId: string): { valid: boolean; error?: string } {
    const manifest = manifestFor(db, perspectiveId);
    const row = db.prepare(
      "SELECT * FROM porthole_events WHERE perspective_id = ? AND kind = 'completeness-receipt-issued'",
    ).get(perspectiveId) as PortholeEventRow | undefined;
    if (!row) return { valid: false, error: 'receipt-missing' };
    const receipt = rowToEvent(row).payload as unknown as PortholeCompletenessReceipt;
    return storedReceiptIsValid(manifest, receipt)
      ? { valid: true }
      : { valid: false, error: 'receipt-invalid' };
  }

  return {
    start,
    appendSegment,
    appendGap,
    complete,
    list,
    events,
    readSegment,
    verifyChain,
    verifyEvidence,
    verifyReceipt,
  };
}

export type PortholeStore = ReturnType<typeof createPortholeStore>;
