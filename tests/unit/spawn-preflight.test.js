import { jest } from '@jest/globals';

const mockAssessBackendReadiness = jest.fn();
const mockResolveFleetAgentRuntime = jest.fn();

jest.unstable_mockModule('../../lib/backend-readiness.js', () => ({
  assessBackendReadiness: mockAssessBackendReadiness,
}));

jest.unstable_mockModule('../../lib/fleet-engine.js', () => ({
  resolveFleetAgentRuntime: mockResolveFleetAgentRuntime,
}));

const { assessSpawnPreflight } = await import('../../lib/spawn-preflight.js');

describe('assessSpawnPreflight', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveFleetAgentRuntime.mockReturnValue({
      backend: 'claude-cli',
      model: 'sonnet',
      modelTier: undefined,
      backendSource: 'agent',
      modelSource: 'agent',
      warnings: [],
    });
    mockAssessBackendReadiness.mockResolvedValue({
      backend: 'claude-cli',
      status: 'ready',
      summary: 'ready',
      nextStep: undefined,
    });
  });

  test('blocks launches without a semantic identity', async () => {
    const result = await assessSpawnPreflight({
      backend: 'claude-cli',
      budgetUsd: 0.75,
    }, {
      costTracker: {
        budgetStatus: jest.fn(() => ({
          project: 'port-daddy',
          budgetUsdPerDay: 0.75,
          spentUsd: 0,
          remainingUsd: 0.75,
          percentUsed: 0,
          overBudget: false,
        })),
      },
    });

    expect(result.launchReady).toBe(false);
    expect(result.blockedReasons).toContain(
      'Semantic identity is required so spend can be attributed to a project budget.'
    );
  });

  test('blocks launches when cost tracker is unavailable', async () => {
    const result = await assessSpawnPreflight({
      backend: 'claude-cli',
      identity: 'port-daddy:repo:cli',
      budgetUsd: 0.75,
    });

    expect(result.launchReady).toBe(false);
    expect(result.blockedReasons).toContain(
      'Cost tracker unavailable; refusing unmetered agent launch.'
    );
  });

  test('returns budget status when identity, budget, and tracker are present', async () => {
    const budgetStatus = {
      project: 'port-daddy',
      budgetUsdPerDay: 0.75,
      spentUsd: 0.2,
      remainingUsd: 0.55,
      percentUsed: 26.7,
      overBudget: false,
    };

    const result = await assessSpawnPreflight({
      backend: 'claude-cli',
      identity: 'port-daddy:repo:cli',
      budgetUsd: 0.75,
    }, {
      costTracker: {
        budgetStatus: jest.fn(() => budgetStatus),
      },
    });

    expect(result.launchReady).toBe(true);
    expect(result.budget).toEqual(budgetStatus);
  });
});
