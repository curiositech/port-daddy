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

  test('is harbor-scoped — removing from one harbor leaves the other intact', () => {
    roadmap.upsert({ slug: 'shared', summaryMd: 'real', status: 'now', harbor: 'port-daddy' });
    roadmap.upsert({ slug: 'shared', summaryMd: 'stray dupe', status: 'backlog', harbor: 'fleet' });

    const result = roadmap.remove('shared', 'fleet');
    expect(result.removed).toBe(true);
    expect(roadmap.get('shared', 'fleet')).toBeNull();
    expect(roadmap.get('shared', 'port-daddy')?.summaryMd).toBe('real');
  });
});

describe('planner columns (ADR-0086)', () => {
  test('round-trips kind, priority, assignee, description, dates, and estimate', () => {
    const dueAt = 1_700_900_000_000;
    const startedAt = 1_700_100_000_000;
    const item = roadmap.upsert({
      slug: 'relay-hardening',
      summaryMd: 'Harden relay reconnect storms.',
      status: 'now',
      harbor: 'fleet',
      kind: 'epic',
      priority: 2,
      assigneeId: 'agent-navigator',
      descriptionMd: 'Full body markdown.\n\nWith paragraphs.',
      startedAt,
      dueAt,
      estimate: 5,
    });
    expect(item.kind).toBe('epic');
    expect(item.priority).toBe(2);
    expect(item.assigneeId).toBe('agent-navigator');
    expect(item.descriptionMd).toContain('With paragraphs');
    expect(item.startedAt).toBe(startedAt);
    expect(item.dueAt).toBe(dueAt);
    expect(item.estimate).toBe(5);

    const fetched = roadmap.get('relay-hardening', 'fleet');
    expect(fetched.kind).toBe('epic');
    expect(fetched.estimate).toBe(5);
    expect(fetched.dueAt).toBe(dueAt);
  });

  test('defaults kind=task and priority=3 when omitted', () => {
    const item = roadmap.upsert({ slug: 'plain', summaryMd: 'no planner fields', harbor: 'fleet' });
    expect(item.kind).toBe('task');
    expect(item.priority).toBe(3);
    expect(item.estimate).toBeNull();
    expect(item.assigneeId).toBeNull();
  });

  test('an upsert that omits planner fields preserves the stored values', () => {
    roadmap.upsert({
      slug: 'sized',
      summaryMd: 'sized item',
      harbor: 'fleet',
      kind: 'story',
      priority: 1,
      estimate: 8,
      assigneeId: 'agent-x',
    });
    // A partial writer (e.g. promote/import re-touching the row) sends only
    // slug+summary; sizing recorded by another surface must survive.
    const after = roadmap.upsert({ slug: 'sized', summaryMd: 'sized item (retitled)', harbor: 'fleet' });
    expect(after.kind).toBe('story');
    expect(after.priority).toBe(1);
    expect(after.estimate).toBe(8);
    expect(after.assigneeId).toBe('agent-x');
  });

  test('clamps out-of-band priority and rejects garbage estimates as null', () => {
    const item = roadmap.upsert({
      slug: 'weird',
      summaryMd: 'weird numbers',
      harbor: 'fleet',
      priority: 99,
      estimate: -4,
    });
    expect(item.priority).toBe(5); // saturates to the lowest legal rung
    expect(item.estimate).toBeNull(); // negative effort is absence, not poison
  });

  test('explicit null clears assignee and estimate on an existing row', () => {
    roadmap.upsert({
      slug: 'clearable',
      summaryMd: 'assigned',
      harbor: 'fleet',
      assigneeId: 'agent-y',
      estimate: 3,
    });
    const cleared = roadmap.upsert({
      slug: 'clearable',
      summaryMd: 'assigned',
      harbor: 'fleet',
      assigneeId: null,
      estimate: null,
    });
    expect(cleared.assigneeId).toBeNull();
    expect(cleared.estimate).toBeNull();
  });
});
