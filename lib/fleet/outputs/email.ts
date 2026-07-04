/**
 * Email output sink — sends an email through one of three REAL transports,
 * in preference order:
 *
 *   1. WORKER (zero mailbox creds): POST an HMAC-signed send request to the
 *      operator's deployed apps/email-ingress Worker (`/send`), which uses
 *      Cloudflare Email Routing's send_email binding. Cloudflare only
 *      delivers to addresses the operator has VERIFIED as Email Routing
 *      destinations — a structural recipient allowlist. Setup:
 *      PD_EMAIL_WORKER_URL + PD_EMAIL_WORKER_SECRET.
 *   2. SENDGRID: PD_EMAIL_SENDGRID_KEY + PD_EMAIL_FROM.
 *   3. POSTMARK: PD_EMAIL_POSTMARK_KEY + PD_EMAIL_FROM.
 *
 * Raw SMTP (PD_EMAIL_SMTP_*) is NOT implemented — a config with only SMTP
 * creds reports an honest {ready:false} instead of pretending (build-plan
 * honesty rule; provider APIs beat raw SMTP for deliverability anyway).
 *
 * Consent posture: sending email AS the operator is unambiguously high-PII
 * and requires `pd fleet consent grant --sink email --tier high`. The
 * consent record SHOULD carry a recipientAllowlist.
 */

import { assertSafeOutboundUrl } from '../url-guard.js';
import { getSharedConsentGate } from '../consent-gate.js';
import { createHmac } from 'node:crypto';
import type {
  OutputAvailability,
  OutputPayload,
  OutputResult,
  OutputSink,
} from '../types.js';

type EmailTransport =
  | { kind: 'worker'; url: string; secret: string }
  | { kind: 'sendgrid'; key: string; from: string }
  | { kind: 'postmark'; key: string; from: string };

function resolveTransport(): EmailTransport | null {
  const workerUrl = process.env.PD_EMAIL_WORKER_URL;
  const workerSecret = process.env.PD_EMAIL_WORKER_SECRET;
  if (workerUrl && workerSecret) return { kind: 'worker', url: workerUrl, secret: workerSecret };

  const from = process.env.PD_EMAIL_FROM;
  const sendgrid = process.env.PD_EMAIL_SENDGRID_KEY;
  if (sendgrid && from) return { kind: 'sendgrid', key: sendgrid, from };
  const postmark = process.env.PD_EMAIL_POSTMARK_KEY;
  if (postmark && from) return { kind: 'postmark', key: postmark, from };

  return null;
}

export class EmailOutputSink implements OutputSink {
  readonly kind = 'email' as const;

  /** Injectable for tests; defaults to global fetch. */
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async available(): Promise<OutputAvailability> {
    if (resolveTransport()) return { ready: true };
    const smtpOnly = Boolean(process.env.PD_EMAIL_SMTP_HOST);
    return {
      ready: false,
      reason: smtpOnly
        ? 'Raw SMTP is not implemented; use the email Worker, SendGrid, or Postmark.'
        : 'Email send requires a transport.',
      requires: [
        'PD_EMAIL_WORKER_URL + PD_EMAIL_WORKER_SECRET (apps/email-ingress Worker; no mailbox creds)',
        'OR PD_EMAIL_SENDGRID_KEY + PD_EMAIL_FROM',
        'OR PD_EMAIL_POSTMARK_KEY + PD_EMAIL_FROM',
      ],
    };
  }

  async dispatch(payload: OutputPayload): Promise<OutputResult> {
    if (payload.sink !== 'email') {
      throw new Error(`EmailOutputSink received payload for sink="${payload.sink}"`);
    }
    if (payload.type !== 'send' && payload.type !== 'reply') {
      throw new Error(`EmailOutputSink: unknown subtype "${payload.type}"`);
    }
    if (!payload.recipient) throw new Error('email:send requires payload.recipient');
    if (!payload.title) throw new Error('email:send requires payload.title (subject)');

    // Outbound email is always high-PII regardless of body.
    getSharedConsentGate().assertAllowed('email', { ...payload, pii: 'high' });

    const transport = resolveTransport();
    if (!transport) {
      throw new Error('email sink dispatched with no configured transport (available() should have refused)');
    }
    return this.send(transport, payload);
  }

  private async send(transport: EmailTransport, payload: OutputPayload): Promise<OutputResult> {
    const to = payload.recipient!;
    const subject = payload.title!;
    const body = payload.body ?? '';

    switch (transport.kind) {
      case 'worker': {
        // SSRF guard on the operator-configured URL (defense in depth: the
        // env var is operator-set, but a poisoned .env must not turn the
        // fleet into an internal-network prober).
        assertSafeOutboundUrl(transport.url);
        const requestBody = JSON.stringify({
          to,
          subject,
          body,
          correlation_id: payload.correlation_id ?? null,
          idempotency_key: payload.idempotency_key ?? null,
        });
        const signature = 'sha256=' + createHmac('sha256', transport.secret).update(requestBody).digest('hex');
        const res = await this.fetchImpl(new URL('/send', transport.url).toString(), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-pd-webhook-signature': signature,
          },
          body: requestBody,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`email worker /send returned ${res.status}: ${text.slice(0, 300)}`);
        }
        const receipt = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        return {
          id: payload.idempotency_key ?? `email:${Date.now()}`,
          deliveredAt: Date.now(),
          receipt: { transport: 'worker', to, subject, ...receipt },
        };
      }

      case 'sendgrid': {
        const res = await this.fetchImpl('https://api.sendgrid.com/v3/mail/send', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${transport.key}`,
          },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: to }] }],
            from: { email: transport.from },
            subject,
            content: [{ type: 'text/plain', value: body }],
          }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`SendGrid returned ${res.status}: ${text.slice(0, 300)}`);
        }
        return {
          id: res.headers.get('x-message-id') ?? payload.idempotency_key ?? `email:${Date.now()}`,
          deliveredAt: Date.now(),
          receipt: { transport: 'sendgrid', to, subject },
        };
      }

      case 'postmark': {
        const res = await this.fetchImpl('https://api.postmarkapp.com/email', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            'x-postmark-server-token': transport.key,
          },
          body: JSON.stringify({
            From: transport.from,
            To: to,
            Subject: subject,
            TextBody: body,
          }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`Postmark returned ${res.status}: ${text.slice(0, 300)}`);
        }
        const receipt = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        return {
          id: (receipt.MessageID as string) ?? payload.idempotency_key ?? `email:${Date.now()}`,
          deliveredAt: Date.now(),
          receipt: { transport: 'postmark', to, subject },
        };
      }
    }
  }
}
