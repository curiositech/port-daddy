import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test, expect } from '@jest/globals';

const repoRoot = resolve(__dirname, '../../');
const preamblePath = resolve(repoRoot, 'website-v2/public/whitepaper/coordination-papers-mega-volume-preamble.tex');

describe('Two-pass compilation', () => {
  test('succeeds with two pdflatex passes', () => {
    const buildDir = resolve(repoRoot, '.cache/two-pass-test');
    const fixturePath = resolve(buildDir, 'two-pass.tex');
    rmSync(buildDir, { recursive: true, force: true });
    mkdirSync(buildDir, { recursive: true });

    writeFileSync(
      fixturePath,
      `\documentclass{article}
\input{${preamblePath}}
\begin{document}
\pdchapter{I}{Test Chapter}
\section{Section 1}
\begin{definition}This is a definition\end{definition}
\begin{theorem}This is a theorem\end{theorem}
\end{document}`
    );

    for (let pass = 0; pass < 2; pass++) {
      const result = spawnSync('pdflatex', [
        '-interaction=nonstopmode',
        '-halt-on-error',
        `-output-directory=${buildDir}`,
        fixturePath
      ], { encoding: 'utf8' });
      expect(result.status).toBe(0);
    }

    const log = readFileSync(resolve(buildDir, 'two-pass.log'), 'utf8');
    expect(log).not.toMatch(/Undefined control sequence/);
  });
});