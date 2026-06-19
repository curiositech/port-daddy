/**
 * CLI Output Utilities
 *
 * TTY-aware formatting helpers for consistent CLI output.
 * Now also re-exports the @clack-based UI module for convenience.
 */

import * as tty from 'node:tty';

/** Kernel-level fd check — robust where stream.isTTY lies under bun-compile. */
function fd2IsTTY(): boolean {
  try {
    return tty.isatty(2);
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
  ((process.stderr.isTTY ?? false) || fd2IsTTY() || !!process.env.FORCE_COLOR);

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
