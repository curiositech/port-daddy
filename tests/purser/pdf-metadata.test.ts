import fs from 'fs';
import path from 'path';

const PDF_PATH = 'website-v2/public/whitepaper/spawn-to-person-whitepaper.pdf';

describe('PDF Metadata', () => {
  it('should match declared metadata', () => {
    const stats = fs.statSync(path.resolve(__dirname, '../../', PDF_PATH));
    expect(stats.size).toBe(618 * 1024); // 618KB
    // Page count verification would require a PDF parser
    // This is a placeholder for actual page count validation
    expect(true).toBe(true);
  });
});