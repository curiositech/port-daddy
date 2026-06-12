/**
 * Durable Session Mode Tests (pd begin --durable)
 *
 * Durable sessions are work contexts, not process lifetimes. They survive
 * without a live heartbeat: the orphan reaper skips them, whoami reports
 * them active even after an abandonment write, and resurrect() flips an
 * abandoned durable session back to active. Only pd done (or worktree
 * removal / branch merge) ends them.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createAgents } from '../../lib/agents.js';
import { createSessions } from '../../lib/sessions.js';
import { createActivityLog } from '../../lib/activity.js';
import { createSugar } from '../../lib/sugar.js';

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
    it('begin({ durable: true }) creates a durable session', () => {
      const result = sugar.begin({ purpose: 'Long-running build', durable: true });
      expect(result.success).toBe(true);

      const row = db.prepare('SELECT is_durable FROM sessions WHERE id = ?').get(result.sessionId);
      expect(row.is_durable).toBe(1);
    });

    it('begin without durable stays non-durable', () => {
      const result = sugar.begin({ purpose: 'Quick fix' });
      expect(result.success).toBe(true);

      const row = db.prepare('SELECT is_durable FROM sessions WHERE id = ?').get(result.sessionId);
      expect(row.is_durable).toBe(0);
    });

    it('whoami reports an abandoned durable session as active and resurrects it', () => {
      const begun = sugar.begin({ purpose: 'Long-running build', durable: true });
      db.prepare("UPDATE sessions SET status = 'abandoned' WHERE id = ?").run(begun.sessionId);

      const who = sugar.whoami({ sessionId: begun.sessionId });

      expect(who.success).toBe(true);
      expect(who.active).toBe(true);
      expect(who.sessionId).toBe(begun.sessionId);
      // Side effect: status flipped back to active in the DB.
      expect(sessions.get(begun.sessionId).session.status).toBe('active');
    });

    it('whoami still reports an abandoned non-durable session as inactive', () => {
      const begun = sugar.begin({ purpose: 'Quick fix' });
      db.prepare("UPDATE sessions SET status = 'abandoned' WHERE id = ?").run(begun.sessionId);

      const who = sugar.whoami({ sessionId: begun.sessionId });

      expect(who.success).toBe(true);
      expect(who.active).toBe(false);
      expect(sessions.get(begun.sessionId).session.status).toBe('abandoned');
    });
  });
});
