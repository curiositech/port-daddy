import { canonicalJson } from '../../lib/agent-run-receipts';

describe('Canonicalization', () => {
  test('canonicalJson sorts object keys', () => {
    const input = { b: 2, a: 1 };
    expect(canonicalJson(input)).toBe('"{\"a\":1,\"b\":2}"');
  });

  test('canonicalJson handles nested objects', () => {
    const input = { a: { b: 2, c: 1 } };
    expect(canonicalJson(input)).toBe('"{\"a\":{\"b\":2,\"c\":1}}"');
  });
});