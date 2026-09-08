/**
 * Unit Tests for lib/correlation.ts
 *
 * Tests the correlation engine that merges activity log entries
 * and session notes into a unified timeline.
 */

import { describe, test, expect, beforeEach } from '@jest/globals';
import { createCorrelationEngine } from '../../lib/correlation.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMockActivityLog(entries = []) {
  return {
    getRecent({ limit, agentId } = {}) {
      let result = [...entries];
      if (agentId) result = result.filter(e => e.agentId === agentId);
      if (limit) result = result.slice(0, limit);
      return { entries: result };
    }
  };
}

function makeMockSessions(notes = []) {
  return {
    getNotes(sessionId, { limit, agentId } = {}) {
      let result = [...notes];
      if (sessionId) result = result.filter(n => n.sessionId === sessionId);
      if (agentId) result = result.filter(n => n.agentId === agentId);
      if (limit) result = result.slice(0, limit);
      return { success: true, notes: result };
    }
  };
}

function makeActivityEntry(overrides = {}) {
  return {
    id: 1,
    timestamp: Date.now() - 1000,
    type: 'port.claim',
    agentId: 'agent-1',
    targetId: 'myapp:api',
    details: 'Claimed port 3000',
    metadata: null,
    ...overrides,
  };
}

function makeNote(overrides = {}) {
  return {
    id: 1,
    sessionId: 'session-abc',
    content: 'Fixed the login bug',
    type: 'note',
    createdAt: Date.now() - 2000,
    sessionPurpose: 'Fixing auth',
    ...overrides,
  };
}

// ─── createCorrelationEngine ─────────────────────────────────────────────────

describe('createCorrelationEngine', () => {
  test('returns an object with getTimeline method', () => {
    const engine = createCorrelationEngine(
      makeMockActivityLog(),
      makeMockSessions()
    );
    expect(typeof engine.getTimeline).toBe('function');
  });
});

// ─── getTimeline ─────────────────────────────────────────────────────────────

