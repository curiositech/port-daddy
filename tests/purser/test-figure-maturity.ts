import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const figurePaths = [
  'website-v2/public/whitepaper/figures/fig-stp-honest-state.tex',
  'website-v2/public/whitepaper/figures/fig-stp-keystone-split.tex',
  'website-v2/public/whitepaper/figures/fig-stp-three-organs.tex'
];

const expectedMaturityLabels = {
  'fig-stp-honest-state.tex': ['BUILTWEAK', 'BUILT', 'BUILT', 'BUILTWEAK', 'VISION'],
  'fig-stp-keystone-split.tex': ['BUILTWEAK', 'BUILTWEAK', 'VISION'],
  'fig-stp-three-organs.tex': ['BUILT', 'PARTIAL', 'BUILTWEAK']
};

describe('Figure Maturity Labels', () => {
  for (const filePath of figurePaths) {
    const fileName = path.basename(filePath);
    it(`should have correct maturity labels in ${fileName}`, () => {
      const content = fs.readFileSync(filePath, 'utf-8');
      const labels = content.match(/\BUILT|\BUILTWEAK|\DESIGNED|\VISION/g) || [];
      expect(labels).toEqual(expectedMaturityLabels[fileName]);
    });
  }
});