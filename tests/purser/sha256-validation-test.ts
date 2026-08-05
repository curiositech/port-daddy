import { describe, test, expect } from 'bun:test';
import { validateSha256 } from '../../website-v2/scripts/check-whitepaper-metadata.ts';

describe('SHA-256 validation', () => {
  test('Fails on incorrect hash', () => {
    const invalidHash = '0000000000000000000000000000000000000000000000000000000000000000';
    expect(() => validateSha256(invalidHash)).toThrow('Hash mismatch');
  });

  test('Accepts correct hash', () => {
    const validHash = '60d6409f1f1564770f3f5c8c718cc145538b9365952971709d9fb1951171f8f4';
    expect(() => validateSha256(validHash)).not.toThrow();
  });
});