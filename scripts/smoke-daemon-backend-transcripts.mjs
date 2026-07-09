#!/usr/bin/env node
import { createServer } from 'node:http';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startEphemeralDaemon } from '../tests/helpers/ephemeral-daemon.js';

export const LAUNCHD_RESTRICTED_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

const FORCED_CLI_BACKENDS = new Map([
  ['claude', 'cli:claude-code'],
  ['claude-code', 'cli:claude-code'],
  ['codex', 'cli:codex'],
  ['gemini', 'cli:gemini'],
  ['groq', 'cli:groq'],
  ['grok', 'cli:grok'],
]);

export function actualExecutionBackend(requestedBackend, env = process.env) {
  const raw = String(env.PD_USE_CLI_BACKEND || '').trim().toLowerCase();
  if (!raw || ['none', 'off', 'disabled', '0', 'false'].includes(raw)) {
    return requestedBackend;
  }
  return FORCED_CLI_BACKENDS.get(raw) || requestedBackend;
}

export function assertNoSilentBackendOverride(row, env = process.env) {
  const actual = actualExecutionBackend(row.requestedBackend, env);
  const mismatch = actual !== row.requestedBackend;
  if (mismatch && env.PD_BACKEND_TRANSCRIPT_ALLOW_FORCED_OVERRIDE !== '1') {
    throw new Error(
      `backend mismatch: requested ${row.requestedBackend}, actual ${actual} via PD_USE_CLI_BACKEND=${env.PD_USE_CLI_BACKEND}. ` +
      'Set PD_BACKEND_TRANSCRIPT_ALLOW_FORCED_OVERRIDE=1 only when the smoke table should explicitly cover the forced CLI path.',
    );
  }
  return {
    ...row,
    actualExecutionBackend: actual,
    backendMismatch: mismatch,
    overrideLabel: mismatch ? `PD_USE_CLI_BACKEND=${env.PD_USE_CLI_BACKEND}` : '',
  };
}

export function assertTranscriptReadback({ requestedBackend, actualExecutionBackend: actual, spawnResult, transcript, budgetUsd }) {
  if (spawnResult.status !== 'completed') {
    throw new Error(`${requestedBackend} spawn did not complete: ${spawnResult.status} ${spawnResult.error || ''}`.trim());
  }
  if (!transcript) {
    throw new Error(`${requestedBackend} produced no readable transcript row`);
  }
  const messages = Array.isArray(transcript.messages) ? transcript.messages : [];
  const outputs = Array.isArray(transcript.outputs) ? transcript.outputs : [];
  const roles = new Set(messages.map((message) => message.role));
  if (!roles.has('user') || !roles.has('assistant')) {
    throw new Error(
      `${requestedBackend} completed through ${actual || requestedBackend} but transcript lacks user+assistant content ` +
      `(roles: ${[...roles].join(',') || 'none'})`,
    );
  }
  if (outputs.length === 0) {
    throw new Error(`${requestedBackend} completed but transcript outputs are empty`);
  }
  if (typeof transcript.cost_usd === 'number' && typeof budgetUsd === 'number' && transcript.cost_usd > budgetUsd) {
    throw new Error(
      `${requestedBackend} exceeded hard budget cap: recorded $${transcript.cost_usd} > requested $${budgetUsd}`,
    );
  }
}

export async function seedProjectBudget(daemon, project = 'port-daddy', { balanceUsd = 5, budgetUsdPerDay = 5 } = {}) {
  const topUp = await daemon.request(`/wallets/${encodeURIComponent(project)}/top-up`, {
    method: 'POST',
    body: { usd: balanceUsd },
  });
  if (!topUp.ok) throw new Error(`wallet top-up failed for ${project}: ${topUp.text}`);

  const budget = await daemon.request(`/wallets/${encodeURIComponent(project)}/budget`, {
    method: 'POST',
    body: { usdPerDay: budgetUsdPerDay },
  });
  if (!budget.ok) throw new Error(`wallet budget failed for ${project}: ${budget.text}`);
}

export function writeFakeClaudeBinary(binPath, finalText = 'pd-claude-smoke') {
  mkdirSync(join(binPath, '..'), { recursive: true });
  const lines = [
    { type: 'system', subtype: 'init' },
    { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'checking smoke request' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: finalText }] } },
    {
      type: 'result',
      subtype: 'success',
      result: finalText,
      usage: {
        input_tokens: 12,
        output_tokens: 4,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    },
  ].map((line) => JSON.stringify(line));
  writeFileSync(binPath, `#!/bin/sh\n${lines.map((line) => `printf '%s\\n' '${line}'`).join('\n')}\n`);
  chmodSync(binPath, 0o755);
}

