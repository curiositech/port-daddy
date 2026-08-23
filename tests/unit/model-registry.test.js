// tests/unit/model-registry.test.js
//
// The declarative model registry (ADR-0057): code declares (backend, capability)
// and resolveModel() splices the concrete ID from lib/model-registry-data.ts.

import { describe, test, expect } from '@jest/globals';

const {
  resolveModel,
  capabilityForTier,
  CAPABILITIES,
  DEFAULT_CAPABILITY,
  registryProvenance,
  allRegisteredModelIds,
} = await import('../../lib/model-registry.js');

describe('resolveModel — declarative (backend, capability) → concrete id', () => {
  test('maps a backend + capability to a concrete id', () => {
    expect(resolveModel({ backend: 'anthropic', capability: 'cheap' })).toBe('claude-haiku-4-5');
    expect(resolveModel({ backend: 'openai', capability: 'high' })).toBe('gpt-5.5');
  });

  test('legacy model_tier (low/mid/high) maps through to a capability', () => {
    expect(resolveModel({ backend: 'anthropic', tier: 'low' })).toBe(resolveModel({ backend: 'anthropic', capability: 'cheap' }));
    expect(resolveModel({ backend: 'codex', tier: 'high' })).toBe('gpt-5.4');
  });

  test('a real explicit operator override wins over the registry', () => {
    expect(resolveModel({ backend: 'anthropic', capability: 'cheap', explicit: 'claude-opus-4-8' })).toBe('claude-opus-4-8');
  });

  test('a backend-name placeholder is NOT treated as an explicit model', () => {
    // 'claude-code' is the bare backend name leaking in as a model — ignore it,
    // fall through to the registry default.
    expect(resolveModel({ backend: 'anthropic', capability: 'cheap', explicit: 'claude-code' }))
      .toBe('claude-haiku-4-5');
  });

  test('defaults to the cheap capability when none is given', () => {
    expect(DEFAULT_CAPABILITY).toBe('cheap');
    expect(resolveModel({ backend: 'gemini' })).toBe(resolveModel({ backend: 'gemini', capability: 'cheap' }));
  });

  test('fails LOUDLY on an unknown backend (never silently guesses a model)', () => {
    expect(() => resolveModel({ backend: 'totally-unknown-backend' })).toThrow(/no backend/i);
  });

  test('every backend resolves every capability to a non-empty id', () => {
    const backends = ['anthropic', 'claude', 'claude-cli', 'openai', 'codex', 'cloudflare', 'gemini', 'groq', 'aider'];
    for (const backend of backends) {
      for (const capability of CAPABILITIES) {
        const id = resolveModel({ backend, capability });
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('capabilityForTier', () => {
  test('low/mid/high alias to cheap/balanced/high', () => {
    expect(capabilityForTier('low')).toBe('cheap');
    expect(capabilityForTier('mid')).toBe('balanced');
    expect(capabilityForTier('high')).toBe('high');
  });
  test('unknown/empty tier falls back to the default capability', () => {
    expect(capabilityForTier(undefined)).toBe(DEFAULT_CAPABILITY);
    expect(capabilityForTier('bogus')).toBe(DEFAULT_CAPABILITY);
  });
});

describe('registry data integrity', () => {
  test('provenance is stamped (so a stale registry is visible)', () => {
    const p = registryProvenance();
    expect(p.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(p.source.length).toBeGreaterThan(0);
  });

  test('the cheap tier still equals the operator defaults (no telemetry drift)', () => {
    // These must stay cost-priced; the backend-telemetry-policy fail-closed gate
    // depends on it. Sentinel against an accidental registry edit that breaks launches.
    expect(resolveModel({ backend: 'claude', capability: 'cheap' })).toBe('claude-haiku-4-5');
    expect(resolveModel({ backend: 'codex', capability: 'cheap' })).toBe('gpt-5.4-mini');
    expect(resolveModel({ backend: 'cloudflare', capability: 'cheap' })).toBe('@cf/zai-org/glm-4.7-flash');
  });

  test('allRegisteredModelIds returns the de-duped id set', () => {
    const ids = allRegisteredModelIds();
    expect(ids).toContain('claude-haiku-4-5');
    // Bare `gpt-5` was superseded by the live-verified gpt-5.4/5.5 ladder in the
    // 2026-08-23 canonical-registry supplant; assert a currently-mapped id.
    expect(ids).toContain('gpt-5.5');
    expect(new Set(ids).size).toBe(ids.length);
  });
});
