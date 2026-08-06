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
        'Publish the seven-paper Coordination Papers as one cohesive collected volume with a global introduction, collated contents and references, consolidated status ledger, notation concordance, research appendix, full-page visual audit, library surface, and production artifact.',
    },
  ],
  [
    'coordination-papers-proof-program',
    {
      status: 'backlog',
      summaryMd:
        'Close the whitepaper proof obligations: theorem assumption/deviation matrices, settlement/custody conservation, revocation dissemination bounds under partitions, model-to-runtime conformance, Proof-of-Attention game class and tightness, and explicit conditionality for grading-oracle incentive compatibility.',
    },
  ],
  [
    'coordination-papers-empirical-program',
    {
      status: 'backlog',
      summaryMd:
        'Run the empirical program behind the papers: estimate miss/false-alarm costs, detection and slash probabilities, discount and payoff parameters; validate judge reliability and conflicts; chaos-test partitions, redelivery, crash recovery, and identity-reset laundering; publish reproducible traces.',
    },
  ],
  [
    'coordination-papers-runtime-closure',
    {
      status: 'backlog',
      summaryMd:
        'Close the code gaps exposed by the papers: reputation-grade witnessed outcomes on commitments, actor identity at every write boundary, portable execution checkpoints, sealed cross-harbor relay, witness-log revocation, custody and settlement prototype, and projection-consistency enforcement.',
    },
  ],
]);

describe('roadmap snapshot', () => {
  it('is internally consistent, unique, and deterministically ordered', () => {
    assert.equal(snapshot.count, 262);
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
