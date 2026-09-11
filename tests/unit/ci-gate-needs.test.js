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
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

const workflowPath = new URL('../../.github/workflows/ci.yml', import.meta.url);
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
  'unit-tests-macos':
    'was a required context under the 18-context ruleset and lost enforcement when the ruleset ' +
    'trimmed to ci-gate; wiring it in is a separate decision about macOS runner flakiness',
  'unit-tests-compat':
    'push-only (`if: github.event_name == push`), so it never runs on a PR or merge-queue event',
  'pd-ios-screenshots':
    'documented informational: visual-evidence capture with continue-on-error, never a merge gate',
  'pd-ios-screenshots-publish':
    'documented informational: publishes the capture above; write-scoped, never a merge gate',
};

const needsOf = (job) => {
  const n = job.needs ?? [];
  return Array.isArray(n) ? n : [n];
};

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
});
