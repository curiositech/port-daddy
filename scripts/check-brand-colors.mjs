#!/usr/bin/env node
/**
 * check-brand-colors.mjs — repo-wide tripwire for retired off-brand hexes.
 *
 * The canonical brand palette lives in website-v2/src/styles/tokens.semantic.css
 * (cobalt #003fb8, teal #006b5f, status-error #bf2f2f, status-warning #a66f00).
 * The "Harbor Heritage" warm palette was RETIRED (see website-v2/docs/design/BRAND.md
 * "Forbidden phrases"), but its hexes kept creeping back — into a duplicate token
 * fork (docs/design/tokens.aaa.css), the brand-mark SVGs, blog diagrams, and skill
 * mirrors. This fails CI on the actual forbidden COLOR VALUES so it cannot return.
 *
 * It checks hexes, not the word "cinnabar" — so BRAND.md's ban-list and ADR-0046's
 * critique (which name the color in order to forbid it) stay green.
 *
 * Companion: website-v2/scripts/check-figure-palette.mjs guards the whitepaper TikZ.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const FORBIDDEN = {
  'CC3D2E': 'cinnabar red',
  'B08D57': 'brass gold',
  '5C7A6A': 'patina green',
}
const FORBIDDEN_RE = new RegExp('#?(' + Object.keys(FORBIDDEN).join('|') + ')\\b', 'i')

// Only scan text source we control. Skip binaries, the stable mirror checkout,
// and generated bundles.
const EXT = /\.(ts|tsx|js|jsx|mjs|cjs|css|scss|html|svg|md|mdx|sh|json|swift|rs|toml|yml|yaml)$/i
// The whitepaper TikZ figures (.tex) have their own dedicated guard,
// website-v2/scripts/check-figure-palette.mjs — exclude them here so the two
// guards don't fight over the same files across separate PRs.
const SKIP_DIR = /(^|\/)(node_modules|dist|build|port-daddy-stable|\.git)(\/|$)|(^|\/)whitepaper\//
// The guard scripts themselves NAME the forbidden hexes as detection patterns —
// they must not trip on their own definitions.
const SKIP_FILE = /(check-brand-colors|check-figure-palette)\.mjs$/

let files = []
try {
  files = execFileSync('git', ['ls-files'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\n').filter(Boolean)
} catch {
  console.error('check-brand-colors: not a git repo / git ls-files failed'); process.exit(2)
}

const violations = []
for (const f of files) {
  if (!EXT.test(f) || SKIP_DIR.test(f) || SKIP_FILE.test(f)) continue
  let text
  try { text = readFileSync(f, 'utf8') } catch { continue }
  if (!FORBIDDEN_RE.test(text)) continue
  text.split('\n').forEach((line, i) => {
    for (const [hex, name] of Object.entries(FORBIDDEN)) {
      if (new RegExp('#?' + hex + '\\b', 'i').test(line)) {
        violations.push(`${f}:${i + 1}  #${hex} (${name}) — ${line.trim().slice(0, 70)}`)
      }
    }
  })
}

if (violations.length) {
  console.error(`\n✗ brand-color guard: ${violations.length} retired off-brand hex(es) found\n`)
  for (const v of violations) console.error('  ' + v)
  console.error('\nThe Harbor Heritage palette is retired (website-v2/docs/design/BRAND.md).')
  console.error('Use tokens.semantic.css: cobalt #003FB8, teal #006B5F, amber #A66F00, danger #BF2F2F.\n')
  process.exit(1)
}
console.log(`✓ brand-color guard: ${files.length} tracked files, no retired off-brand hexes.`)
