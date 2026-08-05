import { describe, test, expect } from 'bun:test';
import { validateWhitepaperMetadata } from '../../website-v2/scripts/check-whitepaper-metadata.ts';

describe('Whitepaper metadata validation', () => {
  test('Fails on incorrect page count', () => {
    const invalidMetadata = { pages: 34, sizeKb: 618, status: 'Version 1.4' };
    expect(() => validateWhitepaperMetadata(invalidMetadata)).toThrow('Page count mismatch');
  });

  test('Accepts correct metadata', () => {
    const validMetadata = { pages: 35, sizeKb: 618, status: 'Version 1.4 (collected-volume edition)' };
    expect(() => validateWhitepaperMetadata(validMetadata)).not.toThrow();
  });
});