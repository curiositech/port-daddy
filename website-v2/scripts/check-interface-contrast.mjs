/** Read source -> semantic -> component roles, including explicit terminal highlights. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { contrastRatio } from './wcag.mjs'
const root = fileURLToPath(new URL('../src/styles/', import.meta.url))
const files = ['tokens.source.css', 'tokens.semantic.css', 'tokens.roles.css'].map(name => readFileSync(root + name, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''))
function declarations(css) { return Object.fromEntries([...css.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)].map(m => [m[1], m[2].trim()])) }
function palette(theme) {
  const values = {}
  for (const css of files) for (const block of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = block[1].trim()
    if (/^:root(?:,|$)/.test(selector) || (theme === 'dark' && /^(?:html)?\[data-theme=['"]dark['"]\]$/.test(selector))) Object.assign(values, declarations(block[2]))
  }
  function rgb(name, stack = []) {
    if (stack.includes(name)) throw new Error(`circular token ${name}`)
    const value = values[name]
    if (!value) throw new Error(`missing token ${name}`)
    if (/^#[\da-f]{6}$/i.test(value)) return [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16))
    const alias = value.match(/^var\((--[\w-]+)\)$/)
    if (alias) return rgb(alias[1], [...stack, name])
    const mix = value.match(/^color-mix\(in srgb, var\((--[\w-]+)\) (\d+)%, var\((--[\w-]+)\)\)$/)
    if (mix) { const a = rgb(mix[1], [...stack, name]), b = rgb(mix[3], [...stack, name]), weight = Number(mix[2]) / 100; return a.map((v, i) => Math.round(v * weight + b[i] * (1 - weight))) }
    throw new Error(`unhandled ${name}: ${value}`)
  }
  return name => '#' + rgb(name).map(v => v.toString(16).padStart(2, '0')).join('')
}
const failures = [], results = []
for (const theme of ['light', 'dark']) {
  const color = palette(theme)
  function pair(ink, ground, minimum = 7) {
    const ratio = contrastRatio(color(ink), color(ground))
    results.push({ theme, ink, ground, ratio, minimum })
    if (ratio < minimum) failures.push(`${theme} ${ink} on ${ground}: ${ratio.toFixed(2)} < ${minimum}`)
  }
  for (const ink of ['--text-primary', '--text-secondary', '--text-meta', ...['red', 'green', 'yellow', 'blue', 'violet', 'teal', 'indigo', 'rust', 'gold', 'slate'].map(tone => `--ui-ink-${tone}`)]) for (const well of ['--surface-base', '--surface-raised', '--surface-strong', '--surface-sunken']) pair(ink, well)
  const tones = ['neutral', 'muted', 'red', 'green', 'yellow', 'blue', 'violet', 'teal']
  for (const tone of tones) { pair(`--ph-tone-${tone}-ink`, '--ph-bg'); pair(`--ph-tone-${tone}-ink`, `--ph-tone-${tone}-bg`) }
  for (const kind of ['primary', 'accent', 'danger', 'success']) pair(`--action-${kind}-text`, kind === 'primary' ? '--brand-primary' : `--action-${kind}-bg`)
  for (const well of ['--surface-base', '--surface-raised', '--surface-strong']) { pair('--interactive-focus', well, 3); pair('--border-strong', well, 3) }
}
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1 }
else console.log(`Interface contrast: ${results.length} text/action/focus pairs pass in light and dark; lowest ratio ${Math.min(...results.map(r => r.ratio)).toFixed(2)}:1. This is a palette gate, not whole-site certification.`)
export { results }
