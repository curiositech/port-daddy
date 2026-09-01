import { afterEach, describe, expect, jest, test } from '@jest/globals';
import Fastify from 'fastify';
import type { DurableOwnershipService } from '../../lib/durable-ownership.js';
import { durableOwnershipPlugin } from '../../routes/durable-ownership.js';

const HARBOR = 'port-daddy';
const OWNER = 'actor-owner';
const SUCCESSOR = 'actor-successor';

function signedGrant() {
  return {
    schema: 'pd.agent-harbor.durable-takeover-grant.v0',
    grantId: 'grant-1',
    roadmapSlug: 'durable-task',
    harbor: HARBOR,
    predecessorEpochId: 'epoch-1',
    predecessorAgentNodeId: 'agent_node_old',
    successorAgentNodeId: 'agent_node_new',
    issuerAgentNodeId: 'agent_node_old',
    authorizedActorId: OWNER,
    successorActorId: SUCCESSOR,
    authorityKind: 'current-owner',
    operatorPresenceReceipt: null,
    sourceSessionId: 'session-old',
    successorSessionId: 'session-new',
    claimBindings: [{ claimNodeId: 'claim-1', disposition: 'transfer' }],
    briefing: { briefingId: 'brief-1', hiddenReasoningAvailable: false },
    issuedAt: 100,
    expiresAt: 200,
    contentHash: `sha256:${'a'.repeat(64)}`,
    signature: { algorithm: 'ed25519', keyId: 'daemon-key', value: 'signed' },
  };
}

async function buildApp() {
  const grant = signedGrant();
  const durableOwnership = {
    prepareTakeover: jest.fn(async () => ({
      grant,
      nonce: 'one-shot-nonce',
      receipt: { receiptId: 'receipt-issued', kind: 'issued' },
    })),
    bootstrapCanonical: jest.fn(),
    getProjection: jest.fn(() => ({
      roadmapItemId: 'roadmap-1',
      roadmapSlug: 'durable-task',
      currentOwner: 'agent_node_old',
      currentState: 'current',
      currentEpoch: null,
      priorOwners: [],
      activeGrantId: null,
    })),
    getGrant: jest.fn((grantId: string) => grantId === grant.grantId ? {
      grant,
      state: 'active',
      consumedAt: null,
      consumedEpochId: null,
      receipts: [],
    } : null),
  } as unknown as DurableOwnershipService;
  const actorSouls = {
    constants: { defaultHarbor: HARBOR },
    verifyCredential: (credential: string, harbor?: string) => {
      if (harbor !== HARBOR) return null;
      if (credential === 'credential-owner') return OWNER;
      if (credential === 'credential-successor') return SUCCESSOR;
      if (credential === 'credential-stranger') return 'actor-stranger';
      return null;
    },
    resolveActor: (handle: string) => ({
      actorId: handle,
      soulClass: handle.startsWith('actor-') ? 'graduated' as const : 'unknown' as const,
    }),
  };
  const app = Fastify();
  await app.register(durableOwnershipPlugin, {
    deps: { durableOwnership, actorSouls },
  });
  await app.ready();
  return { app, durableOwnership };
}

const openApps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

afterEach(async () => {
  while (openApps.length) await openApps.pop()?.app.close();
});

describe('durable ownership HTTP authority boundary', () => {
  test('requires a verified actor before issuing a takeover grant', async () => {
    const state = await buildApp();
    openApps.push(state);
    const response = await state.app.inject({
      method: 'POST',
      url: '/roadmap/items/durable-task/takeovers',
      payload: {
        harbor: HARBOR,
        successorSessionId: 'session-new',
        reason: 'Continue the exact unfinished work.',
        claimDispositions: [{ claimNodeId: 'claim-1', disposition: 'transfer' }],
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('IDENTITY_CREDENTIAL_REQUIRED');
    expect(state.durableOwnership.prepareTakeover).not.toHaveBeenCalled();
  });

  test('rejects caller-carried ownership facts before the coordinator runs', async () => {
    const state = await buildApp();
    openApps.push(state);
    const response = await state.app.inject({
      method: 'POST',
      url: '/roadmap/items/durable-task/takeovers',
      headers: { 'x-actor-credential': 'credential-owner' },
      payload: {
        harbor: HARBOR,
        successorSessionId: 'session-new',
        successorAgentNodeId: 'agent_node_attacker_selected',
        reason: 'Attempt to choose the durable owner in transport.',
        claimDispositions: [{ claimNodeId: 'claim-1', disposition: 'transfer' }],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ success: false, code: 'UNKNOWN_FIELD' });
    expect(state.durableOwnership.prepareTakeover).not.toHaveBeenCalled();
  });

  test('passes only intent fields and the credential-bound actor to the kernel', async () => {
    const state = await buildApp();
    openApps.push(state);
    const response = await state.app.inject({
      method: 'POST',
      url: '/roadmap/items/durable-task/takeovers',
      headers: { 'x-actor-credential': 'credential-owner' },
      payload: {
        harbor: HARBOR,
        successorSessionId: 'session-new',
        reason: 'Continue the exact unfinished work.',
        claimDispositions: [{ claimNodeId: 'claim-1', disposition: 'transfer' }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      grant: { grantId: 'grant-1', successorAgentNodeId: 'agent_node_new' },
      nonce: 'one-shot-nonce',
    });
    expect(state.durableOwnership.prepareTakeover).toHaveBeenCalledWith({
      roadmapSlug: 'durable-task',
      harbor: HARBOR,
      successorSessionId: 'session-new',
      reason: 'Continue the exact unfinished work.',
      claimDispositions: [{ claimNodeId: 'claim-1', disposition: 'transfer' }],
      ttlMs: undefined,
      operatorPresenceProof: undefined,
    }, { actorId: OWNER, soulClass: 'graduated' });
  });

  test('reveals grant lifecycle only to a signed grant party in its harbor', async () => {
    const state = await buildApp();
    openApps.push(state);
    const stranger = await state.app.inject({
      method: 'GET',
      url: '/takeover-grants/grant-1?harbor=port-daddy',
      headers: { 'x-actor-credential': 'credential-stranger' },
    });
    expect(stranger.statusCode).toBe(403);
    expect(stranger.json().code).toBe('AUTHORITY_REQUIRED');

    const successor = await state.app.inject({
      method: 'GET',
      url: '/takeover-grants/grant-1?harbor=port-daddy',
      headers: { 'x-actor-credential': 'credential-successor' },
    });
    expect(successor.statusCode).toBe(200);
    expect(successor.json()).toMatchObject({
      success: true,
      grant: { grantId: 'grant-1', state: 'active' },
    });
  });
});
