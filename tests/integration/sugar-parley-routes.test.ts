import Fastify from 'fastify';
import { describe, expect, test } from '@jest/globals';
import { createAgentInbox } from '../../lib/agent-inbox.js';
import { createParley } from '../../lib/parley.js';
import { createSessions } from '../../lib/sessions.js';
import { sugarPlugin } from '../../routes/sugar.js';
import { mintTestActor, createTestActorSouls } from '../helpers/actor-credentials.js';
import { createTestDb } from '../setup-unit.js';

const HARBOR = 'local';

function semanticPeer(agentId: string) {
  return {
    agentId,
    agentName: 'Peer agent',
    harbor: HARBOR,
    phrase: 'coordinate the shared Sugar workflow',
    score: 0.94,
    similarity: 0.96,
    bm25Score: 1,
    freshnessWeight: 1,
    lastHeartbeat: 1_700_000_000_000,
    stage: 'semantic' as const,
    source: 'declared' as const,
  };
}

async function buildHarness(options: { peerAgentId?: string } = {}) {
  const db = createTestDb();
  const sessions = createSessions(db, undefined, { requireAgentForFileClaims: true });
  const actorSouls = createTestActorSouls(db, { defaultHarbor: HARBOR });
  const inbox = createAgentInbox(db);
  const parley = createParley({
    db,
    tenantId: 'sugar-parley-route-test',
    defaultHarbor: HARBOR,
    agentInbox: inbox,
  });
  const app = Fastify();
  const semanticQueries: string[] = [];
  await app.register(sugarPlugin, {
    deps: {
      sugar: {
        begin: () => ({ success: true }),
        done: () => ({ success: true }),
        whoami: () => ({ success: true }),
        relink: () => ({ success: true }),
      },
      sessions,
      actorSouls,
      parley,
      whois: { search: async (query: string) => {
        semanticQueries.push(query);
        return [semanticPeer(options.peerAgentId ?? 'sugar-peer')];
      } },
      agentInbox: inbox,
      metrics: { errors: 0 },
      logger: { info() {}, warn() {}, error() {} },
    },
  });
  await app.ready();
  return { app, db, sessions, actorSouls, inbox, parley, semanticQueries };
}

