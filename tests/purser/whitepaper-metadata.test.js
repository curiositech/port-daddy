const whitePapers = require('../../website-v2/src/data/whitePapers');

// QUARANTINED — see tests/purser/ROUTING.json. This file cannot run: jest
// cannot load TypeScript out of website-v2/, so the require above never
// resolves. website-v2/src/data/whitePapers.test.ts covers the same ground
// under vitest, and that is where the live assertions are.
//
// It used to carry `expect(legible.pages).toBe(40)` and
// `expect(swk.pages).toBe(35)`. Both were exact page pins, and both had gone
// stale by more than twenty pages (64 and 58 today) without anyone noticing,
// because a quarantined test tells you nothing when it is wrong. Exact page
// pins are against policy now — page counts move on every real change to the
// manuscript, so they get a floor and a drift band instead. See
// website-v2/scripts/page-count-policy.ts, and the live checks in
// website-v2/src/data/whitePapers.test.ts.

describe('Whitepaper metadata validation', () => {
  test('Legible Swarm names its edition', () => {
    const legible = whitePapers.find(p => p.id === 'legible-swarm');
    expect(legible.status).toBe('Version 1.2 (collected-volume edition)');
  });

  test('Single-Writer Kernel names its edition', () => {
    const swk = whitePapers.find(p => p.id === 'single-writer-kernel');
    expect(swk.status).toBe('Version 1.2 (collected-volume edition)');
  });

  test('No undefined references in metadata', () => {
    expect(whitePapers).not.toContainEqual(expect.objectContaining({ id: expect.stringMatching(/missing-.*$/)}));
  });
});
