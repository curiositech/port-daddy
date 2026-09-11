import { createHash } from 'node:crypto';
import { spawn as realSpawn } from 'node:child_process';
import { describe, expect, jest, test } from '@jest/globals';
import {
  OPERATOR_ENROLLMENT_MAX_FRAME_BYTES,
  __operatorEnrollmentHelperTest,
  runOperatorEnrollmentHelper,
  type OperatorEnrollmentHelperRequest,
} from '../../lib/operator-presence-helper.js';

const challenge = Buffer.from('port-daddy operator presence vector v1');
const publicKeyX963 = Buffer.from(
  '04f3385b5cd2dcc139e29e813df7609cdc2eddc16948aeebfcd946d14a32b11cc075fe887e81da93d221b3faa1c0c915cd8d9410d5cffc99714897367cb8f84bff',
  'hex',
);
const signatureDer = Buffer.from(
  '3045022100daa6fe68875717027c47581de53ba12b0f034e42801a0fc7eb0dc7a6e60e9f0502200dafedd299acbb67a7cf21448d47e16754ac51d217c2f84aa19c279000076789',
  'hex',
);
const keyDigest = `sha256:${createHash('sha256').update(publicKeyX963).digest('hex')}`;

function request(nowMs = 1_000_000): OperatorEnrollmentHelperRequest {
  return {
    protocolVersion: 2,
    operation: 'enroll',
    requestId: 'request-1',
    nonce: 'nonce-1',
    daemonGeneration: 'generation-9',
    bootstrapId: 'bootstrap-1',
    expiresAtMs: nowMs + 60_000,
    challengeBytesBase64: challenge.toString('base64'),
    challengeDigest: __operatorEnrollmentHelperTest.sha256(challenge),
  };
}

function trusted(pid: number) {
  return {
    ok: true,
    code: 'VERIFIED',
    reason: 'test signed process',
    source: 'rust-kernel' as const,
    trust: {
      pid,
      identity: 'ai.portdaddy.FleetBar/P5H9P59X2M',
      notarized: true,
      hardened_runtime: true,
      debug_privileges: false,
      unsafe_dyld_environment: false,
    },
  };
}

function validResponse(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: 2,
    operation: 'enrollment-response',
    requestId: 'request-1',
    nonce: 'nonce-1',
    daemonGeneration: 'generation-9',
    bootstrapId: 'bootstrap-1',
    expiresAtMs: 1_060_000,
    challengeDigest: __operatorEnrollmentHelperTest.sha256(challenge),
    deviceKeyId: `se-p256:${keyDigest.slice('sha256:'.length)}`,
    keyDigest,
    publicKeyX963Base64: publicKeyX963.toString('base64'),
    signatureDerBase64: signatureDer.toString('base64'),
    keyState: 'pending',
    ...overrides,
  };
}

const pinReceipt = {
  enrollmentEventId: 'operator-recovery:request-1:enrollment-pinned:test',
  activationEventId: 'operator-recovery:request-1:enrollment-activated:test',
  activationNonce: 'activation-nonce-0123456789',
};

