import fs from 'node:fs';
import crypto from 'node:crypto';

const pdfPaths = {
  'legible-swarm': 'website-v2/public/whitepaper/legible-swarm-whitepaper.pdf',
  'single-writer-kernel': 'website-v2/public/whitepaper/single-writer-kernel-whitepaper.pdf'
};

const expectedHashes = {
  'legible-swarm': '8a337dcbef7aee093fe7e067395ff747e16cae44e7082a417113fbceb583da86',
  'single-writer-kernel': '886b72706ac9164a6f0b82fc524d4513f1870948f8b10489abd8418f4a4eabea'
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
