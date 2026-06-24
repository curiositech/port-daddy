/**
 * Unit tests for the Cloudflare Workers AI `result` → structured transcript
 * parser (lib/spawner/cloudflare-transcript.ts).
 *
 * LIVE-VERIFIED: the `LIVE_GLM_*` fixtures below are VERBATIM captures from a
 * real `env.AI.run('@cf/zai-org/glm-4.7-flash', ...)` call (the spawner's
 * default Cloudflare model), captured 2026-06-23 once the operator's token
 * gained Workers AI Run access. The default model returns the OpenAI-compat
 * shape (`choices[].message`) carrying BOTH `reasoning` and `reasoning_content`,
 * `content`, and OpenAI-style `tool_calls`
 * ({id, type:'function', function:{name, arguments:<json-string>}}).
 *
 * The other fixtures remain REPRESENTATIVE of the documented schema variants
 * the parser must also handle (legacy flat `response`/`reasoning`/`tool_calls`
 * with `{name, arguments}`), which other @cf/* models emit.
 */

import { describe, it, expect } from '@jest/globals';

const { parseCloudflareTranscript } = await import('../../lib/spawner/cloudflare-transcript.js');

// Legacy text-only response (most @cf/* instruct models).
const TEXT_ONLY = {
  response: 'Hello! How can I help you today?',
  usage: { prompt_tokens: 12, completion_tokens: 9, total_tokens: 21 },
};

// Reasoning model (deepseek-r1-distill / glm-4.7-flash): separate `reasoning`.
const REASONING = {
  reasoning: 'Let me factor 91. 91 = 7 * 13, so it is not prime.',
  response: 'No, 91 is not prime (91 = 7 x 13).',
  usage: { prompt_tokens: 20, completion_tokens: 40, total_tokens: 60 },
};

// Legacy tool-calling response: tool_calls + (often empty) response.
const TOOL_CALL = {
  response: '',
  tool_calls: [
    { name: 'get_weather', arguments: { city: 'Paris' } },
  ],
  usage: { prompt_tokens: 30, completion_tokens: 15, total_tokens: 45 },
};

// Reasoning + tool call + final text together.
const REASONING_TOOL_TEXT = {
  reasoning: 'The user wants weather; I should call get_weather.',
  tool_calls: [{ name: 'get_weather', arguments: { city: 'Paris' } }],
  response: 'Let me check the weather in Paris.',
};

// OpenAI-compat shape (choices[].message) with reasoning_content + tool_calls.
const OPENAI_COMPAT = {
  choices: [{
    index: 0,
    message: {
      role: 'assistant',
      reasoning_content: 'I will call the weather function.',
      content: 'Checking the weather now.',
      tool_calls: [{
        id: 'call_1',
        type: 'function',
        function: { name: 'get_weather', arguments: '{"city":"Paris"}' },
      }],
    },
    finish_reason: 'tool_calls',
  }],
  usage: { prompt_tokens: 22, completion_tokens: 18, total_tokens: 40 },
};

// VERBATIM live capture: glm-4.7-flash with a tools request (reasoning + a
// tool_call + a content line). Trimmed reasoning text only.
const LIVE_GLM_TOOLS = {
  id: 'chatcmpl-aa9144b5a85f7ad2',
  object: 'chat.completion',
  choices: [{
    index: 0,
    message: {
      role: 'assistant',
      content: "I'll get the current weather in Paris for you.",
      reasoning: "The user is asking for the current weather in Paris. They've explicitly told me",
      reasoning_content: "The user is asking for the current weather in Paris. They've explicitly told me",
      tool_calls: [{
        id: 'chatcmpl-tool-beda2925b7e685e6',
        type: 'function',
        function: { name: 'get_weather', arguments: '{"city": "Paris"}' },
      }],
    },
    finish_reason: 'tool_calls',
  }],
  usage: { prompt_tokens: 184, completion_tokens: 65, total_tokens: 249 },
};

// VERBATIM live capture: glm-4.7-flash reasoning scenario (reasoning + content,
// empty tool_calls). Trimmed long text.
const LIVE_GLM_REASONING = {
  id: 'chatcmpl-99c059ae77f4b3ea',
  object: 'chat.completion',
  choices: [{
    index: 0,
    message: {
      role: 'assistant',
      content: 'Since 17 is greater than 1 and has no divisors other than 1 and itself, it is prime.',
      reasoning: 'Define prime; test divisibility by 2 and 3 up to sqrt(17); none divide; therefore prime.',
      reasoning_content: 'Define prime; test divisibility by 2 and 3 up to sqrt(17); none divide; therefore prime.',
      tool_calls: [],
    },
    finish_reason: 'stop',
  }],
  usage: { prompt_tokens: 26, completion_tokens: 1249, total_tokens: 1275 },
};

