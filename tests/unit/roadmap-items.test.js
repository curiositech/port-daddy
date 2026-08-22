import { createTestDb } from '../setup-unit.js';
import { createTupleSpace } from '../../lib/tuples.js';
import { createRoadmapItems } from '../../lib/roadmap-items.js';

let db;
let tuples;
let roadmap;
let clock;

beforeEach(() => {
  db = createTestDb();
  tuples = createTupleSpace(db);
  clock = 1_700_000_000_000;
  roadmap = createRoadmapItems({ db, tuples, now: () => clock });
});

afterEach(() => {
  db.close();
});

function advance(ms) {
  clock += ms;
}

describe('upsert', () => {
  test('writes a roadmap:upserted tuple and returns the item', () => {
    const item = roadmap.upsert({
      slug: 'fleetbar-secret-management',
      summaryMd: 'Add FleetBar credentials panel with Keychain + deeplinks.',
      status: 'now',
      project: 'port-daddy',
      promotedFromFeedbackId: 'fb-7425af2d',
      promotedByAgentId: 'agent-cartographer',
      promotedAt: 1_700_000_000_000,
    });

    expect(item.id).toEqual(expect.any(String));
    expect(item.slug).toBe('fleetbar-secret-management');
    expect(item.status).toBe('now');
    expect(item.harbor).toBe('port-daddy:fleet');
    expect(item.promotedFromFeedbackId).toBe('fb-7425af2d');
    expect(item.lastTouchedAt).toBe(1_700_000_000_000);

    const written = tuples.rd(['roadmap:upserted', '*', '*'], { harbor: 'port-daddy:fleet' });
    expect(written).toHaveLength(1);
  });

  test('rejects missing slug or summaryMd', () => {
    expect(() => roadmap.upsert({ slug: '', summaryMd: 'x' })).toThrow(/slug/);
    expect(() => roadmap.upsert({ slug: 's', summaryMd: '' })).toThrow(/summaryMd/);
    expect(() => roadmap.upsert({ slug: '   ', summaryMd: 'x' })).toThrow(/slug/);
  });

  test('defaults status to backlog when not provided on a new slug', () => {
    const item = roadmap.upsert({
      slug: 'new-thing',
      summaryMd: 'do a thing',
      harbor: 'fleet',
    });
    expect(item.status).toBe('backlog');
  });

  test('rejects invalid status enum', () => {
    expect(() =>
      roadmap.upsert({ slug: 's', summaryMd: 'x', status: 'bogus' }),
    ).not.toThrow(); // upsert is permissive on enum, falls back to backlog
    const item = roadmap.upsert({ slug: 's', summaryMd: 'x', status: 'bogus' });
    expect(item.status).toBe('backlog');
  });

  test('notes are append-only across upserts — re-upsert merges, never wipes', () => {
    roadmap.upsert({
      slug: 'noted',
      summaryMd: 'v1',
      harbor: 'fleet',
      notes: [{ at: 1, by: 'agent-a', text: 'first note' }],
    });
    const after = roadmap.upsert({
      slug: 'noted',
      summaryMd: 'v2',
      harbor: 'fleet',
      notes: [{ at: 2, by: 'agent-b', text: 'second note' }],
    });
    expect(after.notes.map((n) => n.text)).toEqual(['first note', 'second note']);
    // Idempotent retry: replaying the same note does not duplicate it.
    const retried = roadmap.upsert({
      slug: 'noted',
      summaryMd: 'v2',
      harbor: 'fleet',
      notes: [{ at: 2, by: 'agent-b', text: 'second note' }],
    });
    expect(retried.notes).toHaveLength(2);
  });

  test('slugExists is an exact any-harbor check', () => {
    roadmap.upsert({ slug: 'exists-here', summaryMd: 'x', harbor: 'fleet' });
    expect(roadmap.slugExists('exists-here')).toBe(true);
    expect(roadmap.slugExists('exists-her')).toBe(false);
    expect(roadmap.slugExists('nope')).toBe(false);
  });

  test('preserves id and promotion provenance across upserts of the same slug', () => {
    const first = roadmap.upsert({
      slug: 'durable',
      summaryMd: 'v1',
      status: 'now',
      promotedFromFeedbackId: 'fb-1',
      promotedByAgentId: 'agent-1',
      promotedAt: 1_700_000_000_000,
      harbor: 'port-daddy:fleet',
    });
    advance(60_000);
    const second = roadmap.upsert({
      slug: 'durable',
      summaryMd: 'v2 — refined wording',
      harbor: 'port-daddy:fleet',
    });
    expect(second.id).toBe(first.id);
    expect(second.summaryMd).toBe('v2 — refined wording');
    // Promotion provenance carries over when not re-specified.
    expect(second.promotedFromFeedbackId).toBe('fb-1');
    expect(second.promotedByAgentId).toBe('agent-1');
    expect(second.lastTouchedAt).toBeGreaterThan(first.lastTouchedAt);
  });
});

