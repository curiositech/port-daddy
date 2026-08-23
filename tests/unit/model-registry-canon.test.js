/**
 * Canonical model registry — structural invariants.
 *
 * These assertions exist because the 2026-08-22 audit found a PHANTOM model id
 * (`@cf/moonshotai/kimi-k2-instruct`) sitting in the registry's cloudflare
 * high/max-thinking slots. On Workers AI an unknown id does not 404 — `ai.run()`
 * HANGS — so the phantom silently killed the fleet reviewer on 2026-07-03 rather
 * than failing loudly. The root cause was that a model id had to be
 * independently correct in four separately-editable places. `config/models.yaml`
 * collapses those into one, and this suite is what makes the collapse
 * load-bearing: registry ⊆ priced ⊆ catalogued-and-GA is asserted, not merely
 * intended.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { execFileSync } from 'node:child_process';

const { MODEL_REGISTRY_DATA } = await import('../../lib/model-registry-data.js');
const { allRegisteredModelIds, resolveModel, CAPABILITIES } = await import(
  '../../lib/model-registry.js'
);
const { hasExactModelRate } = await import('../../lib/cost-tracker.js');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = parseYaml(readFileSync(join(ROOT, 'config', 'models.yaml'), 'utf8'));

describe('canonical model registry', () => {
  it('every registered id has a catalog row', () => {
    const rows = new Set(Object.keys(source.models));
    const missing = allRegisteredModelIds().filter((id) => !rows.has(id));
    expect(missing).toEqual([]);
  });

  it('every registered id is priced (fail-closed telemetry admits it)', () => {
    // An unpriced id is refused at spawn admission by the telemetry policy, so
    // an unpriced registry entry is a launch failure waiting for its first use.
    const unpriced = allRegisteredModelIds().filter((id) => {
      const backend = Object.entries(MODEL_REGISTRY_DATA.backends).find(([, t]) =>
        Object.values(t).includes(id),
      )?.[0];
      return !hasExactModelRate(id, backend);
    });
    expect(unpriced).toEqual([]);
  });

  it('every registered id is GA — never deprecated or retired', () => {
    const notGa = allRegisteredModelIds().filter((id) => source.models[id].status !== 'ga');
    expect(notGa).toEqual([]);
  });

  it('every catalog row carries verification provenance', () => {
    const valid = new Set(['live-probe', 'vendor-docs', 'cf-catalog', 'carried']);
    for (const [id, row] of Object.entries(source.models)) {
      expect(`${id}:${row.verifiedBy}`).toBe(`${id}:${row.verifiedBy}`);
      expect(valid.has(row.verifiedBy)).toBe(true);
      expect(typeof row.verifiedAt).toBe('string');
      expect(row.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof row.contextWindow).toBe('number');
      expect(row.contextWindow).toBeGreaterThan(0);
    }
  });

  it('no catalog row is orphaned (nothing maps to it)', () => {
    // Two things reference a row: the capability ladder (`backends`) and the
    // cloud plane's named roles. A role-only model — the executor's mid tier,
    // the ideas-store embedding model — is referenced, not orphaned.
    const referenced = new Set([
      ...allRegisteredModelIds(),
      ...Object.values(source.cloudPlaneRoles),
    ]);
    const orphans = Object.keys(source.models).filter((id) => !referenced.has(id));
    expect(orphans).toEqual([]);
  });

  it('every cloud-plane role points at a GA, priced, workers-ai row', () => {
    // The Workers plane reaches these through env.AI and cannot import lib/, so
    // this is the only place the two planes' truth is checked against each other.
    for (const [role, id] of Object.entries(source.cloudPlaneRoles)) {
      const row = source.models[id];
      // Jest's expect takes no message argument; the role is in the failure via
      // the assertion below naming the row's own fields.
      expect(row ? `${role}:ok` : `${role} -> ${id} has no catalog row`).toBe(`${role}:ok`);
      expect(row.status).toBe('ga');
      expect(row.plane).toBe('workers-ai');
      expect(typeof row.priceIn).toBe('number');
      expect(typeof row.contextWindow).toBe('number');
    }
  });

  it('the pin allowlist cannot reach the review model', () => {
    // The operator directive this encodes: no ship can pin its way onto the most
    // expensive model. It held only by the review id being absent from a
    // hand-written set — which is the kind of rule that survives until someone
    // adds an id for an unrelated reason.
    const pinnable = source.pinnableRoles.map((r) => source.cloudPlaneRoles[r]);
    expect(pinnable).not.toContain(source.cloudPlaneRoles.reviewBot);
    expect(pinnable).not.toContain(source.cloudPlaneRoles.repairEscalation);
  });

  it('every backend resolves every capability', () => {
    for (const backend of Object.keys(MODEL_REGISTRY_DATA.backends)) {
      for (const capability of CAPABILITIES) {
        const id = resolveModel({ backend, capability });
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(0);
      }
    }
  });

  it('backend aliases resolve to their canonical family', () => {
    for (const [alias, canonical] of Object.entries(MODEL_REGISTRY_DATA.backendAliases)) {
      for (const capability of CAPABILITIES) {
        expect(resolveModel({ backend: alias, capability })).toBe(
          resolveModel({ backend: canonical, capability }),
        );
      }
    }
  });

  it('the generated artifacts are in sync with config/models.yaml', () => {
    // Hand-editing a generated artifact is the drift this whole design removes;
    // --check exits non-zero when either artifact diverges from the source.
    expect(() =>
      execFileSync('npx', ['tsx', 'scripts/generate-model-registry.ts', '--check'], {
        cwd: ROOT,
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });

  it('claude ladder is monotonically non-decreasing in price', () => {
    // The pre-supplant registry had `high` (opus-4-1) mapped to an OLDER, and in
    // one sense weaker, model than `max-thinking` (opus-4-8) while also being
    // cheaper — an incoherent ladder that made "high" ambiguous. Guard the shape.
    const price = (cap) => source.models[resolveModel({ backend: 'claude', capability: cap })].priceIn;
    expect(price('cheap')).toBeLessThanOrEqual(price('balanced'));
    expect(price('balanced')).toBeLessThanOrEqual(price('high'));
    expect(price('high')).toBeLessThanOrEqual(price('max-thinking'));
  });
});
