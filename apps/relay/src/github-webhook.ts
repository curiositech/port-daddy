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
 * N1 (ADR-0123 §6): the transit body is a labeled relay_readable envelope —
 * classification, reason, and a relay-key signature — never bare
 * plaintext-as-base64 in the ciphertext slot.
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
  timingSafeEqual,
  toHex,
  hashHex,
  ZERO_HASH,
} from './crypto.js';
import {
  encodeTransitEnvelope,
  signEnvelope,
  ENVELOPE_SCHEMA_ID,
} from './envelope.js';
import type { RelayReadableEnvelope } from './envelope.js';
import { maybeWakeSteward } from './steward-wake.js';
import {
  getLastEventSeq,
  insertEvent,
  upsertChainHead,
  appendAudit,
  ChainError,
} from './db.js';
import { harborChannelKey } from './harbor-channel.js';
import {
  markFleetRunIntentEnqueued,
  markFleetRunIntentEnqueueFailed,
  reserveFleetRunIntent,
  type FleetIntentReservation,
} from './fleet-run-intents.js';
import type { Env, RelayEvent, ChainHead, RelayError, FleetRunJob } from './types.js';

/**
 * Build one `RelayError` response.
 *
 * PURPOSE: every refusal in this file goes through here so the shape stays
 * uniform — a machine-readable `code` a caller can branch on plus a human
 * `detail` — and no path can drift into returning a bare string or a raw
 * status. The codes are also what the webhook tests assert against, which only
 * works while there is exactly one place that produces them.
 *
 * @param code - Stable machine-readable identifier, e.g. `BAD_SIGNATURE`.
 * @param detail - Human-readable explanation for the operator reading logs.
 * @param status - HTTP status; defaults to 400.
 * @returns A JSON response carrying the error body.
 */
function err(code: string, detail: string, status = 400): Response {
  const body: RelayError = { error: detail, code };
  return Response.json(body, { status });
}

// Deterministic system sender fingerprint for all GitHub webhook events:
// SHA256("github:webhook"), hex. Lets operators identify the GitHub stream and
// keeps the per-(sender, channel) chain stable across deliveries.
const GITHUB_SENDER = hashHex('github:webhook');

// The honest label ADR-0123 §6 (N1) requires on every relay-readable stream:
// this event class transits unencrypted because GitHub already serves the same
// bytes to any authorized watcher of the repo — the relay adds no exposure.
export const GITHUB_RELAY_READABLE_REASON =
  'github webhook relay: payload is GitHub-public data';

// Only these (event, action) pairs warrant a fleet run. GitHub Apps fire a
// flood of workflow_run / check_run / push events on every CI cycle; the
// executor only reviews pull_request changes, so we never enqueue the rest.
// (The full event stream is still PUBLISHED to channels for other subscribers.)
const FLEET_PR_ACTIONS = new Set(['opened', 'synchronize', 'reopened', 'ready_for_review', 'edited']);
/**
 * Merge-queue actions that need a `Port Daddy Fleet` check on the queue branch.
 *
 * GitHub fires `merge_group.checks_requested` when it builds the temporary
 * `gh-readonly-queue/...` branch and waits for every REQUIRED context to report
 * on it. `Port Daddy Fleet` is one of those contexts on ruleset 17604542.
 */
const FLEET_MERGE_GROUP_ACTIONS = new Set(['checks_requested']);

/**
 * Whether this delivery should produce a fleet run.
 *
 * THE DEADLOCK THIS FIXES. Until now this returned true ONLY for
 * `pull_request`, so a `merge_group` delivery was dropped on the floor: no job,
 * no run, no check. But `Port Daddy Fleet` is a REQUIRED context on the merge
 * queue, and GitHub waits for required contexts on the queue branch before it
 * will merge anything. So the queue asked for a check that no code path could
 * ever create and waited forever — the head entry sat `AWAITING_CHECKS` for
 * hours, and because a merge queue is strictly ordered, every PR behind it was
 * frozen too. Observed 2026-08-10: `main` had not advanced since 2026-08-06
 * while PRs kept going green, 64 of 192 open PRs stacked up behind it, and the
 * queue branches showed every Actions check present and passing with
 * `Port Daddy Fleet` simply absent.
 *
 * A check that cannot be produced is not a gate, it is a deadlock.
 *
 * The design rule that falls out of it: every REQUIRED context must have an
 * enumerable producer, and this function is that enumeration for the fleet's.
 *
 * @param eventType - The `X-GitHub-Event` header value.
 * @param action - The payload's `action`, or null for actionless events.
 * @returns True when this delivery should produce exactly one fleet run.
 */
