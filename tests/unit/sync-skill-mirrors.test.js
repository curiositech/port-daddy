/**
 * Unit tests for scripts/sync-skill-mirrors.mjs — the agent-surface skill-mirror
 * sync that the skill-hygiene CI job runs in --check mode. Drives the real CLI
 * against a throwaway repo fixture (its own skills/ + mirror roots) so the
 * behaviour is pinned: drift is detected, --check is non-destructive and exits
 * non-zero on drift, write mode copies + prunes + creates missing mirror dirs,
 * a synced tree is idempotent, and skills without a mirrors block are ignored.
 *
 * Addresses the pd-qa finding on PR #573 (the script shipped as a CI gate with
 * no tests): empty/absent mirrors, prune safety, --check exit codes, --json
 * shape, and idempotency are covered here.
 */
import { describe, expect, test, beforeEach, afterEach } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const script = join(repo, 'scripts', 'sync-skill-mirrors.mjs');

let root;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pd-mirror-sync-'));
});

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

/** Run the real script with `root` as cwd. Returns { code, stdout, stderr }. */
function run(...args) {
  try {
    const stdout = execFileSync('node', [script, ...args], { cwd: root, encoding: 'utf8' });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout?.toString() ?? '', stderr: e.stderr?.toString() ?? '' };
  }
}

function write(rel, body) {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
  return abs;
}

/** A canonical skill that declares one codex mirror. */
function canonicalWithMirror(name = 'demo-skill') {
  write(`skills/${name}/SKILL.md`, [
    '---',
    `name: ${name}`,
    'description: "demo"',
    'metadata:',
    '  mirrors:',
    `    repo: skills/${name}`,
    `    codex: .codex/skills/${name}`,
    '---',
    '',
    `# ${name}`,
    'body v1',
    '',
  ].join('\n'));
  write(`skills/${name}/references/guide.md`, 'guide v1\n');
}

describe('sync-skill-mirrors', () => {
  test('--check exits 1 and names the out-of-sync mirror when it is missing', () => {
    canonicalWithMirror();
    const { code, stdout, stderr } = run('--check');
    expect(code).toBe(1);
    expect(stdout).toMatch(/OUT-OF-SYNC/);
    expect(`${stdout}${stderr}`).toMatch(/out of sync/);
    // --check must not create the mirror.
    expect(existsSync(join(root, '.codex/skills/demo-skill/SKILL.md'))).toBe(false);
  });

  test('write mode creates the mirror dir and copies every canonical file', () => {
    canonicalWithMirror();
    const { code } = run();
    expect(code).toBe(0);
    expect(readFileSync(join(root, '.codex/skills/demo-skill/SKILL.md'), 'utf8')).toMatch(/body v1/);
    expect(readFileSync(join(root, '.codex/skills/demo-skill/references/guide.md'), 'utf8')).toBe('guide v1\n');
  });

  test('a freshly synced tree is idempotent (--check is clean, exit 0)', () => {
    canonicalWithMirror();
    expect(run().code).toBe(0);
    const second = run('--check');
    expect(second.code).toBe(0);
    expect(second.stdout).toMatch(/0 out of sync/);
  });

  test('write mode prunes files that exist in the mirror but not in canonical', () => {
    canonicalWithMirror();
    run(); // initial sync
    // Plant an orphan in the mirror.
    write('.codex/skills/demo-skill/stale-orphan.md', 'left over\n');
    expect(existsSync(join(root, '.codex/skills/demo-skill/stale-orphan.md'))).toBe(true);
    const { code } = run();
    expect(code).toBe(0);
    expect(existsSync(join(root, '.codex/skills/demo-skill/stale-orphan.md'))).toBe(false);
    // Real content survives the prune.
    expect(existsSync(join(root, '.codex/skills/demo-skill/SKILL.md'))).toBe(true);
  });

  test('a canonical edit re-drifts the mirror until re-synced', () => {
    canonicalWithMirror();
    run();
    write('skills/demo-skill/references/guide.md', 'guide v2\n');
    expect(run('--check').code).toBe(1);
    run();
    expect(readFileSync(join(root, '.codex/skills/demo-skill/references/guide.md'), 'utf8')).toBe('guide v2\n');
    expect(run('--check').code).toBe(0);
  });

  test('skills without a mirrors block are ignored (no targets, exit 0)', () => {
    write('skills/plain/SKILL.md', '---\nname: plain\ndescription: "no mirrors"\n---\n\n# plain\n');
    const { code, stdout } = run('--json');
    expect(code).toBe(0);
    const report = JSON.parse(stdout);
    expect(report.driftCount).toBe(0);
    expect(report.mirrors).toHaveLength(0);
  });

  test('--json reports the mirror target and zero drift after a sync', () => {
    canonicalWithMirror();
    run();
    const { code, stdout } = run('--json', '--check');
    expect(code).toBe(0);
    const report = JSON.parse(stdout);
    expect(report.mode).toBe('check');
    expect(report.driftCount).toBe(0);
    expect(report.mirrors).toHaveLength(1);
    expect(report.mirrors[0]).toMatchObject({ skill: 'demo-skill', surface: 'codex' });
  });

  test('an unknown flag is rejected (exit non-zero), not silently ignored', () => {
    canonicalWithMirror();
    const { code } = run('--bogus');
    expect(code).not.toBe(0);
  });
});
