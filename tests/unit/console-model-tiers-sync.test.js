// tests/unit/console-model-tiers-sync.test.js
//
// core/pd-console/config/model-tiers.json is a GENERATED artifact of
// lib/model-registry-data.ts (scripts/generate-console-model-tiers.ts). It
// used to be a hand-edited second copy that had already drifted from the
// registry (console claude.high = "claude-opus-4-8" vs the registry's
// claude.high = "claude-opus-4-1-20250805" — "claude-opus-4-8" is actually
// the registry's max-thinking tier). This test IS the CI drift gate: it
// rebuilds the artifact in-memory from the current registry and fails if the
// checked-in file disagrees, so a registry change that isn't followed by
// `npm run generate:console-model-tiers` fails the build (ADR-0057
// model-abstraction unification).

import { describe, test, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';

const { buildConsoleModelTiers, CONSOLE_MODEL_TIERS_PATH } = await import(
  '../../scripts/generate-console-model-tiers.js'
);

describe('console model-tiers.json stays in sync with the TS registry', () => {
  test('the checked-in JSON matches what the registry generates right now', () => {
    const expected = JSON.stringify(buildConsoleModelTiers(), null, 2) + '\n';
    const actual = readFileSync(CONSOLE_MODEL_TIERS_PATH, 'utf8');
    expect(actual).toBe(expected);
  });

  test('every generated id round-trips through resolveModel (no typo drift)', async () => {
    const { resolveModel } = await import('../../lib/model-registry.js');
    const data = buildConsoleModelTiers();
    const capabilityByTier = { high: 'high', mid: 'balanced', low: 'cheap' };
    for (const [provider, tiers] of Object.entries(data.providers)) {
      if (provider === 'lmstudio') continue; // static placeholder, not registry-derived
      for (const [tier, id] of Object.entries(tiers)) {
        if (tier === '_comment') continue;
        expect(id).toBe(resolveModel({ backend: provider, capability: capabilityByTier[tier] }));
      }
    }
  });
});
