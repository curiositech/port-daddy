/**
 * Regression test for the changelog fragment system — scripts/assemble-changelog.mjs
 * and rule (4) of scripts/check-pr-requirements.mjs.
 *
 * Modelled on tests/unit/version-drift-gate.test.js: it runs the LIVE repo (the tree
 * we are shipping actually passes its own gate) AND a sandbox with injected breakage
 * (the gate has teeth, not just a tree that happens to agree today).
 *
 * The load-bearing assertions are the two couplings to the release train:
 *
 *   1. `--release X.Y.Z` output satisfies the LITERAL
 *      `grep -Fq "## [X.Y.Z] -" CHANGELOG.md` that .github/workflows/release-train.yml
 *      runs in `tag-and-publish`. No dated heading ⇒ no tag ⇒ no GitHub Release ⇒
 *      release.yml never fires ⇒ no binaries, no tap roll. Asserted with `-F`
 *      (substring) semantics, never as a regex, because that is what the workflow does.
 *   2. With zero fragments, `--release` is BYTE-IDENTICAL to the `perl -0pi` one-liner
 *      it replaces in the "Open the version-bump PR" step. That equivalence is the
 *      whole safety argument for swapping the release path.
 */
import { describe, expect, test, beforeAll, afterAll } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const assembler = join(repo, 'scripts', 'assemble-changelog.mjs');
const prGate = join(repo, 'scripts', 'check-pr-requirements.mjs');

/** Run a script; return { code, stdout, stderr }. Never throws. */
function run(script, ...args) {
  try {
    const stdout = execFileSync('node', [script, ...args], { cwd: repo, encoding: 'utf8' });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout?.toString() ?? '', stderr: e.stderr?.toString() ?? '' };
  }
}

const assemble = (...args) => run(assembler, ...args);

// A CHANGELOG head shaped exactly like the real one: `## [Unreleased]`, a blank
// line, then the previous release section.
const HEAD = [
  '# Changelog',
  '',
  'All notable changes to Port Daddy will be documented in this file.',
  '',
  '## [Unreleased]',
  '',
  '## [3.30.2] - 2026-08-21',
  '',
  '### Added',
  '- **An older entry.** Prose that must survive untouched.',
  '',
].join('\n');

/** Build a sandbox root with a CHANGELOG and the named fragments. */
function scaffold(root, fragments = {}, changelog = HEAD) {
  mkdirSync(join(root, 'changelog.d'), { recursive: true });
  writeFileSync(join(root, 'CHANGELOG.md'), changelog);
  for (const [name, content] of Object.entries(fragments)) {
    writeFileSync(join(root, 'changelog.d', name), content);
  }
  return root;
}

