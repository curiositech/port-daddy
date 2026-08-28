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
  sourceSessionMetadata?: Record<string, unknown> | null;
  peerSessionMetadata?: Record<string, unknown> | null;
  directPeerActorId?: string;
  triggerState?: 'fired' | 'replayed' | 'suppressed' | 'failed';
} = {}) {
  const peerSessionId = options.peerSessionId ?? 'session-peer';
  const sourceSessionMetadata = options.sourceSessionMetadata === undefined
    ? { identity: { verified: true, actorId: SOURCE_ACTOR } }
    : options.sourceSessionMetadata;
  const peerSessionMetadata = options.peerSessionMetadata === undefined
    ? { identity: { verified: true, actorId: PEER_ACTOR } }
    : options.peerSessionMetadata;
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
  const evaluations: Array<{
    signal: unknown;
    harbor: string;
    resolveLiveParty: (actorId: string) => { sessionId: string } | null;
    resolvedPartySessions: Array<{ actorId: string; sessionId: string | null }>;
  }> = [];
  const service = createSugarParley({
    sessions: {
      get(sessionId) {
        return sessionId === 'session-source'
          ? {
            success: true,
            session: {
              id: 'session-source',
              agentId: 'source-display',
              purpose: 'Coordinate the shared Sugar workflow',
              status: 'active',
              ...(sourceSessionMetadata ? { metadata: sourceSessionMetadata } : {}),
            },
          }
          : sessionId === peerSessionId
            ? {
              success: true,
              session: {
                id: peerSessionId,
                agentId: 'peer-display',
                purpose: 'Coordinate the shared Sugar workflow',
                status: 'active',
                ...(peerSessionMetadata ? { metadata: peerSessionMetadata } : {}),
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
            {
              id: 'session-source',
              agentId: 'source-display',
              purpose: 'Coordinate the shared Sugar workflow',
              status: 'active',
              ...(sourceSessionMetadata ? { metadata: sourceSessionMetadata } : {}),
            },
            {
              id: peerSessionId,
              agentId: 'peer-display',
              purpose: 'Coordinate the shared Sugar workflow',
              status: 'active',
              ...(peerSessionMetadata ? { metadata: peerSessionMetadata } : {}),
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
        if (agentId === SOURCE_ACTOR) return { actorId: SOURCE_ACTOR, soulClass: 'minted' };
        if (agentId === 'peer-display') return { actorId: options.directPeerActorId ?? PEER_ACTOR, soulClass: 'minted' };
        if (agentId === PEER_ACTOR) return { actorId: PEER_ACTOR, soulClass: 'minted' };
        if (agentId === options.directPeerActorId) return { actorId: agentId, soulClass: 'minted' };
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
        const parties = Array.isArray((signal as { parties?: unknown }).parties)
          ? (signal as { parties: unknown[] }).parties.filter((party): party is string => typeof party === 'string')
          : [];
        const resolvedPartySessions = parties.map((actorId) => ({
          actorId,
          sessionId: context.resolveLiveParty(actorId)?.sessionId ?? null,
        }));
        evaluations.push({
          signal,
          harbor: context.harbor,
          resolveLiveParty: context.resolveLiveParty,
          resolvedPartySessions,
        });
        const state = options.triggerState ?? (
          resolvedPartySessions.length > 0 && resolvedPartySessions.every((party) => party.sessionId !== null)
            ? 'fired'
            : 'failed'
        );
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
        surface: expect.stringMatching(/^session-begin:lib\/shared\.ts#createShared \[local\/worktree\/unscoped\]@[0-9a-f]{16}$/),
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

  test('uses the same semantic-or-LLM reviewed-peer policy as ordinary pd begin', async () => {
    const { service } = harness({ hits: [whoisHit({ stage: 'bm25', score: 0.93, similarity: 0.95 })] });

    await expect(service.preview(input)).resolves.toEqual({
      state: 'none',
      reason: 'No semantically reviewed live peer is relevant enough to coordinate.',
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

  test('keeps canonical one-based ranges and fails closed on malformed rows', async () => {
    const ranged = (sessionId: string, agentId: string, claimedAt: number, startLine: unknown) => ({
      filePath: 'lib/shared.ts',
      sessionId,
      agentId,
      claimedAt,
      symbolPath: null,
      symbol: null,
      startLine,
      endLine: 1,
    });

    const valid = harness({
      sourceClaim: ranged('session-source', 'source-display', 1_700_000_000_001, 1),
      peerClaim: ranged('session-peer', 'peer-display', 1_700_000_000_002, 1),
    });
    const validPreview = await valid.service.preview(input);
    if (validPreview.state !== 'ready') throw new Error('expected a one-based claim card');
    expect(validPreview.card.structuralEvidence.address).toEqual({
      filePath: 'lib/shared.ts', symbolPath: null, startLine: 1, endLine: 1,
    });
    expect(validPreview.card.surface).toMatch(/^session-begin:lib\/shared\.ts#L1-1 /);

    for (const invalidStart of [0, -1, 1.5]) {
      const invalid = harness({
        sourceClaim: ranged('session-source', 'source-display', 1_700_000_000_001, invalidStart),
        peerClaim: ranged('session-peer', 'peer-display', 1_700_000_000_002, invalidStart),
      });
      await expect(invalid.service.preview(input)).resolves.toEqual({
        state: 'unavailable',
        reason: 'The claim or live-session authority is unavailable.',
      });
    }

    const wholeFile = harness({
      sourceClaim: ranged('session-source', 'source-display', 1_700_000_000_001, null),
      peerClaim: ranged('session-peer', 'peer-display', 1_700_000_000_002, null),
    });
    const wholeFilePreview = await wholeFile.service.preview(input);
    if (wholeFilePreview.state !== 'ready') throw new Error('expected an intentionally whole-file claim card');
    expect(wholeFilePreview.card.surface).toMatch(/^session-begin:lib\/shared\.ts#L\*-1 /);
  });

  test('does not create a card for the same relative path in another repo or world scope', async () => {
    const { service } = harness({
      sourceClaim: {
        filePath: 'lib/shared.ts', sessionId: 'session-source', agentId: 'source-display',
        claimedAt: 1_700_000_000_001, symbolPath: 'createShared', startLine: 10, endLine: 30,
        repoId: 'repo-a', worldKind: 'worktree', worldId: 'main',
      },
      peerClaim: {
        filePath: 'lib/shared.ts', sessionId: 'session-peer', agentId: 'peer-display',
        claimedAt: 1_700_000_000_002, symbolPath: 'createShared', startLine: 10, endLine: 30,
        repoId: 'repo-b', worldKind: 'worktree', worldId: 'main',
      },
    });

    await expect(service.preview(input)).resolves.toEqual({
      state: 'none',
      reason: 'Semantic relevance exists, but no exact active claim overlap grounds a card.',
    });

    const { service: sameScopeService } = harness({
      sourceClaim: {
        filePath: 'lib/shared.ts', sessionId: 'session-source', agentId: 'source-display',
        claimedAt: 1_700_000_000_001, symbolPath: 'createShared', startLine: 10, endLine: 30,
        repoId: 'repo-a', worldKind: 'worktree', worldId: 'main',
      },
      peerClaim: {
        filePath: 'lib/shared.ts', sessionId: 'session-peer', agentId: 'peer-display',
        claimedAt: 1_700_000_000_002, symbolPath: 'createShared', startLine: 10, endLine: 30,
        repoId: 'repo-a', worldKind: 'worktree', worldId: 'main',
      },
    });
    await expect(sameScopeService.preview(input)).resolves.toMatchObject({ state: 'ready' });
  });

  test('gives otherwise identical scoped overlaps distinct card and automatic-admission identities', async () => {
    const source = {
      filePath: 'lib/shared.ts', sessionId: 'session-source', agentId: 'source-display',
      claimedAt: 1_700_000_000_001, symbolPath: 'createShared', startLine: 10, endLine: 30,
      repoId: 'repo-a', worldKind: 'worktree', worldId: 'feature-a',
    };
    const peer = {
      filePath: 'lib/shared.ts', sessionId: 'session-peer', agentId: 'peer-display',
      claimedAt: 1_700_000_000_002, symbolPath: 'createShared', startLine: 10, endLine: 30,
      repoId: 'repo-a', worldKind: 'worktree', worldId: 'feature-a',
    };
    const first = harness({ sourceClaim: source, peerClaim: peer });
    const second = harness({
      sourceClaim: { ...source, worldId: 'feature-b' },
      peerClaim: { ...peer, worldId: 'feature-b' },
    });

    const [firstPreview, secondPreview] = await Promise.all([
      first.service.preview(input),
      second.service.preview(input),
    ]);
    if (firstPreview.state !== 'ready' || secondPreview.state !== 'ready') {
      throw new Error('expected both independently scoped overlaps to produce cards');
    }

    expect(firstPreview.card.surface).toContain('[repo-a/worktree/feature-a]@');
    expect(secondPreview.card.surface).toContain('[repo-a/worktree/feature-b]@');
    expect(firstPreview.card.surface).not.toBe(secondPreview.card.surface);
    expect(firstPreview.card.signalId).not.toBe(secondPreview.card.signalId);
    expect(firstPreview.card.cardId).not.toBe(secondPreview.card.cardId);

    await first.service.resolveTogether({ ...input, signalId: firstPreview.card.signalId, harbor: 'port-daddy' });
    await second.service.resolveTogether({ ...input, signalId: secondPreview.card.signalId, harbor: 'port-daddy' });
    expect(first.evaluations[0]?.signal).toMatchObject({
      signalId: firstPreview.card.signalId,
      surface: firstPreview.card.surface,
    });
    expect(second.evaluations[0]?.signal).toMatchObject({
      signalId: secondPreview.card.signalId,
      surface: secondPreview.card.surface,
    });
  });

  test('rejects an otherwise known display alias when its session has no verified actor stamp', async () => {
    const { service } = harness({ sourceSessionMetadata: null });

    await expect(service.preview(input)).resolves.toEqual({
      state: 'unavailable',
      reason: 'The current actor is not authorized for that session.',
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
        {
          id: 'session-peer-b',
          agentId: 'peer-display',
          purpose: 'Coordinate the shared Sugar workflow',
          status: 'active',
          metadata: { identity: { verified: true, actorId: PEER_ACTOR } },
        },
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

  test('does not let a Whois display alias nominate a different stamped session', async () => {
    const legacyActor = 'legacy-peer-display-soul';
    const { service } = harness({
      // The Whois hit remains `peer-display`, but that session carries no
      // verified stamp. A separate live session happens to belong to the
      // display alias's legacy soul and holds the overlap; it must never be
      // promoted into a Parley party through a direct alias lookup.
      directPeerActorId: legacyActor,
      peerSessionMetadata: null,
      peerClaim: {
        filePath: 'lib/unrelated.ts', sessionId: 'session-peer', agentId: 'peer-display',
        claimedAt: 1_700_000_000_002, symbolPath: 'createOther', startLine: 10, endLine: 30,
      },
      additionalPeerSessions: [{
        id: 'session-other-peer',
        agentId: 'other-display',
        purpose: 'Coordinate the shared Sugar workflow',
        status: 'active',
        metadata: { identity: { verified: true, actorId: legacyActor } },
      }],
      additionalClaims: [{
        filePath: 'lib/shared.ts', sessionId: 'session-other-peer', agentId: 'other-display',
        claimedAt: 1_700_000_000_003, symbolPath: 'createShared', startLine: 10, endLine: 30,
      }],
    });

    await expect(service.preview(input)).resolves.toEqual({
      state: 'none',
      reason: 'No semantically reviewed live peer is relevant enough to coordinate.',
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
    expect(evaluations[0]).toMatchObject({
      harbor: 'port-daddy',
      signal: expect.objectContaining({
        signalId: preview.card.signalId,
        surface: preview.card.surface,
        parties: preview.card.participants.map((participant) => participant.actorId),
      }),
      resolvedPartySessions: expect.arrayContaining([
        { actorId: SOURCE_ACTOR, sessionId: 'session-source' },
        { actorId: PEER_ACTOR, sessionId: 'session-peer' },
      ]),
    });
    expect(receipt).toMatchObject({
      state: 'fired',
      cardId: preview.card.cardId,
      signalId: preview.card.signalId,
      parleyId: 'parley-auto:fixture',
      hookContext: {
        kind: 'sugar_parley_hook_context',
        parleyId: 'parley-auto:fixture',
        surface: expect.stringMatching(/^session-begin:lib\/shared\.ts#createShared \[local\/worktree\/unscoped\]@[0-9a-f]{16}$/),
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
