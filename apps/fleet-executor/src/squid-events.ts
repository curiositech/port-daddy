/**
 * Cloud squid — fire-and-forget fleet coordination events, now with a name
 * and a chain (grand-plan DAG node n2-executor-identity; plan §N2).
 *
 * The executor announces its run lifecycle onto a PER-RUN relay channel so
 * other agents (and the operator surfaces) can see cloud fleet activity as it
 * happens: run-started, one ship-verdict per ship, pr-stacked whenever a ship
 * (purser or ideation) stacks a PR, and run-concluded.
 *
 * IDENTITY. The executor holds an operator-provisioned Ed25519 identity:
 *   - `FLEET_EXECUTOR_ED25519_PRIVATE_KEY_HEX` (secret) — a 32-byte seed whose
 *     public-key SHA-256 is the executor's daemon fingerprint in the relay's
 *     identity registry (`proof_method='operator-provisioned'`, registered via
 *     the relay's operator-gated POST /v1/fleet/executor-identity).
 *   - `FLEET_EXECUTOR_HARBOR_CARD` (secret) — the hv:2 harbor card the same
 *     provisioning call returned: an EdDSA JWT signed by the RELAY's key
 *     (header.kid = relay fingerprint, iss = aud = relay fingerprint) carrying
 *     capability `{op:'pub', channel:'<relayFp>:fleet-cloud:*', rate_per_min:120}`.
 *
 * TRANSPORT — the FULL zero-trust /v1/publish dialect, no bearer anything:
 * one POST per event to `env.RELAY_PUBLISH_URL` with body `{ card, event }`
 * (see apps/relay/src/handlers.ts handlePublish). The event is a v:1 relay
 * envelope on channel `<relayFp>:fleet-cloud:<runId>`:
 *   - `sender` is the executor's fingerprint (the relay enforces
 *     sender === card.sub); the human-facing name `fleet-executor@<deployment>`
 *     rides INSIDE the squid/1 body.
 *   - `seq` is monotonic per channel within one executor isolate — no outbox,
 *     no durable seq state, by design. If the isolate recycles mid-run the
 *     restarted chain is rejected by the relay (SEQ_MISMATCH) and those events
 *     are lost; honesty about loss arrives with run-concluded reconciliation
 *     (plan §X7), never by blocking a run.
 *   - `prev_hash`/`this_hash` follow the relay's canonical event-hash formula
 *     (apps/relay/src/crypto.ts computeEventHash):
 *     SHA256(prev_hash|sender|channel|seq|iat|ciphertext), '|'-joined.
 *   - `sig` is Ed25519 over the hash bytes, by the executor's own key.
 *   - `ciphertext` carries the base64url squid/1 body (fleet telemetry is not
 *     E2E-encrypted; the relay treats the field as opaque bytes either way).
 *
 * THE BEARER-PUBLISH ROUTE IS NEVER BUILT. This module sends no Authorization
 * header and no shared token; the stream was greenfield and starts attested
 * (unattested_publish_attempts == 0 by construction — there is nothing to hit).
 *
 * CONTRACT (hard):
 *   - Any of RELAY_PUBLISH_URL / FLEET_EXECUTOR_ED25519_PRIVATE_KEY_HEX /
 *     FLEET_EXECUTOR_HARBOR_CARD unset/empty ⇒ feature silently disabled,
 *     zero fetches. A card whose `sub` does not match the fingerprint derived
 *     from the private key is treated as misconfiguration ⇒ silently disabled.
 *   - TENANT CONSENT (tenancy finding, 2026-08): the tenant repo must ALSO opt
 *     in via a top-level `squidEvents: true` under `fleet:` in its pd-fleet.yml
 *     (read from the trusted default branch — parseFleetSquidEvents in
 *     src/fleet.ts; default false). Events carry the tenant's repo name, PR
 *     numbers, verdicts, and stacked-PR urls onto a shared relay; the
 *     operator's env wiring alone is not the tenant's consent. `tenantOptIn`
 *     is a required parameter so no call site can forget the gate.
 *   - NEVER throws. NEVER awaited by callers. NEVER blocks or changes a run,
 *     a verdict, or the merge gate. A lost event is a lost event.
 */

import * as ed from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';

// @noble/ed25519's synchronous sign/getPublicKey need a sync SHA-512 wired
// once at module load (same wiring as apps/relay/src/crypto.ts).
ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m));

/** Envelope schema tag inside every squid body — versioned now, while there is one producer. */
export const SQUID_SCHEMA = 'squid/1';

/** Channel family: full channels are `<relayFp>:fleet-cloud:<runId>`. */
export const SQUID_CHANNEL_FAMILY = 'fleet-cloud';

