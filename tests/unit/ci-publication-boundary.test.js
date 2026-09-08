// Static workflow contracts only. No daemon, agent, cloud deployment, or token mint.
import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { decideGate } from '../../scripts/ci-gate-verdict.mjs';

const workflow = (file) => parse(readFileSync(new URL(`../../.github/workflows/${file}`, import.meta.url), 'utf8'));
const PUBLISHERS = {
  'publish.yml': ['publish'],
  'release.yml': ['build-binaries', 'build-fleetbar-preview', 'build-pd-console-app', 'build-latest-json'],
  'release-train.yml': ['cut', 'tag-and-publish'],
  'deploy-fleet-executor.yml': ['deploy'],
  'deploy-relay.yml': ['deploy'],
  'deploy-relay-prod.yml': ['deploy'],
  'deploy-relay-do-migration.yml': ['deploy'],
  'deploy-steward.yml': ['deploy'],
  'deploy-website-v2.yml': ['build-and-deploy'],
};

describe('publication requires the operator-configured environment', () => {
  test.each(Object.entries(PUBLISHERS))('%s gates every publishing job before credentials are used', (file, jobs) => {
    const wf = workflow(file);
    for (const name of jobs) expect(wf.jobs[name].environment).toBe('production');
    // New jobs must be classified instead of silently inheriting no approval.
    const expected = file === 'release.yml' ? [...jobs, 'update-homebrew'] : jobs;
    expect(Object.keys(wf.jobs).sort()).toEqual([...expected].sort());
  });

  test('ordinary PR validation does not require deployment approval', () => {
    for (const file of ['ci.yml', 'roadmap-link.yml', 'pr-requirements.yml']) {
      for (const job of Object.values(workflow(file).jobs)) expect(job.environment).toBeUndefined();
    }
  });
});

describe('PR metadata validation never requests paid reviewers', () => {
  test('the workflow has only read authority and a closed set of local commands', () => {
    const wf = workflow('pr-requirements.yml');
    expect(wf.permissions).toEqual({ contents: 'read' });
    const job = wf.jobs['pr-requirements-guard'];
    expect(job.permissions).toBeUndefined();
    expect(job.steps.filter(s => s.run).map(s => s.run)).toEqual([
      'git fetch --no-tags origin main:refs/remotes/origin/main',
      'node scripts/check-pr-requirements.mjs --event-path "$GITHUB_EVENT_PATH"',
    ]);
    expect(job.steps.filter(s => s.uses).map(s => s.uses)).toEqual([
      'actions/checkout@v4', 'actions/setup-node@v4',
    ]);
    expect(wf.on.pull_request.types).toContain('edited');
    expect(wf.on).toHaveProperty('merge_group');
  });
});

describe('macOS verdict reaches the aggregate', () => {
  test.each(['failure', 'cancelled'])('%s fails the current-head aggregate', result => {
    const wf = workflow('ci.yml');
    const needs = Object.fromEntries(wf.jobs['ci-gate'].needs.map(name => [name, { result: 'success' }]));
    expect(needs).toHaveProperty('unit-tests-macos');
    needs['unit-tests-macos'].result = result;
    const verdict = decideGate(needs, false);
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain('unit-tests-macos');
  });
});
