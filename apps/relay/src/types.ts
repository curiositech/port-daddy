/**
 * Port Daddy Relay — Shared types (ADR-0049)
 *
 * Wire types are intentionally minimal: the relay sees metadata + ciphertext.
 * It never sees payload plaintext (I1).
 */

export interface Env {
  // D1 database (identity, events, chain heads, revocations, audit, issuers)
  DB: D1Database;
  // Durable Object namespace — one DO per (harbor_fingerprint, channel)
  HARBOR_CHANNEL: DurableObjectNamespace;
  // Workers KV — JWKS cache + pinned relay key cache
  KV: KVNamespace;
  // Queue producers — one FleetRunJob per GitHub delivery handed to the
  // fleet-executor Worker. Substantive AI reviews stay serialized on
  // fleet-runs. Deterministic merge-group pass-through checks use fleet-gates
  // so a long review cannot starve GitHub's required merge-queue context.
  // Both remain optional so the relay can start before queue provisioning;
  // a partially provisioned routing state is recorded in the audit log.
  FLEET_RUNS?: Queue<FleetRunJob>;
  FLEET_GATES?: Queue<FleetRunJob>;
  // Workers AI — fleet control-plane smoke-test + optimize-prompt endpoints.
  // Optional so the relay still type-checks/deploys before the [ai] binding is
  // provisioned; the handlers fail closed with AI_ERROR when it is absent.
  AI?: Ai;
  // Secrets
  RELAY_OPERATOR_TOKEN: string;
  RELAY_ED25519_PRIVATE_KEY_HEX: string;  // relay's own signing key for ServerHello
  GITHUB_WEBHOOK_SECRET: string;          // HMAC-SHA256 secret for GitHub webhook ingress
  // HMAC secret (>=32 chars) gating the HTML fleet run page (ADR-0101 Phase 0).
  // MUST equal the fleet-executor's RUN_PAGE_SECRET. Optional: unset ⇒ the page
  // only opens with the operator token.
  RUN_PAGE_SECRET?: string;
  // Previous run-page HMAC secret, accepted during a rotation grace window
  // (ADR-0101 Z1). Optional; unset ⇒ single-key verification.
  RUN_PAGE_SECRET_PREV?: string;
  // GitHub login BFF (ADR-0101 Phase 1). Reuses the existing GitHub App's OAuth
  // client. Login is DISABLED unless all four are set (page/API return 503).
  GITHUB_OAUTH_CLIENT_ID?: string;      // var (the App's client id)
  GITHUB_OAUTH_CLIENT_SECRET?: string;  // secret
  USER_TOKEN_WRAPPING_KEY?: string;     // secret, 32-byte hex; AES-GCM wraps the gh token
  PUBLIC_BASE_URL?: string;             // var, relay's public origin; redirect_uri base
  // GitHub App credentials — fleet control-plane config read + save (PR) path.
  // GITHUB_APP_PRIVATE_KEY is a secret (PEM); the rest may be vars.
  GITHUB_APP_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;        // PEM-encoded GitHub App private key
  GITHUB_OWNER?: string;                  // repo owner (e.g. 'port-daddy-dev')
  GITHUB_REPO?: string;                   // repo name (e.g. 'port-daddy')
  DEFAULT_BRANCH?: string;                // trusted ref the executor reads from
  // Stripe billing + prepaid credits (ADR-0116). The relay is the billing
  // authority. Billing endpoints return 503 (BILLING_UNCONFIGURED) unless both
  // secrets are set, so the relay still deploys before Stripe is provisioned.
  STRIPE_SECRET_KEY?: string;             // secret — Stripe REST Bearer token
  STRIPE_WEBHOOK_SECRET?: string;         // secret — whsec_… HMAC for /billing/webhook
  // Optional preconfigured Stripe Price ids per credit pack. When unset the
  // checkout session builds an inline price_data at the pack's amount instead.
  STRIPE_PRICE_STARTER?: string;
  STRIPE_PRICE_PRO?: string;
  STRIPE_PRICE_TEAM?: string;
  // MERCY paging (src/mercy.ts). Optional secret: a webhook URL POSTed exactly
  // once per unresolved red incident (PagerDuty Events / Grafana OnCall /
  // Cloudflare Notifications bridge — see docs/mercy-oncall.md). Unset ⇒
  // incidents are still recorded in D1, but nobody is paged.
  MERCY_PAGE_WEBHOOK?: string;
  // Workers AI model id for the Shipwright chat (src/shipwright.ts). A var,
  // not a secret. Optional: unset ⇒ the module's committed default is used.
  SHIPWRIGHT_MODEL?: string;
  // X4 mediator body opt-in (src/mediator.ts). The relay-side analogue of the
  // fleet's per-tenant `xo:` / `squidEvents:` consent keys. A var, not a
  // secret. ONLY the exact string 'on' enables the pd-mediator seat's
  // observation behavior; unset or anything else ⇒ OFF (the honest v1 seat
  // with no body, and not one token of model spend).
  PARLEY_MEDIATOR?: string;
  // Workers AI model id for the mediator's observations. A var, not a secret.
  // Optional: unset ⇒ mediator.ts's committed default. A NON-`@cf/` value is
  // REJECTED (not honored) — Workers AI only, never Anthropic/Claude Code/an
  // external runner. See resolveMediatorModel.
  PARLEY_MEDIATOR_MODEL?: string;
  // Vars from wrangler.toml
  RELAY_VERSION: string;
  EVENT_RETENTION_DAYS: string;
  SESSION_TTL_SECONDS: string;
  JWKS_CACHE_TTL_SECONDS: string;
  JWKS_FAIL_SOFT_SECONDS: string;
  REVOCATION_BROADCAST_TIMEOUT_MS: string;
  RATE_LIMIT_WINDOW_MS: string;
  // X8 quotas (src/harbor-quota.ts). The aggregating per-harbor quota DO.
  // Optional so the relay still type-checks/deploys before the binding is
  // provisioned; while absent, the publish path falls back to the legacy
  // HarborChannel in-memory rate limiter (rate limiting never fails open).
  HARBOR_QUOTA?: DurableObjectNamespace;
  // Per-harbor daily budgets, as decimal strings (vars, not secrets). Unset
  // or unparsable values fall back to the committed defaults in
  // harbor-quota.ts — never to "unlimited".
  HARBOR_DAILY_EVENT_BUDGET?: string;
  HARBOR_DAILY_BYTE_BUDGET?: string;
  // X8 enforcement switch. ONLY the exact string 'enforce' turns budget
  // refusal on; anything else (including unset) is SHADOW mode: over-budget
  // traffic passes and the would-have-denied delta is recorded. The flip is
  // a deliberate, data-backed config change — see resolveQuotaSettings.
  QUOTA_ENFORCE?: string;
}

