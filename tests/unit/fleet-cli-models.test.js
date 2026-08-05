import { jest } from '@jest/globals';

const mockPdFetch = jest.fn();
const mockUi = {
  error: jest.fn(),
  info: jest.fn(),
  success: jest.fn(),
  warn: jest.fn(),
};

jest.unstable_mockModule('../../cli/utils/fetch.js', () => ({
  pdFetch: mockPdFetch,
  PORT_DADDY_URL: 'http://localhost:43121',
  isDaemonRunning: jest.fn(),
  getDaemonUrl: jest.fn(() => 'http://localhost:43121'),
}));

jest.unstable_mockModule('../../cli/utils/ui.js', () => mockUi);

jest.unstable_mockModule('../../cli/utils/post-commit-hook.js', () => ({
  isLegacyPortDaddyPostCommitHook: jest.fn(() => false),
  isScopedPortDaddyPostCommitHook: jest.fn(() => false),
  loadPostCommitHookTemplate: jest.fn(() => '#!/bin/zsh\n'),
}));

jest.unstable_mockModule('../../lib/fleet-engine.js', () => ({
  findFleetConfigPath: jest.fn(() => null),
  loadFleetConfig: jest.fn(() => null),
  createFleetRunner: jest.fn(),
  getFleetRuntimeDefaults: jest.fn(() => ({})),
  resolveFleetAgentRuntime: jest.fn(() => ({})),
  validateTopology: jest.fn(() => ({ valid: true, cycle: null })),
}));

jest.unstable_mockModule('../../lib/backend-readiness.js', () => ({
  assessBackendReadiness: jest.fn(),
}));

jest.unstable_mockModule('../../lib/fleet-channels.js', () => ({
  resolveFleetChannel: jest.fn((channel) => channel),
}));

const { handleFleet } = await import('../../cli/commands/fleet.js');

function response(ok, data) {
  return {
    ok,
    status: ok ? 200 : 500,
    async json() {
      return data;
    },
  };
}

const modelsPayload = {
  success: true,
  backends: [
    {
      id: 'cloudflare',
      name: 'Cloudflare Workers AI',
      modelTiers: {
        low: '@cf/zai-org/glm-4.7-flash',
        mid: '@cf/openai/gpt-oss-120b',
        high: '@cf/moonshotai/kimi-k2-instruct',
      },
      readinessStatus: 'needs_setup',
      readinessSummary: 'Cloudflare Workers AI credentials missing',
      readinessNextStep: 'Add Cloudflare credentials.',
      credentialKeys: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'],
      credentialAlternates: ['CF_ACCOUNT_ID', 'CF_API_TOKEN'],
      setupLinks: [{ label: 'Create pd-ai-stack token', url: 'https://dash.cloudflare.com/?to=/:account/api-tokens' }],
      setupCommand: "printf '\\nCLOUDFLARE_ACCOUNT_ID=<paste-value>\\nCLOUDFLARE_API_TOKEN=<paste-value>\\n' >> ~/.port-daddy-env\npd restart",
    },
    {
      id: 'codex',
      name: 'OpenAI Codex CLI',
      modelTiers: {
        low: 'gpt-5.4-mini',
        mid: 'gpt-5.3-codex',
        high: 'gpt-5.4',
      },
      readinessStatus: 'manual_check',
      readinessSummary: 'Codex CLI binary found',
    },
  ],
};

describe('pd fleet models', () => {
  const originalExit = process.exit;
  const originalLog = console.log;

  beforeEach(() => {
    jest.clearAllMocks();
    process.exit = jest.fn((code) => { throw new Error(`exit:${code}`); });
    console.log = jest.fn();
    mockPdFetch.mockResolvedValue(response(true, modelsPayload));
  });

  afterAll(() => {
    process.exit = originalExit;
    console.log = originalLog;
  });

  test('prints backend model tiers from the daemon catalog', async () => {
    await handleFleet(['models'], {});

    expect(mockPdFetch).toHaveBeenCalledWith('/fleet/models');
    expect(mockUi.info).toHaveBeenCalledWith('Fleet backend model tiers');
    expect(console.log).toHaveBeenCalledWith('cloudflare — Cloudflare Workers AI [needs_setup]');
    expect(console.log).toHaveBeenCalledWith('  low  @cf/zai-org/glm-4.7-flash');
    expect(console.log).toHaveBeenCalledWith('  mid  @cf/openai/gpt-oss-120b');
    expect(console.log).toHaveBeenCalledWith('  high @cf/moonshotai/kimi-k2-instruct');
    expect(console.log).toHaveBeenCalledWith('codex — OpenAI Codex CLI [manual_check]');
  });

  test('filters to one backend and includes setup details', async () => {
    await handleFleet(['models', 'cloudflare'], {});

    expect(mockUi.info).toHaveBeenCalledWith('Fleet backend model tiers: cloudflare');
    expect(console.log).toHaveBeenCalledWith('  credentials: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN');
    expect(console.log).toHaveBeenCalledWith('  alternates: CF_ACCOUNT_ID, CF_API_TOKEN');
    expect(console.log).toHaveBeenCalledWith('  link: Create pd-ai-stack token - https://dash.cloudflare.com/?to=/:account/api-tokens');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('setup: printf'));
  });

  test('returns filtered JSON for scripts', async () => {
    await handleFleet(['models'], { json: true, backend: 'codex' });

    const printed = JSON.parse(console.log.mock.calls[0][0]);
    expect(printed).toEqual({
      success: true,
      backends: [modelsPayload.backends[1]],
    });
  });

  test('fails clearly for unknown backends', async () => {
    await expect(handleFleet(['models', 'mystery'], {})).rejects.toThrow('exit:1');

    expect(mockUi.error).toHaveBeenCalledWith('Unknown backend: mystery');
    expect(mockUi.info).toHaveBeenCalledWith('Available: cloudflare, codex');
  });
});