describe('changelog fragments', () => {
  let sandbox;
  let n = 0;
  const fresh = (fragments, changelog) => scaffold(join(sandbox, `t${n++}`), fragments, changelog);

  beforeAll(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'pd-changelog-fragments-'));
  });

  afterAll(() => {
    if (sandbox && existsSync(sandbox)) rmSync(sandbox, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------- live repo

  test('the LIVE repo passes --check', () => {
    const { code, stdout } = assemble('--check');
    expect(code).toBe(0);
    expect(stdout).not.toMatch(/✗/);
  });

  test('the LIVE repo has the `## [Unreleased]` anchor the assembler splices into', () => {
    const text = readFileSync(join(repo, 'CHANGELOG.md'), 'utf8');
    expect(text.split('\n')).toContain('## [Unreleased]');
  });

  // ------------------------------------------------------------------ assembly

  test('three fragments across three types assemble into the existing format', () => {
    const root = fresh({
      '9752-assembler.md': 'type: added\n\n- **Fragments assemble the changelog.** Prose.\n',
      '9801-conflicts.md': 'type: fixed\n\n- **A conflict class is closed.** One file per PR.\n  - A sub-bullet.\n',
      'draft-train.md': 'type: changed\n\n- **The train stamps via the assembler.** Prose.\n',
    });
    const { code, stdout } = assemble('--root', root, '--print');
    expect(code).toBe(0);
    // Keep a Changelog canonical order, empty sections omitted, `###` heading
    // followed IMMEDIATELY by its first bullet (no blank line) — the real file's shape.
    expect(stdout).toBe([
      '### Added',
      '- **Fragments assemble the changelog.** Prose.',
      '',
      '### Changed',
      '- **The train stamps via the assembler.** Prose.',
      '',
      '### Fixed',
      '- **A conflict class is closed.** One file per PR.',
      '  - A sub-bullet.',
      '',
    ].join('\n'));
  });

  test('--release splices the dated section and consumes the fragments', () => {
    const root = fresh({
      '9752-a.md': 'type: added\n\n- **Added thing.** Prose.\n',
    });
    const { code } = assemble('--root', root, '--release', '9.9.9', '--date', '2026-01-02');
    expect(code).toBe(0);
    const out = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
    expect(out).toBe([
      '# Changelog',
      '',
      'All notable changes to Port Daddy will be documented in this file.',
      '',
      '## [Unreleased]',
      '',
      '## [9.9.9] - 2026-01-02',
      '',
      '### Added',
      '- **Added thing.** Prose.',
      '',
      '## [3.30.2] - 2026-08-21',
      '',
      '### Added',
      '- **An older entry.** Prose that must survive untouched.',
      '',
    ].join('\n'));
    // Git history is the archive; there is no changelog.d/archive/.
    expect(readdirSync(join(root, 'changelog.d'))).toEqual([]);
  });

  test('byte hygiene: LF only, exactly one trailing newline, no trailing whitespace', () => {
    const root = fresh({ '1-a.md': 'type: added\n\n- **A.** B.\n' });
    assemble('--root', root, '--release', '1.2.3', '--date', '2026-01-02');
    const out = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
    expect(out).not.toMatch(/\r/);
    expect(out.endsWith('\n')).toBe(true);
    expect(out.endsWith('\n\n')).toBe(false);
    expect(out.split('\n').some((l) => /[ \t]+$/.test(l))).toBe(false);
  });

  // ------------------------------------------------- coupling to release-train

  test('--release output satisfies the literal grep -Fq in release-train.yml', () => {
    // .github/workflows/release-train.yml, job `tag-and-publish`:
    //     if ! grep -Fq "## [$version] -" CHANGELOG.md; then … exit 1; fi
    // -F means FIXED STRING, so assert substring containment, not a regex match.
    const root = fresh({ '9752-a.md': 'type: added\n\n- **Added thing.** Prose.\n' });
    assemble('--root', root, '--release', '9.9.9', '--date', '2026-01-02');
    const out = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
    expect(out.includes('## [9.9.9] -')).toBe(true);
    // And the real `grep -Fq` agrees, run exactly as the workflow runs it: this
    // throws (non-zero exit) if the release gate would refuse to tag.
    expect(() =>
      execFileSync('grep', ['-Fq', '## [9.9.9] -', join(root, 'CHANGELOG.md')]),
    ).not.toThrow();
  });

  test('zero fragments still emits the dated heading (the [3.28.2] precedent)', () => {
    const root = fresh({});
    const { code, stdout } = assemble('--root', root, '--release', '4.0.0', '--date', '2026-03-04');
    expect(code).toBe(0);
    expect(stdout).toMatch(/no entries — dated heading emitted anyway/);
    const out = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
    expect(out.includes('## [4.0.0] -')).toBe(true);
    // The heading must be immediately followed by the next release section: an
    // empty version section, exactly like [3.28.2] and [3.28.1] in the real file.
    expect(out).toContain('## [4.0.0] - 2026-03-04\n\n## [3.30.2] - 2026-08-21');
  });

  test('with zero fragments, --release is byte-identical to the perl line it replaces', () => {
    // .github/workflows/release-train.yml, "Open the version-bump PR" step:
    //   perl -0pi -e "s/^## \[Unreleased\]/## [Unreleased]\n\n## [$NEXT] - $(date -u +%F)/m" CHANGELOG.md
    // Run against the REAL CHANGELOG.md, which today carries hand-written bullets
    // under [Unreleased] — the migration case that actually matters.
    const real = readFileSync(join(repo, 'CHANGELOG.md'), 'utf8');
    const viaPerl = real.replace(/^## \[Unreleased\]/m, '## [Unreleased]\n\n## [9.9.9] - 2026-01-02');

    const root = fresh({}, real);
    const { code } = assemble('--root', root, '--release', '9.9.9', '--date', '2026-01-02');
    expect(code).toBe(0);
    expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')).toBe(viaPerl);
  });

  test('the shared surface list has not drifted from release-train.yml DAEMON_PATHSPEC', async () => {
    const { DAEMON_PATHSPEC } = await import('../../scripts/lib/user-visible-surfaces.mjs');
    const wf = readFileSync(join(repo, '.github', 'workflows', 'release-train.yml'), 'utf8');
    const m = wf.match(/^ {2}DAEMON_PATHSPEC: >-\n((?: {4}.*\n)+)/m);
    expect(m).not.toBeNull();
    const fromWorkflow = m[1].trim().split(/\s+/);
    expect(fromWorkflow).toEqual(DAEMON_PATHSPEC);
  });

  // --------------------------------------------------------------- the teeth

  test('an unknown type token fails, naming the file, the token and the accepted set', () => {
    const root = fresh({ '9801-relay-budgets.md': 'type: feat\n\n- **Thing.** Prose.\n' });
    const { code, stderr } = assemble('--root', root);
    expect(code).toBe(1);
    expect(stderr).toMatch(/changelog\.d\/9801-relay-budgets\.md:1/);
    expect(stderr).toMatch(/`type: feat`/);
    expect(stderr).toMatch(/added, changed, deprecated, removed, fixed, security/);
  });

  test('a malformed filename fails, naming the file', () => {
    const root = fresh({ 'New Entry.md': 'type: added\n\n- **Thing.** Prose.\n' });
    const { code, stderr } = assemble('--root', root);
    expect(code).toBe(1);
    expect(stderr).toMatch(/changelog\.d\/New Entry\.md/);
    expect(stderr).toMatch(/filename must match/);
  });

  test('a body that does not start with `- ` fails', () => {
    const root = fresh({ '9803-no-bullet.md': 'type: added\n\nNot a bullet at all.\n' });
    const { code, stderr } = assemble('--root', root);
    expect(code).toBe(1);
    expect(stderr).toMatch(/changelog\.d\/9803-no-bullet\.md:3/);
    expect(stderr).toMatch(/bullet/);
  });

  test('a blank line inside the body fails (one bullet is one physical line)', () => {
    const root = fresh({ '9804-blank.md': 'type: added\n\n- **A.** B.\n\n- **C.** D.\n' });
    const { code, stderr } = assemble('--root', root);
    expect(code).toBe(1);
    expect(stderr).toMatch(/blank line inside the body/);
  });

  test('every offender is reported, not just the first', () => {
    const root = fresh({
      '9801-a.md': 'type: feat\n\n- **A.** B.\n',
      '9802-b.md': 'type: bogus\n\n- **C.** D.\n',
      'Bad Name.md': 'type: added\n\n- **E.** F.\n',
    });
    const { code, stderr } = assemble('--root', root);
    expect(code).toBe(1);
    expect(stderr).toMatch(/3 malformed fragment\(s\)/);
    expect(stderr).toMatch(/9801-a\.md/);
    expect(stderr).toMatch(/9802-b\.md/);
    expect(stderr).toMatch(/Bad Name\.md/);
  });

  test('a malformed fragment makes --release refuse (exit 2) and write NOTHING', () => {
    const root = fresh({ '9801-a.md': 'type: feat\n\n- **A.** B.\n' });
    const before = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
    const { code } = assemble('--root', root, '--release', '5.0.0', '--date', '2026-05-05');
    expect(code).toBe(2);
    // No silently-wrong section, and the fragment is not consumed.
    expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')).toBe(before);
    expect(readdirSync(join(root, 'changelog.d'))).toEqual(['9801-a.md']);
  });

  test('changelog.d/README.md is not treated as a fragment', () => {
    const root = fresh({
      'README.md': '# not a fragment\n\nJust docs.\n',
      '1-a.md': 'type: added\n\n- **A.** B.\n',
    });
    const { code, stdout } = assemble('--root', root);
    expect(code).toBe(0);
    expect(stdout).toMatch(/1 fragment\(s\) clean/);
  });

  // ------------------------------------------------------------- idempotency

  test('--release refuses a version that is already dated, and writes nothing', () => {
    const root = fresh({ '1-a.md': 'type: added\n\n- **A.** B.\n' });
    expect(assemble('--root', root, '--release', '9.9.9', '--date', '2026-01-02').code).toBe(0);
    const after = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
    const second = assemble('--root', root, '--release', '9.9.9', '--date', '2026-01-02');
    expect(second.code).toBe(2);
    expect(second.stderr).toMatch(/already has a dated/);
    expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')).toBe(after);
  });

  test('identical inputs produce byte-identical output (no time/git dependence)', () => {
    const frags = {
      '9752-a.md': 'type: added\n\n- **A.** B.\n',
      '9801-b.md': 'type: fixed\n\n- **C.** D.\n',
    };
    const r1 = fresh({ ...frags });
    const r2 = fresh({ ...frags });
    assemble('--root', r1, '--release', '9.9.9', '--date', '2026-01-02');
    assemble('--root', r2, '--release', '9.9.9', '--date', '2026-01-02');
    expect(readFileSync(join(r1, 'CHANGELOG.md'), 'utf8'))
      .toBe(readFileSync(join(r2, 'CHANGELOG.md'), 'utf8'));
  });

  // ----------------------------------------------------------------- ordering

  test('ordering is by filename alone: PR number ascending, draft- last', () => {
    const root = fresh({
      '9801-b.md': 'type: added\n\n- b-9801\n',
      '9752-a.md': 'type: added\n\n- a-9752\n',
      'draft-x.md': 'type: added\n\n- x-draft\n',
    });
    const { stdout } = assemble('--root', root, '--print');
    expect(stdout).toBe(['### Added', '- a-9752', '- b-9801', '- x-draft', ''].join('\n'));
  });

  test('PR numbers sort numerically, not lexically', () => {
    const root = fresh({
      '100-b.md': 'type: added\n\n- hundred\n',
      '9-a.md': 'type: added\n\n- nine\n',
    });
    const { stdout } = assemble('--root', root, '--print');
    expect(stdout).toBe(['### Added', '- nine', '- hundred', ''].join('\n'));
  });

  // ------------------------------------------------------------------ legacy

  test('hand-written bullets under [Unreleased] are reported (migration: warn, exit 0)', () => {
    const legacy = HEAD.replace('## [Unreleased]\n', '## [Unreleased]\n\n### Added\n- **Hand-written.** Prose.\n');
    const root = fresh({}, legacy);
    const { code, stdout } = assemble('--root', root);
    expect(code).toBe(0);
    expect(stdout).toMatch(/hand-written bullet\(s\) still under/);
    expect(stdout).toMatch(/Hand-written/);
  });

  test('legacy bullets come FIRST in their section, fragments after — nothing lost', () => {
    const legacy = HEAD.replace(
      '## [Unreleased]\n',
      '## [Unreleased]\n\n### Added\n- **Hand-written.** Prose.\n\n### Fixed\n- **Legacy fix.** Prose.\n',
    );
    const root = fresh({ '9752-a.md': 'type: added\n\n- **From a fragment.** Prose.\n' }, legacy);
    const { stdout } = assemble('--root', root, '--print');
    expect(stdout).toBe([
      '### Added',
      '- **Hand-written.** Prose.',
      '- **From a fragment.** Prose.',
      '',
      '### Fixed',
      '- **Legacy fix.** Prose.',
      '',
    ].join('\n'));
  });

  test('a legacy section with a non-canonical name survives rather than being dropped', () => {
    // The real file carries historical strays (`Docs`, `Tests`, `CI / Build`).
    // Losing prose already in the file would be the exact bug this system exists to stop.
    const legacy = HEAD.replace('## [Unreleased]\n', '## [Unreleased]\n\n### Docs\n- **A stray section.** Prose.\n');
    const root = fresh({ '1-a.md': 'type: added\n\n- **A.** B.\n' }, legacy);
    const { stdout } = assemble('--root', root, '--print');
    expect(stdout).toBe(['### Added', '- **A.** B.', '', '### Docs', '- **A stray section.** Prose.', ''].join('\n'));
  });

  // ------------------------------------------------------------------- notes

  test('--notes prints a version section body, for gh release --notes-file', () => {
    const root = fresh({});
    const { code, stdout } = assemble('--root', root, '--notes', '3.30.2');
    expect(code).toBe(0);
    expect(stdout.trim()).toBe(['### Added', '- **An older entry.** Prose that must survive untouched.'].join('\n'));
  });

  test('--notes for a version with no section fails loudly', () => {
    const root = fresh({});
    const { code, stderr } = assemble('--root', root, '--notes', '1.1.1');
    expect(code).toBe(1);
    expect(stderr).toMatch(/no dated `## \[1\.1\.1\] -` section/);
  });

  // ------------------------------------ the PR gate's changelog-fragment rule

  describe('the fragment requirement in check-pr-requirements.mjs', () => {
    const body = [
      '## Summary',
      'A real summary with plenty of prose to clear the ten-word floor comfortably.',
      '## Test Plan',
      'Ran the unit suite and exercised the empty, malformed and oversize edges here.',
    ].join('\n');

    const gate = (...args) => run(prGate, '--body', body, ...args);

    test('RED: a user-visible diff with no fragment fails, naming the files', () => {
      const { code, stderr } = gate('--changed', 'lib/roadmap-items.ts,cli/commands/roadmap.ts');
      expect(code).toBe(1);
      expect(stderr).toMatch(/User-visible surface changed/);
      expect(stderr).toMatch(/lib\/roadmap-items\.ts/);
      expect(stderr).toMatch(/changelog\.d\/<pr>-<slug>\.md/);
    });

    test('GREEN: the same diff with a fragment added passes', () => {
      const { code, stdout } = gate('--changed', 'lib/roadmap-items.ts,cli/commands/roadmap.ts,changelog.d/9810-roadmap.md');
      expect(code).toBe(0);
      expect(stdout).toMatch(/meets the contract/);
    });

    test('changelog.d/README.md alone does NOT count as a fragment', () => {
      const { code, stderr } = gate('--changed', 'lib/roadmap-items.ts,changelog.d/README.md');
      expect(code).toBe(1);
      expect(stderr).toMatch(/User-visible surface changed/);
    });

    test('GREEN: an audited changelog-exempt marker passes', () => {
      const exempt = `${body}\n\n<!-- changelog-exempt: internal refactor, no behaviour reaches a user -->`;
      const { code } = run(prGate, '--body', exempt, '--changed', 'lib/roadmap-items.ts');
      expect(code).toBe(0);
    });

    test('a changelog-exempt marker with an EMPTY reason does not exempt', () => {
      const exempt = `${body}\n\n<!-- changelog-exempt: -->`;
      const { code, stderr } = run(prGate, '--body', exempt, '--changed', 'lib/roadmap-items.ts');
      expect(code).toBe(1);
      expect(stderr).toMatch(/User-visible surface changed/);
    });

    test.each([
      ['tests-only', 'tests/unit/roadmap.test.js'],
      ['markdown-only', 'docs/VERSIONING.md,AGENTS.md'],
      ['plumbing-only (a devDependency bump)', 'package.json,package-lock.json'],
      ['nowhere near a user-visible surface', 'scripts/some-internal-tool.mjs'],
    ])('auto-skip: %s needs no fragment', (_label, changed) => {
      const { code } = gate('--changed', changed);
      expect(code).toBe(0);
    });

    test('auto-skip: the release train bump by title (package.json is in DAEMON_PATHSPEC)', () => {
      const { code } = gate('--changed', 'package.json,server.ts', '--title', 'chore(release): bump to 3.31.0');
      expect(code).toBe(0);
    });

    test('auto-skip: the release train bump by author', () => {
      const { code } = gate('--changed', 'package.json,server.ts', '--author', 'port-daddy-release-train');
      expect(code).toBe(0);
    });

    test('a NON-release commit touching server.ts still needs a fragment', () => {
      // Guards the auto-skip above: it must key on the release train, not on
      // "package.json was touched".
      const { code, stderr } = gate('--changed', 'package.json,server.ts', '--title', 'feat: add a route');
      expect(code).toBe(1);
      expect(stderr).toMatch(/User-visible surface changed/);
    });
  });
});
