import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const snapshot = JSON.parse(
  readFileSync(new URL('../../docs/roadmap/roadmap.snapshot.json', import.meta.url), 'utf8'),
);

// A live roadmap's summaryMd prose is *expected* to be edited — polished,
// corrected, reworded — without that being a regression. Pinning the exact
// string here made this suite fail every time anyone touched wording
// unrelated to the PR under test (observed twice inside one ten-minute
// window under normal multi-agent write volume on 2026-08-12). What must
// stay true across an edit is structural: the item exists exactly once,
// its workflow status didn't silently flip, and its description wasn't
// gutted to empty/near-empty. That's what this asserts instead.
const MIN_SUMMARY_LENGTH = 20;

function assertHealthyItem(items, slug, expectedStatus) {
  const matches = items.filter((item) => item.slug === slug);
  assert.equal(matches.length, 1, `${slug} must occur exactly once`);
  const [item] = matches;
  assert.equal(item.status, expectedStatus, `${slug} status must be '${expectedStatus}'`);
  assert.equal(typeof item.summaryMd, 'string', `${slug} summaryMd must be a string`);
  assert.ok(
    item.summaryMd.trim().length >= MIN_SUMMARY_LENGTH,
    `${slug} summaryMd must be a real description (>= ${MIN_SUMMARY_LENGTH} chars), got: ${JSON.stringify(item.summaryMd)}`,
  );
}

const coordinationPapersProgram = [
  ['coordination-papers-mega-volume', 'now'],
  ['coordination-papers-proof-program', 'backlog'],
  ['coordination-papers-empirical-program', 'backlog'],
  ['coordination-papers-runtime-closure', 'backlog'],
];

describe('roadmap snapshot', () => {
  it('is internally consistent, unique, and deterministically ordered', () => {
    assert.equal(snapshot.count, snapshot.items.length);

    const slugs = snapshot.items.map(({ slug }) => slug);
    assert.equal(new Set(slugs).size, slugs.length, 'snapshot must not contain duplicate slugs');
    assert.deepEqual(slugs, [...slugs].sort((a, b) => a.localeCompare(b)));
  });

  it('contains the exact four-item Coordination Papers program', () => {
    for (const [slug, status] of coordinationPapersProgram) {
      assertHealthyItem(snapshot.items, slug, status);
    }
  });

  it('preserves an unrelated roadmap item', () => {
    assertHealthyItem(snapshot.items, 'workintent-dispatch-isolation', 'now');
  });

  it('has a fresh, well-formed generation timestamp', () => {
    assert.ok(Number.isSafeInteger(snapshot.generatedAt));
    assert.ok(snapshot.generatedAt > 1_784_852_769_105);
  });
});
