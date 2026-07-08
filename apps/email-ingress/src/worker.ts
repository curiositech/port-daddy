/**
 * Fleet Email Ingress — Cloudflare Worker (I/O wiring Phase 4, email half).
 *
 * INBOUND: Cloudflare Email Routing delivers mail for the operator's domain
 * to this Worker's email() handler. The Worker parses the message, stamps
 * the DMARC verdict, and POSTs an HMAC-signed envelope to the daemon's
 * fleet webhook receiver (`/webhooks/fleet/<channel>`), where the fleet
 * email trigger verifies the HMAC and offers the message to its
 * subscribers — behind the ADR-0093 trust gate. Push-based email IN with
 * zero mailbox credentials.
 *
 * OUTBOUND: POST /send (HMAC-authenticated with a SEPARATE secret) sends
 * mail via the send_email binding. Cloudflare only delivers to VERIFIED
 * Email Routing destination addresses — a structural recipient allowlist
 * on top of the daemon's consent gate.
 *
 * Resilience: when PD_FALLBACK_FORWARD is configured, every inbound message
 * is ALSO forwarded to that (verified) address before we try the daemon —
 * a down daemon can delay fleet triggers, never lose mail.
 */

import PostalMime from 'postal-mime';
import { createMimeMessage } from 'mimetext';
import { EmailMessage } from 'cloudflare:email';
import { buildInboundEnvelope, postWithRetry, signBody, verifySignature } from './envelope.js';
import { dlqAlertActive, dlqDepth, replayDlq, stashEnvelope, DLQ_ALERT_THRESHOLD, type KVLike } from './dlq.js';

export interface EmailIngressEnv {
  /** Daemon (or tunnel) base URL for inbound envelope delivery. */
  PD_FORWARD_URL: string;
  /** HMAC secret for inbound envelopes (shared with the daemon's
   *  PD_EMAIL_INBOUND_SECRET). */
  PD_EMAIL_INBOUND_SECRET: string;
  /** HMAC secret for /send requests (shared with the daemon's
   *  PD_EMAIL_WORKER_SECRET). Distinct from the inbound secret so a leak of
   *  one direction does not grant the other. */
  PD_EMAIL_WORKER_SECRET?: string;
  /** Receiver channel slug. Default: email-inbound. */
  PD_EMAIL_INBOUND_CHANNEL?: string;
  /** From address for /send (must be on this zone's domain). */
  PD_EMAIL_FROM?: string;
  /** Optional verified address that receives a copy of ALL inbound mail. */
  PD_FALLBACK_FORWARD?: string;
  SEND_EMAIL?: SendEmail;
  /** Dead-letter store for envelopes the daemon couldn't take (long
   *  outages); replayed by the cron trigger. */
  ENVELOPE_DLQ?: KVNamespace;
}

interface SendEmail {
  send(message: EmailMessage): Promise<void>;
}

type InboundMessage = ForwardableEmailMessage;

