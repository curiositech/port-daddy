import { describe, expect, it, vi } from 'vitest';
import {
  describeAiFailure,
  FleetAiCircuit,
  FleetAiDependencyError,
  normalizeProviderQueueAttempt,
  providerRetryDelaySeconds,
} from '../src/ai-resilience.js';
import { mapWithConcurrency } from '../src/execute.js';

describe('Workers AI failure classification', () => {
  it('retries documented transient timeout and capacity codes', () => {
    expect(describeAiFailure({ name: 'AiError', status: 408, code: 3007, message: 'timed out' }).retryable)
      .toBe(true);
    expect(describeAiFailure({ name: 'AiError', status: 429, code: 3040, message: 'out of capacity' }).retryable)
      .toBe(true);
  });

  it('does not retry permanent plan, auth, or malformed-request errors', () => {
    expect(describeAiFailure({ status: 429, code: 3036, message: 'allocation exhausted' }).retryable)
      .toBe(false);
    expect(describeAiFailure({ status: 403, code: 5035, message: 'paid plan required' }).retryable)
      .toBe(false);
    expect(describeAiFailure({ status: 400, code: 3003, message: 'incomplete request' }).retryable)
      .toBe(false);
  });

  it('redacts credentials, collapses stacks, and bounds durable detail', () => {
    const failure = describeAiFailure(new Error(
      `Authorization: Bearer super-secret\n` +
        `token=ghs_private_value\n` +
        `-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n` +
        'x'.repeat(900),
    ));

    expect(failure.summary).toContain('Authorization=[redacted]');
    expect(failure.summary).toContain('token=[redacted]');
    expect(failure.summary).toContain('[redacted-pem]');
    expect(failure.summary).not.toContain('super-secret');
    expect(failure.summary).not.toContain('ghs_private_value');
    expect(failure.summary.length).toBeLessThanOrEqual(601);
  });

  it('parses common unstructured Cloudflare labels without confusing later status evidence', () => {
    const failure = describeAiFailure(new Error(
      'Workers AI error 3040; HTTP/2 429; upstream status 503',
    ));

    expect(failure).toMatchObject({ code: 3040, status: 429, retryable: true });
  });

  it('prefers structured status and code fields over ambiguous message text', () => {
    const failure = describeAiFailure({
      status: 400,
      code: 3003,
      message: 'HTTP 503 followed by status 429 and Workers AI error 3040',
    });

    expect(failure).toMatchObject({ code: 3003, status: 400, retryable: false });
  });

  it('fails closed for an unexpected error object with no provider evidence', () => {
    const failure = describeAiFailure({ unexpected: { shape: true } });

    expect(failure).toMatchObject({ status: null, code: null, retryable: false });
    expect(failure.summary).toContain('[object Object]');
  });
});

describe('provider delivery counter normalization', () => {
  it('defaults malformed direct-call counters to the conservative final attempt', () => {
    expect(normalizeProviderQueueAttempt(undefined)).toBe(3);
    expect(normalizeProviderQueueAttempt(0)).toBe(3);
    expect(normalizeProviderQueueAttempt(-1)).toBe(3);
    expect(normalizeProviderQueueAttempt(1.5)).toBe(3);
  });

  it('preserves valid attempts and caps counters from older queue configurations', () => {
    expect(normalizeProviderQueueAttempt(1)).toBe(1);
    expect(normalizeProviderQueueAttempt(2)).toBe(2);
    expect(normalizeProviderQueueAttempt(3)).toBe(3);
    expect(normalizeProviderQueueAttempt(12)).toBe(3);
  });
});

describe('per-run Workers AI circuit', () => {
  it('opens on a retryable provider failure and rejects later work without a downstream call', async () => {
    const circuit = new FleetAiCircuit();
    const first = vi.fn(async () => {
      throw Object.assign(new Error('capacity'), { status: 429, code: 3040 });
    });
    const blocked = vi.fn(async () => 'should not run');

    await expect(circuit.run(first)).rejects.toBeInstanceOf(FleetAiDependencyError);
    await expect(circuit.run(blocked)).rejects.toBeInstanceOf(FleetAiDependencyError);

    expect(first).toHaveBeenCalledTimes(1);
    expect(blocked).not.toHaveBeenCalled();
    expect(circuit.isOpen).toBe(true);
  });

  it('keeps the circuit closed for a permanent model/configuration error', async () => {
    const circuit = new FleetAiCircuit();
    await expect(circuit.run(async () => {
      throw Object.assign(new Error('bad model'), { status: 400, code: 5007 });
    })).rejects.toMatchObject({ failure: { retryable: false } });

    await expect(circuit.run(async () => 'probe succeeded')).resolves.toBe('probe succeeded');
    expect(circuit.isOpen).toBe(false);
  });

  it('settles in-flight lanes without claiming queued work after the first failure', async () => {
    const started: number[] = [];
    let markSecondStarted!: () => void;
    let releaseSecond!: () => void;
    const secondStarted = new Promise<void>(resolve => { markSecondStarted = resolve; });
    const secondMayFinish = new Promise<void>(resolve => { releaseSecond = resolve; });

    const run = mapWithConcurrency([0, 1, 2, 3], 2, async value => {
      started.push(value);
      if (value === 0) {
        await secondStarted;
        throw new Error('provider failed');
      }
      if (value === 1) {
        markSecondStarted();
        await secondMayFinish;
      }
      return value;
    });

    await secondStarted;
    // Let lane zero publish the shared failure before lane one settles.
    await Promise.resolve();
    await Promise.resolve();
    releaseSecond();

    await expect(run).rejects.toThrow('provider failed');
    expect(started).toEqual([0, 1]);
  });
});

describe('queue retry jitter', () => {
  it('uses a bounded full-jitter exponential ceiling', () => {
    expect(providerRetryDelaySeconds(1, () => 0)).toBe(1);
    expect(providerRetryDelaySeconds(1, () => 0.999999)).toBe(15);
    expect(providerRetryDelaySeconds(2, () => 0.999999)).toBe(30);
    expect(providerRetryDelaySeconds(8, () => 0.999999)).toBe(120);
  });

  it('honors a provider retry-after floor without exceeding the queue limit', () => {
    expect(providerRetryDelaySeconds(1, () => 0, 600)).toBe(600);
    expect(providerRetryDelaySeconds(1, () => 0, 99_999)).toBe(43_200);
    expect(providerRetryDelaySeconds(2, () => 0.999999, null)).toBe(30);
    expect(providerRetryDelaySeconds(2, () => 0.999999, undefined)).toBe(30);
    expect(providerRetryDelaySeconds(2, () => 0.999999, -1)).toBe(30);
  });

  it('does not synchronize different random draws', () => {
    const a = providerRetryDelaySeconds(2, () => 0.1);
    const b = providerRetryDelaySeconds(2, () => 0.8);
    expect(a).not.toBe(b);
  });
});
