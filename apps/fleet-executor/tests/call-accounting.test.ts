/**
 * Unit tests for per-call accounting (src/call-accounting.ts) — the model id +
 * token usage + USD cost derived from ONE `env.AI.run(...)` result, as opposed
 * to execute.ts's ShipMetrics, which accumulates across a whole ship's calls.
 */

import { describe, it, expect } from 'vitest';
import { perCallAccounting } from '../src/call-accounting.js';

describe('perCallAccounting', () => {
  it('reports usage + cost when the model returns a usage block (standard shape)', () => {
    const res = { response: 'hi', usage: { prompt_tokens: 1000, completion_tokens: 500 } };
    const acc = perCallAccounting('@cf/openai/gpt-oss-120b', res);
    expect(acc).toEqual({
      model: '@cf/openai/gpt-oss-120b',
      usageReported: true,
      inputTokens: 1000,
      outputTokens: 500,
      cachedInputTokens: 0,
      // 1000/1e6*0.35 + 500/1e6*0.75 = 0.000725
      costUsd: 0.000725,
    });
  });

  it('reads the Responses-API usage shape too (input_tokens/output_tokens)', () => {
    const res = { output: [], usage: { input_tokens: 100, output_tokens: 20 } };
    const acc = perCallAccounting('@cf/qwen/qwen3-30b-a3b-fp8', res);
    expect(acc.usageReported).toBe(true);
    expect(acc.inputTokens).toBe(100);
    expect(acc.outputTokens).toBe(20);
    expect(acc.costUsd).toBeCloseTo(0.000012, 6);
  });

  it('omits token/cost fields entirely (never zeroes them) when no usage block is present', () => {
    const acc = perCallAccounting('@cf/openai/gpt-oss-120b', { response: 'no usage here' });
    expect(acc).toEqual({ model: '@cf/openai/gpt-oss-120b', usageReported: false });
    expect(acc.inputTokens).toBeUndefined();
    expect(acc.outputTokens).toBeUndefined();
    expect(acc.costUsd).toBeUndefined();
  });

  it('treats a non-object / null result as no usage, never throws', () => {
    expect(perCallAccounting('@cf/x', null).usageReported).toBe(false);
    expect(perCallAccounting('@cf/x', undefined).usageReported).toBe(false);
    expect(perCallAccounting('@cf/x', 'a string response').usageReported).toBe(false);
  });

  it('an unpriced model records real tokens and NO cost -- not a cost of zero', () => {
    // The distinction this whole row exists to preserve: "we do not know what
    // this cost" is not "this cost nothing". costUsdForModel returns 0 for a
    // model absent from WORKERS_AI_RATES, so stamping it would make an unpriced
    // call indistinguishable from a genuinely free one on a page whose entire
    // job is to be believed. The tokens are real and are still recorded.
    const res = { response: 'x', usage: { prompt_tokens: 500, completion_tokens: 500 } };
    const acc = perCallAccounting('@cf/some/unpriced-model', res);
    expect(acc.usageReported).toBe(true);
    expect(acc.inputTokens).toBe(500);
    expect(acc.outputTokens).toBe(500);
    expect(acc.costUsd).toBeUndefined();
    expect(acc.unpricedModel).toBe(true);
  });

  it('a PRICED model still carries a cost and no unpriced marker', () => {
    const res = { response: 'x', usage: { prompt_tokens: 500, completion_tokens: 500 } };
    const acc = perCallAccounting('@cf/openai/gpt-oss-120b', res);
    expect(acc.costUsd).toBeGreaterThan(0);
    expect(acc.unpricedModel).toBeUndefined();
  });

  it('carries cached-input tokens when the model reports prefix-cache hits', () => {
    const res = {
      response: 'x',
      usage: { prompt_tokens: 1000, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 800 } },
    };
    const acc = perCallAccounting('@cf/openai/gpt-oss-120b', res);
    expect(acc.cachedInputTokens).toBe(800);
  });
});
