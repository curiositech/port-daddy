/**
 * OpenAI spawner transcript regression.
 *
 * This stays separate from daemon-backend-transcripts.test.js because that
 * smoke harness is shared with other backend-compliance lanes. The test uses
 * the real spawner + transcript store, but a fake global fetch for both
 * OpenAI Responses API and Port Daddy coordination heartbeats.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, jest } from '@jest/globals';

const { createSpawner } = await import('../../lib/spawner.js');
const { createTranscripts } = await import('../../lib/transcripts.js');
const { createTestDb } = await import('../setup-unit.js');

const TEST_TELEMETRY_BYPASS = {
  humanConfirmed: true,
  confirmedBy: 'jest',
  reason: 'OpenAI GPT-5 transcript readback regression with fake Responses API',
};

describe('spawner OpenAI transcript readback', () => {
  let db;
  let transcripts;
  let originalFetch;
  let originalApiKey;
  let originalSpawnIsolationOff;

  beforeAll(() => {
    originalSpawnIsolationOff = process.env.PD_SPAWN_ISOLATION_OFF;
    process.env.PD_SPAWN_ISOLATION_OFF = '1';
  });

  afterAll(() => {
    if (originalSpawnIsolationOff === undefined) delete process.env.PD_SPAWN_ISOLATION_OFF;
    else process.env.PD_SPAWN_ISOLATION_OFF = originalSpawnIsolationOff;
  });

  beforeEach(() => {
    db = createTestDb();
    transcripts = createTranscripts(db);
    originalFetch = global.fetch;
    originalApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-test-openai-transcript';
    global.fetch = jest.fn(async (url, init) => {
      const href = String(url);
      if (href === 'https://api.openai.com/v1/responses') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 'resp_transcript_test',
            output: [
              { type: 'reasoning', summary: [{ text: 'not transcript answer text' }] },
              {
                type: 'message',
                content: [{ type: 'output_text', text: 'pd-openai-gpt5-transcript' }],
              },
            ],
            usage: { input_tokens: 12, output_tokens: 6 },
          }),
          text: async () => '',
        };
      }
      const data = href.includes('/sugar/begin')
        ? { success: true, sessionId: 'session-openai-transcript-test' }
        : { success: true };
      return {
        ok: true,
        status: 200,
        json: async () => data,
        text: async () => JSON.stringify(data),
      };
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
    if (db) db.close();
  });

  it('records user, assistant, and output rows for a GPT-5 Responses API spawn', async () => {
    const spawner = createSpawner({
      transcripts,
      enforceTelemetryPolicy: false,
      enforceTranscriptPolicy: true,
      telemetryBypassApproval: TEST_TELEMETRY_BYPASS,
    });

    const result = await spawner.spawn({
      backend: 'openai',
      model: 'gpt-5-nano',
      maxTokens: 64,
      task: 'Reply with exactly: pd-openai-gpt5-transcript',
      identity: 'port-daddy:test:openai-gpt5-transcript',
    });

    expect(result.status).toBe('completed');
    expect(result.output).toBe('pd-openai-gpt5-transcript');

    const openaiCall = global.fetch.mock.calls.find(([url]) => String(url) === 'https://api.openai.com/v1/responses');
    expect(openaiCall).toBeTruthy();
    const body = JSON.parse(openaiCall[1].body);
    expect(body.max_output_tokens).toBe(64);
    expect(body.max_tokens).toBeUndefined();
    expect(body.max_completion_tokens).toBeUndefined();

    const rows = transcripts.listTranscripts({ ship: 'spawn:openai' });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('completed');
    expect(rows[0].model).toBe('gpt-5-nano');

    const tx = transcripts.getTranscript(rows[0].id);
    expect(tx.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(tx.messages[0].content).toBe('Reply with exactly: pd-openai-gpt5-transcript');
    expect(tx.messages[1].content).toBe('pd-openai-gpt5-transcript');
    expect(tx.outputs).toHaveLength(1);
    expect(tx.outputs[0].type).toBe('message');
    expect(tx.outputs[0].summary).toContain('openai returned');
  });
});
