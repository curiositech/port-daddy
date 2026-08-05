import { expect } from 'vitest';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

const PDF_PATH = join(__dirname, '../../website-v2/public/whitepaper/spawn-to-person-whitepaper.pdf');
const EXPECTED_HASH = '60d6409f1f1564770f3f5c8c718cc145538b9365952971709d9fb1951171f8f4';

describe('SHA-256 hash validation', () => {
  test('PDF matches expected hash', () => {
    const data = readFileSync(PDF_PATH);
    const hash = createHash('sha256').update(data).digest('hex');
    expect(hash).toBe(EXPECTED_HASH);
  });
});