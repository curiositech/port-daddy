import { test, expect } from 'vitest';
import { parseLaTeX } from '../lib/latex-parser';

test('All figure references are valid and consistent', async () => {
  const files = [
    'website-v2/public/whitepaper/figures/fig-stp-honest-state.tex',
    'website-v2/public/whitepaper/figures/fig-stp-keystone-split.tex',
    'website-v2/public/whitepaper/figures/fig-stp-three-organs.tex'
  ];
  
  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    const references = parseLaTeX(content);
    
    expect(references.sectionRefs).toContain('\S\ref{sec:organs}');
    expect(references.sectionRefs).toContain('\S\ref{sec:identity}');
    expect(references.sectionRefs).toContain('\S\ref{sec:keystone}');
    
    // Verify theorem/definition citations exist
    expect(references.citations).toContain('\Def\ref{def:oracle}');
    expect(references.citations).toContain('\Thm\ref{thm:necessity}');
  }
});