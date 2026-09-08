/**
 * Live streaming from the API backends.
 *
 * Before this, exactly two backends streamed — the cli-tube pair, which parse
 * claude-code `stream-json` and codex `--json` per line. Every API backend
 * (Cloudflare, Gemini, OpenAI and its compatible family, the Anthropic SDK) sent
 * `stream: false` and returned one blob at the end, so a lane watching an API
 * body showed nothing at all until it finished. That is the Infinite Spinner the
 * operator surface rules forbid: no heartbeat, no partial output, no way to tell
 * a slow run from a hung one.
 *
 * The beliefs pinned here:
 *
 *   1. Streaming is opt-in per call, and the FINAL result is identical either
 *      way. That equivalence is what lets it be a caller's choice rather than a
 *      second code path nothing downstream understands.
 *   2. A frame split across two network chunks does not drop a token. This is
 *      the classic SSE bug and it is silent — it reads as the model having said
 *      less than it did.
 *   3. Usage survives where the provider reports it, and stays UNDEFINED where
 *      it does not. Undefined means unknown; zero would assert a free call, and
 *      the telemetry policy is fail-closed on exactly that difference.
 *   4. A caller's delta sink cannot break the completion. Observing a response
 *      must never fail producing it.
 */

import { describe, test, expect, jest } from '@jest/globals';

const { cloudflareAdapter, geminiAdapter } = await import('../../lib/llm-call.js');
const { openaiAdapter } = await import('../../lib/spawner/backends/openai.js');
const { createDeltaCoalescer } = await import('../../lib/spawner.js');

/** Build a Response whose body streams the given chunks as raw bytes. */
function sseResponse(chunks, { status = 200 } = {}) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/event-stream' },
  });
}

