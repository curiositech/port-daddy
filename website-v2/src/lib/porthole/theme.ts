/**
 * Porthole's 16-slot ANSI palette, resolved to Port Daddy's own semantic
 * design tokens (`src/styles/tokens.semantic.css`) instead of a generic
 * terminal color scheme.
 *
 * Motivation: `lib/maritime.ts` already colors the real CLI's output by
 * MEANING — green for affirmative/success (Charlie), red for negative/
 * failure (November), cyan for safety information (Securite), yellow for
 * danger-ahead warnings (Uniform) — per ADR-0010's maritime signal-flag
 * vocabulary. A generic terminal palette (Solarized, the prototype's
 * hand-picked `--t-0..15`) would silently discard that meaning: the same
 * green the CLI uses for "claimed" would land on an arbitrary hue that has
 * nothing to do with `--status-success` used everywhere else on the site.
 * This module maps each ANSI slot to the token that already carries that
 * exact meaning, so a Porthole embed is not a decorative terminal skin
 * pasted onto the page — it is the site's own color language, playing back
 * bytes the CLI already colored on purpose. `[data-theme]` does the rest:
 * these are CSS custom property REFERENCES, not resolved colors, so a
 * Porthole embed re-themes for free whenever the page around it does.
 *
 * Background/foreground slots (0, 2, 4, 7, 8, 12, 15) route through `--ph-*`,
 * NOT `--code-*`: `--code-*` is deliberately dark-in-both-themes (the static
 * code-block convention), which is exactly why a Porthole embed used to stay
 * dark when the page went light. `--ph-*` (tokens.semantic.css) is real light
 * values in light mode, and aliases straight back to `--code-*` in dark mode
 * — so light mode actually looks like the site, dark mode is unchanged.
 * Signal-carrying slots (1/3/5/6/9/10/11/13/14 — error/warning/identity/info)
 * already route through `--status-*`/`--story-violet`/`--brand-accent`, which
 * were already correctly light/dark differentiated, so those are untouched.
 */
export const PORTHOLE_ANSI_THEME: readonly string[] = [
  // 0-7: standard intensity
  "var(--ph-bg)", // 0 black — background-adjacent, rare as foreground
  "var(--status-error)", // 1 red — November: failures, errors
  "var(--ph-prompt)", // 2 green — Charlie: affirmative, success, the `$` prompt itself
  "var(--status-warning)", // 3 yellow — Uniform: warnings, danger-ahead
  "var(--ph-flag)", // 4 blue — flags/options, and the cobalt "kernel" hue
  "var(--story-violet)", // 5 magenta — identity/continuity (ADR-0048 L3)
  "var(--status-info)", // 6 cyan — Securite: safety/informational signal
  "var(--ph-text)", // 7 white — default foreground
  // 8-15: bright intensity
  "var(--ph-line-number)", // 8 bright black — dim/muted secondary text
  "var(--status-error)", // 9 bright red
  "var(--status-success)", // 10 bright green
  "var(--status-warning)", // 11 bright yellow
  "var(--ph-channel-scope)", // 12 bright blue — matches the `project:` segment color
  "var(--story-violet)", // 13 bright magenta
  "var(--brand-accent)", // 14 bright cyan — teal, "legibility" layer
  "var(--ph-command)", // 15 bright white — the brightest foreground, for command text
];

/** Default terminal foreground/background when SGR resets to "no color"
 *  (`\x1b[39m`/`\x1b[49m` or a bare `\x1b[0m`). Kept as tokens, not literals,
 *  for the same re-theme-for-free reason as the palette above. */
export const PORTHOLE_DEFAULT_FG = "var(--ph-text)";
export const PORTHOLE_DEFAULT_BG: string | null = null;
