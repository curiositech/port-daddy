/**
 * Regression test for scripts/check-pr-requirements.mjs — the machine half of the
 * PR contract (AGENTS.md § Pull Request Operating Procedure + § Visual artifacts for
 * UI diffs). Pins the structural gate against committed fixtures: a full body passes,
 * a thin body fails naming the weak sections, and a visual-surface diff fails unless
 * it ships a screenshot + a motion artifact (or is explicitly visual-exempt).
 */
import { describe, expect, test } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const script = join(repo, 'scripts', 'check-pr-requirements.mjs');
const fixture = (name) => join(repo, 'tests', 'fixtures', 'pr-requirements', name);

/** Run the guard with explicit args; return { code, stdout, stderr }. */
function run(...args) {
  try {
    const stdout = execFileSync('node', [script, ...args], { cwd: repo, encoding: 'utf8' });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout?.toString() ?? '', stderr: e.stderr?.toString() ?? '' };
  }
}

describe('check-pr-requirements guard', () => {
  test('no PR context is a no-op (exit 0)', () => {
    const { code, stdout } = run('--changed', 'lib/relay-client.ts');
    expect(code).toBe(0);
    expect(stdout).toMatch(/no PR context/);
  });

  test('a full body with summary + test plan passes (non-visual diff)', () => {
    const { code, stdout } = run('--body-file', fixture('good-body.md'), '--changed', 'lib/relay-client.ts');
    expect(code).toBe(0);
    expect(stdout).toMatch(/meets the contract/);
  });

  test('a thin summary + checkbox-only test plan fails, naming both', () => {
    const { code, stderr } = run('--body-file', fixture('thin-body.md'), '--changed', 'lib/relay-client.ts');
    expect(code).toBe(1);
    expect(stderr).toMatch(/Summary is too thin/);
    expect(stderr).toMatch(/Test Plan is too thin/);
  });

  test('a missing summary heading fails', () => {
    const { code, stderr } = run('--body', '## Test Plan\n\nRan the whole suite and exercised every edge case I could think of here.', '--changed', 'lib/foo.ts');
    expect(code).toBe(1);
    expect(stderr).toMatch(/Missing a `## Summary`/);
  });

  test('a visual-surface diff with no artifacts fails', () => {
    const { code, stderr } = run('--body-file', fixture('visual-no-artifacts.md'), '--changed', 'fleet-config-ui/src/HealthPane.tsx');
    expect(code).toBe(1);
    expect(stderr).toMatch(/Visual surface changed/);
    expect(stderr).toMatch(/screenshot/);
    expect(stderr).toMatch(/GIF or screen recording/);
  });

  test('a visual-surface diff WITH screenshot + GIF passes', () => {
    const { code, stdout } = run('--body-file', fixture('visual-with-artifacts.md'), '--changed', 'fleet-config-ui/src/HealthPane.tsx');
    expect(code).toBe(0);
    expect(stdout).toMatch(/meets the contract/);
  });

  test('a committed image + committed gif in the diff satisfies the visual rule', () => {
    const { code } = run(
      '--body-file', fixture('visual-no-artifacts.md'),
      '--changed', 'fleet-config-ui/src/HealthPane.tsx,fleet-config-ui/docs/pane.png,fleet-config-ui/docs/pane.gif',
    );
    expect(code).toBe(0);
  });

  test('visual-exempt marker bypasses only the visual rule', () => {
    const { code, stdout } = run('--body-file', fixture('visual-exempt.md'), '--changed', 'fleet-config-ui/src/types.ts');
    expect(code).toBe(0);
    expect(stdout).toMatch(/meets the contract/);
  });

  test('pr-requirements-exempt marker skips the whole gate', () => {
    const { code, stdout } = run('--body', 'whatever <!-- pr-requirements-exempt: dependabot bump -->', '--changed', 'website-v2/src/x.tsx');
    expect(code).toBe(0);
    expect(stdout).toMatch(/skipping/);
  });
});
