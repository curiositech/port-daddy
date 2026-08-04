/**
 * The VoiceLog reader — the TS side of "when did the harness actually talk?"
 * ==========================================================================
 *
 * `bin/pd-hook-prompt` appends exactly one JSON line to
 * `$PD_HOME/squid-voice-log.jsonl` on every UserPromptSubmit, carrying the
 * {@link VoiceLogEvent} shape from `lib/squid/reconcile-contract.ts`. This module
 * is the only sanctioned reader of that file: it parses, filters, and summarizes
 * it for `pd squid voice`.
 *
 * ## Why a reader at all
 *
 * The Giant Squid harness is deliberately quiet — it injects nothing when there
 * is nothing fresh to say. That is the right product behaviour and a terrible
 * debugging experience, because from the outside a *calm fleet*, a *broken
 * harness*, and a *harness strangled by its own byte budget* all look identical:
 * no text in the prompt. The VoiceLog exists to make those three states
 * distinguishable, and this module exists so an operator can ask the question in
 * one command instead of reading JSONL by hand.
 *
 * ## Three design rules, all of them load-bearing
 *
 * 1. **Never throw on bad input.** The log is written by a POSIX-sh script on
 *    every turn of every agent, in parallel, while a rotation may be truncating
 *    the head of the file. Torn and interleaved lines are *expected*, not
 *    exceptional. A malformed line is skipped and counted — see
 *    {@link parseVoiceLogLine} — because a reader that throws turns a cosmetic
 *    write race into a broken operator surface.
 * 2. **Absent data is not zero data.** {@link readVoiceLog} reports `exists:
 *    false` distinctly from an empty file, and {@link summarize} returns `null`
 *    (never `0`) for every rate when there are no events. "The harness was quiet
 *    100% of the time" and "the harness has never run here" are opposite
 *    diagnoses and must never render with the same number.
 * 3. **Bounded reads.** The writer caps the file at 256 KiB, but
 *    `PD_SQUID_VOICE_LOG` can point anywhere. Reads are tail-bounded by
 *    {@link DEFAULT_VOICE_LOG_READ_BYTES} so `pd squid voice` cannot be turned
 *    into an OOM by a mis-set env var — the same posture
 *    `skills/responsible-logging` demands of the writer.
 *
 * @module lib/squid/voice-log
 */

import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { pdRoot } from './matrix.js';
import type {
  ReconcileKeyClassName,
  VoiceLogEvent,
  VoiceLogHookEvent,
  VoiceLogSilenceReason,
  VoiceLogSuppressionReason,
} from './reconcile-contract.js';

// ─── Location ─────────────────────────────────────────────────────────────────

/** Basename of the VoiceLog, matching `VOICE_LOG` in `bin/pd-hook-prompt`. */
export const VOICE_LOG_FILENAME = 'squid-voice-log.jsonl';

/**
 * Upper bound on how many bytes of the log a single read will touch (1 MiB).
 *
 * The rationale is containment, not speed: the shell writer rotates at 256 KiB,
 * so a healthy log always fits several times over, and anything larger means the
 * operator repointed `PD_SQUID_VOICE_LOG` at a file this tool did not create.
 * Reading the tail of that file is useful; slurping an unbounded one into a CLI
 * process is how an observability command becomes the outage.
 */
export const DEFAULT_VOICE_LOG_READ_BYTES = 1024 * 1024;

/**
 * Resolve the VoiceLog path the same way the shell tentacle does.
 *
 * **Design.** The precedence (`PD_SQUID_VOICE_LOG`, then `$PD_HOME`, then
 * `~/.port-daddy`) is copied deliberately from `bin/pd-hook-prompt` and routed
 * through `pdRoot()` so the reader and the writer cannot drift: a test harness
 * that sets `PD_HOME` to a temp dir must move BOTH ends, or `pd squid voice`
 * would cheerfully report "no data yet" about a file that is being written a
 * directory away.
 *
 * @param env Environment to resolve from; injectable so tests need not mutate
 *            `process.env` globally.
 * @returns Absolute path to the JSONL VoiceLog (which may not exist yet).
 */
