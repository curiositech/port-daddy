/**
 * lib/squid/identity.ts — the VISUAL identity of a harnessed session (ADR-0091).
 *
 * The tentacles (hook-shape.ts + cli/commands/hooks-install.ts) make a session
 * coordinated; this module makes it IDENTIFIABLE. Three surfaces:
 *
 *   1. statusLine — `bin/pd-statusline` staged to ~/.port-daddy/bin/ and wired
 *      into .claude/settings.json. Cyan `◆ PD` for a direct Anthropic seat,
 *      magenta `◆ PD⇄CODEX` when the session runs through the Codex bridge
 *      (`pd squid codex` sets PD_SQUID_PILOT=codex in the client env).
 *   2. /squid slash command — a project .claude/commands/squid.md so the
 *      operator can toggle or inspect the harness WITHOUT leaving Claude Code.
 *   3. Status probes — shared helpers `pd squid status` uses to show the
 *      non-diegetic background machinery (what is armed, what would be injected).
 *
 * Same safety posture as the hook installer: never clobber a user-authored
 * statusLine (ours is recognized by the `pd-statusline` marker), edits are
 * idempotent, and uninstall removes only what we wrote.
 */

import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { PD_HOME } from '../../shared/paths.js';
import { resolveSquidAsset } from './assets.js';
import { parseMatrix } from './matrix.js';

export const STATUSLINE_BIN = 'pd-statusline';
/** Marker substring identifying OUR statusLine command (mirror of PD_HOOK_MARKER). */
export const STATUSLINE_MARKER = 'pd-statusline';
export const SLASH_COMMAND_FILENAME = 'squid.md';
export const SQUID_DAEMON_HEARTBEAT_STALE_MS = 30_000;

/** Where the statusline script gets staged (next to the hook gate wrappers). */
export function stagedStatuslinePath(binDir = join(PD_HOME, 'bin')): string {
  return join(binDir, STATUSLINE_BIN);
}

export interface IdentityResult {
  changed: boolean;
  path: string;
  reason: string;
  /** False for a real failure (missing asset, unparsable config) — not merely "no-op". */
  ok: boolean;
}

/** Copy bin/pd-statusline → ~/.port-daddy/bin/. Returns null if not on this build. */
export function stageStatusline(
  sourceDir?: string,
  destBinDir = join(PD_HOME, 'bin'),
): string | null {
  const explicit = sourceDir ? join(sourceDir, STATUSLINE_BIN) : null;
  const src = explicit ? (existsSync(explicit) ? explicit : null) : resolveSquidAsset(join('bin', STATUSLINE_BIN));
  if (!src) return null;
  const dst = stagedStatuslinePath(destBinDir);
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  chmodSync(dst, 0o755);
  return dst;
}

interface ClaudeSettings {
  statusLine?: { type?: string; command?: string; padding?: number };
  [k: string]: unknown;
}

function readSettings(path: string): ClaudeSettings | null {
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, 'utf8').trim();
    return raw ? (JSON.parse(raw) as ClaudeSettings) : {};
  } catch {
    return null; // invalid JSON — caller must not clobber it
  }
}

/**
 * Wire the staged statusline into <scopeDir>/.claude/settings.json. A statusLine
 * the user authored themselves is left alone (that is their identity choice) —
 * we only create or refresh entries carrying our marker.
 */
export function installStatusline(scopeDir: string, stagedPath = stagedStatuslinePath()): IdentityResult {
  const settingsPath = join(scopeDir, '.claude', 'settings.json');
  const staged = stagedPath;
  if (!existsSync(staged)) {
    return { changed: false, path: settingsPath, reason: 'statusline not staged — run pd setup', ok: false };
  }
  const settings = readSettings(settingsPath);
  if (settings === null) {
    return { changed: false, path: settingsPath, reason: 'settings.json is not valid JSON — skipping', ok: false };
  }
  const current = settings.statusLine?.command;
  if (typeof current === 'string' && !current.includes(STATUSLINE_MARKER)) {
    return { changed: false, path: settingsPath, reason: 'user statusLine present — not touching it', ok: true };
  }
  if (current === staged) {
    return { changed: false, path: settingsPath, reason: 'already wired', ok: true };
  }
  settings.statusLine = { type: 'command', command: staged, padding: 0 };
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  return { changed: true, path: settingsPath, reason: current ? 'refreshed' : 'wired', ok: true };
}

