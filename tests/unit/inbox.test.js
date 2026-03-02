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
import { createAgentInbox } from '../../lib/agent-inbox.js';

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
});