export function voiceLogPath(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.PD_SQUID_VOICE_LOG;
  if (explicit && explicit.trim()) return explicit;
  return join(pdRoot(), VOICE_LOG_FILENAME);
}

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Class names that can appear in a VoiceLog `counts`/`classes` field.
 *
 * This is intentionally WIDER than {@link ReconcileKeyClassName}: the prompt
 * tentacle also projects the two pre-reconcile legacy classes (`ALERT`,
 * `PHEROMONE`) and records them in the same object. Narrowing them away in the
 * reader would show an operator `counts: {}` on a turn that injected ten
 * pheromone traces — a lie of omission in the one surface whose entire purpose
 * is to be believed.
 */
export type VoiceLogClassName = ReconcileKeyClassName | 'ALERT' | 'PHEROMONE';

/** Per-class tally keyed by {@link VoiceLogClassName}; absent means zero. */
export type VoiceLogClassTally = Partial<Record<VoiceLogClassName, number>>;

/** Filters accepted by {@link readVoiceLog}. All are AND-combined. */
export interface ReadVoiceLogOptions {
  /** Explicit log path; defaults to {@link voiceLogPath}. */
  path?: string;
  /** Keep events at or after this epoch-ms timestamp. */
  since?: number;
  /** Keep events at or before this epoch-ms timestamp. */
  until?: number;
  /** Keep events from this raw actor id (exact match; `''` matches unidentified). */
  actor?: string;
  /** Keep events from these hook surfaces. */
  hookEvent?: VoiceLogHookEvent | readonly VoiceLogHookEvent[];
  /** Keep events with these outcomes. */
  outcome?: VoiceLogEvent['outcome'] | readonly VoiceLogEvent['outcome'][];
  /** Keep only the newest N surviving events (0 or negative disables). */
  limit?: number;
  /** Tail-read ceiling; defaults to {@link DEFAULT_VOICE_LOG_READ_BYTES}. */
  maxBytes?: number;
}

/**
 * The outcome of one read. Carries the *provenance* of the numbers, not just the
 * numbers: `exists`, `malformed`, and `headTruncated` are what let the CLI tell
 * an honest story about how complete its own answer is.
 */
export interface VoiceLogReadResult {
  /** Path actually read. */
  readonly path: string;
  /** Whether the file exists. `false` means "no data yet", NEVER "no activity". */
  readonly exists: boolean;
  /** Size on disk in bytes (0 when absent). */
  readonly sizeBytes: number;
  /** Surviving events in file (append) order — oldest first, newest last. */
  readonly events: readonly VoiceLogEvent[];
  /** Non-empty lines examined. */
  readonly linesRead: number;
  /** Lines that did not parse as a contract-shaped event, and were skipped. */
  readonly malformed: number;
  /** Well-formed events removed by the filters in {@link ReadVoiceLogOptions}. */
  readonly filteredOut: number;
  /** Well-formed, filter-surviving events dropped by `limit`. */
  readonly droppedByLimit: number;
  /** True when the file exceeded `maxBytes` and only its tail was read. */
  readonly headTruncated: boolean;
  /** Set when the file existed but could not be read (permissions, race). */
  readonly readError?: string;
}

/**
 * The operator-facing statistics. Every rate is `number | null`, and `null`
 * means "no data", which is the whole reason this interface is not just a bag of
 * numbers.
 */
