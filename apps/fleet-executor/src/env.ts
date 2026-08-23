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
  /**
   * Optional producer binding to the same `fleet-runs` queue this Worker
   * consumes. A successful checkpoint sends a NEW continuation message and
   * acknowledges the current delivery, so ordinary progress never consumes
   * the queue's poison-message retry budget. Optional during rolling deploys;
   * an absent binding preserves the legacy `message.retry()` continuation.
   */
  FLEET_CONTINUATIONS?: Queue<FleetRunJob>;
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
   * OPTIONAL XO model override (plaintext var, wrangler.deploy.toml). The XO
   * synthesis officer (src/xo.ts) runs on Workers AI ONLY: only a `@cf/` id is
   * honored, anything else falls back to DEFAULT_XO_MODEL — see resolveXoModel.
   * Unset ⇒ the default deepseek-r1 distill.
   */
  XO_MODEL?: string;
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
   * OPTIONAL "cloud squid" coordination-event sink (src/squid-events.ts): the
   * relay's POST /v1/publish endpoint the executor fire-and-forgets
   * run-started / ship-verdict / pr-stacked / run-concluded events to, on
   * per-run channel `<relayFp>:fleet-cloud:<runId>`. ALL of this,
   * FLEET_EXECUTOR_ED25519_PRIVATE_KEY_HEX, and FLEET_EXECUTOR_HARBOR_CARD
   * must be set or the feature is silently disabled — no fetch is ever
   * attempted. Events are strictly best-effort: they never throw and never
   * block or change a run. There is NO bearer-token dialect on this stream.
   */
  RELAY_PUBLISH_URL?: string;
  /**
   * Ed25519 seed (64 hex chars) — the executor's publish identity (secret).
   * Its public-key SHA-256 is the daemon fingerprint registered on the relay
   * with proof_method='operator-provisioned' (POST /v1/fleet/executor-identity).
   */
  FLEET_EXECUTOR_ED25519_PRIVATE_KEY_HEX?: string;
  /**
   * hv:2 harbor card returned by the relay's provisioning endpoint (secret):
   * relay-signed EdDSA JWT, sub = this key's fingerprint, iss = aud = relay
   * fingerprint, cap = [{op:'pub', channel:'<relayFp>:fleet-cloud:*',
   * rate_per_min:120}]. Rotate via POST /v1/revoke-by-issuer + re-provision.
   */
  FLEET_EXECUTOR_HARBOR_CARD?: string;
  /**
   * OPTIONAL deployment label in the squid/1 body's sender name
   * (`fleet-executor@<deployment>`). A var, not a secret. Default 'default'.
   */
  FLEET_DEPLOYMENT?: string;
  /**
   * OPTIONAL HITL escalation sink (src/interruptions.ts): the relay's
   * POST /v1/interruptions endpoint. When a ship hits a BLOCKING degradation
   * (403 on `contents: write`, blockWithoutSandbox with no SANDBOX binding) it
   * fire-and-forgets an operator interruption there. BOTH this and
   * INTERRUPTIONS_TOKEN must be set or the feature is silently disabled — no
   * fetch is ever attempted. Escalations never block or change a run.
   */
  INTERRUPTIONS_URL?: string;
  /** pdu_ operator token sent as the Bearer on every interruption POST. Secret. */
  INTERRUPTIONS_TOKEN?: string;
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
  /**
   * Number of durable ship checkpoints that existed when this explicit
   * continuation was produced. Relay-originated jobs omit it. The consumer
   * uses it to keep platform retry attempts separate from successful workflow
   * slices and to reject duplicate continuation messages after progress moves.
   */
  continuationSequence?: number;
  payloadMinimal: {
    sender?: Record<string, unknown>;
    repository?: Record<string, unknown>;
    pull_request?: Record<string, unknown>;
    push?: Record<string, unknown>;
    [k: string]: unknown;
  };
}
