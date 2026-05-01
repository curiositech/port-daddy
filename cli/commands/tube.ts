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
import { resolveDeclaredChannel, formatResolvedChannel, type ChannelResolution } from '../utils/channel-resolution.js';
import * as ui from '../utils/ui.js';
import {
  createFileHistoryStore,
  formatProse,
  listen,
  readHistory,
  reply,
  safeChannelSlug,
  send,
  synthesizeSender,
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

type EmitMode = 'prose' | 'raw' | 'json';

function emitMessage(msg: TubeMessage, mode: EmitMode, channelLabel: string): void {
  if (mode === 'json') {
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

  if (mode === 'raw') {
    // Tab-separated: `<id>  <sender|-> [↩<reply-to>]  <body>`
    const reTag = msg.inReplyTo !== undefined ? ` ↩${msg.inReplyTo}` : '';
    const sender = msg.sender || '-';
    console.log(`${msg.id}\t${sender}${reTag}\t${msg.body}`);
    return;
  }

  // Prose: crank-handle block telling the agent how to call back.
  // Use console.log so test capture sees it; trim trailing newline since
  // console.log adds one.
  console.log(formatProse(msg, channelLabel).replace(/\n+$/, ''));
}

function pickEmitMode(options: CLIOptions): EmitMode {
  if (isJson(options)) return 'json';
  if (options.raw) return 'raw';
  return 'prose';
}

/**
 * Decode the `--reply` / `--send` argument into a body source.
 *
 *   undefined           → no body requested
 *   true (bare flag)    → read stdin
 *   '-'                 → read stdin
 *   '<digits>'          → numeric parent id (only legal on --reply); body from stdin
 *   '<other string>'    → inline body
 */
type ReplyArg =
  | { kind: 'none' }
  | { kind: 'stdin' }
  | { kind: 'numericParent'; parentId: number }
  | { kind: 'inline'; body: string };

function classifyReplyArg(value: unknown): ReplyArg {
  if (value === undefined) return { kind: 'none' };
  if (value === true) return { kind: 'stdin' };
  const s = String(value);
  if (s === '-') return { kind: 'stdin' };
  if (/^[0-9]+$/.test(s)) {
    const parentId = parseInt(s, 10);
    if (Number.isFinite(parentId) && parentId > 0) return { kind: 'numericParent', parentId };
  }
  return { kind: 'inline', body: s };
}

function classifySendArg(value: unknown): ReplyArg {
  if (value === undefined) return { kind: 'none' };
  if (value === true) return { kind: 'stdin' };
  const s = String(value);
  if (s === '-') return { kind: 'stdin' };
  return { kind: 'inline', body: s };
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
/**
 * Default block-wait when an agent invokes `pd tube <ch>` and no event has
 * arrived yet. Long enough to be useful in an agent's tool loop, short
 * enough that the bash sandbox/timeout won't kill it. Override with
 * `--wait-for=<seconds>`.
 */
const DEFAULT_WAIT_FOR_SECONDS = 600;

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
 *
 * Listen mode (default): emits the prose crank-handle for each new event;
 * `--raw` switches to tab-separated, `--json` to one-JSON-line-per-message.
 *
 * Inline reply (the loop unlock): `pd tube <ch> --reply "body"` posts a
 * reply correlated to the most recent event from someone else and then
 * keeps listening. `--reply=<numeric-id> --send` preserves the legacy
 * post-and-exit shape (body comes from stdin in that case).
 */
export async function handleTube(channel: string | undefined, options: CLIOptions, deps: TubeHandlerDeps = {}): Promise<void> {
  if (!channel) {
    ui.error('Usage: pd tube <channel> [--reply <body> | --reply=<id> --send | --send <body> | --once | --raw | --json | --no-history]');
    process.exit(1);
  }

  // Resolve channel (logical → physical), unless --raw-channel.
  let resolved: ChannelResolution;
  try {
    resolved = await resolveDeclaredChannel(channel, options);
  } catch (error) {
    ui.error((error as Error).message);
    process.exit(1);
    return;
  }

  const emitMode = pickEmitMode(options);
  const quiet = isQuiet(options);
  const physical = resolved.physicalChannel;
  const channelLabel = (resolved.requestedChannel ?? channel) || channel;

  // Build / pick deps.
  const client = deps.client ?? createDaemonTubeClient(() => physical);
  const history = deps.history ?? createFileHistoryStore();
  const stdin = deps.stdin ?? (process.stdin as NodeJS.ReadableStream & { isTTY?: boolean });
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  // Sender: explicit --sender wins; otherwise synthesize a stable per-cwd
  // label so the listener doesn't echo its own replies back to itself.
  const explicitSender = (options.sender as string) || (options.as as string) || '';
  const selfSender = explicitSender || synthesizeSender(channelLabel);

  // Resolve body for --reply / --send (if either is set).
  const replyArg = classifyReplyArg(options.reply);
  const sendArg = classifySendArg(options.send);

  // Forbid the obvious nonsense up front.
  if (replyArg.kind !== 'none' && sendArg.kind === 'inline') {
    ui.error('tube: --send takes no body when used with --reply (it just toggles post-and-exit)');
    process.exit(1);
    return;
  }

  // Helper to pull a body from stdin and trim trailing whitespace.
  async function bodyFromStdin(): Promise<string> {
    const raw = await readStdinToEnd(stdin);
    const trimmed = raw.replace(/\s+$/, '');
    if (!trimmed) {
      throw new Error('tube: stdin was empty — nothing to send');
    }
    return trimmed;
  }

  function reportPost(id: number): void {
    if (emitMode === 'json') {
      console.log(JSON.stringify({ ok: true, id, channel: physical }));
    } else if (!quiet) {
      ui.success(`tube: posted id=${id} to ${formatResolvedChannel(resolved)}`);
    } else {
      console.log(String(id));
    }
  }

  // ── --reply: post a reply, then either exit or keep listening ───────────
  if (replyArg.kind !== 'none') {
    let body: string;
    let parentId: number;

    try {
      if (replyArg.kind === 'stdin') {
        body = await bodyFromStdin();
        const meta = readHistory(history, physical);
        if (!meta?.lastForeignEventId) {
          throw new Error(
            'tube: no event to reply to yet — listen first, or use --reply=<id> with the explicit message id'
          );
        }
        parentId = meta.lastForeignEventId;
      } else if (replyArg.kind === 'numericParent') {
        body = await bodyFromStdin();
        parentId = replyArg.parentId;
      } else {
        // inline body — auto-correlate to last foreign event
        body = replyArg.body;
        const meta = readHistory(history, physical);
        if (!meta?.lastForeignEventId) {
          throw new Error(
            'tube: no event to reply to yet — listen first (pd tube ' + channelLabel + ') so the cursor knows the parent id, or use --reply=<id> --send'
          );
        }
        parentId = meta.lastForeignEventId;
      }

      const result = await reply(physical, parentId, body, client, { sender: selfSender });
      reportPost(result.id);
    } catch (e) {
      ui.error((e as Error).message);
      process.exit(1);
      return;
    }

    // post-and-exit: --send modifier OR --once OR explicit numeric parent.
    // Continue listening when the user passed an inline body / bare --reply
    // and didn't ask to exit. That's the loop-unlock shape.
    const exitAfterPost = !!options.send || !!options.once || replyArg.kind === 'numericParent';
    if (exitAfterPost) return;

    // Fall through to listen loop.
  }

  // ── --send (no --reply): top-level message, post and exit ───────────────
  if (replyArg.kind === 'none' && sendArg.kind !== 'none') {
    try {
      let body: string;
      if (sendArg.kind === 'inline') body = sendArg.body;
      else body = await bodyFromStdin();
      const result = await send(physical, body, client, { sender: selfSender });
      reportPost(result.id);
      return;
    } catch (e) {
      ui.error((e as Error).message);
      process.exit(1);
      return;
    }
  }

  // ── Listen mode (default, or after an inline-reply continuation) ────────
  //
  // Three shapes:
  //   default       block up to `waitForSeconds` for the next event, then exit.
  //                 This is the agent-loop unlock: each invocation returns,
  //                 letting the agent's bash tool yield control back to the
  //                 model so it can decide what to reply.
  //   --tail        infinite loop; for humans watching a terminal.
  //   --once        single poll-pass; emit current backlog, exit (no waiting).
  //
  const since = options.since !== undefined ? parseNumberOption(options.since, '--since') : undefined;
  const limit = options.limit !== undefined ? parseNumberOption(options.limit, '--limit') : undefined;
  const disableHistory = !!options['no-history'];
  const once = !!options.once;
  const tail = !!options.tail;
  const waitForSeconds = options['wait-for'] !== undefined
    ? parseNumberOption(options['wait-for'], '--wait-for')
    : DEFAULT_WAIT_FOR_SECONDS;
  const waitForMs = Math.max(0, Math.floor(waitForSeconds * 1000));

  if (!quiet && emitMode === 'prose' && tail) {
    ui.info(`tube tailing ${formatResolvedChannel(resolved)} as ${selfSender} (Ctrl+C to exit)`);
  } else if (!quiet && emitMode === 'prose' && !once) {
    ui.info(`tube waiting on ${formatResolvedChannel(resolved)} as ${selfSender} (up to ${waitForSeconds}s; Ctrl+C to exit)`);
  } else if (!quiet && emitMode === 'raw' && tail) {
    ui.info(`tube tailing ${formatResolvedChannel(resolved)} (Ctrl+C to exit)`);
  }

  async function pass(currentSince?: number): Promise<ListenResult> {
    return listen(physical, client, history, {
      since: currentSince,
      limit,
      disableHistory,
      selfSender,
    });
  }

  if (once) {
    try {
      const res = await pass(since);
      for (const m of res.messages) emitMessage(m, emitMode, channelLabel);
      return;
    } catch (e) {
      ui.error((e as Error).message);
      process.exit(1);
      return;
    }
  }

  // Graceful shutdown: SIGINT/SIGTERM end the loop without a stack trace.
  let stopped = false;
  const stop = () => { stopped = true; };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  if (!tail) {
    // Default: block until first event(s) arrive or the wait window expires.
    const deadline = Date.now() + waitForMs;
    let interval = DEFAULT_POLL_INTERVAL_MS;
    let currentSince = since;
    while (!stopped) {
      try {
        const res = await pass(currentSince);
        currentSince = undefined;
        if (res.messages.length > 0) {
          for (const m of res.messages) emitMessage(m, emitMode, channelLabel);
          return;
        }
      } catch (e) {
        ui.error((e as Error).message);
        interval = Math.min(MAX_POLL_INTERVAL_MS, Math.floor(interval * 2));
      }
      if (Date.now() >= deadline) {
        if (emitMode === 'json') {
          console.log(JSON.stringify({ ok: true, channel: physical, timedOut: true }));
        } else if (!quiet && emitMode === 'prose') {
          ui.info(`tube: no event in ${waitForSeconds}s — exiting. Re-run pd tube ${channelLabel} to keep listening.`);
        }
        return;
      }
      if (stopped) return;
      await sleep(interval);
      interval = Math.min(MAX_POLL_INTERVAL_MS, Math.floor(interval * 1.5));
    }
    return;
  }

  // --tail: classic infinite loop.
  let firstPass = true;
  let interval = DEFAULT_POLL_INTERVAL_MS;
  while (!stopped) {
    try {
      const res = await pass(firstPass ? since : undefined);
      firstPass = false;
      if (res.messages.length > 0) {
        for (const m of res.messages) emitMessage(m, emitMode, channelLabel);
        interval = DEFAULT_POLL_INTERVAL_MS;
      } else {
        interval = Math.min(MAX_POLL_INTERVAL_MS, Math.floor(interval * 1.5));
      }
    } catch (e) {
      ui.error((e as Error).message);
      interval = Math.min(MAX_POLL_INTERVAL_MS, Math.floor(interval * 2));
    }
    if (stopped) break;
    await sleep(interval);
  }
}
