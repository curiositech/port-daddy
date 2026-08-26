/**
 * CLI `pd tube <channel>` — relay-independent conversational pipe.
 *
 * Surface (Track B1 of PHONE-INTEGRATION-MASTER-PLAN):
 *
 *   pd tube <channel>                          # listen mode (default)
 *   pd tube <channel> --since=<id>             # resume from a specific id
 *   pd tube <channel> --once                   # one poll-pass, then exit
 *   pd tube <channel> --reply <body>           # inline reply (auto-correlates), keep listening
 *   pd tube <channel> --reply-to=<id>          # reply to a specific message id (body from stdin)
 *   pd tube <channel> --reply <body> --reply-to=<id>  # inline body, explicit parent
 *   pd tube <channel> --reply <body> --send    # inline reply, post-and-exit (no continued listen)
 *   pd tube <channel> --reply=<id> --send      # LEGACY: numeric --reply means parent id; prefer --reply-to
 *   pd tube <channel> --send                   # read stdin to EOF, post top-level
 *   pd tube <channel> --send <body>            # inline top-level body
 *   pd tube <ch> --reply "no, see X" --relationship contradicts --performative inform
 *                                              # typed discourse move: act + argumentative stance (RCP-14)
 *   pd tube <channel> --no-history             # listen without touching the cursor
 *   pd tube <channel> --limit=N                # initial backfill cap (default 50)
 *
 * In listen mode the default output is a prose crank-handle block: one event,
 * how to reply, then exit so an agent's shell tool yields. Use `--json` for
 * JSON lines and `--raw` for tab-separated output.
 *
 * The command works against the daemon's existing `/msg/:channel`
 * surface; nothing else is required and the relay is not assumed.
 */

import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import type { PdFetchResponse } from '../utils/fetch.js';
import { CLIOptions, isJson, isQuiet } from '../types.js';
import { resolveDeclaredChannel, formatResolvedChannel, type ChannelResolution } from '../utils/channel-resolution.js';
import { isStdinInteractive } from '../utils/tty.js';
import * as ui from '../utils/ui.js';
import {
  createFileHistoryStore,
  formatProse,
  listen,
  readHistory,
  reply,
  send,
  synthesizeSender,
  PERFORMATIVES,
  DISCOURSE_RELATIONSHIPS,
  type ConversationMeta,
  type HistoryStore,
  type ListenResult,
  type RawDaemonMessage,
  type TubeClient,
  type TubeMessage,
} from '../../lib/tube.js';
import {
  buildLineage,
  summarizeThread,
  renderLineageTree,
} from '../../lib/discourse-lineage.js';
import {
  buildConversationalDiagnosticSignal,
  CONFLICT_SIGNAL_PRODUCERS,
  shouldConvene,
} from '../../lib/parley-trigger.js';

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

// ─────────────────────────────────────────────────────────────────────────────
// Stdin reader
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read process.stdin to EOF. Returns the trimmed body. Throws a hard error if
 * stdin is an interactive terminal — rather than hanging forever waiting on a
 * human who pasted the wrong flag.
 *
 * Interactivity is decided by the kernel-level `isStdinInteractive` (see
 * `cli/utils/tty.ts`), NOT the `stdin.isTTY` stream flag: under the
 * bun-compiled binary that flag is falsy on a real terminal, so the old check
 * let an interactive invocation fall through to `for await (...)` and HANG.
 * `interactive` is injectable so tests pin both branches deterministically.
 */
