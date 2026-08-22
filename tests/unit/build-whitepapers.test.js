import { describe, expect, test } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repoRoot = process.cwd();
const buildScript = join(repoRoot, 'scripts', 'build-whitepapers.sh');

function bashFunction(functionName, ...args) {
  return execFileSync(
    '/bin/bash',
    ['-c', 'source "$1"; shift; "$@"', 'whitepaper-test', buildScript, functionName, ...args],
    { cwd: repoRoot, encoding: 'utf8' },
  ).trim();
}

function git(...args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function listUnchangedSince(ref) {
  return execFileSync('/bin/bash', [buildScript, '--list-unchanged-since', ref], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter(Boolean);
}

describe('reproducible whitepaper source scoping', () => {
  test('Spawn to Person depends only on its root and imported stp figures', () => {
    const sources = bashFunction(
      'paper_sources',
      'website-v2/public/whitepaper',
      'spawn-to-person.tex',
    ).split('\n');

    expect(sources[0]).toBe('website-v2/public/whitepaper/spawn-to-person.tex');
    expect(sources).toHaveLength(14);
    expect(sources).toContain(
      'website-v2/public/whitepaper/figures/fig-stp-rate-the-raters.tex',
    );
    expect(sources.slice(1).every((source) => source.includes('/figures/fig-stp-')))
      .toBe(true);
    expect(sources.some((source) => source.includes('fig-anchor-'))).toBe(false);
  });

  test('another paper excludes Spawn to Person figures from its epoch', () => {
    const sources = bashFunction(
      'paper_sources',
      'website-v2/public/whitepaper',
      'anchor-protocol-whitepaper.tex',
    ).split('\n');

    expect(sources).toContain(
      'website-v2/public/whitepaper/figures/fig-anchor-four-phases.tex',
    );
    expect(sources.some((source) => source.includes('/figures/fig-stp-'))).toBe(false);
  });

  test('paper_epoch equals the maximum source commit author time', () => {
    const sources = bashFunction(
      'paper_sources',
      'website-v2/public/whitepaper',
      'spawn-to-person.tex',
    ).split('\n');
    const authorTimes = execFileSync(
      'git',
      ['log', '--format=%at', 'HEAD', '--', ...sources],
      { cwd: repoRoot, encoding: 'utf8' },
    ).trim().split('\n').filter(Boolean).map(Number);
    const expected = String(Math.max(...authorTimes));
    const actual = bashFunction(
      'paper_epoch',
      'website-v2/public/whitepaper',
      'spawn-to-person.tex',
    );

    expect(actual).toBe(expected);
  });

  test('builder uses a stable output path for deterministic PDF trailer IDs', () => {
    const script = readFileSync(buildScript, 'utf8');

    expect(script).toContain('BUILD_DIR="$REPO_ROOT/.cache/whitepaper-build"');
    expect(script).not.toContain('mktemp -d');
  });

  test('builder fails clearly when neither TeX driver is installed', () => {
    const script = readFileSync(buildScript, 'utf8');

    expect(script).toContain('if ! command -v pdflatex >/dev/null 2>&1; then');
    expect(script).toContain('error: whitepaper build requires latexmk or pdflatex');
    expect(script).toContain('exit 127');
  });

  // The renderer is byte-stable only within one TeX Live version. A builder
  // change forces CI to rebuild every paper, and on 2026-08-18 that restated
  // five untouched PDFs in a newer PGF's dialect (line widths `0.39851` where
  // the committed render had `0.3985`) and broke the Chapter III digests pinned
  // in tests/unit/spawn-whitepaper-contract.test.js. The workflow restores
  // whatever `--list-unchanged-since` names, so the list must be right in BOTH
  // directions: miss a drifted paper and the churn returns, name a genuinely
  // rebuilt one and its real render is silently thrown away.
  test('with no source change since the ref, every paper is restorable', () => {
    // Order follows the PAPERS table, so this also pins that the CLI walks the
    // whole table rather than stopping at the first match.
    expect(listUnchangedSince(git('rev-parse', 'HEAD'))).toEqual([
      'website-v2/public/whitepaper/agent-transactions-whitepaper.pdf',
      'website-v2/public/whitepaper/anchor-protocol-whitepaper.pdf',
      'website-v2/public/whitepaper/federated-harbor-whitepaper.pdf',
      'website-v2/public/whitepaper/harbor-economy-whitepaper.pdf',
      'website-v2/public/whitepaper/spawn-to-person-whitepaper.pdf',
      'website-v2/public/whitepaper/legible-swarm-whitepaper.pdf',
      'website-v2/public/whitepaper/single-writer-kernel-whitepaper.pdf',
    ]);
  });

  // The bidirectional case runs against a purpose-built repository rather than
  // this one's history. `unit-tests` checks out at depth 1, so `<sha>^` is not
  // resolvable there — an earlier version of this test anchored to the commit
  // that last touched Spawn-to-Person and passed locally while failing in CI for
  // that reason alone. Deepening the checkout would slow every job in the matrix
  // to serve one test; building the two-commit history the assertion actually
  // needs costs nothing and pins the same behaviour.
  //
  // `PAPERS` is overridden after sourcing, so this exercises the real
  // `list_unchanged_since` / `paper_changed_since` against real git history —
  // only the paper table is synthetic.
  test('a paper is excluded exactly when its own source moved', () => {
    const dir = mkdtempSync(join(tmpdir(), 'whitepaper-scope-'));
    const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
    try {
      g('init', '-q', '-b', 'main');
      g('config', 'user.email', 'test@example.invalid');
      g('config', 'user.name', 'whitepaper test');
      mkdirSync(join(dir, 'papers'), { recursive: true });
      writeFileSync(join(dir, 'papers', 'alpha.tex'), '\\documentclass{article}\n');
      writeFileSync(join(dir, 'papers', 'beta.tex'), '\\documentclass{article}\n');
      g('add', '-A');
      g('commit', '-qm', 'both papers');
      const base = g('rev-parse', 'HEAD');

      // Only beta moves.
      writeFileSync(join(dir, 'papers', 'beta.tex'), '\\documentclass{article}\n% revised\n');
      g('add', '-A');
      g('commit', '-qm', 'revise beta');

      const listed = execFileSync(
        '/bin/bash',
        ['-c',
          'source "$1"; cd "$2"; PAPERS=("papers|alpha.tex|out/alpha.pdf" "papers|beta.tex|out/beta.pdf"); list_unchanged_since "$3"',
          'whitepaper-test', buildScript, dir, base],
        { encoding: 'utf8' },
      ).trim().split('\n').filter(Boolean);

      // alpha is restorable (a rebuild would only be restating it); beta is not,
      // because its render genuinely changed and must survive.
      expect(listed).toEqual(['out/alpha.pdf']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
