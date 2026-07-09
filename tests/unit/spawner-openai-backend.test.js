/**
 * OpenAI backend unit tests.
 *
 * Mocks global `fetch` and `lib/secret-env.getSecret` to exercise:
 *   - Missing API key path (no fetch call, returns ok:false)
 *   - Happy path (200, choices[0].message.content extracted)
 *   - HTTP error path (4xx → ok:false with status code)
 *   - Native reasoning models (`gpt-5`, `o1`) use the Responses API
 *     and extract text from the newer output shape
 *   - `OPENAI_BASE_URL` override
 *
 * No network calls. Smoke tests against real OpenAI live in
 * `tests/integration/spawner-openai-smoke.test.js` and are gated behind
 * `OPENAI_API_KEY` presence.
 */

import { jest } from '@jest/globals';

const secretValues = new Map();
const mockGetSecret = jest.fn((key) => secretValues.get(key));

jest.unstable_mockModule('../../lib/secret-env.js', () => ({
  getSecret: mockGetSecret,
}));

const { openaiAdapter, SUPPORTED_OPENAI_MODELS, DEFAULT_OPENAI_MODEL } = await import('../../lib/spawner/backends/openai.js');

const origFetch = global.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  secretValues.clear();
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
});

afterAll(() => {
  global.fetch = origFetch;
});

describe('openaiAdapter — auth', () => {
  test('returns ok:false when OPENAI_API_KEY is missing', async () => {
    global.fetch = jest.fn();
    const result = await openaiAdapter({ prompt: 'hi', model: 'gpt-5-mini' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('OPENAI_API_KEY');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('reads OPENAI_API_KEY via getSecret first, env second', async () => {
    secretValues.set('OPENAI_API_KEY', 'sk-from-secret');
    global.fetch = jest.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: 'hi' } }] }),
      text: async () => '',
    }));
    const result = await openaiAdapter({ prompt: 'hi', model: 'gpt-5-mini' });
    expect(result.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, init] = global.fetch.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer sk-from-secret');
  });
});

describe('openaiAdapter — happy path', () => {
  beforeEach(() => {
    secretValues.set('OPENAI_API_KEY', 'sk-test');
  });

  test('extracts response text from choices[0].message.content', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({
        choices: [{ message: { content: 'Hello, world.' } }],
        usage: { prompt_tokens: 5, completion_tokens: 3 },
      }),
      text: async () => '',
    }));
    const result = await openaiAdapter({ prompt: 'say hi', model: 'gpt-5-mini' });
    expect(result.ok).toBe(true);
    expect(result.text).toBe('Hello, world.');
    expect(result.inputTokens).toBe(5);
    expect(result.outputTokens).toBe(3);
  });

  test('extracts response text from Responses API output_text without choices', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({
        id: 'resp_test',
        output_text: 'Hello from responses.',
        usage: { input_tokens: 7, output_tokens: 4 },
      }),
      text: async () => '',
    }));
    const result = await openaiAdapter({ prompt: 'say hi', model: 'gpt-5-nano' });
    expect(result.ok).toBe(true);
    expect(result.text).toBe('Hello from responses.');
    expect(result.inputTokens).toBe(7);
    expect(result.outputTokens).toBe(4);
  });

  test('extracts nested Responses API message text after non-message output items', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({
        id: 'resp_nested',
        output: [
          null,
          { type: 'reasoning', summary: [{ text: 'private reasoning summary should not be transcript text' }] },
          { type: 'message' },
          {
            type: 'message',
            content: [
              123,
              false,
              { type: 'output_text', text: null },
              { type: 'output_text', text: 'nested ' },
              { type: 'output_text', text: 'answer' },
            ],
          },
          { type: 'message', content: { text: 'not an array, ignore me' } },
        ],
        usage: {
          input_tokens: 100,
          output_tokens: 12,
          input_tokens_details: { cached_tokens: 75 },
        },
      }),
      text: async () => '',
    }));
    const result = await openaiAdapter({ prompt: 'say hi', model: 'gpt-5-mini' });
    expect(result.ok).toBe(true);
    expect(result.text).toBe('nested answer');
    expect(result.cachedInputTokens).toBe(75);
  });

  test('extracts valid choice content while ignoring malformed content parts', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: [
                99,
                true,
                { text: 123 },
                { output_text: null },
                { output_text: 'choice ' },
                { text: 'text' },
              ],
            },
          },
          { message: {} },
          { text: 42 },
        ],
      }),
      text: async () => '',
    }));
    const result = await openaiAdapter({ prompt: 'say hi', model: 'gpt-5-mini' });
    expect(result.ok).toBe(true);
    expect(result.text).toBe('choice text');
  });

  test('captures cached_tokens when present', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({
        choices: [{ message: { content: 'cached' } }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          prompt_tokens_details: { cached_tokens: 80 },
        },
      }),
      text: async () => '',
    }));
    const result = await openaiAdapter({ prompt: 'hi', model: 'gpt-5-mini' });
    expect(result.cachedInputTokens).toBe(80);
  });
});

