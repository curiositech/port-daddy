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
  roadmap = createRoadmapItems({ tuples, db, now: () => clock });
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

  test('content split (ADR-0036): title/whyMd/nextCutMd/descriptionMd', () => {
    const item = roadmap.upsert({
      slug: 'split-content',
      title: 'Fleetbar Secret Management',
      whyMd: 'Operators leak credentials in .env.local today.',
      nextCutMd: 'Add Keychain panel + provider deeplinks.',
      descriptionMd: 'Long-form context here.',
    });
    expect(item.title).toBe('Fleetbar Secret Management');
    expect(item.whyMd).toBe('Operators leak credentials in .env.local today.');
    expect(item.nextCutMd).toBe('Add Keychain panel + provider deeplinks.');
    expect(item.descriptionMd).toBe('Long-form context here.');
    expect(item.summaryMd).toContain('Fleetbar Secret Management');
    expect(item.summaryMd).toContain('Operators leak credentials');
    expect(item.summaryMd).toContain('Add Keychain panel');
    expect(item.summaryMd).toContain('Long-form context here.');
  });

  test('legacy summaryMd roundtrips (descriptionMd back-fill)', () => {
    const item = roadmap.upsert({ slug: 'legacy', summaryMd: 'just a blob' });
    expect(item.title).toBeNull();
    expect(item.descriptionMd).toBe('just a blob');
    expect(item.summaryMd).toBe('just a blob');
  });

  test('hierarchy fields (parentId, ordering) round-trip', () => {
    const parent = roadmap.upsert({ slug: 'phase-3', summaryMd: 'Phase 3 container' });
    const child = roadmap.upsert({
      slug: 'phase-3-claim-prediction',
      summaryMd: 'Predict files for claims.',
      parentId: parent.id,
      ordering: 5,
    });
    expect(child.parentId).toBe(parent.id);
    expect(child.ordering).toBe(5);
  });

  test('team-forward fields (teamId, workspaceId, visibility) round-trip', () => {
    const item = roadmap.upsert({
      slug: 'team-thing',
      summaryMd: 'shared with team',
      teamId: 'team-foo',
      workspaceId: 'ws-bar',
      visibility: 'team',
    });
    expect(item.teamId).toBe('team-foo');
    expect(item.workspaceId).toBe('ws-bar');
    expect(item.visibility).toBe('team');
  });

  test('timeline fields (scheduledAt, startedAt, dueAt, completedAt)', () => {
    const item = roadmap.upsert({
      slug: 'timeline',
      summaryMd: 'gantt-ready',
      scheduledAt: 1_700_000_000_000,
      startedAt: 1_700_000_100_000,
      dueAt: 1_700_000_200_000,
      completedAt: null,
    });
    expect(item.scheduledAt).toBe(1_700_000_000_000);
    expect(item.startedAt).toBe(1_700_000_100_000);
    expect(item.dueAt).toBe(1_700_000_200_000);
    expect(item.completedAt).toBeNull();
  });

  test('accepts arbitrary status strings (ADR-0036: team-defined workflows)', () => {
    // The default set is documented (now/merge/backlog/parked/done/quarantined)
    // but the column accepts any non-empty string so teams can ship their own
    // workflows. CLI tools are the validation layer, not the module.
    const item = roadmap.upsert({ slug: 's', summaryMd: 'x', status: 'in-review' });
    expect(item.status).toBe('in-review');

    const item2 = roadmap.upsert({ slug: 's2', summaryMd: 'x', status: 'quarantined' });
    expect(item2.status).toBe('quarantined');
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

// =============================================================================
// ADR-0036 relational APIs — edges, owners, artifacts, tags, events
// =============================================================================

describe('edges', () => {
  test('addEdge writes a typed edge and listEdges returns it', () => {
    const a = roadmap.upsert({ slug: 'a', summaryMd: 'x' });
    const b = roadmap.upsert({ slug: 'b', summaryMd: 'y' });
    roadmap.addEdge({ fromId: a.id, toId: b.id, kind: 'blocks', by: 'agent-1' });
    const edges = roadmap.listEdges({ fromId: a.id });
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ fromId: a.id, toId: b.id, kind: 'blocks', by: 'agent-1' });
  });

  test('addEdge rejects self-loop', () => {
    const a = roadmap.upsert({ slug: 'a', summaryMd: 'x' });
    expect(() => roadmap.addEdge({ fromId: a.id, toId: a.id, kind: 'blocks' })).toThrow(/loop/);
  });

  test('removeEdge takes it back', () => {
    const a = roadmap.upsert({ slug: 'a', summaryMd: 'x' });
    const b = roadmap.upsert({ slug: 'b', summaryMd: 'y' });
    roadmap.addEdge({ fromId: a.id, toId: b.id, kind: 'depends-on' });
    expect(roadmap.removeEdge({ fromId: a.id, toId: b.id, kind: 'depends-on' })).toBe(true);
    expect(roadmap.listEdges({ fromId: a.id })).toHaveLength(0);
  });

  test('listEdges filters by toId and kind', () => {
    const a = roadmap.upsert({ slug: 'a', summaryMd: 'x' });
    const b = roadmap.upsert({ slug: 'b', summaryMd: 'y' });
    const c = roadmap.upsert({ slug: 'c', summaryMd: 'z' });
    roadmap.addEdge({ fromId: a.id, toId: b.id, kind: 'blocks' });
    roadmap.addEdge({ fromId: c.id, toId: b.id, kind: 'blocks' });
    roadmap.addEdge({ fromId: a.id, toId: c.id, kind: 'related-to' });
    expect(roadmap.listEdges({ toId: b.id })).toHaveLength(2);
    expect(roadmap.listEdges({ kind: 'related-to' })).toHaveLength(1);
  });
});