function helperScript(
  mode: 'success' | 'extra' | 'oversize' | 'timeout' | 'close-stdin',
  overrides = {},
) {
  const response = Buffer.from(JSON.stringify(validResponse(overrides))).toString('base64');
  return `
    const crypto = require('crypto');
    const fs = require('fs');
    const response = Buffer.from(${JSON.stringify(response)}, 'base64');
    const frame = (payload) => { const b = Buffer.alloc(4 + payload.length); b.writeUInt32BE(payload.length, 0); payload.copy(b, 4); return b; };
    const digest = (payload) => 'sha256:' + crypto.createHash('sha256').update(payload).digest('hex');
    const activation = fs.createWriteStream(null, { fd: 3, autoClose: true });
    let input = Buffer.alloc(0);
    let responded = false;
    process.stdin.on('data', (chunk) => {
      input = Buffer.concat([input, chunk]);
      if (!responded && input.length >= 4 && input.length >= 4 + input.readUInt32BE(0)) {
        const end = 4 + input.readUInt32BE(0);
        input = input.subarray(end);
        responded = true;
        ${mode === 'timeout' ? 'setInterval(() => {}, 1000); return;' : ''}
        ${mode === 'oversize' ? `const prefix = Buffer.alloc(4); prefix.writeUInt32BE(${OPERATOR_ENROLLMENT_MAX_FRAME_BYTES + 1}, 0); process.stdout.end(prefix); return;` : ''}
        process.stdout.end(${mode === 'extra' ? 'Buffer.concat([frame(response), frame(response)])' : 'frame(response)'});
        ${mode === 'close-stdin' ? `fs.closeSync(0); setTimeout(() => { activation.end(); process.exit(66); }, 500); return;` : ''}
      }
      if (responded && input.length >= 4 && input.length >= 4 + input.readUInt32BE(0)) {
        const commandPayload = input.subarray(4, 4 + input.readUInt32BE(0));
        input = input.subarray(4 + input.readUInt32BE(0));
        const command = JSON.parse(commandPayload.toString('utf8'));
        const receipt = Buffer.from(JSON.stringify({
          protocolVersion: 2,
          operation: 'enrollment-activated',
          requestId: command.requestId,
          nonce: command.nonce,
          daemonGeneration: command.daemonGeneration,
          bootstrapId: command.bootstrapId,
          expiresAtMs: command.expiresAtMs,
          challengeDigest: command.challengeDigest,
          deviceKeyId: command.deviceKeyId,
          keyDigest: command.keyDigest,
          responseDigest: command.responseDigest,
          enrollmentEventId: command.enrollmentEventId,
          activationEventId: command.activationEventId,
          activationNonce: command.activationNonce,
          activationCommandDigest: digest(commandPayload),
          keyState: 'active',
        }));
        activation.end(frame(receipt));
      }
    });
    process.stdin.on('end', () => process.exit(0));
  `;
}

function spawnScript(script: string, capture?: (options: unknown) => void) {
  return (_executable: string, _args: readonly string[], options: Parameters<typeof realSpawn>[2]) => {
    capture?.(options);
    return realSpawn(process.execPath, ['-e', script], options as never);
  };
}

