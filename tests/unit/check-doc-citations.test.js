/**
 * Regression test for scripts/check-doc-citations.mjs — the machine-checkable half
 * of the ship checklist's "citations are real" killer item (AGENTS.md § Pull Request
 * Operating Procedure). Runs the guard against committed fixtures so the behaviour is
 * pinned: a clean doc passes (real paths, proposal-marked fakes, placeholders, and
 * site-absolute routes all OK), a broken doc fails with the offending tokens named.
 */
import { describe, expect, test } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const script = join(repo, 'scripts', 'check-doc-citations.mjs');
const fixture = (name) => join(repo, 'tests', 'fixtures', 'doc-citations', name);

/** Run the guard on explicit files; return { code, stdout, stderr }. */
function run(...files) {
  try {
    const stdout = execFileSync('node', [script, ...files], { cwd: repo, encoding: 'utf8' });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout?.toString() ?? '', stderr: e.stderr?.toString() ?? '' };
  }
}

describe('check-doc-citations guard', () => {
  test('passes a clean doc (real paths, proposal-marked fakes, placeholders, site routes)', () => {
    const { code, stdout } = run(fixture('clean.md'));
    expect(code).toBe(0);
    expect(stdout).toMatch(/clean/);
  });

  test('fails a doc with an unresolved repo path and names the token', () => {
    const { code, stderr } = run(fixture('broken.md'));
    expect(code).toBe(1);
    expect(stderr).toMatch(/lib\/this-module-does-not-exist-xyz\.ts/);
    expect(stderr).toMatch(/repo path does not exist/);
  });

  test('fails a doc with a broken relative link', () => {
    const { code, stderr } = run(fixture('broken.md'));
    expect(code).toBe(1);
    expect(stderr).toMatch(/no-such-sibling\.md/);
    expect(stderr).toMatch(/relative link target missing/);
  });
});
