import { fleetOperatorOnly } from './fleet-access.js';
import { fleetControlRequest } from './fleet-pause-control.js';
import { getFleetRunIntent } from './fleet-run-intents.js';
import { FLEET_WAITING_CONTROL } from '../../shared/fleet-suspension.js';
import type { Env } from './types.js';

/** Grant one signed webhook redelivery, not an automatic retry or a new epoch. */
export async function handleFleetControlRequeue(request: Request, env: Env, deliveryId: string): Promise<Response> {
  const authority = await fleetOperatorOnly(request, env);
  if (authority instanceof Response) return authority;
  let body: { requestId?: unknown; expectedRevision?: unknown };
  try { body = await request.json(); } catch { return Response.json({ code: 'BAD_JSON' }, { status: 400 }); }
  if (!body || typeof body.requestId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(body.requestId)
      || !Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 1
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,160}$/.test(deliveryId)) {
    return Response.json({ code: 'PRECONDITION_REQUIRED' }, { status: 400 });
  }
  const revision = Number(body.expectedRevision);
  const issuer = authority.kind === 'account' ? `account:${authority.userId}` : 'break-glass';
  try {
    const intent = await getFleetRunIntent(env.DB, deliveryId);
    if (!intent) return Response.json({ code: 'NOT_FOUND' }, { status: 404 });
    const control = await fleetControlRequest(env.FLEET_CONTROL, '/admit', {
      expectedRevision: revision, runId: `${intent.repo_full_name}/run:${deliveryId}`,
    });
    if (control.status !== 'unpaused' || control.revision !== revision) {
      return Response.json({ code: 'CONTROL_BLOCKED', error: 'Control is unavailable, paused, or this run belongs to an earlier revision. A changed revision requires a new review delivery.' }, { status: 409 });
    }
    const previous = await env.DB.prepare('SELECT * FROM fleet_control_requeues WHERE request_id = ?')
      .bind(body.requestId).first<{ delivery_id: string; control_wait_count: number; revision: number; issuer: string }>();
    if (previous) {
      const same = previous.delivery_id === deliveryId && previous.revision === revision
        && previous.issuer === issuer && previous.control_wait_count === intent.control_wait_count;
      return Response.json({ code: same ? 'ALREADY_AUTHORIZED' : 'REQUEST_SUPERSEDED', enqueued: false }, { status: same ? 200 : 409 });
    }
    if (intent.state !== FLEET_WAITING_CONTROL) return Response.json({ code: 'NOT_WAITING_FOR_CONTROL' }, { status: 409 });
    const result = await env.DB.prepare(
      `INSERT OR IGNORE INTO fleet_control_requeues
       (request_id, delivery_id, control_wait_count, revision, issuer, created_at)
       SELECT ?, delivery_id, control_wait_count, ?, ?, ? FROM fleet_run_intents
       WHERE delivery_id = ?
         AND ((state = 'cancelled' AND control_waiting_at IS NOT NULL)
           OR (state = 'retrying' AND control_waiting_at IS NULL
             AND last_error LIKE 'Fleet suspended:%'))
         AND control_wait_count = ?
         AND NOT EXISTS (
           SELECT 1 FROM fleet_run_intents AS newer
           WHERE newer.repo_full_name = fleet_run_intents.repo_full_name
             AND newer.pr_number = fleet_run_intents.pr_number
             AND newer.generation > fleet_run_intents.generation
             AND (
               fleet_run_intents.event_type <> 'merge_group'
               OR (newer.event_type = 'merge_group'
                 AND newer.head_sha = fleet_run_intents.head_sha)
             )
             AND newer.state NOT IN ('enqueue_failed','superseded')
         )`,
    ).bind(body.requestId, revision, issuer, Math.floor(Date.now() / 1000), deliveryId, intent.control_wait_count).run();
    if (result.meta?.changes !== 1) return Response.json({ code: 'REQUEUE_CONFLICT' }, { status: 409 });
    return Response.json({ code: 'REDELIVERY_AUTHORIZED', enqueued: false,
      nextAction: 'Redeliver this original GitHub webhook. The signed delivery will recheck the control revision before enqueueing. No automatic retry is scheduled.' });
  } catch {
    return Response.json({ code: 'CONTROL_UNAVAILABLE', error: 'Redelivery was not acknowledged; no work was queued.' }, { status: 503 });
  }
}
