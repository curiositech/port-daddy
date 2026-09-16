import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { handleGithubWebhook } from '../src/github-webhook.js';
import { handleFleetControlRequeue } from '../src/fleet-control-requeue.js';
import { handleFleetActivity, handleFleetHealth } from '../src/fleet-observability.js';
import { fleetControlRequest, mutateFleetControl } from '../src/fleet-pause-control.js';
import { setFleetPaused } from '../src/db.js';
import { getFleetRunProjectionWithSteps, getFleetRunIntent, reserveFleetRunIntent } from '../src/fleet-run-intents.js';
import { renderFleetRunReceiptPage } from '../src/fleet-run-page.js';
import { fleetLifecycleDb } from './fleet-lifecycle-db.js';
import { memoryFleetControl } from './fleet-control-fixture.js';
import consumer from '../../fleet-executor/src/index.js';
import { freshState, installGitHubFetch, makeJob, makeEnv, memoryKV, aiStub } from '../../fleet-executor/tests/harness.js';
import type { Env } from '../src/types.js';
import type { FleetRunJob } from '../../fleet-executor/src/env.js';

// Import the real consumer without starting/resolving a sandbox runtime.
vi.mock('@cloudflare/sandbox', () => ({ Sandbox: class {}, getSandbox: () => { throw new Error('Sandbox must not run in control tests'); } }));

