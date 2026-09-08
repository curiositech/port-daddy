import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AgentsPanel from './AgentsPanel';

vi.mock('../api', () => ({
  fetchRegistryAgents: vi.fn(async () => []), fetchSorties: vi.fn(async () => []),
  fetchSalvageAgents: vi.fn(async () => []), fetchSessions: vi.fn(async () => []),
  fetchOperatorActors: vi.fn(async () => []), fetchActiveAgentRoster: vi.fn(async () => ({ agents: [] })),
  getDaemonUrl: () => 'http://127.0.0.1:9999',
}));

beforeEach(() => { vi.clearAllMocks(); });

describe('AgentsPanel exact session entry', () => {
  it('opens an explicit session even with an empty directory and no registered agent', async () => {
    const open = vi.fn();
    render(<AgentsPanel daemonKey="isolated" onOpenSession={open} />);
    const input = await screen.findByLabelText('Open exact session');
    fireEvent.change(input, { target: { value: 'session-never-in-beacon' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open plan and history' }));
    expect(open).toHaveBeenCalledWith('session-never-in-beacon');
  });
});
