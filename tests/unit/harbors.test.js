/**
 * Unit Tests for Harbors Module (harbors.ts)
 *
 * Tests harbor creation, member management, expiry cleanup, and
 * the advisory enforcement model (v1 — like file claims, not enforced).
 *
 * Each test runs with a fresh in-memory database for full isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createHarbors } from '../../lib/harbors.js';

describe('Harbors Module', () => {
  let db;
  let harbors;

  beforeEach(() => {
    db = createTestDb();
    harbors = createHarbors(db);
  });

  afterEach(() => {
    if (db) db.close();
  });

  // ─── Create ───────────────────────────────────────────────────────────────

  describe('create (12 tests)', () => {
    it('should create a harbor with minimal options', () => {
      const result = harbors.create('myapp:security-review');

      expect(result.success).toBe(true);
      expect(result.harbor).toBeDefined();
      expect(result.harbor.name).toBe('myapp:security-review');
      expect(result.harbor.capabilities).toEqual([]);
      expect(result.harbor.channels).toEqual([]);
      expect(result.harbor.agentPatterns).toEqual([]);
      expect(result.harbor.members).toEqual([]);
      expect(result.harbor.expiresAt).toBeNull();
    });

    it('should create a harbor with all options', () => {
      const result = harbors.create('myapp:full', {
        capabilities: ['code:read', 'security:scan'],
        channels: ['alerts', 'reports'],
        agentPatterns: ['myapp:*'],
        expiresIn: 3_600_000,
        metadata: { created_by: 'test' },
      });

      expect(result.success).toBe(true);
      expect(result.harbor.capabilities).toEqual(['code:read', 'security:scan']);
      expect(result.harbor.channels).toEqual(['alerts', 'reports']);
      expect(result.harbor.agentPatterns).toEqual(['myapp:*']);
      expect(result.harbor.expiresAt).toBeGreaterThan(Date.now());
      expect(result.harbor.metadata).toEqual({ created_by: 'test' });
    });

    it('should reject empty harbor name', () => {
      const result = harbors.create('');
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('should reject harbor name that is too long', () => {
      const result = harbors.create('a'.repeat(121));
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/too long/);
    });

    it('should reject harbor name with invalid characters', () => {
      const invalidNames = ['my harbor', 'my@harbor', 'my#harbor', 'my!harbor'];
      for (const name of invalidNames) {
        const result = harbors.create(name);
        expect(result.success).toBe(false);
        expect(result.error).toBeTruthy();
      }
    });

    it('should accept harbor names with valid special chars', () => {
      const validNames = [
        'myapp:security',
        'myapp/security',
        'myapp.security',
        'myapp_security',
        'myapp-security',
        'a:b:c/d.e-f_g',
      ];
      for (const name of validNames) {
        const result = harbors.create(name);
        expect(result.success).toBe(true);
        // Clean up for isolation
        harbors.destroy(name);
      }
    });

    it('should silently no-op on duplicate name (INSERT OR IGNORE)', () => {
      harbors.create('myapp:dup', { capabilities: ['code:read'] });

      // Second create with different caps — should not replace (OR IGNORE)
      const result = harbors.create('myapp:dup', { capabilities: ['code:write'] });

      // The INSERT OR IGNORE means the second call quietly does nothing.
      // Routes prevent this reaching the DB (409 if exists), but at DB level
      // this is safe — no CASCADE delete of members.
      const got = harbors.get('myapp:dup');
      expect(got).not.toBeNull();
      // Original capabilities preserved (OR IGNORE didn't overwrite)
      expect(got.capabilities).toEqual(['code:read']);
    });

    it('should set createdAt to current time', () => {
      const before = Date.now();
      const result = harbors.create('myapp:ts');
      const after = Date.now();

      expect(result.harbor.createdAt).toBeGreaterThanOrEqual(before);
      expect(result.harbor.createdAt).toBeLessThanOrEqual(after);
    });

    it('should set expiresAt correctly for expiresIn', () => {
      const before = Date.now();
      const result = harbors.create('myapp:exp', { expiresIn: 60_000 });
      const after = Date.now();

      expect(result.harbor.expiresAt).toBeGreaterThanOrEqual(before + 60_000);
      expect(result.harbor.expiresAt).toBeLessThanOrEqual(after + 60_000);
    });

    it('should have null expiresAt when no expiresIn', () => {
      const result = harbors.create('myapp:noexp');
      expect(result.harbor.expiresAt).toBeNull();
    });

    it('should create multiple harbors independently', () => {
      harbors.create('myapp:harbor-a');
      harbors.create('myapp:harbor-b');
      harbors.create('myapp:harbor-c');

      const list = harbors.list();
      const names = list.map(h => h.name);
      expect(names).toContain('myapp:harbor-a');
      expect(names).toContain('myapp:harbor-b');
      expect(names).toContain('myapp:harbor-c');
    });

    it('should return members array (empty on creation)', () => {
      const result = harbors.create('myapp:empty');
      expect(Array.isArray(result.harbor.members)).toBe(true);
      expect(result.harbor.members.length).toBe(0);
    });
  });

  // ─── Get ──────────────────────────────────────────────────────────────────

  describe('get (4 tests)', () => {
    it('should return null for non-existent harbor', () => {
      const result = harbors.get('does:not:exist');
      expect(result).toBeNull();
    });

    it('should return harbor with members included', () => {
      harbors.create('myapp:with-members');
      harbors.enter('myapp:with-members', 'agent-1', { capabilities: ['code:read'] });
      harbors.enter('myapp:with-members', 'agent-2');

      const result = harbors.get('myapp:with-members');
      expect(result).not.toBeNull();
      expect(result.members.length).toBe(2);
      expect(result.members.map(m => m.agentId)).toContain('agent-1');
      expect(result.members.map(m => m.agentId)).toContain('agent-2');
    });

    it('should return harbor without members if none joined', () => {
      harbors.create('myapp:empty-get');
      const result = harbors.get('myapp:empty-get');
      expect(result.members).toEqual([]);
    });

    it('should return correct metadata on get', () => {
      harbors.create('myapp:meta', { metadata: { owner: 'alice', priority: 1 } });
      const result = harbors.get('myapp:meta');
      expect(result.metadata).toEqual({ owner: 'alice', priority: 1 });
    });
  });

  // ─── List ─────────────────────────────────────────────────────────────────

  describe('list (5 tests)', () => {
    it('should return empty array when no harbors', () => {
      const result = harbors.list();
      expect(result).toEqual([]);
    });

    it('should return all active harbors', () => {
      harbors.create('myapp:a');
      harbors.create('myapp:b');
      const result = harbors.list();
      expect(result.length).toBe(2);
    });

    it('should respect limit parameter', () => {
      for (let i = 0; i < 5; i++) harbors.create(`myapp:h${i}`);
      const result = harbors.list(3);
      expect(result.length).toBe(3);
    });

    it('should auto-clean expired harbors before listing', () => {
      harbors.create('myapp:expired', { expiresIn: -1 }); // already expired
      harbors.create('myapp:active');

      const result = harbors.list();
      const names = result.map(h => h.name);
      expect(names).not.toContain('myapp:expired');
      expect(names).toContain('myapp:active');
    });

    it('should order by created_at desc (newest first)', () => {
      harbors.create('myapp:first');
      // Simulate time passing by direct insert with later timestamp
      harbors.create('myapp:second');
      const result = harbors.list();
      // Both should be there; newest (second) should be first
      expect(result[0].name).toBe('myapp:second');
    });
  });

  // ─── Destroy ──────────────────────────────────────────────────────────────

  describe('destroy (4 tests)', () => {
    it('should destroy an existing harbor', () => {
      harbors.create('myapp:to-destroy');
      const result = harbors.destroy('myapp:to-destroy');

      expect(result.success).toBe(true);
      expect(harbors.get('myapp:to-destroy')).toBeNull();
    });

    it('should fail gracefully when harbor not found', () => {
      const result = harbors.destroy('does:not:exist');
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('should cascade-delete members when harbor is destroyed', () => {
      harbors.create('myapp:cascade');
      harbors.enter('myapp:cascade', 'agent-1');
      harbors.enter('myapp:cascade', 'agent-2');

      harbors.destroy('myapp:cascade');

      // Members should be gone (verify via leaveAll no-op)
      const memberships = harbors.memberships('agent-1');
      expect(memberships).toEqual([]);
    });

    it('should not affect other harbors when one is destroyed', () => {
      harbors.create('myapp:keep');
      harbors.create('myapp:delete');
      harbors.destroy('myapp:delete');

      expect(harbors.get('myapp:keep')).not.toBeNull();
    });
  });

  // ─── Enter ────────────────────────────────────────────────────────────────

  describe('enter (7 tests)', () => {
    beforeEach(() => {
      harbors.create('myapp:test-harbor', { capabilities: ['code:read'] });
    });

    it('should add an agent to a harbor', () => {
      const result = harbors.enter('myapp:test-harbor', 'agent-001');

      expect(result.success).toBe(true);
      expect(result.harbor).toBeDefined();
      expect(result.harbor.members.map(m => m.agentId)).toContain('agent-001');
    });

    it('should record agent capabilities on enter', () => {
      harbors.enter('myapp:test-harbor', 'agent-cap', { capabilities: ['code:read', 'code:write'] });

      const harbor = harbors.get('myapp:test-harbor');
      const member = harbor.members.find(m => m.agentId === 'agent-cap');
      expect(member.capabilities).toEqual(['code:read', 'code:write']);
    });

    it('should record agent identity on enter', () => {
      harbors.enter('myapp:test-harbor', 'agent-id', { identity: 'myapp:api:main' });

      const harbor = harbors.get('myapp:test-harbor');
      const member = harbor.members.find(m => m.agentId === 'agent-id');
      expect(member.identity).toBe('myapp:api:main');
    });

    it('should update capabilities on re-enter (INSERT OR REPLACE on members)', () => {
      harbors.enter('myapp:test-harbor', 'agent-re', { capabilities: ['code:read'] });
      harbors.enter('myapp:test-harbor', 'agent-re', { capabilities: ['code:read', 'code:write'] });

      const harbor = harbors.get('myapp:test-harbor');
      const member = harbor.members.find(m => m.agentId === 'agent-re');
      expect(member.capabilities).toEqual(['code:read', 'code:write']);

      // Still only one entry for this agent
      expect(harbor.members.filter(m => m.agentId === 'agent-re').length).toBe(1);
    });

    it('should fail when harbor does not exist', () => {
      const result = harbors.enter('no:such:harbor', 'agent-x');
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('should allow multiple agents in same harbor', () => {
      harbors.enter('myapp:test-harbor', 'agent-a');
      harbors.enter('myapp:test-harbor', 'agent-b');
      harbors.enter('myapp:test-harbor', 'agent-c');

      const harbor = harbors.get('myapp:test-harbor');
      expect(harbor.members.length).toBe(3);
    });

    it('should record joined_at timestamp', () => {
      const before = Date.now();
      harbors.enter('myapp:test-harbor', 'agent-ts');
      const after = Date.now();

      const harbor = harbors.get('myapp:test-harbor');
      const member = harbor.members.find(m => m.agentId === 'agent-ts');
      expect(member.joinedAt).toBeGreaterThanOrEqual(before);
      expect(member.joinedAt).toBeLessThanOrEqual(after);
    });
  });

  // ─── Leave ────────────────────────────────────────────────────────────────

  describe('leave (5 tests)', () => {
    beforeEach(() => {
      harbors.create('myapp:leave-test');
      harbors.enter('myapp:leave-test', 'agent-001');
      harbors.enter('myapp:leave-test', 'agent-002');
    });

    it('should remove agent from harbor', () => {
      const result = harbors.leave('myapp:leave-test', 'agent-001');

      expect(result.success).toBe(true);
      const harbor = harbors.get('myapp:leave-test');
      expect(harbor.members.map(m => m.agentId)).not.toContain('agent-001');
    });

    it('should not affect other members when one leaves', () => {
      harbors.leave('myapp:leave-test', 'agent-001');
      const harbor = harbors.get('myapp:leave-test');
      expect(harbor.members.map(m => m.agentId)).toContain('agent-002');
    });

    it('should fail gracefully when agent is not a member', () => {
      const result = harbors.leave('myapp:leave-test', 'not-a-member');
      expect(result.success).toBe(false);
    });

    it('should fail gracefully when harbor does not exist', () => {
      const result = harbors.leave('no:harbor', 'agent-001');
      expect(result.success).toBe(false);
    });

    it('should leave harbor with empty member list after all leave', () => {
      harbors.leave('myapp:leave-test', 'agent-001');
      harbors.leave('myapp:leave-test', 'agent-002');
      const harbor = harbors.get('myapp:leave-test');
      expect(harbor.members).toEqual([]);
    });
  });

  // ─── LeaveAll (Zombie protocol) ───────────────────────────────────────────

  describe('leaveAll (5 tests)', () => {
    it('should remove agent from all harbors at once', () => {
      harbors.create('myapp:harbor-1');
      harbors.create('myapp:harbor-2');
      harbors.create('myapp:harbor-3');
      harbors.enter('myapp:harbor-1', 'zombie-agent');
      harbors.enter('myapp:harbor-2', 'zombie-agent');
      harbors.enter('myapp:harbor-3', 'zombie-agent');

      harbors.leaveAll('zombie-agent');

      expect(harbors.get('myapp:harbor-1').members).toEqual([]);
      expect(harbors.get('myapp:harbor-2').members).toEqual([]);
      expect(harbors.get('myapp:harbor-3').members).toEqual([]);
    });

    it('should not affect other agents in those harbors', () => {
      harbors.create('myapp:shared');
      harbors.enter('myapp:shared', 'zombie-agent');
      harbors.enter('myapp:shared', 'survivor');

      harbors.leaveAll('zombie-agent');

      const harbor = harbors.get('myapp:shared');
      expect(harbor.members.map(m => m.agentId)).toContain('survivor');
      expect(harbor.members.map(m => m.agentId)).not.toContain('zombie-agent');
    });

    it('should be a no-op for agent not in any harbor', () => {
      // Should not throw
      expect(() => harbors.leaveAll('ghost-agent')).not.toThrow();
    });

    it('should return removed count (number of rows deleted)', () => {
      harbors.create('myapp:l1');
      harbors.create('myapp:l2');
      harbors.enter('myapp:l1', 'multi');
      harbors.enter('myapp:l2', 'multi');

      const removed = harbors.leaveAll('multi');
      expect(removed).toBe(2);
    });

    it('should return 0 removed when agent was not in any harbor', () => {
      const removed = harbors.leaveAll('never-joined');
      expect(removed).toBe(0);
    });
  });

  // ─── Memberships ─────────────────────────────────────────────────────────

  describe('memberships (4 tests)', () => {
    it('should return empty array when agent not in any harbor', () => {
      const result = harbors.memberships('agent-nobody');
      expect(result).toEqual([]);
    });

    it('should return all harbors an agent is in', () => {
      harbors.create('myapp:h1');
      harbors.create('myapp:h2');
      harbors.enter('myapp:h1', 'multi-agent');
      harbors.enter('myapp:h2', 'multi-agent');

      const result = harbors.memberships('multi-agent');
      const names = result.map(h => h.name);
      expect(names).toContain('myapp:h1');
      expect(names).toContain('myapp:h2');
    });

    it('should not include harbors where agent has left', () => {
      harbors.create('myapp:joined-then-left');
      harbors.enter('myapp:joined-then-left', 'leaver');
      harbors.leave('myapp:joined-then-left', 'leaver');

      const result = harbors.memberships('leaver');
      expect(result.map(h => h.name)).not.toContain('myapp:joined-then-left');
    });

    it('should only return harbors for the requested agent', () => {
      harbors.create('myapp:shared');
      harbors.enter('myapp:shared', 'alice');
      harbors.enter('myapp:shared', 'bob');

      const aliceMemberships = harbors.memberships('alice');
      expect(aliceMemberships.every(h => h.name)).toBe(true);
      // Bob should not appear in Alice's memberships (it's harbor list, not member list)
      const bobMemberships = harbors.memberships('bob');
      expect(bobMemberships.length).toBe(1);
    });
  });

  // ─── Expiry ───────────────────────────────────────────────────────────────

  describe('expiry (3 tests)', () => {
    it('should delete expired harbors on list()', () => {
      harbors.create('myapp:expires-now', { expiresIn: -1000 }); // already expired
      harbors.create('myapp:still-valid');

      const result = harbors.list();
      expect(result.map(h => h.name)).not.toContain('myapp:expires-now');
      expect(result.map(h => h.name)).toContain('myapp:still-valid');
    });

    it('should still be gettable before cleanup runs', () => {
      harbors.create('myapp:about-to-expire', { expiresIn: 100_000 });
      const result = harbors.get('myapp:about-to-expire');
      expect(result).not.toBeNull();
    });

    it('should cascade-delete members when expired harbor is cleaned up', () => {
      harbors.create('myapp:exp-with-members', { expiresIn: -1 });
      harbors.enter('myapp:exp-with-members', 'member-agent');

      harbors.list(); // triggers cleanup

      const memberships = harbors.memberships('member-agent');
      expect(memberships.map(h => h.name)).not.toContain('myapp:exp-with-members');
    });
  });

  // ─── Index Coverage ───────────────────────────────────────────────────────

  describe('schema sanity (2 tests)', () => {
    it('should handle large number of harbors within limit', () => {
      for (let i = 0; i < 60; i++) harbors.create(`myapp:bulk-${i}`);
      const result = harbors.list(50);
      expect(result.length).toBe(50);
    });

    it('should handle agent in many harbors (idx_harbor_members_agent)', () => {
      for (let i = 0; i < 10; i++) {
        harbors.create(`myapp:many-${i}`);
        harbors.enter(`myapp:many-${i}`, 'prolific-agent');
      }
      const memberships = harbors.memberships('prolific-agent');
      expect(memberships.length).toBe(10);
    });
  });
});
