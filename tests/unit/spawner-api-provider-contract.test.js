/**
 * Direct API provider transcript contract.
 *
 * These tests use the real spawner and transcript store with fake HTTP
 * provider responses. They intentionally avoid cli-tube internals.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, jest } from '@jest/globals';

const { createSpawner } = await import('../../lib/spawner.js');
const { createTranscripts } = await import('../../lib/transcripts.js');
const { createTestDb } = await import('../setup-unit.js');

const TEST_TELEMETRY_BYPASS = {
  humanConfirmed: true,
  confirmedBy: 'jest',
  reason: 'Direct API provider transcript contract with fake HTTP providers',
};

const ENV_KEYS = [
  'PD_SPAWN_ISOLATION_OFF',
  'PD_USE_CLI_BACKEND',
  'OPENAI_API_KEY',
  'OPENAI_KEY',
  'OPENAI_BASE_URL',
  'GROQ_API_KEY',
  'GROQ_API_BASE',
  'GROQ_BASE_URL',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_API_BASE',
  'GOOGLE_GEMINI_API_BASE',
];

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * A `text/event-stream` response carrying one `data:` frame per object.
 *
 * Needed because a spawn with an open transcript now asks its API backend to
 * stream, so the provider a spawner test mocks has to answer in the shape the
 * spawner actually requests.
 */
function sseResponse(frames, status = 200) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(`data: ${JSON.stringify(f)}\n\n`));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } });
}

function installFetch(routes) {
  global.fetch = jest.fn(async (url, init = {}) => {
    const href = String(url);
    const route = routes.find((candidate) => candidate.match(href));
    if (route) return route.reply(href, init);
    const { hostname } = new URL(href);
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return jsonResponse({ success: true });
    }
    throw new Error(`Unexpected provider fetch: ${href}`);
  });
}

function makeSpawner(transcripts) {
  return createSpawner({
    transcripts,
    enforceTelemetryPolicy: false,
    enforceTranscriptPolicy: true,
    telemetryBypassApproval: TEST_TELEMETRY_BYPASS,
  });
}

function getOnlyTranscript(transcripts, backend) {
  const rows = transcripts.listTranscripts({ ship: `spawn:${backend}` });
  expect(rows).toHaveLength(1);
  return {
    row: rows[0],
    tx: transcripts.getTranscript(rows[0].id),
  };
}

function expectFailedTranscript(transcripts, backend, task, errorPattern) {
  const { row, tx } = getOnlyTranscript(transcripts, backend);
  expect(row.status).toBe('failed');
  expect(row.error).toEqual(expect.stringMatching(errorPattern));
  expect(tx.messages[0]).toEqual(expect.objectContaining({
    role: 'user',
    content: task,
  }));
  expect(tx.messages.at(-1)).toEqual(expect.objectContaining({
    role: 'assistant',
    content: expect.stringMatching(errorPattern),
  }));
  expect(tx.outputs).toEqual([
    { type: 'noop', summary: expect.stringMatching(errorPattern) },
  ]);
}

