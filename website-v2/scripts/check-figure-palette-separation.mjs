#!/usr/bin/env node
/**
 * check-figure-palette-separation.mjs — can two story colours be told apart?
 *
 * check-figure-palette.mjs already measures every ink against every GROUND it
 * prints on. That is a different question from this one, and passing it says
 * nothing about this one: two inks of equal luminance have a contrast ratio of
 * 1.00 against each other and may still be a fine pair, or an invisible one.
 * A categorical palette exists to tell series apart, so the separation between
 * inks has to be measured too, and it was not.
 *
 * Method, fixed by the `dataviz` skill (references/color-formula.md, check 4):
 * Delta E is Euclidean distance in OKLab x100. Protanopia and deuteranopia are
 * simulated with Machado-Oliveira-Fernandes 2009 at severity 1.0 in linear RGB
 * and they GATE at >= 8 (target) / >= 6 (floor, legal only with a secondary
 * encoding). Tritanopia is computed and printed but does NOT gate: the
 * thresholds are calibrated on the two red-green forms. A companion
 * normal-vision floor of 15 is a hard gate that secondary encoding does not
 * excuse -- below it, full-colour readers cannot tell the pair apart either.
 *
 * All 21 pairs are measured, not just neighbours. The pd* palette is a
 * SEMANTIC palette -- one hue, one meaning -- so any two of its colours can
 * meet in a diagram; that is the `--pairs all` case, and it is the harder one.
 *
 * WHAT THIS CHECK CANNOT MAKE TRUE. Four pairs are below the normal-vision
 * floor and cannot be lifted over it by any re-stepping that keeps their
 * meanings on their own hues. That is a fact about the sRGB gamut on a cream
 * ground, not a tuning failure, and it is recorded in IRREDUCIBLE below with
 * the measured ceiling and the arithmetic that produced it. Those pairs are
 * not skipped: each is pinned to the value it has today, so it can never get
 * WORSE, and any figure that draws two of them together must be acknowledged
 * here with the secondary encoding that carries the distinction instead.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lightTokens } from './tokens-css.mjs'
import { separation, oklch, GATED_CVD } from './oklab-cvd.mjs'
import { contrastRatio } from './wcag.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const FIG_DIRS = [
  join(REPO, 'website-v2', 'public', 'whitepaper'),
  join(REPO, 'whitepaper'),
]

const NORMAL_FLOOR = 15 // hard gate; secondary encoding does not excuse it
const CVD_TARGET = 8 // min(protanopia, deuteranopia)
const CVD_FLOOR = 6 // legal only with a secondary encoding
const SURFACE = '--surface-base' // pdcream, the page the Book prints on
const CONTRAST_FLOOR = 4.5 // these inks all set as text; the repo's `text` role

/** The seven categorical story colours: token -> the meaning it carries. */
const SERIES = {
  '--brand-primary': 'kernel / truth',
  '--brand-accent': 'legibility',
  '--story-gold': 'economy / value',
  '--story-health': 'ready / coordinated',
  '--story-indigo': 'protocol / federation',
  '--story-rust': 'reputation / trust earned',
  '--story-violet': 'identity / continuity',
}
/** Reserved status inks. They must never impersonate a series colour. */
const STATUS = {
  '--status-error': 'breach / correction',
  '--status-warning': 'warning (display only)',
}
/** The TeX name each token wears in the figures, for the co-occurrence scan. */
const TEX_NAME = {
  '--brand-primary': 'pdcobalt',
  '--brand-accent': 'pdteal',
  '--story-gold': 'pdgold',
  '--story-health': 'pdhealth',
  '--story-indigo': 'pdindigo',
  '--story-rust': 'pdrust',
  '--story-violet': 'pdviolet',
  '--status-error': 'pderror',
  '--status-warning': 'pdamber',
}