export function writeFakeCodexBinary(binPath, finalText = 'pd-codex-smoke') {
  mkdirSync(join(binPath, '..'), { recursive: true });
  const lines = [
    { type: 'agent_reasoning', text: 'checking smoke request' },
    { type: 'agent_message', message: finalText },
    {
      type: 'turn.completed',
      usage: {
        input_tokens: 20,
        output_tokens: 5,
        cached_input_tokens: 0,
      },
    },
  ].map((line) => JSON.stringify(line));
  writeFileSync(binPath, `#!/bin/sh\n${lines.map((line) => `printf '%s\\n' '${line}'`).join('\n')}\n`);
  chmodSync(binPath, 0o755);
}

export async function withFakeOpenAICompatibleServer(text = 'pd-openai-smoke') {
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({ method: req.method, url: req.url, body: Buffer.concat(chunks).toString() });
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{ message: { content: text } }],
      usage: { prompt_tokens: 10, completion_tokens: 4 },
    }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function fetchTranscriptForSpawn(daemon, spawnResult, requestedBackend) {
  const list = await daemon.request(`/transcripts?limit=50&ship=${encodeURIComponent(`spawn:${requestedBackend}`)}`);
  if (!list.ok) throw new Error(`transcript list failed for ${requestedBackend}: ${list.text}`);
  const row = list.data.transcripts?.find((candidate) => candidate.spawned_agent_id === spawnResult.agentId)
    || list.data.transcripts?.find((candidate) => candidate.backend === requestedBackend);
  if (!row) return null;
  const full = await daemon.request(`/transcripts/${encodeURIComponent(row.id)}`);
  if (!full.ok) throw new Error(`transcript readback failed for ${requestedBackend}: ${full.text}`);
  return full.data.transcript;
}

