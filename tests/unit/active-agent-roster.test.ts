import { jest } from '@jest/globals';
import { buildActiveAgentRoster } from '../../lib/active-agent-roster.js';
import Fastify from 'fastify';
import { agentRosterPlugin } from '../../routes/agent-roster.js';

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

  test('route returns the joined live roster with clamped query inputs', async () => {
    const app = Fastify();
    const listSessions = jest.fn(() => ({
      sessions: [{
        id: 'session-route',
        agentId: 'agent-route',
        status: 'active',
        purpose: 'Route proof',
        identityProject: 'port-daddy',
        metadata: { worktree: { root: '/tmp/route', branch: 'codex/route' } },
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
        sessions: {
          list: listSessions,
          listAllActiveClaims: jest.fn(() => ({
            claims: [{ agentId: 'agent-route', sessionId: 'session-route', filePath: 'routes/agent-roster.ts', claimedAt: 10 }],
          })),
        },
        metrics: { errors: 0 },
        logger: { error: jest.fn() },
      },
    });

    const response = await app.inject('/agent-roster?project=port-daddy&limit=9999');
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.count).toBe(1);
    expect(listSessions).toHaveBeenCalledWith(expect.objectContaining({ limit: 250, project: 'port-daddy' }));
    expect(body.agents[0]).toMatchObject({
      id: 'agent-route',
      harness: { id: 'claude-code-codex' },
      activeSession: { id: 'session-route' },
      worktree: { root: '/tmp/route' },
    });

    await app.close();
  });
});
