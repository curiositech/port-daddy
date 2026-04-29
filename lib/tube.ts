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
 *   holds `{ lastSeenId, updatedAt }`. Listeners read the cursor before
 *   asking the daemon for messages and write it back after each batch. The
 *   guard is on by default; pass `disableHistory: true` (CLI: `--no-history`)
 *   to opt out.
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
 * Wire format we publish through `/msg/:channel`. Wrapped in a tiny
 * envelope so threading metadata survives the daemon's untyped `payload`.
 */
export interface TubeEnvelope {
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
export interface TubeMessage {
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

export interface HistoryStore {
  read: (channel: string) => number | null;
  write: (channel: string, lastSeenId: number) => void;
}

export interface ListenOptions {
  /** Resume cursor: only emit messages with id strictly greater than this. */
  since?: number;
  /** Cap on initial backfill when no cursor exists. Default 50. */
  limit?: number;
  /** Skip and don't update the on-disk history cursor. */
  disableHistory?: boolean;
}

export interface ListenResult {
  messages: TubeMessage[];
  lastSeenId: number | null;
}

export interface SendOptions {
  sender?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Envelope helpers (pure)
// ─────────────────────────────────────────────────────────────────────────────

/** Build the tube envelope to send over the daemon. */
export function buildEnvelope(body: string, inReplyTo?: number): TubeEnvelope {
  const env: TubeEnvelope = {
    v: TUBE_ENVELOPE_VERSION,
    kind: TUBE_ENVELOPE_KIND,
    body,
  };
  if (typeof inReplyTo === 'number' && Number.isFinite(inReplyTo)) {
    env.inReplyTo = inReplyTo;
  }
  return env;
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

  const p = row.payload;
  if (p && typeof p === 'object' && !Array.isArray(p)) {
    const obj = p as Record<string, unknown>;
    if (obj.kind === TUBE_ENVELOPE_KIND && typeof obj.body === 'string') {
      envelope = true;
      body = obj.body;
      if (typeof obj.inReplyTo === 'number' && Number.isFinite(obj.inReplyTo)) {
        inReplyTo = obj.inReplyTo;
      }
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

/**
 * File-backed history store. Atomic via tmp+rename.
 * Pass a different `baseDir` (or use `inMemoryHistoryStore`) in tests.
 */
export function createFileHistoryStore(baseDir: string = PD_HOME): HistoryStore {
  return {
    read(channel: string): number | null {
      const path = defaultHistoryPath(channel, baseDir);
      if (!existsSync(path)) return null;
      try {
        const txt = readFileSync(path, 'utf8');
        const data = JSON.parse(txt);
        if (typeof data?.lastSeenId === 'number' && Number.isFinite(data.lastSeenId)) {
          return data.lastSeenId;
        }
        return null;
      } catch {
        return null;
      }
    },
    write(channel: string, lastSeenId: number): void {
      const path = defaultHistoryPath(channel, baseDir);
      const dir = dirname(path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
      const tmp = `${path}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify({ lastSeenId, updatedAt: Date.now() }), { mode: 0o600 });
      renameSync(tmp, path);
    },
  };
}

/** In-memory store — used in tests and for `--no-history` style flows. */
export function inMemoryHistoryStore(): HistoryStore {
  const map = new Map<string, number>();
  return {
    read(channel: string) {
      const v = map.get(channel);
      return typeof v === 'number' ? v : null;
    },
    write(channel: string, lastSeenId: number) {
      map.set(channel, lastSeenId);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Core operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One-shot listen pass: pull messages strictly after the resolved cursor,
 * decode them, and (unless disabled) advance the cursor. The caller is
 * responsible for any loop / interval — keeping listen pure-ish makes it
 * trivial to test and trivial to compose with `--once`.
 */
export async function listen(
  channel: string,
  client: TubeClient,
  history: HistoryStore,
  opts: ListenOptions = {},
): Promise<ListenResult> {
  const limit = typeof opts.limit === 'number' && opts.limit > 0 ? opts.limit : 50;

  let cursor: number | null;
  if (typeof opts.since === 'number' && Number.isFinite(opts.since)) {
    cursor = opts.since;
  } else if (!opts.disableHistory) {
    cursor = history.read(channel);
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

  let lastSeenId: number | null = cursor;
  for (const m of filtered) {
    if (lastSeenId === null || m.id > lastSeenId) lastSeenId = m.id;
  }

  if (!opts.disableHistory && lastSeenId !== null && lastSeenId !== cursor) {
    history.write(channel, lastSeenId);
  }

  return { messages: filtered, lastSeenId };
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
  const env = buildEnvelope(body);
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
  const env = buildEnvelope(body, parentId);
  const res = await client.publish(channel, env, { sender: opts.sender });
  if (!res.ok || typeof res.id !== 'number') {
    throw new Error(res.error || `Failed to reply on ${channel}`);
  }
  return { id: res.id };
}
