import { jest } from '@jest/globals';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  const originalHome = process.env.HOME;
  const originalPath = process.env.PATH;
  const originalCliBinDirs = process.env.PD_CLI_BIN_DIRS;
  let fakeHome;
  // The cli:* readiness tests `delete process.env.PD_CLI_*_BIN`; capture and
  // restore them around the suite so a developer with these set locally gets a
  // hermetic run and no state leaks into later tests.
  const CLI_BIN_ENV_KEYS = [
    'PD_CLI_CLAUDE_CODE_BIN',
    'PD_CLI_CODEX_BIN',
    'PD_CLI_AGY_BIN',
    'PD_CLI_GEMINI_BIN',
    'PD_CLI_GROQ_BIN',
    'PD_CLI_GROK_BIN',
  ];
  const originalCliBins = Object.fromEntries(
    CLI_BIN_ENV_KEYS.map((key) => [key, process.env[key]]),
  );

  beforeEach(() => {
    jest.clearAllMocks();
    secretValues.clear();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;
    fakeHome = mkdtempSync(join(tmpdir(), 'pd-readiness-home-'));
    process.env.HOME = fakeHome;
    process.env.PATH = '/usr/bin:/bin';
    delete process.env.PD_CLI_BIN_DIRS;
    for (const key of CLI_BIN_ENV_KEYS) delete process.env[key];
    global.fetch = jest.fn(async () => {
      throw new Error('offline');
    });
  });

  afterEach(() => {
    try { rmSync(fakeHome, { recursive: true, force: true }); } catch { /* noop */ }
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

    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;

    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;

    if (originalCliBinDirs === undefined) delete process.env.PD_CLI_BIN_DIRS;
    else process.env.PD_CLI_BIN_DIRS = originalCliBinDirs;

    for (const key of CLI_BIN_ENV_KEYS) {
      if (originalCliBins[key] === undefined) delete process.env[key];
      else process.env[key] = originalCliBins[key];
    }
  });

  function installCli(name, dir = join(fakeHome, '.local', 'bin')) {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, name);
    writeFileSync(file, '#!/bin/sh\necho ok\n');
    chmodSync(file, 0o755);
    return file;
  }

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

  test('reports Gemini needs_setup when no API key is present (REST adapter, no SDK required)', async () => {
    const readiness = await assessBackendReadiness('gemini');

    expect(mockGetSecret).toHaveBeenNthCalledWith(1, 'GEMINI_API_KEY');
    expect(mockGetSecret).toHaveBeenNthCalledWith(2, 'GOOGLE_API_KEY');
    expect(readiness).toMatchObject({
      backend: 'gemini',
      status: 'needs_setup',
    });
    expect(readiness.summary).toContain('Gemini API key missing');
    // No SDK requirement anymore — the REST adapter needs no package.
    expect(readiness.summary).not.toContain('generative-ai');
    expect(readiness.credentialKeys).toEqual(['GEMINI_API_KEY']);
    expect(readiness.credentialAlternates).toEqual(['GOOGLE_API_KEY']);
    expect(readiness.nextStep).toContain('GEMINI_API_KEY');
  });

  test('reports Gemini ready when GEMINI_API_KEY is present (telemetry policy allows the default model)', async () => {
    secretValues.set('GEMINI_API_KEY', 'g-key');
    const readiness = await assessBackendReadiness('gemini');
    expect(readiness).toMatchObject({ backend: 'gemini', status: 'ready' });
    expect(readiness.summary).toContain('Gemini API key present');
  });

  test('reports Groq ready when GROQ_API_KEY is present', async () => {
    secretValues.set('GROQ_API_KEY', 'gsk');
    const readiness = await assessBackendReadiness('groq');
    expect(readiness).toMatchObject({ backend: 'groq', status: 'ready' });
    expect(readiness.summary).toContain('GROQ_API_KEY present');
  });

  test('reports Groq needs_setup when GROQ_API_KEY is missing', async () => {
    const readiness = await assessBackendReadiness('groq');
    expect(readiness).toMatchObject({ backend: 'groq', status: 'needs_setup' });
    expect(readiness.summary).toContain('GROQ_API_KEY missing');
    expect(readiness.nextStep).toContain('GROQ_API_KEY');
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
    const readiness = await assessBackendReadiness('claude-cli', { model: 'unknown-rateless-model-9999' });

    expect(readiness).toMatchObject({
      backend: 'claude-cli',
      status: 'needs_setup',
    });
    // The combined summary has the binary-probe detail AND the claude-cli
    // telemetry-policy detail. Per the estimate-fallback revision
    // (lib/backend-telemetry-policy.ts `claude-cli` case), claude-cli is
    // fail-closed only when the model has no cost-rate entry — and the policy
    // summary names that precise reason rather than the generic default phrase.
    expect(readiness.summary).toContain('Claude CLI binary "claude" not found');
    expect(readiness.summary).toContain('has no cost rate entry');
    expect(readiness.setupCommand).toBe('claude');
  });

  test('missing cli summary includes stale override and explicit missing binary fact', async () => {
    const stale = join(fakeHome, '.local', 'bin', 'claude');
    process.env.PD_CLI_CLAUDE_CODE_BIN = stale;

    const readiness = await assessBackendReadiness('cli:claude-code');

    expect(readiness).toMatchObject({
      backend: 'cli:claude-code',
      status: 'needs_setup',
    });
    expect(readiness.summary).toContain(`Claude Code CLI binary "${stale}" not found`);
    expect(readiness.summary).toContain(`Configured PD_CLI_CLAUDE_CODE_BIN=${stale} is not executable`);
    expect(readiness.summary).toContain('no claude binary was found');
  });

  test('marks claude-cli launchableUnverified when the binary is found', async () => {
    const cli = installCli('claude', join(fakeHome, '.nvm', 'versions', 'node', 'v22.17.1', 'bin'));

    const readiness = await assessBackendReadiness('claude-cli');

    expect(readiness).toMatchObject({
      backend: 'claude-cli',
      status: 'manual_check',
      launchableUnverified: true,
    });
    expect(readiness.summary).toContain(`Claude CLI binary found at ${cli}`);
    expect(readiness.setupCommand).toBe('claude');
  });

  test('keeps codex probe details and allows launch when exact telemetry is available', async () => {
    installCli('codex');

    const readiness = await assessBackendReadiness('codex');

    expect(readiness).toMatchObject({
      backend: 'codex',
      status: 'manual_check',
      // codex manages its own auth — a found binary must be launchable
      // (with a warning), like its cli:codex twin. Otherwise preflight refuses
      // every codex launch through the daemon ("no launchable backend").
      launchableUnverified: true,
    });
    expect(readiness.summary).toContain('Codex CLI binary found');
    expect(readiness.summary).not.toContain('blocked until exact token counts');
    expect(readiness.setupCommand).toBe('codex exec "print ok"');
  });

  test('blocks codex models without exact cost rates', async () => {
    installCli('codex');

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

  test.each([
    ['cli:agy', 'agy', 'PD_CLI_AGY_BIN'],
    ['cli:gemini', 'gemini', 'PD_CLI_GEMINI_BIN'],
    ['cli:groq', 'groq', 'PD_CLI_GROQ_BIN'],
    ['cli:grok', 'grok', 'PD_CLI_GROK_BIN'],
  ])('%s reports manual_check when the resolver finds its executable', async (backend, bin, envKey) => {
    delete process.env[envKey];

    installCli(bin);
    const found = await assessBackendReadiness(backend);
    expect(found).toMatchObject({ backend, status: 'manual_check' });
    expect(found.nextStep).toContain(`PD_USE_CLI_BACKEND=${bin}`);
    // Installed cli:* tube backend with unverifiable auth must be launchable.
    expect(found.launchableUnverified).toBe(true);
  });

  test.each([
    ['cli:claude-code', 'claude', 'PD_CLI_CLAUDE_CODE_BIN'],
    ['cli:codex', 'codex', 'PD_CLI_CODEX_BIN'],
  ])('%s is launchableUnverified when its binary is found, blocked when missing', async (backend, bin, envKey) => {
    delete process.env[envKey];

    const missing = await assessBackendReadiness(backend);
    expect(missing).toMatchObject({ backend, status: 'needs_setup' });
    expect(missing.launchableUnverified).not.toBe(true);

    installCli(bin);
    const found = await assessBackendReadiness(backend);
    expect(found).toMatchObject({ backend, status: 'manual_check', launchableUnverified: true });
  });

  test.each([
    ['cli:agy', 'agy-beta', 'PD_CLI_AGY_BIN'],
    ['cli:gemini', 'gemini-beta', 'PD_CLI_GEMINI_BIN'],
  ])('%s honors its binary override env var', async (backend, overrideName, envKey) => {
    const cli = installCli(overrideName);
    process.env[envKey] = cli;
    try {
      const readiness = await assessBackendReadiness(backend);
      expect(readiness.status).toBe('manual_check');
      expect(readiness.summary).toContain(cli);
    } finally {
      delete process.env[envKey];
    }
  });

  test('cli:claude-code falls back from a stale explicit path to a discovered user-dir claude', async () => {
    const stale = join(fakeHome, '.local', 'bin', 'claude');
    const discovered = installCli('claude', join(fakeHome, '.nvm', 'versions', 'node', 'v22.17.1', 'bin'));
    process.env.PD_CLI_CLAUDE_CODE_BIN = stale;

    const readiness = await assessBackendReadiness('cli:claude-code');

    expect(readiness).toMatchObject({
      backend: 'cli:claude-code',
      status: 'manual_check',
      launchableUnverified: true,
    });
    expect(readiness.summary).toContain(`Claude Code CLI binary found at ${discovered}`);
    expect(readiness.summary).toContain(`Configured PD_CLI_CLAUDE_CODE_BIN=${stale} is not executable`);
  });

  test('cli:codex falls back from a stale explicit path instead of copy-paste blocking early', async () => {
    const stale = join(fakeHome, '.missing', 'codex');
    const discovered = installCli('codex');
    process.env.PD_CLI_CODEX_BIN = stale;

    const readiness = await assessBackendReadiness('cli:codex');

    expect(readiness).toMatchObject({
      backend: 'cli:codex',
      status: 'manual_check',
      launchableUnverified: true,
    });
    expect(readiness.summary).toContain(`Codex CLI binary found at ${discovered}`);
    expect(readiness.summary).toContain(`Configured PD_CLI_CODEX_BIN=${stale} is not executable`);
  });

  test('keeps ollama probe details while still blocking launch under telemetry policy', async () => {
    installCli('ollama');

    const readiness = await assessBackendReadiness('ollama');

    expect(readiness).toMatchObject({
      backend: 'ollama',
      status: 'needs_setup',
    });
    expect(readiness.summary).toContain('Ollama CLI found, but local API is not reachable');
    // Policy now needs a --model to anchor an exact rate (since the
    // ollama-only family table is backend-scoped). Without a model, the
    // policy returns "Ollama model is required" rather than the old
    // hardcoded-blocked text.
    expect(readiness.summary).toContain('Ollama model is required');
    expect(readiness.setupCommand).toBe('ollama serve');
    expect(global.fetch).toHaveBeenCalled();
  });
});