/** Swap global fetch for the duration of one call. */
async function withFetch(impl, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

const frame = (obj) => `data: ${JSON.stringify(obj)}\n\n`;

describe('cloudflareAdapter streaming', () => {
  const env = { CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_API_TOKEN: 'tok' };

  test('emits each fragment live and returns the whole completion', async () => {
    const deltas = [];
    const result = await withFetch(
      async () =>
        sseResponse([
          frame({ choices: [{ delta: { content: 'Salvage ' } }] }),
          frame({ choices: [{ delta: { content: 'preserves ' } }] }),
          frame({ choices: [{ delta: { content: 'the worktree.' } }] }),
          'data: [DONE]\n\n',
        ]),
      () =>
        cloudflareAdapter({
          prompt: 'p',
          model: '@cf/zai-org/glm-4.7-flash',
          env,
          onTextDelta: (d) => deltas.push(d),
        }),
    );
    expect(deltas).toEqual(['Salvage ', 'preserves ', 'the worktree.']);
    expect(result.ok).toBe(true);
    expect(result.text).toBe('Salvage preserves the worktree.');
  });

  test('a frame split across network chunks is not dropped', async () => {
    // The silent bug: half a frame arrives, the reader parses what it has, and
    // the rest is discarded when the next chunk overwrites the buffer.
    const whole = frame({ choices: [{ delta: { content: 'unbroken' } }] });
    const deltas = [];
    const result = await withFetch(
      async () => sseResponse([whole.slice(0, 12), whole.slice(12)]),
      () =>
        cloudflareAdapter({
          prompt: 'p',
          model: '@cf/zai-org/glm-4.7-flash',
          env,
          onTextDelta: (d) => deltas.push(d),
        }),
    );
    expect(deltas).toEqual(['unbroken']);
    expect(result.text).toBe('unbroken');
  });

  test('a final frame with no trailing blank line still lands', async () => {
    const deltas = [];
    await withFetch(
      async () => sseResponse([`data: ${JSON.stringify({ response: 'tail' })}`]),
      () =>
        cloudflareAdapter({
          prompt: 'p',
          model: '@cf/zai-org/glm-4.7-flash',
          env,
          onTextDelta: (d) => deltas.push(d),
        }),
    );
    expect(deltas).toEqual(['tail']);
  });

  test('a malformed frame is skipped rather than failing the whole stream', async () => {
    const deltas = [];
    const result = await withFetch(
      async () =>
        sseResponse([
          frame({ choices: [{ delta: { content: 'good ' } }] }),
          'data: {not json\n\n',
          frame({ choices: [{ delta: { content: 'still good' } }] }),
        ]),
      () =>
        cloudflareAdapter({
          prompt: 'p',
          model: '@cf/zai-org/glm-4.7-flash',
          env,
          onTextDelta: (d) => deltas.push(d),
        }),
    );
    expect(result.ok).toBe(true);
    expect(result.text).toBe('good still good');
  });

  test('WITHOUT a sink the request is not streamed at all', async () => {
    // Streaming is not the free default it looks like: Workers AI gives up its
    // usage block when streaming, and usage is what the telemetry policy needs.
    let sentBody = null;
    await withFetch(
      async (_url, init) => {
        sentBody = JSON.parse(init.body);
        return new Response(JSON.stringify({ result: { response: 'batch' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
      () => cloudflareAdapter({ prompt: 'p', model: '@cf/zai-org/glm-4.7-flash', env }),
    );
    expect(sentBody.stream).toBe(false);
  });

  test('a sink that throws does not fail the completion', async () => {
    const result = await withFetch(
      async () => sseResponse([frame({ response: 'ok' })]),
      () =>
        cloudflareAdapter({
          prompt: 'p',
          model: '@cf/zai-org/glm-4.7-flash',
          env,
          onTextDelta: () => {
            throw new Error('the lane closed');
          },
        }),
    );
    expect(result.ok).toBe(true);
    expect(result.text).toBe('ok');
  });
});

describe('geminiAdapter streaming', () => {
  const env = { GEMINI_API_KEY: 'k' };
  const part = (text, extra = {}) => ({
    candidates: [{ content: { parts: [{ text, ...extra }] } }],
  });

  test('uses the streaming METHOD with alt=sse, not generateContent', async () => {
    // Without `alt=sse` Gemini returns a JSON array rather than an event stream,
    // which parses as one enormous frame and defeats the point entirely.
    let calledUrl = null;
    await withFetch(
      async (url) => {
        calledUrl = String(url);
        return sseResponse([frame(part('hi'))]);
      },
      () =>
        geminiAdapter({ prompt: 'p', model: 'gemini-3.7-flash', env, onTextDelta: () => {} }),
    );
    expect(calledUrl).toContain(':streamGenerateContent?alt=sse');
  });

  test('thought parts are not streamed into the answer', async () => {
    // Reasoning is billed and recorded elsewhere; splicing the scratchpad into
    // the answer would put the model's thinking in the operator's output.
    const deltas = [];
    const result = await withFetch(
      async () =>
        sseResponse([
          frame({
            candidates: [
              { content: { parts: [{ text: 'let me think…', thought: true }, { text: 'Answer.' }] } },
            ],
          }),
        ]),
      () =>
        geminiAdapter({
          prompt: 'p',
          model: 'gemini-3.7-flash',
          env,
          onTextDelta: (d) => deltas.push(d),
        }),
    );
    expect(deltas).toEqual(['Answer.']);
    expect(result.text).toBe('Answer.');
  });

  test('usage survives streaming — Gemini repeats cumulative totals per chunk', async () => {
    const result = await withFetch(
      async () =>
        sseResponse([
          frame(part('a')),
          frame({
            ...part('b'),
            usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 5, thoughtsTokenCount: 2 },
          }),
        ]),
      () => geminiAdapter({ prompt: 'p', model: 'gemini-3.7-flash', env, onTextDelta: () => {} }),
    );
    expect(result.inputTokens).toBe(11);
    // Thinking tokens are billed as output, so they fold in.
    expect(result.outputTokens).toBe(7);
  });

  test('an empty stream is a real failure, not zero-token success', async () => {
    const result = await withFetch(
      async () => sseResponse([frame({ candidates: [{ finishReason: 'SAFETY' }] })]),
      () => geminiAdapter({ prompt: 'p', model: 'gemini-3.7-flash', env, onTextDelta: () => {} }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/SAFETY/);
  });
});

describe('openaiAdapter streaming', () => {
  const env = { OPENAI_API_KEY: 'sk-test' };

  // Chat-completions shape: any non-gpt-5 / non-o-series id.
  test('streams chat-completion deltas and asks for usage, which streaming otherwise omits', async () => {
    let sentBody = null;
    const deltas = [];
    const result = await withFetch(
      async (_url, init) => {
        sentBody = JSON.parse(init.body);
        return sseResponse([
          frame({ choices: [{ delta: { content: 'one ' } }] }),
          frame({ choices: [{ delta: { content: 'two' } }] }),
          frame({ choices: [], usage: { prompt_tokens: 9, completion_tokens: 4 } }),
          'data: [DONE]\n\n',
        ]);
      },
      () =>
        openaiAdapter({
          prompt: 'p',
          model: 'gpt-4.1-mini',
          env,
          onTextDelta: (d) => deltas.push(d),
        }),
    );
    expect(sentBody.stream).toBe(true);
    expect(sentBody.stream_options).toEqual({ include_usage: true });
    expect(deltas).toEqual(['one ', 'two']);
    expect(result.text).toBe('one two');
    expect(result.inputTokens).toBe(9);
    expect(result.outputTokens).toBe(4);
  });

  // Responses shape: the ENTIRE gpt-5 ladder the registry maps routes here, so
  // leaving it on batch would have meant OpenAI never streams in practice.
  test('streams the Responses API shape used by the whole gpt-5 ladder', async () => {
    let sentBody = null;
    const deltas = [];
    const result = await withFetch(
      async (_url, init) => {
        sentBody = JSON.parse(init.body);
        return sseResponse([
          frame({ type: 'response.output_text.delta', delta: 'Salvage ' }),
          frame({ type: 'response.output_text.delta', delta: 'over reap.' }),
          frame({
            type: 'response.completed',
            response: { usage: { input_tokens: 12, output_tokens: 6 } },
          }),
          'data: [DONE]\n\n',
        ]);
      },
      () =>
        openaiAdapter({
          prompt: 'p',
          model: 'gpt-5-mini',
          env,
          onTextDelta: (d) => deltas.push(d),
        }),
    );
    expect(sentBody.stream).toBe(true);
    expect(deltas).toEqual(['Salvage ', 'over reap.']);
    expect(result.text).toBe('Salvage over reap.');
    expect(result.inputTokens).toBe(12);
    expect(result.outputTokens).toBe(6);
  });

  test('Responses reasoning events are NOT streamed into the answer', async () => {
    // The stream interleaves reasoning with output text; only output-text
    // deltas are the answer. Streaming both puts the scratchpad in the output.
    const deltas = [];
    const result = await withFetch(
      async () =>
        sseResponse([
          frame({ type: 'response.reasoning_summary_text.delta', delta: 'thinking…' }),
          frame({ type: 'response.output_text.delta', delta: 'Answer.' }),
        ]),
      () => openaiAdapter({ prompt: 'p', model: 'gpt-5-mini', env, onTextDelta: (d) => deltas.push(d) }),
    );
    expect(deltas).toEqual(['Answer.']);
    expect(result.text).toBe('Answer.');
  });

  test('a failed Responses stream is an error, not an empty success', async () => {
    const result = await withFetch(
      async () =>
        sseResponse([
          frame({ type: 'response.failed', response: { error: { message: 'context too long' } } }),
        ]),
      () => openaiAdapter({ prompt: 'p', model: 'gpt-5-mini', env, onTextDelta: () => {} }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/context too long/);
  });

  test('absent usage stays UNDEFINED rather than becoming zero', async () => {
    // Undefined means unknown; zero asserts a free call. The fail-closed
    // telemetry policy turns on exactly that difference.
    const result = await withFetch(
      async () => sseResponse([frame({ choices: [{ delta: { content: 'x' } }] })]),
      () => openaiAdapter({ prompt: 'p', model: 'gpt-4.1-mini', env, onTextDelta: () => {} }),
    );
    expect(result.inputTokens).toBeUndefined();
    expect(result.outputTokens).toBeUndefined();
  });

  test('WITHOUT a sink neither shape is streamed', async () => {
    const bodies = [];
    await withFetch(
      async (_url, init) => {
        bodies.push(JSON.parse(init.body));
        return new Response(
          JSON.stringify({ choices: [{ message: { content: 'batch' } }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
      () => openaiAdapter({ prompt: 'p', model: 'gpt-4.1-mini', env }),
    );
    await withFetch(
      async (_url, init) => {
        bodies.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ output_text: 'batch' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
      () => openaiAdapter({ prompt: 'p', model: 'gpt-5-mini', env }),
    );
    expect(bodies[0].stream).toBe(false);
    expect(bodies[0].stream_options).toBeUndefined();
    expect(bodies[1].stream).toBe(false);
  });
});

describe('a "stream" that is not a stream — the 200-with-a-JSON-error case', () => {
  // FOUND LIVE, 2026-08-23. Gemini answers a quota failure with HTTP **200**,
  // `content-type: text/event-stream`, and a plain JSON error object as the
  // body. Every honest check passes — status fine, content type says SSE — and
  // the SSE parser then finds zero frames. Reporting that as "returned no text
  // response" is technically true and completely useless: it hides a 429 behind
  // a message that reads like a model problem and sends an operator hunting the
  // wrong thing. The lane in the first live capture said exactly that.
  const quota = JSON.stringify({
    error: { code: 429, message: 'You exceeded your current quota, please check your plan and billing details.' },
  });

  test('gemini surfaces the provider error instead of "no text response"', async () => {
    const result = await withFetch(
      async () =>
        new Response(quota, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
      () =>
        geminiAdapter({
          prompt: 'p',
          model: 'gemini-3.7-flash',
          env: { GEMINI_API_KEY: 'k' },
          onTextDelta: () => {},
        }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/429/);
    expect(result.error).toMatch(/quota/i);
  });

  test('cloudflare does the same', async () => {
    const result = await withFetch(
      async () =>
        new Response(JSON.stringify({ errors: [], error: { message: 'Account is over its limit' } }), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
      () =>
        cloudflareAdapter({
          prompt: 'p',
          model: '@cf/zai-org/glm-4.7-flash',
          env: { CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: 't' },
          onTextDelta: () => {},
        }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/over its limit/);
  });

  test('openai does the same', async () => {
    const result = await withFetch(
      async () =>
        new Response(JSON.stringify({ error: { type: 'insufficient_quota', message: 'You exceeded your quota' } }), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
      () =>
        openaiAdapter({
          prompt: 'p',
          model: 'gpt-4.1-mini',
          env: { OPENAI_API_KEY: 'sk' },
          onTextDelta: () => {},
        }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/insufficient_quota/);
  });

  test('a non-JSON body is quoted rather than swallowed', async () => {
    // Even an unparseable body beats a generic "no response": the reader needs
    // SOMETHING to search for.
    const result = await withFetch(
      async () =>
        new Response('<html>502 Bad Gateway</html>', {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
      () =>
        geminiAdapter({
          prompt: 'p',
          model: 'gemini-3.7-flash',
          env: { GEMINI_API_KEY: 'k' },
          onTextDelta: () => {},
        }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/502 Bad Gateway/);
  });

  test('a REAL stream that legitimately produced nothing keeps its own message', async () => {
    // The distinction that makes the above safe: frames arrived, they just
    // carried no text. That is a model outcome, not a transport failure, and it
    // must not be reported as a provider error.
    const result = await withFetch(
      async () => sseResponse([frame({ candidates: [{ finishReason: 'SAFETY' }] })]),
      () =>
        geminiAdapter({
          prompt: 'p',
          model: 'gemini-3.7-flash',
          env: { GEMINI_API_KEY: 'k' },
          onTextDelta: () => {},
        }),
    );
    expect(result.error).toMatch(/finishReason: SAFETY/);
  });
});

describe('createDeltaCoalescer — the anti-duplicate, anti-spinner rule', () => {
  test('buffers small fragments instead of writing one transcript row per token', () => {
    // Appending one row per delta would write thousands of rows for one answer
    // and give the operator a lane that scrolls a character at a time.
    const emitted = [];
    let clock = 0;
    const c = createDeltaCoalescer((t) => emitted.push(t), () => clock);
    c.push('a');
    c.push('b');
    c.push('c');
    expect(emitted).toEqual([]);
    c.finish();
    expect(emitted).toEqual(['abc']);
  });

  test('flushes on a newline so seams fall on natural boundaries', () => {
    const emitted = [];
    let clock = 0;
    const c = createDeltaCoalescer((t) => emitted.push(t), () => clock);
    c.push('first line\n');
    c.push('second');
    expect(emitted).toEqual(['first line\n']);
    c.finish();
    expect(emitted).toEqual(['first line\n', 'second']);
  });

  test('flushes on time so a SLOW model does not look frozen', () => {
    // The anti-Infinite-Spinner half: a lane must show life even when the model
    // is producing very little.
    const emitted = [];
    let clock = 0;
    const c = createDeltaCoalescer((t) => emitted.push(t), () => clock);
    c.push('tick');
    expect(emitted).toEqual([]);
    clock = 300;
    c.push('tock');
    expect(emitted).toEqual(['ticktock']);
  });

  test('flushes on size so a FAST model does not buffer a wall of text', () => {
    const emitted = [];
    let clock = 0;
    const c = createDeltaCoalescer((t) => emitted.push(t), () => clock);
    c.push('x'.repeat(500));
    expect(emitted).toHaveLength(1);
  });

  test('finish() reports whether anything streamed — the exactly-once signal', () => {
    // This answer is what tells the spawn loop to SKIP the batched re-append.
    // Get it wrong and the operator reads the same answer twice.
    let clock = 0;
    const silent = createDeltaCoalescer(() => {}, () => clock);
    expect(silent.finish()).toBe(false);

    const spoken = createDeltaCoalescer(() => {}, () => clock);
    spoken.push('something');
    expect(spoken.finish()).toBe(true);
  });

  test('finish() is idempotent — a second call emits nothing more', () => {
    const emitted = [];
    let clock = 0;
    const c = createDeltaCoalescer((t) => emitted.push(t), () => clock);
    c.push('once');
    c.finish();
    c.finish();
    expect(emitted).toEqual(['once']);
  });
});

describe('a reasoning model that runs out of budget mid-thought', () => {
  // FOUND BY LIVE-PROBING ALL 23 ADMITTED WORKERS AI MODELS, 2026-08-23.
  // More than half are reasoning models, and they stream their scratchpad
  // first and their answer last out of ONE shared output budget. Measured on
  // shipDefault (@cf/qwen/qwen3-30b-a3b-fp8), prompt "Say OK.":
  //
  //     max_tokens 2000 -> 113 frames, 105 reasoning, 3 content, stop
  //     max_tokens  400 -> 0 content frames, HTTP 200, empty completion
  //
  // The second is not an error. It is a BLANK, which is the shape a parser
  // reads as "clean" — the same silent-blank class that took the fleet down in
  // #654, arriving by a different route: there the id did not exist, here the
  // model never reached its answer.
  const env = { CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_API_TOKEN: 'tok' };

  test('the failure names the budget, not "the model said nothing"', async () => {
    // These two want opposite responses from whoever reads the log: one is
    // "raise maxTokens", the other is "the model has a problem". A message that
    // cannot tell them apart sends an operator to the wrong place.
    const body = {
      result: {
        choices: [{
          message: { content: null, reasoning_content: 'Okay, the user wants me to' },
          finish_reason: 'length',
        }],
      },
    };
    const res = await withFetch(
      async () => new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      () => cloudflareAdapter({ prompt: 'p', model: '@cf/qwen/qwen3-30b-a3b-fp8', env }),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/entire output budget/);
    expect(res.error).toMatch(/finish_reason: length/);
    expect(res.error).toMatch(/maxTokens/);
  });

  test('the reasoning text is never promoted into the answer', async () => {
    // The tempting fix, and the wrong one. Gemini's reader already refuses to
    // stream `thought` parts into the operator's output for the same reason: a
    // scratchpad spliced into an answer is a different failure, not a repair.
    const body = {
      result: {
        choices: [{
          message: { content: null, reasoning_content: 'SECRET SCRATCHPAD REASONING' },
          finish_reason: 'length',
        }],
      },
    };
    const res = await withFetch(
      async () => new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      () => cloudflareAdapter({ prompt: 'p', model: '@cf/qwen/qwen3-30b-a3b-fp8', env }),
    );
    expect(res.ok).toBe(false);
    expect(res.text ?? '').not.toContain('SECRET SCRATCHPAD');
    expect(res.error).not.toContain('SECRET SCRATCHPAD');
  });

  test('a blank for any OTHER reason still reports the finish_reason it had', async () => {
    // The budget case is one branch, not the whole story. A model that stops
    // for a content filter must not be reported as needing a bigger budget.
    const body = {
      result: { choices: [{ message: { content: '' }, finish_reason: 'content_filter' }] },
    };
    const res = await withFetch(
      async () => new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      () => cloudflareAdapter({ prompt: 'p', model: '@cf/qwen/qwen3-30b-a3b-fp8', env }),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/finish_reason: content_filter/);
    expect(res.error).not.toMatch(/output budget/);
  });

  test('a real answer after a long reasoning run is unaffected', async () => {
    // The complement, and the one that makes the others mean something: the
    // measured shape is 105 reasoning frames THEN content. If the reader only
    // survived the blank case it would be a reader that never works.
    const chunks = [
      ...Array.from({ length: 5 }, () => frame({
        choices: [{ delta: { reasoning_content: 'thinking...' } }],
      })),
      frame({ choices: [{ delta: { content: 'OK' } }] }),
      frame({ choices: [{ delta: { content: '.' } }] }),
      'data: [DONE]\n\n',
    ];
    const deltas = [];
    const res = await withFetch(
      async () => sseResponse(chunks),
      () => cloudflareAdapter({
        prompt: 'p', model: '@cf/qwen/qwen3-30b-a3b-fp8', env,
        onTextDelta: (d) => deltas.push(d),
      }),
    );
    expect(res.ok).toBe(true);
    expect(res.text).toBe('OK.');
    expect(deltas).toEqual(['OK', '.']);
  });
});

describe('a Gemini stream that is all thinking and no answer', () => {
  // FROM THE LIVE CAPTURE. The gemini lane failed with "Gemini returned no text
  // response" while `gemini-3.7-flash` was intermittently 503 and its sibling
  // rung was 429 quota-exhausted. That message was not wrong so much as
  // unhelpfully general: frames DID arrive, they were `thought` parts, and the
  // answer never came. "The model said nothing" and "the model was still
  // thinking when the stream ended" send an operator to different places.
  test('reports the reasoning it did stream instead of claiming silence', async () => {
    const chunks = [
      frame({ candidates: [{ content: { parts: [{ text: 'Let me consider', thought: true }] } }] }),
      frame({ candidates: [{ content: { parts: [{ text: ' the tradeoffs.', thought: true }] } }] }),
      'data: [DONE]\n\n',
    ];
    const res = await withFetch(
      async () => sseResponse(chunks),
      () => geminiAdapter({
        prompt: 'p', model: 'gemini-3.7-flash',
        env: { GOOGLE_API_KEY: 'k' }, onTextDelta: () => {},
      }),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/reasoning and no answer/);
    expect(res.error).toMatch(/still thinking/);
  });

  test('the reasoning text itself is not leaked into the error', async () => {
    // Same rule as everywhere else: a scratchpad is not an answer, and an error
    // message is not a side door for one.
    const chunks = [
      frame({ candidates: [{ content: { parts: [{ text: 'SECRET PLAN', thought: true }] } }] }),
      'data: [DONE]\n\n',
    ];
    const res = await withFetch(
      async () => sseResponse(chunks),
      () => geminiAdapter({
        prompt: 'p', model: 'gemini-3.7-flash',
        env: { GOOGLE_API_KEY: 'k' }, onTextDelta: () => {},
      }),
    );
    expect(res.ok).toBe(false);
    expect(res.error).not.toContain('SECRET PLAN');
    expect(res.error).toMatch(/11 characters of reasoning/);
  });

  test('a stream that closes with no frames at all says THAT instead', async () => {
    // The neighbouring case, and it must stay distinguishable: nothing arrived,
    // versus something arrived that was not the answer.
    const res = await withFetch(
      async () => sseResponse([]),
      () => geminiAdapter({
        prompt: 'p', model: 'gemini-3.7-flash',
        env: { GOOGLE_API_KEY: 'k' }, onTextDelta: () => {},
      }),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/without sending a single frame/);
    expect(res.error).not.toMatch(/reasoning and no answer/);
  });
});
