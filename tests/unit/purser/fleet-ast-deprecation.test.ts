// tests/unit/purser/fleet-ast-deprecation.test.ts
import { describe, test, expect } from '@jest/globals';
import { parseFleet } from '../../../lib/fleet-ast.js';

/**
 * The Port Daddy cut‑over replaces the old WinDAGs runtime.
 * As part of that migration the fleet manifest keys `skill_graft` and `skillGraft`
 * were removed in favour of the new `jury_rig` flag.
 *
 * This test suite guarantees that any fleet YAML still using the deprecated keys
 * is rejected **closed** (i.e. throws) during AST parsing, satisfying the
 * contract’s “fail‑closed” requirement.
 */
describe('Fleet AST deprecation enforcement', () => {
  const baseYaml = (body: string) => `
agents:
  - name: "test-agent"
${body}
`.trim();

  test('throws when using deprecated `skill_graft` key', () => {
    const yaml = baseYaml('    skill_graft: true');
    expect(() => parseFleet(yaml)).toThrow(
      /removed field "skill_graft"/i,
    );
  });

  test('throws when using deprecated `skillGraft` key (camelCase)', () => {
    const yaml = baseYaml('    skillGraft: true');
    expect(() => parseFleet(yaml)).toThrow(
      /removed field "skillGraft"/i,
    );
  });

  test('parses successfully when using the new `jury_rig` key', () => {
    const yaml = baseYaml('    jury_rig: true');
    expect(() => parseFleet(yaml)).not.toThrow();
  });

  test('parses successfully when the deprecated keys are absent', () => {
    const yaml = baseYaml('    description: "A well‑formed agent without deprecated fields"');
    expect(() => parseFleet(yaml)).not.toThrow();
  });
});