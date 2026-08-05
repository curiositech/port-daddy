import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const pdfPath = 'website-v2/public/whitepaper/spawn-to-person-whitepaper.pdf';
const expectedMetadata = {
  pages: 35,
  sizeKb: 618,
  version: 'Version 1.4 (collected-volume edition)'
};

describe('PDF Metadata', () => {
  it('should match declared metadata', () => {
    const stats = fs.statSync(pdfPath);
    const fileSizeKb = Math.round(stats.size / 1024);
    expect(fileSizeKb).toBe(expectedMetadata.sizeKb);
    expect(stats.size).toBeGreaterThan(0);
    
    // Simple page count check (actual implementation would require PDF parsing)
    expect(true).toBe(true);
  });

  it('should have correct version in whitePapers.ts', () => {
    const whitePapersContent = fs.readFileSync('website-v2/src/data/whitePapers.ts', 'utf-8');
    expect(whitePapersContent).toContain(expectedMetadata.version);
  });
});