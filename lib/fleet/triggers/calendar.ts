/**
 * Calendar trigger source — fires when an event on the operator's
 * calendar is about to start (lead-time configurable) or has just ended.
 *
 * Two REAL backends:
 *
 *   1. macOS EventKit (default on darwin) — via the compiled
 *      pd-calendar-helper (lib/fleet/calendar-eventkit.ts). Requires a
 *      one-time OS calendar grant (`pd fleet calendar grant`).
 *
 *   2. Google Calendar API (PD_CALENDAR_BACKEND=google) — OAuth refresh
 *      token flow, `singleEvents=true` so recurring events arrive as
 *      expanded instances (lib/fleet/calendar-google.ts).
 *
 * Spec syntax:
 *   calendar:event-starting(30m)        — 30 minutes before each event
 *   calendar:event-starting(5m,calendar:Personal)
 *                                       — 5min lead, specific calendar
 *   calendar:event-ended                — when an event finishes
 *
 * Trust + privacy posture (ADR-0093 / agentic-calendar-coordination):
 *   - `calendar` is an EXTERNAL trigger kind: anyone can inject content
 *     into the operator's calendar with a spam invite. The OS calendar
 *     grant authorizes US to READ — it says nothing about who AUTHORED an
 *     event, so consent_verified is NEVER set here.
 *   - Data minimization: the emitted payload carries title/time/location/
 *     conference URL only. Event notes/description and attendee lists are
 *     never copied into agent task text. The organizer address rides in
 *     metadata.sender solely for trust-gate allowlist matching.
 *   - All timestamps in the payload are ISO-8601 UTC; instance-unique ids
 *     (series + occurrence start) make recurring dedup per-occurrence.
 */

import {
  chooseCalendarBackend,
  getSharedEventKitClient,
} from '../calendar-eventkit.js';
import { GoogleCalendarClient, googleCredsFromEnv } from '../calendar-google.js';
import type {
  FleetTriggerEvent,
  TriggerAvailability,
  TriggerHandle,
  TriggerSource,
  TriggerSpec,
} from '../types.js';

/** The MINIMIZED event shape that reaches agent task text. */
interface CalendarEventPayload {
  /** Instance-unique id (series + occurrence start). */
  id: string;
  title: string;
  /** ISO-8601 UTC. */
  start: string;
  /** ISO-8601 UTC. */
  end: string;
  allDay: boolean;
  calendar: string;
  recurring: boolean;
  location?: string;
  conferenceUrl?: string;
}

/** What a backend lister returns (superset of the payload; organizer is
 *  stripped into metadata, never the payload). */
export interface ListedCalendarEvent extends CalendarEventPayload {
  organizer?: string;
}

export interface CalendarTriggerDeps {
  /** Injectable backend lister (tests). Default resolves per backend. */
  listEvents?: (fromISO: string, toISO: string, calendar?: string) => Promise<ListedCalendarEvent[]>;
  /** Injectable clock (tests). */
  now?: () => number;
}

const FIRED_RETENTION_MS = 24 * 60 * 60 * 1000;

export class CalendarTriggerSource implements TriggerSource {
  readonly kind = 'calendar' as const;

  constructor(private readonly deps: CalendarTriggerDeps = {}) {}

  async available(): Promise<TriggerAvailability> {
    if (this.deps.listEvents) return { ready: true };
    const backend = chooseCalendarBackend();
    if (backend === 'macos-eventkit') {
      const status = await getSharedEventKitClient().status();
      if (!status.available) {
        return {
          ready: false,
          reason: status.reason ?? 'EventKit helper unavailable',
          requires: ['Swift toolchain (xcode-select --install)'],
        };
      }
      if (!status.authorized) {
        return {
          ready: false,
          reason: status.reason ?? 'calendar access not granted',
          requires: ['pd fleet calendar grant (OS consent prompt)'],
        };
      }
      return { ready: true };
    }
    if (backend === 'google') {
      if (!googleCredsFromEnv()) {
        return {
          ready: false,
          reason: 'Google Calendar OAuth credentials missing.',
          requires: ['PD_GCAL_CLIENT_ID', 'PD_GCAL_CLIENT_SECRET', 'PD_GCAL_REFRESH_TOKEN'],
        };
      }
      return { ready: true };
    }
    return {
      ready: false,
      reason: 'No calendar backend configured. Set PD_CALENDAR_BACKEND=macos or PD_CALENDAR_BACKEND=google.',
      requires: ['PD_CALENDAR_BACKEND'],
    };
  }

