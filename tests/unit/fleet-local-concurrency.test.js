// tests/unit/fleet-local-concurrency.test.js
//
// Local-inference concurrency governor (operator directive 2026-07-06): local
// model backends (ollama/lmstudio) share one machine, so a fleet of local ships
// must not fan out unbounded and thrash the box. This locks the classifier, the
// new `max_concurrent_local_spawns` limit parse, and its presence in the shipped
// config. The permit-gating itself is threaded through createFleetRunner
// (acquireLocalPermit) and exercised by the fleet-engine suite + the semaphore
// suite (concurrency-semaphore.test.js proves the FIFO cap).

import { describe, test, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const {
  isLocalBackend,
  LOCAL_BACKENDS,
  DEFAULT_MAX_CONCURRENT_LOCAL_SPAWNS,
} = await import('../../lib/fleet-engine.js');
const { parseFleetSource, astToConfig } = await import('../../lib/fleet-ast.js');

describe('local-backend classifier', () => {
  test('ollama and lmstudio are local; cloud/CLI backends are not', () => {
    expect(isLocalBackend('ollama')).toBe(true);
    expect(isLocalBackend('lmstudio')).toBe(true);
    expect(isLocalBackend(' ollama ')).toBe(true); // trimmed
    expect(isLocalBackend('cloudflare')).toBe(false);
    expect(isLocalBackend('cli:claude-code')).toBe(false);
    expect(isLocalBackend('anthropic')).toBe(false);
    expect(isLocalBackend(null)).toBe(false);
    expect(isLocalBackend(undefined)).toBe(false);
  });

  test('LOCAL_BACKENDS is exactly the two local substrates', () => {
    expect([...LOCAL_BACKENDS].sort()).toEqual(['lmstudio', 'ollama']);
  });

  test('there is a conservative default local cap', () => {
    expect(DEFAULT_MAX_CONCURRENT_LOCAL_SPAWNS).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_MAX_CONCURRENT_LOCAL_SPAWNS).toBeLessThanOrEqual(4);
  });
});

describe('max_concurrent_local_spawns limit parse', () => {
  test('parses into limits.maxConcurrentLocalSpawns', () => {
    const src = `fleet:
  name: t
  limits:
    max_concurrent_spawns: 3
    max_concurrent_local_spawns: 2
    max_spawns_per_hour: 12
  agents:
    a:
      backend: ollama
      modelTier: low
      prompt: hi
`;
    const cfg = astToConfig(parseFleetSource(src));
    expect(cfg.limits.maxConcurrentSpawns).toBe(3);
    expect(cfg.limits.maxConcurrentLocalSpawns).toBe(2);
  });

  test('absent limit lowers to undefined (daemon applies its default)', () => {
    const src = `fleet:
  name: t
  limits:
    max_concurrent_spawns: 3
  agents:
    a:
      backend: ollama
      modelTier: low
      prompt: hi
`;
    const cfg = astToConfig(parseFleetSource(src));
    expect(cfg.limits.maxConcurrentLocalSpawns).toBeUndefined();
  });
});

describe('shipped pd-fleet.yml caps local concurrency', () => {
  test('carries a max_concurrent_local_spawns limit', () => {
    const src = readFileSync(join(import.meta.dirname, '..', '..', 'pd-fleet.yml'), 'utf-8');
    const cfg = astToConfig(parseFleetSource(src));
    expect(typeof cfg.limits.maxConcurrentLocalSpawns).toBe('number');
    expect(cfg.limits.maxConcurrentLocalSpawns).toBeGreaterThanOrEqual(1);
  });
});