/**
 * Job handed to the fleet-executor Worker — exactly one per GitHub delivery.
 * `deliveryId` is the idempotency key (a queue retry re-runs the same job).
 * Shape MUST match apps/fleet-executor/src/env.ts FleetRunJob.
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
    /** merge_group deliveries only: carries `head_sha` for the queue branch. */
    merge_group?: Record<string, unknown>;
  };
}

// ── Harbor Card (Phase 2, per ADR-0014 + lib/harbor-tokens.ts) ──────────────

export interface HarborCardPayload {
  hv: 2;
  sub: string;           // daemon_fingerprint (hex)
  iss: string;           // harbor_fingerprint (hex)
  aud: string;           // harbor_fingerprint (hex) — same as iss in Phase 2
  exp: number;           // unix timestamp
  nbf?: number;
  iat: number;
  jti: string;
  cap: CapabilityEntry[];
}

export interface CapabilityEntry {
  op: 'pub' | 'sub' | 'admin';
  channel: string;       // exact channel name or glob pattern
  rate_per_min?: number;
  max_payload_bytes?: number;
}

// ── Handshake ────────────────────────────────────────────────────────────────

export interface ClientHello {
  v: 1;
  client_hello: true;
  card: string;          // Base64URL-encoded signed harbor card JWT
  subscriptions: string[]; // requested channels (harbor_fingerprint:channel)
  nonce_c: string;       // hex, 32 bytes
  sig: string;           // Ed25519 sig over SHA256(card + nonce_c), hex
}