describe('openaiAdapter — request shape', () => {
  beforeEach(() => {
    secretValues.set('OPENAI_API_KEY', 'sk-test');
    global.fetch = jest.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
      text: async () => '',
    }));
  });

  test('non-reasoning models get max_tokens', async () => {
    await openaiAdapter({ prompt: 'hi', model: 'gpt-4o-mini', maxTokens: 100 });
    const [, init] = global.fetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.max_tokens).toBe(100);
    expect(body.max_completion_tokens).toBeUndefined();
  });

  test('native reasoning models (gpt-5) use Responses API max_output_tokens', async () => {
    await openaiAdapter({ prompt: 'hi', model: 'gpt-5', maxTokens: 200 });
    const [url, init] = global.fetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(body.input).toEqual([{ role: 'user', content: 'hi' }]);
    expect(body.reasoning).toEqual({ effort: 'minimal' });
    expect(body.store).toBe(false);
    expect(body.max_output_tokens).toBe(200);
    expect(body.max_completion_tokens).toBeUndefined();
    expect(body.max_tokens).toBeUndefined();
  });

  test('native reasoning models (o-series) use Responses API max_output_tokens', async () => {
    await openaiAdapter({ prompt: 'hi', model: 'o3', maxTokens: 500 });
    const [url, init] = global.fetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(body.max_output_tokens).toBe(500);
    expect(body.max_completion_tokens).toBeUndefined();
    expect(body.max_tokens).toBeUndefined();
  });

  test('OpenAI-compatible override keeps reasoning-looking model on chat completions', async () => {
    await openaiAdapter(
      { prompt: 'hi', model: 'gpt-5', maxTokens: 200 },
      { apiKey: 'sk-compatible', baseUrl: 'https://compatible.example/v1' },
    );
    const [url, init] = global.fetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(url).toBe('https://compatible.example/v1/chat/completions');
    expect(body.max_completion_tokens).toBe(200);
    expect(body.max_output_tokens).toBeUndefined();
    expect(body.max_tokens).toBeUndefined();
  });

  test('uses OPENAI_BASE_URL when set', async () => {
    process.env.OPENAI_BASE_URL = 'https://my-proxy.test/v1';
    await openaiAdapter({ prompt: 'hi', model: 'gpt-4o-mini' });
    const [url] = global.fetch.mock.calls[0];
    expect(url).toBe('https://my-proxy.test/v1/chat/completions');
  });

  test('strips trailing slash from base URL', async () => {
    process.env.OPENAI_BASE_URL = 'https://my-proxy.test/v1/';
    await openaiAdapter({ prompt: 'hi', model: 'gpt-4o-mini' });
    const [url] = global.fetch.mock.calls[0];
    expect(url).toBe('https://my-proxy.test/v1/chat/completions');
  });

  test('uses OPENAI_BASE_URL as an OpenAI-compatible chat route for GPT-5 models', async () => {
    process.env.OPENAI_BASE_URL = 'https://my-proxy.test/v1/';
    await openaiAdapter({ prompt: 'hi', model: 'gpt-5-nano', maxTokens: 64 });
    const [url, init] = global.fetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(url).toBe('https://my-proxy.test/v1/chat/completions');
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(body.max_completion_tokens).toBe(64);
    expect(body.max_output_tokens).toBeUndefined();
    expect(body.max_tokens).toBeUndefined();
  });

  test('forwards OpenAI-Organization header when OPENAI_ORG_ID is set', async () => {
    process.env.OPENAI_ORG_ID = 'org-abc';
    await openaiAdapter({ prompt: 'hi', model: 'gpt-5-mini' });
    const [, init] = global.fetch.mock.calls[0];
    expect(init.headers['OpenAI-Organization']).toBe('org-abc');
    delete process.env.OPENAI_ORG_ID;
  });
});

