import { describe, expect, test } from '@jest/globals';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveRepoRoot } from '../../cli/commands/berths.js';

// Regression for `pd dev up` crashing with
//   "build script missing in source tree: /scripts/build-daemon-binary.mjs"
// In the bun-compiled binary, __dirname points inside the bundle (not a real
// tree), so the old module-walk fell through to "/" and produced a bogus
// "/scripts/..." path. resolveRepoRoot must fall back to the cwd's checkout.
describe('resolveRepoRoot (pd dev up source-tree resolution)', () => {
  const repoTop = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf-8' }).trim();

  test('module walk resolves the source tree in dev (real moduleDir)', () => {
    const root = resolveRepoRoot(import.meta.dirname, process.cwd());
    expect(existsSync(join(root, 'scripts', 'build-daemon-binary.mjs'))).toBe(true);
  });

  test('compiled-binary case: bogus moduleDir "/" falls back to the cwd checkout, never "/"', () => {
    const root = resolveRepoRoot('/', repoTop);
    expect(root).not.toBe('/');
    expect(existsSync(join(root, 'scripts', 'build-daemon-binary.mjs'))).toBe(true);
  });

  test('never yields a bogus /scripts path (the original bug)', () => {
    const root = resolveRepoRoot('/', repoTop);
    expect(join(root, 'scripts', 'build-daemon-binary.mjs')).not.toBe('/scripts/build-daemon-binary.mjs');
  });
});
