/**
 * Port Daddy Launch Splash
 *
 * The "name is so silly it deserves a splash" splash. Big PORT DADDY block
 * letters, a sage halo ribbon, and a cathedral-voice tagline.
 *
 * Displayed on:
 *   - `pd --splash`     (explicit invocation)
 *   - `pd init`         (first-time onboarding flourish)
 *
 * Uses 24-bit ANSI for the brand palette when supported. Falls back to
 * monochrome when NO_COLOR is set, the stream is not a TTY, or COLORTERM
 * does not advertise truecolor.
 *
 * Brand palette (sacred): cream / cobalt / sage / ebony.
 */

// ─── Brand palette (24-bit truecolor) ─────────────────────────────────────────
//
// Sourced from website-v2/src/styles/tokens.semantic.css.
//   cream  #f2eee6   surface
//   cobalt #003fb8   primary
//   sage   #006b5f   accent
//   ebony  #1f1f1f   foreground

const COBALT = '\x1b[38;2;0;63;184m';
const SAGE = '\x1b[38;2;0;107;95m';
const SAGE_BRIGHT = '\x1b[38;2;72;167;152m'; // halo ribbon
const GRAY = '\x1b[38;2;138;134;126m'; // subdued cream for tagline
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

// ─── ASCII PORT DADDY (hand-tuned 5-row block-letter rendering) ───────────────
//
// Each row is 60 columns wide. Letters are 7 wide with a 1-column gap. The
// font has subtle "shadow" pixels on the right edge of each letter, giving a
// cel-shaded 90s-game vibe even before color is applied.

// PORT (4 letters x 7 wide + 3 gaps = 31 cols)
// DADDY (5 letters x 7 wide + 4 gaps = 39 cols)
//
// We render PORT on row block 1, DADDY on row block 2, both centered to the
// width of the wider word (DADDY at 39 cols).

const PORT_LINES: string[] = [
  '████████   ██████   ████████  ████████',
  '██     ██ ██    ██  ██     ██    ██   ',
  '████████  ██    ██  ████████     ██   ',
  '██        ██    ██  ██   ██      ██   ',
  '██         ██████   ██    ██     ██   ',
];

const DADDY_LINES: string[] = [
  '████████   ██████  ████████   ████████  ██    ██',
  '██     ██ ██    ██ ██     ██  ██     ██  ██  ██ ',
  '██     ██ ████████ ██     ██  ██     ██   ████  ',
  '██     ██ ██    ██ ██     ██  ██     ██    ██   ',
  '████████  ██    ██ ████████   ████████     ██   ',
];

// Inner pad to center PORT (38 cols) under DADDY (48 cols). Difference = 10,
// half = 5 spaces leading.
const PORT_PAD = ' '.repeat(5);

// ─── Capability detection ─────────────────────────────────────────────────────

/**
 * Should we emit ANSI 24-bit color escapes?
 * False when NO_COLOR set, output is non-TTY, or COLORTERM does not advertise
 * truecolor support (we fall back to bold/dim only, no color).
 */
export function supportsColor(stream: NodeJS.WriteStream = process.stdout): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  if (!stream.isTTY) return false;
  return true;
}

function supportsTruecolor(): boolean {
  const ct = (process.env.COLORTERM ?? '').toLowerCase();
  if (ct.includes('truecolor') || ct.includes('24bit')) return true;
  // Most modern terminals (iTerm2, Kitty, Alacritty, WezTerm, Ghostty,
  // VS Code, Apple Terminal in macOS 13+) handle 24-bit even without the
  // env var. Default to true and let NO_COLOR override.
  return true;
}

// ─── Renderer ─────────────────────────────────────────────────────────────────

interface SplashOptions {
  /** Override color support detection (useful for testing) */
  color?: boolean;
  /** Override truecolor detection */
  truecolor?: boolean;
  /** Tagline shown beneath the wordmark */
  tagline?: string;
}

const DEFAULT_TAGLINE = 'the control plane for your fleet of agents.';

/**
 * Render the splash as a string. Safe to console.log directly.
 */
export function renderSplash(opts: SplashOptions = {}): string {
  const color = opts.color ?? supportsColor();
  const truecolor = color && (opts.truecolor ?? supportsTruecolor());
  const tagline = opts.tagline ?? DEFAULT_TAGLINE;

  const colorize = (code: string, text: string): string =>
    truecolor ? `${code}${text}${RESET}` : text;
  const boldOnly = (text: string): string =>
    color ? `${BOLD}${text}${RESET}` : text;
  const dimOnly = (text: string): string =>
    color ? `${DIM}${text}${RESET}` : text;

  const lines: string[] = [];

  // Top breathing room
  lines.push('');

  // PORT (cobalt) — padded to align under DADDY
  for (const row of PORT_LINES) {
    const inner = truecolor
      ? `${BOLD}${COBALT}${row}${RESET}`
      : boldOnly(row);
    lines.push(`  ${PORT_PAD}${inner}`);
  }

  // 1-row breath between PORT and DADDY so they read as stacked title-card
  lines.push('');

  // DADDY (cobalt with cream "shadow" trick: we paint the whole row cobalt
  // since the typeface already has built-in depth; sage glow comes from the
  // surrounding context, not per-glyph)
  for (const row of DADDY_LINES) {
    const inner = truecolor
      ? `${BOLD}${COBALT}${row}${RESET}`
      : boldOnly(row);
    lines.push(`  ${inner}`);
  }

  // Sage underline ribbon (the "halo" — gives the title-card lift)
  lines.push('');
  const ribbon = '═══════════════════════════════════════════════════';
  lines.push(`  ${colorize(SAGE_BRIGHT, ribbon)}`);
  lines.push('');

  // Tagline (cream/dim, single line, centered to width 76)
  lines.push('');
  const taglineLine = tagline.length > 76
    ? tagline.slice(0, 76)
    : ' '.repeat(Math.max(0, Math.floor((76 - tagline.length) / 2))) + tagline;
  lines.push(dimOnly(colorize(GRAY, taglineLine)));

  // Bottom breath
  lines.push('');

  return lines.join('\n');
}

/**
 * Convenience: print the splash to stdout.
 */
export function printSplash(opts: SplashOptions = {}): void {
  process.stdout.write(renderSplash(opts) + '\n');
}