describe('list and get', () => {
  test('list returns items sorted by status rank then most-recently touched', () => {
    roadmap.upsert({ slug: 'a-backlog', summaryMd: 'a', status: 'backlog', harbor: 'fleet' });
    advance(10);
    roadmap.upsert({ slug: 'b-now', summaryMd: 'b', status: 'now', harbor: 'fleet' });
    advance(10);
    roadmap.upsert({ slug: 'c-done', summaryMd: 'c', status: 'done', harbor: 'fleet' });
    advance(10);
    roadmap.upsert({ slug: 'd-now', summaryMd: 'd', status: 'now', harbor: 'fleet' });

    const items = roadmap.list({ harbor: 'fleet' });
    // Two 'now' items first (newer touch first), then backlog, then done.
    expect(items.map((i) => i.slug)).toEqual(['d-now', 'b-now', 'a-backlog', 'c-done']);
  });

  test('list filters by status', () => {
    roadmap.upsert({ slug: 'a', summaryMd: 'a', status: 'now', harbor: 'fleet' });
    roadmap.upsert({ slug: 'b', summaryMd: 'b', status: 'backlog', harbor: 'fleet' });
    expect(roadmap.list({ harbor: 'fleet', status: 'now' }).map((i) => i.slug)).toEqual(['a']);
    expect(roadmap.list({ harbor: 'fleet', status: 'backlog' }).map((i) => i.slug)).toEqual(['b']);
  });

  test('list scopes by harbor', () => {
    roadmap.upsert({ slug: 'one', summaryMd: 'x', harbor: 'port-daddy:fleet' });
    roadmap.upsert({ slug: 'two', summaryMd: 'y', harbor: 'other:fleet' });
    expect(roadmap.list({ harbor: 'port-daddy:fleet' }).map((i) => i.slug)).toEqual(['one']);
    expect(roadmap.list({ harbor: 'other:fleet' }).map((i) => i.slug)).toEqual(['two']);
  });

  test('get returns the current item or null', () => {
    roadmap.upsert({ slug: 'real', summaryMd: 'r', harbor: 'fleet' });
    expect(roadmap.get('real', 'fleet')?.slug).toBe('real');
    expect(roadmap.get('absent', 'fleet')).toBeNull();
  });
});

describe('updateStatus', () => {
  test('layers a roadmap:status tuple over the latest upsert', () => {
    roadmap.upsert({ slug: 's', summaryMd: 'x', status: 'backlog', harbor: 'fleet' });
    advance(60_000);
    const after = roadmap.updateStatus({ slug: 's', status: 'now', by: 'agent-c', harbor: 'fleet' });
    expect(after.status).toBe('now');
    // get() reflects the overlay even though the original upsert tuple is unchanged.
    expect(roadmap.get('s', 'fleet')?.status).toBe('now');
  });

  test('rejects status changes against unknown slugs', () => {
    expect(() => roadmap.updateStatus({ slug: 'nope', status: 'now', by: 'a', harbor: 'fleet' }))
      .toThrow(/no roadmap item/);
  });

  test('keeps an audit trail when status flips multiple times', () => {
    roadmap.upsert({ slug: 'flippy', summaryMd: 'x', status: 'backlog', harbor: 'fleet' });
    advance(10);
    roadmap.updateStatus({ slug: 'flippy', status: 'now', by: 'a', harbor: 'fleet' });
    advance(10);
    roadmap.updateStatus({ slug: 'flippy', status: 'merge', by: 'a', harbor: 'fleet' });
    const statusEvents = tuples.rd(['roadmap:status', 'flippy', '*'], { harbor: 'fleet' });
    expect(statusEvents).toHaveLength(2);
    expect(roadmap.get('flippy', 'fleet')?.status).toBe('merge');
  });
});

describe('touch', () => {
  test('updates lastTouchedAt without changing anything else', () => {
    const initial = roadmap.upsert({ slug: 't', summaryMd: 'x', status: 'backlog', harbor: 'fleet' });
    advance(60_000);
    const touched = roadmap.touch('t', 'fleet');
    expect(touched?.lastTouchedAt).toBeGreaterThan(initial.lastTouchedAt);
    expect(touched?.status).toBe('backlog');
    expect(touched?.summaryMd).toBe('x');
  });

  test('touch on a missing slug returns null', () => {
    expect(roadmap.touch('absent', 'fleet')).toBeNull();
  });
});

