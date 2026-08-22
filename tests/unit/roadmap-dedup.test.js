/**
 * Port Daddy - scripts/roadmap-dedup.ts Unit Tests
 *
 * Merge semantics for cleaning up cross-harbor duplicate roadmap_items
 * slugs — the same bug class the Planner pane's "77 duplicate slugs" /
 * "harbor split" flags surface. See scripts/roadmap-dedup.ts for the full
 * root-cause writeup.
 */

import { describe, it, test, expect, beforeEach, afterEach } from '@jest/globals';
import {
  groupBySlug,
  checkContradiction,
  pickCanonicalRow,
  planDedup,
  applyDedupPlan,
} from '../../scripts/roadmap-dedup.js';
import { initDatabase } from '../../lib/db.js';
import { createTupleSpace } from '../../lib/tuples.js';
import { createRoadmapItems } from '../../lib/roadmap-items.js';

const NOW = 1_784_000_000_000;

function row(overrides) {
  return {
    id: overrides.id ?? `id-${overrides.slug}-${overrides.harbor ?? 'port-daddy'}`,
    slug: overrides.slug,
    summary_md: overrides.summary_md ?? 'summary',
    status: overrides.status ?? 'now',
    promoted_from_feedback_id: null,
    promoted_by_agent_id: null,
    promoted_at: null,
    last_touched_at: overrides.last_touched_at ?? NOW,
    dependencies_json: overrides.dependencies_json ?? '[]',
    notes_json: overrides.notes_json ?? '[]',
    harbor: overrides.harbor ?? 'port-daddy',
    created_at: overrides.created_at ?? NOW - 1000,
    kind: 'task',
    priority: 3,
    assignee_id: null,
    description_md: null,
    started_at: null,
    due_at: null,
    estimate: null,
    deleted_at: null,
    ...overrides,
  };
}

describe('groupBySlug', () => {
  it('groups rows by slug regardless of harbor', () => {
    const groups = groupBySlug([
      row({ slug: 'a', harbor: 'port-daddy' }),
      row({ slug: 'a', harbor: 'fleet' }),
      row({ slug: 'b', harbor: 'port-daddy' }),
    ]);
    expect(groups.get('a')).toHaveLength(2);
    expect(groups.get('b')).toHaveLength(1);
  });
});

describe('checkContradiction', () => {
  it('flags done coexisting with now as contradictory', () => {
    const result = checkContradiction([
      row({ slug: 's', harbor: 'a', status: 'done' }),
      row({ slug: 's', harbor: 'b', status: 'now' }),
    ]);
    expect(result.contradictory).toBe(true);
    expect(result.reasons[0]).toMatch(/status diverges/);
  });

  it('flags done coexisting with backlog as contradictory', () => {
    const result = checkContradiction([
      row({ slug: 's', harbor: 'a', status: 'done' }),
      row({ slug: 's', harbor: 'b', status: 'backlog' }),
    ]);
    expect(result.contradictory).toBe(true);
  });

  it('does NOT flag done + merge (not in the contradictory pair)', () => {
    const result = checkContradiction([
      row({ slug: 's', harbor: 'a', status: 'done' }),
      row({ slug: 's', harbor: 'b', status: 'merge' }),
    ]);
    expect(result.contradictory).toBe(false);
  });

  it('flags divergent non-null assignee_id', () => {
    const result = checkContradiction([
      row({ slug: 's', harbor: 'a', status: 'now', assignee_id: 'agent-alice' }),
      row({ slug: 's', harbor: 'b', status: 'now', assignee_id: 'agent-bob' }),
    ]);
    expect(result.contradictory).toBe(true);
    expect(result.reasons[0]).toMatch(/assignee_id diverges/);
  });

  it('does not flag when assignee_id is null on one side', () => {
    const result = checkContradiction([
      row({ slug: 's', harbor: 'a', status: 'now', assignee_id: 'agent-alice' }),
      row({ slug: 's', harbor: 'b', status: 'now', assignee_id: null }),
    ]);
    expect(result.contradictory).toBe(false);
  });

  it('clean groups (matching status, no assignee) are never flagged', () => {
    const result = checkContradiction([
      row({ slug: 's', harbor: 'a', status: 'now' }),
      row({ slug: 's', harbor: 'b', status: 'now' }),
    ]);
    expect(result.contradictory).toBe(false);
  });
});

