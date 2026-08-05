import { readFileSync } from 'fs';
import { createHash } from 'crypto';

const expectedHash = 'a8295bb07a3d9287424582de6acd46c9ce00a91a716287447874f0374c6d65f1';
const filePath = '../../website-v2/public/whitepaper/legible-swarm-whitepaper.pdf';

describe('SHA-256 hash validation', () => {
  test('PDF must have expected SHA-256 hash', () => {
    const data = readFileSync(filePath);
    const hash = createHash('sha256').update(data).digest('hex');
    expect(hash).toBe(expectedHash);
  });
});