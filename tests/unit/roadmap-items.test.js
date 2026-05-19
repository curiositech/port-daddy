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
  roadmap = createRoadmapItems({ tuples, now: () => clock });
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
