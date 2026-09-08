/**
 * `pd tube` core — relay-independent conversational pipe.
 *
 * Design intent (Track B1 of PHONE-INTEGRATION-MASTER-PLAN):
 *   `pd tube` is a one-line conversation pipe over an existing PD channel.
 *   Listen mode prints incoming messages on stdout; --send / --reply read
 *   stdin and post. The primitive is independent of any future relay — it
 *   just speaks to the local daemon's existing `/msg/:channel` surface.
 *
 * Threading model:
 *   The daemon's messaging table doesn't model thread parents, so we wrap
 *   the body in a small envelope:
 *
 *     { v: 1, kind: 'tube.msg', body: <string|json>, inReplyTo?: <id> }
 *
 *   Tube emits both the raw daemon row (id, sender, createdAt) and the
 *   parsed envelope so consumers don't need to know about the wrapping.
 *
 * History guard:
 *   To avoid re-emitting messages the listener already printed (e.g., second
 *   listen invocation overlapping the first window), tube stores a tiny
 *   per-channel cursor at `~/.port-daddy/tube-history-<safe>.json`. The file
 *   now holds `{ lastSeenId, lastForeignEventId?, lastForeignSender?, updatedAt }`.
 *   `lastForeignEventId` is the highest message id NOT authored by this
 *   listener — that's what `--reply <body>` auto-correlates against so an
 *   agent can answer "the last event" without hand-typing parent ids.
 *   The guard is on by default; pass `disableHistory: true` (CLI:
 *   `--no-history`) to opt out.
 *
 * This module is pure-ish: every effectful surface (HTTP client, history
 * store, time) is injected. That keeps it trivial to unit-test without a
 * running daemon.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PD_HOME } from '../shared/paths.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export const TUBE_ENVELOPE_VERSION = 1;
export const TUBE_ENVELOPE_KIND = 'tube.msg';

/**
 * Communicative-act performative (ADR-0047 Phase 0; FIPA ACL narrowed to what
 * Port Daddy's coordination actually needs). A message's performative is its
 * INTENT + OWNERSHIP — `request` blocks the receiver until they act/refuse;
 * `escalate`/`distress` blocks until a human/owner acts; `inform` is fire-and-
 * forget. The Attention Queue + living-harbor viz render messages BY performative.
 */
export type Performative =
  | 'inform'
  | 'request'
  | 'propose'
  | 'accept'
  | 'reject'
  | 'refuse'
  | 'failure'
  | 'cancel'
  | 'query'
  | 'not-understood'
  | 'escalate'
  | 'distress';

export const PERFORMATIVES: readonly Performative[] = [
  'inform', 'request', 'propose', 'accept', 'reject', 'refuse',
  'failure', 'cancel', 'query', 'not-understood', 'escalate', 'distress',
] as const;

function asPerformative(v: unknown): Performative | undefined {
  return typeof v === 'string' && (PERFORMATIVES as readonly string[]).includes(v)
    ? (v as Performative)
    : undefined;
}

/**
 * Argumentative stance of one message toward the message it answers (its
 * `inReplyTo` / `conversationId` context). Where the `performative` types a
 * message's INTENT (FIPA act — request / propose / inform), the `relationship`
 * types its DISCOURSE MOVE — how this contribution relates to the prior one.
 * This is the missing half of jury_rig' `SwarmDiscourse` (port-daddy already
 * ships the act half via ADR-0047 Phase 0) and the substrate RCP-14
 * (argumentative lineage / digest-with-zoom for reasoning provenance) builds on:
 * a thread of `inReplyTo` edges typed by relationship IS the argument graph.
 */
export type DiscourseRelationship =
  | 'supports'
  | 'contradicts'
  | 'extends'
  | 'narrows'
  | 'synthesizes';

export const DISCOURSE_RELATIONSHIPS: readonly DiscourseRelationship[] = [
  'supports', 'contradicts', 'extends', 'narrows', 'synthesizes',
] as const;

function asRelationship(v: unknown): DiscourseRelationship | undefined {
  return typeof v === 'string' && (DISCOURSE_RELATIONSHIPS as readonly string[]).includes(v)
    ? (v as DiscourseRelationship)
    : undefined;
}

