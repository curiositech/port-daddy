import { describe, expect, test } from '@jest/globals';
import {
  getMaritimeActor,
  listMaritimeActors,
  resolveMaritimeActorId,
} from '../../lib/maritime-actors.js';

describe('maritime actors', () => {
  test('defines the canonical durable actor roster', () => {
    const actors = listMaritimeActors();

    expect(actors.map(actor => actor.id)).toEqual([
      'navigator',
      'coxswain',
      'signalman',
      'harbormaster',
      'sounder',
      'lookout',
      'breaker',
      'caulker',
      'quartermaster',
    ]);
    expect(actors.every(actor => actor.inboxTarget.startsWith('actor:'))).toBe(true);
  });

  test('resolves compatibility aliases without creating duplicate souls', () => {
    expect(resolveMaritimeActorId('cartographer')).toBe('navigator');
    expect(resolveMaritimeActorId('documentarian')).toBe('lookout');
    expect(resolveMaritimeActorId('qa')).toBe('signalman');
  });

  test('projects live body, session, and salvage evidence onto actor souls', () => {
    const navigator = getMaritimeActor('navigator', {
      agents: [{
        id: 'agent-cartographer',
        identity: 'port-daddy:fleet:cartographer',
        purpose: 'maintain roadmap status',
        lastHeartbeat: 100,
        healthAssessment: { liveness: 'alive' },
      }],
      sessions: [{
        id: 'session-map',
        status: 'active',
        purpose: 'Cartographer roadmap update',
        agentId: 'agent-cartographer',
        updatedAt: 200,
      }],
      salvage: [{
        id: 'agent-dead-map',
        status: 'pending',
        purpose: 'cartographer crashed mid-map',
        sessionId: 'session-old',
        updatedAt: 150,
      }],
    });

    expect(navigator).toEqual(expect.objectContaining({
      id: 'navigator',
      leaseState: 'attached',
      lastActivityAt: 200,
    }));
    expect(navigator?.liveBodies).toHaveLength(1);
    expect(navigator?.recentSessions).toHaveLength(1);
    expect(navigator?.salvage).toHaveLength(1);
    expect(navigator?.evidence).toContain('compatibility fleet agent: cartographer');
  });

  test('classifies actors without live bodies as dormant, detached, or recoverable', () => {
    expect(getMaritimeActor('coxswain')?.leaseState).toBe('dormant');
    expect(getMaritimeActor('coxswain', {
      sessions: [{ id: 'session-locks', purpose: 'coxswain lock review', status: 'completed' }],
    })?.leaseState).toBe('detached');
    expect(getMaritimeActor('coxswain', {
      salvage: [{ id: 'agent-claims', purpose: 'coxswain stale asset pass', status: 'pending' }],
    })?.leaseState).toBe('recoverable');
  });
});
