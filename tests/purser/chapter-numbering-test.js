import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test, expect } from '@jest/globals';

const repoRoot = resolve(__dirname, '../../');
const preamblePath = resolve(repoRoot, 'website-v2/public/whitepaper/coordination-papers-mega-volume-preamble.tex');

describe('Chapter-local numbering', () => {
  test('preserves numbering across chapters and appendices', () => {
    const buildDir = resolve(repoRoot, '.cache/chapter-numbering-test');
    const fixturePath = resolve(buildDir, 'numbering.tex');
    rmSync(buildDir, { recursive: true, force: true });
    mkdirSync(buildDir, { recursive: true });

    writeFileSync(
      fixturePath,
      `\documentclass{article}
\input{${preamblePath}}
\begin{document}
\pdchapter{I}{Chapter I}
\section{Section 1}
\pdchapter{II}{Chapter II}
\section{Section 1}
\pdchapterappendix
\section{Appendix A}
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

    const log = readFileSync(resolve(buildDir, 'numbering.log'), 'utf8');
    expect(log).not.toMatch(/Undefined control sequence/);
    expect(log).toMatch(/Chapter II/);
    expect(log).toMatch(/Appendix A/);
  });
});