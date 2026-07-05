// tests/unit/fleet-calendar-io.test.js
//
// Calendar I/O (io-wiring Phase 5, calendar half) — the trigger's fire/dedup
// logic against an injected backend lister, and the sink against injected
// EventKit/Google clients.
//
// agentic-calendar-coordination gates pinned here:
//   - UTC-internal: payload timestamps are ISO-8601 UTC; the sink
//     normalizes inputs to UTC before the backend call.
//   - Recurring expanded to INSTANCES: two occurrences of one series fire
//     independently (instance-unique ids), and dedup is per-occurrence.
//   - Data minimization: the emitted payload carries NO organizer, NO
//     notes, NO attendees — organizer rides only in metadata.sender for
//     trust-gate allowlist matching.
//   - ADR-0093: consent_verified is ALWAYS false for calendar events (an
//     OS read grant is not content-author verification; spam invites are
//     attacker-controlled).
//   - Dedup pruning is age-based, never wholesale (wholesale clearing
//     re-fires events still inside the lead window).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { CalendarTriggerSource } = await import('../../lib/fleet/triggers/calendar.js');
const { CalendarOutputSink } = await import('../../lib/fleet/outputs/calendar.js');
const { ConsentGate, setSharedConsentGate } = await import('../../lib/fleet/consent-gate.js');
const { parseTriggerSpec } = await import('../../lib/fleet/types.js');

function makeScratch() {
  const home = process.env.HOME || '';
  try {
    return mkdtempSync(join(home, 'coding', 'tmp', 'pd-cal-io-test-'));
  } catch {
    return mkdtempSync(join(tmpdir(), 'pd-cal-io-test-'));
  }
}

afterEach(() => setSharedConsentGate(null));

const T0 = Date.parse('2026-07-06T15:00:00Z'); // fixed "now"

function ev(overrides = {}) {
  return {
    id: 'series-1/2026-07-06T15:20:00Z',
    seriesId: 'series-1',
    title: 'API review',
    start: '2026-07-06T15:20:00Z', // 20 min from T0
    end: '2026-07-06T15:50:00Z',
    allDay: false,
    calendar: 'Work',
    recurring: false,
    organizer: 'alice@example.com',
    ...overrides,
  };
}

// ─── Trigger ─────────────────────────────────────────────────────────────────

