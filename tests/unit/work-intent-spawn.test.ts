import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createWorkIntentService } from '../../lib/agent-harbor/work-intent-service.js';
import { createWorkIntentSpawn } from '../../lib/agent-harbor/work-intent-spawn.js';
import { createConductor } from '../../lib/fleet/conductor.js';
import { createSpawner } from '../../lib/spawner.js';
import { createBonds } from '../../lib/bonds.js';
import { createTranscripts, describeTranscriptArchiveArtifact } from '../../lib/transcripts.js';
import { createSpawnerHarborBridge } from '../../lib/agent-harbor/spawner-bridge.js';
import { createDispatchQueue } from '../../lib/dispatch/queue.js';
import { readEvents, ensureEventLedgerSchema, verifySessionChain } from '../../lib/agent-harbor/event-ledger.js';
import { AgentRunIdempotencyConflictError } from '../../lib/agent-run-receipts.js';

// No child, provider, daemon, hook or socket is started. The only backend is
// runnerOverrides.claude; every coordination fetch receives an inert response.
const originalFetch = global.fetch;
let db: ReturnType<typeof createTestDb>;
const spec = { backend: 'claude' as const, model: 'claude-haiku-4-5', task: 'one bounded goal', budgetUsd: 1 };
beforeEach(() => {
  db = createTestDb();
  ensureEventLedgerSchema(db);
  global.fetch = jest.fn(async () => ({ ok: true, status: 200,
    json: async () => ({ success: true, sessionId: 'exact-session', credential: 'synthetic' }),
    text: async () => 'OK' })) as any;
});
afterEach(async () => { await new Promise(resolve => setImmediate(resolve)); global.fetch = originalFetch; db.close(); });
function fixture(options: Record<string, any> = {}) {
  const archives: Array<{ id: string; status: string }> = [];
  const transcripts = createTranscripts(db, { archiveSink: { archive(entry: any) {
    archives.push({ id: entry.id, status: entry.status });
    return { ok: true, artifact: describeTranscriptArchiveArtifact(entry, `test://receipt/${entry.id}`) };
  } } });
  const backend = jest.fn(options.backend ?? (async () => ({ output: 'done', error: null })));
  const spawner = createSpawner({ runtimeAllowed: options.runtimeAllowed ?? (() => true),
    harbors: options.harbors, bonds: options.bonds,
    transcripts: { ...transcripts, ...options.transcripts },
    harborBridge: createSpawnerHarborBridge(db),
    managedSessionLifecycle: {
      admit: async () => ({ success: true, sessionId: 'exact-session', credential: 'synthetic', worktreeBinding: { cwd: null } }),
      bind: async () => ({ success: true, worktreeBinding: { cwd: null }, validateBeforeLaunch: async () => ({ success: true }) }),
      complete: options.complete ?? (async () => ({ success: true })), abort: async () => ({ success: true }),
    } as any,
    enforceTelemetryPolicy: false,
    telemetryBypassApproval: { humanConfirmed: true, confirmedBy: 'fixture', reason: 'Inert backend and intercepted transport only' },
    runnerOverrides: { claude: backend as any },
  });
  const conductor = createConductor({ db, spawner: spawner as any, bonds: options.bonds });
  const workIntentService = createWorkIntentService({ db });
  const runtime = createWorkIntentSpawn({ db, workIntentService, conductor });
  return { runtime, conductor, workIntentService, spawner, backend, transcripts, archives };
}
function facts(kind: any) { return readEvents(db, { streamType: kind }).map(row => JSON.parse(row.payload_json)); }