export async function readStdinToEnd(
  stdin: NodeJS.ReadableStream & { isTTY?: boolean } = process.stdin,
  interactive: (s: { isTTY?: boolean }) => boolean = isStdinInteractive,
): Promise<string> {
  if (interactive(stdin)) {
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
 *   '<any string>'      → inline body (digits included — use --reply-to=<id>
 *                         to specify a parent id explicitly)
 */
type ReplyArg =
  | { kind: 'none' }
  | { kind: 'stdin' }
  | { kind: 'inline'; body: string };

function classifyReplyArg(value: unknown): ReplyArg {
  if (value === undefined) return { kind: 'none' };
  if (value === true) return { kind: 'stdin' };
  const s = String(value);
  if (s === '-') return { kind: 'stdin' };
  return { kind: 'inline', body: s };
}

function classifySendArg(value: unknown): ReplyArg {
  if (value === undefined) return { kind: 'none' };
  if (value === true) return { kind: 'stdin' };
  const s = String(value);
  if (s === '-') return { kind: 'stdin' };
  return { kind: 'inline', body: s };
}

/**
 * Parse `--reply-to=<id>` (explicit parent message id). Returns null if the
 * flag was not provided, or throws on malformed input.
 */
function parseReplyToArg(value: unknown): number | null {
  if (value === undefined || value === null || value === false) return null;
  if (value === true) {
    throw new Error('tube: --reply-to needs a numeric message id, e.g. --reply-to=42');
  }
  const s = String(value).trim();
  if (!/^[0-9]+$/.test(s)) {
    throw new Error(`tube: --reply-to must be a positive integer message id (got ${JSON.stringify(s)})`);
  }
  const id = parseInt(s, 10);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error(`tube: --reply-to must be a positive integer message id (got ${JSON.stringify(s)})`);
  }
  return id;
}

/**
 * Backward-compat detector: the legacy shape was `--reply=<digits> --send`,
 * where the numeric value of --reply was the parent id and the body came from
 * stdin. We now prefer `--reply-to=<id>` for the explicit-parent case, but
 * keep the legacy shape working with a deprecation note.
 *
 * Returns the parsed parent id when the legacy shape applies, otherwise null.
 */
function detectLegacyNumericReplyParent(replyValue: unknown, sendPresent: boolean): number | null {
  if (!sendPresent) return null;
  if (typeof replyValue !== 'string' && typeof replyValue !== 'number') return null;
  const s = String(replyValue);
  if (!/^[0-9]+$/.test(s)) return null;
  const id = parseInt(s, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

export interface TubeHandlerDeps {
  /** Override for tests — defaults to a real file-backed cursor in PD_HOME. */
  history?: HistoryStore;
  /** Override for tests — defaults to a daemon-backed HTTP client. */
  client?: TubeClient;
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

/**
 * Build the typed conversation metadata from `--performative`,
 * `--relationship`, and `--conversation-id`. Invalid enum values are a hard
 * error (explicit operator input, unlike the lenient drop-on-decode path for
 * untrusted wire data). Returns `undefined` when no meta flags were passed, so
 * the envelope stays in its pre-Phase-0 shape.
 */
export function buildMetaFromOptions(options: CLIOptions): ConversationMeta | undefined {
  const meta: ConversationMeta = {};

  const perf = options.performative;
  if (typeof perf === 'string') {
    if (!(PERFORMATIVES as readonly string[]).includes(perf)) {
      throw new Error(`tube: unknown --performative ${JSON.stringify(perf)} — one of: ${PERFORMATIVES.join(', ')}`);
    }
    meta.performative = perf as ConversationMeta['performative'];
  }

  const rel = options.relationship;
  if (typeof rel === 'string') {
    if (!(DISCOURSE_RELATIONSHIPS as readonly string[]).includes(rel)) {
      throw new Error(`tube: unknown --relationship ${JSON.stringify(rel)} — one of: ${DISCOURSE_RELATIONSHIPS.join(', ')}`);
    }
    meta.relationship = rel as ConversationMeta['relationship'];
  }

  const conv = options['conversation-id'] ?? options.conversation;
  if (typeof conv === 'string' && conv) meta.conversationId = conv;

  return Object.keys(meta).length > 0 ? meta : undefined;
}

/**
 * `pd tube` entry point.
 *
 * Listen mode (default): emits the prose crank-handle for each new event;
 * `--raw` switches to tab-separated, `--json` to one-JSON-line-per-message.
 *
 * Inline reply (the loop unlock): `pd tube <ch> --reply "body"` posts a
 * reply correlated to the most recent event from someone else and then
 * keeps listening. To reply to a specific message id, pass
 * `--reply-to=<id>` (combine with `--reply <body>` for inline body, or pipe
 * the body via stdin). The legacy `--reply=<numeric> --send` shape still
 * works for backward compatibility but emits a deprecation hint.
 */
export async function handleTube(channel: string | undefined, options: CLIOptions, deps: TubeHandlerDeps = {}): Promise<void> {
  if (!channel) {
    ui.error('Usage: pd tube <channel> [--reply <body> [--reply-to=<id>] | --reply-to=<id> < body | --send <body> | --send | --lineage [--conversation-id <id>] [--parley-cost <n> --waste-per-contradiction <n>] | --once | --tail | --wait-for=<seconds> | --raw | --json | --no-history] [--performative <act> --relationship <stance> --conversation-id <id>]');
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
  // --reply-to=<id> is the explicit-parent flag; --reply <body> is always a
  // body now (digits or otherwise). The legacy `--reply=<digits> --send`
  // shape (numeric-as-parent) is detected separately and supported with a
  // deprecation note for backward compatibility.
  let explicitReplyTo: number | null;
  try {
    explicitReplyTo = parseReplyToArg(options['reply-to']);
  } catch (e) {
    ui.error((e as Error).message);
    process.exit(1);
    return;
  }
  const sendPresent = options.send !== undefined;
  const legacyNumericParent = explicitReplyTo === null
    ? detectLegacyNumericReplyParent(options.reply, sendPresent)
    : null;

  let replyArg = classifyReplyArg(options.reply);
  // Legacy compat: when `--reply=<digits> --send` is used WITHOUT --reply-to,
  // treat the numeric value as the parent id and pull the body from stdin —
  // exactly like the pre-PR-17 shape. Emit a one-line deprecation hint to
  // stderr so users migrate to --reply-to.
  if (legacyNumericParent !== null) {
    replyArg = { kind: 'stdin' };
    if (!quiet) {
      ui.warn(`tube: --reply=${legacyNumericParent} --send is the legacy shape; prefer --reply-to=${legacyNumericParent} (with stdin or --reply <body>)`);
    }
  }

  // If --reply-to is set, we need a body source. --reply <body> (or stdin)
  // both work. Promote a bare --reply-to (no --reply) to a stdin reply.
  if (explicitReplyTo !== null && replyArg.kind === 'none') {
    replyArg = { kind: 'stdin' };
  }

  const sendArg = classifySendArg(options.send);

  // Forbid the obvious nonsense up front.
  // --send must be a strict boolean toggle when --reply provides an inline
  // body — anything like `--send "body"` collides with the inline reply.
  if (replyArg.kind !== 'none' && sendArg.kind === 'inline') {
    ui.error('tube: --send takes no body when used with --reply — pick one (inline reply OR stdin send), not both');
    process.exit(1);
    return;
  }
  // If --send is given alongside --reply with explicit `-` (stdin) for
  // --send, that's also nonsense: --reply already chose the body source.
  if (replyArg.kind !== 'none' && sendArg.kind === 'stdin' && options.send !== true && legacyNumericParent === null) {
    ui.error('tube: --send=- is not valid with --reply; --send is a boolean post-and-exit toggle in this combo');
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
      // Decide parent id first (explicit --reply-to wins, then legacy
      // numeric, then auto-correlate to lastForeignEventId).
      if (explicitReplyTo !== null) {
        parentId = explicitReplyTo;
      } else if (legacyNumericParent !== null) {
        parentId = legacyNumericParent;
      } else {
        const meta = readHistory(history, physical);
        if (!meta?.lastForeignEventId) {
          throw new Error(
            'tube: no event to reply to yet — listen first (pd tube ' + channelLabel + ') so the cursor knows the parent id, or pass --reply-to=<id> to specify the parent explicitly'
          );
        }
        parentId = meta.lastForeignEventId;
      }

      // Then resolve the body.
      if (replyArg.kind === 'stdin') {
        body = await bodyFromStdin();
      } else {
        body = replyArg.body;
      }

      const result = await reply(physical, parentId, body, client, { sender: selfSender, meta: buildMetaFromOptions(options) });
      reportPost(result.id);
    } catch (e) {
      ui.error((e as Error).message);
      process.exit(1);
      return;
    }

    // post-and-exit: --send modifier OR --once OR legacy numeric-parent
    // shape. Continue listening when the user passed an inline body / bare
    // --reply (or --reply-to without --send) and didn't ask to exit.
    const exitAfterPost = !!options.send || !!options.once || legacyNumericParent !== null;
    if (exitAfterPost) return;

    // Fall through to listen loop.
  }

  // ── --send (no --reply): top-level message, post and exit ───────────────
  if (replyArg.kind === 'none' && sendArg.kind !== 'none') {
    try {
      let body: string;
      if (sendArg.kind === 'inline') body = sendArg.body;
      else body = await bodyFromStdin();
      const result = await send(physical, body, client, { sender: selfSender, meta: buildMetaFromOptions(options) });
      reportPost(result.id);
      return;
    } catch (e) {
      ui.error((e as Error).message);
      process.exit(1);
      return;
    }
  }

  // ── --lineage: render the argument graph over the channel backlog ───────
  // (RCP-14). Pulls the full backlog, builds the typed inReplyTo graph, and
  // prints a digest (zoom-out) + tree (zoom-in). Optionally scoped to one
  // --conversation-id.
  if (options.lineage) {
    try {
      const res = await listen(physical, client, history, { disableHistory: true, limit: 2000 });
      let msgs = res.messages;
      const convFilter = options['conversation-id'] ?? options.conversation;
      if (typeof convFilter === 'string' && convFilter) {
        msgs = msgs.filter((m) => m.conversationId === convFilter);
      }
      const graph = buildLineage(msgs);
      const digest = summarizeThread(graph);
      const signal = buildConversationalDiagnosticSignal({
        channel: physical,
        conversationId: graph.conversationId,
        digest,
        producer: CONFLICT_SIGNAL_PRODUCERS.tubeDiagnostic,
      });
      // ADR-0111/ADR-0129 diagnostic recommendation for the conversation
      // checkpoint. This renders economics only and never summons Parley.
      const num = (v: unknown, d: number) => {
        const n = typeof v === 'string' ? Number(v) : NaN;
        return Number.isFinite(n) ? n : d;
      };
      const parley = shouldConvene(signal, {
        mode: 'diagnostic',
        costs: {
          wastePerUnresolved: num(options['waste-per-contradiction'], 2),
          parleyCost: num(options['parley-cost'], 1),
        },
      });
      if (emitMode === 'json') {
        console.log(JSON.stringify({
          ok: true,
          channel: physical,
          ...(graph.conversationId ? { conversationId: graph.conversationId } : {}),
          digest: { ...digest },
          parley,
          tree: renderLineageTree(graph),
        }));
      } else {
        const head = `Discourse lineage · ${formatResolvedChannel(resolved)}${graph.conversationId ? ` · conversation ${graph.conversationId}` : ''}`;
        const relBits = Object.entries(digest.byRelationship).filter(([, n]) => n > 0).map(([k, n]) => `${k}=${n}`);
        const parleyLine = parley.convene
          ? `▶ parley recommended (${parley.shape}): ${parley.reason}`
          : `· no parley: ${parley.reason}`;
        const summary = [
          head,
          `${digest.total} message(s) · ${digest.participants.length} participant(s) · depth ${digest.maxDepth}`,
          relBits.length > 0 ? `stances: ${relBits.join(' · ')}` : 'stances: (none typed)',
          digest.unresolvedContradictions.length > 0
            ? `⚠ ${digest.unresolvedContradictions.length} unresolved contradiction(s): ${digest.unresolvedContradictions.map((e) => `#${e.from}→#${e.to}`).join(', ')}`
            : '',
          parleyLine,
          '',
          renderLineageTree(graph) || '(no messages)',
        ].filter((l) => l !== '').join('\n');
        console.log(summary);
      }
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
      // Per-listener cursor namespace so multiple listeners on one channel each
      // receive every message (multi-subscriber). Distinct `--as` identities →
      // independent cursors; the same identity still resumes across runs.
      historyKey: selfSender ? `${physical}::${selfSender}` : physical,
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