export interface VoiceLogSummary {
  /** Total well-formed events considered. */
  readonly total: number;
  /** Turns where context was injected. */
  readonly spoke: number;
  /** Turns where there was genuinely nothing to say. */
  readonly silent: number;
  /** Turns where something existed and a bound ate some or all of it. */
  readonly suppressed: number;
  /** Turns where NOTHING reached the model: silent + fully-suppressed. */
  readonly saidNothing: number;
  /** Suppressed turns that still emitted bytes (a partial, ordered drop). */
  readonly partiallySuppressed: number;
  /**
   * Percentage (0–100) of turns on which the model received nothing at all.
   * `null` when {@link total} is 0 — an unmeasured rate is not a 0% rate.
   */
  readonly quietRate: number | null;
  /** Percentage (0–100) of turns that injected at least one byte, or `null`. */
  readonly spokeRate: number | null;
  /**
   * Percentage (0–100) of turns suppressed by the harness's own bounds, or
   * `null`. This is the actionable number: it is the harness losing arguments
   * with itself, not the fleet being calm.
   */
  readonly suppressedRate: number | null;
  /** Count per {@link VoiceLogSilenceReason}. */
  readonly silenceReasons: Partial<Record<VoiceLogSilenceReason, number>>;
  /** Count per {@link VoiceLogSuppressionReason}. */
  readonly suppressionReasons: Partial<Record<VoiceLogSuppressionReason, number>>;
  /** Entries actually injected, summed per class over `spoke` events. */
  readonly injectedByClass: VoiceLogClassTally;
  /** Entries HELD but not fully emitted, summed per class over `suppressed` events. */
  readonly withheldByClass: VoiceLogClassTally;
  /** How often each class appeared in a `droppedClasses` list. */
  readonly droppedByClass: VoiceLogClassTally;
  /** Bytes injected across `spoke` events. */
  readonly bytesInjected: number;
  /** Bytes `suppressed` events wanted to emit but did not. */
  readonly bytesWithheld: number;
  /** Distinct raw actor ids seen (the empty id counts as one: "unidentified"). */
  readonly actors: number;
  /** Count per hook surface. */
  readonly byHookEvent: Partial<Record<VoiceLogHookEvent, number>>;
  /** Epoch ms of the oldest / newest event, or `null` with no data. */
  readonly firstTs: number | null;
  readonly lastTs: number | null;
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

const HOOK_EVENTS: ReadonlySet<string> = new Set<VoiceLogHookEvent>([
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'SessionStart',
  'Stop',
  'local-citizen-turn',
]);

const SILENCE_REASONS: ReadonlySet<string> = new Set<VoiceLogSilenceReason>([
  'no-entries',
  'matrix-absent',
  'harness-disabled',
]);

const SUPPRESSION_REASONS: ReadonlySet<string> = new Set<VoiceLogSuppressionReason>([
  'over-budget',
  'over-entry-cap',
  'stale-matrix',
  'ttl-expired',
  'not-relevant-to-cwd',
]);

/**
 * Coerce a JSON value into a per-class count map.
 *
 * **Design.** Unknown class names are KEPT rather than dropped. The purpose is
 * forward compatibility in the one direction that actually happens: a newer
 * tentacle staged under `~/.port-daddy/bin` writing a class an older `pd` binary
 * has never heard of. Silently deleting it would make the older CLI under-report
 * injections and look like a coordination bug.
 *
 * @param value Raw `counts` field from a parsed JSON line.
 * @returns A tally with only finite non-negative numeric entries, or `undefined`
 *          when the field is not a plain object.
 */
function coerceCounts(value: unknown): VoiceLogClassTally | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) continue;
    out[key] = raw;
  }
  return out as VoiceLogClassTally;
}

/**
 * Coerce a JSON value into a list of class names.
 *
 * The intent mirrors {@link coerceCounts}: keep every string the writer emitted,
 * discard only structurally impossible entries, so the reader never quietly
 * rewrites the record it exists to display.
 *
 * @param value Raw `classes` / `droppedClasses` field.
 * @returns The string entries, or `undefined` when the field is not an array.
 */
function coerceClassList(value: unknown): VoiceLogClassName[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((v): v is string => typeof v === 'string') as VoiceLogClassName[];
}

