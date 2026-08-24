/**
 * Unit Tests for Agent Registry Module (agents.js)
 *
 * Tests agent registration, heartbeats, resource limits, and cleanup.
 * Each test runs with a fresh in-memory database to ensure isolation.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { createTestDb } from '../setup-unit.js';
import {
  createAgents,
  VERIFIED_ACTOR_INBOX_REGISTRATION,
} from '../../lib/agents.js';
import { createServices } from '../../lib/services.js';
import { createLocks } from '../../lib/locks.js';
import { createSessions } from '../../lib/sessions.js';
import { initDatabase } from '../../lib/db.js';

describe('Agents Module', () => {
  let db;
  let agents;
  let services;
  let locks;

  beforeEach(() => {
    db = createTestDb();
    agents = createAgents(db);
    services = createServices(db);
    locks = createLocks(db);
  });

  describe('Registration (10 tests)', () => {
    it('should register a new agent', () => {
      const result = agents.register('my-agent');

      expect(result.success).toBe(true);
      expect(result.agentId).toBe('my-agent');
      expect(result.registered).toBe(true);
      expect(result.message).toBe('agent registered');
    });

    it('should handle re-registration of existing agent', () => {
      agents.register('my-agent');
      const result = agents.register('my-agent');

      expect(result.success).toBe(true);
      expect(result.agentId).toBe('my-agent');
      expect(result.registered).toBe(false);
      expect(result.message).toBe('agent updated');
    });

    it('should store agent metadata correctly', () => {
      const metadata = { version: '1.0', environment: 'test' };
      agents.register('my-agent', { metadata });

      const result = agents.get('my-agent');
      expect(result.success).toBe(true);
      expect(result.agent.metadata).toEqual(metadata);
    });

    it('should set default limits (maxServices, maxLocks)', () => {
      agents.register('my-agent');

      const result = agents.get('my-agent');
      expect(result.agent.maxServices).toBe(50);
      expect(result.agent.maxLocks).toBe(20);
    });

    it('should accept custom limits', () => {
      agents.register('my-agent', {
        maxServices: 100,
        maxLocks: 50
      });

      const result = agents.get('my-agent');
      expect(result.agent.maxServices).toBe(100);
      expect(result.agent.maxLocks).toBe(50);
    });

    it('should reject empty agent ID', () => {
      const result = agents.register('');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/non-empty string/);
    });

    it('should reject invalid agent ID characters', () => {
      const result = agents.register('my@agent!');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/alphanumeric/);
    });

    it('should reject overly long agent ID', () => {
      const longId = 'a'.repeat(101);
      const result = agents.register(longId);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/too long/);
    });

    it('should track registration timestamp', () => {
      const beforeRegister = Date.now();
      agents.register('my-agent');
      const afterRegister = Date.now();

      const result = agents.get('my-agent');
      const registeredAt = result.agent.registeredAt;

      expect(registeredAt).toBeGreaterThanOrEqual(beforeRegister);
      expect(registeredAt).toBeLessThanOrEqual(afterRegister);
    });

    it('should track PID', () => {
      agents.register('my-agent', { pid: 12345 });

      const result = agents.get('my-agent');
      expect(result.agent.pid).toBe(12345);
    });
  });

  describe('Verified actor inbox registration', () => {
    const binding = (actorId = 'actor-canonical', harbor = 'local') => ({
      [VERIFIED_ACTOR_INBOX_REGISTRATION]: { actorId, harbor },
    });

    it('persists and resolves only the server-selected canonical actor endpoint', () => {
      expect(agents.register('actor-canonical', binding())).toEqual(expect.objectContaining({
        success: true,
        agentId: 'actor-canonical',
      }));

      expect(agents.get('actor-canonical').agent.actorInboxBinding).toEqual(expect.objectContaining({
        verified: true,
        actorId: 'actor-canonical',
        harbor: 'local',
        inboxTarget: 'actor-canonical',
      }));
      expect(agents.resolveLiveActorInbox('actor-canonical', 'local')).toEqual({
        success: true,
        binding: expect.objectContaining({
          actorId: 'actor-canonical',
          harbor: 'local',
          inboxTarget: 'actor-canonical',
        }),
      });
    });

    it('rejects a server binding whose actor does not equal the registered endpoint', () => {
      expect(agents.register('fresh-victim-agent', binding('actor-attacker'))).toEqual(expect.objectContaining({
        success: false,
        code: 'ACTOR_INBOX_BINDING_INVALID',
      }));
      expect(agents.get('fresh-victim-agent').success).toBe(false);
    });

    it('prevents raw re-registration from overwriting or refreshing a verified binding', () => {
      agents.register('actor-canonical', binding());
      const original = agents.get('actor-canonical').agent;

      expect(agents.register('actor-canonical', {
        name: 'forged replacement',
        metadata: { actorId: 'victim' },
      })).toEqual(expect.objectContaining({
        success: false,
        code: 'ACTOR_INBOX_CREDENTIAL_REQUIRED',
      }));
      expect(agents.get('actor-canonical').agent).toEqual(expect.objectContaining({
        name: original.name,
        lastHeartbeat: original.lastHeartbeat,
        actorInboxBinding: original.actorInboxBinding,
      }));
    });

    it('prevents raw unregister from deleting a verified binding', () => {
      agents.register('actor-canonical', binding());

      expect(agents.unregister('actor-canonical')).toEqual(expect.objectContaining({
        success: false,
        unregistered: false,
        code: 'ACTOR_INBOX_CREDENTIAL_REQUIRED',
      }));
      expect(agents.resolveLiveActorInbox('actor-canonical', 'local')).toEqual({
        success: true,
        binding: expect.objectContaining({ inboxTarget: 'actor-canonical' }),
      });

      expect(agents.unregister('actor-canonical', binding())).toEqual(expect.objectContaining({
        success: true,
        unregistered: true,
        agentId: 'actor-canonical',
      }));
      expect(agents.resolveLiveActorInbox('actor-canonical', 'local')).toEqual(expect.objectContaining({
        success: false,
        code: 'ACTOR_INBOX_UNBOUND',
      }));
    });

    it('prevents raw final-session teardown from deleting a verified binding', () => {
      agents.register('actor-canonical', binding());

      expect(agents.finalizeSessionAndUnregisterIfNoActiveSessions(
        'actor-canonical',
        () => ({ success: true }),
      )).toEqual(expect.objectContaining({
        success: false,
        unregistered: false,
        code: 'ACTOR_INBOX_CREDENTIAL_REQUIRED',
      }));
      expect(agents.resolveLiveActorInbox('actor-canonical', 'local')).toEqual({
        success: true,
        binding: expect.objectContaining({ inboxTarget: 'actor-canonical' }),
      });
    });

    it('serializes final teardown against a production-shaped concurrent canonical begin', async () => {
      const raceDir = mkdtempSync(join(process.cwd(), '.identity-inbox-race-'));
      const dbPath = join(raceDir, 'registry.db');
      const priorTestDb = process.env.PORT_DADDY_TEST_DB;
      let raceDb;
      let worker;

      try {
        process.env.PORT_DADDY_TEST_DB = dbPath;
        raceDb = initDatabase({ dbPath });
        if (priorTestDb === undefined) delete process.env.PORT_DADDY_TEST_DB;
        else process.env.PORT_DADDY_TEST_DB = priorTestDb;

        raceDb.pragma('busy_timeout = 5000');
        createLocks(raceDb);
        const raceAgents = createAgents(raceDb);
        const raceSessions = createSessions(raceDb);
        const actorId = 'actor-race-canonical';
        expect(raceAgents.register(actorId, {
          identity: 'demo:test:race-canonical',
          ...binding(actorId),
        })).toEqual(expect.objectContaining({ success: true }));
        const predecessor = raceSessions.start('race predecessor', {
          agentId: actorId,
          project: 'demo',
          durable: true,
          metadata: {
            identity: { verified: true, actorId },
            actorInbox: {
              verified: true,
              actorId,
              harbor: 'local',
              inboxTarget: actorId,
            },
          },
        });
        expect(predecessor).toEqual(expect.objectContaining({ success: true }));

        const attempted = new SharedArrayBuffer(4);
        const attemptedView = new Int32Array(attempted);
        worker = new Worker(`
          const { parentPort, workerData } = require('node:worker_threads');
          const Database = require(workerData.betterSqlitePath);
          const db = new Database(workerData.dbPath);
          db.pragma('busy_timeout = 5000');
          const attempted = new Int32Array(workerData.attempted);
          parentPort.postMessage({ ready: true });
          parentPort.once('message', () => {
            Atomics.store(attempted, 0, 1);
            Atomics.notify(attempted, 0);
            try {
              db.transaction(() => {
                const now = Date.now();
                db.prepare(\`
                  INSERT INTO agents (
                    id, registered_at, last_heartbeat,
                    verified_actor_id, verified_actor_harbor, verified_inbox_bound_at
                  ) VALUES (?, ?, ?, ?, 'local', ?)
                  ON CONFLICT(id) DO UPDATE SET
                    last_heartbeat = excluded.last_heartbeat,
                    verified_actor_id = excluded.verified_actor_id,
                    verified_actor_harbor = excluded.verified_actor_harbor,
                    verified_inbox_bound_at = COALESCE(agents.verified_inbox_bound_at, excluded.verified_inbox_bound_at)
                \`).run(workerData.actorId, now, now, workerData.actorId, now);
                db.prepare(\`
                  INSERT INTO sessions (
                    id, purpose, status, phase, agent_id, identity_project,
                    created_at, updated_at, metadata, is_durable
                  ) VALUES (?, 'race successor', 'active', 'in_progress', ?, 'demo', ?, ?, ?, 1)
                \`).run(
                  workerData.successorId,
                  workerData.actorId,
                  now,
                  now,
                  JSON.stringify({
                    identity: { verified: true, actorId: workerData.actorId },
                    actorInbox: {
                      verified: true,
                      actorId: workerData.actorId,
                      harbor: 'local',
                      inboxTarget: workerData.actorId,
                    },
                  }),
                );
              }).immediate();
              parentPort.postMessage({ success: true });
            } catch (error) {
              parentPort.postMessage({ success: false, error: error.message });
            } finally {
              db.close();
            }
          });
        `, {
          eval: true,
          workerData: {
            dbPath,
            actorId,
            successorId: 'session-race-successor',
            attempted,
            betterSqlitePath: join(process.cwd(), 'node_modules', 'better-sqlite3'),
          },
        });

        await new Promise((resolve, reject) => {
          const onError = (error) => reject(error);
          worker.once('error', onError);
          worker.once('message', (message) => {
            worker.off('error', onError);
            expect(message).toEqual({ ready: true });
            resolve();
          });
        });

        const workerResult = new Promise((resolve, reject) => {
          worker.once('error', reject);
          worker.once('message', resolve);
        });
        const finalized = raceAgents.finalizeSessionAndUnregisterIfNoActiveSessions(
          actorId,
          () => {
            const ended = raceSessions.end(predecessor.id, { status: 'completed' });
            worker.postMessage({ begin: true });
            const waitResult = Atomics.wait(attemptedView, 0, 0, 2000);
            expect(['ok', 'not-equal']).toContain(waitResult);
            expect(Atomics.load(attemptedView, 0)).toBe(1);
            return ended;
          },
          binding(actorId),
        );

        expect(finalized).toEqual(expect.objectContaining({
          success: true,
          unregistered: true,
        }));
        expect(await workerResult).toEqual({ success: true });
        expect(raceSessions.get(predecessor.id).session.status).toBe('completed');
        expect(raceSessions.get('session-race-successor').session).toEqual(expect.objectContaining({
          status: 'active',
          agentId: actorId,
        }));
        expect(raceAgents.resolveLiveActorInbox(actorId, 'local')).toEqual({
          success: true,
          binding: expect.objectContaining({
            actorId,
            harbor: 'local',
            inboxTarget: actorId,
          }),
        });
      } finally {
        if (priorTestDb === undefined) delete process.env.PORT_DADDY_TEST_DB;
        else process.env.PORT_DADDY_TEST_DB = priorTestDb;
        if (worker) await worker.terminate();
        if (raceDb?.open) raceDb.close();
        rmSync(raceDir, { recursive: true, force: true });
      }
    }, 15_000);

    it('fails closed for unbound and stale registry rows', () => {
      agents.register('display-only-agent');
      expect(agents.resolveLiveActorInbox('display-only-agent', 'local')).toEqual(expect.objectContaining({
        success: false,
        code: 'ACTOR_INBOX_UNBOUND',
      }));

      agents.register('actor-canonical', binding());
      db.prepare('UPDATE agents SET last_heartbeat = ? WHERE id = ?')
        .run(Date.now() - agents.DEFAULT_CLEANUP_TTL - 1, 'actor-canonical');
      expect(agents.resolveLiveActorInbox('actor-canonical', 'local')).toEqual(expect.objectContaining({
        success: false,
        code: 'ACTOR_INBOX_STALE',
      }));
    });

    it('uses operational liveness rather than the two-minute display TTL', () => {
      agents.register('actor-canonical', binding());
      db.prepare('UPDATE agents SET last_heartbeat = ? WHERE id = ?')
        .run(Date.now() - agents.DEFAULT_AGENT_TTL - 1, 'actor-canonical');
      expect(agents.get('actor-canonical').agent.isActive).toBe(false);
      expect(agents.resolveLiveActorInbox('actor-canonical', 'local')).toEqual({
        success: true,
        binding: expect.objectContaining({ inboxTarget: 'actor-canonical' }),
      });
    });

    it('does not let the same canonical endpoint cross harbor authority', () => {
      agents.register('actor-canonical', binding('actor-canonical', 'tenant-a'));
      expect(agents.register(
        'actor-canonical',
        binding('actor-canonical', 'tenant-b'),
      )).toEqual(expect.objectContaining({
        success: false,
        code: 'ACTOR_INBOX_BINDING_CONFLICT',
      }));
      expect(agents.resolveLiveActorInbox('actor-canonical', 'tenant-b')).toEqual(expect.objectContaining({
        success: false,
        code: 'ACTOR_INBOX_UNBOUND',
      }));
    });
  });

  describe('Heartbeat (8 tests)', () => {
    it('should update heartbeat timestamp', async () => {
      agents.register('my-agent');
      const initialAgent = agents.get('my-agent').agent;

      // Wait a tiny bit to ensure time difference
      await new Promise(r => setTimeout(r, 5));
      const result = agents.heartbeat('my-agent');

      expect(result.success).toBe(true);
      expect(result.lastHeartbeat).toBeGreaterThanOrEqual(initialAgent.lastHeartbeat);
    });

    it('should auto-register on first heartbeat', () => {
      const result = agents.heartbeat('new-agent');

      expect(result.success).toBe(true);
      expect(result.agentId).toBe('new-agent');
      expect(result.message).toBe('agent registered');
    });

    it('should handle multiple rapid heartbeats', () => {
      agents.register('my-agent');
      const hb1 = agents.heartbeat('my-agent').lastHeartbeat;
      const hb2 = agents.heartbeat('my-agent').lastHeartbeat;
      const hb3 = agents.heartbeat('my-agent').lastHeartbeat;

      expect(hb2).toBeGreaterThanOrEqual(hb1);
      expect(hb3).toBeGreaterThanOrEqual(hb2);
    });

    it('should track PID from heartbeat', () => {
      agents.register('my-agent', { pid: 111 });
      agents.heartbeat('my-agent', { pid: 222 });

      const result = agents.get('my-agent');
      expect(result.agent.pid).toBe(222);
    });

    it('should return agent info on heartbeat', () => {
      agents.register('my-agent');
      const result = agents.heartbeat('my-agent');

      expect(result.success).toBe(true);
      expect(result.agentId).toBe('my-agent');
      expect(result.message).toBe('heartbeat recorded');
    });

    it('should return error for invalid agent', () => {
      const result = agents.heartbeat('');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/non-empty string/);
    });

    it('should update existing agent state', async () => {
      agents.register('my-agent', { name: 'Original' });
      const originalHB = agents.get('my-agent').agent.lastHeartbeat;

      // Wait a bit to ensure time difference
      await new Promise(r => setTimeout(r, 10));

      agents.heartbeat('my-agent');
      const newHB = agents.get('my-agent').agent.lastHeartbeat;

      expect(newHB).toBeGreaterThanOrEqual(originalHB);
    });

    it('should work across time boundaries', () => {
      agents.register('my-agent');
      const hb1 = agents.heartbeat('my-agent').lastHeartbeat;
      const hb2 = agents.heartbeat('my-agent').lastHeartbeat;

      expect(hb1).toBeLessThanOrEqual(hb2);
    });
  });

  describe('Resource Limits (8 tests)', () => {
    it('should enforce maxServices limit', () => {
      agents.register('limited-agent', { maxServices: 2 });

      // Claim 2 services with agent metadata - should succeed
      services.claim('limited-agent:svc:1', { metadata: { agent: 'limited-agent' } });
      services.claim('limited-agent:svc:2', { metadata: { agent: 'limited-agent' } });

      // Claim 3rd service - should fail due to agent limit
      const checkAfter2 = agents.canClaimService('limited-agent');
      expect(checkAfter2.allowed).toBe(false);
      expect(checkAfter2.error).toMatch(/service limit/);
    });

    it('should enforce maxLocks limit', () => {
      agents.register('limited-agent', { maxLocks: 2 });

      // Acquire 2 locks - should succeed
      locks.acquire('lock1', { owner: 'limited-agent' });
      locks.acquire('lock2', { owner: 'limited-agent' });

      // Acquire 3rd lock - should fail
      const checkAfter2 = agents.canAcquireLock('limited-agent');
      expect(checkAfter2.allowed).toBe(false);
      expect(checkAfter2.error).toMatch(/lock limit/);
    });

    it('should allow operations within limits', () => {
      agents.register('my-agent', { maxServices: 10, maxLocks: 5 });

      services.claim('my-agent:svc:1', { metadata: { agent: 'my-agent' } });
      const svcCheck = agents.canClaimService('my-agent');

      locks.acquire('lock1', { owner: 'my-agent' });
      const lockCheck = agents.canAcquireLock('my-agent');

      expect(svcCheck.allowed).toBe(true);
      expect(lockCheck.allowed).toBe(true);
    });

    it('should return current counts', () => {
      agents.register('my-agent');

      services.claim('my-agent:svc:1', { metadata: { agent: 'my-agent' } });
      services.claim('my-agent:svc:2', { metadata: { agent: 'my-agent' } });

      const result = agents.canClaimService('my-agent');

      expect(result.current).toBe(2);
      expect(result.max).toBe(50);
    });

    it('should return max limits', () => {
      agents.register('my-agent', { maxServices: 75 });

      const result = agents.canClaimService('my-agent');

      expect(result.max).toBe(75);
    });

    it('should handle edge of limit', () => {
      agents.register('edge-agent', { maxServices: 1 });

      services.claim('edge-agent:svc:1', { metadata: { agent: 'edge-agent' } });
      const atLimit = agents.canClaimService('edge-agent');

      // At the limit (1 claimed, max 1) - cannot claim more
      expect(atLimit.allowed).toBe(false);
      expect(atLimit.current).toBe(1);
      expect(atLimit.max).toBe(1);
    });

    it('should track service claims', () => {
      agents.register('my-agent');

      const before = agents.canClaimService('my-agent').current;
      services.claim('my-agent:svc:1', { metadata: { agent: 'my-agent' } });
      const after = agents.canClaimService('my-agent').current;

      expect(after).toBe(before + 1);
    });

    it('should track lock acquisitions', () => {
      agents.register('my-agent');

      const before = agents.canAcquireLock('my-agent').current;
      locks.acquire('lock1', { owner: 'my-agent' });
      const after = agents.canAcquireLock('my-agent').current;

      expect(after).toBe(before + 1);
    });
  });

  describe('Unregister (4 tests)', () => {
    it('should unregister agent', () => {
      agents.register('my-agent');
      const result = agents.unregister('my-agent');

      expect(result.success).toBe(true);
      expect(result.unregistered).toBe(true);
      expect(result.agentId).toBe('my-agent');
    });

    it('should return error for non-existent agent', () => {
      const result = agents.unregister('nonexistent');

      expect(result.success).toBe(true);
      expect(result.unregistered).toBe(false);
      expect(result.message).toBe('agent not found');
    });

    it('should handle double unregister', () => {
      agents.register('my-agent');
      agents.unregister('my-agent');
      const secondResult = agents.unregister('my-agent');

      expect(secondResult.success).toBe(true);
      expect(secondResult.unregistered).toBe(false);
    });

    it('should clean up agent data', () => {
      agents.register('my-agent');
      agents.unregister('my-agent');

      const result = agents.get('my-agent');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/);
    });
  });

  describe('List and Get (5 tests)', () => {
    it('should list all agents', () => {
      agents.register('agent1');
      agents.register('agent2');
      agents.register('agent3');

      const result = agents.list();

      expect(result.success).toBe(true);
      expect(result.agents).toHaveLength(3);
      expect(result.count).toBe(3);
    });

    it('should filter active agents only', () => {
      agents.register('active-agent');
      agents.register('stale-agent');

      // Manually set stale agent's heartbeat to old timestamp
      const staleTime = Date.now() - (agents.DEFAULT_AGENT_TTL + 10000);
      db.prepare('UPDATE agents SET last_heartbeat = ? WHERE id = ?').run(staleTime, 'stale-agent');

      const result = agents.list({ activeOnly: true });

      expect(result.agents).toHaveLength(1);
      expect(result.agents[0].id).toBe('active-agent');
    });

    it('should get single agent by ID', () => {
      agents.register('my-agent', { name: 'Test Agent' });

      const result = agents.get('my-agent');

      expect(result.success).toBe(true);
      expect(result.agent.id).toBe('my-agent');
      expect(result.agent.name).toBe('Test Agent');
    });

    it('should return error for non-existent agent', () => {
      const result = agents.get('nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/);
    });

    it('should include all agent fields', () => {
      agents.register('my-agent', {
        name: 'Test',
        pid: 12345,
        type: 'worker',
        metadata: { custom: 'value' }
      });

      const result = agents.get('my-agent');
      const agent = result.agent;

      expect(agent.id).toBeDefined();
      expect(agent.name).toBeDefined();
      expect(agent.pid).toBeDefined();
      expect(agent.type).toBeDefined();
      expect(agent.registeredAt).toBeDefined();
      expect(agent.lastHeartbeat).toBeDefined();
      expect(agent.isActive).toBeDefined();
      expect(agent.timeSinceHeartbeat).toBeDefined();
      expect(agent.maxServices).toBeDefined();
      expect(agent.maxLocks).toBeDefined();
      expect(agent.metadata).toBeDefined();
    });
  });

  describe('Additional Coverage Tests', () => {
    it('should accept valid agent IDs with dashes, underscores, and colons', () => {
      const validIds = [
        'my-agent',
        'my_agent',
        'my:agent',
        'my-agent_1:prod',
        'a',
        '0',
        '123-456_789:abc'
      ];

      for (const id of validIds) {
        const result = agents.register(id);
        expect(result.success).toBe(true);
      }
    });

    it('should report isActive correctly for fresh agents', () => {
      agents.register('fresh-agent');
      const result = agents.get('fresh-agent');

      expect(result.agent.isActive).toBe(true);
      expect(result.agent.timeSinceHeartbeat).toBeLessThan(100);
    });

    it('should report isActive as false for stale agents', () => {
      agents.register('stale-agent');

      // Set heartbeat to old time
      const staleTime = Date.now() - (agents.DEFAULT_AGENT_TTL + 10000);
      db.prepare('UPDATE agents SET last_heartbeat = ? WHERE id = ?').run(staleTime, 'stale-agent');

      const result = agents.get('stale-agent');
      expect(result.agent.isActive).toBe(false);
    });

    it('should cleanup stale agents', () => {
      agents.register('agent1');
      agents.register('agent2');

      // Make agent2 old enough to be operationally dead, not merely display-inactive
      const staleTime = Date.now() - (agents.DEFAULT_CLEANUP_TTL + 10000);
      db.prepare('UPDATE agents SET last_heartbeat = ? WHERE id = ?').run(staleTime, 'agent2');

      const result = agents.cleanup(locks);

      expect(result.cleaned).toBe(1);
      expect(result.message).toMatch(/cleaned 1 stale agent/);

      // Verify agent1 still exists
      const agent1Check = agents.get('agent1');
      expect(agent1Check.success).toBe(true);

      // Verify agent2 is gone
      const agent2Check = agents.get('agent2');
      expect(agent2Check.success).toBe(false);
    });

    it('should not cleanup agents that are only display-inactive', () => {
      agents.register('agent1');

      const displayInactiveTime = Date.now() - (agents.DEFAULT_AGENT_TTL + 10000);
      db.prepare('UPDATE agents SET last_heartbeat = ? WHERE id = ?').run(displayInactiveTime, 'agent1');

      const result = agents.cleanup(locks);

      expect(result.cleaned).toBe(0);
      expect(agents.get('agent1').success).toBe(true);
    });

    it('should release locks held by stale agents', () => {
      // Register an agent and acquire a lock as that agent
      agents.register('doomed-agent');
      locks.acquire('agent-lock', { owner: 'doomed-agent', ttl: 600000 });

      // Verify lock exists
      const before = locks.list({ owner: 'doomed-agent' });
      expect(before.locks.length).toBe(1);

      // Make agent old enough for cleanup
      const staleTime = Date.now() - (agents.DEFAULT_CLEANUP_TTL + 10000);
      db.prepare('UPDATE agents SET last_heartbeat = ? WHERE id = ?').run(staleTime, 'doomed-agent');

      // Cleanup should release the lock
      const result = agents.cleanup(locks);
      expect(result.cleaned).toBe(1);
      expect(result.releasedLocks).toBe(1);

      // Verify lock is gone
      const after = locks.check('agent-lock');
      expect(after.held).toBe(false);
    });

    it('should preserve registered_at on re-registration', () => {
      const firstReg = agents.register('my-agent');
      const firstAgent = agents.get('my-agent').agent;
      const registeredAt = firstAgent.registeredAt;

      // Wait and re-register
      agents.heartbeat('my-agent');
      agents.register('my-agent');

      const secondAgent = agents.get('my-agent').agent;
      expect(secondAgent.registeredAt).toBe(registeredAt);
    });

    it('should allow unregistered agents to claim services with defaults', () => {
      // Don't register an agent, just try to claim a service
      const result = agents.canClaimService('unregistered');

      expect(result.allowed).toBe(true);
      // Unregistered agents only return allowed: true, not max/current counts
    });

    it('should allow unregistered agents to acquire locks with defaults', () => {
      const result = agents.canAcquireLock('unregistered');

      expect(result.allowed).toBe(true);
      // Unregistered agents only return allowed: true, not max/current counts
    });

    it('should list agents sorted by most recent heartbeat', () => {
      agents.register('agent1');
      agents.register('agent2');

      // Agent 1 should have more recent heartbeat
      db.prepare('UPDATE agents SET last_heartbeat = ? WHERE id = ?').run(
        Date.now() - 5000,
        'agent1'
      );

      const result = agents.list();

      // Most recent should be first
      expect(result.agents[0].id).toBe('agent2');
      expect(result.agents[1].id).toBe('agent1');
    });

    it('should handle null metadata gracefully', () => {
      agents.register('my-agent', { metadata: null });

      const result = agents.get('my-agent');
      expect(result.agent.metadata).toBeNull();
    });

    it('should handle complex metadata objects', () => {
      const complexMetadata = {
        version: '1.0.0',
        features: ['auth', 'api', 'database'],
        config: {
          nested: {
            deep: 'value'
          }
        },
        tags: ['production', 'critical']
      };

      agents.register('my-agent', { metadata: complexMetadata });

      const result = agents.get('my-agent');
      expect(result.agent.metadata).toEqual(complexMetadata);
    });

    it('should not allow non-string agent IDs', () => {
      const result = agents.register(12345);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/non-empty string/);
    });

    it('should not allow null agent IDs', () => {
      const result = agents.register(null);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/non-empty string/);
    });

    it('should handle type parameter correctly', () => {
      agents.register('my-agent', { type: 'worker' });

      const result = agents.get('my-agent');
      expect(result.agent.type).toBe('worker');
    });

    it('should default type to cli', () => {
      agents.register('my-agent');

      const result = agents.get('my-agent');
      expect(result.agent.type).toBe('cli');
    });
  });

  describe('Input Validation - maxServices and maxLocks (Bug #26)', () => {
    it('should reject string maxServices', () => {
      const result = agents.register('my-agent', { maxServices: 'invalid' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('maxServices must be a positive integer');
      expect(result.code).toBe('VALIDATION_ERROR');
    });

    it('should reject string maxLocks', () => {
      const result = agents.register('my-agent', { maxLocks: 'invalid' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('maxLocks must be a positive integer');
      expect(result.code).toBe('VALIDATION_ERROR');
    });

    it('should reject negative maxServices', () => {
      const result = agents.register('my-agent', { maxServices: -5 });

      expect(result.success).toBe(false);
      expect(result.error).toBe('maxServices must be a positive integer');
    });

    it('should reject negative maxLocks', () => {
      const result = agents.register('my-agent', { maxLocks: -10 });

      expect(result.success).toBe(false);
      expect(result.error).toBe('maxLocks must be a positive integer');
    });

    it('should reject zero maxServices', () => {
      const result = agents.register('my-agent', { maxServices: 0 });

      expect(result.success).toBe(false);
      expect(result.error).toBe('maxServices must be a positive integer');
    });

    it('should reject zero maxLocks', () => {
      const result = agents.register('my-agent', { maxLocks: 0 });

      expect(result.success).toBe(false);
      expect(result.error).toBe('maxLocks must be a positive integer');
    });

    it('should reject float maxServices', () => {
      const result = agents.register('my-agent', { maxServices: 5.5 });

      expect(result.success).toBe(false);
      expect(result.error).toBe('maxServices must be a positive integer');
    });

    it('should reject float maxLocks', () => {
      const result = agents.register('my-agent', { maxLocks: 10.5 });

      expect(result.success).toBe(false);
      expect(result.error).toBe('maxLocks must be a positive integer');
    });

    it('should reject object maxServices', () => {
      const result = agents.register('my-agent', { maxServices: { value: 10 } });

      expect(result.success).toBe(false);
      expect(result.error).toBe('maxServices must be a positive integer');
    });

    it('should reject array maxLocks', () => {
      const result = agents.register('my-agent', { maxLocks: [20] });

      expect(result.success).toBe(false);
      expect(result.error).toBe('maxLocks must be a positive integer');
    });

    it('should accept valid positive integers', () => {
      const result = agents.register('my-agent', { maxServices: 100, maxLocks: 50 });

      expect(result.success).toBe(true);
      expect(result.agentId).toBe('my-agent');

      const agent = agents.get('my-agent').agent;
      expect(agent.maxServices).toBe(100);
      expect(agent.maxLocks).toBe(50);
    });

    it('should accept 1 as minimum valid value', () => {
      const result = agents.register('my-agent', { maxServices: 1, maxLocks: 1 });

      expect(result.success).toBe(true);

      const agent = agents.get('my-agent').agent;
      expect(agent.maxServices).toBe(1);
      expect(agent.maxLocks).toBe(1);
    });

    it('should use defaults when not provided', () => {
      const result = agents.register('my-agent');

      expect(result.success).toBe(true);

      const agent = agents.get('my-agent').agent;
      expect(agent.maxServices).toBe(50);  // DEFAULT_MAX_SERVICES_PER_AGENT
      expect(agent.maxLocks).toBe(20);     // DEFAULT_MAX_LOCKS_PER_AGENT
    });
  });
});
