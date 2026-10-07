import { spawnSync } from 'node:child_process';
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
    const result = spawnSync(process.execPath, ['--test', ...purserTests], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
      // A passing run of these five tests is about 1.2 KB of TAP. A FAILING one
      // is not: node:test prints the whole received value on a failed
      // assert.match, and one of these matches against the collated Book body,
      // so a single failure emits ~1.5 MB and blows straight past spawnSync's
      // 1 MiB default. The suite then reported `spawnSync ... ENOBUFS` on both
      // runners and said nothing about which test failed or why. Room enough to
      // print the diagnosis, so the failure that happens is the one reported.
      maxBuffer: 64 * 1024 * 1024,
    });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
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
