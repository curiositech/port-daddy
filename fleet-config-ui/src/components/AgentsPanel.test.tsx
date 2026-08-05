import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchActiveAgentRoster,
  fetchAgentInbox,
  fetchAgentInboxStats,
  fetchFileClaims,
  fetchOperatorActors,
  fetchRegistryAgents,
  fetchSalvageAgents,
  fetchSessions,
  fetchSorties,
} from '../api';
import type { OperatorActorEntry, RegistryAgent } from '../types';
import AgentsPanel from './AgentsPanel';

vi.mock('../api', () => ({
  clearAgentInbox: vi.fn(),
  dismissSalvageAgent: vi.fn(),
  fetchActiveAgentRoster: vi.fn(),
  fetchAgentInbox: vi.fn(),
  fetchAgentInboxStats: vi.fn(),
  fetchChannelMessages: vi.fn(),
  fetchFileClaims: vi.fn(),
  fetchOperatorActors: vi.fn(),
  fetchRegistryAgents: vi.fn(),
  fetchSalvageAgents: vi.fn(),
  fetchSessions: vi.fn(),
  fetchSorties: vi.fn(),
  getDaemonUrl: vi.fn(() => 'http://127.0.0.1:43127'),
  cancelSortie: vi.fn(),
  markAllAgentInboxRead: vi.fn(),
}));

function registryAgent(id: string, name: string, lastHeartbeat: number): RegistryAgent {
  return {
    id,
    name,
    pid: 123,
    type: 'codex',
    registeredAt: lastHeartbeat - 1_000,
    lastHeartbeat,
    isActive: true,
    maxServices: 1,
    maxLocks: 1,
    metadata: null,
    agentCard: null,
    skills: [],
    worktreeId: null,
    identity: 'port-daddy:continuation',
    identityProject: 'port-daddy',
    identityStack: null,
    identityContext: null,
    purpose: `${name} purpose`,
    status: 'active',
    readiness: null,
    isReady: true,
    progress: null,
    healthAssessment: { liveness: 'alive', graceRemaining: 30_000 },
  };
}

function actor(agent: RegistryAgent): OperatorActorEntry {
  return {
    id: agent.id,
    label: agent.name ?? agent.id,
    purpose: agent.purpose,
    identity: agent.identity,
    fleetAgentName: null,
    inboxTarget: agent.id,
    isConfiguredFleetAgent: false,
    actorKind: 'ad_hoc',
    actorState: 'running',
    actorStateReason: 'registered heartbeat is fresh',
    runtimeStatus: 'active',
    liveness: 'alive',
    lastActivityAt: agent.lastHeartbeat,
    lastSummary: agent.purpose,
    recentFiles: [],
    registry: agent,
    spawned: null,
    salvage: null,
    sessions: [],
  };
}

beforeEach(() => {
  const requested = registryAgent('spawned-requested', 'Requested continuation', 10);
  const newer = registryAgent('spawned-newer', 'Newer unrelated agent', 20);
  vi.mocked(fetchRegistryAgents).mockResolvedValue([requested, newer]);
  vi.mocked(fetchSorties).mockResolvedValue([]);
  vi.mocked(fetchSalvageAgents).mockResolvedValue([]);
  vi.mocked(fetchSessions).mockResolvedValue([]);
  vi.mocked(fetchOperatorActors).mockResolvedValue([actor(requested), actor(newer)]);
  vi.mocked(fetchActiveAgentRoster).mockResolvedValue({
    success: true,
    generatedAt: 20,
    project: null,
    count: 0,
    agents: [],
  });
  vi.mocked(fetchAgentInbox).mockResolvedValue([]);
  vi.mocked(fetchAgentInboxStats).mockResolvedValue({ total: 0, unread: 0 });
  vi.mocked(fetchFileClaims).mockResolvedValue([]);
});

describe('AgentsPanel continuation focus', () => {
  it('honors the agent id from a global deep link instead of selecting the newest agent', async () => {
    render(<AgentsPanel daemonKey="named-daemon" initialAgentId="spawned-requested" />);

    await screen.findAllByText('Requested continuation');
    const heading = screen.getByText('AGENT DETAIL');
    const detail = heading.closest('section');
    expect(detail).not.toBeNull();
    expect(within(detail as HTMLElement).getByText('Requested continuation')).toBeInTheDocument();
    expect(within(detail as HTMLElement).queryByText('Newer unrelated agent')).not.toBeInTheDocument();

    const roster = screen.getByText('LIVE HARNESS ROSTER').closest('section');
    expect(roster).toHaveClass('order-last');
  });

  it('opens the live agent control center from Join', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    vi.mocked(fetchActiveAgentRoster).mockResolvedValue({
      success: true,
      generatedAt: 20,
      project: 'port-daddy',
      count: 1,
      agents: [{
        id: 'spawned-requested',
        label: 'Requested continuation',
        purpose: 'Prove joinability',
        identity: 'port-daddy:continuation',
        project: 'port-daddy',
        status: 'running',
        liveness: 'alive',
        pid: 123,
        lastHeartbeat: 20,
        progress: 'waiting for operator',
        eventVerb: 'waiting',
        lineageLabel: 'session-parent -> session-child',
        costUsd: 0.01,
        budgetUsd: 1,
        harness: { id: 'codex', label: 'Codex', backend: 'cli:codex', model: 'gpt-5.6-sol', confidence: 'explicit' },
        worktree: { id: 'wt', root: '/Users/dev/worktree', branch: 'feature', name: 'feature', isMain: false },
        activeSession: null,
        sessions: [],
        touchedFiles: [],
        control: {
          steeringChannel: 'agent:spawned-requested',
          streamUrl: '/agents/spawned-requested/stream',
          interruptUrl: '/agents/spawned-requested/interrupt',
          controlCenterUrl: '/fleet-ui/?surface=agents&agent=spawned-requested',
        },
      }],
    });

    render(<AgentsPanel daemonKey="named-daemon" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Join' }));

    expect(open).toHaveBeenCalledWith(
      'http://127.0.0.1:43127/fleet-ui/?surface=agents&agent=spawned-requested',
      '_blank',
      'noopener,noreferrer',
    );
    open.mockRestore();
  });

  it('does not advertise live controls when no runtime exists', async () => {
    vi.mocked(fetchActiveAgentRoster).mockResolvedValue({
      success: true,
      generatedAt: 20,
      project: 'port-daddy',
      count: 1,
      agents: [{
        id: 'session-shell',
        label: 'Session without runtime',
        purpose: 'Needs a successor',
        identity: 'port-daddy:continuation',
        project: 'port-daddy',
        status: 'active',
        liveness: 'no_runtime',
        pid: null,
        lastHeartbeat: null,
        progress: null,
        eventVerb: 'active',
        lineageLabel: 'session-shell',
        costUsd: null,
        budgetUsd: null,
        harness: { id: 'session', label: 'Session proxy', backend: null, model: null, confidence: 'explicit' },
        worktree: { id: 'wt', root: '/Users/dev/worktree', branch: 'feature', name: 'feature', isMain: false },
        activeSession: null,
        sessions: [],
        touchedFiles: [],
        control: {
          steeringChannel: 'agent:session-shell',
          streamUrl: null,
          interruptUrl: null,
          controlCenterUrl: '/fleet-ui/?surface=agents&agent=session-shell',
        },
      }],
    });

    render(<AgentsPanel daemonKey="named-daemon" />);
    await screen.findByText('Session without runtime');
    expect(screen.queryByRole('button', { name: 'Join' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stream' })).not.toBeInTheDocument();
  });
});
