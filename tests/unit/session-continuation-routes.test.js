import Fastify from 'fastify';
import { jest } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';

const { sessionsPlugin } = await import('../../routes/sessions.js');

const predecessor = {
  id: 'session-predecessor',
  purpose: 'Original immutable work',
  status: 'completed',
  identityProject: 'test-project',
  durable: true,
};

function acceptedRun() {
  const now = Date.now();
  return {
    agentId: 'spawned-successor',
    name: 'Successor',
    backend: 'cli:codex',
    model: 'gpt-5.4-mini',
    status: 'accepted',
    identity: 'test-project:continuation',
    purpose: 'Continue the work',
    startedAt: now,
    heartbeatAt: now,
    lastActivityAt: now,
    pid: null,
    deadlineAt: null,
    transcriptId: 'transcript-successor',
    sessionId: 'session-successor',
  };
}

function terminalResult(overrides = {}) {
  return {
    agentId: 'spawned-successor',
    backend: 'cli:codex',
    model: 'gpt-5.4-mini',
    status: 'completed',
    output: 'done',
    error: null,
    telemetry: null,
    startedAt: Date.now(),
    completedAt: Date.now(),
    ...overrides,
  };
}

function continuationPayload(overrides = {}) {
  return {
    purpose: 'Continue the work',
    note: 'Finish the bounded successor task.',
    backend: 'cli:codex',
    workdir: process.cwd(),
    idempotencyKey: 'beacon-session-predecessor-1',
    metadata: { source: 'workflow-beacon' },
    ...overrides,
  };
}

function buildApp(options = {}) {
  const app = Fastify();
  const db = options.db ?? createTestDb();
  let spawnCalls = 0;
  let liveRecord = options.liveRecord ?? null;
  let currentRun = options.run ?? null;
  let predecessorRecord = { ...predecessor };
  let deferredAcceptance = null;
  let resolveRun;
  const pending = new Promise((resolve) => { resolveRun = resolve; });
  const sessions = {
    get: jest.fn((id) => id === predecessor.id && predecessorRecord
      ? { success: true, session: { ...predecessorRecord }, notes: [], files: [] }
      : id === 'session-successor'
        ? { success: true, session: { id, purpose: 'Continue the work', status: 'active' }, notes: [], files: [] }
        : { success: false, error: 'session not found' }),
  };
  const spawner = {
    spawn: jest.fn(async (spec, onAccepted) => {
      spawnCalls += 1;
      if (options.blocked) {
        return terminalResult({
          agentId: 'blocked',
          status: 'failed',
          output: null,
          error: 'Spawn blocked: no safe runtime.',
        });
      }
      const accepted = acceptedRun();
      const admit = () => {
        liveRecord = {
          ...accepted,
          status: 'running',
          heartbeatAt: Date.now(),
          lastActivityAt: Date.now(),
          pid: null,
        };
        onAccepted?.(accepted);
      };
      if (options.deferAcceptance) deferredAcceptance = admit;
      else admit();
      return pending;
    }),
    list: jest.fn(() => liveRecord ? [liveRecord] : []),
    get: jest.fn(() => currentRun),
    cancel: jest.fn(() => true),
  };
  app.register(sessionsPlugin, {
    deps: {
      db,
      spawner,
      sessions,
      metrics: { errors: 0 },
      logger: { info() {}, error() {} },
      activityLog: { log() {} },
    },
  });
  return {
    app,
    db,
    sessions,
    spawner,
    spawnCalls: () => spawnCalls,
    setLiveRecord(value) { liveRecord = value; },
    setRun(value) { currentRun = value; },
    setPredecessor(value) { predecessorRecord = value; },
    admit() { deferredAcceptance?.(); deferredAcceptance = null; },
    finish(result = terminalResult()) { currentRun = result; resolveRun(result); },
  };
}