const OPERATOR = 'test-operator-secret-with-at-least-32-bytes';
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const { db, sqlite } = fleetLifecycleDb();
  const controlProjection = memoryKV();
  const control = memoryFleetControl(
    { paused: false, revision: 2, pausedAt: 0 },
    controlProjection,
  );
  const queued: FleetRunJob[] = [];
  const job = makeJob();
  const state = freshState();
  state.files.set('main:pd-fleet.yml', [
    'fleet:',
    '  agents:',
    '    code-reviewer:',
    '      trigger: pull_request:opened',
    '      blocking: true',
    '      participation: { default: required, rules: [] }',
    '      prompt: review',
    '',
  ].join('\n'));
  installGitHubFetch(state);
  const tokens = memoryKV();
  void tokens.put('github_inst_42', JSON.stringify({ token: 'seeded-tok', expiresAt: Date.now() + 3600000 }));
  const ai = aiStub({ perShip: { 'code-reviewer': 'FLEET-VERDICT: PASS' } });
  const executor = makeEnv({ DB: db, FLEET_TOKENS: tokens, CONTROL_KV: controlProjection, AI: ai.ai,
    FLEET_CONTROL: { admit: (expectedRevision, runId) => fleetControlRequest(control.namespace, '/admit', { expectedRevision, runId }) } });
  const env = {
    DB: db, KV: controlProjection, FLEET_CONTROL: control.namespace,
    FLEET_RUNS: { send: async (message: FleetRunJob) => { queued.push(message); } },
    RELAY_OPERATOR_TOKEN: OPERATOR, GITHUB_WEBHOOK_SECRET: 'test-webhook-secret',
    RELAY_ED25519_PRIVATE_KEY_HEX: '00'.repeat(32),
    HARBOR_CHANNEL: { idFromName: (name: string) => name, get: () => ({ fetch: async () => new Response('{}') }) },
  } as unknown as Env;
  function operatorRequest(body?: unknown, token = OPERATOR) {
    return new Request('https://relay.test/v1/fleet/control-requeues/' + job.deliveryId, {
      method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }
  async function webhook(deliveryId = job.deliveryId) {
    const body = JSON.stringify({ action: 'opened', repository: { full_name: job.repoFullName },
      installation: { id: 42 }, pull_request: job.payloadMinimal.pull_request });
    return handleGithubWebhook(new Request('https://relay.test/v1/github/webhook', {
      method: 'POST', body, headers: { 'X-Github-Event': 'pull_request', 'X-Github-Delivery': deliveryId,
        'X-Hub-Signature-256': 'sha256=' + createHmac('sha256', env.GITHUB_WEBHOOK_SECRET).update(body).digest('hex') },
    }), env);
  }
  async function consume(message = queued.shift()!) {
    const delivery = { id: 'message', timestamp: new Date(), body: message, attempts: 1, ack: vi.fn(), retry: vi.fn() };
    await consumer.queue({ queue: 'fleet-runs', messages: [delivery] } as unknown as MessageBatch<FleetRunJob>, executor,
      { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext);
    return delivery;
  }
  async function suspend() {
    expect((await webhook()).status).toBe(204);
    // Bind the original run, then interrupt the control read without a pause epoch change.
    await fleetControlRequest(control.namespace, '/admit', { runId: `${job.repoFullName}/run:${job.deliveryId}` });
    const available = executor.FLEET_CONTROL;
    executor.FLEET_CONTROL = undefined;
    const delivery = await consume();
    executor.FLEET_CONTROL = available;
    expect(delivery.ack).toHaveBeenCalledOnce();
    expect(delivery.retry).not.toHaveBeenCalled();
    expect((await getFleetRunIntent(db, job.deliveryId))?.state).toBe('waiting_for_control');
    expect(ai.calls).toHaveLength(0);
  }
  const authorize = (requestId = 'resume-one', expectedRevision = 2) =>
    handleFleetControlRequeue(operatorRequest({ requestId, expectedRevision }), env, job.deliveryId);
  return { db, sqlite, control, env, executor, queued, job, state, ai, operatorRequest, webhook, consume, suspend, authorize };
}

describe('operator-authorized control recovery through actual Relay admission', () => {
  it('admits a merge-group through the real ledger before the consumer creates its blocking gate', async () => {
    const f = setup();
    f.executor.AI = undefined;
    const body = JSON.stringify({
      action: 'checks_requested',
      repository: { full_name: f.job.repoFullName },
      installation: { id: 42 },
      merge_group: { head_sha: 'QUEUE_SHA' },
    });
    const response = await handleGithubWebhook(new Request('https://relay.test/v1/github/webhook', {
      method: 'POST', body, headers: {
        'X-Github-Event': 'merge_group', 'X-Github-Delivery': 'merge-group-e2e',
        'X-Hub-Signature-256': 'sha256=' + createHmac('sha256', f.env.GITHUB_WEBHOOK_SECRET).update(body).digest('hex'),
      },
    }), f.env);
    expect(response.status).toBe(204);
    expect(f.queued).toHaveLength(1);
    // A different merge-queue head is an independent required-check scope,
    // not a replacement generation for this queue commit.
    await reserveFleetRunIntent(f.db, {
      deliveryId: 'merge-group-other-head', repoFullName: f.job.repoFullName!, prNumber: 0,
      prUrl: `https://github.com/${f.job.repoFullName}/actions`, headSha: 'OTHER_QUEUE_SHA',
      eventType: 'merge_group', action: 'checks_requested', now: 20,
    });
    const delivery = await f.consume();
    expect(delivery.ack).toHaveBeenCalledOnce();
    expect(delivery.retry).not.toHaveBeenCalled();
    expect(f.ai.calls).toHaveLength(0);
    expect(await getFleetRunIntent(f.db, 'merge-group-e2e')).toMatchObject({
      repo_full_name: f.job.repoFullName, pr_number: 0, head_sha: 'QUEUE_SHA',
      event_type: 'merge_group', state: 'failure',
    });
    expect(f.state.completed[0]).toMatchObject({ conclusion: 'failure' });
  });

  it('rejects a queue body that reuses an admitted delivery id for different coordinates', async () => {
    const f = setup();
    expect((await f.webhook()).status).toBe(204);
    f.queued[0] = { ...f.queued[0], repoFullName: 'attacker/different-repo' };
    const delivery = await f.consume();
    expect(delivery.ack).not.toHaveBeenCalled();
    expect(delivery.retry).toHaveBeenCalledOnce();
    expect(f.ai.calls).toHaveLength(0);
    expect(f.state.checkRunsCreated).toBe(0);
    expect(await getFleetRunIntent(f.db, f.job.deliveryId)).toMatchObject({ state: 'queued' });
    expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM fleet_runs').get()).toEqual({ n: 0 });
  });

  it('does not let an older queued generation run when a newer active intent exists', async () => {
    const f = setup();
    expect((await f.webhook()).status).toBe(204);
    await reserveFleetRunIntent(f.db, {
      deliveryId: 'delivery-newer', repoFullName: f.job.repoFullName!, prNumber: f.job.prNumber!,
      prUrl: `https://github.com/${f.job.repoFullName}/pull/${f.job.prNumber}`,
      headSha: 'N'.repeat(40), eventType: 'pull_request', action: 'synchronize', now: 20,
    });
    const delivery = await f.consume();
    expect(delivery.ack).toHaveBeenCalledOnce();
    expect(delivery.retry).not.toHaveBeenCalled();
    expect(f.ai.calls).toHaveLength(0);
    expect(f.state.checkRunsCreated).toBe(0);
  });

  it('keeps an older PR generation fenced after the newer generation finishes', async () => {
    const f = setup();
    expect((await f.webhook()).status).toBe(204);
    await reserveFleetRunIntent(f.db, {
      deliveryId: 'delivery-newer-terminal', repoFullName: f.job.repoFullName!, prNumber: f.job.prNumber!,
      prUrl: `https://github.com/${f.job.repoFullName}/pull/${f.job.prNumber}`,
      headSha: 'T'.repeat(40), eventType: 'pull_request', action: 'synchronize', now: 20,
    });
    f.sqlite.prepare("UPDATE fleet_run_intents SET state = 'success', finished_at = 21 WHERE delivery_id = ?")
      .run('delivery-newer-terminal');
    const delivery = await f.consume();
    expect(delivery.ack).toHaveBeenCalledOnce();
    expect(delivery.retry).not.toHaveBeenCalled();
    expect(f.ai.calls).toHaveLength(0);
    expect(f.state.checkRunsCreated).toBe(0);
    expect(await getFleetRunIntent(f.db, f.job.deliveryId)).toMatchObject({ state: 'queued' });
  });

  it('preserves existing generations and retry evidence in the additive migration', () => {
    const { sqlite } = fleetLifecycleDb(database => {
      const insert = database.prepare(`INSERT INTO fleet_run_intents
        (delivery_id, repo_full_name, pr_number, pr_url, head_sha, event_type, generation, state, last_error)
        VALUES (?, 'a/b', 1, 'https://github.com/a/b/pull/1', 'sha', 'pull_request', ?, ?, ?)`);
      insert.run('suspended', 1, 'retrying', 'Fleet suspended: binding-missing; awaiting explicit redelivery');
      insert.run('provider', 2, 'retrying', 'provider 503');
      insert.run('review', 3, 'failure', 'model verdict');
    });
    expect(sqlite.prepare('SELECT delivery_id, generation, state, control_waiting_at, control_wait_count FROM fleet_run_intents ORDER BY generation').all())
      .toEqual([
        { delivery_id: 'suspended', generation: 1, state: 'retrying', control_waiting_at: null, control_wait_count: 0 },
        { delivery_id: 'provider', generation: 2, state: 'retrying', control_waiting_at: null, control_wait_count: 0 },
        { delivery_id: 'review', generation: 3, state: 'failure', control_waiting_at: null, control_wait_count: 0 },
      ]);
    expect(() => sqlite.prepare("UPDATE fleet_run_intents SET state = 'invented'").run()).toThrow();
    sqlite.close();
  });

  it('requires explicit consent, consumes it once, and resumes an acknowledged suspension', async () => {
    const f = setup();
    await f.suspend();
    expect(f.sqlite.prepare('SELECT state, control_waiting_at FROM fleet_run_intents WHERE delivery_id = ?')
      .get(f.job.deliveryId)).toMatchObject({ state: 'cancelled' });
    await f.webhook();
    expect(f.queued).toHaveLength(0);
    const unauthorized = await handleFleetControlRequeue(f.operatorRequest({ requestId: 'bad', expectedRevision: 2 }, 'wrong'), f.env, f.job.deliveryId);
    expect(unauthorized.status).not.toBe(200);
    expect((await f.authorize()).status).toBe(200);
    expect((await f.authorize()).status).toBe(200);
    expect(f.queued).toHaveLength(0); // granting consent never spends/queues
    await f.webhook();
    await f.webhook();
    expect(f.queued).toHaveLength(1);
    const resumed = await f.consume();
    expect(resumed.retry).not.toHaveBeenCalled();
    expect(resumed.ack).toHaveBeenCalledOnce();
    expect(f.ai.calls.length).toBeGreaterThan(0);
    expect(f.state.completed.at(-1)?.conclusion).toBe('success');
    await f.authorize();
    await f.webhook();
    expect(f.queued).toHaveLength(0);
    f.sqlite.close();
  });

  it('keeps legacy retrying suspension rows logically held until explicit consent', async () => {
    const f = setup();
    expect((await f.webhook()).status).toBe(204);
    f.sqlite.prepare(`UPDATE fleet_run_intents
      SET state = 'retrying', control_waiting_at = NULL,
          last_error = 'Fleet suspended: legacy hold', control_wait_count = 1
      WHERE delivery_id = ?`).run(f.job.deliveryId);
    f.queued.length = 0;
    expect((await getFleetRunIntent(f.db, f.job.deliveryId))?.state).toBe('waiting_for_control');
    const health = await (await handleFleetHealth(f.operatorRequest(), f.env)).json() as Record<string, unknown>;
    expect(health).toMatchObject({ waitingForControl: 1, retrying: 0, queueDepthEstimate: 0 });
    await f.webhook();
    expect(f.queued).toHaveLength(0);
    expect((await f.authorize('legacy-resume')).status).toBe(200);
    await f.webhook();
    expect(f.queued).toHaveLength(1);
    f.sqlite.close();
  });

  it('lets a durably queued newer generation supersede and clear an older control hold', async () => {
    const f = setup();
    await f.suspend();
    expect((await f.webhook('replacement-delivery')).status).toBe(204);
    expect(await getFleetRunIntent(f.db, f.job.deliveryId)).toMatchObject({
      state: 'superseded', control_waiting_at: null, superseded_by: 'replacement-delivery',
    });
    const before = f.queued.length;
    expect((await f.webhook()).status).toBe(204);
    expect(f.queued).toHaveLength(before);
    f.sqlite.close();
  });

  it('refuses to revive rollback residue after a newer generation already owns the PR', async () => {
    const f = setup();
    await f.suspend();
    f.sqlite.prepare(`INSERT INTO fleet_run_intents
      (delivery_id, repo_full_name, pr_number, pr_url, head_sha, event_type, action,
       generation, state, queued_at, last_progress_at, finished_at)
      VALUES ('newer-after-rollback', ?, ?, ?, 'NEWER', 'pull_request', 'synchronize',
       2, 'success', 20, 21, 21)`)
      .run(f.job.repoFullName, f.job.prNumber,
        `https://github.com/${f.job.repoFullName}/pull/${f.job.prNumber}`);
    const response = await f.authorize('stale-hold');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'REQUEUE_CONFLICT' });
    f.sqlite.close();
  });

  it('keeps activity, health and rendered receipts on the same non-provider-retry state', async () => {
    const f = setup();
    await f.suspend();
    const health = await (await handleFleetHealth(f.operatorRequest(), f.env)).json() as Record<string, unknown>;
    expect(health).toMatchObject({ waitingForControl: 1, retrying: 0, queueDepthEstimate: 0 });
    const activity = await (await handleFleetActivity(f.operatorRequest(), f.env)).json() as { runs: Record<string, unknown>[] };
    expect(activity.runs[0]).toMatchObject({ conclusion: 'waiting_for_control', state: 'waiting_for_control', expectedFinishAt: null });
    const found = (await getFleetRunProjectionWithSteps(f.db, 'run:' + f.job.deliveryId))!;
    for (const steps of [found.steps, []]) {
      const html = renderFleetRunReceiptPage(found.run, steps);
      expect(html).toContain('no automatic retry is scheduled');
      expect(html).not.toContain('Provider retry scheduled');
    }
    // An older binary's failure header must not override the explicit hold.
    f.sqlite.prepare("UPDATE fleet_runs SET conclusion = 'failure'").run();
    expect((await getFleetRunProjectionWithSteps(f.db, found.run.id))!.run.logical_state).toBe('waiting_for_control');
    f.sqlite.close();
  });

  it('permits only one conditional admission winner for simultaneous authorized duplicates', async () => {
    const f = setup();
    await f.suspend();
    await f.authorize();
    const input = { deliveryId: f.job.deliveryId, repoFullName: f.job.repoFullName!, prNumber: 7,
      prUrl: 'https://github.com/erichowens/port-daddy/pull/7', headSha: 'HEADSHA', eventType: 'pull_request',
      action: 'opened', now: 1, authorizeReplay: async (revision: number) => {
        const control = await fleetControlRequest(f.control.namespace, '/admit', {
          expectedRevision: revision, runId: `${f.job.repoFullName}/run:${f.job.deliveryId}`,
        });
        return control.status === 'unpaused' && control.revision === revision;
      } };
    const results = await Promise.all([reserveFleetRunIntent(f.db, input), reserveFleetRunIntent(f.db, input)]);
    expect(results.filter(result => result.shouldEnqueue)).toHaveLength(1);
    f.sqlite.close();
  });

  it('fences a permit across pause/resume and requires a new delivery identity', async () => {
    const f = setup();
    await f.suspend();
    expect((await f.authorize()).status).toBe(200);
    await setFleetPaused(f.env, true);
    await f.webhook();
    expect(f.queued).toHaveLength(0);
    await setFleetPaused(f.env, false, { expectedRevision: 3, requestId: 'resume-global' });
    await f.webhook();
    expect(f.queued).toHaveLength(0);
    expect((await f.authorize('resume-one', 2)).status).toBe(409);
    expect((await f.authorize('resume-new', 4)).status).toBe(409);
    await f.webhook('new-delivery');
    expect(f.queued).toHaveLength(1);
    expect((await f.consume()).ack).toHaveBeenCalledOnce();
    expect(f.state.completed.at(-1)?.conclusion).toBe('success');
    f.sqlite.close();
  });

  it('does not reuse a prior request or permit for a later suspension', async () => {
    const f = setup();
    await f.suspend();
    await f.authorize();
    await f.webhook();
    f.executor.FLEET_CONTROL = undefined;
    await f.consume();
    expect((await f.authorize()).status).toBe(409);
    await f.webhook();
    expect(f.queued).toHaveLength(0);
    expect((await f.authorize('second-suspension')).status).toBe(200);
    await f.webhook();
    expect(f.queued).toHaveLength(1);
    f.sqlite.close();
  });

  it('fails closed if admission storage is unavailable', async () => {
    const f = setup();
    f.sqlite.exec('DROP TABLE fleet_run_intents');
    await f.webhook();
    expect(f.queued).toHaveLength(0);
    f.sqlite.close();
  });

  it('keeps queue-send failure retryable only at its authorized control epoch', async () => {
    const f = setup();
    await f.suspend();
    await f.authorize();
    const queue = f.env.FLEET_RUNS!;
    f.env.FLEET_RUNS = { send: async () => { throw new Error('queue unavailable'); } } as unknown as Queue<FleetRunJob>;
    await f.webhook();
    expect((await getFleetRunIntent(f.db, f.job.deliveryId))?.state).toBe('enqueue_failed');
    await mutateFleetControl(f.control.namespace, true);
    f.env.FLEET_RUNS = queue;
    await f.webhook();
    expect(f.queued).toHaveLength(0);
    f.sqlite.close();
  });

  it('does not spend when a pause lands after authorized enqueue but before consumption', async () => {
    const f = setup();
    await f.suspend();
    await f.authorize();
    await f.webhook();
    expect(f.queued).toHaveLength(1);
    await mutateFleetControl(f.control.namespace, true);
    const message = await f.consume();
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
    expect(f.ai.calls).toHaveLength(0);
    expect((await getFleetRunIntent(f.db, f.job.deliveryId))?.state).toBe('waiting_for_control');
    f.sqlite.close();
  });

  it('preserves a hold without a transcript header and rejects missing resume preconditions', async () => {
    const f = setup();
    await f.suspend();
    f.sqlite.exec('DELETE FROM fleet_run_steps; DELETE FROM fleet_runs');
    const found = (await getFleetRunProjectionWithSteps(f.db, 'intent:' + f.job.deliveryId))!;
    expect(found.run.has_transcript).toBe(false);
    expect(renderFleetRunReceiptPage(found.run, [])).toContain('no automatic retry is scheduled');
    const response = await handleFleetControlRequeue(f.operatorRequest({ requestId: 'missing-revision' }), f.env, f.job.deliveryId);
    expect(response.status).toBe(400);
    await f.webhook();
    expect(f.queued).toHaveLength(0);
    f.sqlite.close();
  });
});
