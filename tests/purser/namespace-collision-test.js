import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test, expect } from '@jest/globals';

const repoRoot = resolve(__dirname, '../../');
const preamblePath = resolve(repoRoot, 'website-v2/public/whitepaper/coordination-papers-mega-volume-preamble.tex');

describe('Namespace collision detection', () => {
  test('fails on chapter-local label and bibliography key collision', () => {
    const buildDir = resolve(repoRoot, '.cache/namespace-collision-test');
    const fixturePath = resolve(buildDir, 'collision.tex');
    rmSync(buildDir, { recursive: true, force: true });
    mkdirSync(buildDir, { recursive: true });

    writeFileSync(
      fixturePath,
      `\documentclass{article}
\input{${preamblePath}}
\begin{document}
\pdchapter{I}{Test Chapter}
\label{test:label}
\bibliographystyle{plain}
\begin{thebibliography}{9}
\bibitem{test:label} Test citation
\end{thebibliography}
\end{document}`
    );

    const result = spawnSync('pdflatex', [
      '-interaction=nonstopmode',
      '-halt-on-error',
      `-output-directory=${buildDir}`,
      fixturePath
    ], { encoding: 'utf8' });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Label(s) have been referenced but not defined');
  });
});