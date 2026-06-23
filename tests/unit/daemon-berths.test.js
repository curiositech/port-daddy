import { describe, expect, test } from '@jest/globals';
import {
  resolveDaemonBerthIdentity,
  resolveBerthTargetUrl,
  isCanonicalTier,
  BERTH_ENV,
  BERTH_COLORS,
  DEV_LATEST_PORT,
} from '../../shared/daemon-berths.js';
import { DEFAULT_DAEMON_PORT } from '../../shared/daemon-discovery.js';

describe('resolveDaemonBerthIdentity (ADR-0084)', () => {
  test('defaults to the stable, canonical berth when env is unset', () => {
    const id = resolveDaemonBerthIdentity({ env: {}, port: DEFAULT_DAEMON_PORT });
    expect(id.tier).toBe('stable');
    expect(id.canonical).toBe(true);
    expect(id.label).toBe('stable');
    expect(id.color).toBe(BERTH_COLORS.stable);
    expect(id.port).toBe(DEFAULT_DAEMON_PORT);
  });

  test('reads tier/label/color/sourceDir from env', () => {
    const id = resolveDaemonBerthIdentity({
      env: {
        [BERTH_ENV.tier]: 'dev-latest',
        [BERTH_ENV.label]: 'nightly',
        [BERTH_ENV.color]: '#123456',
        [BERTH_ENV.sourceDir]: '/repo/pd',
      },
      port: DEV_LATEST_PORT,
      gitSnapshot: { branch: 'main', rev: 'deadbee', builtAt: '2026-06-15T00:00:00.000Z' },
    });
    expect(id.tier).toBe('dev-latest');
    expect(id.canonical).toBe(false);
    expect(id.label).toBe('nightly');
    expect(id.color).toBe('#123456');
    expect(id.sourceDir).toBe('/repo/pd');
    expect(id.gitBranch).toBe('main');
    expect(id.gitRev).toBe('deadbee');
  });

  test('codebase tier is never canonical', () => {
    const id = resolveDaemonBerthIdentity({ env: { [BERTH_ENV.tier]: 'codebase' }, port: 9901 });
    expect(id.tier).toBe('codebase');
    expect(id.canonical).toBe(false);
    expect(id.color).toBe(BERTH_COLORS.codebase);
  });

  test('unknown/garbled tier falls back to stable (never silently promotes a berth)', () => {
    const id = resolveDaemonBerthIdentity({ env: { [BERTH_ENV.tier]: 'wat' }, port: 9999 });
    expect(id.tier).toBe('stable');
    expect(id.canonical).toBe(true);
  });

  test('tier aliases normalize (dev → dev-latest, branch → codebase, rc → stable)', () => {
    expect(resolveDaemonBerthIdentity({ env: { [BERTH_ENV.tier]: 'dev' }, port: 1 }).tier).toBe('dev-latest');
    expect(resolveDaemonBerthIdentity({ env: { [BERTH_ENV.tier]: 'branch' }, port: 1 }).tier).toBe('codebase');
    expect(resolveDaemonBerthIdentity({ env: { [BERTH_ENV.tier]: 'rc' }, port: 1 }).tier).toBe('stable');
  });
});

describe('resolveBerthTargetUrl (pd use / pd --daemon)', () => {
  test('stable/rc → canonical :9876 lane', () => {
    expect(resolveBerthTargetUrl('stable')).toEqual({
      url: `http://127.0.0.1:${DEFAULT_DAEMON_PORT}`, tier: 'stable', label: 'stable',
    });
    expect(resolveBerthTargetUrl('rc').tier).toBe('stable');
  });

  test('dev/dev-latest/latest → fixed :9886 lane', () => {
    for (const t of ['dev', 'dev-latest', 'latest']) {
      const r = resolveBerthTargetUrl(t);
      expect(r.url).toBe(`http://127.0.0.1:${DEV_LATEST_PORT}`);
      expect(r.tier).toBe('dev-latest');
    }
  });

  test('a full URL is returned verbatim (trailing slash trimmed)', () => {
    expect(resolveBerthTargetUrl('http://127.0.0.1:9912/').url).toBe('http://127.0.0.1:9912');
  });

  test('a bare port number → loopback url', () => {
    expect(resolveBerthTargetUrl('9933').url).toBe('http://127.0.0.1:9933');
  });

  test('a label resolves against the dev-berth registry', () => {
    const registry = [
      { label: 'my-feature', tier: 'codebase', port: 9944, sourceDir: '/x', pid: 1, gitRev: 'a', color: '#A855F7', startedAt: 'now' },
    ];
    const r = resolveBerthTargetUrl('my-feature', registry);
    expect(r.url).toBe('http://127.0.0.1:9944');
    expect(r.tier).toBe('codebase');
    expect(r.label).toBe('my-feature');
  });

  test('unknown label → null', () => {
    expect(resolveBerthTargetUrl('nope', [])).toBeNull();
    expect(resolveBerthTargetUrl('')).toBeNull();
  });
});

describe('isCanonicalTier', () => {
  test('only stable is canonical', () => {
    expect(isCanonicalTier('stable')).toBe(true);
    expect(isCanonicalTier('dev-latest')).toBe(false);
    expect(isCanonicalTier('codebase')).toBe(false);
  });
});
