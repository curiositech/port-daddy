import { jest } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createTupleSpace } from '../../lib/tuples.js';
import { createFeedback } from '../../lib/feedback.js';
import { createRoadmapItems } from '../../lib/roadmap-items.js';
import { createRoadmapPromote } from '../../lib/roadmap-promote.js';

let db;
let tuples;
let feedback;
let roadmapItems;
let promote;
let clock;

beforeEach(() => {
  db = createTestDb();
  tuples = createTupleSpace(db);
  clock = 1_700_000_000_000;
  const now = () => clock;
  feedback = createFeedback({ tuples, now });
  roadmapItems = createRoadmapItems({ db, tuples, now });
  promote = createRoadmapPromote({ feedback, roadmapItems, now });
});

afterEach(() => {
  db.close();
});

function advance(ms) {
  clock += ms;
}

function dropOne(overrides = {}) {
  return feedback.drop({
    slug: 'fleetbar-secret-management',
    summary: 'Add FleetBar credentials panel + Keychain.',
    surface: 'FleetBar',
    severity: 'high',
    droppedBy: 'agent-deadbeef',
    project: 'port-daddy',
    suggested: 'Per-backend status panel with provider deeplinks.',
    ...overrides,
  });
}

describe('promoteFromFeedback', () => {
  test('upserts a roadmap_item with promotion provenance AND marks feedback harvested', () => {
    const fb = dropOne();
    advance(60_000);

    const { roadmapItem, feedback: harvested } = promote.promoteFromFeedback({
      feedbackId: fb.feedbackId,
      promotedBy: 'agent-cartographer',
      summaryMd: 'FleetBar Credentials panel keyed off the backend registry.',
    });

    expect(roadmapItem.slug).toBe(fb.slug);
    expect(roadmapItem.summaryMd).toBe('FleetBar Credentials panel keyed off the backend registry.');
    expect(roadmapItem.status).toBe('now');
    expect(roadmapItem.promotedFromFeedbackId).toBe(fb.feedbackId);
    expect(roadmapItem.promotedByAgentId).toBe('agent-cartographer');
    expect(roadmapItem.promotedAt).toBe(clock);
    expect(roadmapItem.harbor).toBe(fb.harbor);

    expect(harvested.status).toBe('harvested');
    expect(harvested.harvestedAt).toBe(clock);
    expect(harvested.harvestedIntoSlug).toBe(fb.slug);
  });

  test('falls back to feedback.suggested then feedback.summary for summaryMd', () => {
    const fb = dropOne({ suggested: 'use the suggested text', summary: 'fallback summary' });
    const { roadmapItem } = promote.promoteFromFeedback({
      feedbackId: fb.feedbackId,
      promotedBy: 'agent-cartographer',
    });
    expect(roadmapItem.summaryMd).toBe('use the suggested text');
  });

  test('falls back to feedback.summary when suggested is missing', () => {
    const fb = feedback.drop({
      slug: 's',
      summary: 'just the summary',
      droppedBy: 'a',
      project: 'port-daddy',
    });
    const { roadmapItem } = promote.promoteFromFeedback({
      feedbackId: fb.feedbackId,
      promotedBy: 'agent-cartographer',
    });
    expect(roadmapItem.summaryMd).toBe('just the summary');
  });

  test('accepts an override slug different from the feedback slug', () => {
    const fb = dropOne();
    const { roadmapItem, feedback: harvested } = promote.promoteFromFeedback({
      feedbackId: fb.feedbackId,
      slug: 'fleetbar-credentials-panel',
      promotedBy: 'agent-cartographer',
    });
    expect(roadmapItem.slug).toBe('fleetbar-credentials-panel');
    expect(harvested.harvestedIntoSlug).toBe('fleetbar-credentials-panel');
  });

  test('rejects missing or unknown feedbackId', () => {
    expect(() =>
      promote.promoteFromFeedback({ feedbackId: '', promotedBy: 'a' }),
    ).toThrow(/feedbackId/);
    expect(() =>
      promote.promoteFromFeedback({ feedbackId: 'no-such', promotedBy: 'a' }),
    ).toThrow(/no feedback/);
  });

  test('rejects missing promotedBy', () => {
    const fb = dropOne();
    expect(() =>
      promote.promoteFromFeedback({ feedbackId: fb.feedbackId, promotedBy: '' }),
    ).toThrow(/promotedBy/);
  });

  test('is idempotent when promoting the same feedback twice (upsert preserves item id)', () => {
    const fb = dropOne();
    const first = promote.promoteFromFeedback({
      feedbackId: fb.feedbackId,
      promotedBy: 'agent-cartographer',
    });
    advance(10);
    const second = promote.promoteFromFeedback({
      feedbackId: fb.feedbackId,
      promotedBy: 'agent-cartographer',
      summaryMd: 'tighter summary on re-promote',
    });
    expect(second.roadmapItem.id).toBe(first.roadmapItem.id);
    expect(second.roadmapItem.summaryMd).toBe('tighter summary on re-promote');
  });

  test('uses provided status; defaults to now', () => {
    const fb = dropOne();
    const promoted = promote.promoteFromFeedback({
      feedbackId: fb.feedbackId,
      promotedBy: 'a',
      status: 'backlog',
    });
    expect(promoted.roadmapItem.status).toBe('backlog');

    const fb2 = dropOne({ slug: 'other-slug' });
    const promoted2 = promote.promoteFromFeedback({
      feedbackId: fb2.feedbackId,
      promotedBy: 'a',
    });
    expect(promoted2.roadmapItem.status).toBe('now');
  });

  test('honors harbor override but defaults to the feedback harbor', () => {
    const fb = dropOne();
    const { roadmapItem } = promote.promoteFromFeedback({
      feedbackId: fb.feedbackId,
      promotedBy: 'a',
    });
    expect(roadmapItem.harbor).toBe(fb.harbor);
  });

  describe('harbor guard — rejects a suspicious harbor override', () => {
    let warnSpy;

    beforeEach(() => {
      warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    test('a promote-time harbor override shaped like a PR id is rejected even when it correctly scopes the feedback lookup', () => {
      // promoteFromFeedback uses `input.harbor` to SCOPE the feedback.get()
      // lookup itself, so a caller-supplied override must match wherever the
      // feedback actually lives to be found at all. Simulate a legacy
      // feedback row that (pre-guard) was dropped under a suspicious harbor,
      // by writing the tuple directly rather than via feedback.drop().
      const feedbackId = 'fb-legacy-2';
      tuples.out(['feedback:dropped', feedbackId, {
        feedbackId,
        slug: 'legacy2',
        summary: 'x',
        surface: null,
        severity: 'medium',
        status: 'open',
        source: 'unknown',
        suggested: null,
        hook: null,
        droppedBy: 'a',
        project: null,
        harbor: 'pr-3143',
        at: clock,
        harvestedAt: null,
        harvestedIntoSlug: null,
      }], { harbor: 'pr-3143', writtenBy: 'a' });

      const { roadmapItem } = promote.promoteFromFeedback({
        feedbackId,
        promotedBy: 'a',
        harbor: 'pr-3143',
      });
      expect(roadmapItem.harbor).toBe('fleet');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('rejected suspicious harbor'));
    });

    test('an inherited feedback.harbor that is itself suspicious falls back to the roadmap default', () => {
      // Simulate a legacy feedback row dropped BEFORE feedback.drop() guarded
      // its own harbor input, by writing the tuple directly rather than via
      // feedback.drop() (which would now refuse to persist this harbor at
      // the source). Covers promotion of pre-existing, unguarded rows.
      const feedbackId = 'fb-legacy-1';
      tuples.out(['feedback:dropped', feedbackId, {
        feedbackId,
        slug: 'legacy',
        summary: 'x',
        surface: null,
        severity: 'medium',
        status: 'open',
        source: 'unknown',
        suggested: null,
        hook: null,
        droppedBy: 'a',
        project: null,
        harbor: '17604542',
        at: clock,
        harvestedAt: null,
        harvestedIntoSlug: null,
      }], { harbor: '17604542', writtenBy: 'a' });

      const { roadmapItem } = promote.promoteFromFeedback({
        feedbackId,
        promotedBy: 'a',
      });
      expect(roadmapItem.harbor).toBe('fleet');
    });
  });
});
