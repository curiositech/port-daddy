import { jest } from '@jest/globals';

const mockPdFetch = jest.fn();
const mockUi = {
  error: jest.fn(),
  info: jest.fn(),
  success: jest.fn(),
  warn: jest.fn(),
};
const mockLoadFleetConfig = jest.fn();
const mockResolveFleetAgentRuntime = jest.fn();
const mockAssessBackendReadiness = jest.fn();

jest.unstable_mockModule('../../cli/utils/fetch.js', () => ({
  pdFetch: mockPdFetch,
  PORT_DADDY_URL: 'http://localhost:9876',
  isDaemonRunning: jest.fn(),
  getDaemonUrl: jest.fn(() => 'http://localhost:9876'),
}));

jest.unstable_mockModule('../../cli/utils/ui.js', () => mockUi);

jest.unstable_mockModule('../../cli/utils/post-commit-hook.js', () => ({
  isLegacyPortDaddyPostCommitHook: jest.fn(() => false),
  isScopedPortDaddyPostCommitHook: jest.fn(() => false),
  loadPostCommitHookTemplate: jest.fn(() => '#!/bin/zsh\n'),
}));

jest.unstable_mockModule('../../lib/fleet-engine.js', () => ({
  findFleetConfigPath: jest.fn(() => '/tmp/pd-fleet.yml'),
  loadFleetConfig: mockLoadFleetConfig,
  createFleetRunner: jest.fn(),
  getFleetRuntimeDefaults: jest.fn(() => ({})),
  resolveFleetAgentRuntime: mockResolveFleetAgentRuntime,
  validateTopology: jest.fn(() => ({ valid: true, cycle: null })),
}));

jest.unstable_mockModule('../../lib/backend-readiness.js', () => ({
  assessBackendReadiness: mockAssessBackendReadiness,
}));

jest.unstable_mockModule('../../lib/fleet-channels.js', () => ({
  resolveFleetChannel: jest.fn((channel) => channel),
}));

// The HITL pre-flight (docs/hitl-interruptions.md §4.3) polls the relay when
// the developer's machine is signed in via `pd account login` — a unit test
// must never make that network call. Wiring is covered in
// fleet-interruptions-gate.test.js; here the gate always passes.
jest.unstable_mockModule('../../cli/commands/interruptions.js', () => ({
  preflightInterruptionsGate: jest.fn(async () => true),
}));

const { handleFleet } = await import('../../cli/commands/fleet.js');

function response(ok, data) {
  return {
    ok,
    async json() {
      return data;
    },
  };
}

describe('pd fleet run budget forwarding', () => {
  const originalExit = process.exit;
  const originalLog = console.log;

  beforeEach(() => {
    jest.clearAllMocks();
    process.exit = jest.fn((code) => { throw new Error(`exit:${code}`); });
    console.log = jest.fn();
    mockAssessBackendReadiness.mockResolvedValue({
      backend: 'ollama',
      status: 'ready',
      summary: 'ready',
      nextStep: null,
    });
  });

  afterAll(() => {
    process.exit = originalExit;
    console.log = originalLog;
  });

  test('forwards fleet daily budget to daemon spawn for one-shot fleet runs', async () => {
    mockLoadFleetConfig.mockReturnValue({
      name: 'port-daddy-dev',
      limits: { budgetUsdPerDay: 5 },
      agents: [
        {
          name: 'documentarian',
          prompt: 'Sync docs',
          identity: 'port-daddy:fleet:documentarian',
        },
      ],
      watchers: [],
      channels: {},
    });

    mockResolveFleetAgentRuntime.mockReturnValue({
      backend: 'ollama',
      model: 'qwen2.5-coder:7b',
    });

    mockPdFetch.mockResolvedValueOnce(response(true, {
      status: 'completed',
      output: 'done',
    }));

    await handleFleet(['run', 'documentarian'], {});

    const body = JSON.parse(mockPdFetch.mock.calls[0][1].body);
    expect(body).toMatchObject({
      backend: 'ollama',
      model: 'qwen2.5-coder:7b',
      identity: 'port-daddy:fleet:documentarian',
      purpose: 'Fleet agent: documentarian',
      budgetUsd: 5,
    });
  });

  test('fails fast when fleet daily budget is missing', async () => {
    mockLoadFleetConfig.mockReturnValue({
      name: 'port-daddy-dev',
      limits: {},
      agents: [
        {
          name: 'documentarian',
          prompt: 'Sync docs',
          identity: 'port-daddy:fleet:documentarian',
        },
      ],
      watchers: [],
      channels: {},
    });

    mockResolveFleetAgentRuntime.mockReturnValue({
      backend: 'ollama',
      model: 'qwen2.5-coder:7b',
    });

    await expect(handleFleet(['run', 'documentarian'], {})).rejects.toThrow('exit:1');
    expect(mockUi.error).toHaveBeenCalledWith(
      'Fleet agent "documentarian" cannot run without limits.budget_usd_per_day (or budgetUsdPerDay) in pd-fleet.yml'
    );
    expect(mockPdFetch).not.toHaveBeenCalled();
  });

  test('fleet status reports harbor-backed registered members even when /agents is sparse', async () => {
    mockLoadFleetConfig.mockReturnValue({
      name: 'workgroup-ai',
      harbor: 'workgroup-ai:fleet',
      limits: { budgetUsdPerDay: 5 },
      agents: [
        {
          name: 'qa',
          trigger: 'git:committed',
          identity: 'workgroup-ai:fleet:qa',
        },
      ],
      watchers: [],
      channels: {},
    });

    mockResolveFleetAgentRuntime.mockReturnValue({
      backend: 'ollama',
      model: 'qwen2.5-coder:7b',
      warnings: [],
    });

    mockPdFetch
      // `pd fleet status` now consults the daemon's /fleet endpoint first
      // (lib/fleet-running-state.ts). An empty fleets payload means the
      // resolver falls back to the standalone state-file path, preserving
      // the original "not running" branch this test was written against.
      .mockResolvedValueOnce(response(true, { running: false, fleets: [] }))
      .mockResolvedValueOnce(response(true, {
        members: [{ agentId: 'workgroup-ai:fleet:qa', identity: 'workgroup-ai:fleet:qa' }],
      }))
      .mockResolvedValueOnce(response(true, {
        agents: [],
      }))
      .mockResolvedValue(response(true, { messages: [] }));

    await handleFleet(['status'], {});

    expect(mockPdFetch).toHaveBeenCalledWith('/harbors/workgroup-ai%3Afleet/members');
    expect(console.log).toHaveBeenCalledWith('  [~] workgroup-ai:fleet:qa — workgroup-ai:fleet:qa');
  });
});