describe('pickCanonicalRow', () => {
  it('prefers an exact match to the resolved repo harbor', () => {
    const rows = [
      row({ slug: 's', harbor: 'port-daddy:fleet', last_touched_at: 200 }),
      row({ slug: 's', harbor: 'port-daddy', last_touched_at: 100 }),
    ];
    const canonical = pickCanonicalRow(rows, 'port-daddy');
    expect(canonical.harbor).toBe('port-daddy');
  });

  it('falls back to the non-suspicious harbor when nothing matches exactly', () => {
    const rows = [
      row({ slug: 's', harbor: 'session-roadmap-dedup-cleanup-bdf77f43', last_touched_at: 500 }),
      row({ slug: 's', harbor: 'port-daddy:fleet', last_touched_at: 100 }),
    ];
    const canonical = pickCanonicalRow(rows, 'some-other-repo');
    expect(canonical.harbor).toBe('port-daddy:fleet');
  });

  it('falls back to most-recently-touched when every harbor is suspicious', () => {
    const rows = [
      row({ slug: 's', harbor: 'session-abc-11112222', last_touched_at: 100 }),
      row({ slug: 's', harbor: 'agent-xyz-33334444', last_touched_at: 900 }),
    ];
    const canonical = pickCanonicalRow(rows, undefined);
    expect(canonical.harbor).toBe('agent-xyz-33334444');
  });
});

describe('planDedup', () => {
  it('merges a clean cross-harbor duplicate: unions deps, merges notes, backfills from freshest', () => {
    const rows = [
      // The live hand-fixed example this script generalizes: correct harbor
      // vs a wrong-harbor duplicate for the same underlying work.
      row({
        slug: 'fleetbar-secret-management',
        harbor: 'port-daddy',
        summary_md: 'canonical summary',
        status: 'backlog',
        last_touched_at: 100,
        dependencies_json: '["parley"]',
        notes_json: JSON.stringify([{ at: 1, by: 'agent-a', text: 'first note' }]),
      }),
      row({
        slug: 'fleetbar-secret-management',
        harbor: 'port-daddy:fleet',
        summary_md: 'stray duplicate summary',
        status: 'now',
        last_touched_at: 900,
        dependencies_json: '["booty"]',
        notes_json: JSON.stringify([{ at: 2, by: 'agent-b', text: 'second note' }]),
        assignee_id: 'agent-freshest',
        description_md: 'richer description from the fresher row',
        estimate: 3,
        started_at: 500,
        due_at: 600,
      }),
    ];

    const plan = planDedup(rows, { repoHarbor: 'port-daddy' });
    expect(plan.flagged).toHaveLength(0);
    expect(plan.merges).toHaveLength(1);

    const merge = plan.merges[0];
    expect(merge.canonical.harbor).toBe('port-daddy');
    expect(merge.losers.map((l) => l.harbor)).toEqual(['port-daddy:fleet']);
    expect(merge.mergedDependencies.sort()).toEqual(['booty', 'parley']);
    expect(merge.mergedNotes.map((n) => n.text)).toEqual(['first note', 'second note']);
    // Freshest row (last_touched_at: 900) backfills these fields.
    expect(merge.freshest.harbor).toBe('port-daddy:fleet');
    expect(merge.freshest.assignee_id).toBe('agent-freshest');
    expect(merge.freshest.status).toBe('now');
  });

  it('flags a contradictory group and does NOT include it in merges', () => {
    const rows = [
      row({ slug: 'contradictory-item', harbor: 'port-daddy', status: 'done', last_touched_at: 100 }),
      row({ slug: 'contradictory-item', harbor: 'fleet', status: 'now', last_touched_at: 200 }),
    ];
    const plan = planDedup(rows, { repoHarbor: 'port-daddy' });
    expect(plan.merges).toHaveLength(0);
    expect(plan.flagged).toHaveLength(1);
    expect(plan.flagged[0].slug).toBe('contradictory-item');
    expect(plan.flagged[0].reasons.length).toBeGreaterThan(0);
  });

  it('counts singleton slugs and leaves them out of both merges and flagged', () => {
    const rows = [row({ slug: 'lonely-item', harbor: 'port-daddy' })];
    const plan = planDedup(rows, { repoHarbor: 'port-daddy' });
    expect(plan.merges).toHaveLength(0);
    expect(plan.flagged).toHaveLength(0);
    expect(plan.singletons).toBe(1);
  });

  it('is read-only over the input rows — planning never mutates or writes', () => {
    const rows = [
      row({ slug: 's', harbor: 'port-daddy', last_touched_at: 100 }),
      row({ slug: 's', harbor: 'fleet', last_touched_at: 200 }),
    ];
    const snapshot = JSON.stringify(rows);
    planDedup(rows, { repoHarbor: 'port-daddy' });
    expect(JSON.stringify(rows)).toBe(snapshot);
  });
});

