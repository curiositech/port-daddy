/**
 * Email output sink — sends an email through the operator-configured
 * SMTP server.
 *
 * Operator setup required (STUBBED until set):
 *   - PD_EMAIL_SMTP_HOST, PD_EMAIL_SMTP_PORT (default 587),
 *     PD_EMAIL_SMTP_USER, PD_EMAIL_SMTP_PASS, PD_EMAIL_FROM
 *   - Or PD_EMAIL_SENDGRID_KEY / PD_EMAIL_POSTMARK_KEY for a
 *     transactional provider (preferred over raw SMTP for deliverability)
 *
 * Consent posture:
 *   Sending email FROM the operator's account is unambiguously high-PII
 *   and requires an opt-in. The consent record SHOULD include a
 *   recipientAllowlist; the default `pd fleet consent grant --sink email`
 *   refuses to write a wildcard allowlist unless --allow-any-recipient is
 *   passed.
 */

import { getSharedConsentGate } from '../consent-gate.js';
import type {
  OutputAvailability,
  OutputPayload,
  OutputResult,
  OutputSink,
} from '../types.js';

export class EmailOutputSink implements OutputSink {
  readonly kind = 'email' as const;

  async available(): Promise<OutputAvailability> {
    const hasSmtp =
      Boolean(process.env.PD_EMAIL_SMTP_HOST) &&
      Boolean(process.env.PD_EMAIL_SMTP_USER) &&
      Boolean(process.env.PD_EMAIL_SMTP_PASS) &&
      Boolean(process.env.PD_EMAIL_FROM);
    const hasTransactional =
      Boolean(process.env.PD_EMAIL_SENDGRID_KEY || process.env.PD_EMAIL_POSTMARK_KEY) &&
      Boolean(process.env.PD_EMAIL_FROM);
    if (!hasSmtp && !hasTransactional) {
      return {
        ready: false,
        reason: 'Email send requires SMTP or transactional provider credentials.',
        requires: [
          'PD_EMAIL_SMTP_HOST + PD_EMAIL_SMTP_USER + PD_EMAIL_SMTP_PASS + PD_EMAIL_FROM',
          'OR PD_EMAIL_SENDGRID_KEY + PD_EMAIL_FROM',
          'OR PD_EMAIL_POSTMARK_KEY + PD_EMAIL_FROM',
        ],
      };
    }
    return { ready: true };
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

    return this.send(payload);
  }

  // ── stub ───────────────────────────────────────────────────────────────

  /**
   * STUBBED. Real implementation uses nodemailer with the configured
   * transport. Returns the message-id from the SMTP server so we can
   * de-duplicate on retry.
   */
  private async send(payload: OutputPayload): Promise<OutputResult> {
    return {
      id: payload.idempotency_key ?? `email:${Date.now()}`,
      deliveredAt: Date.now(),
      receipt: {
        stubbed: true,
        to: payload.recipient,
        subject: payload.title,
        threadId: payload.correlation_id,
      },
    };
  }
}
