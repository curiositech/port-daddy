/**
 * Unit tests for the per-backend LLM adapters. These adapters are the
 * single source of "fetch from cloudflare / ollama" in the codebase —
 * both the spawner (spawn-shape, lib/spawner.ts) and the judge
 * (request-shape, via lib/llm-backend-resolver.ts) delegate to them.
 *
 * Network is mocked via globalThis.fetch.
 */
import { describe, expect, test, jest } from '@jest/globals';
import { cloudflareAdapter, ollamaAdapter, geminiAdapter, createLLMClient } from '../../lib/llm-call.js';

describe('cloudflareAdapter', () => {
  test('returns ok:false when CLOUDFLARE_ACCOUNT_ID is missing', async () => {
    const r = await cloudflareAdapter({ prompt: 'p', model: 'm', env: {} });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('CLOUDFLARE_ACCOUNT_ID');
  });

  test('returns ok:false when token is missing', async () => {
    const r = await cloudflareAdapter({ prompt: 'p', model: 'm', env: { CLOUDFLARE_ACCOUNT_ID: 'a' } });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('TOKEN');
  });

  test('success path: returns text + token usage from result.response', async () => {
    const env = { CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: 't' };
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        result: {
          response: 'hello',
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        },
      }), { status: 200 })
    );
    try {
      const r = await cloudflareAdapter({ prompt: 'p', model: '@cf/test', maxTokens: 200, env });
      // `raw` (the parsed result object) is now also surfaced for transcript
      // reconstruction — assert the stable fields, not exact object equality.
      expect(r).toMatchObject({
        ok: true,
        text: 'hello',
        inputTokens: 10,
        outputTokens: 5,
      });
      expect(r.raw).toBeDefined();
      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/a/ai/run/@cf/test');
      expect(opts.headers.Authorization).toBe('Bearer t');
      expect(JSON.parse(opts.body).max_tokens).toBe(200);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test('preserves Cloudflare model path separators while escaping unsafe segment characters', async () => {
    const env = { CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: 't' };
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ result: { response: 'ok' } }), { status: 200 })
    );
    try {
      const r = await cloudflareAdapter({
        prompt: 'p',
        model: '@cf/test org/model?variant#frag',
        env,
      });
      expect(r.ok).toBe(true);
      const [url] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/a/ai/run/@cf/test%20org/model%3Fvariant%23frag');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test('rejects unsafe model path segments before sending the bearer token', async () => {
    const env = { CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: 't' };
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ result: { response: 'should-not-call' } }), { status: 200 })
    );
    try {
      for (const model of ['@cf/../model', '@cf//model', '.', '']) {
        const r = await cloudflareAdapter({ prompt: 'p', model, env });
        expect(r.ok).toBe(false);
        expect(r.error).toContain('model must be a slash-delimited model id');
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test('extracts text from choices[0].message.content shape', async () => {
    const env = { CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: 't' };
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        result: { choices: [{ message: { content: 'chat-shape' } }] },
      }), { status: 200 })
    );
    try {
      const r = await cloudflareAdapter({ prompt: 'p', model: 'm', env });
      expect(r.ok).toBe(true);
      expect(r.text).toBe('chat-shape');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test('HTTP error → ok:false with status', async () => {
    const env = { CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: 't' };
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('quota exceeded', { status: 402 })
    );
    try {
      const r = await cloudflareAdapter({ prompt: 'p', model: 'm', env });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/HTTP 402/);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test('empty response body → ok:false', async () => {
    const env = { CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: 't' };
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ result: {} }), { status: 200 })
    );
    try {
      const r = await cloudflareAdapter({ prompt: 'p', model: 'm', env });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/no text response/);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test('fetch throws → ok:false with error message (no exceptions out)', async () => {
    const env = { CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: 't' };
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    try {
      const r = await cloudflareAdapter({ prompt: 'p', model: 'm', env });
      expect(r).toEqual({ ok: false, error: 'network down' });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test('alt env names (CF_ACCOUNT_ID, CF_API_TOKEN) work', async () => {
    const env = { CF_ACCOUNT_ID: 'cf-a', CF_API_TOKEN: 'cf-t' };
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ result: { response: 'ok' } }), { status: 200 })
    );
    try {
      const r = await cloudflareAdapter({ prompt: 'p', model: 'm', env });
      expect(r.ok).toBe(true);
      expect(fetchSpy.mock.calls[0][0]).toContain('/accounts/cf-a/');
      expect(fetchSpy.mock.calls[0][1].headers.Authorization).toBe('Bearer cf-t');
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('ollamaAdapter', () => {
  test('success path: parses message.content + token counts', async () => {
    const env = { OLLAMA_HOST: 'http://localhost:11434' };
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        message: { content: 'hi' },
        prompt_eval_count: 7,
        eval_count: 3,
      }), { status: 200 })
    );
    try {
      const r = await ollamaAdapter({ prompt: 'p', model: 'qwen2.5-coder:1.5b', maxTokens: 200, env });
      expect(r).toEqual({
        ok: true,
        text: 'hi',
        inputTokens: 7,
        outputTokens: 3,
      });
      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe('http://localhost:11434/api/chat');
      const body = JSON.parse(opts.body);
      expect(body.model).toBe('qwen2.5-coder:1.5b');
      expect(body.options).toEqual({ num_predict: 200 });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test('falls back to data.response when message.content is absent', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ response: 'legacy-shape' }), { status: 200 })
    );
    try {
      const r = await ollamaAdapter({ prompt: 'p', model: 'm', env: {} });
      expect(r.ok).toBe(true);
      expect(r.text).toBe('legacy-shape');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test('OLLAMA_HOST override is respected (and trailing slash trimmed)', async () => {
    const env = { OLLAMA_HOST: 'http://remote-ollama:8080/' };
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: { content: 'ok' } }), { status: 200 })
    );
    try {
      await ollamaAdapter({ prompt: 'p', model: 'm', env });
      expect(fetchSpy.mock.calls[0][0]).toBe('http://remote-ollama:8080/api/chat');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test('HTTP error → ok:false with status', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('model not found', { status: 404 })
    );
    try {
      const r = await ollamaAdapter({ prompt: 'p', model: 'm', env: {} });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/HTTP 404/);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test('empty response → ok:false', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 })
    );
    try {
      const r = await ollamaAdapter({ prompt: 'p', model: 'm', env: {} });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/no text response/);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('geminiAdapter', () => {
  test('returns ok:false when GEMINI_API_KEY is missing', async () => {
    const r = await geminiAdapter({ prompt: 'p', model: 'gemini-2.5-flash', env: {} });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('GEMINI_API_KEY');
  });

  test('rejects a model id that would inject into the URL path', async () => {
    const r = await geminiAdapter({ prompt: 'p', model: 'foo/bar', env: { GEMINI_API_KEY: 'k' } });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Invalid Gemini model id');
  });

  test('success path: extracts text + exact usage, folds thoughts into output', async () => {
    const env = { GEMINI_API_KEY: 'k' };
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'PONG' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 2, thoughtsTokenCount: 42 },
      }), { status: 200 })
    );
    try {
      const r = await geminiAdapter({ prompt: 'p', model: 'gemini-2.5-flash', maxTokens: 50, env });
      expect(r.ok).toBe(true);
      expect(r.text).toBe('PONG');
      expect(r.inputTokens).toBe(7);
      // thinking tokens (42) are billed as output, so 2 + 42 = 44.
      expect(r.outputTokens).toBe(44);
      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
      expect(opts.headers['x-goog-api-key']).toBe('k');
      expect(JSON.parse(opts.body).generationConfig.maxOutputTokens).toBe(50);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test('treats an empty completion as a failure, not zero-token success', async () => {
    const env = { GEMINI_API_KEY: 'k' };
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }],
        usageMetadata: { promptTokenCount: 7 },
      }), { status: 200 })
    );
    try {
      const r = await geminiAdapter({ prompt: 'p', model: 'gemini-2.5-flash', env });
      expect(r.ok).toBe(false);
      expect(r.error).toContain('no text response');
      expect(r.error).toContain('SAFETY');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test('surfaces HTTP errors', async () => {
    const env = { GEMINI_API_KEY: 'k' };
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('quota exceeded', { status: 429 })
    );
    try {
      const r = await geminiAdapter({ prompt: 'p', model: 'gemini-2.5-flash', env });
      expect(r.ok).toBe(false);
      expect(r.error).toContain('Gemini HTTP 429');
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('createLLMClient — shared cache/rate-limit/timeout/fallback', () => {
  function scriptedAdapter(scripted) {
    let i = 0;
    const calls = [];
    return {
      adapter: async (req) => {
        const idx = i++;
        const r = scripted[idx] ?? { ok: false, error: 'no script' };
        calls.push({ ...req, idx });
        if (r.delayMs) {
          await new Promise((resolve, reject) => {
            const timer = setTimeout(() => resolve(undefined), r.delayMs);
            req.signal?.addEventListener('abort', () => {
              clearTimeout(timer);
              reject(new DOMException('aborted', 'AbortError'));
            });
          });
        }
        return { ok: r.ok, text: r.text, error: r.error };
      },
      calls,
    };
  }

  test('passes call through to adapter and surfaces ok:true with text', async () => {
    const { adapter } = scriptedAdapter([{ ok: true, text: 'hello' }]);
    const client = createLLMClient({ adapter });
    const r = await client.complete({ prompt: 'p' });
    expect(r).toMatchObject({ ok: true, text: 'hello', cached: false, fellBack: false });
  });

  test('cache: same cacheKey returns cached:true on second call without invoking adapter', async () => {
    const { adapter, calls } = scriptedAdapter([{ ok: true, text: 'first' }]);
    const client = createLLMClient({ adapter, cacheTtlMs: 60_000 });
    const a = await client.complete({ prompt: 'p', cacheKey: 'k1' });
    const b = await client.complete({ prompt: 'p', cacheKey: 'k1' });
    expect(a.cached).toBe(false);
    expect(b.cached).toBe(true);
    expect(b.text).toBe('first');
    expect(calls).toHaveLength(1);
  });

  test('cache TTL: same key calls adapter again after expiry', async () => {
    const { adapter, calls } = scriptedAdapter([
      { ok: true, text: 'a' },
      { ok: true, text: 'b' },
    ]);
    let t = 1_000_000;
    const client = createLLMClient({ adapter, cacheTtlMs: 60_000, now: () => t });
    const a = await client.complete({ prompt: 'p', cacheKey: 'k' });
    t += 70_000;
    const b = await client.complete({ prompt: 'p', cacheKey: 'k' });
    expect(a.text).toBe('a');
    expect(b.text).toBe('b');
    expect(calls).toHaveLength(2);
  });

  test('no cacheKey → never caches even with TTL set', async () => {
    const { adapter, calls } = scriptedAdapter([
      { ok: true, text: '1' }, { ok: true, text: '2' },
    ]);
    const client = createLLMClient({ adapter, cacheTtlMs: 60_000 });
    await client.complete({ prompt: 'p' });
    await client.complete({ prompt: 'p' });
    expect(calls).toHaveLength(2);
  });

  test('rate limit: falls back when over callsPerMinute', async () => {
    const { adapter, calls } = scriptedAdapter([
      { ok: true, text: '1' }, { ok: true, text: '2' }, { ok: true, text: '3' },
    ]);
    let t = 1_000_000;
    const client = createLLMClient({ adapter, callsPerMinute: 2, now: () => t });
    await client.complete({ prompt: 'p' });
    await client.complete({ prompt: 'p' });
    const r3 = await client.complete({ prompt: 'p' });
    expect(r3).toMatchObject({ ok: false, fellBack: true, error: 'rate limited' });
    expect(calls).toHaveLength(2);
    expect(client.stats().rateLimited).toBe(1);

    // Advance past window — calls resume.
    t += 61_000;
    const r4 = await client.complete({ prompt: 'p' });
    expect(r4.fellBack).toBe(false);
  });

  test('rate limit: 0 callsPerMinute → unlimited', async () => {
    const { adapter, calls } = scriptedAdapter(Array.from({ length: 10 }, (_, i) => ({ ok: true, text: String(i) })));
    const client = createLLMClient({ adapter, callsPerMinute: 0 });
    for (let i = 0; i < 10; i++) await client.complete({ prompt: 'p' });
    expect(calls).toHaveLength(10);
    expect(client.stats().rateLimited).toBe(0);
  });

  test('timeout: aborts adapter and returns fellBack:true with error:timeout', async () => {
    const { adapter } = scriptedAdapter([{ ok: true, text: 'late', delayMs: 200 }]);
    const client = createLLMClient({ adapter, timeoutMs: 30 });
    const r = await client.complete({ prompt: 'p' });
    expect(r).toMatchObject({ ok: false, fellBack: true, error: 'timeout' });
    expect(client.stats().timedOut).toBe(1);
  }, 5_000);

  test('adapter error → fellBack:true with prefixed error', async () => {
    const { adapter } = scriptedAdapter([{ ok: false, error: 'auth missing' }]);
    const client = createLLMClient({ adapter });
    const r = await client.complete({ prompt: 'p' });
    expect(r).toMatchObject({ ok: false, fellBack: true });
    expect(r.error).toMatch(/adapter: auth missing/);
    expect(client.stats().llmFailures).toBe(1);
  });

  test('clearCache drops cached entries', async () => {
    const { adapter, calls } = scriptedAdapter([
      { ok: true, text: 'a' }, { ok: true, text: 'b' },
    ]);
    const client = createLLMClient({ adapter, cacheTtlMs: 60_000 });
    await client.complete({ prompt: 'p', cacheKey: 'k' });
    client.clearCache();
    const b = await client.complete({ prompt: 'p', cacheKey: 'k' });
    expect(b.text).toBe('b');
    expect(calls).toHaveLength(2);
  });

  test('cache hits do NOT count toward rate limit', async () => {
    // callsPerMinute=2 means only 2 *real* adapter calls per window.
    // Cache hits should be free.
    const { adapter, calls } = scriptedAdapter([
      { ok: true, text: '1' }, { ok: true, text: '2' }, { ok: true, text: '3' },
    ]);
    let t = 1_000_000;
    const client = createLLMClient({ adapter, cacheTtlMs: 60_000, callsPerMinute: 2, now: () => t });
    await client.complete({ prompt: 'p', cacheKey: 'k1' });            // miss → adapter #1
    expect((await client.complete({ prompt: 'p', cacheKey: 'k1' })).cached).toBe(true);
    expect((await client.complete({ prompt: 'p', cacheKey: 'k1' })).cached).toBe(true);
    const r4 = await client.complete({ prompt: 'p', cacheKey: 'k2' }); // miss → adapter #2
    expect(r4.fellBack).toBe(false);
    const r5 = await client.complete({ prompt: 'p', cacheKey: 'k3' }); // miss → rate-limited
    expect(r5).toMatchObject({ fellBack: true, error: 'rate limited' });
    expect(calls).toHaveLength(2);
  });
});
