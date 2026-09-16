/**
 * The pulse — the seat's starter motor and its watchdog (P1 PR 5).
 *
 * WHAT THESE PIN, AND WHY IT IS NOT HYPOTHETICAL: `alarm()` re-arms itself on
 * its way out, so a seat that has beaten once beats forever. But the only code
 * that ever armed a FIRST alarm was `handleWake`, and nothing in this system
 * ever posted a wake. P1 shipped deployed and commissioned, and production D1
 * held zero `steward_deck_log` rows — §5.3 makes that log the seat's vital
 * sign, and the seat could not write one because it had never woken. These
 * tests hold the two properties that failure needs: a cold seat starts, and a
 * seat whose alarm was lost is noticed from outside rather than never again.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { StewardDO } from '../src/steward.js';
import worker, { parseRepoRoster } from '../src/worker.js';
import { makeEnv, makeState, memoryD1, type FakeStorage } from './harness.js';
import type { Env } from '../src/types.js';

const REPO = 'erichowens/port-daddy';

/** Build a seat over an in-memory D1, exposing storage for alarm assertions. */
function makeSeat(env: Env = makeEnv({ DB: memoryD1().db })): {
  seat: StewardDO;
  storage: FakeStorage;
} {
  const { state, storage } = makeState();
  return { seat: new StewardDO(state, env), storage };
}

/** A POST to an internal seat path, carrying the repo header the DO requires. */
function pulseReq(repo: string = REPO): Request {
  return new Request('https://steward.internal/pulse', {
    method: 'POST',
    headers: { 'x-steward-repo': repo },
  });
}

type PulseBody = {
  repo: string;
  armed: boolean;
  reason: string;
  alarmAt: number | null;
  lastWakeAt: number | null;
};

describe('pulse — the starter motor', () => {
  it('arms the first alarm on a cold seat, which nothing else in the system does', async () => {
    const { seat, storage } = makeSeat();
    // A brand-new seat: never woken, no alarm. This is the exact production
    // state that produced zero deck-log rows.
    expect(await storage.getAlarm()).toBeNull();

    const body = (await (await seat.fetch(pulseReq())).json()) as PulseBody;

    expect(body.armed).toBe(true);
    expect(body.reason).toContain('cold seat');
    expect(await storage.getAlarm()).not.toBeNull();
  });

  it('leads to a real deck-log entry — the vital sign, end to end', async () => {
    const d1 = memoryD1();
    const { seat } = makeSeat(makeEnv({ DB: d1.db }));
    await seat.fetch(pulseReq());
    // The pulse arms; the platform then fires alarm(). Running it here is the
    // platform's half, not a shortcut past the code under test.
    await seat.alarm();

    expect(d1.deckLog).toHaveLength(1);
    // ALL QUIET, not 'wake': the pulse must not forge a stimulus the seat
    // never received. It restores the vital sign; it does not fake one.
    expect(d1.deckLog[0].entry_kind).toBe('all-quiet');
    expect(String(d1.deckLog[0].summary)).toContain('ALL QUIET');
  });

  it('is a no-op on a healthy seat, so an hourly cron costs zero extra wakes', async () => {
    const { seat, storage } = makeSeat();
    await seat.fetch(pulseReq());
    await seat.alarm(); // arms the 6h heartbeat and records lastWakeAt
    const armedCount = storage.alarms.length;

    const body = (await (await seat.fetch(pulseReq())).json()) as PulseBody;

    expect(body.armed).toBe(false);
    expect(body.reason).toContain('healthy');
    // The live alarm is untouched — a pulse that re-armed here would drag the
    // next heartbeat earlier on every cron tick and turn hourly checking into
    // hourly waking.
    expect(storage.alarms).toHaveLength(armedCount);
  });

  it('never disturbs a wake debounce already in flight', async () => {
    const { seat, storage } = makeSeat();
    await seat.fetch(
      new Request('https://steward.internal/wake', {
        method: 'POST',
        headers: { 'x-steward-repo': REPO },
        body: JSON.stringify({ kind: 'pull_request:opened', deliveryId: 'd1' }),
      }),
    );
    const debounceTarget = await storage.getAlarm();

    const body = (await (await seat.fetch(pulseReq())).json()) as PulseBody;

    // Never woken yet, but an alarm is pending: the seat is mid-startup, not
    // dead. Firing it now would collapse the debounce window that exists so a
    // burst of webhooks becomes one wake.
    expect(body.armed).toBe(false);
    expect(await storage.getAlarm()).toBe(debounceTarget);
  });
});

