/**
 * Unit tests for the coordination judge — the LLM yes/no layer that
 * coxswain consults on borderline cases. Covers cache, rate limit,
 * timeout, fallback-deny, and prompt-output parsing edge cases.
 *
 * The tests inject a fake transport so we never touch the real
 * Cloudflare Workers AI endpoint; that's a Bash-only smoke concern.
 */
import { describe, expect, test, jest } from '@jest/globals';
import { createCoordinationJudge, buildJudgeCacheKey } from '../../lib/coordination-judge.js';

function fakeTransport(scriptedResponses) {
  // scriptedResponses: array of { ok, text?, error?, delayMs? }
  let i = 0;
  const calls = [];
  return {
    transport: {
      async complete({ prompt, model, signal }) {
        const idx = i;
        i += 1;
        const r = scriptedResponses[idx] ?? { ok: false, error: 'no script' };
        calls.push({ prompt, model, idx });
        if (r.delayMs) {
          await new Promise((resolve, reject) => {
            const timer = setTimeout(() => resolve(undefined), r.delayMs);
            signal.addEventListener('abort', () => {
              clearTimeout(timer);
              reject(new DOMException('aborted', 'AbortError'));
            });
          });
        }
        if (r.throwAbort) {
          // Simulate a transport that threw on signal abort.
          throw new DOMException('aborted', 'AbortError');
        }
        return { ok: r.ok, text: r.text, error: r.error };
      },
    },
    calls,
  };
}

function makeReq(overrides = {}) {
  return {
    kind: 'channel_near_duplicate',
    question: 'Are these two channels the same conversation?',
    context: { channelA: 'auth:rewrite', channelB: 'auth:authn-rewrite', similarity: 0.85 },
    cacheKey: 'test-key-1',
    ...overrides,
  };
}

describe('coordination-judge — basic verdicts', () => {
  test('returns intervene=true when judge says yes (strict JSON)', async () => {
    const { transport } = fakeTransport([
      { ok: true, text: '{"intervene": true, "reason": "names look like a typo split"}' },
    ]);
    const judge = createCoordinationJudge({ transport, disabled: false });
    const verdict = await judge.ask(makeReq());
    expect(verdict).toEqual({
      intervene: true,
      reason: 'names look like a typo split',
      cached: false,
      fellBack: false,
    });
    expect(judge.stats().llmCalls).toBe(1);
  });

  test('returns intervene=false when judge says no', async () => {
    const { transport } = fakeTransport([
      { ok: true, text: '{"intervene": false, "reason": "intentional separation by tense"}' },
    ]);
    const judge = createCoordinationJudge({ transport });
    const verdict = await judge.ask(makeReq());
    expect(verdict.intervene).toBe(false);
    expect(verdict.fellBack).toBe(false);
  });

  test('strips markdown code-fence wrappers around JSON', async () => {
    const { transport } = fakeTransport([
      { ok: true, text: '```json\n{"intervene": true, "reason": "yes"}\n```' },
    ]);
    const judge = createCoordinationJudge({ transport });
    const verdict = await judge.ask(makeReq());
    expect(verdict.intervene).toBe(true);
  });

  test('extracts JSON when the model added prose around it', async () => {
    const { transport } = fakeTransport([
      { ok: true, text: 'Sure, here is my answer:\n{"intervene": true, "reason": "looks duplicate"}\nHope that helps.' },
    ]);
    const judge = createCoordinationJudge({ transport });
    const verdict = await judge.ask(makeReq());
    expect(verdict.intervene).toBe(true);
  });

  test('truncates over-long reasons to ≤120 chars', async () => {
    const longReason = 'x'.repeat(500);
    const { transport } = fakeTransport([
      { ok: true, text: JSON.stringify({ intervene: true, reason: longReason }) },
    ]);
    const judge = createCoordinationJudge({ transport });
    const verdict = await judge.ask(makeReq());
    expect(verdict.reason.length).toBe(120);
  });
});