function shouldEnqueueFleetRun(eventType: string, action: string | null): boolean {
  if (eventType === 'pull_request') return FLEET_PR_ACTIONS.has(action ?? '');
  if (eventType === 'merge_group') return FLEET_MERGE_GROUP_ACTIONS.has(action ?? '');
  return false;
}

// GitHub Apps fire a flood of workflow_run / check_run / push / *_review events
// on every CI cycle. Persisting and fanning out all of them bloats the D1 event
// table (and every per-channel hash chain) with ambient noise that no subscriber
// reads. We persist + publish + enqueue ONLY the PR-family (event, action) pairs
// below; every other event is still HMAC-verified (security gate unchanged) and
// acknowledged with 204, but writes nothing to D1 and starts no fleet run.
const PERSIST_EVENT_TYPES = new Set([
  'pull_request:opened',
  'pull_request:closed',
  'pull_request:reopened',
  'pull_request:synchronize',
  'pull_request:edited',
  'pull_request:ready_for_review',
  'pull_request:labeled',
  'pull_request:unlabeled',
]);
/**
 * Does this delivery earn a D1 event row and a channel fan-out?
 *
 * RATIONALE — this gate governs *storage*, nothing else. It is deliberately
 * narrower than the set of events the relay acts on: `merge_group` and
 * `check_suite` are both "no" here yet still trigger a fleet run and a Steward
 * wake respectively, because neither needs a durable event row to do its job.
 * Conflating the two decisions is exactly how the merge queue once deadlocked
 * — the noise gate silently withheld the run along with the row.
 *
 * @param eventType - The `X-GitHub-Event` header value.
 * @param action - The payload's `action`, or null for actionless events.
 * @returns True when the event should be persisted and fanned out.
 */
function shouldPersistEvent(eventType: string, action: string | null): boolean {
  return (
    eventType === 'pull_request' &&
    PERSIST_EVENT_TYPES.has(action ? `${eventType}:${action}` : eventType)
  );
}

/**
 * Compute the canonical set of channel strings for a normalized webhook.
 *
 * DESIGN — BROADEST FIRST, THEN NARROWER. Order matters and matches the
 * channel/normalization spec: a subscriber choosing `github:webhook:push`
 * wants everything, one choosing `github:acme/widgets:push` wants a single
 * repo, and emitting all three lets each pick its own granularity without the
 * relay guessing. Absent facts drop their channel rather than becoming an
 * empty segment, so a subscription string never silently matches nothing.
 *
 * @param event - The `X-GitHub-Event` header value.
 * @param action - The payload's `action`, or null for actionless events.
 * @param repoFullName - `owner/repo`, or null when the payload names no repo.
 * @returns Channel strings, broadest first.
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
 *
 * DESIGN — WHY THE BYTES DIFFER PER CHANNEL. The transit body is a labeled
 * relay_readable envelope (ADR-0123 §6, N1), rebuilt for each channel because
 * `seq` and `channel` are part of the signed binding: one envelope reused
 * across channels would carry another channel's binding and fail verification
 * downstream. The envelope serializes into the frame's `ciphertext` slot, so
 * chain hashing and `chain_verify.py` are unchanged by any of this.
 *
 * @param env - Relay environment (D1 and the HarborChannel namespace).
 * @param channel - The single channel to publish this event on.
 * @param webhookPayload - The normalized, already-verified GitHub event.
 * @returns `{ok: true, seq}` on success, or `{ok: false, response}` carrying
 *   the error response the caller should return unchanged.
 */