/** Typed conversation metadata carried on every tube envelope (ADR-0047 Phase 0). */
export interface ConversationMeta {
  /** The communicative act — the message's intent + ownership. */
  performative?: Performative;
  /**
   * The argumentative stance toward the answered message — the discourse move
   * (RCP-14 argumentative lineage). Meaningful alongside `inReplyTo`.
   */
  relationship?: DiscourseRelationship;
  /** Groups messages into one dialogue/thread across hops. */
  conversationId?: string;
  /** Ordered actor ids this task was delegated through — loop detection (Phase 2). */
  delegationChain?: string[];
}

/**
 * Wire format we publish through `/msg/:channel`. Wrapped in a tiny
 * envelope so threading metadata survives the daemon's untyped `payload`.
 */
export interface TubeEnvelope extends ConversationMeta {
  v: typeof TUBE_ENVELOPE_VERSION;
  kind: typeof TUBE_ENVELOPE_KIND;
  body: string;
  inReplyTo?: number;
}

/**
 * Daemon row shape returned by `GET /msg/:channel`.
 * (Field names mirror lib/messaging.ts `MessagePayload`.)
 */
export interface RawDaemonMessage {
  id: number;
  payload: unknown;
  contentType?: string;
  sender: string | null;
  createdAt: number;
}

/**
 * Decoded tube message — daemon row + parsed envelope.
 */
export interface TubeMessage extends ConversationMeta {
  id: number;
  sender: string | null;
  createdAt: number;
  body: string;
  inReplyTo?: number;
  /** True when payload was a tube envelope; false for foreign messages on the same channel. */
  envelope: boolean;
  /** Raw payload as it came back from the daemon — useful for debug / non-tube messages. */
  raw: unknown;
}

export interface TubeClient {
  publish: (channel: string, payload: unknown, opts?: { sender?: string }) =>
    Promise<{ ok: boolean; id?: number; error?: string }>;
  getMessages: (channel: string, opts?: { after?: number; limit?: number }) =>
    Promise<{ ok: boolean; messages: RawDaemonMessage[]; error?: string }>;
}

/**
 * Persisted listener cursor + threading hints.
 *
 * `lastSeenId` advances past every message we've fetched (ours or theirs).
 * `lastForeignEventId` only advances past messages whose `sender` differs
 * from the listener's `selfSender`. That's what auto-correlated `--reply`
 * targets — the most recent thing somebody else said.
 */
export interface TubeHistoryMeta {
  lastSeenId: number;
  lastForeignEventId?: number;
  lastForeignSender?: string | null;
  updatedAt?: number;
}

/**
 * History store. The legacy pair (`read` / `write`) keeps existing test
 * mocks working — they only need to round-trip `lastSeenId`. The richer
 * pair (`readMeta` / `writeMeta`) is optional; when present, tube will use
 * it to track foreign-event correlation hints. The `readHistory` /
 * `writeHistory` helpers below pick whichever is available.
 */
export interface HistoryStore {
  read: (channel: string) => number | null;
  write: (channel: string, lastSeenId: number) => void;
  readMeta?: (channel: string) => TubeHistoryMeta | null;
  writeMeta?: (channel: string, meta: TubeHistoryMeta) => void;
}

export interface ListenOptions {
  /** Resume cursor: only emit messages with id strictly greater than this. */
  since?: number;
  /** Cap on initial backfill when no cursor exists. Default 50. */
  limit?: number;
  /** Skip and don't update the on-disk history cursor. */
  disableHistory?: boolean;
  /**
   * Sender label this listener uses when posting. Messages whose `sender`
   * matches are treated as our own — they advance `lastSeenId` (so we
   * don't re-fetch them) but are filtered from emit and do not advance
   * `lastForeignEventId`.
   */
  selfSender?: string | null;
  /**
   * Cursor namespace for the on-disk resume history. Defaults to `channel`.
   *
   * MULTI-SUBSCRIBER: the resume cursor is per-`historyKey`, not per-channel.
   * Two listeners on the SAME channel but with DISTINCT keys keep independent
   * cursors, so each receives every message (true fan-out). Without this, two
   * listeners share one channel-keyed cursor file and race — whoever polls
   * first advances it and the other sees nothing. Callers key this by listener
   * identity (e.g. `channel::selfSender`) so distinct identities multiplex and
   * the same identity still resumes across invocations.
   */
  historyKey?: string;
}

