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
        const sender = url.searchParams.get('sender') ?? '';
        const limitPerMin = parseInt(url.searchParams.get('limit') ?? '60', 10);
        const allowed = this.checkRateLimit(sender, limitPerMin);
        return Response.json({ allowed });
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