/** Remove OUR statusLine (marker-matched) from <scopeDir>/.claude/settings.json. */
export function uninstallStatusline(scopeDir: string): IdentityResult {
  const settingsPath = join(scopeDir, '.claude', 'settings.json');
  const settings = readSettings(settingsPath);
  if (settings === null || !existsSync(settingsPath)) {
    return { changed: false, path: settingsPath, reason: 'no settings', ok: true };
  }
  const current = settings.statusLine?.command;
  if (typeof current !== 'string' || !current.includes(STATUSLINE_MARKER)) {
    return { changed: false, path: settingsPath, reason: 'no pd statusLine', ok: true };
  }
  delete settings.statusLine;
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  return { changed: true, path: settingsPath, reason: 'removed', ok: true };
}

/**
 * The /squid slash command — lets the operator drive the toggle from INSIDE a
 * Claude Code session. Body instructs the agent to shell out to `pd squid`.
 */
export function slashCommandBody(): string {
  return [
    '---',
    'description: Toggle or inspect the Port Daddy Giant Squid harness for this project',
    'allowed-tools: Bash(pd squid:*), Bash(pd hooks:*)',
    '---',
    '',
    'Run `pd squid $ARGUMENTS` via Bash (default to `pd squid status` when no',
    'arguments are given) and relay the result concisely.',
    '',
    'If the subcommand was `on` or `off`, tell the user hook and statusline',
    'changes apply to the NEXT Claude Code session — this one keeps its current',
    'wiring until restarted.',
    '',
  ].join('\n');
}

export function installSlashCommand(projectDir: string): IdentityResult {
  const path = join(projectDir, '.claude', 'commands', SLASH_COMMAND_FILENAME);
  const body = slashCommandBody();
  if (existsSync(path) && readFileSync(path, 'utf8') === body) {
    return { changed: false, path, reason: 'already installed', ok: true };
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, 'utf8');
  return { changed: true, path, reason: 'installed', ok: true };
}

export function uninstallSlashCommand(projectDir: string): IdentityResult {
  const path = join(projectDir, '.claude', 'commands', SLASH_COMMAND_FILENAME);
  if (!existsSync(path)) return { changed: false, path, reason: 'not installed', ok: true };
  rmSync(path);
  return { changed: true, path, reason: 'removed', ok: true };
}

// ─── Status probes (the non-diegetic readout) ────────────────────────────────

export interface MatrixSnapshot {
  path: string;
  exists: boolean;
  alerts: string[];
  pheromones: string[];
  locks: string[];
  window: {
    limitPerKind: number;
    maxValueChars: number;
    totals: { alerts: number; pheromones: number; locks: number };
    returned: { alerts: number; pheromones: number; locks: number };
    truncated: { alerts: boolean; pheromones: boolean; locks: boolean; any: boolean };
    valueCharsTruncated: { alerts: number; pheromones: number; locks: number; any: boolean };
  };
}

export const SQUID_MATRIX_STATUS_LIMIT_PER_KIND = 20;
export const SQUID_MATRIX_STATUS_MAX_VALUE_CHARS = 512;

/**
 * Retain only the newest matrix values and cap each diagnostic string. The
 * design keeps operator status proportional to the display budget even when
 * the cumulative matrix contains thousands of historical pheromones.
 *
 * @param values - Matrix values in file order.
 * @param limit - Maximum newest values to retain.
 * @param maxValueChars - Maximum characters retained per value.
 * @returns The bounded newest-value window.
 */
function boundedMatrixValues(values: string[], limit: number, maxValueChars: number): string[] {
  return values.slice(-limit).map((value) => value.length > maxValueChars
    ? `${value.slice(0, Math.max(0, maxValueChars - 1))}…`
    : value);
}

/**
 * Read the Ink Cloud matrix the tentacles steer from. Values only, no parsing
 * risk — delegates line-parsing to `lib/squid/matrix.ts`'s `parseMatrix`, the
 * single source of truth for the `KEY="value"` format (ADR-0091 PR1: parser
 * consolidation), instead of re-implementing it here. The purpose of the
 * window metadata is to make cumulative state honest without serializing it all.
 *
 * @param path - Matrix file to inspect.
 * @param options - Per-kind and per-value display bounds.
 * @returns A bounded snapshot with exact totals and truncation markers.
 */
