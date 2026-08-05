import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const purserTests = [
  'test-missing-paper-source.js',
  'test-cyclic-imports.js',
  'test-missing-citation.js',
  'test-basictex-fallback.js',
  'test-namespace-conflicts.js',
].map((name) => resolve(root, 'tests/purser', name));

describe('Purser mega-volume successor contract', () => {
  test('executes every authored adversarial test in the standard CI lane', () => {
    const output = execFileSync(process.execPath, ['--test', ...purserTests], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
    });

    expect(output).toMatch(/tests 5/u);
    expect(output).toMatch(/fail 0/u);
    if (existsSync(resolve(root, 'scripts/generate-mega-whitepaper.mjs'))) {
      expect(output).toMatch(/pass 5/u);
      expect(output).toMatch(/skipped 0/u);
    } else {
      expect(output).toMatch(/pass 0/u);
      expect(output).toMatch(/skipped 5/u);
    }
  });
});
