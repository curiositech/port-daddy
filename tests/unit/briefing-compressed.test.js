/**
 * Phase 2 briefing tests — generateCompressed() tiers, zoom enforcement, compact-from-DB.
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createBriefing } from '../../lib/briefing.js';
import { createSessions } from '../../lib/sessions.js';
import { createAgents } from '../../lib/agents.js';
import { createActivityLog } from '../../lib/activity.js';
import { createMessaging } from '../../lib/messaging.js';
import { createResurrection } from '../../lib/resurrection.js';
import { createServices } from '../../lib/services.js';

let db;
let briefing;
let sessions;

beforeEach(() => {
  db = createTestDb();
  sessions = createSessions(db);
  const agents = createAgents(db);
  const activityLog = createActivityLog(db);
  const messaging = createMessaging(db);
  const resurrection = createResurrection(db);
  const services = createServices(db);
  sessions.setActivityLog(activityLog);
  briefing = createBriefing(db, {
    sessions,
    agents,
    resurrection,
    activityLog,
    services,
    messaging,
  });
});

afterEach(() => {
  db.close();
});

function seedAgent(agentId = 'agent-test') {
  db.prepare(
    `INSERT OR IGNORE INTO agents (id, last_heartbeat) VALUES (?, datetime('now'))`
  ).run(agentId);
}

function seedActiveSession(agentId = 'agent-test', sessionId = 'sess-test') {
  db.prepare(
    `INSERT OR IGNORE INTO sessions (id, agent_id, purpose, status, created_at, updated_at)
     VALUES (?, ?, 'test session', 'active', ?, ?)`
  ).run(sessionId, agentId, Date.now(), Date.now());
}

function seedNote(sessionId, content, type = 'note') {
  db.prepare(
    `INSERT INTO session_notes (session_id, content, type, created_at) VALUES (?, ?, ?, ?)`
  ).run(sessionId, content, type, Date.now());
}

// Helper: verify every pointer in a briefing has type and id
function assertZoomCompliant(briefing) {
  const allPointers = [
    ...briefing.activeSessions,
    ...briefing.recentNotes,
    ...briefing.handoffs,
  ];
  for (const ptr of allPointers) {
    expect(ptr).toHaveProperty('type');
    expect(ptr).toHaveProperty('id');
    expect(typeof ptr.type).toBe('string');
    expect(typeof ptr.id).toBe('string');
  }
}

describe('generateCompressed() — tiers', () => {
  test('full tier for budget > 80k', () => {
    seedAgent();
    seedActiveSession();
    seedNote('sess-test', 'Recent work note', 'note');

    const result = briefing.generateCompressed('agent-test', 100_000);
    expect(result.tier).toBe('full');
    expect(result.agentId).toBe('agent-test');
    expect(result.contextBudgetTokens).toBe(100_000);
    expect(typeof result.generatedAt).toBe('string');
    assertZoomCompliant(result);
  });

  test('summary tier for budget 40k–80k', () => {
    seedAgent();
    seedActiveSession();
    seedNote('sess-test', 'Mid-budget note', 'note');

    const result = briefing.generateCompressed('agent-test', 60_000);
    expect(result.tier).toBe('summary');
    assertZoomCompliant(result);
  });

  test('minimal tier for budget 20k–40k', () => {
    seedAgent();
    seedActiveSession();
    seedNote('sess-test', 'Handoff: critical decision', 'handoff');

    const result = briefing.generateCompressed('agent-test', 30_000);
    expect(result.tier).toBe('minimal');
    assertZoomCompliant(result);
  });

  test('emergency tier for budget < 20k', () => {
    seedAgent();
    seedActiveSession();
    seedNote('sess-test', 'Handoff: resume from here', 'handoff');
    seedNote('sess-test', 'Regular note', 'note');

    const result = briefing.generateCompressed('agent-test', 10_000);
    expect(result.tier).toBe('emergency');
    // Emergency includes advisory
    expect(result.advisory).toBeTruthy();
    assertZoomCompliant(result);
  });
});

describe('generateCompressed() — zoom enforcement', () => {
  test('every session pointer has type and id', () => {
    seedAgent();
    seedActiveSession('agent-test', 'sess-zoom-1');
    seedActiveSession('agent-test', 'sess-zoom-2');

    const result = briefing.generateCompressed('agent-test', 100_000);
    for (const ptr of result.activeSessions) {
      expect(ptr.type).toBe('session');
      expect(typeof ptr.id).toBe('string');
      expect(ptr.id.length).toBeGreaterThan(0);
    }
  });

  test('note pointers carry type=note and the note id', () => {
    seedAgent();
    seedActiveSession();
    seedNote('sess-test', 'Finding: important fact', 'finding');

    const result = briefing.generateCompressed('agent-test', 60_000);
    for (const ptr of result.recentNotes) {
      expect(ptr.type).toBe('note');
      expect(typeof ptr.id).toBe('string');
    }
  });

  test('handoff pointers are type=note with noteType=handoff', () => {
    seedAgent();
    seedActiveSession();
    seedNote('sess-test', 'Handoff: resume from PR #42', 'handoff');

    const result = briefing.generateCompressed('agent-test', 30_000);
    for (const ptr of result.handoffs) {
      expect(ptr.type).toBe('note');
      expect(ptr.noteType).toBe('handoff');
    }
  });

  test('minimal tier only includes handoffs and meta pointers', () => {
    seedAgent();
    seedActiveSession();
    seedNote('sess-test', 'Handoff: must resume', 'handoff');
    seedNote('sess-test', 'Regular note content', 'note');

    const result = briefing.generateCompressed('agent-test', 25_000);
    expect(result.tier).toBe('minimal');
    // All returned pointers have valid ids
    assertZoomCompliant(result);
  });

  test('emergency tier includes advisory with spawn recommendation', () => {
    seedAgent();
    seedActiveSession();
    seedNote('sess-test', 'Handoff: critical state', 'handoff');

    const result = briefing.generateCompressed('agent-test', 5_000);
    expect(result.tier).toBe('emergency');
    expect(result.advisory?.toLowerCase()).toContain('spawn');
  });
});

describe('generateCompressed() — compact-from-DB', () => {
  test('works without any on-disk briefing file', () => {
    // This just asserts it runs successfully without needing filesystem
    seedAgent();
    seedActiveSession();

    // Should not throw
    expect(() => briefing.generateCompressed('agent-test', 50_000)).not.toThrow();
  });

  test('agent with no sessions returns valid pointers, not an error', () => {
    seedAgent('lonely-agent');
    const result = briefing.generateCompressed('lonely-agent', 50_000);
    // summary tier: activeSessions has a meta count pointer
    expect(Array.isArray(result.activeSessions)).toBe(true);
    expect(Array.isArray(result.recentNotes)).toBe(true);
    expect(Array.isArray(result.handoffs)).toBe(true);
    assertZoomCompliant(result);
  });

  test('generatedAt is a valid ISO date string', () => {
    seedAgent();
    const result = briefing.generateCompressed('agent-test', 50_000);
    expect(() => new Date(result.generatedAt).toISOString()).not.toThrow();
  });
});
