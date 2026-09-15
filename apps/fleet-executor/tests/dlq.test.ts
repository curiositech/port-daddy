import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import handler from '../src/index.js';
import { DLQ_CHECK_OUTPUT_TITLE, handleDlqJob } from '../src/dlq.js';
import {
  freshState,
  installGitHubFetch,
  memoryD1,
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
  it('can fail an owned merge-group check after queue retries exhaust', async () => {
    const kv = memoryKV();
    seedToken(kv, 42);
    const env = makeEnv({ FLEET_TOKENS: kv,
      DB: memoryD1({ prNumber: 0, headSha: 'QUEUE_SHA', eventType: 'merge_group', action: 'checks_requested' }).db });
    state.existingCheckRuns.push({ id: 515, name: 'Port Daddy Fleet', headSha: 'QUEUE_SHA',
      external_id: 'pd-fleet-run:v1:run:delivery-abc', status: 'in_progress', app: { id: Number(env.GITHUB_APP_ID) } });
    await handleDlqJob(makeJob({ eventType: 'merge_group', action: 'checks_requested', prNumber: null,
      payloadMinimal: { merge_group: { head_sha: 'QUEUE_SHA' } } }), env);
    expect(state.completed[0]).toMatchObject({ id: 515, conclusion: 'failure' });
  });

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
    expect(state.completed[0].summary).toContain('not a verdict on your change');
    const completion = state.records.find(
      record => record.method === 'PATCH' && record.url.endsWith('/check-runs/4242'),
    );
    expect(completion?.body).toMatchObject({
      output: { title: DLQ_CHECK_OUTPUT_TITLE },
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

  it('retries malformed DLQ work instead of acknowledging an unrepairable gate', async () => {
    const job = makeJob({ payloadMinimal: {} });
    await expect(handleDlqJob(job, makeEnv())).rejects.toThrow('unparseable');
    const msg = fakeMessage(job);
    await handler.queue!(fakeDlqBatch([msg]), makeEnv(), {} as ExecutionContext);
    expect(msg.ack).not.toHaveBeenCalled();
    expect(msg.retry).toHaveBeenCalledWith({ delaySeconds: 60 });
    expect(state.completed).toHaveLength(0);
  });

  it('retries rather than acknowledging when the exact DLQ intent is missing', async () => {
    const d1 = memoryD1();
    d1.intents.delete('delivery-abc');
    const msg = fakeMessage(makeJob());

    await handler.queue!(
      fakeDlqBatch([msg]),
      makeEnv({ DB: d1.db }),
      {} as ExecutionContext,
    );

    expect(msg.ack).not.toHaveBeenCalled();
    expect(msg.retry).toHaveBeenCalledWith({ delaySeconds: 60 });
    expect(state.tokenMints).toBe(0);
    expect(state.completed).toHaveLength(0);
  });

  it('retries rather than acknowledging an unverified DLQ ownership write', async () => {
    const d1 = memoryD1();
    d1.omitNextIntentUpdateMeta = true;
    const msg = fakeMessage(makeJob());

    await handler.queue!(
      fakeDlqBatch([msg]),
      makeEnv({ DB: d1.db }),
      {} as ExecutionContext,
    );

    expect(msg.ack).not.toHaveBeenCalled();
    expect(msg.retry).toHaveBeenCalledWith({ delaySeconds: 60 });
    expect(state.tokenMints).toBe(0);
    expect(state.completed).toHaveLength(0);
  });

  it('keeps the intent repairable and retries when GitHub never confirms the failure check', async () => {
    state.existingCheckRuns.push({ id: 88, name: 'Port Daddy Fleet' });
    const kv = memoryKV();
    seedToken(kv, 42);
    const d1 = memoryD1();
    const ghFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (/\/check-runs\/88$/.test(String(input)) && init?.method === 'PATCH') {
          return new Response('cannot update check', { status: 422 });
        }
        return ghFetch(input as RequestInfo, init);
      }) as unknown as typeof fetch,
    );
    const msg = fakeMessage(makeJob());
    await handler.queue!(
      fakeDlqBatch([msg]),
      makeEnv({ FLEET_TOKENS: kv, DB: d1.db }),
      {} as ExecutionContext,
    );

    expect(msg.ack).not.toHaveBeenCalled();
    expect(msg.retry).toHaveBeenCalledWith({ delaySeconds: 60 });
    expect(state.completed).toHaveLength(0);
    expect(d1.intents.get('delivery-abc')?.state).toBe('running');
  });
});
