import { describe, test, expect } from 'bun:test';
import { checkFigureLayout } from '../../website-v2/scripts/check-figure-layout.mjs';

describe('Figure layout validation', () => {
  test('Detects overfull box', () => {
    const latexCode = '\begin{figure}\centering\includegraphics[width=1.1\textwidth]{example.png}\end{figure}';
    expect(() => checkFigureLayout(latexCode)).toThrow('Overfull \hbox detected');
  });

  test('Accepts properly sized figure', () => {
    const latexCode = '\begin{figure}\centering\includegraphics[width=0.9\textwidth]{example.png}\end{figure}';
    expect(() => checkFigureLayout(latexCode)).not.toThrow();
  });
});