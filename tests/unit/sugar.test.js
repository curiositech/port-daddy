/**
 * Sugar Module Tests — Compound commands for common workflows
 *
 * Tests for begin (register + session start), done (session end + unregister),
 * and whoami (current agent/session context).
 */

import { createTestDb, createMockLogger } from '../setup-unit.js';
import { createAgents } from '../../lib/agents.js';
import { createSessions } from '../../lib/sessions.js';
import { createActivityLog } from '../../lib/activity.js';
import { createSugar } from '../../lib/sugar.js';

function setup() {
  const db = createTestDb();
  const agents = createAgents(db);
  const sessions = createSessions(db);
  const activityLog = createActivityLog(db);
  sessions.setActivityLog(activityLog);
  const sugar = createSugar({ agents, sessions, activityLog });
  return { db, agents, sessions, activityLog, sugar };
}

// =============================================================================
// begin
// =============================================================================

describe('sugar.begin', () => {
  test('happy path — registers agent + starts session', () => {
    const { sugar, agents, sessions } = setup();

    const result = sugar.begin({
      purpose: 'Implement sugar commands',
      identity: 'port-daddy:cli:sugar',
    });

    expect(result.success).toBe(true);
    expect(result.agentId).toBeTruthy();
    expect(result.sessionId).toBeTruthy();
    expect(result.agentRegistered).toBe(true);
    expect(result.sessionStarted).toBe(true);
    expect(result.identity).toBe('port-daddy:cli:sugar');
    expect(result.purpose).toBe('Implement sugar commands');

    // Verify agent is registered
    const agentInfo = agents.get(result.agentId);
    expect(agentInfo.success).toBe(true);
    expect(agentInfo.agent.purpose).toBe('Implement sugar commands');

    // Verify session is active
    const sessionInfo = sessions.get(result.sessionId);
    expect(sessionInfo.success).toBe(true);
    expect(sessionInfo.session.status).toBe('active');
    expect(sessionInfo.session.agentId).toBe(result.agentId);
  });

  test('auto-generates agent ID when not provided', () => {
    const { sugar } = setup();

    const result = sugar.begin({ purpose: 'Test auto-ID' });

    expect(result.success).toBe(true);
    expect(result.agentId).toMatch(/^agent-[a-f0-9]{8}$/);
  });

  test('uses provided agent ID', () => {
    const { sugar } = setup();

    const result = sugar.begin({
      purpose: 'Test explicit ID',
      agentId: 'my-custom-agent',
    });

    expect(result.success).toBe(true);
    expect(result.agentId).toBe('my-custom-agent');
  });

  test('claims files during begin', () => {
    const { sugar } = setup();

    const result = sugar.begin({
      purpose: 'Working on sugar',
      files: ['lib/sugar.ts', 'routes/sugar.ts'],
    });

    expect(result.success).toBe(true);
    expect(result.fileClaims).toEqual(['lib/sugar.ts', 'routes/sugar.ts']);
  });

  test('reports file conflicts without blocking', () => {
    const { sugar, sessions } = setup();

    // First agent claims a file
    const first = sugar.begin({
      purpose: 'First agent',
      files: ['lib/sugar.ts'],
    });
    expect(first.success).toBe(true);

    // Second agent begins with same file — should succeed with conflicts
    const second = sugar.begin({
      purpose: 'Second agent',
      files: ['lib/sugar.ts'],
      force: true,
    });

    expect(second.success).toBe(true);
    expect(second.fileConflicts).toBeDefined();
    expect(second.fileConflicts.length).toBeGreaterThan(0);
    expect(second.fileConflicts[0].filePath).toBe('lib/sugar.ts');
  });

  test('rolls back agent registration on session start failure', () => {
    const db = createTestDb();
    const agents = createAgents(db);
    const activityLog = createActivityLog(db);

    // Create a mock sessions that fails on start
    const failSessions = {
      start: () => ({ success: false, error: 'deliberate test failure' }),
      end: () => ({ success: true }),
      list: () => ({ sessions: [], count: 0 }),
      get: () => ({ success: false }),
      getNotes: () => ({ notes: [], count: 0 }),
      setActivityLog: () => {},
    };

    const sugar = createSugar({ agents, sessions: failSessions, activityLog });

    const result = sugar.begin({
      purpose: 'Should fail and rollback',
      agentId: 'rollback-test',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Session start failed');

    // Agent should have been rolled back (unregistered)
    const agentInfo = agents.get('rollback-test');
    expect(agentInfo.success).toBe(false);
  });

  test('includes salvage hint when dead agents exist in project', () => {
    const { sugar, agents, db } = setup();

    // Register a "dead" agent in the same project
    agents.register('dead-agent-1', {
      identity: 'port-daddy:api:main',
      purpose: 'Old work',
    });
    // Backdate its heartbeat to make it dead
    db.prepare("UPDATE agents SET last_heartbeat = ? WHERE id = ?")
      .run(Date.now() - 300000, 'dead-agent-1');

    const result = sugar.begin({
      purpose: 'New work',
      identity: 'port-daddy:cli:new',
    });

    expect(result.success).toBe(true);
    expect(result.salvageHint).toBeTruthy();
  });

  test('requires purpose', () => {
    const { sugar } = setup();

    const result = sugar.begin({});
    expect(result.success).toBe(false);
    expect(result.error).toContain('purpose');
  });

  test('validates identity if provided', () => {
    const { sugar } = setup();

    const result = sugar.begin({
      purpose: 'Test',
      identity: 'invalid identity with spaces',
    });

    expect(result.success).toBe(false);
  });

  test('passes type option through to agent registration', () => {
    const { sugar, agents } = setup();

    const result = sugar.begin({
      purpose: 'MCP agent',
      agentId: 'mcp-test',
      type: 'mcp',
    });

    expect(result.success).toBe(true);
    const agentInfo = agents.get('mcp-test');
    expect(agentInfo.agent.type).toBe('mcp');
  });
});

// =============================================================================
// done
// =============================================================================

describe('sugar.done', () => {
  test('happy path — ends session + unregisters agent', () => {
    const { sugar, agents, sessions } = setup();

    // Begin first
    const begin = sugar.begin({
      purpose: 'Will be done soon',
      agentId: 'done-test',
    });
    expect(begin.success).toBe(true);

    // Done
    const result = sugar.done({
      agentId: 'done-test',
      sessionId: begin.sessionId,
    });

    expect(result.success).toBe(true);
    expect(result.agentId).toBe('done-test');
    expect(result.sessionId).toBe(begin.sessionId);
    expect(result.sessionStatus).toBe('completed');
    expect(result.agentUnregistered).toBe(true);

    // Agent should be gone
    const agentInfo = agents.get('done-test');
    expect(agentInfo.success).toBe(false);

    // Session should be completed
    const sessionInfo = sessions.get(begin.sessionId);
    expect(sessionInfo.session.status).toBe('completed');
  });

  test('adds final note when provided', () => {
    const { sugar, sessions } = setup();

    const begin = sugar.begin({
      purpose: 'Note test',
      agentId: 'note-test',
    });

    const result = sugar.done({
      agentId: 'note-test',
      sessionId: begin.sessionId,
      note: 'All tasks completed successfully',
    });

    expect(result.success).toBe(true);
    expect(result.finalNote).toBe(true);

    // Verify note exists
    const notes = sessions.getNotes(begin.sessionId);
    const handoffNotes = notes.notes.filter(n => n.type === 'handoff');
    expect(handoffNotes.length).toBe(1);
    expect(handoffNotes[0].content).toBe('All tasks completed successfully');
  });

  test('supports abandoned status', () => {
    const { sugar, sessions } = setup();

    const begin = sugar.begin({
      purpose: 'Will abandon',
      agentId: 'abandon-test',
    });

    const result = sugar.done({
      agentId: 'abandon-test',
      sessionId: begin.sessionId,
      status: 'abandoned',
    });

    expect(result.success).toBe(true);
    expect(result.sessionStatus).toBe('abandoned');

    const sessionInfo = sessions.get(begin.sessionId);
    expect(sessionInfo.session.status).toBe('abandoned');
  });

  test('finds active session by agentId when sessionId not provided', () => {
    const { sugar } = setup();

    const begin = sugar.begin({
      purpose: 'Find me by agent',
      agentId: 'find-test',
    });

    const result = sugar.done({ agentId: 'find-test' });

    expect(result.success).toBe(true);
    expect(result.sessionId).toBe(begin.sessionId);
  });

  test('returns error when no active session found', () => {
    const { sugar } = setup();

    const result = sugar.done({ agentId: 'nonexistent-agent' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('No active session');
  });

  test('returns note count', () => {
    const { sugar, sessions } = setup();

    const begin = sugar.begin({
      purpose: 'Counting notes',
      agentId: 'count-test',
    });

    // Add some notes
    sessions.addNote(begin.sessionId, 'Note 1');
    sessions.addNote(begin.sessionId, 'Note 2');

    const result = sugar.done({
      agentId: 'count-test',
      sessionId: begin.sessionId,
      note: 'Final note',
    });

    expect(result.success).toBe(true);
    expect(result.notesCount).toBe(3); // 2 manual + 1 handoff
  });
});

// =============================================================================
// whoami
// =============================================================================

describe('sugar.whoami', () => {
  test('returns active context for registered agent', () => {
    const { sugar } = setup();

    const begin = sugar.begin({
      purpose: 'I am here',
      agentId: 'who-test',
      identity: 'myproject:api:main',
    });

    const result = sugar.whoami({ agentId: 'who-test' });

    expect(result.success).toBe(true);
    expect(result.active).toBe(true);
    expect(result.agentId).toBe('who-test');
    expect(result.sessionId).toBe(begin.sessionId);
    expect(result.purpose).toBe('I am here');
    expect(result.identity).toBe('myproject:api:main');
  });

  test('returns inactive when no agent found', () => {
    const { sugar } = setup();

    const result = sugar.whoami({ agentId: 'ghost' });

    expect(result.success).toBe(true);
    expect(result.active).toBe(false);
    expect(result.hint).toBeTruthy();
  });

  test('returns file claims in context', () => {
    const { sugar } = setup();

    sugar.begin({
      purpose: 'With files',
      agentId: 'files-test',
      files: ['src/main.ts', 'src/utils.ts'],
    });

    const result = sugar.whoami({ agentId: 'files-test' });

    expect(result.success).toBe(true);
    expect(result.files).toEqual(expect.arrayContaining(['src/main.ts', 'src/utils.ts']));
  });

  test('returns note count', () => {
    const { sugar, sessions } = setup();

    const begin = sugar.begin({
      purpose: 'Notes count',
      agentId: 'notecount-test',
    });

    sessions.addNote(begin.sessionId, 'Note 1');
    sessions.addNote(begin.sessionId, 'Note 2');

    const result = sugar.whoami({ agentId: 'notecount-test' });

    expect(result.success).toBe(true);
    expect(result.noteCount).toBe(2);
  });

  test('returns duration for active session', () => {
    const { sugar } = setup();

    sugar.begin({
      purpose: 'Duration test',
      agentId: 'duration-test',
    });

    const result = sugar.whoami({ agentId: 'duration-test' });

    expect(result.success).toBe(true);
    expect(result.startedAt).toBeTruthy();
    expect(typeof result.duration).toBe('number');
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  test('returns phase for active session', () => {
    const { sugar, sessions } = setup();

    const begin = sugar.begin({
      purpose: 'Phase test',
      agentId: 'phase-test',
    });

    sessions.setPhase(begin.sessionId, 'testing');

    const result = sugar.whoami({ agentId: 'phase-test' });

    expect(result.success).toBe(true);
    expect(result.phase).toBe('testing');
  });
});

// =============================================================================
// Full lifecycle
// =============================================================================

describe('sugar lifecycle', () => {
  test('begin → work → done full cycle', () => {
    const { sugar, sessions } = setup();

    // 1. Begin
    const begin = sugar.begin({
      purpose: 'Full lifecycle test',
      agentId: 'lifecycle-test',
      identity: 'myapp:api:feature',
      files: ['lib/sugar.ts'],
    });
    expect(begin.success).toBe(true);

    // 2. Whoami
    const who = sugar.whoami({ agentId: 'lifecycle-test' });
    expect(who.active).toBe(true);
    expect(who.purpose).toBe('Full lifecycle test');

    // 3. Add notes during work
    sessions.addNote(begin.sessionId, 'Started implementation');
    sessions.addNote(begin.sessionId, 'Tests passing', { type: 'progress' });

    // 4. Done
    const done = sugar.done({
      agentId: 'lifecycle-test',
      note: 'All done!',
    });
    expect(done.success).toBe(true);
    expect(done.notesCount).toBe(3); // 2 manual + 1 handoff

    // 5. Whoami should show inactive
    const whoAfter = sugar.whoami({ agentId: 'lifecycle-test' });
    expect(whoAfter.active).toBe(false);
  });

  test('multiple agents can begin/done independently', () => {
    const { sugar } = setup();

    const a1 = sugar.begin({ purpose: 'Agent 1', agentId: 'a1' });
    const a2 = sugar.begin({ purpose: 'Agent 2', agentId: 'a2' });

    expect(a1.success).toBe(true);
    expect(a2.success).toBe(true);
    expect(a1.sessionId).not.toBe(a2.sessionId);

    // Done agent 1
    const d1 = sugar.done({ agentId: 'a1' });
    expect(d1.success).toBe(true);

    // Agent 2 still active
    const who2 = sugar.whoami({ agentId: 'a2' });
    expect(who2.active).toBe(true);

    // Done agent 2
    const d2 = sugar.done({ agentId: 'a2' });
    expect(d2.success).toBe(true);
  });
});
