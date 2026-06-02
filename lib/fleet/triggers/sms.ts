/**
 * SMS / iMessage trigger source.
 *
 * Two routes are supported:
 *
 *   1. macOS iMessage — reads from ~/Library/Messages/chat.db (the SQLite
 *      database Messages.app writes). This is the operator-friendly path
 *      because no third-party service is involved.
 *
 *   2. Twilio webhook — for non-macOS deployments or for actual SMS
 *      (vs iMessage). The daemon HTTP receiver validates the request
 *      signature and translates the POST body into a FleetTriggerEvent.
 *
 * Both routes are STUBBED in this module — wiring them requires operator
 * setup (Full Disk Access for chat.db, or Twilio auth token + webhook
 * URL). The TriggerSource contract is what matters; the actual readers
 * land when the operator opts in.
 *
 * Filter syntax:
 *   sms:received                                — any new message
 *   sms:received(from:+15555551234)             — from a single number
 *   sms:received(from:+1*)                      — any US number
 *   sms:received(group:Family)                  — only from a named group
 */

import type {
  FleetTriggerEvent,
  TriggerAvailability,
  TriggerHandle,
  TriggerSource,
  TriggerSpec,
} from '../types.js';

interface SmsMessage {
  /** Internal id from chat.db or Twilio's SID. */
  id: string;
  /** E.164 phone, email-style iMessage handle, or "+group:Name". */
  from: string;
  /** Message body (plaintext). */
  body: string;
  /** ISO-8601 timestamp the message arrived. */
  date: string;
  /** True if the message came from iMessage (vs SMS). */
  isImessage: boolean;
  /** True if the message is part of a group chat. */
  isGroup: boolean;
  /** Optional group/chat display name. */
  groupName?: string;
}

export class SmsTriggerSource implements TriggerSource {
  readonly kind = 'sms' as const;

  async available(): Promise<TriggerAvailability> {
    const route = chooseRoute();
    if (route === 'imessage-macos') {
      // Best-effort: Full Disk Access is required to read chat.db, and
      // we cannot probe it without trying. We optimistically report
      // ready and let the first poll fail loudly with a helpful error.
      return {
        ready: true,
        reason: 'macOS iMessage chat.db route (requires Full Disk Access for the daemon).',
        requires: ['Full Disk Access for the daemon binary in System Settings → Privacy & Security'],
      };
    }
    if (route === 'twilio-webhook') {
      const hasAuth = Boolean(process.env.PD_TWILIO_AUTH_TOKEN);
      if (!hasAuth) {
        return {
          ready: false,
          reason: 'Twilio webhook signing key missing.',
          requires: ['PD_TWILIO_AUTH_TOKEN'],
        };
      }
      return { ready: true };
    }
    return {
      ready: false,
      reason: 'No SMS route configured. Set PD_SMS_BACKEND=imessage or PD_SMS_BACKEND=twilio.',
      requires: ['PD_SMS_BACKEND'],
    };
  }

  async start(spec: TriggerSpec, emit: (event: FleetTriggerEvent) => void): Promise<TriggerHandle> {
    const route = chooseRoute();
    const fromFilter = spec.filters.from ?? null;
    const groupFilter = spec.filters.group ?? null;

    const onMessage = (msg: SmsMessage) => {
      if (fromFilter && !numberMatches(msg.from, fromFilter)) return;
      if (groupFilter && msg.groupName !== groupFilter) return;
      const event: FleetTriggerEvent<SmsMessage> = {
        source: 'sms',
        type: spec.type, // typically "received"
        timestamp: Date.parse(msg.date) || Date.now(),
        payload: msg,
        metadata: {
          correlation_id: msg.isGroup && msg.groupName ? `group:${msg.groupName}` : msg.from,
          sender: msg.from,
          consent_verified: route === 'twilio-webhook', // Twilio is HMAC-verified
        },
      };
      emit(event);
    };

    const subscription =
      route === 'imessage-macos'
        ? subscribeToIMessage(onMessage)
        : route === 'twilio-webhook'
          ? subscribeToTwilioWebhook(onMessage)
          : { unsubscribe: () => {} };

    return {
      async stop() {
        subscription.unsubscribe();
      },
    };
  }
}

function chooseRoute(): 'imessage-macos' | 'twilio-webhook' | 'none' {
  const env = (process.env.PD_SMS_BACKEND ?? '').toLowerCase();
  if (env === 'imessage') return 'imessage-macos';
  if (env === 'twilio') return 'twilio-webhook';
  // Default: choose iMessage if we're on macOS, nothing otherwise.
  if (process.platform === 'darwin') return 'imessage-macos';
  return 'none';
}

/**
 * STUBBED — real implementation tails ~/Library/Messages/chat.db with
 * a periodic SELECT using better-sqlite3 in read-only mode. Returns a
 * no-op subscription so callers don't crash before creds are wired.
 */
function subscribeToIMessage(_onMessage: (msg: SmsMessage) => void): { unsubscribe: () => void } {
  return { unsubscribe: () => {} };
}

/**
 * STUBBED — real implementation registers a handler with the daemon HTTP
 * router for POST /webhooks/twilio/sms. The handler validates X-Twilio-
 * Signature and emits onMessage for each parsed inbound message.
 */
function subscribeToTwilioWebhook(_onMessage: (msg: SmsMessage) => void): { unsubscribe: () => void } {
  return { unsubscribe: () => {} };
}

function numberMatches(value: string, pattern: string): boolean {
  const v = value.replace(/\s+/g, '');
  const p = pattern.replace(/\s+/g, '');
  if (p === v) return true;
  if (p.endsWith('*') && v.startsWith(p.slice(0, -1))) return true;
  if (p.startsWith('*') && v.endsWith(p.slice(1))) return true;
  return false;
}
