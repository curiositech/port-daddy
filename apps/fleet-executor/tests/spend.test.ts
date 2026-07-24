/**
 * Unit tests for Workers AI spend derivation (src/spend.ts).
 */

import { describe, it, expect } from 'vitest';
import { costUsdForModel, isPricedModel, WORKERS_AI_RATES } from '../src/spend.js';

describe('costUsdForModel', () => {
  it('prices gpt-oss-120b at $0.35/$0.75 per M', () => {
    // 1000 in / 500 out = 1000/1e6*0.35 + 500/1e6*0.75 = 0.00035 + 0.000375
    expect(costUsdForModel('@cf/openai/gpt-oss-120b', 1000, 500)).toBeCloseTo(0.000725, 9);
  });

  it('prices qwen3-30b at $0.051/$0.335 per M', () => {
    // 1000 in / 500 out = 1000/1e6*0.051 + 500/1e6*0.335 = 0.000051 + 0.0001675
    expect(costUsdForModel('@cf/qwen/qwen3-30b-a3b-fp8', 1000, 500)).toBeCloseTo(0.000219, 9);
  });

  it('returns 0 for an unpriced model (tokens still recorded upstream, never guessed)', () => {
    expect(costUsdForModel('@cf/some/unknown-model', 100000, 100000)).toBe(0);
    expect(isPricedModel('@cf/some/unknown-model')).toBe(false);
  });

  it('rounds to 6 decimals so sub-cent costs do not vanish', () => {
    // 1 in / 1 out on gpt-oss ≈ 1.1e-6 → rounds to 0.000001, not 0.
    expect(costUsdForModel('@cf/openai/gpt-oss-120b', 1, 1)).toBe(0.000001);
  });

  it('the rate table only contains the two models the fleet routes to', () => {
    expect(Object.keys(WORKERS_AI_RATES).sort()).toEqual([
      '@cf/openai/gpt-oss-120b',
      '@cf/qwen/qwen3-30b-a3b-fp8',
    ]);
  });
});
