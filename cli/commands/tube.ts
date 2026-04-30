/**
 * CLI `pd tube <channel>` — relay-independent conversational pipe.
 *
 * Surface (Track B1 of PHONE-INTEGRATION-MASTER-PLAN):
 *
 *   pd tube <channel>                       # listen mode (default)
 *   pd tube <channel> --since=<id>          # resume from a specific id
 *   pd tube <channel> --once                # one poll-pass, then exit
 *   pd tube <channel> --reply=<msg-id>      # read stdin to EOF, post as reply
 *   pd tube <channel> --send                # read stdin to EOF, post top-level
 *   pd tube <channel> --no-history          # listen without touching the cursor
 *   pd tube <channel> --limit=N             # initial backfill cap (default 50)
 *   pd tube chat <channel> --backend=codex  # spawn a backend per top-level msg
 *
 * In listen mode each emitted message is one JSON line on stdout
 * (`{ id, sender, createdAt, body, inReplyTo? }`) — easy to pipe into jq,
 * grep, websocat, or another `pd tube` instance. Errors and status notes go
 * to stderr; stdout stays a clean data pipe.
 *
 * The command works against the daemon's existing `/msg/:channel`
 * surface; nothing else is required and the relay is not assumed.
 */

import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import type { PdFetchResponse } from '../utils/fetch.js';
import { CLIOptions, isJson, isQuiet } from '../types.js';
import { resolveDeclaredChannel, formatResolvedChannel } from '../utils/channel-resolution.js';
import * as ui from '../utils/ui.js';
import {
  createFileHistoryStore,
  listen,
  reply,
  safeChannelSlug,
  send,
  type HistoryStore,
  type ListenResult,
  type RawDaemonMessage,
  type TubeClient,
  type TubeMessage,
} from '../../lib/tube.js';

export interface TubeSpawnRequest {
  backend: string;
  model?: string;
  modelTier?: string;
  budgetUsd: number;
  identity: string;
  purpose: string;
  task: string;
}

export interface TubeSpawnClient {
  spawn(request: TubeSpawnRequest): Promise<{ ok: true; output: string; agentId?: string } | { ok: false; error: string }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Daemon client (HTTP shim over pdFetch)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a TubeClient backed by the local daemon's HTTP surface.
 * Exported so tests / future relay backends can reuse the shape.
 */
export function createDaemonTubeClient(physicalChannel: () => string): TubeClient {
  return {
    async publish(_channel, payload, opts) {
      const ch = physicalChannel();
      const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/msg/${encodeURIComponent(ch)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload, sender: opts?.sender }),
      });
      const data = (await res.json()) as { id?: number; error?: string };
      if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
      return { ok: true, id: typeof data.id === 'number' ? data.id : undefined };
    },
    async getMessages(_channel, opts = {}) {
      const ch = physicalChannel();
      const params = new URLSearchParams();
      if (typeof opts.after === 'number') params.set('after', String(opts.after));
      if (typeof opts.limit === 'number') params.set('limit', String(opts.limit));
      const qs = params.toString();
      const url = `${PORT_DADDY_URL}/msg/${encodeURIComponent(ch)}${qs ? '?' + qs : ''}`;
      const res: PdFetchResponse = await pdFetch(url);
      const data = (await res.json()) as { messages?: RawDaemonMessage[]; error?: string };
      if (!res.ok) return { ok: false, messages: [], error: data.error || `HTTP ${res.status}` };
      return { ok: true, messages: Array.isArray(data.messages) ? data.messages : [] };
    },
  };
}

