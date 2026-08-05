/**
 * Port Daddy Relay — GitHub webhook ingress (POST /v1/github/webhook)
 *
 * GitHub is not a harbor card-holder. The HMAC-SHA256 signature over the RAW
 * request body (X-Hub-Signature-256, computed with GITHUB_WEBHOOK_SECRET) is the
 * SOLE authentication gate — equivalent to card verification on /v1/publish.
 * Once HMAC verifies, we take the "internal publish path": write the normalized
 * RelayEvent directly to D1 (events + chain_heads) and fan out via the
 * HarborChannel Durable Object, bypassing card auth.
 *
 * Fail CLOSED: any missing header, signature mismatch, or parse error returns a
 * 4xx and publishes NOTHING.
 *
 * Channel normalization follows the canonical GitHub channel spec. A single
 * delivery fans out to 3 channels (global / action-scoped / repo-scoped):
 *   - github:webhook:<event>
 *   - github:webhook:<event>:<action>        (only when payload.action present)
 *   - github:<owner>/<repo>:<event>          (only when repository.full_name present)
 *
 * Each channel is an independent hash chain keyed by (sender, channel), so we
 * recompute seq / prev_hash / this_hash per channel exactly as handlePublish does.
 */

import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import {
  computeEventHash,
  base64UrlEncode,
  timingSafeEqual,
  toHex,
  hashHex,
  ZERO_HASH,
} from './crypto.js';
import {
  getLastEventSeq,
  insertEvent,
  upsertChainHead,
  appendAudit,
  ChainError,
} from './db.js';
import { harborChannelKey } from './harbor-channel.js';
import type { Env, RelayEvent, ChainHead, RelayError, FleetRunJob } from './types.js';

function err(code: string, detail: string, status = 400): Response {
  const body: RelayError = { error: detail, code };
  return Response.json(body, { status });
}

// Deterministic system sender fingerprint for all GitHub webhook events:
// SHA256("github:webhook"), hex. Lets operators identify the GitHub stream and
// keeps the per-(sender, channel) chain stable across deliveries.
const GITHUB_SENDER = hashHex('github:webhook');

// Only these (event, action) pairs warrant a fleet run. Pull-request events run
// the substantive review; merge-group events propagate that reviewed verdict
// to GitHub's synthetic queue SHA so the required App-owned check cannot vanish
// at the queue boundary.
const FLEET_PR_ACTIONS = new Set(['opened', 'synchronize', 'reopened', 'ready_for_review']);
function shouldEnqueueFleetRun(eventType: string, action: string | null): boolean {
  return (
    (eventType === 'pull_request' && FLEET_PR_ACTIONS.has(action ?? '')) ||
    (eventType === 'merge_group' && action === 'checks_requested')
  );
}

// GitHub Apps fire a flood of workflow_run / check_run / push / *_review events
// on every CI cycle. Persisting and fanning out all of them bloats the D1 event
// table (and every per-channel hash chain) with ambient noise that no subscriber
// reads. We persist + publish + enqueue ONLY the PR-family and required
// merge-group pairs below; every other event is still HMAC-verified and
// acknowledged with 204, but writes nothing to D1 and starts no fleet run.
const PERSIST_EVENT_TYPES = new Set([
  'pull_request:opened',
  'pull_request:closed',
  'pull_request:reopened',
  'pull_request:synchronize',
  'pull_request:ready_for_review',
  'pull_request:labeled',
  'pull_request:unlabeled',
]);
function shouldPersistEvent(eventType: string, action: string | null): boolean {
  return (
    (eventType === 'pull_request' &&
      PERSIST_EVENT_TYPES.has(action ? `${eventType}:${action}` : eventType)) ||
    (eventType === 'merge_group' && action === 'checks_requested')
  );
}

/**
 * Compute the canonical set of channel strings for a normalized webhook.
 * Order matters and matches the channel/normalization spec.
 */
export function channelsForWebhook(
  event: string,
  action: string | null,
  repoFullName: string | null
): string[] {
  const channels: string[] = [`github:webhook:${event}`];
  if (action) channels.push(`github:webhook:${event}:${action}`);
  if (repoFullName) channels.push(`github:${repoFullName}:${event}`);
  return channels;
}

/**
 * Internal publish path for one already-verified GitHub event on one channel.
 * Mirrors the tail of handlePublish (insertEvent → upsertChainHead → DO fanout)
 * but performs NO card auth — HMAC was the gate.
 */