describe('owners', () => {
  test('addOwner writes a principal+role row', () => {
    const item = roadmap.upsert({ slug: 'o', summaryMd: 'x' });
    roadmap.addOwner({
      itemId: item.id,
      principalId: 'agent-cartographer',
      principalType: 'agent',
      role: 'owner',
    });
    const owners = roadmap.listOwners({ itemId: item.id });
    expect(owners).toHaveLength(1);
    expect(owners[0]).toMatchObject({
      itemId: item.id,
      principalId: 'agent-cartographer',
      principalType: 'agent',
      role: 'owner',
    });
  });

  test('addOwner rejects invalid principalType', () => {
    const item = roadmap.upsert({ slug: 'o', summaryMd: 'x' });
    expect(() =>
      roadmap.addOwner({
        itemId: item.id,
        principalId: 'p',
        principalType: 'bogus',
        role: 'owner',
      }),
    ).toThrow(/principalType/);
  });

  test('removeOwner + listOwners by principalId', () => {
    const a = roadmap.upsert({ slug: 'a', summaryMd: 'x' });
    const b = roadmap.upsert({ slug: 'b', summaryMd: 'y' });
    roadmap.addOwner({ itemId: a.id, principalId: 'alice', principalType: 'user', role: 'owner' });
    roadmap.addOwner({ itemId: b.id, principalId: 'alice', principalType: 'user', role: 'reviewer' });
    expect(roadmap.listOwners({ principalId: 'alice' })).toHaveLength(2);
    roadmap.removeOwner({ itemId: a.id, principalId: 'alice', role: 'owner' });
    expect(roadmap.listOwners({ principalId: 'alice' })).toHaveLength(1);
  });
});

describe('artifacts', () => {
  test('addArtifact writes a typed pointer', () => {
    const item = roadmap.upsert({ slug: 'art', summaryMd: 'x' });
    roadmap.addArtifact({
      itemId: item.id,
      kind: 'pr',
      ref: 'curiositech/port-daddy#106',
      label: 'fleet cron→event',
    });
    const arts = roadmap.listArtifacts({ itemId: item.id });
    expect(arts).toHaveLength(1);
    expect(arts[0]).toMatchObject({
      kind: 'pr',
      ref: 'curiositech/port-daddy#106',
      label: 'fleet cron→event',
    });
  });

  test('listArtifacts filters by kind', () => {
    const item = roadmap.upsert({ slug: 'art', summaryMd: 'x' });
    roadmap.addArtifact({ itemId: item.id, kind: 'pr', ref: '#1' });
    roadmap.addArtifact({ itemId: item.id, kind: 'commit', ref: 'abc123' });
    roadmap.addArtifact({ itemId: item.id, kind: 'commit', ref: 'def456' });
    expect(roadmap.listArtifacts({ itemId: item.id, kind: 'commit' })).toHaveLength(2);
    expect(roadmap.listArtifacts({ itemId: item.id, kind: 'pr' })).toHaveLength(1);
  });

  test('removeArtifact', () => {
    const item = roadmap.upsert({ slug: 'art', summaryMd: 'x' });
    roadmap.addArtifact({ itemId: item.id, kind: 'pr', ref: '#1' });
    expect(roadmap.removeArtifact({ itemId: item.id, kind: 'pr', ref: '#1' })).toBe(true);
    expect(roadmap.listArtifacts({ itemId: item.id })).toHaveLength(0);
  });

  test('accepts arbitrary kind (team-forward extensions like linear-issue)', () => {
    const item = roadmap.upsert({ slug: 'art', summaryMd: 'x' });
    roadmap.addArtifact({ itemId: item.id, kind: 'linear-issue', ref: 'TEAM-123' });
    expect(roadmap.listArtifacts({ itemId: item.id })[0].kind).toBe('linear-issue');
  });
});

