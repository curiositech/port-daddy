/**
 * Private-pipe client for FleetBar's native operator-enrollment helper.
 *
 * The daemon spawns one exact executable with a fixed argument, verifies the
 * live child PID in pd-anchor before sending bytes, verifies it again after the
 * response, checks the Secure Enclave signature over the exact challenge, then
 * sends one activation command, then requires a second exact activation receipt
 * on a dedicated private pipe before it records the key as usable. No HTTP
 * enrollment, shell, inherited stdio, caller-supplied code requirement, or
 * app-reported provenance participates.
 */

import { createHash } from 'node:crypto';
import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams, SpawnOptions } from 'node:child_process';
import { isAbsolute } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import {
  verifyFleetBarProcessTrust,
  verifyOperatorPresenceSignature,
  type FleetBarProcessTrustResult,
  type OperatorPresenceVerificationResult,
} from './operator-presence-ffi.js';

export const OPERATOR_ENROLLMENT_HELPER_ARGUMENT = '--operator-enrollment-helper';
export const OPERATOR_ENROLLMENT_PROTOCOL_VERSION = 2;
export const OPERATOR_ENROLLMENT_MAX_FRAME_BYTES = 96 * 1024;
export const OPERATOR_ENROLLMENT_MAX_CHALLENGE_BYTES = 64 * 1024;
export const OPERATOR_ENROLLMENT_MAX_LIFETIME_MS = 2 * 60 * 1000;

export interface OperatorEnrollmentHelperRequest {
  protocolVersion: 2;
  operation: 'enroll';
  requestId: string;
  nonce: string;
  daemonGeneration: string;
  bootstrapId: string;
  expiresAtMs: number;
  challengeBytesBase64: string;
  challengeDigest: string;
}

export interface OperatorEnrollmentHelperResponse {
  protocolVersion: 2;
  operation: 'enrollment-response';
  requestId: string;
  nonce: string;
  daemonGeneration: string;
  bootstrapId: string;
  expiresAtMs: number;
  challengeDigest: string;
  deviceKeyId: string;
  keyDigest: string;
  publicKeyX963Base64: string;
  signatureDerBase64: string;
  keyState: 'pending' | 'active';
}

export interface OperatorEnrollmentActivationReceipt {
  protocolVersion: 2;
  operation: 'enrollment-activated';
  requestId: string;
  nonce: string;
  daemonGeneration: string;
  bootstrapId: string;
  expiresAtMs: number;
  challengeDigest: string;
  deviceKeyId: string;
  keyDigest: string;
  responseDigest: string;
  enrollmentEventId: string;
  activationEventId: string;
  activationNonce: string;
  activationCommandDigest: string;
  keyState: 'active';
}

export interface OperatorEnrollmentActivationCommand {
  protocolVersion: 2;
  operation: 'activate-enrollment';
  requestId: string;
  nonce: string;
  daemonGeneration: string;
  bootstrapId: string;
  expiresAtMs: number;
  challengeDigest: string;
  deviceKeyId: string;
  keyDigest: string;
  responseDigest: string;
  enrollmentEventId: string;
  activationEventId: string;
  activationNonce: string;
}

export interface OperatorEnrollmentPinReceipt {
  enrollmentEventId: string;
  activationEventId: string;
  activationNonce: string;
}

export interface OperatorEnrollmentHelperResult {
  response: OperatorEnrollmentHelperResponse;
  responseDigest: string;
  activationReceipt: OperatorEnrollmentActivationReceipt;
  activationReceiptDigest: string;
  enrollmentProcessTrust: NonNullable<FleetBarProcessTrustResult['trust']>;
  activationProcessTrust: NonNullable<FleetBarProcessTrustResult['trust']>;
}

export interface VerifiedOperatorEnrollmentCandidate {
  response: OperatorEnrollmentHelperResponse;
  responseDigest: string;
  processTrust: NonNullable<FleetBarProcessTrustResult['trust']>;
  /** Exact bytes signed by the Secure Enclave key. */
  challenge: Uint8Array;
}

