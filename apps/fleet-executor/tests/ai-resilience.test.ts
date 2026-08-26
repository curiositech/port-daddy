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
  it('bounds a silent provider call and opens the circuit with timeout evidence', async () => {
    const circuit = new FleetAiCircuit(10);
    const silent = vi.fn(() => new Promise<never>(() => undefined));
    const blocked = vi.fn(async () => 'should not run');

    await expect(circuit.run(silent)).rejects.toMatchObject({
      failure: {
        name: 'FleetAiCallDeadlineError',
        status: 408,
        code: 3007,
        retryable: true,
      },
    });
    await expect(circuit.run(blocked)).rejects.toBeInstanceOf(FleetAiDependencyError);

    expect(silent).toHaveBeenCalledTimes(1);
    expect(blocked).not.toHaveBeenCalled();
    expect(circuit.isOpen).toBe(true);
  });

  it('spends the deadline at most once per INVOCATION — the per-delivery half of the bound', async () => {
    // WHAT THIS DOES AND DOES NOT PROVE — worth stating precisely, because
    // conflating the two scopes is exactly the error the PR #9800 review
    // caught. A queue consumer gets ~15 minutes of wall clock, and the
    // per-call deadline can approach 10 minutes, so one INVOCATION only fits
    // because the circuit opens on the first timeout and every later call is
    // rejected WITHOUT awaiting the provider. That is the property pinned
    // here: if a future edit let a second call reach the provider after a
    // timeout, worst-case wait becomes MAX_MAP_CHUNKS_PER_SHIP × the
    // deadline, past the budget, and the invocation is killed mid-run with no
    // catchable error — the #7743 failure shape.
    //
    // It says NOTHING about a whole logical RUN. A run spans many deliveries
    // (one provider-heavy ship apiece), each with a fresh circuit, so the
    // run-level worst case is ships × attempts × deadline and needs its own
    // ceiling. That is RUN_ABSOLUTE_DEADLINE_MS, not this.
    //
    // Timing is asserted rather than call counts alone: the point is that the
    // later calls cost no WAITING, which a call-count assertion cannot show.
    const deadlineMs = 20;
    const circuit = new FleetAiCircuit(deadlineMs);
    const silent = vi.fn(() => new Promise<never>(() => undefined));

    const startedAt = Date.now();
    await expect(circuit.run(silent)).rejects.toMatchObject({
      failure: { name: 'FleetAiCallDeadlineError' },
    });
    // Seven more chunks' worth of calls, as one ship's MAP fan-out would issue.
    for (let i = 0; i < 7; i++) {
      await expect(circuit.run(silent)).rejects.toBeInstanceOf(FleetAiDependencyError);
    }
    const elapsed = Date.now() - startedAt;

    // One deadline's wait, not eight. Generous headroom for scheduler jitter;
    // the failure this catches is an order-of-magnitude regression, not ms.
    expect(elapsed).toBeLessThan(deadlineMs * 4);
    expect(silent).toHaveBeenCalledTimes(1);
  });

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

describe('per-ship AI call aggregation', () => {
  it('accumulates calls, outcomes, and elapsed time across the ship, keyed by ship name', async () => {
    const circuit = new FleetAiCircuit(1_000);
    await circuit.runForShip('pilot', async () => 'ok-1');
    await circuit.runForShip('pilot', async () => 'ok-2');
    await expect(
      circuit.runForShip('pilot', async () => {
        throw Object.assign(new Error('bad model'), { status: 400, code: 5007 });
      }),
    ).rejects.toBeInstanceOf(FleetAiDependencyError);

    const pilot = circuit.snapshotShipStats('pilot');
    expect(pilot).toMatchObject({ ship: 'pilot', calls: 3, okCalls: 2, errorCalls: 1, timeoutCalls: 0 });
    expect(pilot!.totalElapsedMs).toBeGreaterThanOrEqual(0);
    expect(circuit.snapshotShipStats('lookout')).toBeNull();
  });

  it('keeps separate totals per ship on a shared circuit', async () => {
    const circuit = new FleetAiCircuit(1_000);
    await circuit.runForShip('pilot', async () => 'ok');
    await circuit.runForShip('lookout', async () => 'ok');
    await circuit.runForShip('lookout', async () => 'ok');

    expect(circuit.snapshotShipStats('pilot')).toMatchObject({ calls: 1 });
    expect(circuit.snapshotShipStats('lookout')).toMatchObject({ calls: 2 });
  });

  it('counts a deadline timeout as both a call and a timeout for that ship', async () => {
    const circuit = new FleetAiCircuit(10);
    const silent = () => new Promise<never>(() => undefined);
    await expect(circuit.runForShip('pilot', silent)).rejects.toBeInstanceOf(FleetAiDependencyError);

    const pilot = circuit.snapshotShipStats('pilot');
    expect(pilot).toMatchObject({ calls: 1, okCalls: 0, timeoutCalls: 1, errorCalls: 1 });
  });

  it('opens the circuit for later ships once a retryable failure occurs on any ship', async () => {
    const circuit = new FleetAiCircuit();
    await expect(
      circuit.runForShip('pilot', async () => {
        throw Object.assign(new Error('capacity'), { status: 429, code: 3040 });
      }),
    ).rejects.toBeInstanceOf(FleetAiDependencyError);

    await expect(circuit.runForShip('lookout', async () => 'should not run')).rejects.toBeInstanceOf(
      FleetAiDependencyError,
    );
    expect(circuit.snapshotShipStats('lookout')).toMatchObject({ calls: 1, errorCalls: 1 });
  });
});

describe('AiFailureDetail.elapsedMs', () => {
  it('reports how long the call actually ran before it failed', () => {
    expect(describeAiFailure({ status: 500, message: 'boom' }, 4_200).elapsedMs).toBe(4_200);
    expect(describeAiFailure({ status: 500, message: 'boom' }).elapsedMs).toBe(0);
    expect(describeAiFailure({ status: 500, message: 'boom' }, -5).elapsedMs).toBe(0);
  });

  it('surfaces elapsed time in the summary text once measured', () => {
    const failure = describeAiFailure({ status: 500, code: 5004, message: 'boom' }, 12_345);
    expect(failure.summary).toContain('12345ms elapsed');
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
