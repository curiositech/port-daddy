import { test, expect } from 'vitest';
import { parseFigureContent } from '../lib/figure-parser';

test('Maturity labels reflect technical implementation status', () => {
  const figures = [
    'website-v2/public/whitepaper/figures/fig-stp-honest-state.tex',
    'website-v2/public/whitepaper/figures/fig-stp-three-organs.tex'
  ];
  
  for (const file of figures) {
    const content = parseFigureContent(file);
    
    // Verify BUILTWEAK labels
    expect(content).toContain('\BUILTWEAK').toBe(true);
    
    // Verify DESIGNED labels
    expect(content).toContain('\DESIGNED').toBe(true);
    
    // Verify VISION labels
    expect(content).toContain('\VISION').toBe(true);
  }
});