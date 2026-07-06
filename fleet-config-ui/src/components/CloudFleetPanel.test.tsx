import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import CloudFleetPanel from './CloudFleetPanel';
import type { CloudFleetTelemetry } from '../api';

// Mock the api module — the panel fetches cloud telemetry from the daemon.
const fetchMock = vi.fn();
vi.mock('../api', () => ({
  fetchCloudFleetTelemetry: (...args: unknown[]) => fetchMock(...args),
}));

const SAMPLE: CloudFleetTelemetry = {
  success: true,
  generatedAt: 1,
  since: 0,
  totals: {
    events: 6,
    uniqueDeliveries: 3,
    shipEvents: 4,
    checkRunEvents: 3,
    commentEvents: 4,
    errorEvents: 1,
    costUsd: 0.0123,
    inputTokens: 12000,
    outputTokens: 3400,
    cachedInputTokens: 0,
    totalTokens: 15400,
    estimatedCostEvents: 0,
    unknownCostEvents: 0,
  },
  byRepo: [
    { owner: 'curiositech', repo: 'port-daddy', events: 4, pullRequests: 2, costUsd: 0.01, lastSeen: 1 },
  ],
  byShip: [
    { ship: 'code-reviewer', events: 2, clean: 1, findings: 1, errors: 0, costUsd: 0.008, inputTokens: 8000, outputTokens: 2000, lastSeen: 1 },
    { ship: 'red-team', events: 2, clean: 2, findings: 0, errors: 1, costUsd: 0.004, inputTokens: 4000, outputTokens: 1400, lastSeen: 1 },
  ],
  byBackend: [
    { backend: 'cloudflare', model: '@cf/openai/gpt-oss-120b', events: 4, costUsd: 0.0123, inputTokens: 12000, outputTokens: 3400, estimatedCostEvents: 0 },
  ],
  recent: [],
};

describe('CloudFleetPanel', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('renders aggregate cost + tokens and per-ship verdict stats', async () => {
    fetchMock.mockResolvedValue(SAMPLE);
    render(<CloudFleetPanel theme="dark" embedded={false} daemonUrl="http://localhost:9876" />);

    await waitFor(() => expect(screen.getByText('CLOUD FLEET')).toBeInTheDocument());

    // Totals: PR reviews, cost, tokens.
    expect(screen.getAllByText('$0.01').length).toBeGreaterThan(0); // cost (totals + rows)
    expect(screen.getByText('15.4k')).toBeInTheDocument(); // total tokens
    expect(screen.getByText('3')).toBeInTheDocument(); // uniqueDeliveries (PR reviews)
    // Per-ship rows present with the model.
    expect(screen.getByText('pd-code-reviewer')).toBeInTheDocument();
    expect(screen.getByText('pd-red-team')).toBeInTheDocument();
    expect(screen.getByText('@cf/openai/gpt-oss-120b')).toBeInTheDocument();
    // Per-repo PR count.
    expect(screen.getByText('curiositech/port-daddy')).toBeInTheDocument();
    expect(screen.getByText('2 PRs')).toBeInTheDocument();
  });

  it('shows an empty state when the fleet has no activity', async () => {
    fetchMock.mockResolvedValue({ ...SAMPLE, totals: { ...SAMPLE.totals, events: 0 }, byShip: [], byRepo: [], byBackend: [] });
    render(<CloudFleetPanel theme="dark" embedded={false} daemonUrl="http://localhost:9876" />);
    await waitFor(() => expect(screen.getByText(/No cloud fleet activity/i)).toBeInTheDocument());
  });

  it('surfaces a fetch error without crashing', async () => {
    fetchMock.mockRejectedValue(new Error('daemon offline'));
    render(<CloudFleetPanel theme="dark" embedded={false} daemonUrl="http://localhost:9876" />);
    await waitFor(() => expect(screen.getByText(/daemon offline/i)).toBeInTheDocument());
  });
});
