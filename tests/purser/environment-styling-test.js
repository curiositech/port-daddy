import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test, expect } from '@jest/globals';

const repoRoot = resolve(__dirname, '../../');
const preamblePath = resolve(repoRoot, 'website-v2/public/whitepaper/coordination-papers-mega-volume-preamble.tex');

describe('Environment styling', () => {
  test('applies consistent visual grammar', () => {
    const buildDir = resolve(repoRoot, '.cache/environment-styling-test');
    const fixturePath = resolve(buildDir, 'environments.tex');
    rmSync(buildDir, { recursive: true, force: true });
    mkdirSync(buildDir, { recursive: true });

    writeFileSync(
      fixturePath,
      `\documentclass{article}
\input{${preamblePath}}
\begin{document}
\pdchapter{I}{Test Chapter}
\pullquote{This is a pullquote}
\keyidea{This is a key idea}
\pitfall{This is a pitfall}
\xrefbox{Cross-reference box}
\begin{lsexercises}Exercise 1\end{lsexercises}
\begin{stpexercises}Exercise 2\end{stpexercises}
\begin{heexercises}\item Exercise 3\end{heexercises}
\begin{lsprotocol}{Protocol 1}Body\end{lsprotocol}
\begin{stpprotocol}[Protocol 2]Body\end{stpprotocol}
\begin{heprotocol}Body\end{heprotocol}
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

    const log = readFileSync(resolve(buildDir, 'environments.log'), 'utf8');
    expect(log).not.toMatch(/Undefined control sequence/);
  });
});