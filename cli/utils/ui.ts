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
import sliceAnsi from 'slice-ansi';
import { ANSI, highlightChannel } from '../../lib/maritime.js';
import { ICS_MEANING, signalFor, type SignalCode } from '../../lib/maritime-signals.js';
import {
  detectColorLevel,
  detectTerminalCapabilities,
  IS_TTY,
  type CliColorLevel,
  type TerminalCapabilities,
  type TerminalCapabilityOverrides,
} from './output.js';

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

export type LineworkState =
  | 'healthy'
  | 'fleet-healthy'
  | 'active'
  | 'spawning'
  | 'pending'
  | 'idle'
  | 'unknown'
  | 'awaiting-human'
  | 'warning'
  | 'conflict'
  | 'blocked'
  | 'guard-blocked'
  | 'recovering'
  | 'lost'
  | 'confirmed'
  | 'refused'
  | 'failed'
  | 'mayday'
  | 'request'
  | 'info'
  | 'muted';

export interface LineworkVisual {
  tone: LineworkTone;
  signal?: SignalCode;
  meaning: string;
}

export interface LineworkRow {
  state?: LineworkState;
  tone?: LineworkTone;
  label: string;
  text: string;
  signal?: SignalCode | null;
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

export interface LineworkPolicyOptions {
  json?: boolean;
  quiet?: boolean;
  stream?: 'stdout' | 'stderr';
  capabilities?: TerminalCapabilityOverrides;
}

export interface LineworkPolicy {
  enabled: boolean;
  reason: 'enabled' | 'json' | 'quiet' | TerminalCapabilities['reason'];
  capabilities: TerminalCapabilities;
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

type SignalFaceColor = 'black' | 'white' | 'blue' | 'yellow' | 'red';

const SIGNAL_COLOR: Record<SignalFaceColor, {
  ansi16: number;
  ansi256: number;
  rgb: [number, number, number];
}> = {
  black: { ansi16: 30, ansi256: 233, rgb: [18, 18, 18] },
  white: { ansi16: 37, ansi256: 255, rgb: [242, 239, 231] },
  blue: { ansi16: 34, ansi256: 26, rgb: [30, 72, 190] },
  yellow: { ansi16: 33, ansi256: 190, rgb: [219, 234, 0] },
  red: { ansi16: 31, ansi256: 203, rgb: [222, 56, 72] },
};

// Two-block micro-faces preserve the recognizable colors of the real flag.
// They are cues, not miniature geometric reproductions of the full hoist.
const SIGNAL_FACE: Record<SignalCode, readonly [SignalFaceColor, SignalFaceColor]> = {
  A: ['white', 'blue'], B: ['red', 'red'], C: ['blue', 'red'],
  D: ['yellow', 'blue'], E: ['blue', 'red'], F: ['white', 'red'],
  G: ['yellow', 'blue'], H: ['white', 'red'], I: ['yellow', 'black'],
  J: ['blue', 'white'], K: ['yellow', 'blue'], L: ['yellow', 'black'],
  M: ['blue', 'white'], N: ['blue', 'white'], O: ['yellow', 'red'],
  P: ['blue', 'white'], Q: ['yellow', 'yellow'], R: ['red', 'yellow'],
  S: ['white', 'blue'], T: ['red', 'white'], U: ['red', 'white'],
  V: ['white', 'red'], W: ['blue', 'white'], X: ['white', 'blue'],
  Y: ['yellow', 'red'], Z: ['yellow', 'blue'],
};

export const LINEWORK_SIGNALS: Record<SignalCode, {
  face: readonly [SignalFaceColor, SignalFaceColor];
  meaning: string;
}> = Object.fromEntries(
  (Object.keys(SIGNAL_FACE) as SignalCode[]).map((signal) => [
    signal,
    { face: SIGNAL_FACE[signal], meaning: ICS_MEANING[signal] },
  ]),
) as Record<SignalCode, {
  face: readonly [SignalFaceColor, SignalFaceColor];
  meaning: string;
}>;

export const LINEWORK_STATES: Record<LineworkState, LineworkVisual> = {
  healthy: { tone: 'healthy', meaning: 'health confirmed; no coordination flag implied' },
  'fleet-healthy': { tone: 'healthy', signal: signalFor('fleet-healthy'), meaning: 'fleet is prepared to proceed' },
  active: { tone: 'running', signal: signalFor('claim-active'), meaning: 'active ownership; pilot aboard' },
  spawning: { tone: 'running', signal: signalFor('spawning'), meaning: 'delicate launch in progress; keep clear' },
  pending: { tone: 'pending', meaning: 'queued or pending; no coordination flag implied' },
  idle: { tone: 'unknown', signal: signalFor('idle'), meaning: 'stopped and making no way' },
  unknown: { tone: 'unknown', meaning: 'truth has not been confirmed' },
  'awaiting-human': { tone: 'blocked', signal: signalFor('awaiting-human'), meaning: 'disabled; communicate with operator' },
  warning: { tone: 'warning', signal: 'U', meaning: 'running into danger' },
  conflict: { tone: 'blocked', signal: signalFor('conflict'), meaning: 'requires assistance or arbitration' },
  blocked: { tone: 'blocked', signal: signalFor('blocked'), meaning: 'maneuvering with difficulty' },
  'guard-blocked': { tone: 'blocked', signal: signalFor('awaiting-human'), meaning: 'guard requires operator communication' },
  recovering: { tone: 'recovering', meaning: 'recovery is in progress; no coordination flag implied' },
  lost: { tone: 'failed', meaning: 'agent lost mid-run; no coordination flag implied' },
  confirmed: { tone: 'confirmed', signal: signalFor('affirmative'), meaning: 'affirmative receipt' },
  refused: { tone: 'failed', signal: signalFor('refuse'), meaning: 'negative or refused' },
  failed: { tone: 'failed', meaning: 'operation failed; inspect the next action' },
  mayday: { tone: 'failed', signal: signalFor('mayday'), meaning: 'grave operational danger' },
  request: { tone: 'info', signal: signalFor('request'), meaning: 'request to communicate' },
  info: { tone: 'info', signal: signalFor('inform'), meaning: 'informational context' },
  muted: { tone: 'muted', meaning: 'secondary context' },
};

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

function paintSignalColor(value: string, colorName: SignalFaceColor, level: CliColorLevel): string {
  if (level === 'none') return value;
  const color = SIGNAL_COLOR[colorName];
  const ansi = level === 'truecolor'
    ? `\x1b[38;2;${color.rgb.join(';')}m`
    : level === '256'
      ? `\x1b[38;5;${color.ansi256}m`
      : `\x1b[${color.ansi16}m`;
  return `${ansi}${value}${RESET}`;
}

function block(value: string, tone: LineworkTone, level: CliColorLevel): string {
  if (level === 'none') return value;
  const foreground = level === 'truecolor'
    ? '\x1b[38;2;18;18;18m'
    : level === '256'
      ? '\x1b[38;5;233m'
      : (tone === 'running' || tone === 'recovering' || tone === 'blocked' || tone === 'failed')
        ? '\x1b[37m'
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

const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function graphemeWidth(grapheme: string): number {
  if (
    /\p{Extended_Pictographic}/u.test(grapheme)
    || /\p{Regional_Indicator}/u.test(grapheme)
    || grapheme.includes('\ufe0f')
    || grapheme.includes('\u20e3')
  ) {
    return 2;
  }
  return Array.from(grapheme).reduce((sum, char) => {
    const code = char.codePointAt(0) || 0;
    if (/^\p{Mark}$/u.test(char) || (code >= 0xfe00 && code <= 0xfe0f)) return sum;
    return sum + charWidth(char);
  }, 0);
}

export function visibleWidth(value: string): number {
  return Array.from(GRAPHEME_SEGMENTER.segment(stripAnsi(value)))
    .reduce((sum, part) => sum + graphemeWidth(part.segment), 0);
}

function truncateVisible(value: string, width: number): string {
  if (visibleWidth(value) <= width) return value;
  if (width <= 0) return '';
  return `${sliceAnsi(value, 0, Math.max(0, width - 1))}…${RESET}`;
}

function fitVisible(value: string, width: number): string {
  const trimmed = truncateVisible(value, width);
  const padding = Math.max(0, width - visibleWidth(trimmed));
  return `${trimmed}${' '.repeat(padding)}`;
}

function wrapVisible(value: string, width: number): string[] {
  const safeWidth = Math.max(1, width);
  const chunks: string[] = [];
  let line = '';
  const flush = (): void => {
    if (line) chunks.push(line);
    line = '';
  };
  for (const word of value.trim().split(/\s+/).filter(Boolean)) {
    if (visibleWidth(word) > safeWidth) {
      flush();
      for (let start = 0; start < visibleWidth(word); start += safeWidth) {
        chunks.push(sliceAnsi(word, start, start + safeWidth));
      }
      continue;
    }
    const candidate = line ? `${line} ${word}` : word;
    if (visibleWidth(candidate) <= safeWidth) {
      line = candidate;
    } else {
      flush();
      line = word;
    }
  }
  flush();
  return chunks.length > 0 ? chunks : [''];
}

export function lineworkVisual(state: LineworkState): LineworkVisual {
  return LINEWORK_STATES[state];
}

export function lineworkPolicy(opts: LineworkPolicyOptions = {}): LineworkPolicy {
  const capabilities = detectTerminalCapabilities(
    opts.stream ?? 'stdout',
    opts.capabilities,
  );
  if (opts.json) return { enabled: false, reason: 'json', capabilities };
  if (opts.quiet) return { enabled: false, reason: 'quiet', capabilities };
  if (capabilities.reason !== 'enabled') {
    return { enabled: false, reason: capabilities.reason, capabilities };
  }
  return { enabled: true, reason: 'enabled', capabilities };
}

export function lineworkEnabled(opts: LineworkPolicyOptions = {}): boolean {
  return lineworkPolicy(opts).enabled;
}

export function lineworkColorLevel(stream: 'stdout' | 'stderr' = 'stdout'): CliColorLevel {
  return detectColorLevel(stream);
}

export function lineworkSignal(
  signal: SignalCode,
  opts?: { colorLevel?: CliColorLevel; styled?: boolean }
): string {
  const meta = LINEWORK_SIGNALS[signal];
  const level = opts?.colorLevel ?? detectColorLevel('stdout');
  if (opts?.styled === false || level === 'none') return `[${signal}]`;
  const face = meta.face
    .map((color) => paintSignalColor('█', color, level))
    .join('');
  return `${face}${signal}`;
}

function resolveLineworkRow(row: LineworkRow): Required<Pick<LineworkRow, 'label' | 'text'>> & {
  tone: LineworkTone;
  signal?: SignalCode;
} {
  const visual = row.state ? lineworkVisual(row.state) : undefined;
  return {
    label: row.label,
    text: row.text,
    tone: row.tone ?? visual?.tone ?? 'info',
    signal: row.signal === null ? undefined : row.signal ?? visual?.signal,
  };
}

export function renderLineworkPanel(opts: LineworkPanelOptions): string {
  const width = Math.max(20, Math.min(opts.width ?? process.stdout.columns ?? 88, 120));
  const level = opts.styled === false ? 'none' : (opts.colorLevel ?? detectColorLevel('stdout'));
  const styled = level !== 'none';

  if (!styled) {
    const lines = [`${opts.title}${opts.version ? ` ${opts.version}` : ''}${opts.subtitle ? `  ${opts.subtitle}` : ''}`];
    if (opts.zone) lines.push(opts.zone);
    for (const unresolved of opts.rows) {
      const row = resolveLineworkRow(unresolved);
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

  for (const unresolved of opts.rows) {
    const row = resolveLineworkRow(unresolved);
    const signal = row.signal ? lineworkSignal(row.signal, { colorLevel: level }) : '   ';
    const stripe = paint('▌', row.tone, level);
    const dot = paint('●', row.tone, level);
    const labelWidth = Math.max(4, Math.min(11, width - 13));
    const label = fitVisible(row.label, labelWidth);
    const prefix = `${stripe} ${dot} ${signal} ${label} `;
    const prefixWidth = visibleWidth(prefix);
    const inlineWidth = width - prefixWidth;
    if (inlineWidth < 8) {
      lines.push(fitVisible(prefix, width));
      const continuationIndent = 2;
      for (const chunk of wrapVisible(row.text, width - continuationIndent)) {
        lines.push(fitVisible(`${' '.repeat(continuationIndent)}${chunk}`, width));
      }
      continue;
    }
    const firstChunk = wrapVisible(row.text, inlineWidth)[0];
    lines.push(fitVisible(`${prefix}${firstChunk}`, width));
    const remaining = row.text.trim().slice(firstChunk.length).trimStart();
    if (remaining) {
      const continuationIndent = 2;
      for (const chunk of wrapVisible(remaining, width - continuationIndent)) {
        lines.push(fitVisible(`${' '.repeat(continuationIndent)}${chunk}`, width));
      }
    }
  }

  if (opts.footer) {
    lines.push(`${paint('╵', tone, level)}${fitVisible(` ${opts.footer} `, innerWidth)}${paint('╵', tone, level)}`);
  }

  return lines.join('\n');
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
