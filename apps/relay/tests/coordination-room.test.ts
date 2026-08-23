import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  CoordinationRoom,
  COORDINATION_FLUSH_MS,
  type CoordinationSyncResponse,
} from '../src/coordination-room.js';
import type { CoordinationOperation } from '../../../lib/coordination-ledger.js';
import { COORDINATION_MAX_CLOCK_SKEW_MS } from '../../../lib/coordination-ledger.js';
import type { Env } from '../src/types.js';

interface FakeStorage {
  storage: DurableObjectStorage;
  map: Map<string, unknown>;
  puts: { count: number };
  alarm: () => number | null;
}

function makeStorage(): FakeStorage {
  const map = new Map<string, unknown>();
  const puts = { count: 0 };
  let alarm: number | null = null;
  const storage = {
    async get(key: string) { return map.get(key); },
    async put(first: string | Record<string, unknown>, second?: unknown) {
      puts.count++;
      if (typeof first === 'string') map.set(first, second);
      else for (const [key, value] of Object.entries(first)) map.set(key, value);
    },
    async list(options?: { prefix?: string }) {
      return new Map([...map].filter(([key]) => !options?.prefix || key.startsWith(options.prefix)));
    },
    async getAlarm() { return alarm; },
    async setAlarm(at: number) { alarm = at; },
  } as unknown as DurableObjectStorage;
  return { storage, map, puts, alarm: () => alarm };
}

function room(handle = makeStorage()): { instance: CoordinationRoom; handle: FakeStorage } {
  const state = { storage: handle.storage } as unknown as DurableObjectState;
  return { instance: new CoordinationRoom(state, {} as Env), handle };
}

function operation(replicaId: string, entityId: string, wallTime: number): CoordinationOperation {
  return {
    version: 1,
    opId: `${replicaId}:claim:${entityId}:${wallTime}:0`,
    project: 'curiositech/port-daddy',
    actorId: replicaId,
    replicaId,
    kind: 'claim',
    entityId,
    mutation: 'upsert',
    clock: { wallTime, counter: 0, replicaId },
    value: {
      sessionId: `${replicaId}-session`,
      filePath: `src/${entityId}.ts`,
      startLine: null,
      endLine: null,
      symbol: null,
      symbolPath: null,
      claimedAt: wallTime,
    },
  };
}

async function sync(
  instance: CoordinationRoom,
  replicaId: string,
  operations: CoordinationOperation[] = [],
  since = 0,
): Promise<CoordinationSyncResponse> {
  const response = await instance.fetch(new Request('https://room.invalid/?action=sync', {
    method: 'POST',
    body: JSON.stringify({ replicaId, actorId: replicaId, since, operations }),
  }));
  expect(response.status).toBe(200);
  return response.json<CoordinationSyncResponse>();
}

const NOW = Date.UTC(2026, 7, 23, 12, 0, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => vi.useRealTimers());