describe('parseCloudflareTranscript', () => {
  it('LIVE glm-4.7-flash tools capture → thinking, tool, assistant (in order)', () => {
    const turns = parseCloudflareTranscript(LIVE_GLM_TOOLS);
    expect(turns.map((t) => t.role)).toEqual(['thinking', 'tool', 'assistant']);
    expect(turns[0].content).toMatch(/weather in Paris/);
    expect(turns[1].toolCalls[0]).toEqual({ name: 'get_weather', args: { city: 'Paris' } });
    expect(turns[2].content).toBe("I'll get the current weather in Paris for you.");
  });

  it('LIVE glm-4.7-flash reasoning capture → thinking then assistant (no tool turn)', () => {
    const turns = parseCloudflareTranscript(LIVE_GLM_REASONING);
    expect(turns.map((t) => t.role)).toEqual(['thinking', 'assistant']);
    expect(turns[1].content).toMatch(/17 .* prime/);
  });

  it('returns [] for null / undefined / non-object / empty', () => {
    expect(parseCloudflareTranscript(null)).toEqual([]);
    expect(parseCloudflareTranscript(undefined)).toEqual([]);
    expect(parseCloudflareTranscript(42)).toEqual([]);
    expect(parseCloudflareTranscript([])).toEqual([]);
    expect(parseCloudflareTranscript({})).toEqual([]);
    expect(parseCloudflareTranscript('')).toEqual([]);
    expect(parseCloudflareTranscript('   ')).toEqual([]);
  });

  it('maps a plain string result to a single assistant turn', () => {
    expect(parseCloudflareTranscript('just text')).toEqual([
      { role: 'assistant', content: 'just text' },
    ]);
  });

  it('maps text-only response to one assistant turn (usage ignored)', () => {
    expect(parseCloudflareTranscript(TEXT_ONLY)).toEqual([
      { role: 'assistant', content: 'Hello! How can I help you today?' },
    ]);
  });

  it('maps reasoning → thinking turn before assistant turn', () => {
    const turns = parseCloudflareTranscript(REASONING);
    expect(turns).toEqual([
      { role: 'thinking', content: 'Let me factor 91. 91 = 7 * 13, so it is not prime.' },
      { role: 'assistant', content: 'No, 91 is not prime (91 = 7 x 13).' },
    ]);
  });

  it('maps a legacy tool_call to a tool turn (no empty assistant turn)', () => {
    const turns = parseCloudflareTranscript(TOOL_CALL);
    expect(turns).toEqual([
      {
        role: 'tool',
        content: '→ get_weather',
        toolCalls: [{ name: 'get_weather', args: { city: 'Paris' } }],
      },
    ]);
  });

  it('orders reasoning → tool → assistant', () => {
    const turns = parseCloudflareTranscript(REASONING_TOOL_TEXT);
    expect(turns.map((t) => t.role)).toEqual(['thinking', 'tool', 'assistant']);
    expect(turns[1].toolCalls[0]).toEqual({ name: 'get_weather', args: { city: 'Paris' } });
    expect(turns[2].content).toBe('Let me check the weather in Paris.');
  });

  it('parses OpenAI-compat choices[].message with reasoning_content + tool_calls', () => {
    const turns = parseCloudflareTranscript(OPENAI_COMPAT);
    expect(turns.map((t) => t.role)).toEqual(['thinking', 'tool', 'assistant']);
    expect(turns[0].content).toBe('I will call the weather function.');
    // OpenAI-style args is a JSON string → parsed to object.
    expect(turns[1].toolCalls[0]).toEqual({ name: 'get_weather', args: { city: 'Paris' } });
    expect(turns[2].content).toBe('Checking the weather now.');
  });

  it('keeps raw arguments string when OpenAI args is not valid JSON', () => {
    const turns = parseCloudflareTranscript({
      choices: [{ message: { tool_calls: [{ function: { name: 'f', arguments: 'not-json' } }] } }],
    });
    expect(turns).toEqual([
      { role: 'tool', content: '→ f', toolCalls: [{ name: 'f', args: 'not-json' }] },
    ]);
  });

  it('handles multiple tool calls as separate tool turns', () => {
    const turns = parseCloudflareTranscript({
      response: 'done',
      tool_calls: [
        { name: 'a', arguments: { x: 1 } },
        { name: 'b', arguments: { y: 2 } },
      ],
    });
    expect(turns.map((t) => [t.role, t.toolCalls?.[0]?.name].filter(Boolean).join(':')))
      .toEqual(['tool:a', 'tool:b', 'assistant']);
  });

  it('skips tool-call entries with no usable name', () => {
    const turns = parseCloudflareTranscript({
      response: 'ok',
      tool_calls: [{ arguments: { x: 1 } }, 'garbage', null, { name: 'good', arguments: {} }],
    });
    expect(turns.map((t) => t.role)).toEqual(['tool', 'assistant']);
    expect(turns[0].toolCalls[0].name).toBe('good');
  });

  it('captures an unknown non-empty shape as a forensic tool note (never drops)', () => {
    const weird = { mystery_field: { nested: true }, another: [1, 2, 3] };
    const turns = parseCloudflareTranscript(weird);
    expect(turns).toHaveLength(1);
    expect(turns[0].role).toBe('tool');
    expect(turns[0].content).toBe('[cloudflare:unknown-result]');
    expect(turns[0].toolCalls[0]).toEqual({ name: 'cloudflare_result', args: weird });
  });

  it('does not emit a turn for a usage-only payload', () => {
    expect(parseCloudflareTranscript({ usage: { prompt_tokens: 5, total_tokens: 5 } })).toEqual([]);
  });

  it('falls back to `text` / `output_text` aliases when `response` is absent', () => {
    expect(parseCloudflareTranscript({ text: 'via text alias' })).toEqual([
      { role: 'assistant', content: 'via text alias' },
    ]);
    expect(parseCloudflareTranscript({ output_text: 'via output_text' })).toEqual([
      { role: 'assistant', content: 'via output_text' },
    ]);
  });

  it('never throws on adversarial inputs', () => {
    const inputs = [
      { tool_calls: 'not-an-array' },
      { response: 123 },
      { reasoning: { nested: 'object' }, response: 'ok' },
      { choices: [{}] },
      { choices: ['not-an-object'] },
      { choices: [{ message: null }] },
    ];
    for (const input of inputs) {
      expect(() => parseCloudflareTranscript(input)).not.toThrow();
    }
  });
});
