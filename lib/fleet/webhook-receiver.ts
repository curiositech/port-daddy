/**
 * Fleet webhook receiver — the daemon-owned registry between the HTTP
 * surface (routes/fleet-webhooks.ts) and the fleet engine's webhook trigger
 * sources (lib/fleet/triggers/webhook.ts). I/O wiring Phase 2.
 *
 * Ownership boundary:
 *   - The ROUTE owns HTTP: body parsing, raw-body capture, status codes.
 *   - THIS MODULE owns the channel→handler map and delivery.
 *   - The TRIGGER SOURCE owns semantics: HMAC verification (fail-closed when
 *     `secret:VAR` is declared), event shaping, and the metadata contract
 *     (sender = source IP only; consent_verified NEVER set from transport —
 *     ADR-0093 invariant #1).
 *
 * Trust posture: everything delivered here is ANONYMOUS_EXTERNAL until the
 * engine's trust gate says otherwise. The receiver adds no trust of its own;
 * it is a dumb, observable pipe with two safety properties:
 *   1. Channel registrations are EXCLUSIVE. Two agents (or two projects)
 *      claiming the same channel is a configuration error surfaced at
 *      trigger-start time, never a silent fan-out an attacker can widen.
 *   2. Delivery to an unregistered channel is a typed 404, never a buffer.
 *      There is no queue here — backpressure and approval live behind the
 *      trust gate (L2), not in the transport.
 */

export interface ReceivedWebhookRequest {
  /** Lowercased header names. */
  headers: Record<string, string>;
  /** Parsed body (JSON if the content type was JSON, else raw string). */
  body: unknown;
  /** Exact bytes received — HMAC verification needs the unparsed body. */
  rawBody: Buffer;
  /** Remote address (behind a proxy this is the proxy). */
  ip?: string;
}

export interface ReceivedWebhookResponse {
  status: number;
  body?: unknown;
}

export type WebhookChannelHandler = (
  req: ReceivedWebhookRequest,
) => Promise<ReceivedWebhookResponse>;

/** Channel slugs: path-safe, no traversal, no empties. */
const CHANNEL_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export class FleetWebhookReceiver {
  private readonly handlers = new Map<string, WebhookChannelHandler>();

  /**
   * Register a handler for a channel. Returns the deregister function the
   * trigger source calls on stop(). Throws on an invalid slug or a channel
   * already claimed — the engine surfaces that as a trigger-start refusal.
   */
  registerHandler(channel: string, handler: WebhookChannelHandler): () => void {
    if (!CHANNEL_PATTERN.test(channel)) {
      throw new Error(
        `webhook channel "${channel}" is not a valid slug (lowercase alphanumerics, dash, underscore; max 64 chars)`,
      );
    }
    if (this.handlers.has(channel)) {
      throw new Error(
        `webhook channel "${channel}" is already registered; channels are exclusive per daemon`,
      );
    }
    this.handlers.set(channel, handler);
    return () => {
      // Only deregister our own registration (a stale stop() after a
      // re-register must not evict the new owner).
      if (this.handlers.get(channel) === handler) {
        this.handlers.delete(channel);
      }
    };
  }

  /** Deliver an inbound request to a channel's handler. */
  async deliver(
    channel: string,
    req: ReceivedWebhookRequest,
  ): Promise<ReceivedWebhookResponse> {
    const handler = this.handlers.get(channel);
    if (!handler) {
      // Same shape for "never existed" and "not currently armed" — an
      // external prober learns nothing about fleet topology.
      return { status: 404, body: { error: 'unknown webhook channel' } };
    }
    try {
      return await handler(req);
    } catch (err) {
      // A handler bug must not leak internals to the caller.
      console.error(
        `[FleetWebhooks] handler for channel "${channel}" threw:`,
        err instanceof Error ? err.message : String(err),
      );
      return { status: 500, body: { error: 'webhook handler error' } };
    }
  }

  /** Currently armed channels (for the fleet sources health board). */
  channels(): string[] {
    return [...this.handlers.keys()].sort();
  }
}

// ─── Shared instance ─────────────────────────────────────────────────────────
// The daemon and the route must see the SAME receiver. Same idiom as
// getSharedConsentGate.

let shared: FleetWebhookReceiver | null = null;

export function getSharedWebhookReceiver(): FleetWebhookReceiver {
  if (!shared) shared = new FleetWebhookReceiver();
  return shared;
}

export function setSharedWebhookReceiver(receiver: FleetWebhookReceiver | null): void {
  shared = receiver;
}
