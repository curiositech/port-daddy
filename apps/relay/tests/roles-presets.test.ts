/**
 * roles/ preset validation — the six named role files at the repo root must
 * stay valid against the REAL relay parser, forever.
 *
 * Why this lives in the relay suite: roles/*.yml documents are advertised as
 * paste-ready pd-fleet.yml ship blocks, and the relay's validateFleetYaml is
 * the schema authority the control-plane exposes (POST /v1/fleet/validate).
 * If the parser's contract drifts (required fields, trigger/prompt coercion),
 * this test fails loudly instead of the catalog silently rotting — the same
 * design intent as the executor's config zero-trust: config that LOOKS usable
 * must BE usable.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateFleetYaml, parseAllShips } from '../src/fleet-parser.js';
import { SHIPWRIGHT_SYSTEM_PROMPT } from '../src/shipwright.js';

const ROLES_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../roles');

const ROLE_FILES: Record<string, string> = {
  cleanup: 'cleanup.yml',
  'adversarial-test-writing': 'adversarial-test-writing.yml',
  'doc-writing': 'doc-writing.yml',
  'unit-test-writing': 'unit-test-writing.yml',
  'readme-fixes': 'readme-fixes.yml',
  'homebrew-release-shepherd': 'homebrew-release-shepherd.yml',
};

describe('roles/ presets', () => {
  for (const [shipName, file] of Object.entries(ROLE_FILES)) {
    it(`${file} is a valid pd-fleet.yml document declaring '${shipName}'`, () => {
      const yaml = readFileSync(join(ROLES_DIR, file), 'utf8');
      const result = validateFleetYaml(yaml);
      expect(result.code).toBe('OK_VALID');
      expect(result.valid).toBe(true);

      const ships = parseAllShips(yaml);
      const ship = ships.find((s) => s.name === shipName);
      expect(ship).toBeDefined();
      // Writer roles are advisory by contract; the reviewer role too.
      expect(ship!.blocking).toBe(false);
      // Workers AI only — every preset pins a quoted @cf/ model.
      expect(ship!.cfModel.startsWith('@cf/')).toBe(true);
    });
  }

  it('the Shipwright system prompt offers all six roles by name', () => {
    for (const name of Object.keys(ROLE_FILES)) {
      expect(SHIPWRIGHT_SYSTEM_PROMPT).toContain(name);
    }
  });
});
