/**
 * `pd interruptions` — the CLI surface of HITL operator interruptions.
 *
 * Implements surface 3 of the UI contract in docs/hitl-interruptions.md §4:
 *
 *   pd interruptions          List OPEN asks: title, urgency, source agent, age.
 *                             Red ANSI for high/critical. Exit codes are the
 *                             notice: 0 = none open, 1 = open asks exist,
 *                             2 = state UNKNOWN (failed poll / not signed in).
 *   pd interruptions --json   Machine-readable { status, interruptions } for
 *                             scripts. `status` is three-valued and honest:
 *                             'open' | 'none' | 'unknown' — a failed poll is
 *                             NEVER reported as all-clear.
 *
 * Answer/ack is deliberately NOT built here: closing an ask is session-gated
 * on the relay (a bearer token an agent holds must never silence its own
 * escalations), so this command deep-links to `/account/interruptions`.
 *
 * This module also exports the fleet-dispatch pre-flight
 * (`preflightInterruptionsGate`): commands that start NEW dependent agent work
 * (`pd fleet up|run|approve`, `pd dispatch run`) refuse to launch while an
 * unresolved `critical` ask is open, printing why and the deep link.
 * Non-critical asks warn but do not block; an UNKNOWN poll warns honestly and
 * proceeds (a dead relay must not brick local fleet operation, but it is never
 * announced as "all clear").
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PD_HOME } from '../../shared/paths.js';
import { ANSI } from '../../lib/maritime.js';
import * as ui from '../utils/ui.js';
import { isJson, type CLIOptions } from '../types.js';

/** Public relay default — same origin `pd account login` stores tokens for. */
const DEFAULT_RELAY = 'https://port-daddy-relay.erich-owens.workers.dev';

/**
 * Per-poll request timeout (docs/hitl-interruptions.md §5: "Each poll carries
 * a ≤10 s request timeout — a slow relay counts as a failed poll").
 */
const POLL_TIMEOUT_MS = 10_000;

/** Urgency ladder from the relay's data model (§1). */
export type InterruptionUrgency = 'low' | 'normal' | 'high' | 'critical';

/**
 * One open operator ask, in the relay's public shape
 * (`apps/relay/src/interruptions.ts` `publicShape()`).
 */
export interface OperatorInterruption {
  id: string;
  title: string;
  urgency: InterruptionUrgency;
  state: string;
  sourceAgent: string | null;
  /** Unix seconds. */
  createdAt: number;
  body?: string | null;
}

/**
 * Three-valued poll result. `unknown` covers every failure mode — network,
 * non-2xx, revoked token, no stored account — because the contract (§4.5)
 * forbids rendering a failed poll as "all clear".
 */
export type InterruptionsPoll =
  | { status: 'ok'; interruptions: OperatorInterruption[]; accountUrl: string }
  | { status: 'unknown'; reason: string; unauthenticated?: boolean; accountUrl?: string };

interface StoredAccount {
  token: string;
  login: string;
  relayUrl: string;
}

/**
 * Resolve the relay origin: stored account's relay, then
 * `PD_ACCOUNTS_RELAY_URL`, then the public default (mirrors
 * `cli/commands/account.ts`).
 */
function resolveRelayUrl(stored: StoredAccount | null): string {
  const u = stored?.relayUrl?.trim() || process.env.PD_ACCOUNTS_RELAY_URL?.trim() || DEFAULT_RELAY;
  return u.replace(/\/+$/, '');
}

