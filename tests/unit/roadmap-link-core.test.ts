import {
  parseRoadmapTrailer,
  snapshotBrokenReason,
  classify,
  isPlanningDoc,
  planningDocsIn,
  parseSpawns,
  classifyPlanningSpawn,
  type RoadmapSnapshot,
} from '../../lib/roadmap-link-core';

const NOW = 1_790_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function snap(items: Array<{ slug: string; status?: string }>, ageDays = 0): RoadmapSnapshot {
  return {
    generatedAt: NOW - ageDays * DAY,
    harbor: 'port-daddy',
    items: items.map((i) => ({ slug: i.slug, status: i.status ?? 'now' })),
  };
}

const FRESH = snap([
  { slug: 'adr-0044-phase-0-dark-launch-resolver' },
  { slug: 'roadmap-link-gate' },
]);

describe('parseRoadmapTrailer', () => {
  test('extracts a slug from the Roadmap-Item trailer', () => {
    const body = 'Fixes the thing.\n\nRoadmap-Item: roadmap-link-gate\n';
    expect(parseRoadmapTrailer(body)).toEqual({ slug: 'roadmap-link-gate', optOutReason: null });
  });

  test('accepts the `Roadmap:` alias and is case-insensitive', () => {
    expect(parseRoadmapTrailer('roadmap: my-slug').slug).toBe('my-slug');
    expect(parseRoadmapTrailer('ROADMAP-ITEM:  spaced-slug ').slug).toBe('spaced-slug');
  });

  test('parses an explicit opt-out with an em-dash reason', () => {
    expect(parseRoadmapTrailer('Roadmap-Item: none — pure docs fix')).toEqual({
      slug: null,
      optOutReason: 'pure docs fix',
    });
  });

  test('parses opt-out with hyphen and colon separators, and bare none', () => {
    expect(parseRoadmapTrailer('Roadmap-Item: none - hotfix').optOutReason).toBe('hotfix');
    expect(parseRoadmapTrailer('Roadmap-Item: none').optOutReason).toBe('unspecified');
  });

  test('a trailing note after the slug is ignored', () => {
    expect(parseRoadmapTrailer('Roadmap-Item: my-slug — see thread').slug).toBe('my-slug');
  });

  test('the last trailer wins (edited PRs)', () => {
    expect(parseRoadmapTrailer('Roadmap-Item: old\nRoadmap-Item: new').slug).toBe('new');
  });

  test('no trailer yields nulls', () => {
    expect(parseRoadmapTrailer('just a description')).toEqual({ slug: null, optOutReason: null });
    expect(parseRoadmapTrailer(null)).toEqual({ slug: null, optOutReason: null });
  });
});

describe('snapshotBrokenReason', () => {
  test('null / malformed snapshot is missing', () => {
    expect(snapshotBrokenReason(null)).toBe('snapshot-missing');
    expect(snapshotBrokenReason({ generatedAt: NOW } as unknown as RoadmapSnapshot)).toBe(
      'snapshot-missing',
    );
  });
  test('zero items is empty', () => {
    expect(snapshotBrokenReason(snap([]))).toBe('snapshot-empty');
  });
  test('a populated snapshot is fine', () => {
    expect(snapshotBrokenReason(FRESH)).toBeNull();
  });
});

