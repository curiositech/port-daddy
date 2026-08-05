import fs from 'fs';
import path from 'path';

const FIGURE_PATHS = [
  'website-v2/public/whitepaper/figures/fig-stp-honest-state.tex',
  'website-v2/public/whitepaper/figures/fig-stp-keystone-split.tex',
  'website-v2/public/whitepaper/figures/fig-stp-three-organs.tex'
];

describe('Figure Maturity Labels', () => {
  FIGURE_PATHS.forEach((filePath) => {
    it(`should have correct maturity labels in ${filePath}`, () => {
      const content = fs.readFileSync(path.resolve(__dirname, '../../', filePath), 'utf-8');
      
      // Check specific maturity labels
      expect(content).toContain('\BUILTWEAK &');
      expect(content).toContain('\PARTIAL &');
      expect(content).not.toContain('\DESIGNED &');
    });
  });
});