// tests/unit/purser/version-update-validation.test.ts
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(__dirname, '..', '..', '..');

function read(file: string): string {
  return readFileSync(file, 'utf8');
}

function walk(dir: string, files: string[] = []) {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (['node_modules', 'dist', 'coverage', '.git', '.github', '.turbo', '.cache', '.next', 'public', 'tmp'].includes(entry)) {
      continue;
    }
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, files);
    } else {
      files.push(full);
    }
  }
  return files;
}

const versionChecks = [
  { file: 'package.json', regex: /"version"\s*:\s*"([\d.]+)"/ },
  { file: 'core/pd-console/Cargo.toml', regex: /version\s*=\s*"([\d.]+)"/ },
  { file: '.claude-plugin/plugin.json', regex: /"version"\s*:\s*"([\d.]+)"/ },
  { file: '.gemini/extensions/port-daddy/gemini-extension.json', regex: /"version"\s*:\s*"([\d.]+)"/ },
  { file: 'mcp-server.json', regex: /"version"\s*:\s*"([\d.]+)"/ },
  { file: 'docs/openapi.yaml', regex: /version:\s*([\d.]+)/ },
  { file: 'public/samples/manifest.json', regex: /"packageVersion"\s*:\s*"([\d.]+)"/ },
  { file: 'website-v2/src/data/referenceCatalog.ts', regex: /export const PORT_DADDY_VERSION = ['"]([\d.]+)['"]/ },
  { file: 'cli/commands/diagnostics.ts', regex: /const EMBEDDED_PACKAGE_VERSION: string = ['"]([\d.]+)['"]/ },
  { file: 'server.ts', regex: /const EMBEDDED_PACKAGE_VERSION: string = ['"]([\d.]+)['"]/ },
];

describe('Version bump validation', () => {
  test('All root version fields are 3.29.0', () => {
    for (const { file, regex } of versionChecks) {
      const fullPath = join(ROOT, file);
      const content = read(fullPath);
      const match = content.match(regex);
      expect(match).toBeTruthy();
      const version = match![1];
      expect(version).toBe('3.29.0');
    }
  });

  test('No residual 3.28.2 references exist', () => {
    const allFiles = walk(ROOT);
    const residuals: string[] = [];
    for (const file of allFiles) {
      const content = read(file);
      if (content.includes('3.28.2')) {
        residuals.push(file);
      }
    }
    expect(residuals).toEqual([]);
  });
});