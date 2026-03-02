/**
 * Unit Tests for v3.4 New Features
 *
 * Tests for: Session Phases, Global File Claims, Integration Signals
 */

import { createTestDb } from '../setup-unit.js';
import { createSessions } from '../../lib/sessions.js';
import { createMessaging } from '../../lib/messaging.js';

// =============================================================================
// Session Phases
// =============================================================================

describe('Session Phases', () => {
  let db, sessions;

  beforeEach(() => {
    db = createTestDb();
    sessions = createSessions(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('setPhase()', () => {
    test('should set phase on an active session', () => {
      const session = sessions.start('Test task');
      const result = sessions.setPhase(session.id, 'testing');
      expect(result.success).toBe(true);
      expect(result.phase).toBe('testing');
      expect(result.previousPhase).toBe('in_progress');
    });

    test('should return the session in get() with phase', () => {
      const session = sessions.start('Test task');
      sessions.setPhase(session.id, 'reviewing');
      const got = sessions.get(session.id);
      expect(got.session.phase).toBe('reviewing');
    });

    test('should default new sessions to in_progress phase', () => {
      const session = sessions.start('Test task');
      const got = sessions.get(session.id);
      expect(got.session.phase).toBe('in_progress');
    });

    test('should accept all valid phases', () => {
      const validPhases = ['planning', 'in_progress', 'testing', 'reviewing', 'completed', 'abandoned'];
      for (const phase of validPhases) {
        const session = sessions.start(`Test ${phase}`);
        const result = sessions.setPhase(session.id, phase);
        expect(result.success).toBe(true);
        expect(result.phase).toBe(phase);
      }
    });

    test('should reject invalid phase', () => {
      const session = sessions.start('Test task');
      const result = sessions.setPhase(session.id, 'invalid_phase');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid phase');
    });

    test('should be case-insensitive', () => {
      const session = sessions.start('Test task');
      const result = sessions.setPhase(session.id, 'TESTING');
      expect(result.success).toBe(true);
      expect(result.phase).toBe('testing');
    });

    test('should reject empty phase', () => {
      const session = sessions.start('Test task');
      const result = sessions.setPhase(session.id, '');
      expect(result.success).toBe(false);
    });

    test('should reject null phase', () => {
      const session = sessions.start('Test task');
      const result = sessions.setPhase(session.id, null);
      expect(result.success).toBe(false);
    });

    test('should reject non-existent session', () => {
      const result = sessions.setPhase('non-existent-id', 'testing');
      expect(result.success).toBe(false);
      expect(result.error).toBe('session not found');
    });

    test('should auto-complete session when phase set to completed', () => {
      const session = sessions.start('Test task');
      sessions.claimFiles(session.id, ['foo.ts']);
      sessions.setPhase(session.id, 'completed');

      const got = sessions.get(session.id);
      expect(got.session.status).toBe('completed');
      expect(got.session.phase).toBe('completed');
      // Files should be released
      const activeFiles = got.files.filter(f => f.releasedAt === null);
      expect(activeFiles.length).toBe(0);
    });

    test('should auto-abandon session when phase set to abandoned', () => {
      const session = sessions.start('Test task');
      sessions.setPhase(session.id, 'abandoned');

      const got = sessions.get(session.id);
      expect(got.session.status).toBe('abandoned');
    });

    test('should include phase in list()', () => {
      sessions.start('Test task');
      const list = sessions.list({ allWorktrees: true });
      expect(list.sessions[0].phase).toBe('in_progress');
    });

    test('should track phase transitions', () => {
      const session = sessions.start('Multi-phase task');
      sessions.setPhase(session.id, 'planning');
      const r1 = sessions.setPhase(session.id, 'in_progress');
      expect(r1.previousPhase).toBe('planning');

      const r2 = sessions.setPhase(session.id, 'testing');
      expect(r2.previousPhase).toBe('in_progress');
    });
  });
});

// =============================================================================
// Global File Claims
// =============================================================================

describe('Global File Claims', () => {
  let db, sessions;

  beforeEach(() => {
    db = createTestDb();
    sessions = createSessions(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('listAllActiveClaims()', () => {
    test('should return empty list when no claims', () => {
      const result = sessions.listAllActiveClaims();
      expect(result.success).toBe(true);
      expect(result.claims).toEqual([]);
      expect(result.count).toBe(0);
    });

    test('should list claims across multiple sessions', () => {
      const s1 = sessions.start('Session 1');
      const s2 = sessions.start('Session 2');
      sessions.claimFiles(s1.id, ['src/foo.ts', 'src/bar.ts']);
      sessions.claimFiles(s2.id, ['src/baz.ts']);

      const result = sessions.listAllActiveClaims();
      expect(result.success).toBe(true);
      expect(result.count).toBe(3);
      expect(result.claims.map(c => c.filePath).sort()).toEqual([
        'src/bar.ts', 'src/baz.ts', 'src/foo.ts'
      ]);
    });

    test('should not include released claims', () => {
      const session = sessions.start('Test');
      sessions.claimFiles(session.id, ['src/foo.ts', 'src/bar.ts']);
      sessions.releaseFiles(session.id, ['src/foo.ts']);

      const result = sessions.listAllActiveClaims();
      expect(result.count).toBe(1);
      expect(result.claims[0].filePath).toBe('src/bar.ts');
    });

    test('should not include claims from completed sessions', () => {
      const session = sessions.start('Test');
      sessions.claimFiles(session.id, ['src/foo.ts']);
      sessions.end(session.id);

      const result = sessions.listAllActiveClaims();
      expect(result.count).toBe(0);
    });

    test('should include session metadata in claims', () => {
      const session = sessions.start('Auth module', { agentId: 'claude-1' });
      sessions.claimFiles(session.id, ['src/auth.ts']);

      const result = sessions.listAllActiveClaims();
      expect(result.claims[0]).toEqual(expect.objectContaining({
        filePath: 'src/auth.ts',
        sessionId: session.id,
        purpose: 'Auth module',
        agentId: 'claude-1',
        phase: 'in_progress',
      }));
    });

    test('should reflect phase changes in claims', () => {
      const session = sessions.start('Test');
      sessions.claimFiles(session.id, ['src/foo.ts']);
      sessions.setPhase(session.id, 'testing');

      const result = sessions.listAllActiveClaims();
      expect(result.claims[0].phase).toBe('testing');
    });
  });

  describe('getClaimOwner()', () => {
    test('should return unclaimed for unknown file', () => {
      const result = sessions.getClaimOwner('src/unknown.ts');
      expect(result.success).toBe(true);
      expect(result.claimed).toBe(false);
      expect(result.owners).toEqual([]);
    });

    test('should return owner for claimed file', () => {
      const session = sessions.start('Auth', { agentId: 'claude-1' });
      sessions.claimFiles(session.id, ['src/auth.ts']);

      const result = sessions.getClaimOwner('src/auth.ts');
      expect(result.success).toBe(true);
      expect(result.claimed).toBe(true);
      expect(result.owners.length).toBe(1);
      expect(result.owners[0].sessionId).toBe(session.id);
      expect(result.owners[0].agentId).toBe('claude-1');
    });

    test('should show multiple owners when file claimed by multiple sessions', () => {
      const s1 = sessions.start('Session 1');
      const s2 = sessions.start('Session 2');
      sessions.claimFiles(s1.id, ['src/shared.ts']);
      sessions.claimFiles(s2.id, ['src/shared.ts']);

      const result = sessions.getClaimOwner('src/shared.ts');
      expect(result.claimed).toBe(true);
      expect(result.owners.length).toBe(2);
    });

    test('should reject empty filePath', () => {
      const result = sessions.getClaimOwner('');
      expect(result.success).toBe(false);
    });

    test('should not show released claims', () => {
      const session = sessions.start('Test');
      sessions.claimFiles(session.id, ['src/foo.ts']);
      sessions.releaseFiles(session.id, ['src/foo.ts']);

      const result = sessions.getClaimOwner('src/foo.ts');
      expect(result.claimed).toBe(false);
    });
  });
});

// =============================================================================
// Integration Signals (via pub/sub)
// =============================================================================

describe('Integration Signals', () => {
  let db, messaging;

  beforeEach(() => {
    db = createTestDb();
    messaging = createMessaging(db);
  });

  afterEach(() => {
    messaging.destroy();
    db.close();
  });

  test('should publish ready signal to correct channel', () => {
    const project = 'myapp';
    const channel = `integration:${project}:ready`;
    const payload = {
      type: 'ready',
      identity: 'myapp:api',
      description: 'Auth module complete',
      timestamp: Date.now(),
    };

    const result = messaging.publish(channel, payload, { sender: 'myapp:api' });
    expect(result.success).toBe(true);

    const messages = messaging.getMessages(channel);
    expect(messages.count).toBe(1);
    expect(messages.messages[0].payload.type).toBe('ready');
    expect(messages.messages[0].payload.identity).toBe('myapp:api');
  });

  test('should publish needs signal to correct channel', () => {
    const channel = 'integration:myapp:needs';
    const payload = {
      type: 'needs',
      identity: 'myapp:frontend',
      description: 'Waiting for API auth endpoints',
      timestamp: Date.now(),
    };

    const result = messaging.publish(channel, payload, { sender: 'myapp:frontend' });
    expect(result.success).toBe(true);

    const messages = messaging.getMessages(channel);
    expect(messages.count).toBe(1);
    expect(messages.messages[0].payload.type).toBe('needs');
  });

  test('should list integration channels via listChannels', () => {
    messaging.publish('integration:myapp:ready', { type: 'ready' });
    messaging.publish('integration:myapp:needs', { type: 'needs' });
    messaging.publish('other:channel', 'hello');

    const result = messaging.listChannels();
    const integrationChannels = result.channels.filter(c => c.channel.startsWith('integration:'));
    expect(integrationChannels.length).toBe(2);
  });

  test('should support multiple projects', () => {
    messaging.publish('integration:app1:ready', { type: 'ready', identity: 'app1:api' });
    messaging.publish('integration:app2:ready', { type: 'ready', identity: 'app2:api' });

    const result = messaging.listChannels();
    const integrationChannels = result.channels.filter(c => c.channel.startsWith('integration:'));
    expect(integrationChannels.length).toBe(2);
  });

  test('should notify subscribers of integration signals', () => {
    const received = [];
    messaging.subscribe('integration:myapp:ready', (msg) => {
      received.push(msg);
    });

    messaging.publish('integration:myapp:ready', {
      type: 'ready',
      identity: 'myapp:api',
      description: 'Done',
    });

    expect(received.length).toBe(1);
    expect(received[0].payload).toContain('"type":"ready"');
  });
});
