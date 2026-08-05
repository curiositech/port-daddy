import { describe, expect, test } from '@jest/globals';
import Fastify from 'fastify';
import { infoPlugin } from '../../routes/info.js';
import { createTestDb } from '../setup-unit.js';
import { createTranscripts } from '../../lib/transcripts.js';

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
              totalLaunchableAgents: 2,
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
        launchableAgents: 2,
      }),
    }));
    expect(body.fleet).toEqual(expect.objectContaining({
      running: true,
      projects: 1,
      agents: 4,
      watchers: 1,
      launchableAgents: 2,
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
                  launchableAgents: 0,
                  blockedAgents: [
                    { agent: 'watcher', backend: 'ollama', reason: 'Ollama is blocked until telemetry is exact.' },
                  ],
                },
              ],
              skipped: [{ project: 'beta', projectDir: '/repo/beta', reason: 'duplicate', owner: 'fleetd:test' }],
              totalAgents: 1,
              totalWatchers: 1,
              totalLaunchableAgents: 0,
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
      totalLaunchableAgents: 0,
      launchableAgents: 0,
      totalAgents: 1,
      totalWatchers: 1,
      projects: expect.arrayContaining([
        expect.objectContaining({
          name: 'alpha',
          launchableAgents: 0,
          blockedAgents: [
            expect.objectContaining({ agent: 'watcher', backend: 'ollama' }),
          ],
        }),
      ]),
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
      supervisor: expect.objectContaining({ state: expect.stringMatching(/launchd|systemd|process/) }),
      runtime: expect.objectContaining({
        state: 'disabled',
        reason: 'daemon heartbeat writer unavailable',
      }),
    }));
    expect(body.guardians).not.toHaveProperty('barnacle');
    expect(body.history.recentActivity[0]).toEqual(expect.objectContaining({
      type: 'SESSION_NOTE',
      summary: 'Spark noted a daemon regression',
    }));

    await app.close();
  });

  test('GET /health raises a transcript HITL issue when a live run stalls', async () => {
    const db = createTestDb();
    const transcripts = createTranscripts(db);
    const startedAt = Date.now() - 120_000;
    const id = transcripts.start({
      ship: 'spawn:cli:codex',
      spawned_agent_id: 'spawned-health-stalled',
      trigger: 'manual',
      backend: 'cli:codex',
      model: 'codex-cli',
      started_at: startedAt,
    });
    transcripts.appendMessage(id, {
      role: 'assistant',
      content: 'stale heartbeat proof',
      timestamp: startedAt,
    });

    const app = Fastify();
    await app.register(infoPlugin, {
      deps: buildDeps({
        transcripts,
        spawner: {
          list() {
            return [{
              agentId: 'spawned-health-stalled',
              backend: 'cli:codex',
              status: 'running',
              startedAt,
              completedAt: null,
            }];
          },
        },
      }),
    });

    const res = await app.inject({ method: 'GET', url: '/health' });
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.runtime.transcripts).toEqual(expect.objectContaining({
      state: 'degraded',
      hitlEmergency: true,
      degradedRuns: 1,
      liveRuns: 1,
    }));
    expect(body.runtime.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'transcript_flow_stalled',
        component: 'transcripts',
        requiresHitl: true,
        agentId: 'spawned-health-stalled',
      }),
    ]));

    await app.close();
    db.close();
  });

  test('GET /status exposes daemon heartbeat without a Barnacle compatibility alias', async () => {
    const app = Fastify();
    await app.register(infoPlugin, {
      deps: buildDeps({
        daemonHeartbeat: {
          getStatus() {
            return {
              enabled: true,
              state: 'healthy',
              heartbeatPath: '/tmp/port-daddy/heartbeat',
              intervalMs: 5000,
              staleAfterMs: 30000,
              lastWrittenAt: 1_700_000_114_000,
              lastError: null,
              writeCount: 2,
              pid: 4242,
            };
          },
        },
      }),
    });

    const res = await app.inject({ method: 'GET', url: '/status' });
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.guardians.runtime).toEqual(expect.objectContaining({
      state: 'idle',
      monitoredUrl: 'file:///tmp/port-daddy/heartbeat',
      reason: 'daemon heartbeat is publishing runtime evidence',
      heartbeat: expect.objectContaining({
        heartbeatPath: '/tmp/port-daddy/heartbeat',
        staleAfterMs: 30000,
        writeCount: 2,
      }),
    }));
    expect(body.guardians).not.toHaveProperty('barnacle');

    await app.close();
  });
});