export interface ListenResult {
  messages: TubeMessage[];
  lastSeenId: number | null;
  lastForeignEventId: number | null;
  lastForeignSender: string | null;
}

export interface SendOptions {
  sender?: string;
  /**
   * Optional typed conversation metadata (performative / relationship /
   * conversationId / delegationChain) to carry on the envelope. Omitting it
   * preserves the pre-Phase-0 wire format exactly.
   */
  meta?: ConversationMeta;
}

// ─────────────────────────────────────────────────────────────────────────────
// Envelope helpers (pure)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the tube envelope to send over the daemon. `meta` carries the optional
 * ADR-0047 conversation fields (performative / conversationId / delegationChain);
 * omitting it preserves the pre-Phase-0 wire format exactly (back-compatible).
 */
export function buildEnvelope(body: string, inReplyTo?: number, meta?: ConversationMeta): TubeEnvelope {
  const env: TubeEnvelope = {
    v: TUBE_ENVELOPE_VERSION,
    kind: TUBE_ENVELOPE_KIND,
    body,
  };
  if (typeof inReplyTo === 'number' && Number.isFinite(inReplyTo)) {
    env.inReplyTo = inReplyTo;
  }
  if (meta?.performative) env.performative = meta.performative;
  if (meta?.relationship) env.relationship = meta.relationship;
  if (typeof meta?.conversationId === 'string' && meta.conversationId) env.conversationId = meta.conversationId;
  if (Array.isArray(meta?.delegationChain) && meta.delegationChain.length > 0) {
    env.delegationChain = meta.delegationChain.filter((s) => typeof s === 'string');
  }
  return env;
}

/** Pull the typed conversation fields out of a parsed envelope object (validated). */
function readConversationMeta(obj: Record<string, unknown>): ConversationMeta {
  const meta: ConversationMeta = {};
  const perf = asPerformative(obj.performative);
  if (perf) meta.performative = perf;
  const rel = asRelationship(obj.relationship);
  if (rel) meta.relationship = rel;
  if (typeof obj.conversationId === 'string' && obj.conversationId) meta.conversationId = obj.conversationId;
  if (Array.isArray(obj.delegationChain)) {
    const chain = obj.delegationChain.filter((s): s is string => typeof s === 'string');
    if (chain.length > 0) meta.delegationChain = chain;
  }
  return meta;
}

/**
 * Decode a daemon row into a TubeMessage. If the payload isn't a tube
 * envelope (e.g., a `pd pub` from outside tube), the message is still
 * surfaced — `envelope` is false and `body` is a string rendering of
 * whatever came back.
 */
