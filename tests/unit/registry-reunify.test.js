/**
 * Port Daddy - scripts/registry-reunify.ts Unit Tests
 *
 * Merge semantics for reunifying scattered registry shards + the committed
 * roadmap snapshot into one durable registry (ADR-0090; operator ruling
 * 2026-07-14 "daemons cannot own different truths").
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { planReunification, applyReunification } from '../../scripts/registry-reunify.js';
import { initDatabase } from '../../lib/db.js';

const NOW = 1_784_000_000_000;

function row(overrides) {
  return {
    id: overrides.id ?? `id-${overrides.slug}-${overrides.harbor ?? 'port-daddy'}`,
    slug: overrides.slug,
    summary_md: overrides.summary_md ?? 'summary',
    status: overrides.status ?? 'backlog',
    promoted_from_feedback_id: null,
    promoted_by_agent_id: null,
    promoted_at: null,
    last_touched_at: overrides.last_touched_at ?? NOW,
    dependencies_json: '[]',
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
    ...overrides,
  };
}

describe('planReunification', () => {
  it('newest last_touched_at wins whole-row across shards', () => {
    const plan = planReunification(
      [
        { label: 'shard-a', rows: [row({ slug: 's', summary_md: 'old', last_touched_at: 100 })], events: [] },
        { label: 'shard-b', rows: [row({ slug: 's', summary_md: 'new', last_touched_at: 200 })], events: [] },
      ],
      [],
      'port-daddy',
    );
    expect(plan.winners).toHaveLength(1);
    expect(plan.winners[0].summary_md).toBe('new');
    expect(plan.winners[0].__source).toBe('shard-b');
    expect(plan.superseded).toEqual([
      { slug: 's', harbor: 'port-daddy', loser: 'shard-a', winner: 'shard-b' },
    ]);
  });

  it('same slug under different harbors stays two rows', () => {
    const plan = planReunification(
      [
        {
          label: 'shard-a',
          rows: [row({ slug: 's', harbor: 'port-daddy' }), row({ slug: 's', harbor: 'parley-sugar' })],
          events: [],
        },
      ],
      [],
      'port-daddy',
    );
    expect(plan.winners).toHaveLength(2);
  });

  it('snapshot is a floor: fills missing pairs, never overrides live rows', () => {
    const plan = planReunification(
      [{ label: 'shard-a', rows: [row({ slug: 'live', status: 'done' })], events: [] }],
      [
        { slug: 'live', status: 'backlog', summaryMd: 'stale export of live' },
        { slug: 'snapshot-only', status: 'now', summaryMd: 'only the snapshot knows' },
      ],
      'port-daddy',
    );
    expect(plan.winners.find((w) => w.slug === 'live').status).toBe('done');
    expect(plan.snapshotOnly).toEqual([
      { slug: 'snapshot-only', harbor: 'port-daddy', status: 'now', summaryMd: 'only the snapshot knows' },
    ]);
  });

  it('dedupes duplicate snapshot slugs (last occurrence wins) and drops invalid statuses', () => {
    const plan = planReunification(
      [],
      [
        { slug: 'dupe', status: 'backlog', summaryMd: 'first' },
        { slug: 'dupe', status: 'now', summaryMd: 'second (fresher union-append)' },
        { slug: 'bad', status: 'not-a-status', summaryMd: 'invalid' },
      ],
      'port-daddy',
    );
    expect(plan.snapshotOnly).toHaveLength(1);
    expect(plan.snapshotOnly[0].summaryMd).toBe('second (fresher union-append)');
  });

  it('unions events across shards deduped on (slug, harbor, status, at)', () => {
    const ev = { item_id: 'x', slug: 's', status: 'now', by_agent_id: null, at: 5, harbor: 'port-daddy' };
    const plan = planReunification(
      [
        { label: 'a', rows: [row({ slug: 's' })], events: [ev] },
        { label: 'b', rows: [], events: [ev, { ...ev, at: 6 }] },
      ],
      [],
      'port-daddy',
    );
    expect(plan.events).toHaveLength(2);
  });
});

describe('applyReunification', () => {
  let db;
  let nextId;
  const makeId = () => `uuid-${nextId++}`;

  beforeEach(() => {
    db = initDatabase({ inMemory: true });
    nextId = 0;
  });

  function apply(plan) {
    return applyReunification(db, plan, NOW, makeId);
  }

  it('inserts winners and snapshot fills, appends provenance to notes_json', () => {
    const plan = planReunification(
      [{ label: 'shard-a', rows: [row({ slug: 'live', notes_json: '[{"note":"orig"}]' })], events: [] }],
      [{ slug: 'snap', status: 'backlog', summaryMd: 'from snapshot' }],
      'port-daddy',
    );
    const result = apply(plan);
    expect(result.inserted).toBe(2);

    const live = db.prepare("SELECT notes_json FROM roadmap_items WHERE slug = 'live'").get();
    const notes = JSON.parse(live.notes_json);
    expect(notes[0].note).toBe('orig');
    expect(notes[1].by).toBe('registry-reunify');
    expect(notes[1].note).toContain('shard-a');

    const snap = db.prepare("SELECT id, status FROM roadmap_items WHERE slug = 'snap'").get();
    expect(snap.id).toBe('uuid-0');
    expect(snap.status).toBe('backlog');
  });

  it('updates only when the incoming row is fresher than the destination row', () => {
    const older = planReunification(
      [{ label: 'a', rows: [row({ slug: 's', summary_md: 'v1', last_touched_at: 100 })], events: [] }],
      [], 'port-daddy',
    );
    apply(older);

    const stale = planReunification(
      [{ label: 'b', rows: [row({ slug: 's', summary_md: 'v0', last_touched_at: 50 })], events: [] }],
      [], 'port-daddy',
    );
    expect(apply(stale)).toMatchObject({ inserted: 0, updated: 0, unchanged: 1 });
    expect(db.prepare("SELECT summary_md FROM roadmap_items WHERE slug = 's'").get().summary_md).toBe('v1');

    const fresher = planReunification(
      [{ label: 'c', rows: [row({ slug: 's', summary_md: 'v2', last_touched_at: 200 })], events: [] }],
      [], 'port-daddy',
    );
    expect(apply(fresher)).toMatchObject({ inserted: 0, updated: 1 });
    expect(db.prepare("SELECT summary_md FROM roadmap_items WHERE slug = 's'").get().summary_md).toBe('v2');
  });

  it('is idempotent: re-running the same plan changes nothing', () => {
    const plan = planReunification(
      [{ label: 'a', rows: [row({ slug: 's' })], events: [
        { item_id: 'orig', slug: 's', status: 'backlog', by_agent_id: null, at: 7, harbor: 'port-daddy' },
      ] }],
      [{ slug: 'snap', status: 'now', summaryMd: 'x' }],
      'port-daddy',
    );
    const first = apply(plan);
    expect(first).toMatchObject({ inserted: 2, eventsInserted: 1 });
    const second = apply(plan);
    expect(second).toMatchObject({ inserted: 0, updated: 0, unchanged: 2, eventsInserted: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM roadmap_items').get().n).toBe(2);
  });

  it('ACCEPTANCE: a tombstone in replica A survives reunifying a stale live row from replica B', () => {
    // Replica A deleted the item at t=200 (tombstone, newest write).
    const planA = planReunification(
      [{ label: 'replica-a', rows: [row({ slug: 's', deleted_at: 200, last_touched_at: 200 })], events: [] }],
      [], 'port-daddy',
    );
    apply(planA);
    // Replica B still carries the live row from t=100.
    const planB = planReunification(
      [{ label: 'replica-b', rows: [row({ slug: 's', deleted_at: null, last_touched_at: 100 })], events: [] }],
      [], 'port-daddy',
    );
    apply(planB);

    const merged = db.prepare("SELECT deleted_at FROM roadmap_items WHERE slug = 's'").get();
    expect(merged.deleted_at).toBe(200); // deletion propagated; no zombie resurrection
  });

  it('a fresher live upsert beats an older tombstone (resurrection propagates too)', () => {
    const dead = planReunification(
      [{ label: 'a', rows: [row({ slug: 's', deleted_at: 100, last_touched_at: 100 })], events: [] }],
      [], 'port-daddy',
    );
    apply(dead);
    const revived = planReunification(
      [{ label: 'b', rows: [row({ slug: 's', deleted_at: null, last_touched_at: 300, summary_md: 'back' })], events: [] }],
      [], 'port-daddy',
    );
    apply(revived);

    const merged = db.prepare("SELECT deleted_at, summary_md FROM roadmap_items WHERE slug = 's'").get();
    expect(merged.deleted_at).toBeNull();
    expect(merged.summary_md).toBe('back');
  });

  it('tombstone-vs-tombstone: both replicas deleted the row — newer deleted_at wins, no flapping', () => {
    const first = planReunification(
      [{ label: 'a', rows: [row({ slug: 's', deleted_at: 100, last_touched_at: 100 })], events: [] }],
      [], 'port-daddy',
    );
    apply(first);
    const second = planReunification(
      [{ label: 'b', rows: [row({ slug: 's', deleted_at: 250, last_touched_at: 250 })], events: [] }],
      [], 'port-daddy',
    );
    apply(second);

    const merged = db.prepare("SELECT deleted_at, last_touched_at FROM roadmap_items WHERE slug = 's'").get();
    expect(merged.deleted_at).toBe(250);
    expect(merged.last_touched_at).toBe(250);
    // Exactly one row, still dead — concurrent deletes converge.
    expect(db.prepare('SELECT COUNT(*) AS n FROM roadmap_items').get().n).toBe(1);
  });

  it('the snapshot floor never resurrects a tombstoned pair', () => {
    const plan = planReunification(
      [{ label: 'a', rows: [row({ slug: 's', deleted_at: 100, last_touched_at: 100 })], events: [] }],
      [{ slug: 's', status: 'backlog', summaryMd: 'stale snapshot export' }],
      'port-daddy',
    );
    // The tombstoned row is a live shard row for merge purposes, so the
    // snapshot never sees the pair as missing.
    expect(plan.snapshotOnly).toHaveLength(0);
    apply(plan);
    expect(db.prepare("SELECT deleted_at FROM roadmap_items WHERE slug = 's'").get().deleted_at).toBe(100);
  });

  it('remaps event item_id to the winning row id', () => {
    const plan = planReunification(
      [{
        label: 'a',
        rows: [row({ slug: 's', id: 'winner-id' })],
        events: [{ item_id: 'shard-local-id', slug: 's', status: 'backlog', by_agent_id: 'agent', at: 9, harbor: 'port-daddy' }],
      }],
      [], 'port-daddy',
    );
    apply(plan);
    const ev = db.prepare("SELECT item_id FROM roadmap_item_status_events WHERE slug = 's'").get();
    expect(ev.item_id).toBe('winner-id');
  });
});
