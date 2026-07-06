import { describe, expect, test } from '@jest/globals';
import {
  resolveDaemonBerthIdentity,
  resolveBerthTargetUrl,
  isCanonicalTier,
  classifyBerth,
  describeVerdict,
  shouldReap,
  BERTH_IDLE_TTL_MS,
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

describe('classifyBerth (GC decision)', () => {
  const NOW = 1_000_000_000_000;
  const rec = (over = {}) => ({
    label: 'add-webhooks', tier: 'codebase', port: 3155, sourceDir: '/wt/add-webhooks',
    pid: 42, gitRev: 'abc1234', color: '#A855F7',
    startedAt: new Date(NOW - 60_000).toISOString(), ...over,
  });
  const live = { pidAlive: true, worktreeExists: true, lastActivityMs: NOW - 1000 };

  test('dead process → reap-dead (highest precedence)', () => {
    // dead beats everything, even a missing worktree.
    expect(classifyBerth(rec(), { ...live, pidAlive: false, worktreeExists: false }, NOW)).toBe('reap-dead');
  });

  test('worktree deleted → reap-orphaned', () => {
    expect(classifyBerth(rec(), { ...live, worktreeExists: false }, NOW)).toBe('reap-orphaned');
  });

  test('codebase berth idle past TTL → reap-idle', () => {
    const stale = NOW - (BERTH_IDLE_TTL_MS + 60_000);
    expect(classifyBerth(rec({ startedAt: new Date(stale).toISOString() }),
      { pidAlive: true, worktreeExists: true, lastActivityMs: stale }, NOW)).toBe('reap-idle');
  });

  test('recent activity keeps an otherwise-stale berth live', () => {
    const oldStart = NOW - (BERTH_IDLE_TTL_MS + 60_000);
    expect(classifyBerth(rec({ startedAt: new Date(oldStart).toISOString() }),
      { pidAlive: true, worktreeExists: true, lastActivityMs: NOW - 5_000 }, NOW)).toBe('live');
  });

  test('freshly-started quiet berth gets a grace period (startedAt counts)', () => {
    // no activity yet, but started 1 min ago → not idle.
    expect(classifyBerth(rec(), { pidAlive: true, worktreeExists: true, lastActivityMs: null }, NOW)).toBe('live');
  });

  test('dev-latest / stable are NEVER idle-reaped (standing lanes)', () => {
    const stale = NOW - (BERTH_IDLE_TTL_MS + 60_000);
    const sig = { pidAlive: true, worktreeExists: true, lastActivityMs: stale };
    expect(classifyBerth(rec({ tier: 'dev-latest', startedAt: new Date(stale).toISOString() }), sig, NOW)).toBe('live');
    // ...but a dead dev-latest is still reaped.
    expect(classifyBerth(rec({ tier: 'dev-latest' }), { ...sig, pidAlive: false }, NOW)).toBe('reap-dead');
  });

  test('shouldReap + describeVerdict', () => {
    expect(shouldReap('live')).toBe(false);
    expect(shouldReap('reap-idle')).toBe(true);
    expect(describeVerdict('reap-orphaned')).toMatch(/worktree/i);
  });
});
