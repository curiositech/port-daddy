import { test, expect } from 'vitest';
import { validateFigureColors } from '../lib/figure-validator';

test('All whitepaper figures use AAA brand palette', async () => {
  const figures = ['fig-stp-honest-state.tex', 'fig-stp-keystone-split.tex', 'fig-stp-three-organs.tex'];
  const results = await Promise.all(figures.map(f => validateFigureColors(f)));
  
  results.forEach((valid, i) => {
    expect(valid).toBe(true, `Figure ${figures[i]} failed color validation`);
  });
});