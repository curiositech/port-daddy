import { describe, expect, test } from '@jest/globals';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
    expect(sources).toHaveLength(16);
    expect(sources).toContain(
      'website-v2/public/whitepaper/figures/pd-figure-language.tex',
    );
    expect(sources).toContain(
      'website-v2/public/whitepaper/figures/fig-stp-deterrence-regime.tex',
    );
    expect(sources).toContain(
      'website-v2/public/whitepaper/figures/fig-stp-rate-the-raters.tex',
    );
    // Every non-root input is either an stp figure, one of the shared
    // figures/pd-*.tex files (palette, textbook map, hyperlinks, figure
    // language), or a shared table fragment figures/tab-*.tex that more than
    // one chapter inputs (the keystone split is drawn once for chapters 5 and 6).
    expect(sources.slice(1).every((source) =>
      source.includes('/figures/fig-stp-')
        || /\/figures\/pd-[a-z-]+\.tex$/.test(source)
        || /\/figures\/tab-[a-z-]+\.tex$/.test(source)))
      .toBe(true);
    expect(sources.some((source) => source.includes('fig-anchor-'))).toBe(false);
  });

  test('the Book depends on textbook.json, the one source of chapter order', () => {
    const sources = bashFunction(
      'paper_sources',
      'website-v2/public/whitepaper',
      'coordination-papers-mega-volume.tex',
    ).split('\n');
    expect(sources).toContain('whitepaper/textbook.json');
    expect(sources).toContain('scripts/generate-mega-whitepaper.mjs');
  });

  test('every analytical paper declares the shared figure language as a source', () => {
    const papers = [
      ['website-v2/public/whitepaper', 'agent-transactions-whitepaper.tex'],
      ['website-v2/public/whitepaper', 'anchor-protocol-whitepaper.tex'],
      ['website-v2/public/whitepaper', 'federated-harbor-whitepaper.tex'],
      ['website-v2/public/whitepaper', 'harbor-economy.tex'],
      ['website-v2/public/whitepaper', 'spawn-to-person.tex'],
      ['whitepaper', 'legible-swarm.tex'],
      ['whitepaper', 'single-writer-kernel.tex'],
    ];

    for (const [srcdir, root] of papers) {
      const sources = bashFunction('paper_sources', srcdir, root).split('\n');
      expect(sources).toContain(
        `${srcdir}/figures/pd-figure-language.tex`,
      );
    }
  });

  test('another paper excludes Spawn to Person figures from its epoch', () => {
    const sources = bashFunction(
      'paper_sources',
      'website-v2/public/whitepaper',
      'anchor-protocol-whitepaper.tex',
    ).split('\n');

    expect(sources).toContain(
      'website-v2/public/whitepaper/figures/fig-anchor-capability-attenuation.tex',
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
      'website-v2/public/whitepaper/sealed-harbor-whitepaper.pdf',
      'website-v2/public/whitepaper/spawn-to-person-whitepaper.pdf',
      'website-v2/public/whitepaper/legible-swarm-whitepaper.pdf',
      'website-v2/public/whitepaper/single-writer-kernel-whitepaper.pdf',
      'website-v2/public/whitepaper/coordination-papers-mega-volume.pdf',
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

  // The collected volume is the one paper whose body is GENERATED before
  // pdflatex runs, so it is the only one with a Node dependency — and the TeX
  // container ships no JavaScript runtime, which is why the workflow installs
  // Node explicitly. If that step is ever dropped the build must say so, not
  // produce a volume missing its generated body.
  //
  // This runs the guard rather than grepping for it: PATH is replaced with a
  // directory holding only the handful of coreutils the function needs before
  // the check, so `node` is genuinely absent. Resolving those tools at runtime
  // keeps it working wherever node happens to live — filtering node's directory
  // out of PATH would break on a system where node sits in /usr/bin next to
  // mkdir.
  test('the collected volume fails loudly when Node.js is unavailable', () => {
    const shimBin = mkdtempSync(join(tmpdir(), 'whitepaper-no-node-'));
    try {
      for (const tool of ['mkdir', 'find', 'dirname', 'rm', 'cp', 'wc']) {
        const found = spawnSync('/bin/sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' });
        const real = found.stdout.trim();
        if (real) symlinkSync(real, join(shimBin, tool));
      }

      const result = spawnSync(
        '/bin/bash',
        ['-c',
          'source "$1"; build_one website-v2/public/whitepaper coordination-papers-mega-volume.tex "$2"',
          'whitepaper-test', buildScript, join(shimBin, 'unused.pdf')],
        { cwd: repoRoot, encoding: 'utf8', env: { ...process.env, PATH: shimBin } },
      );

      expect(spawnSync('/bin/sh', ['-c', 'command -v node'], {
        encoding: 'utf8', env: { ...process.env, PATH: shimBin },
      }).stdout.trim()).toBe('');

      expect(result.status).not.toBe(0);
      expect(`${result.stderr}${result.stdout}`)
        .toContain('Node.js is required to generate the collected-volume');
    } finally {
      rmSync(shimBin, { recursive: true, force: true });
    }
  });

  // The renderer is the other half of reproducibility, and the half that was
  // missing. SOURCE_DATE_EPOCH pinning makes a rebuild of unchanged source
  // byte-identical on the SAME TeX Live; it does nothing across versions. On
  // 2026-08-16 `texlive/texlive:latest` was republished, and the PGF/TikZ update
  // it carried rewrote five PDFs whose sources had not moved.
  test('the whitepaper renderer is pinned by digest, not by a floating tag', () => {
    const workflow = readFileSync(
      join(repoRoot, '.github', 'workflows', 'whitepaper-build.yml'), 'utf8');

    expect(workflow).toMatch(/image:\s*texlive\/texlive@sha256:[0-9a-f]{64}/);
    expect(workflow).not.toMatch(/image:\s*texlive\/texlive:latest/);
  });

  test('a renderer re-pin drives BOTH the rebuild and the restore stand-down', () => {
    // These are two separate decisions and missing either one is silent.
    //
    // Skip the forced rebuild and the incremental path builds nothing at all,
    // because no TeX source moved -- the first attempt at this pin produced a
    // green two-minute build job and shipped the new renderer with the OLD
    // artifacts still committed. Skip the stand-down and the restore reverts the
    // whole re-render. Either way the repository can never adopt a new TeX Live.
    const workflow = readFileSync(
      join(repoRoot, '.github', 'workflows', 'whitepaper-build.yml'), 'utf8');

    expect(workflow).toContain('renderer_changed=1');
    expect(workflow).toMatch(/\^\[-\+\]\[\[:space:\]\]\*image:\[\[:space:\]\]\*texlive\/texlive/);

    // forces the full rebuild, ahead of the --changed-since path
    expect(workflow).toMatch(
      /build_papers\(\)\s*\{\s*\n\s*if \[ "\$renderer_changed" = "1" \]; then\s*\n\s*bash scripts\/build-whitepapers\.sh\s*\n\s*return/);

    // ...and stands the restore down
    expect(workflow).toContain('if [ "$renderer_changed" = "0" ]');

    // detection must precede the builds, or it cannot influence them
    expect(workflow.indexOf('renderer_changed=0'))
      .toBeLessThan(workflow.indexOf('build_papers()'));
  });

  // Raised by pd-qa: the two tests above read the workflow's TEXT. That proves
  // the lines are present, not that the shell does the right thing with them.
  // This runs the real detection block, lifted out of the workflow, against
  // purpose-built git history -- so a regex that silently stops matching, or a
  // comparison against the wrong ref, fails here instead of six minutes into a
  // TeX build.
  function rendererDetection() {
    const workflow = readFileSync(
      join(repoRoot, '.github', 'workflows', 'whitepaper-build.yml'), 'utf8');
    const start = workflow.indexOf('          renderer_changed=0');
    const end = workflow.indexOf('          build_papers()');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return workflow.slice(start, end).replace(/^ {10}/gm, '');
  }

  function detectIn(dir, base) {
    const script = `${rendererDetection()}\necho "RESULT=$renderer_changed"`;
    const out = execFileSync('/bin/sh', ['-c', script], {
      cwd: dir, encoding: 'utf8', env: { ...process.env, base },
    });
    return /RESULT=1/.test(out);
  }

  function workflowRepo(secondLine) {
    const dir = mkdtempSync(join(tmpdir(), 'renderer-pin-'));
    const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 'test@example.invalid');
    g('config', 'user.name', 'renderer test');
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
    const file = join(dir, '.github', 'workflows', 'whitepaper-build.yml');
    writeFileSync(file, 'jobs:\n  build:\n    container:\n      image: texlive/texlive@sha256:aaa\n');
    g('add', '-A'); g('commit', '-qm', 'base');
    const base = g('rev-parse', 'HEAD');
    writeFileSync(file, secondLine);
    g('add', '-A'); g('commit', '-qm', 'second');
    return { dir, base };
  }

  test('renderer detection fires on a real pin change and not otherwise', () => {
    // pin actually changes -> must fire
    const changed = workflowRepo(
      'jobs:\n  build:\n    container:\n      image: texlive/texlive@sha256:bbb\n');
    try {
      expect(detectIn(changed.dir, changed.base)).toBe(true);
    } finally { rmSync(changed.dir, { recursive: true, force: true }); }

    // workflow edited but the image line untouched -> must NOT fire, or every
    // unrelated workflow tweak would force a full rebuild and re-commit all
    // seven PDFs.
    const unrelated = workflowRepo(
      'jobs:\n  build:\n    container:\n      image: texlive/texlive@sha256:aaa\n    timeout-minutes: 30\n');
    try {
      expect(detectIn(unrelated.dir, unrelated.base)).toBe(false);
    } finally { rmSync(unrelated.dir, { recursive: true, force: true }); }
  });

  test('renderer detection tolerates whitespace around the image value', () => {
    // Raised by pd-qa. The regex allows padding on both sides; this proves it
    // rather than asserting it, since a tightened regex would fail closed in the
    // worst way -- silently not rebuilding after a real re-pin.
    const spaced = workflowRepo(
      'jobs:\n  build:\n    container:\n      image:   texlive/texlive@sha256:ccc\n');
    try {
      expect(detectIn(spaced.dir, spaced.base)).toBe(true);
    } finally { rmSync(spaced.dir, { recursive: true, force: true }); }
  });
});
