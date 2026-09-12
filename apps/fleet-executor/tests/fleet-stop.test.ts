import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { controlDb } from '../../relay/tests/support/fleet-controls.js';
import { FleetStoppedError, writeFleetControl } from '../../../shared/fleet-controls.js';
import { fleetInvocationGuard, withFleetControls } from '../src/fleet-stop.js';
import { FleetAiCircuit } from '../src/ai-resilience.js';
import { handleDlqJob } from '../src/dlq.js';
import { buildMediatorScanIo } from '../src/mediator.js';
import { completeCheckRun } from '../src/github.js';
import { executeFleet } from '../src/execute.js';
import handler from '../src/index.js';
import { makeEnv, makeJob, memoryD1, freshState, installGitHubFetch } from './harness.js';
import type { FleetRunJob } from '../src/env.js';

// Synthetic signing material; no operator credential is read by these tests.
const fixturePem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Cloud Fleet action-boundary enforcement', () => {
  it.each(['pull-request', 'merge-group', 'dead-letter'])('refuses credential minting after a %s token-cache miss observes a stop', async path => {
    const controls = controlDb([42]);
    const telemetry = memoryD1();
    telemetry.db.withSession = controls.withSession;
    const env = makeEnv({ DB: telemetry.db, GITHUB_APP_PRIVATE_KEY: fixturePem });
    vi.spyOn(env.FLEET_TOKENS as unknown as { get(key: string): Promise<string | null> }, 'get').mockImplementationOnce(async () => {
      await writeFleetControl(controls, 'global', false, 1, 'u_admin');
      return null;
    });
    const state = freshState();
    installGitHubFetch(state);
    const job = path === 'merge-group' ? makeJob({ eventType: 'merge_group', payloadMinimal: { merge_group: { head_sha: 'ABC123' } } }) : makeJob();
    if (path === 'dead-letter') await expect(handleDlqJob(job, env)).resolves.toBeUndefined();
    else await expect(executeFleet(job, env)).rejects.toBeInstanceOf(FleetStoppedError);
    expect(state.tokenMints).toBe(0);
    expect(state.records).toHaveLength(0);
  });
  it('preserves terminal model stops and never revives the invocation after storage recovers', async () => {
    const controls = controlDb([42]);
    const primary = controls.withSession.bind(controls);
    vi.spyOn(controls, 'withSession').mockImplementationOnce(() => { throw new Error('transient'); }).mockImplementation(primary);
    const run = vi.fn(async () => ({ response: 'must not run' }));
    const guard = fleetInvocationGuard(controls, 42);
    const env = withFleetControls(makeEnv({ DB: controls, AI: { run } as unknown as Ai }), 42, guard);
    const circuit = new FleetAiCircuit(1000);
    await expect(circuit.run(() => env.AI.run('fixture' as never, {} as never))).rejects.toBeInstanceOf(FleetStoppedError);
    await expect(guard()).rejects.toBeInstanceOf(FleetStoppedError);
    await expect(env.AI.run('fixture' as never, {} as never)).rejects.toBeInstanceOf(FleetStoppedError);
    expect(run).not.toHaveBeenCalled();
  });

  it.each(['configuration', 'metadata'])('refuses initial check creation when stop arrives during %s lookup', async boundary => {
    const controls = controlDb([42]);
    const telemetry = memoryD1();
    telemetry.db.withSession = controls.withSession;
    const env = makeEnv({ DB: telemetry.db });
    const state = freshState();
    installGitHubFetch(state);
    const fetch = globalThis.fetch;
    let metadataReads = 0, stopped = false;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await fetch(input, init);
      const url = String(input);
      if (url.endsWith('/pulls/7') && (!init?.method || init.method === 'GET')) metadataReads++;
      if (!stopped && (boundary === 'configuration' ? url.includes('/contents/pd-fleet.yml') : metadataReads === 2)) {
        stopped = true;
        await writeFleetControl(controls, 'installation:42', false, 1, 'u_owner');
      }
      return response;
    }));
    await env.FLEET_TOKENS.put('github_inst_42', JSON.stringify({ token: 'synthetic-token', expiresAt: Date.now() + 3600000 }));
    await expect(executeFleet(makeJob(), env)).rejects.toBeInstanceOf(FleetStoppedError);
    expect(stopped).toBe(true);
    expect(state.checkRunsCreated).toBe(0);
    expect(state.completed).toHaveLength(0);
  });

  it.each(['merge-group', 'dead-letter'])('does not retry a %s check mutation after a stop', async path => {
    vi.useFakeTimers();
    const controls = controlDb([42]);
    const state = freshState();
    state.existingCheckRuns.push({ id: 4242, name: 'Port Daddy Fleet' });
    installGitHubFetch(state);
    const fetch = globalThis.fetch;
    let patches = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PATCH' && String(input).includes('/check-runs/')) {
        patches++;
        await writeFleetControl(controls, 'global', false, 1, 'u_admin');
        return new Response('temporary failure', { status: 503 });
      }
      return fetch(input, init);
    }));
    const telemetry = memoryD1();
    telemetry.db.withSession = controls.withSession;
    const env = makeEnv({ DB: telemetry.db });
    await env.FLEET_TOKENS.put('github_inst_42', JSON.stringify({ token: 'synthetic-token', expiresAt: Date.now() + 3600000 }));
    const job = path === 'merge-group' ? makeJob({ eventType: 'merge_group', payloadMinimal: { merge_group: { head_sha: 'ABC123' } } }) : makeJob();
    const result = path === 'merge-group'
      ? expect(executeFleet(job, env)).rejects.toBeInstanceOf(FleetStoppedError)
      : expect(handleDlqJob(job, env)).resolves.toBeUndefined();
    await vi.runAllTimersAsync();
    await result;
    expect(patches).toBe(1);
    expect(state.completed).toHaveLength(0);
  });

  it('guards mediator work after candidate lookup and every completion retry', async () => {
    vi.useFakeTimers();
    const controls = controlDb([42]);
    const guard = fleetInvocationGuard(controls, 42);
    const create = vi.fn(async () => 8);
    const io = buildMediatorScanIo({ env: {}, owner: 'o', repo: 'r', token: 'fixture', beforeAction: guard,
      listOpenPrs: async () => { await writeFleetControl(controls, 'global', false, 1, 'u_admin'); return []; },
      fetchPatches: async () => [], createCheckRun: create, completeCheckRun });
    await io.listOpenPrs();
    await expect(io.postNeutralCheck('head', 'summary')).rejects.toBeInstanceOf(FleetStoppedError);
    expect(create).not.toHaveBeenCalled();
    await writeFleetControl(controls, 'global', true, 2, 'u_admin');
    let patches = 0;
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== 'PATCH') return Response.json({ status: 'in_progress' });
      patches++;
      await writeFleetControl(controls, 'global', false, 3, 'u_admin');
      return new Response('retry', { status: 503 });
    }));
    const freshIo = buildMediatorScanIo({ env: {}, owner: 'o', repo: 'r', token: 'fixture', beforeAction: fleetInvocationGuard(controls, 42),
      listOpenPrs: async () => [], fetchPatches: async () => [], createCheckRun: create, completeCheckRun });
    const result = expect(freshIo.postNeutralCheck('head', 'summary')).rejects.toBeInstanceOf(FleetStoppedError);
    await vi.runAllTimersAsync(); await result;
    expect(patches).toBe(1);
  });
  it('checks each AI invocation and never mutates the supplied binding', async () => {
    const db = controlDb([42]);
    const run = vi.fn(async () => ({ response: 'synthetic response' }));
    const env = makeEnv({ DB: db, AI: { run } as unknown as Ai });
    const guarded = withFleetControls(env, 42);
    await guarded.AI.run('fixture' as never, {} as never);
    await writeFleetControl(db, 'installation:42', false, 1, 'u_owner');
    await expect(guarded.AI.run('fixture' as never, {} as never)).rejects.toThrow('FLEET_STOPPED');
    expect(run).toHaveBeenCalledOnce();
    expect(env.AI.run).toBe(run);
  });

  it.each(['fleet-runs', 'fleet-runs-dlq'])('drops %s deliveries and continuations with no external effects', async queue => {
    const fetch = vi.fn(() => { throw new Error('Unexpected external request'); });
    vi.stubGlobal('fetch', fetch);
    for (const db of [undefined, controlDb(), { withSession() { throw new Error('offline'); } } as unknown as D1Database]) {
      const env = makeEnv();
      env.DB = db;
      const send = vi.fn();
      env.FLEET_CONTINUATIONS = { send } as unknown as Queue<FleetRunJob>;
      const message = { body: makeJob({ continuationSequence: 1 }), ack: vi.fn(), retry: vi.fn() };
      await handler.queue({ queue, messages: [message] } as unknown as MessageBatch<FleetRunJob>, env, {} as ExecutionContext);
      expect(message.ack).toHaveBeenCalledOnce();
      expect(message.retry).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('discards model output when the global stop changes while that request runs', async () => {
    const controls = controlDb([42]);
    const telemetry = memoryD1();
    telemetry.db.withSession = controls.withSession;
    const state = freshState();
    installGitHubFetch(state);
    state.files.set('main:pd-fleet.yml', `fleet:
  agents:
    code-reviewer:
      trigger: pull_request:opened
      blocking: true
      fallbacks:
        - backend: cloudflare
          model: '@cf/qwen/qwen3-30b-a3b-fp8'
      prompt: 'code-reviewer ship: review the diff.'
`);
    const run = vi.fn(async () => {
      await writeFleetControl(controls, 'global', false, 1, 'u_admin');
      return { response: 'FLEET-VERDICT: PASS' };
    });
    const env = makeEnv({ DB: telemetry.db, AI: { run } as unknown as Ai });
    await env.FLEET_TOKENS.put('github_inst_42', JSON.stringify({ token: 'synthetic-token', expiresAt: Date.now() + 3600000 }));
    await expect(executeFleet(makeJob(), env)).rejects.toThrow('FLEET_STOPPED');
    expect(run).toHaveBeenCalledOnce();
    expect(state.commentPosts).toBe(0);
    expect(state.completed).toHaveLength(0);
    expect(state.reviews).toHaveLength(0);
  });
});
