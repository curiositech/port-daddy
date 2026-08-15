import { createTestDb } from '../setup-unit.js';
import { createTupleSpace } from '../../lib/tuples.js';
import { createFeedback } from '../../lib/feedback.js';

let db;
let tuples;
let feedback;
let clock;

beforeEach(() => {
  db = createTestDb();
  tuples = createTupleSpace(db);
  clock = 1_700_000_000_000;
  feedback = createFeedback({ tuples, now: () => clock });
});

afterEach(() => {
  db.close();
});

function advance(ms) {
  clock += ms;
}

describe('drop', () => {
  test('writes a feedback tuple and returns the entry', () => {
    const entry = feedback.drop({
      slug: 'pd-say-flag-mismatch',
      summary: 'pd say --as flag, server says --session/--agent',
      surface: 'CLI',
      severity: 'high',
      source: 'agent',
      droppedBy: 'agent-deadbeef',
      project: 'port-daddy',
      harbor: 'port-daddy:fleet',
    });

    expect(entry.feedbackId).toEqual(expect.any(String));
    expect(entry.slug).toBe('pd-say-flag-mismatch');
    expect(entry.severity).toBe('high');
    expect(entry.status).toBe('open');
    expect(entry.harbor).toBe('port-daddy:fleet');

    const written = tuples.rd(['feedback:dropped', '*', '*'], { harbor: 'port-daddy:fleet' });
    expect(written).toHaveLength(1);
  });

  test('rejects missing slug, summary, or droppedBy', () => {
    expect(() => feedback.drop({ slug: '', summary: 's', droppedBy: 'a' })).toThrow(/slug/);
    expect(() => feedback.drop({ slug: 's', summary: '', droppedBy: 'a' })).toThrow(/summary/);
    expect(() => feedback.drop({ slug: 's', summary: 's', droppedBy: '' })).toThrow(/droppedBy/);
  });

  test('defaults severity=medium and source=unknown', () => {
    const entry = feedback.drop({ slug: 's', summary: 'x', droppedBy: 'a' });
    expect(entry.severity).toBe('medium');
    expect(entry.source).toBe('unknown');
  });

  test('defaults harbor to the project fleet harbor when project is supplied', () => {
    const entry = feedback.drop({
      slug: 'workgroup-cartographer-note',
      summary: 'keep this out of Port Daddy feedback',
      droppedBy: 'workgroup-ai:fleet:cartographer',
      project: 'workgroup-ai',
    });

    expect(entry.harbor).toBe('workgroup-ai:fleet');
    expect(feedback.list({ harbor: 'workgroup-ai:fleet' }).map((e) => e.slug)).toEqual(['workgroup-cartographer-note']);
    expect(feedback.list({ harbor: 'port-daddy:fleet' })).toEqual([]);
  });

  test('coerces unknown enum values back to defaults', () => {
    const entry = feedback.drop({
      slug: 's',
      summary: 'x',
      droppedBy: 'a',
      severity: 'spicy',
      source: 'alien',
    });
    expect(entry.severity).toBe('medium');
    expect(entry.source).toBe('unknown');
  });
});

describe('fleetbot-review flagging', () => {
  test('carries fleetbotRunId through drop, get, and list', () => {
    const entry = feedback.drop({
      slug: 'wrong-qa-verdict-pr-6790',
      summary: 'qa-bot BLOCKed a fix that had no bug — see thread',
      droppedBy: 'agent-reviewer',
      surface: 'Fleetbot',
      severity: 'high',
      fleetbotRunId: 'run:delivery-abc123',
    });

    expect(entry.fleetbotRunId).toBe('run:delivery-abc123');

    const fetched = feedback.get(entry.feedbackId);
    expect(fetched.fleetbotRunId).toBe('run:delivery-abc123');

    const listed = feedback.list({ surface: 'Fleetbot' });
    expect(listed.map((e) => e.fleetbotRunId)).toEqual(['run:delivery-abc123']);
  });

  test('fleetbotRunId defaults to null when not a flag drop', () => {
    const entry = feedback.drop({ slug: 's', summary: 'x', droppedBy: 'a' });
    expect(entry.fleetbotRunId).toBeNull();
  });

  test('blank fleetbotRunId normalizes to null, not an empty string', () => {
    const entry = feedback.drop({
      slug: 's', summary: 'x', droppedBy: 'a', fleetbotRunId: '   ',
    });
    expect(entry.fleetbotRunId).toBeNull();
  });
});