describe('durability', () => {
  test('roadmap state survives a wiped tuple space', () => {
    roadmap.upsert({ slug: 'a', summaryMd: 'A', status: 'now', harbor: 'fleet' });
    roadmap.upsert({ slug: 'b', summaryMd: 'B', status: 'backlog', harbor: 'fleet' });
    roadmap.updateStatus({ slug: 'b', status: 'merge', by: 'agent-x', harbor: 'fleet' });

    // Wipe tuples — simulating a tuple GC, schema reset, or attacker
    // truncating the subscription log. The roadmap table is the
    // database-of-record, so reads MUST still work.
    db.prepare('DELETE FROM tuples').run();

    const items = roadmap.list({ harbor: 'fleet' });
    expect(items.map((i) => i.slug).sort()).toEqual(['a', 'b']);
    expect(roadmap.get('b', 'fleet')?.status).toBe('merge');
    expect(roadmap.get('a', 'fleet')?.summaryMd).toBe('A');
  });

  test('audit trail rows land in roadmap_item_status_events', () => {
    roadmap.upsert({ slug: 'audit', summaryMd: 'x', status: 'backlog', harbor: 'fleet' });
    roadmap.updateStatus({ slug: 'audit', status: 'now', by: 'agent-1', harbor: 'fleet' });
    roadmap.updateStatus({ slug: 'audit', status: 'done', by: 'agent-2', harbor: 'fleet' });

    const events = db
      .prepare(`SELECT status, by_agent_id FROM roadmap_item_status_events
                WHERE slug = ? ORDER BY id ASC`)
      .all('audit');
    expect(events).toEqual([
      { status: 'now', by_agent_id: 'agent-1' },
      { status: 'done', by_agent_id: 'agent-2' },
    ]);
  });
});

describe('remove', () => {
  test('deletes the item and reports what was removed', () => {
    roadmap.upsert({ slug: 'dupe', summaryMd: 'a stray', status: 'backlog', harbor: 'fleet' });
    expect(roadmap.get('dupe', 'fleet')).not.toBeNull();

    const result = roadmap.remove('dupe', 'fleet');
    expect(result.removed).toBe(true);
    expect(result.item?.slug).toBe('dupe');
    expect(roadmap.get('dupe', 'fleet')).toBeNull();
  });

  test('PRESERVES the append-only status-event audit rows (tombstone is the deletion record)', () => {
    roadmap.upsert({ slug: 'withaudit', summaryMd: 'x', status: 'backlog', harbor: 'fleet' });
    roadmap.updateStatus({ slug: 'withaudit', status: 'now', by: 'agent-1', harbor: 'fleet' });
    const id = roadmap.get('withaudit', 'fleet').id;
    expect(db.prepare('SELECT count(*) c FROM roadmap_item_status_events WHERE item_id = ?').get(id).c).toBe(1);

    roadmap.remove('withaudit', 'fleet');
    expect(db.prepare('SELECT count(*) c FROM roadmap_item_status_events WHERE item_id = ?').get(id).c).toBe(1);
  });

  test('is a soft delete: the row survives with deleted_at set and last_touched_at bumped past the live row', () => {
    roadmap.upsert({ slug: 'soft', summaryMd: 'x', status: 'now', harbor: 'fleet' });
    const before = db.prepare("SELECT last_touched_at FROM roadmap_items WHERE slug = 'soft'").get();
    advance(500);
    roadmap.remove('soft', 'fleet');

    const raw = db.prepare("SELECT deleted_at, last_touched_at FROM roadmap_items WHERE slug = 'soft'").get();
    expect(raw).toBeDefined();
    expect(raw.deleted_at).toBe(clock);
    expect(raw.last_touched_at).toBeGreaterThan(before.last_touched_at);
    // Dead to every read surface:
    expect(roadmap.get('soft', 'fleet')).toBeNull();
    expect(roadmap.slugExists('soft')).toBe(false);
    expect(roadmap.list({ harbor: 'fleet', status: 'all' }).map((i) => i.slug)).not.toContain('soft');
    expect(roadmap.touch('soft', 'fleet')).toBeNull();
    expect(() => roadmap.updateStatus({ slug: 'soft', status: 'done', by: 'a', harbor: 'fleet' })).toThrow();
  });

  test('remove on an already-tombstoned item reports removed: false', () => {
    roadmap.upsert({ slug: 'twice', summaryMd: 'x', status: 'now', harbor: 'fleet' });
    expect(roadmap.remove('twice', 'fleet').removed).toBe(true);
    expect(roadmap.remove('twice', 'fleet')).toEqual({ removed: false, item: null });
  });

  test('upsert resurrects a tombstoned item (clears deleted_at)', () => {
    roadmap.upsert({ slug: 'phoenix', summaryMd: 'v1', status: 'now', harbor: 'fleet' });
    roadmap.remove('phoenix', 'fleet');
    expect(roadmap.get('phoenix', 'fleet')).toBeNull();

    advance(1000);
    const revived = roadmap.upsert({ slug: 'phoenix', summaryMd: 'v2', status: 'backlog', harbor: 'fleet' });
    expect(revived.deletedAt ?? null).toBeNull();
    expect(roadmap.get('phoenix', 'fleet')?.summaryMd).toBe('v2');
    expect(roadmap.slugExists('phoenix')).toBe(true);
  });

  test('emits a roadmap:removed tuple', () => {
    roadmap.upsert({ slug: 'gone', summaryMd: 'x', status: 'now', harbor: 'fleet' });
    roadmap.remove('gone', 'fleet');
    const removed = tuples.rd(['roadmap:removed', 'gone', '*'], { harbor: 'fleet' });
    expect(removed).not.toBeNull();
  });

  test('is a no-op for an unknown slug', () => {
    const result = roadmap.remove('never-existed', 'fleet');
    expect(result).toEqual({ removed: false, item: null });
  });

  test('is harbor-scoped — removing from one harbor leaves the other intact (pre-existing legacy duplicate)', () => {
    // Simulate a legacy duplicate that predates the cross-harbor upsert guard
    // below (scripts/roadmap-dedup.ts cleans these up in bulk) by inserting
    // directly — going through roadmap.upsert() for both rows would now LINK
    // the second write onto the first row instead of creating a second one.
    const insert = db.prepare(`
      INSERT INTO roadmap_items (id, slug, summary_md, status, last_touched_at, dependencies_json, notes_json, harbor, created_at)
      VALUES (?, ?, ?, ?, ?, '[]', '[]', ?, ?)
    `);
    insert.run('id-real', 'shared', 'real', 'now', clock, 'port-daddy', clock);
    insert.run('id-dupe', 'shared', 'stray dupe', 'backlog', clock, 'fleet', clock);

    const result = roadmap.remove('shared', 'fleet');
    expect(result.removed).toBe(true);
    expect(roadmap.get('shared', 'fleet')).toBeNull();
    expect(roadmap.get('shared', 'port-daddy')?.summaryMd).toBe('real');
  });
});

