/**
 * Email trigger source — emits one FleetTriggerEvent per inbound message
 * that matches the spec's filter predicates. Two delivery modes:
 *
 * 1. INBOUND WEBHOOK (preferred, Phase 4 via Cloudflare Email Routing):
 *    A Cloudflare Email Worker (apps/email-ingress) receives mail for the
 *    operator's domain, parses it, and POSTs an HMAC-signed envelope to
 *    the daemon's fleet webhook receiver on the reserved channel
 *    `email-inbound`. Push-based: no mailbox creds, no polling.
 *    Setup: set PD_EMAIL_INBOUND_SECRET (shared with the Worker) and
 *    point an Email Routing rule at the deployed Worker.
 *
 * 2. IMAP POLLING (fallback): polls a mailbox. STUBBED until an operator
 *    wires PD_EMAIL_IMAP_HOST/USER/PASS (or PD_EMAIL_OAUTH_TOKEN).
 *
 * Filter syntax (from yml):
 *   email:received(from:newsletter@*)
 *   email:received(from:@team.com,subject:standup)
 *   email:received  (no filter — every new message)
 *
 * Trust posture (ADR-0093): the envelope HMAC authenticates the RELAY
 * (our Worker), never the message author — it does not set
 * consent_verified. What CAN set consent_verified is a DMARC pass
 * attested by the ingress infrastructure: DMARC is a content-author
 * (domain-level) verification performed on the message itself, so
 * `dmarc:"pass"` + an operator-allowlisted author upgrades the event to
 * AUTHENTICATED_EXTERNAL. Either way the trust gate still requires
 * operator approval for every external tier.
 */

import { verifyWebhookHmac } from '../webhook-hmac.js';
import type { WebhookTriggerDeps } from './webhook.js';
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
  /** DMARC verdict attested by the ingress infrastructure (inbound-webhook
   *  mode only): 'pass' | 'fail' | 'none'. */
  dmarc?: string;
}

export interface EmailTriggerOptions {
  /** Poll interval in ms. Default 60_000. */
  pollMs?: number;
  /** IMAP folder. Default INBOX. */
  folder?: string;
}

export interface EmailTriggerDeps {
  /** The daemon's webhook receiver registration primitive (same one the
   *  generic webhook source uses). Absent in bare CLI/test contexts —
   *  inbound-webhook mode then reports itself unavailable. */
  registerHandler?: WebhookTriggerDeps['registerHandler'];
}

/** Reserved receiver channel the email ingress Worker posts to. A spec can
 *  override with `channel:<slug>` when routing several addresses to
 *  several fleets. */
const DEFAULT_INBOUND_CHANNEL = 'email-inbound';

function inboundSecret(): string | null {
  return process.env.PD_EMAIL_INBOUND_SECRET || null;
}

function hasImapCreds(): boolean {
  const host = process.env.PD_EMAIL_IMAP_HOST;
  const user = process.env.PD_EMAIL_IMAP_USER;
  const pass = process.env.PD_EMAIL_IMAP_PASS;
  const oauth = process.env.PD_EMAIL_OAUTH_TOKEN;
  return Boolean(host && user && (pass || oauth));
}

interface InboundSubscriber {
  fromFilter: string | null;
  subjectFilter: string | null;
  emit: (event: FleetTriggerEvent) => void;
}

export class EmailTriggerSource implements TriggerSource {
  readonly kind = 'email' as const;

  /** Per-channel fan-out: several agents in one fleet may declare email
   *  triggers with different filters; the receiver channel is registered
   *  once and every inbound message is offered to every subscriber. */
  private readonly inbound = new Map<string, { deregister: () => void; subscribers: Set<InboundSubscriber> }>();
  /** Dedup by Message-Id across subscribers/redeliveries (bounded). */
  private readonly seenMessageIds = new Set<string>();

  constructor(private readonly opts: EmailTriggerOptions = {}, private readonly deps: EmailTriggerDeps = {}) {}

  async available(): Promise<TriggerAvailability> {
    if (inboundSecret() && this.deps.registerHandler) return { ready: true };
    if (hasImapCreds()) return { ready: true };
    return {
      ready: false,
      reason:
        'Email trigger needs a delivery path: inbound-webhook mode (Cloudflare ' +
        'Email Worker, no mailbox creds) or IMAP credentials.',
      requires: [
        'PD_EMAIL_INBOUND_SECRET (+ deployed apps/email-ingress Worker)',
        'OR PD_EMAIL_IMAP_HOST + PD_EMAIL_IMAP_USER + PD_EMAIL_IMAP_PASS/PD_EMAIL_OAUTH_TOKEN',
      ],
    };
  }

  async start(spec: TriggerSpec, emit: (event: FleetTriggerEvent) => void): Promise<TriggerHandle> {
    const secret = inboundSecret();
    if (secret && this.deps.registerHandler) {
      return this.startInbound(spec, emit, secret);
    }
    return this.startImapPoll(spec, emit);
  }

