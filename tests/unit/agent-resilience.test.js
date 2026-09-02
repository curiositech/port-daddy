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
  isWitnessedBackendFailure,
} from '../../lib/agent-resilience.js';
import { isRetryable } from '../../lib/event-envelope.js';

describe('classifyAgentError', () => {
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
    const error = new Error('unknown');
    Object.defineProperty(error, 'status', { get() { throw new Error('getter executed'); } });
    expect(() => classifyAgentError(error)).not.toThrow();
    expect(classifyAgentError(error).retryable).toBe(false);
  });
});

describe('parseRetryAfterMs', () => {
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
    cb.onRetryableFailure('codex');
    cb.onRetryableFailure('codex');
    expect(cb.state('codex')).toBe('CLOSED'); // 2 < 3
    cb.onRetryableFailure('codex');
    expect(cb.state('codex')).toBe('OPEN');
  });

  test('OPEN gate throws CircuitOpenError until cooldown, then HALF_OPEN', () => {
    const clock = mkClock();
    const cb = new BackendCircuitBreaker({ failureThreshold: 1, successThreshold: 1, openTimeoutMs: 1000, now: clock.now });
    cb.onRetryableFailure('gemini'); // opens
    expect(cb.state('gemini')).toBe('OPEN');
    expect(() => cb.before('gemini')).toThrow(CircuitOpenError);
    clock.advance(1000);
    cb.before('gemini'); // cooldown elapsed → probe allowed
    expect(cb.state('gemini')).toBe('HALF_OPEN');
  });

  test('HALF_OPEN: probe success closes after successThreshold', () => {
    const clock = mkClock();
    const cb = new BackendCircuitBreaker({ failureThreshold: 1, successThreshold: 2, openTimeoutMs: 100, now: clock.now });
    cb.onRetryableFailure('groq');
    clock.advance(100);
    cb.before('groq'); // → HALF_OPEN
    cb.onSuccess('groq'); // 1
    expect(cb.state('groq')).toBe('HALF_OPEN');
    cb.onSuccess('groq'); // 2 → CLOSED
    expect(cb.state('groq')).toBe('CLOSED');
  });

  test('HALF_OPEN: probe failure re-opens immediately', () => {
    const clock = mkClock();
    const cb = new BackendCircuitBreaker({ failureThreshold: 1, successThreshold: 1, openTimeoutMs: 100, now: clock.now });
    cb.onRetryableFailure('claude-cli');
    clock.advance(100);
    cb.before('claude-cli'); // → HALF_OPEN
    cb.onRetryableFailure('claude-cli'); // re-open
    expect(cb.state('claude-cli')).toBe('OPEN');
  });

  test('per-backend isolation: one tripping does not gate another', () => {
    const cb = new BackendCircuitBreaker({ failureThreshold: 1, successThreshold: 1, openTimeoutMs: 1000 });
    cb.onRetryableFailure('codex');
    expect(cb.state('codex')).toBe('OPEN');
    expect(cb.state('gemini')).toBe('CLOSED');
    expect(() => cb.before('gemini')).not.toThrow();
  });

  test('a success resets the consecutive-failure count', () => {
    const cb = new BackendCircuitBreaker({ failureThreshold: 3, successThreshold: 1, openTimeoutMs: 1000 });
    cb.onRetryableFailure('codex');
    cb.onRetryableFailure('codex');
    cb.onSuccess('codex'); // reset
    cb.onRetryableFailure('codex');
    cb.onRetryableFailure('codex');
    expect(cb.state('codex')).toBe('CLOSED'); // would have opened without the reset
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
});
