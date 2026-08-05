import { describe, expect, test, afterAll } from '@jest/globals';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  assessRuntimeIdentity,
  collectRuntimeIdentity,
  parseLaunchctlPrint,
  probeCanonicalHealth,
  readPublishedPidFile,
  readPublishedPortFile,
  resolveProbeEndpoint,
  resolveRuntimeIdentityScope,
  runCanonicalLaunchdAction,
  waitForCanonicalRuntime,
} from '../../lib/daemon-runtime.js';

// CLAUDE.md hard rule: never scratch to /tmp. Use ~/coding/tmp.
const scratchRoots = [];
function scratchDir(prefix) {
  const base = join(homedir(), 'coding', 'tmp');
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, prefix));
  scratchRoots.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratchRoots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

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
    supervisor,
    ...overrides,
  };
}

describe('runtime identity convergence', () => {
  test('accepts one PID and one port across launchd, health, and both runtime files', () => {
    const result = assessRuntimeIdentity(facts());
    expect(result.state).toBe('converged');
    expect(result.severity).toBe('ok');
    expect(result.summary).toContain('PID 4242');
    expect(result.summary).toContain(':9876');
  });

  test('accepts convergence at a shifted port when the preferred seed was occupied', () => {
    // The stable daemon bound away from its usual 9876 seed; every authority
    // agrees on the SHIFTED port it actually published, so this still converges.
    const result = assessRuntimeIdentity(facts({
      expectedPort: 19_991,
      endpointPort: 19_991,
      healthPort: 19_991,
      portFilePort: 19_991,
    }));
    expect(result.state).toBe('converged');
    expect(result.summary).toContain(':19991');
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

  test('rejects a fallback port that disagrees with the resolved reference port', () => {
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

  test('marks missing legacy identity facts incomplete instead of pretending they agree', () => {
    const result = assessRuntimeIdentity(facts({ healthPort: null, portFilePort: null }));
    expect(result.state).toBe('incomplete');
    expect(result.severity).toBe('warn');
    expect(result.missing).toEqual(expect.arrayContaining(['daemon advertised port', 'daemon.port']));
  });

  test('fails closed when no published or selected port could be resolved at all', () => {
    const result = assessRuntimeIdentity(facts({ expectedPort: null }));
    expect(result.state).toBe('incomplete');
    expect(result.missing).toEqual(expect.arrayContaining(['published port (daemon.port)']));
    // With no reference port, the per-port comparisons must not fabricate issues.
    expect(result.issues.some((issue) => issue.includes('expected'))).toBe(false);
  });

  test('never reads, models, requires, or mentions a Bosun heartbeat', () => {
    const result = assessRuntimeIdentity(facts());
    expect(Object.keys(result.facts)).not.toContain('heartbeatPid');
    expect(Object.keys(result.facts)).not.toContain('heartbeatFresh');
    expect(Object.keys(result.facts)).not.toContain('heartbeatWrittenAt');
    expect(JSON.stringify(result)).not.toMatch(/bosun/i);
  });
});

describe('strict whole-file publication reading', () => {
  const dir = scratchDir('daemon-runtime-strict-');

  function write(name, content) {
    const path = join(dir, name);
    writeFileSync(path, content);
    return path;
  }

  test('reads a clean whole-file port', () => {
    const result = readPublishedPortFile(write('port-ok', '19876\n'));
    expect(result).toEqual({ ok: true, value: 19_876, path: expect.any(String), error: null });
  });

  test('reads a clean whole-file pid', () => {
    const result = readPublishedPidFile(write('pid-ok', '4242'));
    expect(result.ok).toBe(true);
    expect(result.value).toBe(4242);
  });

  test('rejects a missing publication file, actionably', () => {
    const result = readPublishedPortFile(join(dir, 'does-not-exist'));
    expect(result.ok).toBe(false);
    expect(result.value).toBeNull();
    expect(result.error).toMatch(/not published/);
  });

  test('rejects an empty publication file', () => {
    const result = readPublishedPortFile(write('port-empty', ''));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not published/);
  });

  test('rejects malformed non-numeric content', () => {
    const result = readPublishedPortFile(write('port-malformed', 'not-a-port\n'));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/malformed/);
  });

  test('rejects a partially-overwritten file with two whole numbers concatenated', () => {
    // Simulates a torn, non-atomic overwrite of a longer old value by a
    // shorter new one (or vice versa) leaving trailing content behind.
    const result = readPublishedPortFile(write('port-partial', '9876\n9877'));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/malformed/);
  });

  test('rejects a port value that overflows the valid TCP range', () => {
    const result = readPublishedPortFile(write('port-overflow', '70000'));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/out of range/);
  });

  test('rejects an absurdly large integer beyond safe-integer range', () => {
    const result = readPublishedPortFile(write('port-huge', '99999999999999999999999999'));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/out of range/);
  });

  test('rejects a negative or signed value', () => {
    const result = readPublishedPortFile(write('port-negative', '-9876'));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/malformed/);
  });

  test('tolerates surrounding whitespace around an otherwise clean value', () => {
    const result = readPublishedPortFile(write('port-padded', '  9876  \n'));
    expect(result.ok).toBe(true);
    expect(result.value).toBe(9876);
  });
});

