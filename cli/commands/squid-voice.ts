/**
 * `pd squid voice` — the operator's window into when the harness talks.
 * =====================================================================
 *
 * The Giant Squid harness injects coordination context into an agent's turn only
 * when it has something fresh and relevant to say. That quietness is the design
 * (`bin/pd-hook-prompt` § THE QUIET HARNESS), and it creates one hard question
 * for the operator: **was the fleet calm, or did the harness break, or did the
 * harness eat its own message to stay inside a byte budget?** From the prompt
 * side those are indistinguishable — all three look like no text.
 *
 * The tentacle answers by appending one {@link VoiceLogEvent} per turn to
 * `$PD_HOME/squid-voice-log.jsonl`. This command is the read side:
 *
 *   pd squid voice                 recent turns, newest last, relative times
 *   pd squid voice --stats         how often it is quiet, and what silenced it
 *   pd squid voice --suppressed    ONLY the "it should still have talked" turns
 *   pd squid voice --follow        live tail
 *   pd squid voice --json          machine-readable form of any of the above
 *
 * `--suppressed` is the actionable list and the reason the VoiceLog exists: a
 * suppressed turn is the harness holding a halt, a claim collision, or a summons
 * and dropping it because of its own bounds. Those are bugs or budget
 * misconfigurations, never calm.
 *
 * Per `port-daddy-internal-dev` § *Operator vs Agent*: this CLI is the secondary
 * surface. A FleetBar/dashboard panel over the same {@link summarize} output is
 * the primary one and is still owed — see the follow-up noted in the PR.
 */

import { CLIOptions, isJson } from '../types.js';
import { relativeTime } from '../utils/output.js';
import * as ui from '../utils/ui.js';
import {
  DEFAULT_VOICE_LOG_READ_BYTES,
  describeVoiceLogEvent,
  readVoiceLog,
  readVoiceLogFrom,
  summarize,
  voiceLogPath,
  type ReadVoiceLogOptions,
  type VoiceLogCursor,
  type VoiceLogReadResult,
  type VoiceLogSummary,
} from '../../lib/squid/voice-log.js';
import type { VoiceLogEvent, VoiceLogHookEvent } from '../../lib/squid/reconcile-contract.js';

/** Default number of recent turns rendered when no `--limit` is given. */
const DEFAULT_RECENT_LIMIT = 20;

/** Default `--follow` poll interval (ms). */
const DEFAULT_FOLLOW_INTERVAL_MS = 1000;

/** How the harness self-identifies when `PD_ACTOR` was never set. */
const UNIDENTIFIED_ACTOR = '(unidentified)';

/**
 * Parse a `--since` value into an absolute epoch-ms bound.
 *
 * **Design.** Operators think in windows ("what has it done in the last hour"),
 * scripts think in timestamps, and both must work without a second flag. So this
 * accepts a duration suffix (`45s`, `30m`, `2h`, `7d`), a bare epoch-ms number,
 * or anything `Date` can parse (an ISO stamp). The rationale for rejecting
 * rather than silently ignoring an unparseable value is that a typo'd window
 * would otherwise return the whole log and read as "the harness has been busy" —
 * a filter that quietly does nothing is worse than an error.
 *
 * @param raw The user-supplied value, or `undefined` when the flag was omitted.
 * @param now Current epoch ms, injected so tests can pin relative windows.
 * @returns The epoch-ms lower bound, or `undefined` when no filter was asked for.
 * @throws Error when the value is present but cannot be interpreted.
 */
export function parseSince(raw: string | number | undefined, now: number = Date.now()): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const value = String(raw).trim();
  const duration = /^(\d+(?:\.\d+)?)([smhdw])$/i.exec(value);
  if (duration) {
    const amount = Number(duration[1]);
    const unit = duration[2].toLowerCase();
    const scale: Record<string, number> = {
      s: 1000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
      w: 604_800_000,
    };
    return now - amount * scale[unit];
  }
  if (/^\d+$/.test(value)) return Number(value);
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return parsed;
  throw new Error(`Unrecognized --since value "${value}". Use 30m, 2h, 7d, an epoch-ms number, or an ISO timestamp.`);
}

