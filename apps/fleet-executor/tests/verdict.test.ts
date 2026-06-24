import { describe, it, expect } from 'vitest';
import {
  parseVerdict,
  resolveVerdict,
  aggregateConclusion,
  type ShipResult,
} from '../src/verdict.js';

describe('parseVerdict', () => {
  it('parses PASS on the last line', () => {
    expect(parseVerdict('findings...\n\nFLEET-VERDICT: PASS')).toBe('PASS');
  });

  it('parses BLOCK on the last line', () => {
    expect(parseVerdict('HIGH: bad\nFLEET-VERDICT: BLOCK')).toBe('BLOCK');
  });

  it('is case-insensitive and whitespace-tolerant', () => {
    expect(parseVerdict('   fleet-verdict:   block  ')).toBe('BLOCK');
  });

  it('last verdict wins when multiple are present', () => {
    expect(parseVerdict('FLEET-VERDICT: BLOCK\nmore\nFLEET-VERDICT: PASS')).toBe('PASS');
  });

  it('returns null when no verdict line exists', () => {
    expect(parseVerdict('just some prose, no verdict')).toBeNull();
  });

  it('does not match a verdict embedded mid-line', () => {
    expect(parseVerdict('the rule says FLEET-VERDICT: BLOCK is required')).toBeNull();
  });
});

describe('resolveVerdict (fail-closed)', () => {
  it('blocking ship with no verdict => BLOCK', () => {
    expect(resolveVerdict('no verdict here', true)).toBe('BLOCK');
  });

  it('non-blocking ship with no verdict => PASS', () => {
    expect(resolveVerdict('no verdict here', false)).toBe('PASS');
  });

  it('honors an explicit verdict regardless of blocking', () => {
    expect(resolveVerdict('FLEET-VERDICT: PASS', true)).toBe('PASS');
    expect(resolveVerdict('FLEET-VERDICT: BLOCK', false)).toBe('BLOCK');
  });
});

describe('aggregateConclusion', () => {
  const r = (over: Partial<ShipResult>): ShipResult => ({
    ship: 's',
    blocking: false,
    verdict: 'PASS',
    errored: false,
    ...over,
  });

  it('success when all blocking ships pass and no advisory objection', () => {
    expect(
      aggregateConclusion([r({ blocking: true, verdict: 'PASS' }), r({ verdict: 'PASS' })]),
    ).toBe('success');
  });

  it('failure when a blocking ship BLOCKs', () => {
    expect(aggregateConclusion([r({ blocking: true, verdict: 'BLOCK' })])).toBe('failure');
  });

  it('failure when a blocking ship errors', () => {
    expect(aggregateConclusion([r({ blocking: true, errored: true, verdict: 'BLOCK' })])).toBe(
      'failure',
    );
  });

  it('neutral when only a non-blocking ship objects', () => {
    expect(
      aggregateConclusion([r({ blocking: true, verdict: 'PASS' }), r({ verdict: 'BLOCK' })]),
    ).toBe('neutral');
  });
});
