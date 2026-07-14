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
  (process.env.NO_COLOR === undefined || process.env.NO_COLOR === '') &&
  ((process.stderr.isTTY ?? false) || fdIsTTY(2) || !!process.env.FORCE_COLOR);

export type CliColorLevel = 'none' | '16' | '256' | 'truecolor';

function forceColorLevel(): CliColorLevel | null {
  const raw = process.env.FORCE_COLOR;
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
export function detectColorLevel(stream: 'stdout' | 'stderr' = 'stdout'): CliColorLevel {
  const forced = forceColorLevel();
  if (forced) return forced;
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') return 'none';
  if ((process.env.TERM || '').toLowerCase() === 'dumb') return 'none';

  const fd = stream === 'stdout' ? 1 : 2;
  const writeStream = stream === 'stdout' ? process.stdout : process.stderr;
  if (!((writeStream.isTTY ?? false) || fdIsTTY(fd))) return 'none';

  const colorTerm = (process.env.COLORTERM || '').toLowerCase();
  if (colorTerm === 'truecolor' || colorTerm === '24bit') return 'truecolor';
  if ((process.env.TERM || '').includes('256color')) return '256';
  return '16';
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