/** prev_hash of the first event in any chain (relay ZERO_HASH). */
export const ZERO_HASH = '0'.repeat(64);

export type SquidEventType = 'run-started' | 'ship-verdict' | 'pr-stacked' | 'run-concluded';

export interface SquidEventPayload {
  /** `owner/repo` of the PR under review. */
  repo: string;
  /** The reviewed PR number. */
  pr: number;
  /** Deterministic run id (`run:<deliveryId>`). */
  runId: string;
  /** Ship name (ship-verdict / pr-stacked). */
  ship?: string;
  /** Ship verdict or run conclusion (ship-verdict / run-concluded). */
  verdict?: string;
  /** Stacked PR html url (pr-stacked). */
  url?: string;
}

/**
 * The squid/1 body — the plaintext the relay envelope's `ciphertext` slot
 * carries, base64url-encoded. The wire `sender` on the OUTER envelope is the
 * executor's fingerprint (enforced by the relay); the deployment-scoped NAME
 * lives here, where humans and downstream consumers read it.
 */
export interface SquidBody {
  schema: typeof SQUID_SCHEMA;
  /** `fleet-executor@<deployment>` — FLEET_DEPLOYMENT, default 'default'. */
  sender: string;
  type: SquidEventType;
  payload: SquidEventPayload;
}

/** The minimal env surface the squid needs (all optional ⇒ disabled). */
export interface SquidEnv {
  /** The relay's POST /v1/publish endpoint. */
  RELAY_PUBLISH_URL?: string;
  /** Ed25519 seed, 64 hex chars (secret; operator-provisioned). */
  FLEET_EXECUTOR_ED25519_PRIVATE_KEY_HEX?: string;
  /** hv:2 harbor card from POST /v1/fleet/executor-identity (secret). */
  FLEET_EXECUTOR_HARBOR_CARD?: string;
  /** Deployment label in the squid/1 sender name; default 'default'. */
  FLEET_DEPLOYMENT?: string;
}

/** The signed relay envelope this module produces (mirrors relay RelayEvent). */
export interface SquidRelayEvent {
  v: 1;
  sender: string;
  channel: string;
  seq: number;
  prev_hash: string;
  this_hash: string;
  iat: number;
  ciphertext: string;
  sig: string;
}

// ── Small pure helpers (kept formula-identical to apps/relay/src/crypto.ts) ──

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return bytes;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64UrlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = 4 - (padded.length % 4 || 4);
  const bin = atob(padded + '='.repeat(pad === 4 ? 0 : pad));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/**
 * Canonical relay event hash — MUST stay byte-identical to
 * apps/relay/src/crypto.ts computeEventHash, or every publish is rejected with
 * HASH_MISMATCH. Pinned by a shared known-answer vector in both suites
 * (tests/squid-events.test.ts and apps/relay/tests/fleet-executor-identity.test.ts).
 *
 * @returns SHA-256 hex over the '|'-joined canonical fields.
 */
export function computeSquidEventHash(fields: {
  prev_hash: string;
  sender: string;
  channel: string;
  seq: number;
  iat: number;
  ciphertext: string;
}): string {
  const canonical = [
    fields.prev_hash,
    fields.sender,
    fields.channel,
    String(fields.seq),
    String(fields.iat),
    fields.ciphertext,
  ].join('|');
  return toHex(sha256(new TextEncoder().encode(canonical)));
}

// ── Identity derivation ──────────────────────────────────────────────────────

interface SquidIdentity {
  /** 32-byte Ed25519 seed. */
  seed: Uint8Array;
  /** SHA-256 hex of the public key — the relay-side daemon fingerprint. */
  fingerprint: string;
  /** The relay's fingerprint, read from the card's `iss` (relay-issued card). */
  relayFp: string;
  /** The verbatim card JWT to attach to every publish. */
  card: string;
}

// One-entry memo: key material never changes within an isolate, and deriving
// the public key per event would be pointless scalar-mult work.
let cachedIdentity: { keyHex: string; card: string; identity: SquidIdentity | null } | null = null;

/**
 * Derive (and memoize) the executor's publish identity from env.
 *
 * Fails SOFT: any malformation — bad hex, undecodable card, or a card whose
 * `sub` is not the fingerprint of this private key — returns null, which
 * {@link emitSquidEvent} treats as "feature disabled". Misconfiguration must
 * never throw inside a run.
 */