describe('session continuation routes', () => {
  test('202 means exactly one durable successor session and transcript were admitted', async () => {
    const state = buildApp();
    const response = await state.app.inject({
      method: 'POST',
      url: `/sessions/${predecessor.id}/continue`,
      payload: continuationPayload(),
    });

    expect(response.statusCode).toBe(202);
    expect(response.headers.location).toMatch(/^\/sessions\/continuations\/run-/);
    expect(response.json()).toMatchObject({
      success: true,
      accepted: true,
      replayed: false,
      status: 'starting',
      predecessor: { sessionId: predecessor.id, status: 'completed' },
      successor: {
        agentId: 'spawned-successor',
        sessionId: 'session-successor',
        transcriptId: 'transcript-successor',
      },
      session: { id: 'session-successor', agentId: 'spawned-successor' },
    });
    expect(state.spawner.spawn).toHaveBeenCalledTimes(1);
    expect(state.spawner.spawn.mock.calls[0][0]).toMatchObject({
      backend: 'cli:codex',
      coordinationLifecycle: 'durable',
      coordinationMetadata: {
        continuation: { predecessorSessionId: predecessor.id },
      },
    });
    expect(state.sessions.get).toHaveBeenCalledWith(predecessor.id);
    await state.app.close();
    state.db.close();
  });

  test('exact idempotent replay returns the same successor and never spawns twice', async () => {
    const state = buildApp();
    const first = await state.app.inject({
      method: 'POST',
      url: `/sessions/${predecessor.id}/continue`,
      payload: continuationPayload(),
    });
    const replay = await state.app.inject({
      method: 'POST',
      url: `/sessions/${predecessor.id}/continue`,
      payload: continuationPayload(),
    });

    expect(replay.statusCode).toBe(202);
    expect(replay.json()).toMatchObject({
      replayed: true,
      successor: first.json().successor,
      receipt: { id: first.json().receipt.id },
    });
    expect(state.spawner.spawn).toHaveBeenCalledTimes(1);
    await state.app.close();
    state.db.close();
  });

  test('a concurrent idempotent replay waits for the owning admission instead of emitting a hollow 202', async () => {
    const state = buildApp({ deferAcceptance: true });
    const firstPromise = state.app.inject({
      method: 'POST',
      url: `/sessions/${predecessor.id}/continue`,
      payload: continuationPayload(),
    });
    await new Promise((resolve) => setImmediate(resolve));
    const replayPromise = state.app.inject({
      method: 'POST',
      url: `/sessions/${predecessor.id}/continue`,
      payload: continuationPayload(),
    });
    let replaySettled = false;
    void replayPromise.then(() => { replaySettled = true; });
    await new Promise((resolve) => setImmediate(resolve));
    expect(replaySettled).toBe(false);

    state.admit();
    const [first, replay] = await Promise.all([firstPromise, replayPromise]);
    expect(first.statusCode).toBe(202);
    expect(replay.statusCode).toBe(202);
    expect(replay.json()).toMatchObject({
      accepted: true,
      replayed: true,
      successor: first.json().successor,
    });
    expect(state.spawner.spawn).toHaveBeenCalledTimes(1);
    await state.app.close();
    state.db.close();
  });

  test('same idempotency key with request drift conflicts before a second spawn', async () => {
    const state = buildApp();
    await state.app.inject({
      method: 'POST',
      url: `/sessions/${predecessor.id}/continue`,
      payload: continuationPayload(),
    });
    const drift = await state.app.inject({
      method: 'POST',
      url: `/sessions/${predecessor.id}/continue`,
      payload: continuationPayload({ note: 'A different task under the same key.' }),
    });

    expect(drift.statusCode).toBe(409);
    expect(drift.json()).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(state.spawner.spawn).toHaveBeenCalledTimes(1);
    await state.app.close();
    state.db.close();
  });

  test('live requires a direct PID and a fresh supervisor heartbeat', async () => {
    const state = buildApp();
    const start = await state.app.inject({
      method: 'POST',
      url: `/sessions/${predecessor.id}/continue`,
      payload: continuationPayload(),
    });
    const monitorUrl = start.json().monitorUrl;

    const starting = await state.app.inject({ method: 'GET', url: monitorUrl });
    expect(starting.json()).toMatchObject({
      status: 'starting',
      liveness: { live: false, evidence: 'not-proven-live' },
    });

    state.setLiveRecord({
      ...acceptedRun(),
      status: 'running',
      pid: 43210,
      heartbeatAt: Date.now(),
      lastActivityAt: Date.now(),
    });
    const live = await state.app.inject({ method: 'GET', url: monitorUrl });
    expect(live.json()).toMatchObject({
      status: 'live',
      liveness: { live: true, evidence: 'pid-and-fresh-supervisor-heartbeat' },
    });

    state.setLiveRecord(null);
    const lost = await state.app.inject({ method: 'GET', url: monitorUrl });
    expect(lost.json()).toMatchObject({
      status: 'unknown',
      outcomeUnknown: true,
      liveness: { live: false },
    });
    await state.app.close();
    state.db.close();
  });

  test('restart recovery may become live again only from a direct PID and fresh heartbeat', async () => {
    const db = createTestDb();
    const first = buildApp({ db });
    const started = await first.app.inject({
      method: 'POST',
      url: `/sessions/${predecessor.id}/continue`,
      payload: continuationPayload(),
    });
    const restarted = buildApp({
      db,
      liveRecord: {
        ...acceptedRun(),
        status: 'running',
        pid: 43211,
        heartbeatAt: Date.now(),
        lastActivityAt: Date.now(),
      },
    });

    const recovered = await restarted.app.inject({ method: 'GET', url: started.json().monitorUrl });
    expect(recovered.json()).toMatchObject({
      status: 'live',
      outcomeUnknown: false,
      liveness: { live: true, pid: 43211 },
    });
    await first.app.close();
    await restarted.app.close();
    db.close();
  });

  test('terminal completion cannot simultaneously report live', async () => {
    const state = buildApp();
    const started = await state.app.inject({
      method: 'POST',
      url: `/sessions/${predecessor.id}/continue`,
      payload: continuationPayload(),
    });
    state.setLiveRecord({
      ...acceptedRun(),
      status: 'completed',
      pid: 43212,
      heartbeatAt: Date.now(),
      lastActivityAt: Date.now(),
    });
    state.setRun(terminalResult());

    const collected = await state.app.inject({ method: 'GET', url: started.json().monitorUrl });
    expect(collected.json()).toMatchObject({
      status: 'completed',
      terminal: true,
      liveness: { live: false },
    });
    await state.app.close();
    state.db.close();
  });

  test('receipt freezes predecessor lineage after the source session disappears', async () => {
    const state = buildApp();
    const started = await state.app.inject({
      method: 'POST',
      url: `/sessions/${predecessor.id}/continue`,
      payload: continuationPayload(),
    });
    state.setPredecessor(null);

    const collected = await state.app.inject({ method: 'GET', url: started.json().monitorUrl });
    expect(collected.json()).toMatchObject({
      predecessor: {
        sessionId: predecessor.id,
        purpose: predecessor.purpose,
        status: predecessor.status,
      },
    });
    expect(state.sessions.get).toHaveBeenCalledTimes(1);
    await state.app.close();
    state.db.close();
  });

  test('backend accounting remains on the receipt after spawner eviction and daemon restart', async () => {
    const db = createTestDb();
    const first = buildApp({ db });
    const started = await first.app.inject({
      method: 'POST',
      url: `/sessions/${predecessor.id}/continue`,
      payload: continuationPayload({ budgetUsd: 2.5 }),
    });
    first.finish(terminalResult({
      telemetry: {
        inputTokens: 200,
        cachedInputTokens: 150,
        outputTokens: 40,
        costUsd: 0.075,
        rateMode: 'exact',
      },
    }));
    await new Promise((resolve) => setImmediate(resolve));

    const restarted = buildApp({ db });
    const collected = await restarted.app.inject({ method: 'GET', url: started.json().monitorUrl });
    expect(collected.json()).toMatchObject({
      status: 'completed',
      accounting: {
        budgetUsd: 2.5,
        evidence: 'backend-reported-and-durable',
        telemetry: {
          inputTokens: 200,
          cachedInputTokens: 150,
          outputTokens: 40,
          costUsd: 0.075,
          rateMode: 'exact',
        },
      },
    });
    await first.app.close();
    await restarted.app.close();
    db.close();
  });

  test('a blocked backend returns no_runtime and never fabricates a successor', async () => {
    const state = buildApp({ blocked: true });
    const response = await state.app.inject({
      method: 'POST',
      url: `/sessions/${predecessor.id}/continue`,
      payload: continuationPayload(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: false,
      accepted: false,
      status: 'no_runtime',
      successor: null,
      session: null,
      run: { agentId: 'blocked' },
    });
    await state.app.close();
    state.db.close();
  });

  test('cancellation is receipt-owned and a late backend result cannot overwrite it', async () => {
    const state = buildApp();
    const start = await state.app.inject({
      method: 'POST',
      url: `/sessions/${predecessor.id}/continue`,
      payload: continuationPayload(),
    });
    const cancelled = await state.app.inject({
      method: 'DELETE',
      url: start.json().cancelUrl,
    });
    expect(cancelled.json()).toMatchObject({
      status: 'cancelled',
      terminal: true,
      receipt: { error: 'Cancelled by operator.' },
    });
    expect(state.spawner.cancel).toHaveBeenCalledWith('spawned-successor');

    state.finish(terminalResult());
    await new Promise((resolve) => setImmediate(resolve));
    const collected = await state.app.inject({ method: 'GET', url: start.json().monitorUrl });
    expect(collected.json()).toMatchObject({ status: 'cancelled', terminal: true });
    await state.app.close();
    state.db.close();
  });

  test('daemon-start recovery makes a nonterminal continuation outcome unknown', async () => {
    const db = createTestDb();
    const first = buildApp({ db });
    const started = await first.app.inject({
      method: 'POST',
      url: `/sessions/${predecessor.id}/continue`,
      payload: continuationPayload(),
    });

    const restarted = buildApp({ db });
    const recovered = await restarted.app.inject({ method: 'GET', url: started.json().monitorUrl });
    expect(recovered.json()).toMatchObject({
      status: 'unknown',
      outcomeUnknown: true,
      successor: started.json().successor,
    });
    await first.app.close();
    await restarted.app.close();
    db.close();
  });

  test('requires a real predecessor, explicit backend, and current workspace', async () => {
    const state = buildApp();
    const missing = await state.app.inject({
      method: 'POST',
      url: '/sessions/no-such-session/continue',
      payload: continuationPayload(),
    });
    const noBackend = await state.app.inject({
      method: 'POST',
      url: `/sessions/${predecessor.id}/continue`,
      payload: continuationPayload({ backend: undefined, idempotencyKey: 'no-backend' }),
    });
    const noWorkspace = await state.app.inject({
      method: 'POST',
      url: `/sessions/${predecessor.id}/continue`,
      payload: continuationPayload({ workdir: '/definitely/not/a/workspace', idempotencyKey: 'no-workspace' }),
    });

    expect(missing.statusCode).toBe(404);
    expect(noBackend.statusCode).toBe(400);
    expect(noWorkspace.statusCode).toBe(400);
    expect(state.spawner.spawn).not.toHaveBeenCalled();
    await state.app.close();
    state.db.close();
  });
});