async function publishGithubEventToChannel(
  env: Env,
  channel: string,
  payload: Record<string, unknown>
): Promise<{ ok: true; seq: number } | { ok: false; response: Response }> {
  const last = await getLastEventSeq(env.DB, GITHUB_SENDER, channel);
  const seq = (last?.seq ?? 0) + 1;
  const prevHash = last?.this_hash ?? ZERO_HASH;
  const iat = Math.floor(Date.now() / 1000);

  const colon = channel.indexOf(':');
  const unsigned: Omit<RelayReadableEnvelope, 'sig'> = {
    schema: ENVELOPE_SCHEMA_ID,
    v: 1,
    classification: 'relay_readable',
    harbor: colon >= 0 ? channel.slice(0, colon) : channel,
    channel,
    sender: GITHUB_SENDER,
    seq,
    iat,
    payload,
    reason: GITHUB_RELAY_READABLE_REASON,
  };
  // Envelope signature: the relay's existing Ed25519 key (the one that already
  // signs ServerHello and chain heads). It attests "the relay ingested this
  // from an HMAC-verified GitHub delivery" — relay ingest attestation, not
  // sender authorship (GITHUB_SENDER is a fingerprint with no keypair).
  // Per-account pd-vault key ids replace key management here when the vault
  // lands; the alg and binding construction stay.
  const envelope: RelayReadableEnvelope = {
    ...unsigned,
    sig: await signEnvelope(env.RELAY_ED25519_PRIVATE_KEY_HEX, unsigned),
  };
  // Egress gate (N1): encodeTransitEnvelope asserts classification, so an
  // unlabeled body cannot leave this producer.
  const ciphertext = encodeTransitEnvelope(envelope);

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
    // Frame-level sig stays empty: it is specified as the SENDER's Ed25519
    // signature over this_hash, and GITHUB_SENDER holds no key. Authenticity
    // travels on the envelope sig above; GitHub HMAC was the ingress gate.
    sig: '',
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
 * Enqueue ONE fleet run for this delivery, when the event warrants one.
 *
 * PURPOSE, from the incident that produced it: extracted so it can be reached
 * from BOTH exits of the handler. The
 * ambient-noise gate (step 6) returns 204 early for every non-PR event, which
 * silently included `merge_group` — so the merge queue's required
 * `Port Daddy Fleet` context was never produced and the queue deadlocked. A
 * merge_group delivery needs a fleet RUN without needing the D1 event row and
 * channel fan-out that gate exists to withhold, so the two decisions are now
 * separate rather than accidentally the same one.
 *
 * Deliberately NOT hoisted above the publish step for the pull_request path:
 * enqueueing before persistence would double-run the fleet whenever a 503 makes
 * GitHub retry the delivery, and a duplicate run is duplicate model spend.
 *
 * Never throws. A queue failure is audited and swallowed — the webhook has
 * already been acknowledged, and the executor's own retry/DLQ owns durability.
 *
 * @param env - Relay environment; both queue producers may be unbound.
 * @param eventType - The `X-GitHub-Event` header value.
 * @param action - The payload's `action`, or null for actionless events.
 * @param deliveryId - `X-GitHub-Delivery`, carried into the job for tracing.
 * @param repoFullName - `owner/repo`, or null when the payload names no repo.
 * @param payload - The HMAC-verified webhook body.
 * @returns Nothing; every failure is absorbed and audited.
 */
async function maybeEnqueueFleetRun(
  env: Env,
  eventType: string,
  action: string | null,
  deliveryId: string,
  repoFullName: string | null,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!shouldEnqueueFleetRun(eventType, action)) return;
  // Preserve the relay's optional-queue boot contract: when neither producer
  // exists, webhook ingestion remains a quiet no-op exactly as before.
  if (!env.FLEET_RUNS && !env.FLEET_GATES) return;
  const queue = eventType === 'merge_group'
    ? (env.FLEET_GATES ?? env.FLEET_RUNS)
    : env.FLEET_RUNS;
  const queueName = eventType === 'merge_group' && env.FLEET_GATES
    ? 'fleet-gates'
    : 'fleet-runs';
  if (!queue) {
    await appendAudit(env.DB, {
      action: 'fleet_run_enqueue_failed',
      target: repoFullName ?? '',
      detail: `event=${eventType} delivery=${deliveryId} queue=unbound`,
    }).catch(() => {});
    return;
  }
  const installation =
    payload.installation && typeof payload.installation === 'object'
      ? (payload.installation as Record<string, unknown>)
      : null;
  const pull =
    payload.pull_request && typeof payload.pull_request === 'object'
      ? (payload.pull_request as Record<string, unknown>)
      : null;
  const pullHead =
    pull?.head && typeof pull.head === 'object'
      ? (pull.head as Record<string, unknown>)
      : null;
  const prNumber = pull && typeof pull.number === 'number' ? pull.number : null;
  const headSha = pullHead && typeof pullHead.sha === 'string' ? pullHead.sha : null;
  const now = Math.floor(Date.now() / 1000);
  let reservation: FleetIntentReservation | null = null;

  // merge_group is a separate, short deterministic gate queue.  The durable
  // PR-generation ledger is only for pull_request review work where a newer
  // head can supersede an older queued generation.
  if (eventType === 'pull_request' && deliveryId && repoFullName && prNumber && headSha) {
    try {
      reservation = await reserveFleetRunIntent(env.DB, {
        deliveryId,
        repoFullName,
        prNumber,
        prUrl: `https://github.com/${repoFullName}/pull/${prNumber}`,
        headSha,
        eventType,
        action,
        now,
      });
      if (!reservation.shouldEnqueue) {
        await appendAudit(env.DB, {
          action: 'fleet_run_enqueue_duplicate',
          target: repoFullName,
          detail: `event=${eventType} delivery=${deliveryId} state=${reservation.state}`,
        });
        return;
      }
    } catch (intentError) {
      // Rollback compatibility: a new relay can briefly run before the additive
      // migration is applied.  Preserve the legacy queue path and make the
      // missing admission receipt visible in audit instead of dropping a gate.
      reservation = null;
      await appendAudit(env.DB, {
        action: 'fleet_run_intent_failed',
        target: repoFullName,
        detail: `delivery=${deliveryId} error=${String(intentError).slice(0, 300)}`,
      }).catch(() => {});
    }
  }
  const job: FleetRunJob = {
    deliveryId,
    eventType,
    action,
    repoFullName,
    installationId: installation && typeof installation.id === 'number' ? installation.id : null,
    prNumber,
    payloadMinimal: {
      sender: (payload.sender as Record<string, unknown>) ?? undefined,
      repository: (payload.repository as Record<string, unknown>) ?? undefined,
      pull_request: pull ?? undefined,
      push: (payload.push as Record<string, unknown>) ?? undefined,
      // Carried for merge_group deliveries: the executor needs `head_sha` to
      // post the check on the QUEUE branch, which is the only sha GitHub is
      // waiting on. There is no pull_request on this payload, so without this
      // the executor would have nothing to attach a check run to.
      merge_group: (payload.merge_group as Record<string, unknown>) ?? undefined,
    },
  };
  try {
    await queue.send(job);
  } catch (queueError) {
    console.error(
      `[relay] Fleet queue handoff failed repo=${repoFullName ?? 'unknown'} delivery=${deliveryId}`,
      queueError,
    );
    if (reservation) {
      await markFleetRunIntentEnqueueFailed(
        env.DB,
        deliveryId,
        String(queueError),
        Math.floor(Date.now() / 1000),
      ).catch(() => {});
    }
    // Best-effort: record and move on. The webhook still succeeds (204);
    // a missed enqueue means the executor simply doesn't run for this
    // delivery — the required check stays absent (PR blocked), never green.
    await appendAudit(env.DB, {
      action: 'fleet_run_enqueue_failed',
      target: repoFullName ?? '',
      detail: `event=${eventType} delivery=${deliveryId} queue=${queueName}`,
    }).catch(() => {});
    return;
  }

  if (reservation) {
    // queue.send and D1 cannot share a transaction.  Supersede older work only
    // AFTER the new message exists. If this projection write fails, both jobs
    // may run and GitHub can temporarily retain an older same-SHA conclusion;
    // the audit row makes that degraded boundary observable.
    await markFleetRunIntentEnqueued(env.DB, deliveryId, Math.floor(Date.now() / 1000)).catch(
      async (intentError) => {
        await appendAudit(env.DB, {
          action: 'fleet_run_intent_failed',
          target: repoFullName ?? '',
          detail: `delivery=${deliveryId} phase=enqueued error=${String(intentError).slice(0, 300)}`,
        }).catch(() => {});
      },
    );
  }

  try {
    await appendAudit(env.DB, {
      action: 'fleet_run_enqueued',
      target: repoFullName ?? '',
      detail: `event=${eventType} delivery=${deliveryId} queue=${queueName}`,
    });
  } catch {
    // The queue already owns the message.  An audit write must never turn a
    // successful admission into a webhook failure/retry and duplicate spend.
  }
}

