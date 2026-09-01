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
  return existsSync(buildScript) && readFileSync(buildScript, 'utf8').includes('pdflatex fallback pass');
}

function copyTexTree(from, to) {
  cpSync(from, to, {
    recursive: true,
    filter(path) {
      if (!existsSync(path)) return false;
      return !path.includes('/.cache/') && (!path.includes('.') || path.endsWith('.tex'));
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
  copyTexTree(resolve(subjectRoot, 'whitepaper/source'), resolve(root, 'whitepaper/source'));
  mkdirSync(resolve(root, 'whitepaper/published'), { recursive: true });
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

export function runFallbackBuild(root) {
  const bin = resolve(root, '.cache/fake-bin');
  mkdirSync(bin, { recursive: true });
  for (const name of ['awk', 'cp', 'dirname', 'find', 'grep', 'mkdir', 'perl', 'wc']) {
    symlinkSync(executableOnPath(name), resolve(bin, name));
  }

  const callLog = resolve(root, '.cache/pdflatex-calls.txt');
  const fakePdflatex = resolve(bin, 'pdflatex');
  writeFileSync(
    fakePdflatex,
    `#!/bin/bash
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
printf '%s\n' "$*" >> "$PDLATEX_CALL_LOG"
`,
    'utf8',
  );
  chmodSync(fakePdflatex, 0o755);

  const result = spawnSync(
    '/bin/bash',
    [
      '-c',
      'source "$1"; build_one whitepaper/source spawn-to-person.tex whitepaper/published/spawn-to-person-whitepaper.pdf',
      'whitepaper-test',
      resolve(root, buildScriptRelative),
    ],
    {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PATH: bin, PDLATEX_CALL_LOG: callLog },
    },
  );
  return {
    ...result,
    calls: existsSync(callLog) ? readFileSync(callLog, 'utf8').trim().split('\n').filter(Boolean) : [],
  };
}