describe('CalendarTriggerSource fire logic', () => {
  test('fires inside the lead window, exactly once across polls, with minimized payload', async () => {
    const events = [];
    const src = new CalendarTriggerSource({
      listEvents: async () => [ev()],
      now: () => T0,
    });
    const spec = parseTriggerSpec('calendar:event-starting(30m)');
    const state = { fired: new Map() };

    await src.pollOnce(spec, (e) => events.push(e), state);
    await src.pollOnce(spec, (e) => events.push(e), state); // second poll: dedup

    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.source).toBe('calendar');
    expect(e.payload.title).toBe('API review');
    expect(e.payload.start).toBe('2026-07-06T15:20:00Z');
    // Data minimization: no organizer/notes/attendees in the payload.
    expect(e.payload.organizer).toBeUndefined();
    expect(e.payload.notes).toBeUndefined();
    expect(e.payload.attendees).toBeUndefined();
    // Organizer is the trust-gate sender; consent NEVER from the OS grant.
    expect(e.metadata.sender).toBe('alice@example.com');
    expect(e.metadata.consent_verified).toBe(false);
  });

  test('does not fire outside the lead window or for already-started events', async () => {
    const events = [];
    const src = new CalendarTriggerSource({
      listEvents: async () => [
        ev({ id: 'far/1', start: '2026-07-06T16:30:00Z', end: '2026-07-06T17:00:00Z' }), // 90m out
        ev({ id: 'past/1', start: '2026-07-06T14:00:00Z', end: '2026-07-06T14:30:00Z' }), // started
      ],
      now: () => T0,
    });
    await src.pollOnce(parseTriggerSpec('calendar:event-starting(30m)'), (e) => events.push(e), { fired: new Map() });
    expect(events).toHaveLength(0);
  });

  test('recurring instances fire independently (per-occurrence dedup, never per-series)', async () => {
    const events = [];
    const src = new CalendarTriggerSource({
      listEvents: async () => [
        ev({ id: 'standup/2026-07-06T15:10:00Z', start: '2026-07-06T15:10:00Z', end: '2026-07-06T15:15:00Z', recurring: true }),
        ev({ id: 'standup/2026-07-06T15:25:00Z', start: '2026-07-06T15:25:00Z', end: '2026-07-06T15:30:00Z', recurring: true }),
      ],
      now: () => T0,
    });
    const state = { fired: new Map() };
    await src.pollOnce(parseTriggerSpec('calendar:event-starting(30m)'), (e) => events.push(e), state);
    expect(events).toHaveLength(2);
    expect(new Set(events.map((e) => e.metadata.correlation_id)).size).toBe(2);
  });

  test('calendar filter and event-ended type', async () => {
    const events = [];
    const src = new CalendarTriggerSource({
      listEvents: async () => [
        ev({ id: 'work/1', calendar: 'Work', start: '2026-07-06T14:30:00Z', end: '2026-07-06T14:59:40Z' }),
        ev({ id: 'personal/1', calendar: 'Personal', start: '2026-07-06T14:30:00Z', end: '2026-07-06T14:59:40Z' }),
      ],
      now: () => T0,
    });
    await src.pollOnce(
      parseTriggerSpec('calendar:event-ended(calendar:Work)'),
      (e) => events.push(e),
      { fired: new Map() },
    );
    expect(events).toHaveLength(1);
    expect(events[0].payload.calendar).toBe('Work');
    expect(events[0].type).toBe('event-ended');
  });

  test('dedup pruning is age-based: old keys drop, recent keys survive', async () => {
    const clock = { t: T0 };
    const src = new CalendarTriggerSource({
      listEvents: async () => [],
      now: () => clock.t,
    });
    const state = { fired: new Map([
      ['ancient:event-starting', T0 - 25 * 60 * 60 * 1000],
      ['recent:event-starting', T0 - 60 * 1000],
    ]) };
    await src.pollOnce(parseTriggerSpec('calendar:event-starting(30m)'), () => {}, state);
    expect(state.fired.has('ancient:event-starting')).toBe(false);
    expect(state.fired.has('recent:event-starting')).toBe(true);
  });

  test('available() is ready when a lister is injected', async () => {
    const src = new CalendarTriggerSource({ listEvents: async () => [] });
    expect((await src.available()).ready).toBe(true);
  });
});

// ─── Sink ────────────────────────────────────────────────────────────────────

function grantedGate(dir) {
  const gate = new ConsentGate({ configPath: join(dir, 'consents.json'), auditLogPath: join(dir, 'audit.log') });
  gate.grant({ sink: 'calendar', maxPii: 'high', grantedAt: Date.now(), reason: 'test' });
  return gate;
}

