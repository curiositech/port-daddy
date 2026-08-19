/**
 * Seat behavior tests: identity binding, wake intake + dedupe + alarm
 * debounce, the alarm's deck-log discipline (wake and ALL QUIET), degraded
 * fallback when D1 is out, charter revision, /status shape, and the Worker
 * entry's auth gate.
 *
 * Together these pin the sanity protocol's harness half (THE_FULL_WHEEL.md
 * §5) before the tick exists: every wake writes exactly one deck-log entry,
 * the heartbeat always re-arms, and the seat can never silently serve two
 * repos or drop its vital sign.
 */

import { describe, it, expect } from 'vitest';
import { StewardDO } from '../src/steward.js';
import worker from '../src/worker.js';
import { makeEnv, makeState, memoryD1, type FakeStorage } from './harness.js';
import type { Charter, DeckLogEntry, Env } from '../src/types.js';

const REPO = 'erichowens/port-daddy';

function makeSeat(env: Env = makeEnv({ DB: memoryD1().db })): { seat: StewardDO; storage: FakeStorage } {
  const { state, storage } = makeState();
  return { seat: new StewardDO(state, env), storage };
}

function req(
  path: string,
  opts: { method?: string; body?: unknown; repo?: string | null } = {},
): Request {
  const headers = new Headers();
  if (opts.repo !== null) headers.set('x-steward-repo', opts.repo ?? REPO);
  return new Request(`https://steward.internal${path}`, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
}

describe('identity binding — one seat, one repo, forever', () => {
  it('rejects a missing or malformed repo header', async () => {
    const { seat } = makeSeat();
    expect((await seat.fetch(req('/status', { repo: null }))).status).toBe(400);
    expect((await seat.fetch(req('/status', { repo: 'not-a-repo' }))).status).toBe(400);
  });

  it('binds to the first repo and 409s any other — never a silent context switch', async () => {
    const { seat } = makeSeat();
    expect((await seat.fetch(req('/status'))).status).toBe(200);
    const res = await seat.fetch(req('/status', { repo: 'other/repo' }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain(REPO);
  });
});

describe('wake intake', () => {
  it('queues an event, arms the debounce alarm, and reports the seq', async () => {
    const { seat, storage } = makeSeat();
    const res = await seat.fetch(
      req('/wake', { body: { kind: 'pull_request:synchronize', deliveryId: 'd1', prNumber: 7 } }),
    );
    expect(res.status).toBe(202);
    expect(((await res.json()) as { seq: number }).seq).toBe(1);
    expect(storage.alarms).toHaveLength(1);
    expect((await storage.list({ prefix: 'inbox:' })).size).toBe(1);
  });

  it('dedupes by deliveryId — at-least-once webhook delivery is safe here', async () => {
    const { seat, storage } = makeSeat();
    await seat.fetch(req('/wake', { body: { kind: 'k', deliveryId: 'dup' } }));
    const res = await seat.fetch(req('/wake', { body: { kind: 'k', deliveryId: 'dup' } }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { deduped: boolean }).deduped).toBe(true);
    expect((await storage.list({ prefix: 'inbox:' })).size).toBe(1);
  });

  it('never pushes an already-armed sooner alarm later — a stream cannot starve the drain', async () => {
    const { seat, storage } = makeSeat();
    await seat.fetch(req('/wake', { body: { kind: 'k', deliveryId: 'a' } }));
    await seat.fetch(req('/wake', { body: { kind: 'k', deliveryId: 'b' } }));
    // Second wake sees an alarm already at now+debounce and leaves it alone.
    expect(storage.alarms).toHaveLength(1);
  });

  it('rejects bodies without kind or deliveryId', async () => {
    const { seat } = makeSeat();
    expect((await seat.fetch(req('/wake', { body: { kind: 'k' } }))).status).toBe(400);
    expect((await seat.fetch(req('/wake', { body: { deliveryId: 'd' } }))).status).toBe(400);
  });
});

describe('the alarm — every wake writes its deck-log entry', () => {
  it('drains the inbox, seeds the charter, logs a wake entry, re-arms the heartbeat', async () => {
    const d1 = memoryD1();
    const { seat, storage } = makeSeat(makeEnv({ DB: d1.db }));
    await seat.fetch(req('/wake', { body: { kind: 'pull_request:opened', deliveryId: 'a', prNumber: 3 } }));
    await seat.fetch(req('/wake', { body: { kind: 'pull_request:opened', deliveryId: 'b', prNumber: 4 } }));

    await seat.alarm();

    expect((await storage.list({ prefix: 'inbox:' })).size).toBe(0);
    const charter = (await storage.get('charter')) as Charter;
    expect(charter.version).toBe(1);
    expect(d1.deckLog).toHaveLength(1);
    expect(d1.deckLog[0].entry_kind).toBe('wake');
    expect(d1.deckLog[0].wake_events).toBe(2);
    expect(String(d1.deckLog[0].summary)).toContain('pull_request:opened ×2');
    expect(String(d1.deckLog[0].summary)).toContain('P1 PR 2');
    // Heartbeat re-armed after the debounce alarm that queued the wakes.
    expect(storage.alarms.length).toBe(2);
    expect(await storage.get('lastWakeAt')).toBeTypeOf('number');
  });

  it('an empty inbox writes ALL QUIET — a silent seat is indistinguishable from a dead one', async () => {
    const d1 = memoryD1();
    const { seat } = makeSeat(makeEnv({ DB: d1.db }));
    // Bind the repo first so the entry carries it.
    await seat.fetch(req('/status'));
    await seat.alarm();
    expect(d1.deckLog).toHaveLength(1);
    expect(d1.deckLog[0].entry_kind).toBe('all-quiet');
    expect(d1.deckLog[0].wake_events).toBe(0);
    expect(String(d1.deckLog[0].summary)).toContain('ALL QUIET');
  });

  it('D1 outage degrades to the bounded fallback ring and raises the flag; recovery clears it', async () => {
    const d1 = memoryD1();
    d1.failing.value = true;
    const { seat, storage } = makeSeat(makeEnv({ DB: d1.db }));
    await seat.fetch(req('/status'));
    await seat.alarm();

    expect(d1.deckLog).toHaveLength(0);
    expect(await storage.get('degraded')).toBe(true);
    const ring = (await storage.get('decklogFallback')) as DeckLogEntry[];
    expect(ring).toHaveLength(1);
    expect(ring[0].entryKind).toBe('all-quiet');

    d1.failing.value = false;
    await seat.alarm();
    expect(d1.deckLog).toHaveLength(1);
    expect(await storage.get('degraded')).toBe(false);
  });

  it('the fallback ring is bounded — a long outage cannot grow storage without limit', async () => {
    const { seat, storage } = makeSeat(makeEnv({ DB: undefined }));
    await seat.fetch(req('/status'));
    for (let i = 0; i < StewardDO.FALLBACK_RING_MAX + 5; i++) await seat.alarm();
    const ring = (await storage.get('decklogFallback')) as DeckLogEntry[];
    expect(ring).toHaveLength(StewardDO.FALLBACK_RING_MAX);
  });
});

describe('/status — binder ch.10 answers from one GET', () => {
  it('reports identity, commissioning, inbox depth, degradation, and the honest tick note', async () => {
    const d1 = memoryD1();
    const { seat } = makeSeat(makeEnv({ DB: d1.db }));
    await seat.fetch(req('/wake', { body: { kind: 'k', deliveryId: 'd' } }));
    const before = (await (await seat.fetch(req('/status'))).json()) as Record<string, unknown>;
    expect(before.role).toBe('steward');
    expect(before.repo).toBe(REPO);
    expect(before.commissioned).toBe(false);
    expect(before.pendingWakes).toBe(1);
    expect(String(before.tick)).toContain('P1 PR 2');

    await seat.alarm();
    const after = (await (await seat.fetch(req('/status'))).json()) as Record<string, unknown>;
    expect(after.commissioned).toBe(true);
    expect(after.pendingWakes).toBe(0);
    expect((after.recentDeckLog as unknown[]).length).toBe(1);
  });
});

describe('charter revision — operator and PRs only, versioned with provenance', () => {
  it('requires updatedBy', async () => {
    const { seat } = makeSeat();
    expect((await seat.fetch(req('/charter', { body: { mission: 'x' } }))).status).toBe(400);
  });

  it('a revision on a fresh seat seeds the constitution then bumps to version 2', async () => {
    const { seat } = makeSeat();
    const res = await seat.fetch(
      req('/charter', { body: { updatedBy: 'operator', hardLimits: ['Never merge on Fridays.'] } }),
    );
    const { charter } = (await res.json()) as { charter: Charter };
    expect(charter.version).toBe(2);
    expect(charter.hardLimits).toEqual(['Never merge on Fridays.']);
    expect(charter.mission).toContain('ADR-0109');
    expect(charter.updatedBy).toBe('operator');
  });
});

describe('worker entry — the commissioning and auth gate', () => {
  /** Route through the real worker with a namespace that runs a real seat. */
  function wiredEnv(over: Partial<Env> = {}): { env: Env; storage: FakeStorage } {
    const { state, storage } = makeState();
    const env: Env = makeEnv({
      DB: memoryD1().db,
      ...over,
      STEWARD: {
        idFromName: (name: string) => ({ name }),
        get: (id: { name: string }) => ({
          fetch: (r: Request) => new StewardDO(state, env).fetch(r),
          _name: id.name,
        }),
      } as unknown as DurableObjectNamespace,
    });
    return { env, storage };
  }

  function extReq(path: string, token?: string, body?: unknown): Request {
    const headers = new Headers();
    if (token) headers.set('authorization', `Bearer ${token}`);
    return new Request(`https://pd-steward.example${path}`, {
      method: body !== undefined ? 'POST' : 'GET',
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }

  it('an uncommissioned seat (no token secret) answers 503, never 200 — fail closed, say why', async () => {
    const { env } = wiredEnv({ STEWARD_ADMIN_TOKEN: undefined });
    const res = await worker.fetch(extReq(`/steward/erichowens/port-daddy/status`, 'anything'), env);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toContain('not commissioned');
  });

  it('a wrong or missing bearer token is 401', async () => {
    const { env } = wiredEnv();
    expect((await worker.fetch(extReq(`/steward/erichowens/port-daddy/status`), env)).status).toBe(401);
    expect(
      (await worker.fetch(extReq(`/steward/erichowens/port-daddy/status`, 'wrong'), env)).status,
    ).toBe(401);
  });

  it('routes /steward/:owner/:repo/:action to the seat with the repo header set', async () => {
    const { env } = wiredEnv();
    const res = await worker.fetch(extReq(`/steward/erichowens/port-daddy/status`, 'test-token'), env);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { repo: string }).repo).toBe(REPO);
  });

  it('unknown paths are 404 at the gate', async () => {
    const { env } = wiredEnv();
    expect((await worker.fetch(extReq(`/steward/erichowens/port-daddy/tick`, 'test-token'), env)).status).toBe(404);
    expect((await worker.fetch(extReq(`/anything`, 'test-token'), env)).status).toBe(404);
  });

  it('POST /wake flows end-to-end through the gate into the seat inbox', async () => {
    const { env, storage } = wiredEnv();
    const res = await worker.fetch(
      extReq(`/steward/erichowens/port-daddy/wake`, 'test-token', { kind: 'k', deliveryId: 'e2e' }),
      env,
    );
    expect(res.status).toBe(202);
    expect((await storage.list({ prefix: 'inbox:' })).size).toBe(1);
  });
});
