/**
 * lib/halt-watch.ts — the daemon's listening watch for the halt sentinel
 * (ADR-0132 phase 3, "Every long-running entity performs an unconditional
 * periodic check of the sentinel and distress file — on a timer, not on a
 * trigger").
 *
 * GMDSS mandated silence periods so weak distress calls could be heard. The
 * daemon's equivalent is a 30-second `setInterval` (unref'd, so it never keeps
 * a stopping process alive) that does one `existsSync` on
 * `~/.port-daddy/HALT`. On the nominal → halted transition it:
 *
 *   1. appends a registry-format `SEEN` line to the distress file,
 *   2. runs the injected `onHalt` callback — server.ts uses it to stop every
 *      background sweep that could spend or coordinate (reaper/resurrection
 *      cleanup, dispatch worker, auto-merge sweep, fleet ticks),
 *   3. appends `COMPLIED` once that callback returned, or `PAN PAN CANNOT-STOP`
 *      if it threw (ADR-0132 registry: "Entity received HALT and could not
 *      comply" — a real signal, not noise).
 *
 * The sentinel's later ABSENCE does not lift the halt: ADR-0132 §4 makes
 * `ALL-CLEAR` operator-only and signed (phase 4). This watch therefore stays
 * `halted` for the life of the process once it has seen the flag, and logs a
 * single line if the file disappears, so nothing resumes on an agent deleting
 * the sentinel.
 *
 * Everything here is guarded so a missing `~/.port-daddy` directory, an
 * unreadable sentinel, or an unwritable distress file is degraded evidence,
 * never an error that takes the daemon down.
 *
 * The halt PREDICATE is `lib/distress.ts#readHalt` (phase 0): sentinel
 * present, OR an unlifted `SECURITE HALT` on the machine-wide register, OR an
 * unreadable home. A daemon that boots after an agent deleted the sentinel is
 * therefore still `halted` on its first check. `readHaltSentinel` below is the
 * existence-only reader kept for callers that pin an explicit `sentinelPath`
 * (tests); the O_APPEND distress write stays inline because it must never
 * throw. The wire format is identical to lib/distress.ts.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { readHalt as readRegisterHalt } from './distress.js';

/** ADR-0132 phase 3: the listening interval every long-running entity keeps. */
export const HALT_WATCH_INTERVAL_MS = 30_000;

/** `/health` state vocabulary this phase contributes (phase 5 completes it). */
export type HaltWatchState = 'nominal' | 'halted';

export interface HaltInfo {
  /** The halt's own line from the sentinel (first non-empty line), or a placeholder. */
  line: string;
  /** The `ref=` value listeners cite: the halt line's ISO timestamp when it has one. */
  ref: string;
  /** Wall-clock ms when this watch first saw the sentinel. */
  detectedAt: number;
  /** Whether `onHalt` completed without throwing. */
  complied: boolean;
}

export interface HaltWatchLogger {
  info(event: string, meta?: Record<string, unknown>): void;
  warn(event: string, meta?: Record<string, unknown>): void;
}

export interface HaltWatchOptions {
  /** `<kind>:<id>` this entity signs distress lines with, e.g. `daemon:prod`. */
  entity: string;
  /** Called exactly once, on the nominal → halted transition. Stop the sweeps here. */
  onHalt: (halt: HaltInfo) => void;
  /**
   * Sentinel path override. When set, the watch reads THAT file only
   * (existence is the signal). When unset, the watch uses the phase-0
   * predicate `lib/distress.ts#readHalt` under `PD_HOME`, which also honours
   * an unlifted HALT on the register after the sentinel is deleted.
   */
  sentinelPath?: string;
  /** Test seam: replaces the halt reader entirely. */
  readHalt?: () => HaltInfo | null;
  /** Machine-wide distress file; defaults to `~/.port-daddy/DISTRESS`. */
  distressPath?: string;
  /** Repo-scoped distress file (`<repo>/.portdaddy/DISTRESS`); appended only if its directory exists. */
  repoDistressPath?: string | null;
  intervalMs?: number;
  now?: () => number;
  logger?: HaltWatchLogger;
}

export interface HaltWatch {
  /** Arm the timer and run one immediate check. Idempotent. */
  start(): void;
  /** Disarm the timer. Does not change the halted state. */
  stop(): void;
  /** One listening-watch tick. Returns true iff the entity is now halted. */
  check(): boolean;
  state(): HaltWatchState;
  halt(): HaltInfo | null;
  /** Number of checks performed since start (test/diagnostic aid). */
  checks(): number;
}

const noopLogger: HaltWatchLogger = { info() {}, warn() {} };

function pdHome(env: NodeJS.ProcessEnv): string {
  return env.PD_HOME || join(homedir(), '.port-daddy');
}

/** `~/.port-daddy/HALT` unless overridden by `PD_HALT_FILE` / `PD_HOME`. */
export function haltSentinelPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.PD_HALT_FILE || join(pdHome(env), 'HALT');
}

/** `~/.port-daddy/DISTRESS` unless overridden by `PD_DISTRESS_FILE` / `PD_HOME`. */
export function distressFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return env.PD_DISTRESS_FILE || join(pdHome(env), 'DISTRESS');
}

/**
 * Read the hoisted sentinel. Existence is the signal; the text is the halt's
 * own `SECURITE HALT` line. Any read error still reports the halt as active,
 * because a sentinel that exists but cannot be read is not "no halt".
 */