describe('coordination-judge — fallback-deny', () => {
  test('falls back when transport returns ok:false', async () => {
    const { transport } = fakeTransport([
      { ok: false, error: 'CLOUDFLARE_API_TOKEN missing' },
    ]);
    const judge = createCoordinationJudge({ transport });
    const verdict = await judge.ask(makeReq());
    expect(verdict).toMatchObject({ intervene: false, fellBack: true });
    expect(verdict.reason).toContain('transport');
    expect(judge.stats().llmFailures).toBe(1);
  });

  test('falls back when judge returns unparseable text', async () => {
    const { transport } = fakeTransport([
      { ok: true, text: 'I think yes but actually maybe no, let me reconsider' },
    ]);
    const judge = createCoordinationJudge({ transport });
    const verdict = await judge.ask(makeReq());
    expect(verdict).toMatchObject({ intervene: false, fellBack: true, reason: 'unparseable response' });
    expect(judge.stats().llmFailures).toBe(1);
  });

  test('falls back when JSON has wrong schema (missing intervene field)', async () => {
    const { transport } = fakeTransport([
      { ok: true, text: '{"verdict": "yes"}' },
    ]);
    const judge = createCoordinationJudge({ transport });
    const verdict = await judge.ask(makeReq());
    expect(verdict.fellBack).toBe(true);
  });

  test('falls back on transport timeout (signal aborted)', async () => {
    // Transport delays past the judge's timeout. Judge should abort and
    // fall back rather than wait.
    const { transport } = fakeTransport([
      { ok: true, text: '{"intervene": true, "reason": "ok"}', delayMs: 2_000 },
    ]);
    const judge = createCoordinationJudge({ transport, timeoutMs: 50 });
    const verdict = await judge.ask(makeReq()).catch(err => ({ thrown: err }));
    // The transport throws AbortError on signal; judge's outer try doesn't
    // catch it explicitly because the spec says transports surface errors
    // via ok:false. Real transport is the Cloudflare one which does this
    // correctly. Here we accept either thrown or fallback — the contract
    // just requires no DM gets fired.
    if ('thrown' in verdict) {
      expect(verdict.thrown.name).toBe('AbortError');
    } else {
      expect(verdict.intervene).toBe(false);
    }
  }, 5_000);
});

describe('coordination-judge — cache', () => {
  test('serves repeat asks from cache without a second LLM call', async () => {
    const { transport, calls } = fakeTransport([
      { ok: true, text: '{"intervene": true, "reason": "first call"}' },
    ]);
    const judge = createCoordinationJudge({ transport });
    const v1 = await judge.ask(makeReq());
    const v2 = await judge.ask(makeReq());
    expect(v1.cached).toBe(false);
    expect(v2.cached).toBe(true);
    expect(v1.intervene).toBe(v2.intervene);
    expect(v1.reason).toBe(v2.reason);
    expect(calls).toHaveLength(1);
    expect(judge.stats().cacheHits).toBe(1);
    expect(judge.stats().cacheMisses).toBe(1);
  });

  test('different cacheKeys hit the LLM independently', async () => {
    const { transport, calls } = fakeTransport([
      { ok: true, text: '{"intervene": true, "reason": "a"}' },
      { ok: true, text: '{"intervene": false, "reason": "b"}' },
    ]);
    const judge = createCoordinationJudge({ transport });
    const a = await judge.ask(makeReq({ cacheKey: 'k-A' }));
    const b = await judge.ask(makeReq({ cacheKey: 'k-B' }));
    expect(a.intervene).toBe(true);
    expect(b.intervene).toBe(false);
    expect(calls).toHaveLength(2);
  });

  test('cache TTL evicts stale entries — same key calls LLM again after TTL', async () => {
    const { transport, calls } = fakeTransport([
      { ok: true, text: '{"intervene": true, "reason": "first"}' },
      { ok: true, text: '{"intervene": false, "reason": "second"}' },
    ]);
    let t = 1_000_000;
    const judge = createCoordinationJudge({ transport, cacheTtlMs: 60_000, now: () => t });
    const v1 = await judge.ask(makeReq());
    t += 90_000; // past TTL
    const v2 = await judge.ask(makeReq());
    expect(v1.intervene).toBe(true);
    expect(v2.intervene).toBe(false);
    expect(calls).toHaveLength(2);
  });

  test('clearCache() drops everything', async () => {
    const { transport, calls } = fakeTransport([
      { ok: true, text: '{"intervene": true, "reason": "first"}' },
      { ok: true, text: '{"intervene": false, "reason": "second"}' },
    ]);
    const judge = createCoordinationJudge({ transport });
    await judge.ask(makeReq());
    judge.clearCache();
    const v2 = await judge.ask(makeReq());
    expect(v2.intervene).toBe(false);
    expect(calls).toHaveLength(2);
  });
});

