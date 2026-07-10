/**
 * S3 rent-at-claim — roadmap link-or-opt-out at session start (server side).
 *
 * `sugar.begin` accepts three mutually-exclusive rent fields:
 *   - roadmapLink: slug of an EXISTING roadmap item (validated, did-you-mean on miss)
 *   - sidequestReason: one-line opt-out reason (min 12 chars)
 *   - roadmapNewTitle: creates a draft roadmap item ('genesis-at-begin' provenance) and links it
 *
 * The rent GATE (refusing begin when none is given) is enforced in the pd CLI
 * and the MCP begin_session tool — the daemon's raw HTTP surface stays lenient
 * for direct programmatic callers in v1.
 */

import { createTestDb } from '../setup-unit.js';
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

  test('slug collision LINKS the existing item instead of clobbering it', () => {
    const { sugar, roadmapItems } = setup();
    // Existing item with a real status and a note — a naive upsert would
    // downgrade status to backlog and wipe the notes.
    roadmapItems.upsert({
      slug: 'fleet-ui-cloud',
      summaryMd: 'Cloud fleet UI',
      status: 'now',
      notes: [{ at: 1, by: 'cartographer', text: 'important provenance' }],
    });
    const res = sugar.begin({ ...base, roadmapNewTitle: 'Fleet UI Cloud' });
    expect(res.success).toBe(true);
    expect(res.roadmapLink).toBe('fleet-ui-cloud');
    expect(res.roadmapExisting).toBe(true);
    expect(res.roadmapCreated).toBeUndefined();

    const item = roadmapItems.get('fleet-ui-cloud');
    expect(item.status).toBe('now');
    expect(item.summaryMd).toBe('Cloud fleet UI');
    expect(item.notes.some((n) => n.text === 'important provenance')).toBe(true);
    expect(item.notes.some((n) => n.text.includes('genesis-at-begin'))).toBe(false);
  });

  test('a begin that fails AFTER rent validation creates no orphan roadmap item', () => {
    const { sugar, sessions, roadmapItems } = setup();
    const origStart = sessions.start;
    sessions.start = () => ({ success: false, error: 'induced failure' });
    try {
      const res = sugar.begin({ ...base, roadmapNewTitle: 'Never Materialized' });
      expect(res.success).toBe(false);
      expect(res.code).toBe('SESSION_START_FAILED');
      expect(roadmapItems.slugExists('never-materialized')).toBe(false);
    } finally {
      sessions.start = origStart;
    }
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

  test('resume switching rent MODE clears the old field (sidequest -> roadmap)', () => {
    const { sugar, sessions } = setup();
    const first = sugar.begin({ ...base, sidequestReason: 'starting as a sidequest first' });
    const second = sugar.begin({ ...base, roadmapLink: 'fleet-ui-cloud' });
    expect(second.resumed).toBe(true);
    const got = sessions.get(first.sessionId);
    expect(got.session.metadata.roadmapLink).toBe('fleet-ui-cloud');
    expect(got.session.metadata.sidequestReason).toBeUndefined();
    // whoami shows exactly one rent field, never both.
    const who = sugar.whoami({ agentId: second.agentId });
    expect(who.roadmapLink).toBe('fleet-ui-cloud');
    expect(who.sidequestReason).toBeNull();
  });

  test('resume switching rent MODE clears the old field (roadmap -> sidequest)', () => {
    const { sugar, sessions } = setup();
    const first = sugar.begin({ ...base, roadmapLink: 'fleet-ui-cloud' });
    const second = sugar.begin({ ...base, sidequestReason: 'now a sidequest instead' });
    expect(second.resumed).toBe(true);
    const got = sessions.get(first.sessionId);
    expect(got.session.metadata.sidequestReason).toBe('now a sidequest instead');
    expect(got.session.metadata.roadmapLink).toBeUndefined();
  });

  test('resume validates a bogus roadmap link instead of silently resuming', () => {
    const { sugar } = setup();
    sugar.begin({ ...base, sidequestReason: 'starting as a sidequest first' });
    const second = sugar.begin({ ...base, roadmapLink: 'no-such-slug-anywhere' });
    expect(second.success).toBe(false);
    expect(second.code).toBe('ROADMAP_SLUG_UNKNOWN');
  });
});

// =============================================================================
// Anti-Goodhart valve: sugar.relink — a wrong link is never sticky.
// =============================================================================

