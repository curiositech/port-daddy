import { jest } from '@jest/globals';
import { scopeSugarSessionsToCoordinationProject } from '../../lib/coordination-session-scope.js';
import { createTestDb } from '../setup-unit.js';
import { createAgents } from '../../lib/agents.js';
import { createSessions } from '../../lib/sessions.js';
import { createActivityLog } from '../../lib/activity.js';
import { createSugar } from '../../lib/sugar.js';

function sessionsStub() {
  return {
    start: jest.fn(() => ({ success: true, id: 'session-1' })),
    takeover: jest.fn(() => ({ success: true, successorId: 'session-2' })),
    list: jest.fn(() => ({
      success: true,
      sessions: [
        {
          id: 'session-1',
          identityProject: 'curiositech/port-daddy',
          metadata: JSON.stringify({ identity: 'fleet:run-123' }),
        },
        {
          id: 'session-2',
          identityProject: 'another-room',
          metadata: { semanticIdentity: 'other:worker' },
        },
      ],
    })),
    get: jest.fn(() => ({ success: true })),
  };
}

describe('scopeSugarSessionsToCoordinationProject', () => {
  it('stores starts and takeovers in the exact coordination room', () => {
    const sessions = sessionsStub();
    const scoped = scopeSugarSessionsToCoordinationProject(sessions, 'curiositech/port-daddy');

    scoped.start('Cloud sandbox coordination peer', { project: 'fleet', agentId: 'fleet:run-123' });
    scoped.takeover('session-1', { project: 'fleet', durable: true });

    expect(sessions.start).toHaveBeenCalledWith('Cloud sandbox coordination peer', {
      project: 'curiositech/port-daddy',
      agentId: 'fleet:run-123',
    });
    expect(sessions.takeover).toHaveBeenCalledWith('session-1', {
      project: 'curiositech/port-daddy',
      durable: true,
    });
  });

  it('projects the semantic identity project only for Sugar resume lookup', () => {
    const sessions = sessionsStub();
    const scoped = scopeSugarSessionsToCoordinationProject(sessions, 'curiositech/port-daddy');

    const result = scoped.list({ status: 'active' });

    expect(result.sessions[0].identityProject).toBe('fleet');
    expect(result.sessions[1].identityProject).toBe('another-room');
    expect(sessions.list).toHaveBeenCalledWith({ status: 'active' });
  });

  it('supports the semanticIdentity metadata shape and forwards other methods', () => {
    const sessions = sessionsStub();
    sessions.list.mockReturnValue({
      success: true,
      sessions: [{
        identityProject: 'curiositech/port-daddy',
        metadata: { semanticIdentity: 'fleet:run-456' },
      }],
    });
    const scoped = scopeSugarSessionsToCoordinationProject(sessions, 'curiositech/port-daddy');

    expect(scoped.list().sessions[0].identityProject).toBe('fleet');
    expect(scoped.get('session-1')).toEqual({ success: true });
    expect(sessions.get).toHaveBeenCalledWith('session-1');
  });

  it('preserves Sugar semantic identity metadata while storing the row in the room', () => {
    const db = createTestDb();
    const agents = createAgents(db);
    const rawSessions = createSessions(db);
    const activityLog = createActivityLog(db);
    rawSessions.setActivityLog(activityLog);
    const scopedSessions = scopeSugarSessionsToCoordinationProject(
      rawSessions,
      'curiositech/port-daddy',
    );
    const sugar = createSugar({
      agents,
      sessions: scopedSessions,
      activityLog,
      gitOriginChecker: {
        checkBranchOnOrigin: () => ({
          ok: true,
          branch: 'codex/cloud-peer',
          upstream: 'origin/codex/cloud-peer',
          ahead: 0,
        }),
      },
    });

    const began = sugar.begin({
      lifecycle: 'durable',
      identity: 'fleet:run:delivery-123',
      purpose: 'Cloud sandbox coordination peer',
    });
    expect(began.success).toBe(true);

    const stored = rawSessions.get(began.sessionId);
    expect(stored.session).toMatchObject({
      identityProject: 'curiositech/port-daddy',
      metadata: expect.objectContaining({ identityString: 'fleet:run:delivery-123' }),
    });
    expect(scopedSessions.list({ status: 'active' }).sessions[0]).toMatchObject({
      identityProject: 'fleet',
      metadata: expect.objectContaining({ identityString: 'fleet:run:delivery-123' }),
    });
  });

  it('is an identity operation when coordination is disabled', () => {
    const sessions = sessionsStub();
    expect(scopeSugarSessionsToCoordinationProject(sessions, null)).toBe(sessions);
  });
});
