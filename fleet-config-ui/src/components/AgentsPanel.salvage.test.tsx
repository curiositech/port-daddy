import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api';
import type { OperatorActorEntry, SalvageAgent, SpawnedAgent } from '../types';
import AgentsPanel from './AgentsPanel';
import { hasSalvageHold } from './SalvageHoldNotice';

vi.mock('../api', () => ({
  fetchRegistryAgents: vi.fn(async () => []), fetchSorties: vi.fn(async () => []),
  fetchSalvageAgents: vi.fn(async () => []), fetchSessions: vi.fn(async () => []),
  fetchOperatorActors: vi.fn(async () => []), fetchActiveAgentRoster: vi.fn(async () => ({ agents: [] })),
  fetchAgentInbox: vi.fn(async () => []), fetchAgentInboxStats: vi.fn(async () => ({ total: 0, unread: 0 })),
  fetchFileClaims: vi.fn(async () => []), fetchChannelMessages: vi.fn(async () => []),
  dismissSalvageAgent: vi.fn(async () => ({ success: true })), killSortie: vi.fn(async () => ({ success: true })),
  clearAgentInbox: vi.fn(), markAllAgentInboxRead: vi.fn(),
  getDaemonUrl: () => 'http://127.0.0.1:9999',
}));

const fixture = (patch: Partial<SalvageAgent> = {}): SalvageAgent => ({
  id: 'synthetic-agent', name: 'Synthetic salvage agent', purpose: 'Preserve synthetic work',
  sessionId: 'synthetic-session', lastHeartbeat: 1, staleSince: 2, status: 'dead',
  identityProject: 'synthetic', identityStack: 'fleet', identityContext: 'tender', ...patch,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.fetchSalvageAgents).mockResolvedValue([]);
  vi.mocked(api.fetchOperatorActors).mockResolvedValue([]);
  vi.mocked(api.fetchSorties).mockResolvedValue([]);
});