describe('runtime identity scope', () => {
  test('moves the expected port with the selected endpoint even for the canonical production scope', () => {
    // The stable daemon relocated off its preferred seed; production stays
    // strict about FILES and SUPERVISOR, but the expected port must follow
    // wherever it actually published, never a fixed constant.
    expect(resolveRuntimeIdentityScope({
      plane: 'prod',
      daemon: { port: 19_890, canonical: true },
    }, {
      endpointPort: 19_890,
      runtimePrefix: '/work/isolated',
      canonicalSupervisor: supervisor,
    })).toEqual({
      expectedPort: 19_890,
      pidFile: expect.stringMatching(/\.port-daddy\/daemon\.pid$/),
      portFile: expect.stringMatching(/\.port-daddy\/daemon\.port$/),
      supervisor,
    });
  });

  test('moves port, files, and supervisor together for an ephemeral runtime, isolated from launchd', () => {
    expect(resolveRuntimeIdentityScope({
      plane: 'ephemeral:pd-doctor-gate',
      daemon: { port: 19_890, canonical: true },
    }, {
      endpointPort: 19_890,
      runtimePrefix: '/work/pd-doctor-gate',
      canonicalSupervisor: supervisor,
    })).toEqual({
      expectedPort: 19_890,
      pidFile: '/work/pd-doctor-gate/daemon.pid',
      portFile: '/work/pd-doctor-gate/daemon.port',
      supervisor: null,
    });
  });

  test('never wires launchd into a named runtime scope even when a canonical supervisor is supplied', () => {
    const scope = resolveRuntimeIdentityScope({ plane: 'named:feature-x' }, {
      endpointPort: 20_010,
      runtimePrefix: '/work/feature-x',
      canonicalSupervisor: supervisor,
    });
    expect(scope.supervisor).toBeNull();
    expect(scope.pidFile.startsWith('/work/feature-x')).toBe(true);
    expect(scope.portFile.startsWith('/work/feature-x')).toBe(true);
  });

  test('uses the legacy canonical flag only when state-plane identity is absent', () => {
    expect(resolveRuntimeIdentityScope({ daemon: { canonical: false } }, {
      endpointPort: 9886,
      runtimePrefix: '/work/dev-latest',
      canonicalSupervisor: supervisor,
    }).expectedPort).toBe(9886);
  });

  test('never returns a heartbeat file for any scope', () => {
    const scope = resolveRuntimeIdentityScope({ plane: 'prod' }, {
      endpointPort: 9876,
      canonicalSupervisor: supervisor,
    });
    expect(scope).not.toHaveProperty('heartbeatFile');
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

describe('published-endpoint probing', () => {
  const dir = scratchDir('daemon-runtime-probe-');

  test('an explicit injected endpoint is used and the published port file is never consulted', async () => {
    const badPortFile = join(dir, 'malformed-port');
    writeFileSync(badPortFile, 'not-a-port');
    const calls = [];
    const health = await probeCanonicalHealth({
      endpoint: { port: 20_500 },
      portFile: badPortFile,
      requestHealth: async (endpoint, timeoutMs) => {
        calls.push({ endpoint, timeoutMs });
        return { status: 'ok', pid: 777, daemon: { port: 20_500 } };
      },
    });
    expect(calls).toEqual([{ endpoint: { host: '127.0.0.1', port: 20_500 }, timeoutMs: 1_500 }]);
    expect(health).toEqual({ status: 'ok', pid: 777, daemon: { port: 20_500 } });
  });

  test('resolveProbeEndpoint discovers the published port from a strict file read when no endpoint is injected', () => {
    const portFile = join(dir, 'good-port');
    writeFileSync(portFile, '21001');
    expect(resolveProbeEndpoint({ portFile })).toEqual({ host: '127.0.0.1', port: 21_001 });
  });

  test('resolveProbeEndpoint prefers an explicit endpoint over a valid published file', () => {
    const portFile = join(dir, 'good-port-2');
    writeFileSync(portFile, '21001');
    expect(resolveProbeEndpoint({ endpoint: { port: 30_030 }, portFile })).toEqual({
      host: '127.0.0.1',
      port: 30_030,
    });
  });

  test('fails closed with no network attempt when the port file is missing', async () => {
    const calls = [];
    const health = await probeCanonicalHealth({
      portFile: join(dir, 'never-written'),
      requestHealth: async (endpoint, timeoutMs) => {
        calls.push({ endpoint, timeoutMs });
        return { status: 'ok', pid: 1 };
      },
    });
    expect(health).toBeNull();
    expect(calls).toEqual([]);
  });

  test('fails closed with no network attempt when the port file is malformed', async () => {
    const portFile = join(dir, 'malformed-port-2');
    writeFileSync(portFile, 'garbage');
    const calls = [];
    const health = await probeCanonicalHealth({
      portFile,
      requestHealth: async (endpoint, timeoutMs) => {
        calls.push({ endpoint, timeoutMs });
        return { status: 'ok', pid: 1 };
      },
    });
    expect(health).toBeNull();
    expect(calls).toEqual([]);
  });

  test('never falls back to a fixed target port', () => {
    // No endpoint, no portFile at all — must resolve null, not e.g. 9876.
    expect(resolveProbeEndpoint()).toBeNull();
  });
});

describe('collectRuntimeIdentity', () => {
  const dir = scratchDir('daemon-runtime-collect-');

  test('discovers expectedPort from a strict published port file when none is supplied', () => {
    const pidFile = join(dir, 'daemon.pid');
    const portFile = join(dir, 'daemon.port');
    writeFileSync(pidFile, '4242');
    writeFileSync(portFile, '22002');
    const result = collectRuntimeIdentity(
      { status: 'ok', pid: 4242, daemon: { port: 22_002 }, binaryDrift: { drifted: false } },
      { endpointPort: 22_002, pidFile, portFile, supervisor: null },
    );
    expect(result.facts.expectedPort).toBe(22_002);
    expect(result.state).toBe('converged');
  });

  test('reports incomplete with an actionable reason when the port file is missing entirely', () => {
    const result = collectRuntimeIdentity(
      { status: 'ok', pid: 4242, daemon: { port: 22_003 }, binaryDrift: { drifted: false } },
      { endpointPort: 22_003, pidFile: join(dir, 'missing.pid'), portFile: join(dir, 'missing.port'), supervisor: null },
    );
    expect(result.state).toBe('incomplete');
    expect(result.missing).toEqual(expect.arrayContaining(['daemon.pid', 'daemon.port']));
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
        supervisor: { ...supervisor, pid: 5151 },
      })),
    });
    expect(result.state).toBe('converged');
    expect(result.facts.healthPid).toBe(5151);
    expect(probes).toBeGreaterThanOrEqual(2);
  });
});
