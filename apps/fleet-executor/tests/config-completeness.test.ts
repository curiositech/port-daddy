/**
 * EVERY ShipConfig field must be reachable from pd-fleet.yml, or be listed here
 * as deliberately code-only with a reason.
 *
 * The bug this exists to catch, in its own words: `cfMapModel` was added to
 * ShipConfig, set on the built-in fallback ship, tested, documented, and
 * shipped -- and never parsed out of pd-fleet.yml. So MAP/REDUCE tiering worked
 * perfectly, for exactly the ships an operator cannot edit. Every test passed.
 * The feature was real and unreachable at the same time.
 *
 * That is the same shape as the tiering bug in map-reduce-invariants.test.ts:
 * a thing half-built, with nothing able to fail. The generalisation is that a
 * config type and a config PARSER are two lists that silently drift, and only
 * one of them is what an operator can actually use.
 *
 * So the two lists are compared. A new ShipConfig field fails this suite until
 * someone either parses it or writes down why it is code-only -- which is a
 * thirty-second decision at the time, and archaeology six months later.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseFleetShips, defaultPRShips, type ShipConfig } from '../src/fleet.js';
import { CF_ROLE_MODELS } from '../../shared/model-registry.generated.js';

/**
 * Fields NOT settable from pd-fleet.yml, each with the reason. Adding to this
 * list is allowed; adding to it silently is not.
 */
const CODE_ONLY: Record<string, string> = {
  name: 'the YAML key IS the name -- there is no field to set',
  trigger: "parsed, but as the entry's `trigger:` key rather than a ShipConfig-shaped field",
  prompt: 'parsed from `prompt:`; listed because the mapping is not name-for-name',
  role: 'derived from telos or `role:`, never set directly',
  needsExecution: 'DERIVED from allowedTools -- an operator declaring it could claim a ship is cloud-safe when it is not',
  ideation: 'derived from `class: ideation` plus the IDEATION_SHIPS identity list',
  purser: 'derived from `class: purser`',
};

/** Read fleet.ts so the parser can be checked against the type. */
function fleetSource(): string {
  return readFileSync(join(__dirname, '..', 'src', 'fleet.ts'), 'utf8');
}

