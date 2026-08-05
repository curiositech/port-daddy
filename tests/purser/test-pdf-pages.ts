import { test, expect } from 'vitest';
import { comparePDFPages } from '../lib/pdf-comparator';

test('PDF pages 14-15 match committed artifact', async () => {
  const expectedPages = ['14', '15'];
  const results = await Promise.all(
    expectedPages.map(page => 
      comparePDFPages('website-v2/public/whitepaper/spawn-to-person-whitepaper.pdf', page)
    )
  );
  
  results.forEach((match, i) => {
    expect(match).toBe(true, `Page ${expectedPages[i]} does not match expected content`);
  });
});