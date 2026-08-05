/**
 * POST /spawn `Prefer: respond-async` durable admission + GET /spawn/:id collection.
 *
 * These cover the integration between routes/spawn.ts and the durable
 * agent-run-receipt core (lib/agent-run-receipts.ts):
 *   1. asynchronous admission runs the ACTUAL backend and reaches a terminal receipt
 *   2. idempotent replay returns the same receipt with exactly ONE backend launch
 *   3. GET /spawn/:id collects the durable projection after completion
 *   4. a receipt whose per-run PID is stale after a restart reconciles to `unknown`
 *      (never `live`, never a 500), and `unknown` cannot flip to `live` without evidence
 *   5. the synchronous POST path is unchanged when `Prefer: respond-async` is absent
 */
import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import Fastify from 'fastify';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mockSpawnViaCliTube = jest.fn();

await jest.unstable_mockModule('../../lib/spawner/backends/cli-tube.js', () => ({
  spawnViaCliTube: mockSpawnViaCliTube,
}));

const { createSpawner } = await import('../../lib/spawner.js');
const { createTranscripts } = await import('../../lib/transcripts.js');
const { spawnPlugin } = await import('../../routes/spawn.js');
const { createAgentRunReceiptStore } = await import('../../lib/agent-run-receipts.js');
const { createTestDb } = await import('../setup-unit.js');

function makeCostTracker() {
  return {
    computeCost: jest.fn(() => ({ costUsd: 0.001, isEstimate: false })),
    record: jest.fn((opts) => ({
      id: 'cost-test',
      ts: Date.now(),
      backend: opts.backend,
      model: opts.model,
      projectName: opts.projectName ?? null,
      projectDir: opts.projectDir ?? null,
      identity: opts.identity ?? null,
      spawnId: opts.spawnId ?? null,
      inputTokens: opts.inputTokens ?? null,
      cachedInputTokens: opts.cachedInputTokens ?? null,
      outputTokens: opts.outputTokens ?? null,
      costUsd: 0.001,
      isEstimate: false,
    })),
    budgetStatus: jest.fn(() => ({
      project: 'port-daddy',
      budgetUsdPerDay: 1,
      spentUsd: 0,
      remainingUsd: 1,
      percentUsed: 0,
      overBudget: false,
    })),
  };
}

function mockCoordinationFetch() {
  return jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ success: true }),
    text: async () => 'OK',
  });
}

function installFakeCli(dir, name) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, '#!/usr/bin/env sh\necho fake\n', 'utf8');
  chmodSync(path, 0o755);
  return path;
}

const ASYNC_PAYLOAD = {
  backend: 'claude',
  modelTier: 'high',
  task: 'route says hello async',
  identity: 'port-daddy:test:route-async',
  budgetUsd: 0.75,
};

async function pollReceipt(app, receiptId, predicate, tries = 50) {
  for (let i = 0; i < tries; i++) {
    const res = await app.inject({ method: 'GET', url: `/spawn/${receiptId}` });
    if (res.statusCode === 200 && predicate(res.json())) return res.json();
    await new Promise((r) => setTimeout(r, 10));
  }
  const final = await app.inject({ method: 'GET', url: `/spawn/${receiptId}` });
  throw new Error(`receipt ${receiptId} never satisfied predicate; last=${final.body}`);
}

