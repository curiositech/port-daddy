import { describe, expect, test } from '@jest/globals';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  resolveRepoRoot,
  defaultFrom,
  devCliShellInitSource,
  devCliShimSource,
  shouldPurgeBerthState,
} from '../../cli/commands/berths.js';

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

describe('defaultFrom (the --label-without---from footgun fix)', () => {
  const ROOT = '/Users/me/coding/tmp/add-webhooks';

  test('explicit --from always wins (even empty string / main)', () => {
    expect(defaultFrom('main', 'some-branch', ROOT)).toBe('main');
    expect(defaultFrom('/other/worktree', 'feat-x', ROOT)).toBe('/other/worktree');
  });

  test('no --from on a feature branch → codebase berth for this worktree (root path)', () => {
    expect(defaultFrom(undefined, 'feat/add-webhooks', ROOT)).toBe(ROOT);
    expect(defaultFrom(undefined, 'fix/freshness', ROOT)).toBe(ROOT);
  });

  test('no --from on main/master/detached → shared dev-latest (unchanged behaviour)', () => {
    expect(defaultFrom(undefined, 'main', ROOT)).toBe('main');
    expect(defaultFrom(undefined, 'master', ROOT)).toBe('main');
    expect(defaultFrom(undefined, 'HEAD', ROOT)).toBe('main');
    expect(defaultFrom(undefined, null, ROOT)).toBe('main');
  });
});

describe('named berth state lifecycle', () => {
  test('ordinary stop preserves the isolated durable ledger', () => {
    expect(shouldPurgeBerthState({})).toBe(false);
    expect(shouldPurgeBerthState({ all: true })).toBe(false);
  });

  test('state destruction requires an explicit purge or reset flag', () => {
    expect(shouldPurgeBerthState({ purge: true })).toBe(true);
    expect(shouldPurgeBerthState({ reset: true })).toBe(true);
  });
});

describe('named berth source-matched CLI', () => {
  test('profile shim executes the feature worktree CLI and forwards argv exactly', () => {
    const source = '/Users/me/coding/tmp/feature worktree';
    const shim = devCliShimSource(source);

    expect(shim).toContain("'/Users/me/coding/tmp/feature worktree/node_modules/.bin/tsx'");
    expect(shim).toContain("'/Users/me/coding/tmp/feature worktree/bin/port-daddy-cli.ts'");
    expect(shim).toContain('"$@"');
    expect(shim.startsWith('#!/bin/sh\nexec ')).toBe(true);
  });

  test('isolated login-shell init keeps the source shim first without replacing user PATH', () => {
    const init = devCliShellInitSource('/profile/dev-bin', '/profile/dev-bin/pd');

    expect(init).toContain("export PATH='/profile/dev-bin':\"$PATH\"");
    expect(init).toContain("export PORT_DADDY_CLI='/profile/dev-bin/pd'");
  });
});
