/**
 * A reported number must not be able to look complete when it is not.
 *
 * This suite exists because of a review finding on the change that introduced
 * per-call costing. That change was written to stop a ship's spend being priced
 * at one model's rate -- and it left the older, quieter version of the same
 * fault in place: `usageReported` asserts only that SOME call carried a usage
 * block, so a run where 3 of 93 calls reported produced token and cost figures
 * covering three calls, rendered next to `calls: 93`.
 *
 * Nothing throws. Nothing goes red. The run page shows a plausible dollar
 * figure, and the operator has no way to know it covers 3% of the work. That is
 * strictly worse than showing nothing, because a blank invites a question and a
 * wrong number does not.
 *
 * So `spendHonesty()` is a pure function with its own tests rather than an
 * inline ternary: the decision "is this figure a total or a floor" is the whole
 * point, and it should be provable without standing up a fleet run.
 */
import { describe, expect, it } from 'vitest';

import { spendHonesty } from '../src/execute.js';

describe('a spend figure declares whether it is a total or a floor', () => {
  it('says nothing when every call was both priced and reported', () => {
    // A silent pass is correct here: absent flags mean "these are totals", and
    // stamping costIsFloor: false on every honest row would train readers to
    // ignore the field.
    expect(spendHonesty({ calls: 9, usageReports: 9, unpricedCalls: 0 })).toEqual({});
  });

  it('marks a floor when a call reported no usage at all', () => {
    // The 3-of-93 case from the review finding. Tokens AND cost are understated,
    // because a call with no usage block contributes nothing to either sum.
    expect(spendHonesty({ calls: 93, usageReports: 3, unpricedCalls: 0 })).toEqual({
      costIsFloor: true,
      unreportedCalls: 90,
    });
  });

  it('marks a floor when a call ran on a model with no published rate', () => {
    // Distinct from the above: the tokens are correct, only the COST is
    // understated, because costUsdForModel returns 0 for an unpriced model.
    // Counted separately so a reader can tell which figure to distrust.
    expect(spendHonesty({ calls: 10, usageReports: 10, unpricedCalls: 2 })).toEqual({
      costIsFloor: true,
      unpricedCalls: 2,
    });
  });

  it('reports both causes independently when both apply', () => {
    expect(spendHonesty({ calls: 20, usageReports: 12, unpricedCalls: 5 })).toEqual({
      costIsFloor: true,
      unpricedCalls: 5,
      unreportedCalls: 8,
    });
  });

  it('never emits a negative count if usageReports somehow exceeds calls', () => {
    // Defensive: the two counters are incremented in the same function so this
    // should be impossible, but a negative `unreportedCalls` on the run page
    // would be a worse bug than the one being guarded against.
    expect(spendHonesty({ calls: 2, usageReports: 5, unpricedCalls: 0 })).toEqual({});
  });

  it('a fully-unreported run is a floor, not a zero', () => {
    // The caller skips the token block entirely when usageReports === 0, but
    // spendHonesty must still be correct in isolation -- it is exported, and
    // the next caller may not have that guard.
    expect(spendHonesty({ calls: 4, usageReports: 0, unpricedCalls: 0 })).toEqual({
      costIsFloor: true,
      unreportedCalls: 4,
    });
  });
});