describe('upsert cross-harbor collision guard', () => {
  test('links a slug that already exists under a DIFFERENT harbor instead of duplicating it', () => {
    roadmap.upsert({ slug: 'linked-shared', summaryMd: 'real', status: 'now', harbor: 'port-daddy' });
    const second = roadmap.upsert({
      slug: 'linked-shared',
      summaryMd: 'attempted duplicate write',
      status: 'backlog',
      harbor: 'fleet',
    });

    // The write landed on the EXISTING 'port-daddy' row — no new row was
    // created under 'fleet'. This is the fix for the Planner pane's
    // duplicate-slug / harbor-split bug: every upsert() caller now gets the
    // same link-instead-of-insert behavior `pd begin --roadmap-new` already
    // had via slugExists() (lib/sugar.ts).
    expect(second.harbor).toBe('port-daddy');
    expect(roadmap.get('linked-shared', 'fleet')).toBeNull();
    expect(roadmap.get('linked-shared', 'port-daddy')?.summaryMd).toBe('attempted duplicate write');
    const rowCount = db.prepare('SELECT COUNT(*) AS c FROM roadmap_items WHERE slug = ?').get('linked-shared').c;
    expect(rowCount).toBe(1);
  });

  test('emits a roadmap:cross-harbor-linked tuple when redirecting', () => {
    roadmap.upsert({ slug: 'warn-me', summaryMd: 'v1', harbor: 'port-daddy' });
    roadmap.upsert({ slug: 'warn-me', summaryMd: 'v2', harbor: 'fleet' });

    const linked = tuples.rd(['roadmap:cross-harbor-linked', 'warn-me', '*'], { harbor: 'port-daddy' });
    expect(linked).toHaveLength(1);
    expect(linked[0].fields[2]).toMatchObject({ requestedHarbor: 'fleet', canonicalHarbor: 'port-daddy' });
  });

  test('same-harbor upsert is unaffected — plain in-place update, no cross-harbor link', () => {
    roadmap.upsert({ slug: 'same-harbor', summaryMd: 'v1', harbor: 'fleet' });
    const second = roadmap.upsert({ slug: 'same-harbor', summaryMd: 'v2', harbor: 'fleet' });
    expect(second.harbor).toBe('fleet');
    const linked = tuples.rd(['roadmap:cross-harbor-linked', 'same-harbor', '*'], { harbor: 'fleet' });
    expect(linked).toHaveLength(0);
  });

  test('a genuinely new slug still inserts normally (no false-positive link)', () => {
    roadmap.upsert({ slug: 'existing-one', summaryMd: 'v1', harbor: 'port-daddy' });
    const fresh = roadmap.upsert({ slug: 'brand-new-slug', summaryMd: 'v1', harbor: 'fleet' });
    expect(fresh.harbor).toBe('fleet');
    expect(roadmap.get('brand-new-slug', 'fleet')).not.toBeNull();
  });
});
