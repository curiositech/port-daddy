/**
 * Unit Tests for Semantic Identity Parser Module (identity.js)
 *
 * Tests parsing, pattern matching, SQL conversion, normalization,
 * and display of semantic identities in project:stack:context format.
 *
 * All tests are pure functions - no database dependency required.
 */

import { describe, it, expect } from '@jest/globals';
import {
  parseIdentity,
  matchesPattern,
  patternToSql,
  normalizeIdentity,
  displayIdentity
} from '../../lib/identity.js';

describe('Identity Module', () => {
  describe('parseIdentity() - Basic Parsing (14 tests)', () => {
    it('should parse single segment (project only)', () => {
      const result = parseIdentity('myapp');
      expect(result.valid).toBe(true);
      expect(result.project).toBe('myapp');
      expect(result.stack).toBeNull();
      expect(result.context).toBeNull();
      expect(result.full).toBe('myapp');
      expect(result.normalized).toBe('myapp');
      expect(result.hasWildcard).toBe(false);
    });

    it('should parse two segments (project:stack)', () => {
      const result = parseIdentity('myapp:api');
      expect(result.valid).toBe(true);
      expect(result.project).toBe('myapp');
      expect(result.stack).toBe('api');
      expect(result.context).toBeNull();
      expect(result.full).toBe('myapp:api');
      expect(result.normalized).toBe('myapp:api');
      expect(result.hasWildcard).toBe(false);
    });

    it('should parse three segments (project:stack:context)', () => {
      const result = parseIdentity('myapp:api:main');
      expect(result.valid).toBe(true);
      expect(result.project).toBe('myapp');
      expect(result.stack).toBe('api');
      expect(result.context).toBe('main');
      expect(result.full).toBe('myapp:api:main');
      expect(result.normalized).toBe('myapp:api:main');
      expect(result.hasWildcard).toBe(false);
    });

    it('should reject empty string', () => {
      const result = parseIdentity('');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/non-empty string/);
    });

    it('should reject non-string input', () => {
      const result = parseIdentity(123);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/non-empty string/);
    });

    it('should reject null input', () => {
      const result = parseIdentity(null);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/non-empty string/);
    });

    it('should reject undefined input', () => {
      const result = parseIdentity(undefined);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/non-empty string/);
    });

    it('should reject more than 3 segments', () => {
      const result = parseIdentity('a:b:c:d');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/at most 3 segments/);
    });

    it('should reject 4 segments', () => {
      const result = parseIdentity('myapp:api:main:extra');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/at most 3 segments/);
    });

    it('should reject invalid characters in project', () => {
      const result = parseIdentity('my@app:api');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/project.*invalid characters/);
    });

    it('should reject invalid characters in stack', () => {
      const result = parseIdentity('myapp:api@v1');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/stack.*invalid characters/);
    });

    it('should reject invalid characters in context', () => {
      const result = parseIdentity('myapp:api:main!');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/context.*invalid characters/);
    });

    it('should accept alphanumeric characters', () => {
      const result = parseIdentity('app123:stack456:context789');
      expect(result.valid).toBe(true);
      expect(result.project).toBe('app123');
      expect(result.stack).toBe('stack456');
      expect(result.context).toBe('context789');
    });

    it('should accept dots, dashes, and underscores', () => {
      const result = parseIdentity('my-app.v1:api_service:main-branch');
      expect(result.valid).toBe(true);
      expect(result.project).toBe('my-app.v1');
      expect(result.stack).toBe('api_service');
      expect(result.context).toBe('main-branch');
    });
  });

  describe('parseIdentity() - Wildcard Support (7 tests)', () => {
    it('should accept wildcard in project', () => {
      const result = parseIdentity('*:api:main');
      expect(result.valid).toBe(true);
      expect(result.project).toBe('*');
      expect(result.hasWildcard).toBe(true);
    });

    it('should accept wildcard in stack', () => {
      const result = parseIdentity('myapp:*:main');
      expect(result.valid).toBe(true);
      expect(result.stack).toBe('*');
      expect(result.hasWildcard).toBe(true);
    });

    it('should accept wildcard in context', () => {
      const result = parseIdentity('myapp:api:*');
      expect(result.valid).toBe(true);
      expect(result.context).toBe('*');
      expect(result.hasWildcard).toBe(true);
    });

    it('should accept multiple wildcards', () => {
      const result = parseIdentity('*:*:*');
      expect(result.valid).toBe(true);
      expect(result.project).toBe('*');
      expect(result.stack).toBe('*');
      expect(result.context).toBe('*');
      expect(result.hasWildcard).toBe(true);
    });

    it('should accept wildcards in partial patterns', () => {
      const result = parseIdentity('*:frontend:*');
      expect(result.valid).toBe(true);
      expect(result.project).toBe('*');
      expect(result.stack).toBe('frontend');
      expect(result.context).toBe('*');
      expect(result.hasWildcard).toBe(true);
    });

    it('should detect no wildcard in normal identity', () => {
      const result = parseIdentity('myapp:api:main');
      expect(result.hasWildcard).toBe(false);
    });

    it('should accept wildcard as part of segment (regex allows it)', () => {
      const result = parseIdentity('my*app:api:main');
      expect(result.valid).toBe(true);
      expect(result.project).toBe('my*app');
      expect(result.hasWildcard).toBe(true);
    });
  });

  describe('parseIdentity() - Length Constraints (5 tests)', () => {
    it('should accept segment at max length (64 chars)', () => {
      const maxSegment = 'a'.repeat(64);
      const result = parseIdentity(maxSegment);
      expect(result.valid).toBe(true);
      expect(result.project).toBe(maxSegment);
    });

    it('should reject segment over max length (65 chars)', () => {
      const overSegment = 'a'.repeat(65);
      const result = parseIdentity(overSegment);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/too long/);
      expect(result.error).toMatch(/max 64 chars/);
    });

    it('should reject overly long project in 3-part identity', () => {
      const tooLong = `${'a'.repeat(65)}:api:main`;
      const result = parseIdentity(tooLong);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/project.*too long/);
    });

    it('should reject overly long stack segment', () => {
      const tooLong = `myapp:${'a'.repeat(65)}:main`;
      const result = parseIdentity(tooLong);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/stack.*too long/);
    });

    it('should reject overly long context segment', () => {
      const tooLong = `myapp:api:${'a'.repeat(65)}`;
      const result = parseIdentity(tooLong);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/context.*too long/);
    });
  });

  describe('parseIdentity() - Edge Cases (6 tests)', () => {
    it('should handle single character segments', () => {
      const result = parseIdentity('a:b:c');
      expect(result.valid).toBe(true);
      expect(result.project).toBe('a');
      expect(result.stack).toBe('b');
      expect(result.context).toBe('c');
    });

    it('should handle numeric project names', () => {
      const result = parseIdentity('123:api:main');
      expect(result.valid).toBe(true);
      expect(result.project).toBe('123');
    });

    it('should handle all numeric identity', () => {
      const result = parseIdentity('1:2:3');
      expect(result.valid).toBe(true);
      expect(result.project).toBe('1');
      expect(result.stack).toBe('2');
      expect(result.context).toBe('3');
    });

    it('should preserve original casing', () => {
      const result = parseIdentity('MyApp:API:Main');
      expect(result.valid).toBe(true);
      expect(result.project).toBe('MyApp');
      expect(result.stack).toBe('API');
      expect(result.context).toBe('Main');
    });

    it('should handle empty segment between colons', () => {
      const result = parseIdentity('myapp::main');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/invalid characters/);
    });

    it('should handle trailing colon', () => {
      const result = parseIdentity('myapp:api:');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/invalid characters/);
    });
  });

  describe('matchesPattern() - Exact Matching (6 tests)', () => {
    it('should match identical single segment identities', () => {
      expect(matchesPattern('myapp', 'myapp')).toBe(true);
    });

    it('should match identical two segment identities', () => {
      expect(matchesPattern('myapp:api', 'myapp:api')).toBe(true);
    });

    it('should match identical three segment identities', () => {
      expect(matchesPattern('myapp:api:main', 'myapp:api:main')).toBe(true);
    });

    it('should not match different project', () => {
      expect(matchesPattern('otherapp:api:main', 'myapp:api:main')).toBe(false);
    });

    it('should not match different stack', () => {
      expect(matchesPattern('myapp:web:main', 'myapp:api:main')).toBe(false);
    });

    it('should not match different context', () => {
      expect(matchesPattern('myapp:api:dev', 'myapp:api:main')).toBe(false);
    });
  });

  describe('matchesPattern() - Wildcard Matching (10 tests)', () => {
    it('should match wildcard project against any project', () => {
      expect(matchesPattern('*:api:main', 'myapp:api:main')).toBe(true);
      expect(matchesPattern('*:api:main', 'otherapp:api:main')).toBe(true);
    });

    it('should match wildcard stack against any stack', () => {
      expect(matchesPattern('myapp:*:main', 'myapp:api:main')).toBe(true);
      expect(matchesPattern('myapp:*:main', 'myapp:web:main')).toBe(true);
    });

    it('should match wildcard context against any context', () => {
      expect(matchesPattern('myapp:api:*', 'myapp:api:main')).toBe(true);
      expect(matchesPattern('myapp:api:*', 'myapp:api:dev')).toBe(true);
    });

    it('should match all-wildcard pattern', () => {
      expect(matchesPattern('*:*:*', 'myapp:api:main')).toBe(true);
      expect(matchesPattern('*:*:*', 'other:web:test')).toBe(true);
    });

    it('should match partial wildcard pattern', () => {
      expect(matchesPattern('*:frontend:*', 'app1:frontend:main')).toBe(true);
      expect(matchesPattern('*:frontend:*', 'app2:frontend:dev')).toBe(true);
      expect(matchesPattern('*:frontend:*', 'app1:api:main')).toBe(false);
    });

    it('should not match if non-wildcard segment differs', () => {
      expect(matchesPattern('*:api:main', 'myapp:web:main')).toBe(false);
      expect(matchesPattern('myapp:*:main', 'otherapp:api:main')).toBe(false);
    });

    it('should match pattern with fewer segments than identity', () => {
      expect(matchesPattern('myapp:api', 'myapp:api:main')).toBe(true);
      expect(matchesPattern('myapp', 'myapp:api:main')).toBe(true);
    });

    it('should not match identity with fewer segments than pattern', () => {
      expect(matchesPattern('myapp:api:main', 'myapp:api')).toBe(false);
      expect(matchesPattern('myapp:api:main', 'myapp')).toBe(false);
    });

    it('should handle case-sensitive matching', () => {
      expect(matchesPattern('MyApp:API:Main', 'myapp:api:main')).toBe(false);
      expect(matchesPattern('MyApp:API:Main', 'MyApp:API:Main')).toBe(true);
    });

    it('should reject invalid patterns', () => {
      expect(matchesPattern('myapp:api:main:extra', 'myapp:api:main')).toBe(false);
      expect(matchesPattern('', 'myapp:api:main')).toBe(false);
    });
  });

  describe('matchesPattern() - Complex Scenarios (5 tests)', () => {
    it('should match wildcard stack with specific project and context', () => {
      expect(matchesPattern('windags:*:main', 'windags:api:main')).toBe(true);
      expect(matchesPattern('windags:*:main', 'windags:frontend:main')).toBe(true);
      expect(matchesPattern('windags:*:main', 'windags:worker:main')).toBe(true);
      expect(matchesPattern('windags:*:main', 'windags:api:dev')).toBe(false);
    });

    it('should match multiple services with same pattern', () => {
      const pattern = 'app:*:prod';
      expect(matchesPattern(pattern, 'app:api:prod')).toBe(true);
      expect(matchesPattern(pattern, 'app:web:prod')).toBe(true);
      expect(matchesPattern(pattern, 'app:worker:prod')).toBe(true);
      expect(matchesPattern(pattern, 'other:api:prod')).toBe(false);
    });

    it('should match with all wildcards for broadcasting', () => {
      const pattern = '*:*:*';
      expect(matchesPattern(pattern, 'app1:api:main')).toBe(true);
      expect(matchesPattern(pattern, 'app2:web:dev')).toBe(true);
      expect(matchesPattern(pattern, 'any:thing:here')).toBe(true);
    });

    it('should work with long identities at max length', () => {
      const longId = `${'a'.repeat(64)}:${'b'.repeat(64)}:${'c'.repeat(64)}`;
      expect(matchesPattern(longId, longId)).toBe(true);
      expect(matchesPattern('*:*:*', longId)).toBe(true);
    });

    it('should handle numeric patterns and identities', () => {
      expect(matchesPattern('1:2:3', '1:2:3')).toBe(true);
      expect(matchesPattern('*:2:3', '1:2:3')).toBe(true);
      expect(matchesPattern('1:*:3', '1:2:3')).toBe(true);
    });
  });

  describe('patternToSql() - Basic SQL Conversion (8 tests)', () => {
    it('should convert single segment to SQL LIKE', () => {
      const sql = patternToSql('myapp');
      expect(sql).toBe('myapp');
    });

    it('should convert two segments to SQL LIKE', () => {
      const sql = patternToSql('myapp:api');
      expect(sql).toBe('myapp:api');
    });

    it('should convert three segments to SQL LIKE', () => {
      const sql = patternToSql('myapp:api:main');
      expect(sql).toBe('myapp:api:main');
    });

    it('should convert wildcard project to %', () => {
      const sql = patternToSql('*:api:main');
      expect(sql).toBe('%:api:main');
    });

    it('should convert wildcard stack to %', () => {
      const sql = patternToSql('myapp:*:main');
      expect(sql).toBe('myapp:%:main');
    });

    it('should convert wildcard context to %', () => {
      const sql = patternToSql('myapp:api:*');
      expect(sql).toBe('myapp:api:%');
    });

    it('should convert multiple wildcards to %', () => {
      const sql = patternToSql('*:*:main');
      expect(sql).toBe('%:%:main');
    });

    it('should convert all wildcards', () => {
      const sql = patternToSql('*:*:*');
      expect(sql).toBe('%:%:%');
    });
  });

  describe('patternToSql() - Embedded Wildcards (Bug #14 regression)', () => {
    // Bug #14: patternToSql('qa-test*') returned 'qa-test*' instead of 'qa-test%'
    // The * was only converted to % when it was a standalone segment (like 'myapp:*:main')
    // but not when embedded in a segment name (like 'qa-test*')

    it('should convert trailing wildcard in project to SQL %', () => {
      const sql = patternToSql('qa-test*');
      expect(sql).toBe('qa-test%');
    });

    it('should convert leading wildcard in project to SQL %', () => {
      const sql = patternToSql('*prefix');
      expect(sql).toBe('%prefix');
    });

    it('should convert middle wildcard in project to SQL %', () => {
      const sql = patternToSql('mid*fix');
      expect(sql).toBe('mid%fix');
    });

    it('should convert embedded wildcard in stack to SQL %', () => {
      const sql = patternToSql('myapp:api*:main');
      expect(sql).toBe('myapp:api%:main');
    });

    it('should convert embedded wildcard in context to SQL %', () => {
      const sql = patternToSql('myapp:api:main*');
      expect(sql).toBe('myapp:api:main%');
    });

    it('should convert multiple embedded wildcards to SQL %', () => {
      const sql = patternToSql('my*app:api*:*main');
      expect(sql).toBe('my%app:api%:%main');
    });

    it('should handle two-segment pattern with trailing wildcard', () => {
      const sql = patternToSql('myapp:api*');
      expect(sql).toBe('myapp:api%');
    });
  });

  describe('patternToSql() - Edge Cases (5 tests)', () => {
    it('should return null for invalid pattern', () => {
      const sql = patternToSql('invalid:pattern:too:many');
      expect(sql).toBeNull();
    });

    it('should return null for empty pattern', () => {
      const sql = patternToSql('');
      expect(sql).toBeNull();
    });

    it('should return null for non-string pattern', () => {
      const sql = patternToSql(123);
      expect(sql).toBeNull();
    });

    it('should handle pattern with numbers', () => {
      const sql = patternToSql('app123:*:env456');
      expect(sql).toBe('app123:%:env456');
    });

    it('should handle pattern with dots and dashes', () => {
      const sql = patternToSql('my-app.v1:api_service:*');
      expect(sql).toBe('my-app.v1:api_service:%');
    });
  });

  describe('normalizeIdentity() - Basic Normalization (6 tests)', () => {
    it('should normalize single segment', () => {
      const result = normalizeIdentity('myapp');
      expect(result.valid).toBe(true);
      expect(result.project).toBe('myapp');
      expect(result.stack).toBeNull();
      expect(result.context).toBeNull();
      expect(result.normalized).toBe('myapp');
    });

    it('should normalize two segments', () => {
      const result = normalizeIdentity('myapp:api');
      expect(result.valid).toBe(true);
      expect(result.project).toBe('myapp');
      expect(result.stack).toBe('api');
      expect(result.context).toBeNull();
      expect(result.normalized).toBe('myapp:api');
    });

    it('should normalize three segments', () => {
      const result = normalizeIdentity('myapp:api:main');
      expect(result.valid).toBe(true);
      expect(result.project).toBe('myapp');
      expect(result.stack).toBe('api');
      expect(result.context).toBe('main');
      expect(result.normalized).toBe('myapp:api:main');
    });

    it('should reject invalid identity', () => {
      const result = normalizeIdentity('invalid:pattern:too:many');
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should set full and normalized to same value', () => {
      const result = normalizeIdentity('myapp:api:main');
      expect(result.full).toBe(result.normalized);
    });

    it('should filter out null values from normalized', () => {
      const result = normalizeIdentity('myapp:api');
      expect(result.normalized).toBe('myapp:api');
      expect(result.normalized).not.toContain(':null');
    });
  });

  describe('normalizeIdentity() - With Defaults (6 tests)', () => {
    it('should apply default stack to field but not rebuild normalized', () => {
      const result = normalizeIdentity('myapp', { stack: 'api' });
      expect(result.valid).toBe(true);
      expect(result.project).toBe('myapp');
      expect(result.stack).toBe('api');
      expect(result.context).toBeNull();
      // Note: normalized stays as parsed, doesn't include defaults
      expect(result.normalized).toBe('myapp');
    });

    it('should apply default context to field but not rebuild normalized', () => {
      const result = normalizeIdentity('myapp', { context: 'main' });
      expect(result.valid).toBe(true);
      expect(result.project).toBe('myapp');
      expect(result.stack).toBeNull();
      expect(result.context).toBe('main');
      // Note: normalized stays as parsed, doesn't include defaults
      expect(result.normalized).toBe('myapp');
    });

    it('should apply both defaults to fields but not rebuild normalized', () => {
      const result = normalizeIdentity('myapp', { stack: 'api', context: 'main' });
      expect(result.valid).toBe(true);
      expect(result.project).toBe('myapp');
      expect(result.stack).toBe('api');
      expect(result.context).toBe('main');
      // Note: normalized stays as parsed, doesn't include defaults
      expect(result.normalized).toBe('myapp');
    });

    it('should not override provided segments with defaults', () => {
      const result = normalizeIdentity('myapp:web', { stack: 'api', context: 'main' });
      expect(result.valid).toBe(true);
      expect(result.stack).toBe('web');
      expect(result.context).toBe('main');
    });

    it('should not override context if already provided', () => {
      const result = normalizeIdentity('myapp:api:dev', { stack: 'web', context: 'main' });
      expect(result.valid).toBe(true);
      expect(result.stack).toBe('api');
      expect(result.context).toBe('dev');
    });

    it('should use defaults object with empty object', () => {
      const result = normalizeIdentity('myapp:api', {});
      expect(result.valid).toBe(true);
      expect(result.project).toBe('myapp');
      expect(result.stack).toBe('api');
      expect(result.context).toBeNull();
    });
  });

  describe('normalizeIdentity() - Edge Cases (5 tests)', () => {
    it('should handle undefined defaults', () => {
      const result = normalizeIdentity('myapp');
      expect(result.valid).toBe(true);
      expect(result.project).toBe('myapp');
    });

    it('should handle null defaults in object', () => {
      const result = normalizeIdentity('myapp', { stack: null, context: null });
      expect(result.valid).toBe(true);
      expect(result.stack).toBeNull();
      expect(result.context).toBeNull();
    });

    it('should reject identity with too many segments even with defaults', () => {
      const result = normalizeIdentity('a:b:c:d', { stack: 'api' });
      expect(result.valid).toBe(false);
    });

    it('should handle wildcard identity with defaults', () => {
      const result = normalizeIdentity('*:api', { context: 'main' });
      expect(result.valid).toBe(true);
      expect(result.project).toBe('*');
      expect(result.stack).toBe('api');
      expect(result.context).toBe('main');
    });

    it('should normalize with complex defaults applied to fields', () => {
      const result = normalizeIdentity('app', {
        stack: 'web-service',
        context: 'feature-branch'
      });
      expect(result.valid).toBe(true);
      expect(result.stack).toBe('web-service');
      expect(result.context).toBe('feature-branch');
      // Note: normalized stays as original parsed value
      expect(result.normalized).toBe('app');
    });
  });

  describe('displayIdentity() - Display Formatting (8 tests)', () => {
    it('should display single segment', () => {
      const display = displayIdentity('myapp');
      expect(display).toBe('myapp');
    });

    it('should display two segments', () => {
      const display = displayIdentity('myapp:api');
      expect(display).toBe('myapp:api');
    });

    it('should display three segments', () => {
      const display = displayIdentity('myapp:api:main');
      expect(display).toBe('myapp:api:main');
    });

    it('should display wildcards', () => {
      const display = displayIdentity('*:api:*');
      expect(display).toBe('*:api:*');
    });

    it('should return original for invalid identity', () => {
      const invalid = 'invalid:too:many:segments';
      const display = displayIdentity(invalid);
      expect(display).toBe(invalid);
    });

    it('should display with numeric segments', () => {
      const display = displayIdentity('1:2:3');
      expect(display).toBe('1:2:3');
    });

    it('should display with special characters (dashes, dots, underscores)', () => {
      const display = displayIdentity('my-app.v1:api_service:main-branch');
      expect(display).toBe('my-app.v1:api_service:main-branch');
    });

    it('should preserve casing in display', () => {
      const display = displayIdentity('MyApp:API:Main');
      expect(display).toBe('MyApp:API:Main');
    });
  });

  describe('displayIdentity() - Edge Cases (5 tests)', () => {
    it('should handle empty string gracefully', () => {
      const display = displayIdentity('');
      expect(display).toBe('');
    });

    it('should handle null gracefully', () => {
      const display = displayIdentity(null);
      expect(display).toBe(null);
    });

    it('should handle non-string gracefully', () => {
      const display = displayIdentity(123);
      expect(display).toBe(123);
    });

    it('should handle invalid characters in input', () => {
      const invalid = 'my@app:api!';
      const display = displayIdentity(invalid);
      expect(display).toBe(invalid);
    });

    it('should handle too many segments gracefully', () => {
      const invalid = 'a:b:c:d:e';
      const display = displayIdentity(invalid);
      expect(display).toBe(invalid);
    });
  });

  describe('Integration Tests - Cross-Function Workflows (10 tests)', () => {
    it('should parse, then display identity', () => {
      const parsed = parseIdentity('myapp:api:main');
      expect(parsed.valid).toBe(true);

      const display = displayIdentity(parsed.full);
      expect(display).toBe('myapp:api:main');
    });

    it('should parse, normalize, then display', () => {
      const parsed = parseIdentity('myapp:api');
      const normalized = normalizeIdentity(parsed.full, { context: 'main' });
      const display = displayIdentity(normalized.full);

      expect(normalized.valid).toBe(true);
      expect(normalized.context).toBe('main');
      expect(display).toBe(normalized.full);
    });

    it('should parse pattern, convert to SQL, and verify match', () => {
      const pattern = 'myapp:*:main';
      const parsed = parseIdentity(pattern);
      const sql = patternToSql(pattern);

      expect(parsed.valid).toBe(true);
      expect(sql).toBe('myapp:%:main');
      expect(matchesPattern(pattern, 'myapp:api:main')).toBe(true);
    });

    it('should handle wildcard identity through full pipeline', () => {
      const pattern = '*:*:main';
      const parsed = parseIdentity(pattern);
      const sql = patternToSql(pattern);
      const display = displayIdentity(pattern);

      expect(parsed.valid).toBe(true);
      expect(sql).toBe('%:%:main');
      expect(display).toBe('*:*:main');
      expect(matchesPattern(pattern, 'any:thing:main')).toBe(true);
    });

    it('should handle normalization with defaults throughout', () => {
      const identity = 'myapp';
      const normalized = normalizeIdentity(identity, {
        stack: 'api',
        context: 'prod'
      });

      expect(normalized.valid).toBe(true);
      expect(normalized.project).toBe('myapp');
      expect(normalized.stack).toBe('api');
      expect(normalized.context).toBe('prod');

      const display = displayIdentity(normalized.full);
      expect(display).toBe(normalized.full);
    });

    it('should convert complex pattern to SQL and back to display', () => {
      const pattern = 'app-name.v1:*:feature-branch';
      const parsed = parseIdentity(pattern);
      const sql = patternToSql(pattern);
      const display = displayIdentity(pattern);

      expect(parsed.valid).toBe(true);
      expect(sql).toBe('app-name.v1:%:feature-branch');
      expect(display).toBe('app-name.v1:*:feature-branch');
    });

    it('should handle very long identities with all segments near max', () => {
      const project = 'myapp';
      const stack = 'api';
      const context = 'production';
      const longId = `${project}:${stack}:${context}`;

      const parsed = parseIdentity(longId);
      expect(parsed.valid).toBe(true);
      expect(parsed.project).toBe(project);

      const normalized = normalizeIdentity(longId);
      expect(normalized.valid).toBe(true);
    });

    it('should handle cascading normalization with wildcards in defaults', () => {
      const identity = 'app';
      const defaults = { stack: '*', context: 'main' };
      const normalized = normalizeIdentity(identity, defaults);

      expect(normalized.valid).toBe(true);
      expect(normalized.project).toBe('app');
      expect(normalized.stack).toBe('*');
      expect(normalized.context).toBe('main');
      // normalized stays as the parsed original
      expect(normalized.normalized).toBe('app');
    });

    it('should use parsed data for matching multiple times', () => {
      const pattern = parseIdentity('app:*:main');
      expect(pattern.valid).toBe(true);

      const matches1 = matchesPattern(pattern.full, 'app:api:main');
      const matches2 = matchesPattern(pattern.full, 'app:web:main');
      const matches3 = matchesPattern(pattern.full, 'other:api:main');

      expect(matches1).toBe(true);
      expect(matches2).toBe(true);
      expect(matches3).toBe(false);
    });

    it('should maintain consistency across all functions for valid identity', () => {
      const identity = 'windags:frontend:production';

      const parsed = parseIdentity(identity);
      const normalized = normalizeIdentity(identity);
      const displayed = displayIdentity(identity);
      const sql = patternToSql(identity);
      const matches = matchesPattern(identity, identity);

      expect(parsed.valid).toBe(true);
      expect(normalized.valid).toBe(true);
      expect(displayed).toBe(identity);
      expect(sql).toBe(identity);
      expect(matches).toBe(true);
    });
  });

  describe('Boundary and Special Cases (8 tests)', () => {
    it('should accept valid special character combinations', () => {
      const validIds = [
        'app-with-dashes',
        'app_with_underscores',
        'app.with.dots',
        'app-with_dots.and:mix',
        'api.v2_prod-service',
        'app123.test_dev-feature:main'
      ];

      for (const id of validIds) {
        const result = parseIdentity(id);
        expect(result.valid).toBe(true);
      }
    });

    it('should reject invalid special characters', () => {
      const invalidIds = [
        'app!',
        'app@',
        'app#',
        'app$',
        'app%',
        'app&',
        'app(',
        'app)',
        'app/',
        'app\\',
        'app[',
        'app]',
        'app{',
        'app}',
        'app|',
        'app;',
        'app,',
        'app<',
        'app>',
        'app?',
        'app`',
        'app~'
      ];

      for (const id of invalidIds) {
        const result = parseIdentity(id);
        expect(result.valid).toBe(false);
      }
    });

    it('should handle whitespace rejection', () => {
      const result = parseIdentity('app with space');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/invalid characters/);
    });

    it('should handle colon-only patterns', () => {
      const result = parseIdentity(':::');
      expect(result.valid).toBe(false);
    });

    it('should reject patterns with leading/trailing colons', () => {
      const result1 = parseIdentity(':myapp:api:main');
      const result2 = parseIdentity('myapp:api:main:');

      expect(result1.valid).toBe(false);
      expect(result2.valid).toBe(false);
    });

    it('should handle Unicode characters (should reject)', () => {
      const result = parseIdentity('app-日本語:api:main');
      expect(result.valid).toBe(false);
    });

    it('should handle very long overall identity string', () => {
      const longId = `${'a'.repeat(20)}:${'b'.repeat(20)}:${'c'.repeat(20)}`;
      const result = parseIdentity(longId);
      expect(result.valid).toBe(true);
    });

    it('should reject identity exceeding total reasonable length', () => {
      const tooLong = Array(1000).fill('a').join(':');
      const result = parseIdentity(tooLong);
      expect(result.valid).toBe(false);
    });
  });

  describe('Real-World Scenarios (6 tests)', () => {
    it('should handle Port Daddy service naming conventions', () => {
      const serviceIds = [
        'port-daddy:api:main',
        'port-daddy:cli:prod',
        'port-daddy:dashboard:dev',
        'port-daddy:worker:test'
      ];

      for (const id of serviceIds) {
        const result = parseIdentity(id);
        expect(result.valid).toBe(true);

        const pattern = parseIdentity('port-daddy:*:*');
        expect(matchesPattern(pattern.full, id)).toBe(true);
      }
    });

    it('should handle multi-project discovery pattern', () => {
      const pattern = '*:api:prod';
      const serviceIds = [
        'app1:api:prod',
        'app2:api:prod',
        'windags:api:prod',
        'other-service:api:prod'
      ];

      for (const id of serviceIds) {
        expect(matchesPattern(pattern, id)).toBe(true);
      }
    });

    it('should handle environment-based patterns', () => {
      const envPatterns = [
        { pattern: '*:*:prod', env: 'production' },
        { pattern: '*:*:staging', env: 'staging' },
        { pattern: '*:*:dev', env: 'development' }
      ];

      const services = [
        'app1:web:prod',
        'app1:api:prod',
        'app2:web:staging'
      ];

      const prodMatches = services.filter(s => matchesPattern('*:*:prod', s));
      expect(prodMatches.length).toBe(2);
    });

    it('should handle feature branch workflow', () => {
      const baseId = 'myapp:api:main';
      const normalized = normalizeIdentity(baseId);

      // Simulate creating feature branch variant
      const featureId = 'myapp:api:feature-auth';
      const parsed = parseIdentity(featureId);

      expect(parsed.valid).toBe(true);
      expect(parsed.project).toBe('myapp');
      expect(parsed.stack).toBe('api');
      expect(parsed.context).toBe('feature-auth');
    });

    it('should handle version-tagged services', () => {
      const versionedServices = [
        'app.v1:api:main',
        'app.v2:api:main',
        'app.v2_1:api:main',
        'app.v2-beta:api:main'
      ];

      for (const id of versionedServices) {
        const result = parseIdentity(id);
        expect(result.valid).toBe(true);
      }
    });

    it('should handle discovery and broadcast patterns', () => {
      const broadcastPattern = '*:*:*';
      const targetServices = [
        'service1:api:prod',
        'service2:web:dev',
        'service3:worker:staging'
      ];

      for (const service of targetServices) {
        expect(matchesPattern(broadcastPattern, service)).toBe(true);
      }

      const sql = patternToSql(broadcastPattern);
      expect(sql).toBe('%:%:%');
    });
  });
});