test('persists the canonical chain before the first backend turn and preserves exact transcript/session joins', async () => {
  let f: ReturnType<typeof fixture>;
  f = fixture({ backend: async () => {
    expect(facts('work-intent')).toHaveLength(1);
    expect(facts('work-plan')[0]).toMatchObject({ shape: 'single-node', state: 'materializing' });
    expect(facts('agent-node').at(-1)).toMatchObject({ currentSessionId: 'exact-session' });
    expect(facts('agent-run')[0]).toMatchObject({ sessionId: 'exact-session', status: 'running' });
    return { output: 'done', error: null };
  } });
  const answer = await f.runtime.run({ ...spec, env: { SYNTHETIC_SECRET: 'never-store-me' } });
  expect(answer.result?.status).toBe('completed');
  expect(answer.runReceipt).toMatchObject({ status: 'completed', successorSessionId: 'exact-session' });
  expect(answer.runReceipt.launchId).toBeTruthy();
  expect(f.transcripts.getTranscript(answer.runReceipt.transcriptId!)?.status).toBe('completed');
  expect(facts('agent-run').at(-1)).toMatchObject({ runId: answer.runReceipt.id, status: 'completed' });
  expect(f.runtime.get(answer.runReceipt.id)).toEqual(answer.runReceipt);
  const timeline = readEvents(db, { streamType: 'transcript-event', sessionId: answer.runReceipt.successorSessionId! })
    .map(row => JSON.parse(row.payload_json));
  expect(timeline.map(event => event.kind)).toEqual(expect.arrayContaining(['session_started', 'operator_message', 'assistant_message', 'session_end']));
  expect(timeline.find(event => event.kind === 'operator_message').payloadJson.content).toBe(spec.task);
  expect(timeline.find(event => event.kind === 'assistant_message').payloadJson.content).toBe('done');
  expect(timeline.every(event => (event.payloadJson.runId ?? event.payloadJson.contextEnvelope?.runId) === answer.runReceipt.id)).toBe(true);
  expect(verifySessionChain(db, answer.runReceipt.successorSessionId!)).toBeNull();
  expect(JSON.stringify(db.prepare('SELECT payload_json FROM harbor_events').all())).not.toContain('never-store-me');
  expect(() => f.workIntentService.start(answer.runReceipt.intentId!, createDispatchQueue({ db }))).toThrow('Single-body');
});

test('concurrent retries execute once; changed request keys conflict; terminal replay does not execute', async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.runtime.run(spec, { idempotencyKey: 'same' }), f.runtime.run(spec, { idempotencyKey: 'same' })]);
  expect(f.backend).toHaveBeenCalledTimes(1);
  expect(b.runReceipt.id).toBe(a.runReceipt.id);
  expect(b.duplicate).toBe(true);
  const replay = await f.runtime.run(spec, { idempotencyKey: 'same' });
  expect(replay).toMatchObject({ duplicate: true, result: null, runReceipt: { status: 'completed' } });
  await expect(f.runtime.run({ ...spec, task: 'different' }, { idempotencyKey: 'same' })).rejects.toBeInstanceOf(AgentRunIdempotencyConflictError);
  expect(f.backend).toHaveBeenCalledTimes(1);
});

test.each(['backend', 'open', 'append', 'finalize', 'run-binding'])('%s failure never produces a completed receipt', async failure => {
  let f: ReturnType<typeof fixture>;
  f = fixture({
    backend: async () => { if (failure === 'backend') throw new Error('backend failure'); return { output: 'done', error: null }; },
    transcripts: failure === 'open' ? { start() { throw new Error('transcript open failure'); } }
      : failure === 'finalize' ? { finalize() { throw new Error('transcript finalize failure'); } }
      : failure === 'append' ? { appendMessage(_id: string, msg: any) { if (msg.role === 'assistant') throw new Error('transcript append failure'); return f.transcripts.appendMessage(_id, msg); } } : {},
  });
  if (failure === 'run-binding') db.exec(`CREATE TRIGGER reject_run BEFORE INSERT ON harbor_events WHEN NEW.stream_type = 'agent-run' BEGIN SELECT RAISE(ABORT, 'run binding failure'); END`);
  const answer = await f.runtime.run(spec);
  expect(answer.runReceipt.status).toBe('failed');
  expect(answer.result?.status).not.toBe('completed');
  if (['open', 'run-binding'].includes(failure)) expect(f.backend).not.toHaveBeenCalled();
  if (failure !== 'open') expect(answer.runReceipt.transcriptId).toBeTruthy();
});

