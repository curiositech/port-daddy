#!/usr/bin/env node
/**
 * check-orphan-assets.mjs — which committed asset files are referenced by NOTHING?
 *
 * WHY THIS EXISTS
 *   PR #10171 deleted 147 asset files and proved each one dead by a human running a
 *   repo-wide grep. The proof was correct and it is unreproducible: nobody can re-run
 *   it, CI never checked it, and the next cleanup redoes the same manual work with the
 *   same chance of missing a reference. `docs/harbor-research/WHITEPAPER-TREE-CONSOLIDATION.md`
 *   then schedules a sequence of file MOVES, where a missed reference does not leave a
 *   dead file behind — it silently breaks a live one. This makes the reference scan
 *   mechanical, so a cleanup PR can quote a command instead of a recollection.
 *
 * THE INVERSE OF THE GUARDS THAT ALREADY EXIST — read this before adding a fifth:
 *   - `scripts/check-doc-citations.mjs` asks "does every path CITED IN PROSE exist?"
 *   - `website-v2/src/site-integrity.test.ts` asks "does every asset literal in the
 *     site's source point at a file that exists?"
 *   - `scripts/harbor-research/check_plate_provenance.py` asks "does every plate carry
 *     a provenance entry, and does every TeX plate path resolve?"
 *   - `scripts/harbor-research/check_citations.py` asks "does every \cite have a
 *     \bibitem?" (bibliography keys, not file paths).
 *   All four run reference → file. NONE of them runs file → reference. A file nothing
 *   points at is invisible to every one of them, which is exactly why 147 of them
 *   accumulated. This script is the missing direction and adds no new opinion about
 *   the ones above.
 *
 * WHAT REACHABILITY MEANS HERE
 *   An asset is REFERENCED if some scanned source file contains a token that resolves
 *   to it. The hard part is that this repository does not spell most of its asset paths
 *   out in full:
 *     - JS/TS template literals:  `/whitepaper/plates/chapter-${chapter.prefix}.jpg`
 *     - LaTeX macro parameters:   \includegraphics{plates/swiss/chapter-#1.jpg}
 *     - Python f-strings:         f'{PLATES}/{slug}.jpg'
 *     - Shell variables:          "$PLATES/cover.jpg"
 *     - Extension-less TeX:       \input{figures/fig-foo}
 *   A naive literal-string grep misses every one of them. Reporting "orphan" for a
 *   plate the Book prints on its own part-title page, or that the site loads every page
 *   view, is worse than no checker at all — it trains the reader to ignore the output.
 *   So a token carrying a placeholder is compiled to a path-segment wildcard and matched
 *   as a pattern, and a token is matched against every path SUFFIX of an asset, not only
 *   its full repo path.
 *
 * ISLANDS (advisory, never gated)
 *   A reference count alone would have called 14 of PR #10171's deletions live: a
 *   proof-manifest.md was the sole referrer of the art it documented, and the
 *   manifest was as dead as the art. So the report also names assets cited ONLY by
 *   markdown that nothing else reaches. Measured against that PR: the check names
 *   126 of its 140 asset deletions as outright orphans and 13 more as islands, 139
 *   of 140 in total.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *   It does not decide whether an unreferenced file should be deleted. Deletion is a
 *   separate judgement with a separate review — some orphans are deliberate (a published
 *   PDF a reader downloads by URL, a favicon the platform fetches by convention). Report
 *   mode names them; `--check` fails only inside a small deny-list of directories where
 *   an orphan is a defect by construction, and an allow-list carries a REASON per entry
 *   for the rest. An over-eager gate that fails main on a legitimately-unreferenced file
 *   gets disabled within a week and then protects nothing.
 *
 * Usage:
 *   node scripts/check-orphan-assets.mjs              # report (default): grouped, with sizes
 *   node scripts/check-orphan-assets.mjs --check      # fail on orphans in the deny-list dirs
 *   node scripts/check-orphan-assets.mjs --json       # machine-readable report
 *   node scripts/check-orphan-assets.mjs --why <path> # explain one asset's verdict
 *   node scripts/check-orphan-assets.mjs --root <dir> # scan a sandbox tree (tests)
 *
 * Exit codes: 0 clean / report produced. 1 --check found a gated orphan, or the
 * allow-list is malformed (an entry without a reason is itself a failure).
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync, existsSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SELF = 'check-orphan-assets'
const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// ── What counts as an asset ────────────────────────────────────────────────────
// Scoped to classes where an orphan is a real defect AND reachability is decidable
// by reference-scanning: something renders it, prints it, or serves it, and that
// act leaves a path in a source file. Deliberately excludes source code, data
// files, and fonts (reached by CSS `@font-face` indirection and by the platform).
const ASSET_EXTS = [
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'ico', 'tif', 'tiff', 'bmp',
  'pdf',
  'mp4', 'mov', 'webm', 'm4v',
]

// Asset trees in scope: the documentation and site trees. Everything else
// (core/, apps/, skills/, demos/ …) is out of scope for now, not because those
// trees cannot hold orphans but because this check earns its keep one tree at a
// time and a report nobody reads is the same as no report.
const ASSET_ROOTS = [
  'docs/',
  'website-v2/public/',
  'website-v2/docs/',
  'website-v2/screenshots/',
  'whitepaper/',
]

// ── Where references can live ──────────────────────────────────────────────────
// The extension set PR #10171's manual scan used, plus the few text formats this
// repo also constructs paths in. Widening this list can only turn an orphan into a
// referenced file, never the reverse, so erring wide is the safe direction.
const SCAN_EXTS = new Set([
  'tex', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'sh', 'bash', 'py', 'json',
  'md', 'mdx', 'css', 'scss', 'yml', 'yaml', 'html', 'htm', 'xml', 'svg',
  'txt', 'toml', 'rs', 'astro', 'vue', 'swift',
])

// Generated or vendored trees: a hit inside one of these is a copy of a reference
// that lives in source, never the reference itself. Counting them would let a
// stale build output keep a dead asset alive.
const SKIP_DIRS = [
  'node_modules/', 'dist/', 'build/', 'out/', 'coverage/', '.git/', '.cache/',
  '.claude/worktrees/', '.codex/', 'target/', '.next/', '.venv/', '__pycache__/',
]

// ── The gate ───────────────────────────────────────────────────────────────────
// Directories where an orphan is a defect BY CONSTRUCTION, so `--check` fails on
// one. Each entry has to survive the question "would a legitimately-unreferenced
// file ever land here?" — if yes, it does not belong in this list. Kept short on
// purpose; see DENY_REASONS for the argument per entry.
const DENY_DIRS = [
  'website-v2/public/whitepaper/plates/',
  'website-v2/public/whitepaper/figures/',
  'whitepaper/figures/',
]
const DENY_REASONS = {
  'website-v2/public/whitepaper/plates/':
    'every plate exists to be printed by a Book edition or shown by the site; ' +
    'check_plate_provenance.py already fails a plate with no provenance entry, so a ' +
    'plate that reaches neither a TeX \\includegraphics nor a site literal is a render ' +
    'that was never wired up',
  'website-v2/public/whitepaper/figures/':
    'a figure fragment is reached by \\input from a chapter or paper; one nothing ' +
    '\\inputs prints nowhere in any edition',
  'whitepaper/figures/':
    'same contract as the site copy of the figure tree, and the consolidation plan ' +
    'moves files between the two — a move that drops the last \\input is exactly the ' +
    'failure this gate is for',
}

const ALLOW_FILE = 'scripts/orphan-assets-allow.json'

// This check must not vouch for a file using its OWN paperwork. The allow-list
// names the very assets it excuses, and the test file names synthetic fixture
// paths that collide with real ones; scanned as ordinary sources they would mark
// those assets "referenced" and turn the gate into a no-op for exactly the files
// someone had to justify. Caught by the allow-list unit test, which failed until
// this list existed.
const SELF_FILES = new Set([ALLOW_FILE, 'scripts/check-orphan-assets.test.mjs'])

// The one runtime path-derivation this repo does that no scan can see; see the
// `derived-dark-sibling` rule in evidence().
const THEMED_IMAGE_SRC = 'website-v2/src/components/site/ThemedImageSrc.ts'

// ── Placeholder grammar ────────────────────────────────────────────────────────
// Every way this repo interpolates a path segment. Each compiles to `[^/]*`: a
// placeholder stands for part of ONE segment, never a directory boundary, so
// `chapter-${prefix}.jpg` cannot silently claim `chapter-a/b.jpg`.
const PLACEHOLDER_RE =
  /\$\{[^}]*\}|\$\([^)]*\)|\{\{[^}]*\}\}|\{[^}/]*\}|<[^>/]*>|#\d|\$[A-Za-z_][A-Za-z0-9_]*|\\[A-Za-z@]+|%[sd]|\*+/g

/** Minimum literal (non-placeholder, non-extension) characters a pattern needs.
 *  `${slug}.jpg` compiles to "any jpg anywhere", which would mark every jpg in the
 *  repo referenced and quietly turn this script into a no-op. Such a pattern is
 *  dropped and counted, and report mode prints the count. */
