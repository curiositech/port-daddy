import { describe, expect, test } from '@jest/globals';
import { createSugarParley } from '../../../lib/sugar-parley.js';
import type { WhoisHit } from '../../../lib/whois.js';

const SOURCE_ACTOR = 'actor-purser-source';
const PEER_ACTOR = 'actor-purser-peer';
const SOURCE_SESSION = 'session-purser-source';
const PEER_SESSION = 'session-purser-peer';

interface ClaimCoordinates {
  symbolPath: string | null;
  startLine: number | null;
  endLine: number | null;
}

function session(id: string, agentId: string, actorId: string) {
  return {
    id,
    agentId,
    purpose: 'Coordinate the bounded Sugar surface',
    status: 'active',
    metadata: { identity: { verified: true, actorId } },
  };
}

function claim(
  sessionId: string,
  agentId: string,
  claimedAt: number,
  coordinates: ClaimCoordinates,
): Record<string, unknown> {
  return {
    filePath: 'lib/shared-surface.ts',
    sessionId,
    agentId,
    claimedAt,
    symbol: null,
    ...coordinates,
  };
}

function reviewedPeer(): WhoisHit {
  return {
    agentId: 'purser-peer-display',
    agentName: 'Purser peer',
    harbor: 'port-daddy',
    phrase: 'coordinate the bounded Sugar surface',
    score: 0.94,
    similarity: 0.95,
    bm25Score: 1,
    freshnessWeight: 1,
    lastHeartbeat: 1_700_000_000_000,
    stage: 'semantic',
    source: 'declared',
  };
}

function serviceFor(sourceCoordinates: ClaimCoordinates, peerCoordinates: ClaimCoordinates) {
  const source = session(SOURCE_SESSION, 'purser-source-display', SOURCE_ACTOR);
  const peer = session(PEER_SESSION, 'purser-peer-display', PEER_ACTOR);
  const sessions = [source, peer];

  return createSugarParley({
    sessions: {
      get(sessionId) {
        const found = sessions.find((candidate) => candidate.id === sessionId);
        return found ? { success: true, session: found } : { success: false };
      },
      list() {
        return { success: true, sessions };
      },
      listAllActiveClaims() {
        return {
          success: true,
          claims: [
            claim(SOURCE_SESSION, source.agentId, 1_700_000_000_001, sourceCoordinates),
            claim(PEER_SESSION, peer.agentId, 1_700_000_000_002, peerCoordinates),
          ],
        };
      },
    },
    actorSouls: {
      resolveActor(actorId) {
        if (actorId === SOURCE_ACTOR || actorId === PEER_ACTOR) {
          return { actorId, soulClass: 'minted' };
        }
        return { actorId, soulClass: 'unknown' };
      },
    },
    whois: {
      async search() {
        return [reviewedPeer()];
      },
    },
    parleyAutoTrigger: {
      evaluate() {
        throw new Error('A read-only Sugar preview must not convene a Parley');
      },
    },
  });
}

const previewInput = { sessionId: SOURCE_SESSION, actorId: SOURCE_ACTOR };

describe('Sugar Parley canonical structural boundary', () => {
  test.each([
    {
      name: 'whole-file claims',
      source: { symbolPath: null, startLine: null, endLine: null },
      peer: { symbolPath: null, startLine: null, endLine: null },
      expected: 'ready',
    },
    {
      name: 'the exact same symbol even when recorded ranges differ',
      source: { symbolPath: 'renderSugarCard', startLine: 10, endLine: 20 },
      peer: { symbolPath: 'renderSugarCard', startLine: 100, endLine: 110 },
      expected: 'ready',
    },
    {
      name: 'inclusive intersecting line ranges',
      source: { symbolPath: null, startLine: 10, endLine: 20 },
      peer: { symbolPath: null, startLine: 20, endLine: 30 },
      expected: 'ready',
    },
    {
      name: 'adjacent but disjoint line ranges',
      source: { symbolPath: null, startLine: 10, endLine: 19 },
      peer: { symbolPath: null, startLine: 20, endLine: 30 },
      expected: 'none',
    },
    {
      name: 'different exact symbols despite nearby ranges',
      source: { symbolPath: 'renderSugarCard', startLine: 10, endLine: 20 },
      peer: { symbolPath: 'settleSugarCard', startLine: 10, endLine: 20 },
      expected: 'none',
    },
  ] as const)('$name produces a $expected preview', async ({ source, peer, expected }) => {
    const result = await serviceFor(source, peer).preview(previewInput);

    expect(result.state).toBe(expected);
    if (expected === 'ready') {
      expect(result).toMatchObject({
        state: 'ready',
        card: {
          kind: 'sugar_parley_card',
          structuralEvidence: {
            address: {
              filePath: 'lib/shared-surface.ts',
              symbolPath: source.symbolPath,
              startLine: source.startLine,
              endLine: source.endLine,
            },
          },
        },
      });
    } else {
      expect(result).toEqual({
        state: 'none',
        reason: 'Semantic relevance exists, but no exact active claim overlap grounds a card.',
      });
    }
  });
});
