/**
 * user-visible-surfaces.mjs — ONE definition of "a change a released user would
 * feel", shared by every consumer that needs to ask that question.
 *
 * Before this module the repo had three different answers and no way to notice
 * when they disagreed:
 *
 *   - `.github/workflows/release-train.yml` env `DAEMON_PATHSPEC` — "daemon-facing
 *     surfaces that make a release worth cutting." This is the maintained,
 *     load-bearing one: it decides whether a release gets cut at all.
 *   - `ci.yml` job `detect-changes` → `recordings` — a BUILD-COST classifier
 *     ("should we re-record the terminal GIFs"). It includes `scripts/`,
 *     `package-lock.json` and `ci.yml` itself, so it is deliberately NOT reused
 *     here: wired to a changelog requirement it would demand a user-facing entry
 *     for a lockfile bump and for this very file.
 *   - `check-pr-requirements.mjs` → `VISUAL_SURFACE_RE` — surfaces the operator
 *     reviews by LOOKING. Narrower question, but a real part of "user-visible".
 *
 * DAEMON_PATHSPEC below is a verbatim copy of the release-train env value.
 * `tests/unit/changelog-fragments.test.js` parses that workflow and FAILS if the
 * two ever drift, so the copy cannot rot silently. The workflow keeps its inline
 * env (shell `git diff` pathspecs can't import ESM) and carries a comment naming
 * this module as the source of truth.
 */

/**
 * Daemon-facing surfaces that make a release worth cutting.
 * Verbatim from .github/workflows/release-train.yml env.DAEMON_PATHSPEC.
 */
export const DAEMON_PATHSPEC = [
  'server.ts',
  'lib/',
  'cli/',
  'shared/',
  'routes/',
  'mcp/',
  'bin/',
  'hooks/',
  'skills/port-daddy-agent-skill/',
  'agents/port-daddy-pilot/',
  'package.json',
  'release-artifacts.json',
  '.github/workflows/release.yml',
]

/**
 * Surfaces the operator reviews by LOOKING, not by reading a green check.
 * `check-pr-requirements.mjs` imports this for its visual-artifact rule; the
 * changelog rule folds it into the user-visible set because the release train
 * does not care about pixels but users do.
 */
export const VISUAL_SURFACE_RE =
  /^(core\/pd-console\/|website-v2\/|fleet-config-ui\/|public\/fleet-ui\/|public\/|dashboard\/|apps\/FleetBar\/)/

/**
 * FIGURE / PRINT TERRITORY — the trees whose output is a rendered page rather
 * than a running screen: the Book and the papers, their TikZ fragments, the
 * plate pipelines, and the two skills that decide what a figure is allowed to
 * look like.
 *
 * Why this is a SEPARATE set from VISUAL_SURFACE_RE rather than a slice of it:
 * the two ask for different evidence. A pane in the GPUI window is proved by a
 * screenshot plus a recording — you have to see it move. A figure in a printed
 * book has nothing to record; it is proved by a still render at page scale, and
 * demanding a GIF of it would be a requirement nobody can meet honestly. So the
 * print set gets its own rule (`check-pr-requirements.mjs` rule 3b) and is
 * SUBTRACTED from the app-visual set that rule 3 fires on.
 *
 * The entries are whole trees on purpose. `skills/harbor-chartwork/` holds the
 * craft rules and the figure checkers, not drawings — but a change to
 * `craft-rules.md` or `tikz_precheck.py` changes what every figure in the corpus
 * is allowed to look like, and the only honest proof that such a change is right
 * is a page that was rendered and looked at. Same for the semantic figure atlas.
 */
export const FIGURE_WORK_TREES = [
  // The Book and the chapter sources, their `figures/` fragments, and the
  // corpus records (`standalone-figures.json`, `corpus.json`) that say which
  // fragment prints in which edition.
  'whitepaper/',
  // Parked worktree copies of the same tree, same shape, same contract.
  'whitepaper-foundlings/',
  // The published paper sources: `.tex`, the committed PDFs, `figures/`,
  // `plates/`, `art/`, and the book cover.
  'website-v2/public/whitepaper/',
  // The chartwork skill: house craft rules plus `tikz_precheck.py` / `figcheck.py`.
  'skills/harbor-chartwork/',
  // The semantic figure atlas and its coverage checker — this is where a
  // figure's FORM is decided before any TikZ is written.
  'skills/whitepaper-figure-system/',
  // The plate render pipelines and their checks.
  'scripts/whitepaper-plates/',
  'tests/whitepaper-plates/',
]