describe('CoordinationRoom', () => {
  it('performs zero hot-path puts and one alarm-batched put for many operations', async () => {
    const { instance, handle } = room();
    const operations = Array.from({ length: 40 }, (_, index) => operation('cloud', `file-${index}`, index + 1));

    const first = await sync(instance, 'cloud', operations);
    expect(first.accepted).toEqual([]);
    expect(first.pending).toHaveLength(40);
    expect(first.operations).toEqual([]);
    expect(handle.puts.count).toBe(0);
    expect(handle.alarm()).toBe(NOW + COORDINATION_FLUSH_MS);

    await instance.alarm();
    expect(handle.puts.count).toBe(1);

    const pulled = await sync(instance, 'local');
    expect(pulled.operations).toHaveLength(40);
    expect(pulled.cursor).toBe(40);
    expect(pulled.hasMore).toBe(false);
  });

  it('does not acknowledge an op until its alarm batch is durable', async () => {
    const { instance } = room();
    const claim = operation('cloud', 'cloud-file', 1);
    expect((await sync(instance, 'cloud', [claim])).pending).toEqual([claim.opId]);
    expect((await sync(instance, 'cloud', [claim])).accepted).toEqual([]);

    await instance.alarm();
    const acknowledged = await sync(instance, 'cloud', [claim]);
    expect(acknowledged.accepted).toEqual([claim.opId]);
    expect(acknowledged.pending).toEqual([]);
  });

  it('chunks large alarm batches into bounded values without adding storage calls', async () => {
    const { instance, handle } = room();
    const operations = Array.from({ length: 80 }, (_, index) => {
      const claim = operation('cloud', `large-${index}`, index + 1);
      if (claim.kind === 'claim' && claim.value) {
        claim.value.filePath = `src/${String(index).padStart(3, '0')}-${'x'.repeat(15_000)}.ts`;
      }
      return claim;
    });

    await sync(instance, 'cloud', operations);
    await instance.alarm();

    expect(handle.puts.count).toBe(1);
    expect([...handle.map.keys()].filter(key => key.startsWith('batch:')).length).toBeGreaterThan(1);
    expect((await sync(instance, 'local')).operations).toHaveLength(80);
  });

  it('survives eviction before flush because the source retains and retries its outbox', async () => {
    const first = room();
    const claim = operation('cloud', 'survives-eviction', 1);
    await sync(first.instance, 'cloud', [claim]);
    expect(first.handle.puts.count).toBe(0);

    // Simulated Durable Object eviction: pending memory disappears, storage is
    // shared. The source has not received a durable ack, so it retries.
    const second = room(first.handle);
    const retry = await sync(second.instance, 'cloud', [claim]);
    expect(retry.pending).toEqual([claim.opId]);
    await second.instance.alarm();

    const third = room(first.handle);
    const pulled = await sync(third.instance, 'local');
    expect(pulled.operations.map((entry) => entry.operation.opId)).toEqual([claim.opId]);
  });

  it('partitioned peers reconverge without losing either claim', async () => {
    const cloud = operation('cloud', 'cloud-file', 1);
    const local = operation('local', 'local-file', 2);
    const shared = room();

    // Both peers append independently during a logical partition, then submit
    // their retained outboxes after connectivity returns.
    await sync(shared.instance, 'cloud', [cloud]);
    await sync(shared.instance, 'local', [local]);
    await shared.instance.alarm();

    const cloudView = await sync(shared.instance, 'cloud');
    const localView = await sync(shared.instance, 'local');
    const ids = cloudView.operations.map((entry) => entry.operation.entityId).sort();
    expect(ids).toEqual(['cloud-file', 'local-file']);
    expect(localView.operations).toEqual(cloudView.operations);
  });

  it('fails closed when an operation actor does not match the authenticated envelope', async () => {
    const { instance } = room();
    const forged = operation('cloud', 'forged', 1);
    const response = await instance.fetch(new Request('https://room.invalid/?action=sync', {
      method: 'POST',
      body: JSON.stringify({ replicaId: 'cloud', actorId: 'attacker', since: 0, operations: [forged] }),
    }));
    expect(response.status).toBe(403);
  });

  it('keeps actor authorization separate from the unique daemon replica id', async () => {
    const { instance } = room();
    const peerOperation = {
      ...operation('fleet-peer-b643d928', 'cloud-claim', NOW),
      actorId: 'fleet-sandbox',
    };
    const response = await instance.fetch(new Request('https://room.invalid/?action=sync', {
      method: 'POST',
      body: JSON.stringify({
        replicaId: 'fleet-peer-b643d928',
        actorId: 'fleet-sandbox',
        since: 0,
        operations: [peerOperation],
      }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      accepted: [],
      pending: [peerOperation.opId],
    });
  });

  it('rejects a far-future clock before it can poison the LWW projection', async () => {
    const { instance } = room();
    const poisoned = operation('cloud', 'future-poison', NOW + COORDINATION_MAX_CLOCK_SKEW_MS + 1);
    const response = await instance.fetch(new Request('https://room.invalid/?action=sync', {
      method: 'POST',
      body: JSON.stringify({ replicaId: 'cloud', actorId: 'cloud', since: 0, operations: [poisoned] }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'CLOCK_SKEW' });
  });
});
