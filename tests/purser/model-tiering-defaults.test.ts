import { describe, it, expect, vi } from 'vitest';
import { parseFleetShips, type ShipConfig } from '../../apps/fleet-executor/src/fleet.js';
import { derivePurserPlanModel, derivePurserAuthorModel } from '../../apps/fleet-executor/src/purser.ts';

function yamlFor(extra: string) {
  return [
    'fleet:',
    '  agents:',
    '    purser:',
    '      class: purser',
    '      trigger: pull_request:opened',
    ...extra.split('\n').filter(Boolean).map(l => `      ${l}`),
  ].join('\n');
}

function purserFrom(extra = '') {
  const ships = parseFleetShips(yamlFor(extra), 'pull_request:opened')!;
  return ships.find(s => s.name === 'purser')!;
}

describe('default model selection for purser steps', () => {
  const CHEAP = '@cf/qwen/qwen3-30b-a3b-fp8';
  const MID = '@cf/openai/gpt-oss-20b';

  it('defaults PLAN to the cheap model', () => {
    const ship = purserFrom();
    expect(derivePurserPlanModel(ship, ship.cfModel)).toBe(CHEAP);
  });

  it('defaults AUTHOR to the mid tier', () => {
    const ship = purserFrom();
    expect(derivePurserAuthorModel(ship, ship.cfModel)).toBe(MID);
  });

  it('does not include step-model keys in non-purser ships', () => {
    const ships = parseFleetShips(
      ['fleet:', '  agents:', '    qa:', '      trigger: pull_request:opened', '      prompt: check it'].join('\n'),
      'pull_request:opened',
    )!;
    expect(ships[0].cfPlanModel).toBeUndefined();
    expect(ships[0].cfAuthorModel).toBeUndefined();
  });

  it('respects repo convention: absent keys mean "same as cfModel"', () => {
    const ship = purserFrom();
    expect(ship.cfPlanModel).toBeUndefined();
    expect(ship.cfAuthorModel).toBeUndefined();
  });

  it('handles empty configuration values gracefully', () => {
    const ship = purserFrom("plan_model: ''\nauthor_model: ''");
    expect(derivePurserPlanModel(ship, ship.cfModel)).toBe(CHEAP);
    expect(derivePurserAuthorModel(ship, ship.cfModel)).toBe(MID);
  });

  it('prevents pinning to review bot model', () => {
    const ship = purserFrom("author_model: '@cf/openai/gpt-oss-120b'");
    expect(derivePurserAuthorModel(ship, ship.cfModel)).toBe(MID);
  });
});