export function readHaltSentinel(path: string, now: () => number = Date.now): HaltInfo | null {
  let exists = false;
  try {
    exists = existsSync(path);
  } catch {
    exists = false;
  }
  if (!exists) return null;
  let line = '';
  try {
    const raw = readFileSync(path, 'utf8').slice(0, 1024);
    line = raw.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  } catch {
    line = '';
  }
  if (!line) line = 'SECURITE HALT (sentinel present, no text)';
  const token = line.split(/\s+/, 1)[0] ?? '';
  const ref = /^\d{4}-\d{2}-\d{2}T/.test(token) ? token : 'sentinel';
  return { line, ref, detectedAt: now(), complied: false };
}

/**
 * The phase-0 predicate as `HaltInfo`: sentinel OR unlifted register HALT OR
 * unreadable home (fail closed). Machine-wide only — the daemon's watch is
 * not scoped to whichever repo it happened to be started from.
 */
export function readHaltFromRegister(now: () => number = Date.now): HaltInfo | null {
  const halt = readRegisterHalt({ repoRoot: null });
  if (!halt) return null;
  const first = halt.raw.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  const line = first || 'SECURITE HALT (sentinel present, no text)';
  const ref = halt.record ? halt.record.at : halt.source === 'sentinel' ? 'sentinel' : halt.at;
  return { line, ref, detectedAt: now(), complied: false };
}

export interface DistressLineInput {
  kind: string;
  id: string;
  cls: 'MAYDAY' | 'PAN PAN' | 'SECURITE' | 'ROUTINE' | 'control';
  code: string;
  fields?: Record<string, string | number>;
  text?: string;
}

/** Format one ADR-0132 wire line: `<iso> <kind>:<id> <CLASS> <CODE> [k=v ...] [-- text]`. */
export function formatDistressLine(input: DistressLineInput, at: number): string {
  const ts = new Date(at).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const parts = [ts, `${input.kind}:${input.id}`, input.cls, input.code];
  for (const [k, v] of Object.entries(input.fields ?? {})) {
    parts.push(`${k}=${String(v).replace(/\s+/g, '_')}`);
  }
  if (input.text) parts.push('--', input.text.replace(/[\r\n]+/g, ' '));
  return parts.join(' ');
}

/**
 * Append one line with `O_APPEND` semantics (`appendFileSync` opens with the
 * `a` flag, so concurrent writers never interleave a short line). Returns
 * true iff the write happened; never throws.
 */
export function appendDistressLine(path: string, line: string, opts: { createDir?: boolean } = {}): boolean {
  try {
    const dir = dirname(path);
    if (!existsSync(dir)) {
      if (!opts.createDir) return false;
      mkdirSync(dir, { recursive: true });
    }
    appendFileSync(path, `${line}\n`, { flag: 'a' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create the daemon's halt listening watch. See the module doc for the
 * transition semantics; `start()` performs the first check synchronously so a
 * daemon started under a hoisted flag is `halted` before it serves anything.
 */
export function createHaltWatch(options: HaltWatchOptions): HaltWatch {
  const now = options.now ?? Date.now;
  const logger = options.logger ?? noopLogger;
  const intervalMs = options.intervalMs ?? HALT_WATCH_INTERVAL_MS;
  const sentinelPath = options.sentinelPath ?? haltSentinelPath();
  const readHalt =
    options.readHalt ??
    (options.sentinelPath ? () => readHaltSentinel(sentinelPath, now) : () => readHaltFromRegister(now));
  const distressPath = options.distressPath ?? distressFilePath();
  const repoDistressPath = options.repoDistressPath ?? null;
  const [kind, ...idParts] = options.entity.split(':');
  const id = idParts.join(':') || 'unknown';

  let timer: ReturnType<typeof setInterval> | null = null;
  let halted: HaltInfo | null = null;
  let checks = 0;
  let sentinelGoneLogged = false;

  function record(cls: DistressLineInput['cls'], code: string, fields?: Record<string, string | number>): void {
    const line = formatDistressLine({ kind: kind || 'daemon', id, cls, code, fields }, now());
    const wroteHome = appendDistressLine(distressPath, line, { createDir: true });
    const wroteRepo = repoDistressPath ? appendDistressLine(repoDistressPath, line) : false;
    logger.info('halt_watch_distress', { code, line, wroteHome, wroteRepo });
  }

  function transition(info: HaltInfo): void {
    halted = info;
    logger.warn('halt_sentinel_seen', { sentinel: sentinelPath, ref: info.ref, line: info.line });
    record('control', 'SEEN', { ref: info.ref });
    try {
      options.onHalt(info);
      info.complied = true;
      record('control', 'COMPLIED', { ref: info.ref });
    } catch (err) {
      info.complied = false;
      logger.warn('halt_comply_failed', { error: err instanceof Error ? err.message : String(err) });
      record('PAN PAN', 'CANNOT-STOP', { ref: info.ref });
    }
  }

  function check(): boolean {
    checks += 1;
    if (halted) {
      // Absence is not all-clear (ADR-0132 §4). Note it once; stay halted.
      let stillThere: boolean;
      try { stillThere = existsSync(sentinelPath); } catch { stillThere = true; }
      if (!stillThere && !sentinelGoneLogged) {
        sentinelGoneLogged = true;
        logger.warn('halt_sentinel_removed_awaiting_all_clear', { sentinel: sentinelPath, ref: halted.ref });
      }
      // ROUTINE LISTENING lines belong in the log, not the distress file.
      if (checks % 20 === 0) logger.info('halt_watch_listening', { ref: halted.ref, checks });
      return true;
    }
    const info = readHalt();
    if (!info) return false;
    transition(info);
    return true;
  }

  return {
    start() {
      if (timer) return;
      check();
      timer = setInterval(() => { check(); }, intervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer) { clearInterval(timer); timer = null; }
    },
    check,
    state: () => (halted ? 'halted' : 'nominal'),
    halt: () => halted,
    checks: () => checks,
  };
}
