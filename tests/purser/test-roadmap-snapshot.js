import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const snapshot = JSON.parse(
  readFileSync(new URL('../../docs/roadmap/roadmap.snapshot.json', import.meta.url), 'utf8'),
);

const expectedProgram = new Map([
  [
    'coordination-papers-mega-volume',
    {
      status: 'now',
      summaryMd:
        'Publish the audited seven-paper coordination series as a coherent collected volume with corrected figures and math, implementation-status ledger, collated table of contents and references, proof roadmap, library metadata, reproducible build receipts, and production artifact verification.',
    },
  ],
  [
    'coordination-papers-proof-program',
    {
      status: 'backlog',
      summaryMd:
        'Close theorem, security, game-theoretic, conservation, dissemination, oracle-independence, Proof-of-Attention, and model-to-runtime conformance obligations under named adversaries and parameter regions.',
    },
  ],
  [
    'coordination-papers-empirical-program',
    {
      status: 'backlog',
      summaryMd:
        'Measure operator miss and false-alarm costs, judge validity, crash and partition behavior, identity-reset resistance, revocation lag, and other parameters with reproducible, versioned trace bundles.',
    },
  ],
  [
    'coordination-papers-runtime-closure',
    {
      status: 'backlog',
      summaryMd:
        'Close publication runtime gaps exposed by the rigor pass: resumable Fleet ships and review chunks, bounded GitHub I/O, the fleet_run_spend migration, exact-head memory and empty-provider receipts, stale-head coalescing, promotion criteria for paper claims, and witnessed implementation-status evidence.',
    },
  ],
]);

describe('roadmap snapshot', () => {
  it('is internally consistent, unique, and deterministically ordered', () => {
    assert.equal(snapshot.count, 272);
    assert.equal(snapshot.count, snapshot.items.length);

    const slugs = snapshot.items.map(({ slug }) => slug);
    assert.equal(new Set(slugs).size, slugs.length, 'snapshot must not contain duplicate slugs');
    assert.deepEqual(slugs, [...slugs].sort((a, b) => a.localeCompare(b)));
    assert.deepEqual(
      snapshot.items.filter(
        ({ slug }) => slug === 'durable-asynchronous-spawn-receipts',
      ),
      [
        {
          slug: 'durable-asynchronous-spawn-receipts',
          status: 'now',
          summaryMd:
            'Durable idempotent admission, lifecycle, liveness, cancellation, and collection receipts for background agent runs.',
        },
      ],
    );
  });

  it('contains the exact four-item Coordination Papers program', () => {
    for (const [slug, expected] of expectedProgram) {
      const matches = snapshot.items.filter((item) => item.slug === slug);
      assert.equal(matches.length, 1, `${slug} must occur exactly once`);
      assert.deepEqual(
        { status: matches[0].status, summaryMd: matches[0].summaryMd },
        expected,
      );
    }
  });

  it('preserves an unrelated roadmap item', () => {
    const item = snapshot.items.find(({ slug }) => slug === 'workintent-dispatch-isolation');
    assert.deepEqual(
      { status: item?.status, summaryMd: item?.summaryMd },
      { status: 'backlog', summaryMd: 'fix(dispatch): isolate WorkIntent worktrees' },
    );
  });

  it('has a fresh, well-formed generation timestamp', () => {
    assert.ok(Number.isSafeInteger(snapshot.generatedAt));
    assert.ok(snapshot.generatedAt > 1_784_852_769_105);
  });
});
