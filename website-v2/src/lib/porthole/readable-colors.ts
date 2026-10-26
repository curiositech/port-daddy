/** Reader presentation only. VT parsing and captured bytes remain unchanged.
 * Explicit256/truecolor inks from a dark terminal cannot be readable on cream.
 * Map their hue to paired website inks, including inverse/background runs. */
export type TerminalTone = 'neutral' | 'muted' | 'red' | 'green' | 'yellow' | 'blue' | 'violet' | 'teal'
const tokens: Record<string, TerminalTone> = {
  'ph-bg': 'neutral', 'ph-text': 'neutral', 'ph-command': 'neutral',
  'ph-comment': 'muted', 'ph-line-number': 'muted',
  'ph-prompt': 'green', 'ph-flag': 'blue', 'ph-channel-scope': 'blue',
  'status-error': 'red', 'status-warning': 'yellow', 'status-info': 'blue',
  'status-success': 'green', 'story-violet': 'violet', 'brand-accent': 'teal',
}
export function terminalTone(color: string | null): TerminalTone {
  if (!color) return 'neutral'
  const token = color.match(/^var\(--([\w-]+)\)$/)?.[1]
  if (token) return tokens[token] ?? 'neutral'
  const match = color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/)
  if (!match) return 'neutral'
  const [r, g, b] = match.slice(1).map(Number).map(value => value / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min
  if (!delta || delta / max < .18) return 'muted'
  const raw = max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4
  const hue = (raw * 60 + 360) % 360
  if (hue < 25 || hue >= 345) return 'red'
  if (hue < 65) return 'yellow'
  if (hue < 160) return 'green'
  if (hue < 200) return 'teal'
  if (hue < 265) return 'blue'
  return 'violet'
}
export function readableTerminalStyle(st: { fg: string | null; bg: string | null; b: boolean; d: boolean; i: boolean; u: boolean; inv: boolean }): string {
  let fg = st.fg, bg = st.bg
  if (st.inv) [fg, bg] = [bg || 'var(--ph-bg)', fg || 'var(--ph-text)']
  // Colored backgrounds always receive their paired ink, so an inverse red
  // status does not become white on pink when the page switches to dark.
  const tone = bg ? terminalTone(bg) : st.d ? 'muted' : terminalTone(fg)
  let style = `color:var(--ph-tone-${tone}-ink);`
  if (bg) style += `background:var(--ph-tone-${tone}-bg);`
  if (st.b) style += 'font-weight:700;'
  if (st.i || st.d) style += 'font-style:italic;'
  if (st.u) style += 'text-decoration:underline;'
  return style
}
