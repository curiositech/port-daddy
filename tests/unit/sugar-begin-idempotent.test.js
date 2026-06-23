/**
 * Regression: `pd begin` forked a NEW session+agent on every call. Two begins
 * for the same identity in the same worktree produced two parallel active
 * sessions; the first held the file claims, the second could not re-claim, and
 * the Coordination Guard then rejected the commit ("no active session" /
 * "claimed by another active session"). This bit the operator at essentially
 * every API-driven commit.
 *
 * Fix: begin is idempotent per (identity, worktree) — it RESUMES the existing
 * active session instead of forking. `force: true` opts back into a fresh one.
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
  const sugar = createSugar({
    agents,
    sessions,
    activityLog,
    gitOriginChecker: { checkBranchOnOrigin: () => ({ ok: true, branch: 'feat/x', upstream: 'origin/feat/x', ahead: 0 }) },
  });
  return { db, agents, sessions, sugar };
}

describe('begin idempotency — resume, do not fork', () => {
  test('re-begin with the same identity in the same worktree RESUMES the same session', () => {
    const { sugar } = setup();
    const first = sugar.begin({ lifecycle: 'ephemeral', identity: 'demo:test:ctx', purpose: 'first call' });
    expect(first.success).toBe(true);

    const second = sugar.begin({ lifecycle: 'ephemeral', identity: 'demo:test:ctx', purpose: 'second call, same identity' });
    expect(second.success).toBe(true);
    expect(second.resumed).toBe(true);
    expect(second.agentId).toBe(first.agentId);
    expect(second.sessionId).toBe(first.sessionId);
  });

  test('force: true mints a fresh session even for the same identity', () => {
    const { sugar } = setup();
    const first = sugar.begin({ lifecycle: 'ephemeral', identity: 'demo:test:ctx', purpose: 'work' });
    const forced = sugar.begin({ lifecycle: 'ephemeral', identity: 'demo:test:ctx', purpose: 'work', force: true });
    expect(forced.success).toBe(true);
    expect(forced.resumed).toBeFalsy();
    expect(forced.sessionId).not.toBe(first.sessionId);
  });

  test('a different identity does NOT resume — it gets its own session', () => {
    const { sugar } = setup();
    const a = sugar.begin({ lifecycle: 'ephemeral', identity: 'demo:test:alpha', purpose: 'work' });
    const b = sugar.begin({ lifecycle: 'ephemeral', identity: 'demo:test:beta', purpose: 'work' });
    expect(b.resumed).toBeFalsy();
    expect(b.sessionId).not.toBe(a.sessionId);
  });

  test('an explicit agentId opts out of resume (caller owns identity)', () => {
    const { sugar } = setup();
    const first = sugar.begin({ lifecycle: 'ephemeral', identity: 'demo:test:ctx', purpose: 'work' });
    const explicit = sugar.begin({ lifecycle: 'ephemeral', identity: 'demo:test:ctx', purpose: 'work', agentId: 'agent-explicit-xyz' });
    expect(explicit.resumed).toBeFalsy();
    expect(explicit.agentId).toBe('agent-explicit-xyz');
    expect(explicit.sessionId).not.toBe(first.sessionId);
  });

  test('resume claims newly-passed files onto the existing session', () => {
    const { sugar, sessions } = setup();
    const first = sugar.begin({ lifecycle: 'ephemeral', identity: 'demo:test:ctx', purpose: 'work' });
    const second = sugar.begin({ lifecycle: 'ephemeral', identity: 'demo:test:ctx', purpose: 'work', files: ['lib/widget.ts'] });
    expect(second.resumed).toBe(true);
    const got = sessions.get(first.sessionId);
    expect(JSON.stringify(got)).toContain('lib/widget.ts');
  });

  test('begin without an identity is unaffected (still creates)', () => {
    const { sugar } = setup();
    const a = sugar.begin({ lifecycle: 'ephemeral', purpose: 'no identity A' });
    const b = sugar.begin({ lifecycle: 'ephemeral', purpose: 'no identity B' });
    expect(a.success && b.success).toBe(true);
    expect(b.resumed).toBeFalsy();
    expect(b.sessionId).not.toBe(a.sessionId);
  });
});
