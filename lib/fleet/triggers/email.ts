/**
 * Email trigger source — polls an IMAP mailbox and emits one
 * FleetTriggerEvent per new message that matches the spec's filter
 * predicates.
 *
 * Filter syntax (from yml):
 *   email:received(from:newsletter@*)
 *   email:received(from:@team.com,subject:standup)
 *   email:received  (no filter — every new message)
 *
 * Operator setup required (this source is STUBBED until creds wire in):
 *   1. Set PD_EMAIL_IMAP_HOST, PD_EMAIL_IMAP_USER, PD_EMAIL_IMAP_PASS
 *      (or PD_EMAIL_OAUTH_TOKEN for Gmail/Outlook OAuth flow).
 *   2. Optional: PD_EMAIL_IMAP_PORT (default 993), PD_EMAIL_IMAP_FOLDER
 *      (default INBOX), PD_EMAIL_POLL_MS (default 60000).
 *   3. Run `pd fleet consent grant --sink email --tier high` before any
 *      ship that REPLIES to email — receiving is opt-in too, granted by
 *      the presence of credentials.
 *
 * Why polling and not push (IDLE):
 *   IDLE works but it's a stateful long-lived TCP connection that has to
 *   be re-established on every network blip. For a personal-agent
 *   running on a laptop, a 1-minute IMAP poll is plenty and never goes
 *   into the "where did my connection go" hole.
 */

import type {
  FleetTriggerEvent,
  TriggerAvailability,
  TriggerHandle,
  TriggerSource,
  TriggerSpec,
} from '../types.js';

interface EmailMessage {
  uid: string;
  from: string;
  to: string[];
  subject: string;
  /** ISO-8601 send time as reported by the SMTP server's Date header. */
  date: string;
  /** Plaintext body (the source SHOULD strip quoted replies before emit). */
  bodyText: string;
  /** True if the message has an HTML alternative. */
  hasHtml: boolean;
  /** Message-Id for threading. */
  messageId?: string;
  /** In-Reply-To / References list for threading. */
  references?: string[];
}

export interface EmailTriggerOptions {
  /** Poll interval in ms. Default 60_000. */
  pollMs?: number;
  /** IMAP folder. Default INBOX. */
  folder?: string;
}

export class EmailTriggerSource implements TriggerSource {
  readonly kind = 'email' as const;

  constructor(private readonly opts: EmailTriggerOptions = {}) {}

  async available(): Promise<TriggerAvailability> {
    const host = process.env.PD_EMAIL_IMAP_HOST;
    const user = process.env.PD_EMAIL_IMAP_USER;
    const pass = process.env.PD_EMAIL_IMAP_PASS;
    const oauth = process.env.PD_EMAIL_OAUTH_TOKEN;

    if (!host || !user || (!pass && !oauth)) {
      return {
        ready: false,
        reason: 'Email trigger requires IMAP credentials. See lib/fleet/triggers/email.ts for setup.',
        requires: ['PD_EMAIL_IMAP_HOST', 'PD_EMAIL_IMAP_USER', 'PD_EMAIL_IMAP_PASS or PD_EMAIL_OAUTH_TOKEN'],
      };
    }
    return { ready: true };
  }

  async start(spec: TriggerSpec, emit: (event: FleetTriggerEvent) => void): Promise<TriggerHandle> {
    const pollMs = this.opts.pollMs ?? Number(process.env.PD_EMAIL_POLL_MS ?? 60_000);
    const folder = this.opts.folder ?? process.env.PD_EMAIL_IMAP_FOLDER ?? 'INBOX';

    const fromFilter = spec.filters.from ?? null;
    const subjectFilter = spec.filters.subject ?? null;

    let seenUids = new Set<string>();
    let firstPoll = true;
    let stopped = false;

    const tick = async () => {
      if (stopped) return;
      try {
        const messages = await fetchUnseenSinceLastPoll(folder);
        for (const msg of messages) {
          if (seenUids.has(msg.uid)) continue;
          seenUids.add(msg.uid);
          // First poll bootstraps the seen-set; do NOT spray every
          // historic inbox message as a trigger event.
          if (firstPoll) continue;
          if (fromFilter && !addressMatches(msg.from, fromFilter)) continue;
          if (subjectFilter && !msg.subject.toLowerCase().includes(subjectFilter.toLowerCase())) continue;

          const event: FleetTriggerEvent<EmailMessage> = {
            source: 'email',
            type: spec.type, // typically "received"
            timestamp: Date.parse(msg.date) || Date.now(),
            payload: msg,
            metadata: {
              correlation_id: msg.messageId ?? msg.uid,
              sender: msg.from,
              subject: msg.subject,
              consent_verified: false, // Email contents are PII by default.
            },
          };
          emit(event);
        }
        firstPoll = false;
      } catch (err) {
        // Soft-fail: log and try again next tick. A broken mail server
        // shouldn't take down the whole fleet.
        console.error('[fleet.email] poll failed:', err instanceof Error ? err.message : err);
      }
    };

    // Trigger sources start fast (first tick on next event loop), then
    // settle into the configured cadence.
    const handle = setInterval(tick, pollMs);
    setImmediate(() => { void tick(); });

    return {
      async stop() {
        stopped = true;
        clearInterval(handle);
      },
    };
  }
}

// ─── Stubs ──────────────────────────────────────────────────────────────────

/**
 * STUBBED — the real implementation imports an IMAP client like
 * `node-imap` or `imapflow` and opens a connection. We return [] so the
 * source is constructable + testable without binding a credential at
 * import time.
 *
 * When the operator wires in real creds:
 *   - Replace this body with imapflow's `fetch` + `parser` pipeline
 *   - Persist last-seen UIDVALIDITY/UID in ~/.port-daddy/email-cursor.json
 *     so daemon restarts don't replay every message
 *   - Honor the existing `PD_EMAIL_OAUTH_TOKEN` path for Gmail/Outlook
 */
async function fetchUnseenSinceLastPoll(_folder: string): Promise<EmailMessage[]> {
  return [];
}

/**
 * Lightweight address matcher. Patterns:
 *   "@team.com"               — any address in the team.com domain
 *   "newsletter@*"            — any newsletter@ on any domain
 *   "alice@example.com"       — exact match
 */
function addressMatches(address: string, pattern: string): boolean {
  const a = address.toLowerCase();
  const p = pattern.toLowerCase();
  if (p === a) return true;
  if (p.startsWith('@') && a.endsWith(p)) return true;
  if (p.endsWith('@*') && a.startsWith(p.slice(0, -1))) return true;
  return false;
}
