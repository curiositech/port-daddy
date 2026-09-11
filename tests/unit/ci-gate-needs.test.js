// ci-gate summarizes only the CI jobs explicitly named by the live
// `main merge queue` ruleset. New jobs are advisory unless the operator changes
// that ruleset; merely adding a job to ci.yml must not silently create a new
// merge blocker.
import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

const workflowPath = new URL('../../.github/workflows/ci.yml', import.meta.url);
const workflow = parseYaml(readFileSync(workflowPath, 'utf8'));
const jobs = workflow.jobs;
const GATE = 'ci-gate';
const REQUIRED_CI_JOBS = [
  'brand-color-guard',
  'compiled-daemon-smoke',
  'doc-citation-guard',
  'fleet-ui',
  'fleetbar',
  'integration-tests',
  'lint',
  'rust-console',
  'rust-console-gpui',
  'rust-kernel',
  'skill-hygiene',
  'unit-tests',
  'version-drift-guard',
  'website-terminal-recordings',
];

const needsOf = (job) => {
  const needs = job.needs ?? [];
  return Array.isArray(needs) ? needs : [needs];
};

describe('ci-gate required-context contract', () => {
  test('every dependency in every job resolves to a defined job id', () => {
    const dangling = [];
    for (const [name, job] of Object.entries(jobs)) {
      for (const dependency of needsOf(job)) {
        if (!(dependency in jobs)) dangling.push(`${name} -> ${dependency}`);
      }
    }
    expect(dangling).toEqual([]);
  });

  test('ci-gate contains exactly the operator-configured required CI jobs', () => {
    expect(needsOf(jobs[GATE])).toEqual(REQUIRED_CI_JOBS);
  });

  test('advisory jobs cannot become blockers merely by existing', () => {
    const gated = new Set(needsOf(jobs[GATE]));
    for (const advisory of [
      'changelog-guard', 'fleet-executor-tests', 'mcp-catalog-guard', 'pd-ios',
      'porthole-cast-gate', 'porthole-stage', 'relay-tests', 'rust-broker',
      'rust-harbor-card', 'steward-tests',
    ]) expect(gated.has(advisory)).toBe(false);
  });

  test('ci-gate always reports even when a required path-gated job skips', () => {
    expect(jobs[GATE].if).toBe('always()');
  });
});