/**
 * Parse one JSONL line into a contract-shaped {@link VoiceLogEvent}.
 *
 * **Motivation.** This is the tolerance boundary of the whole module. The log is
 * appended by a shell script from every agent process concurrently, and rotated
 * by truncating its head — so a partial line, a line spliced from two writes, or
 * a line written by a future version are all normal occurrences. The design
 * choice is to validate strictly but fail *quietly*: anything that does not
 * match the contract returns `undefined` and is counted as malformed by the
 * caller, so a torn write costs one line of fidelity instead of the command.
 *
 * Validation is deliberately shape-level, not value-level: `ts` must be a finite
 * number, `hookEvent` and the reason enums must be members of the contract's
 * unions, and the outcome-specific fields must be present with the right JSON
 * types. A line with an unknown `outcome` is malformed rather than passed
 * through, because every downstream consumer discriminates on that field.
 *
 * @param line One raw line from the JSONL log (leading/trailing space tolerated).
 * @returns The parsed event, or `undefined` when the line is blank or malformed.
 */
export function parseVoiceLogLine(line: string): VoiceLogEvent | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;

  const ts = obj.ts;
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return undefined;
  const actor = obj.actor;
  if (typeof actor !== 'string') return undefined;
  const hookEvent = obj.hookEvent;
  if (typeof hookEvent !== 'string' || !HOOK_EVENTS.has(hookEvent)) return undefined;
  const base = { ts, actor, hookEvent: hookEvent as VoiceLogHookEvent };

  switch (obj.outcome) {
    case 'spoke': {
      const counts = coerceCounts(obj.counts);
      const classes = coerceClassList(obj.classes);
      const bytes = obj.bytes;
      if (!counts || !classes || typeof bytes !== 'number' || !Number.isFinite(bytes)) {
        return undefined;
      }
      return { ...base, outcome: 'spoke', counts, bytes, classes } as VoiceLogEvent;
    }
    case 'silent': {
      const reason = obj.reason;
      if (typeof reason !== 'string' || !SILENCE_REASONS.has(reason)) return undefined;
      return { ...base, outcome: 'silent', reason: reason as VoiceLogSilenceReason };
    }
    case 'suppressed': {
      const reason = obj.reason;
      if (typeof reason !== 'string' || !SUPPRESSION_REASONS.has(reason)) return undefined;
      const counts = coerceCounts(obj.counts);
      const droppedClasses = coerceClassList(obj.droppedClasses);
      const bytes = obj.bytes;
      const emittedBytes = obj.emittedBytes;
      if (
        !counts
        || !droppedClasses
        || typeof bytes !== 'number' || !Number.isFinite(bytes)
        || typeof emittedBytes !== 'number' || !Number.isFinite(emittedBytes)
      ) {
        return undefined;
      }
      return {
        ...base,
        outcome: 'suppressed',
        reason: reason as VoiceLogSuppressionReason,
        counts,
        bytes,
        droppedClasses,
        emittedBytes,
      } as VoiceLogEvent;
    }
    default:
      return undefined;
  }
}

// ─── Reading ──────────────────────────────────────────────────────────────────

/**
 * Read the tail of a file as UTF-8, without loading more than `maxBytes`.
 *
 * **Why not `readFileSync`.** The whole point of the byte ceiling is that this
 * command must stay cheap on a log the operator may have repointed at something
 * enormous; `readFileSync` followed by `slice` would allocate the very thing the
 * ceiling exists to avoid. Reading from an explicit offset costs one syscall and
 * bounds the allocation for real.
 *
 * @param path File to read.
 * @param maxBytes Maximum number of trailing bytes to load.
 * @param size Size of the file, already stat-ed by the caller.
 * @returns The decoded tail plus whether the head of the file was skipped.
 */
