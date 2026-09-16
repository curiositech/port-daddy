/**
 * Port Daddy Relay — HarborChannel Durable Object (ADR-0049)
 *
 * One DO instance per (harbor_fingerprint, channel) pair.
 * Responsible for:
 *   - Maintaining the set of active SSE subscribers (WebSocket stubs are not
 *     used here — instead we hold a list of WritableStream writers given to us
 *     by the Worker when it upgrades an SSE connection)
 *   - Fan-out: when a publish arrives, write to all active subscriber streams
 *   - Revocation broadcast: relay calls broadcastRevocation(), DO fans out
 *   - Heartbeat emission every 25s via DO alarm
 *   - Rate limiting per publisher per minute (atomic counter)
 *   - Per-harbor presence roster (grand-plan X3 v1): principals heartbeat via
 *     `presence-beat` and are listed via `presence-list`. Entries live in DO
 *     storage keyed `presence:<kind>:<id>` so the roster survives DO eviction.
 *     The DO stores raw last_seen timestamps and does NOT decide who is
 *     "online" — TTL/grace policy lives in the Worker (src/presence.ts),
 *     which also authenticates every beat before it reaches this object.
 *     Expired entries are retained (pruned only after PRESENCE_PRUNE_SECONDS)
 *     because the Helm dead-man rule needs to measure HOW LONG a holder has
 *     been gone, not merely that they are.
 *
 * Note: Workers environment does not support SharedMemory; the DO is the
 * serialization point for all writes to a single channel. This ensures
 * the relay never sends events out of order to a subscriber.
 *
 * SSE fan-out is done via a "push" model:
 *   Worker holds an open SSE Response (ReadableStream).
 *   Worker registers a writer via subscribeWriter().
 *   When a new event arrives at publishEvent(), DO calls write() on all writers.
 *   When the client disconnects, Worker calls unsubscribeWriter().
 */

import type { Env, FanoutMessage } from './types.js';

interface SubscriberWriter {
  sessionId: string;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  fromSeq: number;
}

/** One presence roster entry, as stored in DO storage (X3 v1). */
export interface PresenceEntry {
  kind: 'user' | 'daemon';
  id: string;
  /** Display label captured at beat time: GitHub login / daemon fingerprint. */
  label: string;
  /** Identity tier: 'human' for signed-in operators; the identity registry's
   *  proof_method ('oidc' | 'acme' | 'wot') for daemons. */
  tier: string;
  /** Unix seconds of the last accepted heartbeat. */
  last_seen: number;
}

/** Entries with last_seen older than this are pruned from DO storage. Far
 *  larger than the online TTL (90s) on purpose — see the class doc comment. */
export const PRESENCE_PRUNE_SECONDS = 24 * 3600;

const PRESENCE_PREFIX = 'presence:';

