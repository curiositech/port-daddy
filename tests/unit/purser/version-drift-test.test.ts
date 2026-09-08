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

describe('release drift detection', () => {
  mkdirSync(join(homedir(), 'coding', 'tmp'), { recursive: true });
  const scratchRoot = mkdtempSync(
    join(homedir(), 'coding', 'tmp', 'pd-release-version-drift-'),
  );
  const authorityVersion = JSON.parse(
    readFileSync(join(ROOT, 'package.json'), 'utf8'),
  ).version as string;
  const driftedVersion = authorityVersion === '0.0.1' ? '0.0.2' : '0.0.1';

  beforeAll(() => {
    for (const relativePath of VERSION_SURFACES) {
      const destination = join(scratchRoot, relativePath);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, readFileSync(join(ROOT, relativePath)));
    }

    const packagePath = join(scratchRoot, 'package.json');
    const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
    pkg.version = driftedVersion;
    writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
  });

  afterAll(() => {
    rmSync(scratchRoot, { recursive: true, force: true });
  });

  test('the shipped gate rejects a package authority that differs from stamped surfaces', () => {
    const result = spawnSync(process.execPath, [GATE, '--root', scratchRoot], {
      encoding: 'utf8',
    });
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain('VERSION DRIFT');
    expect(output).toContain(`package.json (${driftedVersion})`);
    expect(output).toContain(`found ${authorityVersion}`);
  });
});
