import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from '@jest/globals';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const preamblePath = resolve(
  repoRoot,
  'whitepaper/source/coordination-papers-mega-volume-preamble.tex',
);

describe('collected-volume LaTeX preamble', () => {
  test('pins the publication palette and compatibility grammar', () => {
    const preamble = readFileSync(preamblePath, 'utf8');

    for (const color of [
      '\\definecolor{hhink}{HTML}{1B1712}',
      '\\definecolor{hhcobalt}{HTML}{003FB8}',
      '\\definecolor{hhteal}{HTML}{00564C}',
      '\\definecolor{hhamber}{HTML}{6B4500}',
      '\\definecolor{hhpaper}{HTML}{FBF7EF}',
    ]) {
      expect(preamble).toContain(color);
    }

    for (const command of [
      '\\newcommand{\\Built}',
      '\\newcommand{\\BuiltWeak}',
      '\\newcommand{\\Designed}',
      '\\newcommand{\\Vision}',
      '\\newcommand{\\pdchapter}',
      '\\newcommand{\\pdchapterappendix}',
      '\\newcommand{\\pullquote}',
      '\\newcommand{\\xrefbox}',
    ]) {
      expect(preamble).toContain(command);
    }

    for (const environment of [
      '\\newenvironment{lsexercises}',
      '\\newenvironment{stpexercises}',
      '\\newenvironment{heexercises}',
      '\\newenvironment{lsprotocol}',
      '\\newenvironment{stpprotocol}',
      '\\newtheorem{heprotocol}',
    ]) {
      expect(preamble).toContain(environment);
    }
  });

  test('compiles representative chapter, theorem, protocol, and exercise idioms', () => {
    const available = spawnSync('pdflatex', ['--version'], { encoding: 'utf8' });
    if (available.status !== 0) {
      console.warn('pdflatex unavailable; source contract passed and render smoke is deferred to whitepaper CI');
      return;
    }

    const buildDir = resolve(repoRoot, '.cache/whitepaper-mega-preamble-test');
    const fixturePath = resolve(buildDir, 'preamble-smoke.tex');
    rmSync(buildDir, { recursive: true, force: true });
    mkdirSync(buildDir, { recursive: true });
    writeFileSync(
      fixturePath,
      String.raw`\documentclass[11pt,a4paper]{article}
\input{${preamblePath}}
\begin{document}
\pdchapter{T}{Compatibility Smoke}
\section{Status and prose idioms}
\Built\quad\BuiltWeak\quad\Designed\quad\Vision
\pullquote{One compatibility grammar, exercised as rendered LaTeX.}
\xrefbox{Cross-reference boxes and chapter-local numbering remain available.}
\begin{definition}A representative theorem environment.\end{definition}
\begin{lsprotocol}{Local protocol}A bounded protocol body.\end{lsprotocol}
\begin{stpprotocol}[Continuity protocol]A second protocol idiom.\end{stpprotocol}
\begin{heprotocol}An economy protocol idiom.\end{heprotocol}
\begin{lsexercises}Inspect the local authority boundary.\end{lsexercises}
\begin{stpexercises}Restore a witnessed checkpoint.\end{stpexercises}
\begin{heexercises}\item Verify conservation.\end{heexercises}
\begin{tikzpicture}\node[stp accent box]{shared TikZ grammar};\end{tikzpicture}
\pdchapterappendix
\section{Smoke appendix}
Appendix numbering and hyperlink anchors remain defined.
\end{document}
`,
      'utf8',
    );

    for (let pass = 0; pass < 2; pass += 1) {
      const result = spawnSync(
        'pdflatex',
        [
          '-interaction=nonstopmode',
          '-halt-on-error',
          '-file-line-error',
          `-output-directory=${buildDir}`,
          fixturePath,
        ],
        { cwd: dirname(preamblePath), encoding: 'utf8' },
      );
      if (result.status !== 0) {
        throw new Error(`${result.stdout}\n${result.stderr}`);
      }
      expect(result.status).toBe(0);
    }

    const log = readFileSync(resolve(buildDir, 'preamble-smoke.log'), 'utf8');
    expect(log).not.toMatch(/Undefined control sequence|LaTeX Error|Overfull \\hbox/u);
  });
});
