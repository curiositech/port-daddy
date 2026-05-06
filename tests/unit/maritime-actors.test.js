import { describe, expect, test } from '@jest/globals';
import {
  getMaritimeActor,
  listMaritimeActors,
  resolveMaritimeActorId,
} from '../../lib/maritime-actors.js';

describe('fleet actors (formerly maritime)', () => {
  test('defines the canonical durable actor roster', () => {
    const actors = listMaritimeActors();

    expect(actors.map(actor => actor.id)).toEqual([
      'gardener',
      'qa',
      'test-hunter',
      'documentarian',
      'simplifier',
      'coxswain',
      'quartermaster',
      'cartographer',
      'spark',
      'spider',
    ]);
    // Mailboxes are addressed by fleet name, not maritime metaphor.
    expect(actors.every(actor => actor.inboxTarget === `actor:${actor.id}`)).toBe(true);
  });

  test('resolves deprecated maritime aliases to the fleet-name canonical id', () => {
    expect(resolveMaritimeActorId('navigator')).toBe('cartographer');
    expect(resolveMaritimeActorId('lookout')).toBe('documentarian');
    expect(resolveMaritimeActorId('signalman')).toBe('qa');
    expect(resolveMaritimeActorId('claim-owner')).toBe('coxswain');
    // Comms-officer aliases route to coxswain since the comm pipeline is
    // their domain too.
    expect(resolveMaritimeActorId('comms-officer')).toBe('coxswain');
    expect(resolveMaritimeActorId('signaler')).toBe('coxswain');
    expect(resolveMaritimeActorId('budget')).toBe('quartermaster');
    expect(resolveMaritimeActorId('backend-owner')).toBe('quartermaster');
    // Identity is identity.
    expect(resolveMaritimeActorId('coxswain')).toBe('coxswain');
    expect(resolveMaritimeActorId('quartermaster')).toBe('quartermaster');
    expect(resolveMaritimeActorId('cartographer')).toBe('cartographer');
    expect(resolveMaritimeActorId('qa')).toBe('qa');
  });

  test('keeps standalone coordination and spend owners without inventing the rest of the future roster', () => {
    const coxswain = getMaritimeActor('coxswain');
    const quartermaster = getMaritimeActor('quartermaster');

    expect(coxswain).toEqual(expect.objectContaining({
      id: 'coxswain',
      label: 'Coxswain',
      inboxTarget: 'actor:coxswain',
      compatibilityFleetAgent: null,
      leaseState: 'dormant',
    }));
    expect(coxswain?.owns).toEqual(expect.arrayContaining([
      'claims',
      'locks',
      'stale-assets',
      'symbolic-coordination',
      'session-contention',
      // Comms-officer expansion — coxswain owns the live communications
      // fabric in addition to the static coordination primitives.
      'channels',
      'tuples',
      'channel-naming-hygiene',
      'tuple-nomenclature',
      'subscription-coverage',
      'silent-agents',
      'comm-pipeline-debug',
    ]));
    expect(quartermaster).toEqual(expect.objectContaining({
      id: 'quartermaster',
      label: 'Quartermaster',
      inboxTarget: 'actor:quartermaster',
      compatibilityFleetAgent: null,
      leaseState: 'dormant',
    }));
    expect(quartermaster?.owns).toEqual(expect.arrayContaining([
      'backends',
      'models',
      'telemetry-policy',
      'budget',
      'launch-readiness',
    ]));
    expect(resolveMaritimeActorId('harbormaster')).toBeNull();
    expect(resolveMaritimeActorId('sounder')).toBeNull();
    expect(resolveMaritimeActorId('breaker')).toBeNull();
    expect(resolveMaritimeActorId('caulker')).toBeNull();
  });

  test('projects live body, session, and salvage evidence onto cartographer', () => {
    const cartographer = getMaritimeActor('cartographer', {
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

    expect(cartographer).toEqual(expect.objectContaining({
      id: 'cartographer',
      leaseState: 'attached',
      lastActivityAt: 200,
    }));
    expect(cartographer?.liveBodies).toHaveLength(1);
    expect(cartographer?.recentSessions).toHaveLength(1);
    expect(cartographer?.salvage).toHaveLength(1);
    expect(cartographer?.evidence).toContain('compatibility fleet agent: cartographer');
  });

  test('does not attach topical coordination sessions as live actor bodies', () => {
    const cartographer = getMaritimeActor('cartographer', {
      agents: [{
        id: 'agent-fix',
        identity: 'port-daddy:cartographer-body-fix',
        purpose: 'Fix Cartographer live body matching',
        lastHeartbeat: 300,
        healthAssessment: { liveness: 'alive' },
      }],
      sessions: [{
        id: 'session-fix',
        status: 'active',
        purpose: 'Fix Cartographer live body matching',
        agentId: 'agent-fix',
        updatedAt: 400,
      }],
    });

    expect(cartographer?.liveBodies).toHaveLength(0);
    expect(cartographer?.recentSessions).toHaveLength(1);
    expect(cartographer?.leaseState).toBe('detached');
  });

  test('classifies actors without live bodies as dormant, detached, or recoverable', () => {
    expect(getMaritimeActor('spark')?.leaseState).toBe('dormant');
    expect(getMaritimeActor('spark', {
      sessions: [{ id: 'session-spark', purpose: 'spark idea review', status: 'completed' }],
    })?.leaseState).toBe('detached');
    expect(getMaritimeActor('spark', {
      salvage: [{ id: 'agent-spark-dead', purpose: 'spark crashed mid-idea', status: 'pending' }],
    })?.leaseState).toBe('recoverable');
  });
});