/**
 * Translate CLI flags into {@link ReadVoiceLogOptions}.
 *
 * Isolated from the rendering so the flag semantics are testable on their own
 * and identical across every subcommand — the intent being that `--actor`,
 * `--since`, and `--event` mean exactly one thing whether the operator is
 * reading the recent list, the stats, or the suppressed-only view. A view that
 * silently applies a different filter set than its sibling is how an operator
 * ends up trusting a number that answered a different question.
 *
 * @param options Parsed CLI options.
 * @param now Current epoch ms, forwarded to {@link parseSince}.
 * @returns Filter options ready for `readVoiceLog`.
 */
export function voiceReadOptions(options: CLIOptions, now: number = Date.now()): ReadVoiceLogOptions {
  const opts: ReadVoiceLogOptions = {
    since: parseSince(options.since as string | number | undefined, now),
    maxBytes: DEFAULT_VOICE_LOG_READ_BYTES,
  };
  const actor = options.actor;
  if (typeof actor === 'string') Object.assign(opts, { actor });
  const event = options.event ?? options['hook-event'];
  if (typeof event === 'string' && event) {
    Object.assign(opts, { hookEvent: event as VoiceLogHookEvent });
  }
  if (typeof options.path === 'string' && options.path) Object.assign(opts, { path: options.path });
  return opts;
}

/**
 * Read `--limit`, falling back to the caller's default.
 *
 * Exists so an out-of-range or non-numeric `--limit` degrades to the default
 * instead of producing an empty screen the operator would read as "no activity".
 * The design bias throughout this command is that a bad flag must never be able
 * to manufacture a false silence.
 *
 * @param options Parsed CLI options.
 * @param fallback Value to use when `--limit` is absent or unusable.
 * @returns A positive integer limit.
 */
