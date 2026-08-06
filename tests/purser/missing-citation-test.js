import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test, expect } from '@jest/globals';

const repoRoot = resolve(__dirname, '../../');
const preamblePath = resolve(repoRoot, 'website-v2/public/whitepaper/coordination-papers-mega-volume-preamble.tex');

describe('Missing citation handling', () => {
  test('fails on undefined citation', () => {
    const buildDir = resolve(repoRoot, '.cache/missing-citation-test');
    const fixturePath = resolve(buildDir, 'missing.tex');
    rmSync(buildDir, { recursive: true, force: true });
    mkdirSync(buildDir, { recursive: true });

    writeFileSync(
      fixturePath,
      `\documentclass{article}
\input{${preamblePath}}
\begin{document}
\pdchapter{I}{Test Chapter}
\cite{missing}
\end{document}`
    );

    const result = spawnSync('pdflatex', [
      '-interaction=nonstopmode',
      '-halt-on-error',
      `-output-directory=${buildDir}`,
      fixturePath
    ], { encoding: 'utf8' });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('There were undefined citations');
  });
});