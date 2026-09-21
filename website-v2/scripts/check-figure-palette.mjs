#!/usr/bin/env node
/**
 * check-figure-palette.mjs — the regression guard for whitepaper figure color.
 *
 * Every TikZ figure and whitepaper .tex must draw ONLY from a registered
 * palette: the Port Daddy brand/story palette or the exact Book semantic-block
 * edge registry.
 * This fails (exit 1) if it finds an off-brand hex, an off-brand color NAME
 * (cinnabar / brass / patina — the warm accents that kept creeping back), or an
 * accent whose contrast on the paper ground drops below the floor its role
 * requires.
 *
 * Brand source of truth: website-v2/src/styles/tokens.semantic.css (light theme).
 *
 * Three registered layers coexist in the TeX sources:
 *   hh*  — the first-edition figure palette (cobalt / deepened teal / deepened
 *          amber / mayday, all AAA as text on the cream ground);
 *   pd*  — the Book's semantic palette (story palette v2, one hue per meaning),
 *          declared once per source tree in figures/pd-palette.tex and kept in
 *          LOCKSTEP with the light tokens: this script fails if a pd* hex and
 *          its token disagree, or if the two committed copies differ.
 *   pdblock* — the Book's semantic-block edge inks, declared only in the two
 *          exact pd-semantic-blocks.tex mirrors and kept in lockstep with the
 *          separate --book-block-* CSS registry.
 *
 * The contrast pass recomputes every ink's WCAG 2.2 ratio against every ground
 * it can print on, rather than trusting a number somebody measured once. It
 * also re-derives the ratios BRAND.md states in prose, so a hue can no longer
 * be changed and leave a stale figure behind it.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { contrastRatio } from './wcag.mjs'

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
  '001489', // pdswissblue   — Swiss edition ink (print)  --print-swiss-blue
  '582C83', // pdswissviolet — Swiss edition ink (print)  --print-swiss-violet
  'DA291C', // pdswissred    — Swiss edition red (print)  --print-swiss-red
  '805A14', // pdmaritimegold — maritime edition trim (print) --print-maritime-gold
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
  pdswissblue: '--print-swiss-blue',
  pdswissviolet: '--print-swiss-violet',
  pdswissred: '--print-swiss-red',
  pdmaritimegold: '--print-maritime-gold',
}

// The Book's semantic-block helper is a deliberately separate palette. These
// colors are edge inks only: they are not Port Daddy brand colors and must not
// become a general-purpose TeX palette. Keep the file and role allow-list
// exact so an unrelated figure cannot smuggle in a new accent by reusing a
// familiar pdblock name.
const BOOK_BLOCK_FILES = [
  'whitepaper/figures/pd-semantic-blocks.tex',
  'website-v2/public/whitepaper/figures/pd-semantic-blocks.tex',
]
const BOOK_BLOCK_HEX = {
  pdblockProof: 'B33F35',
  pdblockProperty: '7048A5',
  pdblockHypothesis: '427A26',
  pdblockCalculation: '946000',
  pdblockInvariant: '233A76',
  pdblockDefinition: '3D454B',
  pdblockChecked: '006EA0',
  pdblockProtocol: '007D73',
  pdblockNeutral: '363B40',
}
const BOOK_BLOCK_TOKEN_LOCKSTEP = {
  pdblockProof: '--book-block-proof',
  pdblockProperty: '--book-block-property',
  pdblockHypothesis: '--book-block-hypothesis',
  pdblockCalculation: '--book-block-calculation',
  pdblockInvariant: '--book-block-invariant',
  pdblockDefinition: '--book-block-definition',
  pdblockChecked: '--book-block-checked',
  pdblockProtocol: '--book-block-protocol',
  pdblockNeutral: '--book-block-neutral',
}
const BOOK_BLOCK_FILE_SET = new Set(BOOK_BLOCK_FILES)
const BOOK_BLOCK_NAME_SET = new Set(Object.keys(BOOK_BLOCK_HEX))
// What each ink is allowed to be set as, and therefore the WCAG 2.2 floor it
// has to clear on every ground it can print on. `text` is normal-size body and
// label text (4.5:1); `large` is 18pt-and-up display, rules, dots, stripes and
// single marks (3:1); `nontext` is a ground or a fill that never carries type.
//
// Two inks are deliberately `large`, and both would fail as small text on the
// cream: amber #a66f00 at 3.71:1 (already the documented rule -- amber text
// uses --status-warning-on-tint) and the Swiss red #da291c at 4.21:1 on
// --surface-base, which is why the Swiss brief reserves it for "the single
// mark that must be seen" and not for setting words in.
const INK_ROLE = {
  '--brand-primary': 'text',
  '--brand-accent': 'text',
  '--story-health': 'text',
  '--story-indigo': 'text',
  '--story-violet': 'text',
  '--story-rust': 'text',
  '--story-gold': 'text',
  '--status-error': 'text',
  '--text-primary': 'text',
  '--text-secondary': 'text',
  '--status-warning': 'large',
  '--chart-yellow': 'nontext',   // highlight fill; ink text sits ON it
  '--surface-base': 'nontext',
  '--surface-raised': 'nontext',
  '--surface-strong': 'nontext',
  '--print-swiss-blue': 'text',
  '--print-swiss-violet': 'text',
  '--print-swiss-red': 'large',
  '--print-maritime-gold': 'text',
  // Book semantic-block inks are full-strength perimeter accents and never
  // carry body text. Their edge floor is checked against page, white, and the
  // helper's retained 2% color-on-white field.
  '--book-block-proof': 'edge',
  '--book-block-property': 'edge',
  '--book-block-hypothesis': 'edge',
  '--book-block-calculation': 'edge',
  '--book-block-invariant': 'edge',
  '--book-block-definition': 'edge',
  '--book-block-checked': 'edge',
  '--book-block-protocol': 'edge',
  '--book-block-neutral': 'edge',
}
const ROLE_FLOOR = { text: 4.5, large: 3.0, edge: 3.0 }
// Every ground an ink can actually land on: the page cream, the panel cream,
// and the plate paper, which is lighter than either and is the ground of the
// figure fragments.
//
// --surface-strong (pdcreamstrong, the inset well) is deliberately NOT here:
// it is declared in pd-palette.tex but no figure or chapter source fills with
// it, so nothing is set over it. It is the darkest cream and three story
// colours would fail AA on it (health 4.13:1, error 4.45:1, gold 4.50:1), so
// the day something does fill with it, that has to be a measured decision --
// which is what GROUND_ONLY_IF_UNUSED below forces.
const GROUNDS = [
  { name: '--surface-base', token: '--surface-base' },
  { name: '--surface-raised', token: '--surface-raised' },
  { name: 'plate paper', hex: 'FBF7EF' },
]
const GROUND_ONLY_IF_UNUSED = ['pdcreamstrong']
const BRAND_MD = join(REPO, 'website-v2', 'docs', 'design', 'BRAND.md')

const PD_PALETTE_COPIES = [
  join(REPO, 'website-v2', 'public', 'whitepaper', 'figures', 'pd-palette.tex'),
  join(REPO, 'whitepaper', 'figures', 'pd-palette.tex'),
]
// `--tokens <path>` points the guard at another token file. It exists so the
// contrast pass can be proved to FAIL: the test hands it a copy with one ink
// paled and expects exit 1. It is not for production use; the real file is
// the default and CI never passes the flag.
const tokensArg = process.argv.indexOf('--tokens')
const TOKENS_CSS = tokensArg > -1 && process.argv[tokensArg + 1]
  ? process.argv[tokensArg + 1]
  : join(REPO, 'website-v2', 'src', 'styles', 'tokens.semantic.css')

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
      for (const m of code.matchAll(/(?:provide|define)color\{([A-Za-z]+)\}\{HTML\}\{([0-9A-Fa-f]{6})\}/g)) {
        const name = m[1]
        const hex = m[2].toUpperCase()
        const exactBookDefinition = BOOK_BLOCK_FILE_SET.has(rel) &&
          BOOK_BLOCK_NAME_SET.has(name) && BOOK_BLOCK_HEX[name] === hex
        if (!ALLOWED_HEX.has(hex) && !exactBookDefinition) {
          const why = OFFENDERS[hex] ? ` (${OFFENDERS[hex]})` : ''
          violations.push(`${rel}:${i + 1}  off-brand hex #${hex}${why}`)
        }
      }
      // A Book semantic role is only legal inside its two committed helper
      // mirrors. This catches arbitrary direct uses even when the hex itself
      // happens to be one of the approved nine values.
      for (const name of BOOK_BLOCK_NAME_SET) {
        if (new RegExp(`\\b${name}\\b`).test(code) && !BOOK_BLOCK_FILE_SET.has(rel)) {
          violations.push(`${rel}:${i + 1}  Book semantic role ${name} is outside the exact semantic-block helper files`)
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

// xcolor's `color!2!white` field is a two-percent role ink mixed into white.
// The helper's border is full-strength, so measure that border against the
// actual generated field instead of treating the field as a generic cream.
function mixHex(foreground, background, foregroundShare) {
  const fg = foreground.match(/[0-9a-f]{2}/gi).map((x) => parseInt(x, 16))
  const bg = background.match(/[0-9a-f]{2}/gi).map((x) => parseInt(x, 16))
  return fg.map((value, i) => Math.round(value * foregroundShare + bg[i] * (1 - foregroundShare)))
    .map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase()
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

  // The semantic helper is not pd-palette.tex and therefore gets its own
  // exact registry. Both mirrors must contain exactly the approved role set,
  // the owner-approved values, and the CSS token values.
  const bookCopies = BOOK_BLOCK_FILES.map((relative) => ({
    relative,
    text: readFileSync(join(REPO, relative), 'utf8'),
  }))
  if (bookCopies[0].text !== bookCopies[1].text) {
    violations.push(`pd-semantic-blocks.tex drifted between ${BOOK_BLOCK_FILES[0]} and ${BOOK_BLOCK_FILES[1]} (must be byte-identical)`)
  }
  const bookDeclared = new Map()
  for (const m of bookCopies[0].text.matchAll(/\\definecolor\{(pdblock[A-Za-z]+)\}\{HTML\}\{([0-9A-Fa-f]{6})\}/g)) {
    if (bookDeclared.has(m[1])) violations.push(`Book semantic helper: duplicate \\definecolor{${m[1]}}`)
    bookDeclared.set(m[1], m[2].toUpperCase())
  }
  for (const [name, expected] of Object.entries(BOOK_BLOCK_HEX)) {
    const tex = bookDeclared.get(name)
    const token = BOOK_BLOCK_TOKEN_LOCKSTEP[name]
    const css = tokens.get(token)
    if (!tex) violations.push(`${BOOK_BLOCK_FILES[0]}: missing \\definecolor{${name}}`)
    else if (tex !== expected) violations.push(`Book palette: ${name} is #${tex} but the approved value is #${expected}`)
    if (!css) violations.push(`tokens.semantic.css: ${token} (for ${name}) not found in the light theme`)
    else if (css !== expected) violations.push(`lockstep: ${name} is #${expected} in the Book registry but ${token} is #${css} in tokens.semantic.css`)
  }
  for (const name of bookDeclared.keys()) {
    if (!(name in BOOK_BLOCK_HEX)) violations.push(`${BOOK_BLOCK_FILES[0]}: ${name} has no approved Book semantic role mapping`)
  }
} catch (error) {
  violations.push(`palette lockstep check could not run: ${error.message}`)
}

// 4) contrast: every ink clears the floor its role requires, on every ground.
try {
  const tokens = lightTokens(readFileSync(TOKENS_CSS, 'utf8'))
  const grounds = GROUNDS.map((g) => {
    const hex = g.hex ?? tokens.get(g.token)
    if (!hex) violations.push(`contrast: ground ${g.name} is not in the light theme`)
    return { ...g, hex }
  }).filter((g) => g.hex)

  for (const token of Object.values(PD_TOKEN_LOCKSTEP)) {
    const role = INK_ROLE[token]
    if (!role) {
      // A new ink reaching the lockstep without a declared role would otherwise
      // be measured against nothing at all, so this fails rather than skips.
      violations.push(`contrast: ${token} has no role in INK_ROLE (text / large / nontext)`)
      continue
    }
    const floor = ROLE_FLOOR[role]
    if (!floor) continue
    const hex = tokens.get(token)
    if (!hex) continue          // already reported by the lockstep pass
    for (const ground of grounds) {
      const ratio = contrastRatio(hex, ground.hex)
      if (ratio < floor) {
        violations.push(
          `contrast: ${token} #${hex.toLowerCase()} is ${ratio.toFixed(2)}:1 on ${ground.name} ` +
          `#${ground.hex.toLowerCase()} — below the ${floor}:1 floor for role "${role}"`)
      }
    }
  }

  // The Book's semantic colors are edge-only inks. Check their full-strength
  // perimeter against the white field and the exact retained 2% field used by
  // pd-semantic-blocks.tex, while the loop above checks the page grounds.
  for (const token of Object.values(BOOK_BLOCK_TOKEN_LOCKSTEP)) {
    const role = INK_ROLE[token]
    if (!role) {
      violations.push(`contrast: ${token} has no role in INK_ROLE (edge / nontext)`)
      continue
    }
    const floor = ROLE_FLOOR[role]
    const hex = tokens.get(token)
    if (!hex) continue
    const field = mixHex(hex, 'FFFFFF', 0.02)
    for (const ground of [
      { name: 'white field', hex: 'FFFFFF' },
      { name: '2% role field', hex: field },
    ]) {
      const ratio = contrastRatio(hex, ground.hex)
      if (ratio < floor) {
        violations.push(
          `contrast: ${token} #${hex.toLowerCase()} is ${ratio.toFixed(2)}:1 on ${ground.name} ` +
          `#${ground.hex.toLowerCase()} — below the ${floor}:1 floor for role "${role}"`)
      }
    }
  }

  // A cream that GROUNDS leaves out must stay unused as a fill; the moment a
  // figure paints with it, it becomes a ground and its inks need measuring.
  for (const dir of FIG_DIRS) {
    for (const file of walk(dir)) {
      const text = readFileSync(file, 'utf8')
      for (const name of GROUND_ONLY_IF_UNUSED) {
        if (new RegExp(`(?:fill|colorback|colorbox)\\s*[={]\\s*${name}\\b`).test(text)) {
          violations.push(
            `${file.replace(REPO + '/', '')}: fills with ${name}, which is not in GROUNDS — ` +
            `add it there and re-measure every ink against it before using it as a ground`)
        }
      }
    }
  }

  // Ratios written into BRAND.md prose are re-derived here, so a hue change
  // cannot leave a stale number behind. A claim naming a ground this script
  // cannot resolve fails rather than passing unmeasured.
  const brand = readFileSync(BRAND_MD, 'utf8')
  // Prose names for grounds, longest first so "plate paper" wins over "paper".
  const groundAlias = { 'plate paper': 'FBF7EF', cream: tokens.get('--surface-base') }
  let claims = 0
  for (const line of brand.split('\n')) {
    const inkMatch = line.match(/`(--[a-z0-9-]+)`\s*(?:\|\s*)?`?#([0-9a-fA-F]{6})`?/)
    // Find each claim, then read its ground out of the clause that follows:
    // a token in backticks, a literal hex, or a prose name groundAlias knows.
    // A clause naming none of those is reported rather than skipped.
    for (const m of line.matchAll(/(\d+\.\d+):1 on ([^,.)|]*)/g)) {
      claims += 1
      const [, stated, clause] = m
      if (!inkMatch) {
        violations.push(`BRAND.md: "${stated}:1" claim on a line with no ink token to measure`)
        continue
      }
      const inkHex = inkMatch[2].toUpperCase()
      const hexInClause = clause.match(/#([0-9a-fA-F]{6})/)
      const tokenInClause = clause.match(/`(--[a-z0-9-]+)`/)
      const aliasWord = Object.keys(groundAlias).find((w) => clause.includes(w))
      let ghex = hexInClause?.[1].toUpperCase()
      if (!ghex && tokenInClause) ghex = tokens.get(tokenInClause[1])
      if (!ghex && aliasWord) ghex = groundAlias[aliasWord]
      if (!ghex) {
        violations.push(`BRAND.md: cannot resolve the ground in "${stated}:1 on${clause}" — name it as a token or a hex`)
        continue
      }
      const actual = contrastRatio(inkHex, ghex)
      if (Math.abs(actual - Number(stated)) > 0.01) {
        violations.push(
          `BRAND.md: states ${stated}:1 for #${inkHex.toLowerCase()} on #${ghex.toLowerCase()}, ` +
          `measured ${actual.toFixed(2)}:1`)
      }
    }
  }
  if (claims === 0) {
    violations.push('BRAND.md: no contrast claims found to verify — has the palette table moved?')
  }
} catch (error) {
  violations.push(`contrast check could not run: ${error.message}`)
}

if (violations.length) {
  console.error(`\n✗ figure-palette guard: ${violations.length} violation(s)\n`)
  for (const v of violations) console.error('  ' + v)
  console.error('\nFigures must use ONLY the registered brand palette or the exact Book semantic-block edge registry (see website-v2/scripts/check-figure-palette.mjs).')
  console.error('cinnabar/brass/patina are banned. New accents require an explicit token, role, file scope, and measured contrast.\n')
  process.exit(1)
}
console.log('✓ figure-palette guard: all whitepaper figures use a registered palette; pd-palette.tex and Book semantic-block helpers match their light-token registries.')
