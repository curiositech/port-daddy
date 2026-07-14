/**
 * CLI Output Utilities
 *
 * TTY-aware formatting helpers for consistent CLI output.
 * Now also re-exports the @clack-based UI module for convenience.
 */

import * as tty from 'node:tty';

/** Kernel-level fd check — robust where stream.isTTY lies under bun-compile. */
function fdIsTTY(fd: number): boolean {
  try {
    return tty.isatty(fd);
  } catch {
    return false;
  }
}

/**
 * Whether output is a terminal (not a pipe or redirect).
 *
 * Uses the kernel `tty.isatty(2)` in addition to the stream flag, because under
 * the `bun build --compile` binary `process.stderr.isTTY` can be falsy on a
 * real terminal (see `cli/utils/tty.ts`). A piped/redirected stderr (incl. CI)
 * still reports `false`, so this never turns colour/prompts on for non-TTYs.
 */
export const IS_TTY: boolean =
  process.env.NO_COLOR === undefined &&
  ((process.stderr.isTTY ?? false) || fdIsTTY(2) || !!process.env.FORCE_COLOR);

export type CliColorLevel = 'none' | '16' | '256' | 'truecolor';

export type TerminalCapabilityReason =
  | 'enabled'
  | 'no-color'
  | 'force-color-disabled'
  | 'dumb-terminal'
  | 'not-tty';

export interface TerminalCapabilities {
  stream: 'stdout' | 'stderr';
  isTTY: boolean;
  colorLevel: CliColorLevel;
  columns: number;
  unicode: boolean;
  reason: TerminalCapabilityReason;
}

export interface TerminalCapabilityOverrides {
  env?: NodeJS.ProcessEnv;
  isTTY?: boolean;
  columns?: number;
}

function forceColorLevel(env: NodeJS.ProcessEnv): CliColorLevel | null {
  const raw = env.FORCE_COLOR;
  if (raw === undefined || raw === '') return null;
  if (raw === '0' || raw.toLowerCase() === 'false') return 'none';
  if (raw === '3' || raw.toLowerCase() === 'truecolor') return 'truecolor';
  if (raw === '2' || raw === '256') return '256';
  return '16';
}

/**
 * Detect color support for rendered human output.
 *
 * Unlike the legacy `IS_TTY` stderr check, stdout visuals must respect pipes and
 * redirects because human tables often print to stdout. FORCE_COLOR remains an
 * explicit demo/test override, but ordinary piped output stays plain.
 */
export function detectTerminalCapabilities(
  stream: 'stdout' | 'stderr' = 'stdout',
  overrides: TerminalCapabilityOverrides = {},
): TerminalCapabilities {
  const env = overrides.env ?? process.env;
  const fd = stream === 'stdout' ? 1 : 2;
  const writeStream = stream === 'stdout' ? process.stdout : process.stderr;
  const isTTY = overrides.isTTY ?? ((writeStream.isTTY ?? false) || fdIsTTY(fd));
  const columns = Math.max(20, overrides.columns ?? writeStream.columns ?? 80);

  if (env.NO_COLOR !== undefined) {
    return { stream, isTTY, colorLevel: 'none', columns, unicode: false, reason: 'no-color' };
  }

  const forced = forceColorLevel(env);
  if (forced === 'none') {
    return { stream, isTTY, colorLevel: 'none', columns, unicode: false, reason: 'force-color-disabled' };
  }

  if ((env.TERM || '').toLowerCase() === 'dumb') {
    return { stream, isTTY, colorLevel: 'none', columns, unicode: false, reason: 'dumb-terminal' };
  }

  if (!isTTY && !forced) {
    return { stream, isTTY, colorLevel: 'none', columns, unicode: false, reason: 'not-tty' };
  }

  const colorTerm = (env.COLORTERM || '').toLowerCase();
  const colorLevel = forced
    ?? (colorTerm === 'truecolor' || colorTerm === '24bit'
      ? 'truecolor'
      : (env.TERM || '').includes('256color')
        ? '256'
        : '16');

  return { stream, isTTY, colorLevel, columns, unicode: true, reason: 'enabled' };
}

export function detectColorLevel(
  stream: 'stdout' | 'stderr' = 'stdout',
  overrides: TerminalCapabilityOverrides = {},
): CliColorLevel {
  return detectTerminalCapabilities(stream, overrides).colorLevel;
}

export function supportsStyledStdout(): boolean {
  return detectColorLevel('stdout') !== 'none';
}

/** Print a Unicode separator line (only in TTY mode) */
export function separator(width: number = 75): void {
  if (IS_TTY) console.error('─'.repeat(width));
}

/** Format a table header (only decorates in TTY mode) */
export function tableHeader(...cols: [string, number][]): string {
  return cols.map(([label, width]) => label.padEnd(width)).join('');
}

/** Format relative time from milliseconds */
export function relativeTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/** Format a timestamp for display */
export function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString();
}

/** Format bytes to human readable */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
