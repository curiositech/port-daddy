import {
  cosineSimilarity,
  rankRelated,
  inferPlacement,
  decideDisposition,
  consult,
  selectNextWork,
  DEFAULT_INTAKE_THRESHOLDS,
} from '../../lib/idea-intake.js';

// The idea always points along the first axis. A candidate with vector [c, sqrt(1-c^2)] then
// has cosine similarity exactly `c` to the idea — so tests can dial similarity precisely.
const IDEA = [1, 0];
function vec(c) {
  return [c, Math.sqrt(Math.max(0, 1 - c * c))];
}
function candidate(slug, status, c, opts = {}) {
  return {
    item: { slug, summaryMd: opts.summaryMd ?? `summary for ${slug}`, status },
    vector: vec(c),
  };
}
function draft(opts = {}) {
  return {
    id: opts.id ?? 'draft-1',
    text: opts.text ?? 'an idea',
    harbor: opts.harbor ?? 'fleet',
    by: opts.by ?? null,
    createdAt: opts.createdAt ?? 1_000,
  };
}
function baseInput(candidates, opts = {}) {
  return {
    draft: draft(),
    ideaVector: IDEA,
    candidates,
    claimedSlugs: opts.claimedSlugs ?? new Set(),
    adrPhaseIndex: opts.adrPhaseIndex ?? new Map(),
    thresholds: opts.thresholds ?? DEFAULT_INTAKE_THRESHOLDS,
  };
}

describe('cosineSimilarity', () => {
  test('identical vectors → 1', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1, 10);
  });
  test('orthogonal vectors → 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });
  test('the [c, sqrt(1-c^2)] trick yields cosine c against the idea axis', () => {
    expect(cosineSimilarity(IDEA, vec(0.85))).toBeCloseTo(0.85, 10);
  });
  test('length mismatch or empty → 0 (no throw)', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
  });
});

describe('rankRelated', () => {
  test('drops items below the relate threshold and sorts by similarity desc', () => {
    const ranked = rankRelated(
      IDEA,
      [
        candidate('weak', 'backlog', 0.4), // below 0.5 relate → dropped
        candidate('mid', 'backlog', 0.6),
        candidate('high', 'backlog', 0.9),
      ],
      DEFAULT_INTAKE_THRESHOLDS.relate,
    );
    expect(ranked.map((r) => r.slug)).toEqual(['high', 'mid']);
    expect(ranked[0].similarity).toBeGreaterThan(ranked[1].similarity);
  });
});

describe('inferPlacement', () => {
  test('strong relation to active (now) work suggests now + dependency', () => {
    const related = [{ slug: 'live', summaryMd: 's', status: 'now', similarity: 0.85 }];
    const p = inferPlacement(related, DEFAULT_INTAKE_THRESHOLDS);
    expect(p.status).toBe('now');
    expect(p.dependsOn).toContain('live');
    expect(p.after).toContain('live');
  });
  test('strong relation to backlog work stays backlog; done items are not deps', () => {
    const related = [
      { slug: 'shipped', summaryMd: 's', status: 'done', similarity: 0.85 },
      { slug: 'queued', summaryMd: 's', status: 'backlog', similarity: 0.8 },
    ];
    const p = inferPlacement(related, DEFAULT_INTAKE_THRESHOLDS);
    expect(p.status).toBe('backlog');
    expect(p.dependsOn).toEqual(['queued']);
  });
});

