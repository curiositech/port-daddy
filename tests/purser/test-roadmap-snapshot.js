import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const snapshot = JSON.parse(
  readFileSync(new URL('../../docs/roadmap/roadmap.snapshot.json', import.meta.url), 'utf8'),
);

// A live roadmap's summaryMd prose is *expected* to be edited — polished,
// corrected, reworded — without that being a regression. Pinning the exact
// string here made this suite fail every time anyone touched wording
// unrelated to the PR under test. What must stay true across an edit is
// structural: the item exists exactly once, its workflow status didn't
// silently flip, and its description wasn't gutted to empty/near-empty.
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

const expectedProgram = new Map([
  ['coordination-papers-mega-volume', 'now'],
  ['coordination-papers-proof-program', 'backlog'],
  ['coordination-papers-empirical-program', 'backlog'],
  ['coordination-papers-runtime-closure', 'backlog'],
]);

describe('roadmap snapshot', () => {
  it('is internally consistent, unique, and deterministically ordered', () => {
    // snapshot.count is redundant with items.length by construction (see
    // export-roadmap-snapshot.ts). Keep a floor so we still catch a
    // truncated/empty export without hardcoding a point-in-time count.
    assert.ok(Number.isInteger(snapshot.count) && snapshot.count > 0, 'snapshot.count must be a positive integer');
    assert.equal(snapshot.count, snapshot.items.length);

    const slugs = snapshot.items.map(({ slug }) => slug);
    assert.equal(new Set(slugs).size, slugs.length, 'snapshot must not contain duplicate slugs');
    assert.deepEqual(slugs, [...slugs].sort((a, b) => a.localeCompare(b)));
    // NOTE: this test previously pinned one mutable item
    // ('durable-asynchronous-spawn-receipts'). That item was legitimately
    // renamed/progressed during roadmap grooming, so the pin caused false
    // failures and was intentionally removed.
  });

  it('contains the exact four-item Coordination Papers program', () => {
    for (const [slug, expectedStatus] of expectedProgram) {
      assertHealthyItem(snapshot.items, slug, expectedStatus);
    }
  });

  it('preserves an unrelated roadmap item', () => {
    assertHealthyItem(snapshot.items, 'workintent-dispatch-isolation', 'backlog');
  });

  it('has a well-formed generation timestamp', () => {
    assert.ok(Number.isSafeInteger(snapshot.generatedAt));
    // Sanity bounds instead of a point-in-time floor:
    // - floor catches unit bugs (seconds vs milliseconds) or placeholder values.
    // - ceiling catches impossible future timestamps.
    const YEAR_2020_MS = 1_577_836_800_000;
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    assert.ok(
      snapshot.generatedAt > YEAR_2020_MS,
      'generatedAt looks like seconds (or another unit), not milliseconds — or is a placeholder',
    );
    assert.ok(snapshot.generatedAt <= Date.now() + ONE_DAY_MS, 'generatedAt is implausibly in the future');
  });
});
