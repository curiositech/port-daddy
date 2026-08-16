import { describe, it, expect } from 'vitest';
import { parseFleetShips } from '../src/fleet.js';

describe('spelling aliases for model configuration keys', () => {
  const yamlFor = (extra: string) =>
    [
      'fleet:',
      '  agents:',
      '    purser:',
      '      class: purser',
      '      trigger: pull_request:opened',
      ...extra.split('\n').filter(Boolean).map(l => `      ${l}`),
    ].join('\n');

  const purserFrom = (extra = '') =>
    parseFleetShips(yamlFor(extra), 'pull_request:opened')!.find(s => s.name === 'purser')!;

  const CHEAP = '@cf/qwen/qwen3-30b-a3b-fp8';
  const MID = '@cf/openai/gpt-oss-20b';

  it('accepts all permitted spelling variations for plan_model', () => {
    const testCases = [
      { key: 'plan_model', value: CHEAP, expected: CHEAP },
      { key: 'planModel', value: CHEAP, expected: CHEAP },
      { key: 'cfPlanModel', value: CHEAP, expected: CHEAP },
      { key: 'plan_model', value: MID, expected: MID },
      { key: 'planModel', value: MID, expected: MID },
      { key: 'cfPlanModel', value: MID, expected: MID },
    ];

    for (const { key, value, expected } of testCases) {
      const yaml = `${key}: ${value}`;
      const ship = purserFrom(yaml);
      expect(ship.cfPlanModel).toBe(expected);
    }
  });

  it('accepts all permitted spelling variations for author_model', () => {
    const testCases = [
      { key: 'author_model', value: MID, expected: MID },
      { key: 'authorModel', value: MID, expected: MID },
      { key: 'cfAuthorModel', value: MID, expected: MID },
      { key: 'author_model', value: CHEAP, expected: CHEAP },
      { key: 'authorModel', value: CHEAP, expected: CHEAP },
      { key: 'cfAuthorModel', value: CHEAP, expected: CHEAP },
    ];

    for (const { key, value, expected } of testCases) {
      const yaml = `${key}: ${value}`;
      const ship = purserFrom(yaml);
      expect(ship.cfAuthorModel).toBe(expected);
    }
  });

  it('ignores non-purser ships for model configuration keys', () => {
    const yaml = [
      'fleet:',
      '  agents:',
      '    qa:',
      '      trigger: pull_request:opened',
      '      model: "@cf/qwen/qwen3-30b-a3b-fp8"',
    ].join('\n');

    const ships = parseFleetShips(yaml, 'pull_request:opened')!;
    expect(ships[0].cfPlanModel).toBeUndefined();
    expect(ships[0].cfAuthorModel).toBeUndefined();
  });

  it('defaults to known-good models when no configuration is provided', () => {
    const ship = purserFrom();
    expect(ship.cfPlanModel).toBe(CHEAP);
    expect(ship.cfAuthorModel).toBe(MID);
  });

  it('warns when configuration keys are empty but present', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const ship = purserFrom('plan_model: ""');
      expect(ship.cfPlanModel).toBe(CHEAP);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('plan_model is present but empty'));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('rejects invalid model IDs for configuration keys', () => {
    const ship = purserFrom('cfPlanModel: "@cf/invalid/id"');
    expect(ship.cfPlanModel).toBe(CHEAP);
  });
});