describe('pulse — the watchdog', () => {
  it('re-arms when the alarm was lost after the seat had been running', async () => {
    const { seat, storage } = makeSeat();
    await seat.fetch(pulseReq());
    await seat.alarm();
    // The platform loses the alarm: a failed delivery, an evicted object, a
    // migration. Nothing inside the seat can observe this, because the thing
    // that would report it is the wake that now never happens.
    await storage.deleteAlarm();

    const body = (await (await seat.fetch(pulseReq())).json()) as PulseBody;

    expect(body.armed).toBe(true);
    expect(body.reason).toContain('alarm missing');
    expect(await storage.getAlarm()).not.toBeNull();
  });

  it('forces a beat when an alarm LOOKS armed but no wake has landed in two heartbeats', async () => {
    const { seat, storage } = makeSeat();
    await seat.fetch(pulseReq());
    await seat.alarm();
    // Backdate the last wake past the stale line while leaving the alarm
    // armed. This is the case a getAlarm()-only check cannot see: an
    // undelivered alarm is indistinguishable from a healthy one by its
    // presence alone, which is why liveness is judged on the last ACTUAL wake.
    await storage.put('lastWakeAt', Date.now() - StewardDO.STALE_WAKE_MS - 60_000);
    const before = storage.alarms.length;

    const body = (await (await seat.fetch(pulseReq())).json()) as PulseBody;

    expect(body.armed).toBe(true);
    expect(body.reason).toContain('no wake in');
    expect(storage.alarms).toHaveLength(before + 1);
  });

  it('tolerates one missed beat — a hiccup is not a corpse', async () => {
    const { seat, storage } = makeSeat();
    await seat.fetch(pulseReq());
    await seat.alarm();
    // Older than one heartbeat, younger than the stale line: the platform may
    // still deliver. Acting here would make the watchdog fire on ordinary
    // jitter and hide the signal it exists to raise.
    await storage.put('lastWakeAt', Date.now() - StewardDO.HEARTBEAT_MS - 60_000);

    const body = (await (await seat.fetch(pulseReq())).json()) as PulseBody;

    expect(body.armed).toBe(false);
    expect(StewardDO.STALE_WAKE_MS).toBeGreaterThan(StewardDO.HEARTBEAT_MS);
  });
});

describe('roster parsing — a typo must not create a phantom seat', () => {
  it('accepts a list, trims it, and dedupes', () => {
    expect(parseRepoRoster(' a/b , c/d ,a/b, ')).toEqual({
      repos: ['a/b', 'c/d'],
      rejected: [],
    });
  });

  it('rejects anything that is not owner/repo rather than pulsing it', () => {
    // idFromName accepts ANY string, so a malformed entry would happily
    // create a brand-new empty seat that pulses forever and serves nobody —
    // a quieter version of the bug this whole PR fixes.
    const { repos, rejected } = parseRepoRoster('good/repo,nope,a/b/c,also bad');
    expect(repos).toEqual(['good/repo']);
    expect(rejected).toEqual(['nope', 'a/b/c', 'also bad']);
  });

  it('treats unset and empty identically — no seats, not a crash', () => {
    expect(parseRepoRoster(undefined).repos).toEqual([]);
    expect(parseRepoRoster('   ').repos).toEqual([]);
  });
});