function readTail(path: string, maxBytes: number, size: number): { text: string; headTruncated: boolean } {
  const start = size > maxBytes ? size - maxBytes : 0;
  const length = size - start;
  if (length <= 0) return { text: '', headTruncated: false };
  const buffer = Buffer.allocUnsafe(length);
  const fd = openSync(path, 'r');
  try {
    let read = 0;
    while (read < length) {
      const n = readSync(fd, buffer, read, length - read, start + read);
      if (n <= 0) break;
      read += n;
    }
    return { text: buffer.subarray(0, read).toString('utf8'), headTruncated: start > 0 };
  } finally {
    closeSync(fd);
  }
}

/**
 * Decide whether one parsed event survives the caller's filters.
 *
 * Split out from {@link readVoiceLog} so the filter semantics are stated once
 * and can be reasoned about on their own: every criterion is a conjunction, an
 * omitted criterion never excludes anything, and `actor: ''` is a real filter
 * (the unidentified agent) rather than "no filter" — the design intent being
 * that an operator can isolate turns where `PD_ACTOR` was never set, which is
 * itself a common misconfiguration.
 *
 * @param event A well-formed event.
 * @param opts The caller's filter options.
 * @returns `true` when the event should be kept.
 */
function matchesFilters(event: VoiceLogEvent, opts: ReadVoiceLogOptions): boolean {
  if (opts.since !== undefined && event.ts < opts.since) return false;
  if (opts.until !== undefined && event.ts > opts.until) return false;
  if (opts.actor !== undefined && event.actor !== opts.actor) return false;
  if (opts.hookEvent !== undefined) {
    const wanted = Array.isArray(opts.hookEvent) ? opts.hookEvent : [opts.hookEvent];
    if (!wanted.includes(event.hookEvent)) return false;
  }
  if (opts.outcome !== undefined) {
    const wanted = Array.isArray(opts.outcome) ? opts.outcome : [opts.outcome];
    if (!wanted.includes(event.outcome)) return false;
  }
  return true;
}

/**
 * Read, parse, and filter the VoiceLog.
 *
 * **Purpose.** This is the single entry point every operator surface uses to
 * answer "what has the harness been doing?". It never throws: a missing file, an
 * unreadable file, and a file full of garbage each produce a *result* describing
 * that condition, because the caller is an observability command and an
 * observability command that crashes tells the operator strictly less than one
 * that reports "I could not read this, here is why".
 *
 * The distinction that matters most in the return value is `exists`. A file that
 * is absent means the tentacle has never completed a turn against this
 * `PD_HOME` — a setup fact. An empty `events` array with `exists: true` means it
 * ran and every line was filtered or malformed — an entirely different fact.
 * Collapsing the two into "0 events" is the specific dishonesty this signature
 * is shaped to prevent.
 *
 * @param opts Path override and filters; see {@link ReadVoiceLogOptions}.
 * @param env Environment used to resolve the default path.
 * @returns A {@link VoiceLogReadResult} describing both the data and the read.
 */
