import { test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const WHITE_PAPERS_PATH = 'website-v2/src/data/whitePapers.ts';
const PDF_PATH = 'website-v2/public/whitepaper/spawn-to-person-whitepaper.pdf';

test('Whitepaper metadata matches declared properties', () => {
  const metadata = require(WHITE_PAPERS_PATH).WHITE_PAPERS[0];
  
  expect(metadata.status).toBe('Version 1.4 (collected-volume edition)');
  expect(metadata.pages).toBe(35);
  expect(metadata.sizeKb).toBe(618);
  
  // Verify PDF metadata matches (simplified example)
  const pdfStats = fs.statSync(PDF_PATH);
  expect(pdfStats.size).toBe(618 * 1024); // 618KB
});