export function createDaemonTubeSpawnClient(): TubeSpawnClient {
  return {
    async spawn(request) {
      const body: Record<string, unknown> = {
        backend: request.backend,
        budgetUsd: request.budgetUsd,
        identity: request.identity,
        purpose: request.purpose,
        task: request.task,
      };
      if (request.model) body.model = request.model;
      if (request.modelTier) body.modelTier = request.modelTier;

      const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/spawn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        agentId?: string;
        output?: string;
        error?: string;
      };
      if (!res.ok || data.error) {
        return { ok: false, error: data.error || `HTTP ${res.status}` };
      }
      return { ok: true, output: typeof data.output === 'string' ? data.output : '', agentId: data.agentId };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Stdin reader
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read process.stdin to EOF. Returns the trimmed body. Throws if stdin is a
 * TTY (interactive terminal) — we want a hard error rather than hanging
 * waiting on a human who pasted the wrong flag.
 */
export async function readStdinToEnd(stdin: NodeJS.ReadableStream & { isTTY?: boolean }): Promise<string> {
  if (stdin.isTTY) {
    throw new Error('tube: --send / --reply needs a body on stdin (pipe one in, e.g. `echo hi | pd tube ...`)');
  }
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks).toString('utf8');
}

// ─────────────────────────────────────────────────────────────────────────────
// Output formatting
// ─────────────────────────────────────────────────────────────────────────────

function emitMessage(msg: TubeMessage, json: boolean): void {
  if (json) {
    const line: Record<string, unknown> = {
      id: msg.id,
      sender: msg.sender,
      createdAt: msg.createdAt,
      body: msg.body,
    };
    if (msg.inReplyTo !== undefined) line.inReplyTo = msg.inReplyTo;
    if (!msg.envelope) line.foreign = true;
    console.log(JSON.stringify(line));
    return;
  }

  // Default human-readable: `<id>  <sender|-> [<reply-to>]  <body>`
  const reTag = msg.inReplyTo !== undefined ? ` ↩${msg.inReplyTo}` : '';
  const sender = msg.sender || '-';
  console.log(`${msg.id}\t${sender}${reTag}\t${msg.body}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

export interface TubeHandlerDeps {
  /** Override for tests — defaults to a real file-backed cursor in PD_HOME. */
  history?: HistoryStore;
  /** Override for tests — defaults to a daemon-backed HTTP client. */
  client?: TubeClient;
  /** Override for tube chat tests — defaults to the daemon /spawn route. */
  spawnClient?: TubeSpawnClient;
  /** Override for tests — defaults to process.stdin. */
  stdin?: NodeJS.ReadableStream & { isTTY?: boolean };
  /** Used to make once-mode listen sleep injectable. */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_POLL_INTERVAL_MS = 1000;
const MAX_POLL_INTERVAL_MS = 5000;

function parseNumberOption(raw: unknown, label: string): number {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`tube: invalid ${label}: ${raw}`);
  }
  return n;
}

function parsePositiveBudget(raw: unknown): number | null {
  const budget = typeof raw === 'number' ? raw : parseFloat(String(raw ?? ''));
  return Number.isFinite(budget) && budget > 0 ? budget : null;
}

function defaultTubeChatIdentity(channel: string): string {
  const project = process.cwd().split(/[\\/]/).filter(Boolean).pop() || 'project';
  return `${project}:tube-chat:${safeChannelSlug(channel)}`;
}

function tubeChatTask(channel: string, msg: TubeMessage, promptPrefix?: string): string {
  const prefix = promptPrefix?.trim() || 'Reply to this Port Daddy tube message. Keep the answer concise and directly useful.';
  return [
    prefix,
    '',
    `Channel: ${channel}`,
    `Message id: ${msg.id}`,
    msg.sender ? `Sender: ${msg.sender}` : 'Sender: unknown',
    '',
    msg.body,
  ].join('\n');
}

async function processTubeChatMessages(
  requestedChannel: string,
  physicalChannel: string,
  messages: TubeMessage[],
  options: CLIOptions,
  deps: Required<Pick<TubeHandlerDeps, 'client' | 'spawnClient'>>,
): Promise<number> {
  const sender = ((options.sender as string) || (options.as as string) || 'pd-tube-chat').trim();
  const backend = ((options.backend as string) || 'codex').trim();
  const budgetUsd = parsePositiveBudget(options.budget);
  if (!budgetUsd) {
    throw new Error('tube chat: --budget <usd> is required and must be positive');
  }
  const identity = ((options.identity as string) || defaultTubeChatIdentity(requestedChannel)).trim();
  const model = typeof options.model === 'string' ? options.model : undefined;
  const modelTier = typeof options.tier === 'string'
    ? options.tier
    : typeof options.modelTier === 'string'
      ? options.modelTier
      : undefined;
  const promptPrefix = typeof options.prompt === 'string' ? options.prompt : undefined;

  let processed = 0;
  for (const msg of messages) {
    if (msg.sender === sender) continue;
    if (msg.inReplyTo !== undefined && !options['include-replies']) continue;

    const spawned = await deps.spawnClient.spawn({
      backend,
      model,
      modelTier,
      budgetUsd,
      identity,
      purpose: `pd tube chat reply for ${requestedChannel}#${msg.id}`,
      task: tubeChatTask(requestedChannel, msg, promptPrefix),
    });

    const body = spawned.ok
      ? spawned.output.trim() || `(agent ${spawned.agentId || 'unknown'} completed with no text output)`
      : `pd tube chat spawn failed: ${spawned.error}`;
    await reply(physicalChannel, msg.id, body, deps.client, { sender });
    processed++;
  }
  return processed;
}

