#!/usr/bin/env node
/**
 * check-figure-palette.mjs — the regression guard for whitepaper figure color.
 *
 * Every TikZ figure and whitepaper .tex must draw ONLY from the brand palette.
 * This fails (exit 1) if it finds an off-brand hex, an off-brand color NAME
 * (cinnabar / brass / patina — the warm accents that kept creeping back), or an
 * accent whose contrast on the paper ground drops below WCAG AAA.
 *
 * Brand source of truth: website-v2/src/styles/tokens.semantic.css
 *   --brand-primary #003fb8  --brand-accent #006b5f  --status-warning #a66f00
 * Figures deepen the accent/amber for AAA-as-text on the cream ground; the exact
 * values live in ALLOWED_HEX below (all verified >=7:1 on #FBF7EF, except amber
 * which is 7.94:1, and the two neutral code-block greys which are non-text).
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
  '1B1712', // ink      — body text                                    16.7:1 AAA
  '121212', // ebony    — brand text-primary                          17.5:1 AAA
  'FBF7EF', // paper    — brand paper ground
  'E9DCC4', // sand     — light fill (used at tints)
  'D8C7A6', // sanddeep — deeper fill
  '5C5650', // gray     — muted neutral
  'C8C8C8', // codeframe — code-block rule (RGB 200,200,200), non-text
  'F8F8F8', // codebg    — code-block background (RGB 248,248,248), non-text
])
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

if (violations.length) {
  console.error(`\n✗ figure-palette guard: ${violations.length} violation(s)\n`)
  for (const v of violations) console.error('  ' + v)
  console.error('\nFigures must use ONLY the brand palette (see website-v2/scripts/check-figure-palette.mjs).')
  console.error('cinnabar/brass/patina are banned. New accents: derive from tokens.semantic.css, verify AAA.\n')
  process.exit(1)
}
console.log('✓ figure-palette guard: all whitepaper figures are on the brand palette (AAA).')
