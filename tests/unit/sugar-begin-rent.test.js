/**
 * S3 rent-at-claim — roadmap link-or-opt-out at session start (server side).
 *
 * `sugar.begin` accepts three mutually-exclusive rent fields:
 *   - roadmapLink: slug of an EXISTING roadmap item (validated, did-you-mean on miss)
 *   - sidequestReason: one-line opt-out reason (min 12 chars)
 *   - roadmapNewTitle: creates a draft roadmap item ('genesis-at-begin' provenance) and links it
 *
 * The rent GATE (refusing begin when none is given) is CLI-level — the daemon
 * stays lenient for programmatic callers (spawner, MCP) in v1.
 */

import { createTestDb, createMockLogger } from '../setup-unit.js';
import { createAgents } from '../../lib/agents.js';
import { createSessions } from '../../lib/sessions.js';
import { createActivityLog } from '../../lib/activity.js';
import { createSugar } from '../../lib/sugar.js';
import { createRoadmapItems } from '../../lib/roadmap-items.js';

const stubTuples = { out: () => ({ id: 1 }) };

function setup({ withRoadmap = true } = {}) {
  const db = createTestDb();
  const agents = createAgents(db);
  const sessions = createSessions(db);
  const activityLog = createActivityLog(db);
  sessions.setActivityLog(activityLog);
  const roadmapItems = withRoadmap ? createRoadmapItems({ db, tuples: stubTuples }) : undefined;
  if (roadmapItems) {
    roadmapItems.upsert({ slug: 'adr-0090-database-distribution', summaryMd: 'DB distribution' });
    roadmapItems.upsert({ slug: 'adr-0090-db-tiering', summaryMd: 'DB tiering' });
    roadmapItems.upsert({ slug: 'fleet-ui-cloud', summaryMd: 'Cloud fleet UI' });
  }
  const sugar = createSugar({
    agents,
    sessions,
    activityLog,
    roadmapItems,
    gitOriginChecker: { checkBranchOnOrigin: () => ({ ok: true, branch: 'feat/x', upstream: 'origin/feat/x', ahead: 0 }) },
  });
  return { db, agents, sessions, sugar, roadmapItems };
}

const base = { lifecycle: 'ephemeral', identity: 'demo:test:rent', purpose: 'rent gate work' };

describe('sugar.begin rent-at-claim — roadmap link', () => {
  test('valid roadmap slug links and persists on the session record', () => {
    const { sugar, sessions } = setup();
    const res = sugar.begin({ ...base, roadmapLink: 'adr-0090-database-distribution' });
    expect(res.success).toBe(true);
    expect(res.roadmapLink).toBe('adr-0090-database-distribution');
    const got = sessions.get(res.sessionId);
    expect(got.session.metadata.roadmapLink).toBe('adr-0090-database-distribution');
  });

  test('unknown slug fails with did-you-mean prefix matches', () => {
    const { sugar } = setup();
    const res = sugar.begin({ ...base, roadmapLink: 'adr-0090-databse' });
    expect(res.success).toBe(false);
    expect(res.code).toBe('ROADMAP_SLUG_UNKNOWN');
    expect(res.didYouMean).toContain('adr-0090-database-distribution');
    expect(res.didYouMean).toContain('adr-0090-db-tiering');
    expect(res.didYouMean).not.toContain('fleet-ui-cloud');
    expect(String(res.error)).toContain('adr-0090-database-distribution');
  });

  test('roadmapLink without a roadmap service fails closed', () => {
    const { sugar } = setup({ withRoadmap: false });
    const res = sugar.begin({ ...base, roadmapLink: 'anything' });
    expect(res.success).toBe(false);
    expect(res.code).toBe('ROADMAP_ITEMS_UNAVAILABLE');
  });
});

describe('sugar.begin rent-at-claim — sidequest opt-out', () => {
  test('sidequest reason persists on the session record', () => {
    const { sugar, sessions } = setup();
    const res = sugar.begin({ ...base, sidequestReason: 'operator asked for a quick spike' });
    expect(res.success).toBe(true);
    expect(res.sidequestReason).toBe('operator asked for a quick spike');
    const got = sessions.get(res.sessionId);
    expect(got.session.metadata.sidequestReason).toBe('operator asked for a quick spike');
  });

  test('sidequest reason under 12 chars is rejected', () => {
    const { sugar } = setup();
    const res = sugar.begin({ ...base, sidequestReason: 'too short' });
    expect(res.success).toBe(false);
    expect(res.code).toBe('SIDEQUEST_REASON_TOO_SHORT');
  });
});