describe('list', () => {
  beforeEach(() => {
    feedback.drop({ slug: 'a', summary: 'low one', droppedBy: 'agent-1', severity: 'low' });
    advance(1000);
    feedback.drop({ slug: 'b', summary: 'critical one', droppedBy: 'agent-1', severity: 'critical', surface: 'CLI' });
    advance(1000);
    feedback.drop({ slug: 'c', summary: 'high one', droppedBy: 'agent-2', severity: 'high' });
  });

  test('sorts by severity then recency', () => {
    const entries = feedback.list();
    expect(entries.map((e) => e.slug)).toEqual(['b', 'c', 'a']);
  });

  test('filters by severity', () => {
    const high = feedback.list({ severity: 'high' });
    expect(high.map((e) => e.slug)).toEqual(['c']);
  });

  test('filters by surface', () => {
    const cli = feedback.list({ surface: 'CLI' });
    expect(cli.map((e) => e.slug)).toEqual(['b']);
  });

  test('limit clamps result count', () => {
    const top = feedback.list({ limit: 2 });
    expect(top.map((e) => e.slug)).toEqual(['b', 'c']);
  });
});

describe('harvest', () => {
  test('marks a feedback entry as harvested without mutating the original tuple', () => {
    const dropped = feedback.drop({ slug: 's', summary: 'x', droppedBy: 'agent-1' });
    advance(2000);
    const harvested = feedback.harvest({
      feedbackId: dropped.feedbackId,
      harvestedBy: 'cartographer',
      intoSlug: 's-promoted',
    });
    expect(harvested.status).toBe('harvested');
    expect(harvested.harvestedAt).toBe(dropped.at + 2000);
    expect(harvested.harvestedIntoSlug).toBe('s-promoted');

    const fresh = feedback.get(dropped.feedbackId);
    expect(fresh?.status).toBe('harvested');
    expect(fresh?.harvestedAt).toBe(dropped.at + 2000);
    expect(fresh?.harvestedIntoSlug).toBe('s-promoted');

    // Status filter sees the new state.
    const open = feedback.list({ status: 'open' });
    expect(open).toHaveLength(0);
    const harvestedList = feedback.list({ status: 'harvested' });
    expect(harvestedList).toHaveLength(1);
  });

  test('rejects unknown feedbackId', () => {
    expect(() =>
      feedback.harvest({ feedbackId: 'nope', harvestedBy: 'cartographer' }),
    ).toThrow(/no feedback/);
  });
});

describe('summary', () => {
  test('returns counts grouped by severity and surface', () => {
    feedback.drop({ slug: 'a', summary: 'x', droppedBy: 'agent-1', severity: 'low', surface: 'CLI' });
    feedback.drop({ slug: 'b', summary: 'y', droppedBy: 'agent-1', severity: 'high', surface: 'CLI' });
    feedback.drop({ slug: 'c', summary: 'z', droppedBy: 'agent-2', severity: 'critical' });

    const s = feedback.summary();
    expect(s.total).toBe(3);
    expect(s.open).toBe(3);
    expect(s.harvested).toBe(0);
    expect(s.bySeverity.low).toBe(1);
    expect(s.bySeverity.high).toBe(1);
    expect(s.bySeverity.critical).toBe(1);
    expect(s.bySurface.CLI).toBe(2);
    expect(s.bySurface['(unspecified)']).toBe(1);
  });

  test('open count drops when an entry is harvested', () => {
    const dropped = feedback.drop({ slug: 'a', summary: 'x', droppedBy: 'agent-1' });
    feedback.harvest({ feedbackId: dropped.feedbackId, harvestedBy: 'cartographer' });
    const s = feedback.summary();
    expect(s.open).toBe(0);
    expect(s.harvested).toBe(1);
  });
});

describe('harbor scoping', () => {
  test('list scopes to harbor when provided', () => {
    feedback.drop({ slug: 'a', summary: 'x', droppedBy: 'agent-1', harbor: 'project-a' });
    feedback.drop({ slug: 'b', summary: 'y', droppedBy: 'agent-1', harbor: 'project-b' });
    expect(feedback.list({ harbor: 'project-a' }).map((e) => e.slug)).toEqual(['a']);
    expect(feedback.list({ harbor: 'project-b' }).map((e) => e.slug)).toEqual(['b']);
  });
});
