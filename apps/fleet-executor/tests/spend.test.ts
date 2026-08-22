/**
 * Unit tests for Workers AI spend derivation (src/spend.ts).
 */

import { readFileSync } from 'node:fs';
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
    // gpt-oss-20b author calls rode invisibly for a week. The list is spelled
    // out (not derived) so a repertoire change is a visible, reviewed diff.
    expect(Object.keys(WORKERS_AI_RATES).sort()).toEqual([
      '@cf/aisingapore/gemma-sea-lion-v4-27b-it',
      '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
      '@cf/deepseek-ai/deepseek-v4-flash-0731',
      '@cf/deepseek-ai/deepseek-v4-pro-0813',
      '@cf/google/gemma-4-26b-a4b-it',
      '@cf/ibm-granite/granite-4.0-h-micro',
      '@cf/meta/llama-3.1-8b-instruct-fp8',
      '@cf/meta/llama-3.2-11b-vision-instruct',
      '@cf/meta/llama-3.2-1b-instruct',
      '@cf/meta/llama-3.2-3b-instruct',
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      '@cf/meta/llama-4-scout-17b-16e-instruct',
      '@cf/mistralai/mistral-small-3.1-24b-instruct',
      '@cf/moonshotai/kimi-k2.7-code',
      '@cf/nvidia/nemotron-3-120b-a12b',
      '@cf/openai/gpt-oss-120b',
      '@cf/openai/gpt-oss-20b',
      '@cf/qwen/qwen2.5-coder-32b-instruct',
      '@cf/qwen/qwen3-30b-a3b-fp8',
      '@cf/qwen/qwen3.8-27b',
      '@cf/qwen/qwq-32b',
      '@cf/zai-org/glm-4.7-flash',
      '@cf/zai-org/glm-5.2',
    ]);
  });
});

describe('model-dossier parity (the Shipwright board can never drift from the executor)', () => {
  // The relay's Shipwright page and system prompt render apps/relay/src/
  // model-dossier.json as "the models the fleet honors, at these prices".
  // That is a second copy of what THIS package enforces — so per the repo's
  // fixture-parity rule, this suite reads the identical JSON bytes and pins
  // it to the live tables. A model admitted (or retired) in spend.ts without
  // a dossier edit — or a dossier price that disagrees with the metered rate
  // — fails here, not in front of an operator.
  const dossier = JSON.parse(
    readFileSync(new URL('../../relay/src/model-dossier.json', import.meta.url), 'utf8'),
  ) as {
    models: Array<{
      id: string;
      inputUsdPerM: number;
      outputUsdPerM: number;
      contextTokens: number;
      verdict: string;
    }>;
  };

  it('the dossier lists exactly the honored set — no extras, no omissions', () => {
    const dossierIds = dossier.models.map((m) => m.id).sort();
    expect(dossierIds).toEqual([...KNOWN_GOOD_CF_MODELS].sort());
  });

  it('every dossier price and context window equals what the executor meters and budgets', () => {
    for (const m of dossier.models) {
      const rate = WORKERS_AI_RATES[m.id];
      expect(rate, `${m.id} missing from WORKERS_AI_RATES`).toBeDefined();
      expect(rate!.input, `${m.id} input rate`).toBe(m.inputUsdPerM);
      expect(rate!.output, `${m.id} output rate`).toBe(m.outputUsdPerM);
      expect(MODEL_CONTEXT_TOKENS[m.id], `${m.id} context window`).toBe(m.contextTokens);
    }
  });

  it('every verdict is one the board renders', () => {
    for (const m of dossier.models) {
      expect(['adopted', 'bench'], m.id).toContain(m.verdict);
    }
  });
});