function resolveLimit(options: CLIOptions, fallback: number): number {
  const raw = options.limit;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

/**
 * Render an actor id for human display.
 *
 * The empty actor is not a formatting edge case — it means the tentacle ran
 * without `PD_ACTOR`, which disables every per-actor key class (inbox, parley).
 * Naming it explicitly is the point: a column of blanks reads as a rendering
 * bug, while `(unidentified)` reads as the misconfiguration it actually is.
 *
 * @param actor Raw actor id from the event.
 * @returns The id, or a parenthesized marker when it is empty.
 */
function actorLabel(actor: string): string {
  return actor.trim() ? actor : UNIDENTIFIED_ACTOR;
}

/**
 * Format one event as an aligned, colorized line.
 *
 * Colour carries the outcome so a screenful is scannable without reading: green
 * spoke, dim silent, yellow suppressed. The intent is that the operator's eye
 * lands on the yellow lines, because those are the only ones with an action
 * attached.
 *
 * @param event The event to render.
 * @param now Current epoch ms, used for the relative timestamp.
 * @returns One display line, without a trailing newline.
 */
function formatEventLine(event: VoiceLogEvent, now: number): string {
  const age = `${relativeTime(Math.max(0, now - event.ts))} ago`.padStart(9);
  const actor = actorLabel(event.actor).slice(0, 28).padEnd(28);
  const body = describeVoiceLogEvent(event);
  const painted = event.outcome === 'spoke'
    ? ui.fmtGreen(body)
    : event.outcome === 'suppressed'
      ? ui.fmtYellow(body)
      : ui.fmtDim(body);
  return `  ${ui.fmtDim(age)}  ${ui.fmtCyan(actor)}  ${painted}`;
}

/**
 * Print the "there is no log yet" state, in whichever format was asked for.
 *
 * **Why this is its own function.** It is the single most important honesty
 * requirement of the command: a missing file means the harness has never
 * completed a hooked turn against this `PD_HOME`, which is a setup fact, not a
 * measurement. Rendering it through the same code path as a real summary is what
 * would let a `0%` quiet rate escape onto an operator's screen and be believed.
 *
 * @param result The read result (already known to be empty of data).
 * @param options Parsed CLI options, consulted for `--json`.
 * @returns Nothing; writes to stdout.
 */
function printNoData(result: VoiceLogReadResult, options: CLIOptions): void {
  if (isJson(options)) {
    console.log(JSON.stringify({
      schemaVersion: 1,
      hasData: false,
      reason: !result.exists
        ? 'no-log-file'
        : result.readError
          ? 'unreadable'
          : result.linesRead > result.malformed
            ? 'no-matching-events'
            : 'log-empty',
      path: result.path,
      exists: result.exists,
      malformed: result.malformed,
      readError: result.readError ?? null,
      hint: 'Arm the harness with `pd squid on`, then take a turn in a hooked agent session.',
    }, null, 2));
    return;
  }
  console.log('');
  ui.info('Giant Squid VoiceLog — no data yet');
  console.log(`  ${ui.fmtDim(`path: ${result.path}`)}`);
  if (result.readError) {
    console.log(`  ${ui.fmtYellow(`the file exists but could not be read: ${result.readError}`)}`);
  } else if (!result.exists) {
    console.log(`  ${ui.fmtDim('the tentacle has never written a turn here — this is NOT "the harness was quiet".')}`);
    console.log(`  ${ui.fmtDim('Arm it: pd squid on   ·   then take a turn in a hooked agent session.')}`);
  } else if (result.malformed > 0) {
    console.log(`  ${ui.fmtYellow(`${result.malformed} line(s) present but unreadable — none parsed as a VoiceLog event.`)}`);
  } else {
    console.log(`  ${ui.fmtDim('the log exists but no turn matched these filters.')}`);
  }
  console.log('');
}

/**
 * Print the read's own provenance line (how much was read, what was skipped).
 *
 * Motivation: every count this command prints is derived from a lossy source — a
 * byte-bounded tail of a file that concurrent shell processes append to. Stating
 * the losses next to the numbers is what keeps the summary from over-claiming;
 * the alternative, a bare total, invites the operator to treat a truncated read
 * as the complete history of the fleet.
 *
 * @param result The read result to describe.
 * @returns Nothing; writes to stdout.
 */
function printProvenance(result: VoiceLogReadResult): void {
  const bits: string[] = [`${result.linesRead} line(s) read`];
  if (result.malformed > 0) bits.push(`${result.malformed} unreadable line(s) skipped`);
  if (result.filteredOut > 0) bits.push(`${result.filteredOut} filtered out`);
  if (result.droppedByLimit > 0) bits.push(`${result.droppedByLimit} older event(s) not shown`);
  if (result.headTruncated) bits.push('tail-read only (log exceeded the read budget)');
  console.log(`  ${ui.fmtDim(`${result.path}`)}`);
  console.log(`  ${ui.fmtDim(bits.join(' · '))}`);
}

/**
 * Format a nullable rate for display.
 *
 * The `null` case renders as `n/a` rather than `0.0%` on purpose — see
 * {@link summarize}'s rationale. This function is the last place that decision
 * could be accidentally undone, so it is deliberately the only formatter for a
 * rate in this file.
 *
 * @param rate Percentage in 0–100, or `null` when unmeasured.
 * @returns A display string, either `12.5%` or `n/a`.
 */
function formatRate(rate: number | null): string {
  return rate === null ? 'n/a' : `${rate.toFixed(1)}%`;
}

/**
 * Render the `--stats` view for humans.
 *
 * The ordering is the argument: turns recorded, then how often the model heard
 * ANYTHING, then the quiet rate the operator explicitly asked for, then the
 * breakdown of *why* it was quiet. Silence reasons and suppression reasons are
 * printed as separate blocks because they mean opposite things — one is "no
 * signal existed", the other is "signal existed and a bound ate it" — and a
 * single merged list would flatten that distinction back out.
 *
 * @param summary Statistics computed by {@link summarize}.
 * @param result The read that produced them, for provenance.
 * @param now Current epoch ms, for the window description.
 * @returns Nothing; writes to stdout.
 */
function printStats(summary: VoiceLogSummary, result: VoiceLogReadResult, now: number): void {
  console.log('');
  ui.info('Giant Squid VoiceLog — statistics');
  printProvenance(result);
  console.log('');
  const window = summary.firstTs !== null && summary.lastTs !== null
    ? `${relativeTime(Math.max(0, now - summary.firstTs))} ago → ${relativeTime(Math.max(0, now - summary.lastTs))} ago`
    : 'unknown window';
  console.log(`  Turns recorded        ${String(summary.total).padStart(6)}  ${ui.fmtDim(window)}`);
  console.log(`  Actors seen           ${String(summary.actors).padStart(6)}`);
  console.log('');
  console.log(`  ${ui.fmtGreen('Spoke')}                 ${String(summary.spoke).padStart(6)}  ${formatRate(summary.spokeRate)} of turns injected context`);
  console.log(`  ${ui.fmtBold('QUIET (said nothing)')}  ${String(summary.saidNothing).padStart(6)}  ${ui.fmtBold(formatRate(summary.quietRate))}  ${ui.fmtDim(`= ${summary.silent} silent + ${summary.saidNothing - summary.silent} fully suppressed`)}`);
  const partial = summary.partiallySuppressed > 0
    ? ui.fmtDim(`(${summary.partiallySuppressed} partial — some context still got through)`)
    : '';
  console.log(`  ${ui.fmtYellow('Suppressed')}            ${String(summary.suppressed).padStart(6)}  ${formatRate(summary.suppressedRate)}  ${partial}`);
  console.log('');
  console.log('  Silence reasons (nothing existed to say):');
  const silence = Object.entries(summary.silenceReasons).sort((a, b) => b[1] - a[1]);
  if (silence.length === 0) console.log(`    ${ui.fmtDim('none')}`);
  for (const [reason, count] of silence) {
    console.log(`    ${reason.padEnd(22)} ${String(count).padStart(6)}`);
  }
  console.log('');
  console.log(`  ${ui.fmtYellow('Suppression reasons (it HAD something and a bound ate it):')}`);
  const suppression = Object.entries(summary.suppressionReasons).sort((a, b) => b[1] - a[1]);
  if (suppression.length === 0) console.log(`    ${ui.fmtDim('none — no turn was silenced by its own bounds')}`);
  for (const [reason, count] of suppression) {
    console.log(`    ${reason.padEnd(22)} ${String(count).padStart(6)}`);
  }
  console.log('');
  console.log(`  Entries injected by class ${ui.fmtDim(`(${summary.bytesInjected}B total)`)}:`);
  const injected = Object.entries(summary.injectedByClass).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  if (injected.length === 0) console.log(`    ${ui.fmtDim('none')}`);
  for (const [cls, count] of injected) {
    console.log(`    ${cls.padEnd(22)} ${String(count).padStart(6)}`);
  }
  if (Object.keys(summary.withheldByClass).length > 0) {
    console.log('');
    console.log(`  Entries HELD but not delivered ${ui.fmtDim(`(${summary.bytesWithheld}B withheld)`)}:`);
    for (const [cls, count] of Object.entries(summary.withheldByClass).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))) {
      console.log(`    ${cls.padEnd(22)} ${String(count).padStart(6)}`);
    }
  }
  console.log('');
  if (summary.suppressed > 0) {
    console.log(`  ${ui.fmtDim('Actionable list: pd squid voice --suppressed')}`);
    console.log('');
  }
}

