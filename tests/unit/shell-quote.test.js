import { describe, test, expect } from '@jest/globals';
import { assertSafeId, posixShellQuote, fishShellQuote } from '../../lib/shell-quote.js';

describe('posixShellQuote', () => {
  test('plain alphanumeric is single-quoted unchanged', () => {
    expect(posixShellQuote('abc123')).toBe("'abc123'");
  });

  test('single quote inside is escaped as the POSIX idiom', () => {
    expect(posixShellQuote("it's")).toBe("'it'\\''s'");
  });

  test('shell metacharacters are neutralised', () => {
    for (const meta of ['$VAR', '`cmd`', '$(cmd)', '; rm -rf /', '&& evil']) {
      const quoted = posixShellQuote(meta);
      // Must be wrapped in single quotes — nothing else neutralises these.
      expect(quoted.startsWith("'")).toBe(true);
      expect(quoted.endsWith("'")).toBe(true);
    }
  });
});

describe('fishShellQuote', () => {
  test('plain value is single-quoted unchanged', () => {
    expect(fishShellQuote('hello')).toBe("'hello'");
  });

  test('single quote is escaped with backslash (fish rule)', () => {
    expect(fishShellQuote("it's")).toBe("'it\\'s'");
  });

  test('backslash is doubled', () => {
    expect(fishShellQuote('a\\b')).toBe("'a\\\\b'");
  });
});

describe('assertSafeId', () => {
  test('valid UUIDs and semantic identities pass', () => {
    const valid = [
      'abc123',
      'project:stack:context',
      'a-b-c/d_e.f',
      '550e8400-e29b-41d4-a716-446655440000',
    ];
    for (const v of valid) {
      expect(() => assertSafeId(v, 'test')).not.toThrow();
    }
  });

  test('spaces throw', () => {
    expect(() => assertSafeId('hello world', 'agentId')).toThrow(/agentId/);
  });

  test('shell metacharacters throw', () => {
    for (const bad of ['$(cmd)', '`cmd`', '; rm', '&& evil', '\n']) {
      expect(() => assertSafeId(bad, 'agentId')).toThrow();
    }
  });

  test('empty string throws', () => {
    expect(() => assertSafeId('', 'sessionId')).toThrow(/sessionId/);
  });

  test('value over 256 chars throws', () => {
    expect(() => assertSafeId('a'.repeat(257), 'agentId')).toThrow();
  });
});