export function readVoiceLog(
  opts: ReadVoiceLogOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): VoiceLogReadResult {
  const path = opts.path ?? voiceLogPath(env);
  const maxBytes = opts.maxBytes && opts.maxBytes > 0 ? opts.maxBytes : DEFAULT_VOICE_LOG_READ_BYTES;

  let size = 0;
  try {
    const stat = statSync(path);
    if (!stat.isFile()) {
      return {
        path,
        exists: false,
        sizeBytes: 0,
        events: [],
        linesRead: 0,
        malformed: 0,
        filteredOut: 0,
        droppedByLimit: 0,
        headTruncated: false,
      };
    }
    size = stat.size;
  } catch {
    return {
      path,
      exists: false,
      sizeBytes: 0,
      events: [],
      linesRead: 0,
      malformed: 0,
      filteredOut: 0,
      droppedByLimit: 0,
      headTruncated: false,
    };
  }

  let text = '';
  let headTruncated = false;
  try {
    const tail = readTail(path, maxBytes, size);
    text = tail.text;
    headTruncated = tail.headTruncated;
  } catch (err) {
    return {
      path,
      exists: true,
      sizeBytes: size,
      events: [],
      linesRead: 0,
      malformed: 0,
      filteredOut: 0,
      droppedByLimit: 0,
      headTruncated: false,
      readError: err instanceof Error ? err.message : String(err),
    };
  }

  const lines = text.split('\n');
  // A tail read almost always starts mid-line; that fragment is not a malformed
  // write by the tentacle, so it must not be counted as one.
  if (headTruncated && lines.length > 0) lines.shift();

  let linesRead = 0;
  let malformed = 0;
  let filteredOut = 0;
  const kept: VoiceLogEvent[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    linesRead += 1;
    const event = parseVoiceLogLine(line);
    if (!event) {
      malformed += 1;
      continue;
    }
    if (!matchesFilters(event, opts)) {
      filteredOut += 1;
      continue;
    }
    kept.push(event);
  }

  let droppedByLimit = 0;
  let events = kept;
  if (opts.limit !== undefined && opts.limit > 0 && kept.length > opts.limit) {
    droppedByLimit = kept.length - opts.limit;
    events = kept.slice(kept.length - opts.limit);
  }

  return {
    path,
    exists: true,
    sizeBytes: size,
    events,
    linesRead,
    malformed,
    filteredOut,
    droppedByLimit,
    headTruncated,
  };
}

/**
 * A resumable position in the VoiceLog, for `--follow`.
 *
 * Holds a byte offset rather than a line count on purpose: the writer rotates by
 * truncating the file's head, so line numbers are not stable across a rotation
 * while "bytes consumed, and how large the file was when we consumed them" is
 * enough to detect one.
 */
export interface VoiceLogCursor {
  /** Byte offset already consumed. */
  readonly offset: number;
}

/** What one incremental poll of the log produced. */
export interface VoiceLogTailChunk {
  /** Cursor to pass to the next poll. */
  readonly cursor: VoiceLogCursor;
  /** Newly appended events, oldest first. */
  readonly events: readonly VoiceLogEvent[];
  /** Newly appended lines that failed to parse. */
  readonly malformed: number;
  /** True when the file shrank (rotation/truncation) and the cursor was reset. */
  readonly rotated: boolean;
  /** Whether the file exists at all right now. */
  readonly exists: boolean;
}

/**
 * Read everything appended to the log since a cursor.
 *
 * **Motivation.** `--follow` needs to be a poll over a file that a shell script
 * is appending to and occasionally truncating from the front. Two hazards make a
 * naive `tail -f` port wrong here, and this function exists to handle both in
 * one tested place rather than inside a `setInterval` callback where nobody can
 * test them: (1) a **rotation** makes the file smaller than the cursor, which
 * must reset to 0 rather than read garbage from a negative range; (2) a
 * **partial line** at the end of the chunk is a write in progress, so the cursor
 * is left just before it and the fragment is re-read whole on the next poll
 * instead of being counted as malformed.
 *
 * @param path File to poll.
 * @param cursor Position returned by the previous call (start with `{offset: 0}`).
 * @returns A {@link VoiceLogTailChunk} with the new events and the next cursor.
 */
