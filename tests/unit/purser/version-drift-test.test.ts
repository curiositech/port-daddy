// tests/unit/purser/version-drift-test.test.ts
import { promises as fs } from 'fs';
import { mkdtempSync, rmSync, copyFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';

describe('Version drift detection', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'vdrift-'));

  // Helper to copy a list of files from the repository root to the temp dir
  const copyFiles = async (paths: string[]) => {
    for (const relPath of paths) {
      const src = join(process.cwd(), relPath);
      const dest = join(tmpDir, relPath);
      await fs.mkdir(dirname(dest), { recursive: true });
      await fs.copyFile(src, dest);
    }
  };

  beforeAll(async () => {
    // Copy all relevant versioned files from the repo into the temp dir
    await copyFiles([
      'package.json',
      'core/pd-console/Cargo.toml',
      'public/samples/manifest.json',
      'website-v2/src/data/referenceCatalog.ts',
      'docs/openapi.yaml',
      'mcp-server.json',
      'cli/commands/diagnostics.ts',
      'server.ts',
      '.claude-plugin/plugin.json',
      '.gemini/extensions/port-daddy/gemini-extension.json',
      'scripts/check-version-drift.ts',
    ]);

    // Intentionally introduce a version drift: change package.json to 3.28.2
    const pkgPath = join(tmpDir, 'package.json');
    const pkgText = await fs.readFile(pkgPath, 'utf8');
    const pkg = JSON.parse(pkgText);
    pkg.version = '3.28.2';
    await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2), 'utf8');
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should fail when a drift exists between version surfaces', () => {
    const result = spawnSync(
      'node',
      ['-r', 'ts-node/register', 'scripts/check-version-drift.ts'],
      { cwd: tmpDir, encoding: 'utf8' }
    );

    // Expect the script to exit with a non-zero status indicating a drift was found
    expect(result.status).not.toBe(0);

    // The error output should mention a version mismatch
    const output = result.stderr || result.stdout || '';
    const hasMismatch = /version|mismatch|drift/i.test(output);
    expect(hasMismatch).toBe(true);
  });
});