import { describe, it, expect } from 'vitest';
import { extractAiText, describeResponseShape } from '../src/ai-response.js';

describe('extractAiText — reads every Workers AI / OpenAI response envelope', () => {
  it('standard Workers AI text generation: { response } — and it trims surrounding whitespace', () => {
    const out = extractAiText({ response: '\n  hello world  \n' });
    // The function does real work: the returned text is NOT the raw input — the
    // surrounding whitespace is stripped, and the envelope is labelled.
    expect(out.text).toBe('hello world');
    expect(out.text).not.toBe('\n  hello world  \n');
    expect(out.shape).toBe('response');
  });

  it('OpenAI Responses API convenience aggregate: { output_text } is read only when `response` is absent', () => {
    // Assert the SELECTION behaviour, not an echo: output_text wins here because
    // there's no `response`, and the shape label reflects which field was used.
    const out = extractAiText({ output_text: 'from output_text', usage: { tokens: 3 } });
    expect(out.text).toBe('from output_text');
    expect(out.shape).toBe('output_text');
  });

  it('OpenAI Responses API structured output[] (the gpt-oss-120b shape that blanked the fleet)', () => {
    const res = {
      // gpt-oss emits a reasoning item then a message item; only the message text counts.
      output: [
        { type: 'reasoning', summary: [] },
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'the real review' }],
        },
      ],
    };
    expect(extractAiText(res)).toEqual({ text: 'the real review', shape: 'responses-api' });
  });

  it('OpenAI Chat Completions: choices[].message.content', () => {
    const res = { choices: [{ message: { role: 'assistant', content: 'chat content' } }] };
    expect(extractAiText(res)).toEqual({ text: 'chat content', shape: 'chat-completions' });
  });

  it('prefers response over the newer envelopes when both are present', () => {
    const res = { response: 'primary', output_text: 'secondary' };
    expect(extractAiText(res).shape).toBe('response');
  });

  it('empty string response falls through to the next envelope', () => {
    const res = { response: '   ', output_text: 'fallback' };
    expect(extractAiText(res)).toEqual({ text: 'fallback', shape: 'output_text' });
  });

  it('classic Completions / vLLM: choices[].text with no message object (#7743 tail: qwen3-30b)', () => {
    // The 2026-08-19 spider blackout: qwen3-30b answered in a vLLM completion
    // envelope (prompt_token_ids, kv_transfer_params, choices[].text) and this
    // parser read EMPTY — the ship was blanked by our parser, not the model.
    const res = {
      choices: [{ text: 'findings here\n\nFLEET-VERDICT: PASS', index: 0, finish_reason: 'stop' }],
      prompt_token_ids: [1, 2],
      kv_transfer_params: null,
      response: null,
      usage: {},
    };
    expect(extractAiText(res)).toEqual({
      text: 'findings here\n\nFLEET-VERDICT: PASS',
      shape: 'text-completions',
    });
  });

  it('reasoning models: empty content falls back to message.reasoning_content, labeled honestly', () => {
    const res = {
      choices: [{ message: { content: '', reasoning_content: 'thinking… answer: PASS' } }],
    };
    expect(extractAiText(res)).toEqual({
      text: 'thinking… answer: PASS',
      shape: 'chat-completions-reasoning',
    });
  });

  it('real content always beats reasoning and completions-text — precedence is content > text > reasoning', () => {
    const res = {
      choices: [{ text: 'plain', message: { content: 'the answer', reasoning_content: 'thoughts' } }],
    };
    expect(extractAiText(res)).toEqual({ text: 'the answer', shape: 'chat-completions' });
    const noContent = {
      choices: [{ text: 'plain', message: { content: '', reasoning_content: 'thoughts' } }],
    };
    expect(extractAiText(noContent)).toEqual({ text: 'plain', shape: 'text-completions' });
  });

  it('null / non-object → empty', () => {
    expect(extractAiText(null)).toEqual({ text: '', shape: 'empty' });
    expect(extractAiText(undefined)).toEqual({ text: '', shape: 'empty' });
    expect(extractAiText('a string')).toEqual({ text: '', shape: 'empty' });
  });

  it('an object with no readable text → unknown (so it gets logged, not silently dropped)', () => {
    expect(extractAiText({ usage: { tokens: 5 } })).toEqual({ text: '', shape: 'unknown' });
    // An empty Responses API output[] is unknown, not a false positive.
    expect(extractAiText({ output: [] })).toEqual({ text: '', shape: 'unknown' });
  });
});

describe('describeResponseShape — compact diagnostics for an empty/odd response', () => {
  it('lists the top-level keys', () => {
    expect(describeResponseShape({ usage: {}, output: [] })).toContain('keys=[usage,output]');
  });

  it('surfaces output/choices arity and error text as high-signal hints', () => {
    expect(describeResponseShape({ output: [1, 2, 3] })).toContain('output.len=3');
    expect(describeResponseShape({ choices: [] })).toContain('choices.len=0');
    expect(describeResponseShape({ errors: [{ message: 'boom' }] })).toContain('errors=');
  });

  it('handles null / primitives without throwing', () => {
    expect(describeResponseShape(null)).toBe('null');
    expect(describeResponseShape(undefined)).toBe('undefined');
    expect(describeResponseShape(42)).toBe('number');
  });

  it('never throws on error values JSON.stringify would choke on (BigInt, circular)', () => {
    // The diagnostic runs in the already-degraded empty-response path; a throw
    // here would crash the very diagnostic we need. safeErrorHint avoids stringify.
    expect(() => describeResponseShape({ error: 10n })).not.toThrow();
    expect(describeResponseShape({ error: 10n })).toContain('error=10');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => describeResponseShape({ errors: circular })).not.toThrow();
  });
});