describe('consult — disposition', () => {
  test('auto-commits a mundane idea: one strong backlog relation, no clash, no dup', () => {
    const report = consult(baseInput([candidate('near', 'backlog', 0.85)]));
    expect(report.disposition).toBe('auto-commit');
    expect(report.escalationReasons).toHaveLength(0);
    expect(report.duplicateOf).toBeUndefined();
    expect(report.relatedRoadmap).toHaveLength(1);
    expect(report.suggestedPlacement.status).toBe('backlog');
    expect(report.suggestedPlacement.dependsOn).toContain('near');
  });

  test('escalates on duplicate (similarity ≥ dedup, not done)', () => {
    const report = consult(baseInput([candidate('twin', 'backlog', 0.95)]));
    expect(report.duplicateOf).toBe('twin');
    expect(report.disposition).toBe('escalate');
    expect(report.escalationReasons.join(' ')).toMatch(/duplicate/i);
  });

  test('a near-identical DONE item is not a duplicate → still auto-commits', () => {
    const report = consult(baseInput([candidate('shipped', 'done', 0.95)]));
    expect(report.duplicateOf).toBeUndefined();
    expect(report.disposition).toBe('auto-commit');
    expect(report.suggestedPlacement.status).toBe('backlog');
  });

  test('escalates on in-flight clash (related item is currently claimed)', () => {
    const report = consult(
      baseInput([candidate('contested', 'backlog', 0.85)], {
        claimedSlugs: new Set(['contested']),
      }),
    );
    expect(report.inFlightClashes.map((c) => c.slug)).toEqual(['contested']);
    expect(report.disposition).toBe('escalate');
    expect(report.escalationReasons.join(' ')).toMatch(/in flight/i);
  });

  test('escalates on high-impact placement (suggested status now)', () => {
    const report = consult(baseInput([candidate('live', 'now', 0.85)]));
    expect(report.suggestedPlacement.status).toBe('now');
    expect(report.disposition).toBe('escalate');
    expect(report.escalationReasons.join(' ')).toMatch(/high priority/i);
  });

  test('escalates on low confidence (only weak relations, none strong)', () => {
    const report = consult(baseInput([candidate('vague', 'backlog', 0.6)]));
    expect(report.disposition).toBe('escalate');
    expect(report.escalationReasons.join(' ')).toMatch(/confident/i);
    expect(report.clarifyingQuestions.length).toBeGreaterThan(0);
  });

  test('surfaces covering ADRs via related slugs that are ADR phases', () => {
    const report = consult(
      baseInput([candidate('adr-0043-phase-1', 'backlog', 0.85)], {
        adrPhaseIndex: new Map([['adr-0043-phase-1', '0043']]),
      }),
    );
    expect(report.coveringAdrs).toEqual([{ number: '0043', viaSlug: 'adr-0043-phase-1' }]);
  });
});

describe('decideDisposition — pure', () => {
  test('no triggers → auto-commit', () => {
    const { disposition, reasons } = decideDisposition({
      inFlightClashes: [],
      placement: { status: 'backlog', dependsOn: [], after: [], before: [] },
      topSimilarity: 0.85,
      hasStrongRelation: true,
      thresholds: DEFAULT_INTAKE_THRESHOLDS,
    });
    expect(disposition).toBe('auto-commit');
    expect(reasons).toHaveLength(0);
  });
});

describe('selectNextWork', () => {
  const items = [
    { slug: 'a-now', summaryMd: 's', status: 'now' },
    { slug: 'b-merge', summaryMd: 's', status: 'merge' },
    { slug: 'c-backlog', summaryMd: 's', status: 'backlog' },
    { slug: 'd-done', summaryMd: 's', status: 'done' },
    { slug: 'e-parked', summaryMd: 's', status: 'parked' },
  ];

  test('picks the highest-priority unclaimed, non-done, non-parked item', () => {
    const choice = selectNextWork(items, new Set(), 'agent:x');
    expect(choice.slug).toBe('a-now');
    expect(choice.rationale).toMatch(/agent:x/);
  });

  test('skips claimed items and falls to the next priority tier', () => {
    const choice = selectNextWork(items, new Set(['a-now']), 'agent:x');
    expect(choice.slug).toBe('b-merge');
  });

  test('returns null when nothing is actionable', () => {
    const choice = selectNextWork(
      [
        { slug: 'x', summaryMd: 's', status: 'done' },
        { slug: 'y', summaryMd: 's', status: 'parked' },
        { slug: 'z', summaryMd: 's', status: 'now' },
      ],
      new Set(['z']),
      'agent:x',
    );
    expect(choice).toBeNull();
  });
});
