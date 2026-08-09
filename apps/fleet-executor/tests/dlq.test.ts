import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import handler from '../src/index.js';
import { handleDlqJob } from '../src/dlq.js';
import {
  freshState,
  installGitHubFetch,
  memoryKV,
  memoryD1,
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
    const d1 = memoryD1();
    const env = makeEnv({ FLEET_TOKENS: kv, DB: d1.db });

    await handleDlqJob(makeJob(), env);

    expect(state.completed).toHaveLength(1);
    expect(state.completed[0]).toMatchObject({ id: 4242, conclusion: 'failure' });
    expect(state.completed[0].summary).toContain('dead-lettered');
    expect(d1.runs).toHaveLength(1);
    expect(d1.runs[0]).toMatchObject({
      id: 'run:delivery-abc',
      deliveryId: 'delivery-abc',
      headSha: 'HEADSHA',
    });
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

  it('fails a dead-lettered merge-group check instead of treating it as unparseable', async () => {
    state.existingCheckRuns.push({ id: 88, name: 'Port Daddy Fleet' });
    const kv = memoryKV();
    seedToken(kv, 42);
    const job = makeJob({
      eventType: 'merge_group',
      action: 'checks_requested',
      prNumber: null,
      payloadMinimal: {
        merge_group: {
          head_sha: 'queue-head-sha',
          base_ref: 'refs/heads/main',
        },
      },
    });

    await handleDlqJob(job, makeEnv({ FLEET_TOKENS: kv }));

    expect(state.completed).toHaveLength(1);
    expect(state.completed[0]).toMatchObject({ id: 88, conclusion: 'failure' });
    expect(state.completed[0].summary).toContain('dead-lettered');
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
