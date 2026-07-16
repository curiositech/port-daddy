/**
 * lib/squid/terminal.ts — centralized capability detection + semantic color
 * tokens for the Giant Squid harness's visual surfaces (ADR-0091 identity
 * layer).
 *
 * Single source of truth so `pd squid on|off|status|tap` (and the animated
 * opener) never hand-roll their own NO_COLOR/TTY/TERM=dumb/CI checks or
 * invent a second palette next to `lib/maritime.ts`. Capability detection
 * delegates to `cli/utils/output.ts#detectTerminalCapabilities` — the same
 * function the rest of the CLI already uses for stdout/stderr — and the
 * color codes mirror `lib/maritime.ts`'s existing semantic palette (cyan =
 * identity, green = ok/armed, red = down/blocked, yellow = degraded, dim =
 * secondary) so the harness reads as one visual system, not a bolt-on.
 *
 * `lib/maritime.ts` exports its `ANSI` codes through a Proxy gated by a
 * module-level `COLOR_ENABLED` computed once at import time from raw
 * `process.stdout`. That gating can't be overridden per-call, which makes it
 * untestable and unusable for stderr/stdin-piped surfaces. This module reuses
 * the same escape sequences but gates them itself from a caller-supplied
 * `TerminalCapabilityOverrides`, so tests can assert NO_COLOR/TERM=dumb/CI
 * behavior deterministically.
 */

import {
  detectTerminalCapabilities,
  type TerminalCapabilities,
  type TerminalCapabilityOverrides,
} from '../../cli/utils/output.js';

/** Mirrors lib/maritime.ts's `_ANSI_RAW` — same codes, one visual language. */
const CODES = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
} as const;

export interface SquidCapabilities extends TerminalCapabilities {
  /** True when running under a recognized CI env, independent of isTTY spoofing. */
  ci: boolean;
  /** True when startup motion should be skipped in favor of the static fallback. */
  reducedMotion: boolean;
}

function isCI(env: NodeJS.ProcessEnv): boolean {
  const raw = env.CI;
  return raw !== undefined && raw !== '' && raw !== '0' && raw.toLowerCase() !== 'false';
}

/**
 * Detect the full capability set the squid visual surfaces need: color
 * level, TTY-ness, Unicode, CI, and whether motion should be reduced.
 * `reducedMotion` is true whenever animation would be wasted or actively
 * broken: non-TTY, CI, `TERM=dumb`, or an explicit opt-out.
 */
export function detectSquidCapabilities(
  stream: 'stdout' | 'stderr' = 'stdout',
  overrides: TerminalCapabilityOverrides = {},
): SquidCapabilities {
  const caps = detectTerminalCapabilities(stream, overrides);
  const env = overrides.env ?? process.env;
  const ci = isCI(env);
  const explicitOptOut = env.PD_SQUID_REDUCED_MOTION === '1' || env.NO_ANIMATION === '1';
  const reducedMotion = !caps.isTTY || ci || caps.colorLevel === 'none' || explicitOptOut;
  return { ...caps, ci, reducedMotion };
}

export interface SquidTokens {
  caps: SquidCapabilities;
  /** Armed / healthy / success. */
  ok: (s: string) => string;
  /** Down / blocked / critical failure. */
  bad: (s: string) => string;
  /** Degraded / partial / needs attention. */
  warn: (s: string) => string;
  /** The ◆ PD identity badge and other "this session is harnessed" markers. */
  identity: (s: string) => string;
  /** The ◆ PD⇄CODEX piloted-identity variant. */
  pilot: (s: string) => string;
  /** Secondary / muted detail. */
  dim: (s: string) => string;
  bold: (s: string) => string;
}

/** Build the semantic color tokens for one output stream, honoring capabilities. */
export function squidTokens(
  stream: 'stdout' | 'stderr' = 'stdout',
  overrides: TerminalCapabilityOverrides = {},
): SquidTokens {
  const caps = detectSquidCapabilities(stream, overrides);
  const color = caps.colorLevel !== 'none';
  const wrap = (code: string) => (s: string): string => (color ? `${code}${s}${CODES.reset}` : s);
  return {
    caps,
    ok: wrap(CODES.green),
    bad: wrap(CODES.red),
    warn: wrap(CODES.yellow),
    identity: wrap(CODES.cyan),
    pilot: wrap(CODES.magenta),
    dim: wrap(CODES.dim),
    bold: wrap(CODES.bold),
  };
}
