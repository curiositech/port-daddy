/**
 * Daemon-side relay client (ADR-0049)
 *
 * Manages the outbound connection from a local PD daemon to the relay:
 *   1. Reads relay URL from daemon config (pd config set relay <url>)
 *   2. Performs the handshake (ClientHello → ServerHello)
 *   3. Opens the SSE subscribe stream and routes events to local tube channels
 *   4. Publishes events to the relay on behalf of local channels
 *   5. Reconnects with exponential backoff on disconnect
 *
 * This module is daemon-side only (no Cloudflare Workers types).
 * The relay Worker lives in apps/relay/.
 *
 * Dependencies: lib/harbor-tokens.ts (card issuance), lib/merkle-chain.ts
 * (event chain), lib/event-envelope.ts (wire format).
 *
 * Config:
 *   Relay URL stored in daemon config table: key = 'relay_url'.
 *   Disabled if relay_url is null or empty.
 */

import { createHash, randomBytes } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import type { ClassifiedTransit } from './relay-seal.js';

export const RELAY_CONFIG_KEY = 'relay_url';
export const RELAY_CARD_CONFIG_KEY = 'relay_card';
export const RELAY_RECONNECT_MIN_MS = 1_000;
export const RELAY_RECONNECT_MAX_MS = 60_000;
export const RELAY_HEARTBEAT_INTERVAL_MS = 25_000;

// ── Config ────────────────────────────────────────────────────────────────────

/**
 * Idempotently create the `config` key/value table that relay state lives in.
 *
 * Self-initialization mirrors every other module in this repo (each owns its
 * tables via `CREATE TABLE IF NOT EXISTS`). This table was previously never
 * created anywhere, so getRelayUrl/setRelayUrl threw "no such table: config"
 * the moment the relay routes were exercised — which is part of why the relay
 * surface shipped dead. Ensuring here makes the relay config/status/exchange
 * routes work against a fresh daemon DB. SQLite caches the statement, so the
 * cost on the hot read path is negligible.
 */
export function ensureRelayConfigTable(db: Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT)');
}

