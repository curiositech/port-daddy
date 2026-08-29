import fs from 'node:fs';
import crypto from 'node:crypto';

const pdfPaths = {
  'legible-swarm': 'website-v2/public/whitepaper/legible-swarm-whitepaper.pdf',
  'single-writer-kernel': 'website-v2/public/whitepaper/single-writer-kernel-whitepaper.pdf'
};

const expectedHashes = {
  'legible-swarm': '0f200e575f5624b8826a11c4170bf18bf1e591e1d54710b264b62dfdffb42636',
  'single-writer-kernel': 'd9b133dbfec97e19c00978c6bc6c5f923c62321f828d3c80e923133e0a6dbfee'
};

describe('Whitepaper PDF hash verification', () => {
  Object.entries(pdfPaths).forEach(([name, path]) => {
    test(`SHA-256 hash matches for ${name} paper`, () => {
      const file = fs.readFileSync(path);
      const hash = crypto.createHash('sha256').update(file).digest('hex');
      expect(hash).toBe(expectedHashes[name]);
    });
  });
});
