/**
 * PURSER RE-RUN POLICY — decide whether an existing test suite still applies.
 *
 * THE PROBLEM THIS EXISTS FOR: the purser used to re-run its steel-man call AND
 * its test-authoring call on every single fleet run for a PR. A PR pushed to
 * ten times paid for twenty model calls and had its adversarial tests rewritten
 * ten times. That is expensive, but the worse cost is human: an author who
 * fixed the three cases the purser demanded came back to find those cases
 * renamed or replaced, so the goalposts moved every time they pushed. A gate
 * that rewrites itself under you is not a gate, it is a treadmill.
 *
 * THE RULE: tests are authored ONCE per contract. Subsequent runs re-execute
 * the existing tests and report status. They are re-authored only when the PR
 * has changed so much that the old contract plainly no longer describes it.
 *
 * WHY A FINGERPRINT AND NOT A DIFF HASH: an exact hash would invalidate on
 * every whitespace change, which returns us to the treadmill. What actually
 * determines whether a contract still holds is WHAT the PR touches — its set of
 * changed files — and roughly how big it is. A PR that adds a line to the same
 * three files is the same PR. A PR that abandons those files for eleven others
 * is a different one, and its old tests are testing something that is gone.
 *
 * This module is pure: no I/O, no clock, no model. That is deliberate — the
 * decision "should we spend two model calls" must be auditable and unit-
 * testable without a network.
 */

/** Marker embedded in the test PR body so a later run can recover the fingerprint. */
export const FINGERPRINT_MARKER = 'purser-contract-fingerprint';

/**
 * Jaccard distance below which two PRs count as "the same work".
 *
 * 0.5 means: more than half the changed-file set must turn over before the
 * contract is considered stale. Chosen to be forgiving — the failure mode of
 * re-authoring too eagerly (moving goalposts, wasted calls) is worse than
 * re-running slightly stale tests, which at worst reports a failure the author
 * can dispute on the test PR.
 */
export const RE_AUTHOR_FILE_CHURN = 0.5;

/**
 * Size ratio beyond which the PR counts as a different animal regardless of
 * file overlap — a 40-line patch that becomes a 4,000-line one is not the same
 * change even if it touches the same files.
 */
export const RE_AUTHOR_SIZE_RATIO = 4;

export interface ContractFingerprint {
  /** Sorted, deduped repo-relative paths the reviewed PR changes. */
  files: string[];
  /** Total diff size in characters — coarse on purpose. */
  size: number;
  /**
   * The test files the purser authored, by path.
   *
   * LOAD-BEARING, not informational. The purser's test branch is cut with
   * `base_tree` set to the PR base, so its tree is THE WHOLE REPOSITORY plus
   * these files. A re-run that tried to discover the tests by walking the tree
   * would enumerate every file in the repo and fetch a blob for each — hundreds
   * to thousands of requests, which would time out or exhaust the rate limit
   * and cost far more than the two model calls re-running is meant to save.
   *
   * So the paths are recorded at author time and the re-run reads exactly this
   * list. Absent (older test PRs) ⇒ nothing to read back ⇒ author afresh.
   */
  tests: string[];
}

export type RerunDecision =
  | { action: 'author'; reason: string }
  | { action: 'reuse'; reason: string };

/**
 * Build the fingerprint of a reviewed PR from its unified diff.
 *
 * Parses `+++ b/<path>` headers rather than `diff --git`, because the former
 * names the post-image path, which is what a test would target. `/dev/null`
 * (a deletion's post-image) is skipped.
 *
 * The `tests` list is filled in later by {@link withAuthoredTests}, once the
 * test-author call has produced the files — the diff alone cannot know them.
 *
 * @param diff The reviewed PR's unified diff.
 * @returns The fingerprint, with an empty `tests` list.
 */
export function fingerprintDiff(diff: string): ContractFingerprint {
  const files = new Set<string>();
  for (const line of (diff ?? '').split(/\r?\n/)) {
    const m = /^\+\+\+ [ab]\/(.+?)\s*$/.exec(line);
    if (!m) continue;
    const path = m[1].trim();
    if (!path || path === '/dev/null') continue;
    files.add(path);
  }
  return { files: [...files].sort(), size: (diff ?? '').length, tests: [] };
}

