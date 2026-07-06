// tests/unit/pd-fleet-local-ollama.test.js
//
// Locks the 2026-07-06 local/cloud fleet split into the SHIPPED pd-fleet.yml.
//
// Operator directive: "Its local fleet should really only run small local
// ollama models." So the on-machine bookkeeping / lint / pattern ships must
// lead with a free local Ollama model and carry NO metered cloud rung, while
// the judgment/reviewer ships keep the capable ladder. This guard fails if a
// local ship regresses back to a paid backend, or a cloud ship is accidentally
// demoted to a 7B local model.
//
// It parses the REAL pd-fleet.yml (not a template) both with the yaml literal
// reader (structure assertions) and with the daemon's own parser (accept guard).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { parse as parseYaml } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FLEET_PATH = join(ROOT, 'pd-fleet.yml');
const SOURCE = readFileSync(FLEET_PATH, 'utf-8');

const { parseFleetSource } = await import('../../lib/fleet-ast.js');

// The on-machine ships that must run local models only.
const LOCAL_SHIPS = [
  'gardener',
  'test-hunter',
  'documentarian',
  'simplifier',
  'cartographer',
  'tautology-sniffer',
  'officer-of-the-watch',
  'developer-onboarding-sentinel',
];

// Judgment/reviewer/ideation ships that must keep a capable (non-ollama) ladder.
const CLOUD_SHIPS = ['qa', 'spark', 'spider', 'code-reviewer', 'red-team', 'steward'];

// Backends that cost metered money — forbidden anywhere on a local ship.
const METERED_BACKENDS = ['cloudflare', 'openai', 'anthropic', 'groq', 'xai', 'gemini'];

// Find a ship's config block wherever it lives (agents: or watchers:).
function findShip(doc, name) {
  const fleet = doc.fleet ?? {};
  for (const section of [fleet.agents, fleet.watchers]) {
    if (section && typeof section === 'object' && section[name]) return section[name];
    if (Array.isArray(section)) {
      const hit = section.find((s) => s && s.name === name);
      if (hit) return hit;
    }
  }
  return undefined;
}

function fallbackBackends(ship) {
  return (ship.fallbacks ?? []).map((f) => (typeof f === 'string' ? f : f.backend));
}

describe('pd-fleet.yml local fleet runs local Ollama models only', () => {
  const doc = parseYaml(SOURCE);

  it('parses with the real daemon parser (no throw)', () => {
    const ast = parseFleetSource(SOURCE);
    expect(ast).not.toBeNull();
    expect(ast.name?.value).toBe('port-daddy');
  });

  for (const name of LOCAL_SHIPS) {
    describe(`local ship: ${name}`, () => {
      const ship = findShip(doc, name);

      it('exists in the shipped fleet', () => {
        expect(ship).toBeDefined();
      });

      it('leads with a local Ollama model (backend: ollama + explicit model)', () => {
        expect(ship.backend).toBe('ollama');
        // Explicit model required — the `local` tier has no defensible default.
        expect(typeof ship.model).toBe('string');
        expect(ship.model.length).toBeGreaterThan(0);
      });

      it('keeps a CLI safety-net fallback (fails loud, never silent)', () => {
        const fbs = fallbackBackends(ship);
        expect(fbs.length).toBeGreaterThanOrEqual(1);
        expect(fbs.some((b) => b === 'cli:claude-code' || b === 'cli:codex')).toBe(true);
      });

      it('carries NO metered cloud rung (primary or fallback)', () => {
        const all = [ship.backend, ...fallbackBackends(ship)];
        for (const b of all) {
          expect(METERED_BACKENDS).not.toContain(b);
        }
      });
    });
  }

  for (const name of CLOUD_SHIPS) {
    it(`cloud/judgment ship keeps a capable non-ollama ladder: ${name}`, () => {
      const ship = findShip(doc, name);
      expect(ship).toBeDefined();
      // A reviewer/ideator must not be demoted to a 7B local model.
      expect(ship.backend).not.toBe('ollama');
      const fbs = fallbackBackends(ship);
      expect(fbs.every((b) => b === 'ollama')).toBe(false);
    });
  }
});
