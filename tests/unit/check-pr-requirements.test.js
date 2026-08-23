/**
 * Regression test for scripts/check-pr-requirements.mjs — the machine half of the
 * PR contract (AGENTS.md § Pull Request Operating Procedure + § Visual artifacts for
 * UI diffs). Pins the structural gate against committed fixtures: a full body passes,
 * a thin body fails naming the weak sections, and a visual-surface diff fails unless
 * it ships a screenshot + a motion artifact (or is explicitly visual-exempt).
 *
 * Rule (4) — a user-visible diff must add a `changelog.d/` fragment — was added
 * later. The cases below that are ABOUT rules 1-3 therefore carry a fragment path in
 * their `--changed` list so rule (4) is satisfied for the right reason and cannot mask
 * the behaviour under test. Rule (4)'s own RED/GREEN cases live in
 * tests/unit/changelog-fragments.test.js.
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
    const { code, stdout } = run('--body-file', fixture('good-body.md'), '--changed', 'lib/relay-client.ts,changelog.d/9900-relay.md');
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
    const { code, stdout } = run('--body-file', fixture('visual-with-artifacts.md'), '--changed', 'fleet-config-ui/src/HealthPane.tsx,changelog.d/9901-health-pane.md');
    expect(code).toBe(0);
    expect(stdout).toMatch(/meets the contract/);
  });

  test('a committed image + committed gif in the diff satisfies the visual rule', () => {
    const { code } = run(
      '--body-file', fixture('visual-no-artifacts.md'),
      '--changed', 'fleet-config-ui/src/HealthPane.tsx,fleet-config-ui/docs/pane.png,fleet-config-ui/docs/pane.gif,changelog.d/9902-pane.md',
    );
    expect(code).toBe(0);
  });

  test('visual-exempt marker bypasses only the visual rule', () => {
    const { code, stdout } = run('--body-file', fixture('visual-exempt.md'), '--changed', 'fleet-config-ui/src/types.ts,changelog.d/9903-types.md');
    expect(code).toBe(0);
    expect(stdout).toMatch(/meets the contract/);
  });

  test('pr-requirements-exempt marker skips the whole gate', () => {
    const { code, stdout } = run('--body', 'whatever <!-- pr-requirements-exempt: dependabot bump -->', '--changed', 'website-v2/src/x.tsx');
    expect(code).toBe(0);
    expect(stdout).toMatch(/skipping/);
  });

  // Regression: hasMarker() used a loose substring match, so the PR template's own
  // guidance comment (which names `visual-exempt`) silently exempted EVERY PR.
  test('the PR template guidance comment does NOT auto-exempt the visual gate', () => {
    const body = [
      '## Summary',
      'A real summary that is clearly long enough to clear the floor for review.',
      '## Test Plan',
      'Ran the suite and exercised several edge cases to be sure it behaves.',
      '## Visual Proof',
      '<!--',
      '  Not a visual change? Replace this section body with exactly:',
      '  <!-- visual-exempt: <one-line reason> -->',
      '-->',
    ].join('\n');
    const { code, stderr } = run('--body', body, '--changed', 'fleet-config-ui/src/X.tsx');
    expect(code).toBe(1);
    expect(stderr).toMatch(/Visual surface changed/);
  });

  test('an exempt marker with no reason does not count', () => {
    const body = '## Summary\nLong enough summary prose to clear the floor for sure here today.\n## Test Plan\nRan everything and checked the edges carefully across many inputs here.\n<!-- visual-exempt -->';
    const { code, stderr } = run('--body', body, '--changed', 'website-v2/src/x.tsx');
    expect(code).toBe(1);
    expect(stderr).toMatch(/Visual surface changed/);
  });

  // Regression: hasMarker() matched `\S` against the RAW comment, and `\S` matched
  // the `-` of the closing `-->`. So `<!-- visual-exempt: -->` — a marker with a
  // completely empty reason — exempted the gate, defeating the "auditable, not
  // blank" property the source comment claims. The colon-less `<!-- visual-exempt -->`
  // form was already covered by the test above, which is how this one survived.
  test('an exempt marker with a colon but an EMPTY reason does not count', () => {
    const body = '## Summary\nLong enough summary prose to clear the floor for sure here today.\n## Test Plan\nRan everything and checked the edges carefully across many inputs here.\n<!-- visual-exempt: -->';
    const { code, stderr } = run('--body', body, '--changed', 'website-v2/src/x.tsx');
    expect(code).toBe(1);
    expect(stderr).toMatch(/Visual surface changed/);
  });

  test('a real reason still exempts (the fix does not break the marker)', () => {
    const body = '## Summary\nLong enough summary prose to clear the floor for sure here today.\n## Test Plan\nRan everything and checked the edges carefully across many different inputs here today.\n<!-- visual-exempt: type-only change, nothing renders differently -->';
    const { code, stdout } = run('--body', body, '--changed', 'website-v2/src/x.tsx,changelog.d/9905-x.md');
    expect(code).toBe(0);
    expect(stdout).toMatch(/meets the contract/);
  });

  test('a heading inside a fenced code block does not truncate the Test Plan', () => {
    const body = [
      '## Summary',
      'A genuine summary with plenty of words to satisfy the floor cleanly here.',
      '## Test Plan',
      '```sh',
      '# Test Plan output below',
      'npm test # 1255 passed across the whole suite here',
      '```',
      'All green; exercised the empty-input and oversize-input edges too.',
    ].join('\n');
    const { code, stdout } = run('--body', body, '--changed', 'lib/x.ts,changelog.d/9904-x.md');
    expect(code).toBe(0);
    expect(stdout).toMatch(/meets the contract/);
  });

  test('an opaque GitHub attachment link counts as a screenshot but not as motion', () => {
    const body = [
      '## Summary',
      'A real summary that is clearly long enough to clear the floor for review.',
      '## Test Plan',
      'Ran the suite and exercised several edge cases to be sure it behaves.',
      '## Visual Proof',
      '![shot](https://github.com/curiositech/port-daddy/assets/1/abc-uuid)',
    ].join('\n');
    const { code, stderr } = run('--body', body, '--changed', 'fleet-config-ui/src/X.tsx');
    expect(code).toBe(1);
    expect(stderr).toMatch(/GIF or screen recording/);
    expect(stderr).not.toMatch(/screenshot \(image\)/);
  });

  test('an .avif still does not satisfy the motion requirement', () => {
    const body = [
      '## Summary',
      'A real summary that is clearly long enough to clear the floor for review.',
      '## Test Plan',
      'Ran the suite and exercised several edge cases to be sure it behaves.',
      '## Visual Proof',
      '![shot](docs/pane.avif)',
    ].join('\n');
    const { code, stderr } = run('--body', body, '--changed', 'fleet-config-ui/src/X.tsx');
    expect(code).toBe(1);
    expect(stderr).toMatch(/GIF or screen recording/);
  });
});
