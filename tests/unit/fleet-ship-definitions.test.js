// tests/unit/fleet-ship-definitions.test.js
//
// Enforces the operator directive (2026-07-06): a ship NEVER pins a concrete
// model id. It declares a provider + power tier; the id is injected from the
// single ground-truth registry (lib/model-registry-data.ts). Runs the validator
// (lib/fleet-validate.ts) — the same one `pd guard` calls at commit time —
// against every shipped fleet config, and unit-tests the validator itself.
//
// Also a DRIFT GUARD: the cloud executor's Cloudflare tier→model mirror
// (apps/fleet-executor/src/models.ts) must match the registry's cloudflare rows,
// so a stale mirror can never ship a phantom Workers AI id.

import { describe, test, expect } from '@jest/globals';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');

const { fleetShipDefinitionErrors } = await import('../../lib/fleet-validate.js');

// Every fleet config that ships in the repo must be clean.
const SHIPPED_CONFIGS = [
  'pd-fleet.yml',
  'pd-fleet-personal.example.yml',
  'templates/pd-fleet-starter.yml',
];

describe('shipped fleet configs declare provider + tier, never a model id', () => {
  for (const rel of SHIPPED_CONFIGS) {
    const path = join(ROOT, rel);
    if (!existsSync(path)) continue;
    test(`${rel} has no ship-definition errors`, () => {
      const errors = fleetShipDefinitionErrors(readFileSync(path, 'utf-8'));
      if (errors.length) {
        throw new Error(
          `${rel} has ${errors.length} ship-definition error(s):\n` +
            errors.map((e) => `  [${e.rule}] ${e.ship}: ${e.message}`).join('\n'),
        );
      }
      expect(errors).toEqual([]);
    });
  }

  test('pd-fleet.yml local ships resolve to ollama + a valid tier (no model id)', () => {
    const src = readFileSync(join(ROOT, 'pd-fleet.yml'), 'utf-8');
    // A concrete `model:` key must not appear on any ship line (comments/prompt
    // bodies are prose, not a `model:` mapping key at ship/fallback indent).
    const pinned = src
      .split('\n')
      .filter((l) => /^\s{6,}model:\s+\S/.test(l) && !l.trim().startsWith('#'));
    expect(pinned).toEqual([]);
  });
});

describe('validateFleetShipDefinitions — validator behavior', () => {
  test('flags a ship that pins a concrete model id', () => {
    const yaml = `fleet:
  agents:
    bad-ship:
      backend: ollama
      model: qwen2.5-coder:7b
      prompt: hi
`;
    const errors = fleetShipDefinitionErrors(yaml);
    expect(errors.some((e) => e.rule === 'pinned-model' && e.ship === 'bad-ship')).toBe(true);
  });

  test('flags a concrete model in a fallback', () => {
    const yaml = `fleet:
  agents:
    bad-fallback:
      backend: ollama
      modelTier: low
      fallbacks:
        - backend: cloudflare
          model: '@cf/openai/gpt-oss-120b'
      prompt: hi
`;
    const errors = fleetShipDefinitionErrors(yaml);
    expect(errors.some((e) => e.rule === 'pinned-model')).toBe(true);
  });

  test('flags an invalid modelTier', () => {
    const yaml = `fleet:
  agents:
    bad-tier:
      backend: ollama
      modelTier: turbo
      prompt: hi
`;
    const errors = fleetShipDefinitionErrors(yaml);
    expect(errors.some((e) => e.rule === 'invalid-tier')).toBe(true);
  });

  test('accepts a clean provider + tier ship', () => {
    const yaml = `fleet:
  agents:
    good-ship:
      backend: ollama
      modelTier: low
      fallbacks:
        - backend: cli:claude-code
        - backend: cloudflare
          modelTier: code
      prompt: hi
`;
    expect(fleetShipDefinitionErrors(yaml)).toEqual([]);
  });

  test('flags a personal-fleet backend_preference that embeds a model id', () => {
    const yaml = `fleet:
  agents:
    personal-ship:
      backend_preference:
        - ollama/qwen2.5-coder:7b
      prompt: hi
`;
    const errors = fleetShipDefinitionErrors(yaml);
    expect(errors.some((e) => e.rule === 'pinned-model')).toBe(true);
  });
});

describe('cloud executor cloudflare tier mirror matches the registry (drift guard)', () => {
  test('every executor cloudflare tier id equals the registry cloudflare row', async () => {
    const { CLOUDFLARE_TIER_MODELS } = await import(
      '../../apps/fleet-executor/src/models.js'
    );
    const { MODEL_REGISTRY_DATA } = await import('../../lib/model-registry-data.js');
    const cf = MODEL_REGISTRY_DATA.backends.cloudflare;
    // The mirror is keyed by registry CAPABILITY names.
    for (const capability of ['cheap', 'balanced', 'high', 'max-thinking', 'code']) {
      expect(CLOUDFLARE_TIER_MODELS[capability]).toBe(cf[capability]);
    }
  });
});
