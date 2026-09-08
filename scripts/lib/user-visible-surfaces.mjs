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
