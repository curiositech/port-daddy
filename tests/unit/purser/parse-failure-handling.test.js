// the complete contents of tests/unit/purser/parse-failure-handling.test.js
import { describe, expect, test } from '@jest/globals';
import {
  parseStableVersion,
  stableVersionFromTag,
} from '../../../scripts/release-workflow-state.mjs';

describe('parseStableVersion – malformed inputs and whitespace handling', () => {
  test('accepts a correct stable version', () => {
    expect(parseStableVersion('3.29.0')).toEqual([3n, 29n, 0n]);
  });

  test.each([
    ['leading space', ' 3.29.0'],
    ['trailing space', '3.29.0 '],
    ['tab character', '\t3.29.0'],
    ['newline character', '3.29.0\n'],
    ['embedded space', '3 .29.0'],
    ['zero‑padded major', '03.29.0'],
    ['zero‑padded minor', '3.029.0'],
    ['zero‑padded patch', '3.29.00'],
    ['missing patch', '3.29'],
    ['extra segment', '3.29.0.1'],
    ['prerelease suffix', '3.29.0-rc.1'],
    ['empty string', ''],
  ])('rejects %s: "%s"', (_case, input) => {
    expect(() => parseStableVersion(input)).toThrow(
      /not a stable x\.y\.z version/,
    );
  });
});

describe('stableVersionFromTag – malformed tags and whitespace handling', () => {
  test('accepts a correct stable tag', () => {
    expect(stableVersionFromTag('v3.29.0')).toBe('3.29.0');
  });

  test.each([
    ['leading space', ' v3.29.0'],
    ['trailing space', 'v3.29.0 '],
    ['tab character', '\tv3.29.0'],
    ['newline character', 'v3.29.0\n'],
    ['missing v prefix', '3.29.0'],
    ['zero‑padded major', 'v03.29.0'],
    ['zero‑padded minor', 'v3.029.0'],
    ['zero‑padded patch', 'v3.29.00'],
    ['prerelease suffix', 'v3.29.0-rc.1'],
    ['empty string', ''],
  ])('rejects %s: "%s"', (_case, input) => {
    expect(() => stableVersionFromTag(input)).toThrow(
      /not a stable vx\.y\.z tag/,
    );
  });
});