export interface VerifiedOperatorEnrollmentActivation {
  receipt: OperatorEnrollmentActivationReceipt;
  receiptDigest: string;
  processTrust: NonNullable<FleetBarProcessTrustResult['trust']>;
}

export class OperatorEnrollmentHelperError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'OperatorEnrollmentHelperError';
  }
}

interface HelperChild {
  pid?: number;
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  stdio: Array<Readable | Writable | null>;
  kill(signal?: NodeJS.Signals | number): boolean;
  once(event: 'error', listener: (error: Error) => void): this;
  once(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
}

type SpawnHelper = (
  executable: string,
  args: readonly string[],
  options: SpawnOptions,
) => HelperChild;

interface OperatorEnrollmentHelperDependencies {
  spawn: SpawnHelper;
  verifyProcess: (pid: number) => FleetBarProcessTrustResult;
  verifySignature: (input: {
    publicKeyX963: Uint8Array;
    signatureDer: Uint8Array;
    challenge: Uint8Array;
  }) => OperatorPresenceVerificationResult;
  nowMs: () => number;
}

export interface RunOperatorEnrollmentHelperOptions {
  executablePath: string;
  request: OperatorEnrollmentHelperRequest;
  /**
   * Must durably pin the key and its exact provenance/bindings before resolving.
   * A rejection/throw sends no ACK, so FleetBar leaves the key pending.
   */
  commitVerifiedEnrollment: (
    candidate: VerifiedOperatorEnrollmentCandidate,
  ) => Promise<OperatorEnrollmentPinReceipt>;
  /**
   * Must append the activation proof and make the disposable enrollment
   * projection usable in one transaction before resolving.
   */
  commitVerifiedActivation: (
    activation: VerifiedOperatorEnrollmentActivation,
  ) => Promise<void>;
  timeoutMs?: number;
  /** Test seam: production callers must omit this. */
  dependencies?: Partial<OperatorEnrollmentHelperDependencies>;
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function decodeCanonicalBase64(value: string, field: string): Buffer {
  if (value.length === 0 || value.length > OPERATOR_ENROLLMENT_MAX_FRAME_BYTES * 2) {
    throw new OperatorEnrollmentHelperError('HELPER_RESPONSE_INVALID', `${field} is empty or oversized`);
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value) {
    throw new OperatorEnrollmentHelperError('HELPER_RESPONSE_INVALID', `${field} is not canonical base64`);
  }
  return decoded;
}

function boundedIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    Buffer.byteLength(value) <= 128 &&
    !value.includes('\0')
  );
}

function validateRequest(request: OperatorEnrollmentHelperRequest, nowMs: number): Buffer {
  if (
    request.protocolVersion !== OPERATOR_ENROLLMENT_PROTOCOL_VERSION ||
    request.operation !== 'enroll' ||
    !boundedIdentifier(request.requestId) ||
    !boundedIdentifier(request.nonce) ||
    !boundedIdentifier(request.daemonGeneration) ||
    !boundedIdentifier(request.bootstrapId)
  ) {
    throw new OperatorEnrollmentHelperError(
      'HELPER_REQUEST_INVALID',
      'operator enrollment protocol or binding fields are invalid',
    );
  }
  if (
    !Number.isSafeInteger(request.expiresAtMs) ||
    request.expiresAtMs <= nowMs ||
    request.expiresAtMs - nowMs > OPERATOR_ENROLLMENT_MAX_LIFETIME_MS
  ) {
    throw new OperatorEnrollmentHelperError(
      'HELPER_REQUEST_EXPIRED',
      'operator enrollment request is expired or exceeds the two-minute lifetime',
    );
  }
  const challenge = decodeCanonicalBase64(request.challengeBytesBase64, 'challengeBytesBase64');
  if (
    challenge.length === 0 ||
    challenge.length > OPERATOR_ENROLLMENT_MAX_CHALLENGE_BYTES ||
    sha256(challenge) !== request.challengeDigest
  ) {
    throw new OperatorEnrollmentHelperError(
      'HELPER_CHALLENGE_INVALID',
      'operator enrollment challenge bytes do not match their digest',
    );
  }
  return challenge;
}