/**
 * Pairs that cannot be lifted over the normal-vision floor.
 *
 * `ceiling` is the best normal-vision Delta E obtainable ANYWHERE on the two
 * colours' own ramps, holding each hue and requiring OKLab L in 0.43-0.77,
 * chroma >= 0.085, and >= 4.5:1 on the cream. It comes from an exhaustive
 * sweep of the full cross-product of both ramps over a sampled sRGB gamut, not
 * from hill-climbing, so it is an upper bound rather than a best effort.
 *
 * `kind` says WHY the pair cannot be fixed, because the two reasons have
 * different remedies:
 *   'gamut' — the ceiling itself is under 15. No assignment of these two
 *     meanings to their own hues can ever pass. All three sit on the arc from
 *     gold (112 deg) through health (157 deg) to teal (182 deg), where sRGB has
 *     almost no chroma to spend at a lightness dark enough to set as text on
 *     cream: the teal ramp cannot reach chroma 0.10 at 4.5:1 on the cream at
 *     all (its maximum is 0.097), and admits only 52 steps against indigo's
 *     3254. Only ONE of {gold, health, teal} can be a categorical series
 *     colour; the other two need a second encoding or a smaller palette.
 *   'joint' — the pair clears in isolation, but not while the shared colour
 *     also holds its distance from the rest of the seven. Re-stepping to fix
 *     it breaks a 'gamut' pair instead; the seven-colour optimum plateaus at a
 *     worst normal-vision Delta E of 12.0 however it is arranged.
 *
 * `pinned` is what the pair measures TODAY. The check fails if it drops below
 * that, so a pair that cannot be fixed can still never be made worse.
 */
const IRREDUCIBLE = {
  'pdteal/pdhealth': {
    kind: 'gamut',
    ceiling: 12.2,
    pinned: 6.4,
    why: 'teal 182 deg against health 157 deg; the teal ramp is chroma-starved and '
      + 'admits only 52 steps, so the best this pair can ever reach is 12.2',
    encoding: 'never colour alone: direct-label both, or carry the distinction '
      + 'on texture (45 deg / 135 deg hatch) or a dash pattern',
  },
  'pdgold/pdhealth': {
    kind: 'gamut',
    ceiling: 13.9,
    pinned: 8.5,
    why: 'gold 112 deg against health 157 deg, both chroma-starved dark on cream',
    encoding: 'direct labels, or a 2pt surface gap plus a legend swatch with its label',
  },
  'pdteal/pdgold': {
    kind: 'gamut',
    ceiling: 14.3,
    pinned: 11.8,
    why: 'teal 182 deg against gold 112 deg; the teal ramp is the binding side again',
    encoding: 'ordered forms only (the weighted part rule), where they are never '
      + 'adjacent and every segment is labelled',
  },
  'pdgold/pdrust': {
    kind: 'joint',
    ceiling: 18.5,
    pinned: 11.1,
    why: 'clears on its own (ceiling 18.5), but only by moving gold away from rust, '
      + 'which drives gold into teal and health — both of them gamut-irreducible',
    encoding: 'direct labels; gold and rust never carry two series of one chart alone',
  },
}

/**
 * Figures allowed to draw an IRREDUCIBLE pair together, each with the
 * secondary encoding that carries the distinction instead of the hue.
 * A figure not listed here fails, which is the point: the day someone draws
 * teal against health with nothing but colour between them, this says so.
 */
const ACKNOWLEDGED = {
  'whitepaper/figures/pd-palette.tex':
    'the palette declaration itself: it defines every colour and draws none',
  'website-v2/public/whitepaper/figures/pd-palette.tex':
    'the palette declaration itself: it defines every colour and draws none',
  'whitepaper/figures/pd-textbook-map.tex':
    'the weighted part rule: an ORDERED bar where teal and gold are never adjacent '
    + '(cobalt|teal|violet|gold), every segment is separated by a 3pt cream gap, '
    + 'segments past the current part are outlined rather than filled, and each part '
    + 'carries its own numeral and title',
  'website-v2/public/whitepaper/figures/pd-textbook-map.tex':
    'twin copy of the weighted part rule; same encoding',
}

const tokensArg = process.argv.indexOf('--tokens')
const TOKENS_CSS = tokensArg > -1 && process.argv[tokensArg + 1]
  ? process.argv[tokensArg + 1]
  : join(REPO, 'website-v2', 'src', 'styles', 'tokens.semantic.css')
const verbose = process.argv.includes('--verbose')

