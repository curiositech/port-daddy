/**
 * Chart palette resolver for docs-content Mermaid flowcharts.
 *
 * Mermaid classDef directives need literal color strings inside the chart
 * source, but the website's design contract forbids raw hex outside the token
 * surface. So chart strings carry palette placeholders ({{cobalt}}, {{ink}},
 * {{paper}}, {{green}}, {{accent}}, {{stroke}}, {{cobaltText}}, {{inkText}},
 * {{paperText}}, {{greenText}}, {{accentText}}) and this resolver swaps them
 * for whatever the live theme says — light or dark, brand-tweaked or not.
 *
 * The palette names map onto a small named-slot system rather than to
 * specific hex values: "cobalt" is the daemon/coordination tier, "green" is
 * the safety/state tier, "ink" is the operator/authority tier, "paper" is
 * the neutral surface tier, and "accent" is the highlight tier. That way the
 * docs read like a controlled vocabulary instead of a graphic-design poster.
 */

export type ChartSlot =
  | 'cobalt'
  | 'cobaltText'
  | 'green'
  | 'greenText'
  | 'ink'
  | 'inkText'
  | 'paper'
  | 'paperText'
  | 'accent'
  | 'accentText'
  | 'stroke'

const SLOT_TO_VAR: Record<ChartSlot, string> = {
  cobalt: '--brand-primary',
  cobaltText: '--brand-primary-foreground',
  green: '--brand-accent',
  greenText: '--brand-accent-foreground',
  ink: '--text-primary',
  inkText: '--text-inverse',
  paper: '--surface-raised',
  paperText: '--text-primary',
  // accent is a chart-only yellow tier kept distinct from green/cobalt so a
  // fourth class of node (highlight, often "user/operator action") reads as
  // its own thing in the rendered diagram. The text on it is always dark
  // because yellow is bright.
  accent: '--chart-yellow',
  accentText: '--chart-yellow-foreground',
  stroke: '--border-strong',
}

/**
 * Read the live computed value of a CSS variable. Falls back to the literal
 * `var(--token)` reference if we are in a non-DOM environment (server render,
 * vitest jsdom edge cases) — Mermaid is a client-only renderer anyway, so
 * this is just defensive.
 */
function readVar(name: string): string {
  if (typeof document === 'undefined') return `var(${name})`
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || `var(${name})`
}

/**
 * Substitute every `{{slot}}` placeholder in a chart template with the
 * resolved CSS-variable value for the matching design token. Unknown slots
 * are left untouched, which keeps typos visible in the rendered SVG instead
 * of failing silently.
 */
export function withChartPalette(template: string): string {
  return template.replace(/\{\{(\w+)\}\}/g, (raw, slot: string) => {
    const cssVar = SLOT_TO_VAR[slot as ChartSlot]
    if (!cssVar) return raw
    return readVar(cssVar)
  })
}
