import { jest } from '@jest/globals';

const mockSpawnSync = jest.fn();
const installedPackages = new Set(['@anthropic-ai/sdk', '@google/generative-ai']);
const secretValues = new Map();
const mockGetSecret = jest.fn((key) => secretValues.get(key));

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

jest.unstable_mockModule('../../lib/secret-env.js', () => ({
  getSecret: mockGetSecret,
}));

const { assessBackendReadiness } = await import('../../lib/backend-readiness.js');

describe('backend readiness', () => {
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
  const originalGeminiKey = process.env.GEMINI_API_KEY;
  const originalCfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const originalCfApiToken = process.env.CLOUDFLARE_API_TOKEN;

  beforeEach(() => {
    jest.clearAllMocks();
    secretValues.clear();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;
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
    secretValues.set('ANTHROPIC_API_KEY', 'sk-test');

    const readiness = await assessBackendReadiness('claude', {
      model: 'claude-haiku-4-5-20251001',
    });

    expect(mockGetSecret).toHaveBeenCalledWith('ANTHROPIC_API_KEY');
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
    secretValues.set('ANTHROPIC_API_KEY', 'sk-test');

    const readiness = await assessBackendReadiness('claude');

    expect(mockGetSecret).toHaveBeenCalledWith('ANTHROPIC_API_KEY');
    expect(readiness).toMatchObject({
      backend: 'claude',
      status: 'ready',
    });
    expect(readiness.summary).toContain('ANTHROPIC_API_KEY present');
    expect(readiness.setupCommand).toContain('ANTHROPIC_API_KEY=<paste-value>');
  });

  test('blocks Gemini backend behind the telemetry policy', async () => {
    const readiness = await assessBackendReadiness('gemini');

    expect(mockGetSecret).toHaveBeenNthCalledWith(1, 'GEMINI_API_KEY');
    expect(mockGetSecret).toHaveBeenNthCalledWith(2, 'GOOGLE_API_KEY');
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

  test('marks Cloudflare backend ready when credentials are present (telemetry policy allows it)', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct-123';
    secretValues.set('CLOUDFLARE_ACCOUNT_ID', 'acct-123');
    secretValues.set('CLOUDFLARE_API_TOKEN', 'token-123');

    const readiness = await assessBackendReadiness('cloudflare');

    // Order: account-id first (resolved via getSecret), then API token.
    expect(mockGetSecret).toHaveBeenCalledTimes(2);
    expect(mockGetSecret).toHaveBeenNthCalledWith(1, 'CLOUDFLARE_ACCOUNT_ID');
    expect(mockGetSecret).toHaveBeenNthCalledWith(2, 'CLOUDFLARE_API_TOKEN');
    expect(readiness).toMatchObject({
      backend: 'cloudflare',
      status: 'ready',
    });
    // Cloudflare default model (@cf/zai-org/glm-4.7-flash) has an exact cost
    // rate in lib/cost-tracker.ts, so the fail-closed telemetry policy allows
    // launch. See commit 30e0597e (cloudflare wired as runnable fallback).
    expect(readiness.summary).toContain('Cloudflare Workers AI credentials present');
    expect(readiness.credentialKeys).toEqual(['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN']);
    expect(readiness.credentialAlternates).toEqual(['CLOUDFLARE_API_KEY', 'CF_API_TOKEN', 'CF_ACCOUNT_ID']);
  });

  test('keeps claude-cli probe details when binary is missing and stamps the fail-closed telemetry summary', async () => {
    mockSpawnSync.mockReturnValue({ status: 1 });

    const readiness = await assessBackendReadiness('claude-cli', { model: 'unknown-rateless-model-9999' });

    expect(mockSpawnSync).toHaveBeenCalledWith('which', ['claude'], expect.objectContaining({
      encoding: 'utf-8',
    }));
    expect(readiness).toMatchObject({
      backend: 'claude-cli',
      status: 'needs_setup',
    });
    // The combined summary has the binary-probe detail AND the claude-cli
    // telemetry-policy detail. After the latest policy revision claude-cli is
    // fail-closed regardless of model (subprocess telemetry can't prove exact
    // token counts), so the policy summary appends to the readiness summary.
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