test.each(['success', 'failure'])('observed stop survives late backend %s and archives once', async outcome => {
  let release!: (value: any) => void;
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const delayed = new Promise(resolve => { release = resolve; });
  const f = fixture({ backend: async () => { entered(); return delayed; } });
  const pending = f.runtime.run(spec);
  await ready;
  const receipt = db.prepare('SELECT id, launch_id FROM agent_run_receipts').get() as any;
  f.conductor.halt();
  release(outcome === 'success' ? { output: 'late', error: null } : { output: null, error: 'late failure' });
  const answer = await pending;
  expect(answer.runReceipt.status).toBe('cancelled');
  expect(f.conductor.get(receipt.launch_id)?.state).toBe('halted');
  expect(f.transcripts.getTranscript(answer.runReceipt.transcriptId!)?.status).toBe('killed');
  expect(f.archives).toEqual([{ id: answer.runReceipt.transcriptId, status: 'killed' }]);
});

test('halt request without observed kill remains unknown, never completed', async () => {
  const f = fixture();
  const conductor = { launch: async (intent: any) => {
    intent.onAdmitted({ id: 'late-launch' });
    return { launch: { id: 'late-launch', state: 'halted' }, admitted: true, refusedReason: null,
      spawn: { agentId: 'body', status: 'completed', output: 'late', error: null } };
  } };
  const runtime = createWorkIntentSpawn({ db, workIntentService: f.workIntentService, conductor: conductor as any });
  const result = await runtime.run(spec);
  expect(result.runReceipt.status).toBe('unknown');
  expect(result.result?.status).toBe('failed');
});

test('Off denies the effect and leaves a typed failure; no body executes', async () => {
  const f = fixture({ runtimeAllowed: () => false });
  const result = await f.runtime.run(spec);
  expect(result.runReceipt).toMatchObject({ status: 'failed', transcriptId: null });
  expect(result.runReceipt.error).toMatch(/Off/);
  expect(f.backend).not.toHaveBeenCalled();
});

test('failed admission transaction rolls back and never actuates', async () => {
  const f = fixture();
  db.exec(`CREATE TRIGGER reject_plan BEFORE INSERT ON harbor_events WHEN NEW.stream_type = 'work-plan' BEGIN SELECT RAISE(ABORT, 'plan failure'); END`);
  await expect(f.runtime.run(spec)).rejects.toMatchObject({ message: 'plan failure' });
  expect(f.backend).not.toHaveBeenCalled();
  expect(facts('work-intent')).toHaveLength(0);
  expect(db.prepare('SELECT * FROM agent_run_receipts').all()).toHaveLength(0);
});

test('restart uncertainty is read back without relaunch', async () => {
  const f = fixture();
  // Simulate an interrupted accepted run using the same public receipt format.
  const { createAgentRunReceiptStore } = await import('../../lib/agent-run-receipts.js');
  const store = createAgentRunReceiptStore(db, { recoverNonTerminal: false });
  const accepted = store.accept({ kind: 'spawn', idempotencyKey: 'work-intent:single-body:restart', request: spec });
  const restarted = createWorkIntentSpawn({ db, workIntentService: f.workIntentService, conductor: f.conductor });
  const replay = await restarted.run(spec, { idempotencyKey: 'restart' });
  expect(replay.runReceipt).toMatchObject({ id: accepted.receipt.id, status: 'unknown' });
  expect(replay.duplicate).toBe(true);
  expect(f.backend).not.toHaveBeenCalled();
});


