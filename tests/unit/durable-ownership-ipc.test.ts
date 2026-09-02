import { describe, expect, jest, test } from '@jest/globals';
import { createIpcRouter, type IpcRouterDeps } from '../../lib/ipc-router.js';
import { IpcAction, Performative, type IpcFrame } from '../../lib/ipc-types.js';
import type { IpcConnection } from '../../lib/ipc-server.js';

const OWNER_AGENT = 'registered-owner';
const OWNER_ACTOR = 'actor-owner';
const HARBOR = 'port-daddy';

function connection(agentId = OWNER_AGENT): IpcConnection {
  return {
    id: 'ipc-ownership-test',
    agentId,
    state: 'ready',
    subscriptions: [],
    framesDropped: 0,
    framesOut: 0,
    bytesOut: 0,
    socket: { write: jest.fn(() => true) },
  } as unknown as IpcConnection;
}

function dependencies() {
  const grant = {
    grantId: 'grant-1',
    roadmapSlug: 'durable-task',
    harbor: HARBOR,
    predecessorEpochId: 'epoch-1',
    predecessorAgentNodeId: 'agent_node_old',
    successorAgentNodeId: 'agent_node_new',
    authorizedActorId: OWNER_ACTOR,
    successorActorId: 'actor-successor',
    authorityKind: 'current-owner',
    operatorPresenceReceipt: null,
    sourceSessionId: 'session-old',
    successorSessionId: 'session-new',
    claimBindings: [],
    briefing: { hiddenReasoningAvailable: false },
    issuedAt: 1,
    expiresAt: 2,
    contentHash: `sha256:${'a'.repeat(64)}`,
    signature: { algorithm: 'ed25519', keyId: 'daemon-key', value: 'signed' },
  };
  const durableOwnership = {
    prepareTakeover: jest.fn(async () => ({
      grant,
      nonce: 'one-shot-nonce',
      receipt: { receiptId: 'issued-receipt' },
    })),
    getGrant: jest.fn((grantId: string) => grantId === grant.grantId ? {
      grant,
      state: 'active',
      consumedAt: null,
      consumedEpochId: null,
      receipts: [],
    } : null),
    acceptTakeover: jest.fn(),
    bootstrapCanonical: jest.fn(),
  };
  const inert = jest.fn(() => ({ success: true }));
  const deps = {
    services: { claim: inert, release: inert, find: inert },
    agents: {
      register: inert,
      heartbeat: inert,
      unregister: inert,
      isRegistered: (id: string) => id === OWNER_AGENT ? { id } : null,
    },
    sessions: {
      start: inert,
      end: inert,
      remove: inert,
      list: inert,
      quickNote: inert,
      claimFiles: inert,
      releaseFiles: inert,
    },
    locks: { acquire: inert, check: inert, extend: inert, list: inert, release: inert },
    messaging: { publish: inert, subscribe: () => null },
    pheromones: { spray: inert, sniff: inert, list: inert },
    actorSouls: {
      constants: { defaultHarbor: HARBOR },
      verifyCredential: (credential: string, harbor?: string) =>
        credential === 'credential-owner' && harbor === HARBOR ? OWNER_ACTOR : null,
      resolveActor: (handle: string, harbor?: string) => ({
        actorId: harbor === HARBOR && (handle === OWNER_AGENT || handle === OWNER_ACTOR)
          ? OWNER_ACTOR
          : handle,
        soulClass: harbor === HARBOR && (handle === OWNER_AGENT || handle === OWNER_ACTOR)
          ? 'graduated' as const
          : 'unknown' as const,
      }),
    },
    durableOwnership,
  } as unknown as IpcRouterDeps;
  return { deps, durableOwnership };
}

function request(
  router: ReturnType<typeof createIpcRouter>,
  payload: Record<string, unknown>,
): Promise<IpcFrame> {
  return new Promise(resolve => {
    router.handleFrame({
      type: Performative.REQUEST,
      convId: 41,
      payload,
    }, connection(), resolve);
  });
}

describe('durable ownership IPC authority parity', () => {
  test('registered transport identity is insufficient without an actor credential', async () => {
    const { deps, durableOwnership } = dependencies();
    const reply = await request(createIpcRouter(deps), {
      action: IpcAction.OWNERSHIP_TAKEOVER_PREPARE,
      agentId: OWNER_AGENT,
      roadmapSlug: 'durable-task',
      harbor: HARBOR,
      successorSessionId: 'session-new',
      reason: 'Continue exact unfinished work.',
      claimDispositions: [],
    });

    expect(reply.type).toBe(Performative.REFUSE);
    expect(reply.payload).toMatchObject({ code: 'IDENTITY_CREDENTIAL_REQUIRED' });
    expect(durableOwnership.prepareTakeover).not.toHaveBeenCalled();
  });

  test('rejects authority-shaped surplus fields before calling the coordinator', async () => {
    const { deps, durableOwnership } = dependencies();
    const reply = await request(createIpcRouter(deps), {
      action: IpcAction.OWNERSHIP_TAKEOVER_PREPARE,
      agentId: OWNER_AGENT,
      credential: 'credential-owner',
      roadmapSlug: 'durable-task',
      harbor: HARBOR,
      successorSessionId: 'session-new',
      successorAgentNodeId: 'agent_node_attacker_selected',
      reason: 'Attempt to select the owner in IPC.',
      claimDispositions: [],
    });

    expect(reply.type).toBe(Performative.REFUSE);
    expect(reply.payload).toMatchObject({ code: 'UNKNOWN_FIELD' });
    expect(durableOwnership.prepareTakeover).not.toHaveBeenCalled();
  });

  test('forwards bounded intent with the credential-bound actor and returns the signed receipt', async () => {
    const { deps, durableOwnership } = dependencies();
    const reply = await request(createIpcRouter(deps), {
      action: IpcAction.OWNERSHIP_TAKEOVER_PREPARE,
      agentId: OWNER_AGENT,
      credential: 'credential-owner',
      roadmapSlug: 'durable-task',
      harbor: HARBOR,
      successorSessionId: 'session-new',
      reason: 'Continue exact unfinished work.',
      claimDispositions: [{ claimNodeId: 'claim-1', disposition: 'transfer' }],
    });

    expect(reply.type).toBe(Performative.INFORM_DONE);
    expect(reply.payload.result).toMatchObject({
      success: true,
      grant: { grantId: 'grant-1', successorAgentNodeId: 'agent_node_new' },
      nonce: 'one-shot-nonce',
    });
    expect(durableOwnership.prepareTakeover).toHaveBeenCalledWith({
      roadmapSlug: 'durable-task',
      harbor: HARBOR,
      successorSessionId: 'session-new',
      reason: 'Continue exact unfinished work.',
      claimDispositions: [{ claimNodeId: 'claim-1', disposition: 'transfer' }],
      ttlMs: undefined,
      operatorPresenceProof: undefined,
    }, { actorId: OWNER_ACTOR, soulClass: 'graduated' });
  });

  test('legacy session takeover fields cannot bypass the grant and nonce contract', async () => {
    const { deps, durableOwnership } = dependencies();
    const reply = await request(createIpcRouter(deps), {
      action: IpcAction.SESSION_TAKEOVER,
      agentId: OWNER_AGENT,
      credential: 'credential-owner',
      sessionId: 'session-old',
      purpose: 'Ambient recovery attempt',
    });

    expect(reply.type).toBe(Performative.REFUSE);
    expect(reply.payload).toMatchObject({ code: 'RECOVERY_GRANT_REQUIRED' });
    expect(durableOwnership.acceptTakeover).not.toHaveBeenCalled();
  });
});
