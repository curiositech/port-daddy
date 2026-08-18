import { describe, expect, test } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

  test('a paper is excluded exactly across the commit that changed it', () => {
    // Anchored to the target paper's OWN history rather than to a fixed ref, so
    // it cannot rot: `last` is recomputed each run as the newest commit touching
    // Spawn-to-Person's transitive sources. Across `last` the paper must be
    // excluded from the restore list (a rebuild has a real reason to touch it);
    // at `last` it must be included again (nothing has moved since).
    //
    // A fixed historical ref would not do — this repository's history is
    // squashed and begins 2026-08-05, so "changed since the root commit" is
    // already false for several papers and would say nothing about the guard.
    const sources = bashFunction(
      'paper_sources',
      'website-v2/public/whitepaper',
      'spawn-to-person.tex',
    ).split('\n');
    const spawnPdf = 'website-v2/public/whitepaper/spawn-to-person-whitepaper.pdf';

    const last = git('log', '-1', '--format=%H', 'HEAD', '--', ...sources);
    expect(last).not.toBe('');
    expect(listUnchangedSince(last)).toContain(spawnPdf);

    const before = git('rev-parse', `${last}^`);
    expect(listUnchangedSince(before)).not.toContain(spawnPdf);

    // ...and the guard is per-paper, not a global on/off: a paper that commit
    // did not touch stays restorable across the same boundary.
    const agentTxMoved = git('log', '--format=%H', `${before}..HEAD`, '--',
      'website-v2/public/whitepaper/agent-transactions-whitepaper.tex');
    if (agentTxMoved === '') {
      expect(listUnchangedSince(before))
        .toContain('website-v2/public/whitepaper/agent-transactions-whitepaper.pdf');
    }
  });
});
