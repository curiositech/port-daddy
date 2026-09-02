/**
 * Unit tests for lib/agent-resilience.ts
 *
 * Resilience for expensive-agent launches, composed on the structured
 * `AgentError` retry contract (lib/event-envelope.ts). Quality gates:
 *   - classify raw provider strings → the right closed AGENT_ERROR_CODE
 *   - full-jitter backoff stays within [0, min(cap, base·2^attempt))
 *   - circuit breaker: CLOSED → OPEN (threshold) → HALF_OPEN (cooldown) →
 *     CLOSED (probe success) / OPEN (probe fail)
 *   - non-retryable failures never retry and never trip the breaker
 *   - Retry-After is honoured over computed backoff
 *   - per-backend isolation: one backend tripping does not gate another
 */

import { jest } from '@jest/globals';
import {
  classifyAgentError,
  parseRetryAfterMs,
  fullJitterDelay,
  BackendCircuitBreaker,
  CircuitOpenError,
  runResilientSpawn,
  witnessedBackendFailure,
  localModelDownloadDisabledError,
  isWitnessedBackendFailure,
  safeDiagnosticIdentifier,
} from '../../lib/agent-resilience.js';
import { isRetryable } from '../../lib/event-envelope.js';

describe('classifyAgentError', () => {
  test('only authentic local policy errors retain fixed actionable diagnostic status', () => {
    const original = localModelDownloadDisabledError();
    expect(original).toBeInstanceOf(Error);
    expect(Object.isFrozen(original)).toBe(true);
    const classified = classifyAgentError(original);
    expect(classified).toMatchObject({ code: 'UNAVAILABLE', retryable: false, details: { reason: 'model_download_disabled' } });
    expect(classified.message).toContain('PORT_DADDY_ALLOW_MODEL_DOWNLOAD=1');
    expect(isWitnessedBackendFailure(original)).toBe(false);
    expect(isWitnessedBackendFailure(classified)).toBe(false);
    for (const copied of [JSON.parse(JSON.stringify(classified)), new Error(original.message), original.message,
      Object.assign(new Error('policy unavailable'), { code: 'UNAVAILABLE', retryable: true, reason: 'model_download_disabled' })]) {
      const rejected = classifyAgentError(copied);
      expect(rejected.retryable).toBe(false);
      expect(rejected.details?.reason).not.toBe('model_download_disabled');
      expect(rejected.message).not.toContain('PORT_DADDY_ALLOW_MODEL_DOWNLOAD=1');
      expect(isWitnessedBackendFailure(copied)).toBe(false);
    }
  });

  test.each([
    ['429 Too Many Requests', 'RATE_LIMITED', true],
    ['Error: rate limit exceeded', 'RATE_LIMITED', true],
    ["You've hit your usage limit, try again later", 'RATE_LIMITED', true],
    ['request timed out after 30s', 'TIMEOUT', true],
    ['ETIMEDOUT', 'TIMEOUT', true],
    ['503 Service Unavailable', 'UNAVAILABLE', true],
    ['upstream overloaded', 'UNAVAILABLE', true],
    ['ECONNRESET', 'UNAVAILABLE', true],
    ['409 conflict', 'CONFLICT', true],
    ['400 Bad Request: malformed', 'VALIDATION_ERROR', false],
    ['invalid api key', 'VALIDATION_ERROR', false],
    ['unknown backend: frob', 'VALIDATION_ERROR', false],
    ['401 Unauthorized', 'UNAUTHORIZED', false],
    ['403 forbidden', 'UNAUTHORIZED', false],
    ['404 not found', 'NOT_FOUND', false],
    ['some weird unrecognized failure', 'INTERNAL', false],
  ])('maps %p → %s (retryable=%p)', (msg, code, retryable) => {
    const e = classifyAgentError(msg, { backend: 'codex' });
    expect(e.code).toBe(code);
    expect(isRetryable(e)).toBe(retryable);
    expect(e.details).toEqual({ backend: 'codex' });
  });

  test('accepts an Error instance', () => {
    const e = classifyAgentError(new Error('429 slow down'));
    expect(e.code).toBe('RATE_LIMITED');
  });

  test('unknown failure is fail-closed (non-retryable)', () => {
    expect(isRetryable(classifyAgentError('kaboom'))).toBe(false);
  });

  test('structured permanent status outranks untrusted transient prose and nested wrappers', () => {
    const denied = Object.assign(new Error('untrusted detail mentions 429 timeout'), { status: 401 });
    expect(classifyAgentError(denied)).toMatchObject({ code: 'UNAUTHORIZED', retryable: false });
    const wrapper = Object.assign(new Error('503 unavailable'), { status: 503, cause: denied });
    expect(classifyAgentError(wrapper).code).toBe('UNAUTHORIZED');
    denied.cause = wrapper;
    expect(classifyAgentError(wrapper).code).toBe('UNAUTHORIZED');
    expect(classifyAgentError('401 Unauthorized; untrusted detail mentions 429 timeout').retryable).toBe(false);
  });

  test('JSON cannot impersonate a host witness and diagnostics omit private error content', () => {
    const actual = witnessedBackendFailure({ kind: 'os', code: 'ENOENT' });
    expect(isWitnessedBackendFailure(actual)).toBe(true);
    expect(classifyAgentError(actual).code).toBe('BACKEND_ABSENT');
    const forged = JSON.parse(JSON.stringify(actual));
    expect(isWitnessedBackendFailure(forged)).toBe(false);
    expect(classifyAgentError(forged)).toMatchObject({ code: 'INTERNAL', retryable: false });
    expect(classifyAgentError({ status: 503, message: 'retry me' }).retryable).toBe(false);
    expect(JSON.stringify(classifyAgentError(new Error('401 SYNTHETIC_PRIVATE_MARKER')))).not.toContain('SYNTHETIC_PRIVATE_MARKER');
  });

  test('exception getters are not executed', () => {
    const error = new Error('429 timeout');
    Object.defineProperty(error, 'status', { get() { throw new Error('getter executed'); } });
    expect(() => classifyAgentError(error)).not.toThrow();
    expect(classifyAgentError(error).retryable).toBe(false);
  });

  test.each([401, 403])('conflicting own status fields retain permanent authority fact %s', statusCode => {
    const error = Object.assign(new Error('429 timeout'), { status: 429, statusCode });
    expect(classifyAgentError(error)).toMatchObject({ code: 'UNAUTHORIZED', retryable: false });
    expect(classifyAgentError(Object.assign(new Error('503 unavailable'), { status: 503, cause: error })).retryable).toBe(false);
  });

  test('private or oversized identifiers cannot enter diagnostics verbatim', () => {
    const marker = 'SYNTHETIC_PRIVATE_MARKER';
    const result = classifyAgentError(new Error('401 denied'), { backend: marker });
    expect(JSON.stringify(result)).not.toContain(marker);
    expect(result.details.backend).toMatch(/^backend:[a-f0-9]{16}$/);
    expect(safeDiagnosticIdentifier(marker, 'dependency')).toMatch(/^dependency:[a-f0-9]{16}$/);
    expect(safeDiagnosticIdentifier('x'.repeat(1025))).toBe('backend:unspecified');
    expect(safeDiagnosticIdentifier('cli:codex')).toBe('cli:codex');
  });
});