async function publishGithubEventToChannel(
  env: Env,
  channel: string,
  ciphertext: string
): Promise<{ ok: true; seq: number } | { ok: false; response: Response }> {
  const last = await getLastEventSeq(env.DB, GITHUB_SENDER, channel);
  const seq = (last?.seq ?? 0) + 1;
  const prevHash = last?.this_hash ?? ZERO_HASH;
  const iat = Math.floor(Date.now() / 1000);

  const thisHash = computeEventHash({
    prev_hash: prevHash,
    sender: GITHUB_SENDER,
    channel,
    seq,
    iat,
    ciphertext,
  });

  const event: RelayEvent = {
    v: 1,
    sender: GITHUB_SENDER,
    channel,
    seq,
    prev_hash: prevHash,
    this_hash: thisHash,
    iat,
    ciphertext,
    sig: '', // unsigned: GitHub HMAC was the authentication gate
  };

  try {
    await insertEvent(env.DB, event);
  } catch (e) {
    if (e instanceof ChainError) {
      return { ok: false, response: err(e.code, e.message, 409) };
    }
    throw e;
  }

  const head: ChainHead = {
    sender: GITHUB_SENDER,
    channel,
    tip_seq: seq,
    tip_hash: thisHash,
    issued_at: iat,
    signed_head: '', // GitHub events are not relay-signed
  };
  await upsertChainHead(env.DB, head);

  // Fan out via the HarborChannel DO. The DO is keyed on (harborFp, channelPart)
  // by splitting the channel on its first ':' — purely a routing key, no auth.
  const colonIdx = channel.indexOf(':');
  const harborFp = colonIdx >= 0 ? channel.slice(0, colonIdx) : channel;
  const channelPart = colonIdx >= 0 ? channel.slice(colonIdx + 1) : channel;
  const doId = env.HARBOR_CHANNEL.idFromName(harborChannelKey(harborFp, channelPart));
  const stub = env.HARBOR_CHANNEL.get(doId);
  void stub.fetch('http://do/?action=publish', {
    method: 'POST',
    body: JSON.stringify({ event: JSON.stringify(event) }),
  });

  return { ok: true, seq };
}

/**
 * POST /v1/github/webhook
 *
 * 405 — non-POST
 * 401 — missing X-Hub-Signature-256, missing secret, or signature mismatch
 * 400 — missing X-GitHub-Event, malformed body / JSON
 * 409 — chain conflict on a target channel
 * 204 — accepted; either fanned out to all channels (PR-family event) or
 *       verified-and-ignored (non-PR event: audited, nothing persisted)
 */
