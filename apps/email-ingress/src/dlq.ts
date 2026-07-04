/**
 * Envelope dead-letter queue — KV-backed durability for inbound fleet
 * email events across LONG daemon outages.
 *
 * In-request retries (postWithRetry) cover ~10s of unreachability; a
 * tunnel that is down for an hour would otherwise permanently eat every
 * fleet trigger in that window ("never silently drop messages"). Failed
 * envelopes stash here (7d TTL, keyed by delivery id so retries of the
 * same message overwrite, never duplicate) and the cron replays them —
 * RE-SIGNING with the current secret at replay time, so a rotated
 * PD_EMAIL_INBOUND_SECRET heals old envelopes instead of stranding them.
 * The daemon's delivery-id dedup makes replays at-least-once-safe.
 *
 * KV's eventual consistency is fine here: the cron tolerates seeing a
 * just-deleted key again (the daemon dedupes) and a just-stashed key
 * late (the next run gets it).
 */

import { signBody, postWithRetry } from './envelope.js';

/** Structural KV surface so tests run without workerd. */
export interface KVLike {
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  get(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
  list(opts: { prefix: string; limit?: number; cursor?: string }): Promise<{
    keys: Array<{ name: string }>;
    cursor?: string;
    list_complete?: boolean;
  }>;
}

export interface StashedEnvelope {
  channel: string;
  body: string;
  deliveryId: string;
  failedAt: string;
  attempts: number;
}

const DLQ_PREFIX = 'dlq:';
const DLQ_TTL_SECONDS = 7 * 24 * 60 * 60; // matches the daemon-side tuple TTL
/** Per-cron-run bound. Not a silent cap: leftovers persist for later runs. */
const REPLAY_BATCH = 50;

export async function stashEnvelope(
  kv: KVLike,
  input: { channel: string; body: string; deliveryId: string; attempts: number },
): Promise<void> {
  const record: StashedEnvelope = {
    channel: input.channel,
    body: input.body,
    deliveryId: input.deliveryId,
    failedAt: new Date().toISOString(),
    attempts: input.attempts,
  };
  await kv.put(`${DLQ_PREFIX}${input.deliveryId}`, JSON.stringify(record), {
    expirationTtl: DLQ_TTL_SECONDS,
  });
}

export async function dlqDepth(kv: KVLike): Promise<number> {
  const listed = await kv.list({ prefix: DLQ_PREFIX, limit: 1000 });
  return listed.keys.length;
}

export interface ReplayResult {
  scanned: number;
  delivered: number;
  kept: number;
}

/**
 * Replay up to REPLAY_BATCH stashed envelopes toward the daemon. Delivered
 * ones are deleted; failures stay for the next run (bounded only by the
 * 7d TTL — a stuck envelope is visible via /healthz dlqDepth, never
 * silently dropped).
 */
export async function replayDlq(
  kv: KVLike,
  fetchImpl: typeof fetch,
  forwardBaseUrl: string,
  secret: string,
  log: (msg: string) => void = () => {},
): Promise<ReplayResult> {
  const listed = await kv.list({ prefix: DLQ_PREFIX, limit: REPLAY_BATCH });
  let delivered = 0;
  let kept = 0;

  for (const { name } of listed.keys) {
    const raw = await kv.get(name);
    if (!raw) continue; // expired/deleted between list and get
    let record: StashedEnvelope;
    try {
      record = JSON.parse(raw) as StashedEnvelope;
    } catch {
      await kv.delete(name); // unparseable = unreplayable; drop loudly
      log(`dlq: dropped unparseable record ${name}`);
      continue;
    }

    // Re-sign at replay time — heals secret rotation.
    const signature = await signBody(record.body, secret);
    const url = new URL(`/webhooks/fleet/${record.channel}`, forwardBaseUrl).toString();
    const result = await postWithRetry(
      fetchImpl,
      url,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-pd-webhook-signature': signature,
          'x-pd-delivery-id': record.deliveryId,
        },
        body: record.body,
      },
      [1000], // one quick retry inside the cron; the next run is the real backoff
    );

    if (result.ok) {
      await kv.delete(name);
      delivered += 1;
    } else {
      kept += 1;
      record.attempts += 1;
      await kv.put(name, JSON.stringify(record), { expirationTtl: DLQ_TTL_SECONDS });
      log(`dlq: replay failed for ${record.deliveryId} (attempt ${record.attempts}): ${result.error}`);
    }
  }

  return { scanned: listed.keys.length, delivered, kept };
}