describe('CalendarOutputSink', () => {
  test('EventKit path: UTC-normalized times, recipient → target calendar', async () => {
    const dir = makeScratch();
    try {
      setSharedConsentGate(grantedGate(dir));
      const created = [];
      const sink = new CalendarOutputSink({
        eventKit: {
          status: async () => ({ available: true, authorized: true }),
          createEvent: async (input) => { created.push(input); return { id: 'ek-1', calendar: input.calendar ?? 'Default' }; },
        },
      });
      expect((await sink.available()).ready).toBe(true);

      const res = await sink.dispatch({
        sink: 'calendar',
        type: 'create-event',
        title: 'Fleet review',
        // Non-UTC input offset must normalize to UTC at the boundary.
        start: '2026-07-07T10:00:00-05:00',
        end: '2026-07-07T10:30:00-05:00',
        recipient: 'Work',
        body: 'agenda…',
        pii: 'high',
      });
      expect(created[0].start).toBe('2026-07-07T15:00:00.000Z');
      expect(created[0].end).toBe('2026-07-07T15:30:00.000Z');
      expect(created[0].calendar).toBe('Work');
      expect(res.id).toBe('ek-1');
      expect(res.receipt.backend).toBe('macos-eventkit');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects end <= start and unparseable timestamps (before any backend call)', async () => {
    const dir = makeScratch();
    try {
      setSharedConsentGate(grantedGate(dir));
      const sink = new CalendarOutputSink({
        eventKit: {
          status: async () => ({ available: true, authorized: true }),
          createEvent: async () => { throw new Error('must not be called'); },
        },
      });
      await expect(sink.dispatch({
        sink: 'calendar', type: 'create-event', title: 't',
        start: '2026-07-07T11:00:00Z', end: '2026-07-07T10:00:00Z',
      })).rejects.toThrow(/end must be after start/);
      await expect(sink.dispatch({
        sink: 'calendar', type: 'create-event', title: 't',
        start: 'tomorrow-ish', end: '2026-07-07T10:00:00Z',
      })).rejects.toThrow(/ISO-8601/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('consent is mandatory: no grant → denial before any backend call', async () => {
    const dir = makeScratch();
    try {
      setSharedConsentGate(new ConsentGate({ configPath: join(dir, 'none.json'), auditLogPath: join(dir, 'a.log') }));
      const sink = new CalendarOutputSink({
        eventKit: {
          status: async () => ({ available: true, authorized: true }),
          createEvent: async () => { throw new Error('must not be called'); },
        },
      });
      await expect(sink.dispatch({
        sink: 'calendar', type: 'create-event', title: 't',
        start: '2026-07-07T10:00:00Z', end: '2026-07-07T11:00:00Z',
      })).rejects.toThrow(/consent/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('Google path used when injected', async () => {
    const dir = makeScratch();
    try {
      setSharedConsentGate(grantedGate(dir));
      const created = [];
      const sink = new CalendarOutputSink({
        google: { createEvent: async (input) => { created.push(input); return { id: 'g-1', url: 'https://cal/x' }; } },
      });
      const res = await sink.dispatch({
        sink: 'calendar', type: 'create-event', title: 'Sync',
        start: '2026-07-07T10:00:00Z', end: '2026-07-07T10:30:00Z',
      });
      expect(created).toHaveLength(1);
      expect(res.url).toBe('https://cal/x');
      expect(res.receipt.backend).toBe('google');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ─── Google client ───────────────────────────────────────────────────────────

describe('GoogleCalendarClient', () => {
  test('refreshes token once, lists with singleEvents=true, filters cancelled, UTC-normalizes', async () => {
    const { GoogleCalendarClient } = await import('../../lib/fleet/calendar-google.js');
    const calls = [];
    const fakeFetch = async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('oauth2.googleapis.com')) {
        return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }), text: async () => '' };
      }
      return {
        ok: true,
        text: async () => '',
        json: async () => ({
          items: [
            { id: 'a1', summary: 'Live', start: { dateTime: '2026-07-06T10:00:00-05:00' }, end: { dateTime: '2026-07-06T11:00:00-05:00' }, recurringEventId: 'series-a', organizer: { email: 'o@x.com' } },
            { id: 'dead', status: 'cancelled', start: { dateTime: '2026-07-06T10:00:00Z' }, end: { dateTime: '2026-07-06T11:00:00Z' } },
            { id: 'allday', summary: 'Holiday', start: { date: '2026-07-06' }, end: { date: '2026-07-07' } },
          ],
        }),
      };
    };
    const client = new GoogleCalendarClient(
      { clientId: 'c', clientSecret: 's', refreshToken: 'r', calendarId: 'primary' },
      fakeFetch,
    );
    const events = await client.listEvents('2026-07-06T00:00:00Z', '2026-07-07T00:00:00Z');
    await client.listEvents('2026-07-06T00:00:00Z', '2026-07-07T00:00:00Z'); // token cached

    const tokenCalls = calls.filter((c) => c.url.includes('oauth2'));
    expect(tokenCalls).toHaveLength(1);
    const listCall = calls.find((c) => c.url.includes('/events?'));
    expect(listCall.url).toContain('singleEvents=true');

    expect(events).toHaveLength(2); // cancelled dropped
    expect(events[0].start).toBe('2026-07-06T15:00:00.000Z'); // UTC-normalized
    expect(events[0].seriesId).toBe('series-a');
    expect(events[0].organizer).toBe('o@x.com');
    expect(events[1].allDay).toBe(true);
  });
});
