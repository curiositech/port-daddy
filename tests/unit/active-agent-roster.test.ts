import { jest } from '@jest/globals';
import { buildActiveAgentRoster } from '../../lib/active-agent-roster.js';
import { createCloudAppTelemetry } from '../../lib/cloud-app-telemetry.js';
import { createCostTracker } from '../../lib/cost-tracker.js';
import Fastify from 'fastify';
import { agentRosterPlugin } from '../../routes/agent-roster.js';
import { createTestDb } from '../setup-unit.js';
import { deriveSquidConformance } from '../../lib/squid/conformance.js';

const liveSquid = deriveSquidConformance({
  projectRoot: '/Users/example/coding/tmp/route',
  projectArmed: true,
  daemonAlive: true,
  tentaclesStaged: true,
  statuslineStaged: true,
  statuslineVisible: true,
  statuslineUser: false,
  slashCommand: true,
  pilotSessionStart: true,
  inboxSessionStart: true,
  providers: [{
    name: 'Codex CLI',
    slug: 'codex',
    detected: true,
    expectedScope: 'user',
    configPath: '/Users/example/.codex/config.toml',
    configured: true,
    wired: true,
    missingTentacles: [],
  }],
});

describe('active agent roster', () => {
  test('joins agents, active sessions, file claims, harness, worktree, and controls', () => {
    const roster = buildActiveAgentRoster({
      now: 1000,
      project: 'port-daddy',
      agents: [{
        id: 'agent-codex',
        name: 'Codex bridge',
        type: 'claude-code',
        identity: 'port-daddy:contrib:squid',
        identityProject: 'port-daddy',
        identityStack: 'contrib',
        identityContext: 'squid',
        purpose: 'Run Claude Code through Codex',
        status: 'ready',
        lastHeartbeat: 900,
        metadata: {
          backend: 'codex',
          model: 'gpt-5.3-codex',
          worktree: {
            id: 'wt-1',
            root: '/tmp/port-daddy',
            branch: 'codex/bridge',
            name: 'port-daddy',
            isMain: false,
          },
        },
        healthAssessment: { liveness: 'alive', graceRemaining: 10000 },
      }],
      sessions: [{
        id: 'session-1',
        purpose: 'Run Claude Code through Codex',
        status: 'active',
        phase: 'in_progress',
        agentId: 'agent-codex',
        worktreeId: 'wt-1',
        identityProject: 'port-daddy',
        createdAt: 700,
        updatedAt: 950,
        metadata: null,
      }],
      claims: [{
        filePath: 'lib/squid.ts',
        sessionId: 'session-1',
        purpose: 'Run Claude Code through Codex',
        agentId: 'agent-codex',
        phase: 'in_progress',
        claimedAt: 960,
        startLine: null,
        endLine: null,
        symbol: null,
        symbolPath: 'startBridge',
      }],
    });

    expect(roster.count).toBe(1);
    expect(roster.agents[0]).toMatchObject({
      id: 'agent-codex',
      harness: {
        id: 'claude-code-codex',
        label: 'Claude Code with Codex backend',
        backend: 'codex',
        model: 'gpt-5.3-codex',
        confidence: 'explicit',
      },
      worktree: {
        id: 'wt-1',
        root: '/tmp/port-daddy',
        branch: 'codex/bridge',
      },
      control: {
        steeringChannel: 'agent:agent-codex',
        streamUrl: '/agents/agent-codex/stream',
        interruptUrl: '/agents/agent-codex/interrupt',
        takeoverUrl: '/sessions/session-1/takeover',
      },
    });
    expect(roster.agents[0].touchedFiles[0].symbolPath).toBe('startBridge');
  });

  test('includes active sessions even when the registry row is missing', () => {
    const roster = buildActiveAgentRoster({
      sessions: [{
        id: 'session-orphan',
        purpose: 'Continue old work',
        status: 'active',
        phase: 'in_progress',
        agentId: 'agent-orphan',
        worktreeId: 'wt-2',
        identityProject: 'port-daddy',
        createdAt: 10,
        updatedAt: 20,
        metadata: { worktree: { root: '/tmp/orphan', branch: 'repair' } },
      }],
    });

    expect(roster.count).toBe(1);
    expect(roster.agents[0]).toMatchObject({
      id: 'agent-orphan',
      liveness: 'alive',
      activeSession: { id: 'session-orphan' },
      worktree: { root: '/tmp/orphan', branch: 'repair' },
    });
  });

  test('classifies ollama and cloudflare lanes from unstructured cues', () => {
    const roster = buildActiveAgentRoster({
      agents: [
        {
          id: 'agent-ollama',
          type: 'cli',
          purpose: 'claude code with olamma backend',
          healthAssessment: { liveness: 'alive' },
        },
        {
          id: 'agent-cloudflare',
          type: 'cloudflare-worker',
          purpose: 'review via Workers AI',
          healthAssessment: { liveness: 'alive' },
        },
      ],
    });

    expect(roster.agents.map((agent) => agent.harness.id)).toEqual(['ollama', 'cloudflare-ai']);
  });

  test('projects Cloudflare GitHub App review agents into live roster rows', () => {
    const roster = buildActiveAgentRoster({
      project: 'port-daddy',
      agents: [{
        id: 'cloudflare:curiositech.port-daddy:code-reviewer:abc12345',
        name: 'pd-code-reviewer',
        type: 'cloudflare',
        identity: 'port-daddy:cloudflare:code-reviewer',
        identityProject: 'port-daddy',
        identityStack: 'cloudflare',
        identityContext: 'code-reviewer',
        purpose: 'Remote skeptical reviewer for curiositech/port-daddy PR fleet',
        status: 'draining',
        lastHeartbeat: 2000,
        metadata: {
          origin: 'remote',
          remote: true,
          telemetrySource: 'cloud-app',
          provider: 'github',
          latestBackend: 'cloudflare',
          latestModel: '@cf/qwen/qwen3-30b-a3b-fp8',
          latestPrNumber: 628,
          latestStatus: 'findings',
        },
        healthAssessment: { liveness: 'alive', graceRemaining: 60000 },
      }],
    });

    expect(roster.count).toBe(1);
    expect(roster.agents[0]).toMatchObject({
      id: 'cloudflare:curiositech.port-daddy:code-reviewer:abc12345',
      label: 'pd-code-reviewer',
      identity: 'port-daddy:cloudflare:code-reviewer',
      project: 'port-daddy',
      purpose: 'Remote skeptical reviewer for curiositech/port-daddy PR fleet',
      liveness: 'alive',
      harness: {
        id: 'cloudflare-ai',
        label: 'Cloudflare AI fleet agent',
        backend: 'cloudflare',
        model: '@cf/qwen/qwen3-30b-a3b-fp8',
        confidence: 'explicit',
      },
      control: {
        steeringChannel: 'agent:cloudflare:curiositech.port-daddy:code-reviewer:abc12345',
        streamUrl: '/agents/cloudflare%3Acuriositech.port-daddy%3Acode-reviewer%3Aabc12345/stream',
        interruptUrl: '/agents/cloudflare%3Acuriositech.port-daddy%3Acode-reviewer%3Aabc12345/interrupt',
        takeoverUrl: null,
      },
    });
  });

  test('route returns the joined live roster with clamped query inputs', async () => {
    const app = Fastify();
    const db = createTestDb();
    const costTracker = createCostTracker(db);
    const cloudAppTelemetry = createCloudAppTelemetry(db, { costTracker });
    cloudAppTelemetry.record({
      id: 'delivery-route:code-reviewer',
      timestamp: Date.now(),
      deliveryId: 'delivery-route',
      event: 'pull_request',
      action: 'opened',
      owner: 'curiositech',
      repo: 'port-daddy',
      prNumber: 628,
      sha: 'abc123',
      ship: 'code-reviewer',
      role: 'skeptical reviewer',
      status: 'findings',
      conclusion: 'failure',
      backend: 'cloudflare',
      model: '@cf/qwen/qwen3-30b-a3b-fp8',
      inputTokens: 1200,
      outputTokens: 300,
      commentUrl: 'https://github.com/curiositech/port-daddy/pull/628#issuecomment-1',
    });
    const agentsSpy = jest.spyOn(cloudAppTelemetry, 'agents');
    const remoteAgent = cloudAppTelemetry.agents({ identityPrefix: 'port-daddy' })[0];
    expect(remoteAgent).toBeDefined();
    agentsSpy.mockClear();
    const listSessions = jest.fn(() => ({
      sessions: [{
        id: 'session-route',
        agentId: 'agent-route',
        status: 'active',
        purpose: 'Route proof',
        identityProject: 'port-daddy',
        metadata: { worktree: { root: '/Users/example/coding/tmp/route', branch: 'codex/route' } },
      }],
    }));
    await app.register(agentRosterPlugin, {
      deps: {
        agents: {
          list: jest.fn(() => ({
            agents: [{
              id: 'agent-route',
              type: 'claude-code',
              identity: 'port-daddy:qa:route',
              identityProject: 'port-daddy',
              purpose: 'Route proof',
              healthAssessment: { liveness: 'alive' },
              metadata: { backend: 'codex' },
            }],
          })),
        },
        cloudAppTelemetry,
        sessions: {
          list: listSessions,
          listAllActiveClaims: jest.fn(() => ({
            claims: [{ agentId: 'agent-route', sessionId: 'session-route', filePath: 'routes/agent-roster.ts', claimedAt: 10 }],
          })),
        },
        metrics: { errors: 0 },
        logger: { error: jest.fn() },
        readSquidConformance: jest.fn(() => liveSquid),
      },
    });

    const response = await app.inject('/agent-roster?project=port-daddy&limit=9999');
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.count).toBe(2);
    expect(listSessions).toHaveBeenCalledWith(expect.objectContaining({ limit: 250, project: 'port-daddy' }));
    expect(agentsSpy).toHaveBeenCalledWith({
      activeOnly: false,
      identityPrefix: 'port-daddy',
      limit: 250,
    });
    expect(body.agents.find((agent: { id: string }) => agent.id === 'agent-route')).toMatchObject({
      id: 'agent-route',
      harness: { id: 'claude-code-codex' },
      activeSession: { id: 'session-route' },
      worktree: { root: '/Users/example/coding/tmp/route' },
      squid: { level: 'LIVE', score: 100 },
    });
    expect(body.squidSummary).toEqual({ LIVE: 1, READY: 0, PARTIAL: 0, UNPROTECTED: 1 });
    expect(body.agents.find((agent: { id: string }) => agent.id === remoteAgent.id)).toMatchObject({
      id: remoteAgent.id,
      harness: {
        id: 'cloudflare-ai',
        backend: 'cloudflare',
        model: '@cf/qwen/qwen3-30b-a3b-fp8',
      },
      activeSession: null,
      touchedFiles: [],
    });

    await app.close();
    db.close();
  });
});
