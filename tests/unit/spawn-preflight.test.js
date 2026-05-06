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
    expect(mockAssessBackendReadiness).toHaveBeenCalledWith('claude-cli', { model: 'sonnet' });
  });

  test('surfaces the shared Claude default model in attempts when no model is provided', async () => {
    mockResolveFleetAgentRuntime.mockReturnValue({
      backend: 'claude',
      model: null,
      modelTier: null,
      backendSource: 'agent',
      modelSource: 'unset',
      warnings: [],
    });

    const result = await assessSpawnPreflight({
      backend: 'claude',
      identity: 'port-daddy:repo:cli',
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

    expect(result.attempts[0].model).toBe('claude-haiku-4-5-20251001');
    expect(mockAssessBackendReadiness).toHaveBeenCalledWith('claude', {
      model: 'claude-haiku-4-5-20251001',
    });
  });

  test('explains every blocked backend attempt when none are launchable', async () => {
    mockResolveFleetAgentRuntime.mockReturnValue({
      backend: 'ollama',
      model: 'qwen2.5-coder:7b',
      modelTier: undefined,
      backendSource: 'agent',
      modelSource: 'agent',
      warnings: [],
    });
    mockAssessBackendReadiness.mockResolvedValue({
      backend: 'ollama',
      status: 'needs_setup',
      summary: 'Ollama is blocked until exact telemetry exists.',
      nextStep: 'Use a Claude model with an exact nonzero rate.',
    });

    const result = await assessSpawnPreflight({
      backend: 'ollama',
      model: 'qwen2.5-coder:7b',
      identity: 'port-daddy:fleet:cartographer',
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
    expect(result.blockedReasons.join('\n')).toContain(
      'No launchable backend (every configured attempt is blocked at readiness):',
    );
    expect(result.blockedReasons.join('\n')).toContain(
      'ollama:qwen2.5-coder:7b — Ollama is blocked until exact telemetry exists. Next: Use a Claude model with an exact nonzero rate.',
    );
  });
});
