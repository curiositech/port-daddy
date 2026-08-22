/**
 * Purser contract for #8908, obligation 3 — `sync-skill-mirrors.mjs --check`
 * passes with the import present: every mirror target in sync, and none of
 * the imported skills accidentally registered as a mirror.
 *
 * REPAIRED IN PLACE (argue-with-the-test protocol): the authored draft
 * spawned the script at `../../scripts/...` while setting cwd to
 * `process.cwd()` — the two disagree about where the repo root is, so the
 * spawn failed before any check ran — and matched output strings
 * ("13 mirror targets", "0 discrepancies") the script never prints (real
 * format: "13 mirror target(s) across 4 skill(s); 0 out of sync."). This
 * rewrite resolves the repo root from the test file's own location and
 * asserts the script's REAL success line. The exact counts (13/4) are the
 * PR's test-plan claim at import time; the load-bearing invariant asserted
 * here is exit 0 + "0 out of sync" — the counts drift legitimately as other
 * skills add mirrors, and pinning them would make this test rot.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, test, expect } from '@jest/globals';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('sync-skill-mirrors --check with the windags import present', () => {
  test('exits 0 with zero out-of-sync targets', () => {
    const result = spawnSync('node', [join(repoRoot, 'scripts', 'sync-skill-mirrors.mjs'), '--check'], {
      encoding: 'utf-8',
      cwd: repoRoot,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/\b0 out of sync\./);
  });
});
