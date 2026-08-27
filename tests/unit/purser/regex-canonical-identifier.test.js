// tests/unit/purser/regex-canonical-identifier.test.js
import { describe, test, expect } from '@jest/globals';
import {
  latestStableTag,
  parseStableVersion,
  stableVersionFromTag,
} from '../../../scripts/release-workflow-state.mjs';

describe('canonical numeric identifier regex (indirect validation)', () => {
  test('accepts plain zero and non‑zero components without leading zeros', () => {
    // valid stable versions
    expect(parseStableVersion('0.0.0')).toEqual([0n, 0n, 0n]);
    expect(parseStableVersion('1.2.3')).toEqual([1n, 2n, 3n]);
    expect(parseStableVersion('10.20.30')).toEqual([10n, 20n, 30n]);

    // valid stable tags
    expect(stableVersionFromTag('v0.0.0')).toBe('0.0.0');
    expect(stableVersionFromTag('v1.2.3')).toBe('1.2.3');
    expect(stableVersionFromTag('v10.20.30')).toBe('10.20.30');
  });

  test('rejects components with leading zeros (canonical numeric identifier violation)', () => {
    const invalidVersions = [
      '01.2.3',
      '1.02.3',
      '1.2.03',
      '00.0.0',
      '0.00.0',
      '0.0.00',
    ];
    for (const v of invalidVersions) {
      expect(() => parseStableVersion(v)).toThrow(
        `'${v}' is not a stable x.y.z version`,
      );
    }

    const invalidTags = [
      'v01.2.3',
      'v1.02.3',
      'v1.2.03',
      'v00.0.0',
      'v0.00.0',
      'v0.0.00',
    ];
    for (const t of invalidTags) {
      expect(() => stableVersionFromTag(t)).toThrow(
        `'${t}' is not a stable vx.y.z tag`,
      );
    }

    // Ensure latestStableTag ignores these malformed tags
    const tags = [
      'v01.2.3',
      'v1.02.3',
      'v1.2.03',
      'v0.0.0', // the only valid one
    ];
    expect(latestStableTag(tags)).toBe('v0.0.0');
  });

  test('rejects negative numbers and non‑numeric characters', () => {
    const badVersions = ['-1.2.3', '1.-2.3', '1.2.-3', '1.2.3a', 'a.b.c'];
    for (const v of badVersions) {
      expect(() => parseStableVersion(v)).toThrow(
        `'${v}' is not a stable x.y.z version`,
      );
    }

    const badTags = ['v-1.2.3', 'v1.-2.3', 'v1.2.-3', 'v1.2.3a', 'va.b.c'];
    for (const t of badTags) {
      expect(() => stableVersionFromTag(t)).toThrow(
        `'${t}' is not a stable vx.y.z tag`,
      );
    }
  });

  test('latestStableTag correctly selects the newest valid tag among mixed inputs', () => {
    const tags = [
      'v3.30.1',
      'v3.30.2',
      'v3.30.2-rc.1', // prerelease – should be ignored
      'v03.30.3', // leading zero – invalid
      'v3.30.3',
    ];
    // The function should ignore the prerelease and the zero‑padded tag,
    // returning the highest valid stable tag.
    expect(latestStableTag(tags)).toBe('v3.30.3');
  });
});