describe('direct API providers persist transcript contracts', () => {
  let db;
  let transcripts;
  let originalFetch;
  let originalEnv;

  beforeAll(() => {
    originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  });

  afterAll(() => {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  beforeEach(() => {
    db = createTestDb();
    transcripts = createTranscripts(db);
    originalFetch = global.fetch;
    for (const key of ENV_KEYS) delete process.env[key];
    process.env.PD_SPAWN_ISOLATION_OFF = '1';
    process.env.PD_USE_CLI_BACKEND = 'none';
    process.env.OPENAI_API_KEY = 'sk-test-openai-direct-contract';
    process.env.GROQ_API_KEY = 'gsk-test-groq-direct-contract';
    process.env.GEMINI_API_KEY = 'gemini-test-direct-contract';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (db) db.close();
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  describe.each([
    {
      name: 'OpenAI',
      backend: 'openai',
      model: 'gpt-4o-mini',
      url: 'https://api.openai.com/v1/chat/completions',
      answer: 'OpenAI direct transcript answer.',
    },
    {
      name: 'Groq',
      backend: 'groq',
      model: 'llama-3.3-70b-versatile',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      answer: 'Groq direct transcript answer.',
    },
  ])('$name direct provider', ({ backend, model, url, answer }) => {
    it('persists assistant output on success', async () => {
      let providerBody;
      installFetch([{
        match: (href) => href === url,
        reply: (_href, init) => {
          providerBody = JSON.parse(init.body);
          return jsonResponse({
            choices: [{ message: { role: 'assistant', content: answer } }],
            usage: { prompt_tokens: 11, completion_tokens: 7 },
          });
        },
      }]);

      const task = `${backend} should persist assistant output`;
      const result = await makeSpawner(transcripts).spawn({ backend, model, task });

      expect(result.status).toBe('completed');
      expect(result.output).toBe(answer);
      expect(providerBody.messages).toEqual([{ role: 'user', content: task }]);

      const { row, tx } = getOnlyTranscript(transcripts, backend);
      expect(row.status).toBe('completed');
      expect(row.error).toBeNull();
      expect(tx.messages.map((message) => [message.role, message.content])).toEqual([
        ['user', task],
        ['assistant', answer],
      ]);
      expect(tx.outputs).toEqual([
        { type: 'message', summary: `${backend} returned ${answer.length} chars` },
      ]);
    });

    it('persists failed transcript state when provider auth fails', async () => {
      installFetch([{
        match: (href) => href === url,
        reply: () => jsonResponse({ error: { message: `${backend} token rejected` } }, 401),
      }]);

      const task = `${backend} auth failure should be durable`;
      const result = await makeSpawner(transcripts).spawn({ backend, model, task });

      expect(result.status).toBe('failed');
      expect(result.output).toBeNull();
      expect(result.error).toEqual(expect.stringMatching(/HTTP 401.*token rejected/));
      expectFailedTranscript(transcripts, backend, task, /HTTP 401.*token rejected/);
    });
  });

  it('does not treat an empty successful OpenAI response as meaningful success', async () => {
    installFetch([{
      match: (href) => href === 'https://api.openai.com/v1/chat/completions',
      reply: () => jsonResponse({
        choices: [{ message: { role: 'assistant', content: '' } }],
        usage: { prompt_tokens: 9, completion_tokens: 0 },
      }),
    }]);

    const task = 'empty OpenAI text should fail honestly';
    const result = await makeSpawner(transcripts).spawn({
      backend: 'openai',
      model: 'gpt-4o-mini',
      task,
    });

    expect(result.status).toBe('failed');
    expect(result.output).toBeNull();
    expect(result.error).toMatch(/OpenAI returned no text response/);
    expectFailedTranscript(transcripts, 'openai', task, /OpenAI returned no text response/);
  });

  it('persists Gemini thinking separately without reporting it as final assistant output', async () => {
    // A spawn that records a transcript now STREAMS, so the endpoint is the
    // streaming one and the shape is SSE. The contract under test is unchanged
    // and that is the point: streaming must not cost the separate thinking turn,
    // which is exactly the capability a naive "just stream the text" would drop.
    installFetch([{
      match: (href) => href === 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse',
      reply: (_href, init) => {
        const body = JSON.parse(init.body);
        expect(body.generationConfig.thinkingConfig).toEqual({ includeThoughts: true });
        return sseResponse([
          { candidates: [{ content: { parts: [{ text: 'Internal reasoning trace. ', thought: true }] } }] },
          { candidates: [{ content: { parts: [{ text: 'Gemini final assistant output.' }] } }],
            usageMetadata: {
              promptTokenCount: 13,
              candidatesTokenCount: 5,
              thoughtsTokenCount: 8,
            } },
        ]);
      },
    }]);

    const task = 'Gemini should separate reasoning from final output';
    const result = await makeSpawner(transcripts).spawn({
      backend: 'gemini',
      model: 'gemini-2.5-flash',
      task,
    });

    expect(result.status).toBe('completed');
    expect(result.output).toBe('Gemini final assistant output.');

    const { row, tx } = getOnlyTranscript(transcripts, 'gemini');
    expect(row.status).toBe('completed');
    // The assistant text arrives live, turn by turn, as the model produces it;
    // the reasoning summary is appended after the stream closes, because a text
    // sink cannot carry a role. Both are present and still SEPARATE, which is
    // the contract — thinking must never be reported as final output.
    const byRole = tx.messages.map((message) => [message.role, message.content]);
    expect(byRole).toContainEqual(['user', task]);
    expect(byRole).toContainEqual(['assistant', 'Gemini final assistant output.']);
    expect(byRole).toContainEqual(['thinking', 'Internal reasoning trace. ']);
    expect(byRole.filter(([role]) => role === 'assistant')).toHaveLength(1);
  });
});
