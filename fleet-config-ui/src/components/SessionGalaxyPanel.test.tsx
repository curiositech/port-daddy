import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SessionGalaxyPanel, {
  CLUSTER_COLORS,
  clientToViewBox,
  clusterColor,
  defaultParleyReason,
  distinctAgentIds,
  pointToViewBox,
  pointsInRect,
  selectionTermsSlug,
} from './SessionGalaxyPanel';
import { callGalaxyParley, fetchGalaxyMap, fetchGalaxySessionDetail } from '../api';
import type {
  GalaxyCluster,
  GalaxyMapResponse,
  GalaxyPoint,
  GalaxySessionDetailResponse,
} from '../types';

vi.mock('../api', () => ({
  fetchGalaxyMap: vi.fn(),
  fetchGalaxySessionDetail: vi.fn(),
  callGalaxyParley: vi.fn(),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makePoint(overrides: Partial<GalaxyPoint> & Pick<GalaxyPoint, 'id' | 'agentId'>): GalaxyPoint {
  return {
    sessionId: null,
    ship: 'gardener',
    project: 'port-daddy',
    identity: 'port-daddy:gardener',
    purpose: null,
    status: 'completed',
    startedAt: 1_750_000_000_000,
    endedAt: 1_750_000_100_000,
    tailTokens: 1200,
    x: 0.5,
    y: 0.5,
    clusterId: 0,
    snippet: 'refactored the sqlite migration runner',
    prNumber: null,
    ...overrides,
  };
}

const clusterZero: GalaxyCluster = {
  id: 0,
  label: 'sqlite migration · wal',
  terms: [
    { term: 'sqlite migration', mi: 1.4 },
    { term: 'wal', mi: 1.1 },
    { term: 'schema', mi: 0.9 },
    { term: 'rollback', mi: 0.7 },
    { term: 'sqlite', mi: 0.6 },
  ],
  size: 3,
  centroid: [0.25, 0.3],
};

const clusterOne: GalaxyCluster = {
  id: 1,
  label: 'parley broker',
  terms: [
    { term: 'parley', mi: 1.2 },
    { term: 'broker', mi: 1.0 },
  ],
  size: 3,
  centroid: [0.75, 0.7],
};

const sixPoints: GalaxyPoint[] = [
  makePoint({ id: 't-1', agentId: 'agent-a', purpose: 'Fix sqlite migration ordering', x: 0.1, y: 0.2, clusterId: 0 }),
  makePoint({ id: 't-2', agentId: 'agent-b', purpose: 'WAL checkpoint tuning', x: 0.2, y: 0.25, clusterId: 0 }),
  makePoint({ id: 't-3', agentId: 'agent-a', purpose: 'Schema rollback guard', x: 0.3, y: 0.35, clusterId: 0, status: 'running' }),
  makePoint({ id: 't-4', agentId: 'agent-c', purpose: 'Parley round limit', x: 0.7, y: 0.65, clusterId: 1 }),
  makePoint({ id: 't-5', agentId: 'agent-c', purpose: 'Broker inbox retries', x: 0.8, y: 0.7, clusterId: 1 }),
  makePoint({ id: 't-6', agentId: 'agent-c', purpose: 'Parley channel naming', x: 0.9, y: 0.8, clusterId: 1 }),
];

const mapFixture: GalaxyMapResponse = {
  success: true,
  computedAt: 1_750_000_200_000,
  params: { windowHours: 24, tailTokens: 4000, minTokens: 256, limit: 500, project: null },
  points: sixPoints,
  clusters: [clusterZero, clusterOne],
  stats: { sessionCount: 6, embeddedNow: 6, cacheHits: 0, elapsedMs: 42 },
};

const detailFixture: GalaxySessionDetailResponse = {
  success: true,
  detail: {
    transcript: {
      id: 't-1',
      ship: 'gardener',
      session_id: null,
      spawned_agent_id: 'agent-a',
      pr_number: null,
      trigger: 'cron',
      backend: 'claude',
      model: 'claude-haiku',
      status: 'completed',
      started_at: 1_750_000_000_000,
      ended_at: 1_750_000_100_000,
      messages: [
        { role: 'assistant', content: 'Reordered the sqlite migrations and re-ran the suite.', timestamp: 1_750_000_050_000 },
      ],
      outputs: [],
    },
    session: null,
    notes: [],
    files: [
      { filePath: 'lib/migrations.ts', startLine: 12, endLine: 80, symbol: 'runMigrations', claimedAt: 1_750_000_010_000, releasedAt: null },
    ],
    toolUses: [
      { name: 'Bash', args: { command: 'npm test' }, at: 1_750_000_060_000 },
    ],
    prs: [],
  },
};

async function renderGalaxy() {
  render(<SessionGalaxyPanel project={null} />);
  // Six circles appear once the mocked map fetch resolves.
  const circles = await screen.findAllByTestId(/^galaxy-point-/);
  expect(circles).toHaveLength(6);
  return circles;
}

beforeEach(() => {
  vi.mocked(fetchGalaxyMap).mockReset().mockResolvedValue(mapFixture);
  vi.mocked(fetchGalaxySessionDetail).mockReset().mockResolvedValue(detailFixture);
  vi.mocked(callGalaxyParley).mockReset().mockResolvedValue({ success: true, parley: { parleyId: 'parley-9' } });
});

// ── Pure helpers ──────────────────────────────────────────────────────────────

describe('pointsInRect', () => {
  it('selects exactly the points whose projected coords fall inside the rect', () => {
    // t-1 projects to (40 + 0.1*920, 40 + 0.2*620) = (132, 164)
    // t-2 projects to (224, 195); t-3 to (316, 257); cluster-1 points are far right.
    const ids = pointsInRect(sixPoints, { x0: 100, y0: 100, x1: 250, y1: 220 });
    expect(ids).toEqual(['t-1', 't-2']);
  });

  it('normalizes inverted drag rectangles (dragging up-left)', () => {
    const ids = pointsInRect(sixPoints, { x0: 250, y0: 220, x1: 100, y1: 100 });
    expect(ids).toEqual(['t-1', 't-2']);
  });

  it('returns empty for a rect containing no points', () => {
    expect(pointsInRect(sixPoints, { x0: 0, y0: 0, x1: 10, y1: 10 })).toEqual([]);
  });
});

describe('clientToViewBox', () => {
  it('is the inverse of the projection when the container matches the viewBox aspect', () => {
    const rect = { left: 0, top: 0, width: 500, height: 350 }; // exactly half scale, no letterbox
    const { cx, cy } = pointToViewBox({ x: 0.5, y: 0.5 });
    const back = clientToViewBox(cx / 2, cy / 2, rect);
    expect(back.x).toBeCloseTo(cx);
    expect(back.y).toBeCloseTo(cy);
  });

  it('accounts for xMidYMid meet letterboxing on a wide container', () => {
    // Container 2000x700: scale = min(2, 1) = 1, x offset = (2000-1000)/2 = 500.
    const rect = { left: 0, top: 0, width: 2000, height: 700 };
    const vb = clientToViewBox(500 + 132, 164, rect);
    expect(vb.x).toBeCloseTo(132);
    expect(vb.y).toBeCloseTo(164);
  });

  it('does not divide by zero on degenerate rects', () => {
    expect(clientToViewBox(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe('selection helpers', () => {
  it('distinctAgentIds dedupes while preserving first-seen order', () => {
    expect(distinctAgentIds(sixPoints)).toEqual(['agent-a', 'agent-b', 'agent-c']);
  });

  it('selectionTermsSlug kebab-joins the modal cluster top terms, <= 64 chars', () => {
    const slug = selectionTermsSlug([sixPoints[0], sixPoints[1]], mapFixture.clusters);
    expect(slug).toBe('sqlite-migration-wal-schema');
    expect(slug.length).toBeLessThanOrEqual(64);
  });

  it('selectionTermsSlug falls back when clusters carry no terms', () => {
    expect(selectionTermsSlug([sixPoints[0]], [])).toBe('selection');
  });

  it('clusterColor wraps clusterId modulo the shared 8-color palette', () => {
    expect(clusterColor(0)).toBe(CLUSTER_COLORS[0]);
    expect(clusterColor(8)).toBe(CLUSTER_COLORS[0]);
    expect(clusterColor(9)).toBe(CLUSTER_COLORS[1]);
  });

  it('defaultParleyReason names the cluster and the session count', () => {
    expect(defaultParleyReason('sqlite migration · wal', 3))
      .toBe('Operator convened parley from session galaxy cluster "sqlite migration · wal" (3 sessions)');
  });
});

// ── Component ─────────────────────────────────────────────────────────────────

describe('SessionGalaxyPanel', () => {
  it('renders one circle per galaxy point and the cluster labels', async () => {
    await renderGalaxy();
    expect(screen.getByText('sqlite migration · wal')).toBeInTheDocument();
    expect(screen.getByText('parley broker')).toBeInTheDocument();
    expect(fetchGalaxyMap).toHaveBeenCalledWith(expect.objectContaining({ windowHours: 24, minTokens: 256 }));
  });

  it('shows the session purpose in a tooltip on hover', async () => {
    await renderGalaxy();
    fireEvent.mouseEnter(screen.getByTestId('galaxy-point-t-1'), { clientX: 120, clientY: 90 });
    expect(screen.getByTestId('galaxy-tooltip')).toBeInTheDocument();
    expect(screen.getByText('Fix sqlite migration ordering')).toBeInTheDocument();
    fireEvent.mouseLeave(screen.getByTestId('galaxy-point-t-1'));
    expect(screen.queryByTestId('galaxy-tooltip')).not.toBeInTheDocument();
  });

  it('cmd-click on two points from distinct agents enables Initiate parley and posts /parley/call', async () => {
    await renderGalaxy();
    fireEvent.click(screen.getByTestId('galaxy-point-t-1'), { metaKey: true });
    fireEvent.click(screen.getByTestId('galaxy-point-t-2'), { metaKey: true });

    const button = screen.getByRole('button', { name: /initiate parley/i });
    expect(button).toBeEnabled();

    fireEvent.click(button);
    await waitFor(() => expect(callGalaxyParley).toHaveBeenCalledTimes(1));
    expect(callGalaxyParley).toHaveBeenCalledWith({
      surface: expect.stringMatching(/^galaxy:/),
      reason: defaultParleyReason('sqlite migration · wal', 2),
      calledBy: 'operator',
      parties: ['agent-a', 'agent-b'],
      trigger: 'operator',
    });
    expect(await screen.findByText(/parley parley-9 convened/i)).toBeInTheDocument();
  });

  it('keeps Initiate parley disabled when the selection spans only one distinct agent', async () => {
    await renderGalaxy();
    // t-4 and t-5 are both agent-c: two sessions, one party — daemon would 400.
    fireEvent.click(screen.getByTestId('galaxy-point-t-4'), { metaKey: true });
    fireEvent.click(screen.getByTestId('galaxy-point-t-5'), { metaKey: true });

    const button = screen.getByRole('button', { name: /initiate parley/i });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(callGalaxyParley).not.toHaveBeenCalled();
  });

  it('cmd-click toggles selection off again without opening the detail drawer', async () => {
    await renderGalaxy();
    fireEvent.click(screen.getByTestId('galaxy-point-t-1'), { metaKey: true });
    expect(screen.getByTestId('galaxy-selection-bar')).toBeInTheDocument();
    expect(fetchGalaxySessionDetail).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('galaxy-point-t-1'), { metaKey: true });
    expect(screen.queryByTestId('galaxy-selection-bar')).not.toBeInTheDocument();
  });

  it('plain click opens the detail drawer with transcript, files, tools, and an honest empty PR state', async () => {
    await renderGalaxy();
    fireEvent.click(screen.getByTestId('galaxy-point-t-1'));

    expect(fetchGalaxySessionDetail).toHaveBeenCalledWith('t-1');
    const drawer = await screen.findByTestId('galaxy-detail-drawer');
    expect(drawer).toBeInTheDocument();

    // Best-effort provenance: no PRs recorded is labeled, not implied as "no PRs produced".
    expect(await screen.findByText(/none recorded/i)).toBeInTheDocument();
    expect(screen.getByText(/lib\/migrations\.ts:12-80/)).toBeInTheDocument();
    expect(screen.getByText('Bash')).toBeInTheDocument();
    expect(screen.getByText(/Reordered the sqlite migrations/)).toBeInTheDocument();
  });

  it('surfaces a daemon parley rejection verbatim in the error banner', async () => {
    vi.mocked(callGalaxyParley).mockRejectedValueOnce(new Error('parley requires at least 2 distinct parties'));
    await renderGalaxy();
    fireEvent.click(screen.getByTestId('galaxy-point-t-1'), { metaKey: true });
    fireEvent.click(screen.getByTestId('galaxy-point-t-2'), { metaKey: true });
    fireEvent.click(screen.getByRole('button', { name: /initiate parley/i }));
    expect(await screen.findByText('parley requires at least 2 distinct parties')).toBeInTheDocument();
  });
});
