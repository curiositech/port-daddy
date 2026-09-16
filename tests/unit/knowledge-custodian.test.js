/**
 * Unit Tests: Knowledge Custodian (Phase 3)
 *
 * Tests each duty in isolation with mock deps.
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { KnowledgeCustodian } from '../../lib/knowledge-custodian.js';
import { createEpisodicMemory } from '../../lib/episodic-memory.js';
import { createOperatorPermissions } from '../../lib/operator-permissions.js';

let db;
let episodicMemory;
let operatorPermissions;
let messages;
let logger;

function makeCustodian(extraDeps = {}) {
  messages = [];
  return new KnowledgeCustodian({
    db,
    logger,
    episodicMemory,
    operatorPermissions,
    messaging: {
      publish(channel, payload) {
        messages.push({ channel, payload });
      },
    },
    ...extraDeps,
  });
}

function seedSession(sessionId, updatedAtOffset = 0) {
  db.prepare(
    `INSERT OR IGNORE INTO sessions (id, agent_id, purpose, status, created_at, updated_at)
     VALUES (?, 'agent-test', 'test', 'active', ?, ?)`
  ).run(sessionId, Date.now() + updatedAtOffset, Date.now() + updatedAtOffset);
}

function seedNote(sessionId, content, type = 'note') {
  db.prepare(
    `INSERT INTO session_notes (session_id, content, type, created_at) VALUES (?, ?, ?, ?)`
  ).run(sessionId, content, type, Date.now());
}

beforeEach(() => {
  db = createTestDb();
  episodicMemory = createEpisodicMemory(db);
  operatorPermissions = createOperatorPermissions(db);
  logger = {
    info: () => {},
    error: () => {},
  };
});

afterEach(() => {
  db.close();
});

describe('Duty: harvest', () => {
  test('harvests stale active sessions', async () => {
    const staleOffset = -(35 * 60 * 1000); // 35 minutes ago
    seedSession('sess-stale-1', staleOffset);
    seedNote('sess-stale-1', 'Finding: stale work', 'finding');

    const custodian = makeCustodian();
    await custodian.runHarvestDuty();

    const episodes = db.prepare('SELECT COUNT(*) as n FROM episodic_memory').get();
    expect(episodes.n).toBe(1);
  });

  test('does not harvest recent sessions (< 30 min inactive)', async () => {
    seedSession('sess-recent', 0); // just now
    seedNote('sess-recent', 'Active note', 'note');

    const custodian = makeCustodian();
    await custodian.runHarvestDuty();

    const episodes = db.prepare('SELECT COUNT(*) as n FROM episodic_memory').get();
    expect(episodes.n).toBe(0);
  });

  test('onSessionEnd triggers immediate harvest', async () => {
    seedSession('sess-end', 0);
    seedNote('sess-end', 'End of session note', 'handoff');

    const custodian = makeCustodian();
    await custodian.onSessionEnd('sess-end');

    const episodes = db.prepare('SELECT COUNT(*) as n FROM episodic_memory').get();
    expect(episodes.n).toBe(1);
  });
});

describe('Duty: resurrect', () => {
  test('publishes to operator:approvals when policy is "ask" (default)', async () => {
    const custodian = makeCustodian();
    // Scope is now a distinct authenticated argument; the capsule is context-only.
    await custodian.onAgentDead('dead-agent-1', 'port-daddy', { nextPlan: 'Continue auth work' });

    const approval = messages.find(m => m.channel === 'operator:approvals');
    expect(approval).toBeTruthy();
    expect(approval.payload.agentId).toBe('dead-agent-1');
    expect(approval.payload.type).toBe('resurrect_request');
  });

  test('skips publish when policy is "deny"', async () => {
    // Set a deny policy
    db.prepare(
      `INSERT INTO operator_permission_patterns
       (kind, project_prefix, policy, approval_count, denial_count, last_seen_at)
       VALUES ('resurrect', 'deny-project', 'deny', 0, 5, datetime('now'))`
    ).run();

    const custodian = makeCustodian();
    await custodian.onAgentDead('dead-agent-deny', 'deny-project');

    expect(messages.filter(m => m.channel === 'operator:approvals')).toHaveLength(0);
  });

  test('resolveResurrection records decision and sends inbox message on approved', async () => {
    const custodian = makeCustodian();
    await custodian.resolveResurrection('agent-resurrect', 'port-daddy', 'approved', { nextPlan: 'Continue' });

    // Should record the approval
    const patterns = operatorPermissions.list();
    expect(patterns.some(p => p.kind === 'resurrect' && p.approvalCount === 1)).toBe(true);

    // Should publish resurrection_context to agent inbox
    const inboxMsg = messages.find(m => m.channel === 'agent:agent-resurrect:inbox');
    expect(inboxMsg).toBeTruthy();
    expect(inboxMsg.payload.type).toBe('resurrection_context');
  });
});

describe('Duty: dedupWarn', () => {
  test('publishes dedup warning when similar past work found (score >= 0.5)', async () => {
    // Seed an episode with matching content
    episodicMemory.remember({
      episodeType: 'finding',
      title: 'Auth tokens rotation design',
      summary: 'Designed the token rotation system for auth service.',
      sourceType: 'note',
      sourceId: 'note-dedup-1',
    });

    const custodian = makeCustodian();
    await custodian.onSortieCreated('sortie-new', 'auth token rotation design', 'agent-new');

    const warning = messages.find(m => m.payload?.type === 'dedup_warning');
    expect(warning).toBeTruthy();
    expect(warning.payload.matches.length).toBeGreaterThan(0);
  });

  test('does not warn when no similar work found', async () => {
    const custodian = makeCustodian();
    await custodian.onSortieCreated('sortie-fresh', 'completely unique novel approach xyz999', 'agent-new');

    expect(messages.filter(m => m.payload?.type === 'dedup_warning')).toHaveLength(0);
  });

  test('does nothing when purpose is empty', async () => {
    const custodian = makeCustodian();
    await custodian.onSortieCreated('sortie-empty', '', 'agent-new');

    expect(messages).toHaveLength(0);
  });
});

describe('Duty: contextPressure', () => {
  test('sends critical message to critical agents', () => {
    const custodian = makeCustodian({
      contextTracker: {
        getSwarmContextSummary() {
          return [
            { agentId: 'agent-critical', pressureLevel: 'critical', usedPct: 0.75, effectiveMax: 120_000, tokensUsed: 90_000 },
            { agentId: 'agent-ok', pressureLevel: 'ok', usedPct: 0.3, effectiveMax: 120_000, tokensUsed: 36_000 },
          ];
        },
      },
    });

    custodian.runContextPressureDuty();

    const criticalMsg = messages.find(m => m.channel === 'agent:agent-critical:inbox');
    expect(criticalMsg).toBeTruthy();
    expect(criticalMsg.payload.pressureLevel).toBe('critical');
    expect(criticalMsg.payload.message).toContain('75%');

    // ok agent should not get a message
    expect(messages.find(m => m.channel === 'agent:agent-ok:inbox')).toBeUndefined();
  });

  test('sends advisory (not critical) to warn-level agents', () => {
    const custodian = makeCustodian({
      contextTracker: {
        getSwarmContextSummary() {
          return [
            { agentId: 'agent-warn', pressureLevel: 'warn', usedPct: 0.6, effectiveMax: 120_000, tokensUsed: 72_000 },
          ];
        },
      },
    });

    custodian.runContextPressureDuty();

    const advisoryMsg = messages.find(m => m.channel === 'agent:agent-warn:inbox');
    expect(advisoryMsg).toBeTruthy();
    expect(advisoryMsg.payload.type).toBe('context_advisory');
  });
});

describe('Duty: archiveTTL', () => {
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  let sweepAt;
  let cutoff;
  let completed;
  let errors;

  beforeEach(() => {
    // Use INTEGER affinity and allow legacy NULL without a daemon or key store.
    db.exec('ALTER TABLE sessions ADD COLUMN is_durable INTEGER DEFAULT 0');
    sweepAt = Date.now();
    cutoff = sweepAt - sevenDays;
    jest.spyOn(Date, 'now').mockReturnValue(sweepAt);
    completed = [];
    errors = [];
    logger = {
      info: (message, data) => completed.push({ message, data }),
      error: (message, data) => errors.push({ message, data }),
    };
  });

  afterEach(() => jest.restoreAllMocks());

  function oldSession(id, { updatedAt = cutoff - 1, durable = 0, status = 'active' } = {}) {
    db.prepare(`INSERT INTO sessions
      (id, agent_id, purpose, status, created_at, updated_at, is_durable, metadata, worktree_id)
      VALUES (?, 'archive-owner', 'retained purpose', ?, ?, ?, ?, ?, 'fixture-world')`)
      .run(id, status, cutoff - 10, updatedAt, durable, '{"identity":{"verified":true,"actorId":"fixture-actor"}}');
  }

  function oldNote(id, { at = cutoff - 1, content = 'Retained original evidence' } = {}) {
    return db.prepare('INSERT INTO session_notes (session_id, content, type, created_at) VALUES (?, ?, ?, ?)')
      .run(id, content, 'finding', at).lastInsertRowid;
  }

  function row(id) {
    return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  }

  async function settled() {
    // The public duty remains fire-and-forget. Drain actual harvest continuations.
    await new Promise(resolve => setImmediate(resolve));
  }

  function deferredHarvest(extraDeps = {}) {
    let release;
    const blocked = new Promise(resolve => { release = resolve; });
    const store = jest.fn(() => blocked);
    const custodian = makeCustodian({ blobs: { store }, ...extraDeps });
    return { custodian, store, release: () => release({ id: 'synthetic-archive-blob' }) };
  }

  test.each([0, null])('retires stale ephemeral storage %p once while preserving claims, notes and identity', async durable => {
    oldSession('eligible', { durable });
    oldNote('eligible');
    db.prepare('INSERT INTO session_files (session_id, file_path, claimed_at) VALUES (?, ?, ?)')
      .run('eligible', 'kept.ts', cutoff - 1);
    const before = row('eligible');
    const notes = db.prepare('SELECT * FROM session_notes').all();
    const claims = db.prepare('SELECT * FROM session_files').all();
    const custodian = makeCustodian();
    custodian.runArchiveTTLDuty();
    await settled();
    expect(row('eligible')).toEqual({ ...before, status: 'abandoned', phase: 'abandoned',
      completed_at: sweepAt, updated_at: sweepAt });
    expect(db.prepare('SELECT * FROM session_notes').all()).toEqual(notes);
    expect(db.prepare('SELECT * FROM session_files').all()).toEqual(claims);
    expect(db.prepare('SELECT COUNT(*) AS n FROM episodic_memory').get().n).toBe(1);
    expect(completed.map(entry => entry.data.orphanedSessions)).toEqual([1]);
    custodian.runArchiveTTLDuty();
    await settled();
    expect(completed.map(entry => entry.data.orphanedSessions)).toEqual([1]);
    expect(errors).toEqual([]);
  });

  test.each([1, -1, 2, 0.5, 'malformed', Buffer.from([0])])('preserves non-ephemeral durability %p without harvesting', async durable => {
    oldSession('protected', { durable });
    oldNote('protected', { content: 'x'.repeat(10_001) });
    const before = row('protected');
    const { custodian, store } = deferredHarvest();
    custodian.runArchiveTTLDuty();
    await settled();
    expect(store).not.toHaveBeenCalled();
    expect(row('protected')).toEqual(before);
    expect(db.prepare('SELECT COUNT(*) AS n FROM episodic_memory').get().n).toBe(0);
  });

  test('durable preservation does not depend on verified identity metadata', async () => {
    oldSession('unverified', { durable: 1 });
    db.prepare('UPDATE sessions SET metadata = NULL WHERE id = ?').run('unverified');
    makeCustodian().runArchiveTTLDuty();
    await settled();
    expect(row('unverified').status).toBe('active');
  });

  test.each(['completed', 'abandoned', 'ACTIVE'])('preserves non-active exact status %s', async status => {
    oldSession('terminal', { status });
    const before = row('terminal');
    makeCustodian().runArchiveTTLDuty();
    await settled();
    expect(row('terminal')).toEqual(before);
  });

  test.each(['cutoff', 'future', 'text', 'negative', 'fractional', 'unsafe', 'blob'])('refuses %s session timestamps', async kind => {
    const values = { cutoff, future: sweepAt + 1, text: 'not-a-timestamp', negative: -1,
      fractional: cutoff - 0.5, unsafe: Number.MAX_SAFE_INTEGER + 1, blob: Buffer.from([0]) };
    oldSession('timestamp', { updatedAt: values[kind] });
    const before = row('timestamp');
    makeCustodian().runArchiveTTLDuty();
    await settled();
    expect(row('timestamp')).toEqual(before);
  });

  test.each(['cutoff', 'recent', 'future', 'text', 'negative', 'fractional', 'unsafe', 'blob'])('preserves sessions with %s exact-session note timestamps', async kind => {
    const values = { cutoff, recent: sweepAt, future: sweepAt + sevenDays, text: 'invalid',
      negative: -1, fractional: cutoff - 0.5, unsafe: Number.MAX_SAFE_INTEGER + 1, blob: Buffer.from([0]) };
    oldSession('note-protected');
    oldNote('note-protected', { at: values[kind] });
    const before = row('note-protected');
    makeCustodian().runArchiveTTLDuty();
    await settled();
    expect(row('note-protected')).toEqual(before);
  });

  test('uses SQLite stored integer semantics for numeric input and isolates sibling notes', async () => {
    oldSession('numeric', { durable: '0', updatedAt: String(cutoff - 1) });
    oldSession('sibling');
    oldNote('sibling', { at: sweepAt + sevenDays });
    expect(db.prepare('SELECT typeof(is_durable) AS t FROM sessions WHERE id = ?').get('numeric').t).toBe('integer');
    makeCustodian().runArchiveTTLDuty();
    await settled();
    expect(row('numeric').status).toBe('abandoned');
    expect(row('sibling').status).toBe('active');
    expect(completed[0].data.orphanedSessions).toBe(1);
  });

  test.each(['complete', 'refresh', 'older-refresh', 'durable', 'recent-note', 'future-note', 'malformed-note'])('rechecks %s mutation while real blobs.store is awaited', async mutation => {
    oldSession('raced');
    oldNote('raced', { content: 'x'.repeat(10_001) });
    const notesBefore = db.prepare('SELECT * FROM session_notes').all();
    db.prepare('INSERT INTO session_files (session_id, file_path, claimed_at) VALUES (?, ?, ?)')
      .run('raced', 'retained.ts', cutoff - 1);
    const claims = db.prepare('SELECT * FROM session_files').all();
    const { custodian, store, release } = deferredHarvest();
    custodian.runArchiveTTLDuty();
    expect(store).toHaveBeenCalledTimes(1);
    expect(row('raced').status).toBe('active');
    if (mutation === 'complete') db.prepare("UPDATE sessions SET status = 'completed', completed_at = ? WHERE id = 'raced'").run(sweepAt);
    if (mutation === 'refresh') db.prepare("UPDATE sessions SET updated_at = ? WHERE id = 'raced'").run(sweepAt);
    if (mutation === 'older-refresh') db.prepare("UPDATE sessions SET updated_at = ? WHERE id = 'raced'").run(cutoff - 2);
    if (mutation === 'durable') db.prepare("UPDATE sessions SET is_durable = 1 WHERE id = 'raced'").run();
    if (mutation.endsWith('-note')) oldNote('raced', { at: mutation === 'recent-note' ? sweepAt : mutation === 'future-note' ? sweepAt + sevenDays : 'malformed' });
    const afterMutation = row('raced');
    release();
    await settled();
    expect(row('raced')).toEqual(afterMutation);
    expect(db.prepare('SELECT * FROM session_files').all()).toEqual(claims);
    expect(db.prepare('SELECT * FROM session_notes ORDER BY id').all().slice(0, notesBefore.length)).toEqual(notesBefore);
    expect(completed[0].data.orphanedSessions).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM episodic_memory').get().n).toBe(1);
    expect(errors).toEqual([]);
  });

  test('keeps the original cutoff when time advances during harvest', async () => {
    oldSession('slow');
    oldNote('slow', { content: 'x'.repeat(10_001) });
    const { custodian, release } = deferredHarvest();
    custodian.runArchiveTTLDuty();
    oldNote('slow', { at: cutoff });
    Date.now.mockReturnValue(sweepAt + 2 * sevenDays);
    release();
    await settled();
    expect(row('slow').status).toBe('active');
    expect(completed[0].data.orphanedSessions).toBe(0);
  });

  test('concurrent sweeps count one actual transition, never two selected rows', async () => {
    oldSession('overlap');
    oldNote('overlap', { content: 'x'.repeat(10_001) });
    const { custodian, store, release } = deferredHarvest();
    custodian.runArchiveTTLDuty();
    custodian.runArchiveTTLDuty();
    expect(store).toHaveBeenCalledTimes(2);
    release();
    await settled();
    expect(row('overlap').status).toBe('abandoned');
    expect(completed.map(entry => entry.data.orphanedSessions).sort()).toEqual([0, 1]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM session_notes').get().n).toBe(1);
  });

  test('failed harvest preserves the session; a later successful sweep may retire it', async () => {
    oldSession('retry');
    oldNote('retry', { content: 'x'.repeat(10_001) });
    const before = row('retry');
    const remember = jest.spyOn(episodicMemory, 'remember').mockImplementationOnce(() => { throw new Error('synthetic storage refusal'); });
    const { custodian, release } = deferredHarvest();
    custodian.runArchiveTTLDuty();
    release();
    await settled();
    expect(row('retry')).toEqual(before);
    expect(errors).toHaveLength(1);
    expect(completed[0].data.orphanedSessions).toBe(0);
    remember.mockRestore();
    custodian.runArchiveTTLDuty();
    await settled();
    expect(row('retry').status).toBe('abandoned');
    expect(completed.map(entry => entry.data.orphanedSessions)).toEqual([0, 1]);
  });

  test('blob rejection retains the existing inline-harvest fallback and original note', async () => {
    oldSession('inline');
    oldNote('inline', { content: 'x'.repeat(10_001) });
    const note = db.prepare('SELECT * FROM session_notes').get();
    const store = jest.fn(async () => { throw new Error('synthetic blob refusal'); });
    makeCustodian({ blobs: { store } }).runArchiveTTLDuty();
    await settled();
    expect(store).toHaveBeenCalledTimes(1);
    expect(row('inline').status).toBe('abandoned');
    expect(db.prepare('SELECT * FROM session_notes').get()).toEqual(note);
    expect(db.prepare('SELECT blob_id FROM episodic_memory').get().blob_id).toBeNull();
    expect(completed[0].data.orphanedSessions).toBe(1);
    expect(errors).toEqual([]);
  });

  test.each([NaN, Infinity, -1, 0, Number.MAX_SAFE_INTEGER + 1, 1.5])('refuses malformed sweep clock %p without session mutation', async now => {
    oldSession('bad-clock');
    const before = row('bad-clock');
    Date.now.mockReturnValue(now);
    makeCustodian().runArchiveTTLDuty();
    await settled();
    expect(row('bad-clock')).toEqual(before);
    expect(errors.map(entry => entry.message)).toEqual(['Custodian archiveTTL clock invalid']);
  });

  test('archives expired episodes', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    episodicMemory.remember({
      episodeType: 'note',
      title: 'Old note',
      summary: 'Expired.',
      sourceType: 'note',
      sourceId: 'note-ttl-1',
      expiresAt: past,
    });

    const custodian = makeCustodian();
    custodian.runArchiveTTLDuty();

    // Episode should still be in DB but archived
    const all = db.prepare('SELECT metadata FROM episodic_memory').get();
    const meta = JSON.parse(all.metadata || '{}');
    expect(meta.archived).toBe(1);
  });

  // Regression test: runArchiveTTLDuty previously called deps.resurrection
  // .getQueue()/.markDead(), neither of which exist on the real resurrection
  // module (lib/resurrection.ts only exposes .cleanup()). An `as any` cast at
  // the server.ts wiring site hid the mismatch from the type checker, and the
  // TypeError crashed the whole daemon the first time this duty ran with a
  // real `resurrection` dep wired in. No prior test exercised this branch —
  // every other test in this file omits `resurrection` from extraDeps, so
  // `if (deps.resurrection)` was always falsy and the bug shipped silently.
  test('purges stale resurrection queue entries via cleanup(), not a nonexistent getQueue/markDead pair', () => {
    let cleanupArg;
    const resurrection = {
      cleanup(olderThan) {
        cleanupArg = olderThan;
        return { cleaned: 3 };
      },
    };
    const custodian = makeCustodian({ resurrection });

    expect(() => custodian.runArchiveTTLDuty()).not.toThrow();
    expect(cleanupArg).toBe(30 * 24 * 60 * 60 * 1000);
  });

  test('archiveTTL duty is a no-op (never throws) when resurrection dep is absent', () => {
    const custodian = makeCustodian();
    expect(() => custodian.runArchiveTTLDuty()).not.toThrow();
  });
});

describe('getStatus()', () => {
  test('returns running=false before start()', () => {
    const custodian = makeCustodian();
    expect(custodian.getStatus().running).toBe(false);
  });

  test('returns running=true after start(), false after stop()', () => {
    const custodian = makeCustodian();
    custodian.start();
    expect(custodian.getStatus().running).toBe(true);
    custodian.stop();
    expect(custodian.getStatus().running).toBe(false);
  });

  test('tracks episodesHarvestedToday', async () => {
    seedSession('sess-track', -(40 * 60 * 1000));
    seedNote('sess-track', 'Some content', 'note');

    const custodian = makeCustodian();
    await custodian.runHarvestDuty();

    const status = custodian.getStatus();
    expect(status.episodesHarvestedToday).toBe(1);
  });
});
