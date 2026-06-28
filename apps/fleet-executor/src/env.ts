/**
 * Executor environment + queue job shapes.
 *
 * The executor is a Cloudflare Queues *consumer*. Relay (the producer) enqueues
 * exactly one {@link FleetRunJob} per GitHub delivery; `deliveryId` is the
 * idempotency key for the whole pipeline.
 */

export interface ExecutorEnv {
  /** GitHub App id (var or secret). */
  GITHUB_APP_ID: string;
  /** GitHub App private key, PEM-encoded (secret). */
  GITHUB_APP_PRIVATE_KEY: string;
  /**
   * The TRUSTED branch every config/contract file is read from. Hard
   * zero-trust invariant: never resolve config from `pull_request.head`.
   */
  DEFAULT_BRANCH: string;
  /** KV cache for installation tokens, keyed by `github_inst_<id>`. */
  FLEET_TOKENS: KVNamespace;
  /** Workers AI binding. */
  AI: Ai;
}

/**
 * One job per GitHub delivery. Minimal payload — the executor fetches whatever
 * else it needs from GitHub directly (config/contracts from the trusted branch,
 * PR diff from the API). `deliveryId` dedupes retries.
 */
export interface FleetRunJob {
  deliveryId: string;
  eventType: string;
  action: string | null;
  repoFullName: string | null;
  installationId: number | null;
  prNumber: number | null;
  payloadMinimal: {
    sender?: Record<string, unknown>;
    repository?: Record<string, unknown>;
    pull_request?: Record<string, unknown>;
    push?: Record<string, unknown>;
    [k: string]: unknown;
  };
}
