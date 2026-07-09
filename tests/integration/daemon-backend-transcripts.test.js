import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startEphemeralDaemon } from '../helpers/ephemeral-daemon.js';
import {
  LAUNCHD_RESTRICTED_PATH,
  actualExecutionBackend,
  assertNoSilentBackendOverride,
  assertTranscriptReadback,
  createScratchSpawnWorktree,
  fetchTranscriptForSpawn,
  seedProjectBudget,
  withFakeOpenAICompatibleServer,
  writeFakeAgyBinary,
  writeFakeClaudeBinary,
} from '../../scripts/smoke-daemon-backend-transcripts.mjs';

async function getTranscriptForSpawn(daemon, backend, agentId) {
  const list = await daemon.request(`/transcripts?limit=50&ship=${encodeURIComponent(`spawn:${backend}`)}`);
  expect(list.ok).toBe(true);
  const row = list.data.transcripts.find((candidate) => candidate.spawned_agent_id === agentId);
  expect(row).toBeTruthy();

  const full = await daemon.request(`/transcripts/${encodeURIComponent(row.id)}`);
  expect(full.ok).toBe(true);
  return full.data.transcript;
}

function spawnBody(backend, overrides = {}) {
  return {
    backend,
    identity: `port-daddy:e2e:${backend.replace(/[^a-z0-9]+/gi, '-')}`,
    task: `Reply with exactly: ${backend}-daemon-e2e`,
    budgetUsd: 0.01,
    timeout: 60000,
    ...overrides,
  };
}

