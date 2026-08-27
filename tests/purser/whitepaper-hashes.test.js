import fs from 'node:fs';
import crypto from 'node:crypto';

const pdfPaths = {
  'legible-swarm': 'website-v2/public/whitepaper/legible-swarm-whitepaper.pdf',
  'single-writer-kernel': 'website-v2/public/whitepaper/single-writer-kernel-whitepaper.pdf'
};

const expectedHashes = {
  'legible-swarm': 'e8c3d393c9258798149d4031f3ae15ff6540575a99601d9f4c253f2a3c3fb83b',
  'single-writer-kernel': '75d135c59aec8b64f36a0b94b66aad4f05da6047f1e72d2b73f44318e5e9acbc'
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