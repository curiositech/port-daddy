/**
 * Generic webhook trigger source — turns an arbitrary inbound HTTP POST
 * into a FleetTriggerEvent. This is the escape hatch: anything not
 * covered by the typed sources (Zapier, Tasker, n8n, a Raspberry Pi door
 * sensor, your bank's transaction notifier) can dispatch into a fleet
 * via this source.
 *
 * Spec syntax:
 *   webhook:my-channel                     — listen on /webhooks/my-channel
 *   webhook:my-channel(secret:HMAC_VAR)    — require X-PD-Webhook-Signature
 *
 * The daemon owns the HTTP receiver (routes/webhooks.ts when wired). This
 * source registers a handler with that router and emits events as POSTs
 * arrive. Until the receiver lands the registration is a stub that
 * returns an empty handle — the operator can still parse the yml and
 * the dry-run path validates the spec.
 */

import { verifyWebhookHmac } from '../webhook-hmac.js';
import type {
  FleetTriggerEvent,
  TriggerAvailability,
  TriggerHandle,
  TriggerSource,
  TriggerSpec,
} from '../types.js';

interface WebhookPayload {
  /** The channel slug from the spec ("my-channel"). */
  channel: string;
  /** Inbound HTTP headers (lowercased keys). */
  headers: Record<string, string>;
  /** Parsed body — JSON if Content-Type is application/json, else raw string. */
  body: unknown;
  /** Source IP (best-effort; behind a proxy this is the proxy's IP). */
  sourceIp?: string;
}

export interface WebhookTriggerDeps {
  /**
   * The daemon's webhook router exposes a registration primitive. We
   * inject it instead of importing so this module stays a leaf. The
   * registration returns a deregister fn the source uses on stop().
   *
   * When the daemon hasn't wired the router yet, pass a no-op shim.
   */
  registerHandler: (
    channel: string,
    handler: (req: WebhookRequest) => Promise<WebhookResponse>,
  ) => () => void;
}

export interface WebhookRequest {
  headers: Record<string, string>;
  body: unknown;
  rawBody: Buffer;
  ip?: string;
}

export interface WebhookResponse {
  status: number;
  body?: unknown;
}

export class WebhookTriggerSource implements TriggerSource {
  readonly kind = 'webhook' as const;

  constructor(private readonly deps: WebhookTriggerDeps) {}

  async available(): Promise<TriggerAvailability> {
    return { ready: true };
  }

  async start(spec: TriggerSpec, emit: (event: FleetTriggerEvent) => void): Promise<TriggerHandle> {
    // The channel slug rides in `spec.type` (the part after `webhook:`).
    const channel = spec.type;
    if (!channel || channel === 'received') {
      throw new Error('webhook trigger requires a channel slug: webhook:<channel>');
    }

    const secretEnvVar = spec.filters.secret ?? null;
    const expectedSecret = secretEnvVar ? process.env[secretEnvVar] ?? null : null;
    // Fail closed (ADR-0093 §5.3): a spec that DECLARES HMAC verification but
    // whose secret env var is unset must refuse to start, not silently run
    // without verification. Silent no-HMAC turns a typo into an open endpoint.
    if (secretEnvVar && !expectedSecret) {
      throw new Error(
        `webhook trigger "${channel}" declares secret:${secretEnvVar} but that ` +
        `environment variable is not set; refusing to start without HMAC ` +
        `verification (fail-closed)`,
      );
    }

    const deregister = this.deps.registerHandler(channel, async (req) => {
      // If the spec asked for HMAC verification, enforce it.
      if (expectedSecret) {
        const signature = req.headers['x-pd-webhook-signature'] ?? '';
        if (!verifyWebhookHmac(req.rawBody, expectedSecret, signature)) {
          return { status: 401, body: { error: 'invalid signature' } };
        }
      }

      const payload: WebhookPayload = {
        channel,
        headers: req.headers,
        body: req.body,
        sourceIp: req.ip,
      };

      const event: FleetTriggerEvent<WebhookPayload> = {
        source: 'webhook',
        type: channel,
        timestamp: Date.now(),
        payload,
        metadata: {
          correlation_id: req.headers['x-pd-correlation-id'] ?? `webhook:${channel}:${Date.now()}`,
          // NEVER copy an attacker-controllable header (x-pd-sender) into
          // `sender`: the trust gate upgrades allowlisted senders, so a
          // spoofable sender is a tier-escalation primitive (ADR-0093 §5.3).
          // The source IP is the only transport fact we report.
          sender: req.ip,
          // Transport authentication ≠ content trust (ADR-0093 invariant #1).
          // A valid HMAC proves the RELAY holds the secret, not that the
          // payload AUTHOR is trusted. consent_verified may only be set by a
          // content-level author verification, which no webhook has.
          consent_verified: false,
        },
      };
      emit(event);
      return { status: 200, body: { received: true } };
    });

    return {
      async stop() {
        deregister();
      },
    };
  }
}

