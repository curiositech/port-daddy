/** Inert filesystem observations only: no runtime, child, socket or paid call. */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';
const files = new Map<string, 'dir' | 'file' | 'symlink' | 'denied'>();
const error = (code: string) => Object.assign(new Error(code), { code });
jest.unstable_mockModule('node:fs', () => ({
  constants: { R_OK: 4, X_OK: 1 },
  accessSync: (path: string) => { if (files.get(path) === 'denied') throw error('EACCES'); },
  lstatSync: (path: string) => {
    const type = files.get(path);
    if (!type) throw error('ENOENT');
    if (type === 'denied') throw error('EACCES');
    return { isDirectory: () => type === 'dir', isSymbolicLink: () => type === 'symlink' };
  },
}));
const { createLocalRuntimeGate, readLocalRuntimeControl } = await import('../../lib/local-runtime-control.js');
const fakeFs = await import('node:fs');
const fixture = { canonicalRoot: '/fixture/canonical', selectedRoot: '/fixture/selected', env: {} };
beforeEach(() => {
  files.clear();
  files.set('/fixture', 'dir');
  files.set(fixture.canonicalRoot, 'dir');
  files.set(fixture.selectedRoot, 'dir');
});

describe('local Off admission', () => {
  test('only verified absences enable runtime, including an observably missing root', () => {
    expect(readLocalRuntimeControl(fixture).enabled).toBe(true);
    files.delete(fixture.canonicalRoot);
    expect(readLocalRuntimeControl(fixture).enabled).toBe(true);
    files.set('/fixture', 'denied');
    expect(readLocalRuntimeControl(fixture).enabled).toBe(false);
  });

  test.each(['canonical', 'selected'])('HALT and hooks.disabled in %s are both vetoes', (root) => {
    for (const marker of ['HALT', 'hooks.disabled']) {
      const path = `/fixture/${root}/${marker}`;
      files.set(path, 'file');
      expect(readLocalRuntimeControl(fixture)).toMatchObject({ enabled: false, reason: 'stop_marker', path });
      files.delete(path);
    }
  });

  test.each(['symlink', 'denied', 'file'] as const)('invalid canonical root %s fails closed', (type) => {
    files.set(fixture.canonicalRoot, type);
    expect(readLocalRuntimeControl(fixture).enabled).toBe(false);
  });

  test('dangling sentinel symlink is a stop, without following or reading it', () => {
    files.set('/fixture/canonical/HALT', 'symlink');
    expect(readLocalRuntimeControl(fixture).reason).toBe('stop_marker');
  });

  test('custom controls add denials and never override canonical Off', () => {
    expect(readLocalRuntimeControl({ ...fixture, haltFile: 'relative/HALT' }).enabled).toBe(false);
    expect(readLocalRuntimeControl({ ...fixture, haltFile: '/unknown/HALT' }).enabled).toBe(false);
    files.set('/fixture/canonical/hooks.disabled', 'file');
    expect(readLocalRuntimeControl({ ...fixture, haltFile: '/fixture/absent-HALT' }).enabled).toBe(false);
  });

  test('uncertain observation latches; removal does not grant ALL-CLEAR', () => {
    let allow = true;
    const gate = createLocalRuntimeGate(() => allow);
    expect(gate()).toBe(true);
    allow = false;
    expect(gate()).toBe(false);
    allow = true;
    expect(gate()).toBe(false);
    expect(createLocalRuntimeGate(() => { throw error('EACCES'); })()).toBe(false);
  });
});

describe('runtime source wiring (not execution proof)', () => {
  test.each([
    ['bin/port-daddy-cli.ts', '../lib/cli-entry-guard.js'],
    ['bin/port-daddy-daemon.ts', '../lib/runtime-entry-guard.js'],
    ['server.ts', './lib/runtime-entry-guard.js'],
  ])('%s evaluates its Off guard as the first dependency', (path, guard) => {
    const source = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
    expect(source.match(/^import [^\n]+/m)?.[0]).toBe(`import '${guard}';`);
  });

  test('dispatch starts only after the synchronous watch; SIGHUP checks its latch', () => {
    const source = readFileSync(new URL('../../server.ts', import.meta.url), 'utf8');
    expect(source.indexOf('haltWatch.start();')).toBeLessThan(source.indexOf('dispatchWorker?.start();'));
    expect(source).not.toContain('if (dispatchWorker) dispatchWorker.start();');
    expect(source).toContain("process.on('SIGHUP', () => {\n  if (haltWatch.check())");
  });
});