describe('daemon state plane (S1 — plane identity)', () => {
  test('GET /version carries the plane when wired', async () => {
    const app = Fastify();
    await app.register(infoPlugin, { deps: buildDeps({ plane: 'dev-latest' }) });
    const res = await app.inject({ method: 'GET', url: '/version' });
    const body = res.json();
    expect(res.statusCode).toBe(200);
    expect(body.version).toBe('9.9.9');
    expect(body.plane).toBe('dev-latest');
    await app.close();
  });

  test('GET /health carries the plane when wired', async () => {
    const app = Fastify();
    await app.register(infoPlugin, { deps: buildDeps({ plane: 'ephemeral:pd-feat-x' }) });
    const res = await app.inject({ method: 'GET', url: '/health' });
    const body = res.json();
    expect(res.statusCode).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.plane).toBe('ephemeral:pd-feat-x');
    await app.close();
  });

  test('prod plane rides through verbatim on both routes', async () => {
    const app = Fastify();
    await app.register(infoPlugin, { deps: buildDeps({ plane: 'prod' }) });
    expect((await app.inject({ method: 'GET', url: '/version' })).json().plane).toBe('prod');
    expect((await app.inject({ method: 'GET', url: '/health' })).json().plane).toBe('prod');
    await app.close();
  });

  test('plane is omitted when not wired (legacy daemon)', async () => {
    const app = Fastify();
    await app.register(infoPlugin, { deps: buildDeps() });
    expect((await app.inject({ method: 'GET', url: '/version' })).json().plane).toBeUndefined();
    expect((await app.inject({ method: 'GET', url: '/health' })).json().plane).toBeUndefined();
    await app.close();
  });
});

describe('daemon berth self-identity (ADR-0084)', () => {
  const stableBerth = {
    tier: 'stable',
    label: 'stable',
    color: '#E6A23C',
    sourceDir: null,
    gitBranch: null,
    gitRev: null,
    builtAt: '2026-06-15T00:00:00.000Z',
    port: 43121,
    canonical: true,
  };
  const devBerth = {
    tier: 'dev-latest',
    label: 'dev-latest',
    color: '#3B82F6',
    sourceDir: '/repo/port-daddy',
    gitBranch: 'main',
    gitRev: 'abc1234',
    builtAt: '2026-06-15T01:00:00.000Z',
    port: 9886,
    canonical: false,
  };

  test('GET /health embeds the stable berth identity when daemonBerth is wired', async () => {
    const app = Fastify();
    await app.register(infoPlugin, { deps: buildDeps({ daemonBerth: stableBerth }) });
    const res = await app.inject({ method: 'GET', url: '/health' });
    const body = res.json();
    expect(res.statusCode).toBe(200);
    expect(body.daemon).toEqual(stableBerth);
    expect(body.daemon.canonical).toBe(true);
    await app.close();
  });

  test('GET /whoami returns the berth identity', async () => {
    const app = Fastify();
    await app.register(infoPlugin, { deps: buildDeps({ daemonBerth: devBerth }) });
    const res = await app.inject({ method: 'GET', url: '/whoami' });
    const body = res.json();
    expect(res.statusCode).toBe(200);
    expect(body.service).toBe('port-daddy');
    expect(body.daemon).toEqual(devBerth);
    expect(body.daemon.tier).toBe('dev-latest');
    expect(body.daemon.canonical).toBe(false);
    await app.close();
  });

  test('GET /health omits daemon when no berth wired; /whoami reports null', async () => {
    const app = Fastify();
    await app.register(infoPlugin, { deps: buildDeps() });
    const health = (await app.inject({ method: 'GET', url: '/health' })).json();
    const whoami = (await app.inject({ method: 'GET', url: '/whoami' })).json();
    expect(health.daemon).toBeUndefined();
    expect(whoami.daemon).toBeNull();
    await app.close();
  });

  // ADR-0084 Phase 2: FleetBar reads the berth from its existing `/status` poll,
  // so the berth must ride inside `/status.daemon.berth` (alongside build info),
  // not only on `/health`/`/whoami`. Pin that nested contract.
  test('GET /status nests the berth identity under daemon.berth', async () => {
    const app = Fastify();
    await app.register(infoPlugin, { deps: buildDeps({ daemonBerth: devBerth }) });
    const res = await app.inject({ method: 'GET', url: '/status' });
    const body = res.json();
    expect(res.statusCode).toBe(200);
    // build info still present...
    expect(typeof body.daemon.version).toBe('string');
    expect(typeof body.daemon.codeHash).toBe('string');
    // ...with the berth nested alongside it.
    expect(body.daemon.berth).toEqual(devBerth);
    expect(body.daemon.berth.tier).toBe('dev-latest');
    expect(body.daemon.berth.canonical).toBe(false);
    await app.close();
  });

  test('GET /status omits daemon.berth when no berth is wired (legacy daemon)', async () => {
    const app = Fastify();
    await app.register(infoPlugin, { deps: buildDeps() });
    const body = (await app.inject({ method: 'GET', url: '/status' })).json();
    expect(typeof body.daemon.version).toBe('string');
    expect(body.daemon.berth).toBeUndefined();
    await app.close();
  });
});
