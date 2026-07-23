/**
 * Delivery dedupe cache — TTL-bounded, capacity-bounded, insertion-ordered
 * Map dedup for at-least-once delivery sources (webhooks, retried HTTP
 * callbacks, anything that can redeliver the same event more than once).
 *
 * Ported from the inline `Map`-based dedup pattern in
 * lib/fleet/triggers/webhook.ts's generic webhook trigger source (which
 * dedupes retried deliveries by `X-PD-Delivery-Id` / raw-body hash before
 * emitting a FleetTriggerEvent). Extracted here so other delivery-id-bearing
 * inbound routes — e.g. routes/github-webhook.ts, which dedupes on the
 * GitHub `X-GitHub-Delivery` header — can reuse the exact same
 * TTL/capacity/eviction behavior instead of re-implementing it.
 */

export interface DeliveryDedupeCache {
  /**
   * Records `key` as seen and returns `true` if `key` was ALREADY seen
   * within the retention window (i.e. this call is a duplicate/retried
   * delivery that should be acknowledged but not re-processed). A
   * previously-unseen key returns `false` and is recorded for future calls.
   */
  seen(key: string): boolean;
  /** Current number of tracked keys (diagnostic / test use). */
  size(): number;
}

export interface DeliveryDedupeCacheOptions {
  /** How long a delivery id is remembered before it may be pruned (default: 24h). */
  retentionMs?: number;
  /** Hard cap on tracked keys; oldest insertions evict first (default: 5000). */
  capacity?: number;
  /** Below this size, skip the amortized age-prune scan (default: 512). */
  pruneThreshold?: number;
  /** Injectable clock, for deterministic tests. */
  now?: () => number;
}

const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CAPACITY = 5000;
const DEFAULT_PRUNE_THRESHOLD = 512;

/**
 * Create a fresh delivery dedupe cache. Intended lifetime is one per
 * long-lived receiver (one per fastify plugin registration / one per
 * trigger-source `start()` call) — NOT one per request, or every call would
 * see an empty cache and dedup would never fire.
 */
export function createDeliveryDedupeCache(opts: DeliveryDedupeCacheOptions = {}): DeliveryDedupeCache {
  const retentionMs = opts.retentionMs ?? DEFAULT_RETENTION_MS;
  const capacity = opts.capacity ?? DEFAULT_CAPACITY;
  const pruneThreshold = opts.pruneThreshold ?? DEFAULT_PRUNE_THRESHOLD;
  const now = opts.now ?? (() => Date.now());

  const delivered = new Map<string, number>();

  return {
    seen(key: string): boolean {
      const ts = now();
      if (delivered.has(key)) return true;
      delivered.set(key, ts);

      // Size cap first: evict oldest insertions until under the cap. A Map
      // preserves insertion order, so the first key from the iterator is
      // always the oldest.
      while (delivered.size > capacity) {
        const oldest = delivered.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        delivered.delete(oldest);
      }
      // Age prune, amortized: a full scan on every call is wasted work at
      // small sizes. Never wholesale-clear (that would re-open the dedup
      // window for recent deliveries).
      if (delivered.size > pruneThreshold) {
        for (const [k, at] of delivered) {
          if (ts - at > retentionMs) delivered.delete(k);
        }
      }
      return false;
    },
    size(): number {
      return delivered.size;
    },
  };
}
