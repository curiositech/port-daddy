/**
 * Bridge for pd-purser's adversarial contract tests (tests/purser/*.test.js,
 * stacked onto PR #5452 via #5628). Those tests import `makeD1`/`makeEnv`
 * from '../session-intel.test.js' relative to tests/purser/ -- i.e. exactly
 * this path -- because the ship's default drop zone for adversarial tests is
 * this flat top-level tests/ directory, while the real session-intel suite
 * and its fixtures live nested under apps/relay/tests/. Re-export the SAME
 * real fixtures the app's own suite uses so purser's tests exercise the
 * actual mock, not a second hand-rolled one that could drift from it.
 *
 * No describe/it blocks here on purpose -- this file exists to be imported
 * for its exports, not collected as its own test suite.
 */
export { OPERATOR, makeD1, makeEnv } from '../apps/relay/tests/session-intel-fixtures.js';