describe('applyDedupPlan (--apply path)', () => {
  let db;
  let tuples;
  let roadmapItems;

  beforeEach(() => {
    db = initDatabase({ inMemory: true });
    tuples = createTupleSpace(db);
    roadmapItems = createRoadmapItems({ db, tuples, now: () => NOW });
  });

  afterEach(() => {
    db.close();
  });

  function seed(rows) {
    const insert = db.prepare(`
      INSERT INTO roadmap_items (
        id, slug, summary_md, status, promoted_from_feedback_id, promoted_by_agent_id,
        promoted_at, last_touched_at, dependencies_json, notes_json, harbor, created_at,
        kind, priority, assignee_id, description_md, started_at, due_at, estimate, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of rows) {
      insert.run(
        r.id, r.slug, r.summary_md, r.status, r.promoted_from_feedback_id, r.promoted_by_agent_id,
        r.promoted_at, r.last_touched_at, r.dependencies_json, r.notes_json, r.harbor, r.created_at,
        r.kind, r.priority, r.assignee_id, r.description_md, r.started_at, r.due_at, r.estimate,
        r.deleted_at,
      );
    }
  }

  test('merges the canonical row, backfills freshest fields, and tombstones the loser', () => {
    const canonicalRow = row({
      slug: 'fleetbar-secret-management',
      harbor: 'port-daddy',
      summary_md: 'canonical summary',
      status: 'backlog',
      last_touched_at: 100,
      dependencies_json: '["parley"]',
      notes_json: JSON.stringify([{ at: 1, by: 'agent-a', text: 'first note' }]),
    });
    const loserRow = row({
      slug: 'fleetbar-secret-management',
      harbor: 'port-daddy:fleet',
      summary_md: 'stray duplicate summary',
      status: 'now',
      last_touched_at: 900,
      dependencies_json: '["booty"]',
      notes_json: JSON.stringify([{ at: 2, by: 'agent-b', text: 'second note' }]),
      assignee_id: 'agent-freshest',
      description_md: 'richer description',
      estimate: 3,
      started_at: 500,
      due_at: 600,
    });
    seed([canonicalRow, loserRow]);

    const plan = planDedup([canonicalRow, loserRow], { repoHarbor: 'port-daddy' });
    const result = applyDedupPlan(db, plan, { roadmapItems });

    expect(result.groupsMerged).toBe(1);
    expect(result.rowsTombstoned).toBe(1);

    const canonical = roadmapItems.get('fleetbar-secret-management', 'port-daddy');
    expect(canonical).not.toBeNull();
    // summaryMd stays the CANONICAL row's own — never overwritten by a loser.
    expect(canonical.summaryMd).toBe('canonical summary');
    // status/assignee/etc backfilled from the freshest row (the loser here).
    expect(canonical.status).toBe('now');
    expect(canonical.dependencies.sort()).toEqual(['booty', 'parley']);
    expect(canonical.notes.map((n) => n.text)).toEqual(['first note', 'second note']);

    const raw = db.prepare('SELECT assignee_id, description_md, estimate, started_at, due_at FROM roadmap_items WHERE id = ?').get(canonical.id);
    expect(raw.assignee_id).toBe('agent-freshest');
    expect(raw.description_md).toBe('richer description');
    expect(raw.estimate).toBe(3);
    expect(raw.started_at).toBe(500);
    expect(raw.due_at).toBe(600);

    // Loser is a SOFT delete — tombstoned, not gone.
    expect(roadmapItems.get('fleetbar-secret-management', 'port-daddy:fleet')).toBeNull();
    const loserRaw = db.prepare('SELECT deleted_at FROM roadmap_items WHERE id = ?').get(loserRow.id);
    expect(loserRaw.deleted_at).not.toBeNull();
  });

  test('leaves a flagged (contradictory) group completely untouched', () => {
    const doneRow = row({ slug: 'contradictory-item', harbor: 'port-daddy', status: 'done', last_touched_at: 100 });
    const nowRow = row({ slug: 'contradictory-item', harbor: 'fleet', status: 'now', last_touched_at: 200 });
    seed([doneRow, nowRow]);

    const plan = planDedup([doneRow, nowRow], { repoHarbor: 'port-daddy' });
    expect(plan.flagged).toHaveLength(1);
    const result = applyDedupPlan(db, plan, { roadmapItems });

    // Nothing to merge — the flagged group never reaches applyDedupPlan's writes.
    expect(result.groupsMerged).toBe(0);
    expect(result.rowsTombstoned).toBe(0);

    // Both rows survive, live, unchanged.
    const a = roadmapItems.get('contradictory-item', 'port-daddy');
    const b = roadmapItems.get('contradictory-item', 'fleet');
    expect(a?.status).toBe('done');
    expect(b?.status).toBe('now');
  });

  test('dry-run planning alone performs zero writes', () => {
    const rowA = row({ slug: 's', harbor: 'port-daddy', last_touched_at: 100 });
    const rowB = row({ slug: 's', harbor: 'fleet', last_touched_at: 200 });
    seed([rowA, rowB]);

    const before = db.prepare('SELECT COUNT(*) AS n FROM roadmap_items').get().n;
    planDedup([rowA, rowB], { repoHarbor: 'port-daddy' }); // planning only — never touches `db`
    const after = db.prepare('SELECT COUNT(*) AS n FROM roadmap_items').get().n;

    expect(after).toBe(before);
    // Both rows are still live and identical to how they were seeded.
    expect(roadmapItems.get('s', 'port-daddy')).not.toBeNull();
    expect(roadmapItems.get('s', 'fleet')).not.toBeNull();
  });
});
