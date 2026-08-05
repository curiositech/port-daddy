const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PDF_PATH = path.join(__dirname, '../../website-v2/public/whitepaper/single-writer-kernel-whitepaper.pdf');
const EXPECTED_SHA = 'dd0ee0506e721658a21780b6f4d27d6255e5c739d5c826f7275d8bb2144a1a77';

describe('PDF Checksum Audit', () => {
  it('should verify PDF SHA-256 matches implementation metadata', () => {
    const file = fs.readFileSync(PDF_PATH);
    const hash = crypto.createHash('sha256').update(file).digest('hex');
    expect(hash).toBe(EXPECTED_SHA);
  });
});