describe('spawn route Prefer: respond-async durable admission', () => {
  let db;
  let transcripts;
  let spawner;
  let costTracker;
  let app;
  let tmp;
  let originalFetch;
  let originalUseCliBackend;
  let originalCliBinDirs;
  let originalIsolationOff;

  beforeEach(async () => {
    db = createTestDb();
    transcripts = createTranscripts(db);
    costTracker = makeCostTracker();
    spawner = createSpawner({
      transcripts,
      costTracker,
      enforceTelemetryPolicy: true,
      enforceTranscriptPolicy: true,
    });
    tmp = mkdtempSync(join(tmpdir(), 'pd-route-async-'));
    originalFetch = global.fetch;
    originalUseCliBackend = process.env.PD_USE_CLI_BACKEND;
    originalCliBinDirs = process.env.PD_CLI_BIN_DIRS;
    originalIsolationOff = process.env.PD_SPAWN_ISOLATION_OFF;
    global.fetch = mockCoordinationFetch();
    process.env.PD_USE_CLI_BACKEND = 'codex';
    process.env.PD_CLI_BIN_DIRS = tmp;
    process.env.PD_SPAWN_ISOLATION_OFF = '1';
    installFakeCli(tmp, 'codex');
    mockSpawnViaCliTube.mockReset();
    mockSpawnViaCliTube.mockResolvedValue({
      output: 'codex actually ran',
      error: null,
      rawStdout: '',
    });

    app = Fastify();
    await app.register(spawnPlugin, {
      deps: {
        spawner,
        costTracker,
        metrics: { errors: 0 },
        logger: { info: jest.fn(), error: jest.fn() },
        db,
        transcripts,
      },
    });
    await app.ready();
  });

  afterEach(async () => {
    if (app) await app.close();
    global.fetch = originalFetch;
    if (originalUseCliBackend === undefined) delete process.env.PD_USE_CLI_BACKEND;
    else process.env.PD_USE_CLI_BACKEND = originalUseCliBackend;
    if (originalCliBinDirs === undefined) delete process.env.PD_CLI_BIN_DIRS;
    else process.env.PD_CLI_BIN_DIRS = originalCliBinDirs;
    if (originalIsolationOff === undefined) delete process.env.PD_SPAWN_ISOLATION_OFF;
    else process.env.PD_SPAWN_ISOLATION_OFF = originalIsolationOff;
    if (db) db.close();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  test('async admission runs the real backend and records a terminal receipt', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/spawn',
      headers: { prefer: 'respond-async', 'idempotency-key': 'async-key-1' },
      payload: ASYNC_PAYLOAD,
    });

    expect(res.statusCode).toBe(202);
    expect(res.headers['retry-after']).toBe('1');
    const body = res.json();
    expect(body).toEqual(expect.objectContaining({
      success: true,
      accepted: true,
      replayed: false,
      status: 'accepted',
    }));
    expect(body.receiptId).toMatch(/^run-/);
    expect(body.monitorUrl).toBe(`/spawn/${body.receiptId}`);
    expect(res.headers.location).toBe(body.monitorUrl);

    const done = await pollReceipt(app, body.receiptId, (p) => p.terminal === true);
    expect(done.status).toBe('completed');
    expect(done.success).toBe(true);
    expect(done.live).toBe(false);
    // Real backend evidence was attached, not fabricated.
    expect(done.agentId).toBeTruthy();
    expect(done.transcriptId).toBeTruthy();
    expect(done.telemetry).toEqual(expect.objectContaining({ rateMode: expect.any(String) }));
    // The transcript id points at a real recorded transcript.
    expect(transcripts.getTranscript(done.transcriptId)).toBeTruthy();
  });

  test('idempotent replay returns the same receipt with exactly one backend launch', async () => {
    const spawnSpy = jest.spyOn(spawner, 'spawn');

    const first = await app.inject({
      method: 'POST',
      url: '/spawn',
      headers: { prefer: 'respond-async', 'idempotency-key': 'async-key-replay' },
      payload: ASYNC_PAYLOAD,
    });
    expect(first.statusCode).toBe(202);
    const receiptId = first.json().receiptId;

    await pollReceipt(app, receiptId, (p) => p.terminal === true);

    const replay = await app.inject({
      method: 'POST',
      url: '/spawn',
      headers: { prefer: 'respond-async', 'idempotency-key': 'async-key-replay' },
      payload: ASYNC_PAYLOAD,
    });

    expect(replay.statusCode).toBe(200);
    const replayBody = replay.json();
    expect(replayBody.replayed).toBe(true);
    expect(replayBody.receiptId).toBe(receiptId);
    expect(replayBody.status).toBe('completed');
    // The whole point: the backend launched once, not twice.
    expect(spawnSpy).toHaveBeenCalledTimes(1);
  });

  test('idempotent replay remains accepted before runtime evidence exists', async () => {
    let finishBackend;
    mockSpawnViaCliTube.mockImplementation(() => new Promise((resolve) => {
      finishBackend = resolve;
    }));
    const spawnSpy = jest.spyOn(spawner, 'spawn');

    const first = await app.inject({
      method: 'POST',
      url: '/spawn',
      headers: { prefer: 'respond-async', 'idempotency-key': 'async-key-pending-replay' },
      payload: ASYNC_PAYLOAD,
    });
    expect(first.statusCode).toBe(202);
    const receiptId = first.json().receiptId;

    const replay = await app.inject({
      method: 'POST',
      url: '/spawn',
      headers: { prefer: 'respond-async', 'idempotency-key': 'async-key-pending-replay' },
      payload: ASYNC_PAYLOAD,
    });

    expect(replay.statusCode).toBe(202);
    expect(replay.json()).toEqual(expect.objectContaining({
      accepted: true,
      replayed: true,
      receiptId,
      status: 'accepted',
    }));
    expect(spawnSpy).toHaveBeenCalledTimes(1);

    finishBackend({ output: 'codex actually ran', error: null, rawStdout: '' });
    await pollReceipt(app, receiptId, (projection) => projection.terminal === true);
  });

  test('conflicting request under the same idempotency key is rejected 409', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/spawn',
      headers: { prefer: 'respond-async', 'idempotency-key': 'async-key-conflict' },
      payload: ASYNC_PAYLOAD,
    });
    expect(first.statusCode).toBe(202);

    const conflict = await app.inject({
      method: 'POST',
      url: '/spawn',
      headers: { prefer: 'respond-async', 'idempotency-key': 'async-key-conflict' },
      payload: { ...ASYNC_PAYLOAD, task: 'a different task under the same key' },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().code).toBe('IDEMPOTENCY_CONFLICT');
  });

  test('async admission without an Idempotency-Key is rejected 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/spawn',
      headers: { prefer: 'respond-async' },
      payload: ASYNC_PAYLOAD,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  test('a stale per-run PID after restart collects as unknown, never live, never 500', async () => {
    // Directly admit + advance a receipt on the SAME db the route reads, then
    // prove it live with a genuinely-alive PID (this process) — the receipt
    // core corroborates the PID with defaultVerifyProcessAlive, so this is real
    // liveness, not a fabricated heartbeat.
    const side = createAgentRunReceiptStore(db, { recoverNonTerminal: false });
    const { receipt } = side.accept({
      idempotencyKey: 'stale-pid-key',
      kind: 'spawn',
      request: { backend: 'claude', task: 'long runner' },
    });
    side.markStarting(receipt.id, {
      successorAgentId: 'agent-live-1',
      successorSessionId: 'sess-live-1',
      transcriptId: 'tx-live-1',
    });
    const liveReceipt = side.markStatus(receipt.id, 'live', {
      liveEvidence: { pid: process.pid, supervisorHeartbeatAt: Date.now() },
    });
    expect(liveReceipt.status).toBe('live');

    // The route reads current db state: while genuinely live, it reports live.
    const whileLive = await app.inject({ method: 'GET', url: `/spawn/${receipt.id}` });
    expect(whileLive.statusCode).toBe(200);
    expect(whileLive.json().live).toBe(true);

    // Simulate a daemon restart: a fresh store over the same db reconciles any
    // non-terminal receipt (its per-run PID is no longer observable) to unknown.
    createAgentRunReceiptStore(db);

    const afterRestart = await app.inject({ method: 'GET', url: `/spawn/${receipt.id}` });
    expect(afterRestart.statusCode).toBe(200); // never a 500
    const projection = afterRestart.json();
    expect(projection.status).toBe('unknown');
    expect(projection.live).toBe(false); // never live off a stale PID
    expect(projection.outcomeUnknown).toBe(true);
    expect(projection.success).toBe(false);

    // Unknown must not be promotable to live without fresh, corroborated evidence.
    expect(() => side.markStatus(receipt.id, 'live', {})).toThrow();
    const stillUnknown = await app.inject({ method: 'GET', url: `/spawn/${receipt.id}` });
    expect(stillUnknown.json().status).toBe('unknown');
  });

  test('GET /spawn/:id 404s for an unknown receipt id', async () => {
    const res = await app.inject({ method: 'GET', url: '/spawn/run-does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(res.json().success).toBe(false);
  });

  test('synchronous POST is unchanged when Prefer: respond-async is absent', async () => {
    const spawnSpy = jest.spyOn(spawner, 'spawn');
    const res = await app.inject({
      method: 'POST',
      url: '/spawn',
      payload: ASYNC_PAYLOAD,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Existing synchronous contract: the spawn result is returned inline.
    expect(body).toEqual(expect.objectContaining({
      success: true,
      backend: 'cli:codex',
      model: 'codex-cli',
      requestedBackend: 'claude',
      effectiveBackend: 'cli:codex',
    }));
    // No durable admission fields leak into the synchronous response.
    expect(body.receiptId).toBeUndefined();
    expect(body.accepted).toBeUndefined();
    expect(body.monitorUrl).toBeUndefined();
    expect(spawnSpy).toHaveBeenCalledTimes(1);
  });
});