describe('parseRetryAfterMs', () => {
  test('all nested hints preserve the longest minimum and any invalid hint refuses retry', () => {
    expect(parseRetryAfterMs('retry after 1s; Retry-After: 3s')).toBe(3000);
    expect(parseRetryAfterMs('retry after 1s; Retry-After: -3s')).toBeUndefined();
    const cause = Object.assign(new Error('retry after 3s'), { status: 429 });
    expect(classifyAgentError(new Error('retry after 1s', { cause })).retryAfterMs).toBe(3000);
  });
  test.each([
    ['retry after 30', 30000],
    ['Retry-After: 1500ms', 1500],
    ['retry-after 2 min', 120000],
    ['retry after 5 seconds', 5000],
    ['no hint here', undefined],
  ])('%p → %p', (msg, ms) => {
    expect(parseRetryAfterMs(msg)).toBe(ms);
  });

  test('classifyAgentError carries retryAfterMs through', () => {
    const e = classifyAgentError('429 rate limit; retry after 10');
    expect(e.retryAfterMs).toBe(10000);
  });

  test.each(['retry-after -5', 'retry-after 1.5s', 'retry-after 1e9', `retry-after ${'9'.repeat(308)} min`])('rejects malformed or overflowing delay %s', message => {
    expect(parseRetryAfterMs(message)).toBeUndefined();
    expect(classifyAgentError(`429; ${message}`)).toMatchObject({ retryable: false, details: { reason: 'invalid_retry_after' } });
  });
});

