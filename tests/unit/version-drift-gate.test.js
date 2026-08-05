/**
 * Regression test for scripts/check-version-drift.mjs — the ADR-0057
 * dist-version-authority drift gate. package.json is the sole version authority;
 * scripts/sync-version.ts stamps it across every surface; this gate FAILS CI when
 * any surface drifts. The test pins that behaviour two ways:
 *
 *   1. The LIVE repo passes the gate (source mode) — i.e. the tree we are shipping
 *      is actually unified. This is the regression that would have caught the
 *      pre-ADR state where VERSION said 3.7.0 and core/pd-console/Cargo.toml said
 *      0.3.0 while package.json said 3.20.0.
 *   2. Against a sandbox copy of the surfaces, a clean tree passes and an INJECTED
 *      drift (VERSION + the pd-console crate version) fails with the offenders named.
 *      This proves the gate has teeth, not just that today's tree happens to agree.
 */
import { describe, expect, test, beforeAll, afterAll } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const gate = join(repo, 'scripts', 'check-version-drift.mjs');

/** Run the gate; return { code, stdout, stderr }. */
function run(...flags) {
  try {
    const stdout = execFileSync('node', [gate, ...flags], { cwd: repo, encoding: 'utf8' });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout?.toString() ?? '', stderr: e.stderr?.toString() ?? '' };
  }
}

/** Write a minimal but real set of version surfaces into `root` at `version`. */
function scaffold(root, version) {
  const w = (rel, content) => {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  };
  w('package.json', JSON.stringify({ name: 'port-daddy', version }, null, 2) + '\n');
  w('mcp-server.json', JSON.stringify({ name: 'port-daddy', version }, null, 2) + '\n');
  w('.claude-plugin/plugin.json', JSON.stringify({ name: 'port-daddy', version }, null, 2) + '\n');
  w(
    '.gemini/extensions/port-daddy/gemini-extension.json',
    JSON.stringify({ name: 'port-daddy', version }, null, 2) + '\n',
  );
  w('public/samples/manifest.json', JSON.stringify({ packageVersion: version }, null, 2) + '\n');
  w('mcp/server.ts', `const s = new Server({ name: 'port-daddy', version: '${version}' });\n`);
  w('server.ts', `const EMBEDDED_PACKAGE_VERSION: string = '${version}';\n`);
  w('cli/commands/diagnostics.ts', `const EMBEDDED_PACKAGE_VERSION: string = '${version}';\n`);
  w('website-v2/src/data/referenceCatalog.ts', `export const PORT_DADDY_VERSION = '${version}';\n`);
  w('VERSION', `${version}\n`);
  w('core/pd-console/Cargo.toml', `[package]\nname = "pd-console"\nversion = "${version}"\nedition = "2021"\n`);
  w('core/Cargo.lock', `[[package]]\nname = "pd-console"\nversion = "${version}"\n`);
  w('README.md', `# ⚓ Port Daddy (v${version})\n\nHello.\n`);
  w('docs/openapi.yaml', `openapi: 3.1.0\ninfo:\n  title: Port Daddy API\n  version: ${version}\n`);
}

describe('version drift gate (scripts/check-version-drift.mjs)', () => {
  let sandbox;

  beforeAll(() => {
    const base = join(homedir(), 'coding', 'tmp');
    mkdirSync(base, { recursive: true });
    sandbox = mkdtempSync(join(base, 'pd-version-drift-'));
  });

  afterAll(() => {
    if (sandbox && existsSync(sandbox)) rmSync(sandbox, { recursive: true, force: true });
  });

  test('the LIVE repo tree is unified (source mode passes)', () => {
    const { code, stdout } = run();
    expect(code).toBe(0);
    expect(stdout).toMatch(/all \d+ checked surface\(s\) agree/);
    // The two surfaces this ADR phase newly enforces must be present and green.
    expect(stdout).toMatch(/VERSION →/);
    expect(stdout).toMatch(/core\/pd-console\/Cargo\.toml/);
    expect(stdout).toMatch(/core\/Cargo\.lock/);
    expect(stdout).toMatch(/cli\/commands\/diagnostics\.ts/);
    // The front-door surfaces added after the README rotted at 3.13 for months.
    expect(stdout).toMatch(/README\.md \(title version\)/);
    expect(stdout).toMatch(/docs\/openapi\.yaml \(info\.version\)/);
  });

  test('a clean sandbox tree passes', () => {
    const root = join(sandbox, 'clean');
    scaffold(root, '9.9.9');
    const { code, stdout } = run('--root', root);
    expect(code).toBe(0);
    expect(stdout).toMatch(/9\.9\.9/);
    expect(stdout).toMatch(/agree on 9\.9\.9/);
  });

  test('injected drift FAILS the gate and names every offender', () => {
    const root = join(sandbox, 'drift');
    scaffold(root, '9.9.9');
    // Inject the exact pre-ADR drift: VERSION lags, the pd-console crate lags.
    writeFileSync(join(root, 'VERSION'), '3.7.0\n');
    writeFileSync(
      join(root, 'core/pd-console/Cargo.toml'),
      '[package]\nname = "pd-console"\nversion = "0.3.0"\nedition = "2021"\n',
    );
    const { code, stderr } = run('--root', root);
    expect(code).toBe(1);
    expect(stderr).toMatch(/VERSION DRIFT/);
    // Both injected offenders are named with their stale value.
    expect(stderr).toMatch(/VERSION: found 3\.7\.0/);
    expect(stderr).toMatch(/core\/pd-console\/Cargo\.toml.*found 0\.3\.0/);
    // And the fix instruction points at the authority script.
    expect(stderr).toMatch(/sync-version\.ts/);
  });

  test('a surface whose version literal is missing is reported as drift, not silently passed', () => {
    const root = join(sandbox, 'missing');
    scaffold(root, '9.9.9');
    // Blank out the mcp/server.ts version literal entirely.
    writeFileSync(join(root, 'mcp/server.ts'), 'const s = new Server({ name: "port-daddy" });\n');
    const { code, stderr } = run('--root', root);
    expect(code).toBe(1);
    expect(stderr).toMatch(/mcp\/server\.ts: found NONE/);
  });

  test('compiled CLI and Cargo lock drift both fail closed', () => {
    const root = join(sandbox, 'build-input-drift');
    scaffold(root, '9.9.9');
    writeFileSync(join(root, 'cli/commands/diagnostics.ts'), `const EMBEDDED_PACKAGE_VERSION: string = '9.9.8';\n`);
    writeFileSync(join(root, 'core/Cargo.lock'), '[[package]]\nname = "pd-console"\nversion = "9.9.7"\n');
    const { code, stderr } = run('--root', root);
    expect(code).toBe(1);
    expect(stderr).toMatch(/cli\/commands\/diagnostics\.ts.*found 9\.9\.8/);
    expect(stderr).toMatch(/core\/Cargo\.lock.*found 9\.9\.7/);
  });

  test('--json emits a machine-readable report with authority + drift list', () => {
    const root = join(sandbox, 'json');
    scaffold(root, '9.9.9');
    writeFileSync(join(root, 'VERSION'), '0.0.1\n');
    const { stdout } = run('--root', root, '--json');
    const report = JSON.parse(stdout);
    expect(report.authority).toBe('9.9.9');
    expect(report.drift.some((d) => d.surface === 'VERSION' && d.found === '0.0.1')).toBe(true);
  });
});