export function getRelayUrl(db: Database): string | null {
  ensureRelayConfigTable(db);
  const row = db
    .prepare("SELECT value FROM config WHERE key = ?")
    .get(RELAY_CONFIG_KEY) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setRelayUrl(db: Database, url: string | null): void {
  ensureRelayConfigTable(db);
  if (url === null) {
    db.prepare("DELETE FROM config WHERE key = ?").run(RELAY_CONFIG_KEY);
  } else {
    db.prepare(
      "INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value"
    ).run(RELAY_CONFIG_KEY, url);
  }
}

/**
 * Read the stored harbor card (JWT) the daemon presents in the relay
 * handshake, or null when none has been exchanged yet.
 *
 * Why stored config rather than a file: the card is daemon connection state —
 * the outbound connection manager needs it on every reconnect, across daemon
 * restarts, without the operator re-running the OIDC exchange. It lives in
 * the same self-initialized config table as relay_url.
 *
 * @param db The daemon registry database.
 * @returns The stored card JWT, or null.
 */
export function getRelayCard(db: Database): string | null {
  ensureRelayConfigTable(db);
  const row = db
    .prepare('SELECT value FROM config WHERE key = ?')
    .get(RELAY_CARD_CONFIG_KEY) as { value: string } | undefined;
  return row?.value ?? null;
}

/**
 * Persist (or clear, with null) the harbor card used for relay handshakes.
 *
 * Why one write path: the successful `POST /relay/exchange` — the daemon
 * remembers the card it just obtained so the connection lifecycle can use it
 * without a second operator step.
 *
 * @param db The daemon registry database.
 * @param card The card JWT to store, or null to clear.
 * @returns Nothing — the config row is the output.
 */
export function setRelayCard(db: Database, card: string | null): void {
  ensureRelayConfigTable(db);
  if (card === null) {
    db.prepare('DELETE FROM config WHERE key = ?').run(RELAY_CARD_CONFIG_KEY);
  } else {
    db.prepare(
      'INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'
    ).run(RELAY_CARD_CONFIG_KEY, card);
  }
}

// ── Handshake ─────────────────────────────────────────────────────────────────

export interface ClientHello {
  v: 1;
  client_hello: true;
  card: string;
  subscriptions: string[];
  nonce_c: string;
  sig: string;
}

export interface ServerHello {
  v: 1;
  server_hello: true;
  session_id: string;
  nonce_c: string;
  nonce_s: string;
  accepted_subs: { channel: string; tip_seq: number | null; tip_hash: string | null }[];
  rejected_subs: { channel: string; reason: string }[];
  sig: string;
  relay_pub_key: string;
}

// S7 (fixed): verify relay's ServerHello signature using the PINNED key.
// Verifying against serverHello.relay_pub_key (the self-reported value) is circular —
// a MITM can return their own key + valid signature. We must verify against a key
// we obtained out-of-band (pinnedRelayPubKey) or persisted from a prior TOFU session.
//
// TOFU behaviour (first-run only):
//   - If no pin is stored, trust the first key seen and persist it.
//   - On all subsequent handshakes, reject any deviation from the stored key.
//   - Operators can rotate by explicitly calling clearRelayKeyPin(db).
async function verifyServerHelloSig(
  serverHello: ServerHello,
  nonceC: string,
  keyToVerifyWith: string   // MUST be the pinned key, never serverHello.relay_pub_key
): Promise<boolean> {
  // Use Node's built-in crypto (Ed25519 supported since Node 15, stable in Node 20).
  // @noble/ed25519 is only installed in apps/relay — do not import it here.
  const { createPublicKey, verify: cryptoVerify } = await import('node:crypto');
  const msg = createHash('sha256')
    .update([serverHello.session_id, nonceC, serverHello.nonce_s].join('|'))
    .digest();
  const pubKeyDer = Buffer.concat([
    // DER prefix for Ed25519 SubjectPublicKeyInfo (RFC 8410)
    Buffer.from('302a300506032b6570032100', 'hex'),
    Buffer.from(keyToVerifyWith, 'hex'),
  ]);
  const pubKey = createPublicKey({ key: pubKeyDer, format: 'der', type: 'spki' });
  const sigBytes = Buffer.from(serverHello.sig, 'hex');
  return cryptoVerify(null, msg, pubKey, sigBytes);
}

const RELAY_PINNED_KEY_CONFIG_KEY = 'relay_pinned_pub_key';

export function getRelayPinnedKey(db: Database): string | null {
  ensureRelayConfigTable(db);
  const row = db
    .prepare('SELECT value FROM config WHERE key = ?')
    .get(RELAY_PINNED_KEY_CONFIG_KEY) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setRelayPinnedKey(db: Database, pubKeyHex: string): void {
  ensureRelayConfigTable(db);
  db.prepare(
    'INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'
  ).run(RELAY_PINNED_KEY_CONFIG_KEY, pubKeyHex);
}

export function clearRelayKeyPin(db: Database): void {
  ensureRelayConfigTable(db);
  db.prepare('DELETE FROM config WHERE key = ?').run(RELAY_PINNED_KEY_CONFIG_KEY);
}

export async function performHandshake(
  relayUrl: string,
  card: string,
  subscriptions: string[],
  signerFn: (msgHex: string) => Promise<string>,
  db: Database  // required: used for TOFU key pinning
): Promise<ServerHello> {
  const nonceC = randomBytes(32).toString('hex');

  const msg = createHash('sha256').update(card + nonceC).digest('hex');
  const sig = await signerFn(msg);

  const hello: ClientHello = { v: 1, client_hello: true, card, subscriptions, nonce_c: nonceC, sig };

  const resp = await fetch(`${relayUrl}/v1/handshake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(hello),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new RelayError('HANDSHAKE_FAILED', `Handshake failed ${resp.status}: ${text}`);
  }

  const serverHello = await resp.json() as ServerHello;

  if (serverHello.nonce_c !== nonceC) {
    throw new RelayError('NONCE_MISMATCH', 'Relay did not echo our nonce_c');
  }

  // S7 (TOFU): resolve the key to verify against — never trust the self-reported value
  let pinnedKey = getRelayPinnedKey(db);

  if (!pinnedKey) {
    // First-ever handshake: TOFU — trust and pin the key we see
    pinnedKey = serverHello.relay_pub_key;
    setRelayPinnedKey(db, pinnedKey);
  } else if (pinnedKey !== serverHello.relay_pub_key) {
    // Key changed — reject immediately (even before sig check)
    throw new RelayError(
      'RELAY_KEY_CHANGED',
      `Relay public key changed from pinned value. If intentional, run: pd relay unpin`
    );
  }

  // Verify signature against the pinned key (not self-reported)
  const sigValid = await verifyServerHelloSig(serverHello, nonceC, pinnedKey);
  if (!sigValid) {
    throw new RelayError('BAD_RELAY_SIG', 'ServerHello signature verification failed');
  }

  return serverHello;
}

// ── SSE subscription ──────────────────────────────────────────────────────────

export interface RelayEvent {
  type: 'event' | 'revocation' | 'heartbeat';
  payload: string;
}

export type EventHandler = (event: RelayEvent) => void;
export type ErrorHandler = (err: Error) => void;

export interface RelaySubscription {
  close(): void;
}

/**
 * Open the SSE subscribe stream for a handshaken session and route its events.
 *
 * Why `onOpen` exists: the status surface must never claim connected when it
 * is not, and the only moment that claim becomes TRUE is when the relay has
 * accepted the stream (HTTP 200 on the subscribe fetch) — not when the
 * connection attempt started, and not when the handshake succeeded. `onOpen`
 * fires at exactly that moment so a status manager can flip `connected` on
 * evidence instead of intent.
 *
 * @param relayUrl Relay origin.
 * @param sessionId Session from the handshake's ServerHello.
 * @param fromSeq Resume cursor for the event stream.
 * @param onEvent Receives each parsed relay event (events, revocations, heartbeats).
 * @param onError Receives the terminal error for this stream (a closed stream included) — the reconnect trigger.
 * @param onOpen Optional: fires once when the relay accepts the stream.
 * @returns A handle whose close() tears the stream down without firing onError.
 */
export function subscribeRelay(
  relayUrl: string,
  sessionId: string,
  fromSeq: number,
  onEvent: EventHandler,
  onError: ErrorHandler,
  onOpen?: () => void
): RelaySubscription {
  let closed = false;
  let controller: AbortController | null = null;

  const connect = async () => {
    if (closed) return;

    controller = new AbortController();
    const url = `${relayUrl}/v1/subscribe/${sessionId}?from_seq=${fromSeq}`;

    try {
      const resp = await fetch(url, {
        headers: { 'Accept': 'text/event-stream' },
        signal: controller.signal,
      });

      if (!resp.ok || !resp.body) {
        throw new RelayError('SSE_CONNECT_FAILED', `SSE connect ${resp.status}`);
      }

      // The stream is accepted: this — not the attempt, not the handshake —
      // is the moment "connected" becomes a true statement.
      onOpen?.();

      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buffer = '';

      while (!closed) {
        const { done, value } = await reader.read();
        if (done) {
          // Stream ended normally — treat as a disconnect so the reconnect loop fires
          if (!closed) onError(new RelayError('SSE_CLOSED', 'SSE stream closed by relay'));
          break;
        }

        buffer += dec.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6)) as RelayEvent;
              onEvent(event);
            } catch {
              // malformed event — skip
            }
          }
        }
      }
    } catch (err) {
      if (!closed) {
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  };

  void connect();

  return {
    close() {
      closed = true;
      controller?.abort();
    },
  };
}

// ── Publish ───────────────────────────────────────────────────────────────────

export interface PublishOptions {
  event: {
    v: 1;
    sender: string;
    channel: string;
    seq: number;
    prev_hash: string;
    this_hash: string;
    iat: number;
    /**
     * The transit body — a CLASSIFIED envelope only (ADR-0123 §6 N1).
     *
     * Why the branded type and not `string`: {@link ClassifiedTransit} has no
     * inhabitants outside lib/relay-seal.ts's classification chokepoint, so
     * the compiler — not a reviewer — rejects any call site that tries to put
     * an unclassified body on the wire. This field is the daemon's only public
     * entry to the publish wire, which is what makes "every relay-bound event
     * passes through the chokepoint" a construction rather than a convention.
     */
    ciphertext: ClassifiedTransit;
    sig: string;
  };
  card?: string;
  authHeader?: string;
}

export async function publishToRelay(
  relayUrl: string,
  opts: PublishOptions
): Promise<{ seq: number; this_hash: string }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.authHeader) headers['Authorization'] = opts.authHeader;

  const resp = await fetch(`${relayUrl}/v1/publish`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ event: opts.event, card: opts.card }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new RelayError('PUBLISH_FAILED', `Publish failed ${resp.status}: ${text}`);
  }

  return resp.json() as Promise<{ seq: number; this_hash: string }>;
}

// ── Revocation ────────────────────────────────────────────────────────────────

export async function revokeOnRelay(
  relayUrl: string,
  jti: string,
  signerFn: (msgHex: string) => Promise<string>,
  cardJwt: string,
  reason?: string
): Promise<void> {
  const msgHex = createHash('sha256').update('revoke:' + jti).digest('hex');
  const sig = await signerFn(msgHex);

  const resp = await fetch(`${relayUrl}/v1/revoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cardJwt}`,
    },
    body: JSON.stringify({ jti, sig, reason }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new RelayError('REVOKE_FAILED', `Revoke failed ${resp.status}: ${text}`);
  }
}

// ── Reconnect loop ────────────────────────────────────────────────────────────

/**
 * Optional collaborators for {@link RelayConnectionManager}.
 *
 * Design intent: the manager owns exactly one loop (session → stream →
 * backoff → retry). Everything a *status surface* or a *test* needs is
 * injected here — the open/error signals so status reflects evidence, and the
 * subscribe/sleep functions so the lifecycle is provable without a network or
 * a wall clock.
 */
export interface RelayConnectionManagerOptions {
  /** Fires when the relay ACCEPTS the SSE stream — the only honest moment to report connected. */
  onConnect?: () => void;
  /** Receives the terminal error of each stream/connect attempt, before onDisconnect. */
  onError?: (err: Error) => void;
  /** Stream opener; defaults to {@link subscribeRelay}. Injectable for tests. */
  subscribeFn?: typeof subscribeRelay;
  /** Delay primitive; defaults to a real setTimeout sleep. Injectable for tests. */
  sleepFn?: (ms: number) => Promise<void>;
}

export class RelayConnectionManager {
  private subscription: RelaySubscription | null = null;
  private reconnectDelay = RELAY_RECONNECT_MIN_MS;
  private stopped = false;

  constructor(
    private readonly relayUrl: string,
    private readonly getSession: () => Promise<{ sessionId: string; fromSeq: number } | null>,
    private readonly onEvent: EventHandler,
    private readonly onDisconnect?: () => void,
    private readonly options: RelayConnectionManagerOptions = {}
  ) {}

  start(): void {
    void this.connectWithRetry();
  }

  stop(): void {
    this.stopped = true;
    this.subscription?.close();
    this.subscription = null;
  }

  private async connectWithRetry(): Promise<void> {
    const subscribeFn = this.options.subscribeFn ?? subscribeRelay;
    const sleepFn = this.options.sleepFn ?? sleep;
    while (!this.stopped) {
      const session = await this.getSession();
      if (!session) {
        await sleepFn(this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, RELAY_RECONNECT_MAX_MS);
        continue;
      }

      await new Promise<void>((resolve) => {
        this.subscription = subscribeFn(
          this.relayUrl,
          session.sessionId,
          session.fromSeq,
          this.onEvent,
          (err) => {
            this.options.onError?.(err);
            this.onDisconnect?.();
            resolve();
          },
          () => {
            // A stream the relay accepted is the definition of a successful
            // connection, so the backoff resets HERE — resetting on the
            // attempt would defeat backoff, and never resetting (the old
            // behavior) made a daemon that had been up for a week retry a
            // blip at the 60s ceiling as if it were flapping.
            this.reconnectDelay = RELAY_RECONNECT_MIN_MS;
            this.options.onConnect?.();
          }
        );
      });

      if (!this.stopped) {
        await sleepFn(this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, RELAY_RECONNECT_MAX_MS);
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Errors ────────────────────────────────────────────────────────────────────

export class RelayError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'RelayError';
  }
}
