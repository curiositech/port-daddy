import { describe, expect, test } from '@jest/globals';
import { parseFleetSource } from '../../../lib/fleet-ast.js';

describe('Fleet AST removed-field enforcement', () => {
  const baseYaml = (body: string) => `
agents:
  - name: "test-agent"
${body}
`.trim();

  test.each(['skill_graft', 'skillGraft'])('rejects removed field %s', (field) => {
    expect(() => parseFleetSource(baseYaml(`    ${field}: true`)))
      .toThrow(new RegExp(`removed field "${field}"`, 'i'));
  });

  test('accepts the native jury_rig field', () => {
    expect(() => parseFleetSource(baseYaml('    jury_rig: true'))).not.toThrow();
  });

  test('accepts manifests without removed fields', () => {
    expect(() => parseFleetSource(baseYaml('    description: "A well-formed agent"'))).not.toThrow();
  });
});