describe('native FleetBar enrollment helper', () => {
  test('uses separate private response and activation pipes and re-verifies one PID', async () => {
    const processChecks: number[] = [];
    const signedChallenges: Buffer[] = [];
    let spawnOptions: unknown;

    const result = await runOperatorEnrollmentHelper({
      executablePath: '/Applications/FleetBar.app/Contents/MacOS/FleetBar',
      request: request(),
      commitVerifiedEnrollment: async (candidate) => {
        expect(candidate.response.keyDigest).toBe(keyDigest);
        expect(Buffer.from(candidate.challenge)).toEqual(challenge);
        return pinReceipt;
      },
      commitVerifiedActivation: async (activation) => {
        expect(activation.receipt.enrollmentEventId).toBe(pinReceipt.enrollmentEventId);
        expect(activation.receipt.keyState).toBe('active');
      },
      dependencies: {
        nowMs: () => 1_000_000,
        spawn: spawnScript(helperScript('success'), (options) => { spawnOptions = options; }),
        verifyProcess: (pid) => {
          processChecks.push(pid);
          return trusted(pid);
        },
        verifySignature: (input) => {
          signedChallenges.push(Buffer.from(input.challenge));
          expect(Buffer.from(input.publicKeyX963)).toEqual(publicKeyX963);
          expect(Buffer.from(input.signatureDer)).toEqual(signatureDer);
          return { ok: true, code: 'VERIFIED', reason: 'exact bytes', source: 'rust-kernel' };
        },
      },
    });

    expect(processChecks).toHaveLength(4);
    expect(new Set(processChecks)).toEqual(new Set([processChecks[0]]));
    expect(signedChallenges).toEqual([challenge]);
    expect(result.response.keyDigest).toBe(keyDigest);
    expect(result.responseDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(spawnOptions).toMatchObject({
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
      detached: false,
      env: expect.not.objectContaining({ DYLD_INSERT_LIBRARIES: expect.anything() }),
    });
  });

  test('refuses a spoofed binding before ACK', async () => {
    await expect(runOperatorEnrollmentHelper({
      executablePath: '/Applications/FleetBar.app/Contents/MacOS/FleetBar',
      request: request(),
      commitVerifiedEnrollment: async () => pinReceipt,
      commitVerifiedActivation: async () => {},
      dependencies: {
        nowMs: () => 1_000_000,
        spawn: spawnScript(helperScript('success', { nonce: 'attacker-nonce' })),
        verifyProcess: (pid) => trusted(pid),
        verifySignature: () => ({ ok: true, code: 'VERIFIED', reason: 'unused', source: 'rust-kernel' }),
      },
    })).rejects.toMatchObject({ code: 'HELPER_RESPONSE_BINDING_MISMATCH' });
  });

  test('refuses an oversized frame and an extra frame', async () => {
    for (const mode of ['oversize', 'extra'] as const) {
      await expect(runOperatorEnrollmentHelper({
        executablePath: '/Applications/FleetBar.app/Contents/MacOS/FleetBar',
        request: request(),
        commitVerifiedEnrollment: async () => pinReceipt,
        commitVerifiedActivation: async () => {},
        dependencies: {
          nowMs: () => 1_000_000,
          spawn: spawnScript(helperScript(mode)),
          verifyProcess: (pid) => trusted(pid),
          verifySignature: () => ({ ok: true, code: 'VERIFIED', reason: 'test', source: 'rust-kernel' }),
        },
      })).rejects.toMatchObject({
        code: mode === 'oversize' ? 'HELPER_FRAME_INVALID' : 'HELPER_EXTRA_FRAME',
      });
    }
  });

  test('kills a helper that times out', async () => {
    await expect(runOperatorEnrollmentHelper({
      executablePath: '/Applications/FleetBar.app/Contents/MacOS/FleetBar',
      request: request(),
      commitVerifiedEnrollment: async () => pinReceipt,
      commitVerifiedActivation: async () => {},
      timeoutMs: 100,
      dependencies: {
        nowMs: () => 1_000_000,
        spawn: spawnScript(helperScript('timeout')),
        verifyProcess: (pid) => trusted(pid),
        verifySignature: () => ({ ok: true, code: 'VERIFIED', reason: 'test', source: 'rust-kernel' }),
      },
    })).rejects.toMatchObject({ code: 'HELPER_TIMEOUT' });
  });

  test('fails closed when the child exits or changes trust after responding', async () => {
    let checks = 0;
    await expect(runOperatorEnrollmentHelper({
      executablePath: '/Applications/FleetBar.app/Contents/MacOS/FleetBar',
      request: request(),
      commitVerifiedEnrollment: async () => pinReceipt,
      commitVerifiedActivation: async () => {},
      dependencies: {
        nowMs: () => 1_000_000,
        spawn: spawnScript(helperScript('success')),
        verifyProcess: (pid) => {
          checks += 1;
          return checks === 1
            ? trusted(pid)
            : {
                ok: false,
                code: 'PROCESS_UNAVAILABLE',
                reason: 'child exited',
                trust: null,
                source: 'rust-kernel' as const,
              };
        },
        verifySignature: () => ({ ok: true, code: 'VERIFIED', reason: 'test', source: 'rust-kernel' }),
      },
    })).rejects.toMatchObject({ code: 'FLEETBAR_PROCESS_UNTRUSTED' });
    expect(checks).toBe(2);
  });

  test('sends no activation ACK when durable enrollment pinning fails', async () => {
    await expect(runOperatorEnrollmentHelper({
      executablePath: '/Applications/FleetBar.app/Contents/MacOS/FleetBar',
      request: request(),
      commitVerifiedEnrollment: async () => {
        throw new Error('database transaction rolled back');
      },
      commitVerifiedActivation: async () => {},
      dependencies: {
        nowMs: () => 1_000_000,
        spawn: spawnScript(helperScript('success')),
        verifyProcess: (pid) => trusted(pid),
        verifySignature: () => ({ ok: true, code: 'VERIFIED', reason: 'test', source: 'rust-kernel' }),
      },
    })).rejects.toThrow('database transaction rolled back');
  });

  test('rejects a closed activation command pipe without terminating the parent process', async () => {
    await expect(runOperatorEnrollmentHelper({
      executablePath: '/Applications/FleetBar.app/Contents/MacOS/FleetBar',
      request: request(),
      commitVerifiedEnrollment: async () => pinReceipt,
      commitVerifiedActivation: async () => {
        throw new Error('activation must not commit after EPIPE');
      },
      dependencies: {
        nowMs: () => 1_000_000,
        spawn: spawnScript(helperScript('close-stdin')),
        verifyProcess: (pid) => trusted(pid),
        verifySignature: () => ({ ok: true, code: 'VERIFIED', reason: 'test', source: 'rust-kernel' }),
      },
    })).rejects.toMatchObject({
      code: 'HELPER_PIPE_ERROR',
    });
    expect(process.pid).toBeGreaterThan(0);
  });
});