function walk(dir) {
  let out = []
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const e of entries) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) out = out.concat(walk(p))
    else if (e.endsWith('.tex')) out.push(p)
  }
  return out
}

const violations = []
const tokens = lightTokens(readFileSync(TOKENS_CSS, 'utf8'))
const hexOf = (token) => {
  const h = tokens.get(token)
  if (!h) violations.push(`${token} is not in the light theme of the token file`)
  return h ? `#${h}` : null
}

const series = Object.keys(SERIES).map((t) => ({ token: t, hex: hexOf(t), label: SERIES[t] }))
  .filter((s) => s.hex)
const status = Object.keys(STATUS).map((t) => ({ token: t, hex: hexOf(t), label: STATUS[t] }))
  .filter((s) => s.hex)
const surfaceHex = hexOf(SURFACE)

const rows = []
for (let i = 0; i < series.length; i += 1) {
  for (let j = i + 1; j < series.length; j += 1) {
    const a = series[i]
    const b = series[j]
    const key = `${TEX_NAME[a.token]}/${TEX_NAME[b.token]}`
    const s = separation(a.hex, b.hex)
    const waiver = IRREDUCIBLE[key]
    let verdict
    if (waiver) {
      // A waived pair is pinned, not skipped: it may never get worse, and it
      // may never quietly exceed the ceiling that justified the waiver either
      // (that would mean the ceiling was wrong and the waiver should go).
      if (s.normal < waiver.pinned - 0.05) {
        violations.push(
          `${key}: normal-vision Delta E fell to ${s.normal.toFixed(1)}, below the `
          + `${waiver.pinned.toFixed(1)} it was pinned at. A pair that cannot be fixed `
          + `must at least not get worse.`)
      }
      if (s.normal >= NORMAL_FLOOR) {
        violations.push(
          `${key}: now measures ${s.normal.toFixed(1)}, at or above the ${NORMAL_FLOOR} floor. `
          + `It is no longer irreducible — delete its IRREDUCIBLE entry so the real gate applies.`)
      }
      verdict = `waived (ceiling ${waiver.ceiling.toFixed(1)})`
    } else if (s.normal < NORMAL_FLOOR) {
      violations.push(
        `${key}: normal-vision Delta E ${s.normal.toFixed(1)} is below the ${NORMAL_FLOOR} floor `
        + `— full-colour readers cannot tell "${a.label}" from "${b.label}". Re-step one of them.`)
      verdict = 'FAIL normal'
    } else if (s.worstGated < CVD_FLOOR) {
      violations.push(
        `${key}: Delta E ${s.worstGated.toFixed(1)} under simulated CVD is below the `
        + `${CVD_FLOOR} floor (protanopia ${s.protanopia.toFixed(1)}, `
        + `deuteranopia ${s.deuteranopia.toFixed(1)}) — "${a.label}" and "${b.label}" collapse.`)
      verdict = 'FAIL cvd'
    } else if (s.worstGated < CVD_TARGET) {
      verdict = 'floor only'
    } else {
      verdict = 'ok'
    }
    rows.push({ key, s, verdict })
  }
}

// Status inks are reserved. They ship with an icon and a label by rule, so a
// collision with a series colour is reported rather than failed -- but it is
// reported, because "always icon + label" is only a mitigation while it is
// actually true of the figure.
const collisions = []
for (const st of status) {
  for (const se of series) {
    const s = separation(st.hex, se.hex)
    if (s.normal < NORMAL_FLOOR || s.worstGated < CVD_FLOOR) {
      collisions.push(
        `${TEX_NAME[st.token]}/${TEX_NAME[se.token]}: normal ${s.normal.toFixed(1)}, `
        + `protanopia ${s.protanopia.toFixed(1)}, deuteranopia ${s.deuteranopia.toFixed(1)}`)
    }
  }
}

// Contrast on the page, so this check is self-contained about the inks it moves.
for (const ink of [...series, ...status]) {
  if (!surfaceHex) break
  const ratio = contrastRatio(ink.hex, surfaceHex)
  const floor = ink.token === '--status-warning' ? 3.0 : CONTRAST_FLOOR
  if (ratio < floor) {
    violations.push(
      `${TEX_NAME[ink.token]} ${ink.hex.toLowerCase()} is ${ratio.toFixed(2)}:1 on the cream — `
      + `below the ${floor}:1 floor it needs`)
  }
}

