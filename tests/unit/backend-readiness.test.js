import { jest } from '@jest/globals';

const mockSpawnSync = jest.fn();
const installedPackages = new Set(['@anthropic-ai/sdk', '@google/generative-ai']);

jest.unstable_mockModule('node:child_process', () => ({
  spawnSync: mockSpawnSync,
}));

jest.unstable_mockModule('node:module', () => ({
  createRequire: () => ({
    resolve(specifier) {
      if (installedPackages.has(specifier)) return `/mocked/${specifier}`;
      throw new Error(`Cannot find module ${specifier}`);
    },
  }),
}));

const { assessBackendReadiness } = await import('../../lib/backend-readiness.js');

describe('backend readiness', () => {
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
  const originalGeminiKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    global.fetch = jest.fn(async () => {
      throw new Error('offline');
    });
  });

  afterAll(() => {
    if (originalAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalAnthropicKey;

    if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalGeminiKey;
  });

  test('reports Claude SDK backend as ready when ANTHROPIC_API_KEY is present', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';

    const readiness = await assessBackendReadiness('claude');

    expect(readiness).toMatchObject({
      backend: 'claude',
      status: 'ready',
      summary: 'ANTHROPIC_API_KEY present and Claude SDK installed',
    });
  });

  test('reports Gemini backend as needs setup when GEMINI_API_KEY is missing', async () => {
    const readiness = await assessBackendReadiness('gemini');

    expect(readiness).toMatchObject({
      backend: 'gemini',
      status: 'needs_setup',
      summary: 'GEMINI_API_KEY missing',
    });
    expect(readiness.nextStep).toContain('GEMINI_API_KEY');
  });

  test('reports claude-cli as needs setup when the CLI binary is missing', async () => {
    mockSpawnSync.mockReturnValue({ status: 1 });

    const readiness = await assessBackendReadiness('claude-cli');

    expect(mockSpawnSync).toHaveBeenCalledWith('which', ['claude'], expect.objectContaining({
      encoding: 'utf-8',
    }));
    expect(readiness).toMatchObject({
      backend: 'claude-cli',
      status: 'needs_setup',
      summary: 'Claude CLI binary not found',
    });
  });

  test('reports codex as manual check when the CLI binary is present', async () => {
    mockSpawnSync.mockImplementation((command, args) => ({
      status: command === 'which' && args[0] === 'codex' ? 0 : 1,
    }));

    const readiness = await assessBackendReadiness('codex');

    expect(mockSpawnSync).toHaveBeenCalledWith('which', ['codex'], expect.objectContaining({
      encoding: 'utf-8',
    }));
    expect(readiness).toMatchObject({
      backend: 'codex',
      status: 'manual_check',
      summary: 'Codex CLI binary found; OpenAI auth and model access cannot be verified non-interactively',
    });
  });

  test('reports ollama as manual check when the CLI exists but the local API is down', async () => {
    mockSpawnSync.mockImplementation((command, args) => ({
      status: command === 'which' && args[0] === 'ollama' ? 0 : 1,
    }));

    const readiness = await assessBackendReadiness('ollama');

    expect(readiness).toMatchObject({
      backend: 'ollama',
      status: 'manual_check',
      summary: 'Ollama CLI found, but local API is not reachable',
    });
    expect(readiness.nextStep).toContain('ollama serve');
  });
});