describe('the config type and the config parser do not drift', () => {
  it('every ShipConfig field is either parsed from YAML or declared code-only', () => {
    // A ship built by the real parser is the ground truth for "settable":
    // anything the parser can emit shows up as a key on the object it pushes.
    const yaml = [
      'fleet:',
      '  agents:',
      '    demo-reviewer:',
      '      trigger: pull_request',
      '      prompt: review this',
      '      telos: demo',
      '      blocking: true',
      '      temperature: 0.2',
      '      map_cf_role: shipDefault',
      '      graft: [some-skill]',
      '',
    ].join('\n');
    const parsed = parseFleetShips(yaml, 'pull_request');
    expect(parsed, 'the fixture must parse, or this suite proves nothing').not.toBeNull();

    // A SECOND fixture, because some fields are only ever emitted for a purser
    // ship. One reviewer fixture cannot see them, and a field this suite cannot
    // see is a field it cannot protect -- which would make the purser's own
    // per-step model tiers the next cfMapModel: real, and reachable by nobody.
    // Both step models are pinned to an id that DIFFERS from the ship's own
    // model, so each key is actually emitted -- a pin equal to cfModel resolves
    // to "absent" by repo convention and would silently prove nothing.
    const purserYaml = [
      'fleet:',
      '  agents:',
      '    purser:',
      '      class: purser',
      '      trigger: pull_request',
      '      blockWithoutSandbox: true',
      '      testPaths: [tests/purser]',
      '      plan_cf_role: shipMid',
      '      author_cf_role: shipMid',
      '',
    ].join('\n');
    const parsedPurser = parseFleetShips(purserYaml, 'pull_request');
    expect(parsedPurser, 'the purser fixture must parse, or purser-only fields go unchecked').not.toBeNull();
    expect(
      [parsedPurser![0].cfPlanModel, parsedPurser![0].cfAuthorModel],
      'the purser fixture must actually exercise plan_cf_role/author_cf_role, or it proves nothing',
    ).toEqual([CF_ROLE_MODELS.shipMid, CF_ROLE_MODELS.shipMid]);

    // The type's field list, read from the source rather than from a value --
    // an optional field absent at runtime would otherwise vanish from the check
    // precisely when it is the one being forgotten.
    const iface = fleetSource().match(/export interface ShipConfig \{([\s\S]*?)\n\}/);
    expect(iface, 'could not locate the ShipConfig interface').not.toBeNull();
    // Indentation-agnostic: `^\s*` rather than two literal spaces. Raised in
    // review, and it is the failure mode this whole suite is about -- a regex
    // pinned to one formatting style silently matches FEWER fields after a
    // reformat, and a drift check that sees fewer fields reports less drift.
    // It would go quiet exactly when someone touched the file.
    const declared = [...iface![1].matchAll(/^\s*(\w+)\??:/gm)].map(m => m[1]);

    const settable = new Set([...Object.keys(parsed![0]), ...Object.keys(parsedPurser![0])]);

    // The extraction must account for EVERY field we already know exists --
    // both the ones the parser emits and the ones declared code-only. A count
    // floor (`> 8`) only catches total breakage; this catches the partial
    // match, which is the realistic way a regex rots.
    const known = [...settable, ...Object.keys(CODE_ONLY)];
    const missed = known.filter(f => !declared.includes(f));
    expect(
      missed,
      `The ShipConfig field extraction missed fields it should have found: ` +
        `${missed.join(', ')}. The regex has drifted from the interface's ` +
        `formatting, so this suite is now checking less than it claims to.`,
    ).toEqual([]);
    const unreachable = declared.filter(f => !settable.has(f) && !(f in CODE_ONLY));

    expect(
      unreachable,
      `These ShipConfig fields cannot be set from pd-fleet.yml. Either parse them ` +
        `in parseFleetShips, or add them to CODE_ONLY with the reason. A field ` +
        `that exists only in code works for the built-in fallback ships and for ` +
        `nobody else -- which is how cfMapModel shipped unreachable.`,
    ).toEqual([]);
  });

  it('map_cf_role actually tiers a ship declared in YAML', () => {
    // The regression itself, end to end: an operator writes map_cf_role and the
    // ship comes back tiered. Before this change the key was silently ignored.
    const yaml = [
      'fleet:',
      '  agents:',
      '    demo-reviewer:',
      '      trigger: pull_request',
      '      prompt: review this',
      '      map_cf_role: shipDefault',
      '',
    ].join('\n');
    const ship = parseFleetShips(yaml, 'pull_request')![0];
    expect(ship.cfMapModel).toBe(CF_ROLE_MODELS.shipDefault);
    expect(ship.cfMapModel).not.toBe(ship.cfModel);
  });

  it('a bogus map_cf_role runs the ship UNTIERED rather than silently mute', () => {
    // A nonexistent Workers AI id does not error -- it returns a blank the
    // parser reads as "clean". Honouring a typo would silence every chunk while
    // REDUCE reported nothing found. Untiered costs more; mute costs the truth.
    const yaml = [
      'fleet:',
      '  agents:',
      '    demo-reviewer:',
      '      trigger: pull_request',
      '      prompt: review this',
      '      map_cf_role: not-a-real-role',
      '',
    ].join('\n');
    const ship = parseFleetShips(yaml, 'pull_request')![0];
    expect(ship.cfMapModel).toBeUndefined();
  });

  it('map_cf_role cannot pin a ship ONTO the expensive model', () => {
    // Only the cheap id is in the honored set, so tiering is one-directional by
    // construction: it can save money, never spend more.
    const yaml = [
      'fleet:',
      '  agents:',
      '    demo-reviewer:',
      '      trigger: pull_request',
      '      prompt: review this',
      '      map_cf_role: reviewBot',
      '',
    ].join('\n');
    const ship = parseFleetShips(yaml, 'pull_request')![0];
    expect(ship.cfMapModel).toBeUndefined();
  });

  it('a map_cf_role equal to the ship model is dropped as a no-op', () => {
    // Otherwise `cfMapModel` would be set while changing nothing, and
    // "does this ship tier?" would stop being answerable by reading the field.
    const yaml = [
      'fleet:',
      '  agents:',
      '    demo:',
      '      trigger: pull_request',
      '      prompt: do a thing',
      '      map_cf_role: shipDefault',
      '',
    ].join('\n');
    const ship = parseFleetShips(yaml, 'pull_request')![0];
    // pd-demo is not a review bot, so its cfModel IS the ship default.
    expect(ship.cfModel).toBe(CF_ROLE_MODELS.shipDefault);
    expect(ship.cfMapModel).toBeUndefined();
  });

  it('the built-in fallback ships stay tiered too', () => {
    // The YAML path must not become the only path -- pd-fleet.yml can fail to
    // fetch, and the fallback fleet is what reviews the PR when it does.
    const tiered = defaultPRShips().filter((s: ShipConfig) => s.cfMapModel);
    expect(tiered.length).toBeGreaterThan(0);
  });
});