/**
 * Attach the authored test paths to a fingerprint before it is embedded.
 *
 * @param fp The diff fingerprint.
 * @param paths Paths of the test files just authored.
 * @returns A copy carrying the paths a later re-run will read back.
 */
export function withAuthoredTests(fp: ContractFingerprint, paths: string[]): ContractFingerprint {
  return { ...fp, tests: [...paths].sort() };
}

/** Serialize a fingerprint into the hidden PR-body marker. */
export function encodeFingerprint(fp: ContractFingerprint): string {
  return `<!-- ${FINGERPRINT_MARKER}: ${JSON.stringify(fp)} -->`;
}

/**
 * Recover a fingerprint from a test PR body.
 *
 * @param body The stacked test PR's body (may be any text, or undefined).
 * @returns The fingerprint, or null when absent/malformed — both of which mean
 *          "no usable memory", so the caller authors afresh.
 */
export function decodeFingerprint(body: string | null | undefined): ContractFingerprint | null {
  if (!body) return null;
  const m = new RegExp(`<!--\\s*${FINGERPRINT_MARKER}:\\s*(\\{[\\s\\S]*?\\})\\s*-->`).exec(body);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1]) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const o = parsed as Record<string, unknown>;
    if (!Array.isArray(o.files) || typeof o.size !== 'number') return null;
    const files = o.files.filter((f): f is string => typeof f === 'string');
    // `tests` is absent on markers written before bounded re-reads existed.
    // Treated as "no recorded tests", which routes the caller to re-author
    // rather than to a tree walk.
    const tests = Array.isArray(o.tests)
      ? o.tests.filter((t): t is string => typeof t === 'string')
      : [];
    return { files, size: o.size, tests };
  } catch {
    return null;
  }
}

/**
 * Decide whether to reuse the existing tests or author new ones.
 *
 * Every `author` outcome carries a reason naming WHY the old contract was
 * judged stale, because that reason is surfaced to the PR author — "your tests
 * were rewritten" is only acceptable if it comes with "because the PR stopped
 * touching the files they covered".
 *
 * @param previous Fingerprint recovered from the existing test PR (null ⇒ none).
 * @param current Fingerprint of the PR as it now stands.
 * @param haveFiles Whether the existing test files were actually readable.
 * @returns The decision plus a human-legible reason.
 */
export function decideRerun(
  previous: ContractFingerprint | null,
  current: ContractFingerprint,
  haveFiles: boolean,
): RerunDecision {
  if (!haveFiles) {
    return { action: 'author', reason: 'no previous test files could be read for this PR' };
  }
  if (!previous) {
    return {
      action: 'author',
      reason: 'the existing test PR carries no contract fingerprint (authored before re-run support)',
    };
  }

  // Size blow-up: same files, wildly different scale.
  const lo = Math.min(previous.size, current.size);
  const hi = Math.max(previous.size, current.size);
  if (lo > 0 && hi / lo >= RE_AUTHOR_SIZE_RATIO) {
    return {
      action: 'author',
      reason:
        `the diff changed size by ${(hi / lo).toFixed(1)}× ` +
        `(${previous.size} → ${current.size} chars), past the ${RE_AUTHOR_SIZE_RATIO}× threshold`,
    };
  }

  // File-set turnover, measured as Jaccard distance.
  const prev = new Set(previous.files);
  const cur = new Set(current.files);
  if (prev.size === 0 && cur.size === 0) {
    return { action: 'reuse', reason: 'no changed files recorded on either side' };
  }
  let intersection = 0;
  for (const f of cur) if (prev.has(f)) intersection += 1;
  const union = new Set([...prev, ...cur]).size;
  const distance = union === 0 ? 0 : 1 - intersection / union;
  if (distance >= RE_AUTHOR_FILE_CHURN) {
    return {
      action: 'author',
      reason:
        `${Math.round(distance * 100)}% of the changed-file set turned over ` +
        `(${intersection}/${union} still shared), past the ${Math.round(RE_AUTHOR_FILE_CHURN * 100)}% threshold`,
    };
  }

  return {
    action: 'reuse',
    reason:
      `the PR still targets substantially the same files ` +
      `(${intersection}/${union} shared, ${Math.round(distance * 100)}% turnover)`,
  };
}
