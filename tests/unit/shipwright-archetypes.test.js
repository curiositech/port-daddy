// Shipwright Archetype Catalog — verifies the closed catalog (12 entries),
// per-archetype rank predicates, and getArchetype lookup behavior.

import { jest } from '@jest/globals';

const { listArchetypes, getArchetype, rankArchetypes } = await import('../../lib/shipwright/archetypes.js');

const baseSignals = {
  hasTests: false,
  testsPassing: null,
  ciRed: false,
  testSuites: 0,
  hasFleet: false,
  hasReadme: false,
  hasClaudeMd: false,
  hasManifest: false,
  hasSentry: false,
  hasGithubActions: false,
  hasPlaywright: false,
  activity: 'cool',
  commitsLast30d: 0,
  kind: 'lib',
  frameworks: [],
  strictTs: false,
  docDrift: false,
  perfHotPaths: false,
};

test('exactly 12 archetypes ship in the catalog', () => {
  expect(listArchetypes()).toHaveLength(12);
});

test('every archetype has the required fields populated', () => {
  for (const a of listArchetypes()) {
    expect(a.id).toMatch(/^[a-z][a-z0-9-]*$/);
    expect(a.name).toBeTruthy();
    expect(a.purpose).toBeTruthy();
    expect(a.defaultTrigger.kind).toBeTruthy();
    expect(['low', 'mid', 'high']).toContain(a.defaultModelTier);
    expect(a.defaultBondUsd).toBeGreaterThan(0);
    expect(a.defaultBudgetUsdPerDay).toBeGreaterThan(0);
    expect(a.skillQuery).toBeTruthy();
    expect(a.promptTemplate).toContain('{project}');
    expect(typeof a.select).toBe('function');
  }
});

test('archetype IDs are unique', () => {
  const ids = listArchetypes().map((a) => a.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test('getArchetype returns the catalog entry for a known id', () => {
  const a = getArchetype('qa-sentinel');
  expect(a.name).toBe('QA Sentinel');
  expect(a.defaultTrigger.kind).toBe('git-pr');
});

test('getArchetype throws for an unknown id', () => {
  expect(() => getArchetype('nonexistent-archetype')).toThrow(/Unknown archetype/);
});

test('rankArchetypes returns descending non-zero scores', () => {
  const ranked = rankArchetypes({
    ...baseSignals,
    hasTests: true,
    testsPassing: true,
    testSuites: 50,
    hasReadme: true,
    hasClaudeMd: true,
    hasManifest: true,
    hasGithubActions: true,
    activity: 'hot',
    commitsLast30d: 80,
    kind: 'server-daemon',
    frameworks: ['typescript', 'fastify'],
    strictTs: true,
    docDrift: true,
  });
  expect(ranked.length).toBeGreaterThan(0);
  for (const entry of ranked) {
    expect(entry.score).toBeGreaterThan(0);
  }
  for (let i = 1; i < ranked.length; i++) {
    expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score);
  }
});

test('rankArchetypes for a busy TS daemon includes qa-sentinel + documentarian + typesafety-sweeper', () => {
  const ranked = rankArchetypes({
    ...baseSignals,
    hasTests: true,
    testsPassing: true,
    testSuites: 50,
    hasReadme: true,
    hasClaudeMd: true,
    hasManifest: true,
    hasGithubActions: true,
    activity: 'hot',
    commitsLast30d: 80,
    kind: 'server-daemon',
    frameworks: ['typescript', 'fastify'],
    strictTs: true,
    docDrift: true,
  });
  const ids = ranked.map((r) => r.archetype.id);
  expect(ids).toContain('qa-sentinel');
  expect(ids).toContain('documentarian');
  expect(ids).toContain('typesafety-sweeper');
});

test('rankArchetypes for an inactive lib drops most archetypes', () => {
  const ranked = rankArchetypes({
    ...baseSignals,
    activity: 'cold',
    commitsLast30d: 1,
    kind: 'lib',
  });
  // Cold lib with no tests and no infra should match very few — gardener
  // and simplifier require commits>=5 and >=10 respectively, research-scout
  // skips on cold, so the set is essentially empty.
  expect(ranked.length).toBeLessThanOrEqual(1);
});

test('sentry-responder fires only when hasSentry is true', () => {
  const without = rankArchetypes({ ...baseSignals, hasTests: true, testSuites: 5, hasGithubActions: true });
  const with_ = rankArchetypes({ ...baseSignals, hasTests: true, testSuites: 5, hasGithubActions: true, hasSentry: true });
  expect(without.find((r) => r.archetype.id === 'sentry-responder')).toBeUndefined();
  expect(with_.find((r) => r.archetype.id === 'sentry-responder')).toBeDefined();
});

test('browser-canary appears for sites and projects with playwright', () => {
  const site = rankArchetypes({ ...baseSignals, kind: 'site', activity: 'warm' });
  const playwright = rankArchetypes({ ...baseSignals, kind: 'lib', hasPlaywright: true, activity: 'warm' });
  const neither = rankArchetypes({ ...baseSignals, kind: 'lib', activity: 'warm' });

  expect(site.find((r) => r.archetype.id === 'browser-canary')).toBeDefined();
  expect(playwright.find((r) => r.archetype.id === 'browser-canary')).toBeDefined();
  expect(neither.find((r) => r.archetype.id === 'browser-canary')).toBeUndefined();
});

test('spark requires high commit volume', () => {
  const lowVolume = rankArchetypes({ ...baseSignals, commitsLast30d: 10, activity: 'warm' });
  const highVolume = rankArchetypes({ ...baseSignals, commitsLast30d: 80, activity: 'hot' });

  expect(lowVolume.find((r) => r.archetype.id === 'spark')).toBeUndefined();
  expect(highVolume.find((r) => r.archetype.id === 'spark')).toBeDefined();
});

test('typesafety-sweeper requires a TypeScript-adjacent framework', () => {
  const tsProject = rankArchetypes({
    ...baseSignals,
    frameworks: ['typescript', 'react'],
    strictTs: true,
  });
  const pyProject = rankArchetypes({
    ...baseSignals,
    frameworks: ['flask', 'celery'],
  });
  expect(tsProject.find((r) => r.archetype.id === 'typesafety-sweeper')).toBeDefined();
  expect(pyProject.find((r) => r.archetype.id === 'typesafety-sweeper')).toBeUndefined();
});
