#!/usr/bin/env node
/**
 * scripts/console-release-gate.mjs — decide whether a release must rebuild
 * pd-console, or may skip the cut because nothing real changed.
 *
 * WHY THIS EXISTS (operator ask, 2026-08-22): `postversion` (via
 * scripts/sync-version.ts) stamps the release version into
 * core/pd-console/Cargo.toml on EVERY release, so a naive
 * `git diff -- core/pd-console` between release tags is non-empty every time —
 * which is why the console was rebuilt bit-for-bit-identically-except-version
 * release after release (v3.29.0 through v3.30.2 all re-cut an unchanged
 * console). A release where the console's application code did not change must
 * not spend a full Rust build + signing + notarization round to pretend
 * something shipped. The design: diff the console's watched paths between this
 * tag and the previous v* tag with `-I'^version = '`, which ignores pure
 * version-string churn while still catching real dependency changes (any true
 * Cargo.lock change also touches its `checksum = …` / `source = …` lines).
 *
 * Extracted from release.yml's inline bash so the logic is unit-testable
 * (tests/unit/console-release-gate.test.js) — the workflow calls THIS file, so
 * the tested code and the shipped code cannot drift.
 *
 * Interface (GitHub Actions step contract):
 *   env CURR_TAG              the release tag being built (required)
 *   env FORCE                 'true' ⇒ build unconditionally (the
 *                             force_console workflow_dispatch input)
 *   env GITHUB_OUTPUT         file to append `build=true|false` to (required)
 *   env GITHUB_STEP_SUMMARY   optional file for the human-readable skip notice
 *
 * FAILURE POSTURE — fail open, toward building: the gate exists to save money,
 * not to guard correctness, so its own malfunction must never block or skew a
 * release. Any unexpected git failure emits a warning and answers build=true;
 * only a missing CURR_TAG/GITHUB_OUTPUT (a miswired workflow) exits non-zero.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

/**
 * The paths whose changes mean "the console binary would differ": the crate
 * itself plus the packaging script that shapes the .app. Deliberately narrow —
 * this module, release.yml, and signing secrets do not change the built bytes.
 *
 * Design note: kept as the single exported source of truth so the unit tests
 * assert against the same list the gate actually diffs.
 */
export const CONSOLE_WATCHED_PATHS = ['core/pd-console', 'scripts/package-pd-console.sh'];

/**
 * Run one git command in `cwd` and return trimmed stdout.
 *
 * Purpose: a minimal helper so decideConsoleBuild reads as the decision it is,
 * not as child-process plumbing; kept synchronous because the gate is a
 * single-shot CI step with nothing to parallelize.
 *
 * @param {string} cwd repository to run in
 * @param {string[]} args git argv (without the leading 'git')
 * @returns {string} trimmed stdout
 */
function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/**
 * Decide whether this release must rebuild pd-console.
 *
 * WHY the shape: the previous release tag is the v* tag immediately below
 * `currTag` in git's version sort. Diffing against the immediate predecessor is
 * transitive — if several consecutive releases skip the console, each skip
 * proved its own tag-to-tag interval clean. Git's default version ordering
 * places `-rc.N` tags ABOVE their stable release, so a stable tag compares
 * against the previous *stable*; any rc-ordering ambiguity errs toward
 * building, never toward wrongly skipping.
 *
 * @param {object} opts
 * @param {string} opts.cwd git repository to interrogate
 * @param {string} opts.currTag the release tag being built
 * @param {boolean} opts.force true ⇒ build unconditionally
 * @returns {{build: boolean, reason: string, prevTag: string|null}} the
 *   verdict, a one-line human reason, and the predecessor tag when one exists
 */
export function decideConsoleBuild({ cwd, currTag, force }) {
  if (force) {
    return { build: true, reason: 'force_console=true — building pd-console unconditionally.', prevTag: null };
  }
  let prevTag = null;
  try {
    const tags = git(cwd, ['tag', '-l', 'v*', '--sort=-v:refname']).split('\n').filter(Boolean);
    const idx = tags.indexOf(currTag);
    prevTag = idx >= 0 && idx + 1 < tags.length ? tags[idx + 1] : null;
  } catch (err) {
    return {
      build: true,
      reason: `gate could not list tags (${err instanceof Error ? err.message : String(err)}) — failing open to a build.`,
      prevTag: null,
    };
  }
  if (!prevTag) {
    return { build: true, reason: `No previous v* tag below ${currTag} — building the console.`, prevTag: null };
  }
  try {
    // --quiet implies --exit-code: 0 ⇒ no non-ignored changes, 1 ⇒ changes.
    // -I'^version = ' ignores the version-string churn sync-version.ts stamps
    // into Cargo.toml on every release; a real dependency change still shows
    // through its checksum/source lines in Cargo.lock.
    execFileSync(
      'git',
      ['diff', '--quiet', '-I^version = ', prevTag, currTag, '--', ...CONSOLE_WATCHED_PATHS],
      { cwd, encoding: 'utf8' },
    );
    return {
      build: false,
      reason: `pd-console unchanged ${prevTag}..${currTag} (version-string churn aside) — skipping the console build.`,
      prevTag,
    };
  } catch (err) {
    const status = err && typeof err === 'object' && 'status' in err ? err.status : null;
    if (status === 1) {
      return { build: true, reason: `pd-console changed since ${prevTag} — building.`, prevTag };
    }
    return {
      build: true,
      reason: `gate diff failed (exit ${status ?? 'unknown'}) — failing open to a build.`,
      prevTag,
    };
  }
}

/**
 * CLI entry: read the Actions env contract, decide, and write outputs.
 *
 * Why side effects live here and not in decideConsoleBuild: the decision is a
 * pure(ish) function of a git repo so the tests can call it — or the whole CLI
 * — without faking GitHub's env-file plumbing beyond two temp files.
 */
function main() {
  const currTag = process.env.CURR_TAG;
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!currTag || !outputFile) {
    console.error('console-release-gate: CURR_TAG and GITHUB_OUTPUT are required.');
    process.exit(1);
  }
  const force = process.env.FORCE === 'true';
  const cwd = process.cwd();
  const verdict = decideConsoleBuild({ cwd, currTag, force });
  appendFileSync(outputFile, `build=${verdict.build}\n`);
  console.log(verdict.reason);
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile && !verdict.build && verdict.prevTag) {
    appendFileSync(
      summaryFile,
      [
        '### pd-console NOT re-cut',
        '',
        `\`${CONSOLE_WATCHED_PATHS.join('` and `')}\` are unchanged between \`${verdict.prevTag}\` and \`${currTag}\` (version-string churn aside).`,
        "The newest console binary remains the one attached to the last release that built it; this release's `latest.json` carries no console entry.",
        'To cut one anyway (e.g. after a signing-cert rotation), re-run release.yml via workflow_dispatch with `force_console: true`.',
        '',
      ].join('\n'),
    );
  } else if (summaryFile && force) {
    appendFileSync(summaryFile, `${verdict.reason}\n`);
  }
}

// Only run the CLI when executed directly, so the tests can import
// decideConsoleBuild without tripping the env-contract check.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