/**
 * Any directory literally named `figures` — at any depth, in any tree. Catches
 * `docs/harbor-research/figures/`, `docs/harbor-research/exposition/figures/`
 * and whatever figure tree exists next month, so the enumerated list above does
 * not have to be the only line of defence.
 */
export const FIGURE_DIR_RE = /(^|\/)figures\//i

/**
 * A plate directory: a segment that is exactly `plates` or ends in `-plates`
 * (`website-v2/public/whitepaper/plates/`, `scripts/whitepaper-plates/`,
 * `docs/pr-assets/swiss-plates/`). The `(^|\/)` anchor and the required hyphen
 * are what keep this off the ~90 `templates/` directories in this repo —
 * "templates" contains the letters "plates" and a looser pattern matches every
 * one of them.
 */
export const PLATE_DIR_RE = /(^|\/)(?:[A-Za-z0-9_]+-)?plates\//i

/**
 * A typeset source file. Every `.tex` in this repository is a chapter, a paper,
 * a TikZ fragment or a figure-craft template — there is no `.tex` here that is
 * not a page someone has to look at — so the extension alone is a sound test
 * and needs no tree to qualify it.
 */
export const TYPESET_SOURCE_RE = /\.tex$/i

/**
 * True if `file` is figure/print territory: work whose result is a rendered
 * page. `check-pr-requirements.mjs` uses this to decide that a `visual-exempt`
 * marker is not available and that a page-scale render is required instead.
 */
export function isFigureSurface(file) {
  // Matched case-INSENSITIVELY, unlike `isUserVisibleSurface` below. Git stores
  // paths case-sensitively, so `Figures/` and `figures/` are two different
  // directories here, and `Whitepaper/` is a tree the enumerated list would not
  // recognise. A contributor who capitalises a directory would then create a
  // figure tree this rule cannot see — which is the exact gap the shape-based
  // tests exist to close, reopened by an accident of spelling. The corpus is all
  // lowercase today, so this is latent, and a guard meant to be unbypassable
  // should not depend on that staying true.
  //
  // The three patterns carry `i` for the same reason and for direct importers;
  // `FIGURE_WORK_TREES` is all lowercase, so folding the path is enough there.
  const lower = file.toLowerCase()
  if (matchesPathspec(lower, FIGURE_WORK_TREES)) return true
  if (FIGURE_DIR_RE.test(file)) return true
  if (PLATE_DIR_RE.test(file)) return true
  return TYPESET_SOURCE_RE.test(file)
}

/**
 * Release/packaging plumbing that lives in DAEMON_PATHSPEC (correctly — a change
 * there can change what gets released) but which, CHANGED ALONE, ships nothing a
 * user would notice: a devDependency bump, an npm-script alias, a CI matrix tweak.
 * Whatever user-visible thing they accompany is carried by the code change next to
 * them, and that code change is itself in the set.
 *
 * Deliberately an EXPLICIT, short, enumerated list, not a heuristic. If a change
 * to one of these really is user-visible on its own, write the fragment — nothing
 * stops you — or take `<!-- changelog-exempt: <reason> -->`.
 */
export const CHANGELOG_PLUMBING_EXCLUSIONS = [
  'package.json',
  'release-artifacts.json',
  '.github/workflows/release.yml',
]

/** True if `file` (repo-relative) is under one of `pathspec`'s entries. */
function matchesPathspec(file, pathspec) {
  return pathspec.some((p) => (p.endsWith('/') ? file.startsWith(p) : file === p))
}

/**
 * True if `file` is a surface a released user would feel — the union of the
 * release train's daemon pathspec and the visual surfaces, minus the enumerated
 * release-plumbing exclusions. This is the classifier the changelog-fragment
 * requirement fires on.
 */
export function isUserVisibleSurface(file) {
  if (CHANGELOG_PLUMBING_EXCLUSIONS.includes(file)) return false
  if (VISUAL_SURFACE_RE.test(file)) return true
  return matchesPathspec(file, DAEMON_PATHSPEC)
}
