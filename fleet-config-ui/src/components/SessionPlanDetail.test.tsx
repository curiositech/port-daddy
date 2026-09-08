import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SessionPlanDetail, { SessionNoteContent } from './SessionPlanDetail';
import { fetchSessionDetail } from '../api';
import type { SessionDetail } from '../sessionPlan';

vi.mock('../api', () => ({ fetchSessionDetail: vi.fn() }));

const fixture = (id = 'session-a'): SessionDetail => ({
  session: { id, purpose: `Work for ${id}`, status: 'active', phase: 'in_progress', agentId: null, worktreeId: 'same-worktree', identityProject: 'synthetic', createdAt: 1, updatedAt: 6, completedAt: null, metadata: { worktree: { root: '/synthetic/shared-repo' }, identity: { verified: true, actorId: `actor-${id}` }, secret: 'must-not-render' } },
  notes: [1, 2, 3, 4, 5, 6].map((n) => ({ id: n, sessionId: id, type: n === 5 || n === 1 ? 'todo_list' : 'progress', createdAt: n * 1000, content: n === 5 ? '- [x] First delivered\n- [ ] Review current head\n- [ ] Protected merge receipt\n- [ ] Final long-lived handoff' : n === 6 ? 'Published [PR #42](https://github.com/example/synthetic/pull/42), not yet merged.' : `Earlier note ${n}` })),
});

beforeEach(() => { vi.mocked(fetchSessionDetail).mockReset(); });

describe('SessionPlanDetail', () => {
  it('shows the complete latest plan and newest PR receipt even without a registered agent', async () => {
    vi.mocked(fetchSessionDetail).mockResolvedValue(fixture());
    render(<SessionPlanDetail sessionId="session-a" daemonKey="daemon-a" onBack={() => {}} />);
    const current = await screen.findByRole('region', { name: 'Current plan' });
    expect(within(current).getByText('Final long-lived handoff')).toBeInTheDocument();
    expect(within(current).getByText('1 of 4 checklist items complete')).toBeInTheDocument();
    expect(screen.getByText('actor-session-a')).toBeInTheDocument();
    expect(screen.queryByText('must-not-render')).not.toBeInTheDocument();
    const history = screen.getByRole('region', { name: 'Complete note history' });
    const disclosures = history.querySelectorAll('details');
    expect(disclosures).toHaveLength(6);
    expect(disclosures[0]).toHaveAttribute('id', 'session-note-6');
    fireEvent.click(disclosures[0].querySelector('summary')!);
    expect(within(disclosures[0] as HTMLElement).getByRole('link', { name: 'PR #42' })).toHaveAttribute('href', 'https://github.com/example/synthetic/pull/42');
    expect(fetchSessionDetail).toHaveBeenCalledWith('session-a');
  });

  it('never displays a stale asynchronous session when two sessions share a worktree', async () => {
    let resolveA!: (detail: SessionDetail) => void;
    vi.mocked(fetchSessionDetail).mockImplementation((id) => id === 'session-a' ? new Promise((resolve) => { resolveA = resolve; }) : Promise.resolve(fixture(id)));
    const view = render(<SessionPlanDetail sessionId="session-a" daemonKey="daemon-a" onBack={() => {}} />);
    view.rerender(<SessionPlanDetail sessionId="session-b" daemonKey="daemon-a" onBack={() => {}} />);
    expect(await screen.findByRole('heading', { name: 'Work for session-b' })).toBeInTheDocument();
    await act(async () => resolveA(fixture('session-a')));
    expect(screen.queryByRole('heading', { name: 'Work for session-a' })).not.toBeInTheDocument();
    expect(screen.getByText('actor-session-b')).toBeInTheDocument();
  });

  it('clears previously rendered details immediately when the explicit selector changes', async () => {
    vi.mocked(fetchSessionDetail).mockResolvedValueOnce(fixture('session-a')).mockImplementationOnce(() => new Promise(() => {}));
    const view = render(<SessionPlanDetail sessionId="session-a" daemonKey="daemon-a" onBack={() => {}} />);
    await screen.findByRole('heading', { name: 'Work for session-a' });
    view.rerender(<SessionPlanDetail sessionId="session-missing" daemonKey="daemon-a" onBack={() => {}} />);
    expect(screen.queryByRole('heading', { name: 'Work for session-a' })).not.toBeInTheDocument();
  });

  it.each(['session not found', 'Authentication required', 'Forbidden'])('does not fall back on exact-session errors: %s', async (message) => {
    vi.mocked(fetchSessionDetail).mockRejectedValue(new Error(message));
    render(<SessionPlanDetail sessionId="session-missing" daemonKey="daemon-a" onBack={() => {}} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('alert')).toHaveTextContent('session-missing');
    expect(fetchSessionDetail).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('region', { name: 'Current plan' })).not.toBeInTheDocument();
  });

  it('does not call a missing plan completed and refreshes the same exact target', async () => {
    vi.mocked(fetchSessionDetail).mockResolvedValue({ ...fixture(), notes: [] });
    const back = vi.fn();
    render(<SessionPlanDetail sessionId="session-a" daemonKey="daemon-a" onBack={back} />);
    expect(await screen.findByText('No typed plan has been recorded. This does not mean the work is complete.')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh' })); });
    expect(fetchSessionDetail).toHaveBeenNthCalledWith(2, 'session-a');
    fireEvent.click(screen.getByRole('button', { name: 'All agents and sessions' }));
    expect(back).toHaveBeenCalledOnce();
  });

  it('treats HTML, images, scripts and unsafe protocols as inert retained text', () => {
    const { container } = render(<SessionNoteContent content={'<script>alert(1)</script>\n![image](https://example.test/image.png)\n[bad](javascript:alert)\n[file](file:///secret)\n[good](https://example.test/proof)'} />);
    expect(container.querySelector('script, img, iframe')).toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'good' })).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText('[bad](javascript:alert)')).toBeInTheDocument();
  });
});
