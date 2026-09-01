import fs from 'node:fs';
import crypto from 'node:crypto';

const pdfPaths = {
  'legible-swarm': 'whitepaper/published/legible-swarm-whitepaper.pdf',
  'single-writer-kernel': 'whitepaper/published/single-writer-kernel-whitepaper.pdf'
};

const expectedHashes = {
  'legible-swarm': 'bb5704b0b2acf5f9e6015a130b1578e9c14b2cc6dd6ebe27fffe45fabcd9e639',
  'single-writer-kernel': '2ec6d1ae929e01880320d9d255f887d8635c4b27eb14a965d0d57057f732323c'
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
