/**
 * Tests for scripts/fleet-citation-scoreboard.mjs — the measurement half of
 * the fleet citation-integrity work (the enforcement half lives in
 * apps/fleet-executor/src/citation-audit.ts and its own vitest suite).
 *
 * The extraction is pinned against the fleet's REAL posting format
 * (findings-render.ts machine blocks + pd-ship markers), and the audit against
 * a real tree — this repo's own files — so a format drift in either place
 * fails here by name.
 */
import { describe, expect, test } from '@jest/globals';
import {
  auditRecords,
  extractShipRecords,
  isPathShaped,
  mergeRows,
  parseMachinePayload,
} from '../../scripts/fleet-citation-scoreboard.mjs';

const findingsComment = (ship, findings) =>
  `#### findings\n\n<!-- pd-findings-json\n${JSON.stringify(findings)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')}\n-->\n\n<!-- pd-ship:${ship} -->`;

describe('extractShipRecords', () => {
  test('reads the ship marker and the findings machine block verbatim', () => {
    const rec = extractShipRecords(
      findingsComment('qa', [{ path: 'scripts/check-doc-citations.mjs', line: 1, severity: 'HIGH', body: 'x' }]),
    );
    expect(rec.ship).toBe('qa');
    expect(rec.findings).toHaveLength(1);
  });

  test('a comment with no ship marker is not a fleet comment', () => {
    expect(extractShipRecords('just some human comment with `a/b.ts`')).toBeNull();
  });

  test('entity-mangled braces are recovered, but only as a fallback', () => {
    expect(parseMachinePayload('[&#123;"a":1&#125;]')).toEqual([{ a: 1 }]);
    // A body string legitimately containing the entity survives the verbatim parse.
    expect(parseMachinePayload('[{"body":"&#123;"}]')).toEqual([{ body: '&#123;' }]);
  });
});

describe('auditRecords against this repository', () => {
  test('a real path with a sane line is clean; a fabricated path is counted', () => {
    const row = auditRecords({
      ship: 'qa',
      findings: [
        { path: 'scripts/check-doc-citations.mjs', line: 1, severity: 'HIGH', body: 'x' },
        // Posted verbatim by pd-spark on #9224; exists on no ref.
        { path: 'apps/relay/src/csp-validator.ts', line: 10, severity: 'HIGH', body: 'x' },
      ],
      proposals: [],
    });
    expect(row.pathMissing).toBe(1);
    expect(row.linePastEof).toBe(0);
  });

  test('a line past EOF on a real file is counted as objectively wrong', () => {
    const row = auditRecords({
      ship: 'qa',
      findings: [{ path: 'package.json', line: 999999, severity: 'LOW', body: 'x' }],
      proposals: [],
    });
    expect(row.pathMissing).toBe(0);
    expect(row.linePastEof).toBe(1);
  });

  test('proposal evidence is audited; concepts are not counted as citations', () => {
    const row = auditRecords({
      ship: 'spider',
      findings: [],
      proposals: [{ title: 'p', evidence: ['cli/visibility.py', 'PR description', 'package.json'] }],
    });
    expect(row.proposalCitations).toBe(2); // the two path-shaped entries
    expect(row.pathMissing).toBe(1); // cli/visibility.py
  });
});

describe('mergeRows', () => {
  test('aggregates per ship and sorts worst-first', () => {
    const merged = mergeRows([
      { ship: 'qa', findings: 2, proposalCitations: 0, pathMissing: 0, linePastEof: 1, examples: [] },
      { ship: 'spark', findings: 0, proposalCitations: 3, pathMissing: 3, linePastEof: 0, examples: [] },
      { ship: 'qa', findings: 1, proposalCitations: 0, pathMissing: 1, linePastEof: 0, examples: [] },
    ]);
    expect(merged[0].ship).toBe('spark');
    const qa = merged.find(r => r.ship === 'qa');
    expect(qa).toMatchObject({ findings: 3, pathMissing: 1, linePastEof: 1 });
  });
});

describe('isPathShaped parity with the executor module', () => {
  test('the two implementations agree on the boundary cases', () => {
    for (const [input, expected] of [
      ['apps/relay/src/x.ts', true],
      ['CHANGELOG.md', true],
      ['PR description', false],
      ['skills/<name>/SKILL.md', false],
      ['a/*.json', false],
    ]) {
      expect(isPathShaped(input)).toBe(expected);
    }
  });
});