  // ── Inbound-webhook mode (Cloudflare Email Routing → Worker → daemon) ────

  private startInbound(
    spec: TriggerSpec,
    emit: (event: FleetTriggerEvent) => void,
    secret: string,
  ): TriggerHandle {
    const channel = spec.filters.channel ?? DEFAULT_INBOUND_CHANNEL;
    const subscriber: InboundSubscriber = {
      fromFilter: spec.filters.from ?? null,
      subjectFilter: spec.filters.subject ?? null,
      emit,
    };

    let entry = this.inbound.get(channel);
    if (!entry) {
      const subscribers = new Set<InboundSubscriber>();
      const deregister = this.deps.registerHandler!(channel, async (req) => {
        // HMAC is MANDATORY in inbound mode — the envelope crosses the
        // public internet from our Worker. Fail closed on a bad or missing
        // signature.
        const signature = req.headers['x-pd-webhook-signature'] ?? '';
        if (!verifyWebhookHmac(req.rawBody, secret, signature)) {
          return { status: 401, body: { error: 'invalid signature' } };
        }
        const msg = parseInboundEnvelope(req.body);
        if (!msg) {
          return { status: 400, body: { error: 'malformed email envelope' } };
        }
        const dedupeKey = msg.messageId ?? msg.uid;
        if (this.seenMessageIds.has(dedupeKey)) {
          return { status: 200, body: { received: true, deduped: true } };
        }
        this.seenMessageIds.add(dedupeKey);
        if (this.seenMessageIds.size > 5000) {
          // Bounded memory: drop the oldest half. Redelivery storms are the
          // Worker's problem to rate-limit; this is a backstop.
          const keep = [...this.seenMessageIds].slice(-2500);
          this.seenMessageIds.clear();
          for (const k of keep) this.seenMessageIds.add(k);
        }

        let matched = 0;
        for (const sub of subscribers) {
          if (sub.fromFilter && !addressMatches(msg.from, sub.fromFilter)) continue;
          if (sub.subjectFilter && !msg.subject.toLowerCase().includes(sub.subjectFilter.toLowerCase())) continue;
          matched += 1;
          sub.emit({
            source: 'email',
            type: spec.type || 'received',
            timestamp: Date.parse(msg.date) || Date.now(),
            payload: msg,
            metadata: {
              correlation_id: msg.messageId ?? msg.uid,
              sender: msg.from,
              subject: msg.subject,
              // ADR-0093 invariant #1: the envelope HMAC (transport) never
              // sets this. A DMARC pass is a content-author verification
              // performed on the message itself by the ingress infra — that
              // is what may upgrade an allowlisted author.
              consent_verified: msg.dmarc === 'pass',
            },
          });
        }
        return { status: 200, body: { received: true, matched } };
      });
      entry = { deregister, subscribers };
      this.inbound.set(channel, entry);
    }
    entry.subscribers.add(subscriber);

    const inboundMap = this.inbound;
    return {
      async stop() {
        const current = inboundMap.get(channel);
        if (!current) return;
        current.subscribers.delete(subscriber);
        if (current.subscribers.size === 0) {
          current.deregister();
          inboundMap.delete(channel);
        }
      },
    };
  }

  // ── IMAP polling mode (fallback; fetch is still stubbed) ─────────────────

  private async startImapPoll(spec: TriggerSpec, emit: (event: FleetTriggerEvent) => void): Promise<TriggerHandle> {
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
 * Parse + validate an inbound envelope POSTed by the email ingress Worker.
 * Strict on the fields the trust/filter logic depends on (from, subject),
 * lenient on the rest. Returns null (→ HTTP 400) on garbage — a malformed
 * envelope is a bug or an attack, never something to guess at.
 */
function parseInboundEnvelope(body: unknown): EmailMessage | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const from = typeof b.from === 'string' ? b.from.trim() : '';
  if (!from) return null;
  const subject = typeof b.subject === 'string' ? b.subject : '';
  const messageId = typeof b.messageId === 'string' && b.messageId ? b.messageId : undefined;
  return {
    uid: messageId ?? `inbound:${from}:${typeof b.date === 'string' ? b.date : ''}:${subject}`,
    from,
    to: Array.isArray(b.to) ? b.to.filter((t): t is string => typeof t === 'string') : [],
    subject,
    date: typeof b.date === 'string' ? b.date : new Date().toISOString(),
    bodyText: typeof b.bodyText === 'string' ? b.bodyText : '',
    hasHtml: Boolean(b.hasHtml),
    messageId,
    references: Array.isArray(b.references)
      ? b.references.filter((r): r is string => typeof r === 'string')
      : undefined,
    dmarc: typeof b.dmarc === 'string' ? b.dmarc : 'none',
  };
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
