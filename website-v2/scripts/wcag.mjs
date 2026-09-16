/**
 * wcag.mjs — WCAG 2.2 relative luminance and contrast ratio, in one place.
 *
 * Used by check-figure-palette.mjs to measure every registered ink against
 * every ground it prints on, and importable on its own so the arithmetic can
 * be tested without running the guard. The formulas are the ones in WCAG 2.2
 * §1.4.3 and its "relative luminance" definition: sRGB channels linearised
 * with the 0.04045 knee, weighted 0.2126 / 0.7152 / 0.0722, and the ratio
 * (L1 + 0.05) / (L2 + 0.05) with the lighter colour on top.
 */

/** Relative luminance of a six-digit hex colour (with or without '#'). */
export function relativeLuminance(hex) {
  const clean = hex.replace(/^#/, '')
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) throw new TypeError(`not a six-digit hex colour: ${hex}`)
  const channel = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(clean.slice(i, i + 2), 16) / 255))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Contrast ratio between two hex colours, always >= 1. */
export function contrastRatio(a, b) {
  const [la, lb] = [relativeLuminance(a), relativeLuminance(b)]
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** The AA floors: normal text and large text (>= 18 pt, or 14 pt bold). */
export const AA = Object.freeze({ text: 4.5, large: 3.0 })
