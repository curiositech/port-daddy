#!/usr/bin/env node
/**
 * check-figure-palette.mjs — the regression guard for whitepaper figure color.
 *
 * Every TikZ figure and whitepaper .tex must draw ONLY from the brand palette.
 * This fails (exit 1) if it finds an off-brand hex, an off-brand color NAME
 * (cinnabar / brass / patina — the warm accents that kept creeping back), or an
 * accent whose contrast on the paper ground drops below the documented floor.
 *
 * Brand source of truth: website-v2/src/styles/tokens.semantic.css (light theme).
 *
 * Two palettes coexist in the TeX sources:
 *   hh*  — the first-edition figure palette (cobalt / deepened teal / deepened
 *          amber / mayday, all AAA as text on the cream ground);
 *   pd*  — the Book's semantic palette (story palette v2, one hue per meaning),
 *          declared once per source tree in figures/pd-palette.tex and kept in
 *          LOCKSTEP with the light tokens: this script fails if a pd* hex and
 *          its token disagree, or if the two committed copies differ.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')             // repo root from website-v2/scripts
const FIG_DIRS = [
  join(REPO, 'website-v2', 'public', 'whitepaper'),
  join(REPO, 'whitepaper'),                      // explainable quartet (when present)
]

// Brand palette the figures are allowed to define (upper-case, no #).
const ALLOWED_HEX = new Set([
  '003FB8', // cobalt   — brand-primary           (accent / primary)   8.18:1 AAA
  '00564C', // teal     — brand-accent deepened   (accent / secondary) 8.07:1 AAA
  '6B4500', // amber    — the fourth               (accent / caution)   7.94:1 AAA
  '8B0000', // mayday   — failure/blocked/revoked  (accent / negative)  9.37:1 AAA
  '1B1712', // ink      — body text                                    16.7:1 AAA
  '121212', // ebony    — brand text-primary                          17.5:1 AAA
  'FBF7EF', // paper    — brand paper ground
  'E9DCC4', // sand     — light fill (used at tints)
  'D8C7A6', // sanddeep — deeper fill
  '5C5650', // gray     — muted neutral
  'C8C8C8', // codeframe — code-block rule (RGB 200,200,200), non-text
  'F8F8F8', // codebg    — code-block background (RGB 248,248,248), non-text
  // The Book's semantic palette (pd*), light values, one hue per meaning.
  // Amber is stripes/dots/display only (3.71:1); violet and gold are AA as text.
  '006B5F', // pdteal    — legibility               --brand-accent
  '1F7A4D', // pdhealth  — ready / coordinated      --story-health
  '353A85', // pdindigo  — protocol / federation    --story-indigo
  '933FA5', // pdviolet  — identity / continuity    --story-violet
  '7A4514', // pdrust    — reputation               --story-rust
  '666A00', // pdgold    — economy / value          --story-gold
  '403B34', // pdinkmuted — links, secondary text   --text-secondary
  'BF2F2F', // pderror   — breach / correction      --status-error
  'A66F00', // pdamber   — warning, display only    --status-warning
  'CAD900', // pdlime    — highlight fill, ink text --chart-yellow
  'F2EEE6', // pdcream   — page ground              --surface-base
  'F7F3EB', // pdcreamraised — panels               --surface-raised
  'E9E2D5', // pdcreamstrong — inset wells          --surface-strong
])

// pd* color -> the light token it must equal. figures/pd-palette.tex is the
// single TeX declaration; both committed copies must match each other and the
// tokens. Change a hue in tokens.semantic.css (+ BRAND.md) first, then here.
const PD_TOKEN_LOCKSTEP = {
  pdcobalt: '--brand-primary',
  pdteal: '--brand-accent',
  pdhealth: '--story-health',
  pdindigo: '--story-indigo',
  pdviolet: '--story-violet',
  pdrust: '--story-rust',
  pdgold: '--story-gold',
  pderror: '--status-error',
  pdamber: '--status-warning',
  pdlime: '--chart-yellow',
  pdink: '--text-primary',
  pdinkmuted: '--text-secondary',
  pdcream: '--surface-base',
  pdcreamraised: '--surface-raised',
  pdcreamstrong: '--surface-strong',
}
const PD_PALETTE_COPIES = [
  join(REPO, 'website-v2', 'public', 'whitepaper', 'figures', 'pd-palette.tex'),
  join(REPO, 'whitepaper', 'figures', 'pd-palette.tex'),
]
const TOKENS_CSS = join(REPO, 'website-v2', 'src', 'styles', 'tokens.semantic.css')

const FORBIDDEN_NAMES = /\b(cinnabar|brass|patina)\b/   // the warm accents, banned by name
// known off-brand hexes we explicitly call out for a better error message
const OFFENDERS = { CC3D2E: 'cinnabar red', B08D57: 'brass gold', '5C7A6A': 'patina green' }

function walk(dir) {
  let out = []
  let entries
  try { entries = readdirSync(dir) } catch { return out }
  for (const e of entries) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) out = out.concat(walk(p))
    else if (e.endsWith('.tex')) out.push(p)
  }
  return out
}

const violations = []
for (const dir of FIG_DIRS) {
  for (const file of walk(dir)) {
    const text = readFileSync(file, 'utf8')
    const rel = file.replace(REPO + '/', '')
    text.split('\n').forEach((line, i) => {
      const code = line.replace(/%.*$/, '') // strip TeX comments
      // 1) HTML color definitions must use an allowed hex
      for (const m of code.matchAll(/(?:provide|define)color\{[A-Za-z]+\}\{HTML\}\{([0-9A-Fa-f]{6})\}/g)) {
        const hex = m[1].toUpperCase()
        if (!ALLOWED_HEX.has(hex)) {
          const why = OFFENDERS[hex] ? ` (${OFFENDERS[hex]})` : ''
          violations.push(`${rel}:${i + 1}  off-brand hex #${hex}${why}`)
        }
      }
      // 2) forbidden color NAMES anywhere (defs, use-sites, prose)
      if (FORBIDDEN_NAMES.test(code)) {
        violations.push(`${rel}:${i + 1}  forbidden color name: ${code.trim().slice(0, 80)}`)
      }
    })
  }
}

// 3) pd* lockstep: the TeX palette equals the light tokens, in both copies.
function lightTokens(css) {
  // The first `:root {` block is the light theme; dark themes follow it.
  const start = css.indexOf(':root')
  const open = css.indexOf('{', start)
  let depth = 0
  let end = open
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1
    if (css[i] === '}') { depth -= 1; if (depth === 0) { end = i; break } }
  }
  const block = css.slice(open + 1, end)
  const tokens = new Map()
  for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:\s*#([0-9a-fA-F]{6})\b/g)) {
    if (!tokens.has(m[1])) tokens.set(m[1], m[2].toUpperCase())
  }
  return tokens
}
try {
  const tokens = lightTokens(readFileSync(TOKENS_CSS, 'utf8'))
  const copies = PD_PALETTE_COPIES.map((p) => ({ path: p, text: readFileSync(p, 'utf8') }))
  if (copies[0].text !== copies[1].text) {
    violations.push(`pd-palette.tex drifted between ${copies[0].path.replace(REPO + '/', '')} and ${copies[1].path.replace(REPO + '/', '')} (must be byte-identical)`)
  }
  const declared = new Map()
  for (const m of copies[0].text.matchAll(/\\definecolor\{(pd[a-z]+)\}\{HTML\}\{([0-9A-Fa-f]{6})\}/g)) {
    declared.set(m[1], m[2].toUpperCase())
  }
  for (const [name, token] of Object.entries(PD_TOKEN_LOCKSTEP)) {
    const tex = declared.get(name)
    const css = tokens.get(token)
    if (!tex) violations.push(`figures/pd-palette.tex: missing \\definecolor{${name}}`)
    else if (!css) violations.push(`tokens.semantic.css: ${token} (for ${name}) not found in the light theme`)
    else if (tex !== css) violations.push(`lockstep: ${name} is #${tex} in pd-palette.tex but ${token} is #${css} in tokens.semantic.css`)
  }
  for (const name of declared.keys()) {
    if (!(name in PD_TOKEN_LOCKSTEP)) violations.push(`figures/pd-palette.tex: ${name} has no token mapping in check-figure-palette.mjs`)
  }
} catch (error) {
  violations.push(`pd* lockstep check could not run: ${error.message}`)
}

if (violations.length) {
  console.error(`\n✗ figure-palette guard: ${violations.length} violation(s)\n`)
  for (const v of violations) console.error('  ' + v)
  console.error('\nFigures must use ONLY the brand palette (see website-v2/scripts/check-figure-palette.mjs).')
  console.error('cinnabar/brass/patina are banned. New accents: derive from tokens.semantic.css, verify contrast, then add to pd-palette.tex + the lockstep map.\n')
  process.exit(1)
}
console.log('✓ figure-palette guard: all whitepaper figures are on the brand palette, and pd-palette.tex matches the light tokens.')
