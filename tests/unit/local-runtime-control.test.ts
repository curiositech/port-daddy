/** Inert filesystem observations only: no runtime, child, socket or paid call. */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
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
