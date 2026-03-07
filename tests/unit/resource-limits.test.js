/**
 * Unit Tests for Resource Limits (Phase 9c)
 *
 * Tests that resource exhaustion is prevented via hard limits:
 * - Agent inbox: max 1000 messages
 * - Notes per session: max 500
 * - Services per identity: max 20
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createAgentInbox } from '../../lib/agent-inbox.js';
import { createSessions } from '../../lib/sessions.js';
import { createServices } from '../../lib/services.js';

describe('Resource Limits', () => {

  // ==========================================================================
  // Agent Inbox Limits
  // ==========================================================================
  describe('Agent Inbox (max 1000 messages)', () => {
    let db;
    let inbox;

    beforeEach(() => {
      db = createTestDb();
      inbox = createAgentInbox(db);
    });

    it('should expose MAX_INBOX_MESSAGES constant', () => {
      expect(inbox.MAX_INBOX_MESSAGES).toBe(1000);
    });

    it('should allow sending messages below the limit', () => {
      const result = inbox.send('agent-1', 'Hello');
      expect(result.success).toBe(true);
      expect(result.messageId).toBeDefined();
    });

    it('should reject messages when inbox is full', () => {
      // Fill the inbox to capacity
      for (let i = 0; i < 1000; i++) {
        const r = inbox.send('agent-full', `msg-${i}`);
        expect(r.success).toBe(true);
      }

      // Attempt to send one more
      const result = inbox.send('agent-full', 'overflow');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Inbox full/);
      expect(result.error).toMatch(/1000/);
      expect(result.code).toBe('RESOURCE_LIMIT');
    });

    it('should allow sending after clearing messages', () => {
      // Fill inbox
      for (let i = 0; i < 1000; i++) {
        inbox.send('agent-clear', `msg-${i}`);
      }

      // Verify it's full
      expect(inbox.send('agent-clear', 'overflow').success).toBe(false);

      // Clear inbox
      inbox.clear('agent-clear');

      // Should work now
      const result = inbox.send('agent-clear', 'after-clear');
      expect(result.success).toBe(true);
    });

    it('should enforce limit per-agent (not globally)', () => {
      // Fill agent-1's inbox
      for (let i = 0; i < 1000; i++) {
        inbox.send('agent-1', `msg-${i}`);
      }

      // agent-2 should still be able to receive messages
      const result = inbox.send('agent-2', 'hello from agent-2');
      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // Session Notes Limits
  // ==========================================================================
  describe('Session Notes (max 500 per session)', () => {
    let db;
    let sessions;

    beforeEach(() => {
      db = createTestDb();
      sessions = createSessions(db);
    });

    it('should allow adding notes below the limit', () => {
      const session = sessions.start('test session');
      const result = sessions.addNote(session.id, 'test note');
      expect(result.success).toBe(true);
      expect(result.noteId).toBeDefined();
    });

    it('should reject notes when session has reached the limit', () => {
      const session = sessions.start('test session');

      // Add 500 notes
      for (let i = 0; i < 500; i++) {
        const r = sessions.addNote(session.id, `note-${i}`);
        expect(r.success).toBe(true);
      }

      // Attempt to add one more
      const result = sessions.addNote(session.id, 'overflow note');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/note limit reached/i);
      expect(result.error).toMatch(/500/);
      expect(result.code).toBe('RESOURCE_LIMIT');
    });

    it('should enforce limit per-session (not globally)', () => {
      const session1 = sessions.start('session 1');
      const session2 = sessions.start('session 2');

      // Fill session 1
      for (let i = 0; i < 500; i++) {
        sessions.addNote(session1.id, `note-${i}`);
      }

      // Verify session 1 is full
      expect(sessions.addNote(session1.id, 'overflow').success).toBe(false);

      // Session 2 should still accept notes
      const result = sessions.addNote(session2.id, 'note for session 2');
      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // Services per Identity Limits
  // ==========================================================================
  describe('Services per Identity (max 20)', () => {
    let db;
    let services;

    beforeEach(() => {
      db = createTestDb();
      services = createServices(db);
    });

    it('should allow claiming services below the limit', () => {
      const result = services.claim('myapp:api:main');
      expect(result.success).toBe(true);
      expect(result.port).toBeDefined();
    });

    it('should reject claims when identity has reached the limit', () => {
      // Claim 20 services under the same project identity
      for (let i = 0; i < 20; i++) {
        const r = services.claim(`fullproject:svc${i}:main`);
        expect(r.success).toBe(true);
      }

      // Attempt to claim one more under the same project
      const result = services.claim('fullproject:svc20:main');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Service limit reached/);
      expect(result.error).toMatch(/fullproject/);
      expect(result.error).toMatch(/20/);
      expect(result.code).toBe('RESOURCE_LIMIT');
    });

    it('should allow claims under a different project identity', () => {
      // Fill one project
      for (let i = 0; i < 20; i++) {
        services.claim(`project-a:svc${i}:main`);
      }

      // Different project should still work
      const result = services.claim('project-b:api:main');
      expect(result.success).toBe(true);
    });

    it('should allow claiming after releasing services', () => {
      // Fill the project
      for (let i = 0; i < 20; i++) {
        services.claim(`releasable:svc${i}:main`);
      }

      // Verify it's full
      expect(services.claim('releasable:svc20:main').success).toBe(false);

      // Release one
      services.release('releasable:svc0:main');

      // Should work now
      const result = services.claim('releasable:svc20:main');
      expect(result.success).toBe(true);
    });

    it('should still allow re-claiming an existing service (idempotent)', () => {
      // Fill the project
      for (let i = 0; i < 20; i++) {
        services.claim(`idem:svc${i}:main`);
      }

      // Re-claim an existing service should succeed (idempotent)
      const result = services.claim('idem:svc0:main');
      expect(result.success).toBe(true);
      expect(result.existing).toBe(true);
    });
  });
});

describe('Secure Random IDs (Phase 9d)', () => {
  let db;
  let sessions;

  beforeEach(() => {
    db = createTestDb();
    sessions = createSessions(db);
  });

  it('should generate session IDs using crypto.randomUUID format', () => {
    const session = sessions.start('test purpose');
    expect(session.success).toBe(true);

    // crypto.randomUUID() produces format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    // Our IDs are prefixed with 'session-'
    const id = session.id;
    expect(id).toMatch(/^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('should generate unique session IDs', () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) {
      const session = sessions.start(`session-${i}`);
      ids.add(session.id);
    }
    // All 100 should be unique
    expect(ids.size).toBe(100);
  });
});