describe('Sugar-first Parley route contract', () => {
  test('derives, convenes, converses, and settles without exposing raw protocol UX', async () => {
    const harness = await buildHarness();
    try {
      const source = mintTestActor(harness.actorSouls, 'sugar-source');
      const peer = mintTestActor(harness.actorSouls, 'sugar-peer');
      const sourceSession = harness.sessions.start('Coordinate shared Sugar workflow', {
        agentId: 'sugar-source',
        files: ['lib/shared-sugar.ts'],
      }) as { success: boolean; id: string };
      const peerSession = harness.sessions.start('Coordinate shared Sugar workflow', {
        agentId: 'sugar-peer',
      }) as { success: boolean; id: string };
      expect(sourceSession.success).toBe(true);
      expect(peerSession.success).toBe(true);
      const peerClaim = harness.sessions.claimFiles(peerSession.id, ['lib/shared-sugar.ts'], {
        force: true,
        agentId: 'sugar-peer',
      });
      expect(peerClaim.success).toBe(true);

      const cardResponse = await harness.app.inject({
        method: 'GET',
        url: `/sugar/parley-card?${new URLSearchParams({
          agentId: 'forged-display-handle',
          sessionId: sourceSession.id,
          purpose: 'Deliberately wrong client semantic query',
        }).toString()}`,
        headers: source.headers,
      });
      expect(harness.semanticQueries).toEqual(['Coordinate shared Sugar workflow']);
      expect(cardResponse.statusCode).toBe(200);
      const cardBody = cardResponse.json();
      expect(cardBody).toMatchObject({
        success: true,
        state: 'ready',
        card: {
          kind: 'sugar_parley_card',
          participants: expect.arrayContaining([
            expect.objectContaining({ actorId: source.actorId, sessionId: sourceSession.id }),
            expect.objectContaining({ actorId: peer.actorId, sessionId: peerSession.id }),
          ]),
          actions: expect.arrayContaining([
            expect.objectContaining({ id: 'work-separately', label: 'Work separately' }),
            expect.objectContaining({ id: 'send-note', label: 'Send note' }),
            expect.objectContaining({ id: 'resolve-together', label: 'Resolve together', enabled: true }),
          ]),
        },
      });
      const card = cardBody.card as { signalId: string; surface: string };

      const convene = await harness.app.inject({
        method: 'POST',
        url: '/sugar/parley/resolve-together',
        headers: source.headers,
        payload: {
          agentId: 'forged-display-handle',
          sessionId: sourceSession.id,
          purpose: 'Deliberately wrong client semantic query',
          signalId: card.signalId,
        },
      });
      expect(convene.statusCode).toBe(200);
      const conveneBody = convene.json();
      expect(conveneBody).toMatchObject({
        success: true,
        kind: 'sugar_parley_convening_receipt',
        state: 'fired',
        hookContext: {
          kind: 'sugar_parley_hook_context',
          surface: card.surface,
        },
      });
      const parleyId = conveneBody.parleyId as string;
      const peerSummons = harness.inbox.list('sugar-peer').messages;
      expect(peerSummons.some((message) => (
        (message.content as { sugarHookContext?: { kind?: string } }).sugarHookContext?.kind
          === 'sugar_parley_hook_context'
      ))).toBe(true);
      expect(peerSummons).toEqual(expect.arrayContaining([
        expect.objectContaining({
          content: expect.objectContaining({
            sugarHookContext: expect.objectContaining({ cardId: cardBody.card.cardId }),
          }),
        }),
      ]));

      const message = await harness.app.inject({
        method: 'POST',
        url: '/sugar/parley/message',
        headers: source.headers,
        payload: {
          agentId: 'sugar-source',
          sessionId: sourceSession.id,
          parleyId,
          message: 'I can release the shared overlap once we split the follow-up work.',
        },
      });
      expect(message.statusCode).toBe(200);
      expect(message.json()).toMatchObject({ success: true, kind: 'sugar_parley_message_receipt', parleyId });

      const settlement = {
        parleyId,
        summary: 'Split the follow-up work after releasing the shared overlap.',
        nextStep: 'Claim separate implementation regions before editing.',
      };
      const first = await harness.app.inject({
        method: 'POST',
        url: '/sugar/parley/settle',
        headers: source.headers,
        payload: { agentId: 'sugar-source', sessionId: sourceSession.id, ...settlement },
      });
      expect(first.statusCode).toBe(202);
      expect(first.json()).toMatchObject({
        success: true,
        kind: 'sugar_parley_settlement_receipt',
        state: 'awaiting-peer',
        remindersSuppressed: false,
      });

      const second = await harness.app.inject({
        method: 'POST',
        url: '/sugar/parley/settle',
        headers: peer.headers,
        payload: { agentId: 'sugar-peer', sessionId: peerSession.id, ...settlement },
      });
      expect(second.statusCode).toBe(200);
      expect(second.json()).toMatchObject({
        success: true,
        kind: 'sugar_parley_settlement_receipt',
        state: 'settled',
        remindersSuppressed: true,
        claimUpdates: expect.arrayContaining([
          expect.objectContaining({ sessionId: sourceSession.id, released: true }),
          expect.objectContaining({ sessionId: peerSession.id, released: true }),
        ]),
        planUpdates: expect.arrayContaining([
          expect.objectContaining({ sessionId: sourceSession.id, updated: true }),
          expect.objectContaining({ sessionId: peerSession.id, updated: true }),
        ]),
      });
      expect(harness.sessions.listAllActiveClaims().claims).toEqual([]);
      expect(harness.parley.get(parleyId, HARBOR)).toMatchObject({
        status: 'COLLAPSED',
        outcome: { resolvedBy: 'port-daddy:sugar-parley-consensus' },
      });
      for (const agentId of ['sugar-source', 'sugar-peer']) {
        expect(harness.inbox.list(agentId).messages).toEqual(expect.arrayContaining([
          expect.objectContaining({
            type: 'parley_turn',
            content: expect.objectContaining({ kind: 'sugar_parley_settlement_receipt' }),
          }),
        ]));
      }
      expect(harness.sessions.getNotes(sourceSession.id, { type: 'todo_list', limit: 1 }).notes)
        .toEqual(expect.arrayContaining([expect.objectContaining({ content: expect.stringContaining('Sugar Parley settlement') })]));
    } finally {
      await harness.app.close();
      harness.db.close();
    }
  });

  test('fails closed without a minted credential instead of treating the card as client authority', async () => {
    const harness = await buildHarness();
    try {
      const response = await harness.app.inject({
        method: 'GET',
        url: '/sugar/parley-card?sessionId=session-forged',
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ success: false, code: 'IDENTITY_CREDENTIAL_REQUIRED' });
    } finally {
      await harness.app.close();
      harness.db.close();
    }
  });

  test('derives generated Sugar handles from their verified session stamps before admitting a Parley', async () => {
    const harness = await buildHarness({ peerAgentId: 'generated-peer-handle' });
    try {
      // This display handle is independently bound elsewhere. A normal Sugar
      // begin must still prove authority with its own credential + session
      // stamp rather than treating the display handle as a soul alias.
      mintTestActor(harness.actorSouls, 'generated-source-handle');
      mintTestActor(harness.actorSouls, 'generated-peer-handle');
      const source = mintTestActor(harness.actorSouls, 'source-proof-alias');
      const peer = mintTestActor(harness.actorSouls, 'peer-proof-alias');
      const sourceSession = harness.sessions.start('Design the shared collaboration interface', {
        agentId: 'generated-source-handle',
        files: ['lib/sugar-parley.ts'],
        metadata: { identity: { verified: true, actorId: source.actorId } },
      }) as { success: boolean; id: string };
      const peerSession = harness.sessions.start('Align the bounded coordination surface', {
        agentId: 'generated-peer-handle',
        metadata: { identity: { verified: true, actorId: peer.actorId } },
      }) as { success: boolean; id: string };
      expect(sourceSession.success).toBe(true);
      expect(peerSession.success).toBe(true);
      expect(harness.sessions.claimFiles(peerSession.id, ['lib/sugar-parley.ts'], {
        force: true,
        agentId: 'generated-peer-handle',
      }).success).toBe(true);

      const cardResponse = await harness.app.inject({
        method: 'GET',
        url: `/sugar/parley-card?${new URLSearchParams({
          agentId: 'forged-display-handle',
          sessionId: sourceSession.id,
          purpose: 'Deliberately wrong client semantic query',
        }).toString()}`,
        headers: source.headers,
      });
      expect(cardResponse.statusCode).toBe(200);
      const card = cardResponse.json().card as { signalId: string };
      expect(cardResponse.json()).toMatchObject({
        success: true,
        state: 'ready',
        card: {
          participants: expect.arrayContaining([
            expect.objectContaining({ actorId: source.actorId, sessionId: sourceSession.id }),
            expect.objectContaining({ actorId: peer.actorId, sessionId: peerSession.id }),
          ]),
        },
      });

      const convene = await harness.app.inject({
        method: 'POST',
        url: '/sugar/parley/resolve-together',
        headers: source.headers,
        payload: {
          agentId: 'forged-display-handle',
          sessionId: sourceSession.id,
          purpose: 'Deliberately wrong client semantic query',
          signalId: card.signalId,
        },
      });
      expect(convene.statusCode).toBe(200);
      expect(convene.json()).toMatchObject({ success: true, state: 'fired' });
      const parleyId = convene.json().parleyId as string;

      const message = await harness.app.inject({
        method: 'POST',
        url: '/sugar/parley/message',
        headers: source.headers,
        payload: {
          agentId: 'generated-source-handle',
          sessionId: sourceSession.id,
          parleyId,
          message: 'I can split the next step once the shared surface is settled.',
        },
      });
      expect(message.statusCode).toBe(200);
      expect(message.json()).toMatchObject({ success: true, kind: 'sugar_parley_message_receipt', parleyId });
    } finally {
      await harness.app.close();
      harness.db.close();
    }
  });
});
