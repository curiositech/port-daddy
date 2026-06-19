/**
 * Port Daddy internal output sink — drops a message into an actor inbox,
 * a tuple space, or a coordination channel.
 *
 * Subtypes:
 *   inbox(actor:user)        — write to the operator's actor inbox
 *   channel(name:foo:bar)    — publish on a fleet channel
 *   note                     — append a note to the current session
 *
 * No external network. No PII leaves the daemon. Consent gate is still
 * consulted for pii=high payloads as a paper-trail discipline — the
 * audit log is the operator's after-the-fact view of what fleets wrote.
 */

import { getSharedConsentGate } from '../consent-gate.js';
import type {
  OutputAvailability,
  OutputPayload,
  OutputResult,
  OutputSink,
} from '../types.js';

export interface PdOutputDeps {
  /**
   * Inject the daemon's internal write primitive. This sink intentionally
   * does NOT call the HTTP API — it talks to in-process objects so we
   * don't take a round-trip on the loopback for our own coordination.
   */
  appendNote: (sessionId: string, content: string) => Promise<{ id: string }>;
  sendToInbox: (actor: string, message: { title?: string; body?: string }) => Promise<{ id: string }>;
  publishChannel: (channel: string, message: unknown) => Promise<void>;
}

export class PdOutputSink implements OutputSink {
  readonly kind = 'pd' as const;

  constructor(private readonly deps: PdOutputDeps) {}

  async available(): Promise<OutputAvailability> {
    return { ready: true };
  }

  async dispatch(payload: OutputPayload): Promise<OutputResult> {
    if (payload.sink !== 'pd') {
      throw new Error(`PdOutputSink received payload for sink="${payload.sink}"`);
    }

    if ((payload.pii ?? 'none') === 'high') {
      // Paper-trail enforcement even for local-only writes.
      getSharedConsentGate().assertAllowed('pd', payload);
    }

    switch (payload.type) {
      case 'inbox': {
        const actor = String(payload.extras?.actor ?? payload.recipient ?? '');
        if (!actor) throw new Error('pd:inbox requires extras.actor or recipient');
        const result = await this.deps.sendToInbox(actor, { title: payload.title, body: payload.body });
        return {
          id: result.id,
          deliveredAt: Date.now(),
          receipt: { actor, route: 'inbox' },
        };
      }
      case 'channel': {
        const channel = String(payload.extras?.name ?? payload.recipient ?? '');
        if (!channel) throw new Error('pd:channel requires extras.name or recipient');
        await this.deps.publishChannel(channel, { title: payload.title, body: payload.body, extras: payload.extras });
        return { id: `pd:channel:${channel}:${Date.now()}`, deliveredAt: Date.now(), receipt: { channel } };
      }
      case 'note': {
        const sessionId = String(payload.extras?.sessionId ?? payload.correlation_id ?? '');
        if (!sessionId) throw new Error('pd:note requires extras.sessionId or correlation_id');
        const result = await this.deps.appendNote(sessionId, payload.body ?? payload.title ?? '');
        return { id: result.id, deliveredAt: Date.now(), receipt: { sessionId } };
      }
      default:
        throw new Error(`PdOutputSink: unknown subtype "${payload.type}"`);
    }
  }
}