describe('daemon backend transcript E2E smoke', () => {
  test('fails before launch when stale PD_CLI_CLAUDE_CODE_BIN has no discoverable claude fallback', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'pd-stale-claude-'));
    const spawnWorktree = createScratchSpawnWorktree(tmp);
    const staleClaude = join(tmp, 'missing', 'claude');
    const daemon = await startEphemeralDaemon({
      startupTimeout: 45000,
      env: {
        PATH: LAUNCHD_RESTRICTED_PATH,
        PD_USE_CLI_BACKEND: 'none',
        PD_CLI_CLAUDE_CODE_BIN: staleClaude,
      },
    });

    try {
      const res = await daemon.request('/spawn', {
        method: 'POST',
        body: spawnBody('cli:claude-code', { model: 'sonnet', workdir: spawnWorktree.workdir }),
        timeout: 70000,
      });

      expect(res.ok).toBe(false);
      expect(res.status).toBe(400);
      const error = res.data.error || '';
      expect(error).toMatch(/No launchable backend/);
      expect(error).toContain('PD_CLI_CLAUDE_CODE_BIN');
      expect(error).toContain(staleClaude);
      expect(error).toMatch(/claude/i);
      expect(error).toMatch(/not (found|executable)|no .*fallback/i);
      expect(existsSync(staleClaude)).toBe(false);
    } finally {
      await daemon.cleanup();
      spawnWorktree.cleanup();
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 60000);

  test('daemon /spawn launches cli:claude-code with stale PD_CLI_CLAUDE_CODE_BIN and PD_CLI_BIN_DIRS fallback', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'pd-fake-claude-'));
    const spawnWorktree = createScratchSpawnWorktree(tmp);
    const staleClaude = join(tmp, 'stale-home', '.local', 'bin', 'claude');
    const fakeBinDir = join(tmp, 'nvm', 'versions', 'node', 'v22.17.1', 'bin');
    const fakeClaude = join(fakeBinDir, 'claude');
    const fakeClaudeInvoked = join(tmp, 'fake-claude-invoked.txt');
    writeFakeClaudeBinary(fakeClaude, 'pd-claude-smoke');
    const daemonEnv = {
      PATH: LAUNCHD_RESTRICTED_PATH,
      PD_USE_CLI_BACKEND: 'none',
      PD_CLI_CLAUDE_CODE_BIN: staleClaude,
      PD_CLI_BIN_DIRS: fakeBinDir,
      PD_FAKE_CLAUDE_INVOKED_FILE: fakeClaudeInvoked,
    };
    const daemon = await startEphemeralDaemon({ startupTimeout: 45000, env: daemonEnv });

    try {
      await seedProjectBudget(daemon, 'port-daddy');
      const res = await daemon.request('/spawn', {
        method: 'POST',
        body: spawnBody('cli:claude-code', { model: 'sonnet', workdir: spawnWorktree.workdir }),
        timeout: 70000,
      });

      expect(res.ok).toBe(true);
      expect(res.data.backend).toBe('cli:claude-code');
      expect(res.data.agentId).toBeTruthy();
      expect(res.data.status).toBe('completed');
      const transcript = await getTranscriptForSpawn(daemon, 'cli:claude-code', res.data.agentId);
      assertTranscriptReadback({
        requestedBackend: 'cli:claude-code',
        actualExecutionBackend: actualExecutionBackend('cli:claude-code', daemonEnv),
        spawnResult: res.data,
        transcript,
        budgetUsd: 0.01,
      });
      expect(transcript.backend).toBe('cli:claude-code');
      expect(transcript.spawned_agent_id).toBe(res.data.agentId);
      expect(['completed', 'failed']).toContain(transcript.status);
      expect(transcript.status).toBe('completed');
      expect(transcript.messages.map((message) => message.role)).toEqual(
        expect.arrayContaining(['user', 'thinking', 'assistant']),
      );
      expect(JSON.stringify(transcript.messages)).toContain('pd-claude-smoke');
      expect(transcript.outputs.length).toBeGreaterThan(0);
      expect(JSON.stringify(transcript.outputs)).toContain('cli:claude-code');
      expect(existsSync(fakeClaudeInvoked)).toBe(true);
      expect(readFileSync(fakeClaudeInvoked, 'utf8')).toContain(fakeClaude);
      expect(existsSync(staleClaude)).toBe(false);
    } finally {
      await daemon.cleanup();
      spawnWorktree.cleanup();
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 60000);

  test('launches cli:agy through /spawn and records final stdout/stderr transcript only', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'pd-fake-agy-'));
    const spawnWorktree = createScratchSpawnWorktree(tmp);
    const fakeAgy = join(tmp, 'bin', 'agy');
    writeFakeAgyBinary(fakeAgy, 'pd-agy-smoke');
    const daemonEnv = {
      PATH: LAUNCHD_RESTRICTED_PATH,
      PD_USE_CLI_BACKEND: 'none',
      PD_CLI_AGY_BIN: fakeAgy,
    };
    const daemon = await startEphemeralDaemon({ startupTimeout: 45000, env: daemonEnv });

    try {
      await seedProjectBudget(daemon, 'port-daddy');
      const res = await daemon.request('/spawn', {
        method: 'POST',
        body: spawnBody('cli:agy', { workdir: spawnWorktree.workdir }),
        timeout: 70000,
      });

      expect(res.ok).toBe(true);
      const transcript = await getTranscriptForSpawn(daemon, 'cli:agy', res.data.agentId);
      assertTranscriptReadback({
        requestedBackend: 'cli:agy',
        actualExecutionBackend: actualExecutionBackend('cli:agy', daemonEnv),
        spawnResult: res.data,
        transcript,
        budgetUsd: 0.01,
      });
      const roles = transcript.messages.map((message) => message.role);
      expect(roles).toEqual(expect.arrayContaining(['user', 'assistant']));
      expect(roles).not.toContain('thinking');
      expect(roles).not.toContain('tool');
      expect(JSON.stringify(transcript.messages)).toContain('pd-agy-smoke');
      expect(JSON.stringify(transcript.messages)).not.toContain('checking smoke request');
    } finally {
      await daemon.cleanup();
      spawnWorktree.cleanup();
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 60000);

  test('launches an OpenAI-compatible fake service through /spawn and reads back transcript plus budget compliance', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'pd-openai-workdir-'));
    const spawnWorktree = createScratchSpawnWorktree(tmp);
    const openai = await withFakeOpenAICompatibleServer('pd-openai-smoke');
    const daemonEnv = {
      PATH: LAUNCHD_RESTRICTED_PATH,
      PD_USE_CLI_BACKEND: 'none',
      PD_CLI_CLAUDE_CODE_BIN: '',
      OPENAI_API_KEY: 'sk-fake-e2e',
      OPENAI_BASE_URL: openai.baseUrl,
    };
    const daemon = await startEphemeralDaemon({ startupTimeout: 45000, env: daemonEnv });

    try {
      await seedProjectBudget(daemon, 'port-daddy');
      const res = await daemon.request('/spawn', {
        method: 'POST',
        body: spawnBody('openai', { model: 'gpt-5-nano', maxTokens: 20, workdir: spawnWorktree.workdir }),
        timeout: 70000,
      });

      expect(res.ok).toBe(true);
      expect(openai.requests).toHaveLength(1);
      const transcript = await getTranscriptForSpawn(daemon, 'openai', res.data.agentId);
      assertTranscriptReadback({
        requestedBackend: 'openai',
        actualExecutionBackend: actualExecutionBackend('openai', daemonEnv),
        spawnResult: res.data,
        transcript,
        budgetUsd: 0.01,
      });
      expect(transcript.messages.map((message) => message.role)).toEqual(expect.arrayContaining(['user', 'assistant']));
      expect(JSON.stringify(transcript.messages)).toContain('pd-openai-smoke');
    } finally {
      await daemon.cleanup();
      await openai.close();
      spawnWorktree.cleanup();
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 90000);

  test('smoke matrix refuses a silent requested-vs-actual backend mismatch from PD_USE_CLI_BACKEND', () => {
    const env = { PD_USE_CLI_BACKEND: 'codex' };

    expect(actualExecutionBackend('gemini', env)).toBe('cli:codex');
    expect(actualExecutionBackend('openai', { PD_USE_CLI_BACKEND: 'agy' })).toBe('cli:agy');
    expect(() => assertNoSilentBackendOverride({ requestedBackend: 'gemini' }, env))
      .toThrow(/backend mismatch: requested gemini, actual cli:codex/);
    expect(() => assertNoSilentBackendOverride({ requestedBackend: 'cloudflare' }, env))
      .toThrow(/backend mismatch: requested cloudflare, actual cli:codex/);

    const visible = assertNoSilentBackendOverride(
      { requestedBackend: 'gemini' },
      { ...env, PD_BACKEND_TRANSCRIPT_ALLOW_FORCED_OVERRIDE: '1' },
    );
    expect(visible).toMatchObject({
      requestedBackend: 'gemini',
      actualExecutionBackend: 'cli:codex',
      backendMismatch: true,
      overrideLabel: 'PD_USE_CLI_BACKEND=codex (shell or ~/.port-daddy-env)',
    });
  });

  test('smoke matrix refuses persisted backend override unless env disables it', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'pd-persisted-backend-'));
    const persistedPath = join(tmp, '.port-daddy-cli-backend');
    writeFileSync(persistedPath, 'codex\n');

    try {
      expect(actualExecutionBackend('openai', {}, { persistedPath })).toBe('cli:codex');
      expect(() => assertNoSilentBackendOverride(
        { requestedBackend: 'openai' },
        {},
        { persistedPath },
      )).toThrow(/backend mismatch: requested openai, actual cli:codex via .*\.port-daddy-cli-backend=codex/);

      expect(actualExecutionBackend('openai', { PD_USE_CLI_BACKEND: 'agy' }, { persistedPath })).toBe('cli:agy');
      expect(() => assertNoSilentBackendOverride(
        { requestedBackend: 'openai' },
        { PD_USE_CLI_BACKEND: 'agy' },
        { persistedPath },
      )).toThrow(/backend mismatch: requested openai, actual cli:agy via PD_USE_CLI_BACKEND=agy/);
      expect(actualExecutionBackend('openai', { PD_USE_CLI_BACKEND: 'none' }, { persistedPath })).toBe('openai');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('transcript lookup uses real daemon transcript fixture for actual backend fallback', async () => {
    const daemon = await startEphemeralDaemon({
      startupTimeout: 45000,
      env: {
        PATH: LAUNCHD_RESTRICTED_PATH,
        PD_USE_CLI_BACKEND: 'none',
      },
    });
    const transcript = {
      id: `tx-actual-${Date.now()}`,
      ship: 'spawn:cli:codex',
      trigger: 'spawn',
      backend: 'cli:codex',
      model: 'codex-cli',
      status: 'completed',
      spawned_agent_id: 'agent-actual',
      started_at: Date.now(),
      ended_at: Date.now() + 1000,
      messages: [
        { role: 'user', content: 'Reply with exactly: pd-codex-smoke' },
        { role: 'assistant', content: 'pd-codex-smoke' },
      ],
      outputs: [{ type: 'message', summary: 'cli:codex returned 14 chars' }],
      cost_usd: 0,
    };

    try {
      const seeded = await daemon.request('/transcripts', {
        method: 'POST',
        body: transcript,
      });
      expect(seeded.ok).toBe(true);

      await expect(fetchTranscriptForSpawn(
        daemon,
        { status: 'completed' },
        'openai',
        'cli:codex',
      )).resolves.toMatchObject({
        id: transcript.id,
        ship: 'spawn:cli:codex',
        backend: 'cli:codex',
        spawned_agent_id: 'agent-actual',
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'assistant', content: 'pd-codex-smoke' }),
        ]),
        outputs: expect.arrayContaining([
          expect.objectContaining({ summary: 'cli:codex returned 14 chars' }),
        ]),
      });
    } finally {
      await daemon.cleanup();
    }
  }, 60000);

  test('readback guard rejects completed-empty transcripts, missing durable outputs, and budget overruns', () => {
    expect(() => assertTranscriptReadback({
      requestedBackend: 'cli:codex',
      actualExecutionBackend: 'cli:codex',
      spawnResult: { status: 'completed' },
      transcript: { messages: [], outputs: [], cost_usd: 0 },
      budgetUsd: 0.01,
    })).toThrow(/lacks user\+assistant content/);

    expect(() => assertTranscriptReadback({
      requestedBackend: 'cli:codex',
      actualExecutionBackend: 'cli:codex',
      spawnResult: { status: 'completed' },
      transcript: {
        messages: [
          { role: 'user', content: 'Reply with exactly: pd-codex-smoke' },
          { role: 'assistant', content: 'pd-codex-smoke' },
        ],
        outputs: [{ type: 'message', summary: 'cli:codex returned 14 chars' }],
        cost_usd: 0.021275,
      },
      budgetUsd: 0.01,
    })).toThrow(/exceeded hard budget cap/);

    expect(() => assertTranscriptReadback({
      requestedBackend: 'cli:codex',
      actualExecutionBackend: 'cli:codex',
      spawnResult: { status: 'completed' },
      transcript: {
        messages: [
          { role: 'user', content: 'Reply with exactly: pd-codex-smoke' },
          { role: 'assistant', content: 'pd-codex-smoke' },
        ],
        outputs: [],
        cost_usd: 0,
      },
      budgetUsd: 0.01,
    })).toThrow(/transcript outputs are empty/);

    expect(() => assertTranscriptReadback({
      requestedBackend: 'cli:codex',
      actualExecutionBackend: 'cli:codex',
      spawnResult: { status: 'completed' },
      transcript: {
        messages: [
          { role: 'user', content: 'Reply with exactly: pd-codex-smoke' },
          { role: 'assistant', content: 'pd-codex-smoke' },
        ],
        outputs: [{ type: 'message', summary: 'cli:codex returned 14 chars' }],
      },
      budgetUsd: 0.01,
    })).toThrow(/missing numeric cost_usd/);
  });
});
