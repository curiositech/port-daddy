/**
 * Fleet trigger + output sink types — the universal event language for
 * always-on agents that consume from email/SMS/calendar/file-watch/etc.
 * and write to calendar/notifications/email/SMS/webhooks/etc.
 *
 * Why this exists:
 *   The original fleet shape was GitHub/git-bound. Triggers were channels
 *   like `git:committed` and outputs were ad-hoc shell exec lines. That's
 *   fine for repo automation, but the operator wants the same primitive
 *   to power personal-agent use cases — a morning briefing, a commitment
 *   extractor, an end-of-day reflector. Those agents don't live in a repo.
 *   They live in your day.
 *
 *   So we factor "where the event came from" and "where the answer goes"
 *   into pluggable registries with a uniform FleetTriggerEvent /
 *   OutputPayload contract. The yaml shape stays additive: existing
 *   pd-fleet.yml files still work.
 *
 * Naming note:
 *   lib/fleet-engine.ts already exports `FleetEvent` for agent-lifecycle
 *   events (agent_started / agent_completed / etc). To avoid the
 *   collision, this module uses `FleetTriggerEvent` for source-emitted
 *   events. They serve different roles and live in different namespaces.
 */

// ─── Source identities ─────────────────────────────────────────────────────

/**
 * Canonical list of trigger sources. Adding a new source means:
 *   1. Implement `TriggerSource` in `lib/fleet/triggers/<name>.ts`
 *   2. Register it in `lib/fleet/triggers/index.ts`
 *   3. Add the literal here so the yml parser can validate it.
 */
export type TriggerSourceKind =
  | 'github'
  | 'git'
  | 'schedule'
  | 'email'
  | 'sms'
  | 'calendar'
  | 'file'
  | 'webhook'
  | 'pd';

/**
 * Canonical list of output sinks. Same rules as triggers.
 */
export type OutputSinkKind =
  | 'github'
  | 'notify'
  | 'calendar'
  | 'email'
  | 'sms'
  | 'webhook'
  | 'file'
  | 'pd';

// ─── Event envelope ────────────────────────────────────────────────────────

/**
 * The uniform event shape every trigger source emits. The router doesn't
 * need to know whether the event came from a GitHub webhook or a polled
 * IMAP inbox — only the `source` and `type` discriminator plus a typed
 * payload.
 *
 * `metadata.correlation_id` is the thread-key for reply outputs. If an
 * email triggers a fleet agent that wants to reply to that same thread,
 * the agent reads `event.metadata.correlation_id` and forwards it into
 * the output dispatch.
 */
export interface FleetTriggerEvent<TPayload = unknown> {
  /** Which source produced this event. */
  source: TriggerSourceKind;
  /** Source-specific event subtype. Examples:
   *  - github: "pull_request:opened", "push", "issue:commented"
   *  - email: "received", "filtered"
   *  - sms: "received"
   *  - calendar: "event-starting", "event-ended"
   *  - file: "changed", "created", "deleted"
   *  - webhook: arbitrary user-defined slug
   *  - pd: "note-added", "claim-released", etc. */
  type: string;
  /** Unix epoch ms when the event was observed by the trigger source. */
  timestamp: number;
  /** Source-specific structured payload. Keep it JSON-serializable so the
   *  daemon can persist a copy for replay/debug. */
  payload: TPayload;
  /** Cross-source metadata for threading + privacy controls. */
  metadata: {
    /** Thread/conversation id for reply-style outputs. */
    correlation_id?: string;
    /** Human-readable sender (email From, SMS originator, GH actor). */
    sender?: string;
    /** Optional subject/title (email subject, calendar event title). */
    subject?: string;
    /** True if the trigger source already verified the operator opted in
     *  to this stream (e.g. webhook with valid HMAC, OS-blessed calendar
     *  access). False/undefined means consent-gate must approve before
     *  any output sink touches PII. */
    consent_verified?: boolean;
    /** Anything else the source wants to surface to the agent prompt. */
    [k: string]: unknown;
  };
}

// ─── Trigger source contract ───────────────────────────────────────────────