describe('fullJitterDelay', () => {
  const cfg = { baseMs: 100, capMs: 30000 };

  test('is bounded by [0, min(cap, base·2^attempt))', () => {
    for (let attempt = 0; attempt < 12; attempt++) {
      const ceiling = Math.min(cfg.capMs, cfg.baseMs * 2 ** attempt);
      const d = fullJitterDelay(attempt, { ...cfg, random: () => 0.999999 });
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(ceiling);
    }
  });

  test('random=0 yields 0; random≈1 yields near-ceiling', () => {
    expect(fullJitterDelay(3, { ...cfg, random: () => 0 })).toBe(0);
    const ceiling = cfg.baseMs * 2 ** 3; // 800
    expect(fullJitterDelay(3, { ...cfg, random: () => 0.5 })).toBe(Math.floor(0.5 * ceiling));
  });

  test('respects the cap at high attempts', () => {
    const d = fullJitterDelay(20, { ...cfg, random: () => 1 });
    expect(d).toBeLessThanOrEqual(cfg.capMs);
  });

  test.each([1024, Number.MAX_SAFE_INTEGER])('zero base and huge attempt %s stay finite', attempt => {
    expect(fullJitterDelay(attempt, { baseMs: 0, capMs: 10, random: () => 1 })).toBe(0);
    expect(fullJitterDelay(attempt, { baseMs: 1, capMs: 10, random: () => 1 })).toBe(10);
    expect(fullJitterDelay(attempt, { baseMs: 10, capMs: 0, random: () => 1 })).toBe(0);
  });
});

describe('BackendCircuitBreaker', () => {
  const mkClock = () => {
    let t = 0;
    return { now: () => t, advance: (ms) => (t += ms) };
  };

  test('opens after failureThreshold consecutive retryable failures', () => {
    const clock = mkClock();
    const cb = new BackendCircuitBreaker({ failureThreshold: 3, successThreshold: 2, openTimeoutMs: 1000, now: clock.now });
    expect(cb.state('codex')).toBe('CLOSED');
    cb.before('codex').settle('failure');
    cb.before('codex').settle('failure');
    expect(cb.state('codex')).toBe('CLOSED'); // 2 < 3
    cb.before('codex').settle('failure');
    expect(cb.state('codex')).toBe('OPEN');
  });

  test('OPEN gate throws CircuitOpenError until cooldown, then HALF_OPEN', () => {
    const clock = mkClock();
    const cb = new BackendCircuitBreaker({ failureThreshold: 1, successThreshold: 1, openTimeoutMs: 1000, now: clock.now });
    cb.before('gemini').settle('failure'); // opens
    expect(cb.state('gemini')).toBe('OPEN');
    expect(() => cb.before('gemini')).toThrow(CircuitOpenError);
    clock.advance(1000);
    cb.before('gemini'); // cooldown elapsed → probe allowed
    expect(cb.state('gemini')).toBe('HALF_OPEN');
  });

  test('HALF_OPEN: probe success closes after successThreshold', () => {
    const clock = mkClock();
    const cb = new BackendCircuitBreaker({ failureThreshold: 1, successThreshold: 2, openTimeoutMs: 100, now: clock.now });
    cb.before('groq').settle('failure');
    clock.advance(100);
    cb.before('groq').settle('success'); // 1
    expect(cb.state('groq')).toBe('HALF_OPEN');
    cb.before('groq').settle('success'); // 2 → CLOSED
    expect(cb.state('groq')).toBe('CLOSED');
  });

  test('HALF_OPEN: probe failure re-opens immediately', () => {
    const clock = mkClock();
    const cb = new BackendCircuitBreaker({ failureThreshold: 1, successThreshold: 1, openTimeoutMs: 100, now: clock.now });
    cb.before('claude-cli').settle('failure');
    clock.advance(100);
    cb.before('claude-cli').settle('failure'); // re-open
    expect(cb.state('claude-cli')).toBe('OPEN');
  });

  test('per-backend isolation: one tripping does not gate another', () => {
    const cb = new BackendCircuitBreaker({ failureThreshold: 1, successThreshold: 1, openTimeoutMs: 1000 });
    cb.before('codex').settle('failure');
    expect(cb.state('codex')).toBe('OPEN');
    expect(cb.state('gemini')).toBe('CLOSED');
    expect(() => cb.before('gemini')).not.toThrow();
  });

  test('a success resets the consecutive-failure count', () => {
    const cb = new BackendCircuitBreaker({ failureThreshold: 3, successThreshold: 1, openTimeoutMs: 1000 });
    cb.before('codex').settle('failure');
    cb.before('codex').settle('failure');
    cb.before('codex').settle('success'); // reset
    cb.before('codex').settle('failure');
    cb.before('codex').settle('failure');
    expect(cb.state('codex')).toBe('CLOSED'); // would have opened without the reset
  });

  test('one probe, exact-once settlement, and stale-generation completions', () => {
    const c = mkClock();
    const cb = new BackendCircuitBreaker({ failureThreshold: 1, successThreshold: 2, openTimeoutMs: 100, now: c.now });
    const stale = cb.before('codex');
    cb.before('codex').settle('failure');
    c.advance(100);
    const probe = cb.before('codex');
    expect(() => cb.before('codex')).toThrow(CircuitOpenError);
    stale.settle('success');
    expect(cb.state('codex')).toBe('HALF_OPEN');
    expect(() => cb.before('codex')).toThrow(CircuitOpenError);
    probe.settle('success');
    probe.settle('success');
    expect(cb.state('codex')).toBe('HALF_OPEN');
    cb.before('codex').settle('success');
    expect(cb.state('codex')).toBe('CLOSED');
  });

  test('an abandoned physical probe retains its reservation until it really settles', () => {
    const c = mkClock();
    const cb = new BackendCircuitBreaker({ failureThreshold: 1, successThreshold: 1, openTimeoutMs: 100, now: c.now });
    cb.before('codex').settle('failure');
    c.advance(100);
    const probe = cb.before('codex');
    probe.abandon();
    c.advance(1000);
    expect(() => cb.before('codex')).toThrow(CircuitOpenError);
    probe.settle('success'); // late success cannot close the newer outage
    expect(cb.state('codex')).toBe('OPEN');
    cb.before('codex').settle('success');
    expect(cb.state('codex')).toBe('CLOSED');
  });
});