/**
 * `POST /v1/github/webhook` — the GitHub webhook ingress gate.
 *
 * DESIGN — THE HMAC IS THE WHOLE AUTHENTICATION STORY. GitHub holds no relay
 * card, so `X-Hub-Signature-256` over the *raw* body bytes is the sole gate,
 * and every step below it runs only after that comparison passes. The body is
 * read as bytes and parsed afterwards for exactly that reason: parsing first
 * would verify a re-serialization rather than what GitHub signed.
 *
 * The rationale for the shape after the gate is fail-direction. Publishing is
 * fail-CLOSED (503, GitHub retries) because a dropped event breaks the chain
 * the relay's whole audit model rests on. The two hand-offs that follow —
 * {@link maybeEnqueueFleetRun} and {@link maybeWakeSteward} — are fail-OPEN,
 * because by then the delivery is already acknowledged and a retry would
 * re-run work that succeeded, spending real money twice.
 *
 * Response codes:
 * - 405 — non-POST
 * - 401 — missing `X-Hub-Signature-256`, unconfigured secret, or mismatch
 * - 400 — missing `X-GitHub-Event`, malformed body / JSON
 * - 409 — chain conflict on a target channel
 * - 204 — accepted; either fanned out to all channels (PR-family event) or
 *   verified-and-ignored (non-PR event: audited, nothing persisted)
 *
 * @param request - The inbound GitHub delivery, signature headers included.
 * @param env - Relay environment; queue and Steward bindings may be absent.
 * @returns The response to hand GitHub, per the code table above.
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

  // Structured relay-readable payload. Per-channel envelope construction (seq
  // and channel are signed binding fields) happens in
  // publishGithubEventToChannel, so bytes now differ per channel by design.
  const webhookPayload: Record<string, unknown> = {
    event_type: eventType,
    delivery_id: deliveryId,
    action,
    repository: repoFullName,
    payload,
  };

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
    // NOT persisted, but merge_group still needs its fleet run: this gate
    // withholds the D1 row and the channel fan-out, not the merge-queue gate.
    await maybeEnqueueFleetRun(env, eventType, action, deliveryId, repoFullName, payload);
    // Nor does it withhold the Steward's wake, and this is the path that
    // matters most for it: `check_suite:completed` and `pull_request_review`
    // are both "not a PR event" by the persistence gate's reckoning, yet a
    // suite going green is the single most merge-relevant thing that happens
    // to a PR. Ambient *noise* is what that gate withholds — this is signal.
    await maybeWakeSteward(env, eventType, action, deliveryId, repoFullName, payload);
    return new Response(null, { status: 204 });
  }

  // 7. Publish to every channel via the internal path. Wrap in try/catch so an
  //    infra failure (D1 / Durable Object unreachable, permission error, any
  //    non-ChainError throw from insertEvent / getLastEventSeq / upsertChainHead
  //    / appendAudit) fails CLOSED with a controlled 503 — GitHub then retries
  //    the delivery — rather than crashing into a raw runtime 500.
  try {
    for (const channel of channels) {
      const result = await publishGithubEventToChannel(env, channel, webhookPayload);
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
  await maybeEnqueueFleetRun(env, eventType, action, deliveryId, repoFullName, payload);

  // 9. Wake the repo's Steward seat (P1 PR 8). Same guarded contract as the
  //    queue hand-off above and for the same reason: the seat is an
  //    accelerant, not a dependency. Losing a wake costs latency until the
  //    next heartbeat; failing the delivery would cost a duplicate fleet run.
  await maybeWakeSteward(env, eventType, action, deliveryId, repoFullName, payload);

  return new Response(null, { status: 204 });
}
