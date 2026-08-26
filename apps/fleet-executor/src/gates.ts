/**
 * Deterministic ship gating — the biggest cost lever, at zero model risk.
 *
 * Most fleet cost is AI spend on ships that had nothing to say. The ship prompts
 * already declare surface gates in prose ("red-team: only if the diff touches
 * auth/crypto/…"; "tautology-sniffer: only if it touches test files") — but the
 * cloud executor still ran the FULL map-reduce to discover the gate was closed,
 * paying for every chunk. This module moves those gates into CODE: a ship whose
 * surface the diff doesn't touch is skipped BEFORE any `ai.run`, spending nothing.
 *
 * Class-aware docs-only routing (operator directive, 2026-07-07): a docs-only
 * diff (planning / thought-generation prose, NOT inline code documentation) has
 * nothing for the reviewer ships to review — but it is exactly where the IDEATION
 * ships (spark/spider/lookout/snipe) should run. So reviewers skip docs-only;
 * ideation runs on it.
 */

import type { ShipConfig } from './fleet.js';

/** A path is prose/docs (not code) — `.md`/`.mdx`, or anything under `docs/`. */
const PROSE_PATH_RE = /(\.mdx?$)|(^|\/)docs\//i;

/** Any code-ish source file — used to reject "docs-only" when real code changed. */
const CODE_PATH_RE = /\.(ts|tsx|js|jsx|mjs|cjs|rs|swift|go|py|rb|java|kt|c|h|cpp|sh|sql|toml|ya?ml|json)$/i;

/**
 * red-team's security surface (path-based; contents aren't cheaply inspectable
 * in the Worker, so err toward running on any security-looking path). Mirrors the
 * gate enumerated in red-team's prompt.
 */
const SECURITY_SURFACE_RE =
  /(lib\/(auth|capabilities|secret-env|bonds|cost-tracker|arbiter|file-claims|salvage|note-encryption))|(routes\/(auth|bonds))|(crypto|sign|verify|hash|token|secret|auth|capabilit|key|vault|wrap|hpke)/i;

/** Test-file surface for tautology-sniffer / test-author. */
const TEST_FILE_RE = /(\.(test|spec)\.[tj]sx?$)|((^|\/)tests?\/)|(_test\.go$)|((^|\/)test_[^/]*\.py$)/i;

/** User-facing copy surface for copy-pm. */
const COPY_SURFACE_RE = /(\.(tsx|html|mdx|md)$)|((^|\/)(website|website-v2|blog|public)\/)|((^|\/)README)/i;

/** Per-ship surface gate. `null` = no gate (the ship reviews all code). */
function shipSurfaceGate(shipName: string): RegExp | null {
  switch (shipName) {
    case 'red-team':
      return SECURITY_SURFACE_RE;
    case 'tautology-sniffer':
    case 'test-author':
      return TEST_FILE_RE;
    case 'copy-pm':
      return COPY_SURFACE_RE;
    default:
      return null;
  }
}

/**
 * A docs-only diff = at least one changed path, every path is prose, and NO code
 * file changed. `AGENTS.md`, `docs/plans/foo.md`, `fleet/ships/spider.md` → true;
 * anything touching a `.ts`/`.rs`/… → false (that's a code change with docs, not
 * a docs-only diff).
 */
export function isDocsOnly(changedPaths: string[]): boolean {
  if (changedPaths.length === 0) return false;
  if (changedPaths.some(p => CODE_PATH_RE.test(p))) return false;
  return changedPaths.every(p => PROSE_PATH_RE.test(p));
}

/**
 * Files whose diffs cannot carry a reviewable defect.
 *
 * These are machine-authored or machine-derived: nobody wrote the bug, and no
 * reviewer can act on the hunk. They are, however, frequently the LARGEST
 * entries in a diff — a lockfile refresh or a regenerated snapshot dwarfs the
 * hand-written change it accompanies.
 *
 * Excluding them before chunking is the cheapest possible saving in this
 * pipeline. Review is map-reduce with one model call per 12k-char chunk, so
 * every chunk of regenerated JSON is a call spent producing findings about
 * output no human controls — and worse, it displaces real code into further
 * chunks, which is what makes a reviewer's view of the actual change partial in
 * the first place.
 */
const UNREVIEWABLE_PATH_RE = new RegExp(
  [
    // dependency lockfiles
    '(^|/)(package-lock\\.json|pnpm-lock\\.yaml|yarn\\.lock|Cargo\\.lock|poetry\\.lock|go\\.sum|Gemfile\\.lock)$',
    // generated / derived artifacts
    '(^|/)(dist|build|out|coverage|vendor|node_modules|target)/',
    '\\.(min\\.(js|css)|map|snap)$',
    '(^|/)__snapshots__/',
    '\\.snapshot\\.json$',
    // binary-ish assets a text reviewer cannot reason about
    '\\.(png|jpe?g|gif|webp|ico|svg|pdf|woff2?|ttf|eot|mp4|mov|zip|gz|wasm)$',
  ].join('|'),
  'i',
);

/**
 * Whether a changed file's diff is worth spending a review call on.
 *
 * Conservative by construction: anything not positively recognised as generated
 * is reviewable. A false negative here silently hides real code from review,
 * which is far worse than the tokens a false positive costs.
 */
export function isReviewableForBugs(path: string): boolean {
  return !UNREVIEWABLE_PATH_RE.test(path);
}

export interface GateDecision {
  run: boolean;
  /** Why the ship was skipped (for the transcript). Absent when it runs. */
  reason?: string;
}

/**
 * Decide whether a ship should run against this diff, BEFORE any AI spend.
 *
 *   1. Ideation ships always run (they propose forward work on ANY diff, and are
 *      the whole point of a docs-only planning diff).
 *   2. Reviewer ships skip a docs-only diff (nothing to review for correctness).
 *   3. A ship with a surface gate skips when the diff touches none of its surface.
 *   4. Otherwise it runs.
 */
export function decideShipGate(
  ship: ShipConfig,
  changedPaths: string[],
  docsOnly: boolean,
): GateDecision {
  if (ship.ideation) return { run: true };
  if (docsOnly) return { run: false, reason: 'docs-only diff — reviewer ships skip (ideation runs)' };

  const gate = shipSurfaceGate(ship.name);
  if (gate && !changedPaths.some(p => gate.test(p))) {
    return { run: false, reason: `surface not touched by diff (pd-${ship.name} gate)` };
  }
  return { run: true };
}
