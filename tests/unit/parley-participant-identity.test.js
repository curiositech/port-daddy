import { describe, expect, test, jest } from '@jest/globals';
import {
  MAX_PARLEY_IDENTITY_PARTICIPANTS,
  resolveParleyParticipantIdentities,
} from '../../lib/parley-participant-identity.js';

function session(id, actorId, options = {}) {
  const harbor = options.harbor ?? 'tenant-a';
  const inboxTarget = options.inboxTarget ?? actorId;
  return {
    success: true,
    session: {
      id,
      status: options.status ?? 'active',
      // Deliberately non-authoritative: hostile tests set this to a victim.
      agentId: options.agentId ?? inboxTarget,
      metadata: {
        identity: options.identity ?? { verified: true, actorId, soulClass: 'agent' },
        ...(options.predecessorSessionId === undefined
          ? {}
          : { predecessorSessionId: options.predecessorSessionId }),
        ...(options.omitInbox
          ? {}
          : {
              actorInbox: options.actorInbox ?? {
                verified: true,
                actorId,
                harbor,
                inboxTarget,
              },
            }),
      },
    },
  };
}

function source(entries, options = {}) {
  const records = new Map(entries.map((entry) => [entry.session.id, entry]));
  return {
    get(id) {
      return records.get(id) ?? { success: false, error: 'not found' };
    },
    findSuccessors(id) {
      if (options.incompleteFor === id) return { success: true, complete: false, sessions: [] };
      if (options.failFor === id) return { success: false, error: 'index unavailable' };
      return {
        success: true,
        complete: true,
        sessions: [...records.values()]
          .filter((entry) => entry.session.metadata?.predecessorSessionId === id)
          .map((entry) => entry.session),
      };
    },
  };
}

function inboxSource(bindings) {
  const resolveLiveActorInbox = jest.fn((actorId, harbor) => {
    const value = bindings.get(`${harbor}\0${actorId}`);
    if (!value) {
      return {
        success: false,
        code: 'ACTOR_INBOX_UNBOUND',
        error: `no inbox for ${harbor}/${actorId}`,
      };
    }
    if (value.stale) {
      return {
        success: false,
        code: 'ACTOR_INBOX_STALE',
        error: `stale inbox for ${harbor}/${actorId}`,
      };
    }
    return {
      success: true,
      binding: {
        actorId: value.actorId ?? actorId,
        harbor: value.harbor ?? harbor,
        inboxTarget: value.inboxTarget ?? actorId,
        boundAt: value.boundAt ?? 10,
        lastHeartbeat: value.lastHeartbeat ?? 20,
      },
    };
  });
  return { resolveLiveActorInbox };
}

function liveBindings(...actorIds) {
  return new Map(actorIds.map((actorId) => [
    `tenant-a\0${actorId}`,
    { actorId, harbor: 'tenant-a', inboxTarget: actorId },
  ]));
}

