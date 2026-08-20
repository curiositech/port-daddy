const fs = require('fs');
const crypto = require('crypto');

const pdfPaths = {
  'legible-swarm': 'website-v2/public/whitepaper/legible-swarm-whitepaper.pdf',
  'single-writer-kernel': 'website-v2/public/whitepaper/single-writer-kernel-whitepaper.pdf'
};

const expectedHashes = {
  'legible-swarm': '3b0885cc57908c9ee79746ddbb0bc763b8607eea62399a6cace278c263cd7acc',
  'single-writer-kernel': '8a86d8e949c34e312f9cfd9f2e4ac8ecfe57ab2e72f3884c3314317185aede3b'
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