async function pollLatestTranscript(daemon, requestedBackend, startedAt, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  let lastList = null;
  while (Date.now() < deadline) {
    lastList = await daemon.request(
      `/transcripts?limit=50&ship=${encodeURIComponent(`spawn:${requestedBackend}`)}&since=${startedAt - 1000}`,
      { timeout: 15000 },
    );
    if (lastList.ok) {
      const row = [...(lastList.data.transcripts || [])]
        .filter((candidate) => !candidate.started_at || candidate.started_at >= startedAt - 1000)
        .sort((a, b) => (b.started_at || 0) - (a.started_at || 0))[0];
      if (row) {
        const full = await daemon.request(`/transcripts/${encodeURIComponent(row.id)}`, { timeout: 15000 });
        if (full.ok && full.data.transcript?.status && full.data.transcript.status !== 'running') {
          return full.data.transcript;
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`timed out waiting for ${requestedBackend} transcript after spawn request timeout; last list=${lastList?.text || 'none'}`);
}

async function runSpawnRow({ daemon, requestedBackend, body, budgetUsd, env, requestTimeoutMs }) {
  const classified = assertNoSilentBackendOverride({ requestedBackend, budgetUsd }, env);
  await seedProjectBudget(daemon, 'port-daddy');
  const startedAt = Date.now();
  const spawnBody = {
    backend: requestedBackend,
    identity: `port-daddy:smoke:${requestedBackend.replace(/[^a-z0-9]+/gi, '-')}`,
    task: `Reply with exactly: ${requestedBackend}-daemon-transcript-smoke`,
    budgetUsd,
    timeout: 60000,
    ...body,
  };
  let res = null;
  let transcript = null;
  try {
    res = await daemon.request('/spawn', {
      method: 'POST',
      body: spawnBody,
      timeout: requestTimeoutMs ?? Math.max(10000, Number(spawnBody.timeout || 0) + 15000),
    });
  } catch (error) {
    if (!String(error?.message || error).includes('timed out')) throw error;
    transcript = await pollLatestTranscript(daemon, requestedBackend, startedAt);
  }
  if (res && !res.ok) {
    throw new Error(`${requestedBackend} spawn route failed (${res.status}): ${res.text}`);
  }
  if (!transcript) {
    transcript = await fetchTranscriptForSpawn(daemon, res.data, requestedBackend);
  }
  assertTranscriptReadback({
    requestedBackend,
    actualExecutionBackend: classified.actualExecutionBackend,
    spawnResult: res?.data ?? { status: transcript.status, error: transcript.error },
    transcript,
    budgetUsd,
  });
  return {
    ...classified,
    status: res?.data?.status ?? transcript.status,
    agentId: res?.data?.agentId ?? transcript.spawned_agent_id,
    transcriptId: transcript.id,
    messageCount: transcript.messages.length,
    outputCount: transcript.outputs.length,
    costUsd: transcript.cost_usd,
  };
}

async function runCiSafeSmoke() {
  const tmp = mkdtempSync(join(tmpdir(), 'pd-backend-transcript-smoke-'));
  const fakeClaude = join(tmp, 'bin', 'claude');
  writeFakeClaudeBinary(fakeClaude);
  const openai = await withFakeOpenAICompatibleServer();
  const env = {
    PATH: LAUNCHD_RESTRICTED_PATH,
    PD_USE_CLI_BACKEND: 'none',
    PD_CLI_BIN_DIRS: join(fakeClaude, '..'),
    OPENAI_API_KEY: 'sk-fake-smoke',
    OPENAI_BASE_URL: openai.baseUrl,
  };
  const daemon = await startEphemeralDaemon({ env, startupTimeout: 45000 });
  try {
    return [
      await runSpawnRow({
        daemon,
        requestedBackend: 'cli:claude-code',
        budgetUsd: 0.01,
        body: { model: 'sonnet' },
        env,
      }),
      await runSpawnRow({
        daemon,
        requestedBackend: 'openai',
        budgetUsd: 0.01,
        body: { model: 'gpt-5-nano', maxTokens: 20 },
        env,
      }),
    ];
  } finally {
    await daemon.cleanup();
    await openai.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

function liveRowsFromEnv() {
  const rows = [];
  if (process.env.PD_LIVE_CLI_CLAUDE_CODE === '1') rows.push({ requestedBackend: 'cli:claude-code', body: { model: process.env.PD_LIVE_CLAUDE_MODEL || 'sonnet' } });
  if (process.env.PD_LIVE_CLI_CODEX === '1') rows.push({ requestedBackend: 'cli:codex', body: { model: 'codex-cli' } });
  if (process.env.PD_LIVE_CLI_GEMINI === '1') rows.push({ requestedBackend: 'cli:gemini', body: {} });
  if (process.env.PD_LIVE_AGY === '1') rows.push({ requestedBackend: 'agy', body: {}, expected: 'unsupported-on-current-branch' });
  if (process.env.PD_LIVE_OLLAMA === '1') rows.push({ requestedBackend: 'ollama', body: { model: process.env.OLLAMA_MODEL || 'llama3.1:8b' } });
  if (process.env.PD_LIVE_OPENAI === '1') rows.push({ requestedBackend: 'openai', body: { model: process.env.OPENAI_MODEL || 'gpt-5-nano', maxTokens: 20 } });
  if (process.env.PD_LIVE_GROQ === '1') rows.push({ requestedBackend: 'groq', body: { model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile', maxTokens: 20 } });
  if (process.env.PD_LIVE_CLOUDFLARE === '1') rows.push({ requestedBackend: 'cloudflare', body: { model: process.env.CLOUDFLARE_MODEL || '@cf/zai-org/glm-4.7-flash', maxTokens: 20 } });
  if (process.env.PD_LIVE_GEMINI === '1') rows.push({ requestedBackend: 'gemini', body: { model: process.env.GEMINI_MODEL || 'gemini-2.5-flash', maxTokens: 20 } });
  return rows;
}

async function runLiveSmoke() {
  const env = { ...process.env };
  const daemon = await startEphemeralDaemon({ env, startupTimeout: 45000 });
  const rows = [];
  try {
    for (const row of liveRowsFromEnv()) {
      if (row.expected === 'unsupported-on-current-branch') {
        rows.push({ requestedBackend: row.requestedBackend, actualExecutionBackend: 'unsupported', status: 'skipped', note: 'agy backend is not accepted by /spawn on this branch' });
        continue;
      }
      rows.push(await runSpawnRow({
        daemon,
        requestedBackend: row.requestedBackend,
        budgetUsd: Number(process.env.PD_BACKEND_TRANSCRIPT_BUDGET_USD || '0.05'),
        body: row.body,
        env,
      }));
    }
    return rows;
  } finally {
    await daemon.cleanup();
  }
}

function printTable(rows) {
  console.table(rows.map((row) => ({
    requested: row.requestedBackend,
    actual: row.actualExecutionBackend,
    mismatch: row.backendMismatch ? row.overrideLabel : '',
    status: row.status,
    transcript: row.transcriptId || '',
    messages: row.messageCount ?? '',
    outputs: row.outputCount ?? '',
    costUsd: row.costUsd ?? '',
    note: row.note || '',
  })));
}

async function main() {
  const rows = process.env.PD_RUN_LIVE_BACKEND_TRANSCRIPT_SMOKE === '1'
    ? await runLiveSmoke()
    : await runCiSafeSmoke();
  printTable(rows);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}
