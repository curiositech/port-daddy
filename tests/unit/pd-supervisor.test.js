import { describe, expect, test } from '@jest/globals';
import {
  assessOuterSupervisorIntegrity,
  assessStaleVersion,
  buildPdSupervisorProjection,
  compareReleaseVersions,
  decideRestartPolicy,
  projectCrashLedger,
} from '../../lib/pd-supervisor.js';

const supervisor = (overrides = {}) => ({
  label: 'homebrew.mxcl.port-daddy',
  loaded: true,
  running: true,
  pid: 42,
  ...overrides,
});

describe('pd-supervisor outer supervisor policy', () => {
  test('reports duplicate launchd supervisors as a warning with a targeted bootout repair', () => {
    const assessment = assessOuterSupervisorIntegrity({
      platform: 'darwin',
      daemonReachable: true,
      supervisors: [
        supervisor(),
        supervisor({ label: 'com.portdaddy.daemon', pid: 99 }),
      ],
    });

    expect(assessment.severity).toBe('warn');
    expect(assessment.detail).toContain('2 supervisors loaded');
    expect(assessment.detail).toContain('duplicate KeepAlive jobs');
    expect(assessment.repair?.command).toBe('launchctl bootout gui/$(id -u)/com.portdaddy.daemon');
  });

  test('exactly one running launchd supervisor is ok', () => {
    expect(assessOuterSupervisorIntegrity({
      platform: 'darwin',
      daemonReachable: true,
      supervisors: [supervisor()],
    }).severity).toBe('ok');
  });
});

describe('pd-supervisor crash ledger and restart policy', () => {
  test('missing crash classification is not treated as healthy', () => {
    const ledger = projectCrashLedger([
      { at: 10_000, kind: 'crash', source: 'launchd', detail: 'Trace/BPT' },
    ], { nowMs: 12_000, windowMs: 60_000 });

    expect(ledger.severity).toBe('warn');
    expect(ledger.crashCount).toBe(1);
    expect(ledger.missingClassificationCount).toBe(1);
    expect(ledger.reasons.join(' ')).toContain('missing classification');
  });

  test('suppresses duplicate restart attempts inside the backoff window', () => {
    const decision = decideRestartPolicy({
      nowMs: 10_500,
      backoffMs: 2_000,
      entries: [
        { at: 10_000, kind: 'restart-attempt', classification: 'stale-heartbeat', source: 'bosun' },
      ],
    });

    expect(decision.allowed).toBe(false);
    expect(decision.action).toBe('suppress_duplicate_restart');
    expect(decision.nextAllowedAt).toBe(12_000);
  });

  test('halts a restart loop after too many attempts in one window', () => {
    const decision = decideRestartPolicy({
      nowMs: 20_000,
      windowMs: 60_000,
      maxRestartAttemptsPerWindow: 3,
      entries: [
        { at: 1_000, kind: 'restart-attempt', classification: 'dead-pid' },
        { at: 5_000, kind: 'restart-attempt', classification: 'dead-pid' },
        { at: 9_000, kind: 'restart-attempt', classification: 'dead-pid' },
      ],
    });

    expect(decision.allowed).toBe(false);
    expect(decision.action).toBe('halt_restart_loop');
    expect(decision.recentRestartAttempts).toBe(3);
  });
});

describe('pd-supervisor stale version policy', () => {
  test('compares release versions without treating Homebrew revision suffixes as stale', () => {
    expect(compareReleaseVersions('3.24.1_1', '3.24.1')).toBe(0);
    expect(assessStaleVersion({
      berthTier: 'stable',
      runningVersion: '3.24.1_1',
      latestVersion: '3.24.1',
    })).toEqual(expect.objectContaining({ severity: 'ok', stale: false }));
  });

  test('does not flag codebase berths from the stable release feed', () => {
    const assessment = assessStaleVersion({
      berthTier: 'codebase',
      runningVersion: '3.0.0',
      latestVersion: '9.0.0',
    });

    expect(assessment.severity).toBe('ok');
    expect(assessment.stale).toBe(false);
    expect(assessment.reason).toContain('codebase');
  });

  test('flags an older stable daemon as stale only with parseable newer evidence', () => {
    expect(assessStaleVersion({
      berthTier: 'stable',
      runningVersion: '3.24.1',
      latestVersion: '3.25.0',
    })).toEqual(expect.objectContaining({ severity: 'warn', stale: true }));

    expect(assessStaleVersion({
      berthTier: 'stable',
      runningVersion: 'dev',
      latestVersion: '3.25.0',
    })).toEqual(expect.objectContaining({ severity: 'ok', stale: false }));
  });
});

describe('pd-supervisor projection', () => {
  test('folds duties into one projection while retaining Bosun as implementation history', () => {
    const projection = buildPdSupervisorProjection({
      platform: 'darwin',
      daemonReachable: true,
      supervisors: [supervisor()],
      crashLedger: [],
      runningVersion: '3.24.1',
      latestVersion: '3.24.1',
      berthTier: 'stable',
      legacyBosunPresent: true,
    });

    expect(projection.state).toBe('ready');
    expect(projection.duties).toEqual(expect.arrayContaining([
      'readiness',
      'crash-ledger',
      'restart-policy',
      'berth-health',
      'stale-version-detection',
      'duplicate-daemon-detection',
    ]));
    expect(projection.legacyBosun.role).toBe('implementation-retained');
  });
});
