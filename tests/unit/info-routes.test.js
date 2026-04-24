import { describe, expect, test } from '@jest/globals';
import Fastify from 'fastify';
import { infoPlugin } from '../../routes/info.js';

function buildDeps(overrides = {}) {
  return {
    metrics: {
      errors: 0,
      total_assignments: 3,
      total_releases: 1,
      uptime_start: Date.now() - 5_000,
    },
    services: {
      find() {
        return { success: true, services: [] };
      },
      count() {
        return 2;
      },
      claim() {
        return { success: true, port: 3100 };
      },
      release() {
        return { success: true, released: 1 };
      },
    },
    config: {
      ports: {
        range_start: 3100,
        range_end: 3199,
      },
    },
    VERSION: '9.9.9',
    CODE_HASH: 'abc123',
    STARTED_AT: 1_700_000_000_000,
    __dirname: '/tmp/port-daddy',
    cleanupStale() {
      return [];
    },
    getSystemPorts() {
      return [];
    },
    activityLog: {
      getRecent() {
        return {
          success: true,
          count: 1,
          entries: [
            {
              id: 42,
              timestamp: 1_700_000_111_000,
              type: 'SESSION_NOTE',
              agentId: 'spark',
              targetId: 'session-1',
              details: 'Spark noted a daemon regression',
            },
          ],
        };
      },
    },
    costTracker: {
      recent() {
        return [
          {
            id: 'cost-1',
            ts: 1_700_000_112_000,
            backend: 'codex',
            model: 'gpt-5.3-codex',
            projectName: 'alpha',
            projectDir: '/repo/alpha',
            costUsd: 0.12,
            isEstimate: false,
          },
        ];
      },
    },
    barnacle: {
      getStatus() {
        return {
          monitoredUrl: 'http://localhost:9875/health',
          binaryPath: '/tmp/pd-barnacle',
          binaryExists: true,
          enabled: true,
          state: 'healthy',
          reason: null,
          lastCheckAt: 1_700_000_113_000,
          lastHealthyAt: 1_700_000_113_000,
          lastFailureAt: null,
          lastResurrectedAt: null,
          failureCount: 0,
        };
      },
    },
    ...overrides,
  };
}

function buildArbiterStatus() {
  return {
    active: true,
    strictMode: false,
    enforcerLoaded: false,
    rulesCount: 6,
    rules: [
      'PID_SQUATTING',
      'CAP_ESCALATION',
      'NOTE_MONOTONICITY',
      'ESCROW_POSITIVE',
      'LOCK_OWNER_VALID',
      'HEARTBEAT_FRESHNESS',
    ],
    ruleDetails: [
      { name: 'PID_SQUATTING', coverage: 'enforced' },
      { name: 'CAP_ESCALATION', coverage: 'degraded' },
      { name: 'NOTE_MONOTONICITY', coverage: 'enforced' },
      { name: 'ESCROW_POSITIVE', coverage: 'stubbed' },
      { name: 'LOCK_OWNER_VALID', coverage: 'enforced' },
      { name: 'HEARTBEAT_FRESHNESS', coverage: 'enforced' },
    ],
    summary: {
      state: 'degraded',
      mode: 'observe_only',
      criticalAction: 'log_only',
      enforcedRules: 4,
      degradedRules: 1,
      stubbedRules: 1,
    },
    degraded: [
      {
        code: 'strict_mode_disabled',
        component: 'arbiter',
        affectedRules: ['PID_SQUATTING', 'CAP_ESCALATION', 'NOTE_MONOTONICITY'],
        message: 'Critical arbiter violations are logged but do not trigger man-overboard while strictMode is false.',
      },
      {
        code: 'ffi_enforcer_unavailable',
        component: 'arbiter',
        affectedRules: ['CAP_ESCALATION'],
        message: 'Capability escalation checks cannot validate capability subsets without the Rust enforcer.',
      },
      {
        code: 'escrow_rule_stubbed',
        component: 'arbiter',
        affectedRules: ['ESCROW_POSITIVE'],
        message: 'Escrow positivity remains a placeholder until Float Plans / escrow-backed sessions exist.',
      },
    ],
    violationsCount: 0,
    uptimeMs: 1234,
    startedAt: 1_700_000_000_000,
  };
}