/**
 * Render a list of events for humans, newest last.
 *
 * Newest-last is chosen over newest-first because this output is read in a
 * scrolling terminal, where the last line printed is the one under the cursor —
 * the same reason `git log -p | tail` feels wrong and `tail -f` feels right. It
 * also makes the static view and `--follow` read identically, so an operator
 * does not have to re-orient when switching between them.
 *
 * @param events Events in chronological order.
 * @param now Current epoch ms for relative timestamps.
 * @returns Nothing; writes to stdout.
 */
function printEvents(events: readonly VoiceLogEvent[], now: number): void {
  for (const event of events) console.log(formatEventLine(event, now));
}

/**
 * Emit the machine-readable form of any view.
 *
 * One JSON shape serves every subcommand — the view only changes which events
 * are in `events`. The purpose is that a script wrapping this command does not
 * need a per-flag parser, and that `summary` is always present so an alerting
 * rule can key on `quietRate` without re-deriving it (and without inventing a
 * `0` where the reader honestly returned `null`).
 *
 * @param view Which view produced this payload.
 * @param result The read result.
 * @param summary Statistics over the surviving events.
 * @returns Nothing; writes to stdout.
 */
function printJson(view: string, result: VoiceLogReadResult, summary: VoiceLogSummary): void {
  console.log(JSON.stringify({
    schemaVersion: 1,
    view,
    hasData: true,
    path: result.path,
    exists: result.exists,
    sizeBytes: result.sizeBytes,
    linesRead: result.linesRead,
    malformed: result.malformed,
    filteredOut: result.filteredOut,
    droppedByLimit: result.droppedByLimit,
    headTruncated: result.headTruncated,
    summary,
    events: result.events,
  }, null, 2));
}

