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
import { detectColorLevel, IS_TTY, type CliColorLevel } from './output.js';

export type LineworkTone =
  | 'healthy'
  | 'running'
  | 'pending'
  | 'unknown'
  | 'recovering'
  | 'confirmed'
  | 'blocked'
  | 'failed'
  | 'warning'
  | 'info'
  | 'muted';

export interface LineworkRow {
  tone: LineworkTone;
  label: string;
  text: string;
  signal?: keyof typeof LINEWORK_SIGNALS;
}

export interface LineworkPanelOptions {
  title: string;
  subtitle?: string;
  version?: string;
  tone?: LineworkTone;
  zone?: string;
  rows: LineworkRow[];
  footer?: string;
  width?: number;
  colorLevel?: CliColorLevel;
  styled?: boolean;
}

const RESET = '\x1b[0m';

const TONE_COLOR: Record<LineworkTone, {
  ansi16: number;
  ansi256: number;
  rgb: [number, number, number];
}> = {
  healthy: { ansi16: 32, ansi256: 78, rgb: [95, 206, 151] },
  running: { ansi16: 34, ansi256: 111, rgb: [125, 180, 255] },
  pending: { ansi16: 33, ansi256: 221, rgb: [242, 190, 81] },
  unknown: { ansi16: 37, ansi256: 245, rgb: [165, 159, 147] },
  recovering: { ansi16: 35, ansi256: 219, rgb: [224, 165, 237] },
  confirmed: { ansi16: 32, ansi256: 78, rgb: [95, 206, 151] },
  blocked: { ansi16: 35, ansi256: 219, rgb: [224, 165, 237] },
  failed: { ansi16: 31, ansi256: 210, rgb: [255, 125, 125] },
  warning: { ansi16: 33, ansi256: 221, rgb: [242, 190, 81] },
  info: { ansi16: 36, ansi256: 116, rgb: [143, 208, 167] },
  muted: { ansi16: 37, ansi256: 245, rgb: [165, 159, 147] },
};

export const LINEWORK_SIGNALS = {
  K: { glyph: '▌▐', tone: 'running', meaning: 'I wish to communicate with you.' },
  Q: { glyph: '▀▄', tone: 'healthy', meaning: "My vessel is healthy and I request free pratique." },
  P: { glyph: '▟▙', tone: 'pending', meaning: 'In harbor: all persons should report on board as the vessel is about to proceed to sea.' },
  M: { glyph: '▁▁', tone: 'unknown', meaning: 'My vessel is stopped and making no way through the water.' },
  O: { glyph: '▖▗', tone: 'recovering', meaning: 'Man overboard.' },
  C: { glyph: '██', tone: 'confirmed', meaning: 'Yes; affirmative.' },
  D: { glyph: '▂▂', tone: 'blocked', meaning: 'Keep clear of me; I am maneuvering with difficulty.' },
  N: { glyph: '▔▔', tone: 'failed', meaning: 'No; negative.' },
  U: { glyph: '▚▚', tone: 'warning', meaning: 'You are running into danger.' },
  X: { glyph: '▚▞', tone: 'blocked', meaning: 'Stop carrying out your intentions and watch for my signals.' },
  F: { glyph: '▘▝', tone: 'unknown', meaning: 'I am disabled; communicate with me.' },
  Z: { glyph: '▛▜', tone: 'recovering', meaning: 'I require a tug.' },
} as const;

function ansiForTone(tone: LineworkTone, level: CliColorLevel, background = false): string {
  if (level === 'none') return '';
  const color = TONE_COLOR[tone] || TONE_COLOR.info;
  if (level === 'truecolor') {
    const [r, g, b] = color.rgb;
    return `\x1b[${background ? 48 : 38};2;${r};${g};${b}m`;
  }
  if (level === '256') return `\x1b[${background ? 48 : 38};5;${color.ansi256}m`;
  return `\x1b[${background ? color.ansi16 + 10 : color.ansi16}m`;
}

function paint(value: string, tone: LineworkTone, level: CliColorLevel): string {
  if (level === 'none') return value;
  return `${ansiForTone(tone, level)}${value}${RESET}`;
}

function block(value: string, tone: LineworkTone, level: CliColorLevel): string {
  if (level === 'none') return value;
  const foreground = level === 'truecolor'
    ? '\x1b[38;2;18;18;18m'
    : level === '256'
      ? '\x1b[38;5;233m'
      : '\x1b[30m';
  return `${ansiForTone(tone, level, true)}${foreground}\x1b[1m${value}${RESET}`;
}

