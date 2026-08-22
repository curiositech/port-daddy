import { describe, it, expect } from 'vitest';
import { extractAiText, describeResponseShape, stripThinkTags } from '../src/ai-response.js';

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

describe('reasoning-model envelopes (DeepSeek V4, qwq, r1-distill)', () => {
  it('strips an inline <think> block from the standard response shape', () => {
    const res = { response: '<think>hmm, is FLEET-VERDICT: BLOCK right? no.</think>All clear.\n\nFLEET-VERDICT: PASS' };
    const out = extractAiText(res);
    expect(out.shape).toBe('response');
    expect(out.text).toBe('All clear.\n\nFLEET-VERDICT: PASS');
    // The deliberation must be GONE — an unstripped think block containing a
    // verdict string is parsed as the verdict.
    expect(out.text).not.toContain('BLOCK');
  });

  it('treats a response truncated mid-think as empty, not as an answer', () => {
    const res = { response: '<think>step 1: the diff touches the gate, step 2:' };
    const out = extractAiText(res);
    expect(out.text).toBe('');
  });

  it('reads DeepSeek V4 chat-completions with sibling reasoning_content', () => {
    const res = {
      choices: [{ message: {
        reasoning_content: 'considering whether to block...',
        content: 'No findings.\n\nFLEET-VERDICT: PASS',
      } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };
    const out = extractAiText(res);
    expect(out.shape).toBe('chat-completions');
    expect(out.text).toBe('No findings.\n\nFLEET-VERDICT: PASS');
    expect(out.text).not.toContain('considering');
  });

  it('non-string, non-array content is unreadable — falls through, never stringified', () => {
    // A model (or an error body) putting a number/boolean/object in `content`
    // must not surface "123" as review text; with nothing else readable the
    // whole response is 'unknown' so it gets logged for diagnosis.
    expect(extractAiText({ choices: [{ message: { content: 123 } }] }))
      .toEqual({ text: '', shape: 'unknown' });
    // …and it falls through to a readable fallback when one exists.
    expect(extractAiText({ choices: [{ message: { content: true, reasoning_content: 'the answer' } }] }))
      .toEqual({ text: 'the answer', shape: 'chat-completions-reasoning' });
  });

  it('reads typed-part array content', () => {
    const res = { choices: [{ message: { content: [
      { type: 'text', text: 'part one. ' },
      { type: 'text', text: 'part two.' },
    ] } }] };
    expect(extractAiText(res)).toEqual({ text: 'part one. part two.', shape: 'chat-completions' });
  });

  it('ignores typed parts whose text is not a string', () => {
    const res = { choices: [{ message: { content: [
      { type: 'text', text: 42 },
      { type: 'text', text: 'the answer' },
      { type: 'text', text: false },
    ] } }] };
    expect(extractAiText(res)).toEqual({ text: 'the answer', shape: 'chat-completions' });
  });

  it('reasoning that strips to NOTHING stays empty with a shape that names it', () => {
    // max_tokens hit mid-think: the reasoning is one unclosed <think> block —
    // deliberation that never finished. There is no answer to fall back to,
    // and half a chain-of-thought must not reach the findings parser.
    const res = { choices: [{ message: { reasoning_content: '<think>weighing whether FLEET-VERDICT: BLOCK applies', content: '' } }] };
    const out = extractAiText(res);
    expect(out).toEqual({ text: '', shape: 'reasoning-only' });
  });

  it('the reasoning fallback is think-stripped before it reaches the parser', () => {
    // qwen3 thinking mode (#7743): content empty, whole generation in
    // reasoning_content. The fallback hands over the answer portion only.
    const res = { choices: [{ message: {
      reasoning_content: '<think>maybe BLOCK? no.</think>ok\n\nFLEET-VERDICT: PASS',
      content: '',
    } }] };
    const out = extractAiText(res);
    expect(out).toEqual({ text: 'ok\n\nFLEET-VERDICT: PASS', shape: 'chat-completions-reasoning' });
    expect(out.text).not.toContain('BLOCK');
  });

  it('removes nested think blocks through the reasoning_content fallback', () => {
    const res = { choices: [{ message: {
      reasoning_content: '<think>outer<think>inner BLOCK</think>tail</think>FLEET-VERDICT: PASS',
      content: '',
    } }] };
    expect(extractAiText(res)).toEqual({
      text: 'FLEET-VERDICT: PASS',
      shape: 'chat-completions-reasoning',
    });
  });

  it('surfaces reasoning length in the diagnostic shape description', () => {
    const res = { choices: [{ message: { reasoning_content: 'x'.repeat(42), content: '' } }] };
    expect(describeResponseShape(res)).toContain('reasoning.len=42');
  });

  it('omits the reasoning length hint when reasoning_content is empty', () => {
    const res = { choices: [{ message: { reasoning_content: '', content: '' } }] };
    expect(describeResponseShape(res)).not.toContain('reasoning.len');
  });

  it('stripThinkTags handles nested-free multiple blocks', () => {
    expect(stripThinkTags('<think>a</think>real<think>b</think> answer')).toBe('real answer');
  });
});

describe('malformed think tags (pd-qa on #7788)', () => {
  it('nested blocks leave no residue', () => {
    expect(stripThinkTags('<think>a<think>b</think>c</think>real answer')).toBe('real answer');
  });

  it('an orphan closer is dropped but the surrounding output is kept', () => {
    expect(stripThinkTags('half a thought</think>the actual answer')).toBe('half a thoughtthe actual answer');
  });
});