const MIN_PATTERN_STEM = 3

function sh(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
}

function tracked(root) {
  return sh('git', ['ls-files', '-z'], root).split('\0').filter(Boolean)
}

const extOf = (p) => {
  const i = p.lastIndexOf('.')
  return i === -1 ? '' : p.slice(i + 1).toLowerCase()
}
const skipped = (p) => SKIP_DIRS.some((d) => p.startsWith(d) || p.includes('/' + d))
const inAssetRoots = (p) => ASSET_ROOTS.some((r) => p.startsWith(r))

/**
 * A FIGURE FRAGMENT: a `.tex` file inside a `figures/` directory. These are assets
 * in every sense that matters here — a fragment exists to be `\input` by a chapter
 * or paper, and one nothing inputs prints in no edition — but a `.tex` file in
 * general is not: the chapter sources and the standalone papers one directory up
 * are ENTRY POINTS, compiled directly, and nothing in the repo references them by
 * path. The `figures/` directory is what separates the two, and it is how both
 * whitepaper trees are actually laid out.
 */
const isFigureFragment = (p) =>
  extOf(p) === 'tex' && (p.includes('/figures/') || p.startsWith('figures/'))

const isAsset = (p) => (ASSET_EXTS.includes(extOf(p)) || isFigureFragment(p)) && inAssetRoots(p)

