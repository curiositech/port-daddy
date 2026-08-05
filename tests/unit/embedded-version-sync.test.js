import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

/**
 * The bun-compiled binary cannot read package.json at runtime (it lives at a
 * virtual /$bunfs/ path that doesn't exist on disk). It falls back to the
 * EMBEDDED_PACKAGE_VERSION constant in server.ts, which scripts/sync-version.ts
 * maintains in lockstep with package.json via the postversion hook.
 *
 * This test catches the failure mode the postversion hook can't: someone
 * hand-edits package.json's version without running `npm version`, the sync
 * never runs, and the binary ships with a stale embedded version. CI catches
 * it on the next commit.
 */
describe('EMBEDDED_PACKAGE_VERSION lockstep with package.json', () => {
  test('server.ts EMBEDDED_PACKAGE_VERSION matches package.json version', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8'));
    const serverSrc = readFileSync(join(REPO_ROOT, 'server.ts'), 'utf-8');
    const m = serverSrc.match(/const EMBEDDED_PACKAGE_VERSION: string = ['"]([\w.\-+]+)['"]/);
    expect(m).not.toBeNull();
    expect(m[1]).toBe(pkg.version);
  });

  test('mcp/server.ts version literal matches package.json version', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8'));
    const mcpSrc = readFileSync(join(REPO_ROOT, 'mcp', 'server.ts'), 'utf-8');
    // Match the same literal sync-version.ts maintains (top-level `version: '...'`)
    const m = mcpSrc.match(/version:\s*['"]([\w.\-+]+)['"]/);
    expect(m).not.toBeNull();
    expect(m[1]).toBe(pkg.version);
  });

  test('compiled CLI and resolved pd-console package match package.json version', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8'));
    const diagnostics = readFileSync(join(REPO_ROOT, 'cli', 'commands', 'diagnostics.ts'), 'utf-8');
    const cliVersion = diagnostics.match(/EMBEDDED_PACKAGE_VERSION: string = ['"]([\w.\-+]+)['"]/);
    expect(cliVersion).not.toBeNull();
    expect(cliVersion[1]).toBe(pkg.version);

    const cargoLock = readFileSync(join(REPO_ROOT, 'core', 'Cargo.lock'), 'utf-8');
    const consoleVersion = cargoLock.match(/\[\[package\]\]\nname = "pd-console"\nversion = "([\w.\-+]+)"/);
    expect(consoleVersion).not.toBeNull();
    expect(consoleVersion[1]).toBe(pkg.version);
  });
});