describe('openaiAdapter — failure paths', () => {
  beforeEach(() => {
    secretValues.set('OPENAI_API_KEY', 'sk-test');
  });

  test('HTTP 401 returns ok:false with status code', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false, status: 401,
      text: async () => '{"error":"invalid_key"}',
      json: async () => ({ error: 'invalid_key' }),
    }));
    const result = await openaiAdapter({ prompt: 'hi', model: 'gpt-5-mini' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('OpenAI HTTP 401');
    expect(result.error).toContain('invalid_key');
  });

  test('network error returns ok:false with the message', async () => {
    global.fetch = jest.fn(async () => { throw new Error('connection refused'); });
    const result = await openaiAdapter({ prompt: 'hi', model: 'gpt-5-mini' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('connection refused');
  });

  test('empty text response returns ok:false', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: '' } }] }),
      text: async () => '',
    }));
    const result = await openaiAdapter({ prompt: 'hi', model: 'gpt-5-mini' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('no text response');
  });

  test('malformed Responses output and choices return the explicit no-text error', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({
        id: 'resp_malformed',
        output: [
          null,
          17,
          { type: 'message' },
          { type: 'message', content: { text: 'not a supported content object' } },
          {
            type: 'message',
            content: [
              undefined,
              false,
              { text: 123 },
              { output_text: null },
              { unexpected: 'object' },
            ],
          },
          { type: 'tool_call', content: 'not transcript text' },
        ],
        choices: [
          { message: {} },
          { message: { content: [{ text: 456 }, { output_text: null }, { unexpected: 'object' }] } },
          { text: 99 },
        ],
      }),
      text: async () => '',
    }));
    const result = await openaiAdapter({ prompt: 'hi', model: 'gpt-5-nano' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('OpenAI returned no text response');
  });

  test('malformed incomplete reason falls back to the generic no-text error', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({
        status: 'incomplete',
        incomplete_details: { reason: 404 },
        output: [],
      }),
      text: async () => '',
    }));
    const result = await openaiAdapter({ prompt: 'hi', model: 'gpt-5-nano' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('OpenAI returned no text response');
  });
});

describe('openaiAdapter — model list', () => {
  test('exposes the documented model list', () => {
    expect(SUPPORTED_OPENAI_MODELS).toContain('gpt-5');
    expect(SUPPORTED_OPENAI_MODELS).toContain('gpt-5-mini');
    expect(SUPPORTED_OPENAI_MODELS).toContain('gpt-5-nano');
    expect(SUPPORTED_OPENAI_MODELS).toContain('gpt-4.1');
    expect(SUPPORTED_OPENAI_MODELS).toContain('o4-mini');
    expect(SUPPORTED_OPENAI_MODELS).toContain('o3');
    expect(SUPPORTED_OPENAI_MODELS).toContain('o1');
  });

  test('default model is in the supported list', () => {
    expect(SUPPORTED_OPENAI_MODELS).toContain(DEFAULT_OPENAI_MODEL);
  });
});