export interface ServerHello {
  v: 1;
  server_hello: true;
  session_id: string;
  nonce_c: string;       // echoed from ClientHello — daemon verifies this
  nonce_s: string;       // hex, 32 bytes
  accepted_subs: SubscriptionStatus[];
  rejected_subs: SubscriptionStatus[];
  sig: string;           // relay's Ed25519 sig over SHA256(session_id + nonce_c + nonce_s), hex
  relay_pub_key: string; // relay's Ed25519 public key, hex
}

export interface SubscriptionStatus {
  channel: string;
  tip_seq: number | null;
  tip_hash: string | null;
  reason?: string;       // present only on rejection
}

// ── Event (wire format, relay side) ──────────────────────────────────────────

export interface RelayEvent {
  v: 1;
  sender: string;        // daemon_fingerprint (hex)
  channel: string;       // harbor_fingerprint:channel
  seq: number;
  prev_hash: string;     // hex, ZERO_HASH for first event
  this_hash: string;     // hex, SHA256 over canonical fields
  iat: number;           // unix timestamp
  ciphertext: string;    // Base64URL AES-256-GCM ciphertext
  sig: string;           // Ed25519 sig over this_hash by sender's key, hex
}

// ── Publish request ───────────────────────────────────────────────────────────

export interface PublishRequest {
  event: RelayEvent;
  card?: string;         // if not using Authorization header
}

// ── OIDC exchange ─────────────────────────────────────────────────────────────

export interface OidcExchangeRequest {
  oidc_token: string;    // raw OIDC JWT from GitHub Actions
  pub_key: string;       // daemon's Ed25519 public key, hex
  cap: CapabilityEntry[]; // requested capabilities
}

export interface OidcExchangeResponse {
  card: string;          // signed harbor card JWT
  exp: number;
}

// ── Revocation ────────────────────────────────────────────────────────────────

export interface RevokeRequest {
  jti: string;
  sig: string;           // Ed25519 sig over SHA256("revoke:" + jti), hex
  reason?: string;
}

export interface RevokeByIssuerRequest {
  issuer: string;        // OIDC issuer_id
  iat_min: number;       // unix timestamp inclusive
  iat_max: number;       // unix timestamp inclusive
  reason?: string;
}

// ── Chain head ────────────────────────────────────────────────────────────────

export interface ChainHead {
  sender: string;
  channel: string;
  tip_seq: number;
  tip_hash: string;
  issued_at: number;
  signed_head: string;   // Base64URL-encoded relay signature over (sender+channel+tip_seq+tip_hash)
  anchors?: AnchorRef[];
}

export interface AnchorRef {
  kind: 'dns' | 'git' | 'transparency-log';
  ref: string;
}

// ── Issuer config ─────────────────────────────────────────────────────────────

export interface IssuerConfig {
  issuer_id: string;
  jwks_uri: string;
  audience: string;
  disabled: boolean;
  disabled_at?: number | undefined;
  last_fetch?: number | undefined;
}

// ── SSE fan-out message (sent over DO internal storage) ──────────────────────

export interface FanoutMessage {
  type: 'event' | 'revocation' | 'heartbeat';
  payload: string;       // JSON-encoded RelayEvent | RevokedJti | HeartbeatPayload
}

export interface RevokedJti {
  jti: string;
  revoked_at: number;
}

export interface HeartbeatPayload {
  at: number;
  relay_version: string;
}

// ── Error response ────────────────────────────────────────────────────────────

export interface RelayError {
  error: string;
  code: string;
  detail?: string;
}
