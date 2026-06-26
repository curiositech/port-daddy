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
  // Queue producer — one FleetRunJob per GitHub delivery handed to the
  // fleet-executor Worker. Optional so the relay still deploys before the
  // 'fleet-runs' queue is provisioned; ingress guards on its presence.
  FLEET_RUNS?: Queue<FleetRunJob>;
  // Workers AI — fleet control-plane smoke-test + optimize-prompt endpoints.
  // Optional so the relay still type-checks/deploys before the [ai] binding is
  // provisioned; the handlers fail closed with AI_ERROR when it is absent.
  AI?: Ai;
  // Secrets
  RELAY_OPERATOR_TOKEN: string;
  RELAY_ED25519_PRIVATE_KEY_HEX: string;  // relay's own signing key for ServerHello
  GITHUB_WEBHOOK_SECRET: string;          // HMAC-SHA256 secret for GitHub webhook ingress
  // GitHub App credentials — fleet control-plane config read + save (PR) path.
  // GITHUB_APP_PRIVATE_KEY is a secret (PEM); the rest may be vars.
  GITHUB_APP_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;        // PEM-encoded GitHub App private key
  GITHUB_OWNER?: string;                  // repo owner (e.g. 'port-daddy-dev')
  GITHUB_REPO?: string;                   // repo name (e.g. 'port-daddy')
  DEFAULT_BRANCH?: string;                // trusted ref the executor reads from
  // Vars from wrangler.toml
  RELAY_VERSION: string;
  EVENT_RETENTION_DAYS: string;
  SESSION_TTL_SECONDS: string;
  JWKS_CACHE_TTL_SECONDS: string;
  JWKS_FAIL_SOFT_SECONDS: string;
  REVOCATION_BROADCAST_TIMEOUT_MS: string;
  RATE_LIMIT_WINDOW_MS: string;
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
