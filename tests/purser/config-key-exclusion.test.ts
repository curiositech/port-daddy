import { describe, it, expect } from 'vitest';
import { parseFleetShips } from '../../apps/fleet-executor/src/fleet.js';

describe('purser config key exclusion', () => {
  const nonPurserYaml = [
    'fleet:',
    '  agents:',
    '    qa:',
    '      trigger: pull_request:opened',
    '      prompt: check it',
  ].join('\n');

  const purserYaml = [
    'fleet:',
    '  agents:',
    '    purser:',
    '      class: purser',
    '      trigger: pull_request:opened',
    '      cfPlanModel: "@cf/qwen/qwen3-30b-a3b-fp8"',
    '      cfAuthorModel: "@cf/openai/gpt-oss-20b"',
  ].join('\n');

  it('non-purser ships exclude cfPlanModel and cfAuthorModel', () => {
    const ships = parseFleetShips(nonPurserYaml, 'pull_request:opened');
    expect(ships).toBeDefined();
    const ship = ships[0];
    expect(ship.cfPlanModel).toBeUndefined();
    expect(ship.cfAuthorModel).toBeUndefined();
  });

  it('purser ships include cfPlanModel and cfAuthorModel when configured', () => {
    const ships = parseFleetShips(purserYaml, 'pull_request:opened');
    expect(ships).toBeDefined();
    const ship = ships[0];
    expect(ship.cfPlanModel).toBe('@cf/qwen/qwen3-30b-a3b-fp8');
    expect(ship.cfAuthorModel).toBe('@cf/openai/gpt-oss-20b');
  });

  it('purser ships without config keys do not have the fields', () => {
    const yaml = [
      'fleet:',
      '  agents:',
      '    purser:',
      '      class: purser',
      '      trigger: pull_request:opened',
    ].join('\n');
    const ships = parseFleetShips(yaml, 'pull_request:opened');
    expect(ships).toBeDefined();
    const ship = ships[0];
    expect(ship.cfPlanModel).toBeUndefined();
    expect(ship.cfAuthorModel).toBeUndefined();
  });

  it('non-purser ships with config keys still exclude them', () => {
    const yaml = [
      'fleet:',
      '  agents:',
      '    qa:',
      '      trigger: pull_request:opened',
      '      cfPlanModel: "@cf/qwen/qwen3-30b-a3b-fp8"',
      '      cfAuthorModel: "@cf/openai/gpt-oss-20b"',
    ].join('\n');
    const ships = parseFleetShips(yaml, 'pull_request:opened');
    expect(ships).toBeDefined();
    const ship = ships[0];
    expect(ship.cfPlanModel).toBeUndefined();
    expect(ship.cfAuthorModel).toBeUndefined();
  });
});