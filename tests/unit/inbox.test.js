/**
 * Unit Tests for Agent Inbox Module (agent-inbox.ts)
 *
 * Tests the per-agent direct messaging system:
 * - Send messages to agent inboxes
 * - Read messages (all, unread-only, since timestamp)
 * - Mark messages as read (individual and bulk)
 * - Clear inbox
 * - Inbox stats
 * - Cleanup old messages
 * - Adversarial inputs: SQL injection, unicode, oversized messages
 * - Multiple agents with independent inboxes
 *
 * Each test runs with a fresh in-memory database to ensure isolation.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  createAgentInbox,
  inboxMessageForMessaging,
  INBOX_DELIVERY_CLEANUP_BATCH,
  MAX_INBOX_DELIVERY_KEY_CHARS,
} from '../../lib/agent-inbox.js';

describe('Agent Inbox Module', () => {
  let db;
  let inbox;

  beforeEach(() => {
    db = createTestDb();
    inbox = createAgentInbox(db);
  });

  // ======================================================================
  // SEND — DELIVER MESSAGE TO AGENT INBOX
  // ======================================================================
  describe('send()', () => {
    it('should send a message to an agent inbox', () => {
      const result = inbox.send('agent-1', 'Hello from agent-2');

      expect(result.success).toBe(true);
      expect(result.messageId).toBeDefined();
      expect(typeof result.messageId).toBe('number');
      expect(result.agentId).toBe('agent-1');
    });

    it('should accept optional from field', () => {
      const result = inbox.send('agent-1', 'Hello', { from: 'agent-sender' });
      expect(result.success).toBe(true);

      const messages = inbox.list('agent-1');
      expect(messages.messages[0].from).toBe('agent-sender');
    });

    it('should accept optional type field', () => {
      const result = inbox.send('agent-1', 'Alert!', { type: 'alert' });
      expect(result.success).toBe(true);

      const messages = inbox.list('agent-1');
      expect(messages.messages[0].type).toBe('alert');
    });

    it('should default type to message', () => {
      inbox.send('agent-1', 'Default type');

      const messages = inbox.list('agent-1');
      expect(messages.messages[0].type).toBe('message');
    });

    it('should default from to null', () => {
      inbox.send('agent-1', 'Anonymous message');

      const messages = inbox.list('agent-1');
      expect(messages.messages[0].from).toBeNull();
    });

    it('should mark new messages as unread', () => {
      inbox.send('agent-1', 'Unread message');

      const messages = inbox.list('agent-1');
      expect(messages.messages[0].read).toBe(false);
    });

    it('should fail when agentId is empty', () => {
      const result = inbox.send('', 'Message');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/required/);
    });

    it('should fail when content is empty', () => {
      const result = inbox.send('agent-1', '');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/required/);
    });

    it('should fail when agentId is null/undefined', () => {
      const result = inbox.send(null, 'Message');
      expect(result.success).toBe(false);
    });

    it('should fail when content is null/undefined', () => {
      const result = inbox.send('agent-1', null);
      expect(result.success).toBe(false);
    });

    it('should assign sequential message IDs', () => {
      const r1 = inbox.send('agent-1', 'First');
      const r2 = inbox.send('agent-1', 'Second');

      expect(r2.messageId).toBeGreaterThan(r1.messageId);
    });

    it('replays an identical delivery key as the same message without notifying twice', () => {
      const delivered = [];
      const keyedInbox = createAgentInbox(db, (_agentId, message) => delivered.push(message));
      const options = { from: 'agent-a', type: 'parley_summons', contentType: 'json', deliveryKey: 'summons:1' };
      const first = keyedInbox.internal.sendOnce('agent-b', { parleyId: 'p1' }, options);
      const replay = keyedInbox.internal.sendOnce('agent-b', { parleyId: 'p1' }, options);

      expect(first).toMatchObject({ success: true, replayed: false });
      expect(replay).toEqual({ ...first, replayed: true });
      expect(delivered).toHaveLength(1);
      expect(keyedInbox.list('agent-b').messages[0].deliveryKey).toBe('summons:1');
    });

    it('treats reordered JSON object keys as the same canonical full message', () => {
      const options = {
        from: 'agent-a',
        type: 'parley_summons',
        contentType: 'json',
        deliveryKey: 'summons:canonical-json',
      };
      const first = inbox.internal.sendOnce('agent-b', {
        parleyId: 'p1',
        nested: { z: 3, a: 1 },
      }, options);
      const replay = inbox.internal.sendOnce('agent-b', {
        nested: { a: 1, z: 3 },
        parleyId: 'p1',
      }, options);

      expect(replay).toMatchObject({ success: true, messageId: first.messageId, replayed: true });
      expect(inbox.list('agent-b').messages).toHaveLength(1);
    });

    it('keeps unkeyed JSON delivery non-idempotent and preserves string storage', () => {
      const first = inbox.send('agent-b', '{"z":2,"a":1}', { contentType: 'json' });
      const second = inbox.send('agent-b', '{"a":1,"z":2}', { contentType: 'json' });

      expect(first.messageId).not.toBe(second.messageId);
      expect(inbox.list('agent-b').messages).toHaveLength(2);
      expect(db.prepare('SELECT content FROM agent_inbox WHERE id = ?').get(first.messageId).content)
        .toBe('{"z":2,"a":1}');
    });

    it('refuses ordinary-send poisoning of a predictable internal delivery key', () => {
      const key = 'parley_summons:parley-auto:known:agent-b';
      const poisonAttempts = [
        inbox.send('agent-b', 'poison', { signal: key }),
        inbox.send('agent-b', 'poison', { deliveryKey: key }),
        inbox.send('agent-b', 'poison', { idempotencyKey: key }),
      ];
      const delivered = inbox.internal.sendOnce('agent-b', 'legitimate', { deliveryKey: key });

      expect(poisonAttempts).toEqual(Array(3).fill(expect.objectContaining({
        success: false,
        code: 'INTERNAL_DELIVERY_KEY_FORBIDDEN',
      })));
      expect(delivered).toMatchObject({ success: true, replayed: false });
      expect(inbox.list('agent-b').messages).toEqual([
        expect.objectContaining({ content: 'legitimate', deliveryKey: key }),
      ]);
    });

    it('projects internal delivery identity as maritime report for messaging callbacks', () => {
      const delivered = [];
      const publishingInbox = createAgentInbox(db, (_agentId, message) => {
        delivered.push(inboxMessageForMessaging(message));
      });
      publishingInbox.internal.sendOnce('agent-b', 'summons', {
        deliveryKey: 'parley_summons:p1:agent-b',
      });

      expect(delivered).toEqual([
        expect.objectContaining({
          signal: 'report',
        }),
      ]);
      expect(delivered[0]).not.toHaveProperty('deliveryKey');
      const inboxColumns = db.prepare('PRAGMA table_info(agent_inbox)').all().map((row) => row.name);
      const deliveryColumns = db.prepare('PRAGMA table_info(agent_inbox_deliveries)').all().map((row) => row.name);
      expect(inboxColumns).toContain('delivery_key');
      expect(inboxColumns).not.toContain('signal');
      expect(deliveryColumns).toContain('delivery_key');
      expect(deliveryColumns).not.toContain('signal');
      expect(db.prepare('SELECT delivery_key FROM agent_inbox WHERE agent_id = ?').get('agent-b'))
        .toEqual({ delivery_key: 'parley_summons:p1:agent-b' });
    });

    it('keeps a body-free tombstone across clear, cleanup, and a restarted instance', () => {
      const first = inbox.internal.sendOnce('agent-b', { parleyId: 'p1' }, {
        contentType: 'json',
        deliveryKey: 'survives-delete',
      });
      inbox.clear('agent-b');
      inbox.cleanup(0);
      const restarted = createAgentInbox(db);
      const replay = restarted.internal.sendOnce('agent-b', { parleyId: 'p1' }, {
        contentType: 'json',
        deliveryKey: 'survives-delete',
      });

      expect(replay).toMatchObject({ success: true, messageId: first.messageId, replayed: true });
      expect(restarted.list('agent-b').messages).toHaveLength(0);
      const columns = db.prepare('PRAGMA table_info(agent_inbox_deliveries)').all().map((row) => row.name);
      expect(columns).not.toContain('content');
    });

    it('bounds expired-ledger cleanup performed by one send', () => {
      const insert = db.prepare(`
        INSERT INTO agent_inbox_deliveries
          (agent_id, delivery_key, fingerprint, message_id, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      const seed = db.transaction(() => {
        for (let index = 0; index < INBOX_DELIVERY_CLEANUP_BATCH * 3; index++) {
          insert.run(`expired-${index}`, `key-${index}`, 'fingerprint', index + 1, 1, 1);
        }
      });
      seed();

      expect(inbox.send('agent-live', 'bounded cleanup')).toMatchObject({ success: true });
      const remaining = db.prepare('SELECT COUNT(*) AS count FROM agent_inbox_deliveries').get().count;
      expect(remaining).toBe(INBOX_DELIVERY_CLEANUP_BATCH * 2);
    });

    it('reuses an expired requested key outside the bounded background batch', () => {
      const insert = db.prepare(`
        INSERT INTO agent_inbox_deliveries
          (agent_id, delivery_key, fingerprint, message_id, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      const total = INBOX_DELIVERY_CLEANUP_BATCH * 3;
      const seed = db.transaction(() => {
        for (let index = 0; index < total; index++) {
          insert.run(`expired-${index}`, `key-${index}`, 'old-fingerprint', index + 1, 1, 1);
        }
      });
      seed();
      const target = total - 1;

      const delivered = inbox.internal.sendOnce(`expired-${target}`, 'fresh', {
        deliveryKey: `key-${target}`,
      });
      expect(delivered).toMatchObject({ success: true, replayed: false });
      const reservation = db.prepare(`
        SELECT * FROM agent_inbox_deliveries WHERE agent_id = ? AND delivery_key = ?
      `).get(`expired-${target}`, `key-${target}`);
      expect(reservation.expires_at).toBeGreaterThan(Date.now());
      expect(reservation.fingerprint).not.toBe('old-fingerprint');
      expect(db.prepare('SELECT COUNT(*) AS count FROM agent_inbox_deliveries').get().count)
        .toBe(INBOX_DELIVERY_CLEANUP_BATCH * 2);
    });

    it.each([
      ['body', { content: { parleyId: 'p2' } }],
      ['from', { options: { from: 'agent-c' } }],
      ['type', { options: { type: 'different' } }],
    ])('fails visibly when the same delivery key changes %s', (_field, mutation) => {
      const baseOptions = {
        from: 'agent-a',
        type: 'parley_summons',
        contentType: 'json',
        deliveryKey: 'summons:conflict',
      };
      inbox.internal.sendOnce('agent-b', { parleyId: 'p1' }, baseOptions);
      const result = inbox.internal.sendOnce(
        'agent-b',
        mutation.content ?? { parleyId: 'p1' },
        { ...baseOptions, ...(mutation.options ?? {}) },
      );

      expect(result.success).toBe(false);
      expect(result.code).toBe('IDEMPOTENCY_CONFLICT');
      expect(result.error).toMatch(/different message/);
      expect(inbox.list('agent-b').messages).toHaveLength(1);
    });

    it('resolves a delivery-key replay before inbox-full refusal', () => {
      const options = { deliveryKey: 'survives-full' };
      const first = inbox.internal.sendOnce('full-agent', 'original', options);
      for (let i = 1; i < inbox.MAX_INBOX_MESSAGES; i++) {
        expect(inbox.send('full-agent', `message-${i}`).success).toBe(true);
      }

      const replay = inbox.internal.sendOnce('full-agent', 'original', options);
      expect(replay).toMatchObject({ success: true, messageId: first.messageId, replayed: true });
      expect(inbox.send('full-agent', 'new')).toMatchObject({
        success: false,
        code: 'RESOURCE_LIMIT',
      });
    });

    it('is atomic across inbox instances on separate SQLite connections', () => {
      const dir = mkdtempSync(join(process.cwd(), '.test-inbox-delivery-key-'));
      const path = join(dir, 'inbox.db');
      const dbA = new Database(path);
      const dbB = new Database(path);
      const deliveredA = [];
      const deliveredB = [];
      try {
        const inboxA = createAgentInbox(dbA, (_agentId, message) => deliveredA.push(message.id));
        const inboxB = createAgentInbox(dbB, (_agentId, message) => deliveredB.push(message.id));
        const options = { from: 'system', type: 'notice', deliveryKey: 'cross-instance' };

        const first = inboxA.internal.sendOnce('agent-a', 'same', options);
        const replay = inboxB.internal.sendOnce('agent-a', 'same', options);

        expect(first.success).toBe(true);
        expect(replay).toMatchObject({ success: true, messageId: first.messageId, replayed: true });
        expect(inboxA.list('agent-a').messages).toHaveLength(1);
        expect(deliveredA).toEqual([first.messageId]);
        expect(deliveredB).toEqual([]);
      } finally {
        dbA.close();
        dbB.close();
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('rejects empty and over-limit delivery keys without truncating', () => {
      expect(inbox.internal.sendOnce('agent-a', 'x', { deliveryKey: ' ' })).toMatchObject({ success: false });
      expect(inbox.internal.sendOnce('agent-a', 'x', {
        deliveryKey: 'k'.repeat(MAX_INBOX_DELIVERY_KEY_CHARS + 1),
      })).toMatchObject({ success: false });
      expect(inbox.stats('agent-a').total).toBe(0);
    });
  });

  it('adds persisted delivery-key uniqueness to an existing inbox schema', () => {
    const legacyDb = createTestDb();
    try {
      legacyDb.exec(`
        CREATE TABLE agent_inbox (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_id TEXT NOT NULL,
          from_agent TEXT,
          content TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'message',
          read INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        )
      `);
      const migrated = createAgentInbox(legacyDb);
      const columns = legacyDb.prepare('PRAGMA table_info(agent_inbox)').all().map((column) => column.name);
      const indexes = legacyDb.prepare('PRAGMA index_list(agent_inbox)').all().map((index) => index.name);

      const first = migrated.internal.sendOnce('agent-a', 'hello', { deliveryKey: 'migration' });
      const replay = migrated.internal.sendOnce('agent-a', 'hello', { deliveryKey: 'migration' });
      expect(columns).toContain('delivery_key');
      expect(columns).not.toContain('signal');
      expect(indexes).toContain('idx_agent_inbox_agent_delivery_key');
      expect(replay.messageId).toBe(first.messageId);
    } finally {
      legacyDb.close();
    }
  });

  // ======================================================================
  // LIST — READ MESSAGES FROM INBOX
  // ======================================================================
  describe('list()', () => {
    it('should list all messages for an agent', () => {
      inbox.send('agent-1', 'Message 1');
      inbox.send('agent-1', 'Message 2');
      inbox.send('agent-1', 'Message 3');

      const result = inbox.list('agent-1');
      expect(result.success).toBe(true);
      expect(result.count).toBe(3);
    });

    it('should return messages in descending order (newest first)', () => {
      inbox.send('agent-1', 'First');
      inbox.send('agent-1', 'Second');
      inbox.send('agent-1', 'Third');

      const result = inbox.list('agent-1');
      expect(result.messages[0].content).toBe('Third');
      expect(result.messages[2].content).toBe('First');
    });

    it('should return empty list for agent with no messages', () => {
      const result = inbox.list('empty-agent');
      expect(result.success).toBe(true);
      expect(result.count).toBe(0);
      expect(result.messages).toEqual([]);
    });

    it('should respect limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        inbox.send('agent-1', `Message ${i}`);
      }

      const result = inbox.list('agent-1', { limit: 3 });
      expect(result.count).toBe(3);
    });

    it('should default limit to 50', () => {
      for (let i = 0; i < 60; i++) {
        inbox.send('agent-1', `Message ${i}`);
      }

      const result = inbox.list('agent-1');
      expect(result.count).toBe(50);
    });

    it('should filter unread-only messages', () => {
      const r1 = inbox.send('agent-1', 'Read this');
      inbox.send('agent-1', 'Unread');
      inbox.markRead('agent-1', r1.messageId);

      const result = inbox.list('agent-1', { unreadOnly: true });
      expect(result.count).toBe(1);
      expect(result.messages[0].content).toBe('Unread');
    });

    it('should filter messages since a timestamp', () => {
      inbox.send('agent-1', 'Old message');

      // Backdate the first message
      db.prepare('UPDATE agent_inbox SET created_at = ? WHERE content = ?')
        .run(Date.now() - 100000, 'Old message');

      const since = Date.now() - 5000;
      inbox.send('agent-1', 'New message');

      const result = inbox.list('agent-1', { since });
      expect(result.count).toBe(1);
      expect(result.messages[0].content).toBe('New message');
    });

    it('should format message correctly with all fields', () => {
      inbox.send('agent-1', 'Test content', { from: 'sender', type: 'alert' });

      const result = inbox.list('agent-1');
      const msg = result.messages[0];

      expect(msg.id).toBeDefined();
      expect(msg.agentId).toBe('agent-1');
      expect(msg.from).toBe('sender');
      expect(msg.content).toBe('Test content');
      expect(msg.type).toBe('alert');
      expect(msg.read).toBe(false);
      expect(msg.createdAt).toBeDefined();
      expect(typeof msg.createdAt).toBe('number');
    });
  });

  // ======================================================================
  // MARK READ — INDIVIDUAL MESSAGE
  // ======================================================================
  describe('markRead()', () => {
    it('should mark a specific message as read', () => {
      const sent = inbox.send('agent-1', 'Read me');

      const result = inbox.markRead('agent-1', sent.messageId);
      expect(result.success).toBe(true);

      const messages = inbox.list('agent-1');
      expect(messages.messages[0].read).toBe(true);
    });

    it('should not affect other messages', () => {
      const r1 = inbox.send('agent-1', 'Read');
      inbox.send('agent-1', 'Unread');

      inbox.markRead('agent-1', r1.messageId);

      const messages = inbox.list('agent-1', { unreadOnly: true });
      expect(messages.count).toBe(1);
      expect(messages.messages[0].content).toBe('Unread');
    });

    it('should succeed even for non-existent message (no-op)', () => {
      const result = inbox.markRead('agent-1', 999999);
      expect(result.success).toBe(true);
    });
  });

  // ======================================================================
  // MARK ALL READ — BULK OPERATION
  // ======================================================================
  describe('markAllRead()', () => {
    it('should mark all messages as read', () => {
      inbox.send('agent-1', 'Message 1');
      inbox.send('agent-1', 'Message 2');
      inbox.send('agent-1', 'Message 3');

      const result = inbox.markAllRead('agent-1');
      expect(result.success).toBe(true);
      expect(result.marked).toBe(3);

      const unread = inbox.list('agent-1', { unreadOnly: true });
      expect(unread.count).toBe(0);
    });

    it('should return 0 marked when inbox is empty', () => {
      const result = inbox.markAllRead('empty-agent');
      expect(result.success).toBe(true);
      expect(result.marked).toBe(0);
    });

    it('should only mark unread messages (idempotent)', () => {
      inbox.send('agent-1', 'Message 1');
      inbox.send('agent-1', 'Message 2');

      inbox.markAllRead('agent-1');
      const result = inbox.markAllRead('agent-1');
      expect(result.marked).toBe(0); // Already read
    });
  });

  // ======================================================================
  // CLEAR — DELETE ALL INBOX MESSAGES
  // ======================================================================
  describe('clear()', () => {
    it('should delete all messages for an agent', () => {
      inbox.send('agent-1', 'Message 1');
      inbox.send('agent-1', 'Message 2');

      const result = inbox.clear('agent-1');
      expect(result.success).toBe(true);
      expect(result.deleted).toBe(2);

      const messages = inbox.list('agent-1');
      expect(messages.count).toBe(0);
    });

    it('should return 0 deleted for empty inbox', () => {
      const result = inbox.clear('empty-agent');
      expect(result.success).toBe(true);
      expect(result.deleted).toBe(0);
    });

    it('should not affect other agents inboxes', () => {
      inbox.send('agent-1', 'Agent 1 message');
      inbox.send('agent-2', 'Agent 2 message');

      inbox.clear('agent-1');

      const agent2Messages = inbox.list('agent-2');
      expect(agent2Messages.count).toBe(1);
    });
  });

  // ======================================================================
  // STATS — INBOX STATISTICS
  // ======================================================================
  describe('stats()', () => {
    it('should return total and unread counts', () => {
      inbox.send('agent-1', 'Message 1');
      inbox.send('agent-1', 'Message 2');
      const r3 = inbox.send('agent-1', 'Message 3');

      inbox.markRead('agent-1', r3.messageId);

      const result = inbox.stats('agent-1');
      expect(result.success).toBe(true);
      expect(result.total).toBe(3);
      expect(result.unread).toBe(2);
    });

    it('should return 0/0 for agent with no messages', () => {
      const result = inbox.stats('empty-agent');
      expect(result.total).toBe(0);
      expect(result.unread).toBe(0);
    });

    it('should reflect changes after markAllRead', () => {
      inbox.send('agent-1', 'Message 1');
      inbox.send('agent-1', 'Message 2');

      inbox.markAllRead('agent-1');

      const result = inbox.stats('agent-1');
      expect(result.total).toBe(2);
      expect(result.unread).toBe(0);
    });

    it('should reflect changes after clear', () => {
      inbox.send('agent-1', 'Message 1');
      inbox.clear('agent-1');

      const result = inbox.stats('agent-1');
      expect(result.total).toBe(0);
      expect(result.unread).toBe(0);
    });
  });

  // ======================================================================
  // CLEANUP — REMOVE OLD MESSAGES
  // ======================================================================
  describe('cleanup()', () => {
    it('should remove messages older than threshold', () => {
      inbox.send('agent-1', 'Old message');

      // Backdate the message
      db.prepare('UPDATE agent_inbox SET created_at = ? WHERE content = ?')
        .run(Date.now() - (10 * 24 * 60 * 60 * 1000), 'Old message'); // 10 days ago

      const result = inbox.cleanup(7 * 24 * 60 * 60 * 1000); // 7 day threshold
      expect(result.cleaned).toBe(1);
    });

    it('should not remove recent messages', () => {
      inbox.send('agent-1', 'Recent message');

      const result = inbox.cleanup();
      expect(result.cleaned).toBe(0);
    });

    it('should clean across all agents', () => {
      inbox.send('agent-1', 'Old A');
      inbox.send('agent-2', 'Old B');

      // Backdate both
      db.prepare('UPDATE agent_inbox SET created_at = ?')
        .run(Date.now() - (10 * 24 * 60 * 60 * 1000));

      const result = inbox.cleanup(7 * 24 * 60 * 60 * 1000);
      expect(result.cleaned).toBe(2);
    });
  });

  // ======================================================================
  // MULTIPLE AGENTS — INDEPENDENT INBOXES
  // ======================================================================
  describe('Multiple agents — independent inboxes', () => {
    it('should maintain independent inboxes per agent', () => {
      inbox.send('agent-1', 'Message for agent 1');
      inbox.send('agent-2', 'Message for agent 2');
      inbox.send('agent-3', 'Message for agent 3');

      expect(inbox.list('agent-1').count).toBe(1);
      expect(inbox.list('agent-2').count).toBe(1);
      expect(inbox.list('agent-3').count).toBe(1);
    });

    it('should not leak messages between agents', () => {
      inbox.send('agent-1', 'Secret for agent 1');
      inbox.send('agent-2', 'Secret for agent 2');

      const agent1Messages = inbox.list('agent-1');
      expect(agent1Messages.messages.every(m => m.agentId === 'agent-1')).toBe(true);
      expect(agent1Messages.messages.every(m => m.content !== 'Secret for agent 2')).toBe(true);
    });

    it('should allow cross-agent messaging', () => {
      inbox.send('agent-2', 'Hello from 1', { from: 'agent-1' });
      inbox.send('agent-1', 'Hello from 2', { from: 'agent-2' });

      const agent1Inbox = inbox.list('agent-1');
      expect(agent1Inbox.messages[0].from).toBe('agent-2');

      const agent2Inbox = inbox.list('agent-2');
      expect(agent2Inbox.messages[0].from).toBe('agent-1');
    });

    it('should track stats independently per agent', () => {
      inbox.send('agent-1', 'Msg 1');
      inbox.send('agent-1', 'Msg 2');
      inbox.send('agent-2', 'Msg 1');

      expect(inbox.stats('agent-1').total).toBe(2);
      expect(inbox.stats('agent-2').total).toBe(1);
    });

    it('should clear only the target agents inbox', () => {
      inbox.send('agent-1', 'Keep');
      inbox.send('agent-2', 'Clear');

      inbox.clear('agent-2');

      expect(inbox.list('agent-1').count).toBe(1);
      expect(inbox.list('agent-2').count).toBe(0);
    });
  });

  // ======================================================================
  // ADVERSARIAL INPUTS
  // ======================================================================
  describe('Adversarial inputs', () => {
    it('should handle SQL injection in agent ID (parameterized queries)', () => {
      const malicious = "'; DROP TABLE agent_inbox; --";

      const result = inbox.send(malicious, 'Normal message');
      expect(result.success).toBe(true);

      // Table should still exist and work
      const messages = inbox.list(malicious);
      expect(messages.success).toBe(true);
      expect(messages.count).toBe(1);
    });

    it('should handle SQL injection in message content', () => {
      const malicious = "'; INSERT INTO agent_inbox VALUES (999, 'hacked', 'evil', 'pwned', 'hack', 0, 0); --";

      const result = inbox.send('agent-1', malicious);
      expect(result.success).toBe(true);

      const messages = inbox.list('agent-1');
      expect(messages.count).toBe(1);
      expect(messages.messages[0].content).toBe(malicious);
    });

    it('should handle very long messages (10KB)', () => {
      const longContent = 'x'.repeat(10240);
      const result = inbox.send('agent-1', longContent);
      expect(result.success).toBe(true);

      const messages = inbox.list('agent-1');
      expect(messages.messages[0].content.length).toBe(10240);
    });

    it('should handle unicode in messages', () => {
      inbox.send('agent-1', 'Message with special chars and CJK');

      const messages = inbox.list('agent-1');
      expect(messages.messages[0].content).toBe('Message with special chars and CJK');
    });

    it('should handle empty string from field', () => {
      const result = inbox.send('agent-1', 'Message', { from: '' });
      expect(result.success).toBe(true);

      const messages = inbox.list('agent-1');
      expect(messages.messages[0].from).toBe('');
    });

    it('should handle many concurrent sends to same inbox', () => {
      // Simulate rapid-fire messages (synchronous since SQLite is sync)
      for (let i = 0; i < 100; i++) {
        const result = inbox.send('busy-agent', `Message ${i}`, { from: `sender-${i % 5}` });
        expect(result.success).toBe(true);
      }

      const stats = inbox.stats('busy-agent');
      expect(stats.total).toBe(100);
      expect(stats.unread).toBe(100);
    });

    it('should handle message with newlines and special formatting', () => {
      const content = 'Line 1\nLine 2\n\tTabbed line\n\0Null byte\rCarriage return';
      inbox.send('agent-1', content);

      const messages = inbox.list('agent-1');
      expect(messages.messages[0].content).toBe(content);
    });
  });

  // ======================================================================
  // FULL LIFECYCLE
  // ======================================================================
  describe('Full lifecycle', () => {
    it('should support: send -> list -> markRead -> stats -> clear', () => {
      // 1. Send messages
      const r1 = inbox.send('agent-1', 'Task assigned', { from: 'orchestrator', type: 'task' });
      inbox.send('agent-1', 'Reminder: deadline', { from: 'orchestrator', type: 'reminder' });
      inbox.send('agent-1', 'FYI: config changed', { from: 'agent-3', type: 'info' });

      // 2. List all
      const all = inbox.list('agent-1');
      expect(all.count).toBe(3);

      // 3. Check unread
      const unread = inbox.list('agent-1', { unreadOnly: true });
      expect(unread.count).toBe(3);

      // 4. Mark one as read
      inbox.markRead('agent-1', r1.messageId);
      expect(inbox.stats('agent-1').unread).toBe(2);

      // 5. Mark all as read
      inbox.markAllRead('agent-1');
      expect(inbox.stats('agent-1').unread).toBe(0);
      expect(inbox.stats('agent-1').total).toBe(3);

      // 6. Clear inbox
      const cleared = inbox.clear('agent-1');
      expect(cleared.deleted).toBe(3);
      expect(inbox.stats('agent-1').total).toBe(0);
    });
  });

  // ======================================================================
  // READ RECEIPTS — read_at stamping + listSent (sender side)
  // ======================================================================
  describe('read receipts', () => {
    it('list() reports readAt: null until the message is read', () => {
      inbox.send('bob', 'hi', { from: 'alice' });
      const before = inbox.list('bob').messages[0];
      expect(before.read).toBe(false);
      expect(before.readAt).toBeNull();
    });

    it('markRead() stamps read_at and exposes it on list()', () => {
      const { messageId } = inbox.send('bob', 'hi', { from: 'alice' });
      const t0 = Date.now();
      inbox.markRead('bob', messageId);
      const msg = inbox.list('bob').messages[0];
      expect(msg.read).toBe(true);
      expect(typeof msg.readAt).toBe('number');
      expect(msg.readAt).toBeGreaterThanOrEqual(t0);
    });

    it('markRead() does not overwrite an existing read_at (COALESCE keeps first read)', () => {
      const { messageId } = inbox.send('bob', 'hi', { from: 'alice' });
      inbox.markRead('bob', messageId);
      const first = inbox.list('bob').messages[0].readAt;
      inbox.markRead('bob', messageId); // re-mark
      const second = inbox.list('bob').messages[0].readAt;
      expect(second).toBe(first);
    });

    it('markAllRead() stamps read_at on the newly-read messages', () => {
      inbox.send('bob', 'one', { from: 'alice' });
      inbox.send('bob', 'two', { from: 'alice' });
      inbox.markAllRead('bob');
      for (const m of inbox.list('bob').messages) {
        expect(m.read).toBe(true);
        expect(typeof m.readAt).toBe('number');
      }
    });

    it('listSent() returns the SENDER\'s messages with read receipts', () => {
      const { messageId } = inbox.send('bob', 'read me', { from: 'alice' });
      inbox.send('carol', 'unread one', { from: 'alice' });
      inbox.markRead('bob', messageId);

      const sent = inbox.listSent('alice');
      expect(sent.success).toBe(true);
      expect(sent.count).toBe(2);
      // each sent message exposes the recipient (agentId) + read receipt
      const toBob = sent.messages.find((m) => m.agentId === 'bob');
      const toCarol = sent.messages.find((m) => m.agentId === 'carol');
      expect(toBob.read).toBe(true);
      expect(typeof toBob.readAt).toBe('number');
      expect(toCarol.read).toBe(false);
      expect(toCarol.readAt).toBeNull();
    });

    it('listSent() does not leak other senders\' messages', () => {
      inbox.send('bob', 'from alice', { from: 'alice' });
      inbox.send('bob', 'from dave', { from: 'dave' });
      const aliceSent = inbox.listSent('alice');
      expect(aliceSent.count).toBe(1);
      expect(aliceSent.messages[0].from).toBe('alice');
    });

    it('listSent() honors unreadOnly: true', () => {
      const { messageId } = inbox.send('bob', 'read', { from: 'alice' });
      inbox.send('carol', 'unread', { from: 'alice' });
      inbox.markRead('bob', messageId);
      const unread = inbox.listSent('alice', { unreadOnly: true });
      expect(unread.count).toBe(1);
      expect(unread.messages[0].agentId).toBe('carol');
    });
  });
});
