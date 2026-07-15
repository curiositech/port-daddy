/**
 * Unit Tests: Knowledge Custodian (Phase 3)
 *
 * Tests each duty in isolation with mock deps.
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
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
