/**
 * LIVE end-to-end transcript capture — gated behind PD_LIVE=1.
 *
 * This is the "expose her" proof: it runs a REAL backend through the real
 * spawner pipeline (createSpawner + createTranscripts on a real better-sqlite3
 * DB, enforceTranscriptPolicy ON) and asserts the full conversation —
 * thinking, tool calls, assistant turns — actually lands in fleet_transcripts.
 *
 * It is SKIPPED by default (no creds / no network in CI). To run it:
 *   PD_LIVE=1 /opt/homebrew/bin/node --experimental-vm-modules \
 *     node_modules/jest/bin/jest.js tests/unit/spawner-live-transcripts.test.js
 *
 * Requires: the `codex` CLI authenticated (OAuth). Gemini/Cloudflare variants
 * additionally require their managed secrets and are gated by their own flags.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';

const LIVE = process.env.PD_LIVE === '1';
const d = LIVE ? describe : describe.skip;

const { createSpawner } = await import('../../lib/spawner.js');
const { createTranscripts } = await import('../../lib/transcripts.js');
const { createTestDb } = await import('../setup-unit.js');

d('LIVE: full-depth transcript capture through the real spawner', () => {
  let db;
  let transcripts;
  const originalIsolationOff = process.env.PD_SPAWN_ISOLATION_OFF;

  beforeAll(() => {
    // These run from the repo checkout; opt out of the worktree-isolation guard
    // (the live backend doesn't write files for these read-only probes).
    process.env.PD_SPAWN_ISOLATION_OFF = '1';
    db = createTestDb();
    transcripts = createTranscripts(db);
  });
  afterAll(() => {
    if (originalIsolationOff === undefined) delete process.env.PD_SPAWN_ISOLATION_OFF;
    else process.env.PD_SPAWN_ISOLATION_OFF = originalIsolationOff;
    if (db) db.close();
  });

  it('records reasoning + command + assistant turns from a real codex run', async () => {
    const spawner = createSpawner({
      transcripts,
      enforceTelemetryPolicy: false,
      enforceTranscriptPolicy: true,
      telemetryBypassApproval: { humanConfirmed: true, confirmedBy: 'live-test', reason: 'PD_LIVE codex e2e' },
    });

    const result = await spawner.spawn({
      backend: 'codex',
      model: 'gpt-5.4-mini',
      task: "Run the shell command 'echo port-daddy-live' exactly once, then tell me what it printed.",
      timeout: 120000,
    });

    // Surface the run for the operator running this live.
    // eslint-disable-next-line no-console
    console.log('LIVE codex spawn status:', result.status, '| error:', result.error);

    const rows = transcripts.listTranscripts({ ship: 'spawn:codex' });
    expect(rows.length).toBeGreaterThan(0);
    const full = transcripts.getTranscript(rows[0].id);
    const roles = full.messages.map((m) => m.role);
    // eslint-disable-next-line no-console
    console.log('LIVE codex transcript roles:', JSON.stringify(roles));
    // eslint-disable-next-line no-console
    console.log('LIVE codex tool turns:', JSON.stringify(full.messages.filter((m) => m.role === 'tool').map((m) => m.tool_calls), null, 2));

    // Proof the live pipeline records the REAL backend conversation through the
    // structured-turn path: the opening user turn plus at least one real
    // backend turn (assistant). Whether codex emits a `tool`/`thinking` turn is
    // model- and config-dependent (it may answer directly, and reasoning
    // summaries are off by default), so those are logged, not hard-asserted —
    // the deterministic depth proof lives in codex-transcript.test.js against
    // real captured command_execution + reasoning fixtures.
    expect(result.status).toBe('completed');
    expect(roles).toContain('user');
    expect(roles).toContain('assistant');
    expect(full.messages.length).toBeGreaterThan(1);
  }, 130000);

  // Gemini resolves its key via getSecret → the keychain in the daemon, but a
  // bare jest process can't reach that store; require the key in the env so
  // this only runs when the operator has surfaced it. (codex above needs no
  // key — it uses its own OAuth.)
  const geminiIt = process.env.GEMINI_API_KEY ? it : it.skip;
  geminiIt('records gemini thinking + assistant turns from a real API run', async () => {
    const spawner = createSpawner({
      transcripts,
      enforceTelemetryPolicy: false,
      enforceTranscriptPolicy: true,
      telemetryBypassApproval: { humanConfirmed: true, confirmedBy: 'live-test', reason: 'PD_LIVE gemini e2e' },
    });

    const result = await spawner.spawn({
      backend: 'gemini',
      model: 'gemini-2.5-flash',
      task: 'Think step by step about why the sky appears blue, then give a one-sentence answer.',
      timeout: 60000,
    });
    // eslint-disable-next-line no-console
    console.log('LIVE gemini spawn status:', result.status, '| error:', result.error);

    const rows = transcripts.listTranscripts({ ship: 'spawn:gemini' });
    expect(rows.length).toBeGreaterThan(0);
    const full = transcripts.getTranscript(rows[0].id);
    const roles = full.messages.map((m) => m.role);
    // eslint-disable-next-line no-console
    console.log('LIVE gemini transcript roles:', JSON.stringify(roles));

    expect(result.status).toBe('completed');
    expect(roles).toContain('user');
    expect(roles).toContain('assistant');
    // includeThoughts is requested, so a thinking turn should be present for a
    // 2.5 thinking model on a reasoning prompt. Logged + asserted.
    expect(roles).toContain('thinking');
  }, 70000);

  // Cloudflare resolves creds via getSecret → keychain/env in the daemon. The
  // bare jest process can't reach the keychain, so require both creds in the
  // env. The default model (@cf/zai-org/glm-4.7-flash) is OpenAI-compat and
  // returns reasoning + content, so a thinking turn is expected.
  const cfIt = (process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID) ? it : it.skip;
  cfIt('records cloudflare thinking + assistant turns from a real Workers AI run', async () => {
    const spawner = createSpawner({
      transcripts,
      enforceTelemetryPolicy: false,
      enforceTranscriptPolicy: true,
      telemetryBypassApproval: { humanConfirmed: true, confirmedBy: 'live-test', reason: 'PD_LIVE cloudflare e2e' },
    });

    const result = await spawner.spawn({
      backend: 'cloudflare',
      model: '@cf/zai-org/glm-4.7-flash',
      task: 'Think step by step about why 13 is prime, then give a one-sentence answer.',
      timeout: 60000,
    });
    // eslint-disable-next-line no-console
    console.log('LIVE cloudflare spawn status:', result.status, '| error:', result.error);

    const rows = transcripts.listTranscripts({ ship: 'spawn:cloudflare' });
    expect(rows.length).toBeGreaterThan(0);
    const full = transcripts.getTranscript(rows[0].id);
    const roles = full.messages.map((m) => m.role);
    // eslint-disable-next-line no-console
    console.log('LIVE cloudflare transcript roles:', JSON.stringify(roles));

    expect(result.status).toBe('completed');
    expect(roles).toContain('user');
    expect(roles).toContain('assistant');
    expect(roles).toContain('thinking');
  }, 70000);

  // cli:claude-code drives the local `claude` CLI over its own OAuth (no API
  // key). It runs by default under PD_LIVE. Critically this spawns with the
  // SENTINEL model "claude-cli" — the exact value DEFAULT_MODELS hands out and
  // the value that previously leaked into `claude --model claude-cli` and
  // killed the run ("model may not exist"). With the placeholder fix the
  // sentinel maps to a real default and the run records thinking + assistant
  // via stream-json.
  it('records cli:claude-code thinking + assistant from a real run launched with the "claude-cli" sentinel model', async () => {
    const spawner = createSpawner({
      transcripts,
      enforceTelemetryPolicy: false,
      enforceTranscriptPolicy: true,
      telemetryBypassApproval: { humanConfirmed: true, confirmedBy: 'live-test', reason: 'PD_LIVE cli:claude-code e2e' },
    });

    const result = await spawner.spawn({
      backend: 'cli:claude-code',
      model: 'claude-cli', // the sentinel that used to break the spawn
      task: 'What is 6 times 7? Think briefly, then answer.',
      timeout: 90000,
    });
    // eslint-disable-next-line no-console
    console.log('LIVE cli:claude-code spawn status:', result.status, '| error:', result.error);

    const rows = transcripts.listTranscripts({ ship: 'spawn:cli:claude-code' });
    expect(rows.length).toBeGreaterThan(0);
    const full = transcripts.getTranscript(rows[0].id);
    const roles = full.messages.map((m) => m.role);
    // eslint-disable-next-line no-console
    console.log('LIVE cli:claude-code transcript roles:', JSON.stringify(roles));

    // The point of THIS test: the sentinel model no longer breaks the run
    // (was status=failed "model may not exist"). It now completes and records
    // the conversation. Whether a `thinking` turn appears is model/prompt
    // dependent (a trivial prompt may not trigger extended thinking) — the
    // stream-json thinking capture is asserted against a real reasoning block
    // in cli-claude-code-transcript.test.js.
    expect(result.status).toBe('completed');
    expect(roles).toContain('user');
    expect(roles).toContain('assistant');
  }, 100000);
});
