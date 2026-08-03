/**
 * Harness-injection log — a durable, append-only record of *what the harness
 * feeds each agent* (ch.28 §28.5, "Observably Harnessed").
 * =============================================================================
 *
 * The Port Daddy harness INJECTS context into agents at several points — the
 * SessionStart pilot blob (`hooks/sessionstart-pilot.mjs`), the per-prompt
 * "Suggestibility Envelope" / steering alerts written to `matrix.env`
 * (`lib/squid/matrix.ts`), and the live coordination-state block read each turn
 * by hookless runners (`lib/local-citizen/ink-cloud.ts`). Historically it
 * recorded NONE of it: an agent's turn context was un-attributable after the
 * fact.
 *
 * This module is the ONE shared appender. Each injection site calls
 * `logInjection(rec)` with a light descriptor and we append a single JSONL line
 * to a well-known path under the durable Port Daddy home. A downstream
 * transcript explorer can then attribute every turn's input context to its
 * source and show harness-context stats per step/type — making every runtime
 * (Claude / Codex / Gemini / agy, and the operator session) observably
 * "harnessed".
 *
 * INTENDED CONSUMER: the Workflow Beacon — `~/coding/wf-monitor-plugin/server.js`
 * — is the next slice. It (or a small reader in this repo) will tail this JSONL
 * and render per-step / per-source injection stats. The reader + Beacon UI are
 * deliberately NOT built here.
 *
 * DESIGN CONSTRAINTS
 *  - LIGHT: we store `bytes` + `sha256` of the payload, NOT the payload itself.
 *    Full-payload spill-to-blob (content-addressed, dedup'd) is the ch.28 W8
 *    follow-up; keeping this log light means it can be appended in the hot hook
 *    path without bloating.
 *  - FAIL-OPEN: this sits on the injection / hook path. It MUST NEVER throw into
 *    that path. Every public entry point is wrapped in try/catch and returns
 *    quietly on any error (bad path, unwritable dir, hashing failure, …).
 *  - DURABLE HOME: honors `PD_HOME` exactly like `lib/squid/matrix.ts#pdRoot()`
 *    (and the `pd-hook-*` shell tentacles), so the TS layer and the shell layer
 *    always agree on one runtime root. NEVER /tmp.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

/** Runtimes we can attribute an injection to. `unknown` when undeterminable. */
export type HarnessRuntime = 'claude' | 'codex' | 'gemini' | 'agy' | 'unknown';

/** The injection site that emitted this record. */
export type InjectionSource =
  | 'sessionstart-pilot'
  | 'matrix-envelope'
  | 'ink-cloud'
  | 'other';

/** A caller-supplied injection record (payload passed separately, not stored). */
export interface InjectionRecord {
  /** The runtime the context was injected INTO. Derived if omitted. */
  runtime?: HarnessRuntime;
  /** Which harness site emitted this injection. */
  source: InjectionSource;
  /** The actual injected text/bytes. Hashed + measured, then discarded. */
  payload: string;
  /** Optional harness session id (e.g. Claude Code session). */
  sessionId?: string;
  /** Optional actor/agent id (Port Daddy actor-soul, codex bridge, …). */
  agentId?: string;
  /** Optional cheap turn discriminator (e.g. "turn:12" or a prompt hash). */
  turnHint?: string;
  /**
   * Override the log path. Primarily for tests (inject a temp path so no real
   * ~/.port-daddy write happens). Production callers omit this.
   */
  logPath?: string;
}

/** The line shape actually written to the JSONL log. */
export interface InjectionLogLine {
  ts: string;
  sessionId?: string;
  agentId?: string;
  runtime: HarnessRuntime;
  source: InjectionSource;
  bytes: number;
  sha256: string;
  turnHint?: string;
}

/**
 * Root of Port Daddy runtime state. Mirrors `lib/squid/matrix.ts#pdRoot()`:
 * honor `PD_HOME` (the same override the shell hooks read), else `~/.port-daddy`.
 * NEVER /tmp.
 */
export function pdHome(): string {
  const env = process.env.PD_HOME;
  if (env && env.trim()) return env;
  return join(homedir(), '.port-daddy');
}

/**
 * Canonical path of the harness-injection log. A `PD_HARNESS_INJECTION_LOG`
 * override wins (single concrete file, mirrors the `PD_MATRIX_FILE` pattern);
 * otherwise it derives from `pdHome()`.
 */
export function harnessInjectionLogPath(): string {
  const fileEnv = process.env.PD_HARNESS_INJECTION_LOG;
  if (fileEnv && fileEnv.trim()) return fileEnv;
  return join(pdHome(), 'harness-injections.jsonl');
}

/**
 * Best-effort derivation of the runtime the harness is feeding. Uses only cheap
 * env signals; falls back to `unknown` rather than guessing wrong. Structured
 * env checks ONLY — never keyword-sniff free text.
 */
export function detectRuntime(env: NodeJS.ProcessEnv = process.env): HarnessRuntime {
  // Explicit, structured override always wins.
  const explicit = (env.PD_RUNTIME || '').trim().toLowerCase();
  if (explicit === 'claude' || explicit === 'codex' || env.PD_RUNTIME === 'gemini' ||
      explicit === 'gemini' || explicit === 'agy') {
    return explicit as HarnessRuntime;
  }
  // Claude Code sets CLAUDECODE=1 in the hook/tool environment.
  if (env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT) return 'claude';
  // Codex CLI bridge.
  if (env.CODEX || env.CODEX_SANDBOX || env.CODEX_HOME) return 'codex';
  // Gemini CLI.
  if (env.GEMINI_CLI || env.GEMINI_AGENT) return 'gemini';
  // agy runtime.
  if (env.AGY || env.AGY_RUNTIME) return 'agy';
  return 'unknown';
}

/** SHA-256 hex of a UTF-8 payload. */
function sha256Hex(payload: string): string {
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

/**
 * Append one `context_injected` record to the harness-injection JSONL log.
 *
 * FAIL-OPEN: never throws. Returns the line written (for tests / callers that
 * want to assert), or `null` if anything went wrong. Callers on the hook path
 * should ignore the return value.
 */
export function logInjection(rec: InjectionRecord): InjectionLogLine | null {
  try {
    const payload = typeof rec.payload === 'string' ? rec.payload : String(rec.payload ?? '');
    const line: InjectionLogLine = {
      ts: new Date().toISOString(),
      runtime: rec.runtime ?? detectRuntime(),
      source: rec.source,
      bytes: Buffer.byteLength(payload, 'utf8'),
      sha256: sha256Hex(payload),
    };
    // Only attach optional discriminators when present — keeps lines compact.
    if (rec.sessionId) line.sessionId = rec.sessionId;
    if (rec.agentId) line.agentId = rec.agentId;
    if (rec.turnHint) line.turnHint = rec.turnHint;

    const path = rec.logPath && rec.logPath.trim() ? rec.logPath : harnessInjectionLogPath();
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(line) + '\n', { mode: 0o600 });
    return line;
  } catch {
    // Injection logging is best-effort observability. A failure here must never
    // disrupt the harness feeding the agent. Swallow and move on.
    return null;
  }
}