describe('Parley participant identity prerequisite', () => {
  test('persists caller assertion separately from daemon-selected live evidence', () => {
    const sessions = source([
      session('session-a-old', 'actor-a', { status: 'completed' }),
      session('session-a-live', 'actor-a', { predecessorSessionId: 'session-a-old' }),
      session('session-b-live', 'actor-b'),
    ]);
    const inboxes = inboxSource(liveBindings('actor-a', 'actor-b'));

    expect(resolveParleyParticipantIdentities(
      ['session-a-old', 'session-b-live'],
      sessions,
      inboxes,
      { harbor: 'tenant-a' },
    )).toEqual({
      ok: true,
      participants: [
        {
          actorId: 'actor-a',
          harbor: 'tenant-a',
          inboxTarget: 'actor-a',
          lineageRootSessionId: 'session-a-old',
          asserted: { sessionId: 'session-a-old' },
          selected: {
            sessionId: 'session-a-live',
            actorId: 'actor-a',
            harbor: 'tenant-a',
            inboxTarget: 'actor-a',
            inboxBoundAt: 10,
            inboxLastHeartbeat: 20,
          },
        },
        expect.objectContaining({
          actorId: 'actor-b',
          asserted: { sessionId: 'session-b-live' },
          selected: expect.objectContaining({ sessionId: 'session-b-live' }),
        }),
      ],
    });
  });

  test('a fresh victim agentId in session evidence has zero delivery authority', () => {
    const sessions = source([
      session('session-attacker', 'actor-attacker', { agentId: 'fresh-victim-agent' }),
      session('session-peer', 'actor-peer'),
    ]);
    const inboxes = inboxSource(liveBindings('actor-attacker', 'actor-peer'));
    const result = resolveParleyParticipantIdentities(
      ['session-attacker', 'session-peer'],
      sessions,
      inboxes,
      { harbor: 'tenant-a' },
    );

    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(result.participants[0]).toEqual(expect.objectContaining({
      actorId: 'actor-attacker',
      inboxTarget: 'actor-attacker',
    }));
    expect(JSON.stringify(result)).not.toContain('fresh-victim-agent');
  });

  test('forged selected inbox metadata cannot substitute a victim endpoint', () => {
    const sessions = source([
      session('session-attacker', 'actor-attacker', { inboxTarget: 'fresh-victim-agent' }),
      session('session-peer', 'actor-peer'),
    ]);
    const inboxes = inboxSource(liveBindings('actor-attacker', 'actor-peer'));
    expect(resolveParleyParticipantIdentities(
      ['session-attacker', 'session-peer'], sessions, inboxes, { harbor: 'tenant-a' },
    )).toEqual(expect.objectContaining({
      ok: false,
      code: 'PARLEY_INBOX_BINDING_MISMATCH',
      sessionId: 'session-attacker',
    }));
    expect(inboxes.resolveLiveActorInbox).not.toHaveBeenCalled();
  });

  test('a closed historical session with no successor fails closed as stale', () => {
    const sessions = source([
      session('session-a-old', 'actor-a', { status: 'completed' }),
      session('session-b', 'actor-b'),
    ]);
    expect(resolveParleyParticipantIdentities(
      ['session-a-old', 'session-b'], sessions, inboxSource(liveBindings('actor-a', 'actor-b')), { harbor: 'tenant-a' },
    )).toEqual(expect.objectContaining({
      ok: false,
      code: 'PARLEY_SUCCESSOR_STALE',
      sessionId: 'session-a-old',
    }));
  });

  test('ambiguous verified successors fail closed before inbox selection', () => {
    const sessions = source([
      session('session-a-old', 'actor-a', { status: 'completed' }),
      session('session-a-live-1', 'actor-a', { predecessorSessionId: 'session-a-old' }),
      session('session-a-live-2', 'actor-a', { predecessorSessionId: 'session-a-old' }),
      session('session-b', 'actor-b'),
    ]);
    const inboxes = inboxSource(liveBindings('actor-a', 'actor-b'));
    expect(resolveParleyParticipantIdentities(
      ['session-a-old', 'session-b'], sessions, inboxes, { harbor: 'tenant-a' },
    )).toEqual(expect.objectContaining({
      ok: false,
      code: 'PARLEY_SUCCESSOR_AMBIGUOUS',
      sessionId: 'session-a-old',
    }));
    expect(inboxes.resolveLiveActorInbox).not.toHaveBeenCalled();
  });

  test('same-named actor evidence from another harbor cannot cross tenant scope', () => {
    const sessions = source([
      session('session-shared', 'actor-same-name', { harbor: 'tenant-b' }),
      session('session-peer', 'actor-peer'),
    ]);
    const bindings = liveBindings('actor-peer');
    bindings.set('tenant-b\0actor-same-name', {
      actorId: 'actor-same-name', harbor: 'tenant-b', inboxTarget: 'actor-same-name',
    });
    const inboxes = inboxSource(bindings);
    expect(resolveParleyParticipantIdentities(
      ['session-shared', 'session-peer'], sessions, inboxes, { harbor: 'tenant-a' },
    )).toEqual(expect.objectContaining({
      ok: false,
      code: 'PARLEY_HARBOR_MISMATCH',
      sessionId: 'session-shared',
    }));
    expect(inboxes.resolveLiveActorInbox).not.toHaveBeenCalled();
  });

  test('missing server-selected tenant scope is a typed fail-closed prerequisite', () => {
    expect(resolveParleyParticipantIdentities(
      ['session-a', 'session-b'], source([]), inboxSource(new Map()), {},
    )).toEqual({
      ok: false,
      code: 'PARLEY_HARBOR_SCOPE_REQUIRED',
      error: 'Parley participant identity requires a server-selected harbor scope',
    });
  });

  test('a capped or incomplete successor scan is never accepted as authority', () => {
    const sessions = source([
      session('session-a', 'actor-a'),
      session('session-b', 'actor-b'),
    ], { incompleteFor: 'session-a' });
    expect(resolveParleyParticipantIdentities(
      ['session-a', 'session-b'], sessions, inboxSource(liveBindings('actor-a', 'actor-b')), { harbor: 'tenant-a' },
    )).toEqual(expect.objectContaining({
      ok: false,
      code: 'PARLEY_SUCCESSOR_INDEX_UNAVAILABLE',
      sessionId: 'session-a',
    }));
  });

  test.each([
    ['unbound', new Map(), 'PARLEY_INBOX_UNBOUND'],
    ['stale', new Map([['tenant-a\0actor-a', { stale: true }]]), 'PARLEY_INBOX_STALE'],
  ])('rejects a %s selected endpoint', (_label, bindings, code) => {
    const sessions = source([session('session-a', 'actor-a'), session('session-b', 'actor-b')]);
    expect(resolveParleyParticipantIdentities(
      ['session-a', 'session-b'], sessions, inboxSource(bindings), { harbor: 'tenant-a' },
    )).toEqual(expect.objectContaining({ ok: false, code, sessionId: 'session-a' }));
  });

  test('legacy identity authority without a selected inbox stamp is rejected', () => {
    const sessions = source([
      session('session-a', 'actor-a', { omitInbox: true }),
      session('session-b', 'actor-b'),
    ]);
    expect(resolveParleyParticipantIdentities(
      ['session-a', 'session-b'], sessions, inboxSource(liveBindings('actor-a', 'actor-b')), { harbor: 'tenant-a' },
    )).toEqual(expect.objectContaining({
      ok: false,
      code: 'PARLEY_SESSION_HARBOR_UNVERIFIED',
      sessionId: 'session-a',
    }));
  });

  test('bounds participant fan-out before session or inbox reads', () => {
    const sessions = {
      get: jest.fn(),
      findSuccessors: jest.fn(),
    };
    const inboxes = { resolveLiveActorInbox: jest.fn() };
    const ids = Array.from(
      { length: MAX_PARLEY_IDENTITY_PARTICIPANTS + 1 },
      (_, index) => `session-${index}`,
    );
    expect(resolveParleyParticipantIdentities(ids, sessions, inboxes, { harbor: 'tenant-a' }))
      .toEqual(expect.objectContaining({ ok: false, code: 'PARLEY_PARTICIPANTS_LIMIT' }));
    expect(sessions.get).not.toHaveBeenCalled();
    expect(inboxes.resolveLiveActorInbox).not.toHaveBeenCalled();
  });
});
