import {
  accessSync,
  chmodSync,
  constants,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const subjectRoot = resolve(process.env.MEGA_VOLUME_SUBJECT_ROOT ?? repoRoot);

const generatorRelative = 'scripts/generate-mega-whitepaper.mjs';
const buildScriptRelative = 'scripts/build-whitepapers.sh';
export function subjectAvailable() {
  return existsSync(resolve(subjectRoot, generatorRelative));
}

export function fallbackAvailable() {
  if (!subjectAvailable()) return false;
  const buildScript = resolve(subjectRoot, buildScriptRelative);
  // The fallback loop prints "<engine> fallback pass N/4"; the engine is a
  // literal pdflatex in older scripts and a variable once the Book moved to xelatex.
  return existsSync(buildScript) && /(pdflatex|\$engine) fallback pass/u.test(readFileSync(buildScript, 'utf8'));
}

function copyTexTree(from, to) {
  cpSync(from, to, {
    recursive: true,
    filter(path) {
      if (!existsSync(path)) return false;
      return !path.includes('/.cache/') && (!path.includes('.') || path.endsWith('.tex') || path.endsWith('.json'));
    },
  });
}

export function makeFixture() {
  const cacheRoot = resolve(repoRoot, '.cache/purser-mega-volume-tests');
  mkdirSync(cacheRoot, { recursive: true });
  const root = mkdtempSync(join(cacheRoot, 'fixture-'));

  mkdirSync(resolve(root, 'scripts'), { recursive: true });
  cpSync(resolve(subjectRoot, generatorRelative), resolve(root, generatorRelative));
  if (existsSync(resolve(subjectRoot, buildScriptRelative))) {
    cpSync(resolve(subjectRoot, buildScriptRelative), resolve(root, buildScriptRelative));
  }
  copyTexTree(resolve(subjectRoot, 'whitepaper'), resolve(root, 'whitepaper'));
  copyTexTree(
    resolve(subjectRoot, 'website-v2/public/whitepaper'),
    resolve(root, 'website-v2/public/whitepaper'),
  );
  return root;
}

export function cleanupFixture(root) {
  rmSync(root, { recursive: true, force: true });
}

export function runGenerator(root) {
  const output = resolve(root, '.cache/generated');
  const result = spawnSync(process.execPath, [resolve(root, generatorRelative), output], {
    cwd: root,
    encoding: 'utf8',
  });
  return { ...result, output };
}

export function readFixture(root, relative) {
  return readFileSync(resolve(root, relative), 'utf8');
}

export function writeFixture(root, relative, contents) {
  writeFileSync(resolve(root, relative), contents, 'utf8');
}

export function injectAfterDocumentStart(root, relative, addition) {
  const source = readFixture(root, relative);
  if (!source.includes('\\begin{document}')) {
    throw new Error(`${relative} has no document start`);
  }
  writeFixture(root, relative, source.replace('\\begin{document}', `\\begin{document}\n${addition}`));
}

function executableOnPath(name) {
  for (const directory of (process.env.PATH ?? '').split(':')) {
    const candidate = resolve(directory, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next PATH entry.
    }
  }
  throw new Error(`required test command is unavailable: ${name}`);
}

/**
 * Runs `build-whitepapers.sh <filter>` inside the fixture with `latexmk`
 * absent from PATH, so the bounded pdflatex/xelatex fallback loop in
 * `build_one()` is what actually renders. Every reachable row today is a
 * Book edition (xelatex) — the eight chapters that used to build on plain
 * pdflatex are retired — so both engine binaries are faked identically and
 * `node` is passed through for the Book's body/bibliography generator step.
 */
export function runFallbackBuild(root, { filter = 'coordination-papers-mega-volume', engine = 'xelatex' } = {}) {
  const bin = resolve(root, '.cache/fake-bin');
  mkdirSync(bin, { recursive: true });
  for (const name of ['awk', 'cp', 'dirname', 'find', 'grep', 'mkdir', 'node', 'perl', 'wc']) {
    symlinkSync(executableOnPath(name), resolve(bin, name));
  }

  const callLog = resolve(root, '.cache/engine-calls.txt');
  const fakeEngineScript = `#!/bin/bash
set -eu
outdir=''
tex=''
for arg in "$@"; do
  case "$arg" in
    -output-directory=*) outdir="\${arg#*=}" ;;
    *.tex) tex="$arg" ;;
  esac
done
base="\${tex%.tex}"
mkdir -p "$outdir"
: > "$outdir/$base.log"
printf 'fixture pdf\n' > "$outdir/$base.pdf"
printf '%s\n' "$*" >> "$ENGINE_CALL_LOG"
`;
  // Both engines are faked identically regardless of which one this run
  // targets — build_one() picks the engine from the root's own filename, and
  // faking only the one currently in use keeps this helper correct if a
  // future paper ever reintroduces a plain-pdflatex root.
  for (const name of ['pdflatex', 'xelatex']) {
    const fakeEngine = resolve(bin, name);
    writeFileSync(fakeEngine, fakeEngineScript, 'utf8');
    chmodSync(fakeEngine, 0o755);
  }

  const result = spawnSync('/bin/bash', [resolve(root, buildScriptRelative), filter], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PATH: bin, ENGINE_CALL_LOG: callLog },
  });
  return {
    ...result,
    engine,
    calls: existsSync(callLog) ? readFileSync(callLog, 'utf8').trim().split('\n').filter(Boolean) : [],
  };
}
