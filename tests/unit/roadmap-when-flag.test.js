/**
 * parseWhenFlag — the `pd roadmap upsert --start/--due` date parser.
 *
 * The contract under test: exactly three shapes parse (epoch ms, ISO
 * calendar date, `+Nd` relative days) and EVERYTHING else returns undefined
 * so the CLI can reject loudly instead of silently scheduling for 1970 or
 * NaN-poisoning the Gantt anchors.
 */
import { describe, test, expect } from '@jest/globals';
import { parseWhenFlag } from '../../cli/commands/roadmap.js';

describe('parseWhenFlag', () => {
  test('parses a 13-digit epoch-ms timestamp verbatim', () => {
    expect(parseWhenFlag('1787260000000')).toBe(1_787_260_000_000);
  });

  test('parses an ISO calendar date', () => {
    const ms = parseWhenFlag('2026-09-01');
    expect(typeof ms).toBe('number');
    expect(new Date(ms).getUTCFullYear()).toBe(2026);
  });

  test('parses +Nd as N days from now', () => {
    const before = Date.now();
    const ms = parseWhenFlag('+14d');
    expect(ms).toBeGreaterThanOrEqual(before + 14 * 86_400_000 - 1000);
    expect(ms).toBeLessThanOrEqual(Date.now() + 14 * 86_400_000 + 1000);
  });

  test('rejects malformed inputs as undefined (loud CLI error, not 1970)', () => {
    expect(parseWhenFlag('invalid')).toBeUndefined();
    expect(parseWhenFlag('+d')).toBeUndefined();
    expect(parseWhenFlag('+abcd')).toBeUndefined();
    expect(parseWhenFlag('14d')).toBeUndefined(); // relative needs the +
    expect(parseWhenFlag('2026-13-45x')).toBeUndefined();
    expect(parseWhenFlag('')).toBeUndefined();
    expect(parseWhenFlag(undefined)).toBeUndefined();
  });
});
