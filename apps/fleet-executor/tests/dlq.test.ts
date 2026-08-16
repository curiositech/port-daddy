import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import handler from '../src/index.js';
import { handleDlqJob } from '../src/dlq.js';
import {
  freshState,
  installGitHubFetch,
  memoryKV,
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

function fakeDlqBatch(messages: ReturnType<typeof fakeMessage>[]) {
  return { queue: 'fleet-runs-dlq', messages } as unknown as MessageBatch<FleetRunJob>;
}

let state: GitHubState;

beforeEach(() => {
  state = freshState();
  installGitHubFetch(state);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DLQ handler', () => {
  it('completes the stuck check run as failure for a dead-lettered job', async () => {
    // A 'Port Daddy Fleet' check exists in_progress for the PR head SHA.
    state.existingCheckRuns.push({ id: 4242, name: 'Port Daddy Fleet' });
    const kv = memoryKV();
    seedToken(kv, 42);
    const env = makeEnv({ FLEET_TOKENS: kv });

    await handleDlqJob(makeJob(), env);

    expect(state.completed).toHaveLength(1);
    expect(state.completed[0]).toMatchObject({ id: 4242, conclusion: 'failure' });
    expect(state.completed[0].summary).toContain('dead-lettered');
  });

  // `blockWithoutSandbox: false` promises the fleet never blocks on tests it
  // could not run. That promise held inside the purser and leaked here: a job
  // that dies outright completes `failure`, which rendered as the same red
  // `Port Daddy Fleet` a genuine BLOCK does. Ten-plus correct PRs were read as
  // rejected on 2026-08-10 because of it, each re-diagnosed from scratch.
  it('labels the gate as OUR failure, not a verdict on the PR', async () => {
    state.existingCheckRuns.push({ id: 4242, name: 'Port Daddy Fleet' });
    const kv = memoryKV();
    seedToken(kv, 42);

    await handleDlqJob(makeJob(), makeEnv({ FLEET_TOKENS: kv }));

    // The title is the ONLY part of a completed check rendered in the PR's
    // checks list. If this collapses back to the bare check name, the
    // distinction becomes invisible again without clicking through.
    expect(state.completed[0].title).toContain('infrastructure failure');
    expect(state.completed[0].title).not.toBe('Port Daddy Fleet');
    expect(state.completed[0].summary).toContain('not a verdict on your change');
  });

  it('still fails CLOSED — an unverified change must not merge', async () => {
    state.existingCheckRuns.push({ id: 4242, name: 'Port Daddy Fleet' });
    const kv = memoryKV();
    seedToken(kv, 42);

    await handleDlqJob(makeJob(), makeEnv({ FLEET_TOKENS: kv }));

    // Relabelling must not soften the gate. `failure` is also load-bearing for
    // execute.ts's DECIDED set: a non-terminal conclusion here is what once let
    // redelivered jobs re-run ships for hours against an unwinnable gate.
    expect(state.completed[0].conclusion).toBe('failure');
  });

  it('routes a fleet-runs-dlq batch through the handler and always acks', async () => {
    state.existingCheckRuns.push({ id: 77, name: 'Port Daddy Fleet' });
    const kv = memoryKV();
    seedToken(kv, 42);

    const msg = fakeMessage(makeJob());
    await handler.queue!(
      fakeDlqBatch([msg]),
      makeEnv({ FLEET_TOKENS: kv }),
      {} as ExecutionContext,
    );

    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.retry).not.toHaveBeenCalled();
    expect(state.completed[0]).toMatchObject({ id: 77, conclusion: 'failure' });
  });

  it('emits an error telemetry event for the dropped run when configured', async () => {
    state.existingCheckRuns.push({ id: 5, name: 'Port Daddy Fleet' });
    const kv = memoryKV();
    seedToken(kv, 42);
    const posted: unknown[] = [];
    // Intercept the telemetry POST by URL; delegate everything else to the GitHub stub.
    const ghFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('/telemetry/cloud-app')) {
          posted.push(JSON.parse(init?.body as string));
          return new Response(null, { status: 202 });
        }
        return ghFetch(input as RequestInfo, init);
      }) as unknown as typeof fetch,
    );

    await handleDlqJob(
      makeJob(),
      makeEnv({ FLEET_TOKENS: kv, PORT_DADDY_TELEMETRY_URL: 'https://sink.example/telemetry/cloud-app' }),
    );

    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      event: 'dlq',
      status: 'error',
      conclusion: 'failure',
      metadata: { deadLettered: true },
    });
  });

  it('is a no-op (never throws) for an unparseable job with no head SHA', async () => {
    const job = makeJob({ payloadMinimal: {} });
    await expect(handleDlqJob(job, makeEnv())).resolves.toBeUndefined();
    expect(state.completed).toHaveLength(0);
  });
});
