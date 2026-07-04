/**
 * tests/unit/safe-staged-guard.test.ts — ADR-0088 Phase B `--staged` guard (jest).
 * Reuses the A1 scanner against a synthesized `git diff --staged` and asserts a
 * planted staged secret is flagged (path/line/ruleId/last4 only — never the raw
 * value), while a clean diff passes.
 */

import { scanStagedDiff, parseAddedLines } from '../../lib/safe/staged-guard.js';

const HOME = '/home/test';
const AWS_KEY = 'AKIAIOSFODNN7EXAMPLE';

/** A minimal unified diff that ADDS a line to `.env`. */
function dotenvDiff(addedLine: string, file = '.env'): string {
  return [
    `diff --git a/${file} b/${file}`,
    `index e69de29..1234567 100644`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -0,0 +1 @@`,
    `+${addedLine}`,
    '',
  ].join('\n');
}

describe('parseAddedLines', () => {
  it('extracts only added lines with correct new-file line numbers', () => {
    const diff = [
      'diff --git a/f b/f',
      '--- a/f',
      '+++ b/f',
      '@@ -1,2 +1,3 @@',
      ' context',
      '-removed',
      '+added one',
      '+added two',
      '',
    ].join('\n');
    const added = parseAddedLines(diff);
    expect(added.map((a) => a.text)).toEqual(['added one', 'added two']);
    // context = line 1, added one = line 2, added two = line 3
    expect(added.map((a) => a.newLine)).toEqual([2, 3]);
    expect(added.every((a) => a.file === 'f')).toBe(true);
  });

  it('ignores the +++ file header (not treated as an added line)', () => {
    const added = parseAddedLines(dotenvDiff('FOO=bar'));
    expect(added).toHaveLength(1);
    expect(added[0].text).toBe('FOO=bar');
  });
});

describe('scanStagedDiff', () => {
  it('flags a planted staged secret with last4 only (no raw value)', () => {
    const diff = dotenvDiff(`AWS_ACCESS_KEY_ID=${AWS_KEY}`);
    const result = scanStagedDiff({ home: HOME, diff: () => diff });
    expect(result.diffAvailable).toBe(true);
    expect(result.findings.length).toBeGreaterThan(0);
    const f = result.findings.find((x) => x.ruleId.includes('aws'))!;
    expect(f).toBeDefined();
    expect(f.file).toBe('.env');
    expect(f.newLine).toBe(1);
    expect(f.last4).toBe('MPLE');
    // NO RAW VALUE anywhere in the result.
    expect(JSON.stringify(result)).not.toContain(AWS_KEY);
  });

  it('passes a clean staged diff (no secrets)', () => {
    const diff = dotenvDiff('GREETING=hello');
    const result = scanStagedDiff({ home: HOME, diff: () => diff });
    expect(result.findings).toHaveLength(0);
    expect(result.files).toEqual(['.env']);
  });

  it('reports diffAvailable=false when git could not run', () => {
    const result = scanStagedDiff({ home: HOME, diff: () => null });
    expect(result.diffAvailable).toBe(false);
    expect(result.findings).toHaveLength(0);
  });

  it('flags a secret added to a config file (gh hosts.yml shape)', () => {
    // A realistic high-entropy PAT body (the github-pat rule has an entropy
    // floor of 3, which correctly suppresses a degenerate all-`a` token).
    const diff = dotenvDiff('GITHUB_TOKEN=ghp_aB3xZ9qW7mK2pL8nR4tV6yU1cD5fH0jG7sE2', '.env.local');
    const result = scanStagedDiff({ home: HOME, diff: () => diff });
    const f = result.findings.find((x) => x.ruleId.includes('github') || x.ruleId.includes('gh'));
    expect(f).toBeDefined();
    expect(f!.file).toBe('.env.local');
  });
});
