/**
 * Durable Session Mode Tests (lifecycle: durable)
 *
 * Durable sessions are work contexts, not process lifetimes. They survive
 * without a live heartbeat: the orphan reaper skips them, whoami reports
 * abandonment as dormant/resumable without mutating it, and an explicit
 * resume/takeover path may later continue the work. Only pd done (or
 * worktree removal / branch merge) ends them.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDb } from '../setup-unit.js';
import { createAgents } from '../../lib/agents.js';
import { createSessions } from '../../lib/sessions.js';
import { createActivityLog } from '../../lib/activity.js';
import { createSugar } from '../../lib/sugar.js';
import { resolveActiveSessionForFiles } from '../../cli/commands/sessions.js';
import { writeCurrentContext } from '../../cli/utils/current-context.js';

function passingChecker() {
  return {
    checkBranchOnOrigin: () => ({ ok: true, branch: 'feat/test', upstream: 'origin/feat/test', ahead: 0 }),
  };
}

describe('Durable Sessions', () => {
  let db;
  let agents;
  let sessions;
  let sugar;

  beforeEach(() => {
    db = createTestDb();
    // Agents table must exist before createSessions so the orphan-reaper
    // statement takes its real (agents-joined) branch.
    agents = createAgents(db);
    sessions = createSessions(db);
    const activityLog = createActivityLog(db);
    sessions.setActivityLog(activityLog);
    sugar = createSugar({
      agents,
      sessions,
      activityLog,
      gitOriginChecker: passingChecker(),
    });
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  // ===========================================================================
  // Insert + formatting
  // ===========================================================================

  describe('start({ durable })', () => {
    it('persists is_durable=1 when durable is requested', () => {
      const result = sessions.start('Durable work', { durable: true });
      expect(result.success).toBe(true);

      const row = db.prepare('SELECT is_durable FROM sessions WHERE id = ?').get(result.id);
      expect(row.is_durable).toBe(1);
    });

    it('defaults to is_durable=0', () => {
      const result = sessions.start('Ordinary work');
      expect(result.success).toBe(true);

      const row = db.prepare('SELECT is_durable FROM sessions WHERE id = ?').get(result.id);
      expect(row.is_durable).toBe(0);
    });

    it('exposes durable on the formatted session (get)', () => {
      const durable = sessions.start('Durable work', { durable: true });
      const ordinary = sessions.start('Ordinary work');

      expect(sessions.get(durable.id).session.durable).toBe(true);
      expect(sessions.get(ordinary.id).session.durable).toBe(false);
    });
  });

  // ===========================================================================
  // Orphan reaper exclusion
  // ===========================================================================

  describe('abandonOrphanedActive', () => {
    it('skips durable sessions, abandons ordinary orphans', () => {
      // Sessions owned by an agent id that has no row in the agents registry
      // are "orphaned". Backdate both past the reaper threshold.
      const durable = sessions.start('Durable orphan', { agentId: 'ghost-durable', durable: true });
      const ordinary = sessions.start('Ordinary orphan', { agentId: 'ghost-ordinary' });
      const longAgo = Date.now() - 60 * 60 * 1000;
      db.prepare('UPDATE sessions SET updated_at = ? WHERE id IN (?, ?)').run(longAgo, durable.id, ordinary.id);

      const result = sessions.abandonOrphanedActive({ olderThan: 20 * 60 * 1000 });

      expect(result.success).toBe(true);
      expect(result.abandoned).toContain(ordinary.id);
      expect(result.abandoned).not.toContain(durable.id);
      expect(sessions.get(durable.id).session.status).toBe('active');
      expect(sessions.get(ordinary.id).session.status).toBe('abandoned');
    });
  });

  // ===========================================================================
  // cleanup() — old sessions are reported but preserved as append-only evidence
  // ===========================================================================

  describe('cleanup', () => {
    it('preserves abandoned ordinary and completed durable sessions as evidence', () => {
      const abandonedDurable = sessions.start('Durable suspended', { durable: true });
      const abandonedOrdinary = sessions.start('Ordinary abandoned');
      const completedDurable = sessions.start('Durable finished', { durable: true });
      const longAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      db.prepare("UPDATE sessions SET status = 'abandoned', updated_at = ? WHERE id IN (?, ?)")
        .run(longAgo, abandonedDurable.id, abandonedOrdinary.id);
      db.prepare("UPDATE sessions SET status = 'completed', updated_at = ? WHERE id = ?")
        .run(longAgo, completedDurable.id);

      const result = sessions.cleanup({ olderThan: 7 * 24 * 60 * 60 * 1000 });

      expect(result.cleaned).toBe(0);
      expect(result.preserved).toBe(3);
      expect(result.notesPreserved).toBe(true);
      expect(sessions.get(abandonedDurable.id).success).toBe(true);
      expect(sessions.get(abandonedOrdinary.id).success).toBe(true);
      expect(sessions.get(completedDurable.id).success).toBe(true);
    });

    it('status-filtered cleanup also spares abandoned durable sessions', () => {
      const abandonedDurable = sessions.start('Durable suspended', { durable: true });
      const longAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      db.prepare("UPDATE sessions SET status = 'abandoned', updated_at = ? WHERE id = ?")
        .run(longAgo, abandonedDurable.id);

      const result = sessions.cleanup({ olderThan: 7 * 24 * 60 * 60 * 1000, status: 'abandoned' });

      expect(result.cleaned).toBe(0);
      expect(result.preserved).toBe(1);
      expect(result.notesPreserved).toBe(true);
      expect(sessions.get(abandonedDurable.id).success).toBe(true);
    });
  });

  // ===========================================================================
  // resurrect()
  // ===========================================================================

  describe('resurrect', () => {
    it('flips an abandoned durable session back to active', () => {
      const durable = sessions.start('Durable work', { durable: true });
      db.prepare("UPDATE sessions SET status = 'abandoned' WHERE id = ?").run(durable.id);

      sessions.resurrect(durable.id);

      expect(sessions.get(durable.id).session.status).toBe('active');
    });

    it('does not resurrect a non-durable abandoned session', () => {
      const ordinary = sessions.start('Ordinary work');
      db.prepare("UPDATE sessions SET status = 'abandoned' WHERE id = ?").run(ordinary.id);

      sessions.resurrect(ordinary.id);

      expect(sessions.get(ordinary.id).session.status).toBe('abandoned');
    });

    it('resets phase and completed_at left behind by an abandonment write', () => {
      const durable = sessions.start('Durable work', { durable: true });
      // Mirror the orphan reaper's full abandonment write: status, phase, completed_at.
      db.prepare("UPDATE sessions SET status = 'abandoned', phase = 'abandoned', completed_at = ? WHERE id = ?")
        .run(Date.now(), durable.id);

      sessions.resurrect(durable.id);

      const session = sessions.get(durable.id).session;
      expect(session.status).toBe('active');
      expect(session.phase).toBe('in_progress');
      expect(session.completedAt).toBeNull();
    });

    it('does not touch completed durable sessions (pd done is final)', () => {
      const durable = sessions.start('Durable work', { durable: true });
      db.prepare("UPDATE sessions SET status = 'completed' WHERE id = ?").run(durable.id);

      sessions.resurrect(durable.id);

      expect(sessions.get(durable.id).session.status).toBe('completed');
    });
  });

  // ===========================================================================
  // sugar.begin + whoami
  // ===========================================================================

  describe('sugar integration', () => {
    it("begin({ lifecycle: 'durable' }) creates a durable session", () => {
      const result = sugar.begin({ purpose: 'Long-running build', lifecycle: 'durable' });
      expect(result.success).toBe(true);

      const row = db.prepare('SELECT is_durable FROM sessions WHERE id = ?').get(result.sessionId);
      expect(row.is_durable).toBe(1);
    });

    it("begin({ lifecycle: 'ephemeral' }) stays non-durable", () => {
      const result = sugar.begin({ purpose: 'Quick fix', lifecycle: 'ephemeral' });
      expect(result.success).toBe(true);

      const row = db.prepare('SELECT is_durable FROM sessions WHERE id = ?').get(result.sessionId);
      expect(row.is_durable).toBe(0);
    });

    it('whoami reports an explicitly selected abandoned durable session as dormant without resurrecting it', () => {
      const begun = sugar.begin({ purpose: 'Long-running build', lifecycle: 'durable' });
      db.prepare("UPDATE sessions SET status = 'abandoned' WHERE id = ?").run(begun.sessionId);

      const who = sugar.whoami({ sessionId: begun.sessionId });

      expect(who.success).toBe(true);
      expect(who.active).toBe(false);
      expect(who.dormant).toBe(true);
      expect(who.resumable).toBe(true);
      expect(who.lifecycle).toBe('durable');
      expect(who.sessionId).toBe(begun.sessionId);
      expect(sessions.get(begun.sessionId).session.status).toBe('abandoned');
    });

    it('whoami by agentId finds one abandoned durable session but leaves it dormant', () => {
      const begun = sugar.begin({ purpose: 'Long-running build', lifecycle: 'durable' });
      db.prepare("UPDATE sessions SET status = 'abandoned' WHERE id = ?").run(begun.sessionId);

      const who = sugar.whoami({ agentId: begun.agentId });

      expect(who.success).toBe(true);
      expect(who.active).toBe(false);
      expect(who.dormant).toBe(true);
      expect(who.resumable).toBe(true);
      expect(who.sessionId).toBe(begun.sessionId);
      expect(sessions.get(begun.sessionId).session.status).toBe('abandoned');
    });

    it('whoami can report a dormant durable session after its process-agent row is gone', () => {
      const begun = sugar.begin({ purpose: 'Detached durable build', lifecycle: 'durable' });
      db.prepare("UPDATE sessions SET status = 'abandoned' WHERE id = ?").run(begun.sessionId);
      agents.unregister(begun.agentId);

      const who = sugar.whoami({ agentId: begun.agentId });

      expect(who).toMatchObject({
        success: true,
        active: false,
        dormant: true,
        resumable: true,
        agentId: begun.agentId,
        sessionId: begun.sessionId,
      });
      expect(sessions.get(begun.sessionId).session.status).toBe('abandoned');
    });

    it('whoami by agentId still reports inactive for an abandoned non-durable session', () => {
      const begun = sugar.begin({ purpose: 'Quick fix', lifecycle: 'ephemeral' });
      db.prepare("UPDATE sessions SET status = 'abandoned' WHERE id = ?").run(begun.sessionId);

      const who = sugar.whoami({ agentId: begun.agentId });

      expect(who.success).toBe(true);
      expect(who.active).toBe(false);
      expect(sessions.get(begun.sessionId).session.status).toBe('abandoned');
    });

    it('whoami still reports an abandoned non-durable session as inactive', () => {
      const begun = sugar.begin({ purpose: 'Quick fix', lifecycle: 'ephemeral' });
      db.prepare("UPDATE sessions SET status = 'abandoned' WHERE id = ?").run(begun.sessionId);

      const who = sugar.whoami({ sessionId: begun.sessionId });

      expect(who.success).toBe(true);
      expect(who.active).toBe(false);
      expect(sessions.get(begun.sessionId).session.status).toBe('abandoned');
    });
  });
});

describe('CLI file-claim session selection', () => {
  it('returns AMBIGUOUS_ACTIVE_SESSION with every candidate session/worktree id', async () => {
    const pd = {
      whoami: jest.fn(),
      sessions: jest.fn().mockResolvedValue({
        success: true,
        count: 2,
        sessions: [
          { id: 'session-one', agentId: 'agent-many', worktreeId: 'worktree-one' },
          { id: 'session-two', agentId: 'agent-many', worktreeId: 'worktree-two' },
        ],
      }),
    };

    const result = await resolveActiveSessionForFiles(pd, { agent: 'agent-many' });

    expect(result).toEqual({
      success: false,
      code: 'AMBIGUOUS_ACTIVE_SESSION',
      error: 'Agent "agent-many" has multiple active sessions; pass --session explicitly.',
      candidates: [
        { sessionId: 'session-one', worktreeId: 'worktree-one' },
        { sessionId: 'session-two', worktreeId: 'worktree-two' },
      ],
    });
  });

  it('lets an explicit session and agent outrank contradictory ambient context', async () => {
    const contextDir = mkdtempSync(join(tmpdir(), 'pd-session-selection-'));
    const keys = ['PORT_DADDY_CONTEXT_DIR', 'PORT_DADDY_CONTEXT_SLOT', 'PD_AGENT_ID', 'PD_SESSION_ID'];
    const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    try {
      process.env.PORT_DADDY_CONTEXT_DIR = contextDir;
      process.env.PORT_DADDY_CONTEXT_SLOT = 'selection-test';
      writeCurrentContext({ agentId: 'slot-agent', sessionId: 'slot-session' });
      process.env.PD_AGENT_ID = 'env-agent';
      process.env.PD_SESSION_ID = 'env-session';

      const pd = {
        whoami: jest.fn().mockResolvedValue({
          success: true,
          active: true,
          agentId: 'explicit-agent',
          sessionId: 'explicit-session',
        }),
        sessions: jest.fn(),
      };

      const result = await resolveActiveSessionForFiles(pd, {
        agent: 'explicit-agent',
        session: 'explicit-session',
      });

      expect(result).toEqual({
        success: true,
        sessionId: 'explicit-session',
        agentId: 'explicit-agent',
        source: 'explicit-session',
      });
      expect(pd.whoami).toHaveBeenCalledWith({
        agentId: 'explicit-agent',
        sessionId: 'explicit-session',
      });
      expect(pd.sessions).not.toHaveBeenCalled();
    } finally {
      for (const key of keys) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
      rmSync(contextDir, { recursive: true, force: true });
    }
  });
});