describe('durable-session salvage holds', () => {
  it.each(['dark', 'light'])('uses the house text token and readable body size for %s row names', async theme => {
    document.documentElement.dataset.theme = theme;
    vi.mocked(api.fetchSalvageAgents).mockResolvedValue([fixture()]);
    render(<AgentsPanel daemonKey="synthetic" />);
    const row = await screen.findByRole('button', { name: /Synthetic salvage agent/ });
    const label = within(row).getByText('Synthetic salvage agent');
    expect(label.style.color).toBe('var(--pd-text)');
    expect(label).toHaveClass('text-sm');
    delete document.documentElement.dataset.theme;
  });

  it('preserves ordinary unheld dismissal and fleet start behavior', async () => {
    vi.mocked(api.fetchSalvageAgents).mockResolvedValue([fixture()]);
    const run = vi.fn();
    render(<AgentsPanel daemonKey="synthetic" onRunFleetAgent={run} />);
    const dismiss = await screen.findByRole('button', { name: 'Dismiss ghost' });
    expect(dismiss).toBeEnabled();
    fireEvent.click(dismiss);
    await waitFor(() => expect(api.dismissSalvageAgent).toHaveBeenCalledWith('synthetic-agent'));
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
    await waitFor(() => expect(run).toHaveBeenCalledWith('tender'));
    expect(screen.queryByRole('complementary', { name: 'Salvage on hold' })).not.toBeInTheDocument();
  });

  it('explains dormant ownership and blocks dismiss/start/resume without offering clearance', async () => {
    vi.mocked(api.fetchSalvageAgents).mockResolvedValue([fixture({ status: 'dormant', holdReason: 'durable_session_active', replacementAlreadyAdmitted: false })]);
    const run = vi.fn(), pause = vi.fn();
    render(<AgentsPanel daemonKey="synthetic" onRunFleetAgent={run} onPauseFleetAgent={pause}
      runtimeAgents={[{ agentName: 'tender', status: 'paused' }]} />);
    const notice = await screen.findByRole('complementary', { name: 'Salvage on hold' });
    expect(notice).toHaveTextContent('On hold · dormant salvage entry');
    expect(notice).toHaveTextContent('notes and claims are preserved');
    expect(notice).toHaveTextContent('Hold clearance is not implemented');
    for (const name of ['Dismiss ghost', 'Run now', 'Resume']) {
      const button = screen.getByRole('button', { name });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('aria-describedby', notice.id);
      fireEvent.click(button);
    }
    expect(api.dismissSalvageAgent).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
    const evidence = within(notice).getByRole('link', { name: 'Open exact session evidence' });
    const url = new URL(evidence.getAttribute('href')!, 'http://synthetic.test');
    expect(url.searchParams.get('session')).toBe('synthetic-session');
    expect(url.searchParams.get('daemon')).toBe('http://127.0.0.1:9999');
    expect(screen.queryByRole('button', { name: /clear hold|take over|claim|retry/i })).not.toBeInTheDocument();
  });

  it('distinguishes admitted work from actual execution and keeps explicit Stop separate', async () => {
    const held = fixture({ status: 'resurrecting', holdReason: 'durable_session_active', replacementAlreadyAdmitted: true });
    vi.mocked(api.fetchSalvageAgents).mockResolvedValue([held]);
    vi.mocked(api.fetchSorties).mockResolvedValue([{ agentId: held.id, purpose: held.purpose,
      status: 'running', startedAt: 1, identity: 'synthetic:fleet:tender', backend: 'synthetic', model: 'fixture' } as SpawnedAgent]);
    render(<AgentsPanel daemonKey="synthetic" />);
    const notice = await screen.findByRole('complementary', { name: 'Salvage on hold' });
    expect(notice).toHaveTextContent('earlier replacement attempt admitted');
    expect(notice).toHaveTextContent('does not cancel the earlier admitted attempt or prove it is running');
    expect(screen.getByRole('button', { name: 'Dismiss ghost' })).toBeDisabled();
    const stop = screen.getByRole('button', { name: 'Stop run' });
    expect(stop).toBeEnabled();
    fireEvent.click(stop);
    await waitFor(() => expect(api.killSortie).toHaveBeenCalledWith(held.id));
  });

  it('keeps a dormant entry non-actionable even if the source omitted its reason', async () => {
    vi.mocked(api.fetchSalvageAgents).mockResolvedValue([fixture({ status: 'dormant' })]);
    render(<AgentsPanel daemonKey="synthetic" />);
    const notice = await screen.findByRole('complementary', { name: 'Salvage on hold' });
    expect(notice).toHaveTextContent('without a hold reason');
    expect(notice).not.toHaveTextContent('An active durable session still owns');
    expect(screen.getByRole('button', { name: 'Dismiss ghost' })).toBeDisabled();
  });

  it('does not infer a cleared hold when another projection omitted optional fields', async () => {
    const ordinary = fixture(), held = fixture({ holdReason: 'durable_session_active' });
    vi.mocked(api.fetchSalvageAgents).mockResolvedValue([ordinary]);
    vi.mocked(api.fetchOperatorActors).mockResolvedValue([{ id: ordinary.id, label: ordinary.name,
      fleetAgentName: 'tender', actorState: 'salvaged', actorStateReason: 'synthetic hold',
      salvage: held, sessions: [], inboxTarget: ordinary.id } as unknown as OperatorActorEntry]);
    render(<AgentsPanel daemonKey="synthetic" />);
    await screen.findByRole('complementary', { name: 'Salvage on hold' });
    expect(screen.getByRole('button', { name: 'Dismiss ghost' })).toBeDisabled();
  });

  it('does not apply one agent hold to a different selected agent', async () => {
    vi.mocked(api.fetchSalvageAgents).mockResolvedValue([
      fixture({ name: 'Synthetic held row', status: 'dormant', staleSince: 3 }),
      fixture({ id: 'other-agent', name: 'Synthetic ordinary row', sessionId: 'other-session', identityContext: 'lookout' }),
    ]);
    render(<AgentsPanel daemonKey="synthetic" />);
    await screen.findByRole('complementary', { name: 'Salvage on hold' });
    fireEvent.click(screen.getByRole('button', { name: /Synthetic ordinary row/ }));
    expect(screen.queryByRole('complementary', { name: 'Salvage on hold' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss ghost' }));
    await waitFor(() => expect(api.dismissSalvageAgent).toHaveBeenCalledWith('other-agent'));
  });

  it('preserves same-role bodies, exact selection on refresh, and body-specific dismissal', async () => {
    const held = fixture({ name: 'Synthetic held sibling', status: 'dormant', staleSince: 3 });
    const ordinary = fixture({ id: 'ordinary-sibling', name: 'Synthetic ordinary sibling', sessionId: 'ordinary-session' });
    vi.mocked(api.fetchSalvageAgents).mockResolvedValue([held, ordinary]);
    const run = vi.fn(), pause = vi.fn();
    render(<AgentsPanel daemonKey="synthetic" onRunFleetAgent={run} onPauseFleetAgent={pause}
      runtimeAgents={[{ agentName: 'tender', status: 'paused' }]} />);
    await screen.findByRole('complementary', { name: 'Salvage on hold' });
    expect(screen.getByRole('button', { name: /Synthetic held sibling/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /Synthetic ordinary sibling/ })).toBeVisible();
    expect(screen.getByText('On hold entries').parentElement).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: 'Dismiss ghost' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Synthetic ordinary sibling/ }));
    expect(screen.queryByRole('complementary', { name: 'Salvage on hold' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss ghost' })).toBeEnabled();
    expect(screen.getByText(/This fleet role maps to multiple directory entries/)).toBeVisible();
    for (const name of ['Run now', 'Resume']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name }));
    }
    vi.mocked(api.fetchSalvageAgents).mockResolvedValue([ordinary, held]);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(api.fetchSalvageAgents).toHaveBeenCalledTimes(2));
    await screen.findByRole('button', { name: /Synthetic ordinary sibling/ });
    expect(screen.queryByRole('complementary', { name: 'Salvage on hold' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss ghost' }));
    await waitFor(() => expect(api.dismissSalvageAgent).toHaveBeenCalledWith('ordinary-sibling'));
    expect(api.dismissSalvageAgent).not.toHaveBeenCalledWith(held.id);
    expect(run).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
  });

  it('does not retarget when the selected body disappears on refresh', async () => {
    const held = fixture({ name: 'Synthetic disappearing body', status: 'dormant', staleSince: 3 });
    const sibling = fixture({ id: 'retained-sibling', name: 'Synthetic retained sibling' });
    vi.mocked(api.fetchSalvageAgents).mockResolvedValue([held, sibling]);
    render(<AgentsPanel daemonKey="synthetic" />);
    await screen.findByRole('complementary', { name: 'Salvage on hold' });
    vi.mocked(api.fetchSalvageAgents).mockResolvedValue([sibling]);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByText('The selected agent is no longer in this directory response.');
    expect(screen.queryByRole('button', { name: 'Dismiss ghost' })).not.toBeInTheDocument();
    expect(api.dismissSalvageAgent).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Synthetic retained sibling/ })); });
    expect(screen.getByRole('button', { name: 'Dismiss ghost' })).toBeEnabled();
  });

  it('does not join an actor projection or route an inbox by shared fleet name', async () => {
    vi.mocked(api.fetchSalvageAgents).mockResolvedValue([fixture()]);
    vi.mocked(api.fetchOperatorActors).mockResolvedValue([{ id: 'different-body', label: 'Synthetic role peer',
      fleetAgentName: 'tender', actorState: 'salvaged', salvage: fixture({ id: 'different-body', status: 'dormant' }),
      sessions: [], inboxTarget: 'different-body-inbox' } as unknown as OperatorActorEntry]);
    render(<AgentsPanel daemonKey="synthetic" />);
    await screen.findByRole('button', { name: /Synthetic role peer/ });
    expect(screen.queryByRole('complementary', { name: 'Salvage on hold' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss ghost' })).toBeEnabled();
    await waitFor(() => expect(api.fetchAgentInbox).toHaveBeenCalledWith('synthetic-agent', { limit: 20 }));
    expect(api.fetchAgentInbox).not.toHaveBeenCalledWith('different-body-inbox', expect.anything());
  });

  it('keeps explicit Stop pinned to the selected body when fleet roles are ambiguous', async () => {
    const held = fixture({ name: 'Synthetic held run', status: 'resurrecting', holdReason: 'durable_session_active', staleSince: 3 });
    vi.mocked(api.fetchSalvageAgents).mockResolvedValue([held, fixture({ id: 'other-run', name: 'Synthetic other run' })]);
    vi.mocked(api.fetchSorties).mockResolvedValue([held.id, 'other-run'].map(agentId => ({ agentId,
      purpose: 'Synthetic run', status: 'running', startedAt: 1, identity: 'synthetic:fleet:tender',
      backend: 'synthetic', model: 'fixture' } as SpawnedAgent)));
    render(<AgentsPanel daemonKey="synthetic" />);
    await screen.findByRole('complementary', { name: 'Salvage on hold' });
    fireEvent.click(screen.getByRole('button', { name: 'Stop run' }));
    await waitFor(() => expect(api.killSortie).toHaveBeenCalledWith(held.id));
    expect(api.killSortie).not.toHaveBeenCalledWith('other-run');
  });

  it.each(['pending', 'stale', 'dead', 'resurrecting'] as const)('honors explicit holds regardless of old queue status: %s', (status) => {
    expect(hasSalvageHold(fixture({ status, holdReason: 'durable_session_active' }))).toBe(true);
    expect(hasSalvageHold(fixture({ status }))).toBe(false);
  });
});