describe('classify', () => {
  test('PASS when linked to an existing item', () => {
    const r = classify('Roadmap-Item: roadmap-link-gate', FRESH, { now: NOW });
    expect(r.verdict).toBe('pass');
    expect(r.reason).toBe('linked');
    expect(r.requiresHumanApproval).toBe(false);
    expect(r.labelShouldBePresent).toBe(false);
    expect(r.loud).toBe(false);
  });

  test('PASS on an explicit opt-out', () => {
    const r = classify('Roadmap-Item: none — docs only', FRESH, { now: NOW });
    expect(r.verdict).toBe('pass');
    expect(r.reason).toBe('opt-out');
    expect(r.optOutReason).toBe('docs only');
    expect(r.requiresHumanApproval).toBe(false);
  });

  test('NEEDS-APPROVAL when no trailer present', () => {
    const r = classify('a PR with no roadmap link', FRESH, { now: NOW });
    expect(r.verdict).toBe('needs-approval');
    expect(r.reason).toBe('missing-trailer');
    expect(r.requiresHumanApproval).toBe(true);
    expect(r.labelShouldBePresent).toBe(true);
    expect(r.loud).toBe(false);
  });

  test('NEEDS-APPROVAL + create-suggestion when slug is unknown', () => {
    const r = classify('Roadmap-Item: not-a-real-slug', FRESH, { now: NOW });
    expect(r.verdict).toBe('needs-approval');
    expect(r.reason).toBe('unknown-slug');
    expect(r.slug).toBe('not-a-real-slug');
    expect(r.requiresHumanApproval).toBe(true);
  });

  test('PASS when the unknown slug is declared by the SAME PR’s Roadmap-Spawns (self-spawned)', () => {
    // The 2026-08-19 chicken-and-egg: a PR that lands a program plan is
    // necessarily the first user of the items it creates. The spawn trailer is
    // the auditable declaration; the daemon stays the only writer and the
    // snapshot catches up at the next export.
    const body = [
      'Lands the plan.',
      '',
      'Roadmap-Item: steward-takes-the-seat',
      'Roadmap-Spawns: steward-takes-the-seat, cartographer-dispatches-sailors',
    ].join('\n');
    const r = classify(body, FRESH, { now: NOW });
    expect(r.verdict).toBe('pass');
    expect(r.reason).toBe('self-spawned');
    expect(r.slug).toBe('steward-takes-the-seat');
    expect(r.requiresHumanApproval).toBe(false);
    expect(r.labelShouldBePresent).toBe(false);
  });

  test('self-spawn does NOT rescue a slug absent from the spawns list', () => {
    const body = ['Roadmap-Item: something-else', 'Roadmap-Spawns: steward-takes-the-seat'].join('\n');
    const r = classify(body, FRESH, { now: NOW });
    expect(r.verdict).toBe('needs-approval');
    expect(r.reason).toBe('unknown-slug');
  });

  test('self-spawn against a STALE snapshot still shouts instead of passing', () => {
    const body = ['Roadmap-Item: brand-new', 'Roadmap-Spawns: brand-new'].join('\n');
    const r = classify(body, snap(FRESH.items, 40), { now: NOW, staleAfterDays: 21 });
    expect(r.verdict).toBe('needs-approval');
    expect(r.reason).toBe('snapshot-stale');
    expect(r.loud).toBe(true);
    expect(r.requiresHumanApproval).toBe(true);
  });

  test('a slug the snapshot already KNOWS stays reason=linked even when also spawned', () => {
    const body = ['Roadmap-Item: roadmap-link-gate', 'Roadmap-Spawns: roadmap-link-gate'].join('\n');
    const r = classify(body, FRESH, { now: NOW });
    expect(r.reason).toBe('linked');
  });

  test('BROKEN + loud when snapshot is missing', () => {
    const r = classify('Roadmap-Item: anything', null, { now: NOW });
    expect(r.verdict).toBe('broken');
    expect(r.reason).toBe('snapshot-missing');
    expect(r.loud).toBe(true);
    expect(r.requiresHumanApproval).toBe(true);
  });

  test('BROKEN + loud when snapshot has zero items', () => {
    const r = classify('Roadmap-Item: anything', snap([]), { now: NOW });
    expect(r.verdict).toBe('broken');
    expect(r.reason).toBe('snapshot-empty');
    expect(r.loud).toBe(true);
  });

  test('stale snapshot is loud even for an otherwise-valid link', () => {
    const r = classify('Roadmap-Item: roadmap-link-gate', snap(FRESH.items, 30), {
      now: NOW,
      staleAfterDays: 21,
    });
    expect(r.reason).toBe('snapshot-stale');
    expect(r.loud).toBe(true);
    expect(r.requiresHumanApproval).toBe(true);
  });

  test('unknown slug against a stale snapshot is treated as broken (might already exist)', () => {
    const r = classify('Roadmap-Item: maybe-new', snap(FRESH.items, 40), { now: NOW });
    expect(r.verdict).toBe('broken');
    expect(r.loud).toBe(true);
  });
});