function charWidth(char: string): number {
  const code = char.codePointAt(0) || 0;
  if (code === 0) return 0;
  if (code < 32 || (code >= 0x7f && code < 0xa0)) return 0;
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2329 && code <= 0x232a) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
  ) {
    return 2;
  }
  return 1;
}

export function visibleWidth(value: string): number {
  return Array.from(stripAnsi(value)).reduce((sum, char) => sum + charWidth(char), 0);
}

function truncateVisible(value: string, width: number): string {
  const clean = stripAnsi(value);
  if (visibleWidth(clean) <= width) return value;
  let out = '';
  let used = 0;
  for (const char of Array.from(clean)) {
    const next = charWidth(char);
    if (used + next > Math.max(0, width - 1)) break;
    out += char;
    used += next;
  }
  return `${out}…`;
}

function fitVisible(value: string, width: number): string {
  const trimmed = truncateVisible(value, width);
  const padding = Math.max(0, width - visibleWidth(trimmed));
  return `${trimmed}${' '.repeat(padding)}`;
}

export function lineworkEnabled(opts?: {
  json?: boolean;
  quiet?: boolean;
  stream?: 'stdout' | 'stderr';
}): boolean {
  if (opts?.json || opts?.quiet) return false;
  return detectColorLevel(opts?.stream || 'stdout') !== 'none';
}

export function lineworkColorLevel(stream: 'stdout' | 'stderr' = 'stdout'): CliColorLevel {
  return detectColorLevel(stream);
}

export function lineworkSignal(
  signal: keyof typeof LINEWORK_SIGNALS,
  opts?: { colorLevel?: CliColorLevel; styled?: boolean }
): string {
  const meta = LINEWORK_SIGNALS[signal];
  const level = opts?.colorLevel ?? detectColorLevel('stdout');
  if (opts?.styled === false || level === 'none') return `[${signal}]`;
  return paint(meta.glyph, meta.tone as LineworkTone, level);
}

export function renderLineworkPanel(opts: LineworkPanelOptions): string {
  const width = Math.max(40, Math.min(opts.width ?? process.stdout.columns ?? 88, 120));
  const level = opts.styled === false ? 'none' : (opts.colorLevel ?? detectColorLevel('stdout'));
  const styled = level !== 'none';

  if (!styled) {
    const lines = [`${opts.title}${opts.version ? ` ${opts.version}` : ''}${opts.subtitle ? `  ${opts.subtitle}` : ''}`];
    if (opts.zone) lines.push(opts.zone);
    for (const row of opts.rows) {
      const signal = row.signal ? `${lineworkSignal(row.signal, { colorLevel: 'none', styled: false })} ` : '';
      lines.push(`${signal}${row.label}: ${row.text}`);
    }
    if (opts.footer) lines.push(opts.footer);
    return lines.join('\n');
  }

  const tone = opts.tone || 'running';
  const titleBlock = block(` ${opts.title.toUpperCase()} `, tone, level);
  const versionBlock = opts.version ? block(` ${opts.version} `, 'pending', level) : '';
  const headText = [titleBlock, versionBlock, opts.subtitle || ''].filter(Boolean).join(' ');
  const innerWidth = width - 2;
  const lines = [
    `${paint('┌', tone, level)}${fitVisible(headText, innerWidth)}${paint('┐', tone, level)}`,
  ];

  if (opts.zone) {
    lines.push(fitVisible(block(` ${opts.zone.toUpperCase()} `, tone, level), width));
  }

  for (const row of opts.rows) {
    const rowSignal = row.signal || toneSignal(row.tone);
    const signal = rowSignal ? lineworkSignal(rowSignal, { colorLevel: level }) : '  ';
    const stripe = paint('▌', row.tone, level);
    const dot = paint('●', row.tone, level);
    const label = fitVisible(row.label, 11);
    lines.push(fitVisible(`${stripe} ${dot} ${signal} ${label} ${row.text}`, width));
  }

  if (opts.footer) {
    lines.push(`${paint('╵', tone, level)}${fitVisible(` ${opts.footer} `, innerWidth)}${paint('╵', tone, level)}`);
  }

  return lines.join('\n');
}

function toneSignal(tone: LineworkTone): keyof typeof LINEWORK_SIGNALS | undefined {
  switch (tone) {
    case 'healthy': return 'Q';
    case 'running': return 'K';
    case 'pending': return 'P';
    case 'unknown': return 'M';
    case 'recovering': return 'O';
    case 'confirmed': return 'C';
    case 'blocked': return 'D';
    case 'failed': return 'N';
    case 'warning': return 'U';
    default: return undefined;
  }
}

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
