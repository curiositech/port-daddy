// tests/unit/purser/failure-handling.test.ts
/**
 * Unit tests for the continuation‑replay failure handling logic.
 *
 * These tests exercise the contract that delivery failures must:
 *   • Fail‑closed (i.e. surface an exception) when required bindings are missing.
 *   • Route the payload to the dead‑letter queue (DLQ) when the retry limit is exceeded,
 *     preserving the continuationSequence and platformAttempt context.
 *
 * The test harness uses only Jest globals and no external test utilities.
 */

import { recordDeliveryFailure } from '../../../apps/fleet-executor/src/delivery-failure.ts';

/**
 * Minimal shape of the environment expected by `recordDeliveryFailure`.
 * The real implementation uses Cloudflare Workers bindings (DB, DLQ, etc.).
 */
type MockEnv = {
  DB?: {
    prepare: jest.Mock<any, any>;
  };
  DLQ?: {
    send: jest.Mock<any, any>;
  };
};

/**
 * Helper to build a mock DB binding that records calls but never throws.
 */
function mockDbBinding() {
  const runMock = jest.fn().mockResolvedValue(undefined);
  const bindMock = jest.fn().mockReturnThis();
  const prepareMock = jest.fn().mockReturnValue({
    bind: bindMock,
    run: runMock,
  });

  return { prepare: prepareMock, __runMock: runMock, __bindMock: bindMock };
}

/**
 * Helper to build a mock DLQ binding.
 */
function mockDlqBinding() {
  return { send: jest.fn().mockResolvedValue(undefined) };
}

/**
 * Sample job payload – only the fields touched by the failure handler are required.
 */
const SAMPLE_JOB = {
  id: 'job‑sample',
  queue: 'fleet‑queue',
};

/**
 * Sample delivery attempt – the handler normalises this shape internally.
 */
const BASE_ATTEMPT = {
  retries: 0,
  continuationSequence: 1,
  platformAttempt: 1,
};

describe('recordDeliveryFailure – contract enforcement', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  test('fails closed when required bindings (DB) are missing', async () => {
    const env: MockEnv = {
      // DB is deliberately omitted to trigger the fail‑closed path
      DLQ: mockDlqBinding(),
    };

    const error = new Error('simulated failure');

    // The implementation should reject – we assert the promise is rejected.
    await expect(
      recordDeliveryFailure(env as any, SAMPLE_JOB, BASE_ATTEMPT, error),
    ).rejects.toThrow();

    // No attempt to write to the DLQ should have been made because the function
    // should abort before any side‑effects.
    expect(env.DLQ?.send).not.toHaveBeenCalled();
  });

  test('fails closed when required bindings (DLQ) are missing', async () => {
    const env: MockEnv = {
      DB: mockDbBinding(),
      // DLQ omitted
    };

    const error = new Error('simulated failure');

    await expect(
      recordDeliveryFailure(env as any, SAMPLE_JOB, BASE_ATTEMPT, error),
    ).rejects.toThrow();

    // The DB should not be touched because the handler must abort early.
    expect(env.DB?.prepare).not.toHaveBeenCalled();
  });

  test('routes payload to DLQ after exceeding max retries', async () => {
    // The actual max‑retry constant lives inside the implementation; we use a
    // deliberately high number to guarantee the limit is crossed.
    const overLimitAttempt = {
      ...BASE_ATTEMPT,
      retries: 999, // far beyond any reasonable limit
    };

    const dbMock = mockDbBinding();
    const dlqMock = mockDlqBinding();

    const env: MockEnv = {
      DB: dbMock,
      DLQ: dlqMock,
    };

    const error = new Error('exhausted retries');

    // Invoke the handler – it should resolve (no exception) because the DLQ
    // handling is the expected success path for over‑retry cases.
    await expect(
      recordDeliveryFailure(env as any, SAMPLE_JOB, overLimitAttempt, error),
    ).resolves.not.toThrow();

    // Verify that the DLQ received exactly one message.
    expect(dlqMock.send).toHaveBeenCalledTimes(1);

    // Extract the payload that was sent to the DLQ.
    const dlqPayload = dlqMock.send.mock.calls[0][0];

    // The payload must contain the continuation context and a human‑readable error.
    expect(dlqPayload).toEqual(
      expect.objectContaining({
        continuationSequence: overLimitAttempt.continuationSequence,
        platformAttempt: overLimitAttempt.platformAttempt,
        errorMessage: error.message,
        // Additional fields (e.g., jobId) are allowed but not required for the contract.
      }),
    );

    // When the retry limit is hit, we must *not* attempt a normal DB write.
    expect(dbMock.prepare).not.toHaveBeenCalled();
  });

  test('does not send to DLQ when retries are within the allowed window', async () => {
    const withinLimitAttempt = {
      ...BASE_ATTEMPT,
      retries: 1, // assumed to be under the internal max‑retry threshold
    };

    const dbMock = mockDbBinding();
    const dlqMock = mockDlqBinding();

    const env: MockEnv = {
      DB: dbMock,
      DLQ: dlqMock,
    };

    const error = new Error('transient failure');

    // Expect the function to attempt a DB write (recording the failure) and *not*
    // push to the DLQ.
    await expect(
      recordDeliveryFailure(env as any, SAMPLE_JOB, withinLimitAttempt, error),
    ).resolves.not.toThrow();

    expect(dbMock.prepare).toHaveBeenCalledTimes(1);
    expect(dlqMock.send).not.toHaveBeenCalled();
  });
});