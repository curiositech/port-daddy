import { describe, it, expect } from 'vitest';
import { UsageMeter } from '../src/usage.js';
import { costForModel, isPricedModel } from '../src/pricing.js';

// The RELAY sink's cost derivation. Ship ROLE routing (deriveCfModel) only ever
// lands on PRICED Workers AI models today, so the null-cost / partial-cost paths
// can no longer be exercised end-to-end through executeFleet — they are pinned
// here at the unit level so the "unknown values stay null, never guessed" rule
// (binder ch09) can't silently regress.

describe('costForModel', () => {
  it('derives real USD for a priced model', () => {
    // gpt-oss-120b: $0.35/1M in, $0.75/1M out.
    expect(costForModel('@cf/openai/gpt-oss-120b', 100, 20)).toBeCloseTo(0.00005, 8);
  });

  it('returns null for a model with no known rate (never a guess)', () => {
    expect(costForModel('@cf/qwen/qwen2.5-coder-32b-instruct', 1000, 1000)).toBeNull();
    expect(isPricedModel('@cf/qwen/qwen2.5-coder-32b-instruct')).toBe(false);
  });

  it('returns 0 (not null) for a priced model with zero tokens', () => {
    expect(costForModel('@cf/openai/gpt-oss-120b', 0, 0)).toBe(0);
  });
});

describe('UsageMeter', () => {
  it('sums tokens per model and totals cost across the run', () => {
    const m = new UsageMeter();
    m.add('@cf/openai/gpt-oss-120b', 100, 20);
    m.add('@cf/openai/gpt-oss-120b', 50, 10);
    const s = m.summary();
    expect(s.inputTokens).toBe(150);
    expect(s.outputTokens).toBe(30);
    expect(s.totalTokens).toBe(180);
    expect(s.modelsCsv).toBe('@cf/openai/gpt-oss-120b');
    // 150/1e6*0.35 + 30/1e6*0.75 = 0.0000525 + 0.0000225 = 0.000075
    expect(s.costUsd).toBeCloseTo(0.000075, 8);
  });

  it('yields null cost when NO model in the run is priced', () => {
    const m = new UsageMeter();
    m.add('@cf/qwen/qwen2.5-coder-32b-instruct', 200, 40);
    const s = m.summary();
    expect(s.inputTokens).toBe(200);
    expect(s.outputTokens).toBe(40);
    expect(s.costUsd).toBeNull();
  });

  it('keeps partial cost when only SOME models are priced', () => {
    const m = new UsageMeter();
    m.add('@cf/openai/gpt-oss-120b', 100, 20); // priced → 0.00005
    m.add('@cf/qwen/qwen2.5-coder-32b-instruct', 100, 20); // unpriced → contributes tokens only
    const s = m.summary();
    expect(s.inputTokens).toBe(200);
    expect(s.outputTokens).toBe(40);
    expect(s.costUsd).toBeCloseTo(0.00005, 8);
    expect(s.modelsCsv).toBe('@cf/openai/gpt-oss-120b,@cf/qwen/qwen2.5-coder-32b-instruct');
  });

  it('clamps a bad (negative/NaN) count to 0 and ignores an empty model id', () => {
    const m = new UsageMeter();
    m.add('@cf/openai/gpt-oss-120b', -5, Number.NaN);
    m.add('', 100, 100);
    const s = m.summary();
    expect(s.inputTokens).toBe(0);
    expect(s.outputTokens).toBe(0);
    expect(s.modelsCsv).toBe('@cf/openai/gpt-oss-120b');
  });
});
