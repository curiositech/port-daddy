import { describe, expect, test } from '@jest/globals';
import {
  assessRuntimeIdentity,
  parseLaunchctlPrint,
  resolveRuntimeIdentityScope,
  runCanonicalLaunchdAction,
  waitForCanonicalRuntime,
} from '../../lib/daemon-runtime.js';
import { DEFAULT_DAEMON_PORT } from '../../shared/daemon-discovery.js';

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
    expectedPort: DEFAULT_DAEMON_PORT,
    endpointPort: DEFAULT_DAEMON_PORT,
    healthPid: 4242,
    healthPort: DEFAULT_DAEMON_PORT,
    healthStatus: 'ok',
    binaryDrifted: false,
    pidFilePid: 4242,
    portFilePort: DEFAULT_DAEMON_PORT,
    supervisor,
    ...overrides,
  };
}

describe('runtime identity convergence', () => {
  test('accepts one PID and port across launchd, health, and runtime files', () => {
    const result = assessRuntimeIdentity(facts());
    expect(result.state).toBe('converged');
    expect(result.severity).toBe('ok');
    expect(result.summary).toContain('PID 4242');
    expect(result.summary).toContain(`:${DEFAULT_DAEMON_PORT}`);
  });

  test('accepts convergence when the selected and published port shifted from the preferred seed', () => {
    const shiftedPort = DEFAULT_DAEMON_PORT + 137;
    const result = assessRuntimeIdentity(facts({
      expectedPort: shiftedPort,
      endpointPort: shiftedPort,
      healthPort: shiftedPort,
      portFilePort: shiftedPort,
    }));
    expect(result.state).toBe('converged');
    expect(result.summary).toContain(`:${shiftedPort}`);
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

  test('rejects a port that disagrees with the resolved reference port', () => {
    const differentPort = DEFAULT_DAEMON_PORT + 1;
    const result = assessRuntimeIdentity(facts({
      endpointPort: differentPort,
      portFilePort: differentPort,
    }));
    expect(result.state).toBe('diverged');
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.stringContaining(`endpoint used port ${differentPort}`),
      expect.stringContaining(`daemon.port contains ${differentPort}`),
    ]));
  });

  test('marks missing identity facts incomplete instead of pretending they agree', () => {
    const result = assessRuntimeIdentity(facts({ healthPort: null, portFilePort: null }));
    expect(result.state).toBe('incomplete');
    expect(result.severity).toBe('warn');
    expect(result.missing).toEqual(expect.arrayContaining(['daemon advertised port', 'daemon.port']));
  });

  test('fails incomplete instead of guessing when no reference port was published', () => {
    const result = assessRuntimeIdentity(facts({ expectedPort: null }));
    expect(result.state).toBe('incomplete');
    expect(result.missing).toContain('published port (daemon.port)');
  });
});

describe('runtime identity scope', () => {
  test('keeps production files and supervisor strict while following the selected endpoint', () => {
    expect(resolveRuntimeIdentityScope({
      plane: 'prod',
      daemon: { port: 19890, canonical: true },
    }, {
      endpointPort: 19890,
      runtimePrefix: '/work/isolated',
      canonicalSupervisor: supervisor,
    })).toEqual({
      expectedPort: 19890,
      pidFile: expect.stringMatching(/\.port-daddy\/daemon\.pid$/),
      portFile: expect.stringMatching(/\.port-daddy\/daemon\.port$/),
      supervisor,
    });
  });

  test('moves port, files, and supervisor together for an ephemeral runtime', () => {
    expect(resolveRuntimeIdentityScope({
      plane: 'ephemeral:pd-doctor-gate',
      daemon: { port: 19890, canonical: true },
    }, {
      endpointPort: 19890,
      runtimePrefix: '/work/pd-doctor-gate',
      canonicalSupervisor: supervisor,
    })).toEqual({
      expectedPort: 19890,
      pidFile: '/work/pd-doctor-gate/daemon.pid',
      portFile: '/work/pd-doctor-gate/daemon.port',
      supervisor: null,
    });
  });

  test('uses the legacy canonical flag only when state-plane identity is absent', () => {
    expect(resolveRuntimeIdentityScope({ daemon: { canonical: false } }, {
      endpointPort: 9886,
      runtimePrefix: '/work/dev-latest',
      canonicalSupervisor: supervisor,
    }).expectedPort).toBe(9886);
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
    const health = { status: 'ok', pid: 5151, daemon: { port: DEFAULT_DAEMON_PORT }, binaryDrift: { drifted: false } };
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
        supervisor: { ...supervisor, pid: 5151 },
      })),
    });
    expect(result.state).toBe('converged');
    expect(result.facts.healthPid).toBe(5151);
    expect(probes).toBeGreaterThanOrEqual(2);
  });
});