export default {
  /** Email Routing entrypoint. */
  async email(message: InboundMessage, env: EmailIngressEnv, ctx: ExecutionContext): Promise<void> {
    // Never lose mail: fallback-forward first, independent of daemon health.
    if (env.PD_FALLBACK_FORWARD) {
      try {
        await message.forward(env.PD_FALLBACK_FORWARD);
      } catch (err) {
        console.error('fallback forward failed:', err instanceof Error ? err.message : String(err));
      }
    }

    if (!env.PD_FORWARD_URL || !env.PD_EMAIL_INBOUND_SECRET) {
      console.error('email ingress not configured (PD_FORWARD_URL / PD_EMAIL_INBOUND_SECRET); dropping envelope forward');
      return;
    }

    const rawBuf = await new Response(message.raw).arrayBuffer();
    const parsed = await PostalMime.parse(rawBuf);

    const envelope = buildInboundEnvelope({
      from: message.from,
      to: message.to,
      subject: parsed.subject ?? message.headers.get('subject'),
      date: parsed.date ?? null,
      bodyText: parsed.text ?? null,
      hasHtml: Boolean(parsed.html),
      messageId: parsed.messageId ?? message.headers.get('message-id'),
      references: message.headers.get('references'),
      authenticationResults: message.headers.get('authentication-results'),
    });

    const channel = env.PD_EMAIL_INBOUND_CHANNEL || 'email-inbound';
    const body = JSON.stringify(envelope);
    const signature = await signBody(body, env.PD_EMAIL_INBOUND_SECRET);
    const url = new URL(`/webhooks/fleet/${channel}`, env.PD_FORWARD_URL).toString();

    // At-least-once toward the daemon (bounded retries; the daemon-side
    // trigger dedupes by x-pd-delivery-id so retries never double-fire).
    // Exhausted retries dead-letter into KV for the cron to replay — a
    // long daemon outage delays fleet triggers, never loses them.
    const deliveryId = envelope.messageId ?? `email:${envelope.from}:${envelope.date}`;
    ctx.waitUntil(
      postWithRetry(fetch, url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-pd-webhook-signature': signature,
          'x-pd-delivery-id': deliveryId,
        },
        body,
      }).then(async (result) => {
        if (result.ok) return;
        console.error(`daemon envelope delivery failed after ${result.attempts} attempt(s): ${result.error}`);
        if (env.ENVELOPE_DLQ) {
          await stashEnvelope(env.ENVELOPE_DLQ as unknown as KVLike, {
            channel,
            body,
            deliveryId,
            attempts: result.attempts,
          });
        }
      }),
    );
  },

  /** Cron: replay dead-lettered envelopes once the daemon is back. */
  async scheduled(_controller: ScheduledController, env: EmailIngressEnv, ctx: ExecutionContext): Promise<void> {
    if (!env.ENVELOPE_DLQ || !env.PD_FORWARD_URL || !env.PD_EMAIL_INBOUND_SECRET) return;
    ctx.waitUntil(
      replayDlq(
        env.ENVELOPE_DLQ as unknown as KVLike,
        fetch,
        env.PD_FORWARD_URL,
        env.PD_EMAIL_INBOUND_SECRET,
        (msg) => console.error(msg),
      ).then(async (result) => {
        if (result.scanned > 0) {
          console.log(`dlq replay: ${result.delivered} delivered, ${result.kept} kept of ${result.scanned}`);
        }
        // Alert (not just observe): a backlog this deep after a replay pass
        // means the daemon has been unreachable long enough to warrant a look.
        // No PII — a count only. Surfaces the same signal /healthz `dlqAlert`
        // exposes, so an external monitor OR the Worker log both catch it.
        const postReplayDepth = env.ENVELOPE_DLQ
          ? await dlqDepth(env.ENVELOPE_DLQ as unknown as KVLike)
          : result.kept;
        if (dlqAlertActive(postReplayDepth)) {
          console.error(`dlq ALERT: ${postReplayDepth} envelopes undelivered after replay (>= ${DLQ_ALERT_THRESHOLD}); daemon likely unreachable`);
        }
      }),
    );
  },

  /** HTTP entrypoint: health + authenticated outbound send. */
  async fetch(request: Request, env: EmailIngressEnv): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/healthz') {
      const dlq = env.ENVELOPE_DLQ
        ? await dlqDepth(env.ENVELOPE_DLQ as unknown as KVLike)
        : null;
      return Response.json({
        ok: true,
        inbound: Boolean(env.PD_FORWARD_URL && env.PD_EMAIL_INBOUND_SECRET),
        outbound: Boolean(env.SEND_EMAIL && env.PD_EMAIL_WORKER_SECRET && env.PD_EMAIL_FROM),
        dlqDepth: dlq,
        // Monitor hook: an external health check can page on this without
        // needing to know the threshold. Null-safe when the DLQ is unbound.
        dlqAlert: dlqAlertActive(dlq),
      });
    }

    if (request.method === 'POST' && url.pathname === '/send') {
      if (!env.SEND_EMAIL || !env.PD_EMAIL_WORKER_SECRET || !env.PD_EMAIL_FROM) {
        return Response.json({ error: 'outbound send not configured' }, { status: 503 });
      }
      const body = await request.text();
      const ok = await verifySignature(body, env.PD_EMAIL_WORKER_SECRET, request.headers.get('x-pd-webhook-signature'));
      if (!ok) {
        return Response.json({ error: 'invalid signature' }, { status: 401 });
      }

      let parsed: { to?: unknown; subject?: unknown; body?: unknown; correlation_id?: unknown };
      try {
        parsed = JSON.parse(body);
      } catch {
        return Response.json({ error: 'malformed JSON' }, { status: 400 });
      }
      const to = typeof parsed.to === 'string' ? parsed.to.trim() : '';
      const subject = typeof parsed.subject === 'string' ? parsed.subject : '';
      const text = typeof parsed.body === 'string' ? parsed.body : '';
      if (!to || !subject) {
        return Response.json({ error: 'to and subject are required' }, { status: 400 });
      }

      const mime = createMimeMessage();
      mime.setSender({ addr: env.PD_EMAIL_FROM });
      mime.setRecipient(to);
      mime.setSubject(subject);
      mime.addMessage({ contentType: 'text/plain', data: text });

      try {
        await env.SEND_EMAIL.send(new EmailMessage(env.PD_EMAIL_FROM, to, mime.asRaw()));
      } catch (err) {
        // Most common: recipient is not a VERIFIED Email Routing destination.
        const message = err instanceof Error ? err.message : String(err);
        return Response.json({ error: `send_email refused: ${message}` }, { status: 502 });
      }
      return Response.json({ sent: true, to, subject });
    }

    return Response.json({ error: 'not found' }, { status: 404 });
  },
} satisfies ExportedHandler<EmailIngressEnv>;
