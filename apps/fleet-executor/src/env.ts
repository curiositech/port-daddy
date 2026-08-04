/**
 * Executor environment + queue job shapes.
 *
 * The executor is a Cloudflare Queues *consumer*. Relay (the producer) enqueues
 * exactly one {@link FleetRunJob} per GitHub delivery; `deliveryId` is the
 * idempotency key for the whole pipeline.
 */

import type { PortDaddyTelemetryEnv } from './telemetry.js';

export interface ExecutorEnv extends PortDaddyTelemetryEnv {
  /** GitHub App id (var or secret). */
  GITHUB_APP_ID: string;
  /** GitHub App private key, PEM-encoded (secret). */
  GITHUB_APP_PRIVATE_KEY: string;
  /**
   * The TRUSTED branch every config/contract file is read from. Hard
   * zero-trust invariant: never resolve config from `pull_request.head`.
   */
  DEFAULT_BRANCH: string;
  /**
   * KV cache for installation tokens, keyed by `github_inst_<id>`.
   */
  FLEET_TOKENS: KVNamespace;
  /**
   * Relay CONTROL-PLANE KV (the relay's own `KV` namespace). Carries the
   * kill-switch flag at key `fleet:paused` (JSON `{paused, pausedAt}` or the
   * literal string `"true"`/`"false"`), written by the relay's
   * POST /v1/fleet/pause. MUST be the SAME namespace the relay binds as `KV` —
   * otherwise the executor never sees a pause toggle. Optional at the type level
   * so unit tests can omit it; absent ⇒ NOT paused (fail-safe: the gate runs).
   */
  CONTROL_KV?: KVNamespace;
  /** Workers AI binding. */
  AI: Ai;
  /**
   * OPTIONAL Cloudflare Sandbox binding (Containers beta, `@cloudflare/sandbox`)
   * used by the purser ship to EXECUTE its authored adversarial tests against
   * the PR head. Deliberately typed `unknown` and duck-typed in
   * src/sandbox-runner.ts so the SDK is not a build dependency. ABSENT (the
   * default deploy) ⇒ the purser reports `executed: false` and never fabricates
   * test results. See the commented block in wrangler.toml.example.
   */
  SANDBOX?: unknown;
  /**
   * Optional Cloudflare AI Gateway id. When set, every ship's `env.AI.run(...)`
   * is routed through this gateway (`{ gateway: { id } }`) so token/cost/latency
   * is logged and cacheable in the AI Gateway dashboard (ADR-0116/0117). UNSET ⇒
   * the option is omitted ⇒ calls hit Workers AI directly (exactly today's
   * behavior). A var, not a secret — a gateway id is not sensitive.
   */
  AI_GATEWAY_ID?: string;
  /**
   * Public base URL of the relay serving the human-facing run page
   * (ADR-0101 Phase 0), e.g. "https://port-daddy-relay.example.workers.dev".
   * OPTIONAL: unset (with RUN_PAGE_SECRET) ⇒ check runs carry no details_url.
   */
  RUN_DETAILS_BASE_URL?: string;
  /**
   * Shared HMAC secret for the run-page capability token; MUST equal the
   * relay's RUN_PAGE_SECRET. ≥32 chars or the details_url is not emitted.
   */
  RUN_PAGE_SECRET?: string;
  /**
   * Shared relay D1 database (`port-daddy-relay`). The executor writes the
   * fleet_runs audit header + the append-only fleet_run_steps transcript here.
   * Optional at the type level so unit tests can omit it; all writes are
   * best-effort and a missing/failing DB NEVER changes the gate.
   */
  DB?: D1Database;
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
