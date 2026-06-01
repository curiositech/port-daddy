/**
 * Unit tests for lib/fleet-running-state.ts
 *
 * Asserts that the resolver correctly classifies the three fleet-running
 * regimes (none / standalone-fork / daemon-supervised) and produces honest
 * descriptions even when agents are "armed" but not actively executing.
 */

import {
  describeFleetRunningState,
  resolveFleetRunningState,
} from '../../lib/fleet-running-state.js';

function makeStandalone({ statePidByCwd = {}, alivePids = new Set() } = {}) {
  return {
    readState(cwd) {
      const pid = statePidByCwd[cwd];
      return pid ? { pid, name: 'standalone-test' } : null;
    },
    isPidAlive(pid) {
      return alivePids.has(pid);
    },
  };
}

describe('resolveFleetRunningState', () => {
  test('returns none when no state file and no daemon record', () => {
    const state = resolveFleetRunningState({
      cwd: '/repo',
      standalone: makeStandalone(),
      daemonFleetStatus: { running: false, fleets: [] },
    });
    expect(state.running).toBe(false);
    expect(state.source).toBe('none');
  });

  test('returns standalone-fork when state file PID is alive and daemon has nothing', () => {
    const state = resolveFleetRunningState({
      cwd: '/repo',
      standalone: makeStandalone({ statePidByCwd: { '/repo': 4242 }, alivePids: new Set([4242]) }),
      daemonFleetStatus: { running: true, fleets: [] },
    });
    expect(state.running).toBe(true);
    expect(state.source).toBe('standalone-fork');
    expect(state.pid).toBe(4242);
    expect(state.name).toBe('standalone-test');
  });

  test('treats dead PID in state file as not-running (no zombie)', () => {
    const state = resolveFleetRunningState({
      cwd: '/repo',
      standalone: makeStandalone({ statePidByCwd: { '/repo': 9999 }, alivePids: new Set() }),
      daemonFleetStatus: null,
    });
    expect(state.running).toBe(false);
    expect(state.source).toBe('none');
  });

  test('returns daemon-supervised when daemon registers the cwd as a fleet', () => {
    const state = resolveFleetRunningState({
      cwd: '/repo',
      standalone: makeStandalone(),
      daemonFleetStatus: {
        running: true,
        fleets: [
          {
            project: 'port-daddy',
            projectDir: '/repo',
            running: true,
            agents: [
              { status: 'armed', running: false },
              { status: 'armed', running: false },
              { status: 'running', running: true },
              { status: 'paused', paused: true },
            ],
          },
        ],
      },
    });

    expect(state.running).toBe(true);
    expect(state.source).toBe('daemon-supervised');
    expect(state.name).toBe('port-daddy');
    expect(state.projectDir).toBe('/repo');
    expect(state.agentCounts).toEqual({
      total: 4,
      armed: 2,
      running: 1,
      paused: 1,
      failed: 0,
      idle: 0,
    });
  });

  test('does NOT report the canonical "fleet stopped" lie when daemon supervises with armed agents', () => {
    // Regression: the previous CLI returned `not running` whenever
    // .portdaddy/fleet-state.json was missing, even though the always-on
    // daemon was actively supervising 8 armed agents waiting on triggers.
    // This test pins the corrected behavior.
    const state = resolveFleetRunningState({
      cwd: '/repo/port-daddy',
      standalone: makeStandalone(),
      daemonFleetStatus: {
        running: true,
        fleets: [
          {
            project: 'port-daddy',
            projectDir: '/repo/port-daddy',
            running: true,
            agents: Array.from({ length: 8 }, () => ({ status: 'armed' })),
          },
        ],
      },
    });

    expect(state.running).toBe(true);
    expect(state.source).toBe('daemon-supervised');
    expect(state.agentCounts.armed).toBe(8);
  });

  test('prefers daemon-supervised over standalone-fork when both claim ownership', () => {
    // The daemon is the source of truth during the migration window: if a
    // user accidentally still has an old state-file lying around AND the
    // daemon has the fleet registered, render the daemon view.
    const state = resolveFleetRunningState({
      cwd: '/repo',
      standalone: makeStandalone({ statePidByCwd: { '/repo': 100 }, alivePids: new Set([100]) }),
      daemonFleetStatus: {
        running: true,
        fleets: [{ project: 'port-daddy', projectDir: '/repo', running: true, agents: [] }],
      },
    });
    expect(state.source).toBe('daemon-supervised');
    expect(state.pid).toBeNull();
  });

  test('ignores daemon fleets whose projectDir does not match cwd', () => {
    const state = resolveFleetRunningState({
      cwd: '/repo/a',
      standalone: makeStandalone(),
      daemonFleetStatus: {
        running: true,
        fleets: [{ project: 'other', projectDir: '/repo/b', running: true, agents: [] }],
      },
    });
    expect(state.running).toBe(false);
  });

  test('skips daemon fleets explicitly marked running:false', () => {
    const state = resolveFleetRunningState({
      cwd: '/repo',
      standalone: makeStandalone(),
      daemonFleetStatus: {
        running: true,
        fleets: [{ project: 'port-daddy', projectDir: '/repo', running: false, agents: [] }],
      },
    });
    expect(state.running).toBe(false);
  });

  test('survives a null daemonFleetStatus (daemon unreachable)', () => {
    const state = resolveFleetRunningState({
      cwd: '/repo',
      standalone: makeStandalone({ statePidByCwd: { '/repo': 1 }, alivePids: new Set([1]) }),
      daemonFleetStatus: null,
    });
    expect(state.running).toBe(true);
    expect(state.source).toBe('standalone-fork');
  });
});

describe('describeFleetRunningState', () => {
  test('renders the canonical "armed waiting for trigger" copy', () => {
    const description = describeFleetRunningState({
      running: true,
      source: 'daemon-supervised',
      pid: null,
      name: 'port-daddy',
      projectDir: '/repo',
      agentCounts: { total: 8, armed: 8, running: 0, paused: 0, failed: 0, idle: 0 },
    });
    expect(description).toBe('running (daemon-supervised) · 8 armed');
  });

  test('renders mixed agent states', () => {
    const description = describeFleetRunningState({
      running: true,
      source: 'daemon-supervised',
      pid: null,
      name: 'port-daddy',
      projectDir: '/repo',
      agentCounts: { total: 5, armed: 2, running: 1, paused: 1, failed: 1, idle: 0 },
    });
    expect(description).toBe('running (daemon-supervised) · 1 running · 2 armed · 1 paused · 1 failed');
  });

  test('renders standalone-fork with PID', () => {
    const description = describeFleetRunningState({
      running: true,
      source: 'standalone-fork',
      pid: 4242,
      name: null,
      projectDir: '/repo',
      agentCounts: null,
    });
    expect(description).toBe('running (standalone, PID 4242)');
  });

  test('renders not-running as a plain string', () => {
    const description = describeFleetRunningState({
      running: false,
      source: 'none',
      pid: null,
      name: null,
      projectDir: null,
      agentCounts: null,
    });
    expect(description).toBe('not running');
  });
});