export class HarborChannel implements DurableObject {
  private subscribers = new Map<string, SubscriberWriter>();
  private rateLimitCounters = new Map<string, { count: number; windowStart: number }>();
  private readonly env: Env;
  private readonly state: DurableObjectState;
  private readonly enc = new TextEncoder();

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    switch (action) {
      case 'publish': {
        const body = await request.json() as { event: string };
        await this.fanout({ type: 'event', payload: body.event });
        return new Response(null, { status: 204 });
      }

      case 'revoke': {
        const body = await request.json() as { jti: string; revoked_at: number };
        await this.fanout({
          type: 'revocation',
          payload: JSON.stringify({ jti: body.jti, revoked_at: body.revoked_at }),
        });
        return new Response(null, { status: 204 });
      }

      case 'rate-check': {
        // LEGACY (X8): the publish path now rate-limits via the per-harbor
        // HarborQuota DO (src/harbor-quota.ts), which is durable and does not
        // split per channel. This action remains for (a) the deploy-order
        // fallback while the HARBOR_QUOTA binding is unprovisioned and
        // (b) mercy.ts's side-effect-free do_channel echo probe.
        const sender = url.searchParams.get('sender') ?? '';
        const limitPerMin = parseInt(url.searchParams.get('limit') ?? '60', 10);
        const allowed = this.checkRateLimit(sender, limitPerMin);
        return Response.json({ allowed });
      }

      case 'presence-beat': {
        // Trust boundary: the Worker (src/presence.ts) has already
        // authenticated the principal and checked harbor membership before
        // this call — the DO only records what the member gate admitted.
        const body = await request.json() as PresenceEntry;
        await this.state.storage.put(`${PRESENCE_PREFIX}${body.kind}:${body.id}`, body);
        await this.prunePresence(body.last_seen);
        return new Response(null, { status: 204 });
      }

      case 'presence-list': {
        const map = await this.state.storage.list<PresenceEntry>({ prefix: PRESENCE_PREFIX });
        return Response.json({ entries: [...map.values()] });
      }

      case 'subscribe': {
        // SSE stream upgrade: return a ReadableStream the Worker pipes to the client.
        const sessionId = url.searchParams.get('session_id') ?? '';
        const fromSeq = parseInt(url.searchParams.get('from_seq') ?? '0', 10);
        return this.createSseStream(sessionId, fromSeq);
      }

      default:
        return new Response('Unknown action', { status: 400 });
    }
  }

  async alarm(): Promise<void> {
    // Heartbeat every 25s
    const payload = JSON.stringify({ at: Math.floor(Date.now() / 1000), relay_version: this.env.RELAY_VERSION });
    await this.fanout({ type: 'heartbeat', payload });
    // Re-arm
    await this.scheduleAlarm();
  }

  /** Drop presence entries not seen for PRESENCE_PRUNE_SECONDS (bounds storage
   *  growth; expired-but-recent entries are deliberately KEPT — dead-man). */
  private async prunePresence(now: number): Promise<void> {
    const map = await this.state.storage.list<PresenceEntry>({ prefix: PRESENCE_PREFIX });
    const stale: string[] = [];
    for (const [key, entry] of map) {
      if (now - entry.last_seen > PRESENCE_PRUNE_SECONDS) stale.push(key);
    }
    if (stale.length > 0) await this.state.storage.delete(stale);
  }

  private async scheduleAlarm(): Promise<void> {
    const current = await this.state.storage.getAlarm();
    if (current === null) {
      await this.state.storage.setAlarm(Date.now() + 25_000);
    }
  }

  private async fanout(msg: FanoutMessage): Promise<void> {
    const sseData = `data: ${JSON.stringify(msg)}\n\n`;
    const bytes = this.enc.encode(sseData);
    const dead: string[] = [];

    for (const [sessionId, sub] of this.subscribers) {
      try {
        await sub.writer.write(bytes);
      } catch {
        // Subscriber disconnected
        dead.push(sessionId);
      }
    }

    for (const id of dead) {
      this.subscribers.delete(id);
    }
  }

  private createSseStream(sessionId: string, _fromSeq: number): Response {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();

    this.subscribers.set(sessionId, {
      sessionId,
      writer,
      fromSeq: _fromSeq,
    });

    // Arm heartbeat alarm if not already armed
    void this.scheduleAlarm();

    // Send initial comment to keep connection alive
    void writer.write(this.enc.encode(': connected\n\n'));

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  private checkRateLimit(sender: string, limitPerMin: number): boolean {
    const now = Date.now();
    const windowMs = parseInt(this.env.RATE_LIMIT_WINDOW_MS, 10);
    const entry = this.rateLimitCounters.get(sender);

    if (!entry || now - entry.windowStart >= windowMs) {
      this.rateLimitCounters.set(sender, { count: 1, windowStart: now });
      return true;
    }

    if (entry.count >= limitPerMin) return false;
    entry.count++;
    return true;
  }
}

// ── DO stub key ───────────────────────────────────────────────────────────────

export function harborChannelKey(harborFingerprint: string, channel: string): string {
  return `${harborFingerprint}:${channel}`;
}
