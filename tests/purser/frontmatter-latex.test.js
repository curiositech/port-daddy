import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const outputDir = resolve('.cache/purser-frontmatter-latex');
const fixture = resolve(outputDir, 'frontmatter-fixture.tex');
const frontmatter = resolve('website-v2/public/whitepaper/coordination-papers-mega-frontmatter.tex');

test('front matter compiles in a representative collected-volume preamble', () => {
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(fixture, String.raw`\documentclass[11pt,a4paper]{article}
\usepackage{lmodern}
\usepackage{microtype}
\usepackage{geometry}
\geometry{margin=2.5cm}
\usepackage{xcolor}
\usepackage{tabularx}
\usepackage{url}
\usepackage{float}
\usepackage{tikz}
\usetikzlibrary{arrows.meta,positioning}
\usepackage[hidelinks]{hyperref}
\definecolor{hhpaper}{HTML}{FBF7EF}
\definecolor{hhink}{HTML}{1B1712}
\definecolor{hhcobalt}{HTML}{003FB8}
\definecolor{hhsand}{HTML}{E9DCC4}
\newcommand{\Built}{\textsc{implemented}}
\newcommand{\BuiltWeak}{\textsc{partial}}
\newcommand{\Designed}{\textsc{specified}}
\newcommand{\Vision}{\textit{proposed}}
\begin{document}
\setlength{\emergencystretch}{2em}
\input{${frontmatter}}
\end{document}
`, 'utf8');

  const args = ['-interaction=nonstopmode', '-halt-on-error', `-output-directory=${outputDir}`, fixture];
  try {
    execFileSync('pdflatex', args, { stdio: 'pipe' });
    execFileSync('pdflatex', args, { stdio: 'pipe' });
    const log = readFileSync(resolve(outputDir, 'frontmatter-fixture.log'), 'utf8');
    assert.doesNotMatch(log, /Overfull \\[hv]box/);
    assert.doesNotMatch(log, /undefined control sequence/i);
    assert.doesNotMatch(log, /Rerun to get cross-references right/);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});