export function readVoiceLogFrom(path: string, cursor: VoiceLogCursor): VoiceLogTailChunk {
  let size = 0;
  try {
    size = statSync(path).size;
  } catch {
    return { cursor: { offset: 0 }, events: [], malformed: 0, rotated: false, exists: false };
  }

  let start = cursor.offset;
  let rotated = false;
  if (size < start) {
    // The file got smaller than what we already consumed: it was rotated or
    // recreated. Restart from the top of the new file.
    start = 0;
    rotated = true;
  }
  if (size === start) {
    return { cursor: { offset: start }, events: [], malformed: 0, rotated, exists: true };
  }

  const length = size - start;
  const buffer = Buffer.allocUnsafe(length);
  let read = 0;
  try {
    const fd = openSync(path, 'r');
    try {
      while (read < length) {
        const n = readSync(fd, buffer, read, length - read, start + read);
        if (n <= 0) break;
        read += n;
      }
    } finally {
      closeSync(fd);
    }
  } catch {
    return { cursor: { offset: start }, events: [], malformed: 0, rotated, exists: true };
  }

  const text = buffer.subarray(0, read).toString('utf8');
  const lastNewline = text.lastIndexOf('\n');
  // Nothing complete yet — hold the cursor so the partial line is re-read whole.
  if (lastNewline < 0) {
    return { cursor: { offset: start }, events: [], malformed: 0, rotated, exists: true };
  }
  const complete = text.slice(0, lastNewline);
  const consumed = Buffer.byteLength(complete, 'utf8') + 1;

  const events: VoiceLogEvent[] = [];
  let malformed = 0;
  for (const line of complete.split('\n')) {
    if (!line.trim()) continue;
    const event = parseVoiceLogLine(line);
    if (event) events.push(event);
    else malformed += 1;
  }
  return { cursor: { offset: start + consumed }, events, malformed, rotated, exists: true };
}

// ─── Summary ──────────────────────────────────────────────────────────────────

/**
 * Add a per-class tally into an accumulator.
 *
 * A tiny helper with a real design purpose: per-class arithmetic happens three
 * times in {@link summarize} (injected, withheld, dropped) and each one must
 * treat an absent key as zero rather than `NaN`. Writing it once removes the
 * chance that one of the three quietly poisons a total with `undefined + 1`.
 *
 * @param into Accumulator, mutated in place.
 * @param from Counts to add; `undefined` entries are ignored.
 * @returns Nothing; `into` is mutated.
 */
function addCounts(into: Record<string, number>, from: Record<string, number | undefined>): void {
  for (const [key, value] of Object.entries(from)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    into[key] = (into[key] ?? 0) + value;
  }
}

/**
 * Express a count as a percentage of a total, or `null` when there is no total.
 *
 * **Motivation.** This one-liner is the enforcement point for rule 2 of this
 * module: an unmeasured rate must never render as `0%`. Making the division a
 * named function with a nullable return means every rate in
 * {@link VoiceLogSummary} inherits the honest empty-state behaviour by
 * construction, instead of each call site remembering to guard the divide.
 *
 * @param count Numerator — the events matching some condition.
 * @param total Denominator — all events considered.
 * @returns The percentage in the range 0–100, or `null` when `total` is 0.
 */
function percentOf(count: number, total: number): number | null {
  if (total === 0) return null;
  return (count / total) * 100;
}

/**
 * Compute the operator-facing statistics for a set of events.
 *
 * **The quiet rate, defined precisely.** `quietRate` is the percentage of turns
 * on which the model received *nothing*: every `silent` event, plus every
 * `suppressed` event whose `emittedBytes` is 0. A partially-suppressed turn —
 * one where the drop order sacrificed accomplishments but a halt still got
 * through — is NOT counted as quiet, because the agent did hear the harness that
 * turn. Conflating the two would let a healthy, budget-constrained fleet read as
 * a mute one, which is the exact misdiagnosis this surface exists to prevent;
 * `suppressedRate` is the number to watch for that condition instead.
 *
 * **Why every rate is nullable.** With no events there is no rate. Returning `0`
 * would mean "measured, and it never happened", and an operator who has simply
 * never armed the harness in this `PD_HOME` would read a confident 0% and
 * conclude the harness is healthy. `null` forces the caller to render "no data
 * yet", which is the truth.
 *
 * @param events Well-formed events, typically from {@link readVoiceLog}.
 * @returns A {@link VoiceLogSummary}; all rates are `null` when `events` is empty.
 */
