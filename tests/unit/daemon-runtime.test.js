import { describe, expect, test } from '@jest/globals';
import {
  assessRuntimeIdentity,
  parseLaunchctlPrint,
  runCanonicalLaunchdAction,
  waitForCanonicalRuntime,
} from '../../lib/daemon-runtime.js';

const supervisor = {
  label: 'homebrew.mxcl.port-daddy',
  target: 'gui/501/homebrew.mxcl.port-daddy',
  plistPath: '/Users/me/Library/LaunchAgents/homebrew.mxcl.port-daddy.plist',
  installed: true,
  loaded: true,
  running: true,
  pid: 4242,
  state: 'running',
  error: null,
};

function facts(overrides = {}) {
  return {
    checkedAt: 100_000,
    expectedPort: 9876,
    endpointPort: 9876,
    healthPid: 4242,
    healthPort: 9876,
    healthStatus: 'ok',
    binaryDrifted: false,
    pidFilePid: 4242,
    portFilePort: 9876,
    heartbeatPid: 4242,
    heartbeatWrittenAt: 99_000,
    heartbeatFresh: true,
    supervisor,
    ...overrides,
  };
}

describe('runtime identity convergence', () => {
  test('accepts one PID and port across launchd, health, files, and Bosun', () => {
    const result = assessRuntimeIdentity(facts());
    expect(result.state).toBe('converged');
    expect(result.severity).toBe('ok');
    expect(result.summary).toContain('PID 4242');
    expect(result.summary).toContain(':9876');
  });

  test('rejects the exact split brain where launchd and the listener have different PIDs', () => {
    const result = assessRuntimeIdentity(facts({
      supervisor: { ...supervisor, pid: 9001 },
    }));
    expect(result.state).toBe('diverged');
    expect(result.severity).toBe('critical');
    expect(result.summary).toContain('pid=9001');
    expect(result.summary).toContain('/health pid=4242');
  });

  test('rejects a fallback port that disagrees with the canonical contract', () => {
    const result = assessRuntimeIdentity(facts({
      endpointPort: 9877,
      healthPort: 9876,
      portFilePort: 9877,
    }));
    expect(result.state).toBe('diverged');
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.stringContaining('endpoint used port 9877'),
      expect.stringContaining('daemon.port contains 9877'),
    ]));
  });

  test('rejects a stale Bosun heartbeat even when every PID still matches', () => {
    const result = assessRuntimeIdentity(facts({ heartbeatFresh: false }));
    expect(result.state).toBe('diverged');
    expect(result.summary).toContain('heartbeat is stale');
  });

  test('marks missing legacy identity facts incomplete instead of pretending they agree', () => {
    const result = assessRuntimeIdentity(facts({ healthPort: null, heartbeatPid: null, heartbeatFresh: null }));
    expect(result.state).toBe('incomplete');
    expect(result.severity).toBe('warn');
    expect(result.missing).toEqual(expect.arrayContaining(['daemon advertised port', 'Bosun heartbeat']));
  });
});

describe('launchd ownership', () => {
  test('parses the launchd-owned PID and verifies liveness', () => {
    const parsed = parseLaunchctlPrint(`gui/501/homebrew.mxcl.port-daddy = {
      state = running
      runs = 14
      pid = 4242
    }`, { home: '/Users/me', uid: 501, pidAlive: () => true });
    expect(parsed.loaded).toBe(true);
    expect(parsed.running).toBe(true);
    expect(parsed.pid).toBe(4242);
    expect(parsed.target).toBe('gui/501/homebrew.mxcl.port-daddy');
  });

  test('restart is one kickstart transaction, never a detached spawn', () => {
    const calls = [];
    const result = runCanonicalLaunchdAction('restart', supervisor, (args) => {
      calls.push(args);
      return { status: 0, stdout: '', stderr: '' };
    });
    expect(result.status).toBe(0);
    expect(calls).toEqual([['kickstart', '-k', 'gui/501/homebrew.mxcl.port-daddy']]);
  });

  test('start bootstraps the installed plist when the job was deliberately stopped', () => {
    const calls = [];
    runCanonicalLaunchdAction('start', { ...supervisor, loaded: false, running: false, pid: null }, (args) => {
      calls.push(args);
      return { status: 0, stdout: '', stderr: '' };
    });
    expect(calls).toEqual([[
      'bootstrap',
      'gui/501',
      '/Users/me/Library/LaunchAgents/homebrew.mxcl.port-daddy.plist',
    ]]);
  });

  test('refuses to manufacture a detached fallback when the canonical plist is missing', () => {
    const calls = [];
    const result = runCanonicalLaunchdAction(
      'start',
      { ...supervisor, installed: false, loaded: false, running: false, pid: null },
      (args) => {
        calls.push(args);
        return { status: 0, stdout: '', stderr: '' };
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/launchd plist is missing/);
    expect(calls).toEqual([]);
  });
});

describe('readiness wait', () => {
  test('requires a replacement PID and two stable converged samples', async () => {
    let probes = 0;
    const health = { status: 'ok', pid: 5151, daemon: { port: 9876 }, binaryDrift: { drifted: false } };
    const result = await waitForCanonicalRuntime({
      previousPid: 4242,
      timeoutMs: 100,
      pollIntervalMs: 0,
      stableSamples: 2,
      probeHealth: async () => {
        probes += 1;
        return health;
      },
      inspectSupervisor: () => ({ ...supervisor, pid: 5151 }),
      collect: () => assessRuntimeIdentity(facts({
        healthPid: 5151,
        pidFilePid: 5151,
        heartbeatPid: 5151,
        supervisor: { ...supervisor, pid: 5151 },
      })),
    });
    expect(result.state).toBe('converged');
    expect(result.facts.healthPid).toBe(5151);
    expect(probes).toBeGreaterThanOrEqual(2);
  });
});