export async function handleGithubWebhook(request: Request, env: Env): Promise<Response> {
  // 0. Method gate (router only dispatches POST, but fail closed defensively).
  if (request.method !== 'POST') {
    return err('METHOD_NOT_ALLOWED', 'POST required', 405);
  }

  // 1. Required headers.
  const signature = request.headers.get('X-Hub-Signature-256');
  if (!signature) {
    return err('MISSING_SIGNATURE', 'X-Hub-Signature-256 header required', 401);
  }
  const eventType = request.headers.get('X-GitHub-Event');
  if (!eventType) {
    return err('MISSING_EVENT_HEADER', 'X-GitHub-Event header required', 400);
  }

  // 2. Secret must be configured — fail closed if not.
  const secret = env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return err('WEBHOOK_UNCONFIGURED', 'GITHUB_WEBHOOK_SECRET not set', 401);
  }

  // 3. Read RAW body bytes and verify HMAC over those exact bytes.
  const bodyBytes = new Uint8Array(await request.arrayBuffer());
  const enc = new TextEncoder();
  const computed = hmac(sha256, enc.encode(secret), bodyBytes);
  const expectedSig = 'sha256=' + toHex(computed);

  // Constant-time compare via the relay's existing helper.
  if (!timingSafeEqual(signature, expectedSig)) {
    return err('BAD_SIGNATURE', 'Webhook signature verification failed', 401);
  }

  // 4. Parse JSON payload (only AFTER signature verified).
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(new TextDecoder().decode(bodyBytes)) as Record<string, unknown>;
  } catch {
    return err('BAD_JSON', 'Webhook payload is not valid JSON', 400);
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return err('BAD_JSON', 'Webhook payload must be a JSON object', 400);
  }

  // 5. Normalize.
  const deliveryId = request.headers.get('X-GitHub-Delivery') ?? '';
  const action = typeof payload.action === 'string' ? payload.action : null;
  const repository =
    payload.repository && typeof payload.repository === 'object'
      ? (payload.repository as Record<string, unknown>)
      : null;
  const repoFullName =
    repository && typeof repository.full_name === 'string' ? repository.full_name : null;

  const channels = channelsForWebhook(eventType, action, repoFullName);

  // Opaque Base64URL JSON ciphertext — the relay does not encrypt; consumers read
  // the plaintext envelope. Identical bytes published to each channel.
  const ciphertext = base64UrlEncode(
    enc.encode(
      JSON.stringify({
        event_type: eventType,
        delivery_id: deliveryId,
        action,
        repository: repoFullName,
        payload,
      })
    )
  );

  // 6. Ambient-noise gate. Only PR-family events earn a D1 write + fan-out.
  //    Every other event was still HMAC-verified above (security gate is
  //    unchanged); we acknowledge it with 204 and record a single audit row so
  //    the delivery is traceable, but we persist NOTHING and start no fleet run.
  if (!shouldPersistEvent(eventType, action)) {
    await appendAudit(env.DB, {
      action: 'github_webhook_ignored',
      target: repoFullName ?? '',
      detail: `event=${eventType} action=${action ?? ''} delivery=${deliveryId} (not a PR event)`,
    }).catch(() => {});
    return new Response(null, { status: 204 });
  }

  // 7. Publish to every channel via the internal path. Wrap in try/catch so an
  //    infra failure (D1 / Durable Object unreachable, permission error, any
  //    non-ChainError throw from insertEvent / getLastEventSeq / upsertChainHead
  //    / appendAudit) fails CLOSED with a controlled 503 — GitHub then retries
  //    the delivery — rather than crashing into a raw runtime 500.
  try {
    for (const channel of channels) {
      const result = await publishGithubEventToChannel(env, channel, ciphertext);
      if (!result.ok) return result.response;
      await appendAudit(env.DB, {
        action: 'github_webhook_publish',
        target: channel,
        detail: `event=${eventType} delivery=${deliveryId} seq=${result.seq}`,
      });
    }
  } catch {
    return err('INGEST_FAILED', 'relay storage error while publishing webhook', 503);
  }

  // 8. Hand ONE job per delivery to the fleet-executor queue. Guarded: a queue
  //    failure (or the queue not yet provisioned) must NOT fail the webhook —
  //    we've already published to channels. The executor's own retry/DLQ owns
  //    durability from here. installation.id / pull_request.number are read
  //    from the verified payload (no GitHub API call from the relay).
  if ((env.FLEET_RUNS || env.FLEET_GATES) && shouldEnqueueFleetRun(eventType, action)) {
    const installation =
      payload.installation && typeof payload.installation === 'object'
        ? (payload.installation as Record<string, unknown>)
        : null;
    const pull =
      payload.pull_request && typeof payload.pull_request === 'object'
        ? (payload.pull_request as Record<string, unknown>)
        : null;
    const mergeGroup =
      payload.merge_group && typeof payload.merge_group === 'object'
        ? (payload.merge_group as Record<string, unknown>)
        : null;
    const job: FleetRunJob = {
      deliveryId,
      eventType,
      action,
      repoFullName,
      installationId:
        installation && typeof installation.id === 'number' ? installation.id : null,
      // merge_group refs are not an identity contract. The executor resolves
      // exact membership from base_ref + the synthetic head SHA instead.
      prNumber: pull && typeof pull.number === 'number' ? pull.number : null,
      payloadMinimal: {
        sender: (payload.sender as Record<string, unknown>) ?? undefined,
        repository: (payload.repository as Record<string, unknown>) ?? undefined,
        pull_request: pull ?? undefined,
        merge_group: mergeGroup ?? undefined,
        push: (payload.push as Record<string, unknown>) ?? undefined,
      },
    };
    const queue = eventType === 'merge_group'
      ? (env.FLEET_GATES ?? env.FLEET_RUNS)
      : env.FLEET_RUNS;
    if (!queue) {
      await appendAudit(env.DB, {
        action: 'fleet_run_enqueue_failed',
        target: repoFullName ?? '',
        detail: `event=${eventType} delivery=${deliveryId} queue=unbound`,
      }).catch(() => {});
      return new Response(null, { status: 204 });
    }
    try {
      await queue.send(job);
      await appendAudit(env.DB, {
        action: 'fleet_run_enqueued',
        target: repoFullName ?? '',
        detail: `event=${eventType} delivery=${deliveryId} queue=${eventType === 'merge_group' && env.FLEET_GATES ? 'fleet-gates' : 'fleet-runs'}`,
      });
    } catch {
      // Best-effort: record and move on. The webhook still succeeds (204);
      // a missed enqueue means the executor simply doesn't run for this
      // delivery — the required check stays absent (PR blocked), never green.
      await appendAudit(env.DB, {
        action: 'fleet_run_enqueue_failed',
        target: repoFullName ?? '',
        detail: `event=${eventType} delivery=${deliveryId}`,
      }).catch(() => {});
    }
  }

  return new Response(null, { status: 204 });
}