export async function handleTubeChat(channel: string | undefined, options: CLIOptions, deps: TubeHandlerDeps = {}): Promise<void> {
  if (!channel) {
    ui.error('Usage: pd tube chat <channel> --backend <backend> --tier <low|mid|high> --budget <usd> [--once]');
    process.exit(1);
  }
  const requestedChannel = channel;

  let resolved;
  try {
    resolved = await resolveDeclaredChannel(channel, options);
  } catch (error) {
    ui.error((error as Error).message);
    process.exit(1);
    return;
  }

  const json = isJson(options);
  const quiet = isQuiet(options);
  const physical = resolved.physicalChannel;
  const client = deps.client ?? createDaemonTubeClient(() => physical);
  const spawnClient = deps.spawnClient ?? createDaemonTubeSpawnClient();
  const history = deps.history ?? createFileHistoryStore();
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const since = options.since !== undefined ? parseNumberOption(options.since, '--since') : undefined;
  const limit = options.limit !== undefined ? parseNumberOption(options.limit, '--limit') : undefined;
  const disableHistory = !!options['no-history'];
  const once = !!options.once;

  if (!quiet && !json) {
    ui.info(`tube chat listening on ${formatResolvedChannel(resolved)}`);
  }

  async function pass(currentSince?: number): Promise<{ processed: number; seen: number }> {
    const res = await listen(physical, client, history, { since: currentSince, limit, disableHistory });
    const processed = await processTubeChatMessages(requestedChannel, physical, res.messages, options, { client, spawnClient });
    return { processed, seen: res.messages.length };
  }

  if (once) {
    try {
      const res = await pass(since);
      if (json) console.log(JSON.stringify({ ok: true, channel: physical, ...res }));
      else if (!quiet) ui.success(`tube chat: processed ${res.processed}/${res.seen} message(s)`);
      return;
    } catch (e) {
      ui.error((e as Error).message);
      process.exit(1);
      return;
    }
  }

  let firstPass = true;
  let interval = DEFAULT_POLL_INTERVAL_MS;
  let stopped = false;
  const stop = () => { stopped = true; };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  while (!stopped) {
    try {
      const res = await pass(firstPass ? since : undefined);
      firstPass = false;
      interval = res.seen > 0 ? DEFAULT_POLL_INTERVAL_MS : Math.min(MAX_POLL_INTERVAL_MS, Math.floor(interval * 1.5));
    } catch (e) {
      ui.error((e as Error).message);
      interval = Math.min(MAX_POLL_INTERVAL_MS, Math.floor(interval * 2));
    }
    if (stopped) break;
    await sleep(interval);
  }
}

/**
 * `pd tube` entry point.
 */
