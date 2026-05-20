/**
 * SMS / iMessage output sink.
 *
 * Same two-backend story as the SMS trigger:
 *   - macOS iMessage via osascript -> Messages.app (default on darwin)
 *   - Twilio REST API for actual SMS
 *
 * STUBBED. Operator setup required:
 *   - iMessage: Messages.app must be signed in; Automation permission
 *     must be granted to the daemon binary.
 *   - Twilio: PD_TWILIO_ACCOUNT_SID + PD_TWILIO_AUTH_TOKEN +
 *     PD_TWILIO_FROM_NUMBER
 *
 * Consent posture:
 *   SMS is treated as high-PII (sends to phone numbers, can incur
 *   charges, surfaces on lock screens). Always consent-gated.
 */

import { getSharedConsentGate } from '../consent-gate.js';
import type {
  OutputAvailability,
  OutputPayload,
  OutputResult,
  OutputSink,
} from '../types.js';

export class SmsOutputSink implements OutputSink {
  readonly kind = 'sms' as const;

  async available(): Promise<OutputAvailability> {
    const route = chooseRoute();
    if (route === 'imessage-macos') {
      return {
        ready: true,
        reason: 'macOS iMessage via osascript (requires Automation access to Messages.app).',
        requires: ['Automation access to Messages.app in System Settings → Privacy'],
      };
    }
    if (route === 'twilio') {
      const ok = Boolean(
        process.env.PD_TWILIO_ACCOUNT_SID &&
        process.env.PD_TWILIO_AUTH_TOKEN &&
        process.env.PD_TWILIO_FROM_NUMBER,
      );
      if (!ok) {
        return {
          ready: false,
          reason: 'Twilio credentials missing.',
          requires: ['PD_TWILIO_ACCOUNT_SID', 'PD_TWILIO_AUTH_TOKEN', 'PD_TWILIO_FROM_NUMBER'],
        };
      }
      return { ready: true };
    }
    return {
      ready: false,
      reason: 'No SMS route configured.',
      requires: ['PD_SMS_BACKEND'],
    };
  }

  async dispatch(payload: OutputPayload): Promise<OutputResult> {
    if (payload.sink !== 'sms') {
      throw new Error(`SmsOutputSink received payload for sink="${payload.sink}"`);
    }
    if (payload.type !== 'send' && payload.type !== 'reply') {
      throw new Error(`SmsOutputSink: unknown subtype "${payload.type}"`);
    }
    if (!payload.recipient) throw new Error('sms:send requires payload.recipient (phone or iMessage handle)');
    if (!payload.body) throw new Error('sms:send requires payload.body');

    getSharedConsentGate().assertAllowed('sms', { ...payload, pii: 'high' });

    const route = chooseRoute();
    return route === 'twilio' ? this.dispatchTwilio(payload) : this.dispatchIMessage(payload);
  }

  // ── stubs ──────────────────────────────────────────────────────────────

  /**
   * STUBBED. Real implementation uses osascript:
   *   tell application "Messages"
   *     send "<body>" to buddy "<recipient>" of service id "<iMessageServiceId>"
   *   end tell
   * The service id needs a one-time discovery pass.
   */
  private async dispatchIMessage(payload: OutputPayload): Promise<OutputResult> {
    return {
      id: payload.idempotency_key ?? `sms:imessage:${Date.now()}`,
      deliveredAt: Date.now(),
      receipt: { stubbed: true, backend: 'imessage', to: payload.recipient, body: payload.body?.slice(0, 80) },
    };
  }

  /**
   * STUBBED. Real implementation POSTs to
   *   https://api.twilio.com/2010-04-01/Accounts/<sid>/Messages.json
   * with basic auth using the account sid + auth token.
   */
  private async dispatchTwilio(payload: OutputPayload): Promise<OutputResult> {
    return {
      id: payload.idempotency_key ?? `sms:twilio:${Date.now()}`,
      deliveredAt: Date.now(),
      receipt: { stubbed: true, backend: 'twilio', to: payload.recipient, body: payload.body?.slice(0, 80) },
    };
  }
}

function chooseRoute(): 'imessage-macos' | 'twilio' | 'none' {
  const env = (process.env.PD_SMS_BACKEND ?? '').toLowerCase();
  if (env === 'twilio') return 'twilio';
  if (env === 'imessage') return 'imessage-macos';
  if (process.platform === 'darwin') return 'imessage-macos';
  return 'none';
}