describe('plain-JS entry parity (entire shim evaluated with inert module adapters)', () => {
  const source = readFileSync(new URL('../../bin/port-daddy-cli.js', import.meta.url), 'utf8');
  const canonicalRoot = '/fixture/.port-daddy';
  async function runShim(env: Record<string, string>, args = ['status'], afterResolve = () => {}) {
    const spawn = jest.fn(() => ({ on: jest.fn() }));
    const exit = jest.fn((code) => { throw new Error(`fixture exit ${code}`); });
    const context = createContext({ process: { argv: ['node', '/fixture/bin/shim.js', ...args],
      env, execPath: '/fixture/node', exit }, console: { error: jest.fn() } });
    const modules: Record<string, object> = {
      'node:child_process': { spawn }, 'node:fs': fakeFs, 'node:os': { homedir: () => '/fixture' },
      'node:path': path, 'node:url': url,
      'node:module': { createRequire: () => ({ resolve: () => {
        afterResolve(); return '/fixture/tsx.mjs';
      } }) },
    };
    const entry = new SourceTextModule(source, { context,
      initializeImportMeta: (meta) => { meta.url = 'file:///fixture/bin/shim.js'; } });
    await entry.link(async (name) => {
      const values = modules[name];
      if (!values) throw new Error(`Unexpected import ${name}`);
      return new SyntheticModule(Object.keys(values), function () {
        for (const [key, value] of Object.entries(values)) this.setExport(key, value);
      }, { context });
    });
    try { await entry.evaluate(); } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith('fixture exit')) throw error;
    }
    return { spawn, exit };
  }

  test.each([
    ['absent roots', undefined, undefined],
    ['canonical HALT', `${canonicalRoot}/HALT`, 'file'],
    ['canonical hooks disabled', `${canonicalRoot}/hooks.disabled`, 'file'],
    ['selected HALT', '/fixture/selected/HALT', 'file'],
    ['selected hooks disabled', '/fixture/selected/hooks.disabled', 'file'],
    ['dangling HALT', `${canonicalRoot}/HALT`, 'symlink'],
    ['unreadable canonical', canonicalRoot, 'denied'],
    ['canonical is a file', canonicalRoot, 'file'],
    ['canonical symlink', canonicalRoot, 'symlink'],
    ['selected symlink', '/fixture/selected', 'symlink'],
    ['unreadable parent', '/fixture', 'denied'],
  ] as const)('%s matches the typed predicate', async (_label, location, kind) => {
    if (location) {
      files.set(canonicalRoot, 'dir');
      files.set(location, kind!);
    } else {
      files.delete('/fixture/selected');
    }
    const env = { PD_HOME: '/fixture/selected' };
    const expected = readLocalRuntimeControl({ canonicalRoot, env }).enabled;
    expect((await runShim(env)).spawn).toHaveBeenCalledTimes(expected ? 1 : 0);
  });

  test.each(['relative/HALT', '/unknown/HALT', '/fixture/custom-HALT', `${canonicalRoot}/HALT`])(
    'custom sentinel %s matches typed control', async (PD_HALT_FILE) => {
      const env = { PD_HALT_FILE };
      const expected = readLocalRuntimeControl({ canonicalRoot, env }).enabled;
      expect((await runShim(env)).spawn).toHaveBeenCalledTimes(expected ? 1 : 0);
    });

  test('Off during loader resolution denies the actual child spawn', async () => {
    files.set(canonicalRoot, 'dir');
    const result = await runShim({}, ['status'], () => files.set(`${canonicalRoot}/HALT`, 'file'));
    expect(result.spawn).not.toHaveBeenCalled();
    expect(result.exit).toHaveBeenCalledWith(1);
  });

  test.each([['--help'], ['--version'], ['--help', 'status']])('only exact informational argv %j bypasses runtime admission', async (...args) => {
    files.set(canonicalRoot, 'dir');
    files.set(`${canonicalRoot}/HALT`, 'file');
    expect((await runShim({}, args)).spawn).toHaveBeenCalledTimes(args.length === 1 ? 1 : 0);
  });
});