describe('sugar.relink — validation matrix', () => {
  test('relink to a valid slug updates the active session and clears the sidequest', () => {
    const { sugar, sessions } = setup();
    const began = sugar.begin({ ...base, sidequestReason: 'picked a garbage reason to pass the gate' });
    const res = sugar.relink({ agentId: began.agentId, roadmapLink: 'fleet-ui-cloud' });
    expect(res.success).toBe(true);
    expect(res.sessionId).toBe(began.sessionId);
    expect(res.roadmapLink).toBe('fleet-ui-cloud');
    expect(res.previousSidequestReason).toBe('picked a garbage reason to pass the gate');
    expect(res.previousRoadmapLink).toBeNull();
    const got = sessions.get(began.sessionId);
    expect(got.session.metadata.roadmapLink).toBe('fleet-ui-cloud');
    expect(got.session.metadata.sidequestReason).toBeUndefined();
  });

  test('relink to an unknown slug fails with did-you-mean prefix matches', () => {
    const { sugar } = setup();
    const began = sugar.begin({ ...base, sidequestReason: 'starting as a sidequest first' });
    const res = sugar.relink({ agentId: began.agentId, roadmapLink: 'adr-0090-databse' });
    expect(res.success).toBe(false);
    expect(res.code).toBe('ROADMAP_SLUG_UNKNOWN');
    expect(res.didYouMean).toContain('adr-0090-database-distribution');
    expect(String(res.error)).toContain('adr-0090-database-distribution');
  });

  test('relink to a sidequest updates the session and clears the roadmap link', () => {
    const { sugar, sessions } = setup();
    const began = sugar.begin({ ...base, roadmapLink: 'fleet-ui-cloud' });
    const res = sugar.relink({ agentId: began.agentId, sidequestReason: 'scope shrank to an off-roadmap spike' });
    expect(res.success).toBe(true);
    expect(res.sidequestReason).toBe('scope shrank to an off-roadmap spike');
    expect(res.previousRoadmapLink).toBe('fleet-ui-cloud');
    const got = sessions.get(began.sessionId);
    expect(got.session.metadata.sidequestReason).toBe('scope shrank to an off-roadmap spike');
    expect(got.session.metadata.roadmapLink).toBeUndefined();
  });

  test('relink sidequest under 12 chars is rejected', () => {
    const { sugar } = setup();
    const began = sugar.begin({ ...base, roadmapLink: 'fleet-ui-cloud' });
    const res = sugar.relink({ agentId: began.agentId, sidequestReason: 'too short' });
    expect(res.success).toBe(false);
    expect(res.code).toBe('SIDEQUEST_REASON_TOO_SHORT');
  });

  test('relink with both fields at once conflicts', () => {
    const { sugar } = setup();
    const began = sugar.begin({ ...base, roadmapLink: 'fleet-ui-cloud' });
    const res = sugar.relink({
      agentId: began.agentId,
      roadmapLink: 'adr-0090-db-tiering',
      sidequestReason: 'also a sidequest somehow',
    });
    expect(res.success).toBe(false);
    expect(res.code).toBe('ROADMAP_RENT_CONFLICT');
  });

  test('relink with neither field is rejected', () => {
    const { sugar } = setup();
    const began = sugar.begin({ ...base, roadmapLink: 'fleet-ui-cloud' });
    const res = sugar.relink({ agentId: began.agentId });
    expect(res.success).toBe(false);
    expect(res.code).toBe('ROADMAP_RENT_REQUIRED');
  });

  test('relink with no active session fails with NO_ACTIVE_SESSION', () => {
    const { sugar } = setup();
    const res = sugar.relink({ agentId: 'agent-that-never-began', roadmapLink: 'fleet-ui-cloud' });
    expect(res.success).toBe(false);
    expect(res.code).toBe('NO_ACTIVE_SESSION');
  });

  test('relink roadmap without a roadmap service fails closed', () => {
    const { sugar } = setup({ withRoadmap: false });
    const began = sugar.begin({ ...base, sidequestReason: 'starting as a sidequest first' });
    const res = sugar.relink({ agentId: began.agentId, roadmapLink: 'anything' });
    expect(res.success).toBe(false);
    expect(res.code).toBe('ROADMAP_ITEMS_UNAVAILABLE');
  });
});

describe('sugar.relink — audit trail + surfacing', () => {
  test('relink appends a session note recording old -> new', () => {
    const { sugar, sessions } = setup();
    const began = sugar.begin({ ...base, sidequestReason: 'picked a garbage reason to pass the gate' });
    sugar.relink({ agentId: began.agentId, roadmapLink: 'fleet-ui-cloud' });
    const notes = sessions.getNotes(began.sessionId);
    const audit = (notes.notes || []).find((n) => n.type === 'relink');
    expect(audit).toBeTruthy();
    expect(audit.content).toContain('rent-relink');
    expect(audit.content).toContain('sidequest:picked a garbage reason to pass the gate');
    expect(audit.content).toContain('roadmap:fleet-ui-cloud');
    expect(audit.content).toMatch(/->/);
  });

  test('whoami shows the updated link after relink', () => {
    const { sugar } = setup();
    const began = sugar.begin({ ...base, sidequestReason: 'picked a garbage reason to pass the gate' });
    sugar.relink({ agentId: began.agentId, roadmapLink: 'fleet-ui-cloud' });
    const who = sugar.whoami({ agentId: began.agentId });
    expect(who.active).toBe(true);
    expect(who.roadmapLink).toBe('fleet-ui-cloud');
    expect(who.sidequestReason).toBeNull();
  });

  test('a failed relink leaves the original rent untouched', () => {
    const { sugar, sessions } = setup();
    const began = sugar.begin({ ...base, roadmapLink: 'fleet-ui-cloud' });
    const res = sugar.relink({ agentId: began.agentId, roadmapLink: 'no-such-slug-anywhere' });
    expect(res.success).toBe(false);
    const got = sessions.get(began.sessionId);
    expect(got.session.metadata.roadmapLink).toBe('fleet-ui-cloud');
  });
});
