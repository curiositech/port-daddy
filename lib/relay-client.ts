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

export const RELAY_CONFIG_KEY = 'relay_url';
export const RELAY_RECONNECT_MIN_MS = 1_000;
export const RELAY_RECONNECT_MAX_MS = 60_000;
export const RELAY_HEARTBEAT_INTERVAL_MS = 25_000;

// ── Config ────────────────────────────────────────────────────────────────────

export function getRelayUrl(db: Database): string | null {
  const row = db
    .prepare("SELECT value FROM config WHERE key = ?")
    .get(RELAY_CONFIG_KEY) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setRelayUrl(db: Database, url: string | null): void {
  if (url === null) {
    db.prepare("DELETE FROM config WHERE key = ?").run(RELAY_CONFIG_KEY);
  } else {
    db.prepare(
      "INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value"
    ).run(RELAY_CONFIG_KEY, url);
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

export async function performHandshake(
  relayUrl: string,
  card: string,
  subscriptions: string[],
  signerFn: (msgHex: string) => Promise<string>,
  _verifyRelayFn?: (relayPubKey: string, sessionId: string, nonceC: string, nonceS: string, sig: string) => Promise<boolean>
): Promise<ServerHello> {
  const nonceC = randomBytes(32).toString('hex');

  // Sign: SHA256(card + nonce_c)
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

export function subscribeRelay(
  relayUrl: string,
  sessionId: string,
  fromSeq: number,
  onEvent: EventHandler,
  onError: ErrorHandler
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

      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buffer = '';

      while (!closed) {
        const { done, value } = await reader.read();
        if (done) break;

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
    ciphertext: string;
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

export class RelayConnectionManager {
  private subscription: RelaySubscription | null = null;
  private reconnectDelay = RELAY_RECONNECT_MIN_MS;
  private stopped = false;

  constructor(
    private readonly relayUrl: string,
    private readonly getSession: () => Promise<{ sessionId: string; fromSeq: number } | null>,
    private readonly onEvent: EventHandler,
    private readonly onDisconnect?: () => void
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
    while (!this.stopped) {
      const session = await this.getSession();
      if (!session) {
        await sleep(this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, RELAY_RECONNECT_MAX_MS);
        continue;
      }

      await new Promise<void>((resolve) => {
        this.subscription = subscribeRelay(
          this.relayUrl,
          session.sessionId,
          session.fromSeq,
          this.onEvent,
          () => {
            this.onDisconnect?.();
            resolve();
          }
        );
      });

      if (!this.stopped) {
        await sleep(this.reconnectDelay);
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
