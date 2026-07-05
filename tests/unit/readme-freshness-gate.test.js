/**
 * Regression test for scripts/check-readme-freshness.mjs — the commit-time
 * README freshness gate. The README rotted from v3.13 to v3.24 because nothing
 * asked, at commit time, whether a change to a documented surface was reflected
 * in it. The gate FAILS a commit that stages changes to the CLI verb registry,
 * MCP tool surface, OpenAPI contract, or fleet topology (or adds a new
 * cli/commands/ file) without staging README.md alongside.
 *
 * The test proves the gate has teeth AND that its escape hatches work:
 *   - surface change without README staged → exit 1, offender named
 *   - surface change WITH README staged → exit 0
 *   - non-surface change → exit 0 (no cry-wolf)
 *   - edit (not add) to an existing cli/commands file → exit 0 (internal churn)
 *   - NEW cli/commands file → exit 1 (a new verb is README material)
 *   - PD_README_OK=1 → exit 0, bypass logged to stderr
 */
import { describe, expect, test, beforeEach, afterAll } from '@jest/globals';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const gate = join(repo, 'scripts', 'check-readme-freshness.mjs');

const sandboxes = [];

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

/** Create a throwaway git repo with an initial commit of the given files. */
function makeRepo(files) {
  const base = join(homedir(), 'coding', 'tmp');
  mkdirSync(base, { recursive: true });
  const root = mkdtempSync(join(base, 'pd-readme-gate-'));
  sandboxes.push(root);
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'gate-test@example.com');
  git(root, 'config', 'user.name', 'Gate Test');
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'initial');
  return root;
}

/** Run the gate in `cwd`; return { code, stdout, stderr } (stderr captured on success too). */
function run(cwd, env = {}) {
  const r = spawnSync('node', [gate, '--staged'], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, PD_README_OK: '', ...env },
  });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const BASE = {
  'README.md': '# ⚓ Port Daddy (v9.9.9)\n',
  'cli/permission-tiers.ts': 'export const TIER_REGISTRY = {};\n',
  'cli/commands/status.ts': 'export const status = 1;\n',
  'mcp/server.ts': 'const s = 1;\n',
  'docs/openapi.yaml': 'openapi: 3.1.0\n',
  'lib/internal.ts': 'export const x = 1;\n',
};

afterAll(() => {
  for (const s of sandboxes) if (existsSync(s)) rmSync(s, { recursive: true, force: true });
});

describe('README freshness gate (scripts/check-readme-freshness.mjs)', () => {
  let root;
  beforeEach(() => {
    root = makeRepo(BASE);
  });

  test('surface change without README staged FAILS and names the offender', () => {
    writeFileSync(join(root, 'cli/permission-tiers.ts'), 'export const TIER_REGISTRY = { newverb: "silent" };\n');
    git(root, 'add', 'cli/permission-tiers.ts');
    const { code, stderr } = run(root);
    expect(code).toBe(1);
    expect(stderr).toMatch(/README FRESHNESS/);
    expect(stderr).toMatch(/cli\/permission-tiers\.ts/);
    expect(stderr).toMatch(/PD_README_OK=1/);
  });

  test('surface change WITH README staged passes', () => {
    writeFileSync(join(root, 'cli/permission-tiers.ts'), 'export const TIER_REGISTRY = { newverb: "silent" };\n');
    writeFileSync(join(root, 'README.md'), '# ⚓ Port Daddy (v9.9.9)\n\nnewverb documented.\n');
    git(root, 'add', 'cli/permission-tiers.ts', 'README.md');
    const { code } = run(root);
    expect(code).toBe(0);
  });

  test('non-surface change passes without README (no cry-wolf)', () => {
    writeFileSync(join(root, 'lib/internal.ts'), 'export const x = 2;\n');
    git(root, 'add', 'lib/internal.ts');
    const { code } = run(root);
    expect(code).toBe(0);
  });

  test('EDIT to an existing cli/commands file passes (internal churn is not a new verb)', () => {
    writeFileSync(join(root, 'cli/commands/status.ts'), 'export const status = 2;\n');
    git(root, 'add', 'cli/commands/status.ts');
    const { code } = run(root);
    expect(code).toBe(0);
  });

  test('NEW cli/commands file FAILS without README (a new verb is README material)', () => {
    writeFileSync(join(root, 'cli/commands/frobnicate.ts'), 'export const frobnicate = 1;\n');
    git(root, 'add', 'cli/commands/frobnicate.ts');
    const { code, stderr } = run(root);
    expect(code).toBe(1);
    expect(stderr).toMatch(/cli\/commands\/frobnicate\.ts/);
    expect(stderr).toMatch(/new CLI command file/);
  });

  test('PD_README_OK=1 bypasses with a logged trail', () => {
    writeFileSync(join(root, 'mcp/server.ts'), 'const s = 2;\n');
    git(root, 'add', 'mcp/server.ts');
    const { code, stderr } = run(root, { PD_README_OK: '1' });
    expect(code).toBe(0);
    expect(stderr).toMatch(/bypassed via PD_README_OK=1/);
  });

  test('--json emits a machine-readable report', () => {
    writeFileSync(join(root, 'docs/openapi.yaml'), 'openapi: 3.1.0\npaths: {}\n');
    git(root, 'add', 'docs/openapi.yaml');
    let out;
    try {
      out = execFileSync('node', [gate, '--staged', '--json'], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, PD_README_OK: '' },
      });
    } catch (e) {
      out = e.stdout?.toString() ?? '';
    }
    const report = JSON.parse(out);
    expect(report.fresh).toBe(false);
    expect(report.hits.some((h) => h.path === 'docs/openapi.yaml')).toBe(true);
  });
});
