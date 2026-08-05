import { expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const FIGURE_DIR = join(__dirname, '../../website-v2/public/whitepaper/figures');
const PALETTE_FILE = join(FIGURE_DIR, 'palette.tex');

describe('Figure color palette validation', () => {
  test('Uses AAA brand palette colors', () => {
    const paletteContent = readFileSync(PALETTE_FILE, 'utf-8');
    expect(paletteContent).toContain('\providecolor{hhsand}{HTML}{E9DCC4}');
    expect(paletteContent).toContain('\providecolor{hhsanddeep}{HTML}{D8C7A6}');
    expect(paletteContent).toContain('\providecolor{hhebony}{HTML}{121212}');
  });

  test('Figures reference correct sections', () => {
    const figureFiles = ['fig-stp-honest-state.tex', 'fig-stp-keystone-split.tex', 'fig-stp-three-organs.tex'];
    for (const file of figureFiles) {
      const content = readFileSync(join(FIGURE_DIR, file), 'utf-8');
      expect(content).toContain('\S\ref{sec:organs}');
      expect(content).toContain('\S\ref{sec:identity}');
      expect(content).toContain('\S\ref{sec:keystone}');
    }
  });
});