  private resolveLister(): (fromISO: string, toISO: string, calendar?: string) => Promise<ListedCalendarEvent[]> {
    if (this.deps.listEvents) return this.deps.listEvents;
    if (chooseCalendarBackend() === 'google') {
      const creds = googleCredsFromEnv();
      if (!creds) throw new Error('Google Calendar creds missing (available() should have refused)');
      const client = new GoogleCalendarClient(creds);
      return (fromISO, toISO) => client.listEvents(fromISO, toISO);
    }
    const client = getSharedEventKitClient();
    return (fromISO, toISO, calendar) => client.listEvents(fromISO, toISO, calendar);
  }

  async start(spec: TriggerSpec, emit: (event: FleetTriggerEvent) => void): Promise<TriggerHandle> {
    let stopped = false;
    /** fireKey → firedAt, pruned on age — clearing wholesale would re-fire
     *  recent events still inside the lead window. */
    const state = { fired: new Map<string, number>() };
    const pollMs = 30_000;

    const tick = async () => {
      if (stopped) return;
      try {
        await this.pollOnce(spec, emit, state, pollMs);
      } catch (err) {
        console.error('[fleet.calendar] poll failed:', err instanceof Error ? err.message : err);
      }
    };

    const handle = setInterval(tick, pollMs);
    setImmediate(() => { void tick(); });

    return {
      async stop() {
        stopped = true;
        clearInterval(handle);
      },
    };
  }

  /** One poll pass. Public-ish so tests exercise the fire logic without
   *  timers; start() drives the same code on its interval. */
  async pollOnce(
    spec: TriggerSpec,
    emit: (event: FleetTriggerEvent) => void,
    state: { fired: Map<string, number> },
    pollMs = 30_000,
  ): Promise<void> {
    const leadMs = spec.arg ? parseDuration(spec.arg) : 5 * 60_000;
    const calendarFilter = spec.filters.calendar ?? null;
    const now = this.deps.now ?? Date.now;
    const listEvents = this.resolveLister();
    const nowMs = now();

    // Window: recently-ended events (for event-ended) through the lead
    // horizon plus one poll of slack, so nothing lands between ticks.
    const fromISO = new Date(nowMs - 2 * pollMs - 60 * 60_000).toISOString();
    const toISO = new Date(nowMs + leadMs + 2 * pollMs).toISOString();
    const events = await listEvents(fromISO, toISO, calendarFilter ?? undefined);

    for (const ev of events) {
      if (calendarFilter && ev.calendar !== calendarFilter) continue;
      const startMs = Date.parse(ev.start);
      const endMs = Date.parse(ev.end);
      if (Number.isNaN(startMs) || Number.isNaN(endMs)) continue;

      const fireKey = `${ev.id}:${spec.type}`;
      if (state.fired.has(fireKey)) continue;

      const fireNow =
        spec.type === 'event-starting'
          ? startMs - nowMs <= leadMs && startMs > nowMs
          : spec.type === 'event-ended'
            ? endMs <= nowMs && endMs > nowMs - pollMs * 2
            : false;
      if (!fireNow) continue;

      state.fired.set(fireKey, nowMs);
      const { organizer, ...minimized } = ev;
      const event: FleetTriggerEvent<CalendarEventPayload> = {
        source: 'calendar',
        type: spec.type,
        timestamp: nowMs,
        payload: minimized,
        metadata: {
          correlation_id: ev.id,
          // Organizer is the content AUTHOR the trust gate can match
          // against an operator allowlist; the calendar name is not.
          sender: organizer ?? ev.calendar ?? 'calendar',
          subject: ev.title,
          // NEVER true here: the OS calendar grant authorizes reading,
          // it does not verify who authored the event — a spam invite
          // is attacker-controlled content (ADR-0093 invariant #1).
          consent_verified: false,
        },
      };
      emit(event);
    }

    // Prune by age, never wholesale.
    for (const [key, at] of state.fired) {
      if (nowMs - at > FIRED_RETENTION_MS) state.fired.delete(key);
    }
  }
}

function parseDuration(input: string): number {
  const match = input.trim().match(/^(\d+)\s*(s|m|h|d)?$/);
  if (!match) return 5 * 60_000;
  const value = Number(match[1]);
  const unit = (match[2] ?? 'm').toLowerCase();
  const mult = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  return value * mult;
}
