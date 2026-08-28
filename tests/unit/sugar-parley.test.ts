import { describe, expect, test } from '@jest/globals';
import { createSugarParley } from '../../lib/sugar-parley.js';
import type { WhoisHit } from '../../lib/whois.js';

const SOURCE_ACTOR = 'actor-source';
const PEER_ACTOR = 'actor-peer';

function whoisHit(overrides: Partial<WhoisHit> = {}): WhoisHit {
  return {
    agentId: 'peer-display',
    agentName: 'Peer',
    harbor: 'port-daddy',
    phrase: 'coordinate the shared Sugar workflow',
    score: 0.93,
    similarity: 0.95,
    bm25Score: 1,
    freshnessWeight: 1,
    lastHeartbeat: 1_700_000_000_000,
    stage: 'semantic',
    source: 'declared',
    ...overrides,
  };
}

function harness(options: {
  hits?: WhoisHit[];
  sourceClaim?: Record<string, unknown> | null;
  peerClaim?: Record<string, unknown> | null;
  peerSessionId?: string;
  additionalPeerSessions?: Array<Record<string, unknown>>;
  additionalClaims?: Array<Record<string, unknown>>;
  peerSessionMetadata?: Record<string, unknown>;
  directPeerActorId?: string;
  triggerState?: 'fired' | 'replayed' | 'suppressed' | 'failed';
} = {}) {
  const peerSessionId = options.peerSessionId ?? 'session-peer';
  const sourceClaim = options.sourceClaim === undefined
    ? {
      filePath: 'lib/shared.ts', sessionId: 'session-source', agentId: 'source-display',
      claimedAt: 1_700_000_000_001, symbolPath: 'createShared', startLine: 10, endLine: 30,
    }
    : options.sourceClaim;
  const peerClaim = options.peerClaim === undefined
    ? {
      filePath: 'lib/shared.ts', sessionId: peerSessionId, agentId: 'peer-display',
      claimedAt: 1_700_000_000_002, symbolPath: 'createShared', startLine: 10, endLine: 30,
    }
    : options.peerClaim;
  const evaluations: Array<{ signal: unknown; harbor: string }> = [];
  const service = createSugarParley({
    sessions: {
      get(sessionId) {
        return sessionId === 'session-source'
          ? { success: true, session: { id: 'session-source', agentId: 'source-display', purpose: 'Coordinate the shared Sugar workflow', status: 'active' } }
          : sessionId === peerSessionId
            ? {
              success: true,
              session: {
                id: peerSessionId,
                agentId: 'peer-display',
                purpose: 'Coordinate the shared Sugar workflow',
                status: 'active',
                ...(options.peerSessionMetadata ? { metadata: options.peerSessionMetadata } : {}),
              },
            }
            : (() => {
              const extra = (options.additionalPeerSessions ?? []).find((session) => session.id === sessionId);
              return extra ? { success: true, session: extra } : { success: false };
            })();
      },
      list() {
        return {
          success: true,
          sessions: [
            { id: 'session-source', agentId: 'source-display', purpose: 'Coordinate the shared Sugar workflow', status: 'active' },
            {
              id: peerSessionId,
              agentId: 'peer-display',
              purpose: 'Coordinate the shared Sugar workflow',
              status: 'active',
              ...(options.peerSessionMetadata ? { metadata: options.peerSessionMetadata } : {}),
            },
            ...(options.additionalPeerSessions ?? []),
          ],
        };
      },
      listAllActiveClaims() {
        return { success: true, claims: [sourceClaim, peerClaim, ...(options.additionalClaims ?? [])].filter(Boolean) };
      },
    },
    actorSouls: {
      resolveActor(agentId) {
        if (agentId === 'source-display') return { actorId: SOURCE_ACTOR, soulClass: 'minted' };
        if (agentId === 'peer-display') return { actorId: options.directPeerActorId ?? PEER_ACTOR, soulClass: 'minted' };
        if (agentId === PEER_ACTOR) return { actorId: PEER_ACTOR, soulClass: 'minted' };
        return { actorId: agentId, soulClass: 'unknown' };
      },
    },
    whois: {
      async search() {
        return options.hits ?? [whoisHit()];
      },
    },
    parleyAutoTrigger: {
      evaluate(signal, context) {
        evaluations.push({ signal, harbor: context.harbor, resolveLiveParty: context.resolveLiveParty });
        const state = options.triggerState ?? 'fired';
        return {
          state,
          signalId: (signal as { signalId: string }).signalId,
          lineageKey: 'lineage',
          decision: {
            convene: state === 'fired' || state === 'replayed',
            checkpoint: 'session_begin',
            signalId: (signal as { signalId: string }).signalId,
            policyCleared: true,
            unresolved: 1,
            expectedWaste: 1.9,
            margin: 0.9,
            terminated: null,
            reason: 'fixture',
          },
          parleyId: state === 'fired' || state === 'replayed' ? 'parley-auto:fixture' : null,
          reason: 'fixture',
        };
      },
    },
  });
  return { service, evaluations };
}

const input = {
  sessionId: 'session-source',
  actorId: SOURCE_ACTOR,
};