describe('getTimeline', () => {
  test('returns empty array when both sources are empty', async () => {
    const engine = createCorrelationEngine(
      makeMockActivityLog([]),
      makeMockSessions([])
    );
    const timeline = await engine.getTimeline();
    expect(Array.isArray(timeline)).toBe(true);
    expect(timeline).toHaveLength(0);
  });

  test('returns activity entries as TimelineEntry objects', async () => {
    const entry = makeActivityEntry({ id: 42, timestamp: 1000 });
    const engine = createCorrelationEngine(
      makeMockActivityLog([entry]),
      makeMockSessions([])
    );
    const timeline = await engine.getTimeline();

    expect(timeline).toHaveLength(1);
    expect(timeline[0].id).toBe('act-42');
    expect(timeline[0].source).toBe('activity');
    expect(timeline[0].type).toBe('port.claim');
    expect(timeline[0].timestamp).toBe(1000);
    expect(timeline[0].agentId).toBe('agent-1');
    expect(timeline[0].targetId).toBe('myapp:api');
  });

  test('activity entry content uses details field', async () => {
    const entry = makeActivityEntry({ details: 'Port 3000 claimed' });
    const engine = createCorrelationEngine(
      makeMockActivityLog([entry]),
      makeMockSessions([])
    );
    const timeline = await engine.getTimeline();
    expect(timeline[0].content).toBe('Port 3000 claimed');
  });

  test('activity entry content falls back to type when no details', async () => {
    const entry = makeActivityEntry({ details: undefined, type: 'port.release' });
    const engine = createCorrelationEngine(
      makeMockActivityLog([entry]),
      makeMockSessions([])
    );
    const timeline = await engine.getTimeline();
    expect(timeline[0].content).toBe('port.release');
  });

  test('returns session notes as TimelineEntry objects', async () => {
    const note = makeNote({ id: 7, sessionId: 'sess-1', createdAt: 5000 });
    const engine = createCorrelationEngine(
      makeMockActivityLog([]),
      makeMockSessions([note])
    );
    const timeline = await engine.getTimeline();

    expect(timeline).toHaveLength(1);
    expect(timeline[0].id).toBe('note-7');
    expect(timeline[0].source).toBe('note');
    expect(timeline[0].timestamp).toBe(5000);
    expect(timeline[0].targetId).toBe('sess-1');
    expect(timeline[0].content).toBe('Fixed the login bug');
  });

  test('note metadata contains sessionId and sessionPurpose', async () => {
    const note = makeNote({ sessionId: 'sess-2', sessionPurpose: 'Build auth' });
    const engine = createCorrelationEngine(
      makeMockActivityLog([]),
      makeMockSessions([note])
    );
    const timeline = await engine.getTimeline();
    expect(timeline[0].metadata.sessionId).toBe('sess-2');
    expect(timeline[0].metadata.sessionPurpose).toBe('Build auth');
  });

  test('merges and sorts activity and notes by timestamp (newest first)', async () => {
    const now = Date.now();
    const old = makeActivityEntry({ id: 1, timestamp: now - 5000 });
    const mid = makeNote({ id: 2, createdAt: now - 2000 });
    const recent = makeActivityEntry({ id: 3, timestamp: now - 500 });

    const engine = createCorrelationEngine(
      makeMockActivityLog([old, recent]),
      makeMockSessions([mid])
    );
    const timeline = await engine.getTimeline();

    expect(timeline).toHaveLength(3);
    // Sorted newest first
    expect(timeline[0].timestamp).toBeGreaterThan(timeline[1].timestamp);
    expect(timeline[1].timestamp).toBeGreaterThan(timeline[2].timestamp);
  });

  test('respects limit option', async () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      makeActivityEntry({ id: i + 1, timestamp: i * 1000 })
    );
    const engine = createCorrelationEngine(
      makeMockActivityLog(entries),
      makeMockSessions([])
    );
    const timeline = await engine.getTimeline({ limit: 3 });
    expect(timeline).toHaveLength(3);
  });

  test('limit applies to merged result', async () => {
    const now = Date.now();
    const activities = [
      makeActivityEntry({ id: 1, timestamp: now - 100 }),
      makeActivityEntry({ id: 2, timestamp: now - 200 }),
    ];
    const notes = [
      makeNote({ id: 3, createdAt: now - 50 }),
      makeNote({ id: 4, createdAt: now - 300 }),
    ];
    const engine = createCorrelationEngine(
      makeMockActivityLog(activities),
      makeMockSessions(notes)
    );
    const timeline = await engine.getTimeline({ limit: 2 });
    expect(timeline).toHaveLength(2);
    // Should be the 2 newest entries
    expect(timeline[0].timestamp).toBeGreaterThanOrEqual(timeline[1].timestamp);
  });

  test('default limit is 100', async () => {
    const entries = Array.from({ length: 150 }, (_, i) =>
      makeActivityEntry({ id: i + 1, timestamp: i })
    );
    const engine = createCorrelationEngine(
      makeMockActivityLog(entries),
      makeMockSessions([])
    );
    const timeline = await engine.getTimeline();
    expect(timeline.length).toBeLessThanOrEqual(100);
  });

  test('agentId option is passed to both sources', async () => {
    let activityAgentId;
    let notesAgentId;

    const mockActivity = {
      getRecent({ agentId }) {
        activityAgentId = agentId;
        return { entries: [] };
      }
    };
    const mockSessions = {
      getNotes(sid, { agentId }) {
        notesAgentId = agentId;
        return { success: true, notes: [] };
      }
    };

    const engine = createCorrelationEngine(mockActivity, mockSessions);
    await engine.getTimeline({ agentId: 'agent-x' });

    expect(activityAgentId).toBe('agent-x');
    expect(notesAgentId).toBe('agent-x');
  });

  test('sessionId option is passed to getNotes', async () => {
    let receivedSessionId;
    const mockActivity = { getRecent: () => ({ entries: [] }) };
    const mockSessions = {
      getNotes(sessionId) {
        receivedSessionId = sessionId;
        return { success: true, notes: [] };
      }
    };

    const engine = createCorrelationEngine(mockActivity, mockSessions);
    await engine.getTimeline({ sessionId: 'sess-123' });
    expect(receivedSessionId).toBe('sess-123');
  });

  test('rejects missing activity entries rather than silently dropping that source', async () => {
    const engine = createCorrelationEngine(
      { getRecent: () => ({}) },          // no `entries` key
      { getNotes: () => ({ notes: [] }) }
    );
    await expect(engine.getTimeline()).rejects.toMatchObject({ code: 'TIMELINE_SOURCE_UNAVAILABLE' });
  });

  test('rejects missing notes rather than silently dropping that source', async () => {
    const engine = createCorrelationEngine(
      { getRecent: () => ({ entries: [] }) },
      { getNotes: () => ({}) }            // no `notes` key
    );
    await expect(engine.getTimeline()).rejects.toMatchObject({ code: 'TIMELINE_SOURCE_UNAVAILABLE' });
  });
});
