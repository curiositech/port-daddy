/**
 * Calendar output sink — creates a new calendar event.
 *
 * Two backends, matching `triggers/calendar.ts`:
 *   - macOS EventKit (default on darwin)
 *   - Google Calendar API (when PD_CALENDAR_BACKEND=google)
 *
 * Both are STUBBED here. Operator setup required:
 *   - macOS: grant Calendar access to the daemon binary
 *   - Google: set PD_GCAL_CLIENT_ID + PD_GCAL_REFRESH_TOKEN +
 *     PD_GCAL_CALENDAR_ID (default "primary")
 *
 * Consent posture:
 *   Writing to the operator's calendar is unambiguously personal data,
 *   so we always run through the consent gate. The first time a fleet
 *   tries to create a calendar event the operator must grant via
 *   `pd fleet consent grant --sink calendar --tier high`.
 */

import { getSharedConsentGate } from '../consent-gate.js';
import type {
  OutputAvailability,
  OutputPayload,
  OutputResult,
  OutputSink,
} from '../types.js';

export class CalendarOutputSink implements OutputSink {
  readonly kind = 'calendar' as const;

  async available(): Promise<OutputAvailability> {
    const backend = chooseBackend();
    if (backend === 'macos-eventkit') {
      return {
        ready: true,
        reason: 'macOS EventKit (requires Calendar access for the daemon binary).',
        requires: ['Calendar access in System Settings → Privacy'],
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

    // Calendar writes always touch PII (event titles, attendees).
    getSharedConsentGate().assertAllowed('calendar', { ...payload, pii: payload.pii ?? 'high' });

    return chooseBackend() === 'google' ? this.dispatchGoogle(payload) : this.dispatchMacOS(payload);
  }

  // ── stubs ──────────────────────────────────────────────────────────────

  /**
   * STUBBED. Real implementation either:
   *   - shells `osascript` to add an event via Calendar.app scripting, or
   *   - calls a small Swift helper around EventKit that we bundle with
   *     the daemon (preferred — survives Calendar.app being closed).
   * For now we acknowledge the call so the rest of the engine can be
   * tested end-to-end without a real calendar.
   */
  private async dispatchMacOS(payload: OutputPayload): Promise<OutputResult> {
    return {
      id: payload.idempotency_key ?? `calendar:macos:${Date.now()}`,
      deliveredAt: Date.now(),
      receipt: { stubbed: true, backend: 'macos-eventkit', title: payload.title, start: payload.start, end: payload.end },
    };
  }

  /**
   * STUBBED. Real implementation:
   *   1. Exchange PD_GCAL_REFRESH_TOKEN for an access token (1h TTL,
   *      cache in memory).
   *   2. POST https://www.googleapis.com/calendar/v3/calendars/<calendarId>/events
   *      with { summary, start.dateTime, end.dateTime, location, description }.
   *   3. Persist the returned event id so a retry can de-dupe.
   */
  private async dispatchGoogle(payload: OutputPayload): Promise<OutputResult> {
    return {
      id: payload.idempotency_key ?? `calendar:google:${Date.now()}`,
      url: `https://calendar.google.com/calendar/u/0/r/eventedit#stub`,
      deliveredAt: Date.now(),
      receipt: { stubbed: true, backend: 'google', title: payload.title, start: payload.start, end: payload.end },
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
