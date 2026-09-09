import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const content = readFileSync(
  new URL('../../docs/recovery/UNIFIED-ROADMAP.md', import.meta.url),
  'utf8',
);
const heading = '## Track 8: Coordination Papers Proof And Runtime Closure';
const start = content.indexOf(heading);
const end = content.indexOf('\n## ', start + heading.length);
const section = start >= 0 ? content.slice(start, end >= 0 ? end : undefined) : '';

const count = (text, needle) => text.split(needle).length - 1;
const normalizedSection = section.replace(/\s+/gu, ' ');

// Track 8's prose is hand-maintained and gets reworded like any other roadmap
// copy. The seven priorities below are ALREADY written two different ways in
// this repo: this file says "sealed relay" where docs/roadmap/roadmap.snapshot.json
// says "sealed cross-harbor relay", and "federated revocation" against
// "witness-log revocation". Harmonising the two — an obviously correct edit —
// would fail a verbatim-phrase assertion on four of these at once. What has to
// survive a reword is that the track still names each priority and still gates
// the release on production-only evidence, so match the least-synonymisable
// term of art for each commitment rather than the sentence it happens to sit in.
const IMPLEMENTATION_PRIORITIES = [
  /reputation-grade/iu,
  /actor[\s-]identity/iu,
  /checkpoints/iu,
  /sealed[\w\s-]*relay/iu,
  /revocation/iu,
  /custody[\s/]*(?:and\s+)?settlement/iu,
  /projection[\s-]consistency/iu,
];

// The exit condition is what stops the release item being called done on
// preview evidence: a live route, the production artifact measurements, and
// the commit they were built from. `now` and `done` are workflow status
// values, not prose, so those stay pinned exactly.
const RELEASE_EXIT_EVIDENCE = [
  /library route/iu,
  /page count/iu,
  /hash/iu,
  /source commit/iu,
];

describe('Coordination Papers roadmap track', () => {
  it('appears exactly once and before the deferred-work section', () => {
    assert.equal(count(content, heading), 1);
    assert.ok(start >= 0);
    assert.ok(start < content.indexOf('## Not Doing Right Now'));
  });

  it('links the canonical research program and all four registry items once', () => {
    assert.equal(
      count(section, '[`docs/roadmap/whitepaper-research-program.md`](../roadmap/whitepaper-research-program.md)'),
      1,
    );

    for (const slug of [
      'coordination-papers-mega-volume',
      'coordination-papers-proof-program',
      'coordination-papers-empirical-program',
      'coordination-papers-runtime-closure',
    ]) {
      assert.equal(count(section, `link:${slug}`), 1, `${slug} must be linked exactly once`);
    }
  });

  it('states the implementation priorities and production-only exit condition', () => {
    for (const priority of IMPLEMENTATION_PRIORITIES) {
      assert.match(normalizedSection, priority, `Track 8 no longer names priority ${priority}`);
    }

    for (const evidence of RELEASE_EXIT_EVIDENCE) {
      assert.match(normalizedSection, evidence, `Track 8 exit condition dropped ${evidence}`);
    }

    // The gate itself: the release item is held at `now` and only reaches
    // `done` once that evidence is recorded. Losing either status token means
    // the exit condition stopped being a gate.
    assert.match(normalizedSection, /`now`/u, 'Track 8 must keep the release item at `now`');
    assert.match(normalizedSection, /`done`/u, 'Track 8 must state the `done` transition');
  });
});