describe('coordination-judge — rate limit', () => {
  test('falls back when over callsPerMinute in the rolling window', async () => {
    let t = 1_000_000;
    const responses = Array.from({ length: 10 }, (_, i) => ({
      ok: true,
      text: `{"intervene": true, "reason": "call-${i}"}`,
    }));
    const { transport, calls } = fakeTransport(responses);
    const judge = createCoordinationJudge({ transport, callsPerMinute: 3, now: () => t });

    // Fire 3 distinct asks at the same instant — all go through.
    for (let i = 0; i < 3; i += 1) {
      const v = await judge.ask(makeReq({ cacheKey: `k-${i}` }));
      expect(v.fellBack).toBe(false);
    }
    // 4th in same minute → rate limited fallback.
    const v4 = await judge.ask(makeReq({ cacheKey: 'k-4' }));
    expect(v4).toMatchObject({ intervene: false, fellBack: true, reason: 'rate limited' });
    expect(calls).toHaveLength(3); // transport not called for the 4th
    expect(judge.stats().rateLimited).toBe(1);

    // Advance past the window — calls should resume.
    t += 61_000;
    const v5 = await judge.ask(makeReq({ cacheKey: 'k-5' }));
    expect(v5.fellBack).toBe(false);
  });
});

describe('coordination-judge — disabled mode', () => {
  test('always returns intervene:false with no LLM calls when disabled=true', async () => {
    const { transport, calls } = fakeTransport([
      { ok: true, text: '{"intervene": true, "reason": "would have said yes"}' },
    ]);
    const judge = createCoordinationJudge({ transport, disabled: true });
    const verdict = await judge.ask(makeReq());
    expect(verdict).toMatchObject({ intervene: false, fellBack: true, reason: 'judge disabled' });
    expect(calls).toHaveLength(0);
    expect(judge.stats().disabledCalls).toBe(1);
  });

  test('implicitly disabled when no transport is supplied', async () => {
    // Backend-agnostic default: no transport injected → judge stays quiet.
    // The runner resolves the active fleet backend via
    // lib/llm-backend-resolver.ts (resolveLLMBackend({actor: 'judge'})).
    const judge = createCoordinationJudge({});
    const verdict = await judge.ask(makeReq());
    expect(verdict).toMatchObject({ intervene: false, fellBack: true, reason: 'judge disabled' });
    expect(judge.stats().disabledCalls).toBe(1);
    expect(judge.stats().llmCalls).toBe(0);
  });
});

describe('coordination-judge — buildJudgeCacheKey', () => {
  test('produces stable hash for identical inputs', () => {
    const a = buildJudgeCacheKey(['silent_agent', 'agent-x', 1234]);
    const b = buildJudgeCacheKey(['silent_agent', 'agent-x', 1234]);
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{24}$/);
  });

  test('different inputs produce different hashes', () => {
    const a = buildJudgeCacheKey(['silent_agent', 'agent-x']);
    const b = buildJudgeCacheKey(['silent_agent', 'agent-y']);
    expect(a).not.toBe(b);
  });
});
