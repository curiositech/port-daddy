#!/usr/bin/env node
/**
 * check-swiss-normalization.mjs — the Swiss visual-system RATCHET (Wave 0).
 *
 * The Book's Swiss edition draws with flat colour blocks, paper-coloured text
 * on them, square corners, no outlines, no elevation, every value from a
 * token. /whitepaper already renders that way; the rest of the site does not,
 * and nothing stopped it drifting further. This is that mechanism.
 *
 * It is a RATCHET, not a gate: about 90 of the 315 in-scope files violate at
 * least one rule today. A hard gate would fail every PR on day one and get
 * switched off within a week. This fails only on NEW drift (a file gaining a
 * violation it wasn't already carrying) or WORSENING drift (a listed file's
 * count going up) — and it also fails on a STALE entry, so a file cannot sit
 * in the allow-list forever after being cleaned up: the count can only ever
 * travel toward zero, and the build makes you say so when it does.
 *
 * Three rules, one scan, one ratchet file (not three near-identical scripts —
 * see swiss-normalization-ratchet.json next to this file):
 *
 *   R1 literal — no colour value outside the token layers (hex6/hex8, or an
 *                rgb/rgba/hsl/hsla/oklch/oklab/lab/lch function).
 *   R2 radius  — square corners (no `rounded-*` Tailwind class, no
 *                `border-radius` in CSS).
 *   R3 flat    — no elevation, no blur, no gradient (`shadow-*`,
 *                `drop-shadow-*`, `box-shadow`, `backdrop-blur`,
 *                `bg-gradient-*`, `linear-/radial-/conic-gradient`).
 *
 * Scope: website-v2/src/components/** and website-v2/src/pages/**, *.tsx /
 * *.ts / *.css only. website-v2/src/styles/** (the token layers themselves),
 * public/, docs/design/, node_modules, and anything path-matching
 * `.generated.` or `__generated__/` are never read.
 *
 * Escape hatch: a single violation may be suppressed by a same-line or
 * line-above comment of the exact shape
 *   swiss-allow: <rule> — <reason, at least 12 characters>
 * A malformed one (missing rule, missing/short reason) does NOT suppress and
 * is itself a build failure — the hatch cannot become a silent mute.
 *
 * `--root <dir>` and `--ratchet <path>` exist only so tests can point this at
 * a fixture tree instead of the real one; CI never passes them. `--json`
 * dumps the current per-file counts (the shape swiss-normalization-ratchet.json
 * takes) instead of doing the ratchet comparison — it's how the ratchet
 * itself gets (re)generated when a wave of cleanup earns an update; CI never
 * passes it either.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = join(HERE, '..') // website-v2/

function argVal(flag, fallback) {
  const i = process.argv.indexOf(flag)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const ROOT = resolve(argVal('--root', DEFAULT_ROOT))
const RATCHET_PATH = resolve(argVal('--ratchet', join(ROOT, 'scripts', 'swiss-normalization-ratchet.json')))
const RULES = ['literal', 'radius', 'flat']

// ---------------------------------------------------------------------------
// File discovery — scoped to exactly the two directories the spec names.
// ---------------------------------------------------------------------------

const EXT_RE = /\.(tsx|ts|css)$/
const EXCLUDE_RE = /(^|\/)__generated__(\/|$)|\.generated\./
const SKIP_DIR_NAMES = new Set(['node_modules', '__generated__'])

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
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      if (SKIP_DIR_NAMES.has(e)) continue
      out = out.concat(walk(p))
    } else if (EXT_RE.test(e)) {
      out.push(p)
    }
  }
  return out
}

function toRel(absPath) {
  return relative(ROOT, absPath).split(sep).join('/')
}

const SCOPE_DIRS = [join(ROOT, 'src', 'components'), join(ROOT, 'src', 'pages')]
const inScopeFiles = SCOPE_DIRS.flatMap(walk)
  .map((p) => ({ abs: p, rel: toRel(p) }))
  .filter(({ rel }) => !EXCLUDE_RE.test(rel))

// ---------------------------------------------------------------------------
// Comment stripping — blank out comment BODIES (same length, newlines kept)
// so line numbers stay accurate and a colour/class word that only lives in a
// comment cannot trip a detector. String literals are left intact: that is
// exactly where Tailwind class lists and CSS-in-JS colour values live.
//
// Deliberately simple (line/char scanning, not a real parser) — same level of
// rigor the sibling guards use (check-figure-palette.mjs strips TeX `%...`
// comments the same way). `//` is only treated as a comment starter outside
// CSS, and only outside a string, so `href="https://…"` is never mistaken for
// a line comment.
// ---------------------------------------------------------------------------

function stripComments(text, isCss) {
  let out = ''
  let state = 'code' // 'code' | 'line' | 'block' | 'str'
  let strCh = ''
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]
    const c2 = text[i + 1]
    if (state === 'line') {
      if (c === '\n') {
        out += c
        state = 'code'
      } else {
        out += ' '
      }
      continue
    }
    if (state === 'block') {
      if (c === '*' && c2 === '/') {
        out += '  '
        i += 1
        state = 'code'
      } else if (c === '\n') {
        out += '\n'
      } else {
        out += ' '
      }
      continue
    }
    if (state === 'str') {
      out += c
      if (c === '\\' && i + 1 < text.length) {
        out += text[i + 1]
        i += 1
        continue
      }
      if (c === strCh) state = 'code'
      continue
    }
    // state === 'code'
    if (!isCss && c === '/' && c2 === '/') {
      out += '  '
      i += 1
      state = 'line'
      continue
    }
    if (c === '/' && c2 === '*') {
      out += '  '
      i += 1
      state = 'block'
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      state = 'str'
      strCh = c
      out += c
      continue
    }
    out += c
  }
  return out
}

// ---------------------------------------------------------------------------
// R1 literal — colour values, with the anchor/URL false-positive suppression.
// ---------------------------------------------------------------------------

const HEX_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6})\b/g
const COLOR_FN_RE = /\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(/g
const URLISH_ATTR_RE = /^(?:href|to|id|aria-controls)$/

// Find every quoted span (single/double/backtick) on a line: {start, end}
// are offsets of the content between the quotes (end exclusive).
function quotedSpans(line) {
  const spans = []
  let i = 0
  while (i < line.length) {
    const c = line[i]
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1
      while (j < line.length) {
        if (line[j] === '\\') {
          j += 2
          continue
        }
        if (line[j] === c) break
        j += 1
      }
      spans.push({ quoteStart: i, start: i + 1, end: j })
      i = j + 1
    } else {
      i += 1
    }
  }
  return spans
}

function attrNameBefore(line, quoteStart) {
  let i = quoteStart - 1
  while (i >= 0 && /[\s{]/.test(line[i])) i -= 1
  if (line[i] !== '=') return null
  i -= 1
  while (i >= 0 && /\s/.test(line[i])) i -= 1
  const end = i + 1
  while (i >= 0 && /[A-Za-z-]/.test(line[i])) i -= 1
  return line.slice(i + 1, end) || null
}

function isUrlishSuppressed(line, matchIndex) {
  for (const span of quotedSpans(line)) {
    if (matchIndex < span.start || matchIndex >= span.end) continue
    const attr = attrNameBefore(line, span.quoteStart)
    if (attr && URLISH_ATTR_RE.test(attr)) return true
    const content = line.slice(span.start, span.end)
    const offsetInSpan = matchIndex - span.start
    const slashIdx = content.indexOf('//')
    if (slashIdx > -1 && slashIdx < offsetInSpan) return true
    return false
  }
  return false
}

function detectLiteral(codeLines) {
  const hits = []
  codeLines.forEach((line, idx) => {
    for (const m of line.matchAll(HEX_RE)) {
      if (!isUrlishSuppressed(line, m.index)) hits.push({ line: idx + 1, text: m[0] })
    }
    for (const m of line.matchAll(COLOR_FN_RE)) {
      if (!isUrlishSuppressed(line, m.index)) hits.push({ line: idx + 1, text: m[0] })
    }
  })
  return hits
}

// ---------------------------------------------------------------------------
// R2 radius / R3 flat — Tailwind class-token matching + CSS property matching
// ---------------------------------------------------------------------------

// A "segment" of a Tailwind class fragment after the base name: either a
// bracketed arbitrary value `-[...]` (any content but `]`, so
// `shadow-[0_4px_8px_rgba(0,0,0,.1)]` still matches in full) or a plain
// alnum/%/. run (`-lg`, `-2xl`, `-t-lg` via repeated segments).
const SEGMENT = '(?:-(?:\\[[^\\]]*\\]|[a-zA-Z0-9%.]+))'

function classTokenRegex(base, requireSuffix) {
  const escaped = base.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
  const suffix = requireSuffix ? `${SEGMENT}+` : `${SEGMENT}*`
  // Preceded by a quote, backtick, space, `{`, or start of line; followed by
  // a class terminator (quote, backtick, `}`, space) or end of line — never
  // mid-identifier (`surroundedBox`, `roundedValue`) and never bare prose.
  return new RegExp(`(?<=["'\`{\\s]|^)${escaped}${suffix}(?=["'\`}\\s]|$)`, 'g')
}

function findClassTokens(codeLines, base, requireSuffix) {
  const re = classTokenRegex(base, requireSuffix)
  const hits = []
  codeLines.forEach((line, idx) => {
    for (const m of line.matchAll(re)) hits.push({ line: idx + 1, text: m[0] })
  })
  return hits
}

function isAllZero(value) {
  const tokens = value
    .replace(/!important/i, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (tokens.length === 0) return false
  return tokens.every((t) => /^0(?:px|%|em|rem|vh|vw)?$/i.test(t))
}

function findCssProperty(codeLines, property, isNoop) {
  const re = new RegExp(`\\b${property}\\s*:\\s*([^;{}\\n]+)`, 'g')
  const hits = []
  codeLines.forEach((line, idx) => {
    for (const m of line.matchAll(re)) {
      if (isNoop(m[1])) continue
      hits.push({ line: idx + 1, text: m[0].trim() })
    }
  })
  return hits
}

function findFunctionCall(codeLines, name) {
  const re = new RegExp(`\\b${name}\\(`, 'g')
  const hits = []
  codeLines.forEach((line, idx) => {
    for (const m of line.matchAll(re)) hits.push({ line: idx + 1, text: m[0] })
  })
  return hits
}

function detectRadius(codeLines) {
  return [
    ...findClassTokens(codeLines, 'rounded', false),
    ...findCssProperty(codeLines, 'border-radius', isAllZero),
  ]
}

function detectFlat(codeLines) {
  const shadowNone = (v) => v.replace(/!important/i, '').trim().toLowerCase() === 'none'
  return [
    ...findClassTokens(codeLines, 'shadow', true).filter((h) => h.text !== 'shadow-none'),
    ...findClassTokens(codeLines, 'drop-shadow', true),
    ...findClassTokens(codeLines, 'backdrop-blur', false),
    ...findClassTokens(codeLines, 'bg-gradient', true),
    ...findCssProperty(codeLines, 'box-shadow', shadowNone),
    ...findFunctionCall(codeLines, 'linear-gradient'),
    ...findFunctionCall(codeLines, 'radial-gradient'),
    ...findFunctionCall(codeLines, 'conic-gradient'),
  ]
}

const DETECTORS = { literal: detectLiteral, radius: detectRadius, flat: detectFlat }

// ---------------------------------------------------------------------------
// Escape hatch — `swiss-allow: <rule> — <reason, >=12 chars>` on the same
// line or the line immediately above. Found against the RAW text (it lives
// inside a comment, which stripComments() has already blanked out of the
// text the detectors see). Malformed hatches are collected as their own
// failure rather than silently ignored.
// ---------------------------------------------------------------------------

const HATCH_PRESENT_RE = /swiss-allow\b.*$/
const HATCH_WELLFORMED_RE = /^swiss-allow\s*:\s*([A-Za-z]+)\s*(?:—|-)\s*(.+)$/

function scanEscapeHatch(rawLines, rel) {
  const allowMap = new Map() // 0-based line index -> Set(rule)
  const errors = []
  rawLines.forEach((line, idx) => {
    const found = line.match(HATCH_PRESENT_RE)
    if (!found) return
    const clause = found[0].trim()
    const wellformed = clause.match(HATCH_WELLFORMED_RE)
    const rule = wellformed?.[1]?.toLowerCase()
    const reason = wellformed?.[2]?.trim() ?? ''
    if (wellformed && RULES.includes(rule) && reason.length >= 12) {
      if (!allowMap.has(idx)) allowMap.set(idx, new Set())
      allowMap.get(idx).add(rule)
    } else {
      errors.push(
        `${rel}:${idx + 1}  malformed swiss-allow (needs 'swiss-allow: <literal|radius|flat> — <reason, at least 12 characters>'): ${clause.slice(0, 90)}`
      )
    }
  })
  return { allowMap, errors }
}

function isHatchSuppressed(allowMap, lineIdx0, rule) {
  return Boolean(allowMap.get(lineIdx0)?.has(rule)) || Boolean(allowMap.get(lineIdx0 - 1)?.has(rule))
}

// ---------------------------------------------------------------------------
// Per-file scan
// ---------------------------------------------------------------------------

function scanFile({ abs, rel }) {
  const raw = readFileSync(abs, 'utf8')
  const isCss = abs.endsWith('.css')
  const code = stripComments(raw, isCss)
  const rawLines = raw.split('\n')
  const codeLines = code.split('\n')

  const { allowMap, errors: hatchErrors } = scanEscapeHatch(rawLines, rel)

  const counts = {}
  const details = {}
  for (const rule of RULES) {
    const raw2 = DETECTORS[rule](codeLines)
    const kept = raw2.filter((hit) => !isHatchSuppressed(allowMap, hit.line - 1, rule))
    if (kept.length) {
      counts[rule] = kept.length
      details[rule] = kept
    }
  }
  return { rel, counts, details, hatchErrors }
}

// ---------------------------------------------------------------------------
// Ratchet comparison
// ---------------------------------------------------------------------------

function loadRatchet(path) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    console.error(`swiss-normalization guard: cannot read ratchet at ${path}`)
    process.exit(2)
  }
  let data
  try {
    data = JSON.parse(text)
  } catch (e) {
    console.error(`swiss-normalization guard: ratchet at ${path} is not valid JSON: ${e.message}`)
    process.exit(2)
  }
  for (const rule of RULES) {
    if (typeof data[rule] !== 'object' || data[rule] === null || Array.isArray(data[rule])) {
      console.error(`swiss-normalization guard: ratchet missing object "${rule}"`)
      process.exit(2)
    }
  }
  return data
}

function main() {
  const perFile = inScopeFiles.map(scanFile)

  if (process.argv.includes('--json')) {
    const dump = { literal: {}, radius: {}, flat: {} }
    for (const f of perFile) {
      for (const rule of RULES) {
        if (f.counts[rule]) dump[rule][f.rel] = f.counts[rule]
      }
    }
    console.log(JSON.stringify(dump, null, 2))
    return
  }

  const ratchet = loadRatchet(RATCHET_PATH)
  const byRel = new Map(perFile.map((f) => [f.rel, f]))

  const failures = []
  const hatchErrors = perFile.flatMap((f) => f.hatchErrors)

  const currentTotals = { literal: 0, radius: 0, flat: 0 }
  const currentFileCounts = { literal: 0, radius: 0, flat: 0 }
  const cleanFileCandidates = new Set(inScopeFiles.map((f) => f.rel))

  for (const rule of RULES) {
    const ratchetEntries = ratchet[rule]
    const currentEntries = new Map()
    for (const f of perFile) {
      const n = f.counts[rule] ?? 0
      if (n > 0) currentEntries.set(f.rel, n)
    }

    // Condition 1: new drift — a violating file this rule's ratchet doesn't list.
    for (const [rel, n] of currentEntries) {
      if (!(rel in ratchetEntries)) {
        cleanFileCandidates.delete(rel)
        const f = byRel.get(rel)
        for (const hit of f.details[rule]) {
          failures.push(
            `NEW DRIFT  ${rel}:${hit.line}  [${rule}]  ${hit.text}\n` +
              `  not listed in swiss-normalization-ratchet.json for rule "${rule}" — ` +
              `either fix it, or if it is a genuine system primitive, suppress it with a ` +
              `'swiss-allow: ${rule} — <reason>' comment.`
          )
        }
        void n
      }
    }

    // Conditions 2 & 3: worsening / stale, for every file the ratchet lists.
    for (const [rel, recorded] of Object.entries(ratchetEntries)) {
      const now = currentEntries.get(rel) ?? 0
      if (now > 0) cleanFileCandidates.delete(rel)
      if (now > recorded) {
        failures.push(`WORSENING  ${rel}  [${rule}]  was ${recorded}, now ${now}`)
      } else if (now < recorded) {
        failures.push(
          `STALE  ${rel}  [${rule}]  ratchet is stale: ${rel} is now ${now} (was ${recorded}); ` +
            `update website-v2/scripts/swiss-normalization-ratchet.json`
        )
      }
    }

    currentTotals[rule] = [...currentEntries.values()].reduce((a, b) => a + b, 0)
    currentFileCounts[rule] = currentEntries.size
  }

  const totalFiles = inScopeFiles.length
  const cleanFiles = cleanFileCandidates.size
  const pctClean = totalFiles === 0 ? 100 : (100 * cleanFiles) / totalFiles

  const allFailures = [...hatchErrors, ...failures]

  console.log('Swiss normalization guard — remaining drift (ratchet, not a gate):')
  for (const rule of RULES) {
    console.log(`  ${rule.padEnd(8)} ${currentTotals[rule]} occurrence(s) across ${currentFileCounts[rule]} file(s)`)
  }
  console.log(`  ${totalFiles} in-scope files scanned, ${cleanFiles} clean (${pctClean.toFixed(1)}% of in-scope files clean)`)

  if (allFailures.length) {
    console.error(`\n✗ swiss-normalization guard: ${allFailures.length} failure(s)\n`)
    for (const f of allFailures) console.error('  ' + f + '\n')
    console.error(
      'This is a ratchet: new or worsening drift fails the build, and a file cleaned up must have\n' +
        'its ratchet entry updated in the same PR (that is what keeps the list honest).\n'
    )
    process.exit(1)
  }

  console.log('\n✓ swiss-normalization guard: no new or worsening drift, ratchet is current.')
}

main()