/** Every path suffix of `p` cut at a `/` boundary, longest first.
 *  `a/b/c.png` → ['a/b/c.png', 'b/c.png', 'c.png']. A reference that names only
 *  `c.png`, or only `b/c.png`, still reaches the file. */
function suffixes(p) {
  const out = []
  const parts = p.split('/')
  for (let i = 0; i < parts.length; i++) out.push(parts.slice(i).join('/'))
  return out
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Compile a placeholder-bearing token into an anchored suffix regex, or null if
 *  its literal stem is too thin to mean anything. */
function compilePattern(token) {
  let stem = 0
  for (const chunk of token.split(PLACEHOLDER_RE)) {
    stem += chunk.replace(/[^A-Za-z0-9]/g, '').length
  }
  // The extension itself is not stem: `${x}.jpg` must not qualify on "jpg" alone.
  stem -= extOf(token).length
  if (stem < MIN_PATTERN_STEM) return null

  let src = ''
  let last = 0
  PLACEHOLDER_RE.lastIndex = 0
  for (const m of token.matchAll(PLACEHOLDER_RE)) {
    src += escapeRe(token.slice(last, m.index)) + '[^/]*'
    last = m.index + m[0].length
  }
  src += escapeRe(token.slice(last))
  try {
    return new RegExp('^' + src + '$', 'i')
  } catch {
    return null
  }
}

const hasPlaceholder = (t) => {
  PLACEHOLDER_RE.lastIndex = 0
  return PLACEHOLDER_RE.test(t)
}

/** Strip the noise that wraps a path in real source: quotes, parens, markdown
 *  syntax, trailing punctuation, a leading `./` or `/`. */
function normalizeToken(raw) {
  let t = raw.trim()
  // A TeX command name swallowed into the front of the token: the character class
  // that finds path-ish runs admits `{`, so `\IfFileExists{plates/swiss/cover.jpg}`
  // arrives here as `IfFileExists{plates/…`. Drop the command and its brace. (The
  // `${…}` and `{…}` placeholder forms never start with bare letters, so they are
  // untouched.)
  t = t.replace(/^[A-Za-z@]+\{/, '')
  t = t.replace(/^[`'"(<[{|]+/, '').replace(/[`'"),>\]|]+$/, '')
  t = t.replace(/[.,;:!?]+$/, '')
  t = t.replace(/^\.\//, '').replace(/^\/+/, '')
  t = t.replace(/\\_/g, '_') // LaTeX-escaped underscore in a path
  return t
}

const ASSET_EXT_ALT = ASSET_EXTS.join('|')
// A path-ish run of characters ending in an asset extension. The character class
// admits the placeholder punctuation above so an interpolated path survives as one
// token instead of being cut in half at the `$`.
const TOKEN_RE = new RegExp(
  `[A-Za-z0-9_~@+%*.\\-/\\$\\{\\}\\(\\)<>#]*\\.(?:${ASSET_EXT_ALT})\\b`,
  'gi',
)
// Extension-less TeX inclusion: \includegraphics[opts]{figures/fig-foo}. The
// extension is resolved by TeX at build time, so the token has to be matched
// against the asset path with ITS extension removed.
const TEX_INCLUDE_RE =
  /\\(?:includegraphics|includestandalone|includepdf|input|include|includemedia|pdfximage)\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g

/**
 * The reference index: every token any scanned file offers, in the three shapes a
 * token can take.
 */
function buildIndex(root, files) {
  const literals = new Map()   // exact token            → Set(referrer)
  const stems = new Map()      // extension-less token   → Set(referrer)
  const patterns = []          // { re, token, from }
  const dirRefs = new Map()    // directory path         → Set(referrer)
  const pathRefs = new Map()   // non-asset path token   → Set(referrer)
  let droppedBroad = 0

  // Directory strings only count when they name a directory that actually holds
  // assets — that is what makes a bare directory mention a reference rather than
  // prose. Built first so the scan can recognise one.
  const assetDirs = new Set()
  for (const f of files) {
    if (isAsset(f)) assetDirs.add(dirname(f))
  }
  const dirSuffixIndex = new Map()
  for (const d of assetDirs) {
    for (const s of suffixes(d)) {
      if (!s.includes('/')) continue // a bare directory NAME is too weak to count
      if (!dirSuffixIndex.has(s)) dirSuffixIndex.set(s, [])
      dirSuffixIndex.get(s).push(d)
    }
  }
  const dirProbe = new RegExp(
    `[A-Za-z0-9_~@+.\\-/]*\\/[A-Za-z0-9_~@+.\\-]+`, 'g',
  )

  for (const f of files) {
    if (!SCAN_EXTS.has(extOf(f))) continue
    if (skipped(f) || SELF_FILES.has(f)) continue
    // An asset that happens to be scannable text (an .svg) is not a referrer to
    // itself; but an .svg CAN legitimately reference another asset, so only its
    // self-reference is excluded, below, at match time.
    let text
    try { text = readFileSync(join(root, f), 'utf8') } catch { continue }
    if (text.length > 4 * 1024 * 1024) text = text.slice(0, 4 * 1024 * 1024)

    for (const m of text.matchAll(TOKEN_RE)) {
      const t = normalizeToken(m[0])
      if (!t || t.startsWith('..')) continue
      if (hasPlaceholder(t)) {
        const re = compilePattern(t)
        if (!re) { droppedBroad++; continue }
        patterns.push({ re, token: t, from: f })
      } else {
        if (!literals.has(t)) literals.set(t, new Set())
        literals.get(t).add(f)
      }
    }

    if (extOf(f) === 'tex') {
      for (const m of text.matchAll(TEX_INCLUDE_RE)) {
        for (const part of m[1].split(',')) {
          const t = normalizeToken(part)
          if (!t || ASSET_EXTS.includes(extOf(t))) continue
          if (hasPlaceholder(t)) {
            const re = compilePattern(t)
            if (re) patterns.push({ re, token: t, from: f, stem: true })
            else droppedBroad++
          } else {
            if (!stems.has(t)) stems.set(t, new Set())
            stems.get(t).add(f)
          }
        }
      }
    }

    // Directory mentions: a script that names an asset directory reaches the files
    // directly inside it (a glob, a readdir, a copy). Subdirectories are NOT
    // covered — naming `plates/` says nothing about `plates/swiss/`.
    // The same pass records every non-asset path token, which is what lets the
    // island check below ask whether a sidecar manifest is itself reachable.
    for (const m of text.matchAll(dirProbe)) {
      const t = normalizeToken(m[0])
      if (!t || ASSET_EXTS.includes(extOf(t))) continue
      if (SCAN_EXTS.has(extOf(t))) {
        if (!pathRefs.has(t)) pathRefs.set(t, new Set())
        pathRefs.get(t).add(f)
      }
      const hits = dirSuffixIndex.get(t)
      if (!hits) continue
      for (const d of hits) {
        if (!dirRefs.has(d)) dirRefs.set(d, new Set())
        dirRefs.get(d).add(f)
      }
    }
  }

  return { literals, stems, patterns, dirRefs, pathRefs, droppedBroad }
}

/** True if some file OUTSIDE `file`'s own directory names it. Used to tell a
 *  generated index (website-v2/public/img/og/manifest.json, written and read by
 *  the site's metadata pipeline) apart from a dead sidecar that only documents the
 *  dead files beside it. */
function reachedFromOutside(file, idx) {
  const dir = dirname(file)
  for (const s of suffixes(file)) {
    // A BARE BASENAME does not count here. `MANIFEST.md` and `proof-manifest.md`
    // are names this repo reuses in a dozen directories, so accepting one would
    // let any live manifest anywhere vouch for a dead one — which is how five
    // files under docs/pr-assets/pr-4922/ read as reachable until this line.
    if (!s.includes('/')) continue
    const hit = idx.pathRefs.get(s)
    if (!hit) continue
    for (const f of hit) if (f !== file && dirname(f) !== dir) return true
  }
  return false
}

/**
 * EVERY way `asset` is reachable — all four kinds, not the first one found.
 * Returning only the first hit would have hidden the case this script exists for:
 * a Swiss plate is named both by a sibling PROVENANCE.json (a literal) and by the
 * Book's `\includegraphics{plates/swiss/chapter-#1.jpg}` (a pattern), and a
 * first-hit answer would report the literal and never prove the pattern works.
 * Returns [] when nothing reaches it — that is the orphan verdict.
 */
function evidence(asset, idx) {
  const out = []
  const sfx = suffixes(asset)
  const noExt = asset.replace(/\.[^./]+$/, '')

  for (const s of sfx) {
    const hit = idx.literals.get(s)
    if (!hit) continue
    const from = [...hit].filter((f) => f !== asset)
    if (from.length) out.push({ kind: 'literal', token: s, from })
  }
  for (const s of suffixes(noExt)) {
    const hit = idx.stems.get(s)
    if (!hit) continue
    const from = [...hit].filter((f) => f !== asset)
    if (from.length) out.push({ kind: 'tex-stem', token: s, from })
  }
  for (const p of idx.patterns) {
    if (p.from === asset) continue
    const probe = p.stem ? suffixes(noExt) : sfx
    if (probe.some((s) => p.re.test(s))) {
      out.push({ kind: 'pattern', token: p.token, from: [p.from] })
    }
  }
  // A bare directory mention counts everywhere EXCEPT inside a deny directory.
  // Outside, naming a directory usually does mean reaching its contents (a glob, a
  // readdir, a copy step) and honouring it keeps the broad report quiet. Inside a
  // deny directory the contract is stronger — every file there is individually
  // printed or served — and honouring it would make the gate vacuous: one prose
  // sentence in a changelog naming `…/plates/swiss/` would vouch for every plate
  // ever dropped into it, including one nothing prints. Measured: with this rule
  // absent, a deliberately unreferenced plate added to plates/swiss/ was reported
  // as referenced, which is the mutation this check exists to catch.
  if (!denyMatch(asset)) {
    const dir = idx.dirRefs.get(dirname(asset))
    if (dir) {
      const from = [...dir].filter((f) => f !== asset)
      if (from.length) out.push({ kind: 'directory', token: dirname(asset) + '/', from })
    }
  }

  // Runtime-derived siblings. `website-v2/src/components/site/ThemedImageSrc.ts`
  // computes a dark source from a light one by string surgery
  // (`collision.webp` → `collision-dark.webp`, `resources-light.webp` →
  // `resources-dark.webp`), and `components/landing/Features.tsx` does the same
  // with `src.replace('-light.', '-dark.')`. The dark file's path therefore never
  // appears anywhere in source, and 14 of the site's agent portraits plus every
  // themed illustration would be reported as orphans on the first run. A dark
  // sibling inherits the light original's reachability, and nothing else does —
  // this is a named rule about one function, not a general "looks similar" fuzz.
  const darkOf = asset.match(/^(.*?)(?:-light)?-dark(\.[^./]+)$/)
  if (darkOf && asset.startsWith('website-v2/public/')) {
    for (const light of [`${darkOf[1]}${darkOf[2]}`, `${darkOf[1]}-light${darkOf[2]}`]) {
      if (light === asset) continue
      if (evidence(light, idx).length) {
        out.push({ kind: 'derived-dark-sibling', token: light, from: [THEMED_IMAGE_SRC] })
        break
      }
    }
  }
  return out
}

/** Allow-list: exact paths or `dir/` prefixes, each with a REASON. A bare path with
 *  no reason fails the check — an allow-list nobody has to justify is how this
 *  repo's stale manifests started. */
function loadAllow(root) {
  const p = join(root, ALLOW_FILE)
  if (!existsSync(p)) return { entries: [], errors: [] }
  let parsed
  try { parsed = JSON.parse(readFileSync(p, 'utf8')) } catch (e) {
    return { entries: [], errors: [`${ALLOW_FILE} is not valid JSON: ${e.message}`] }
  }
  const errors = []
  const entries = []
  const list = Array.isArray(parsed?.allow) ? parsed.allow : null
  if (!list) {
    errors.push(`${ALLOW_FILE} must be an object with an "allow" array`)
    return { entries, errors }
  }
  for (const [i, e] of list.entries()) {
    if (typeof e === 'string') {
      errors.push(`${ALLOW_FILE}[${i}]: "${e}" is a bare path — every entry needs { "path", "reason" }`)
      continue
    }
    const path = e?.path
    const reason = typeof e?.reason === 'string' ? e.reason.trim() : ''
    if (!path || typeof path !== 'string') {
      errors.push(`${ALLOW_FILE}[${i}]: missing "path"`)
      continue
    }
    if (reason.split(/\s+/).filter(Boolean).length < 5) {
      errors.push(`${ALLOW_FILE}[${i}] (${path}): "reason" must be a real sentence (5+ words), not "${reason}"`)
      continue
    }
    entries.push({ path, reason })
  }
  return { entries, errors }
}

const allowMatch = (asset, entries) =>
  entries.find((e) => (e.path.endsWith('/') ? asset.startsWith(e.path) : asset === e.path))

const denyMatch = (asset) => DENY_DIRS.find((d) => asset.startsWith(d))

function humanSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

function analyse(root) {
  const files = tracked(root)
  const assets = files.filter(
    (f) => isAsset(f) && !skipped(f),
  )
  const idx = buildIndex(root, files)
  const { entries: allow, errors: allowErrors } = loadAllow(root)

  const orphans = []
  const siblingOnly = []
  for (const a of assets) {
    const ev = evidence(a, idx)
    if (!ev.length) {
      orphans.push(a)
      continue
    }
    // ISLANDS. An asset whose only referrers are MARKDOWN documents that nothing
    // outside their own directory reaches is cited, but only by paperwork that is
    // itself unreached — the group cites itself and the world cites none of it.
    // That is precisely the shape PR #10171 found: illuminated-mega-volume's
    // proof-manifest.md was the sole referrer of 12 renders (7 of them in a
    // different tree entirely), and both the manifest and the renders were dead, so
    // a plain reference count called the art live. Measured on this tree: the check
    // names 126 of that PR's 147 deletions outright, and this rule accounts for all
    // 14 of the remaining asset files.
    //
    // Restricted to markdown referrers on purpose. A .md file is reached by being
    // linked or cited, which this scan can see; a .ts file is reached through an
    // extension-less import graph it cannot, so extending the rule to code would
    // invent islands out of every component that happens not to be named by path.
    // And a sidecar the world DOES reach — website-v2/public/img/og/manifest.json,
    // read by the site's metadata pipeline — is a real index, so its 335 images are
    // not reported. Advisory either way; never gated, because an unreferenced
    // markdown document is not necessarily a dead one.
    const referrers = [...new Set(ev.flatMap((e) => e.from))]
    if (
      referrers.every((f) => extOf(f) === 'md') &&
      !referrers.some((f) => reachedFromOutside(f, idx))
    ) siblingOnly.push({ asset: a, referrers })
  }

  let size = 0
  const withSize = orphans.map((a) => {
    let bytes = 0
    try { bytes = statSync(join(root, a)).size } catch { /* removed under us */ }
    size += bytes
    return { path: a, bytes, allowed: allowMatch(a, allow), denied: denyMatch(a) }
  })

  return { assets, idx, orphans: withSize, siblingOnly, totalBytes: size, allow, allowErrors }
}

function groupByDir(items) {
  const g = new Map()
  for (const it of items) {
    const d = dirname(it.path)
    if (!g.has(d)) g.set(d, [])
    g.get(d).push(it)
  }
  return [...g.entries()].sort((a, b) => {
    const bytes = (xs) => xs.reduce((s, x) => s + x.bytes, 0)
    return bytes(b[1]) - bytes(a[1])
  })
}

function main() {
  const argv = process.argv.slice(2)
  const rootArg = argv.indexOf('--root')
  const root = rootArg !== -1 ? resolve(argv[rootArg + 1]) : DEFAULT_ROOT
  const check = argv.includes('--check')
  const asJson = argv.includes('--json')
  const whyArg = argv.indexOf('--why')

  const r = analyse(root)

  if (whyArg !== -1) {
    const target = argv[whyArg + 1]
    const ev = evidence(target, r.idx)
    if (!ev.length) {
      console.log(`${SELF}: ${target} — ORPHAN (nothing references it)`)
      process.exit(0)
    }
    console.log(`${SELF}: ${target} — referenced, by ${ev.length} route(s):`)
    for (const e of ev) {
      console.log(`  [${e.kind}] ${e.token}`)
      for (const f of e.from.slice(0, 10)) console.log(`      from ${f}`)
    }
    process.exit(0)
  }

  const gated = r.orphans.filter((o) => o.denied && !o.allowed)

  if (asJson) {
    console.log(JSON.stringify({
      scanned: r.assets.length,
      orphans: r.orphans.map((o) => ({
        path: o.path, bytes: o.bytes,
        denyDir: o.denied ?? null,
        allowedBecause: o.allowed?.reason ?? null,
      })),
      siblingOnly: r.siblingOnly.map((s) => ({ path: s.asset, referrers: s.referrers })),
      gated: gated.map((o) => o.path),
      allowListErrors: r.allowErrors,
    }, null, 2))
    process.exit(r.allowErrors.length || (check && gated.length) ? 1 : 0)
  }

  if (r.allowErrors.length) {
    console.error(`\n✗ ${SELF}: the allow-list itself is the problem:\n`)
    for (const e of r.allowErrors) console.error(`  ${e}`)
    console.error('')
    process.exit(1)
  }

  console.log(
    `${SELF}: ${r.assets.length} asset(s) in scope; ` +
    `${r.orphans.length} referenced by nothing (${humanSize(r.totalBytes)}).`,
  )
  if (r.idx.droppedBroad) {
    console.log(
      `  (${r.idx.droppedBroad} interpolated token(s) were too broad to match on — ` +
      'e.g. `${slug}.jpg` — and were ignored rather than treated as reaching every file.)',
    )
  }

  if (r.orphans.length) {
    console.log('\nOrphans, grouped by directory (largest first):\n')
    for (const [dir, items] of groupByDir(r.orphans)) {
      const bytes = items.reduce((s, x) => s + x.bytes, 0)
      const deny = items[0].denied ? '  [--check enforces this directory]' : ''
      console.log(`  ${dir}/  — ${items.length} file(s), ${humanSize(bytes)}${deny}`)
      for (const it of items) {
        const tag = it.allowed ? `  (allowed: ${it.allowed.reason})` : ''
        console.log(`      ${it.path.slice(dir.length + 1)}  ${humanSize(it.bytes)}${tag}`)
      }
    }
  }

  if (r.siblingOnly.length) {
    console.log(
      `\nAdvisory — ${r.siblingOnly.length} asset(s) cited ONLY by markdown that is itself ` +
      'unreferenced (the group cites itself; nothing outside cites the group):\n',
    )
    for (const [dir, items] of groupByDir(r.siblingOnly.map((s) => ({ path: s.asset, bytes: 0 })))) {
      console.log(`  ${dir}/  — ${items.length} file(s)`)
    }
  }

  if (check) {
    if (gated.length) {
      console.error(`\n✗ ${SELF}: ${gated.length} orphan(s) in a directory that must stay clean:\n`)
      for (const o of gated) {
        console.error(`  ${o.path}  ${humanSize(o.bytes)}`)
        console.error(`      ${o.denied} — ${DENY_REASONS[o.denied]}`)
      }
      console.error(
        `\nEither wire the file up, delete it, or add it to ${ALLOW_FILE} with a reason ` +
        'that says why an unreferenced file belongs there.\n',
      )
      process.exit(1)
    }
    console.log(
      `\n✓ ${SELF} --check: no orphans in ${DENY_DIRS.length} gated director${DENY_DIRS.length === 1 ? 'y' : 'ies'} ` +
      `(${DENY_DIRS.join(', ')}).`,
    )
  }
}

main()