function frame(payload: Uint8Array): Buffer {
  if (payload.byteLength === 0 || payload.byteLength > OPERATOR_ENROLLMENT_MAX_FRAME_BYTES) {
    throw new OperatorEnrollmentHelperError('HELPER_FRAME_INVALID', 'helper frame is empty or oversized');
  }
  const framed = Buffer.allocUnsafe(4 + payload.byteLength);
  framed.writeUInt32BE(payload.byteLength, 0);
  Buffer.from(payload).copy(framed, 4);
  return framed;
}

function writeAll(stream: Writable, bytes: Uint8Array, phase: string): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(Buffer.from(bytes), (error?: Error | null) => {
      if (error) reject(new OperatorEnrollmentHelperError(
        'HELPER_PIPE_ERROR',
        `FleetBar helper ${phase} pipe closed before the bounded frame was accepted`,
      ));
      else resolve();
    });
  });
}

function endWritable(stream: Writable, phase: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = () => reject(new OperatorEnrollmentHelperError(
      'HELPER_PIPE_ERROR',
      `FleetBar helper ${phase} pipe closed before EOF was acknowledged`,
    ));
    stream.once('error', onError);
    stream.end(() => {
      stream.removeListener('error', onError);
      resolve();
    });
  });
}

class OneFrameCollector {
  private bytes = Buffer.alloc(0);
  private expected: number | null = null;
  private settled = false;
  private resolve!: (payload: Buffer) => void;
  private reject!: (error: Error) => void;
  readonly promise = new Promise<Buffer>((resolve, reject) => {
    this.resolve = resolve;
    this.reject = reject;
  });
  extraBytes = 0;

  push(chunk: Buffer): void {
    if (this.settled) {
      this.extraBytes += chunk.length;
      return;
    }
    this.bytes = Buffer.concat([this.bytes, chunk]);
    if (this.expected === null && this.bytes.length >= 4) {
      this.expected = this.bytes.readUInt32BE(0);
      if (this.expected === 0 || this.expected > OPERATOR_ENROLLMENT_MAX_FRAME_BYTES) {
        this.settled = true;
        this.reject(
          new OperatorEnrollmentHelperError(
            'HELPER_FRAME_INVALID',
            'FleetBar helper response frame is empty or oversized',
          ),
        );
        return;
      }
    }
    if (this.expected !== null && this.bytes.length >= 4 + this.expected) {
      const end = 4 + this.expected;
      const payload = this.bytes.subarray(4, end);
      this.extraBytes += this.bytes.length - end;
      this.bytes = Buffer.alloc(0);
      this.settled = true;
      this.resolve(payload);
    }
  }

  endBeforeFrame(): void {
    if (this.settled) return;
    this.settled = true;
    this.reject(
      new OperatorEnrollmentHelperError(
        'HELPER_RESPONSE_TRUNCATED',
        'FleetBar helper exited before one complete response frame',
      ),
    );
  }

  fail(error: Error): void {
    if (this.settled) return;
    this.settled = true;
    this.reject(error);
  }
}

function sanitizeEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    LANG: 'en_US.UTF-8',
  };
  if (process.env.HOME) environment.HOME = process.env.HOME;
  if (process.env.TMPDIR) environment.TMPDIR = process.env.TMPDIR;
  return environment;
}

function requireTrustedProcess(
  verdict: FleetBarProcessTrustResult,
  expectedPid: number,
  stage: 'before-request' | 'after-response' | 'before-activation' | 'after-activation',
): NonNullable<FleetBarProcessTrustResult['trust']> {
  if (
    !verdict.ok ||
    verdict.trust === null ||
    verdict.trust.pid !== expectedPid ||
    !verdict.trust.notarized ||
    !verdict.trust.hardened_runtime ||
    verdict.trust.debug_privileges ||
    verdict.trust.unsafe_dyld_environment
  ) {
    throw new OperatorEnrollmentHelperError(
      'FLEETBAR_PROCESS_UNTRUSTED',
      `FleetBar helper process trust failed ${stage}: ${verdict.code}: ${verdict.reason}`,
    );
  }
  return verdict.trust;
}

