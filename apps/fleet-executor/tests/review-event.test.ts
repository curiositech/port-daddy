/**
 * When the fleet REJECTS a pull request, and when it must not.
 *
 * Every fleet review used to post as `COMMENT`, on the reasoning that gating
 * belongs to the check run. That made the review surface lie by omission: a
 * blocking ship could find ten real defects and the PR still showed no reviewer
 * objecting — only a red check, which people learn to scroll past. A ship
 * configured as *blocking* is not advisory, and the review state should say so.
 *
 * The restraint matters as much as the rejection. REQUEST_CHANGES is a demand
 * on a human's time, so it is reserved for the case that is both TRUE (a
 * blocking ship's own judgement, not an infrastructure failure) and ACTIONABLE
 * (it names at least one HIGH defect). Rejecting with nothing to point at
 * teaches authors to dismiss the signal exactly as they learned to dismiss the
 * check.
 */
import { describe, expect, it } from 'vitest';

import { reviewEventFor, type Finding, type ShipResult } from '../src/verdict.js';

const high: Finding = { path: 'lib/a.ts', line: 1, severity: 'HIGH', body: 'real defect' };
const med: Finding = { path: 'lib/a.ts', line: 2, severity: 'MEDIUM', body: 'nit' };

const ship = (over: Partial<ShipResult>): ShipResult => ({
  ship: 'code-reviewer',
  blocking: true,
  verdict: 'BLOCK',
  errored: false,
  ...over,
} as ShipResult);

describe('the fleet rejects when a blocking ship names a real defect', () => {
  it('blocking + BLOCK + a HIGH finding => REQUEST_CHANGES', () => {
    expect(reviewEventFor([ship({ findings: [high] })])).toBe('REQUEST_CHANGES');
  });

  it('one rejecting ship is enough, even beside passing ones', () => {
    expect(
      reviewEventFor([
        ship({ ship: 'qa', verdict: 'PASS', findings: [] }),
        ship({ findings: [high] }),
      ]),
    ).toBe('REQUEST_CHANGES');
  });
});

describe('the restraints — where rejecting would be false or unactionable', () => {
  it('an ADVISORY ship never rejects, however severe its findings', () => {
    // THE BELIEF: blocking is a configuration decision about which ships get to
    // stop a merge. An advisory ship escalating itself to REQUEST_CHANGES would
    // silently overrule that decision.
    expect(reviewEventFor([ship({ blocking: false, findings: [high] })])).toBe('COMMENT');
  });

  it('a blocking ship with only MEDIUM/LOW findings does not reject', () => {
    // Requesting changes over a nit spends the author's attention on the wrong
    // thing and devalues the next real rejection.
    expect(reviewEventFor([ship({ findings: [med] })])).toBe('COMMENT');
  });

  it('a blocking ship that ERRORED does not reject', () => {
    // It still fails the check closed — an absent review is not an approval —
    // but demanding changes while naming no defect is unactionable. The
    // distinction between "I judged this bad" and "I could not judge it" is the
    // whole point of keeping errored separate from BLOCK.
    expect(reviewEventFor([ship({ errored: true, findings: [high] })])).toBe('COMMENT');
  });

  it('a blocking ship with NO USABLE OUTPUT does not reject', () => {
    expect(reviewEventFor([ship({ noUsableOutput: true, findings: [high] })])).toBe('COMMENT');
  });

  it('a BLOCK verdict with an empty findings list does not reject', () => {
    expect(reviewEventFor([ship({ findings: [] })])).toBe('COMMENT');
  });

  it('a legacy result with no findings field does not reject', () => {
    // Absent is not empty, and it is certainly not "ten HIGH defects".
    expect(reviewEventFor([ship({})])).toBe('COMMENT');
  });

  it('a clean run never APPROVES', () => {
    // THE BELIEF: a passing bot is not a merge authorisation. Emitting APPROVE
    // could satisfy a branch-protection review requirement, converting "the
    // linter liked it" into "a reviewer signed off" — a power nobody granted it.
    expect(reviewEventFor([ship({ verdict: 'PASS', findings: [] })])).toBe('COMMENT');
    expect(reviewEventFor([])).toBe('COMMENT');
  });

  it('severity matching is case-insensitive', () => {
    // Cast: the wire format is JSON from a model, so a lowercase severity is a
    // real thing that can arrive even though the type says otherwise.
    expect(
      reviewEventFor([ship({ findings: [{ ...high, severity: 'high' as unknown as Finding['severity'] }] })]),
    ).toBe('REQUEST_CHANGES');
  });
});
