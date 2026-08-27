import fs from 'node:fs';
import crypto from 'node:crypto';

const pdfPaths = {
  'legible-swarm': 'website-v2/public/whitepaper/legible-swarm-whitepaper.pdf',
  'single-writer-kernel': 'website-v2/public/whitepaper/single-writer-kernel-whitepaper.pdf'
};

const expectedHashes = {
  'legible-swarm': '303098c82ff63e30d3a3650023497879185958efd317c84a3354586f0423b986',
  'single-writer-kernel': 'c89b24be0f98959f85460da58a1b0b8766d00d651e46023f3d6c88a191b469f3'
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