export function readMatrixSnapshot(
  path = join(PD_HOME, 'matrix.env'),
  options: { limitPerKind?: number; maxValueChars?: number } = {},
): MatrixSnapshot {
  const limitPerKind = Math.max(1, Math.min(100, Math.floor(options.limitPerKind ?? SQUID_MATRIX_STATUS_LIMIT_PER_KIND)));
  const maxValueChars = Math.max(32, Math.min(2_048, Math.floor(options.maxValueChars ?? SQUID_MATRIX_STATUS_MAX_VALUE_CHARS)));
  const emptyWindow: MatrixSnapshot['window'] = {
    limitPerKind,
    maxValueChars,
    totals: { alerts: 0, pheromones: 0, locks: 0 },
    returned: { alerts: 0, pheromones: 0, locks: 0 },
    truncated: { alerts: false, pheromones: false, locks: false, any: false },
    valueCharsTruncated: { alerts: 0, pheromones: 0, locks: 0, any: false },
  };
  const snap: MatrixSnapshot = { path, exists: false, alerts: [], pheromones: [], locks: [], window: emptyWindow };
  if (!existsSync(path)) return snap;
  snap.exists = true;
  const text = readFileSync(path, 'utf8');
  const kv = parseMatrix(text);
  const alerts: string[] = [];
  const pheromones: string[] = [];
  const locks: string[] = [];
  for (const [key, value] of Object.entries(kv)) {
    if (key.startsWith('PD_ALERT_')) alerts.push(value);
    else if (key.startsWith('PD_PHEROMONE_')) pheromones.push(value);
    else if (key.startsWith('PD_LOCK_')) locks.push(value);
  }
  snap.alerts = boundedMatrixValues(alerts, limitPerKind, maxValueChars);
  snap.pheromones = boundedMatrixValues(pheromones, limitPerKind, maxValueChars);
  snap.locks = boundedMatrixValues(locks, limitPerKind, maxValueChars);
  snap.window.totals = { alerts: alerts.length, pheromones: pheromones.length, locks: locks.length };
  snap.window.returned = {
    alerts: snap.alerts.length,
    pheromones: snap.pheromones.length,
    locks: snap.locks.length,
  };
  snap.window.truncated = {
    alerts: alerts.length > snap.alerts.length,
    pheromones: pheromones.length > snap.pheromones.length,
    locks: locks.length > snap.locks.length,
    any: alerts.length > snap.alerts.length || pheromones.length > snap.pheromones.length || locks.length > snap.locks.length,
  };
  const alertCharsTruncated = alerts.slice(-limitPerKind).filter((value) => value.length > maxValueChars).length;
  const pheromoneCharsTruncated = pheromones.slice(-limitPerKind).filter((value) => value.length > maxValueChars).length;
  const lockCharsTruncated = locks.slice(-limitPerKind).filter((value) => value.length > maxValueChars).length;
  snap.window.valueCharsTruncated = {
    alerts: alertCharsTruncated,
    pheromones: pheromoneCharsTruncated,
    locks: lockCharsTruncated,
    any: alertCharsTruncated > 0 || pheromoneCharsTruncated > 0 || lockCharsTruncated > 0,
  };
  return snap;
}

export interface IdentityStatus {
  statuslineStaged: boolean;
  statuslineProject: boolean;
  statuslineUser: boolean;
  slashCommand: boolean;
  pilotSessionStart: boolean;
  daemonAlive: boolean;
}

/** Filesystem-only daemon liveness for callers that may run inside a CLI sandbox. */
export function isSquidDaemonHeartbeatFresh(
  heartbeatPath = join(PD_HOME, 'heartbeat'),
  now = Date.now(),
  staleAfterMs = SQUID_DAEMON_HEARTBEAT_STALE_MS,
): boolean {
  try {
    const age = now - statSync(heartbeatPath).mtimeMs;
    return age >= -staleAfterMs && age <= staleAfterMs;
  } catch {
    return false;
  }
}

export function readIdentityStatus(projectDir: string, home = process.env.HOME || ''): IdentityStatus {
  const wired = (scopeDir: string): boolean => {
    const settings = readSettings(join(scopeDir, '.claude', 'settings.json'));
    const cmd = settings?.statusLine?.command;
    return typeof cmd === 'string' && cmd.includes(STATUSLINE_MARKER);
  };
  const projectSettings = readSettings(join(projectDir, '.claude', 'settings.json'));
  const pilotSessionStart = JSON.stringify(projectSettings?.hooks ?? {}).includes('sessionstart-pilot.mjs');
  return {
    statuslineStaged: existsSync(stagedStatuslinePath()),
    statuslineProject: wired(projectDir),
    statuslineUser: home ? wired(home) : false,
    slashCommand: existsSync(join(projectDir, '.claude', 'commands', SLASH_COMMAND_FILENAME)),
    pilotSessionStart,
    daemonAlive: isSquidDaemonHeartbeatFresh(),
  };
}
