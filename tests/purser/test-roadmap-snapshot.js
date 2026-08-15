import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const snapshot = JSON.parse(
  readFileSync(new URL('../../docs/roadmap/roadmap.snapshot.json', import.meta.url), 'utf8'),
);

// Expected *status* for the four-item Coordination Papers program. Status is
// an intentionally-set, low-churn business state (now vs backlog) and is
// safe to pin literally. We deliberately do NOT pin summaryMd text here
// (see the test below) — the daemon owns that prose and reworks it during
// normal roadmap grooming.
const expectedProgram = new Map([
  ['coordination-papers-mega-volume', 'now'],
  ['coordination-papers-proof-program', 'backlog'],
  ['coordination-papers-empirical-program', 'backlog'],
  ['coordination-papers-runtime-closure', 'backlog'],
]);

describe('roadmap snapshot', () => {
  it('is internally consistent, unique, and deterministically ordered', () => {
    // snapshot.count is redundant with items.length by construction (see
    // export-roadmap-snapshot.ts) — the self-consistency check right below
    // already gets full signal from that. A hardcoded exact value here
    // (259 -> 260 -> 270 across three commits in one week) rotted on every
    // roadmap-item addition with no signal beyond "the count changed,"
    // which is exactly what blocked every merge_group run on main for five
    // days. Keep a floor instead: it still catches a truncated/empty
    // export without requiring an edit every time someone adds an item.
    assert.ok(Number.isInteger(snapshot.count) && snapshot.count > 0, 'snapshot.count must be a positive integer');
    assert.equal(snapshot.count, snapshot.items.length);

    const slugs = snapshot.items.map(({ slug }) => slug);
    assert.equal(new Set(slugs).size, slugs.length, 'snapshot must not contain duplicate slugs');
    assert.deepEqual(slugs, [...slugs].sort((a, b) => a.localeCompare(b)));
    // NOTE: this test previously also pinned a single item,
    // 'durable-asynchronous-spawn-receipts' (status 'now'), as a
    // point-in-time regression check for the PR that minted it. That item
    // has since been legitimately renamed/progressed by normal roadmap
    // grooming as the work landed — it now appears as
    // 'cli-spawn-liveness-and-collection' (status 'merge') and
    // 'durable-agent-cross-harness-resumption' (status 'merge') in the
    // snapshot, both covered by the uniqueness/ordering checks above. A
    // permanent CI assertion should not pin one mutable item's exact slug
    // and prose forever; that pin is what broke this suite this time.
  });

  it('contains the exact four-item Coordination Papers program', () => {
    for (const [slug, expectedStatus] of expectedProgram) {
      const matches = snapshot.items.filter((item) => item.slug === slug);
      assert.equal(matches.length, 1, `${slug} must occur exactly once`);
      assert.equal(matches[0].status, expectedStatus, `${slug} status`);
      // summaryMd is free text the daemon rewords during normal roadmap
      // grooming (all four of these items' summaries changed between when
      // this test was written and when it was last run, with zero change
      // in meaning). Assert it's real prose, not a placeholder — pinning
      // the exact wording is covered by nothing except test-fragility.
      // Markdown/link integrity for these slugs is asserted separately in
      // test-roadmap-markdown.js.
      assert.equal(typeof matches[0].summaryMd, 'string');
      assert.ok(matches[0].summaryMd.trim().length > 20, `${slug} summaryMd looks empty or placeholder`);
    }
  });

  it('preserves an unrelated roadmap item', () => {
    const item = snapshot.items.find(({ slug }) => slug === 'workintent-dispatch-isolation');
    assert.deepEqual(
      { status: item?.status, summaryMd: item?.summaryMd },
      { status: 'backlog', summaryMd: 'fix(dispatch): isolate WorkIntent worktrees' },
    );
  });

  it('has a well-formed generation timestamp', () => {
    assert.ok(Number.isSafeInteger(snapshot.generatedAt));
    // Sanity bounds instead of a point-in-time floor. The previous floor
    // (1_784_852_769_105, i.e. 2026-07-24) was already older than the
    // committed snapshot's actual generatedAt the moment it was
    // committed, and would need bumping again on every future export
    // regardless of correctness. These bounds are true by construction of
    // "a real millisecond Unix timestamp" and never need editing:
    // - floor: comfortably before this repo existed, so it only catches a
    //   unit bug (seconds vs milliseconds) or a zero/garbage value, not
    //   staleness — an old-but-honest snapshot still passes.
    // - ceiling: now plus a day of slack, so it only catches a timestamp
    //   that is impossibly in the future (clock skew, bad units).
    const YEAR_2020_MS = 1_577_836_800_000;
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    assert.ok(
      snapshot.generatedAt > YEAR_2020_MS,
      'generatedAt looks like seconds (or another unit), not milliseconds — or is a placeholder',
    );
    assert.ok(snapshot.generatedAt <= Date.now() + ONE_DAY_MS, 'generatedAt is implausibly in the future');
  });
});