/**
 * `--follow`: poll the log and print each new event as it lands.
 *
 * **Design.** A poll rather than `fs.watch` because the writer is a POSIX-sh
 * script that appends and periodically rewrites the file during rotation;
 * watch-based tailing on that pattern is famously platform-dependent, while a
 * 1s stat+read is boring and correct everywhere. Rotation is handled inside
 * {@link readVoiceLogFrom}, which resets the cursor when the file shrinks, so a
 * long-running follow survives the tentacle's own log rotation instead of
 * silently going deaf — the failure mode that would make this view lie in
 * exactly the situation (a busy fleet) where it matters most.
 *
 * @param path Log path to follow.
 * @param intervalMs Poll interval in milliseconds.
 * @returns A promise that resolves when the operator interrupts the command.
 */
async function followVoiceLog(path: string, intervalMs: number): Promise<void> {
  const initial = readVoiceLog({ path, limit: DEFAULT_RECENT_LIMIT });
  const now = Date.now();
  console.log('');
  ui.info(`Giant Squid VoiceLog — following ${path}`);
  console.log(`  ${ui.fmtDim('Ctrl-C to stop. Nothing appears until an agent takes a turn.')}`);
  console.log('');
  printEvents(initial.events, now);

  let cursor: VoiceLogCursor = { offset: initial.exists ? initial.sizeBytes : 0 };
  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      const chunk = readVoiceLogFrom(path, cursor);
      cursor = chunk.cursor;
      if (chunk.rotated) {
        console.log(`  ${ui.fmtDim('— log rotated; continuing from the new file —')}`);
      }
      printEvents(chunk.events, Date.now());
    }, intervalMs);
    const stop = (): void => {
      clearInterval(timer);
      console.log('');
      resolve();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

/**
 * Print the command's help text.
 *
 * @returns Nothing; writes to stdout. Its purpose is to state, in the operator's
 *          own terms, the question each view answers — the flags are secondary
 *          to the diagnosis they support.
 */
function printHelp(): void {
  console.log(`Usage:
  pd squid voice [recent]  [filters]    Recent turns — spoke / quiet / suppressed
  pd squid voice --stats                How often the harness is quiet, and why
  pd squid voice --suppressed           ONLY turns where a bound ate real content
  pd squid voice --follow               Live tail (Ctrl-C to stop)

Filters:
  --since <30m|2h|7d|epoch|ISO>   Only turns since then
  --actor <id>                    Only this actor (use "" for unidentified turns)
  --event <hookEvent>             UserPromptSubmit | PreToolUse | ...
  --limit <n>                     Recent-list size (default ${DEFAULT_RECENT_LIMIT})
  --path <file>                   Read a specific log file
  --interval <ms>                 --follow poll interval (default ${DEFAULT_FOLLOW_INTERVAL_MS})
  --json                          Machine-readable output for any view

What the outcomes mean:
  spoke        context was injected into that turn
  silent       nothing existed to say (calm fleet, working harness)
  suppressed   something DID exist and the harness's own bounds dropped it —
               this is the actionable one; a stale matrix, a blown byte budget,
               or an entry cap means the fleet was talking and the agent never heard it.

The log is written by the UserPromptSubmit tentacle at
  \${PD_SQUID_VOICE_LOG:-\$PD_HOME/squid-voice-log.jsonl}
and is byte-bounded + rotated by the tentacle itself.`);
}

/**
 * Entry point for `pd squid voice`.
 *
 * **Purpose.** One command that answers "is the harness talking, and if not,
 * why not?" — with the deliberate property that it can never fabricate a
 * measurement. Every path through it either reports real events or says "no data
 * yet"; there is no branch that prints a rate derived from zero turns.
 *
 * The exit code stays 0 even for `--suppressed` with findings: this is an
 * observability read, and making it non-zero would break the operator's habit of
 * piping it next to other status commands. Anything that must gate on
 * suppression should read `summary.suppressedRate` from `--json`.
 *
 * @param args Positional args after `pd squid voice` (an optional view name).
 * @param options Parsed CLI flags.
 * @returns A promise resolving when output is complete (or the follow ends).
 */
export async function handleSquidVoice(args: string[], options: CLIOptions): Promise<void> {
  const sub = (args[0] || '').toLowerCase();
  if (sub === 'help' || sub === '--help' || sub === '-h' || options.help === true) {
    printHelp();
    return;
  }

  const now = Date.now();
  let readOpts: ReadVoiceLogOptions;
  try {
    readOpts = voiceReadOptions(options, now);
  } catch (err) {
    ui.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }

  const wantsStats = options.stats === true || sub === 'stats';
  const wantsSuppressed = options.suppressed === true || sub === 'suppressed';
  const wantsFollow = options.follow === true || options.f === true || sub === 'follow';

  if (wantsFollow) {
    const rawInterval = options.interval;
    const parsed = typeof rawInterval === 'number' ? rawInterval : parseInt(String(rawInterval ?? ''), 10);
    const intervalMs = Number.isFinite(parsed) && parsed >= 100 ? parsed : DEFAULT_FOLLOW_INTERVAL_MS;
    await followVoiceLog(readOpts.path ?? voiceLogPath(), intervalMs);
    return;
  }

  if (wantsSuppressed) Object.assign(readOpts, { outcome: 'suppressed' as const });
  // Stats must see the whole filtered window; only the list views are capped.
  if (!wantsStats) Object.assign(readOpts, { limit: resolveLimit(options, DEFAULT_RECENT_LIMIT) });

  const result = readVoiceLog(readOpts);
  const summary = summarize(result.events);

  if (!result.exists || result.readError || result.events.length === 0) {
    printNoData(result, options);
    return;
  }

  if (isJson(options)) {
    printJson(wantsStats ? 'stats' : wantsSuppressed ? 'suppressed' : 'recent', result, summary);
    return;
  }

  if (wantsStats) {
    printStats(summary, result, now);
    return;
  }

  console.log('');
  ui.info(wantsSuppressed
    ? 'Giant Squid VoiceLog — suppressed turns (it should still have talked)'
    : 'Giant Squid VoiceLog — recent turns');
  printProvenance(result);
  console.log('');
  printEvents(result.events, now);
  console.log('');
  if (!wantsSuppressed) {
    console.log(`  ${ui.fmtDim(`quiet on ${formatRate(summary.quietRate)} of these turns · full picture: pd squid voice --stats`)}`);
  } else {
    console.log(`  ${ui.fmtDim(`${result.events.length} suppressed turn(s) shown · ${summary.bytesWithheld}B of coordination context never reached an agent`)}`);
  }
  console.log('');
}
