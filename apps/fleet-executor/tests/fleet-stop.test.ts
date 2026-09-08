import { afterEach, describe, expect, it, vi } from 'vitest';
import { controlDb } from '../../relay/tests/support/fleet-controls.js';
import { writeFleetControl } from '../../../shared/fleet-controls.js';
import { withFleetControls } from '../src/fleet-stop.js';
import { executeFleet } from '../src/execute.js';
import handler from '../src/index.js';
import { makeEnv, makeJob, memoryD1, freshState, installGitHubFetch } from './harness.js';
import type { FleetRunJob } from '../src/env.js';

afterEach(() => vi.unstubAllGlobals());

describe('Cloud Fleet action-boundary enforcement', () => {
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