function deriveSquidIdentity(keyHex: string, card: string): SquidIdentity | null {
  if (cachedIdentity && cachedIdentity.keyHex === keyHex && cachedIdentity.card === card) {
    return cachedIdentity.identity;
  }
  let identity: SquidIdentity | null = null;
  try {
    if (/^[0-9a-f]{64}$/i.test(keyHex)) {
      const seed = fromHex(keyHex.toLowerCase());
      const fingerprint = toHex(sha256(ed.getPublicKey(seed)));
      const payloadPart = card.split('.')[1];
      if (payloadPart) {
        const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadPart))) as {
          sub?: string;
          iss?: string;
        };
        if (payload.sub === fingerprint && typeof payload.iss === 'string' && payload.iss.length > 0) {
          identity = { seed, fingerprint, relayFp: payload.iss, card };
        }
      }
    }
  } catch {
    identity = null;
  }
  cachedIdentity = { keyHex, card, identity };
  return identity;
}

// ── Per-channel chain state (in-memory, per isolate — deliberately) ──────────

interface ChainState {
  seq: number;
  prevHash: string;
  /** Serialization tail: events on one channel sign+send strictly in order. */
  tail: Promise<void>;
}

const chains = new Map<string, ChainState>();

/**
 * Fire one squid event. Fire-and-forget by design: the signing + POST are
 * queued on the channel's serialization tail and never awaited by the caller;
 * every rejection is swallowed; any synchronous failure is caught. Returns
 * nothing.
 *
 * `tenantOptIn` is the tenant repo's `squidEvents: true` consent from its
 * trusted-branch pd-fleet.yml (parseFleetSquidEvents). It is REQUIRED and
 * strictly `=== true` gated: anything else ⇒ zero fetches, regardless of the
 * operator's env wiring.
 */
export function emitSquidEvent(
  env: SquidEnv,
  type: SquidEventType,
  payload: SquidEventPayload,
  tenantOptIn: boolean,
): void {
  if (tenantOptIn !== true) return; // tenant has not consented — silently, no fetch
  const url = env.RELAY_PUBLISH_URL;
  const keyHex = env.FLEET_EXECUTOR_ED25519_PRIVATE_KEY_HEX;
  const card = env.FLEET_EXECUTOR_HARBOR_CARD;
  if (!url || !keyHex || !card) return; // feature disabled — silently, no fetch

  try {
    const identity = deriveSquidIdentity(keyHex, card);
    if (!identity) return; // misconfigured key/card pair — silently disabled

    const deployment = env.FLEET_DEPLOYMENT && env.FLEET_DEPLOYMENT.length > 0
      ? env.FLEET_DEPLOYMENT
      : 'default';
    const channel = `${identity.relayFp}:${SQUID_CHANNEL_FAMILY}:${payload.runId}`;

    let state = chains.get(channel);
    if (!state) {
      state = { seq: 0, prevHash: ZERO_HASH, tail: Promise.resolve() };
      chains.set(channel, state);
    }

    const chained = state; // stable reference for the closure
    chained.tail = chained.tail
      .then(async () => {
        const body: SquidBody = {
          schema: SQUID_SCHEMA,
          sender: `fleet-executor@${deployment}`,
          type,
          payload,
        };
        const ciphertext = base64UrlEncode(new TextEncoder().encode(JSON.stringify(body)));
        const seq = chained.seq + 1;
        const prev_hash = chained.prevHash;
        const iat = Math.floor(Date.now() / 1000);
        const this_hash = computeSquidEventHash({
          prev_hash,
          sender: identity.fingerprint,
          channel,
          seq,
          iat,
          ciphertext,
        });
        const sig = toHex(ed.sign(fromHex(this_hash), identity.seed));
        // Advance the local chain BEFORE the fetch settles: the relay's chain
        // check is authoritative, and a lost event is a lost event (a later
        // event whose prev points at it is rejected there, never retried here).
        chained.seq = seq;
        chained.prevHash = this_hash;

        const event: SquidRelayEvent = {
          v: 1,
          sender: identity.fingerprint,
          channel,
          seq,
          prev_hash,
          this_hash,
          iat,
          ciphertext,
          sig,
        };
        // NOTE: the card travels in the body (PublishRequest.card). There is
        // no Authorization header — no bearer dialect exists on this stream.
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ card: identity.card, event }),
        });
      })
      .catch(() => undefined); // never let a squid event disturb the run
  } catch {
    // Never let a squid event disturb the run.
  }
}

// ── Awaited chained publish (mediator transport) ─────────────────────────────

/** What one awaited chained publish did — honest, enumerated. */
export interface ChainedPublishResult {
  ok: boolean;
  /** 'disabled' (identity/env absent), 'network' (fetch threw), or the relay's error code. */
  code: string | null;
  /** HTTP status from the relay, when a response arrived. */
  status: number | null;
  /** Chain coordinates on success (the DELIVERY RECEIPT into the chain). */
  seq: number | null;
  hash: string | null;
  channel: string | null;
  /** The relay's parsed response body (for callers that need more). */
  body: unknown;
}

