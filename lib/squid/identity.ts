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
import { fileURLToPath } from 'node:url';
import { PD_HOME } from '../../shared/paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

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
}

/** Copy bin/pd-statusline → ~/.port-daddy/bin/. Returns null if not on this build. */
export function stageStatusline(
  sourceDir = join(PROJECT_ROOT, 'bin'),
  destBinDir = join(PD_HOME, 'bin'),
): string | null {
  const src = join(sourceDir, STATUSLINE_BIN);
  if (!existsSync(src)) return null;
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
    return { changed: false, path: settingsPath, reason: 'statusline not staged — run pd setup' };
  }
  const settings = readSettings(settingsPath);
  if (settings === null) {
    return { changed: false, path: settingsPath, reason: 'settings.json is not valid JSON — skipping' };
  }
  const current = settings.statusLine?.command;
  if (typeof current === 'string' && !current.includes(STATUSLINE_MARKER)) {
    return { changed: false, path: settingsPath, reason: 'user statusLine present — not touching it' };
  }
  if (current === staged) {
    return { changed: false, path: settingsPath, reason: 'already wired' };
  }
  settings.statusLine = { type: 'command', command: staged, padding: 0 };
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  return { changed: true, path: settingsPath, reason: current ? 'refreshed' : 'wired' };
}

/** Remove OUR statusLine (marker-matched) from <scopeDir>/.claude/settings.json. */
export function uninstallStatusline(scopeDir: string): IdentityResult {
  const settingsPath = join(scopeDir, '.claude', 'settings.json');
  const settings = readSettings(settingsPath);
  if (settings === null || !existsSync(settingsPath)) {
    return { changed: false, path: settingsPath, reason: 'no settings' };
  }
  const current = settings.statusLine?.command;
  if (typeof current !== 'string' || !current.includes(STATUSLINE_MARKER)) {
    return { changed: false, path: settingsPath, reason: 'no pd statusLine' };
  }
  delete settings.statusLine;
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  return { changed: true, path: settingsPath, reason: 'removed' };
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
    return { changed: false, path, reason: 'already installed' };
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, 'utf8');
  return { changed: true, path, reason: 'installed' };
}

export function uninstallSlashCommand(projectDir: string): IdentityResult {
  const path = join(projectDir, '.claude', 'commands', SLASH_COMMAND_FILENAME);
  if (!existsSync(path)) return { changed: false, path, reason: 'not installed' };
  rmSync(path);
  return { changed: true, path, reason: 'removed' };
}

// ─── Status probes (the non-diegetic readout) ────────────────────────────────

export interface MatrixSnapshot {
  path: string;
  exists: boolean;
  alerts: string[];
  pheromones: string[];
  locks: string[];
}

/** Read the Ink Cloud matrix the tentacles steer from. Values only, no parsing risk. */
export function readMatrixSnapshot(matrixPath = join(PD_HOME, 'matrix.env')): MatrixSnapshot {
  const snap: MatrixSnapshot = { path: matrixPath, exists: false, alerts: [], pheromones: [], locks: [] };
  if (!existsSync(matrixPath)) return snap;
  snap.exists = true;
  const unquote = (line: string): string => line.replace(/^[A-Za-z0-9_]+="?/, '').replace(/"$/, '');
  for (const line of readFileSync(matrixPath, 'utf8').split('\n')) {
    if (/^PD_ALERT_[A-Za-z0-9_]+=/.test(line)) snap.alerts.push(unquote(line));
    else if (/^PD_PHEROMONE_[A-Za-z0-9_]+=/.test(line)) snap.pheromones.push(unquote(line));
    else if (/^PD_LOCK_[A-Za-z0-9_]+=/.test(line)) snap.locks.push(unquote(line));
  }
  return snap;
}

export interface IdentityStatus {
  statuslineStaged: boolean;
  statuslineProject: boolean;
  statuslineUser: boolean;
  slashCommand: boolean;
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
  return {
    statuslineStaged: existsSync(stagedStatuslinePath()),
    statuslineProject: wired(projectDir),
    statuslineUser: home ? wired(home) : false,
    slashCommand: existsSync(join(projectDir, '.claude', 'commands', SLASH_COMMAND_FILENAME)),
    daemonAlive: isSquidDaemonHeartbeatFresh(),
  };
}
