import { jest } from '@jest/globals';
import { scopeSugarSessionsToCoordinationProject } from '../../lib/coordination-session-scope.js';

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

  it('is an identity operation when coordination is disabled', () => {
    const sessions = sessionsStub();
    expect(scopeSugarSessionsToCoordinationProject(sessions, null)).toBe(sessions);
  });
});
