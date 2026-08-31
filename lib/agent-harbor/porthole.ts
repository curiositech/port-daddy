/**
 * Porthole — universal first-person evidence storage.
 *
 * Porthole records what an operator or embodied agent could actually observe:
 * window pixels, terminal bytes, accessibility/DOM/editor annotations, input
 * receipts, and explicit gaps. It does not infer or claim hidden reasoning.
 *
 * The metadata ledger is append-only and independently hash-chained per
 * perspective. Segment payloads are sealed before they enter the ordinary blob
 * store using the pd-vault parity-gated XChaCha20-Poly1305 implementation. The
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
  mode: 'fixed-interval' | 'event-driven';
  samplingIntervalMs: number | null;
  boundary: {
    kind: 'fixed-duration' | 'event-delimited' | 'operator-stop';
    durationMs: number | null;
    terminalEventKind: string | null;
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

/** Verification-only authority for privacy-pipeline attestations. */
export interface PortholePrivacyAuthority {
  verify(
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
}

/** Signing authority for terminal completeness receipts, with local verify. */
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
  verify(
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

export interface PortholeEvidenceIssue {
  captureIndex: number;
  code: 'ciphertext-missing' | 'ciphertext-invalid' | 'privacy-quarantined';
}

export interface PortholeEvidenceVerification {
  valid: boolean;
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
`;

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

function sha256(bytes: string | Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function sha256Hex(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

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

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new PortholeError(`${field} must be a non-empty string`, 'PORTHOLE_VALIDATION', 400);
  }
  return value.trim();
}

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

function requiredDate(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new PortholeError(`${field} must be an RFC 3339 date-time`, 'PORTHOLE_VALIDATION', 400);
  }
  return validDate(value, field);
}

function assertSha256(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new PortholeError(`${field} must be a sha256 commitment`, 'PORTHOLE_VALIDATION', 400);
  }
  return value;
}

type CaptureScheduleCommitmentMaterial = Omit<PortholeCaptureSchedule, 'commitmentHash'>;

export function computePortholeScheduleCommitment(
  schedule: CaptureScheduleCommitmentMaterial,
): string {
  return sha256(canonicalJson({
    domain: 'pd.porthole.capture-schedule.v1',
    schedule,
  }));
}

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
  if (mode !== 'fixed-interval' && mode !== 'event-driven') {
    throw new PortholeError('captureSchedule.mode is invalid', 'PORTHOLE_VALIDATION', 400);
  }
  const samplingIntervalMs = input.samplingIntervalMs;
  if (
    (mode === 'fixed-interval' && (!Number.isSafeInteger(samplingIntervalMs) || Number(samplingIntervalMs) < 1)) ||
    (mode === 'event-driven' && samplingIntervalMs !== null)
  ) {
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
    (kind === 'fixed-duration' &&
      (!Number.isSafeInteger(durationMs) || Number(durationMs) < 1 || terminalEventKind !== null)) ||
    (kind === 'event-delimited' &&
      (durationMs !== null || typeof terminalEventKind !== 'string' || terminalEventKind.trim().length === 0)) ||
    (kind === 'operator-stop' && (durationMs !== null || terminalEventKind !== null)) ||
    !['fixed-duration', 'event-delimited', 'operator-stop'].includes(String(kind))
  ) {
    throw new PortholeError('captureSchedule.boundary is internally inconsistent', 'PORTHOLE_VALIDATION', 400);
  }
  const committedAt = requiredDate(input.committedAt, 'captureSchedule.committedAt');
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
    samplingIntervalMs: samplingIntervalMs as number | null,
    boundary: {
      kind: kind as PortholeCaptureSchedule['boundary']['kind'],
      durationMs: durationMs as number | null,
      terminalEventKind: terminalEventKind === null ? null : String(terminalEventKind).trim(),
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

function expectedCaptureCountFor(
  manifest: PortholePerspective,
  closedAt?: string,
): number {
  const schedule = manifest.captureSchedule;
  const { commitmentHash, ...material } = schedule;
  if (computePortholeScheduleCommitment(material) !== commitmentHash) {
    throw new PortholeError('capture schedule commitment is invalid', 'PORTHOLE_CONFLICT', 409);
  }
  if (schedule.mode !== 'fixed-interval' || schedule.samplingIntervalMs === null) {
    throw new PortholeError(
      'event-driven schedules require a proven terminal event counter before completeness can be issued',
      'PORTHOLE_CONFLICT',
      409,
    );
  }
  let durationMs: number;
  if (schedule.boundary.kind === 'fixed-duration' && schedule.boundary.durationMs !== null) {
    durationMs = schedule.boundary.durationMs;
    if (closedAt !== undefined && Date.parse(closedAt) < Date.parse(manifest.startedAt) + durationMs) {
      throw new PortholeError('fixed-duration capture closed before its committed boundary', 'PORTHOLE_CONFLICT', 409);
    }
  } else if (schedule.boundary.kind === 'operator-stop') {
    throw new PortholeError(
      'operator-stop schedules require an authorized terminal stage-event counter before completeness can be issued',
      'PORTHOLE_CONFLICT',
      409,
    );
  } else {
    throw new PortholeError(
      'event-delimited schedules require a terminal stage-event proof before completeness can be issued',
      'PORTHOLE_CONFLICT',
      409,
    );
  }
  return Math.floor(durationMs / schedule.samplingIntervalMs);
}

function validateCaptureIndex(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new PortholeError('captureIndex must be a non-negative integer', 'PORTHOLE_VALIDATION', 400);
  }
  return value;
}

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
}

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

export function computePortholePrivacyReceiptContentHash(
  receipt: UnsignedPortholePrivacyReceipt,
): string {
  return sha256(canonicalJson({
    domain: 'pd.porthole.privacy-receipt-content.v1',
    schema: 'pd.porthole.privacy-receipt.v1',
    receipt,
  }));
}

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

function normalizePrivacyReceipt(
  value: unknown,
  manifest: PortholePerspective,
  authority: PortholePrivacyAuthority,
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
    if (!authority.verify({
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

function privacyReceiptState(receipt: PortholePrivacyReceipt): 'verified' | 'quarantined' {
  return receipt.secretScan === 'passed' && receipt.redactionDisposition === 'scrubbed'
    ? 'verified'
    : 'quarantined';
}

type UnsignedPortholeCompletenessReceipt = Omit<
  PortholeCompletenessReceipt,
  'contentHash' | 'signature'
>;

function normalizeCompletenessReceipt(value: unknown): PortholeCompletenessReceipt {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PortholeError('completeness receipt must be an object', 'PORTHOLE_VALIDATION', 400);
  }
  const input = JSON.parse(canonicalJson(value, '$.completenessReceipt')) as Record<string, unknown>;
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
  const integer = (candidate: unknown, field: string): number => {
    if (!Number.isSafeInteger(candidate) || Number(candidate) < 0) {
      throw new PortholeError(`${field} must be a non-negative safe integer`, 'PORTHOLE_VALIDATION', 400);
    }
    return Number(candidate);
  };
  const nullableIndex = (candidate: unknown, field: string): number | null =>
    candidate === null ? null : integer(candidate, field);
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

function portholeCompletenessContentHash(
  receipt: UnsignedPortholeCompletenessReceipt,
): string {
  return sha256(canonicalJson({
    domain: 'pd.porthole.completeness-receipt-content.v1',
    receipt,
  }));
}

export function portholeCompletenessReceiptSigningMessage(
  receipt: Omit<PortholeCompletenessReceipt, 'signature'>,
): Buffer {
  return Buffer.from(canonicalJson({
    domain: 'pd.porthole.completeness-receipt-signature.v1',
    receipt,
  }), 'utf8');
}

function verifyCompletenessReceiptSignature(
  receipt: PortholeCompletenessReceipt,
  manifest: PortholePerspective,
  signer: PortholeReceiptSigner,
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
      return signer.verify({
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

function keychainAccount(harborId: string): string {
  const digest = createHash('sha256').update(harborId).digest('hex');
  return `porthole-harbor-v1:${digest}`;
}

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

export function createKeychainPortholeSecretProvider(
  accessor: PortholeKeychainAccessor = keychain,
): PortholeSecretProvider {
  return {
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

export function createInMemoryPortholeSecretProvider(secret = Buffer.alloc(32, 7)): PortholeSecretProvider {
  if (secret.length < 32) throw new Error('in-memory Porthole secret must be at least 32 bytes');
  const copy = Buffer.from(secret);
  return {
    getHarborSecret(): PortholeSecret {
      return { secret: Buffer.from(copy), keyCustody: 'in-memory-test' };
    },
  };
}

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

function getEventByOrdinal(db: DatabaseInstance, perspectiveId: string, ordinal: number): PortholeEvent | null {
  const row = db.prepare(
    'SELECT * FROM porthole_events WHERE perspective_id = ? AND ordinal = ?',
  ).get(perspectiveId, ordinal) as PortholeEventRow | undefined;
  return row ? rowToEvent(row) : null;
}

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

function startEvent(db: DatabaseInstance, perspectiveId: string): PortholeEvent {
  const event = getEventByOrdinal(db, perspectiveId, 0);
  if (!event || event.kind !== 'perspective-started') {
    throw new PortholeError(`Porthole perspective ${perspectiveId} not found`, 'PORTHOLE_NOT_FOUND', 404);
  }
  return event;
}

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
  privacyAuthority: PortholePrivacyAuthority;
  receiptSigner: PortholeReceiptSigner;
}

export function createPortholeStore(options: PortholeStoreOptions) {
  const { db, blobs } = options;
  const secrets = options.secrets ?? createKeychainPortholeSecretProvider();
  const vault = options.vault ?? referenceVault;
  const privacyAuthority = options.privacyAuthority;
  const receiptSigner = options.receiptSigner;
  ensurePortholeSchema(db);

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
      const decoded = parseCanonicalJson(blob.buffer, 'Porthole ciphertext envelope');
      if (
        decoded.schema !== 'pd.porthole.ciphertext-envelope.v1' ||
        decoded.perspectiveId !== event.perspectiveId ||
        decoded.captureIndex !== captureIndex ||
        decoded.encryptionSuite !== PORTHOLE_ENCRYPTION_SUITE
      ) {
        throw new PortholeError(
          'Porthole ciphertext routing does not match its ledger reference',
          'PORTHOLE_DECRYPT_FAILED',
          422,
        );
      }
      const aad = decoded.aad as Record<string, unknown> | null;
      if (
        aad === null || typeof aad !== 'object' || Array.isArray(aad) ||
        aad.harborId !== manifest.harborId ||
        aad.channelId !== manifest.encryption.channelId ||
        aad.epoch !== manifest.encryption.epoch ||
        aad.seq !== captureIndex
      ) {
        throw new PortholeError(
          'Porthole ciphertext authenticated routing is invalid',
          'PORTHOLE_DECRYPT_FAILED',
          422,
        );
      }
      const nonceText = requiredString(decoded.nonceBase64url, 'nonceBase64url');
      nonce = Buffer.from(nonceText, 'base64url');
      if (nonce.length === 0 || nonce.toString('base64url') !== nonceText) {
        throw new PortholeError('Porthole nonce encoding is invalid', 'PORTHOLE_DECRYPT_FAILED', 422);
      }
      const ciphertextText = requiredString(decoded.ciphertextBase64, 'ciphertextBase64');
      ciphertext = Buffer.from(ciphertextText, 'base64');
      if (ciphertext.length === 0 || ciphertext.toString('base64') !== ciphertextText) {
        throw new PortholeError('Porthole ciphertext encoding is invalid', 'PORTHOLE_DECRYPT_FAILED', 422);
      }
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
        receipt = normalizePrivacyReceipt(segment.privacyReceipt, manifest, privacyAuthority, {
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
    const privacyReceipt = normalizePrivacyReceipt(input.privacyReceipt, manifest, privacyAuthority, {
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

  function inspectSegmentEvidence(
    manifest: PortholePerspective,
    segments: PortholeEvent[],
    chain: { valid: boolean; checked: number; error?: string },
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
      valid: chain.valid && issues.length === 0,
      chain,
      checkedSegmentCount: segments.length,
      missingCiphertextCount,
      invalidCiphertextCount,
      quarantinedSegmentCount,
      issues,
    };
  }

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
    for (const event of evidenceEvents) {
      const occurred = Date.parse(event.occurredAt);
      const captureIndex = event.ordinal - 1;
      if (
        !Number.isFinite(occurred) ||
        occurred < previous ||
        occurred > closed ||
        (fixedBoundary !== null && occurred > fixedBoundary) ||
        !Number.isSafeInteger(event.payload.captureIndex) ||
        Number(event.payload.captureIndex) !== captureIndex
      ) {
        return false;
      }
      if (event.kind === 'segment-recorded') {
        if (event.payload.capturedAt !== event.occurredAt) return false;
        if (event.payload.endedAt !== null) {
          if (typeof event.payload.endedAt !== 'string') return false;
          const ended = Date.parse(event.payload.endedAt);
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
          const gapEnd = occurred + Number(duration);
          if (gapEnd > closed || (fixedBoundary !== null && gapEnd > fixedBoundary)) return false;
        }
      } else {
        return false;
      }
      previous = occurred;
    }
    return true;
  }

  function storedReceiptIsValid(
    manifest: PortholePerspective,
    receipt: PortholeCompletenessReceipt,
  ): boolean {
    if (!verifyCompletenessReceiptSignature(receipt, manifest, receiptSigner)) return false;
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
      const verification = inspectSegmentEvidence(manifest, segments, chain);
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
      if (!verifyCompletenessReceiptSignature(receipt, manifest, receiptSigner)) {
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

  function events(perspectiveId: string): PortholeEvent[] {
    startEvent(db, perspectiveId);
    const rows = db.prepare(
      'SELECT * FROM porthole_events WHERE perspective_id = ? ORDER BY ordinal',
    ).all(perspectiveId) as PortholeEventRow[];
    return rows.map(rowToEvent);
  }

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

  function verifyEvidence(perspectiveId: string): PortholeEvidenceVerification {
    const manifest = manifestFor(db, perspectiveId);
    const stream = events(perspectiveId);
    const segments = stream.filter((event) => event.kind === 'segment-recorded');
    return inspectSegmentEvidence(manifest, segments, verifyChain(perspectiveId));
  }

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
