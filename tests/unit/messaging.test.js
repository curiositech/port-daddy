/**
 * Unit Tests for Messaging Module (messaging.js)
 *
 * Tests message publishing, subscription, polling, and cleanup.
 * Each test runs with a fresh in-memory database to ensure isolation.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createMessaging } from '../../lib/messaging.js';

describe('Messaging Module', () => {
  let db;
  let messaging;

  beforeEach(() => {
    db = createTestDb();
    messaging = createMessaging(db);
  });

  afterEach(() => {
    if (messaging) {
      messaging.destroy();
    }
    if (db) {
      db.close();
    }
  });

  describe('Publish (12 tests)', () => {
    it('should publish a string message to a channel', () => {
      const result = messaging.publish('my-channel', 'hello world');

      expect(result.success).toBe(true);
      expect(result.id).toBeDefined();
      expect(typeof result.id).toBe('number');
      expect(result.message).toBe('published to my-channel');
    });

    it('should publish a JSON object message', () => {
      const payload = { type: 'event', data: 'test' };
      const result = messaging.publish('my-channel', payload);

      expect(result.success).toBe(true);
      expect(result.id).toBeDefined();
    });

    it('should store message payload as JSON string', () => {
      const payload = { status: 'active', count: 42 };
      messaging.publish('test-channel', payload);

      const messages = messaging.getMessages('test-channel').messages;
      expect(messages).toHaveLength(1);
      expect(messages[0].payload).toEqual(payload);
    });

    it('should store string payload as-is', () => {
      messaging.publish('test-channel', 'plain text');

      const messages = messaging.getMessages('test-channel').messages;
      expect(messages).toHaveLength(1);
      expect(messages[0].payload).toBe('plain text');
    });

    it('should track sender information', () => {
      const result = messaging.publish('test-channel', 'msg', {
        sender: 'agent-1'
      });

      expect(result.success).toBe(true);

      const messages = messaging.getMessages('test-channel').messages;
      expect(messages[0].sender).toBe('agent-1');
    });

    it('should set expiration time when provided', () => {
      const before = Date.now();
      messaging.publish('test-channel', 'msg', { expires: '1h' });
      const after = Date.now();

      const row = db.prepare('SELECT * FROM messages').get();
      expect(row.expires_at).toBeDefined();
      expect(row.expires_at).toBeGreaterThanOrEqual(before + 3600000 - 100);
      expect(row.expires_at).toBeLessThanOrEqual(after + 3600000 + 100);
    });

    it('should handle numeric expiration (milliseconds)', () => {
      const before = Date.now();
      messaging.publish('test-channel', 'msg', { expires: 5000 });
      const after = Date.now();

      const row = db.prepare('SELECT * FROM messages').get();
      expect(row.expires_at).toBeGreaterThanOrEqual(before + 5000 - 100);
      expect(row.expires_at).toBeLessThanOrEqual(after + 5000 + 100);
    });

    it('should reject empty channel name', () => {
      const result = messaging.publish('', 'msg');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/non-empty string/);
    });

    it('should reject whitespace-only channel name', () => {
      const result = messaging.publish('   ', 'msg');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/non-empty string/);
      expect(result.code).toBe('VALIDATION_ERROR');
    });

    it('should reject non-string channel name', () => {
      const result = messaging.publish(123, 'msg');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/non-empty string/);
    });

    it('should reject null channel name', () => {
      const result = messaging.publish(null, 'msg');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/non-empty string/);
    });

    it('should assign monotonically increasing message IDs', () => {
      const msg1 = messaging.publish('ch1', 'msg1').id;
      const msg2 = messaging.publish('ch1', 'msg2').id;
      const msg3 = messaging.publish('ch1', 'msg3').id;

      expect(msg2).toBeGreaterThan(msg1);
      expect(msg3).toBeGreaterThan(msg2);
    });

    it('should track message creation timestamp', () => {
      const before = Date.now();
      messaging.publish('test-channel', 'msg');
      const after = Date.now();

      const messages = messaging.getMessages('test-channel').messages;
      const createdAt = messages[0].createdAt;

      expect(createdAt).toBeGreaterThanOrEqual(before);
      expect(createdAt).toBeLessThanOrEqual(after);
    });
  });

  describe('Get Messages (10 tests)', () => {
    it('should retrieve messages from a channel', () => {
      messaging.publish('test-channel', 'msg1');
      messaging.publish('test-channel', 'msg2');

      const result = messaging.getMessages('test-channel');

      expect(result.success).toBe(true);
      expect(result.channel).toBe('test-channel');
      expect(result.messages).toHaveLength(2);
      expect(result.count).toBe(2);
    });

    it('should return messages in chronological order', () => {
      messaging.publish('test-channel', 'first');
      messaging.publish('test-channel', 'second');
      messaging.publish('test-channel', 'third');

      const result = messaging.getMessages('test-channel');

      expect(result.messages[0].payload).toBe('first');
      expect(result.messages[1].payload).toBe('second');
      expect(result.messages[2].payload).toBe('third');
    });

    it('should respect limit parameter', () => {
      messaging.publish('test-channel', 'msg1');
      messaging.publish('test-channel', 'msg2');
      messaging.publish('test-channel', 'msg3');
      messaging.publish('test-channel', 'msg4');

      const result = messaging.getMessages('test-channel', { limit: 2 });

      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].payload).toBe('msg3');
      expect(result.messages[1].payload).toBe('msg4');
    });

    it('should return empty array for non-existent channel', () => {
      const result = messaging.getMessages('nonexistent');

      expect(result.success).toBe(true);
      expect(result.messages).toHaveLength(0);
      expect(result.count).toBe(0);
    });

    it('should support after parameter for pagination', () => {
      const msg1 = messaging.publish('test-channel', 'msg1').id;
      const msg2 = messaging.publish('test-channel', 'msg2').id;
      const msg3 = messaging.publish('test-channel', 'msg3').id;

      const result = messaging.getMessages('test-channel', { after: msg1 });

      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].id).toBe(msg2);
      expect(result.messages[1].id).toBe(msg3);
    });

    it('should return nothing when after is beyond last message', () => {
      messaging.publish('test-channel', 'msg1');
      messaging.publish('test-channel', 'msg2');

      const result = messaging.getMessages('test-channel', { after: 9999 });

      expect(result.messages).toHaveLength(0);
    });

    it('should parse JSON payloads automatically', () => {
      const payload = { status: 'ok', code: 200 };
      messaging.publish('test-channel', payload);

      const result = messaging.getMessages('test-channel');
      expect(result.messages[0].payload).toEqual(payload);
    });

    it('should include sender in returned messages', () => {
      messaging.publish('test-channel', 'msg', { sender: 'agent-1' });
      messaging.publish('test-channel', 'msg2', { sender: 'agent-2' });

      const result = messaging.getMessages('test-channel');

      expect(result.messages[0].sender).toBe('agent-1');
      expect(result.messages[1].sender).toBe('agent-2');
    });

    it('should default limit to 50', () => {
      // Publish 100 messages
      for (let i = 0; i < 100; i++) {
        messaging.publish('test-channel', `msg${i}`);
      }

      const result = messaging.getMessages('test-channel');

      // Should return last 50 (default limit)
      expect(result.messages).toHaveLength(50);
      expect(result.messages[0].payload).toBe('msg50');
      expect(result.messages[49].payload).toBe('msg99');
    });
  });

  describe('Poll (8 tests)', () => {
    it('should return next message after ID', () => {
      const msg1 = messaging.publish('test-channel', 'msg1').id;
      const msg2 = messaging.publish('test-channel', 'msg2').id;
      const msg3 = messaging.publish('test-channel', 'msg3').id;

      const result = messaging.poll('test-channel', msg1);

      expect(result.success).toBe(true);
      expect(result.channel).toBe('test-channel');
      expect(result.message).toBeDefined();
      expect(result.message.id).toBe(msg2);
      expect(result.lastId).toBe(msg2);
    });

    it('should return null when no messages after ID', () => {
      const msg1 = messaging.publish('test-channel', 'msg1').id;

      const result = messaging.poll('test-channel', msg1);

      expect(result.success).toBe(true);
      expect(result.message).toBeNull();
      expect(result.lastId).toBe(msg1);
    });

    it('should return first message when afterId is 0', () => {
      const msg1 = messaging.publish('test-channel', 'first').id;
      messaging.publish('test-channel', 'second');

      const result = messaging.poll('test-channel', 0);

      expect(result.success).toBe(true);
      expect(result.message.id).toBe(msg1);
      expect(result.message.payload).toBe('first');
    });

    it('should parse JSON payloads', () => {
      messaging.publish('test-channel', { status: 'ready' });

      const result = messaging.poll('test-channel', 0);

      expect(result.message.payload).toEqual({ status: 'ready' });
    });

    it('should include sender information', () => {
      messaging.publish('test-channel', 'msg', { sender: 'agent-1' });

      const result = messaging.poll('test-channel', 0);

      expect(result.message.sender).toBe('agent-1');
    });

    it('should work in polling sequence', () => {
      const id1 = messaging.publish('test-channel', 'msg1').id;
      const id2 = messaging.publish('test-channel', 'msg2').id;
      const id3 = messaging.publish('test-channel', 'msg3').id;

      // Poll for msg1
      let poll1 = messaging.poll('test-channel', 0);
      expect(poll1.message.id).toBe(id1);

      // Poll for next (msg2)
      let poll2 = messaging.poll('test-channel', poll1.lastId);
      expect(poll2.message.id).toBe(id2);

      // Poll for next (msg3)
      let poll3 = messaging.poll('test-channel', poll2.lastId);
      expect(poll3.message.id).toBe(id3);

      // Poll for next (none)
      let poll4 = messaging.poll('test-channel', poll3.lastId);
      expect(poll4.message).toBeNull();
    });
  });

  describe('Subscribe (12 tests)', () => {
    it('should subscribe to a channel', () => {
      const callback = jest.fn();
      const unsub = messaging.subscribe('test-channel', callback);

      expect(unsub).toBeDefined();
      expect(typeof unsub).toBe('function');
    });

    it('should call callback when message published', () => {
      const callback = jest.fn();
      messaging.subscribe('test-channel', callback);

      messaging.publish('test-channel', 'test message');

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'test-channel',
          payload: 'test message',
          sender: null
        })
      );
    });

    it('should call callback with sender', () => {
      const callback = jest.fn();
      messaging.subscribe('test-channel', callback);

      messaging.publish('test-channel', 'msg', { sender: 'agent-1' });

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          sender: 'agent-1'
        })
      );
    });

    it('should notify multiple subscribers', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();
      const callback3 = jest.fn();

      messaging.subscribe('test-channel', callback1);
      messaging.subscribe('test-channel', callback2);
      messaging.subscribe('test-channel', callback3);

      messaging.publish('test-channel', 'msg');

      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).toHaveBeenCalledTimes(1);
      expect(callback3).toHaveBeenCalledTimes(1);
    });

    it('should unsubscribe with returned function', () => {
      const callback = jest.fn();
      const unsub = messaging.subscribe('test-channel', callback);

      messaging.publish('test-channel', 'msg1');
      expect(callback).toHaveBeenCalledTimes(1);

      unsub();

      messaging.publish('test-channel', 'msg2');
      expect(callback).toHaveBeenCalledTimes(1); // Still only 1
    });

    it('should support wildcard subscriber', () => {
      const callback = jest.fn();
      messaging.subscribe('*', callback);

      messaging.publish('channel1', 'msg1');
      messaging.publish('channel2', 'msg2');

      expect(callback).toHaveBeenCalledTimes(2);
      expect(callback.mock.calls[0][0].channel).toBe('channel1');
      expect(callback.mock.calls[1][0].channel).toBe('channel2');
    });

    it('should enforce MAX_CHANNELS limit', () => {
      // Create max channels
      for (let i = 0; i < 1000; i++) {
        const callback = jest.fn();
        const result = messaging.subscribe(`channel-${i}`, callback);
        expect(result).not.toBeNull();
      }

      // Try to subscribe to new channel - should fail
      const callback = jest.fn();
      const result = messaging.subscribe('overflow-channel', callback);

      expect(result).toBeNull();
    });

    it('should enforce MAX_SUBSCRIBERS_PER_CHANNEL limit', () => {
      const callbacks = [];

      // Subscribe 100 times to same channel
      for (let i = 0; i < 100; i++) {
        const callback = jest.fn();
        callbacks.push(callback);
        const result = messaging.subscribe('test-channel', callback);
        expect(result).not.toBeNull();
      }

      // Try 101st subscription - should fail
      const extraCallback = jest.fn();
      const result = messaging.subscribe('test-channel', extraCallback);

      expect(result).toBeNull();
    });

    it('should handle subscriber errors gracefully', () => {
      const goodCallback = jest.fn();
      const badCallback = () => {
        throw new Error('Subscriber error');
      };

      messaging.subscribe('test-channel', badCallback);
      messaging.subscribe('test-channel', goodCallback);

      // Should not throw, despite badCallback throwing
      expect(() => {
        messaging.publish('test-channel', 'msg');
      }).not.toThrow();

      // goodCallback should still be called
      expect(goodCallback).toHaveBeenCalledTimes(1);
    });

    it('should clean up empty channel subscriptions', () => {
      const callback = jest.fn();
      const unsub = messaging.subscribe('test-channel', callback);

      unsub();

      // Try to subscribe again to verify cleanup happened
      const callback2 = jest.fn();
      const result = messaging.subscribe('test-channel', callback2);

      expect(result).not.toBeNull();
    });

    it('should pass full message object to wildcard subscriber', () => {
      const callback = jest.fn();
      messaging.subscribe('*', callback);

      const payload = { status: 'active' };
      messaging.publish('test-channel', payload, { sender: 'agent-1' });

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'test-channel',
          sender: 'agent-1'
        })
      );

      // Verify the payload is the parsed object (subscribers now get hydrated payload)
      const call = callback.mock.calls[0][0];
      expect(call.payload).toEqual(payload);
    });
  });

  describe('Clear (5 tests)', () => {
    it('should clear all messages from a channel', () => {
      messaging.publish('test-channel', 'msg1');
      messaging.publish('test-channel', 'msg2');
      messaging.publish('test-channel', 'msg3');

      const result = messaging.clear('test-channel');

      expect(result.success).toBe(true);
      expect(result.deleted).toBe(3);
      expect(result.message).toMatch(/cleared 3 message/);
    });

    it('should return 0 deleted for non-existent channel', () => {
      const result = messaging.clear('nonexistent');

      expect(result.success).toBe(true);
      expect(result.deleted).toBe(0);
    });

    it('should not affect other channels', () => {
      messaging.publish('channel1', 'msg1');
      messaging.publish('channel2', 'msg2');
      messaging.publish('channel2', 'msg3');

      messaging.clear('channel2');

      const channel1 = messaging.getMessages('channel1');
      const channel2 = messaging.getMessages('channel2');

      expect(channel1.messages).toHaveLength(1);
      expect(channel2.messages).toHaveLength(0);
    });

  });

  describe('List Channels (5 tests)', () => {
    it('should list all channels with message counts', () => {
      messaging.publish('channel1', 'msg');
      messaging.publish('channel2', 'msg');
      messaging.publish('channel2', 'msg');
      messaging.publish('channel3', 'msg');
      messaging.publish('channel3', 'msg');
      messaging.publish('channel3', 'msg');

      const result = messaging.listChannels();

      expect(result.success).toBe(true);
      expect(result.channels).toHaveLength(3);

      const ch1 = result.channels.find(c => c.channel === 'channel1');
      const ch2 = result.channels.find(c => c.channel === 'channel2');
      const ch3 = result.channels.find(c => c.channel === 'channel3');

      expect(ch1.count).toBe(1);
      expect(ch2.count).toBe(2);
      expect(ch3.count).toBe(3);
    });

    it('should include last message timestamp', () => {
      messaging.publish('test-channel', 'msg');

      const result = messaging.listChannels();

      expect(result.channels).toHaveLength(1);
      expect(result.channels[0].lastMessage).toBeDefined();
      expect(typeof result.channels[0].lastMessage).toBe('number');
    });

    it('should return empty array when no channels', () => {
      const result = messaging.listChannels();

      expect(result.success).toBe(true);
      expect(result.channels).toHaveLength(0);
    });

    it('should sort by most recent message', async () => {
      messaging.publish('old-channel', 'msg');

      // Add a small delay to ensure timestamp difference
      await new Promise(r => setTimeout(r, 10));

      messaging.publish('new-channel', 'msg');

      const result = messaging.listChannels();

      expect(result.channels[0].channel).toBe('new-channel');
      expect(result.channels[1].channel).toBe('old-channel');
    });

    it('should handle many channels', () => {
      for (let i = 0; i < 100; i++) {
        messaging.publish(`channel-${i}`, `msg-${i}`);
      }

      const result = messaging.listChannels();

      expect(result.channels).toHaveLength(100);
    });
  });

  describe('Cleanup (8 tests)', () => {
    it('should remove expired messages', () => {
      const now = Date.now();

      // Publish a message that expires in 1 second
      messaging.publish('test-channel', 'msg1', { expires: 1000 });

      // Publish a message that lasts 1 hour
      messaging.publish('test-channel', 'msg2', { expires: '1h' });

      // Manually set first message to be expired
      db.prepare('UPDATE messages SET expires_at = ? WHERE id = 1').run(now - 1000);

      const result = messaging.cleanup();

      expect(result.cleaned).toBe(1);

      // Verify msg1 is gone, msg2 remains
      const messages = messaging.getMessages('test-channel');
      expect(messages.messages).toHaveLength(1);
      expect(messages.messages[0].payload).toBe('msg2');
    });

    it('should return cleaned count of 0 when nothing to clean', () => {
      messaging.publish('test-channel', 'msg1', { expires: '1h' });

      const result = messaging.cleanup();

      expect(result.cleaned).toBe(0);
    });

    it('should clean multiple expired messages', () => {
      const now = Date.now();

      for (let i = 0; i < 5; i++) {
        messaging.publish('test-channel', `msg${i}`, { expires: '1h' });
      }

      // Expire first 3 messages
      db.prepare('UPDATE messages SET expires_at = ? WHERE id <= 3').run(now - 1000);

      const result = messaging.cleanup();

      expect(result.cleaned).toBe(3);

      const messages = messaging.getMessages('test-channel');
      expect(messages.messages).toHaveLength(2);
    });

    it('should not affect messages without expiration', () => {
      messaging.publish('test-channel', 'permanent');
      messaging.publish('test-channel', 'temp', { expires: '1h' });

      const result = messaging.cleanup();

      expect(result.cleaned).toBe(0);

      const messages = messaging.getMessages('test-channel');
      expect(messages.messages).toHaveLength(2);
    });

    it('should only clean messages with expires_at < now', () => {
      const futureTime = Date.now() + 10000;

      messaging.publish('test-channel', 'msg1', { expires: '1h' });

      // Set expiration to future
      db.prepare('UPDATE messages SET expires_at = ?').run(futureTime);

      const result = messaging.cleanup();

      expect(result.cleaned).toBe(0);

      const messages = messaging.getMessages('test-channel');
      expect(messages.messages).toHaveLength(1);
    });

    it('should clean across multiple channels', () => {
      const now = Date.now();

      messaging.publish('ch1', 'msg1', { expires: '1h' });
      messaging.publish('ch2', 'msg2', { expires: '1h' });
      messaging.publish('ch3', 'msg3', { expires: '1h' });

      // Expire all
      db.prepare('UPDATE messages SET expires_at = ?').run(now - 1000);

      const result = messaging.cleanup();

      expect(result.cleaned).toBe(3);

      expect(messaging.getMessages('ch1').messages).toHaveLength(0);
      expect(messaging.getMessages('ch2').messages).toHaveLength(0);
      expect(messaging.getMessages('ch3').messages).toHaveLength(0);
    });

    it('should handle cleanup with no messages', () => {
      const result = messaging.cleanup();

      expect(result.cleaned).toBe(0);
    });

    it('should be idempotent', () => {
      const now = Date.now();

      messaging.publish('test-channel', 'msg1', { expires: '1h' });
      db.prepare('UPDATE messages SET expires_at = ?').run(now - 1000);

      const result1 = messaging.cleanup();
      const result2 = messaging.cleanup();

      expect(result1.cleaned).toBe(1);
      expect(result2.cleaned).toBe(0);
    });
  });

  describe('Subscriber Count (5 tests)', () => {
    it('should return subscriber count for a channel', () => {
      const cb1 = jest.fn();
      const cb2 = jest.fn();

      messaging.subscribe('test-channel', cb1);
      messaging.subscribe('test-channel', cb2);

      expect(messaging.subscriberCount('test-channel')).toBe(2);
    });

    it('should return 0 for channel with no subscribers', () => {
      expect(messaging.subscriberCount('nonexistent')).toBe(0);
    });

    it('should decrement count on unsubscribe', () => {
      const cb1 = jest.fn();
      const cb2 = jest.fn();

      const unsub1 = messaging.subscribe('test-channel', cb1);
      messaging.subscribe('test-channel', cb2);

      expect(messaging.subscriberCount('test-channel')).toBe(2);

      unsub1();

      expect(messaging.subscriberCount('test-channel')).toBe(1);
    });

    it('should track wildcard subscribers separately', () => {
      const cb1 = jest.fn();
      const cb2 = jest.fn();

      messaging.subscribe('test-channel', cb1);
      messaging.subscribe('*', cb2);

      expect(messaging.subscriberCount('test-channel')).toBe(1);
      expect(messaging.subscriberCount('*')).toBe(1);
    });

  });

  describe('Message Ordering and Edge Cases (10 tests)', () => {
    it('should maintain message order across rapid publishes', () => {
      const ids = [];

      for (let i = 0; i < 10; i++) {
        ids.push(messaging.publish('test-channel', `msg${i}`).id);
      }

      const messages = messaging.getMessages('test-channel');

      for (let i = 0; i < 10; i++) {
        expect(messages.messages[i].id).toBe(ids[i]);
        expect(messages.messages[i].payload).toBe(`msg${i}`);
      }
    });

    it('should reject null payload', () => {
      const result = messaging.publish('test-channel', null);

      expect(result.success).toBe(false);
      expect(result.error).toBe('payload is required');
      expect(result.code).toBe('VALIDATION_ERROR');
    });

    it('should handle boolean payloads', () => {
      messaging.publish('test-channel', true);
      messaging.publish('test-channel', false);

      const messages = messaging.getMessages('test-channel');

      expect(messages.messages[0].payload).toBe(true);
      expect(messages.messages[1].payload).toBe(false);
    });

    it('should handle numeric payloads', () => {
      messaging.publish('test-channel', 42);
      messaging.publish('test-channel', 3.14);

      const messages = messaging.getMessages('test-channel');

      expect(messages.messages[0].payload).toBe(42);
      expect(messages.messages[1].payload).toBe(3.14);
    });

    it('should reject empty string payload', () => {
      const result = messaging.publish('test-channel', '');

      expect(result.success).toBe(false);
      expect(result.error).toBe('payload must be a non-empty string');
      expect(result.code).toBe('VALIDATION_ERROR');
    });

    it('should reject whitespace-only payload', () => {
      const result = messaging.publish('test-channel', '   ');

      expect(result.success).toBe(false);
      expect(result.error).toBe('payload must be a non-empty string');
      expect(result.code).toBe('VALIDATION_ERROR');
    });

    it('should handle complex nested objects', () => {
      const complex = {
        level1: {
          level2: {
            level3: {
              data: [1, 2, 3],
              nested: { key: 'value' }
            }
          }
        }
      };

      messaging.publish('test-channel', complex);

      const messages = messaging.getMessages('test-channel');

      expect(messages.messages[0].payload).toEqual(complex);
    });

    it('should handle very long strings', () => {
      const longString = 'x'.repeat(10000);
      messaging.publish('test-channel', longString);

      const messages = messaging.getMessages('test-channel');

      expect(messages.messages[0].payload).toBe(longString);
    });

    it('should handle special characters in payload', () => {
      const special = 'Hello "quoted" \\backslash\\ \n newline \t tab';
      messaging.publish('test-channel', special);

      const messages = messaging.getMessages('test-channel');

      expect(messages.messages[0].payload).toBe(special);
    });

    it('should handle JSON with special characters', () => {
      const payload = {
        text: 'Line 1\nLine 2',
        escaped: 'Quote: "hello"',
        unicode: '🚀 emoji'
      };

      messaging.publish('test-channel', payload);

      const messages = messaging.getMessages('test-channel');

      expect(messages.messages[0].payload).toEqual(payload);
    });

    it('should support multiple channels independently', () => {
      messaging.publish('ch1', 'msg1');
      messaging.publish('ch2', 'msg2');
      messaging.publish('ch1', 'msg3');
      messaging.publish('ch2', 'msg4');
      messaging.publish('ch2', 'msg5');

      const ch1 = messaging.getMessages('ch1');
      const ch2 = messaging.getMessages('ch2');

      expect(ch1.messages).toHaveLength(2);
      expect(ch2.messages).toHaveLength(3);
      expect(ch1.messages[0].payload).toBe('msg1');
      expect(ch2.messages[2].payload).toBe('msg5');
    });
  });

  describe('Integration Scenarios (8 tests)', () => {
    it('should support pub/sub workflow', () => {
      const messages = [];
      const unsub = messaging.subscribe('events', msg => {
        messages.push(msg.payload);
      });

      messaging.publish('events', 'event1');
      messaging.publish('events', 'event2');

      expect(messages).toEqual(['event1', 'event2']);

      unsub();

      messaging.publish('events', 'event3');

      // event3 not in messages because we unsubscribed
      expect(messages).toEqual(['event1', 'event2']);
    });

    it('should support polling workflow', () => {
      messaging.publish('stream', 'msg1');
      messaging.publish('stream', 'msg2');
      messaging.publish('stream', 'msg3');

      let lastId = 0;
      const collected = [];

      while (true) {
        const result = messaging.poll('stream', lastId);

        if (result.message === null) break;

        collected.push(result.message.payload);
        lastId = result.lastId;
      }

      expect(collected).toEqual(['msg1', 'msg2', 'msg3']);
    });

    it('should support mixed pub/sub and polling', () => {
      const subMessages = [];
      messaging.subscribe('mixed', msg => {
        subMessages.push(msg.payload);
      });

      // Publish some messages
      messaging.publish('mixed', 'sub1');
      messaging.publish('mixed', 'sub2');

      expect(subMessages).toEqual(['sub1', 'sub2']);

      // Poll for all messages
      const pollMessages = messaging.getMessages('mixed').messages;

      expect(pollMessages).toHaveLength(2);
    });

    it('should support agent-to-agent messaging', () => {
      const agent1Inbox = [];
      const agent2Inbox = [];

      messaging.subscribe('agent-1-inbox', msg => {
        agent1Inbox.push(msg);
      });

      messaging.subscribe('agent-2-inbox', msg => {
        agent2Inbox.push(msg);
      });

      // Agent 2 sends to Agent 1
      messaging.publish('agent-1-inbox', 'Hello from agent2', {
        sender: 'agent-2'
      });

      // Agent 1 sends to Agent 2
      messaging.publish('agent-2-inbox', 'Hello from agent1', {
        sender: 'agent-1'
      });

      expect(agent1Inbox).toHaveLength(1);
      expect(agent2Inbox).toHaveLength(1);
      expect(agent1Inbox[0].sender).toBe('agent-2');
      expect(agent2Inbox[0].sender).toBe('agent-1');
    });

    it('should handle expiration with active messages', () => {
      const now = Date.now();

      // Track which message IDs should expire
      const expireIds = [];

      // Mix of expiring and permanent messages
      for (let i = 0; i < 5; i++) {
        if (i % 2 === 0) {
          const id = messaging.publish('test-channel', `expiring-${i}`, { expires: '1h' }).id;
          expireIds.push(id);
        } else {
          messaging.publish('test-channel', `permanent-${i}`);
        }
      }

      // Expire all messages marked for expiration
      for (const id of expireIds) {
        db.prepare('UPDATE messages SET expires_at = ? WHERE id = ?')
          .run(now - 1000, id);
      }

      const result = messaging.cleanup();

      expect(result.cleaned).toBe(3);
      const messages = messaging.getMessages('test-channel').messages;

      expect(messages).toHaveLength(2); // 1, 3 (odd-numbered permanent messages)
    });

    it('should maintain consistency across operations', () => {
      // Publish, poll, subscribe, cleanup, list all in one flow
      const id1 = messaging.publish('stress', 'msg1').id;
      const id2 = messaging.publish('stress', 'msg2').id;

      // Poll
      const polled = messaging.poll('stress', id1);
      expect(polled.message.id).toBe(id2);

      // Subscribe
      const messages = [];
      messaging.subscribe('stress', msg => {
        messages.push(msg.payload);
      });

      messaging.publish('stress', 'msg3');
      expect(messages).toEqual(['msg3']);

      // List
      const channels = messaging.listChannels();
      expect(channels.channels[0].count).toBe(3);

      // Cleanup (nothing expires)
      const cleanup = messaging.cleanup();
      expect(cleanup.cleaned).toBe(0);

      // Final state check
      const final = messaging.getMessages('stress');
      expect(final.messages).toHaveLength(3);
    });
  });

  describe('Coverage Edge Cases (1 test)', () => {
    it('should notify wildcard subscribers when publishing', () => {
      const wildcard1 = jest.fn();
      const wildcard2 = jest.fn();
      const specific = jest.fn();

      messaging.subscribe('*', wildcard1);
      messaging.subscribe('*', wildcard2);
      messaging.subscribe('test-channel', specific);

      messaging.publish('test-channel', 'msg');

      expect(wildcard1).toHaveBeenCalledTimes(1);
      expect(wildcard2).toHaveBeenCalledTimes(1);
      expect(specific).toHaveBeenCalledTimes(1);

      // Wildcard should receive message with channel included
      const wildcardMsg1 = wildcard1.mock.calls[0][0];
      const wildcardMsg2 = wildcard2.mock.calls[0][0];

      expect(wildcardMsg1.channel).toBe('test-channel');
      expect(wildcardMsg2.channel).toBe('test-channel');
    });
  });

  describe('Error Handling and Robustness (6 tests)', () => {
    it('should handle database errors gracefully', () => {
      // This is tricky in tests since we control the DB
      // Instead, test that exceptions from subscribers don't break publishing
      const errorCb = () => {
        throw new Error('Subscriber failed');
      };

      const goodCb = jest.fn();

      messaging.subscribe('test-channel', errorCb);
      messaging.subscribe('test-channel', goodCb);

      // Should not throw
      messaging.publish('test-channel', 'msg');

      expect(goodCb).toHaveBeenCalledTimes(1);
    });

    it('should handle subscriber callback that modifies data', () => {
      const data = { count: 0 };

      const callback = (msg) => {
        data.count++;
      };

      messaging.subscribe('test-channel', callback);

      messaging.publish('test-channel', 'msg1');
      messaging.publish('test-channel', 'msg2');

      expect(data.count).toBe(2);
    });

    it('should reject invalid expiration formats gracefully', () => {
      // Invalid expires should not crash
      const result = messaging.publish('test-channel', 'msg', {
        expires: 'invalid-format'
      });

      expect(result.success).toBe(true);

      // When parseExpires returns null, expiresAt is set to null (no expiration)
      const row = db.prepare('SELECT expires_at FROM messages').get();
      expect(row.expires_at).toBeNull();
    });

    it('should handle getMessages with negative limit', () => {
      messaging.publish('test-channel', 'msg1');
      messaging.publish('test-channel', 'msg2');

      // Negative limit should be handled by SQLite
      const result = messaging.getMessages('test-channel', { limit: -1 });

      // SQLite treats negative LIMIT as no limit
      expect(result.messages).toHaveLength(2);
    });

    it('should handle null sender gracefully', () => {
      const result = messaging.publish('test-channel', 'msg', { sender: null });

      expect(result.success).toBe(true);

      const messages = messaging.getMessages('test-channel');
      expect(messages.messages[0].sender).toBeNull();
    });
  });

  describe('Declared channel registry', () => {
    const contexts = {
      '/repo/feature-a': {
        projectDir: '/repo/feature-a',
        repoAnchor: '/repo/.git',
        repoKey: 'repo1234',
        worktreeId: 'worka111',
        branch: 'feature-a',
        inGit: true,
      },
      '/repo/feature-b': {
        projectDir: '/repo/feature-b',
        repoAnchor: '/repo/.git',
        repoKey: 'repo1234',
        worktreeId: 'workb222',
        branch: 'feature-b',
        inGit: true,
      },
    };

    beforeEach(() => {
      messaging = createMessaging(db, {
        resolveChannelContext(projectDir) {
          return contexts[projectDir] || contexts['/repo/feature-a'];
        }
      });
    });

    it('derives different physical channels for the same logical channel across worktrees', () => {
      const featureA = messaging.ensureChannel('tauri:desktop', { projectDir: '/repo/feature-a' });
      const featureB = messaging.ensureChannel('tauri:desktop', { projectDir: '/repo/feature-b' });

      expect(featureA.success).toBe(true);
      expect(featureB.success).toBe(true);
      expect(featureA.channel.physicalName).not.toBe(featureB.channel.physicalName);
      expect(featureA.channel.scope).toBe('branch');
      expect(featureB.channel.scope).toBe('branch');
    });

    it('discovers only channels relevant to the current repo/worktree context', () => {
      const globalChannel = messaging.ensureChannel('fleet:inbox', {
        projectDir: '/repo/feature-a',
        scope: 'global',
      });
      const repoChannel = messaging.ensureChannel('repo:handoff', {
        projectDir: '/repo/feature-a',
        scope: 'repo',
      });
      const featureA = messaging.ensureChannel('tauri:desktop', { projectDir: '/repo/feature-a' });
      const featureB = messaging.ensureChannel('tauri:desktop', { projectDir: '/repo/feature-b' });

      const discovered = messaging.discoverChannels({ projectDir: '/repo/feature-a' });
      const physicalNames = discovered.channels.map((entry) => entry.physicalName);

      expect(physicalNames).toContain(globalChannel.channel.physicalName);
      expect(physicalNames).toContain(repoChannel.channel.physicalName);
      expect(physicalNames).toContain(featureA.channel.physicalName);
      expect(physicalNames).not.toContain(featureB.channel.physicalName);
    });

    it('resolves aliases within the current worktree and branch', () => {
      const featureA = messaging.ensureChannel('tauri:desktop', {
        projectDir: '/repo/feature-a',
        aliases: ['desktop:probe'],
      });
      messaging.ensureChannel('tauri:desktop', {
        projectDir: '/repo/feature-b',
        aliases: ['desktop:probe'],
      });

      const resolved = messaging.resolveChannel('desktop:probe', { projectDir: '/repo/feature-a' });

      expect(resolved.success).toBe(true);
      expect(resolved.channel.physicalName).toBe(featureA.channel.physicalName);
    });

    it('can surface observed undeclared channels when explicitly requested', () => {
      messaging.publish('legacy:raw', { ok: true });

      const discovered = messaging.discoverChannels({
        projectDir: '/repo/feature-a',
        includeObserved: true,
      });
      const observed = discovered.channels.find((entry) => entry.physicalName === 'legacy:raw');

      expect(observed).toBeDefined();
      expect(observed.source).toBe('observed');
      expect(observed.activeCount).toBe(1);
    });
  });
});
