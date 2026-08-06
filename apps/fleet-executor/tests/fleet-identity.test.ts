/**
 * Authorship classification — the guard that decides whether a PR is the
 * fleet's own work.
 *
 * The adversarial case these tests exist for: a HUMAN opening a PR from a
 * branch named `purser/pr-1-tests` must never inherit machine trust, because
 * the branch name is the one input an attacker fully controls.
 */
import { describe, it, expect } from 'vitest';
import { classifyPrAuthorship, FLEET_BRANCH_PREFIXES } from '../src/fleet-identity.js';

const APP = 'port-daddy[bot]';

describe('classifyPrAuthorship — the strong signal', () => {
  it('recognizes the fleet App as fleet-authored', () => {
    const r = classifyPrAuthorship({
      authorLogin: APP,
      authorType: 'Bot',
      headRef: 'purser/pr-4763-tests',
      fleetAppLogin: APP,
    });
    expect(r.fleetAuthored).toBe(true);
    expect(r.signal).toBe('app-identity');
    expect(r.branchMatches).toBe(true);
  });

  it('matches the App login case-insensitively', () => {
    const r = classifyPrAuthorship({
      authorLogin: 'Port-Daddy[Bot]',
      authorType: 'Bot',
      headRef: 'fleet/qa-pr-9-fix',
      fleetAppLogin: APP,
    });
    expect(r.signal).toBe('app-identity');
  });

  it('recognizes the App even on a non-fleet branch name', () => {
    const r = classifyPrAuthorship({
      authorLogin: APP,
      authorType: 'Bot',
      headRef: 'some/other-branch',
      fleetAppLogin: APP,
    });
    expect(r.fleetAuthored).toBe(true);
    expect(r.signal).toBe('app-identity');
    expect(r.branchMatches).toBe(false);
  });
});

describe('classifyPrAuthorship — a branch name is never enough', () => {
  it('REFUSES a human on a `purser/` branch', () => {
    const r = classifyPrAuthorship({
      authorLogin: 'mallory',
      authorType: 'User',
      headRef: 'purser/pr-1-tests',
      fleetAppLogin: APP,
    });
    expect(r.fleetAuthored).toBe(false);
    expect(r.signal).toBe('none');
    expect(r.reason).toContain('not the fleet');
  });

  it('REFUSES a human on a `purser/` branch even when the App login is unknown', () => {
    const r = classifyPrAuthorship({
      authorLogin: 'mallory',
      authorType: 'User',
      headRef: 'purser/pr-1-tests',
      fleetAppLogin: null,
    });
    expect(r.fleetAuthored).toBe(false);
  });

  it('REFUSES a DIFFERENT bot on a fleet-prefixed branch when the App is known', () => {
    const r = classifyPrAuthorship({
      authorLogin: 'dependabot[bot]',
      authorType: 'Bot',
      headRef: 'fleet/whatever',
      fleetAppLogin: APP,
    });
    expect(r.fleetAuthored).toBe(false);
    expect(r.reason).toContain('not this fleet');
  });
});

describe('classifyPrAuthorship — the weak signal is labelled weak', () => {
  it('accepts bot + fleet branch when the App login is unresolvable, but marks it weak', () => {
    const r = classifyPrAuthorship({
      authorLogin: 'port-daddy[bot]',
      authorType: 'Bot',
      headRef: 'purser/pr-4763-tests',
      fleetAppLogin: null,
    });
    expect(r.fleetAuthored).toBe(true);
    expect(r.signal).toBe('bot-and-branch');
    expect(r.reason).toContain('WEAK');
  });

  it('refuses a bot on a non-fleet branch when the App login is unresolvable', () => {
    const r = classifyPrAuthorship({
      authorLogin: 'some[bot]',
      authorType: 'Bot',
      headRef: 'feature/x',
      fleetAppLogin: null,
    });
    expect(r.fleetAuthored).toBe(false);
  });
});

describe('classifyPrAuthorship — missing data is not fleet-authored', () => {
  it.each([
    ['no author at all', { authorLogin: null, authorType: null, headRef: 'purser/x' }],
    ['empty type', { authorLogin: APP, authorType: '', headRef: 'purser/x' }],
    ['undefined head ref', { authorLogin: 'x[bot]', authorType: 'Bot', headRef: undefined }],
  ])('%s ⇒ not fleet-authored', (_label, input) => {
    const r = classifyPrAuthorship({ ...input, fleetAppLogin: null });
    expect(r.fleetAuthored).toBe(false);
  });
});

describe('FLEET_BRANCH_PREFIXES', () => {
  it('covers exactly the prefixes the fleet itself creates', () => {
    // purser/pr-<n>-tests (src/purser.ts) and fleet/<ship>-... (src/execute.ts).
    expect([...FLEET_BRANCH_PREFIXES]).toEqual(['purser/', 'fleet/']);
  });
});
