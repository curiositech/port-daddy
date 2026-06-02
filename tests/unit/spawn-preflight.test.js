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

  test('returns budget status when identity, dailyBudgetUsd, and tracker are present', async () => {
    const budgetStatus = {
      project: 'port-daddy',
      budgetUsdPerDay: 0.75,
      spentUsd: 0.2,
      remainingUsd: 0.55,
      percentUsed: 26.7,
      overBudget: false,
    };
    const mockBudget = jest.fn(() => budgetStatus);

    const result = await assessSpawnPreflight({
      backend: 'claude-cli',
      identity: 'port-daddy:repo:cli',
      budgetUsd: 0.75,
      dailyBudgetUsd: 0.75,
    }, {
      costTracker: {
        budgetStatus: mockBudget,
      },
    });

    expect(result.launchReady).toBe(true);
    expect(result.budget).toEqual(budgetStatus);
    expect(mockBudget).toHaveBeenCalledWith('port-daddy', 0.75);
    expect(mockAssessBackendReadiness).toHaveBeenCalledWith('claude-cli', { model: 'sonnet' });
  });

  test('does NOT trigger the budget overage check when only per-call budgetUsd is set', async () => {
    // Regression: previously the per-mission --budget was conflated with a
    // daily project ceiling, so a $0.10 sortie would be "blocked" by $1.60
    // of pre-existing project spend in the last 24h. The per-call cap is
    // enforced inside the spawner during execution, not at preflight.
    const mockBudget = jest.fn(() => ({
      project: 'port-daddy',
      budgetUsdPerDay: 0.10,
      spentUsd: 1.60,
      remainingUsd: 0,
      percentUsed: 1600,
      overBudget: true,
    }));

    const result = await assessSpawnPreflight({
      backend: 'claude-cli',
      identity: 'port-daddy:sortie:test:coordinator',
      budgetUsd: 0.10,
    }, {
      costTracker: { budgetStatus: mockBudget },
    });

    expect(mockBudget).not.toHaveBeenCalled();
    expect(result.budget).toBeNull();
    expect(result.launchReady).toBe(true);
    expect(result.blockedReasons).toEqual([]);
  });

  test('blocks when dailyBudgetUsd is set and the project is over the daily ceiling', async () => {
    const mockBudget = jest.fn(() => ({
      project: 'port-daddy',
      budgetUsdPerDay: 5.00,
      spentUsd: 6.42,
      remainingUsd: 0,
      percentUsed: 128.4,
      overBudget: true,
    }));

    const result = await assessSpawnPreflight({
      backend: 'claude-cli',
      identity: 'port-daddy:fleet:cartographer',
      budgetUsd: 0.25,
      dailyBudgetUsd: 5.00,
    }, {
      costTracker: { budgetStatus: mockBudget },
    });

    expect(mockBudget).toHaveBeenCalledWith('port-daddy', 5.00);
    expect(result.launchReady).toBe(false);
    expect(result.blockedReasons).toContain(
      'Budget exceeded for port-daddy ($6.42 / $5.00).'
    );
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
      'No launchable backend (no configured attempt is setup-ready):',
    );
    expect(result.blockedReasons.join('\n')).toContain(
      'ollama:qwen2.5-coder:7b — needs_setup: Ollama is blocked until exact telemetry exists. Next: Use a Claude model with an exact nonzero rate.',
    );
  });

  test('blocks manual-check runtimes until readiness is proven', async () => {
    mockAssessBackendReadiness.mockResolvedValue({
      backend: 'codex',
      status: 'manual_check',
      summary: 'Codex auth cannot be verified non-interactively',
      nextStep: 'Run codex exec once interactively.',
    });
    mockResolveFleetAgentRuntime.mockReturnValue({
      backend: 'codex',
      model: 'gpt-5.4-mini',
      modelTier: undefined,
      backendSource: 'agent',
      modelSource: 'agent',
      warnings: [],
    });

    const result = await assessSpawnPreflight({
      backend: 'codex',
      model: 'gpt-5.4-mini',
      identity: 'port-daddy:fleet:test-hunter',
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
    expect(result.blockedReasons.join('\n')).toContain('codex:gpt-5.4-mini — manual_check');
  });
});
