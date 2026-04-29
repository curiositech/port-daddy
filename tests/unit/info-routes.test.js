import { describe, expect, jest, test } from '@jest/globals';
import Fastify from 'fastify';
import { infoPlugin } from '../../routes/info.js';

function buildDeps(overrides = {}) {
  const {
    metrics: metricsOverrides,
    services: servicesOverrides,
    config: configOverrides,
    activityLog: activityLogOverrides,
    costTracker: costTrackerOverrides,
    ...rest
  } = overrides;

  const metrics = {
    errors: 0,
    total_assignments: 3,
    total_releases: 1,
    uptime_start: Date.now() - 5_000,
    ...(metricsOverrides ?? {}),
  };

  const services = {
    find: jest.fn(() => ({ success: true, services: [] })),
    count: jest.fn(() => 2),
    claim: jest.fn(() => ({ success: true, port: 3100 })),
    release: jest.fn(() => ({ success: true, released: 1 })),
    ...(servicesOverrides ?? {}),
  };

  const activityLog = {
    getRecent: jest.fn(() => ({
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
    })),
    ...(activityLogOverrides ?? {}),
  };

  const costTracker = {
    recent: jest.fn(() => [
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
    ]),
    ...(costTrackerOverrides ?? {}),
  };

  const config = {
    ...(configOverrides ?? {}),
    ports: {
      range_start: 3100,
      range_end: 3199,
      ...(configOverrides?.ports ?? {}),
    },
  };

  return {
    metrics,
    services,
    config,
    VERSION: '9.9.9',
    CODE_HASH: 'abc123',
    STARTED_AT: 1_700_000_000_000,
    __dirname: '/tmp/port-daddy',
    cleanupStale: jest.fn(() => []),
    getSystemPorts: jest.fn(() => []),
    activityLog,
    costTracker,
    ...rest,
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
  test('GET /version reports the daemon build identity exactly', async () => {
    const app = Fastify();
    const deps = buildDeps();
    await app.register(infoPlugin, { deps });

    const res = await app.inject({ method: 'GET', url: '/version' });
    const body = res.json();
    const uptime = Math.floor(process.uptime());

    expect(res.statusCode).toBe(200);
    expect(body).toEqual({
      version: '9.9.9',
      codeHash: 'abc123',
      startedAt: 1_700_000_000_000,
      service: 'port-daddy',
      api: 'semantic',
      node_version: process.version,
      pid: process.pid,
      uptime,
      installDir: '/tmp/port-daddy',
    });
    expect(deps.services.count).not.toHaveBeenCalled();

    await app.close();
  });

  test('GET /metrics reports active ports and formatted uptime exactly', async () => {
    const app = Fastify();
    const deps = buildDeps({
      metrics: {
        errors: 2,
        total_assignments: 5,
        total_releases: 4,
        uptime_start: Date.now() - 125_000,
      },
    });
    await app.register(infoPlugin, { deps });

    const res = await app.inject({ method: 'GET', url: '/metrics' });
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.errors).toBe(2);
    expect(body.total_assignments).toBe(5);
    expect(body.total_releases).toBe(4);
    expect(body.active_ports).toBe(2);
    expect(body.uptime_seconds).toBe(125);
    expect(body.uptime_formatted).toBe('2m');
    expect(deps.services.count).toHaveBeenCalledTimes(1);

    await app.close();
  });

  test('POST /ports/request claims the requested project port and records the assignment', async () => {
    const app = Fastify();
    const deps = buildDeps({
      services: {
        claim: jest.fn(() => ({ success: true, port: 3200, existing: false })),
      },
    });
    await app.register(infoPlugin, { deps });

    const res = await app.inject({
      method: 'POST',
      url: '/ports/request',
      headers: { 'x-pid': '4321' },
      payload: { project: 'alpha:api:main', preferred: 3200 },
    });
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body).toEqual({
      port: 3200,
      message: 'port assigned successfully',
      existing: false,
    });
    expect(deps.services.claim).toHaveBeenCalledTimes(1);
    expect(deps.services.claim).toHaveBeenCalledWith('alpha:api:main', {
      port: 3200,
      range: [3100, 3199],
      pid: 4321,
      systemPorts: new Set(),
    });
    expect(deps.metrics.total_assignments).toBe(4);

    await app.close();
  });

  test('POST /ports/request rejects missing project names', async () => {
    const app = Fastify();
    const deps = buildDeps();
    await app.register(infoPlugin, { deps });

    const res = await app.inject({
      method: 'POST',
      url: '/ports/request',
      payload: { preferred: 3200 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'project name required' });
    expect(deps.services.claim).not.toHaveBeenCalled();
    expect(deps.metrics.total_assignments).toBe(3);

    await app.close();
  });

  test('POST /ports/request surfaces claim failures from the services layer', async () => {
    const app = Fastify();
    const deps = buildDeps({
      services: {
        claim: jest.fn(() => ({ success: false, error: 'No available ports in range' })),
      },
    });
    await app.register(infoPlugin, { deps });

    const res = await app.inject({
      method: 'POST',
      url: '/ports/request',
      payload: { project: 'alpha:api:main', preferred: 3200 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'No available ports in range' });
    expect(deps.services.claim).toHaveBeenCalledWith('alpha:api:main', expect.any(Object));

    await app.close();
  });

  test('DELETE /ports/release releases a project without looking up the port table', async () => {
    const app = Fastify();
    const deps = buildDeps({
      services: {
        release: jest.fn(() => ({ success: true, released: 2 })),
      },
    });
    await app.register(infoPlugin, { deps });

    const res = await app.inject({
      method: 'DELETE',
      url: '/ports/release',
      payload: { project: 'alpha:api:main' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      success: true,
      message: 'released 2 port(s) for project alpha:api:main',
    });
    expect(deps.services.release).toHaveBeenCalledTimes(1);
    expect(deps.services.release).toHaveBeenCalledWith('alpha:api:main');
    expect(deps.services.find).not.toHaveBeenCalled();
    expect(deps.metrics.total_releases).toBe(3);

    await app.close();
  });

  test('DELETE /ports/release resolves a port-backed service before releasing it', async () => {
    const app = Fastify();
    const deps = buildDeps({
      services: {
        find: jest.fn(() => ({
          success: true,
          services: [
            { id: 'alpha:api:main', port: 3200, pid: 222, createdAt: 1_700_000_000_000, lastSeen: 1_700_000_050_000 },
          ],
        })),
        release: jest.fn(() => ({ success: true, released: 1 })),
      },
    });
    await app.register(infoPlugin, { deps });

    const res = await app.inject({
      method: 'DELETE',
      url: '/ports/release',
      payload: { port: 3200 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      success: true,
      message: 'released port 3200',
    });
    expect(deps.services.find).toHaveBeenCalledWith('*', { port: 3200 });
    expect(deps.services.release).toHaveBeenCalledWith('alpha:api:main');

    await app.close();
  });

  test('GET /ports/active returns computed ages from service records', async () => {
    const app = Fastify();
    const createdAt = Date.now() - 125_000;
    const deps = buildDeps({
      services: {
        find: jest.fn(() => ({
          success: true,
          services: [
            { id: 'alpha:api:main', port: 3200, pid: 222, createdAt, lastSeen: createdAt + 5_000 },
            { id: 'alpha:web:main', port: 3201, pid: 223, createdAt, lastSeen: createdAt + 10_000 },
          ],
        })),
      },
    });
    await app.register(infoPlugin, { deps });

    const res = await app.inject({ method: 'GET', url: '/ports/active' });
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body).toEqual({
      ports: [
        {
          port: 3200,
          project: 'alpha:api:main',
          pid: 222,
          started: createdAt,
          last_seen: createdAt + 5_000,
          alive: true,
          age_minutes: 2,
        },
        {
          port: 3201,
          project: 'alpha:web:main',
          pid: 223,
          started: createdAt,
          last_seen: createdAt + 10_000,
          alive: true,
          age_minutes: 2,
        },
      ],
      count: 2,
    });
    expect(deps.services.find).toHaveBeenCalledWith('*');

    await app.close();
  });

  test('GET /ports/system filters managed and unmanaged ports deterministically', async () => {
    const app = Fastify();
    const deps = buildDeps({
      services: {
        find: jest.fn(() => ({
          success: true,
          services: [
            { id: 'alpha:api:main', port: 3100 },
            { id: 'alpha:web:main', port: 3300 },
          ],
        })),
      },
      getSystemPorts: jest.fn(() => [
        { port: 3100, pid: 11, command: 'node', user: 'eric' },
        { port: 3200, pid: 12, command: 'node', user: 'eric' },
        { port: 3300, pid: 13, command: 'node', user: 'eric' },
      ]),
    });
    await app.register(infoPlugin, { deps });

    const res = await app.inject({
      method: 'GET',
      url: '/ports/system?range_only=true&unmanaged_only=true',
    });
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body).toEqual({
      ports: [
        {
          port: 3200,
          pid: 12,
          command: 'node',
          user: 'eric',
          managed_by_port_daddy: false,
          project: null,
        },
      ],
      count: 1,
      total_system_ports: 3,
    });
    expect(deps.getSystemPorts).toHaveBeenCalledTimes(1);
    expect(deps.services.find).toHaveBeenCalledWith('*');

    await app.close();
  });

  test('POST /ports/cleanup calls the cleanup hook and reports freed entries', async () => {
    const app = Fastify();
    const deps = buildDeps({
      cleanupStale: jest.fn(() => ['stale:one', 'stale:two']),
    });
    await app.register(infoPlugin, { deps });

    const res = await app.inject({ method: 'POST', url: '/ports/cleanup' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      freed: ['stale:one', 'stale:two'],
      count: 2,
    });
    expect(deps.cleanupStale).toHaveBeenCalledTimes(1);

    await app.close();
  });

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
      supervisor: expect.objectContaining({ state: 'launchctl_preferred' }),
      bosun: expect.objectContaining({
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

  test('GET /status exposes Bosun heartbeat without a Barnacle compatibility alias', async () => {
    const app = Fastify();
    await app.register(infoPlugin, {
      deps: buildDeps({
        bosunHeartbeat: {
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
    expect(body.guardians.bosun).toEqual(expect.objectContaining({
      state: 'idle',
      monitoredUrl: 'file:///tmp/port-daddy/heartbeat',
      binaryPath: '/tmp/port-daddy/core/pd-bosun/target/release/pd-bosun',
      binaryExists: false,
      reason: 'daemon heartbeat writer active; pd-bosun supervisor not installed (optional)',
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
