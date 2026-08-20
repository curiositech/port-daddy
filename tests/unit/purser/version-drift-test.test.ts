import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = process.env.PD_RELEASE_TEST_ROOT
  ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GATE = join(ROOT, 'scripts', 'check-version-drift.mjs');
const VERSION_SURFACES = [
  'package.json',
  'mcp-server.json',
  '.claude-plugin/plugin.json',
  '.gemini/extensions/port-daddy/gemini-extension.json',
  'public/samples/manifest.json',
  'mcp/server.ts',
  'server.ts',
  'website-v2/src/data/referenceCatalog.ts',
  'VERSION',
  'core/pd-console/Cargo.toml',
  'README.md',
  'docs/openapi.yaml',
];

describe('3.29.0 release drift detection', () => {
  const scratchRoot = mkdtempSync(
    join(homedir(), 'coding', 'tmp', 'pd-release-version-drift-'),
  );

  beforeAll(() => {
    for (const relativePath of VERSION_SURFACES) {
      const destination = join(scratchRoot, relativePath);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, readFileSync(join(ROOT, relativePath)));
    }

    const packagePath = join(scratchRoot, 'package.json');
    const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
    pkg.version = '3.28.2';
    writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
  });

  afterAll(() => {
    rmSync(scratchRoot, { recursive: true, force: true });
  });

  test('the shipped gate rejects a stale package authority against 3.29.0 surfaces', () => {
    const result = spawnSync(process.execPath, [GATE, '--root', scratchRoot], {
      encoding: 'utf8',
    });
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain('VERSION DRIFT');
    expect(output).toContain('package.json (3.28.2)');
    expect(output).toContain('found 3.29.0');
  });
});