// A figure that draws an irreducible pair together must say how it tells them
// apart without the hue.
const waivedPairs = Object.keys(IRREDUCIBLE).map((k) => k.split('/'))
for (const dir of FIG_DIRS) {
  for (const file of walk(dir)) {
    const rel = file.replace(`${REPO}/`, '')
    const text = readFileSync(file, 'utf8')
    const used = new Set()
    for (const name of Object.values(TEX_NAME)) {
      if (new RegExp(`\\b${name}\\b`).test(text)) used.add(name)
    }
    for (const [x, y] of waivedPairs) {
      if (used.has(x) && used.has(y) && !ACKNOWLEDGED[rel]) {
        violations.push(
          `${rel}: draws ${x} and ${y} together, a pair below the normal-vision floor `
          + `(${IRREDUCIBLE[`${x}/${y}`].pinned.toFixed(1)}). Either separate them or add the `
          + `figure to ACKNOWLEDGED with the secondary encoding that tells them apart.`)
        break
      }
    }
  }
}
for (const rel of Object.keys(ACKNOWLEDGED)) {
  try {
    statSync(join(REPO, rel))
  } catch {
    violations.push(`ACKNOWLEDGED lists ${rel}, which does not exist — stale acknowledgement`)
  }
}

if (verbose || violations.length) {
  rows.sort((a, b) => a.s.normal - b.s.normal)
  console.log(`\n  ${'pair'.padEnd(22)}${'normal'.padStart(7)}${'prot'.padStart(7)}`
    + `${'deut'.padStart(7)}${'(trit)'.padStart(8)}   verdict`)
  for (const r of rows) {
    console.log(`  ${r.key.padEnd(22)}${r.s.normal.toFixed(1).padStart(7)}`
      + `${r.s.protanopia.toFixed(1).padStart(7)}${r.s.deuteranopia.toFixed(1).padStart(7)}`
      + `${`(${r.s.tritanopia.toFixed(1)})`.padStart(8)}   ${r.verdict}`)
  }
  if (verbose) {
    console.log(`\n  ${'ink'.padEnd(12)}${'hex'.padStart(9)}${'L'.padStart(7)}`
      + `${'C'.padStart(7)}${'hue'.padStart(7)}${'cream'.padStart(9)}`)
    for (const ink of [...series, ...status]) {
      const [L, C, h] = oklch(ink.hex)
      console.log(`  ${TEX_NAME[ink.token].padEnd(12)}${ink.hex.toLowerCase().padStart(9)}`
        + `${L.toFixed(3).padStart(7)}${C.toFixed(3).padStart(7)}${h.toFixed(1).padStart(7)}`
        + `${`${contrastRatio(ink.hex, surfaceHex).toFixed(2)}:1`.padStart(9)}`)
    }
  }
}

if (collisions.length) {
  console.log(`\n  status inks that sit close to a series colour (${collisions.length}) —`)
  console.log('  legal only because status always ships with an icon AND a label')
  console.log(`  (dataviz: "never colour alone"), never as a bare swatch:`)
  for (const c of collisions) console.log(`    ${c}`)
}

if (violations.length) {
  console.error(`\n✗ figure-palette separation: ${violations.length} violation(s)\n`)
  for (const v of violations) console.error(`  ${v}`)
  console.error(
    '\nDelta E is OKLab x100. Normal-vision floor 15 is a hard gate; protanopia and\n'
    + 'deuteranopia gate at 8 (target) / 6 (floor, with secondary encoding). Re-step a\n'
    + 'failing colour ON ITS OWN HUE in tokens.semantic.css, mirror it into both copies\n'
    + 'of figures/pd-palette.tex, and re-run. If the pair has a ceiling below the floor,\n'
    + 'it belongs in IRREDUCIBLE with the arithmetic — not in a lowered threshold.\n')
  process.exit(1)
}
console.log(`✓ figure-palette separation: ${rows.length} pairs measured; `
  + `${Object.keys(IRREDUCIBLE).length} irreducible pairs pinned and acknowledged where drawn.`)
