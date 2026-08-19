import { describe, it, expect } from 'vitest';
import {
  parseVerdict,
  resolveVerdict,
  aggregateConclusion,
  parseShipFindings,
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

describe('parseShipFindings', () => {
  const fenced = (json: string, tail = '\n\nFLEET-VERDICT: PASS') =>
    ['```json', json, '```', tail].join('\n');

  it('returns [] when there is no findings block', () => {
    expect(parseShipFindings('just prose\n\nFLEET-VERDICT: PASS')).toEqual([]);
  });

  it('returns [] for an empty array block', () => {
    expect(parseShipFindings(fenced('[]'))).toEqual([]);
  });

  it('parses a well-formed findings array', () => {
    const out = fenced('[{"path":"src/a.ts","line":42,"severity":"HIGH","body":"TOCTOU"}]');
    expect(parseShipFindings(out)).toEqual([
      { path: 'src/a.ts', line: 42, severity: 'HIGH', body: 'TOCTOU' },
    ]);
  });

  it('coerces MED/unknown severity to MEDIUM/LOW', () => {
    const out = fenced(
      '[{"path":"a","line":1,"severity":"MED","body":"x"},{"path":"b","line":2,"severity":"weird","body":"y"}]',
    );
    const findings = parseShipFindings(out);
    expect(findings).not.toBeNull();
    expect(findings![0].severity).toBe('MEDIUM');
    expect(findings![1].severity).toBe('LOW');
  });

  it('returns null for malformed JSON inside the fence (parse failure)', () => {
    expect(parseShipFindings(fenced('{ not valid array'))).toBeNull();
  });

  it('returns null when the JSON is not an array', () => {
    expect(parseShipFindings(fenced('{"path":"a","line":1}'))).toBeNull();
  });

  it('returns null when an element does not match the Finding schema', () => {
    expect(parseShipFindings(fenced('[{"path":"a"}]'))).toBeNull();
    expect(parseShipFindings(fenced('[{"path":"a","line":"NaN","body":"x"}]'))).toBeNull();
  });

  it('dedupes identical findings (path|line|body) — the 2026-07-07 line-68/86 duplicate', () => {
    // A single-chunk diff skips the REDUCE manager, so its "deduplicate" prompt
    // never runs. The same finding emitted twice must reach the operator once.
    const out = fenced(
      '[' +
        '{"path":"src/a.ts","line":68,"severity":"MEDIUM","body":"loop off-by-one"},' +
        '{"path":"src/a.ts","line":68,"severity":"MEDIUM","body":"loop off-by-one"}' +
        ']',
    );
    expect(parseShipFindings(out)).toEqual([
      { path: 'src/a.ts', line: 68, severity: 'MEDIUM', body: 'loop off-by-one' },
    ]);
  });

  it('keeps findings that differ only by line or body (not over-dedup)', () => {
    const out = fenced(
      '[' +
        '{"path":"a","line":1,"severity":"LOW","body":"x"},' +
        '{"path":"a","line":2,"severity":"LOW","body":"x"},' +
        '{"path":"a","line":1,"severity":"LOW","body":"y"}' +
        ']',
    );
    expect(parseShipFindings(out)).toHaveLength(3);
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

  // Broken-ship doctrine (operator ruling, 2026-08-19): "advisory" scopes a
  // ship's JUDGMENT, not its machinery. A ship that errored or returned
  // nothing usable rendered no opinion — the fleet is broken, and the run
  // fails until it is fixed, whatever the ship's blocking flag.
  it('failure when an ADVISORY ship errors — a broken ship is not an opinion', () => {
    expect(
      aggregateConclusion([r({ blocking: true, verdict: 'PASS' }), r({ errored: true })]),
    ).toBe('failure');
  });

  it('failure when an ADVISORY ship produced no usable output', () => {
    expect(
      aggregateConclusion([r({ blocking: true, verdict: 'PASS' }), r({ noUsableOutput: true })]),
    ).toBe('failure');
  });

  it('a broken advisory ship dominates an otherwise all-green fleet', () => {
    expect(
      aggregateConclusion([
        r({ ship: 'code-reviewer', blocking: true, verdict: 'PASS' }),
        r({ ship: 'spark', verdict: 'PASS' }),
        r({ ship: 'snipe', verdict: 'PASS', errored: true }),
      ]),
    ).toBe('failure');
  });
});
