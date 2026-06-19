/**
 * Calendar trigger source — fires when an event on the operator's
 * calendar is about to start (lead-time configurable) or has just ended.
 *
 * Two backends are supported:
 *
 *   1. macOS CalendarStore / EventKit — reads from the system Calendar
 *      database. Requires the operator to grant Calendar access to the
 *      daemon in System Settings → Privacy.
 *
 *   2. Google Calendar API — reads from the operator's Google account
 *      via OAuth. Requires PD_GCAL_CLIENT_ID + PD_GCAL_REFRESH_TOKEN.
 *
 * Spec syntax:
 *   calendar:event-starting(30m)        — 30 minutes before each event
 *   calendar:event-starting(5m,calendar:Personal)
 *                                       — 5min lead, specific calendar
 *   calendar:event-ended                — when an event finishes
 *
 * Both backends are STUBBED. The TriggerSource contract is fully
 * implemented; the actual fetch path is a placeholder until the
 * operator wires creds.
 */

import type {
  FleetTriggerEvent,
  TriggerAvailability,
  TriggerHandle,
  TriggerSource,
  TriggerSpec,
} from '../types.js';

interface CalendarEvent {
  id: string;
  title: string;
  /** ISO-8601 with timezone. */
  start: string;
  /** ISO-8601 with timezone. */
  end: string;
  location?: string;
  /** Plaintext notes/body. May include meeting links. */
  notes?: string;
  /** Display name of the source calendar ("Work", "Personal", etc). */
  calendar?: string;
  /** RFC 5322 addresses of attendees. */
  attendees?: string[];
  /** Free-form videoconference link (Zoom/Meet/Teams). */
  conferenceUrl?: string;
}

export class CalendarTriggerSource implements TriggerSource {
  readonly kind = 'calendar' as const;

  async available(): Promise<TriggerAvailability> {
    const backend = chooseBackend();
    if (backend === 'macos-eventkit') {
      return {
        ready: true,
        reason: 'macOS EventKit (requires Calendar access in System Settings → Privacy).',
        requires: ['Calendar access for the daemon binary'],
      };
    }
    if (backend === 'google') {
      const hasCreds = Boolean(process.env.PD_GCAL_CLIENT_ID && process.env.PD_GCAL_REFRESH_TOKEN);
      if (!hasCreds) {
        return {
          ready: false,
          reason: 'Google Calendar OAuth credentials missing.',
          requires: ['PD_GCAL_CLIENT_ID', 'PD_GCAL_REFRESH_TOKEN'],
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

  async start(spec: TriggerSpec, emit: (event: FleetTriggerEvent) => void): Promise<TriggerHandle> {
    // Parse the lead time. `spec.arg` like "30m" or "1h" or "15s".
    const leadMs = spec.arg ? parseDuration(spec.arg) : 5 * 60_000;
    const calendarFilter = spec.filters.calendar ?? null;

    let stopped = false;
    const seenFired = new Set<string>();
    const pollMs = 30_000; // Check every 30s for events crossing the lead-time threshold.

    const tick = async () => {
      if (stopped) return;
      try {
        const events = await fetchUpcomingEvents();
        const now = Date.now();
        for (const ev of events) {
          if (calendarFilter && ev.calendar !== calendarFilter) continue;
          const startMs = Date.parse(ev.start);
          if (Number.isNaN(startMs)) continue;

          const fireKey = `${ev.id}:${spec.type}`;
          if (seenFired.has(fireKey)) continue;

          const fireNow =
            spec.type === 'event-starting'
              ? startMs - now <= leadMs && startMs > now
              : spec.type === 'event-ended'
                ? Date.parse(ev.end) <= now && Date.parse(ev.end) > now - pollMs * 2
                : false;
          if (!fireNow) continue;

          seenFired.add(fireKey);
          const event: FleetTriggerEvent<CalendarEvent> = {
            source: 'calendar',
            type: spec.type,
            timestamp: Date.now(),
            payload: ev,
            metadata: {
              correlation_id: ev.id,
              sender: ev.calendar ?? 'calendar',
              subject: ev.title,
              consent_verified: true, // Calendar grant is OS-mediated.
            },
          };
          emit(event);
        }
        // Prune seenFired so it doesn't grow without bound. Anything we
        // saw more than 24h ago can be safely forgotten.
        if (seenFired.size > 1000) {
          seenFired.clear();
        }
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
}

function chooseBackend(): 'macos-eventkit' | 'google' | 'none' {
  const env = (process.env.PD_CALENDAR_BACKEND ?? '').toLowerCase();
  if (env === 'macos') return 'macos-eventkit';
  if (env === 'google') return 'google';
  if (process.platform === 'darwin') return 'macos-eventkit';
  return 'none';
}

function parseDuration(input: string): number {
  const match = input.trim().match(/^(\d+)\s*(s|m|h|d)?$/);
  if (!match) return 5 * 60_000;
  const value = Number(match[1]);
  const unit = (match[2] ?? 'm').toLowerCase();
  const mult = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  return value * mult;
}

/**
 * STUBBED. The real implementation either:
 *   - shells `osascript` against the Calendar.app scripting interface
 *     (cheap but slow; only works while Calendar is running), or
 *   - links a small Swift helper around EventKit that we ship alongside
 *     the daemon and call via XPC, or
 *   - calls the Google Calendar v3 API with the operator's OAuth token.
 *
 * Operator setup required — see module header.
 */
async function fetchUpcomingEvents(): Promise<CalendarEvent[]> {
  return [];
}
