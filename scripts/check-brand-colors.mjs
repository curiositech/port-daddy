#!/usr/bin/env node
/**
 * check-brand-colors.mjs — repo-wide tripwire for retired off-brand colors.
 *
 * The canonical brand palette lives in website-v2/src/styles/tokens.semantic.css
 * (cobalt #003fb8, teal #006b5f, status-error #bf2f2f, status-warning #a66f00).
 * The "Harbor Heritage" warm palette was RETIRED (see website-v2/docs/design/BRAND.md
 * "Forbidden phrases"), but its hexes kept creeping back — into a duplicate token
 * fork (docs/design/tokens.aaa.css), the brand-mark SVGs, blog diagrams, and skill
 * mirrors. This fails CI on the actual forbidden COLOR VALUES so it cannot return.
 *
 * It checks both hex (#CC3D2E) AND rgb/rgba numeric forms (204,61,46) so the guard
 * cannot be bypassed by writing rgba(204,61,46,...) instead of the hex literal.
 * It does NOT check the word "cinnabar" — so BRAND.md's ban-list and ADR-0046's
 * critique (which name the color in order to forbid it) stay green.
 *
 * Companion: website-v2/scripts/check-figure-palette.mjs guards the whitepaper TikZ.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

/**
 * Each entry: hex key (uppercase, no #) → { name, rgb: [r,g,b] }
 * rgb values are used to build a numeric-form pattern like `204\s*,\s*61\s*,\s*46`
 * so rgba(204,61,46,0.5) is caught just as firmly as #CC3D2E.
 */
const FORBIDDEN = {
  'CC3D2E': { name: 'cinnabar red',   rgb: [204, 61, 46] },
  'B08D57': { name: 'brass gold',     rgb: [176, 141, 87] },
  '5C7A6A': { name: 'patina green',   rgb: [92, 122, 106] },
  // Retired 2026-07-05 per binder ch. 20 / the design parley (#671): mustard-as-brand
  // is replaced by palette v2 gold (#666a00 light / #d8dd3c dark) — economy semantics,
  // not a brand accent. All prior uses (pd-tui tokens, planner board, tokens.aaa.css)
  // were migrated in the same PR that added this entry.
  'FFDB33': { name: 'mustard brand (retired for palette v2 gold)', rgb: [255, 219, 51] },
}

// Quick pre-filter: does this file contain ANY forbidden content at all?
// Matches either the hex form or the first two rgb components together (e.g. "204,61" or "204, 61").
// The per-line check below is the authoritative test; this is just a fast skip.
const FORBIDDEN_QUICK_RE = new RegExp(
  '(?:' +
    // hex forms
    '#?(' + Object.keys(FORBIDDEN).join('|') + ')\\b' +
    '|' +
    // numeric rgb forms: match first two components to keep the pre-filter cheap
    Object.values(FORBIDDEN).map(({ rgb: [r, g] }) =>
      `${r}\\s*,\\s*${g}\\b`
    ).join('|') +
  ')',
  'i'
)

// Per-line detectors: one regex per forbidden color, matching both hex and rgb/rgba forms.
const LINE_DETECTORS = Object.entries(FORBIDDEN).map(([hex, { name, rgb: [r, g, b] }]) => {
  const hexPat   = '#?' + hex + '\\b'
  // numeric form: allow optional whitespace around commas, e.g. "204, 61, 46" or "204,61,46"
  const rgbPat   = `${r}\\s*,\\s*${g}\\s*,\\s*${b}\\b`
  const re       = new RegExp('(?:' + hexPat + '|' + rgbPat + ')', 'i')
  return { hex, name, re }
})

// Only scan text source we control. Skip binaries, the stable mirror checkout,
// and generated bundles.
const EXT = /\.(ts|tsx|js|jsx|mjs|cjs|css|scss|html|svg|md|mdx|sh|json|swift|rs|toml|yml|yaml)$/i
// The whitepaper TikZ figures (.tex) have their own dedicated guard,
// website-v2/scripts/check-figure-palette.mjs — exclude them here so the two
// guards don't fight over the same files across separate PRs.
// neobrutalism-pro-files/ documents an EXTERNAL design system whose brand token is
// #FFDB33 — reference material, not our tokens (same principle as the cinnabar
// ban-list exemption above).
const SKIP_DIR = /(^|\/)(node_modules|dist|build|\.git|neobrutalism-pro-files)(\/|$)|(^|\/)whitepaper\/|(^|\/)docs\/design\//
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
  // Fast skip: if neither hex nor numeric rgb triggers appear, move on
  if (!FORBIDDEN_QUICK_RE.test(text)) continue
  text.split('\n').forEach((line, i) => {
    for (const { hex, name, re } of LINE_DETECTORS) {
      if (re.test(line)) {
        violations.push(`${f}:${i + 1}  #${hex} (${name}) — ${line.trim().slice(0, 70)}`)
      }
    }
  })
}

if (violations.length) {
  console.error(`\n✗ brand-color guard: ${violations.length} retired off-brand color(s) found\n`)
  for (const v of violations) console.error('  ' + v)
  console.error('\nThe Harbor Heritage palette is retired (website-v2/docs/design/BRAND.md).')
  console.error('Both hex (#CC3D2E) and numeric rgb/rgba (204,61,46) forms are banned.')
  console.error('Use tokens.semantic.css: cobalt #003FB8, teal #006B5F, amber #A66F00, danger #BF2F2F.\n')
  process.exit(1)
}
console.log(`✓ brand-color guard: ${files.length} tracked files, no retired off-brand colors.`)