/**
 * A trigger source is anything that produces FleetTriggerEvents. It owns
 * its own poll loop / webhook handler / fs.watch / whatever — the fleet
 * engine just hands it a callback and asks it to start.
 *
 * The trigger source is responsible for:
 *   - parsing its declarative configuration (the `trigger:` string in yml)
 *   - resolving credentials (or refusing to start if creds are missing)
 *   - producing well-formed FleetTriggerEvents
 *   - clean shutdown when `stop()` returns
 *
 * The fleet engine is responsible for:
 *   - routing the event to the correct ship/agent
 *   - cost accounting, dedupe windows, cooldowns
 *   - persisting the event for replay
 */
export interface TriggerSource {
  /** Canonical name (matches TriggerSourceKind). */
  readonly kind: TriggerSourceKind;
  /**
   * Returns true if the source has whatever it needs to run (creds, OS
   * permissions, reachable host). Called once at fleet boot so the engine
   * can refuse to start ships pointed at unavailable sources with a clear
   * error instead of silently hanging.
   */
  available(): Promise<TriggerAvailability>;
  /**
   * Begin emitting events matching `spec`. Returns a handle the engine
   * uses to stop the source on fleet shutdown.
   */
  start(spec: TriggerSpec, emit: (event: FleetTriggerEvent) => void): Promise<TriggerHandle>;
}

/**
 * Result of a `TriggerSource.available()` probe. Tells the engine
 * whether to even attempt to start the source.
 */
export interface TriggerAvailability {
  ready: boolean;
  /** Human-readable explanation. Surfaced in `pd fleet status` and in
   *  the boot-time log so the operator knows what to configure. */
  reason?: string;
  /** Optional list of env vars / OS permissions the source needs. */
  requires?: string[];
}

/**
 * Parsed form of a `trigger:` yml string. The parser in
 * `lib/fleet/triggers/index.ts` turns strings like
 *   `email:received(from:@team.com)`
 *   `calendar:event-starting(30m)`
 *   `file:changed(~/Documents/notes/)`
 * into this shape so each source can pick out the bits it cares about.
 */
export interface TriggerSpec {
  kind: TriggerSourceKind;
  type: string;
  /** Bare positional arg if no key:value syntax (e.g. "30m" for calendar). */
  arg?: string;
  /** Parsed key:value pairs from the parenthesized portion. */
  filters: Record<string, string>;
  /** Original yml string, preserved for diagnostics + replay. */
  raw: string;
}

export interface TriggerHandle {
  /** Stop the source cleanly. Must be idempotent. */
  stop(): Promise<void>;
}

// ─── Output sink contract ──────────────────────────────────────────────────

/**
 * An output sink is anything that consumes a payload and acts on the
 * outside world: posts a comment, fires a macOS notification, writes a
 * calendar event, sends an email, etc.
 *
 * Sinks MUST be idempotent against `payload.idempotency_key` when one is
 * provided. The fleet engine retries dispatches on transient errors, and
 * a non-idempotent sink would spam the user.
 */
export interface OutputSink {
  /** Canonical name (matches OutputSinkKind). */
  readonly kind: OutputSinkKind;
  /**
   * Returns true if the sink has whatever it needs to dispatch (creds,
   * OS permissions, reachable host). Used at agent-start to fail fast.
   */
  available(): Promise<OutputAvailability>;
  /**
   * Send the payload. Resolves with a result the engine logs (URL, id,
   * delivery receipt). Throws on permanent failure; the engine treats
   * thrown errors as "do not retry" and routes them to `on_failure:`.
   */
  dispatch(payload: OutputPayload): Promise<OutputResult>;
}

export interface OutputAvailability {
  ready: boolean;
  reason?: string;
  requires?: string[];
}

/**
 * The payload an agent (or watcher) hands to an output sink. Most fields
 * are optional because different sinks consume different shapes — a
 * notification needs `title` + `body`, a calendar event needs `start` +
 * `end`, an SMS needs `recipient` + `text`.
 *
 * The agent populates whatever the target sink needs; the sink ignores
 * fields it doesn't recognize but MAY warn the operator about typos.
 */