/** Read the device-flow account file written by `pd account login`. */
function readStoredAccount(accountPath: string): StoredAccount | null {
  try {
    const parsed = JSON.parse(readFileSync(accountPath, 'utf8')) as StoredAccount;
    return parsed && typeof parsed.token === 'string' && parsed.token.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Poll `GET /v1/interruptions?state=open` on the relay for the signed-in
 * operator, honestly. Any failure — no stored token, timeout, HTTP error,
 * unparseable body — returns `status: 'unknown'` with a reason; only a clean
 * 200 returns `status: 'ok'`.
 *
 * @param opts.accountPath Override the account.json path (tests).
 * @param opts.timeoutMs   Override the ≤10 s poll timeout (tests).
 */
export async function pollOpenInterruptions(
  opts: { accountPath?: string; timeoutMs?: number } = {},
): Promise<InterruptionsPoll> {
  const accountPath = opts.accountPath ?? join(PD_HOME, 'account.json');
  const stored = readStoredAccount(accountPath);
  if (!stored) {
    return {
      status: 'unknown',
      unauthenticated: true,
      reason: 'not signed in — run: pd account login',
    };
  }

  const relay = resolveRelayUrl(stored);
  const accountUrl = `${relay}/account/interruptions`;
  try {
    const res = await fetch(`${relay}/v1/interruptions?state=open`, {
      headers: { Authorization: `Bearer ${stored.token}` },
      signal: AbortSignal.timeout(opts.timeoutMs ?? POLL_TIMEOUT_MS),
    });
    if (res.status === 401) {
      return {
        status: 'unknown',
        unauthenticated: true,
        reason: 'stored token is revoked or expired — run: pd account login',
        accountUrl,
      };
    }
    if (!res.ok) {
      return { status: 'unknown', reason: `relay returned HTTP ${res.status}`, accountUrl };
    }
    const body = (await res.json()) as { interruptions?: unknown };
    if (!Array.isArray(body.interruptions)) {
      return { status: 'unknown', reason: 'relay response had no interruptions array', accountUrl };
    }
    return { status: 'ok', interruptions: body.interruptions as OperatorInterruption[], accountUrl };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: 'unknown', reason: `poll failed: ${msg}`, accountUrl };
  }
}

/**
 * Human age like `3m`, `2h 05m`, `1d 4h` from unix-seconds `createdAt`.
 * Sub-minute ages render as `<1m` — never an empty column.
 */
export function formatInterruptionAge(createdAt: number, nowMs: number = Date.now()): string {
  const seconds = Math.max(0, Math.floor(nowMs / 1000) - createdAt);
  if (seconds < 60) return '<1m';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/** Red for critical/high (contract §4.2: "visually loud"), yellow normal, dim low. */
function paintUrgency(urgency: InterruptionUrgency, label: string, color: boolean): string {
  if (!color) return label;
  if (urgency === 'critical' || urgency === 'high') return `${ANSI.fgRed}${ANSI.bold}${label}${ANSI.reset}`;
  if (urgency === 'normal') return `${ANSI.fgYellow}${label}${ANSI.reset}`;
  return `${ANSI.dim}${label}${ANSI.reset}`;
}

/**
 * Pure renderer for `pd interruptions` — returns the lines to print and the
 * exit code, so tests can golden-snapshot the output without a TTY.
 *
 * Exit codes: `0` none open · `1` open asks exist (the exit-worthy notice the
 * contract requires) · `2` state unknown.
 */
export function renderInterruptionsReport(
  poll: InterruptionsPoll,
  opts: { nowMs?: number; color?: boolean } = {},
): { lines: string[]; exitCode: 0 | 1 | 2 } {
  const color = opts.color ?? true;
  const nowMs = opts.nowMs ?? Date.now();

  if (poll.status === 'unknown') {
    const lines = [
      `Operator interruption state UNKNOWN — ${poll.reason}`,
      '  This is NOT an all-clear. Agents may be blocked on you right now.',
    ];
    if (poll.accountUrl) lines.push(`  Check the web surface: ${poll.accountUrl}`);
    return { lines, exitCode: 2 };
  }

  const open = poll.interruptions.filter((i) => i.state === 'open');
  if (open.length === 0) {
    return { lines: ['No open operator interruptions.'], exitCode: 0 };
  }

  const noun = open.length === 1 ? 'interruption' : 'interruptions';
  const lines: string[] = [
    `${open.length} open operator ${noun} — agents are waiting on you`,
    '',
  ];
  for (const ask of open) {
    const urgency = paintUrgency(ask.urgency, ask.urgency.toUpperCase().padEnd(8), color);
    const agent = ask.sourceAgent || 'unknown-agent';
    const age = formatInterruptionAge(ask.createdAt, nowMs);
    lines.push(`  ${urgency}  ${ask.title}`);
    lines.push(`            from ${agent} · open ${age}`);
  }
  lines.push('');
  lines.push(`Answer or ack (web only): ${poll.accountUrl}`);
  return { lines, exitCode: 1 };
}

/**
 * Pure decision core for the fleet-dispatch pre-flight. Blocks only on a KNOWN
 * open `critical` ask; warns (without blocking) on non-critical opens and on
 * an unknown poll. An unauthenticated machine (no operator scope at all) is
 * silent — local-only users without a cloud account are not nagged.
 */
export function describeDispatchGate(
  poll: InterruptionsPoll,
  action: string,
  opts: { nowMs?: number; color?: boolean } = {},
): { block: boolean; lines: string[] } {
  const color = opts.color ?? true;
  const nowMs = opts.nowMs ?? Date.now();

  if (poll.status === 'unknown') {
    if (poll.unauthenticated) return { block: false, lines: [] };
    return {
      block: false,
      lines: [
        `Operator interruption state UNKNOWN (${poll.reason}) — proceeding with ${action},`,
        'but this is not an all-clear. Run: pd interruptions',
      ],
    };
  }

  const open = poll.interruptions.filter((i) => i.state === 'open');
  const criticals = open.filter((i) => i.urgency === 'critical');
  if (criticals.length > 0) {
    const lines: string[] = [
      `BLOCKED: refusing to start new dependent work (${action}).`,
      'An unresolved CRITICAL operator interruption is open:',
    ];
    for (const ask of criticals) {
      const agent = ask.sourceAgent || 'unknown-agent';
      const age = formatInterruptionAge(ask.createdAt, nowMs);
      const title = color ? `${ANSI.fgRed}${ANSI.bold}${ask.title}${ANSI.reset}` : ask.title;
      lines.push(`  • ${title} (from ${agent}, open ${age})`);
    }
    lines.push(`Answer or ack it first: ${poll.accountUrl}`);
    lines.push('Then re-run this command.');
    return { block: true, lines };
  }

  if (open.length > 0) {
    const noun = open.length === 1 ? 'ask is' : 'asks are';
    return {
      block: false,
      lines: [
        `${open.length} non-critical operator ${noun} open — not blocking ${action}.`,
        `Review with: pd interruptions  (${poll.accountUrl})`,
      ],
    };
  }

  return { block: false, lines: [] };
}

/**
 * Fleet-dispatch pre-flight (contract §4.3). Call before starting NEW
 * dependent agent work. Returns `true` when the work may proceed; prints why
 * and the `/account/interruptions` deep link and returns `false` when an open
 * `critical` ask blocks it. Callers decide how to exit.
 */
export async function preflightInterruptionsGate(action: string): Promise<boolean> {
  const poll = await pollOpenInterruptions();
  const gate = describeDispatchGate(poll, action);
  if (gate.block) {
    for (const line of gate.lines) ui.error(line);
    return false;
  }
  for (const line of gate.lines) ui.warn(line);
  return true;
}

/**
 * Module-owned help page (`pd interruptions --help`), kept beside the flags
 * it documents and wired into VERB_HELP in bin/port-daddy-cli.ts.
 */
export const INTERRUPTIONS_HELP: string = [
  'Usage: pd interruptions [--json]',
  '',
  'List OPEN operator asks (HITL interruptions) for the signed-in operator:',
  'title, urgency, source agent, age. high/critical render red and bold.',
  '',
  'Exit codes are the notice:',
  '  0  no open asks',
  '  1  open asks exist',
  '  2  state UNKNOWN (failed poll, or not signed in via `pd account login`)',
  '',
  'Options:',
  '  --json   Machine-readable { status, openCount, interruptions, accountUrl }',
  "           with an honest three-valued status: 'open' | 'none' | 'unknown'",
  '           (a failed poll is NEVER reported as all-clear)',
  '',
  'Answer/ack is web-only by design: this command deep-links to',
  '/account/interruptions instead of silencing asks locally.',
  '',
  'Pre-flight: `pd fleet up|run|approve` and `pd dispatch run` refuse to start',
  'new dependent work while a critical ask is open (non-critical opens warn).',
].join('\n');

/**
 * `pd interruptions` entry point. Sets `process.exitCode` (0 none · 1 open ·
 * 2 unknown) rather than calling `process.exit`, so stdout flushes.
 */
export async function handleInterruptions(args: string[], options: CLIOptions): Promise<void> {
  const sub = args[0];
  if (sub && sub !== 'list') {
    ui.error(`Unknown: pd interruptions ${sub}. This command only lists; answer/ack is web-only.`);
    process.exitCode = 2;
    return;
  }

  const poll = await pollOpenInterruptions();

  if (isJson(options)) {
    if (poll.status === 'unknown') {
      console.log(JSON.stringify({ status: 'unknown', reason: poll.reason, accountUrl: poll.accountUrl ?? null }, null, 2));
      process.exitCode = 2;
      return;
    }
    const open = poll.interruptions.filter((i) => i.state === 'open');
    console.log(JSON.stringify({
      status: open.length > 0 ? 'open' : 'none',
      openCount: open.length,
      interruptions: open,
      accountUrl: poll.accountUrl,
    }, null, 2));
    process.exitCode = open.length > 0 ? 1 : 0;
    return;
  }

  const report = renderInterruptionsReport(poll);
  if (report.exitCode === 0) {
    ui.success(report.lines[0]);
  } else if (report.exitCode === 2) {
    for (const line of report.lines) ui.warn(line);
  } else {
    ui.warn(report.lines[0]);
    for (const line of report.lines.slice(1)) console.log(line);
  }
  process.exitCode = report.exitCode;
}
