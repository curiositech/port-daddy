/**
 * ADR numbering registry contract — executable form of the purser's
 * adversarial demand on PR #7279 (its draft targeted tests/purser/, which
 * jest's testMatch never discovers, and assumed `numbers` was an array; the
 * registry's real shape is an object map — see
 * docs/adr/adr-numbering-registry.json and
 * scripts/adr-number-collision-guard.mjs).
 *
 * Pins the 0119 → 0121 renumber and the registry invariants the collision
 * guard enforces, so a regression fails here even if nobody re-runs the guard.
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

const ADR_DIR = resolve(import.meta.dirname, '..', '..', 'docs', 'adr');
const registry = JSON.parse(
  readFileSync(join(ADR_DIR, 'adr-numbering-registry.json'), 'utf8'),
);

describe('ADR numbering registry (post 0119→0121 renumber)', () => {
  test('shared-harbors wave numbers 0121–0126 are live and map to real files', () => {
    for (const num of ['0121', '0122', '0123', '0124', '0125', '0126']) {
      const file = registry.numbers[num];
      expect(typeof file).toBe('string');
      expect(existsSync(join(ADR_DIR, file))).toBe(true);
    }
    expect(registry.numbers['0121']).toBe('0121-durable-agent-roster.md');
  });

  test('0119 is held solely by the relay release-channels ADR', () => {
    expect(registry.numbers['0119']).toBe(
      '0119-relay-release-channels-and-staging-d1.md',
    );
  });

  test('the 0119 roster stub is recorded and is a real forwarding stub', () => {
    const stub = registry.stubs.find(
      (s) => s.file === '0119-durable-agent-roster.md',
    );
    expect(stub).toBeDefined();
    expect(stub.renumberedTo).toBe('0121');
    const stubBody = readFileSync(
      join(ADR_DIR, '0119-durable-agent-roster.md'),
      'utf8',
    );
    expect(stubBody).toContain('<!-- ADR-RENUMBERED-TO: 0121 -->');
    expect(stubBody).toContain('0121-durable-agent-roster.md');
  });

  test('every registry number maps to exactly one live file that exists', () => {
    for (const [num, file] of Object.entries(registry.numbers)) {
      expect(typeof file).toBe('string'); // a collision would make this an array
      expect(existsSync(join(ADR_DIR, file))).toBe(true);
      expect(file.startsWith(num)).toBe(true);
    }
  });

  test('every stub file exists and forwards to a live number', () => {
    for (const stub of registry.stubs) {
      expect(existsSync(join(ADR_DIR, stub.file))).toBe(true);
      expect(typeof registry.numbers[stub.renumberedTo]).toBe('string');
    }
  });

  test('no live ADR file on disk is missing from the registry', () => {
    const onDisk = readdirSync(ADR_DIR).filter((f) => /^\d{4}-.*\.md$/.test(f));
    const registered = new Set([
      ...Object.values(registry.numbers),
      ...registry.stubs.map((s) => s.file),
    ]);
    for (const file of onDisk) {
      expect(registered.has(file)).toBe(true);
    }
  });
});
