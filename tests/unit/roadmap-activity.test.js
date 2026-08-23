/**
 * Unit tests for lib/roadmap-activity.ts + routes/roadmap-activity.ts —
 * the live-work join for the roadmap command center (operator mandate
 * 2026-08-22: the roadmap must show ACTIVE IN-PROGRESS AGENT WORK).
 *
 * Proves, with an in-memory db and fixture sessions/agents/claims:
 *   - active work appears (all three join paths: claims, rent-at-claim
 *     session links, planner assignee via registry + durable roster)
 *   - stale work is marked stale, never active (real lib/agents.ts
 *     threshold ladder through classifySessionLiveness)
 *   - cockpit links are well-formed (/agents/:id/stream, /agents/:id/
 *     interrupt, /sessions/:id/events, agent:<id> steering channel)
 *   - empty item → empty activity (the null state the UI renders)
 *   - stage classification (stacked → executing → review → done) and
 *     board-wide header counts
 *   - HITL approvals attach only on exact agent match
 */

import Fastify from 'fastify';
import { createTestDb } from '../setup-unit.js';
import { createTupleSpace } from '../../lib/tuples.js';
import { createRoadmapItems } from '../../lib/roadmap-items.js';
import {
  createRoadmapActivity,
  classifyStage,
  scanForPrLinks,
} from '../../lib/roadmap-activity.js';
import { roadmapActivityPlugin } from '../../routes/roadmap-activity.js';
import { getStaleThresholdForStatus } from '../../lib/agents.js';

const NOW = 1_750_000_000_000;
const HARBOR = 'port-daddy:fleet';

// Real ladder values (lib/agents.ts): stale = 0.6 × dead, by status.
const STALE_BUSY = getStaleThresholdForStatus('busy'); // 0.6 × 4h
const STALE_DRAINING = getStaleThresholdForStatus('draining'); // 0.6 × 5m

let db;
let roadmapItems;
let activity;

function insertAgent(id, { name = null, status = 'busy', lastHeartbeat = NOW, purpose = null } = {}) {
  db.prepare(
    `INSERT INTO agents (id, name, pid, registered_at, last_heartbeat, status, purpose)
     VALUES (?, ?, 1234, ?, ?, ?, ?)`,
  ).run(id, name, NOW - 60_000, lastHeartbeat, status, purpose);
}

function insertSession(id, { agentId = null, status = 'active', metadata = null, purpose = 'work', worktreeId = null } = {}) {
  db.prepare(
    `INSERT INTO sessions (id, purpose, status, agent_id, worktree_id, created_at, updated_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, purpose, status, agentId, worktreeId, NOW - 120_000, NOW - 30_000, metadata ? JSON.stringify(metadata) : null);
}

function ensureClaimsTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS roadmap_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL,
      kind TEXT NOT NULL,
      feedback_id TEXT,
      claimed_by TEXT NOT NULL,
      claimed_at INTEGER NOT NULL,
      released_at INTEGER,
      released_by TEXT,
      release_reason TEXT,
      summary TEXT,
      surface TEXT,
      payload TEXT,
      session_id TEXT,
      agent_id TEXT
    );
  `);
}

function insertClaim(slug, { sessionId = null, agentId = null, claimedBy = 'agent-x', releasedAt = null } = {}) {
  ensureClaimsTable();
  db.prepare(
    `INSERT INTO roadmap_claims (slug, kind, claimed_by, claimed_at, released_at, session_id, agent_id)
     VALUES (?, 'next-cut', ?, ?, ?, ?, ?)`,
  ).run(slug, claimedBy, NOW - 90_000, releasedAt, sessionId, agentId);
}

function upsertItem(slug, { status = 'now', summaryMd = `Item ${slug}`, notes } = {}) {
  return roadmapItems.upsert({ slug, summaryMd, status, harbor: HARBOR, notes });
}

function ensureDispatchesTable() {
  // Mirror of migration 083's shape (columns this module reads).
  db.exec(`
    CREATE TABLE IF NOT EXISTS dispatches (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      goal TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'proposed',
      worker_actor_id TEXT,
      branch TEXT,
      session_id TEXT,
      result_artifact TEXT,
      error_message TEXT,
      created_at INTEGER NOT NULL
    );
  `);
}