describe('runResilientSpawn', () => {
  const noSleep = async () => {};
  const mkBreaker = (over = {}) =>
    new BackendCircuitBreaker({ failureThreshold: 99, successThreshold: 1, openTimeoutMs: 1000, ...over });

  test('returns on first success', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const out = await runResilientSpawn('codex', fn, {
      maxAttempts: 3,
      backoff: { baseMs: 1, capMs: 10 },
      breaker: mkBreaker(),
      sleep: noSleep,
    });
    expect(out).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('retries transient failures then succeeds', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('429 rate limit'))
      .mockRejectedValueOnce(new Error('503 unavailable'))
      .mockResolvedValue('done');
    const events = [];
    const out = await runResilientSpawn('gemini', fn, {
      maxAttempts: 5,
      backoff: { baseMs: 1, capMs: 10, random: () => 0 },
      breaker: mkBreaker(),
      sleep: noSleep,
      onEvent: (e) => events.push(e.kind),
    });
    expect(out).toBe('done');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(events.filter((k) => k === 'retry')).toHaveLength(2);
    expect(events).toContain('success');
  });

  test('never retries a non-retryable failure', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('401 unauthorized'));
    await expect(
      runResilientSpawn('groq-cli', fn, {
        maxAttempts: 5,
        backoff: { baseMs: 1, capMs: 10 },
        breaker: mkBreaker(),
        sleep: noSleep,
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED', retryable: false });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('non-retryable failure does NOT trip the breaker', async () => {
    const breaker = mkBreaker({ failureThreshold: 1 });
    const fn = jest.fn().mockRejectedValue(new Error('400 malformed'));
    await expect(
      runResilientSpawn('codex', fn, { maxAttempts: 3, backoff: { baseMs: 1, capMs: 10 }, breaker, sleep: noSleep }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(breaker.state('codex')).toBe('CLOSED');
  });

  test('exhausts retries and throws the last AgentError', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('429 slow down'));
    await expect(
      runResilientSpawn('codex', fn, {
        maxAttempts: 3,
        backoff: { baseMs: 1, capMs: 10, random: () => 0 },
        breaker: mkBreaker(),
        sleep: noSleep,
      }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED', retryable: true });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('retryable failures trip the breaker and the next call is gated', async () => {
    const breaker = mkBreaker({ failureThreshold: 2 });
    const fn = jest.fn().mockRejectedValue(new Error('503 unavailable'));
    // First call: 2 attempts both fail → breaker opens (2 retryable failures).
    await expect(
      runResilientSpawn('gemini', fn, { maxAttempts: 2, backoff: { baseMs: 1, capMs: 10, random: () => 0 }, breaker, sleep: noSleep }),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(breaker.state('gemini')).toBe('OPEN');
    // Second call: breaker OPEN → CircuitOpenError, fn never invoked again.
    const calls = fn.mock.calls.length;
    await expect(
      runResilientSpawn('gemini', () => fn(), { maxAttempts: 3, backoff: { baseMs: 1, capMs: 10 }, breaker, sleep: noSleep }),
    ).rejects.toBeInstanceOf(CircuitOpenError);
    expect(fn.mock.calls.length).toBe(calls);
  });

  test('honours Retry-After over computed backoff', async () => {
    const delays = [];
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('429 rate limit; retry after 7'))
      .mockResolvedValue('ok');
    await runResilientSpawn('codex', fn, {
      maxAttempts: 3,
      backoff: { baseMs: 1, capMs: 10, random: () => 0 },
      breaker: mkBreaker(),
      sleep: async (ms) => { delays.push(ms); },
    });
    expect(delays).toEqual([7000]); // Retry-After wins over jitter(=0)
  });

  test('server minimum that cannot fit total deadline never sleeps or retries early', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('429 retry after 100000000000 min'));
    const sleep = jest.fn();
    await expect(runResilientSpawn('codex', fn, {
      maxAttempts: 3, totalTimeoutMs: 100, breaker: mkBreaker(), sleep,
      backoff: { baseMs: 1, capMs: 2 },
    })).rejects.toMatchObject({ retryable: false, details: { reason: 'retry_after_exceeds_deadline' } });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  test('one deadline includes operations plus backoff and private observer labels are safe', async () => {
    let now = 0;
    const events = [];
    const fn = jest.fn().mockImplementation(async () => { now += 6; throw new Error('503 SYNTHETIC_SECRET'); });
    await expect(runResilientSpawn('SYNTHETIC_PRIVATE_BACKEND', fn, {
      maxAttempts: 5, totalTimeoutMs: 10, now: () => now, breaker: mkBreaker(),
      backoff: { baseMs: 3, capMs: 3, random: () => 1 }, sleep: async ms => { now += ms; },
      onEvent: event => events.push(event),
    })).rejects.toMatchObject({ code: 'TIMEOUT', retryable: false });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(events)).not.toContain('SYNTHETIC');
  });

  test('cancellation during backoff does not launch again and discards private abort reason', async () => {
    const controller = new AbortController();
    const fn = jest.fn().mockRejectedValue(new Error('503 unavailable'));
    await expect(runResilientSpawn('codex', fn, {
      maxAttempts: 3, breaker: mkBreaker(), signal: controller.signal,
      backoff: { baseMs: 1, capMs: 2 },
      sleep: async () => { controller.abort('SYNTHETIC_SECRET'); await new Promise(() => {}); },
    })).rejects.toMatchObject({ code: 'CANCELLED', retryable: false });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('real deadline aborts an uncooperative probe but retains its physical reservation', async () => {
    const breaker = mkBreaker({ failureThreshold: 1, openTimeoutMs: 0 });
    breaker.before('codex').settle('failure');
    let release;
    let signal;
    const work = new Promise(resolve => { release = resolve; });
    await expect(runResilientSpawn('codex', async s => { signal = s; return work; }, {
      maxAttempts: 2, totalTimeoutMs: 10, breaker, backoff: { baseMs: 1, capMs: 2 },
    })).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(signal.aborted).toBe(true);
    expect(() => breaker.before('codex')).toThrow(CircuitOpenError);
    release('late');
    await new Promise(resolve => setImmediate(resolve));
    expect(breaker.state('codex')).toBe('OPEN');
    breaker.before('codex').settle('success');
    expect(breaker.state('codex')).toBe('CLOSED');
  });

  test('observer exceptions cannot strand a probe or retry successful work', async () => {
    const breaker = mkBreaker({ failureThreshold: 1, openTimeoutMs: 0 });
    breaker.before('codex').settle('failure');
    const fn = jest.fn().mockResolvedValue('ok');
    expect(await runResilientSpawn('codex', fn, {
      maxAttempts: 2, breaker, backoff: { baseMs: 1, capMs: 2 }, onEvent: () => { throw new Error('observer'); },
    })).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(breaker.state('codex')).toBe('CLOSED');
  });

  test.each([Infinity, 0, -1, 2_147_483_648])('rejects invalid total budget %s before work', async totalTimeoutMs => {
    const fn = jest.fn();
    await expect(runResilientSpawn('codex', fn, {
      maxAttempts: 2, totalTimeoutMs, breaker: mkBreaker(), backoff: { baseMs: 1, capMs: 2 },
    })).rejects.toThrow(RangeError);
    expect(fn).not.toHaveBeenCalled();
  });
});
