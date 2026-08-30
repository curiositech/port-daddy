import Fastify from 'fastify';
import { describe, expect, test } from '@jest/globals';
import { createAgentInbox } from '../../lib/agent-inbox.js';
import { createActivityLog } from '../../lib/activity.js';
import { createAgents } from '../../lib/agents.js';
import { createHarbors } from '../../lib/harbors.js';
import { createParley } from '../../lib/parley.js';
import { createSessions } from '../../lib/sessions.js';
import { createSugar } from '../../lib/sugar.js';
import { createWhois } from '../../lib/whois.js';
import { sugarPlugin } from '../../routes/sugar.js';
import { mintTestActor, createTestActorSouls } from '../helpers/actor-credentials.js';
import { createTestDb } from '../setup-unit.js';

const HARBOR = 'local';

function fixedSemanticResolver() {
  return {
    modelId: 'sugar-parley-route-fixed',
    async embed(): Promise<number[]> { return [1, 0, 0]; },
  };
}

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

function stampedSessionMetadata(actorId: string) {
  return { identity: { verified: true, actorId } };
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

/**
 * Use the actual ordinary Sugar begin, Harbor membership, and Whois wiring.
 * Nothing pre-populates the capability sidecar: the second begin must see the
 * first only because its normal admission awaited the canonical Harbor
 * projection, exactly as server.ts wires production.
 */
async function buildFreshBeginHarness() {
  const db = createTestDb();
  const agents = createAgents(db);
  const sessions = createSessions(db, undefined, { requireAgentForFileClaims: true });
  const activityLog = createActivityLog(db);
  sessions.setActivityLog(activityLog);
  const actorSouls = createTestActorSouls(db, { defaultHarbor: HARBOR });
  const inbox = createAgentInbox(db);
  const parley = createParley({
    db,
    tenantId: 'sugar-parley-fresh-begin-route-test',
    defaultHarbor: HARBOR,
    agentInbox: inbox,
  });
  // Creation order mirrors server.ts: the Harbor owns the membership table
  // that Whois reads for its projection/backfill authority.
  const harbors = createHarbors(db);
  const whois = createWhois(db, {
    resolver: fixedSemanticResolver(),
    logger: { info() {}, error() {} },
  });
  harbors.setCapabilityListener(async (agentId, harborName, phrases) => {
    await whois.registerCapabilities(agentId, harborName, phrases);
  });
  const sugar = createSugar({
    agents,
    sessions,
    activityLog,
    gitOriginChecker: {
      checkBranchOnOrigin: () => ({ ok: true, branch: 'fresh-begin', upstream: 'origin/fresh-begin', ahead: 0 }),
      checkLedgerOnly: () => ({ ok: true, dirtyEntries: 0, unpublishedCommits: 0 }),
    },
  });
  const app = Fastify();
  await app.register(sugarPlugin, {
    deps: {
      sugar,
      sessions,
      actorSouls,
      parley,
      whois,
      harbors,
      agentInbox: inbox,
      metrics: { errors: 0 },
      logger: { info() {}, warn() {}, error() {} },
    },
  });
  await app.ready();
  return { app, db, harbors, whois, inbox, parley };
}

describe('Sugar-first Parley route contract', () => {
  test('makes a fresh second ordinary begin immediately card-ready through Harbor-backed Whois', async () => {
    const harness = await buildFreshBeginHarness();
    const purpose = 'Coordinate the shared Sugar workflow';
    try {
      const begin = async (agentId: string) => harness.app.inject({
        method: 'POST',
        url: '/sugar/begin',
        payload: {
          purpose,
          agentId,
          files: ['lib/fresh-sugar-shared.ts'],
          force: true,
          lifecycle: 'durable',
          // The isolated in-memory route fixture has no Git worktree; this
          // exercises projection rather than the separately tested guard.
          allowMainWorktree: true,
        },
      });

      const firstResponse = await begin('fresh-sugar-source');
      expect(firstResponse.statusCode).toBe(200);
      const first = firstResponse.json() as { success: boolean; sessionId: string; actorId: string; credential: string };
      expect(first).toMatchObject({ success: true, credential: expect.any(String) });

      // No warmup/raw Whois registration occurs here. The second normal begin
      // must await its own Harbor listener and discover the first immediately.
      const secondResponse = await begin('fresh-sugar-peer');
      expect(secondResponse.statusCode).toBe(200);
      const second = secondResponse.json() as { success: boolean; sessionId: string; actorId: string; credential: string };
      expect(second).toMatchObject({ success: true, credential: expect.any(String) });

      expect(harness.harbors.get(HARBOR)?.members).toEqual(expect.arrayContaining([
        expect.objectContaining({ agentId: 'fresh-sugar-source', capabilities: [purpose] }),
        expect.objectContaining({ agentId: 'fresh-sugar-peer', capabilities: [purpose] }),
      ]));
      const reviewed = await harness.whois.search(purpose, { kind: 'agent', semanticReview: true });
      expect(reviewed).toEqual(expect.arrayContaining([
        expect.objectContaining({ agentId: 'fresh-sugar-source', stage: 'semantic', score: 1, similarity: 1 }),
        expect.objectContaining({ agentId: 'fresh-sugar-peer', stage: 'semantic', score: 1, similarity: 1 }),
      ]));

      const cardResponse = await harness.app.inject({
        method: 'GET',
        url: `/sugar/parley-card?sessionId=${first.sessionId}`,
        headers: { 'x-actor-credential': first.credential },
      });
      expect(cardResponse.statusCode).toBe(200);
      const cardBody = cardResponse.json() as {
        card: { signalId: string };
      };
      expect(cardBody).toMatchObject({
        success: true,
        state: 'ready',
        card: {
          participants: expect.arrayContaining([
            expect.objectContaining({ actorId: first.actorId, sessionId: first.sessionId }),
            expect.objectContaining({ actorId: second.actorId, sessionId: second.sessionId }),
          ]),
          semanticEvidence: expect.objectContaining({ stage: 'semantic', score: 1, similarity: 1 }),
        },
      });

      // This uses routes/sugar.ts's real createParleyAutoTrigger, not the
      // interaction fixture in the unit suite. A fired trigger must produce
      // both the durable Parley and its participant-visible summonses.
      const convene = await harness.app.inject({
        method: 'POST',
        url: '/sugar/parley/resolve-together',
        headers: { 'x-actor-credential': first.credential },
        payload: { sessionId: first.sessionId, signalId: cardBody.card.signalId },
      });
      expect(convene.statusCode).toBe(200);
      const parleyId = convene.json().parleyId as string;
      expect(harness.parley.get(parleyId, HARBOR)).toMatchObject({
        status: 'SUMMONED',
        parley: expect.objectContaining({
          automatic: expect.objectContaining({ origin: 'sugar-parley', signalId: cardBody.card.signalId }),
        }),
      });
      for (const agentId of ['fresh-sugar-source', 'fresh-sugar-peer']) {
        expect(harness.inbox.list(agentId).messages).toEqual(expect.arrayContaining([
          expect.objectContaining({
            type: 'parley_summons',
            content: expect.objectContaining({
              sugarHookContext: expect.objectContaining({ kind: 'sugar_parley_hook_context' }),
            }),
          }),
        ]));
      }
    } finally {
      await harness.app.close();
      harness.db.close();
    }
  });

  test('derives, convenes, converses, and settles without exposing raw protocol UX', async () => {
    const harness = await buildHarness();
    try {
      const source = mintTestActor(harness.actorSouls, 'sugar-source');
      const peer = mintTestActor(harness.actorSouls, 'sugar-peer');
      const sourceSession = harness.sessions.start('Coordinate shared Sugar workflow', {
        agentId: 'sugar-source',
        files: ['lib/shared-sugar.ts'],
        metadata: stampedSessionMetadata(source.actorId),
      }) as { success: boolean; id: string };
      const peerSession = harness.sessions.start('Coordinate shared Sugar workflow', {
        agentId: 'sugar-peer',
        metadata: stampedSessionMetadata(peer.actorId),
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
      // Both participants receive the visually distinct, typed hook. The
      // caller's successful action receipt is not a substitute for their own
      // inbox context: the two-pane Porthole proof and normal attention path
      // must see the same bounded convening fact.
      for (const agentId of ['sugar-source', 'sugar-peer']) {
        expect(harness.inbox.list(agentId).messages).toEqual(expect.arrayContaining([
          expect.objectContaining({
            type: 'parley_summons',
            content: expect.objectContaining({
              sugarHookContext: expect.objectContaining({
                kind: 'sugar_parley_hook_context',
                cardId: cardBody.card.cardId,
                message: expect.stringContaining('⚑ PARLEY BEGUN ⚑'),
              }),
            }),
          }),
        ]));
      }
      const sourceSummons = harness.inbox.list('sugar-source').messages.find((message) => (
        message.type === 'parley_summons'
      ));
      expect((sourceSummons?.content as { sugarHookContext?: unknown }).sugarHookContext)
        .toEqual(conveneBody.hookContext);

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
      expect(harness.inbox.list('sugar-peer').messages).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'sugar_parley_message',
          content: expect.objectContaining({
            kind: 'sugar_parley_message',
            schemaVersion: 1,
            origin: 'sugar-parley',
            parleyId,
            message: 'I can release the shared overlap once we split the follow-up work.',
          }),
        }),
      ]));

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
        kind: 'sugar_parley_settlement_acknowledgement',
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
      const automaticEvidence = harness.parley.get(parleyId, HARBOR)?.parley.automatic?.evidenceRefs;
      for (const agentId of ['sugar-source', 'sugar-peer']) {
        expect(harness.inbox.list(agentId).messages).toEqual(expect.arrayContaining([
          expect.objectContaining({
            type: 'sugar_parley_settlement_receipt',
            content: expect.objectContaining({
              kind: 'sugar_parley_settlement_receipt',
              state: 'settled',
              origin: 'sugar-parley',
              evidenceRefs: automaticEvidence,
            }),
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

  test('returns unavailable when a credentialed session lacks its daemon-minted actor stamp', async () => {
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
        metadata: stampedSessionMetadata(peer.actorId),
      }) as { success: boolean; id: string };
      expect(harness.sessions.claimFiles(peerSession.id, ['lib/shared-sugar.ts'], {
        force: true,
        agentId: 'sugar-peer',
      }).success).toBe(true);

      const response = await harness.app.inject({
        method: 'GET',
        url: `/sugar/parley-card?sessionId=${sourceSession.id}`,
        headers: source.headers,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(expect.objectContaining({
        success: true,
        state: 'unavailable',
        reason: 'The current actor is not authorized for that session.',
      }));
      expect(harness.semanticQueries).toEqual([]);
    } finally {
      await harness.app.close();
      harness.db.close();
    }
  });

  test('keeps sealed message and settlement inputs bounded before membership evaluation', async () => {
    const harness = await buildHarness();
    try {
      const source = mintTestActor(harness.actorSouls, 'sugar-source');
      const message = await harness.app.inject({
        method: 'POST',
        url: '/sugar/parley/message',
        headers: source.headers,
        payload: {},
      });
      expect(message.statusCode).toBe(400);
      expect(message.json()).toMatchObject({ success: false, code: 'VALIDATION_ERROR' });

      const settlement = await harness.app.inject({
        method: 'POST',
        url: '/sugar/parley/settle',
        headers: source.headers,
        payload: {
          sessionId: 'session-x',
          parleyId: 'parley-x',
          summary: 's'.repeat(2_001),
          nextStep: 'forward work',
        },
      });
      expect(settlement.statusCode).toBe(400);
      expect(settlement.json()).toMatchObject({ success: false, code: 'VALIDATION_ERROR' });
    } finally {
      await harness.app.close();
      harness.db.close();
    }
  });

  test('rejects a natural-language message from a Parley party whose session ended after convening', async () => {
    const harness = await buildHarness();
    try {
      const source = mintTestActor(harness.actorSouls, 'sugar-source');
      const peer = mintTestActor(harness.actorSouls, 'sugar-peer');
      const sourceSession = harness.sessions.start('Coordinate shared Sugar workflow', {
        agentId: 'sugar-source',
        files: ['lib/shared-sugar.ts'],
        metadata: stampedSessionMetadata(source.actorId),
      }) as { success: boolean; id: string };
      const peerSession = harness.sessions.start('Coordinate shared Sugar workflow', {
        agentId: 'sugar-peer',
        metadata: stampedSessionMetadata(peer.actorId),
      }) as { success: boolean; id: string };
      expect(harness.sessions.claimFiles(peerSession.id, ['lib/shared-sugar.ts'], {
        force: true,
        agentId: 'sugar-peer',
      }).success).toBe(true);
      const card = (await harness.app.inject({
        method: 'GET',
        url: `/sugar/parley-card?sessionId=${sourceSession.id}`,
        headers: source.headers,
      })).json().card as { signalId: string };
      const convene = await harness.app.inject({
        method: 'POST',
        url: '/sugar/parley/resolve-together',
        headers: source.headers,
        payload: { sessionId: sourceSession.id, signalId: card.signalId },
      });
      expect(convene.statusCode).toBe(200);
      const parleyId = convene.json().parleyId as string;
      expect(harness.sessions.end(sourceSession.id).success).toBe(true);

      const response = await harness.app.inject({
        method: 'POST',
        url: '/sugar/parley/message',
        headers: source.headers,
        payload: { sessionId: sourceSession.id, parleyId, message: 'This must not reach the peer.' },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ success: false, code: 'SUGAR_PARLEY_MEMBERSHIP_REQUIRED' });
      expect(harness.inbox.list('sugar-peer').messages.some((item) => (
        (item.content as { kind?: unknown }).kind === 'sugar_parley_message'
      ))).toBe(false);
      void peer;
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