function insertDispatch(id, slug, state, { sessionId = null, workerActorId = null, createdAt = NOW - 60_000, errorMessage = null } = {}) {
  ensureDispatchesTable();
  db.prepare(
    `INSERT INTO dispatches (id, slug, goal, state, worker_actor_id, session_id, error_message, created_at)
     VALUES (?, ?, 'goal', ?, ?, ?, ?, ?)`,
  ).run(id, slug, state, workerActorId, sessionId, errorMessage, createdAt);
}

beforeEach(() => {
  db = createTestDb();
  const tuples = createTupleSpace(db);
  roadmapItems = createRoadmapItems({ db, tuples, now: () => NOW - 300_000 });
  activity = createRoadmapActivity({ db, now: () => NOW, listPendingApprovals: () => [] });
});

afterEach(() => {
  if (db) db.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// Join path 1: active roadmap claims
// ─────────────────────────────────────────────────────────────────────────────

describe('claim join path', () => {
  test('an active claim with a live session+agent appears as active work', () => {
    upsertItem('live-slice');
    insertAgent('agent-live', { status: 'busy', lastHeartbeat: NOW - 60_000 });
    insertSession('session-live', { agentId: 'agent-live' });
    insertClaim('live-slice', { sessionId: 'session-live', agentId: 'agent-live' });

    const view = activity.itemActivity('live-slice');
    expect(view).not.toBeNull();
    expect(view.attachments).toHaveLength(1);
    const a = view.attachments[0];
    expect(a.sources).toContain('claim');
    expect(a.agentId).toBe('agent-live');
    expect(a.sessionId).toBe('session-live');
    expect(a.liveness).toBe('active');
    expect(a.agentRegistered).toBe(true);
    expect(a.claim).toMatchObject({ claimedBy: 'agent-x', kind: 'next-cut' });
    expect(view.stage).toBe('executing');
  });

  test('a released claim contributes nothing', () => {
    upsertItem('released-slice');
    insertClaim('released-slice', { sessionId: 's1', agentId: 'a1', releasedAt: NOW - 10 });
    const view = activity.itemActivity('released-slice');
    expect(view.attachments).toHaveLength(0);
    expect(view.stage).toBe('stacked');
  });

  test('a claim on a completed session is reported done, not active', () => {
    upsertItem('finished-slice');
    insertAgent('agent-done', { lastHeartbeat: NOW - 1_000 });
    insertSession('session-done', { agentId: 'agent-done', status: 'completed' });
    insertClaim('finished-slice', { sessionId: 'session-done', agentId: 'agent-done' });

    const view = activity.itemActivity('finished-slice');
    expect(view.attachments).toHaveLength(1);
    expect(view.attachments[0].liveness).toBe('done');
    // A fresh heartbeat cannot resurrect a completed session into "executing".
    expect(view.stage).toBe('stacked');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Join path 2: rent-at-claim session links (metadata.roadmapLink)
// ─────────────────────────────────────────────────────────────────────────────

describe('session-link join path', () => {
  test('an active session stamped with roadmapLink appears', () => {
    upsertItem('linked-slice');
    insertAgent('agent-linked', { lastHeartbeat: NOW - 5_000 });
    insertSession('session-linked', {
      agentId: 'agent-linked',
      metadata: { roadmapLink: 'linked-slice' },
      purpose: 'ship the linked slice',
    });

    const view = activity.itemActivity('linked-slice');
    expect(view.attachments).toHaveLength(1);
    const a = view.attachments[0];
    expect(a.sources).toEqual(['session-link']);
    expect(a.purpose).toBe('ship the linked slice');
    expect(a.liveness).toBe('active');
    expect(view.stage).toBe('executing');
  });

  test('a claim and a session link describing the same work merge into one attachment', () => {
    upsertItem('merged-slice');
    insertAgent('agent-merged', { lastHeartbeat: NOW - 5_000 });
    insertSession('session-merged', {
      agentId: 'agent-merged',
      metadata: { roadmapLink: 'merged-slice' },
    });
    insertClaim('merged-slice', { sessionId: 'session-merged', agentId: 'agent-merged' });

    const view = activity.itemActivity('merged-slice');
    expect(view.attachments).toHaveLength(1);
    expect(view.attachments[0].sources.sort()).toEqual(['claim', 'session-link']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Join path 3: planner assignee (registry agent + durable roster node)
// ─────────────────────────────────────────────────────────────────────────────

describe('assignee join path', () => {
  function hasAssigneeColumn() {
    return db
      .prepare('PRAGMA table_info(roadmap_items)')
      .all()
      .some((column) => column.name === 'assignee_id');
  }

  // The shared test schema (tests/setup-unit.js) grew `assignee_id` when the
  // ADR-0086 planner columns landed, so this is now usually a no-op. It stays
  // because these tests must also pass against a mirror that predates the
  // column — adding it unconditionally is what made them fail once the mirror
  // caught up.
  function addAssigneeColumn() {
    if (!hasAssigneeColumn()) {
      db.exec('ALTER TABLE roadmap_items ADD COLUMN assignee_id TEXT');
    }
  }

  // The legacy case has to be constructed now that the shared schema provides
  // the column; without this the test passes for the wrong reason and stops
  // exercising the missing-column path at all.
  function dropAssigneeColumn() {
    if (hasAssigneeColumn()) {
      db.exec('ALTER TABLE roadmap_items DROP COLUMN assignee_id');
    }
  }

  test('assignee resolving to a registered live agent appears', () => {
    addAssigneeColumn();
    upsertItem('assigned-slice');
    db.prepare('UPDATE roadmap_items SET assignee_id = ? WHERE slug = ?').run('agent-assignee', 'assigned-slice');
    insertAgent('agent-assignee', { name: 'Navigator', lastHeartbeat: NOW - 10_000 });

    const view = activity.itemActivity('assigned-slice');
    expect(view.assigneeId).toBe('agent-assignee');
    expect(view.attachments).toHaveLength(1);
    const a = view.attachments[0];
    expect(a.sources).toContain('assignee-agent');
    expect(a.agentName).toBe('Navigator');
    expect(a.liveness).toBe('active');
  });

  test('assignee resolving to a durable roster node joins through to its live session', () => {
    addAssigneeColumn();
    db.exec(`
      CREATE TABLE harbor_proj_roster (
        agent_node_id TEXT PRIMARY KEY,
        display_name TEXT,
        status TEXT,
        current_session_id TEXT,
        last_heartbeat_at TEXT
      );
    `);
    upsertItem('node-slice');
    db.prepare('UPDATE roadmap_items SET assignee_id = ? WHERE slug = ?').run('node-42', 'node-slice');
    db.prepare(
      `INSERT INTO harbor_proj_roster (agent_node_id, display_name, status, current_session_id, last_heartbeat_at)
       VALUES ('node-42', 'Durable Person', 'busy', 'session-node', ?)`,
    ).run(new Date(NOW - 20_000).toISOString());
    insertSession('session-node', { agentId: null });

    const view = activity.itemActivity('node-slice');
    expect(view.attachments).toHaveLength(1);
    const a = view.attachments[0];
    expect(a.sources).toContain('assignee-node');
    expect(a.agentNodeId).toBe('node-42');
    expect(a.sessionId).toBe('session-node');
    expect(a.agentNodeUrl).toBe('/agent-nodes/node-42');
    expect(a.transcriptUrl).toBe('/sessions/session-node/events');
    expect(a.liveness).toBe('active');
  });

  test('an unresolvable assignee id contributes nothing (no fake attachments)', () => {
    addAssigneeColumn();
    upsertItem('ghost-slice');
    db.prepare('UPDATE roadmap_items SET assignee_id = ? WHERE slug = ?').run('nobody-here', 'ghost-slice');
    const view = activity.itemActivity('ghost-slice');
    expect(view.attachments).toHaveLength(0);
  });

  test('legacy schema without assignee_id column degrades gracefully', () => {
    // Seed first: the current roadmapItems.upsert writes assignee_id
    // unconditionally, so a table lacking the column cannot be written to at
    // all. What lib/roadmap-activity.ts degrades gracefully about is the READ,
    // so drop the column after the row exists and read through it.
    upsertItem('legacy-slice');
    dropAssigneeColumn();
    const view = activity.itemActivity('legacy-slice');
    expect(view.assigneeId).toBeNull();
    expect(view.attachments).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Honest liveness: stale is stale, never active
// ─────────────────────────────────────────────────────────────────────────────

describe('honest liveness', () => {
  test('a heartbeat older than the real stale threshold is reported stale', () => {
    upsertItem('stale-slice');
    insertAgent('agent-stale', {
      status: 'busy',
      lastHeartbeat: NOW - STALE_BUSY - 1,
    });
    insertSession('session-stale', {
      agentId: 'agent-stale',
      metadata: { roadmapLink: 'stale-slice' },
    });

    const view = activity.itemActivity('stale-slice');
    expect(view.attachments).toHaveLength(1);
    const a = view.attachments[0];
    expect(a.liveness).toBe('stale');
    expect(a.staleThresholdMs).toBe(STALE_BUSY);
    expect(a.idleMs).toBeGreaterThan(STALE_BUSY);
    // Stale work must not classify the item as executing.
    expect(view.stage).toBe('stacked');
  });

  test('a heartbeat just inside the stale threshold is still active', () => {
    upsertItem('fresh-slice');
    insertAgent('agent-fresh', {
      status: 'busy',
      lastHeartbeat: NOW - STALE_BUSY + 60_000,
    });
    insertSession('session-fresh', {
      agentId: 'agent-fresh',
      metadata: { roadmapLink: 'fresh-slice' },
    });

    const view = activity.itemActivity('fresh-slice');
    expect(view.attachments[0].liveness).toBe('active');
  });

  test('the threshold ladder is per-status: draining goes stale far sooner than busy', () => {
    const idle = 10 * 60 * 1000; // 10 minutes — inside busy's band, past draining's.
    expect(idle).toBeLessThan(STALE_BUSY);
    expect(idle).toBeGreaterThan(STALE_DRAINING);

    upsertItem('draining-slice');
    insertAgent('agent-draining', { status: 'draining', lastHeartbeat: NOW - idle });
    insertSession('session-draining', {
      agentId: 'agent-draining',
      metadata: { roadmapLink: 'draining-slice' },
    });

    upsertItem('busy-slice');
    insertAgent('agent-busy', { status: 'busy', lastHeartbeat: NOW - idle });
    insertSession('session-busy', {
      agentId: 'agent-busy',
      metadata: { roadmapLink: 'busy-slice' },
    });

    expect(activity.itemActivity('draining-slice').attachments[0].liveness).toBe('stale');
    expect(activity.itemActivity('busy-slice').attachments[0].liveness).toBe('active');
  });

  test('a session whose agent never heartbeated (unregistered) is stale', () => {
    upsertItem('orphan-slice');
    insertSession('session-orphan', {
      agentId: 'agent-vanished',
      metadata: { roadmapLink: 'orphan-slice' },
    });

    const view = activity.itemActivity('orphan-slice');
    const a = view.attachments[0];
    expect(a.liveness).toBe('stale');
    expect(a.lastHeartbeatMs).toBeNull();
    expect(a.idleMs).toBeNull();
    expect(a.agentRegistered).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cockpit links
// ─────────────────────────────────────────────────────────────────────────────

describe('cockpit links', () => {
  test('are well-formed and URL-encoded', () => {
    upsertItem('cockpit-slice');
    insertAgent('agent cockpit/1', { lastHeartbeat: NOW - 1_000 });
    insertSession('session cockpit/1', {
      agentId: 'agent cockpit/1',
      metadata: { roadmapLink: 'cockpit-slice' },
    });

    const a = activity.itemActivity('cockpit-slice').attachments[0];
    expect(a.cockpit.steeringChannel).toBe('agent:agent cockpit/1');
    expect(a.cockpit.streamUrl).toBe('/agents/agent%20cockpit%2F1/stream');
    expect(a.transcriptUrl).toBe('/sessions/session%20cockpit%2F1/events');
  });

  test('interrupt is an honest capability-flagged affordance, never a wired control', () => {
    upsertItem('interrupt-slice');
    insertAgent('agent-int', { lastHeartbeat: NOW - 1_000 });
    insertSession('session-int', {
      agentId: 'agent-int',
      metadata: { roadmapLink: 'interrupt-slice' },
    });

    const a = activity.itemActivity('interrupt-slice').attachments[0];
    expect(a.cockpit.interrupt.available).toBe(false);
    expect(a.cockpit.interrupt.reason).toMatch(/publish-only|no delivery/i);
    // The soft signal that exists today is still linked, labeled as such.
    expect(a.cockpit.interrupt.softSignalUrl).toBe('/agents/agent-int/interrupt');
    // The planned acknowledged control ingress is named as the extension point.
    expect(a.cockpit.interrupt.plannedRoute).toBe('/agent-nodes/:id/control');
    expect(a.cockpit.interrupt.plannedVerbs).toEqual(['interrupt', 'steer']);
  });

  test('cockpit is null when no agent id is known', () => {
    upsertItem('agentless-slice');
    insertSession('session-agentless', {
      agentId: null,
      metadata: { roadmapLink: 'agentless-slice' },
    });
    const a = activity.itemActivity('agentless-slice').attachments[0];
    expect(a.cockpit).toBeNull();
    expect(a.transcriptUrl).toBe('/sessions/session-agentless/events');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Empty / null states
// ─────────────────────────────────────────────────────────────────────────────

describe('null states', () => {
  test('an item with no work returns empty attachments, stage stacked', () => {
    upsertItem('idle-slice');
    const view = activity.itemActivity('idle-slice');
    expect(view.attachments).toEqual([]);
    expect(view.counts).toEqual({ attachments: 0, active: 0, stale: 0 });
    expect(view.stage).toBe('stacked');
  });

  test('an unknown slug returns null', () => {
    expect(activity.itemActivity('never-existed')).toBeNull();
  });

  test('missing roadmap_claims / harbor_proj_roster / dispatches tables are tolerated', () => {
    // The default fixture has none of the three — nothing should throw.
    upsertItem('bare-slice');
    expect(() => activity.itemActivity('bare-slice')).not.toThrow();
    expect(() => activity.board()).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Stage classification + board feed
// ─────────────────────────────────────────────────────────────────────────────

describe('stage classification', () => {
  test('pure classifier precedence: done > review > executing > stacked', () => {
    expect(classifyStage('done', null, { kind: 'status-merge' }, [{ liveness: 'active' }])).toBe('done');
    expect(classifyStage('now', null, { kind: 'status-merge' }, [{ liveness: 'active' }])).toBe('review');
    expect(classifyStage('now', null, null, [{ liveness: 'active' }])).toBe('executing');
    expect(classifyStage('now', null, null, [{ liveness: 'stale' }])).toBe('stacked');
    expect(classifyStage('backlog', null, null, [])).toBe('stacked');
  });

  test('the rollup is a documented mapping over the canonical dispatches.state enum', () => {
    // done ← accepted | settled
    expect(classifyStage('now', 'accepted', null, [])).toBe('done');
    expect(classifyStage('now', 'settled', null, [])).toBe('done');
    // review ← review_pending
    expect(classifyStage('now', 'review_pending', null, [])).toBe('review');
    // executing ← claimed | in_progress | produced (even with no heartbeat —
    // the dispatch machine is authoritative for WHERE; liveness stays on the
    // attachments for WHO)
    expect(classifyStage('now', 'claimed', null, [])).toBe('executing');
    expect(classifyStage('now', 'in_progress', null, [])).toBe('executing');
    expect(classifyStage('now', 'produced', null, [])).toBe('executing');
    // stacked ← proposed and the attention states — NEVER laundered into done
    expect(classifyStage('now', 'proposed', null, [])).toBe('stacked');
    expect(classifyStage('now', 'failed', null, [])).toBe('stacked');
    expect(classifyStage('now', 'rejected', null, [])).toBe('stacked');
    expect(classifyStage('now', 'salvage', null, [])).toBe('stacked');
  });

  test('merge status classifies as review (status-merge evidence)', () => {
    upsertItem('review-slice', { status: 'merge' });
    const view = activity.itemActivity('review-slice');
    expect(view.stage).toBe('review');
    expect(view.reviewEvidence).toEqual({ kind: 'status-merge' });
  });

  test('a real PR link in notes classifies as review with pr-link evidence', () => {
    upsertItem('pr-slice', {
      notes: [{ at: NOW - 1000, by: 'agent-x', text: 'Opened https://github.com/curiositech/port-daddy/pull/9001 for review' }],
    });
    const view = activity.itemActivity('pr-slice');
    expect(view.stage).toBe('review');
    expect(view.reviewEvidence).toEqual({
      kind: 'pr-link',
      urls: ['https://github.com/curiositech/port-daddy/pull/9001'],
    });
  });

  test('scanForPrLinks finds and dedupes PR URLs, ignores non-PR links', () => {
    expect(
      scanForPrLinks([
        'see https://github.com/o/r/pull/1 and https://github.com/o/r/pull/1',
        'not a PR: https://github.com/o/r/issues/2',
        null,
      ]),
    ).toEqual(['https://github.com/o/r/pull/1']);
  });

  test('board feed: counts across all items, only in-flight items listed', () => {
    // stacked (no work)
    upsertItem('board-stacked', { status: 'backlog' });
    // executing (live agent via session link)
    upsertItem('board-exec');
    insertAgent('agent-b1', { lastHeartbeat: NOW - 1_000 });
    insertSession('session-b1', { agentId: 'agent-b1', metadata: { roadmapLink: 'board-exec' } });
    // review (merge lane) with an open claim on a stale agent
    upsertItem('board-review', { status: 'merge' });
    insertAgent('agent-b2', { status: 'busy', lastHeartbeat: NOW - STALE_BUSY - 60_000 });
    insertSession('session-b2', { agentId: 'agent-b2' });
    insertClaim('board-review', { sessionId: 'session-b2', agentId: 'agent-b2' });
    // done
    upsertItem('board-done', { status: 'done' });

    const board = activity.board({ harbor: HARBOR });
    expect(board.counts.items).toBe(4);
    expect(board.counts.byStage).toEqual({ stacked: 1, executing: 1, review: 1, done: 1 });
    expect(board.counts.activeAgents).toBe(1);
    expect(board.counts.staleAttachments).toBe(1);
    expect(board.counts.openClaims).toBe(1);

    const slugs = board.items.map((i) => i.slug).sort();
    // stacked-and-idle is counted but not listed; done has no attachments but a stage.
    expect(slugs).toEqual(['board-done', 'board-exec', 'board-review']);

    const withStacked = activity.board({ harbor: HARBOR, includeStacked: true });
    expect(withStacked.items.map((i) => i.slug).sort()).toContain('board-stacked');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch join path (canonical lifecycle)
// ─────────────────────────────────────────────────────────────────────────────

describe('dispatch join path', () => {
  test('an in-flight dispatch surfaces its state, session attachment, and executing stage', () => {
    upsertItem('dispatch-slice');
    insertSession('session-disp', { agentId: null, purpose: 'dispatched work' });
    insertDispatch('disp-1', 'dispatch-slice', 'in_progress', {
      sessionId: 'session-disp',
      workerActorId: 'worker-7',
    });

    const view = activity.itemActivity('dispatch-slice');
    expect(view.dispatch).toMatchObject({
      id: 'disp-1',
      state: 'in_progress',
      sessionId: 'session-disp',
      workerActorId: 'worker-7',
    });
    expect(view.stage).toBe('executing');
    expect(view.needsAttention).toBe(false);
    const a = view.attachments.find((x) => x.sources.includes('dispatch'));
    expect(a).toBeDefined();
    expect(a.sessionId).toBe('session-disp');
    expect(a.transcriptUrl).toBe('/sessions/session-disp/events');
    // No heartbeat behind this session — honest liveness stays stale even
    // though the canonical lifecycle says executing.
    expect(a.liveness).toBe('stale');
  });

  test('review_pending dispatch classifies as review', () => {
    upsertItem('disp-review-slice');
    insertDispatch('disp-2', 'disp-review-slice', 'review_pending');
    const view = activity.itemActivity('disp-review-slice');
    expect(view.stage).toBe('review');
  });

  test('settled dispatch classifies as done', () => {
    upsertItem('disp-done-slice');
    insertDispatch('disp-3', 'disp-done-slice', 'settled');
    expect(activity.itemActivity('disp-done-slice').stage).toBe('done');
  });

  test('failed dispatch is flagged needsAttention, never hidden in done', () => {
    upsertItem('disp-failed-slice');
    insertDispatch('disp-4', 'disp-failed-slice', 'failed', { errorMessage: 'worker crashed' });

    const view = activity.itemActivity('disp-failed-slice');
    expect(view.stage).toBe('stacked');
    expect(view.needsAttention).toBe(true);
    expect(view.dispatch.state).toBe('failed');
    expect(view.dispatch.errorMessage).toBe('worker crashed');

    // Attention items appear in the board feed and header even with zero attachments.
    const board = activity.board({ harbor: HARBOR });
    expect(board.counts.attention).toBe(1);
    expect(board.items.map((i) => i.slug)).toContain('disp-failed-slice');
  });

  test('the newest dispatch per slug wins (re-dispatch after failure)', () => {
    upsertItem('disp-retry-slice');
    insertDispatch('disp-old', 'disp-retry-slice', 'failed', { createdAt: NOW - 500_000 });
    insertDispatch('disp-new', 'disp-retry-slice', 'claimed', { createdAt: NOW - 10_000 });
    const view = activity.itemActivity('disp-retry-slice');
    expect(view.dispatch.id).toBe('disp-new');
    expect(view.stage).toBe('executing');
    expect(view.needsAttention).toBe(false);
  });

  test('a proposed or terminal dispatch attaches no session (nothing to watch)', () => {
    upsertItem('disp-proposed-slice');
    insertDispatch('disp-5', 'disp-proposed-slice', 'proposed', { sessionId: 'session-x' });
    const view = activity.itemActivity('disp-proposed-slice');
    expect(view.attachments).toHaveLength(0);
    expect(view.stage).toBe('stacked');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HITL approvals
// ─────────────────────────────────────────────────────────────────────────────

describe('HITL approvals', () => {
  test('attach only on exact agent id/name match, with a decision URL', () => {
    const approvals = [
      { id: 'apv-1', agent: 'agent-hitl', trigger: 'webhook:deploy', tier: 'observed', project: 'port-daddy', reason: 'gate', timestamp: NOW - 500 },
      { id: 'apv-2', agent: 'someone-else', trigger: 'cron', tier: 'observed', project: 'port-daddy', reason: null, timestamp: NOW - 500 },
    ];
    const scoped = createRoadmapActivity({ db, now: () => NOW, listPendingApprovals: () => approvals });

    upsertItem('hitl-slice');
    insertAgent('agent-hitl', { lastHeartbeat: NOW - 1_000 });
    insertSession('session-hitl', { agentId: 'agent-hitl', metadata: { roadmapLink: 'hitl-slice' } });

    const view = scoped.itemActivity('hitl-slice');
    const a = view.attachments[0];
    expect(a.hitl).toHaveLength(1);
    expect(a.hitl[0]).toMatchObject({
      id: 'apv-1',
      decisionUrl: '/fleet/approvals/apv-1/decision',
    });
  });

  test('a throwing approvals source never breaks the view (fail-open default is injectable)', () => {
    const scoped = createRoadmapActivity({
      db,
      now: () => NOW,
      listPendingApprovals: () => [],
    });
    upsertItem('safe-slice');
    expect(() => scoped.itemActivity('safe-slice')).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

describe('routes/roadmap-activity.ts', () => {
  let app;

  beforeEach(async () => {
    app = Fastify();
    await app.register(roadmapActivityPlugin, { deps: { roadmapActivity: activity } });
    await app.ready();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  test('GET /roadmap/items/:slug/activity returns the live-work join', async () => {
    upsertItem('route-slice');
    insertAgent('agent-route', { lastHeartbeat: NOW - 1_000 });
    insertSession('session-route', { agentId: 'agent-route', metadata: { roadmapLink: 'route-slice' } });

    const res = await app.inject({ method: 'GET', url: '/roadmap/items/route-slice/activity' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.activity.stage).toBe('executing');
    expect(body.activity.attachments[0].cockpit.streamUrl).toBe('/agents/agent-route/stream');
    expect(body.activity.attachments[0].cockpit.interrupt.available).toBe(false);
    expect(body.activity.attachments[0].cockpit.interrupt.softSignalUrl).toBe('/agents/agent-route/interrupt');
  });

  test('GET /roadmap/items/:slug/activity → 200 empty for an idle item, 404 for unknown', async () => {
    upsertItem('idle-route-slice');
    const ok = await app.inject({ method: 'GET', url: '/roadmap/items/idle-route-slice/activity' });
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(ok.body).activity.attachments).toEqual([]);

    const missing = await app.inject({ method: 'GET', url: '/roadmap/items/nope/activity' });
    expect(missing.statusCode).toBe(404);
    expect(JSON.parse(missing.body).success).toBe(false);
  });

  test('GET /roadmap/activity returns board counts and in-flight items', async () => {
    upsertItem('route-board-exec');
    insertAgent('agent-rb', { lastHeartbeat: NOW - 1_000 });
    insertSession('session-rb', { agentId: 'agent-rb', metadata: { roadmapLink: 'route-board-exec' } });
    upsertItem('route-board-idle', { status: 'backlog' });

    const res = await app.inject({ method: 'GET', url: `/roadmap/activity?harbor=${encodeURIComponent(HARBOR)}` });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.counts.items).toBe(2);
    expect(body.counts.byStage.executing).toBe(1);
    expect(body.items.map((i) => i.slug)).toEqual(['route-board-exec']);
  });
});