export function decodeMessage(row: RawDaemonMessage): TubeMessage {
  let body: string;
  let inReplyTo: number | undefined;
  let envelope = false;
  let meta: ConversationMeta = {};

  const p = row.payload;
  if (p && typeof p === 'object' && !Array.isArray(p)) {
    const obj = p as Record<string, unknown>;
    if (obj.kind === TUBE_ENVELOPE_KIND && typeof obj.body === 'string') {
      envelope = true;
      body = obj.body;
      if (typeof obj.inReplyTo === 'number' && Number.isFinite(obj.inReplyTo)) {
        inReplyTo = obj.inReplyTo;
      }
      meta = readConversationMeta(obj);
    } else {
      body = JSON.stringify(p);
    }
  } else if (typeof p === 'string') {
    // Daemon may return JSON-typed payloads as already-parsed objects, or as
    // strings for text content. If it's a stringified JSON envelope, try once.
    try {
      const parsed = JSON.parse(p);
      if (parsed && typeof parsed === 'object' && parsed.kind === TUBE_ENVELOPE_KIND && typeof parsed.body === 'string') {
        envelope = true;
        body = parsed.body;
        if (typeof parsed.inReplyTo === 'number' && Number.isFinite(parsed.inReplyTo)) {
          inReplyTo = parsed.inReplyTo;
        }
        meta = readConversationMeta(parsed as Record<string, unknown>);
      } else {
        body = p;
      }
    } catch {
      body = p;
    }
  } else {
    body = String(p ?? '');
  }

  return {
    id: row.id,
    sender: row.sender,
    createdAt: row.createdAt,
    body,
    ...(inReplyTo !== undefined ? { inReplyTo } : {}),
    ...meta,
    envelope,
    raw: row.payload,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// History store (file-based, atomic write via rename)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sanitize a channel name into a filesystem-safe basename. The daemon
 * accepts colons, slashes, and other separator characters in channel names
 * (e.g. `br:repo123:work:tauri:desktop`); the cursor file mustn't.
 */
export function safeChannelSlug(channel: string): string {
  return channel.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'channel';
}

export function defaultHistoryPath(channel: string, baseDir: string = PD_HOME): string {
  return join(baseDir, `tube-history-${safeChannelSlug(channel)}.json`);
}

function readMetaFromPath(path: string): TubeHistoryMeta | null {
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    if (!data || typeof data !== 'object') return null;
    if (typeof data.lastSeenId !== 'number' || !Number.isFinite(data.lastSeenId)) return null;
    const meta: TubeHistoryMeta = { lastSeenId: data.lastSeenId };
    if (typeof data.lastForeignEventId === 'number' && Number.isFinite(data.lastForeignEventId)) {
      meta.lastForeignEventId = data.lastForeignEventId;
    }
    if (typeof data.lastForeignSender === 'string' || data.lastForeignSender === null) {
      meta.lastForeignSender = data.lastForeignSender ?? null;
    }
    if (typeof data.updatedAt === 'number') meta.updatedAt = data.updatedAt;
    return meta;
  } catch {
    return null;
  }
}

function writeMetaToPath(path: string, meta: TubeHistoryMeta): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const payload: TubeHistoryMeta = {
    lastSeenId: meta.lastSeenId,
    updatedAt: meta.updatedAt ?? Date.now(),
  };
  if (meta.lastForeignEventId !== undefined) payload.lastForeignEventId = meta.lastForeignEventId;
  if (meta.lastForeignSender !== undefined) payload.lastForeignSender = meta.lastForeignSender;
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(payload), { mode: 0o600 });
  renameSync(tmp, path);
}

/**
 * File-backed history store. Atomic via tmp+rename.
 * Pass a different `baseDir` (or use `inMemoryHistoryStore`) in tests.
 */
export function createFileHistoryStore(baseDir: string = PD_HOME): HistoryStore {
  return {
    read(channel: string): number | null {
      const meta = readMetaFromPath(defaultHistoryPath(channel, baseDir));
      return meta ? meta.lastSeenId : null;
    },
    write(channel: string, lastSeenId: number): void {
      writeMetaToPath(defaultHistoryPath(channel, baseDir), { lastSeenId });
    },
    readMeta(channel: string): TubeHistoryMeta | null {
      return readMetaFromPath(defaultHistoryPath(channel, baseDir));
    },
    writeMeta(channel: string, meta: TubeHistoryMeta): void {
      writeMetaToPath(defaultHistoryPath(channel, baseDir), meta);
    },
  };
}

/** In-memory store — used in tests and for `--no-history` style flows. */
export function inMemoryHistoryStore(): HistoryStore {
  const map = new Map<string, TubeHistoryMeta>();
  return {
    read(channel: string) {
      const v = map.get(channel);
      return v ? v.lastSeenId : null;
    },
    write(channel: string, lastSeenId: number) {
      const existing = map.get(channel) ?? { lastSeenId };
      map.set(channel, { ...existing, lastSeenId, updatedAt: Date.now() });
    },
    readMeta(channel: string) {
      return map.get(channel) ?? null;
    },
    writeMeta(channel: string, meta: TubeHistoryMeta) {
      map.set(channel, { ...meta, updatedAt: meta.updatedAt ?? Date.now() });
    },
  };
}

