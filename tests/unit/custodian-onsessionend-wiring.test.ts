/**
 * Unit Tests: custodian.onSessionEnd wiring (Item 6, PR #2596).
 *
 * server.ts's `agent:dead` handler captures a dying agent's active session ids via
 * `sessions.activeSessionIdsByAgent(agentId)` BEFORE the zombie protocol abandons them,
 * then loops `for (const sid of abandonedSessionIds) void custodian.onSessionEnd(sid)` —
 * an immediate harvest so session notes are promoted to episodic memory while they
 * remain queryable, instead of waiting up to a poll interval (or being lost entirely
 * once the zombie protocol abandons the session first).
 *
 * `onSessionEnd` itself was previously exercised in isolation (knowledge-custodian.test.js
 * has a single happy-path "triggers immediate harvest" case), but pd-qa flagged that no
 * test exercised the actual wiring: the real capture-then-loop call pattern used at the
 * server.ts call site, nor its edge cases (empty/invalid session ids, internal failure).
 * This file closes that gap, mirroring the dedicated-wiring-test convention established
 * by tests/unit/custodian-onagentdead-wiring.test.ts for the sibling `onAgentDead` wiring.
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createSessions } from '../../lib/sessions.js';
import { createEpisodicMemory } from '../../lib/episodic-memory.js';
import { KnowledgeCustodian } from '../../lib/knowledge-custodian.js';

let db: any;
let sessions: ReturnType<typeof createSessions>;
let episodicMemory: ReturnType<typeof createEpisodicMemory>;

function sessionIdOf(startResult: any): string {
  return startResult.session?.id ?? startResult.id;
}

function episodeCount(): number {
  return (db.prepare('SELECT COUNT(*) as n FROM episodic_memory').get() as { n: number }).n;
}

function makeCustodian(extraDeps: Record<string, unknown> = {}, logSink: Array<{ msg: string; meta?: Record<string, unknown> }> = []) {
  return new KnowledgeCustodian({
    db,
    logger: {
      info() {},
      error(msg: string, meta?: Record<string, unknown>) { logSink.push({ msg, meta }); },
    },
    episodicMemory: episodicMemory as any,
    ...extraDeps,
  } as any);
}

beforeEach(() => {
  db = createTestDb();
  // No episodicMemory wired into createSessions here — matches server.ts/production,
  // where session-note episode promotion happens exclusively through the custodian's
  // harvest path, not inline at addNote() time.
  sessions = createSessions(db);
  episodicMemory = createEpisodicMemory(db);
});

afterEach(() => { db.close(); });

describe('onSessionEnd — real server.ts agent:dead wiring pattern', () => {
  test('activeSessionIdsByAgent() capture -> per-id onSessionEnd() harvests real session notes', async () => {
    const started = sessions.start('debug the flaky test', { agentId: 'agent-dead-1' });
    expect(started.success).toBe(true);
    const sessionId = sessionIdOf(started);

    const noted = sessions.addNote(sessionId, 'Finding: root cause is a race in the poller', { type: 'finding' });
    expect(noted.success).toBe(true);

    // Exact wiring pattern from server.ts's agent:dead handler: read active session ids
    // BEFORE abandon so they are still harvestable.
    const abandonedSessionIds = sessions.activeSessionIdsByAgent('agent-dead-1');
    expect(abandonedSessionIds).toEqual([sessionId]);

    const custodian = makeCustodian();
    for (const sid of abandonedSessionIds) await custodian.onSessionEnd(sid);

    expect(episodeCount()).toBe(1);
    const episode = db.prepare('SELECT source_type, source_id FROM episodic_memory').get() as any;
    expect(episode.source_type).toBe('note');
  });

  test('harvests every session an agent had active, not just the first (matches the real for..of loop)', async () => {
    const s1 = sessions.start('task one', { agentId: 'agent-dead-multi' });
    const s2 = sessions.start('task two', { agentId: 'agent-dead-multi' });
    const id1 = sessionIdOf(s1);
    const id2 = sessionIdOf(s2);
    expect(sessions.addNote(id1, 'note in session one', { type: 'finding' }).success).toBe(true);
    expect(sessions.addNote(id2, 'note in session two', { type: 'finding' }).success).toBe(true);

    const abandonedSessionIds = sessions.activeSessionIdsByAgent('agent-dead-multi');
    expect([...abandonedSessionIds].sort()).toEqual([id1, id2].sort());

    const custodian = makeCustodian();
    for (const sid of abandonedSessionIds) await custodian.onSessionEnd(sid);

    expect(episodeCount()).toBe(2);
  });

  test('an agent with no active sessions produces an empty capture and harvests nothing', async () => {
    const abandonedSessionIds = sessions.activeSessionIdsByAgent('agent-never-had-a-session');
    expect(abandonedSessionIds).toEqual([]);

    const custodian = makeCustodian();
    for (const sid of abandonedSessionIds) await custodian.onSessionEnd(sid);

    expect(episodeCount()).toBe(0);
  });
});

describe('onSessionEnd — edge cases (per pd-qa finding)', () => {
  test('empty-string session id harvests nothing and never throws', async () => {
    const custodian = makeCustodian();
    await expect(custodian.onSessionEnd('')).resolves.toBeUndefined();
    expect(episodeCount()).toBe(0);
  });

  test('unknown/invalid session id harvests nothing and never throws', async () => {
    const custodian = makeCustodian();
    await expect(custodian.onSessionEnd('session-does-not-exist')).resolves.toBeUndefined();
    expect(episodeCount()).toBe(0);
  });

  test('a session with zero notes harvests nothing and never throws', async () => {
    const started = sessions.start('quiet session, no notes ever added', { agentId: 'agent-quiet' });
    const sessionId = sessionIdOf(started);

    const custodian = makeCustodian();
    await expect(custodian.onSessionEnd(sessionId)).resolves.toBeUndefined();
    expect(episodeCount()).toBe(0);
  });

  test('a harvest failure is caught and logged, never thrown to the fire-and-forget caller', async () => {
    const started = sessions.start('will explode during harvest', { agentId: 'agent-dead-boom' });
    const sessionId = sessionIdOf(started);
    expect(sessions.addNote(sessionId, 'this note will fail to promote', { type: 'finding' }).success).toBe(true);

    const logSink: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
    const explodingEpisodicMemory = {
      archiveExpired() { return 0; },
      remember() { throw new Error('boom: episodic store unavailable'); },
    };
    const custodian = makeCustodian({ episodicMemory: explodingEpisodicMemory }, logSink);

    // server.ts calls this fire-and-forget (`void custodian.onSessionEnd(sid)`) — nothing
    // awaits or catches it there, so a rejection here would surface as an unhandled
    // promise rejection and could crash the daemon. onSessionEnd's own try/catch must
    // absorb it instead.
    await expect(custodian.onSessionEnd(sessionId)).resolves.toBeUndefined();
    expect(
      logSink.some(l => l.msg === 'Custodian onSessionEnd harvest failed' && l.meta?.sessionId === sessionId),
    ).toBe(true);
  });

  test('idempotent: calling onSessionEnd twice for the same session does not double-harvest', async () => {
    const started = sessions.start('idempotency check', { agentId: 'agent-dead-idem' });
    const sessionId = sessionIdOf(started);
    expect(sessions.addNote(sessionId, 'only promote me once', { type: 'finding' }).success).toBe(true);

    const custodian = makeCustodian();
    await custodian.onSessionEnd(sessionId);
    await custodian.onSessionEnd(sessionId);

    expect(episodeCount()).toBe(1);
  });
});
