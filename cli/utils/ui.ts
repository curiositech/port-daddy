/**
 * Port Daddy UI Module
 *
 * Built on @clack/prompts. Provides the CLI's visual identity:
 * confident, helpful, AI-like voice with maritime flair.
 *
 * This is the single source of truth for all CLI output formatting.
 * Command modules should import from here, not from @clack directly.
 */

import * as p from '@clack/prompts';
import { ANSI, highlightChannel } from '../../lib/maritime.js';
import { IS_TTY } from './output.js';

// ─────────────────────────────────────────────────────────────────────────────
// Intro / Outro
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Display the Port Daddy intro bar (replaces the old ASCII banner for CLI commands).
 * Shown at the top of interactive commands; skipped in --quiet/--json mode.
 */
export function intro(title?: string): void {
  p.intro(`${ANSI.fgCyan}${ANSI.bold}⚓ ${title || 'Port Daddy'}${ANSI.reset}`);
}

/**
 * Display the outro bar — wraps up a multi-step flow.
 */
export function outro(message: string): void {
  p.outro(`${ANSI.fgCyan}${message}${ANSI.reset}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Status Messages (replaces maritimeStatus)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Log a success message.
 */
export function success(message: string): void {
  if (!IS_TTY) {
    console.log(`SUCCESS: ${message}`);
    return;
  }
  p.log.success(message);
}

/**
 * Log an error message.
 */
export function error(message: string): void {
  if (!IS_TTY) {
    console.error(`ERROR: ${message}`);
    return;
  }
  p.log.error(message);
}

/**
 * Log a warning message.
 */
export function warn(message: string): void {
  if (!IS_TTY) {
    console.error(`WARN: ${message}`);
    return;
  }
  p.log.warn(message);
}

/**
 * Log an informational message.
 */
export function info(message: string): void {
  if (!IS_TTY) {
    console.log(`INFO: ${message}`);
    return;
  }
  p.log.info(message);
}

/**
 * Dim a string with ANSI gray — for unobtrusive hints, empty-state text,
 * and secondary tips that shouldn't fight with primary output. Returns the
 * bare string when color is disabled.
 *
 * @example
 *   console.log(`  ${ui.dim('(harbor quiet — nothing to report)')}`);
 */
export function dim(str: string): string {
  return `${ANSI.dim}${str}${ANSI.reset}`;
}

/**
 * Log a plain message (no icon).
 */
export function message(msg: string): void {
  if (!IS_TTY) {
    console.error(msg);
    return;
  }
  p.log.message(msg);
}

/**
 * Log a step — for multi-step flows.
 */
export function step(msg: string): void {
  if (!IS_TTY) {
    console.error(`STEP: ${msg}`);
    return;
  }
  p.log.step(msg);
}

// ─────────────────────────────────────────────────────────────────────────────
// Notes & Boxes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Display a boxed note (e.g., salvage hints, onboarding).
 */
export function note(message: string, title?: string): void {
  p.note(message, title);
}

// ─────────────────────────────────────────────────────────────────────────────
// Spinners
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create and return a spinner for async operations.
 */
export function spinner(): ReturnType<typeof p.spinner> {
  return p.spinner();
}

// ─────────────────────────────────────────────────────────────────────────────
// Interactive Prompts (replaces readline-based prompts)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check whether interactive prompting is possible.
 */
export function canPrompt(): boolean {
  return IS_TTY && !process.env.CI && !process.env.PORT_DADDY_NON_INTERACTIVE;
}

/**
 * Prompt for freeform text input.
 * Returns null if cancelled or non-interactive.
 */
export async function text(opts: {
  label: string;
  hint?: string;
  required?: boolean;
  default?: string;
  placeholder?: string;
}): Promise<string | null> {
  if (!canPrompt()) return opts.default || null;

  const result = await p.text({
    message: opts.label,
    placeholder: opts.placeholder || opts.hint,
    defaultValue: opts.default,
    validate: opts.required
      ? (value: string | undefined) => { if (!value?.trim()) return 'This field is required'; return undefined; }
      : undefined,
  });

  if (p.isCancel(result)) return null;
  return (result as string) || opts.default || null;
}

/**
 * Prompt for a selection from a list.
 * Returns null if cancelled or non-interactive.
 */
export async function select<T extends string>(opts: {
  label: string;
  choices: Array<{ value: T; label: string; hint?: string }>;
  default?: T;
}): Promise<T | null> {
  if (!canPrompt()) return opts.default || null;

  const result = await p.select({
    message: opts.label,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options: opts.choices.map(c => ({
      value: c.value,
      label: c.label,
      hint: c.hint,
    })) as any,
    initialValue: opts.default,
  });

  if (p.isCancel(result)) return null;
  return result as T;
}

/**
 * Prompt for yes/no confirmation.
 * Returns the default if non-interactive.
 */
export async function confirm(label: string, defaultYes = true): Promise<boolean> {
  if (!canPrompt()) return defaultYes;

  const result = await p.confirm({
    message: label,
    initialValue: defaultYes,
  });

  if (p.isCancel(result)) return defaultYes;
  return result as boolean;
}

/**
 * Prompt for a semantic identity (project:stack:context).
 * Returns null if cancelled or non-interactive.
 */
export async function identity(opts: {
  label?: string;
  suggested?: string;
}): Promise<string | null> {
  const label = opts.label || 'Service identity (project:stack:context)';
  const hint = opts.suggested
    ? `auto-detected: ${opts.suggested}`
    : 'e.g. myapp:api:main';

  return text({
    label,
    placeholder: hint,
    default: opts.suggested,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Cancellation
// ─────────────────────────────────────────────────────────────────────────────

export const isCancel = p.isCancel;

// ─────────────────────────────────────────────────────────────────────────────
// Table formatting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format a table with headers and rows. Renders as a @clack note box.
 */
export function table(headers: string[], rows: string[][], opts?: { title?: string }): void {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => stripAnsi(r[i] || '').length)) + 2
  );

  const headerLine = headers.map((h, i) => `${ANSI.bold}${h.padEnd(widths[i])}${ANSI.reset}`).join('');
  const divider = widths.map(w => '─'.repeat(w)).join('');
  const body = rows.map(row =>
    row.map((cell, i) => {
      const stripped = stripAnsi(cell);
      const padding = widths[i] - stripped.length;
      return cell + ' '.repeat(Math.max(0, padding));
    }).join('')
  ).join('\n');

  const content = `${headerLine}\n${divider}\n${body}`;

  if (opts?.title) {
    p.note(content, opts.title);
  } else {
    p.log.message(content);
  }
}

/**
 * Strip ANSI escape codes from a string for width calculations.
 */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

// ─────────────────────────────────────────────────────────────────────────────
// Semantic Formatting Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format a service identity with channel highlighting.
 */
export function fmtIdentity(id: string): string {
  return highlightChannel(id);
}

/**
 * Format a port number (green, bold).
 */
export function fmtPort(port: number | string): string {
  return `${ANSI.fgGreen}${ANSI.bold}${port}${ANSI.reset}`;
}

/**
 * Format a label (dim).
 */
export function fmtLabel(label: string): string {
  return `${ANSI.dim}${label}${ANSI.reset}`;
}

/**
 * Format a value (bold).
 */
export function fmtBold(value: string): string {
  return `${ANSI.bold}${value}${ANSI.reset}`;
}

/**
 * Format a dim/secondary value.
 */
export function fmtDim(value: string): string {
  return `${ANSI.dim}${value}${ANSI.reset}`;
}

/**
 * Format a cyan-colored value.
 */
export function fmtCyan(value: string): string {
  return `${ANSI.fgCyan}${value}${ANSI.reset}`;
}

/**
 * Format a green value (success-like).
 */
export function fmtGreen(value: string): string {
  return `${ANSI.fgGreen}${value}${ANSI.reset}`;
}

/**
 * Format a yellow value (warning-like).
 */
export function fmtYellow(value: string): string {
  return `${ANSI.fgYellow}${value}${ANSI.reset}`;
}

/**
 * Format a red value (error-like).
 */
export function fmtRed(value: string): string {
  return `${ANSI.fgRed}${value}${ANSI.reset}`;
}