/**
 * Sign one event on a fleet-cloud channel and POST it — AWAITED.
 *
 * This is the mediator's transport (grand-plan node mediator-body): a summons
 * must NEVER be fire-and-forget, so unlike {@link emitSquidEvent} the caller
 * awaits the result and reads the relay's answer — the returned (seq, hash)
 * is the delivery receipt the summons ledger records. It shares this module's
 * per-channel chain state and identity memo, so mediator events and squid
 * telemetry on the same channel would chain correctly together (in practice
 * they use disjoint channel suffixes), and it serializes on the channel tail
 * so an interleaved fire-and-forget event cannot fork the chain.
 *
 * Same hard contract as the squid otherwise: missing env ⇒ `disabled` with
 * ZERO fetches; a mismatched key/card pair ⇒ `disabled`; it never throws.
 *
 * @param env The squid env surface (identity + publish URL).
 * @param channelSuffix Channel WITHIN the fleet-cloud family, e.g.
 *        `mediator:owner-repo` → full channel `<relayFp>:fleet-cloud:<suffix>`.
 * @param bodyObj JSON-serializable event body (rides base64url in ciphertext).
 * @param url The relay endpoint to POST `{ card, event }` to — /v1/publish
 *        or a mediator route that delegates to it.
 */
export async function publishChainedEvent(
  env: SquidEnv,
  channelSuffix: string,
  bodyObj: unknown,
  url: string,
): Promise<ChainedPublishResult> {
  const none: ChainedPublishResult = { ok: false, code: 'disabled', status: null, seq: null, hash: null, channel: null, body: null };
  const keyHex = env.FLEET_EXECUTOR_ED25519_PRIVATE_KEY_HEX;
  const card = env.FLEET_EXECUTOR_HARBOR_CARD;
  if (!url || !keyHex || !card) return none;
  const identity = deriveSquidIdentity(keyHex, card);
  if (!identity) return none;

  const channel = `${identity.relayFp}:${SQUID_CHANNEL_FAMILY}:${channelSuffix}`;
  let state = chains.get(channel);
  if (!state) {
    state = { seq: 0, prevHash: ZERO_HASH, tail: Promise.resolve() };
    chains.set(channel, state);
  }
  const chained = state;

  // Serialize behind any in-flight event on this channel, then sign + send.
  const run = chained.tail.catch(() => undefined).then(async (): Promise<ChainedPublishResult> => {
    const ciphertext = base64UrlEncode(new TextEncoder().encode(JSON.stringify(bodyObj)));
    const seq = chained.seq + 1;
    const prev_hash = chained.prevHash;
    const iat = Math.floor(Date.now() / 1000);
    const this_hash = computeSquidEventHash({
      prev_hash,
      sender: identity.fingerprint,
      channel,
      seq,
      iat,
      ciphertext,
    });
    const sig = toHex(ed.sign(fromHex(this_hash), identity.seed));
    // Advance the local chain before the fetch settles — the relay's chain
    // check is authoritative, exactly as in emitSquidEvent.
    chained.seq = seq;
    chained.prevHash = this_hash;

    const event: SquidRelayEvent = {
      v: 1,
      sender: identity.fingerprint,
      channel,
      seq,
      prev_hash,
      this_hash,
      iat,
      ciphertext,
      sig,
    };
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card: identity.card, event }),
      });
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      const b = body as { code?: string } | null;
      return {
        ok: res.status === 200 || res.status === 201,
        code: res.status === 200 || res.status === 201 ? null : (b?.code ?? String(res.status)),
        status: res.status,
        seq,
        hash: this_hash,
        channel,
        body,
      };
    } catch {
      return { ok: false, code: 'network', status: null, seq, hash: this_hash, channel, body: null };
    }
  });
  // Keep the channel tail joined so later fire-and-forget events serialize.
  chained.tail = run.then(() => undefined, () => undefined);
  return run;
}

/**
 * Await every in-flight squid publish (all channel tails). For tests and for
 * teardown paths that WANT best-effort delivery before an isolate exits;
 * production call sites still never await {@link emitSquidEvent} itself.
 */
export async function flushSquidEvents(): Promise<void> {
  await Promise.all([...chains.values()].map((s) => s.tail.catch(() => undefined)));
}

/**
 * Drop all per-channel chain state and the memoized identity. TESTS ONLY —
 * production code must never reset a live chain (the relay would reject the
 * restarted seq as SEQ_MISMATCH, exactly as it should).
 */
export function resetSquidChains(): void {
  chains.clear();
  cachedIdentity = null;
}