function validateActivationReceipt(
  value: unknown,
  request: OperatorEnrollmentHelperRequest,
  response: OperatorEnrollmentHelperResponse,
  responseDigest: string,
  enrollmentEventId: string,
  activationEventId: string,
  activationNonce: string,
  activationCommandDigest: string,
): OperatorEnrollmentActivationReceipt {
  if (typeof value !== 'object' || value === null) {
    throw new OperatorEnrollmentHelperError(
      'HELPER_ACTIVATION_INVALID',
      'FleetBar activation receipt is not an object',
    );
  }
  const receipt = value as Partial<OperatorEnrollmentActivationReceipt>;
  if (
    receipt.protocolVersion !== OPERATOR_ENROLLMENT_PROTOCOL_VERSION ||
    receipt.operation !== 'enrollment-activated' ||
    receipt.requestId !== request.requestId ||
    receipt.nonce !== request.nonce ||
    receipt.daemonGeneration !== request.daemonGeneration ||
    receipt.bootstrapId !== request.bootstrapId ||
    receipt.expiresAtMs !== request.expiresAtMs ||
    receipt.challengeDigest !== request.challengeDigest ||
    receipt.deviceKeyId !== response.deviceKeyId ||
    receipt.keyDigest !== response.keyDigest ||
    receipt.responseDigest !== responseDigest ||
    receipt.enrollmentEventId !== enrollmentEventId ||
    receipt.activationEventId !== activationEventId ||
    receipt.activationNonce !== activationNonce ||
    receipt.activationCommandDigest !== activationCommandDigest ||
    receipt.keyState !== 'active'
  ) {
    throw new OperatorEnrollmentHelperError(
      'HELPER_ACTIVATION_BINDING_MISMATCH',
      'FleetBar activation receipt does not match the exact pinned enrollment',
    );
  }
  return receipt as OperatorEnrollmentActivationReceipt;
}

function validateResponse(
  value: unknown,
  request: OperatorEnrollmentHelperRequest,
  challenge: Buffer,
  verifySignature: OperatorEnrollmentHelperDependencies['verifySignature'],
): OperatorEnrollmentHelperResponse {
  if (typeof value !== 'object' || value === null) {
    throw new OperatorEnrollmentHelperError('HELPER_RESPONSE_INVALID', 'helper response is not an object');
  }
  const response = value as Partial<OperatorEnrollmentHelperResponse>;
  if (
    response.protocolVersion !== OPERATOR_ENROLLMENT_PROTOCOL_VERSION ||
    response.operation !== 'enrollment-response' ||
    response.requestId !== request.requestId ||
    response.nonce !== request.nonce ||
    response.daemonGeneration !== request.daemonGeneration ||
    response.bootstrapId !== request.bootstrapId ||
    response.expiresAtMs !== request.expiresAtMs ||
    response.challengeDigest !== request.challengeDigest ||
    (response.keyState !== 'pending' && response.keyState !== 'active') ||
    !boundedIdentifier(response.deviceKeyId) ||
    typeof response.keyDigest !== 'string' ||
    typeof response.publicKeyX963Base64 !== 'string' ||
    typeof response.signatureDerBase64 !== 'string'
  ) {
    throw new OperatorEnrollmentHelperError(
      'HELPER_RESPONSE_BINDING_MISMATCH',
      'FleetBar helper response does not echo the exact request bindings',
    );
  }
  const publicKey = decodeCanonicalBase64(response.publicKeyX963Base64, 'publicKeyX963Base64');
  const signature = decodeCanonicalBase64(response.signatureDerBase64, 'signatureDerBase64');
  const keyDigest = sha256(publicKey);
  if (
    publicKey.length !== 65 ||
    publicKey[0] !== 0x04 ||
    signature.length === 0 ||
    signature.length > 80 ||
    response.keyDigest !== keyDigest ||
    response.deviceKeyId !== `se-p256:${keyDigest.slice('sha256:'.length)}`
  ) {
    throw new OperatorEnrollmentHelperError(
      'HELPER_KEY_BINDING_INVALID',
      'FleetBar helper key identity does not match the returned public key',
    );
  }
  const signatureVerdict = verifySignature({
    publicKeyX963: publicKey,
    signatureDer: signature,
    challenge,
  });
  if (!signatureVerdict.ok) {
    throw new OperatorEnrollmentHelperError(
      'HELPER_SIGNATURE_INVALID',
      `FleetBar helper did not sign the exact challenge: ${signatureVerdict.code}: ${signatureVerdict.reason}`,
    );
  }
  return response as OperatorEnrollmentHelperResponse;
}