/**
 * Read history meta from a store, falling back gracefully when the store
 * only implements the legacy `read` (e.g. older test mocks). Returns
 * `null` when no cursor has been written yet.
 */
export function readHistory(store: HistoryStore, channel: string): TubeHistoryMeta | null {
  if (store.readMeta) return store.readMeta(channel);
  const id = store.read(channel);
  return id !== null ? { lastSeenId: id } : null;
}

/**
 * Write history meta to a store, falling back to the legacy `write` when
 * the rich methods aren't available. Merges with any existing meta so a
 * partial update never wipes `lastForeignEventId`.
 */
export function writeHistory(store: HistoryStore, channel: string, updates: Partial<TubeHistoryMeta> & { lastSeenId: number }): void {
  if (store.writeMeta) {
    const existing = store.readMeta?.(channel) ?? null;
    const merged: TubeHistoryMeta = {
      lastSeenId: updates.lastSeenId,
      updatedAt: Date.now(),
    };
    if (updates.lastForeignEventId !== undefined) merged.lastForeignEventId = updates.lastForeignEventId;
    else if (existing?.lastForeignEventId !== undefined) merged.lastForeignEventId = existing.lastForeignEventId;
    if (updates.lastForeignSender !== undefined) merged.lastForeignSender = updates.lastForeignSender;
    else if (existing?.lastForeignSender !== undefined) merged.lastForeignSender = existing.lastForeignSender;
    store.writeMeta(channel, merged);
  } else {
    store.write(channel, updates.lastSeenId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Core operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One-shot listen pass: pull messages strictly after the resolved cursor,
 * decode them, filter out our own (when `selfSender` is set), and update
 * the persisted meta — `lastSeenId` always advances; `lastForeignEventId`
 * only advances on messages from other senders. The caller is responsible
 * for any loop / interval.
 */
export async function listen(
  channel: string,
  client: TubeClient,
  history: HistoryStore,
  opts: ListenOptions = {},
): Promise<ListenResult> {
  const limit = typeof opts.limit === 'number' && opts.limit > 0 ? opts.limit : 50;

  // Per-listener cursor namespace (defaults to the channel). Keying by listener
  // identity is what lets multiple listeners on one channel each receive every
  // message instead of racing over a single shared channel-keyed cursor file.
  const histKey = opts.historyKey ?? channel;

  const existingMeta = !opts.disableHistory ? readHistory(history, histKey) : null;

  let cursor: number | null;
  if (typeof opts.since === 'number' && Number.isFinite(opts.since)) {
    cursor = opts.since;
  } else if (existingMeta) {
    cursor = existingMeta.lastSeenId;
  } else {
    cursor = null;
  }

  const pullOpts: { after?: number; limit?: number } = {};
  if (cursor !== null) {
    pullOpts.after = cursor;
  } else {
    pullOpts.limit = limit;
  }

  const res = await client.getMessages(channel, pullOpts);
  if (!res.ok) {
    throw new Error(res.error || `Failed to read messages on ${channel}`);
  }

  const decoded = res.messages.map(decodeMessage);

  // History guard: filter anything at-or-below the cursor (defense in depth —
  // daemon should already do this with `after=`, but tests verify the guard).
  const filtered = cursor === null
    ? decoded
    : decoded.filter((m) => m.id > cursor);

  const selfSender = opts.selfSender ?? null;
  const emitted: TubeMessage[] = [];

  let lastSeenId: number | null = cursor;
  let lastForeignEventId: number | null = existingMeta?.lastForeignEventId ?? null;
  let lastForeignSender: string | null = existingMeta?.lastForeignSender ?? null;

  for (const m of filtered) {
    if (lastSeenId === null || m.id > lastSeenId) lastSeenId = m.id;

    const isSelf = selfSender !== null && m.sender === selfSender;
    if (isSelf) {
      // Advance the cursor past our own messages but don't surface them
      // back to the listener and don't treat them as the next reply target.
      continue;
    }
    emitted.push(m);
    if (lastForeignEventId === null || m.id > lastForeignEventId) {
      lastForeignEventId = m.id;
      lastForeignSender = m.sender;
    }
  }

  const advancedSeen = lastSeenId !== null && lastSeenId !== cursor;
  const advancedForeign = lastForeignEventId !== (existingMeta?.lastForeignEventId ?? null);
  if (!opts.disableHistory && (advancedSeen || advancedForeign)) {
    writeHistory(history, histKey, {
      lastSeenId: lastSeenId ?? cursor ?? 0,
      lastForeignEventId: lastForeignEventId ?? undefined,
      lastForeignSender: lastForeignSender ?? undefined,
    });
  }

  return { messages: emitted, lastSeenId, lastForeignEventId, lastForeignSender };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sender synthesis & prose formatter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stable per-cwd+channel sender label so a listener doesn't echo its own
 * replies back to itself. Overridable with `--sender`.
 */
export function synthesizeSender(channel: string, cwd: string = process.cwd()): string {
  const cwdName = cwd.split(/[\\/]/).filter(Boolean).pop() || 'pd';
  const safeCwd = cwdName.replace(/[^A-Za-z0-9._-]+/g, '_');
  return `pd-tube/${safeCwd || 'pd'}/${safeChannelSlug(channel)}`;
}

/**
 * Render a tube message as the "crank-handle" prose block: a human-readable
 * frame plus a one-liner that tells the agent how to reply and continue
 * listening with a single command.
 */
export function formatProse(msg: TubeMessage, channel: string): string {
  const ts = (() => {
    try { return new Date(msg.createdAt).toISOString(); } catch { return String(msg.createdAt); }
  })();
  const sender = msg.sender || 'unknown';
  const reTag = msg.inReplyTo !== undefined ? `  ↩ ${msg.inReplyTo}` : '';
  const indentedBody = (msg.body || '').split('\n').map((line) => `  ${line}`).join('\n');
  // Surface the typed conversation move when present, so the act + argumentative
  // stance are legible without parsing the raw envelope (RCP-14 digest-with-zoom).
  const actBits = [
    msg.performative ? `act=${msg.performative}` : '',
    msg.relationship ? `relationship=${msg.relationship}` : '',
  ].filter(Boolean);
  const actLine = actBits.length > 0 ? [`Discourse: ${actBits.join(' · ')}`] : [];
  return [
    `──── event id=${msg.id} · channel ${channel}${reTag} ────`,
    `From: ${sender} · ${ts}`,
    ...actLine,
    'Body:',
    indentedBody,
    '',
    'Act on the event above, then post your response by running:',
    '',
    `    pd tube ${channel} --reply "your response here"`,
    '',
    `That command posts a reply correlated to id=${msg.id} AND continues`,
    'listening. Use --raw / --json for machine output. Ctrl+C to exit.',
    '──────────────────────────────────────',
    '',
  ].join('\n');
}

/**
 * Send a top-level tube message.
 */
export async function send(
  channel: string,
  body: string,
  client: TubeClient,
  opts: SendOptions = {},
): Promise<{ id: number }> {
  if (!body || !body.trim()) {
    throw new Error('tube: refusing to send empty body');
  }
  const env = buildEnvelope(body, undefined, opts.meta);
  const res = await client.publish(channel, env, { sender: opts.sender });
  if (!res.ok || typeof res.id !== 'number') {
    throw new Error(res.error || `Failed to publish to ${channel}`);
  }
  return { id: res.id };
}

/**
 * Reply to an existing tube message. Threading metadata travels in the
 * envelope's `inReplyTo`.
 */
export async function reply(
  channel: string,
  parentId: number,
  body: string,
  client: TubeClient,
  opts: SendOptions = {},
): Promise<{ id: number }> {
  if (!Number.isFinite(parentId) || parentId <= 0) {
    throw new Error(`tube: invalid parent id ${parentId}`);
  }
  if (!body || !body.trim()) {
    throw new Error('tube: refusing to send empty reply body');
  }
  const env = buildEnvelope(body, parentId, opts.meta);
  const res = await client.publish(channel, env, { sender: opts.sender });
  if (!res.ok || typeof res.id !== 'number') {
    throw new Error(res.error || `Failed to reply on ${channel}`);
  }
  return { id: res.id };
}
