// Producer test for scripts/check-formula-compat.mjs — the repo-side half of
// the tap formula's self-verifying tarball gate. The formula odies at install
// time when the tarball's top-level entries don't hash to its pinned manifest;
// this preflight fails the RELEASE when the layout release.yml is about to tar
// wouldn't be accepted. Regression guard for the post-v3.27.0 window where the
// tar list drifted (bin/ + hooks/ added) and every release cut from main would
// have shipped a brew-rejected tarball.
import { describe, test, expect } from '@jest/globals';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

const SCRIPT = resolve('scripts/check-formula-compat.mjs');

const SINGLE_ENTRIES = ['pd', 'port-daddy', 'port-daddy-manifest.json', 'native', 'bin', 'hooks', 'skills', 'agents'];
const LEGACY_ENTRIES = ['pd', 'port-daddy', 'port-daddy-manifest.json', 'pd-bosun', 'native', 'pd-hook-prompt', 'pd-hook-pre-tool', 'pd-hook-post-tool'];

function hashOf(entries) {
  return createHash('sha256').update([...entries].sort().join(',')).digest('hex');
}

// Mirrors the real formula's gate shape (curiositech/homebrew-tap
// Formula/port-daddy.rb) closely enough to exercise the parser.
const FIXTURE_FORMULA = `
class PortDaddy < Formula
  def install
    legacy_tarball_manifest_sha256 =
      "${hashOf(LEGACY_ENTRIES)}"
    single_supervisor_manifest_sha256 =
      "${hashOf(SINGLE_ENTRIES)}"
    known_tarball_manifest_sha256 = if version >= Version.new("3.28.0")
      single_supervisor_manifest_sha256
    else
      legacy_tarball_manifest_sha256
    end
  end
end
`;

function run(version, entries, formulaBody = FIXTURE_FORMULA) {
  const dir = mkdtempSync(join(tmpdir(), 'pd-formula-compat-'));
  try {
    const formulaPath = join(dir, 'port-daddy.rb');
    writeFileSync(formulaPath, formulaBody);
    return spawnSync('node', [SCRIPT, '--version', version, '--entries', entries.join(' '), '--formula-file', formulaPath], {
      encoding: 'utf8',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('check-formula-compat', () => {
  test('3.28.0 with the single-supervisor layout → OK', () => {
    const r = run('v3.28.0', SINGLE_ENTRIES);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('single_supervisor');
    expect(r.stdout).toContain('OK');
  });

  test('pre-cutover version with the legacy layout → OK', () => {
    const r = run('3.27.1', LEGACY_ENTRIES);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('legacy');
  });

  test('3.28.0 with the drifted post-v3.27.0 main layout → MISMATCH, exit 1', () => {
    const drifted = [...LEGACY_ENTRIES, 'bin', 'hooks'];
    const r = run('v3.28.0', drifted);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('MISMATCH');
    expect(r.stderr).toContain('REJECTED');
  });

  test('pre-cutover version with the new layout → MISMATCH (the tap would reject a back-port)', () => {
    const r = run('3.27.2', SINGLE_ENTRIES);
    expect(r.status).toBe(1);
  });

  test('prerelease tags resolve to their base version branch', () => {
    const r = run('v3.28.0-rc.1', SINGLE_ENTRIES);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('single_supervisor');
  });

  test('a formula without the gate variables fails LOUD, not green', () => {
    const r = run('3.28.0', SINGLE_ENTRIES, 'class PortDaddy < Formula\nend\n');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('no *_manifest_sha256');
  });

  // The release train derived patch off 3.27.0 → 3.27.1, the preflight
  // correctly refused (the tap only accepts this layout from 3.28.0), and the
  // train died at the same step on every scheduled run — 2026-08-10 and
  // 2026-08-13 — so no daemon could ever ship. The constraint had been written
  // as a note in a PR body. These pin it as a control instead.
  describe('--min-accepted-version (the train\'s version floor)', () => {
    function floor(entries, formulaBody = FIXTURE_FORMULA) {
      const dir = mkdtempSync(join(tmpdir(), 'pd-formula-floor-'));
      try {
        const p = join(dir, 'port-daddy.rb');
        writeFileSync(p, formulaBody);
        return spawnSync('node', [SCRIPT, '--min-accepted-version', '--entries', entries.join(' '), '--formula-file', p], { encoding: 'utf8' });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }

    test('single-supervisor layout floors at the formula cutoff', () => {
      const r = floor(SINGLE_ENTRIES);
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('3.28.0');
    });

    test('legacy layout imposes no floor', () => {
      const r = floor(LEGACY_ENTRIES);
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('0.0.0');
    });

    test('a layout no branch accepts fails loudly rather than printing a floor', () => {
      const r = floor(['pd', 'port-daddy']);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('no formula branch accepts this tarball layout');
      expect(r.stdout.trim()).toBe('');
    });

    test('the floor makes the deadlocked 3.27.1 derivation shippable', () => {
      // What the train computes: max(derived, floor).
      const f = floor(SINGLE_ENTRIES).stdout.trim();
      const cmp = (a, b) => {
        const [x, y] = [a.split('.').map(Number), b.split('.').map(Number)];
        for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
        return 0;
      };
      const next = cmp('3.27.1', f) < 0 ? f : '3.27.1';
      expect(next).toBe('3.28.0');
      // And that floored version must pass the preflight it previously failed.
      const dir = mkdtempSync(join(tmpdir(), 'pd-formula-floor-'));
      try {
        const p = join(dir, 'port-daddy.rb');
        writeFileSync(p, FIXTURE_FORMULA);
        const r = spawnSync('node', [SCRIPT, '--version', next, '--entries', SINGLE_ENTRIES.join(' '), '--formula-file', p], { encoding: 'utf8' });
        expect(r.status).toBe(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    test('release-train.yml actually consults the floor', () => {
      const wf = readFileSync(resolve('.github/workflows/release-train.yml'), 'utf8');
      expect(wf).toContain('--min-accepted-version');
    });
  });

  test('the entry list release.yml declares matches what the live-formula branch expects for 3.28', () => {
    // Pin release.yml's TARBALL_ENTRIES to the fixture's single-supervisor
    // list so the workflow and this test can't drift silently.
    const workflow = readFileSync(resolve('.github/workflows/release.yml'), 'utf8');
    const m = workflow.match(/TARBALL_ENTRIES:\s*(.+)/);
    expect(m).not.toBeNull();
    expect(m[1].trim().split(/\s+/).sort()).toEqual([...SINGLE_ENTRIES].sort());
  });
});
