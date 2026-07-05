/**
 * Calendar output sink — creates a new calendar event. Two REAL backends,
 * matching `triggers/calendar.ts`:
 *   - macOS EventKit (default on darwin) via the compiled
 *     pd-calendar-helper (survives Calendar.app being closed).
 *   - Google Calendar API (PD_CALENDAR_BACKEND=google) via OAuth refresh
 *     token (PD_GCAL_CLIENT_ID + PD_GCAL_CLIENT_SECRET +
 *     PD_GCAL_REFRESH_TOKEN, calendar via PD_GCAL_CALENDAR_ID).
 *
 * Timestamps cross this boundary as ISO-8601 (UTC canonical); the backend
 * client normalizes before the API call — never a bare local time string.
 *
 * Consent posture: writing to the operator's calendar is unambiguously
 * personal data, so we always run through the consent gate. The first time
 * a fleet tries to create a calendar event the operator must grant via
 * `pd fleet consent grant --sink calendar --tier high`.
 */

import { getSharedConsentGate } from '../consent-gate.js';
import {
  chooseCalendarBackend,
  getSharedEventKitClient,
  type EventKitClient,
} from '../calendar-eventkit.js';
import { GoogleCalendarClient, googleCredsFromEnv } from '../calendar-google.js';
import type {
  OutputAvailability,
  OutputPayload,
  OutputResult,
  OutputSink,
} from '../types.js';

export interface CalendarSinkDeps {
  /** Injectable clients (tests). */
  eventKit?: Pick<EventKitClient, 'status' | 'createEvent'>;
  google?: Pick<GoogleCalendarClient, 'createEvent'>;
}

export class CalendarOutputSink implements OutputSink {
  readonly kind = 'calendar' as const;

  constructor(private readonly deps: CalendarSinkDeps = {}) {}

  async available(): Promise<OutputAvailability> {
    if (this.deps.eventKit || this.deps.google) return { ready: true };
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
    };
  }

  async dispatch(payload: OutputPayload): Promise<OutputResult> {
    if (payload.sink !== 'calendar') {
      throw new Error(`CalendarOutputSink received payload for sink="${payload.sink}"`);
    }
    if (payload.type !== 'create-event') {
      throw new Error(`CalendarOutputSink: unknown subtype "${payload.type}" (only create-event supported)`);
    }
    if (!payload.title) throw new Error('calendar:create-event requires payload.title');
    if (!payload.start) throw new Error('calendar:create-event requires payload.start (ISO-8601)');
    if (!payload.end) throw new Error('calendar:create-event requires payload.end (ISO-8601)');
    const startMs = Date.parse(payload.start);
    const endMs = Date.parse(payload.end);
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
      throw new Error('calendar:create-event start/end must be parseable ISO-8601 timestamps');
    }
    if (endMs <= startMs) {
      throw new Error('calendar:create-event end must be after start');
    }

    // Calendar writes always touch PII (event titles, attendees).
    getSharedConsentGate().assertAllowed('calendar', { ...payload, pii: payload.pii ?? 'high' });

    const useGoogle = this.deps.google || (!this.deps.eventKit && chooseCalendarBackend() === 'google');
    return useGoogle ? this.dispatchGoogle(payload) : this.dispatchEventKit(payload);
  }

  private async dispatchEventKit(payload: OutputPayload): Promise<OutputResult> {
    const client = this.deps.eventKit ?? getSharedEventKitClient();
    const created = await client.createEvent({
      title: payload.title!,
      start: new Date(payload.start!).toISOString(),
      end: new Date(payload.end!).toISOString(),
      calendar: payload.recipient || undefined, // recipient = target calendar name
      location: payload.location,
      notes: payload.body,
    });
    return {
      id: created.id,
      deliveredAt: Date.now(),
      receipt: {
        backend: 'macos-eventkit',
        calendar: created.calendar,
        title: payload.title,
        start: new Date(payload.start!).toISOString(),
        end: new Date(payload.end!).toISOString(),
      },
    };
  }

  private async dispatchGoogle(payload: OutputPayload): Promise<OutputResult> {
    let client = this.deps.google;
    if (!client) {
      const creds = googleCredsFromEnv();
      if (!creds) throw new Error('Google Calendar creds missing (available() should have refused)');
      client = new GoogleCalendarClient(creds);
    }
    const created = await client.createEvent({
      title: payload.title!,
      start: new Date(payload.start!).toISOString(),
      end: new Date(payload.end!).toISOString(),
      location: payload.location,
      notes: payload.body,
    });
    return {
      id: created.id,
      url: created.url,
      deliveredAt: Date.now(),
      receipt: {
        backend: 'google',
        title: payload.title,
        start: new Date(payload.start!).toISOString(),
        end: new Date(payload.end!).toISOString(),
      },
    };
  }
}
