import { describe, expect, it } from 'vitest';
import {
  handleCoordinationGrant,
  handleCoordinationSync,
  parseCoordinationProject,
} from '../src/coordination.js';
import type { Env } from '../src/types.js';

const OPERATOR = 'operator-token-0123456789abcdef-0123456789abcdef';
const ROOT = '42'.repeat(32);
const PROJECT = 'curiositech/port-daddy';
const ACTOR = 'fleet-sandbox';

function operation(project = PROJECT) {
  return {
    version: 1,
    opId: `${ACTOR}:session:cloud-session:10:0`,
    project,
    actorId: ACTOR,
    replicaId: ACTOR,
    kind: 'session',
    entityId: 'cloud-session',
    mutation: 'upsert',
    clock: { wallTime: 10, counter: 0, replicaId: ACTOR },
    value: {
      purpose: 'Cloud sandbox coordination peer',
      status: 'active',
      phase: 'in_progress',
      agentId: ACTOR,
      worktreeId: null,
      createdAt: 10,
      updatedAt: 10,
      completedAt: null,
      metadata: null,
      durable: false,
    },
  };
}

function envWithRoom(onFetch: (request: Request) => Promise<Response>): Env {
  return {
    RELAY_OPERATOR_TOKEN: OPERATOR,
    COORDINATION_MACAROON_ROOT_KEY_HEX: ROOT,
    COORDINATION_ROOM: {
      idFromName: (name: string) => name as unknown as DurableObjectId,
      get: () => ({
        fetch: (input: RequestInfo | URL, init?: RequestInit) => onFetch(
          input instanceof Request ? input : new Request(input, init),
        ),
      }),
    } as unknown as DurableObjectNamespace,
  } as unknown as Env;
}

async function grant(env: Env): Promise<string> {
  const response = await handleCoordinationGrant(
    new Request(`https://relay.example/v1/coordination/${encodeURIComponent(PROJECT)}/grant`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPERATOR}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ actor_id: ACTOR, ttl_seconds: 60 }),
    }),
    env,
    PROJECT,
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as { macaroon: string }).macaroon;
}

describe('ADR-0092 coordination routes', () => {
  it('decodes one project routing segment and rejects path traversal', () => {
    expect(parseCoordinationProject(encodeURIComponent(PROJECT))).toBe(PROJECT);
    expect(parseCoordinationProject(encodeURIComponent('../escape'))).toBeNull();
  });

  it('mints an operator-gated grant and forwards an authorized sync to the project room', async () => {
    let forwarded: unknown;
    const env = envWithRoom(async request => {
      forwarded = await request.json();
      return Response.json({ cursor: 1, operations: [], hasMore: false, accepted: [], pending: [] });
    });
    const macaroon = await grant(env);
    const response = await handleCoordinationSync(
      new Request(`https://relay.example/v1/coordination/${encodeURIComponent(PROJECT)}/sync`, {
        method: 'POST',
        headers: { Authorization: `Macaroon ${macaroon}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          replicaId: ACTOR,
          actorId: ACTOR,
          since: 0,
          operations: [operation()],
        }),
      }),
      env,
      PROJECT,
    );

    expect(response.status).toBe(200);
    expect(forwarded).toMatchObject({ replicaId: ACTOR, actorId: ACTOR });
  });

  it('rejects an unscoped actor and a cross-project operation before the room', async () => {
    let calls = 0;
    const env = envWithRoom(async () => {
      calls += 1;
      return Response.json({});
    });
    const macaroon = await grant(env);
    const wrongActor = await handleCoordinationSync(
      new Request('https://relay.example/sync', {
        method: 'POST',
        headers: { Authorization: `Macaroon ${macaroon}` },
        body: JSON.stringify({ replicaId: 'other', actorId: 'other', since: 0, operations: [] }),
      }),
      env,
      PROJECT,
    );
    const wrongProject = await handleCoordinationSync(
      new Request('https://relay.example/sync', {
        method: 'POST',
        headers: { Authorization: `Macaroon ${macaroon}` },
        body: JSON.stringify({ replicaId: ACTOR, actorId: ACTOR, since: 0, operations: [operation('other/project')] }),
      }),
      env,
      PROJECT,
    );

    expect(wrongActor.status).toBe(401);
    expect(wrongProject.status).toBe(403);
    expect(calls).toBe(0);
  });
});
