/**
 * Regression test for scripts/check-relay-decode-guard.mjs — the guard that
 * stops the relay's malformed-URL 500 defect class (four review bots on PR
 * #10150) from coming back: no raw `decodeURIComponent` reference in
 * apps/relay/src/index.ts outside `safeDecodeSegment`'s own body.
 *
 * Runs against committed fixtures (tests/fixtures/relay-decode-guard/) so the
 * mechanical behaviour is pinned:
 *   - a clean file (helper + routes that all go through it, plus a comment
 *     that merely MENTIONS the banned name) passes;
 *   - a raw `decodeURIComponent(...)` call outside the helper fails, named;
 *   - a raw BARE REFERENCE (`.map(decodeURIComponent)`, no trailing "(") also
 *     fails — proving the guard is AST-based, not a `decodeURIComponent(`
 *     text search, which would miss exactly this shape;
 *   - a file with no `safeDecodeSegment` anchor at all errors out (exit 2),
 *     distinct from a real violation (exit 1), rather than silently passing.
 *
 * It also runs the guard against the REAL, live apps/relay/src/index.ts and
 * pins its ACTUAL current result — which is presently two known, pre-existing
 * violations, not zero. See the test below for why.
 */
import { describe, expect, test } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const script = join(repo, 'scripts', 'check-relay-decode-guard.mjs');
const fixture = (name) => join(repo, 'tests', 'fixtures', 'relay-decode-guard', name);

/** Run the guard; return { code, stdout, stderr }. */
function run(...args) {
  try {
    const stdout = execFileSync('node', [script, ...args], { cwd: repo, encoding: 'utf8' });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout?.toString() ?? '', stderr: e.stderr?.toString() ?? '' };
  }
}

describe('relay decode guard (scripts/check-relay-decode-guard.mjs)', () => {
  test('a clean file (helper-only call, comment mention) passes', () => {
    const { code, stdout } = run(fixture('clean.ts'));
    expect(code).toBe(0);
    expect(stdout).toMatch(/no raw decodeURIComponent outside safeDecodeSegment/);
  });

  test('a raw decodeURIComponent(...) call outside the helper fails, named', () => {
    const { code, stderr } = run(fixture('dirty-raw-call.ts'));
    expect(code).toBe(1);
    expect(stderr).toMatch(/1 raw `decodeURIComponent` reference/);
    expect(stderr).toMatch(/:26\s+const id = decodeURIComponent/);
    expect(stderr).toMatch(/Use safeDecodeSegment\(segment\)/);
    // Actionable: names the throw + the 500 it causes.
    expect(stderr).toMatch(/URIError/);
    expect(stderr).toMatch(/500 INTERNAL_ERROR/);
  });

  test('a raw BARE REFERENCE (.map(decodeURIComponent), no trailing "(") also fails', () => {
    const { code, stderr } = run(fixture('dirty-bare-ref.ts'));
    expect(code).toBe(1);
    expect(stderr).toMatch(/1 raw `decodeURIComponent` reference/);
    expect(stderr).toMatch(/\.map\(decodeURIComponent\)/);
  });

  test('safeDecodeSegment\'s own body is exempt: only the injected site is flagged, never the helper\'s own call', () => {
    const { stderr } = run(fixture('dirty-raw-call.ts'));
    // Exactly one violation reported even though the helper (present in the
    // same file) also contains the literal text "decodeURIComponent".
    const offenderLines = stderr.split('\n').filter((l) => /^\s+tests\/fixtures.*:\d+\s/.test(l));
    expect(offenderLines).toHaveLength(1);
  });

  test('a file with no safeDecodeSegment anchor errors (exit 2), not a silent pass', () => {
    const { code, stderr } = run(fixture('no-helper.ts'));
    expect(code).toBe(2);
    expect(stderr).toMatch(/could not find `safeDecodeSegment`/);
  });

  test(
    'the LIVE apps/relay/src/index.ts currently has exactly two pre-existing, ' +
      'known-deferred violations (NOT zero) -- /account/parleys/ and /account/harbors/, ' +
      'both explicitly left out of PR #10150 per its own commit message (parleys is owned ' +
      'by a separate stacked PR; harbors was already try/catch-guarded locally, just not ' +
      'through the canonical helper). This test pins the CURRENT real count and sites so ' +
      'a THIRD raw site cannot slip in unnoticed, and so fixing either existing one requires ' +
      'a deliberate, visible edit to this test rather than a silent guard downgrade.',
    () => {
      const { code, stderr } = run(); // no override -- real apps/relay/src/index.ts
      expect(code).toBe(1);
      expect(stderr).toMatch(/2 raw `decodeURIComponent` reference\(s\)/);
      expect(stderr).toMatch(/apps\/relay\/src\/index\.ts:795\s+const seg = .*\/account\/parleys\//);
      expect(stderr).toMatch(/apps\/relay\/src\/index\.ts:836\s+seg = .*\/account\/harbors\//);
    },
  );
});
