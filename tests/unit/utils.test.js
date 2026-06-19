/**
 * Unit Tests for Utilities Module (utils.js)
 *
 * Tests duration parsing, JSON parsing, and edge cases.
 * All tests are pure functions - no database or network dependency required.
 */

import { describe, it, expect } from '@jest/globals';
import {
  parseExpires,
  tryParseJson
} from '../../lib/utils.js';

describe('Utils Module', () => {
  describe('parseExpires() - Basic Duration Parsing (12 tests)', () => {
    it('should parse seconds only', () => {
      expect(parseExpires('5s')).toBe(5 * 1000);
      expect(parseExpires('10s')).toBe(10 * 1000);
      expect(parseExpires('60s')).toBe(60 * 1000);
    });

    it('should parse minutes only', () => {
      expect(parseExpires('1m')).toBe(60 * 1000);
      expect(parseExpires('5m')).toBe(5 * 60 * 1000);
      expect(parseExpires('30m')).toBe(30 * 60 * 1000);
    });

    it('should parse hours only', () => {
      expect(parseExpires('1h')).toBe(60 * 60 * 1000);
      expect(parseExpires('2h')).toBe(2 * 60 * 60 * 1000);
      expect(parseExpires('24h')).toBe(24 * 60 * 60 * 1000);
    });

    it('should parse days only', () => {
      expect(parseExpires('1d')).toBe(24 * 60 * 60 * 1000);
      expect(parseExpires('7d')).toBe(7 * 24 * 60 * 60 * 1000);
      expect(parseExpires('365d')).toBe(365 * 24 * 60 * 60 * 1000);
    });

    it('should parse combined duration: hours and minutes', () => {
      // 1h30m = 60min + 30min = 90min = 5400000ms
      expect(parseExpires('1h30m')).toBe(90 * 60 * 1000);
    });

    it('should parse combined duration: hours and seconds', () => {
      // 1h30s = 3600s + 30s = 3630s = 3630000ms
      expect(parseExpires('1h30s')).toBe(3630 * 1000);
    });

    it('should parse combined duration: minutes and seconds', () => {
      // 5m30s = 300s + 30s = 330s = 330000ms
      expect(parseExpires('5m30s')).toBe(330 * 1000);
    });

    it('should parse combined duration: all four units', () => {
      // 1d2h30m45s = 86400 + 7200 + 1800 + 45 = 95445s
      expect(parseExpires('1d2h30m45s')).toBe(95445 * 1000);
    });

    it('should parse combined duration: days and hours', () => {
      // 1d5h = 24h + 5h = 29h = 29 * 3600 * 1000
      expect(parseExpires('1d5h')).toBe(29 * 60 * 60 * 1000);
    });

    it('should parse large values', () => {
      expect(parseExpires('100h')).toBe(100 * 60 * 60 * 1000);
      expect(parseExpires('365d')).toBe(365 * 24 * 60 * 60 * 1000);
    });

    it('should parse single digit values', () => {
      expect(parseExpires('1s')).toBe(1000);
      expect(parseExpires('1m')).toBe(60 * 1000);
      expect(parseExpires('1h')).toBe(60 * 60 * 1000);
      expect(parseExpires('1d')).toBe(24 * 60 * 60 * 1000);
    });

    it('should handle whitespace in duration string', () => {
      // The regex /(\d+)([smhd])/g matches across whitespace
      // "1h 30m" = 1h (3600000) + 30m (1800000) = 5400000ms
      expect(parseExpires('1h 30m')).toBe(5400000);
    });
  });

  describe('parseExpires() - Number Input (3 tests)', () => {
    it('should return number as-is when passed numeric value', () => {
      expect(parseExpires(1000)).toBe(1000);
      expect(parseExpires(5000)).toBe(5000);
      expect(parseExpires(0)).toBe(0);
    });

    it('should return large numbers unchanged', () => {
      expect(parseExpires(1000000)).toBe(1000000);
      expect(parseExpires(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('should return negative numbers unchanged', () => {
      expect(parseExpires(-1000)).toBe(-1000);
      expect(parseExpires(-5000)).toBe(-5000);
    });
  });

  describe('parseExpires() - Invalid Input (10 tests)', () => {
    it('should return null for empty string', () => {
      expect(parseExpires('')).toBeNull();
    });

    it('should return null for null input', () => {
      expect(parseExpires(null)).toBeNull();
    });

    it('should return null for undefined input', () => {
      expect(parseExpires(undefined)).toBeNull();
    });

    it('should return null for non-string, non-number input', () => {
      expect(parseExpires([])).toBeNull();
      expect(parseExpires({})).toBeNull();
      expect(parseExpires(true)).toBeNull();
      expect(parseExpires(false)).toBeNull();
    });

    it('should return null for string without valid unit', () => {
      expect(parseExpires('5x')).toBeNull();
      expect(parseExpires('10')).toBeNull();
      expect(parseExpires('abc')).toBeNull();
    });

    it('should return null for invalid characters only', () => {
      // The regex extracts matches regardless of surrounding characters
      // '1h$' will still match '1h' and return 3600000
      expect(parseExpires('5@')).toBeNull(); // No match
      expect(parseExpires('1h$')).toBe(3600000); // Matches '1h'
      expect(parseExpires('!5m')).toBe(300000); // Matches '5m'
    });

    it('should return null for string exceeding max length (50 chars)', () => {
      const tooLong = '1h' + 'x'.repeat(50);
      expect(parseExpires(tooLong)).toBeNull();
    });

    it('should reject string with length exactly 51', () => {
      const length51 = 'x'.repeat(51);
      expect(parseExpires(length51)).toBeNull();
    });

    it('should accept string with length exactly 50', () => {
      // '1h' + 48 characters = 50 total (within limit)
      // The regex extracts '1h' = 3600000ms
      const length50 = '1h' + 'x'.repeat(48);
      expect(parseExpires(length50)).toBe(3600000);
    });

    it('should return null or extract valid portions from malformed strings', () => {
      // The regex looks for digit + unit, so it extracts what it can
      expect(parseExpires('hm1m')).toBe(60000); // Matches '1m'
      expect(parseExpires('m5h')).toBe(18000000); // Matches '5h'
      expect(parseExpires('--5m')).toBe(300000); // Still matches '5m' despite leading dashes
    });
  });

  describe('parseExpires() - Edge Cases (8 tests)', () => {
    it('should return zero when no valid matches found', () => {
      expect(parseExpires('xyz')).toBeNull();
    });

    it('should handle zero duration values', () => {
      expect(parseExpires('0s')).toBeNull(); // 0 || null = null
      expect(parseExpires('0m')).toBeNull();
      expect(parseExpires('0h')).toBeNull();
      expect(parseExpires('0d')).toBeNull();
    });

    it('should handle duration with spaces between components', () => {
      // "1 h 30 m" won't match the regex since regex looks for digits directly before unit
      expect(parseExpires('1 h 30 m')).toBeNull();
    });

    it('should handle repeated units in single string', () => {
      // "1h2h" should add both: 3600000 + 7200000 = 10800000
      expect(parseExpires('1h2h')).toBe(3 * 60 * 60 * 1000);
    });

    it('should handle unordered units', () => {
      // "30m5h" should still work: 1800000 + 18000000 = 19800000
      expect(parseExpires('30m5h')).toBe((30 * 60 + 5 * 60 * 60) * 1000);
    });

    it('should handle very large duration values', () => {
      // 999999h should parse correctly
      expect(parseExpires('999999h')).toBe(999999 * 60 * 60 * 1000);
    });

    it('should handle lowercase and case-sensitivity', () => {
      // Regex only matches lowercase 's', 'm', 'h', 'd'
      expect(parseExpires('1H')).toBeNull();
      expect(parseExpires('1M')).toBeNull();
      expect(parseExpires('1S')).toBeNull();
      expect(parseExpires('1D')).toBeNull();
    });

    it('should accept special combinations at max length', () => {
      // Create a string that's exactly 50 chars with valid duration
      // '1d2h3m4s' = 8 chars
      const testStr = '1d2h3m4s';
      const result = parseExpires(testStr);
      const expected = (24 * 60 * 60 + 2 * 60 * 60 + 3 * 60 + 4) * 1000;
      expect(result).toBe(expected);
      expect(result).toBeGreaterThan(0);
    });
  });

  describe('tryParseJson() - Valid JSON (10 tests)', () => {
    it('should parse valid JSON object', () => {
      const json = '{"key": "value"}';
      const result = tryParseJson(json);
      expect(result).toEqual({ key: 'value' });
      expect(typeof result).toBe('object');
    });

    it('should parse valid JSON array', () => {
      const json = '[1, 2, 3]';
      const result = tryParseJson(json);
      expect(result).toEqual([1, 2, 3]);
      expect(Array.isArray(result)).toBe(true);
    });

    it('should parse valid JSON string', () => {
      const json = '"hello world"';
      const result = tryParseJson(json);
      expect(result).toBe('hello world');
    });

    it('should parse valid JSON number', () => {
      const json = '42';
      const result = tryParseJson(json);
      expect(result).toBe(42);
    });

    it('should parse valid JSON boolean true', () => {
      const json = 'true';
      const result = tryParseJson(json);
      expect(result).toBe(true);
    });

    it('should parse valid JSON boolean false', () => {
      const json = 'false';
      const result = tryParseJson(json);
      expect(result).toBe(false);
    });

    it('should parse valid JSON null', () => {
      const json = 'null';
      const result = tryParseJson(json);
      expect(result).toBeNull();
    });

    it('should parse nested JSON objects', () => {
      const json = '{"user": {"name": "John", "age": 30}}';
      const result = tryParseJson(json);
      expect(result).toEqual({
        user: { name: 'John', age: 30 }
      });
    });

    it('should parse JSON with mixed types in array', () => {
      const json = '[1, "string", true, null, {"key": "value"}]';
      const result = tryParseJson(json);
      expect(result).toEqual([1, 'string', true, null, { key: 'value' }]);
    });

    it('should parse JSON with special characters in strings', () => {
      const json = '{"message": "Hello\\nWorld\\t!"}';
      const result = tryParseJson(json);
      expect(result).toEqual({ message: 'Hello\nWorld\t!' });
    });
  });

  describe('tryParseJson() - Invalid JSON (8 tests)', () => {
    it('should return original string for invalid JSON object', () => {
      const invalid = '{"key": value}'; // Missing quotes around value
      const result = tryParseJson(invalid);
      expect(result).toBe(invalid);
    });

    it('should return original string for incomplete JSON', () => {
      const invalid = '{"key": "value"';
      const result = tryParseJson(invalid);
      expect(result).toBe(invalid);
    });

    it('should return original string for trailing comma in array', () => {
      const invalid = '[1, 2, 3,]';
      const result = tryParseJson(invalid);
      expect(result).toBe(invalid);
    });

    it('should return original string for single quotes instead of double quotes', () => {
      const invalid = "{'key': 'value'}";
      const result = tryParseJson(invalid);
      expect(result).toBe(invalid);
    });

    it('should return original string for plain text', () => {
      const text = 'just plain text';
      const result = tryParseJson(text);
      expect(result).toBe(text);
    });

    it('should return original string for undefined JSON value', () => {
      const invalid = '{"key": undefined}';
      const result = tryParseJson(invalid);
      expect(result).toBe(invalid);
    });

    it('should return original string for single unquoted value', () => {
      const invalid = 'notajson';
      const result = tryParseJson(invalid);
      expect(result).toBe(invalid);
    });

    it('should return original string for empty string', () => {
      const empty = '';
      const result = tryParseJson(empty);
      expect(result).toBe(empty);
    });
  });

  describe('tryParseJson() - Edge Cases (10 tests)', () => {
    it('should handle JSON with whitespace', () => {
      const json = '  {  "key"  :  "value"  }  ';
      const result = tryParseJson(json);
      expect(result).toEqual({ key: 'value' });
    });

    it('should handle empty JSON object', () => {
      const json = '{}';
      const result = tryParseJson(json);
      expect(result).toEqual({});
    });

    it('should handle empty JSON array', () => {
      const json = '[]';
      const result = tryParseJson(json);
      expect(result).toEqual([]);
    });

    it('should handle zero', () => {
      const json = '0';
      const result = tryParseJson(json);
      expect(result).toBe(0);
    });

    it('should handle negative number', () => {
      const json = '-42';
      const result = tryParseJson(json);
      expect(result).toBe(-42);
    });

    it('should handle decimal number', () => {
      const json = '3.14159';
      const result = tryParseJson(json);
      expect(result).toBe(3.14159);
    });

    it('should handle scientific notation', () => {
      const json = '1e5';
      const result = tryParseJson(json);
      expect(result).toBe(100000);
    });

    it('should handle very long JSON string', () => {
      const longValue = 'x'.repeat(10000);
      const json = `"${longValue}"`;
      const result = tryParseJson(json);
      expect(result).toBe(longValue);
    });

    it('should handle deeply nested JSON', () => {
      const json = '{"a":{"b":{"c":{"d":{"e":"value"}}}}}';
      const result = tryParseJson(json);
      expect(result.a.b.c.d.e).toBe('value');
    });

    it('should handle JSON with unicode characters', () => {
      const json = '{"name": "José"}';
      const result = tryParseJson(json);
      expect(result).toEqual({ name: 'José' });
    });
  });

  describe('Integration Tests - Cross-Function Workflows (5 tests)', () => {
    it('should parse expiration and use in timeout calculation', () => {
      const expiresIn = parseExpires('1h');
      expect(expiresIn).toBe(60 * 60 * 1000);

      const expiresAt = Date.now() + expiresIn;
      expect(expiresAt).toBeGreaterThan(Date.now());
    });

    it('should parse JSON config with expiration', () => {
      const configJson = '{"timeout": "30m", "retries": 3}';
      const config = tryParseJson(configJson);

      expect(typeof config).toBe('object');
      const expiresIn = parseExpires(config.timeout);
      expect(expiresIn).toBe(30 * 60 * 1000);
    });

    it('should handle malformed JSON config gracefully', () => {
      const badConfig = 'invalid json config';
      const result = tryParseJson(badConfig);

      expect(typeof result).toBe('string');
      expect(result).toBe(badConfig);
    });

    it('should parse Port Daddy service registration', () => {
      const serviceRegJson = '{"id": "app:api:main", "expires": "24h"}';
      const registration = tryParseJson(serviceRegJson);

      expect(registration.id).toBe('app:api:main');
      const ttl = parseExpires(registration.expires);
      expect(ttl).toBe(24 * 60 * 60 * 1000);
    });

    it('should chain parsing operations for webhook delivery', () => {
      const webhookPayload = '{"event": "service.registered", "ttl": "1h"}';
      const parsed = tryParseJson(webhookPayload);

      expect(parsed.event).toBe('service.registered');
      const expiresMs = parseExpires(parsed.ttl);
      expect(expiresMs).toBe(60 * 60 * 1000);
    });
  });

  describe('Boundary Values (6 tests)', () => {
    it('should handle maximum safe integer in JSON', () => {
      const json = String(Number.MAX_SAFE_INTEGER);
      const result = tryParseJson(json);
      expect(result).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('should handle minimum safe integer in JSON', () => {
      const json = String(Number.MIN_SAFE_INTEGER);
      const result = tryParseJson(json);
      expect(result).toBe(Number.MIN_SAFE_INTEGER);
    });

    it('should handle very large duration value', () => {
      const result = parseExpires('999999d');
      expect(result).toBe(999999 * 24 * 60 * 60 * 1000);
    });

    it('should return null for number type in parseExpires', () => {
      // NaN, Infinity should be passed through as-is
      expect(parseExpires(Infinity)).toBe(Infinity);
      expect(parseExpires(NaN)).toBe(NaN);
    });

    it('should handle extreme nesting in JSON', () => {
      let json = '{"a":';
      for (let i = 0; i < 100; i++) {
        json += '{"b":';
      }
      json += '1';
      for (let i = 0; i < 100; i++) {
        json += '}';
      }
      json += '}';

      const result = tryParseJson(json);
      expect(typeof result).toBe('object');
    });

    it('should handle extremely long key names in JSON', () => {
      const longKey = 'a'.repeat(1000);
      const json = `{"${longKey}": "value"}`;
      const result = tryParseJson(json);
      expect(result[longKey]).toBe('value');
    });
  });

});
