// ci-gate is the only test-bearing check the `main merge queue` ruleset
// requires, so a job that runs on every PR but is missing from ci-gate's
// `needs` can go red without blocking a merge. That exact gap shipped three
// times before this test existed: relay-tests (PR #10051), rust-broker and
// rust-harbor-card (PR #10058) all ran for weeks as non-blocking decoration.
//
// This test turns the gate's needs list from a hand-maintained convention
// into a checked contract:
//   1. every `needs` entry in ci.yml resolves to a real job id (a rename or
//      deletion cannot silently leave the gate pointing at nothing — GitHub
//      would reject the workflow, but only at run time, on the PR that broke it);
//   2. every job is either in ci-gate's needs or listed below with a written
//      reason — a new job cannot be added without deciding, in code, whether
//      it gates merges;
//   3. the aggregator pattern (PR #4297) is intact: `if: always()` and a
//      sorted needs list, so a skipped path-gated job does not skip the gate
//      and additions land in a predictable slot.
import { describe, expect, test } from '@jest/globals';
import { readdirSync, readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

const workflowPath = new URL('../../.github/workflows/ci.yml', import.meta.url);
const workflowsDir = new URL('../../.github/workflows/', import.meta.url);
const workflow = parseYaml(readFileSync(workflowPath, 'utf8'));
const jobs = workflow.jobs;
const GATE = 'ci-gate';

/**
 * Jobs deliberately absent from ci-gate's needs. Each entry is a decision,
 * not an oversight: adding a job here says "this may go red without blocking
 * a merge" and the reason must hold up in review.
 */
const NOT_GATED = {
  'detect-changes':
    'path-filter producer; its outputs drive the `if:` of gated jobs, it has no verdict of its own',
  'unit-tests-compat':
    'push-only (`if: github.event_name == push`), so it never runs on a PR or merge-queue event',
  'pd-ios-screenshots':
    'documented informational visual-evidence capture; failures stay red but do not gate merges',
  'pd-ios-screenshots-publish':
    'documented informational publisher for the capture above; write-scoped and never a merge gate',
};

const needsOf = (job) => {
  const n = job.needs ?? [];
  return Array.isArray(n) ? n : [n];
};

const allWorkflows = () => readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .map((name) => [name, parseYaml(readFileSync(new URL(name, workflowsDir), 'utf8'))]);

describe('ci-gate needs contract', () => {
  test('every needs entry in every job resolves to a defined job id', () => {
    const dangling = [];
    for (const [name, job] of Object.entries(jobs)) {
      for (const dep of needsOf(job)) {
        if (!(dep in jobs)) dangling.push(`${name} -> ${dep}`);
      }
    }
    expect(dangling).toEqual([]);
  });

  test('every job is either gated by ci-gate or exempted here with a reason', () => {
    const gated = new Set(needsOf(jobs[GATE]));
    const ungated = Object.keys(jobs).filter((j) => j !== GATE && !gated.has(j));
    const unexplained = ungated.filter((j) => !(j in NOT_GATED));
    expect(unexplained).toEqual([]);
  });

  test('exemptions are live: each names a real job that is not also gated', () => {
    const gated = new Set(needsOf(jobs[GATE]));
    for (const [name, reason] of Object.entries(NOT_GATED)) {
      expect(jobs).toHaveProperty(name);
      expect(gated.has(name)).toBe(false);
      expect(reason.trim().length).toBeGreaterThan(20);
    }
  });

  test('ci-gate keeps the if: always() aggregator so skipped jobs do not skip the gate', () => {
    expect(jobs[GATE].if).toBe('always()');
  });

  test('ci-gate needs are alphabetical so additions land in a predictable slot', () => {
    const needs = needsOf(jobs[GATE]);
    expect(needs).toEqual([...needs].sort());
    expect(new Set(needs).size).toBe(needs.length);
  });

  test('the security-relevant Rust jobs are always-run AND gated', () => {
    // A TCB test that runs but cannot fail the gate is theater (the jobs'
    // own comments). Always-run means no `if:` path gate, so the gate never
    // sees a "skipped" from them.
    for (const name of ['rust-broker', 'rust-harbor-card', 'rust-kernel']) {
      expect(jobs[name].if).toBeUndefined();
      expect(needsOf(jobs[GATE])).toContain(name);
    }
  });

  test('every GitHub Actions failure remains a failure', () => {
    const masked = [];
    for (const [file, parsed] of allWorkflows()) {
      for (const [jobName, job] of Object.entries(parsed.jobs ?? {})) {
        if (job['continue-on-error'] === true) masked.push(`${file}:${jobName}`);
        for (const step of job.steps ?? []) {
          if (step['continue-on-error'] === true) {
            masked.push(`${file}:${jobName}:${step.name ?? '<unnamed step>'}`);
          }
        }
      }
    }
    expect(masked).toEqual([]);
  });

  test('verification steps do not discard command failures', () => {
    const masked = [];
    const verificationName = /\b(test|check|verify|audit|lint|proof|tape)s?\b/i;
    const discardedFailure = /\|\|\s*(?:true|:|echo\b)/;
    for (const [file, parsed] of allWorkflows()) {
      for (const [jobName, job] of Object.entries(parsed.jobs ?? {})) {
        for (const step of job.steps ?? []) {
          if (!verificationName.test(step.name ?? '') || typeof step.run !== 'string') continue;
          const executable = step.run
            .split('\n')
            .filter((line) => !line.trimStart().startsWith('#'))
            .join('\n');
          if (discardedFailure.test(executable)) {
            masked.push(`${file}:${jobName}:${step.name ?? '<unnamed step>'}`);
          }
        }
      }
    }
    expect(masked).toEqual([]);
  });

  test('artifact verifiers are read-only and check the event exact head', () => {
    const verifierFiles = [
      'harbor-research-build.yml',
      'whitepaper-build.yml',
      'whitepaper-metadata.yml',
    ];
    for (const file of verifierFiles) {
      const parsed = parseYaml(readFileSync(new URL(file, workflowsDir), 'utf8'));
      expect(parsed.permissions?.contents).toBe('read');
      expect(parsed.concurrency?.['cancel-in-progress']).toBe(true);
      for (const job of Object.values(parsed.jobs ?? {})) {
        const checkout = (job.steps ?? []).find((step) =>
          typeof step.uses === 'string' && step.uses.startsWith('actions/checkout@'));
        if (checkout) {
          expect(checkout.with?.ref).toBe('${{ github.event.pull_request.head.sha || github.sha }}');
        }
      }
    }
  });
});