export interface OutputPayload {
  /** Parsed sink target string (e.g. "calendar:create-event"). */
  sink: OutputSinkKind;
  /** Sink-specific subtype (e.g. "create-event", "send", "comment"). */
  type: string;
  /** Human-readable headline. Notification title, email subject,
   *  GH issue title, calendar event title. */
  title?: string;
  /** Long-form body. Notification body, email body, GH issue body,
   *  file contents. Markdown allowed where the sink renders it. */
  body?: string;
  /** Recipient address. Email To, SMS phone, webhook URL, file path. */
  recipient?: string;
  /** Reply-to thread for sinks that support threading (email, SMS, GH). */
  correlation_id?: string;
  /** For calendar events. ISO-8601 strings; the sink converts to local
   *  representation as needed. */
  start?: string;
  end?: string;
  location?: string;
  /** Idempotency key. Sinks SHOULD dedupe on this so a fleet retry does
   *  not double-fire. */
  idempotency_key?: string;
  /** PII level. Set by the agent. The consent gate (see consent-gate.ts)
   *  refuses dispatches that touch PII unless the operator opted in. */
  pii?: 'none' | 'low' | 'high';
  /** Free-form extension data the sink consumes (calendar attendees,
   *  GH labels, webhook headers, etc). */
  extras?: Record<string, unknown>;
}

export interface OutputResult {
  /** Where the dispatched artifact lives (URL, file path, OS notification id). */
  url?: string;
  id?: string;
  /** Timestamp the sink confirmed delivery. */
  deliveredAt: number;
  /** Free-form sink-specific receipt the engine logs. */
  receipt?: Record<string, unknown>;
}

// ─── Yaml parsing helpers ──────────────────────────────────────────────────

/**
 * Parse a trigger yml string like `email:received(from:@team.com)` into
 * a TriggerSpec. Exported here (not in triggers/index.ts) because the
 * yml validator in `fleet-engine.ts` may want to call it during config
 * load without pulling in every source implementation.
 */
export function parseTriggerSpec(raw: string): TriggerSpec | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Shape: <kind>:<type>(<filters>) — filters optional.
  const match = trimmed.match(/^([a-z]+):([a-z0-9-]+)(?:\((.*)\))?$/i);
  if (!match) return null;

  const [, kind, type, filterBlob] = match;
  const filters: Record<string, string> = {};
  let arg: string | undefined;

  if (filterBlob) {
    // Either "key:value,key:value" pairs or a bare positional like "30m".
    const parts = filterBlob.split(',').map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
      const colon = part.indexOf(':');
      if (colon === -1) {
        // Treat the first bare token as positional `arg`.
        if (arg === undefined) arg = part;
        continue;
      }
      const key = part.slice(0, colon).trim();
      const val = part.slice(colon + 1).trim();
      filters[key] = val;
    }
  }

  // Validate the kind is one we know about.
  const known: TriggerSourceKind[] = [
    'github', 'git', 'schedule', 'email', 'sms', 'calendar', 'file', 'webhook', 'pd',
  ];
  if (!known.includes(kind as TriggerSourceKind)) return null;

  return { kind: kind as TriggerSourceKind, type, arg, filters, raw: trimmed };
}

/**
 * Parse an output yml string like `calendar:create-event` or
 * `file:write(~/notes/today.md)` into a partial OutputPayload (just
 * the routing fields; the agent fills in title/body/etc at dispatch time).
 */
export function parseOutputTarget(raw: string): { sink: OutputSinkKind; type: string; arg?: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^([a-z]+):([a-z0-9-]+)(?:\((.*)\))?$/i);
  if (!match) return null;

  const [, sink, type, arg] = match;
  const known: OutputSinkKind[] = [
    'github', 'notify', 'calendar', 'email', 'sms', 'webhook', 'file', 'pd',
  ];
  if (!known.includes(sink as OutputSinkKind)) return null;

  return { sink: sink as OutputSinkKind, type, arg };
}