describe('Sugar-first Parley coordinator', () => {
  test('shows one bounded card only when semantic review and exact structure agree', async () => {
    const { service } = harness();

    const result = await service.preview(input);

    expect(result).toMatchObject({
      state: 'ready',
      card: {
        kind: 'sugar_parley_card',
        surface: 'session-begin:lib/shared.ts#createShared',
        participants: [
          { actorId: PEER_ACTOR, sessionId: 'session-peer' },
          { actorId: SOURCE_ACTOR, sessionId: 'session-source' },
        ],
        semanticEvidence: { stage: 'semantic', score: 0.93 },
        structuralEvidence: {
          address: { filePath: 'lib/shared.ts', symbolPath: 'createShared' },
        },
        bounds: { maxParleyRounds: 2 },
      },
    });
    if (result.state !== 'ready') throw new Error('expected a coordination card');
    expect(result.card.actions).toEqual([
      { id: 'work-separately', label: 'Work separately', enabled: true, reason: null },
      { id: 'send-note', label: 'Send note', enabled: true, reason: null },
      { id: 'resolve-together', label: 'Resolve together', enabled: true, reason: null },
    ]);
  });

  test('does not turn a lexical candidate without semantic review into a card', async () => {
    const { service } = harness({ hits: [whoisHit({ stage: 'bm25', similarity: 0.2 })] });

    await expect(service.preview(input)).resolves.toEqual({
      state: 'none',
      reason: 'No semantically reviewed live peer is relevant enough to coordinate.',
    });
  });

  test('accepts a hybrid phonebook candidate only when its cosine review also clears the threshold', async () => {
    const { service } = harness({ hits: [whoisHit({ stage: 'bm25', score: 0.93, similarity: 0.95 })] });

    await expect(service.preview(input)).resolves.toMatchObject({
      state: 'ready',
      card: {
        semanticEvidence: {
          stage: 'semantic',
          resolverStage: 'bm25',
          score: 0.93,
          similarity: 0.95,
        },
      },
    });
  });

  test('does not infer a card when semantic relevance lacks structural overlap', async () => {
    const { service } = harness({
      peerClaim: {
        filePath: 'lib/other.ts', sessionId: 'session-peer', agentId: 'peer-display',
        claimedAt: 1_700_000_000_002, symbolPath: 'createOther', startLine: 10, endLine: 30,
      },
    });

    await expect(service.preview(input)).resolves.toEqual({
      state: 'none',
      reason: 'Semantic relevance exists, but no exact active claim overlap grounds a card.',
    });
  });

  test('finds and delivers to the overlapping session when one canonical peer holds multiple active sessions', async () => {
    const { service, evaluations } = harness({
      peerSessionId: 'session-peer-a',
      peerClaim: {
        filePath: 'lib/unrelated.ts', sessionId: 'session-peer-a', agentId: 'peer-display',
        claimedAt: 1_700_000_000_002, symbolPath: 'createOther', startLine: 10, endLine: 30,
      },
      additionalPeerSessions: [
        { id: 'session-peer-b', agentId: 'peer-display', purpose: 'Coordinate the shared Sugar workflow', status: 'active' },
      ],
      additionalClaims: [
        {
          filePath: 'lib/shared.ts', sessionId: 'session-peer-b', agentId: 'peer-display',
          claimedAt: 1_700_000_000_003, symbolPath: 'createShared', startLine: 10, endLine: 30,
        },
      ],
    });

    const preview = await service.preview(input);
    expect(preview).toMatchObject({
      state: 'ready',
      card: {
        participants: expect.arrayContaining([
          expect.objectContaining({ actorId: PEER_ACTOR, sessionId: 'session-peer-b' }),
        ]),
      },
    });
    if (preview.state !== 'ready') throw new Error('expected the overlapping peer session');
    await service.resolveTogether({ ...input, signalId: preview.card.signalId, harbor: 'port-daddy' });
    const resolver = evaluations[0]?.resolveLiveParty as ((actorId: string) => { sessionId: string } | null) | undefined;
    expect(resolver?.(PEER_ACTOR)).toMatchObject({ sessionId: 'session-peer-b' });
  });

  test('prefers the verified session stamp over a legacy display-alias soul', async () => {
    const { service } = harness({
      directPeerActorId: 'legacy-peer-display-soul',
      peerSessionMetadata: { identity: { verified: true, actorId: PEER_ACTOR } },
    });

    await expect(service.preview(input)).resolves.toMatchObject({
      state: 'ready',
      card: {
        participants: expect.arrayContaining([
          expect.objectContaining({ actorId: PEER_ACTOR, sessionId: 'session-peer' }),
        ]),
      },
    });
  });

  test('re-derives the card before admission and supplies a distinct hook context', async () => {
    const { service, evaluations } = harness();
    const preview = await service.preview(input);
    if (preview.state !== 'ready') throw new Error('expected a coordination card');

    const receipt = await service.resolveTogether({
      ...input,
      signalId: preview.card.signalId,
      harbor: 'port-daddy',
    });

    expect(evaluations).toHaveLength(1);
    expect(evaluations[0]).toMatchObject({ harbor: 'port-daddy' });
    expect(receipt).toMatchObject({
      state: 'fired',
      cardId: preview.card.cardId,
      signalId: preview.card.signalId,
      parleyId: 'parley-auto:fixture',
      hookContext: {
        kind: 'sugar_parley_hook_context',
        parleyId: 'parley-auto:fixture',
        surface: 'session-begin:lib/shared.ts#createShared',
      },
    });
  });

  test('fails closed when a client presents an obsolete card signal', async () => {
    const { service, evaluations } = harness();

    const receipt = await service.resolveTogether({
      ...input,
      signalId: 'parley-signal:v1:stale',
      harbor: 'port-daddy',
    });

    expect(evaluations).toHaveLength(0);
    expect(receipt).toMatchObject({
      state: 'rejected',
      reason: 'The coordination card changed; re-read its current evidence before resolving together.',
    });
  });
});
