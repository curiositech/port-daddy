const fs = require('fs');
const crypto = require('crypto');

const pdfPaths = {
  'legible-swarm': 'website-v2/public/whitepaper/legible-swarm-whitepaper.pdf',
  'single-writer-kernel': 'website-v2/public/whitepaper/single-writer-kernel-whitepaper.pdf'
};

const expectedHashes = {
  'legible-swarm': 'a8295bb07a3d9287424582de6acd46c9ce00a91a716287447874f0374c6d65f1',
  'single-writer-kernel': '4b43269f0cdb070cb4852a03506c28a218f51ea24fcfff5667520ae9bc3a16d0'
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