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
import { createFeedback } from '../../lib/feedback.js';
import { createCommitments } from '../../lib/commitments.js';
import { createTupleSpace } from '../../lib/tuples.js';

/**
 * Default-pass git-origin stub for unit tests.
 *
 * The real pd done now enforces "branch must be on origin" before
 * marking a session completed. The e-existing test corpus does not
 * care about that — it was written before the rule existed and runs in
 * an in-memory SQLite scratch environment that isn't a git worktree.
 *
 * Tests that DO want to exercise the gate (see "pd done origin rule"
 * describe block below) construct their own checker stub via setup({
 * gitOriginChecker: ... }).
 */
function passingChecker() {
  return {
    checkBranchOnOrigin: () => ({ ok: true, branch: 'feat/test', upstream: 'origin/feat/test', ahead: 0 }),
    checkLedgerOnly: () => ({ ok: true, dirtyEntries: 0, unpublishedCommits: 0 }),
  };
}

function setup(overrides = {}) {
  const db = createTestDb();
  const agents = createAgents(db);
  const sessions = createSessions(db);
  const activityLog = createActivityLog(db);
  sessions.setActivityLog(activityLog);
  const tuples = createTupleSpace(db);
  const feedback = createFeedback({ tuples });
  const commitments = createCommitments(db);
  const sugar = createSugar({
    agents,
    sessions,
    activityLog,
    gitOriginChecker: overrides.gitOriginChecker || passingChecker(),
    feedback,
    commitments,
  });
  return { db, agents, sessions, activityLog, tuples, feedback, commitments, sugar };
}

/**
 * A complete result note that satisfies the new pd-done sentinel
 * precondition (PR URL). Existing tests append this where they pass
 * a final note so they don't trip the "missing sentinel" refusal.
 */
const VALID_RESULT_NOTE_WITH_PR = 'Result: shipped. PR opened: https://github.com/curiositech/port-daddy/pull/999';

// =============================================================================
// begin
// =============================================================================