export async function handleTube(channel: string | undefined, options: CLIOptions, deps: TubeHandlerDeps = {}): Promise<void> {
  if (!channel) {
    ui.error('Usage: pd tube <channel> [--send | --reply=<id> | --since=<id> | --once | --no-history]');
    process.exit(1);
  }

  // Resolve channel (logical → physical), unless --raw-channel.
  let resolved;
  try {
    resolved = await resolveDeclaredChannel(channel, options);
  } catch (error) {
    ui.error((error as Error).message);
    process.exit(1);
    return;
  }

  const json = isJson(options);
  const quiet = isQuiet(options);
  const physical = resolved.physicalChannel;

  // Build / pick deps.
  const client = deps.client ?? createDaemonTubeClient(() => physical);
  const history = deps.history ?? createFileHistoryStore();
  const stdin = deps.stdin ?? (process.stdin as NodeJS.ReadableStream & { isTTY?: boolean });
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  // ── --send / --reply: read stdin, post, exit ─────────────────────────────
  if (options.send || options.reply !== undefined) {
    let body: string;
    try {
      body = await readStdinToEnd(stdin);
    } catch (e) {
      ui.error((e as Error).message);
      process.exit(1);
      return;
    }
    const trimmed = body.replace(/\s+$/, '');
    if (!trimmed) {
      ui.error('tube: stdin was empty — nothing to send');
      process.exit(1);
      return;
    }

    const sender = (options.sender as string) || (options.as as string) || undefined;

    try {
      let result: { id: number };
      if (options.reply !== undefined) {
        const parentId = parseNumberOption(options.reply, '--reply');
        result = await reply(physical, parentId, trimmed, client, { sender });
      } else {
        result = await send(physical, trimmed, client, { sender });
      }

      if (json) {
        console.log(JSON.stringify({ ok: true, id: result.id, channel: physical }));
      } else if (!quiet) {
        ui.success(`tube: posted id=${result.id} to ${formatResolvedChannel(resolved)}`);
      } else {
        console.log(String(result.id));
      }
      return;
    } catch (e) {
      ui.error((e as Error).message);
      process.exit(1);
      return;
    }
  }

  // ── Listen mode (default) ────────────────────────────────────────────────
  const since = options.since !== undefined ? parseNumberOption(options.since, '--since') : undefined;
  const limit = options.limit !== undefined ? parseNumberOption(options.limit, '--limit') : undefined;
  const disableHistory = !!options['no-history'];
  const once = !!options.once;

  if (!quiet && !json) {
    ui.info(`tube listening on ${formatResolvedChannel(resolved)} (Ctrl+C to exit)`);
  }

  // Single pass = once mode; otherwise loop with polling backoff.
  async function pass(currentSince?: number): Promise<ListenResult> {
    return listen(physical, client, history, {
      since: currentSince,
      limit,
      disableHistory,
    });
  }

  if (once) {
    try {
      const res = await pass(since);
      for (const m of res.messages) emitMessage(m, json);
      return;
    } catch (e) {
      ui.error((e as Error).message);
      process.exit(1);
      return;
    }
  }

  // Polling loop. We pass `since` only on the first pass; thereafter the
  // history store advances the cursor (or stays put if --no-history).
  let firstPass = true;
  let interval = DEFAULT_POLL_INTERVAL_MS;

  // Graceful shutdown: SIGINT/SIGTERM end the loop without a stack trace.
  let stopped = false;
  const stop = () => { stopped = true; };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  while (!stopped) {
    try {
      const res = await pass(firstPass ? since : undefined);
      firstPass = false;
      if (res.messages.length > 0) {
        for (const m of res.messages) emitMessage(m, json);
        interval = DEFAULT_POLL_INTERVAL_MS;
      } else {
        // Gentle backoff when quiet — caps at MAX_POLL_INTERVAL_MS.
        interval = Math.min(MAX_POLL_INTERVAL_MS, Math.floor(interval * 1.5));
      }
    } catch (e) {
      ui.error((e as Error).message);
      // Don't kill the loop on a transient error; back off and retry.
      interval = Math.min(MAX_POLL_INTERVAL_MS, Math.floor(interval * 2));
    }
    if (stopped) break;
    await sleep(interval);
  }
}
