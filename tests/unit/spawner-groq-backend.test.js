/**
 * Groq backend unit tests.
 *
 * The Groq backend reuses the OpenAI adapter with a base-url + api-key
 * override (Groq is OpenAI-API-compatible). These tests mock global
 * `fetch` and `lib/secret-env.getSecret` to exercise:
 *   - Missing API key path (no fetch call, returns ok:false)
 *   - Happy path (200, choices[0].message.content + usage extracted)
 *   - The request hits Groq's base URL with the Groq key as Bearer
 *   - GROQ_API_BASE override
 *
 * No network. A live smoke test against real Groq lives in
 * tests/integration (gated behind GROQ_API_KEY presence).
 */

import { jest } from '@jest/globals';

const secretValues = new Map();
const mockGetSecret = jest.fn((key) => secretValues.get(key));

jest.unstable_mockModule('../../lib/secret-env.js', () => ({
  getSecret: mockGetSecret,
}));

const { groqAdapter, SUPPORTED_GROQ_MODELS, DEFAULT_GROQ_MODEL, GROQ_DEFAULT_BASE_URL } =
  await import('../../lib/spawner/backends/groq.js');

const origFetch = global.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  secretValues.clear();
  delete process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_BASE;
  delete process.env.OPENAI_API_KEY;
});

afterAll(() => {
  global.fetch = origFetch;
});

describe('groqAdapter — auth', () => {
  test('returns ok:false when GROQ_API_KEY is missing', async () => {
    global.fetch = jest.fn();
    const result = await groqAdapter({ prompt: 'hi', model: DEFAULT_GROQ_MODEL });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('GROQ_API_KEY');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('reads GROQ_API_KEY via getSecret first, env second', async () => {
    secretValues.set('GROQ_API_KEY', 'gsk-from-secret');
    global.fetch = jest.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({
        choices: [{ message: { content: 'PONG' } }],
        usage: { prompt_tokens: 42, completion_tokens: 2 },
      }),
      text: async () => '',
    }));
    const result = await groqAdapter({ prompt: 'ping', model: 'llama-3.3-70b-versatile' });
    expect(result.ok).toBe(true);
    expect(result.text).toBe('PONG');
    expect(result.inputTokens).toBe(42);
    expect(result.outputTokens).toBe(2);

    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe(`${GROQ_DEFAULT_BASE_URL}/chat/completions`);
    expect(opts.headers.Authorization).toBe('Bearer gsk-from-secret');
    expect(JSON.parse(opts.body).model).toBe('llama-3.3-70b-versatile');
  });

  test('falls back to env GROQ_API_KEY when getSecret returns nothing', async () => {
    process.env.GROQ_API_KEY = 'gsk-from-env';
    global.fetch = jest.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
      text: async () => '',
    }));
    const result = await groqAdapter({ prompt: 'x', model: DEFAULT_GROQ_MODEL });
    expect(result.ok).toBe(true);
    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.headers.Authorization).toBe('Bearer gsk-from-env');
  });

  test('uses the GROQ key even when OPENAI_API_KEY is present in the secret cache (regression)', async () => {
    // Bug: groq delegated to openaiAdapter via env-injection, but the adapter
    // read getSecret('OPENAI_API_KEY') first → a cached OpenAI key shadowed
    // the Groq key and Groq returned HTTP 401. The override path fixes this.
    secretValues.set('OPENAI_API_KEY', 'sk-openai-should-not-be-used');
    secretValues.set('GROQ_API_KEY', 'gsk-the-right-one');
    global.fetch = jest.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
      text: async () => '',
    }));
    const result = await groqAdapter({ prompt: 'x', model: DEFAULT_GROQ_MODEL });
    expect(result.ok).toBe(true);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe(`${GROQ_DEFAULT_BASE_URL}/chat/completions`);
    expect(opts.headers.Authorization).toBe('Bearer gsk-the-right-one');
  });

  test('honors GROQ_API_BASE override', async () => {
    secretValues.set('GROQ_API_KEY', 'gsk');
    global.fetch = jest.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
      text: async () => '',
    }));
    await groqAdapter({ prompt: 'x', model: DEFAULT_GROQ_MODEL, env: { GROQ_API_BASE: 'https://proxy.example/v1' } });
    const [url] = global.fetch.mock.calls[0];
    expect(url).toBe('https://proxy.example/v1/chat/completions');
  });

  test('surfaces HTTP errors', async () => {
    secretValues.set('GROQ_API_KEY', 'gsk');
    global.fetch = jest.fn(async () => ({
      ok: false, status: 401,
      json: async () => ({}),
      text: async () => 'invalid api key',
    }));
    const result = await groqAdapter({ prompt: 'x', model: DEFAULT_GROQ_MODEL });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('HTTP 401');
  });
});

describe('groq model catalog', () => {
  test('default model is in the supported list', () => {
    expect(SUPPORTED_GROQ_MODELS).toContain(DEFAULT_GROQ_MODEL);
  });
});
