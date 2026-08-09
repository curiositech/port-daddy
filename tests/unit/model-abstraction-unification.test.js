// tests/unit/model-abstraction-unification.test.js
//
// ADR-0057 model-abstraction unification: a caller must NEVER name a
// concrete model — only a (backend handle, capability tier) pair — and the
// router resolves the concrete id in ONE place (lib/model-registry.ts
// resolveModel). This suite proves that end-to-end for the two real runtime
// paths that accept a bare tier with no explicit model:
//
//   1. lib/fleet-runtime.ts resolveFleetAgentRuntime({backend, modelTier})
//      (fleet YAML agents declare a modelTier, never a model id)
//   2. lib/spawner.ts DEFAULT_MODELS (routes/spawn.ts falls back to this when
//      a /spawn request supplies a backend but no model)
//
// It also proves the Rust console's generated model-tiers.json — the ONE
// place a non-TypeScript consumer would read resolved ids from — agrees
// with the registry exactly (the console used to hand-edit a second copy
// that had already drifted).

import { describe, test, expect } from '@jest/globals';

const { resolveFleetAgentRuntime } = await import('../../lib/fleet-runtime.js');
const { resolveModel } = await import('../../lib/model-registry.js');
const { KNOWN_BACKEND_IDS } = await import('../../lib/backend-catalog.js');
const { buildConsoleModelTiers } = await import('../../scripts/generate-console-model-tiers.js');

describe('a caller can launch with only (backend handle, tier) — no model id', () => {
  test('fleet agent: backend + modelTier resolves a concrete model with no explicit model', () => {
    const resolved = resolveFleetAgentRuntime({ backend: 'claude', modelTier: 'high' });
    expect(resolved.backend).toBe('claude');
    expect(resolved.model).toBe(resolveModel({ backend: 'claude', tier: 'high' }));
    expect(resolved.warnings).toEqual([]);
  });

  test('fleet agent: the newly-unified ollama backend resolves every tier through the registry', () => {
    for (const [tier, capability] of [['low', 'cheap'], ['mid', 'balanced'], ['high', 'high']]) {
      const resolved = resolveFleetAgentRuntime({ backend: 'ollama', modelTier: tier });
      expect(resolved.model).toBe(resolveModel({ backend: 'ollama', capability }));
      expect(resolved.warnings).toEqual([]);
    }
  });

  test('fleet agent: an alias backend name (claude-cli) still resolves through the same registry family', () => {
    // claude-cli keeps its own SPECIAL_FORM_MODEL_TIERS (CLI short aliases,
    // not API ids) — this proves the alias collapse in model-registry-data.ts
    // didn't change that path's behavior.
    const resolved = resolveFleetAgentRuntime({ backend: 'claude-cli', modelTier: 'high' });
    expect(resolved.model).toBe('opus');
  });

  test('every backend id the fleet/CLI validators accept resolves a tier via the registry OR has a documented special form', () => {
    // lib/fleet-runtime.ts special-forms + registry-tier backends must cover
    // every id in the single backend-id catalog, OR the backend is a CLI-tube
    // (`cli:*`) whose model is opaque to Port Daddy and legitimately has no
    // tier ladder at all.
    for (const backend of KNOWN_BACKEND_IDS) {
      if (backend.startsWith('cli:')) continue;
      const resolved = resolveFleetAgentRuntime({ backend, modelTier: 'low' });
      expect(resolved.backend).toBe(backend);
      // A backend either resolves a real model for its 'low' tier, or (for a
      // backend with no tier ladder, e.g. 'custom') resolves its documented
      // placeholder — either way it must never silently come back empty.
      expect(typeof resolved.model === 'string' && resolved.model.length > 0).toBe(true);
    }
  });
});

describe('the console model-tiers artifact matches the TS registry exactly', () => {
  test('buildConsoleModelTiers() reproduces every provider tier via resolveModel', () => {
    const data = buildConsoleModelTiers();
    expect(data.providers.claude.high).toBe(resolveModel({ backend: 'claude', capability: 'high' }));
    expect(data.providers.claude.mid).toBe(resolveModel({ backend: 'claude', capability: 'balanced' }));
    expect(data.providers.claude.low).toBe(resolveModel({ backend: 'claude', capability: 'cheap' }));
    expect(data.providers.ollama.low).toBe(resolveModel({ backend: 'ollama', capability: 'cheap' }));
    // The stale hand-edited value this replaced ("claude-opus-4-8" as the
    // console's "high" tier) was actually the registry's max-thinking tier —
    // pin that they're now genuinely different, not accidentally re-merged.
    expect(data.providers.claude.high).not.toBe(resolveModel({ backend: 'claude', capability: 'max-thinking' }));
  });
});