function waitForClose(child: HelperChild): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
}

/** Spawn, mutually bind, and activate one FleetBar enrollment helper. */
export async function runOperatorEnrollmentHelper(
  options: RunOperatorEnrollmentHelperOptions,
): Promise<OperatorEnrollmentHelperResult> {
  const dependencies: OperatorEnrollmentHelperDependencies = {
    spawn: ((executable, args, spawnOptions) =>
      nodeSpawn(executable, [...args], spawnOptions) as unknown as ChildProcessWithoutNullStreams) as SpawnHelper,
    verifyProcess: verifyFleetBarProcessTrust,
    verifySignature: verifyOperatorPresenceSignature,
    nowMs: Date.now,
    ...options.dependencies,
  };
  if (!isAbsolute(options.executablePath) || options.executablePath.includes('\0')) {
    throw new OperatorEnrollmentHelperError(
      'FLEETBAR_PATH_INVALID',
      'FleetBar helper executable must be an absolute NUL-free path',
    );
  }
  const nowMs = dependencies.nowMs();
  const challenge = validateRequest(options.request, nowMs);
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
    throw new OperatorEnrollmentHelperError(
      'HELPER_TIMEOUT_INVALID',
      'FleetBar helper timeout must be between 100 ms and 120 seconds',
    );
  }

  const child = dependencies.spawn(
    options.executablePath,
    [OPERATOR_ENROLLMENT_HELPER_ARGUMENT],
    {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
      windowsHide: true,
      detached: false,
      env: sanitizeEnvironment(),
    },
  );
  const pid = child.pid;
  if (!Number.isSafeInteger(pid) || (pid ?? 0) <= 0) {
    child.kill('SIGKILL');
    throw new OperatorEnrollmentHelperError(
      'HELPER_PID_UNAVAILABLE',
      'FleetBar helper did not expose a live child PID',
    );
  }

  const activationOutput = child.stdio[3];
  if (!activationOutput || typeof (activationOutput as Readable).on !== 'function') {
    child.kill('SIGKILL');
    throw new OperatorEnrollmentHelperError(
      'HELPER_ACTIVATION_PIPE_UNAVAILABLE',
      'FleetBar helper did not expose its private activation-receipt pipe',
    );
  }

  const collector = new OneFrameCollector();
  const activationCollector = new OneFrameCollector();
  // The activation pipe may close before we reach the activation phase on a
  // valid fail-closed response error. Attach the observer now so that early
  // rejection is never promoted to an unhandled process exception.
  void activationCollector.promise.catch(() => {});
  let resolveStdoutEnded!: () => void;
  const stdoutEnded = new Promise<void>((resolve) => {
    resolveStdoutEnded = resolve;
  });
  let resolveActivationEnded!: () => void;
  const activationEnded = new Promise<void>((resolve) => {
    resolveActivationEnded = resolve;
  });
  const stderrChunks: Buffer[] = [];
  let stderrBytes = 0;
  let streamFailure: OperatorEnrollmentHelperError | null = null;
  const recordPipeFailure = (channel: string, error: Error) => {
    if (streamFailure !== null) return;
    streamFailure = new OperatorEnrollmentHelperError(
      'HELPER_PIPE_ERROR',
      `FleetBar helper ${channel} pipe failed: ${error.message}`,
    );
    collector.fail(streamFailure);
    activationCollector.fail(streamFailure);
    child.kill('SIGKILL');
  };
  child.stdin.on('error', (error: Error) => recordPipeFailure('stdin', error));
  child.stdout.on('error', (error: Error) => recordPipeFailure('stdout', error));
  child.stderr.on('error', (error: Error) => recordPipeFailure('stderr', error));
  (activationOutput as Readable).on('error', (error: Error) => {
    recordPipeFailure('activation', error);
  });
  child.stdout.on('data', (chunk: Buffer | string) => collector.push(Buffer.from(chunk)));
  child.stdout.once('end', () => {
    collector.endBeforeFrame();
    resolveStdoutEnded();
  });
  (activationOutput as Readable).on('data', (chunk: Buffer | string) => {
    activationCollector.push(Buffer.from(chunk));
  });
  (activationOutput as Readable).once('end', () => {
    activationCollector.endBeforeFrame();
    resolveActivationEnded();
  });
  child.stderr.on('data', (chunk: Buffer | string) => {
    const bytes = Buffer.from(chunk);
    stderrBytes += bytes.length;
    if (stderrBytes <= 8 * 1024) {
      stderrChunks.push(bytes);
    } else if (streamFailure === null) {
      streamFailure = new OperatorEnrollmentHelperError(
        'HELPER_STDERR_OVERSIZED',
        'FleetBar helper exceeded the bounded diagnostic channel',
      );
      collector.fail(streamFailure);
      child.kill('SIGKILL');
    }
  });
  const close = waitForClose(child);
  // Make a spawn error reject the response wait immediately as well as the
  // eventual close wait; keeping this handler attached also prevents an
  // unobserved rejection when the response path times out first.
  void close.catch((error: Error) => collector.fail(error));
  let timeout: NodeJS.Timeout | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new OperatorEnrollmentHelperError('HELPER_TIMEOUT', 'FleetBar helper timed out'));
    }, timeoutMs);
    timeout.unref?.();
  });

  try {
    requireTrustedProcess(dependencies.verifyProcess(pid!), pid!, 'before-request');
    const requestPayload = Buffer.from(JSON.stringify(options.request));
    await Promise.race([writeAll(child.stdin, frame(requestPayload), 'enrollment-request'), timedOut]);

    const responsePayload = await Promise.race([collector.promise, timedOut]);
    await Promise.race([stdoutEnded, timedOut]);
    if (streamFailure !== null) throw streamFailure;
    if (collector.extraBytes !== 0) {
      throw new OperatorEnrollmentHelperError(
        'HELPER_EXTRA_FRAME',
        'FleetBar helper wrote more than one response frame',
      );
    }
    const secondTrust = requireTrustedProcess(
      dependencies.verifyProcess(pid!),
      pid!,
      'after-response',
    );
    let decoded: unknown;
    try {
      decoded = JSON.parse(responsePayload.toString('utf8'));
    } catch {
      throw new OperatorEnrollmentHelperError(
        'HELPER_RESPONSE_INVALID',
        'FleetBar helper response is not valid UTF-8 JSON',
      );
    }
    const response = validateResponse(
      decoded,
      options.request,
      challenge,
      dependencies.verifySignature,
    );
    const responseDigest = sha256(responsePayload);
    const pinReceipt = await Promise.race([
      options.commitVerifiedEnrollment({
        response,
        responseDigest,
        processTrust: secondTrust,
        challenge: Buffer.from(challenge),
      }),
      timedOut,
    ]);
    if (
      !boundedIdentifier(pinReceipt.enrollmentEventId) ||
      !boundedIdentifier(pinReceipt.activationEventId) ||
      !boundedIdentifier(pinReceipt.activationNonce)
    ) {
      throw new OperatorEnrollmentHelperError(
        'HELPER_PIN_RECEIPT_INVALID',
        'durable enrollment pin returned an invalid event id',
      );
    }
    if (dependencies.nowMs() >= options.request.expiresAtMs) {
      throw new OperatorEnrollmentHelperError(
        'HELPER_REQUEST_EXPIRED',
        'operator enrollment expired before the durable pin could be acknowledged',
      );
    }
    const activationCommand: OperatorEnrollmentActivationCommand = {
      protocolVersion: OPERATOR_ENROLLMENT_PROTOCOL_VERSION,
      operation: 'activate-enrollment',
      requestId: options.request.requestId,
      nonce: options.request.nonce,
      daemonGeneration: options.request.daemonGeneration,
      bootstrapId: options.request.bootstrapId,
      expiresAtMs: options.request.expiresAtMs,
      challengeDigest: options.request.challengeDigest,
      deviceKeyId: response.deviceKeyId,
      keyDigest: response.keyDigest,
      responseDigest,
      enrollmentEventId: pinReceipt.enrollmentEventId,
      activationEventId: pinReceipt.activationEventId,
      activationNonce: pinReceipt.activationNonce,
    };
    const activationTrustBeforeCommand = requireTrustedProcess(
      dependencies.verifyProcess(pid!),
      pid!,
      'before-activation',
    );
    if (activationTrustBeforeCommand.identity !== secondTrust.identity) {
      throw new OperatorEnrollmentHelperError(
        'FLEETBAR_PROCESS_UNTRUSTED',
        'FleetBar helper process identity changed before activation',
      );
    }
    const activationCommandPayload = Buffer.from(JSON.stringify(activationCommand));
    const activationCommandDigest = sha256(activationCommandPayload);
    await Promise.race([
      writeAll(child.stdin, frame(activationCommandPayload), 'activation-command'),
      timedOut,
    ]);

    const activationPayload = await Promise.race([activationCollector.promise, timedOut]);
    await Promise.race([activationEnded, timedOut]);
    if (activationCollector.extraBytes !== 0) {
      throw new OperatorEnrollmentHelperError(
        'HELPER_ACTIVATION_EXTRA_FRAME',
        'FleetBar helper wrote more than one activation receipt frame',
      );
    }
    let decodedActivation: unknown;
    try {
      decodedActivation = JSON.parse(activationPayload.toString('utf8'));
    } catch {
      throw new OperatorEnrollmentHelperError(
        'HELPER_ACTIVATION_INVALID',
        'FleetBar activation receipt is not valid UTF-8 JSON',
      );
    }
    const activationReceipt = validateActivationReceipt(
      decodedActivation,
      options.request,
      response,
      responseDigest,
      pinReceipt.enrollmentEventId,
      pinReceipt.activationEventId,
      pinReceipt.activationNonce,
      activationCommandDigest,
    );
    const activationTrust = requireTrustedProcess(
      dependencies.verifyProcess(pid!),
      pid!,
      'after-activation',
    );
    if (activationTrust.identity !== secondTrust.identity) {
      throw new OperatorEnrollmentHelperError(
        'FLEETBAR_PROCESS_UNTRUSTED',
        'FleetBar helper process identity changed after activation',
      );
    }
    const activationReceiptDigest = sha256(activationPayload);
    await Promise.race([endWritable(child.stdin, 'activation-command'), timedOut]);

    const completion = await Promise.race([close, timedOut]);
    if (streamFailure !== null) throw streamFailure;
    if (completion.code !== 0 || completion.signal !== null) {
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
      throw new OperatorEnrollmentHelperError(
        'HELPER_EXIT_REFUSED',
        `FleetBar helper refused activation (code=${completion.code}, signal=${completion.signal})${
          stderr ? `: ${stderr}` : ''
        }`,
      );
    }
    if (collector.extraBytes !== 0) {
      throw new OperatorEnrollmentHelperError(
        'HELPER_EXTRA_FRAME',
        'FleetBar helper wrote trailing bytes after its response frame',
      );
    }
    if (stderrBytes !== 0) {
      throw new OperatorEnrollmentHelperError(
        'HELPER_STDERR_REFUSED',
        'FleetBar helper produced unexpected diagnostic output during a successful exchange',
      );
    }
    await Promise.race([
      options.commitVerifiedActivation({
        receipt: activationReceipt,
        receiptDigest: activationReceiptDigest,
        processTrust: activationTrust,
      }),
      timedOut,
    ]);
    return {
      response,
      responseDigest,
      activationReceipt,
      activationReceiptDigest,
      enrollmentProcessTrust: secondTrust,
      activationProcessTrust: activationTrust,
    };
  } catch (error) {
    child.kill('SIGKILL');
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export const __operatorEnrollmentHelperTest = {
  frame,
  sha256,
};
