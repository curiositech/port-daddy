/**
 * Unit tests for the structured error + streaming contracts in
 * lib/event-envelope.ts — completing the agent-interchange-formats quality gates
 * the base envelope (#252) didn't cover:
 *
 *   - "Retry behavior is encoded structurally, not only described in prose."
 *     Shibboleth: if a caller must read prose to learn whether an error is
 *     retryable, it is not a machine-grade contract.
 *   - "Streaming contracts specify ordering and completion semantics."
 *     A stream must have a monotonic sequence, a terminal marker, and
 *     deterministic, reorder-safe reassembly.
 */

import {
  makeError,
  isRetryable,
  nextRetryDelayMs,
  AGENT_ERROR_CODES,
  makeStreamEvent,
  assembleStream,
} from '../../lib/event-envelope.js';

describe('agent error: machine-grade retry contract', () => {
  test('makeError builds a typed, retryable error with bounded retry policy', () => {
    const e = makeError({ code: 'RATE_LIMITED', message: 'slow down', retryAfterMs: 1000, maxRetries: 3 });
    expect(e.code).toBe('RATE_LIMITED');
    expect(e.retryable).toBe(true);
    expect(e.retryAfterMs).toBe(1000);
    expect(e.maxRetries).toBe(3);
  });

  test('a non-retryable code is structurally non-retryable (no prose-reading)', () => {
    const e = makeError({ code: 'VALIDATION_ERROR', message: 'bad field' });
    expect(e.retryable).toBe(false);
    expect(isRetryable(e)).toBe(false);
  });

  test('an unknown code defaults to non-retryable (fail closed)', () => {
    expect(makeError({ code: 'WHATEVER', message: 'x' }).retryable).toBe(false);
  });

  test('explicit retryable overrides the code default', () => {
    expect(makeError({ code: 'INTERNAL', message: 'transient', retryable: true }).retryable).toBe(true);
    expect(makeError({ code: 'RATE_LIMITED', message: 'x', retryable: false }).retryable).toBe(false);
  });

  test('nextRetryDelayMs applies exponential backoff bounded by maxRetries', () => {
    const e = makeError({ code: 'RATE_LIMITED', message: 'x', retryAfterMs: 100, maxRetries: 3 });
    expect(nextRetryDelayMs(e, 1)).toBe(100);
    expect(nextRetryDelayMs(e, 2)).toBe(200);
    expect(nextRetryDelayMs(e, 3)).toBe(400);
    expect(nextRetryDelayMs(e, 4)).toBeNull();
  });

  test('a non-retryable error never yields a retry delay', () => {
    expect(nextRetryDelayMs(makeError({ code: 'VALIDATION_ERROR', message: 'x' }), 1)).toBeNull();
  });

  test('details + message are preserved; serializes round-trip', () => {
    const e = makeError({ code: 'RATE_LIMITED', message: 'quota', retryAfterMs: 50, details: { quota: 'rpm' } });
    const restored = JSON.parse(JSON.stringify(e));
    expect(restored.details.quota).toBe('rpm');
    expect(restored.message).toBe('quota');
  });

  test('AGENT_ERROR_CODES is a closed enum the contract is built on', () => {
    expect(AGENT_ERROR_CODES).toContain('RATE_LIMITED');
    expect(AGENT_ERROR_CODES).toContain('VALIDATION_ERROR');
    expect(AGENT_ERROR_CODES.length).toBeGreaterThan(3);
  });
});

describe('streaming: ordering + completion semantics', () => {
  test('assembleStream concatenates chunks in seq order and detects completion', () => {
    const ev = [
      makeStreamEvent({ streamId: 's1', seq: 0, chunk: 'Hel' }),
      makeStreamEvent({ streamId: 's1', seq: 1, chunk: 'lo ' }),
      makeStreamEvent({ streamId: 's1', seq: 2, chunk: 'world', done: true }),
    ];
    const r = assembleStream(ev);
    expect(r.complete).toBe(true);
    expect(r.text).toBe('Hello world');
    expect(r.error).toBeNull();
  });

  test('out-of-order events reassemble deterministically by seq', () => {
    const ev = [
      makeStreamEvent({ streamId: 's1', seq: 2, chunk: 'world', done: true }),
      makeStreamEvent({ streamId: 's1', seq: 0, chunk: 'Hel' }),
      makeStreamEvent({ streamId: 's1', seq: 1, chunk: 'lo ' }),
    ];
    expect(assembleStream(ev).text).toBe('Hello world');
  });

  test('a gap in the sequence is reported, not silently corrupted', () => {
    const ev = [
      makeStreamEvent({ streamId: 's1', seq: 0, chunk: 'a' }),
      makeStreamEvent({ streamId: 's1', seq: 2, chunk: 'c', done: true }),
    ];
    const r = assembleStream(ev);
    expect(r.complete).toBe(false);
    expect(r.error).toMatch(/gap|missing/i);
  });

  test('missing terminal marker → not complete', () => {
    const ev = [
      makeStreamEvent({ streamId: 's1', seq: 0, chunk: 'a' }),
      makeStreamEvent({ streamId: 's1', seq: 1, chunk: 'b' }),
    ];
    expect(assembleStream(ev).complete).toBe(false);
  });

  test('a duplicate seq (relay replay) is idempotent, not doubled', () => {
    const ev = [
      makeStreamEvent({ streamId: 's1', seq: 0, chunk: 'a' }),
      makeStreamEvent({ streamId: 's1', seq: 0, chunk: 'a' }),
      makeStreamEvent({ streamId: 's1', seq: 1, chunk: 'b', done: true }),
    ];
    expect(assembleStream(ev).text).toBe('ab');
  });

  test('events from a different streamId are rejected (no cross-stream mixing)', () => {
    const ev = [
      makeStreamEvent({ streamId: 's1', seq: 0, chunk: 'a' }),
      makeStreamEvent({ streamId: 's2', seq: 1, chunk: 'b', done: true }),
    ];
    expect(assembleStream(ev).error).toMatch(/stream/i);
  });

  test('makeStreamEvent validates its fields (fail closed)', () => {
    expect(() => makeStreamEvent({ streamId: '', seq: 0, chunk: 'a' })).toThrow();
    expect(() => makeStreamEvent({ streamId: 's', seq: -1, chunk: 'a' })).toThrow();
    expect(() => makeStreamEvent({ streamId: 's', seq: 0, chunk: 5 })).toThrow();
  });

  test('empty event list → not complete, no error', () => {
    const r = assembleStream([]);
    expect(r.complete).toBe(false);
    expect(r.text).toBe('');
  });
});