test.each(['binding', 'terminal'])('receipt %s persistence failure cannot report completion', async stage => {
  const f = fixture();
  db.exec(`CREATE TRIGGER reject_receipt BEFORE UPDATE ON agent_run_receipts
    WHEN NEW.status = '${stage === 'binding' ? 'starting' : 'completed'}'
    BEGIN SELECT RAISE(ABORT, 'receipt write failure'); END`);
  await expect(f.runtime.run(spec)).rejects.toMatchObject({ message: 'receipt write failure' });
  if (stage === 'binding') expect(f.backend).not.toHaveBeenCalled();
  expect(db.prepare("SELECT id FROM agent_run_receipts WHERE status = 'completed'").all()).toHaveLength(0);
  expect(facts('agent-run').some(fact => fact.status === 'completed')).toBe(false);
});

test('one-body materialization preserves explicit spawn options without granting worktree or merge authority', async () => {
  const f = fixture();
  let launch: any;
  const runtime = createWorkIntentSpawn({ db, workIntentService: f.workIntentService,
    conductor: { launch: async (intent: any) => {
      launch = intent;
      return { launch: { id: 'refused', state: 'failed' }, admitted: false, refusedReason: 'fixture refusal', spawn: null };
    } } as any });
  const options = { ...spec, name: 'body-name', files: ['owned.ts'], identity: 'repo:task', purpose: 'bounded work',
    workdir: '/fixture/worktree', timeout: 1234, allowedTools: 'Read', maxTokens: 42,
    permissionMode: 'acceptEdits' as const, injectSquidHooks: false, tubeChannel: 'task:run',
    env: { SYNTHETIC: 'ephemeral' }, requestedBackend: 'gemini' as const, requestedModel: 'requested-model',
    backendOverrideSource: 'preflight' as const };
  await runtime.run(options);
  const spawnSpec = f.conductor.intentToSpawnSpec(launch, options.workdir);
  expect(spawnSpec).toMatchObject(options);
  expect(launch).toMatchObject({ source: 'operator', worktree: 'inherit', mergePolicy: 'never', timeoutMs: 1234 });
  expect(JSON.stringify(facts('work-intent'))).not.toContain('ephemeral');
});


test('halt during delayed harbor admission refuses the first backend turn', async () => {
  let release!: (value: any) => void;
  let entering!: () => void;
  const entered = new Promise<void>(resolve => { entering = resolve; });
  const admission = new Promise(resolve => { release = resolve; });
  const bonds = createBonds(db as any);
  bonds.topUpWallet('test', 10);
  bonds.setBudget('test', 10);
  const f = fixture({ bonds, harbors: {
    get: () => ({ name: 'test' }), enter: async () => { entering(); return admission; }, leaveAll: () => {},
  } });
  const pending = f.runtime.run({ ...spec, identity: 'test:one-body' });
  await Promise.race([entered, pending.then(answer => { throw new Error(`Stopped before harbor admission: ${answer.runReceipt.error}`); })]);
  const row = db.prepare('SELECT launch_id FROM agent_run_receipts').get() as any;
  f.conductor.halt({ rootId: row.launch_id });
  release({ success: true });
  const answer = await pending;
  expect(f.backend).not.toHaveBeenCalled();
  expect(f.conductor.get(row.launch_id)?.state).toBe('halted');
  expect(answer.runReceipt).toMatchObject({ status: 'cancelled', successorSessionId: null });
  expect(bonds.listBonds({ project: 'test' }).map(bond => bond.state)).toEqual(['refunded']);
  expect(bonds.conservation('test')).toMatchObject({ walletUsd: 10, escrowUsd: 0, commonsUsd: 0 });
  expect(f.archives).toEqual([{ id: answer.runReceipt.transcriptId, status: 'killed' }]);
});


test('unconfirmed managed-session completion produces a failed receipt', async () => {
  const f = fixture({ complete: async () => ({ success: false, error: 'completion refused' }) });
  const answer = await f.runtime.run(spec);
  expect(f.backend).toHaveBeenCalledTimes(1);
  expect(answer.runReceipt).toMatchObject({ status: 'failed', successorSessionId: 'exact-session' });
  expect(answer.runReceipt.error).toContain('completion refused');
});
