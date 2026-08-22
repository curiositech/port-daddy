/**
 * Unit tests for Workers AI spend derivation (src/spend.ts).
 */

import { describe, it, expect } from 'vitest';
import {
  costUsdForModel,
  isPricedModel,
  hasKnownContextWindow,
  WORKERS_AI_RATES,
  MODEL_CONTEXT_TOKENS,
} from '../src/spend.js';
import { KNOWN_GOOD_CF_MODELS } from '../src/fleet.js';

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

  it('ADMISSION CONTRACT: every honored model is priced AND has a known context window', () => {
    // The roster's three-part admission contract as an executable invariant
    // (pd-qa HIGH on #9249): an honored-but-unpriced model meters $0 and
    // rides invisibly; an honored model without a context row breaks derived
    // chunk budgets. Membership in KNOWN_GOOD_CF_MODELS therefore REQUIRES
    // both rows — adding an id to fleet.ts without spend.ts fails here.
    for (const model of KNOWN_GOOD_CF_MODELS) {
      expect({ model, priced: isPricedModel(model) }).toEqual({ model, priced: true });
      expect({ model, ctx: hasKnownContextWindow(model) }).toEqual({ model, ctx: true });
    }
    // Bijection both ways: a rate or context row for an UN-honored id is dead
    // config that silently prices nothing — the tables and the set move together.
    expect(Object.keys(WORKERS_AI_RATES).sort()).toEqual([...KNOWN_GOOD_CF_MODELS].sort());
    expect(Object.keys(MODEL_CONTEXT_TOKENS).sort()).toEqual([...KNOWN_GOOD_CF_MODELS].sort());
  });

  it('the rate table contains exactly the known-good models the fleet routes to', () => {
    // Admission contract: every id fleet.ts honors as a pin must be priced
    // here (verified against the live pricing page, never guessed) — an
    // honored-but-unpriced model meters $0, which is how the purser's
    // gpt-oss-20b author calls rode invisibly for a week.
    expect(Object.keys(WORKERS_AI_RATES).sort()).toEqual([
      '@cf/moonshotai/kimi-k2.7-code',
      '@cf/openai/gpt-oss-120b',
      '@cf/openai/gpt-oss-20b',
      '@cf/qwen/qwen3-30b-a3b-fp8',
    ]);
  });
});
