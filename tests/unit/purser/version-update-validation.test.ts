import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.PD_RELEASE_TEST_ROOT
  ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const EXPECTED_VERSION = '3.29.0';

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

const versionChecks = [
  { file: 'package.json', regex: /"version"\s*:\s*"([\d.]+)"/ },
  { file: 'VERSION', regex: /^([\d.]+)\s*$/ },
  { file: 'README.md', regex: /^# ⚓ Port Daddy \(v([\d.]+)\)/m },
  { file: 'core/pd-console/Cargo.toml', regex: /^version\s*=\s*"([\d.]+)"/m },
  { file: '.claude-plugin/plugin.json', regex: /"version"\s*:\s*"([\d.]+)"/ },
  { file: '.gemini/extensions/port-daddy/gemini-extension.json', regex: /"version"\s*:\s*"([\d.]+)"/ },
  { file: 'mcp-server.json', regex: /"version"\s*:\s*"([\d.]+)"/ },
  { file: 'mcp/server.ts', regex: /version:\s*['"]([\d.]+)['"]/ },
  { file: 'docs/openapi.yaml', regex: /^  version:\s*([\d.]+)\s*$/m },
  { file: 'public/samples/manifest.json', regex: /"packageVersion"\s*:\s*"([\d.]+)"/ },
  { file: 'website-v2/src/data/referenceCatalog.ts', regex: /PORT_DADDY_VERSION\s*=\s*['"]([\d.]+)['"]/ },
  { file: 'cli/commands/diagnostics.ts', regex: /EMBEDDED_PACKAGE_VERSION:\s*string\s*=\s*['"]([\d.]+)['"]/ },
  { file: 'server.ts', regex: /EMBEDDED_PACKAGE_VERSION:\s*string\s*=\s*['"]([\d.]+)['"]/ },
];

describe('3.29.0 release version surfaces', () => {
  test.each(versionChecks)('$file is stamped with the release version', ({ file, regex }) => {
    const match = read(file).match(regex);
    expect(match?.[1]).toBe(EXPECTED_VERSION);
  });

  test('the previous version is absent from every stamped field', () => {
    for (const { file, regex } of versionChecks) {
      const match = read(file).match(regex);
      expect(match?.[1]).not.toBe('3.28.2');
    }
  });
});
