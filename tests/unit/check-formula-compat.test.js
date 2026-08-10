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

  test('the entry list release.yml declares matches what the live-formula branch expects for 3.28', () => {
    // Pin release.yml's TARBALL_ENTRIES to the fixture's single-supervisor
    // list so the workflow and this test can't drift silently.
    const workflow = readFileSync(resolve('.github/workflows/release.yml'), 'utf8');
    const m = workflow.match(/TARBALL_ENTRIES:\s*(.+)/);
    expect(m).not.toBeNull();
    expect(m[1].trim().split(/\s+/).sort()).toEqual([...SINGLE_ENTRIES].sort());
  });
});