describe('sugar.begin', () => {
  test('happy path — registers agent + starts session', () => {
    const { sugar, agents, sessions } = setup();

    const result = sugar.begin({ lifecycle: 'ephemeral',
      purpose: 'Implement sugar commands',
      identity: 'port-daddy:cli:sugar',
    });

    expect(result.success).toBe(true);
    expect(result.agentId).toBeTruthy();
    expect(result.sessionId).toBeTruthy();
    expect(result.agentId).toMatch(/^agent-implement-sugar-commands-[a-f0-9]{8}$/);
    expect(result.sessionId).toMatch(/^session-implement-sugar-commands-[a-f0-9]{12}$/);
    expect(result.agentName).toBe('Implement sugar commands');
    expect(result.sessionName).toBe('Implement sugar commands');
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
    expect(sessionInfo.session.identityProject).toBe('port-daddy');
  });

  test('auto-generates agent ID when not provided', () => {
    const { sugar } = setup();

    const result = sugar.begin({ lifecycle: 'ephemeral', purpose: 'Test auto-ID' });

    expect(result.success).toBe(true);
    expect(result.agentId).toMatch(/^agent-test-auto-id-[a-f0-9]{8}$/);
    expect(result.agentName).toBe('Test auto-ID');
    expect(result.sessionId).toMatch(/^session-test-auto-id-[a-f0-9]{12}$/);
    expect(result.sessionName).toBe('Test auto-ID');
  });

  test('stores a readable agent name while keeping the technical ID', () => {
    const { sugar, agents } = setup();

    const result = sugar.begin({ lifecycle: 'ephemeral',
      purpose: 'Fix checkout auth regression',
      identity: 'shop:api:auth',
      name: 'Auth Repair Lead',
    });

    expect(result.success).toBe(true);
    expect(result.agentId).toMatch(/^agent-auth-repair-lead-[a-f0-9]{8}$/);
    expect(result.agentName).toBe('Auth Repair Lead');
    expect(result.sessionName).toBe('Auth Repair Lead');

    const agentInfo = agents.get(result.agentId);
    expect(agentInfo.agent.name).toBe('Auth Repair Lead');
    expect(agentInfo.agent.purpose).toBe('Fix checkout auth regression');
  });

  test('uses provided agent ID', () => {
    const { sugar } = setup();

    const result = sugar.begin({ lifecycle: 'ephemeral',
      purpose: 'Test explicit ID',
      agentId: 'my-custom-agent',
    });

    expect(result.success).toBe(true);
    expect(result.agentId).toBe('my-custom-agent');
  });

  test('claims files during begin', () => {
    const { sugar } = setup();

    const result = sugar.begin({ lifecycle: 'ephemeral',
      purpose: 'Working on sugar',
      files: ['lib/sugar.ts', 'routes/sugar.ts'],
    });

    expect(result.success).toBe(true);
    expect(result.fileClaims).toEqual(['lib/sugar.ts', 'routes/sugar.ts']);
  });

  test('rejects required worktree sessions without worktree context', () => {
    const { sugar } = setup();

    const result = sugar.begin({ lifecycle: 'ephemeral',
      purpose: 'Main checkout work',
      requireLinkedWorktree: true,
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('WORKTREE_REQUIRED');
    expect(result.hint).toContain('git worktree add');
  });

  test('rejects main-worktree sessions unless explicitly allowed', () => {
    const { sugar } = setup();

    const result = sugar.begin({ lifecycle: 'ephemeral',
      purpose: 'Main checkout work',
      requireLinkedWorktree: true,
      worktree: {
        id: 'main1234',
        root: '/repo/port-daddy',
        name: 'port-daddy',
        branch: 'main',
        isMain: true,
      },
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('MAIN_WORKTREE_SESSION_FORBIDDEN');
  });

  test('refuses main-worktree session when another agent is already there even with --allow-main-worktree', () => {
    const { sugar } = setup();
    const worktree = {
      id: 'main1234',
      root: '/repo/port-daddy',
      name: 'port-daddy',
      branch: 'main',
      isMain: true,
    };

    // First solo session on main with explicit allow — fine (no one else here).
    const first = sugar.begin({ lifecycle: 'ephemeral',
      purpose: 'Solo on main',
      requireLinkedWorktree: true,
      allowMainWorktree: true,
      worktree,
    });
    expect(first.success).toBe(true);

    // Second agent arrives. --allow-main-worktree no longer saves them.
    const second = sugar.begin({ lifecycle: 'ephemeral',
      purpose: 'Second agent piling onto main',
      requireLinkedWorktree: true,
      allowMainWorktree: true,
      worktree,
    });
    expect(second.success).toBe(false);
    expect(second.code).toBe('MAIN_WORKTREE_CROWDED');
    expect(second.error).toMatch(/other active session/);
    expect(second.hint).toContain('git worktree add');
    // The refusal must not advertise the bypass flag to the blocked agent.
    expect(second.hint).not.toMatch(/allow-main-worktree/i);
    expect(second.error).not.toMatch(/allow-main-worktree/i);
  });

  test('bypassCrowdedGate=true skips the crowded check (env-sourced allow)', () => {
    const { sugar } = setup();
    const worktree = {
      id: 'main1234',
      root: '/repo/port-daddy',
      name: 'port-daddy',
      branch: 'main',
      isMain: true,
    };

    const first = sugar.begin({ lifecycle: 'ephemeral',
      purpose: 'CI session 1',
      requireLinkedWorktree: true,
      allowMainWorktree: true,
      bypassCrowdedGate: true,
      worktree,
    });
    expect(first.success).toBe(true);

    // Second CI/single-user session would normally be refused, but the
    // bypass flag (env-sourced allow) skips the gate so existing CI
    // suites keep working.
    const second = sugar.begin({ lifecycle: 'ephemeral',
      purpose: 'CI session 2',
      requireLinkedWorktree: true,
      allowMainWorktree: true,
      bypassCrowdedGate: true,
      worktree,
    });
    expect(second.success).toBe(true);
  });

  test('main-worktree gate releases once the first session ends', () => {
    const { sugar } = setup();
    const worktree = {
      id: 'main1234',
      root: '/repo/port-daddy',
      name: 'port-daddy',
      branch: 'main',
      isMain: true,
    };

    const first = sugar.begin({ lifecycle: 'ephemeral',
      purpose: 'Solo on main',
      requireLinkedWorktree: true,
      allowMainWorktree: true,
      worktree,
    });
    expect(first.success).toBe(true);

    // PR #160 added a hard precondition for completed sessions: the result
    // note must carry the Result/PR sentinel (and the branch must be on
    // origin — satisfied here by setup()'s passing gitOriginChecker mock).
    // This test exercises the main-worktree gate lifecycle, not the PR-URL
    // contract, so we just supply a conformant note to clear the gate.
    const ended = sugar.done({ sessionId: first.sessionId, note: VALID_RESULT_NOTE_WITH_PR });
    expect(ended.success).toBe(true);

    // After the first session ends a second solo agent should be able
    // to take over the main worktree. Without this guarantee the gate
    // would degrade into "main is permanently poisoned by any past
    // session", breaking the solo-developer path.
    const second = sugar.begin({ lifecycle: 'ephemeral',
      purpose: 'New solo agent after handoff',
      requireLinkedWorktree: true,
      allowMainWorktree: true,
      worktree,
    });
    expect(second.success).toBe(true);
  });

  test('stores linked worktree context on agent, session, and metadata', () => {
    const { sugar, agents, sessions } = setup();
    const worktree = {
      id: 'wt123456',
      root: '/tmp/port-daddy-feature',
      name: 'port-daddy-feature',
      branch: 'codex/worktree-policy',
      isMain: false,
    };

    const result = sugar.begin({ lifecycle: 'ephemeral',
      purpose: 'Linked worktree work',
      identity: 'port-daddy:runtime:worktrees',
      metadata: { source: 'unit-test' },
      requireLinkedWorktree: true,
      worktree,
    });

    expect(result.success).toBe(true);
    expect(result.worktree).toEqual(worktree);

    const agentInfo = agents.get(result.agentId);
    expect(agentInfo.agent.worktreeId).toBe(worktree.id);
    expect(agentInfo.agent.metadata.worktree).toEqual(worktree);
    expect(agentInfo.agent.metadata.sessionWorktreePolicy).toEqual({
      requireLinkedWorktree: true,
      allowMainWorktree: false,
    });

    const sessionInfo = sessions.get(result.sessionId);
    expect(sessionInfo.session.worktreeId).toBe(worktree.id);
    expect(sessionInfo.session.metadata.worktree).toEqual(worktree);
    expect(sessionInfo.session.metadata.sessionWorktreePolicy).toEqual({
      requireLinkedWorktree: true,
      allowMainWorktree: false,
    });
  });

  test('reports file conflicts without blocking', () => {
    const { sugar, sessions } = setup();

    // First agent claims a file
    const first = sugar.begin({ lifecycle: 'ephemeral',
      purpose: 'First agent',
      files: ['lib/sugar.ts'],
    });
    expect(first.success).toBe(true);

    // Second agent begins with same file — should succeed with conflicts
    const second = sugar.begin({ lifecycle: 'ephemeral',
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

    const result = sugar.begin({ lifecycle: 'ephemeral',
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

    const result = sugar.begin({ lifecycle: 'ephemeral',
      purpose: 'New work',
      identity: 'port-daddy:cli:new',
    });

    expect(result.success).toBe(true);
    expect(result.salvageHint).toBeTruthy();
  });

  test('requires purpose', () => {
    const { sugar } = setup();

    const result = sugar.begin({ lifecycle: 'ephemeral' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('purpose');
  });

  test('requires explicit lifecycle', () => {
    const { sugar } = setup();

    const result = sugar.begin({ purpose: 'Test' });
    expect(result.success).toBe(false);
    expect(result.code).toBe('SESSION_LIFECYCLE_REQUIRED');
    expect(result.error).toContain('lifecycle');
  });

  test('validates identity if provided', () => {
    const { sugar } = setup();

    const result = sugar.begin({ lifecycle: 'ephemeral',
      purpose: 'Test',
      identity: 'invalid identity with spaces',
    });

    expect(result.success).toBe(false);
  });

  test('passes type option through to agent registration', () => {
    const { sugar, agents } = setup();

    const result = sugar.begin({ lifecycle: 'ephemeral',
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
    const begin = sugar.begin({ lifecycle: 'ephemeral',
      purpose: 'Will be done soon',
      agentId: 'done-test',
    });
    expect(begin.success).toBe(true);

    // Done — must include result-note sentinel (PR URL here) to satisfy
    // the pd-done origin-push rule.
    const result = sugar.done({
      agentId: 'done-test',
      sessionId: begin.sessionId,
      note: VALID_RESULT_NOTE_WITH_PR,
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

    const begin = sugar.begin({ lifecycle: 'ephemeral',
      purpose: 'Note test',
      agentId: 'note-test',
    });

    const finalNote = 'All tasks completed successfully. ' + VALID_RESULT_NOTE_WITH_PR;
    const result = sugar.done({
      agentId: 'note-test',
      sessionId: begin.sessionId,
      note: finalNote,
    });

    expect(result.success).toBe(true);
    expect(result.finalNote).toBe(true);

    // Verify note exists
    const notes = sessions.getNotes(begin.sessionId);
    const handoffNotes = notes.notes.filter(n => n.type === 'handoff');
    expect(handoffNotes.length).toBe(1);
    expect(handoffNotes[0].content).toBe(finalNote);
  });

  test('supports abandoned status', () => {
    const { sugar, sessions } = setup();

    const begin = sugar.begin({ lifecycle: 'ephemeral',
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

    const begin = sugar.begin({ lifecycle: 'ephemeral',
      purpose: 'Find me by agent',
      agentId: 'find-test',
    });

    const result = sugar.done({ agentId: 'find-test', note: VALID_RESULT_NOTE_WITH_PR });

    expect(result.success).toBe(true);
    expect(result.sessionId).toBe(begin.sessionId);
  });

  test('returns error when no active session found', () => {
    const { sugar } = setup();

    const result = sugar.done({ agentId: 'nonexistent-agent' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('No active session');
  });

  test('no-context done refuses instead of closing the globally newest active session', () => {
    const { sugar, sessions } = setup();
    const first = sugar.begin({ lifecycle: 'ephemeral', purpose: 'First active', agentId: 'scope-first' });
    const second = sugar.begin({ lifecycle: 'ephemeral', purpose: 'Second active', agentId: 'scope-second' });

    const result = sugar.done({ note: VALID_RESULT_NOTE_WITH_PR });

    expect(result).toMatchObject({
      success: false,
      code: 'NO_ACTIVE_SESSION_SCOPE',
    });
    expect(sessions.get(first.sessionId).session.status).toBe('active');
    expect(sessions.get(second.sessionId).session.status).toBe('active');
  });

  test('agent-only done returns every candidate when multiple sessions are active', () => {
    const { sugar, sessions } = setup();
    const first = sugar.begin({ lifecycle: 'ephemeral', purpose: 'Agent session one', agentId: 'multi-session-agent' });
    const second = sessions.start('Agent session two', {
      agentId: 'multi-session-agent',
      worktreeId: 'worktree-two',
    });

    const result = sugar.done({ agentId: 'multi-session-agent', note: VALID_RESULT_NOTE_WITH_PR });

    expect(result).toMatchObject({
      success: false,
      code: 'AMBIGUOUS_ACTIVE_SESSION',
    });
    expect(result.candidates).toEqual(expect.arrayContaining([
      { sessionId: first.sessionId, worktreeId: expect.anything() },
      { sessionId: second.id, worktreeId: 'worktree-two' },
    ]));
    expect(sessions.get(first.sessionId).session.status).toBe('active');
    expect(sessions.get(second.id).session.status).toBe('active');
  });

  test('refuses pd done when active plan has unchecked todo items', () => {
    const { sugar, sessions } = setup();

    const begin = sugar.begin({ lifecycle: 'ephemeral',
      purpose: 'Checked items test',
      agentId: 'plan-test-1',
    });
    expect(begin.success).toBe(true);

    // Set a plan with unchecked items
    sessions.addNote(begin.sessionId, '- [ ] todo one\n- [x] todo two', { type: 'todo_list' });

    // Done should fail
    const result = sugar.done({
      agentId: 'plan-test-1',
      sessionId: begin.sessionId,
      note: VALID_RESULT_NOTE_WITH_PR,
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('PLAN_UNCHECKED_ITEMS');
  });

  test('validates the latest plan when an older plan had unchecked todo items', () => {
    const { sugar, sessions } = setup();

    const begin = sugar.begin({ lifecycle: 'ephemeral',
      purpose: 'Latest plan test',
      agentId: 'plan-test-latest',
    });
    expect(begin.success).toBe(true);

    sessions.addNote(begin.sessionId, '- [ ] todo one', { type: 'todo_list' });
    sessions.addNote(begin.sessionId, '- [x] todo one', { type: 'todo_list' });

    const latestPlan = sessions.getNotes(begin.sessionId, { type: 'todo_list', limit: 1 });
    expect(latestPlan.success).toBe(true);
    expect(latestPlan.notes).toHaveLength(1);
    expect(latestPlan.notes[0].content).toBe('- [x] todo one');

    const result = sugar.done({
      agentId: 'plan-test-latest',
      sessionId: begin.sessionId,
      note: VALID_RESULT_NOTE_WITH_PR,
    });

    expect(result.success).toBe(true);
    expect(result.sessionStatus).toBe('completed');
  });

  test('succeeds pd done with forceIncomplete and reason', () => {
    const { sugar, sessions } = setup();

    const begin = sugar.begin({ lifecycle: 'ephemeral',
      purpose: 'Force checked items test',
      agentId: 'plan-test-2',
    });
    expect(begin.success).toBe(true);

    // Set a plan with unchecked items
    sessions.addNote(begin.sessionId, '- [ ] todo one', { type: 'todo_list' });

    // Done fails if forceIncompleteReason is too short or missing
    const fail1 = sugar.done({
      agentId: 'plan-test-2',
      sessionId: begin.sessionId,
      note: VALID_RESULT_NOTE_WITH_PR,
      forceIncomplete: true,
    });
    expect(fail1.success).toBe(false);
    expect(fail1.code).toBe('FORCE_INCOMPLETE_REASON_REQUIRED');

    const fail2 = sugar.done({
      agentId: 'plan-test-2',
      sessionId: begin.sessionId,
      note: VALID_RESULT_NOTE_WITH_PR,
      forceIncomplete: true,
      forceIncompleteReason: 'too short',
    });
    expect(fail2.success).toBe(false);
    expect(fail2.code).toBe('FORCE_INCOMPLETE_REASON_REQUIRED');

    // Done succeeds with a long reason
    const ok = sugar.done({
      agentId: 'plan-test-2',
      sessionId: begin.sessionId,
      note: VALID_RESULT_NOTE_WITH_PR,
      forceIncomplete: true,
      forceIncompleteReason: 'deferred features to next ticket',
    });
    expect(ok.success).toBe(true);

    // Verify notes have override stamp
    const notes = sessions.getNotes(begin.sessionId);
    const handoffNotes = notes.notes.filter(n => n.type === 'handoff');
    expect(handoffNotes[0].content).toContain('[OPERATOR-OVERRIDE force-incomplete]');
  });

  test('returns note count', () => {
    const { sugar, sessions } = setup();

    const begin = sugar.begin({ lifecycle: 'ephemeral',
      purpose: 'Counting notes',
      agentId: 'count-test',
    });

    // Add some notes
    sessions.addNote(begin.sessionId, 'Note 1');
    sessions.addNote(begin.sessionId, 'Note 2');

    const result = sugar.done({
      agentId: 'count-test',
      sessionId: begin.sessionId,
      note: 'Final note. ' + VALID_RESULT_NOTE_WITH_PR,
    });

    expect(result.success).toBe(true);
    expect(result.notesCount).toBe(3); // 2 manual + 1 handoff
  });

  test('rejects ending another agent session when both agentId and sessionId are explicit', () => {
    const { sugar } = setup();

    const begin = sugar.begin({ lifecycle: 'ephemeral',
      purpose: 'Owned by agent a',
      agentId: 'agent-a',
    });

    const result = sugar.done({
      agentId: 'agent-b',
      sessionId: begin.sessionId,
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('SESSION_OWNERSHIP_MISMATCH');
    expect(result.error).toContain('belongs to agent agent-a');
  });
});

// =============================================================================
// pd done — origin-push + result-note-sentinel rule (substrate fix 2026-05-20)
//
// Motivated by an incident where 9 worktree branches were orphaned because
// agents wrote `pd done` without ever pushing their work. The rule:
//   1. Branch must not be ahead of its upstream on origin.
//   2. Result note must include one of: PR URL, "no-pr-yet:", or "not-applicable:".
// Escape hatch: --skip-origin-check requires --reason.
// =============================================================================

describe('pd done origin rule', () => {
  function aheadChecker(ahead = 3) {
    return {
      checkBranchOnOrigin: () => ({
        ok: false,
        code: 'BRANCH_AHEAD',
        error: `Branch "feat/x" is ahead of origin/feat/x by ${ahead} commits.`,
        hint: 'Push the branch first:\n    git push -u origin feat/x\n  Then re-run pd done.',
        branch: 'feat/x',
        upstream: 'origin/feat/x',
        ahead,
      }),
    };
  }
  function noUpstreamChecker() {
    return {
      checkBranchOnOrigin: () => ({
        ok: false,
        code: 'NO_UPSTREAM',
        error: 'Branch "feat/x" has no upstream — nothing has been pushed.',
        hint: 'Push the branch and set its upstream:\n    git push -u origin feat/x\n  Then re-run pd done.',
        branch: 'feat/x',
        upstream: null,
      }),
    };
  }
  function spyingChecker() {
    let calls = 0;
    return {
      calls: () => calls,
      checkBranchOnOrigin: () => {
        calls++;
        return { ok: true, branch: 'feat/x', upstream: 'origin/feat/x', ahead: 0 };
      },
      checkLedgerOnly: () => ({ ok: true, dirtyEntries: 0, unpublishedCommits: 0 }),
    };
  }

  test('refuses pd done when branch is ahead of origin (no push performed)', () => {
    const { sugar, sessions } = setup({ gitOriginChecker: aheadChecker(3) });

    const begin = sugar.begin({ lifecycle: 'ephemeral', purpose: 'Branch ahead case', agentId: 'ahead-agent' });

    const result = sugar.done({
      agentId: 'ahead-agent',
      sessionId: begin.sessionId,
      // Provide a valid sentinel so the FIRST refusal we hit is the
      // origin-push check, not the note check.
      note: VALID_RESULT_NOTE_WITH_PR,
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('BRANCH_NOT_ON_ORIGIN');
    expect(result.originCheckCode).toBe('BRANCH_AHEAD');
    expect(result.ahead).toBe(3);
    expect(result.branch).toBe('feat/x');
    expect(result.upstream).toBe('origin/feat/x');
    expect(result.error).toMatch(/ahead of origin\/feat\/x by 3 commits/);
    expect(result.hint).toMatch(/git push -u origin feat\/x/);

    // Session must remain ACTIVE — refusal is a hard precondition, not a
    // soft warning. If pd done refused, no state changes.
    const sessionInfo = sessions.get(begin.sessionId);
    expect(sessionInfo.session.status).toBe('active');
  });

  test('refuses pd done when branch has no upstream', () => {
    const { sugar } = setup({ gitOriginChecker: noUpstreamChecker() });

    sugar.begin({ lifecycle: 'ephemeral', purpose: 'No upstream case', agentId: 'no-upstream-agent' });

    const result = sugar.done({
      agentId: 'no-upstream-agent',
      note: VALID_RESULT_NOTE_WITH_PR,
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('BRANCH_NOT_ON_ORIGIN');
    expect(result.originCheckCode).toBe('NO_UPSTREAM');
    expect(result.error).toMatch(/no upstream/);
    expect(result.hint).toMatch(/git push -u origin/);
  });

  test('--no-pr closes only a verified clean ledger-only branch without an upstream', () => {
    const checker = {
      ...noUpstreamChecker(),
      checkLedgerOnly: () => ({ ok: true, dirtyEntries: 0, unpublishedCommits: 0 }),
    };
    const { sugar, sessions } = setup({ gitOriginChecker: checker });
    const begin = sugar.begin({ lifecycle: 'ephemeral', purpose: 'Ledger-only close', agentId: 'ledger-only-agent' });

    const result = sugar.done({
      agentId: 'ledger-only-agent',
      sessionId: begin.sessionId,
      note: 'Result: reconciliation notes recorded; no repository changes were made.',
      noPr: true,
    });

    expect(result.success).toBe(true);
    const handoff = sessions.getNotes(begin.sessionId).notes.find((note) => note.type === 'handoff');
    expect(handoff.content).toContain('not-applicable: ledger-only session, no repository artifact');
  });

  test('--no-pr still refuses dirty or unpublished repository work', () => {
    const checker = {
      ...noUpstreamChecker(),
      checkLedgerOnly: () => ({
        ok: false,
        code: 'DIRTY_WORKTREE',
        error: 'Worktree has 1 uncommitted or untracked entry.',
        hint: 'Preserve the work first.',
        dirtyEntries: 1,
      }),
    };
    const { sugar } = setup({ gitOriginChecker: checker });
    const begin = sugar.begin({ lifecycle: 'ephemeral', purpose: 'Dirty no-pr close', agentId: 'dirty-no-pr-agent' });
    const result = sugar.done({
      agentId: 'dirty-no-pr-agent',
      sessionId: begin.sessionId,
      note: 'Result: attempted ledger close.',
      noPr: true,
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('LEDGER_ONLY_CHECK_FAILED');
    expect(result.ledgerOnlyCheckCode).toBe('DIRTY_WORKTREE');
    expect(result.dirtyEntries).toBe(1);
  });

  test('--no-pr verifies ledger-only cleanliness even when the branch is fully pushed', () => {
    const checker = {
      checkBranchOnOrigin: () => ({ ok: true, branch: 'feat/x', upstream: 'origin/feat/x', ahead: 0 }),
      checkLedgerOnly: () => ({
        ok: false,
        code: 'DIRTY_WORKTREE',
        error: 'Worktree has 2 uncommitted or untracked entries.',
        hint: 'Preserve the work first.',
        dirtyEntries: 2,
      }),
    };
    const { sugar } = setup({ gitOriginChecker: checker });
    const begin = sugar.begin({ lifecycle: 'ephemeral', purpose: 'Pushed but dirty close', agentId: 'pushed-dirty-agent' });

    const result = sugar.done({
      agentId: 'pushed-dirty-agent',
      sessionId: begin.sessionId,
      note: 'Result: attempted ledger close.',
      noPr: true,
    });

    expect(result).toMatchObject({
      success: false,
      code: 'LEDGER_ONLY_CHECK_FAILED',
      ledgerOnlyCheckCode: 'DIRTY_WORKTREE',
      dirtyEntries: 2,
      originCheckCode: null,
    });
  });

  test('--no-pr still refuses dirty work when skip-origin-check is requested', () => {
    const checker = {
      checkBranchOnOrigin: () => { throw new Error('origin gate must be skipped'); },
      checkLedgerOnly: () => ({
        ok: false,
        code: 'DIRTY_WORKTREE',
        error: 'Worktree has 1 uncommitted or untracked entry.',
        hint: 'Preserve the work first.',
        dirtyEntries: 1,
      }),
    };
    const { sugar } = setup({ gitOriginChecker: checker });
    const begin = sugar.begin({ lifecycle: 'ephemeral', purpose: 'Dirty override close', agentId: 'dirty-override-agent' });

    const result = sugar.done({
      agentId: 'dirty-override-agent',
      sessionId: begin.sessionId,
      note: 'Result: attempted ledger close.',
      noPr: true,
      skipOriginCheck: true,
      skipOriginCheckReason: 'operator accepts no upstream for ledger-only work',
    });

    expect(result).toMatchObject({
      success: false,
      code: 'LEDGER_ONLY_CHECK_FAILED',
      ledgerOnlyCheckCode: 'DIRTY_WORKTREE',
      dirtyEntries: 1,
      originCheckCode: null,
    });
  });

  test('--no-pr plus skip-origin-check closes only after ledger verification and records both markers', () => {
    const checker = {
      checkBranchOnOrigin: () => { throw new Error('origin gate must be skipped'); },
      checkLedgerOnly: () => ({ ok: true, dirtyEntries: 0, unpublishedCommits: 0 }),
    };
    const { sugar, sessions } = setup({ gitOriginChecker: checker });
    const begin = sugar.begin({ lifecycle: 'ephemeral', purpose: 'Clean override close', agentId: 'clean-override-agent' });

    const result = sugar.done({
      agentId: 'clean-override-agent',
      sessionId: begin.sessionId,
      note: 'Result: verified ledger-only completion.',
      noPr: true,
      skipOriginCheck: true,
      skipOriginCheckReason: 'operator accepts no upstream for ledger-only work',
    });

    expect(result.success).toBe(true);
    const handoff = sessions.getNotes(begin.sessionId).notes.find((entry) => entry.type === 'handoff');
    expect(handoff.content).toContain('[OPERATOR-OVERRIDE skip-origin-check]');
    expect(handoff.content).toContain('not-applicable: ledger-only session, no repository artifact');
  });

  test('refuses pd done when result note lacks a sentinel', () => {
    const checker = spyingChecker();
    const { sugar, sessions } = setup({ gitOriginChecker: checker });

    const begin = sugar.begin({ lifecycle: 'ephemeral', purpose: 'Missing sentinel case', agentId: 'no-sentinel-agent' });

    // Note A: empty note (none provided)
    const r1 = sugar.done({ agentId: 'no-sentinel-agent', sessionId: begin.sessionId });
    expect(r1.success).toBe(false);
    expect(r1.code).toBe('RESULT_NOTE_MISSING_SENTINEL');
    expect(r1.error).toMatch(/PR URL/);
    expect(r1.error).toMatch(/no-pr-yet/);
    expect(r1.error).toMatch(/not-applicable/);

    // Note B: a note with NO sentinel
    const r2 = sugar.done({
      agentId: 'no-sentinel-agent',
      sessionId: begin.sessionId,
      note: 'Work is done. Tests pass. Shipping later.',
    });
    expect(r2.success).toBe(false);
    expect(r2.code).toBe('RESULT_NOTE_MISSING_SENTINEL');

    // The cheap note check must fire BEFORE the git check, so the
    // origin checker should not have been invoked yet.
    expect(checker.calls()).toBe(0);

    // Session must still be active.
    const sessionInfo = sessions.get(begin.sessionId);
    expect(sessionInfo.session.status).toBe('active');
  });

  test('succeeds with a valid PR URL note + clean origin', () => {
    const { sugar, sessions } = setup({ gitOriginChecker: spyingChecker() });

    const begin = sugar.begin({ lifecycle: 'ephemeral', purpose: 'Happy origin case', agentId: 'happy-agent' });

    const result = sugar.done({
      agentId: 'happy-agent',
      sessionId: begin.sessionId,
      note: 'Result: feature shipped. PR opened: https://github.com/curiositech/port-daddy/pull/143',
    });

    expect(result.success).toBe(true);
    expect(result.sessionStatus).toBe('completed');

    // Each accepted sentinel form should also work.
    const b2 = sugar.begin({ lifecycle: 'ephemeral', purpose: 'no-pr-yet case', agentId: 'no-pr-agent' });
    const r2 = sugar.done({
      agentId: 'no-pr-agent',
      sessionId: b2.sessionId,
      note: 'Result: paused. no-pr-yet: blocked on operator approval of design.',
    });
    expect(r2.success).toBe(true);

    const b3 = sugar.begin({ lifecycle: 'ephemeral', purpose: 'not-applicable case', agentId: 'na-agent' });
    const r3 = sugar.done({
      agentId: 'na-agent',
      sessionId: b3.sessionId,
      note: 'Result: docs-only sync. not-applicable: documentation skill update, no PR needed.',
    });
    expect(r3.success).toBe(true);

    // Test that noPr / subtask bypasses the sentinel check.
    const b_no_pr = sugar.begin({ lifecycle: 'ephemeral', purpose: 'no-pr flag case', agentId: 'no-pr-flag-agent' });
    const r_no_pr = sugar.done({
      agentId: 'no-pr-flag-agent',
      sessionId: b_no_pr.sessionId,
      note: 'Result: work completed without a PR',
      noPr: true,
    });
    expect(r_no_pr.success).toBe(true);
    // Note should have standard sentinel appended
    const notes_no_pr = sessions.getNotes(b_no_pr.sessionId).notes;
    const handoff_no_pr = notes_no_pr.find((n) => n.type === 'handoff');
    expect(handoff_no_pr).toBeTruthy();
    expect(handoff_no_pr.content).toContain('not-applicable: ledger-only session, no repository artifact');

    const b_subtask = sugar.begin({ lifecycle: 'ephemeral', purpose: 'subtask flag case', agentId: 'subtask-flag-agent' });
    const r_subtask = sugar.done({
      agentId: 'subtask-flag-agent',
      sessionId: b_subtask.sessionId,
      note: 'Result: work completed as subtask',
      subtask: true,
    });
    expect(r_subtask.success).toBe(true);
    // Note should have standard sentinel appended
    const notes_subtask = sessions.getNotes(b_subtask.sessionId).notes;
    const handoff_subtask = notes_subtask.find((n) => n.type === 'handoff');
    expect(handoff_subtask).toBeTruthy();
    expect(handoff_subtask.content).toContain('not-applicable: subtask code delivery');

    // Session was completed.
    const sessionInfo = sessions.get(begin.sessionId);
    expect(sessionInfo.session.status).toBe('completed');
  });

  test('--skip-origin-check works only with a reason; stamps [OPERATOR-OVERRIDE]', () => {
    const { sugar, sessions } = setup({ gitOriginChecker: aheadChecker(5) });

    const begin = sugar.begin({ lifecycle: 'ephemeral', purpose: 'Override case', agentId: 'override-agent' });

    // Without --reason: refusal.
    const noReason = sugar.done({
      agentId: 'override-agent',
      sessionId: begin.sessionId,
      skipOriginCheck: true,
    });
    expect(noReason.success).toBe(false);
    expect(noReason.code).toBe('SKIP_ORIGIN_CHECK_REASON_REQUIRED');

    // Still active after refusal.
    expect(sessions.get(begin.sessionId).session.status).toBe('active');

    // With --reason: success even though the (would-have-been) origin
    // check would have refused (branch ahead by 5).
    const ok = sugar.done({
      agentId: 'override-agent',
      sessionId: begin.sessionId,
      skipOriginCheck: true,
      skipOriginCheckReason: 'local experiment, not shipping',
      note: 'tried thing X, did not work', // note WITHOUT a sentinel — override bypasses both gates
    });
    expect(ok.success).toBe(true);
    expect(ok.sessionStatus).toBe('completed');

    // The stored handoff note must carry the override stamp.
    const notes = sessions.getNotes(begin.sessionId).notes;
    const handoff = notes.find((n) => n.type === 'handoff');
    expect(handoff).toBeTruthy();
    expect(handoff.content).toMatch(/^\[OPERATOR-OVERRIDE skip-origin-check\] reason: local experiment, not shipping/);
    expect(handoff.content).toContain('tried thing X');
  });
});

// =============================================================================
// whoami
// =============================================================================

describe('sugar.whoami', () => {
  test('returns active context for registered agent', () => {
    const { sugar } = setup();

    const begin = sugar.begin({ lifecycle: 'ephemeral',
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

  test('agent-only whoami fails on multiple active sessions and names each worktree', () => {
    const { sugar, sessions } = setup();
    const first = sugar.begin({ lifecycle: 'ephemeral', purpose: 'Who one', agentId: 'who-many' });
    const second = sessions.start('Who two', { agentId: 'who-many', worktreeId: 'who-worktree-two' });

    const result = sugar.whoami({ agentId: 'who-many' });

    expect(result).toMatchObject({
      success: false,
      active: false,
      code: 'AMBIGUOUS_ACTIVE_SESSION',
    });
    expect(result.candidates).toEqual(expect.arrayContaining([
      { sessionId: first.sessionId, worktreeId: expect.anything() },
      { sessionId: second.id, worktreeId: 'who-worktree-two' },
    ]));
  });

  test('falls back to an explicit active session when the agent row was reaped', () => {
    const { sugar, agents } = setup();

    const begin = sugar.begin({ lifecycle: 'ephemeral',
      purpose: 'Recover from stale agent',
      agentId: 'stale-agent-test',
      identity: 'myproject:api:main',
    });

    agents.unregister('stale-agent-test');

    const result = sugar.whoami({
      agentId: 'stale-agent-test',
      sessionId: begin.sessionId,
    });

    expect(result.success).toBe(true);
    expect(result.active).toBe(true);
    expect(result.agentId).toBe('stale-agent-test');
    expect(result.sessionId).toBe(begin.sessionId);
    expect(result.purpose).toBe('Recover from stale agent');
    expect(result.identity).toBeNull();
  });

  test('returns file claims in context', () => {
    const { sugar } = setup();

    sugar.begin({ lifecycle: 'ephemeral',
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

    const begin = sugar.begin({ lifecycle: 'ephemeral',
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

    sugar.begin({ lifecycle: 'ephemeral',
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

    const begin = sugar.begin({ lifecycle: 'ephemeral',
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
    const begin = sugar.begin({ lifecycle: 'ephemeral',
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
      note: 'All done! ' + VALID_RESULT_NOTE_WITH_PR,
    });
    expect(done.success).toBe(true);
    expect(done.notesCount).toBe(3); // 2 manual + 1 handoff

    // 5. Whoami should show inactive
    const whoAfter = sugar.whoami({ agentId: 'lifecycle-test' });
    expect(whoAfter.active).toBe(false);
  });

  test('multiple agents can begin/done independently', () => {
    const { sugar } = setup();

    const a1 = sugar.begin({ lifecycle: 'ephemeral', purpose: 'Agent 1', agentId: 'a1' });
    const a2 = sugar.begin({ lifecycle: 'ephemeral', purpose: 'Agent 2', agentId: 'a2' });

    expect(a1.success).toBe(true);
    expect(a2.success).toBe(true);
    expect(a1.sessionId).not.toBe(a2.sessionId);

    // Done agent 1
    const d1 = sugar.done({ agentId: 'a1', note: VALID_RESULT_NOTE_WITH_PR });
    expect(d1.success).toBe(true);

    // Agent 2 still active
    const who2 = sugar.whoami({ agentId: 'a2' });
    expect(who2.active).toBe(true);

    // Done agent 2
    const d2 = sugar.done({ agentId: 'a2', note: VALID_RESULT_NOTE_WITH_PR });
    expect(d2.success).toBe(true);
  });

  it('should auto-enroll and auto-close commitments during begin/done lifecycle', () => {
    const { sugar, commitments } = setup();

    const beginRes = sugar.begin({
      purpose: 'Write tests for port-daddy commitments',
      identity: 'port-daddy:test:commitments',
      lifecycle: 'durable',
      agentId: 'test-agent-commitments',
    });

    expect(beginRes.success).toBe(true);

    // Verify a commitment was created
    const activeCommitments = commitments.list({ ownerActorId: 'test-agent-commitments', state: 'open' });
    expect(activeCommitments.length).toBe(1);
    expect(activeCommitments[0].successCheck).toBe(`session:${beginRes.sessionId}:completed`);

    // Done the session
    const doneRes = sugar.done({
      agentId: 'test-agent-commitments',
      note: VALID_RESULT_NOTE_WITH_PR,
    });
    expect(doneRes.success).toBe(true);

    // Verify commitment is now closed
    const activeAfter = commitments.list({ ownerActorId: 'test-agent-commitments', state: 'open' });
    expect(activeAfter.length).toBe(0);
  });

  it('should allow takeover/resumption of recently closed sessions', () => {
    const { sugar } = setup();

    const beginRes1 = sugar.begin({
      purpose: 'Initial session purpose',
      identity: 'port-daddy:test:takeover',
      lifecycle: 'durable',
      agentId: 'test-agent-takeover',
    });
    expect(beginRes1.success).toBe(true);

    // Close the session
    const doneRes = sugar.done({
      agentId: 'test-agent-takeover',
      note: VALID_RESULT_NOTE_WITH_PR,
    });
    expect(doneRes.success).toBe(true);

    // Re-begin for the same identity without force should perform takeover
    const beginRes2 = sugar.begin({
      purpose: 'New successor session purpose',
      identity: 'port-daddy:test:takeover',
      lifecycle: 'durable',
    });

    expect(beginRes2.success).toBe(true);
    expect(beginRes2.resumed).toBe(true);
    expect(beginRes2.takeover).toBe(true);
    expect(beginRes2.sessionId).not.toBe(beginRes1.sessionId);
  });

  it('should generate a welcome briefing with roadmap, ongoing, high-pri bugs, and dormant sessions', () => {
    const { sugar, feedback } = setup();

    // 1. Add some open high-pri feedback
    feedback.list = () => [
      {
        feedbackId: 'fb-1',
        slug: 'critical-bug',
        summary: 'Daemon crash on boot',
        severity: 'critical',
        status: 'open',
        droppedBy: 'operator',
        surface: 'daemon',
        at: Date.now(),
      },
    ];

    // 2. Add an active session
    sugar.begin({
      purpose: 'Live ongoing feature work',
      identity: 'port-daddy:test:welcome',
      lifecycle: 'durable',
      agentId: 'test-agent-welcome',
    });

    const welcome = sugar.getWelcomeBriefing('fleet');
    expect(welcome.success).toBe(true);
    expect(welcome.ongoing.length).toBe(1);
    expect(welcome.ongoing[0].purpose).toBe('Live ongoing feature work');
    expect(welcome.highPriBugs.length).toBe(1);
    expect(welcome.highPriBugs[0].slug).toBe('critical-bug');
  });
});
