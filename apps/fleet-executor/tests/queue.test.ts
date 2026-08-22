import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import handler from '../src/index.js';
import {
  freshState,
  installGitHubFetch,
  memoryKV,
  aiStub,
  makeEnv,
  makeJob,
  type GitHubState,
} from './harness.js';
import type { FleetRunJob } from '../src/env.js';

function seedToken(kv: KVNamespace, installationId: number): void {
  void kv.put(
    `github_inst_${installationId}`,
    JSON.stringify({ token: 'seeded-tok', expiresAt: Date.now() + 3_600_000 }),
  );
}

function fakeMessage(body: FleetRunJob) {
  return { id: 'm1', timestamp: new Date(), body, ack: vi.fn(), retry: vi.fn() };
}

function fakeBatch(messages: ReturnType<typeof fakeMessage>[]) {
  return { queue: 'fleet-runs', messages } as unknown as MessageBatch<FleetRunJob>;
}

interface CapturingCtx extends ExecutionContext {
  waited: Promise<unknown>[];
}

function capturingCtx(): CapturingCtx {
  const waited: Promise<unknown>[] = [];
  return {
    waited,
    waitUntil(promise: Promise<unknown>) {
      waited.push(promise);
    },
    passThroughOnException() {},
  } as unknown as CapturingCtx;
}

let state: GitHubState;

beforeEach(() => {
  state = freshState();
  installGitHubFetch(state);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('queue consumer', () => {
  it('acks a message on successful run', async () => {
    state.files.set('main:pd-fleet.yml', 'fleet:\n');
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({
      fleetParser: JSON.stringify([
        { name: 'code-reviewer', trigger: 'pull_request:opened', prompt: 'code-reviewer r', cfModel: null, role: 'r', telos: 't', blocking: true, allowedTools: '' },
      ]),
      perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' },
    }).ai;

    const msg = fakeMessage(makeJob());
    const ctx = capturingCtx();
    await handler.queue!(
      fakeBatch([msg]),
      makeEnv({ FLEET_TOKENS: kv, AI: ai }),
      ctx,
    );

    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.retry).not.toHaveBeenCalled();
    expect(ctx.waited).toHaveLength(1);
    await Promise.all(ctx.waited);
  });

  it('retries a message when the orchestrator throws (recoverable infra error)', async () => {
    // Force a token mint to fail repeatedly: no seeded KV + token mint 401s,
    // so getInstallationTokenCached throws and executeFleet re-throws.
    const kv = memoryKV();
    state.failTokenMintTimes = 5;
    // Provide a real-ish env; AI never reached.
    const env = makeEnv({
      FLEET_TOKENS: kv,
      GITHUB_APP_PRIVATE_KEY: pkcs8(),
    });

    const msg = fakeMessage(makeJob());
    const ctx = capturingCtx();
    await handler.queue!(fakeBatch([msg]), env, ctx);

    expect(msg.retry).toHaveBeenCalledTimes(1);
    expect(msg.ack).not.toHaveBeenCalled();
    expect(ctx.waited).toHaveLength(0);
  });

  it('retries instead of acking when the required check cannot be completed', async () => {
    state.files.set('main:pd-fleet.yml', 'fleet:\n');
    const kv = memoryKV();
    seedToken(kv, 42);
    const ai = aiStub({
      fleetParser: JSON.stringify([
        { name: 'code-reviewer', trigger: 'pull_request:opened', prompt: 'code-reviewer r', cfModel: null, role: 'r', telos: 't', blocking: true, allowedTools: '' },
      ]),
      perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' },
    }).ai;

    const realFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (/\/check-runs\/\d+$/.test(url) && (init?.method ?? 'GET') === 'PATCH') {
          return new Response('completion unavailable', { status: 503 });
        }
        return realFetch(input as RequestInfo, init);
      }) as unknown as typeof fetch,
    );

    const msg = fakeMessage(makeJob());
    const ctx = capturingCtx();
    await handler.queue!(fakeBatch([msg]), makeEnv({ FLEET_TOKENS: kv, AI: ai }), ctx);

    expect(msg.retry).toHaveBeenCalledTimes(1);
    expect(msg.ack).not.toHaveBeenCalled();
    expect(state.completed).toHaveLength(0);
    expect(state.reviews).toHaveLength(0);
    expect(ctx.waited).toHaveLength(0);
  });
});

// Real PKCS8 key so the (failing) mint path actually signs a JWT before the
// faked fetch returns 401.
function pkcs8(): string {
  return generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
    type: 'pkcs8',
    format: 'pem',
  }) as string;
}