describe('isPlanningDoc / planningDocsIn', () => {
  test('numbered ADRs and top-level plans are planning docs', () => {
    expect(isPlanningDoc('docs/adr/0044-shadow-db-path-consolidation.md')).toBe(true);
    expect(isPlanningDoc('PLAN.md')).toBe(true);
    expect(isPlanningDoc('V4-DAG.md')).toBe(true);
    expect(isPlanningDoc('docs/marketing/launch-proposal.md')).toBe(true);
  });
  test('ordinary code and non-planning docs are not', () => {
    expect(isPlanningDoc('lib/roadmap-items.ts')).toBe(false);
    expect(isPlanningDoc('docs/operations/daemon-and-supervision.md')).toBe(false);
    expect(isPlanningDoc('README.md')).toBe(false);
  });
  test('planningDocsIn filters a changed-file list', () => {
    expect(
      planningDocsIn(['lib/x.ts', 'docs/adr/0090-thing.md', 'README.md']),
    ).toEqual(['docs/adr/0090-thing.md']);
  });
});

describe('parseSpawns', () => {
  test('comma/space separated slug list', () => {
    expect(parseSpawns('Roadmap-Spawns: a-slug, b-slug c-slug').slugs).toEqual([
      'a-slug',
      'b-slug',
      'c-slug',
    ]);
  });
  test('opt-out with reason', () => {
    const r = parseSpawns('Roadmap-Spawns: none — supersedes ADR-0050, no new work');
    expect(r.slugs).toEqual([]);
    expect(r.optOutReason).toContain('supersedes');
  });
  test('absent trailer yields empty', () => {
    expect(parseSpawns('no trailer here')).toEqual({ slugs: [], optOutReason: null });
  });
});

describe('classifyPlanningSpawn', () => {
  test('non-planning PR is a pass and inert', () => {
    const r = classifyPlanningSpawn('Roadmap-Item: x', ['lib/a.ts', 'src/b.ts']);
    expect(r.isPlanning).toBe(false);
    expect(r.verdict).toBe('pass');
    expect(r.labelShouldBePresent).toBe(false);
  });

  test('planning PR WITHOUT spawns needs approval', () => {
    const r = classifyPlanningSpawn('Roadmap-Item: x', ['docs/adr/0091-new-thing.md']);
    expect(r.isPlanning).toBe(true);
    expect(r.reason).toBe('missing-spawns');
    expect(r.verdict).toBe('needs-approval');
    expect(r.requiresHumanApproval).toBe(true);
    expect(r.labelShouldBePresent).toBe(true);
  });

  test('planning PR WITH declared spawns passes', () => {
    const r = classifyPlanningSpawn(
      'Roadmap-Item: x\nRoadmap-Spawns: adr-0091-phase-0, adr-0091-phase-1',
      ['docs/adr/0091-new-thing.md'],
    );
    expect(r.verdict).toBe('pass');
    expect(r.reason).toBe('spawns-declared');
    expect(r.spawnedSlugs).toEqual(['adr-0091-phase-0', 'adr-0091-phase-1']);
  });

  test('planning PR with explicit spawn opt-out passes', () => {
    const r = classifyPlanningSpawn(
      'Roadmap-Spawns: none — supersedes ADR-0050 only',
      ['docs/adr/0091-new-thing.md'],
    );
    expect(r.verdict).toBe('pass');
    expect(r.reason).toBe('spawn-opt-out');
  });
});
