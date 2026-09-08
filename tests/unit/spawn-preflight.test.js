import { jest } from '@jest/globals';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const mockAssessBackendReadiness = jest.fn();
const mockResolveFleetAgentRuntime = jest.fn();

jest.unstable_mockModule('../../lib/backend-readiness.js', () => ({
  assessBackendReadiness: mockAssessBackendReadiness,
}));

jest.unstable_mockModule('../../lib/fleet-runtime.js', () => ({
  resolveFleetAgentRuntime: mockResolveFleetAgentRuntime,
}));

const { assessSpawnPreflight } = await import('../../lib/spawn-preflight.js');
const { CLI_BACKEND_SELECTION_PATH } = await import('../../lib/backend-catalog.js');
const { resolveModel } = await import('../../lib/model-registry.js');

describe('assessSpawnPreflight', () => {
  let previousUseCliBackend;

  beforeEach(() => {
    jest.clearAllMocks();
    previousUseCliBackend = process.env.PD_USE_CLI_BACKEND;
    process.env.PD_USE_CLI_BACKEND = 'none';
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

  afterEach(() => {
    if (previousUseCliBackend === undefined) delete process.env.PD_USE_CLI_BACKEND;
    else process.env.PD_USE_CLI_BACKEND = previousUseCliBackend;
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

    // The SHARED default is the point: preflight must report the same id the
    // resolver would pick, so a preflight can never bless a model the spawn then
    // does not use. Asserting the literal instead pinned a DATED snapshot id
    // (`-20251001`) that the registry had already corrected to the undated form
    // the vendor documents — so this test was failing on the fix.
    const sharedDefault = resolveModel({ backend: 'claude', capability: 'cheap' });
    expect(result.attempts[0].model).toBe(sharedDefault);
    expect(mockAssessBackendReadiness).toHaveBeenCalledWith('claude', {
      model: sharedDefault,
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

  test('preflights the forced CLI backend, not the requested backend', async () => {
    process.env.PD_USE_CLI_BACKEND = 'claude-code';
    mockResolveFleetAgentRuntime.mockImplementation((target) => ({
      backend: target.backend,
      model: target.model ?? null,
      modelTier: target.modelTier,
      backendSource: 'agent',
      modelSource: target.model ? 'agent' : 'unset',
      warnings: [],
    }));
    mockAssessBackendReadiness.mockImplementation(async (backend) => ({
      backend,
      status: backend === 'cli:claude-code' ? 'needs_setup' : 'ready',
      summary: backend === 'cli:claude-code'
        ? 'Claude Code CLI binary not found'
        : 'requested backend was ready',
      nextStep: backend === 'cli:claude-code' ? 'Install claude.' : undefined,
    }));

    const result = await assessSpawnPreflight({
      backend: 'openai',
      model: 'gpt-5-mini',
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

    expect(mockResolveFleetAgentRuntime).toHaveBeenCalledWith({
      backend: 'cli:claude-code',
      model: 'claude-cli',
      modelTier: undefined,
    });
    expect(mockAssessBackendReadiness).toHaveBeenCalledWith('cli:claude-code', { model: 'claude-cli' });
    expect(result.launchReady).toBe(false);
    expect(result.attempts[0]).toMatchObject({
      backend: 'cli:claude-code',
      model: 'claude-cli',
      backendSource: 'env',
      readinessStatus: 'needs_setup',
    });
    expect(result.blockedReasons.join('\n')).toContain('cli:claude-code:claude-cli — needs_setup: Claude Code CLI binary not found');
    expect(result.warnings.join('\n')).toContain('PD_USE_CLI_BACKEND forces cli:claude-code');
  });

  test('marks forced backend source as persisted when it comes from the saved CLI selection', async () => {
    const hadDefault = existsSync(CLI_BACKEND_SELECTION_PATH);
    const savedDefault = hadDefault ? readFileSync(CLI_BACKEND_SELECTION_PATH, 'utf-8') : null;
    try {
      delete process.env.PD_USE_CLI_BACKEND;
      writeFileSync(CLI_BACKEND_SELECTION_PATH, 'codex\n');
      mockResolveFleetAgentRuntime.mockImplementation((target) => ({
        backend: target.backend,
        model: target.model ?? null,
        modelTier: target.modelTier,
        backendSource: 'agent',
        modelSource: target.model ? 'agent' : 'unset',
        warnings: [],
      }));
      mockAssessBackendReadiness.mockResolvedValue({
        backend: 'cli:codex',
        status: 'manual_check',
        launchableUnverified: true,
        summary: 'Codex CLI binary found',
      });

      const result = await assessSpawnPreflight({
        backend: 'openai',
        model: 'gpt-5-mini',
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

      expect(result.attempts[0]).toMatchObject({
        backend: 'cli:codex',
        backendSource: 'persisted',
      });
      expect(result.warnings.join('\n')).toContain('Persisted CLI backend selection forces cli:codex');
      expect(result.warnings.join('\n')).not.toContain('PD_USE_CLI_BACKEND forces cli:codex');
    } finally {
      if (hadDefault) writeFileSync(CLI_BACKEND_SELECTION_PATH, savedDefault);
      else rmSync(CLI_BACKEND_SELECTION_PATH, { force: true });
    }
  });

  test('preflights forced cli:agy without inventing a default model', async () => {
    process.env.PD_USE_CLI_BACKEND = 'agy';
    mockResolveFleetAgentRuntime.mockImplementation((target) => ({
      backend: target.backend,
      model: target.model ?? null,
      modelTier: target.modelTier,
      backendSource: 'agent',
      modelSource: target.model ? 'agent' : 'unset',
      warnings: [],
    }));
    mockAssessBackendReadiness.mockImplementation(async (backend, opts) => ({
      backend,
      status: backend === 'cli:agy' ? 'manual_check' : 'ready',
      launchableUnverified: backend === 'cli:agy',
      summary: backend === 'cli:agy'
        ? `Antigravity agy CLI binary found; model=${opts?.model ?? 'unset'}`
        : 'requested backend was ready',
      nextStep: backend === 'cli:agy' ? 'Run `agy --print "hello"` once.' : undefined,
    }));

    const result = await assessSpawnPreflight({
      backend: 'openai',
      model: 'gpt-5-mini',
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

    expect(mockResolveFleetAgentRuntime).toHaveBeenCalledWith({
      backend: 'cli:agy',
      model: undefined,
      modelTier: undefined,
    });
    expect(mockAssessBackendReadiness).toHaveBeenCalledWith('cli:agy', { model: null });
    expect(result.launchReady).toBe(true);
    expect(result.attempts[0]).toMatchObject({
      backend: 'cli:agy',
      model: null,
      backendSource: 'env',
      readinessStatus: 'manual_check',
      readinessLaunchableUnverified: true,
    });
    expect(result.warnings.join('\n')).toContain('PD_USE_CLI_BACKEND forces cli:agy');
    expect(result.warnings.join('\n')).toContain('agy --print "hello"');
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

  test('launches an installed CLI backend whose auth is only unverifiable (launchableUnverified)', async () => {
    // cli:claude-code: the binary is present, auth merely cannot be checked
    // offline, so readiness is manual_check + launchableUnverified. A missing
    // token surfaces as a real non-zero-exit error at runtime (cli-tube maps
    // it), not a silent hang — so the control plane lets the operator launch.
    mockAssessBackendReadiness.mockResolvedValue({
      backend: 'cli:claude-code',
      status: 'manual_check',
      launchableUnverified: true,
      summary: 'Claude Code CLI binary found; auth cannot be verified non-interactively',
      nextStep: 'Run `claude -p "hello"` once to confirm auth.',
    });
    mockResolveFleetAgentRuntime.mockReturnValue({
      backend: 'cli:claude-code',
      model: undefined,
      modelTier: undefined,
      backendSource: 'agent',
      modelSource: 'unset',
      warnings: [],
    });

    const result = await assessSpawnPreflight({
      backend: 'cli:claude-code',
      identity: 'port-daddy:sortie:test',
      budgetUsd: 5,
    }, {
      costTracker: {
        budgetStatus: jest.fn(() => ({
          project: 'port-daddy',
          budgetUsdPerDay: 5,
          spentUsd: 0,
          remainingUsd: 5,
          percentUsed: 0,
          overBudget: false,
        })),
      },
    });

    expect(result.launchReady).toBe(true);
    expect(result.blockedReasons).toEqual([]);
    // The operator must still be told auth was not proven.
    expect(result.warnings.join('\n')).toMatch(/auth.*not.*verif|could not be verified/i);
  });

  test('still blocks a degraded manual_check backend that lacks launchableUnverified (e.g. ollama with its server down)', async () => {
    mockAssessBackendReadiness.mockResolvedValue({
      backend: 'ollama',
      status: 'manual_check',
      // no launchableUnverified — the API was probed and is unreachable.
      summary: 'Ollama CLI found, but local API is not reachable',
      nextStep: 'Start `ollama serve`.',
    });
    mockResolveFleetAgentRuntime.mockReturnValue({
      backend: 'ollama',
      model: 'llama3.1',
      modelTier: undefined,
      backendSource: 'agent',
      modelSource: 'agent',
      warnings: [],
    });

    const result = await assessSpawnPreflight({
      backend: 'ollama',
      model: 'llama3.1',
      identity: 'port-daddy:sortie:test',
      budgetUsd: 5,
    }, {
      costTracker: {
        budgetStatus: jest.fn(() => ({
          project: 'port-daddy',
          budgetUsdPerDay: 5,
          spentUsd: 0,
          remainingUsd: 5,
          percentUsed: 0,
          overBudget: false,
        })),
      },
    });

    expect(result.launchReady).toBe(false);
    expect(result.blockedReasons.join('\n')).toContain('ollama:llama3.1 — manual_check');
  });
});
