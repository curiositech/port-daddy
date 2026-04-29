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

const { _resetForTests: resetSecrets } = await import('../../lib/secret-env.js');
const { assessBackendReadiness } = await import('../../lib/backend-readiness.js');

describe('backend readiness', () => {
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
  const originalGeminiKey = process.env.GEMINI_API_KEY;
  const originalCfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const originalCfApiToken = process.env.CLOUDFLARE_API_TOKEN;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;
    resetSecrets();
    global.fetch = jest.fn(async () => {
      throw new Error('offline');
    });
  });

  afterAll(() => {
    if (originalAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalAnthropicKey;

    if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalGeminiKey;

    if (originalCfAccountId === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID;
    else process.env.CLOUDFLARE_ACCOUNT_ID = originalCfAccountId;

    if (originalCfApiToken === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
    else process.env.CLOUDFLARE_API_TOKEN = originalCfApiToken;
  });

  test('reports Claude SDK backend as ready when ANTHROPIC_API_KEY is present and the model has an exact rate', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';

    const readiness = await assessBackendReadiness('claude', {
      model: 'claude-haiku-4-5-20251001',
    });

    expect(readiness).toMatchObject({
      backend: 'claude',
      status: 'ready',
      summary: 'ANTHROPIC_API_KEY present and Claude SDK installed',
      credentialKeys: ['ANTHROPIC_API_KEY'],
      setupFiles: ['~/.port-daddy-env', '.env.local', '.env'],
      restartRequired: true,
    });
  });

  test('uses the shared exact-rate Claude default when no model is supplied', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';

    const readiness = await assessBackendReadiness('claude');

    expect(readiness).toMatchObject({
      backend: 'claude',
      status: 'ready',
    });
    expect(readiness.summary).toContain('ANTHROPIC_API_KEY present');
    expect(readiness.setupCommand).toContain('ANTHROPIC_API_KEY=<paste-value>');
  });

  test('blocks Gemini backend behind the telemetry policy', async () => {
    const readiness = await assessBackendReadiness('gemini');

    expect(readiness).toMatchObject({
      backend: 'gemini',
      status: 'needs_setup',
    });
    expect(readiness.summary).toContain('Gemini API key missing');
    expect(readiness.summary).toContain('blocked until exact token counts');
    expect(readiness.credentialKeys).toEqual(['GEMINI_API_KEY']);
    expect(readiness.credentialAlternates).toEqual(['GOOGLE_API_KEY']);
    expect(readiness.nextStep).toContain('~/.port-daddy-env');
  });

  test('blocks Cloudflare backend even when credentials are present', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct-123';
    process.env.CLOUDFLARE_API_TOKEN = 'token-123';

    const readiness = await assessBackendReadiness('cloudflare');

    expect(readiness).toMatchObject({
      backend: 'cloudflare',
      status: 'needs_setup',
    });
    expect(readiness.summary).toContain('blocked until exact token counts');
    expect(readiness.credentialKeys).toEqual(['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN']);
    expect(readiness.credentialAlternates).toEqual(['CLOUDFLARE_API_KEY', 'CF_API_TOKEN', 'CF_ACCOUNT_ID']);
  });

  test('keeps claude-cli probe details while still blocking launch under telemetry policy', async () => {
    mockSpawnSync.mockReturnValue({ status: 1 });

    const readiness = await assessBackendReadiness('claude-cli');

    expect(mockSpawnSync).toHaveBeenCalledWith('which', ['claude'], expect.objectContaining({
      encoding: 'utf-8',
    }));
    expect(readiness).toMatchObject({
      backend: 'claude-cli',
      status: 'needs_setup',
    });
    expect(readiness.summary).toContain('Claude CLI binary not found');
    expect(readiness.summary).toContain('blocked until exact token counts');
    expect(readiness.setupCommand).toBe('claude');
  });

  test('keeps codex probe details and allows launch when exact telemetry is available', async () => {
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
    });
    expect(readiness.summary).toContain('Codex CLI binary found');
    expect(readiness.summary).not.toContain('blocked until exact token counts');
    expect(readiness.setupCommand).toBe('codex exec "print ok"');
  });

  test('blocks codex models without exact cost rates', async () => {
    mockSpawnSync.mockImplementation((command, args) => ({
      status: command === 'which' && args[0] === 'codex' ? 0 : 1,
    }));

    const readiness = await assessBackendReadiness('codex', {
      model: 'gpt-mystery-model',
    });

    expect(readiness).toMatchObject({
      backend: 'codex',
      status: 'needs_setup',
    });
    expect(readiness.summary).toContain('Codex CLI binary found');
    expect(readiness.summary).toContain('has no exact cost rate entry');
  });

  test('keeps ollama probe details while still blocking launch under telemetry policy', async () => {
    mockSpawnSync.mockImplementation((command, args) => ({
      status: command === 'which' && args[0] === 'ollama' ? 0 : 1,
    }));

    const readiness = await assessBackendReadiness('ollama');

    expect(readiness).toMatchObject({
      backend: 'ollama',
      status: 'needs_setup',
    });
    expect(readiness.summary).toContain('Ollama CLI found, but local API is not reachable');
    expect(readiness.summary).toContain('blocked until Port Daddy can attach exact token counts');
    expect(readiness.setupCommand).toBe('ollama serve');
    expect(mockSpawnSync).toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalled();
  });
});