describe('tags', () => {
  test('addTag is idempotent', () => {
    const item = roadmap.upsert({ slug: 't', summaryMd: 'x' });
    roadmap.addTag({ itemId: item.id, tag: 'phase-3' });
    roadmap.addTag({ itemId: item.id, tag: 'phase-3' });
    expect(roadmap.listTags(item.id)).toHaveLength(1);
  });

  test('removeTag', () => {
    const item = roadmap.upsert({ slug: 't', summaryMd: 'x' });
    roadmap.addTag({ itemId: item.id, tag: 'phase-3' });
    expect(roadmap.removeTag({ itemId: item.id, tag: 'phase-3' })).toBe(true);
    expect(roadmap.listTags(item.id)).toHaveLength(0);
  });
});

describe('events', () => {
  test('addEvent writes a note', () => {
    const item = roadmap.upsert({ slug: 'e', summaryMd: 'x' });
    roadmap.addEvent({
      itemId: item.id,
      kind: 'note',
      by: 'agent-1',
      payload: { text: 'just a note' },
    });
    const evts = roadmap.events({ itemId: item.id, kind: 'note' });
    expect(evts).toHaveLength(1);
    expect(evts[0].payload).toEqual({ text: 'just a note' });
  });

  test('addEdge/addOwner/addArtifact/addTag mint events automatically', () => {
    const a = roadmap.upsert({ slug: 'a', summaryMd: 'x' });
    const b = roadmap.upsert({ slug: 'b', summaryMd: 'y' });
    roadmap.addEdge({ fromId: a.id, toId: b.id, kind: 'blocks', by: 'agent-1' });
    roadmap.addOwner({ itemId: a.id, principalId: 'alice', principalType: 'user', role: 'owner' });
    roadmap.addArtifact({ itemId: a.id, kind: 'pr', ref: '#1' });
    roadmap.addTag({ itemId: a.id, tag: 'phase-3' });
    const evts = roadmap.events({ itemId: a.id });
    const kinds = evts.map((e) => e.kind).sort();
    expect(kinds).toEqual(['artifact-added', 'edge-added', 'owner-added', 'tag-added']);
  });

  test('events filters by kind and since', () => {
    const item = roadmap.upsert({ slug: 'e', summaryMd: 'x' });
    // events at t=1_700_000_000_000, t+5_000, t+10_000
    roadmap.addEvent({ itemId: item.id, kind: 'note', payload: { text: 'one' } });
    advance(5000);
    roadmap.addEvent({ itemId: item.id, kind: 'note', payload: { text: 'two' } });
    advance(5000);
    roadmap.addEvent({ itemId: item.id, kind: 'milestone', payload: { name: 'first-cut' } });
    expect(roadmap.events({ itemId: item.id, kind: 'note' })).toHaveLength(2);
    // since is inclusive; cutoff at second event timestamp returns both later events
    expect(roadmap.events({ itemId: item.id, since: 1_700_000_005_000 })).toHaveLength(2);
  });
});

describe('relational APIs without db dep', () => {
  test('addEdge throws when db absent', () => {
    const tuplesOnly = createTupleSpace(createTestDb());
    const r = createRoadmapItems({ tuples: tuplesOnly });
    expect(() => r.addEdge({ fromId: 'a', toId: 'b', kind: 'blocks' })).toThrow(/db/);
  });

  test('core APIs (upsert/get/list/updateStatus/touch) work without db', () => {
    const tdb = createTestDb();
    const tuplesOnly = createTupleSpace(tdb);
    const r = createRoadmapItems({ tuples: tuplesOnly });
    const item = r.upsert({ slug: 'no-db', summaryMd: 'works' });
    expect(item.slug).toBe('no-db');
    expect(r.get('no-db')?.summaryMd).toBe('works');
    tdb.close();
  });
});