export function summarize(events: readonly VoiceLogEvent[]): VoiceLogSummary {
  const silenceReasons: Partial<Record<VoiceLogSilenceReason, number>> = {};
  const suppressionReasons: Partial<Record<VoiceLogSuppressionReason, number>> = {};
  const byHookEvent: Partial<Record<VoiceLogHookEvent, number>> = {};
  const injectedByClass: Record<string, number> = {};
  const withheldByClass: Record<string, number> = {};
  const droppedByClass: Record<string, number> = {};
  const actors = new Set<string>();

  let spoke = 0;
  let silent = 0;
  let suppressed = 0;
  let saidNothing = 0;
  let partiallySuppressed = 0;
  let bytesInjected = 0;
  let bytesWithheld = 0;
  let firstTs: number | null = null;
  let lastTs: number | null = null;

  for (const event of events) {
    actors.add(event.actor);
    byHookEvent[event.hookEvent] = (byHookEvent[event.hookEvent] ?? 0) + 1;
    if (firstTs === null || event.ts < firstTs) firstTs = event.ts;
    if (lastTs === null || event.ts > lastTs) lastTs = event.ts;

    switch (event.outcome) {
      case 'spoke':
        spoke += 1;
        bytesInjected += event.bytes;
        addCounts(injectedByClass, event.counts);
        break;
      case 'silent':
        silent += 1;
        saidNothing += 1;
        silenceReasons[event.reason] = (silenceReasons[event.reason] ?? 0) + 1;
        break;
      case 'suppressed': {
        suppressed += 1;
        suppressionReasons[event.reason] = (suppressionReasons[event.reason] ?? 0) + 1;
        addCounts(withheldByClass, event.counts);
        for (const cls of event.droppedClasses) {
          droppedByClass[cls] = (droppedByClass[cls] ?? 0) + 1;
        }
        bytesWithheld += Math.max(0, event.bytes - event.emittedBytes);
        if (event.emittedBytes > 0) partiallySuppressed += 1;
        else saidNothing += 1;
        break;
      }
    }
  }

  const total = events.length;

  return {
    total,
    spoke,
    silent,
    suppressed,
    saidNothing,
    partiallySuppressed,
    quietRate: percentOf(saidNothing, total),
    spokeRate: percentOf(total - saidNothing, total),
    suppressedRate: percentOf(suppressed, total),
    silenceReasons,
    suppressionReasons,
    injectedByClass: injectedByClass as VoiceLogClassTally,
    withheldByClass: withheldByClass as VoiceLogClassTally,
    droppedByClass: droppedByClass as VoiceLogClassTally,
    bytesInjected,
    bytesWithheld,
    actors: actors.size,
    byHookEvent,
    firstTs,
    lastTs,
  };
}

/**
 * One-line human description of an event, without any ANSI styling.
 *
 * Kept in the library rather than the CLI because the same sentence is wanted by
 * `--follow`, by the recent list, and by any future FleetBar/dashboard panel
 * (the operator-surface rule in `port-daddy-internal-dev` says the terminal is
 * the secondary surface, so the phrasing should not be trapped inside it).
 *
 * The design constraint is that the three outcomes must never read alike at a
 * glance: `spoke` names what went in, `silent` names why there was nothing, and
 * `suppressed` always names both the bound that fired and what it cost.
 *
 * @param event The event to describe.
 * @returns A single line of plain text with no trailing newline.
 */
export function describeVoiceLogEvent(event: VoiceLogEvent): string {
  switch (event.outcome) {
    case 'spoke': {
      const classes = event.classes.length > 0 ? event.classes.join(', ') : 'no classes';
      return `spoke — ${event.bytes}B · ${classes}`;
    }
    case 'silent':
      return `silent — ${event.reason}`;
    case 'suppressed': {
      const dropped = event.droppedClasses.length > 0
        ? event.droppedClasses.join(', ')
        : 'nothing named';
      const emitted = event.emittedBytes > 0
        ? `${event.emittedBytes}B of ${event.bytes}B survived`
        : `all ${event.bytes}B withheld`;
      return `suppressed (${event.reason}) — ${emitted} · dropped: ${dropped}`;
    }
  }
}
