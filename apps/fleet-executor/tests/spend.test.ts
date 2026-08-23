/**
 * Unit tests for Workers AI spend derivation (src/spend.ts).
 */

import { describe, it, expect } from 'vitest';
import { costUsdForModel, isPricedModel, WORKERS_AI_RATES } from '../src/spend.js';
import { CF_ROLE_MODELS, CF_PRICES } from '../../shared/model-registry.generated.js';

describe('costUsdForModel', () => {
  // Priced by ROLE against the catalog's own rate, not against a literal: the
  // unit prices belong to config/models.yaml and move when a vendor moves them.
  // What must not move is that a routed model IS priced and that the arithmetic
  // is right.
  it.each([['reviewBot'], ['shipDefault'], ['shipMid']] as const)(
    'prices the %s role from the catalog rate',
    role => {
      const id = CF_ROLE_MODELS[role];
      const rate = CF_PRICES[id]!;
      const expected = (1000 / 1e6) * rate.input + (500 / 1e6) * rate.output;
      expect(costUsdForModel(id, 1000, 500)).toBeCloseTo(expected, 9);
    },
  );

  it('returns 0 for an unpriced model (tokens still recorded upstream, never guessed)', () => {
    expect(costUsdForModel('@cf/some/unknown-model', 100000, 100000)).toBe(0);
    expect(isPricedModel('@cf/some/unknown-model')).toBe(false);
  });

  it('rounds to 6 decimals so sub-cent costs do not vanish', () => {
    // 1 in / 1 out on the review model ≈ 1.1e-6 → rounds to 0.000001, not 0.
    expect(costUsdForModel(CF_ROLE_MODELS.reviewBot, 1, 1)).toBe(0.000001);
  });

  it('every routable role is priced — a selectable-but-unpriced model is the bug', () => {
    // The old assertion pinned the table to exactly two literal ids, which made
    // it a change-detector rather than an invariant: it failed for any catalog
    // edit and passed for the one thing that matters going wrong, a role
    // pointing at a model with no rate.
    for (const [role, id] of Object.entries(CF_ROLE_MODELS)) {
      expect(isPricedModel(id), `role ${role} -> ${id} has no rate`).toBe(true);
      expect(WORKERS_AI_RATES[id]!.input).toBeGreaterThanOrEqual(0);
    }
  });
});