describe('info routes runtime summary', () => {
  test('GET /health includes consolidated runtime truth without marking the daemon unhealthy', async () => {
    const app = Fastify();
    await app.register(infoPlugin, {
      deps: buildDeps({
        arbiter: {
          getStatus() {
            return buildArbiterStatus();
          },
        },
        fleetDaemon: {
          getStatus() {
            return {
              running: true,
              startedAt: 1_700_000_000_000,
              fleets: [{ project: 'alpha', projectDir: '/repo/alpha', running: true, agents: [], watchers: 1, channels: 2, startedAt: 1_700_000_000_000 }],
              skipped: [{ project: 'beta', projectDir: '/repo/beta', reason: 'duplicate', owner: 'fleetd:test' }],
              totalAgents: 4,
              totalWatchers: 1,
            };
          },
        },
      }),
    });

    const res = await app.inject({ method: 'GET', url: '/health' });
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.runtime).toEqual(expect.objectContaining({
      state: 'degraded',
      degraded: true,
      arbiter: expect.objectContaining({
        mode: 'observe_only',
        strictMode: false,
        rules: expect.objectContaining({
          total: 6,
          enforced: 4,
          degraded: 1,
          stubbed: 1,
        }),
      }),
      fleet: expect.objectContaining({
        running: true,
        projects: 1,
        skippedProjects: 1,
        totalAgents: 4,
      }),
    }));
    expect(body.fleet).toEqual(expect.objectContaining({
      running: true,
      projects: 1,
      agents: 4,
      watchers: 1,
      skippedProjects: 1,
    }));
    await app.close();
  });

  test('GET /status exposes skipped fleet details alongside runtime trust data', async () => {
    const app = Fastify();
    await app.register(infoPlugin, {
      deps: buildDeps({
        arbiter: {
          getStatus() {
            return buildArbiterStatus();
          },
        },
        fleetDaemon: {
          getStatus() {
            return {
              running: true,
              startedAt: 1_700_000_000_000,
              fleets: [
                {
                  project: 'alpha',
                  projectDir: '/repo/alpha',
                  running: true,
                  agents: [{ name: 'watcher', type: 'agent', status: 'idle', running: true, paused: false, uptime: 10, queueDepth: 0 }],
                  watchers: 1,
                  channels: 2,
                  startedAt: 1_700_000_000_000,
                },
              ],
              skipped: [{ project: 'beta', projectDir: '/repo/beta', reason: 'duplicate', owner: 'fleetd:test' }],
              totalAgents: 1,
              totalWatchers: 1,
            };
          },
        },
      }),
    });

    const res = await app.inject({ method: 'GET', url: '/status' });
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.runtime).toEqual(expect.objectContaining({
      state: 'degraded',
      reasons: expect.arrayContaining([
        expect.objectContaining({ code: 'strict_mode_disabled' }),
        expect.objectContaining({ code: 'escrow_rule_stubbed' }),
      ]),
    }));
    expect(body.fleet).toEqual(expect.objectContaining({
      running: true,
      totalAgents: 1,
      totalWatchers: 1,
      skippedProjects: expect.arrayContaining([
        expect.objectContaining({
          project: 'beta',
          projectDir: '/repo/beta',
          reason: 'duplicate',
        }),
      ]),
    }));
    expect(body.daemon).toEqual(expect.objectContaining({
      version: '9.9.9',
      codeHash: 'abc123',
      installDir: '/tmp/port-daddy',
    }));
    expect(body.guardians).toEqual(expect.objectContaining({
      supervisor: expect.objectContaining({ state: 'launchctl_preferred' }),
      bosun: expect.objectContaining({
        state: 'healthy',
        binaryExists: true,
      }),
      barnacle: expect.objectContaining({
        state: 'healthy',
        binaryExists: true,
      }),
    }));
    expect(body.guardians.barnacle).toEqual(body.guardians.bosun);
    expect(body.history.recentActivity[0]).toEqual(expect.objectContaining({
      type: 'SESSION_NOTE',
      summary: 'Spark noted a daemon regression',
    }));

    await app.close();
  });
});