describe('cron handler — the outside clock', () => {
  const logs: string[] = [];
  const errors: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    logs.length = 0;
    errors.length = 0;
  });

  /** Wire the real worker to real seats, one FakeStorage per repo name. */
  function cronEnv(over: Partial<Env> = {}): { env: Env; seats: Map<string, FakeStorage> } {
    const seats = new Map<string, FakeStorage>();
    const stewards = new Map<string, StewardDO>();
    const env: Env = makeEnv({
      DB: memoryD1().db,
      ...over,
      STEWARD: {
        idFromName: (name: string) => ({ name }),
        get: (id: { name: string }) => {
          let seat = stewards.get(id.name);
          if (!seat) {
            const { state, storage } = makeState();
            seat = new StewardDO(state, env);
            stewards.set(id.name, seat);
            seats.set(id.name, storage);
          }
          const bound = seat;
          return { fetch: (r: Request) => bound.fetch(r) };
        },
      } as unknown as DurableObjectNamespace,
    });
    vi.spyOn(console, 'log').mockImplementation(m => void logs.push(String(m)));
    vi.spyOn(console, 'error').mockImplementation(m => void errors.push(String(m)));
    return { env, seats };
  }

  it('pulses every seat on the roster, addressing each by its own DO name', async () => {
    const { env, seats } = cronEnv({ STEWARD_REPOS: 'o/one, o/two' });

    await worker.scheduled({} as ScheduledController, env);

    expect([...seats.keys()].sort()).toEqual(['steward:o/one', 'steward:o/two']);
    for (const storage of seats.values()) {
      expect(await storage.getAlarm()).not.toBeNull();
    }
  });

  it('does NOT require the admin bearer — the cron is inside the boundary, not outside it', async () => {
    // The token gate in fetch() authenticates the outside world. Making the
    // Worker present a credential to its own Durable Object would add a secret
    // without adding a boundary: DO namespaces are not publicly addressable.
    const { env, seats } = cronEnv({ STEWARD_REPOS: 'o/one', STEWARD_ADMIN_TOKEN: undefined });

    await worker.scheduled({} as ScheduledController, env);

    expect(await seats.get('steward:o/one')!.getAlarm()).not.toBeNull();
  });

  it('names each malformed entry in the log while still pulsing the valid ones', async () => {
    // parseRepoRoster's rejection is unit-tested above; this pins the half that
    // only exists end-to-end — that the cron SAYS which entry it dropped. A
    // roster silently one seat short is the failure this whole PR exists to
    // prevent, wearing a config typo as a disguise, so the drop has to be as
    // loud as the empty-roster case while the rest of the roster still beats.
    const { env, seats } = cronEnv({ STEWARD_REPOS: 'o/good, not-a-repo, a/b/c' });

    await worker.scheduled({} as ScheduledController, env);

    expect(errors.join('\n')).toContain('not-a-repo');
    expect(errors.join('\n')).toContain('a/b/c');
    expect([...seats.keys()]).toEqual(['steward:o/good']);
    expect(await seats.get('steward:o/good')!.getAlarm()).not.toBeNull();
  });

  it('logs an EMPTY roster as an error — "ran fine" and "did nothing" must not look alike', async () => {
    const { env, seats } = cronEnv({ STEWARD_REPOS: '' });

    await worker.scheduled({} as ScheduledController, env);

    expect(seats.size).toBe(0);
    expect(errors.join('\n')).toContain('NO seat was pulsed');
  });

  it('keeps pulsing the rest of the roster after one seat throws', async () => {
    // A silent seat is the failure being prevented; an unhandled throw here
    // would silence every seat listed after the broken one.
    const seats = new Map<string, FakeStorage>();
    const env: Env = makeEnv({
      DB: memoryD1().db,
      STEWARD_REPOS: 'o/broken,o/fine',
      STEWARD: {
        idFromName: (name: string) => ({ name }),
        get: (id: { name: string }) => {
          if (id.name === 'steward:o/broken') {
            return {
              fetch: () => {
                throw new Error('DO unreachable');
              },
            };
          }
          const { state, storage } = makeState();
          seats.set(id.name, storage);
          const seat = new StewardDO(state, env);
          return { fetch: (r: Request) => seat.fetch(r) };
        },
      } as unknown as DurableObjectNamespace,
    });
    vi.spyOn(console, 'log').mockImplementation(m => void logs.push(String(m)));
    vi.spyOn(console, 'error').mockImplementation(m => void errors.push(String(m)));

    await worker.scheduled({} as ScheduledController, env);

    expect(errors.join('\n')).toContain('o/broken');
    expect(await seats.get('steward:o/fine')!.getAlarm()).not.toBeNull();
  });
});

describe('/status reports whether the clock is wound', () => {
  it('is null on a seat nothing has ever armed — the incident, visible from one GET', async () => {
    const { seat } = makeSeat();
    const body = (await (await seat.fetch(
      new Request('https://steward.internal/status', { headers: { 'x-steward-repo': REPO } }),
    )).json()) as { alarmAt: number | null; lastWakeAt: number | null };
    expect(body.alarmAt).toBeNull();
  });

  it('reports the armed target once a pulse has wound it', async () => {
    const { seat } = makeSeat();
    await seat.fetch(pulseReq());
    const body = (await (await seat.fetch(
      new Request('https://steward.internal/status', { headers: { 'x-steward-repo': REPO } }),
    )).json()) as { alarmAt: number | null };
    expect(typeof body.alarmAt).toBe('number');
  });
});

describe('worker route — /pulse is reachable and still gated', () => {
  /** Route through the real worker with a namespace that runs a real seat. */
  function wiredEnv(over: Partial<Env> = {}): { env: Env; storage: FakeStorage } {
    const { state, storage } = makeState();
    const env: Env = makeEnv({
      DB: memoryD1().db,
      ...over,
      STEWARD: {
        idFromName: (name: string) => ({ name }),
        get: () => ({ fetch: (r: Request) => new StewardDO(state, env).fetch(r) }),
      } as unknown as DurableObjectNamespace,
    });
    return { env, storage };
  }

  it('an operator with the bearer can start a seat by hand', async () => {
    const { env, storage } = wiredEnv();
    const res = await worker.fetch(
      new Request('https://pd-steward.example/steward/erichowens/port-daddy/pulse', {
        method: 'POST',
        headers: { authorization: 'Bearer test-token' },
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(await storage.getAlarm()).not.toBeNull();
  });

  it('refuses an unauthenticated pulse like every other route', async () => {
    const { env, storage } = wiredEnv();
    const res = await worker.fetch(
      new Request('https://pd-steward.example/steward/erichowens/port-daddy/pulse', {
        method: 'POST',
      }),
      env,
    );
    expect(res.status).toBe(401);
    expect(await storage.getAlarm()).toBeNull();
  });
});
