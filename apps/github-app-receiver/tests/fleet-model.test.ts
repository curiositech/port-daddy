import { describe, expect, it } from 'vitest';
import { resolveCfModel } from '../src/fleet';
import { CF_ROLE_MODELS, CF_ADMITTED_MODELS } from '../../shared/model-registry.generated.js';

// An unknown Workers AI id does not fail fast — ai.run() hangs, the waitUntil
// budget dies, and the check run sticks in_progress forever (the 2026-07-03
// outage). resolveCfModel is the gate that makes that class of outage
// impossible.
//
// This suite used to name ids directly, and it had the incident BACKWARDS: it
// asserted that `@cf/moonshotai/kimi-k2-instruct` — the id Cloudflare had
// stopped serving, and the one actually sitting in the receiver's allowlist —
// passed through, while calling its live successor `kimi-k2.7-code` the
// phantom. A test written against remembered ids can certify the exact bug it
// was written to prevent. Assertions are against the registry now.
describe('resolveCfModel', () => {
  it('passes through every id the registry knows to be served', () => {
    for (const id of CF_ADMITTED_MODELS) {
      expect(resolveCfModel(id, 'senior-dev')).toBe(id);
    }
  });

  it('remaps an id the registry does not know, rather than dispatching it', () => {
    // The tombstone: the id whose absence hung the fleet.
    expect(resolveCfModel('@cf/moonshotai/kimi-k2-instruct', 'spark')).toBe(
      CF_ROLE_MODELS.shipDefault,
    );
    expect(resolveCfModel('@cf/typo/not-a-real-model', 'spark')).toBe(CF_ROLE_MODELS.shipDefault);
    // A reviewer falls back to its own role, not the general default.
    expect(resolveCfModel('@cf/typo/not-a-real-model', 'code-reviewer')).toBe(
      CF_ROLE_MODELS.reviewBot,
    );
  });

  it('falls back per ship class when no model is declared', () => {
    expect(resolveCfModel(null, 'code-reviewer')).toBe(CF_ROLE_MODELS.reviewBot);
    expect(resolveCfModel(undefined, 'documentarian')).toBe(CF_ROLE_MODELS.shipDefault);
  });
});