describe('sugar.begin rent-at-claim — draft item genesis', () => {
  test('roadmapNewTitle creates a draft item with genesis-at-begin provenance and links it', () => {
    const { sugar, sessions, roadmapItems } = setup();
    const res = sugar.begin({ ...base, roadmapNewTitle: 'Rent at Claim Gate' });
    expect(res.success).toBe(true);
    expect(res.roadmapLink).toBe('rent-at-claim-gate');
    expect(res.roadmapCreated).toBe(true);

    // Round-trip: the item exists in the roadmap store with the provenance note.
    // begin has no project (identity project demo → demo:fleet harbor).
    const item = roadmapItems.get('rent-at-claim-gate', 'demo:fleet');
    expect(item).toBeTruthy();
    expect(item.summaryMd).toBe('Rent at Claim Gate');
    expect(item.notes.some((n) => n.text.includes('genesis-at-begin'))).toBe(true);

    const got = sessions.get(res.sessionId);
    expect(got.session.metadata.roadmapLink).toBe('rent-at-claim-gate');
  });

  test('empty title is rejected', () => {
    const { sugar } = setup();
    const res = sugar.begin({ ...base, roadmapNewTitle: '   ' });
    expect(res.success).toBe(false);
    expect(res.code).toBe('ROADMAP_TITLE_REQUIRED');
  });
});

describe('sugar.begin rent-at-claim — validation matrix', () => {
  test('two rent fields at once conflict', () => {
    const { sugar } = setup();
    const res = sugar.begin({
      ...base,
      roadmapLink: 'fleet-ui-cloud',
      sidequestReason: 'also a sidequest somehow',
    });
    expect(res.success).toBe(false);
    expect(res.code).toBe('ROADMAP_RENT_CONFLICT');
  });

  test('all three rent fields conflict', () => {
    const { sugar } = setup();
    const res = sugar.begin({
      ...base,
      roadmapLink: 'fleet-ui-cloud',
      sidequestReason: 'also a sidequest somehow',
      roadmapNewTitle: 'And a new one',
    });
    expect(res.success).toBe(false);
    expect(res.code).toBe('ROADMAP_RENT_CONFLICT');
  });

  test('none provided still succeeds server-side (gate is CLI-level in v1)', () => {
    const { sugar } = setup();
    const res = sugar.begin({ ...base });
    expect(res.success).toBe(true);
  });
});

describe('sugar.begin rent-at-claim — surfacing', () => {
  test('whoami shows the roadmap link', () => {
    const { sugar } = setup();
    const began = sugar.begin({ ...base, roadmapLink: 'fleet-ui-cloud' });
    const who = sugar.whoami({ agentId: began.agentId });
    expect(who.active).toBe(true);
    expect(who.roadmapLink).toBe('fleet-ui-cloud');
  });

  test('whoami shows the sidequest reason', () => {
    const { sugar } = setup();
    const began = sugar.begin({ ...base, sidequestReason: 'operator asked for a quick spike' });
    const who = sugar.whoami({ agentId: began.agentId });
    expect(who.sidequestReason).toBe('operator asked for a quick spike');
  });

  test('resume with a new roadmap link updates the resumed session record', () => {
    const { sugar, sessions } = setup();
    const first = sugar.begin({ ...base, sidequestReason: 'starting as a sidequest first' });
    const second = sugar.begin({ ...base, roadmapLink: 'fleet-ui-cloud' });
    expect(second.resumed).toBe(true);
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.roadmapLink).toBe('fleet-ui-cloud');
    const got = sessions.get(first.sessionId);
    expect(got.session.metadata.roadmapLink).toBe('fleet-ui-cloud');
  });

  test('resume validates a bogus roadmap link instead of silently resuming', () => {
    const { sugar } = setup();
    sugar.begin({ ...base, sidequestReason: 'starting as a sidequest first' });
    const second = sugar.begin({ ...base, roadmapLink: 'no-such-slug-anywhere' });
    expect(second.success).toBe(false);
    expect(second.code).toBe('ROADMAP_SLUG_UNKNOWN');
  });
});
