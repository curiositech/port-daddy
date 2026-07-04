/**
 * Google Calendar v3 client for the fleet calendar channel — the creds-
 * gated backend (PD_GCAL_CLIENT_ID + PD_GCAL_CLIENT_SECRET +
 * PD_GCAL_REFRESH_TOKEN, calendar id via PD_GCAL_CALENDAR_ID, default
 * "primary").
 *
 * agentic-calendar-coordination gates honored here:
 *   - `singleEvents=true` + `orderBy=startTime` on every list: recurring
 *     events arrive as expanded INSTANCES (the classic seasonal-DST
 *     conflict bug comes from skipping this).
 *   - All timestamps cross this boundary as ISO-8601 UTC.
 *   - Data minimization: the list projection keeps id/summary/times/
 *     location/organizer/hangoutLink and DROPS description + attendee
 *     lists before anything reaches agent task text.
 */

export interface GoogleCalendarCreds {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  calendarId: string;
}

export function googleCredsFromEnv(): GoogleCalendarCreds | null {
  const clientId = process.env.PD_GCAL_CLIENT_ID;
  const clientSecret = process.env.PD_GCAL_CLIENT_SECRET;
  const refreshToken = process.env.PD_GCAL_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;
  return {
    clientId,
    clientSecret,
    refreshToken,
    calendarId: process.env.PD_GCAL_CALENDAR_ID || 'primary',
  };
}

interface GoogleEventInstance {
  id: string;
  seriesId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  calendar: string;
  recurring: boolean;
  location?: string;
  organizer?: string;
  conferenceUrl?: string;
}

export class GoogleCalendarClient {
  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;

  constructor(
    private readonly creds: GoogleCalendarCreds,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async token(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt - 60_000) {
      return this.accessToken;
    }
    const res = await this.fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.creds.clientId,
        client_secret: this.creds.clientSecret,
        refresh_token: this.creds.refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });
    if (!res.ok) {
      throw new Error(`Google token refresh failed: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
    }
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.accessToken = body.access_token;
    this.accessTokenExpiresAt = Date.now() + body.expires_in * 1000;
    return this.accessToken;
  }

  async listEvents(fromISO: string, toISO: string): Promise<GoogleEventInstance[]> {
    const token = await this.token();
    const params = new URLSearchParams({
      timeMin: fromISO,
      timeMax: toISO,
      singleEvents: 'true', // expand recurring to instances — load-bearing
      orderBy: 'startTime',
      maxResults: '100',
    });
    const res = await this.fetchImpl(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.creds.calendarId)}/events?${params}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      throw new Error(`Google events.list failed: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
    }
    const body = (await res.json()) as {
      items?: Array<{
        id: string;
        recurringEventId?: string;
        summary?: string;
        status?: string;
        location?: string;
        hangoutLink?: string;
        organizer?: { email?: string };
        start?: { dateTime?: string; date?: string };
        end?: { dateTime?: string; date?: string };
      }>;
    };
    const out: GoogleEventInstance[] = [];
    for (const item of body.items ?? []) {
      if (item.status === 'cancelled') continue;
      const start = item.start?.dateTime ?? (item.start?.date ? `${item.start.date}T00:00:00Z` : null);
      const end = item.end?.dateTime ?? (item.end?.date ? `${item.end.date}T00:00:00Z` : null);
      if (!start || !end) continue;
      out.push({
        id: item.id, // instance ids are already unique with singleEvents=true
        seriesId: item.recurringEventId ?? item.id,
        title: item.summary ?? '',
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        allDay: Boolean(item.start?.date),
        calendar: this.creds.calendarId,
        recurring: Boolean(item.recurringEventId),
        location: item.location,
        organizer: item.organizer?.email,
        conferenceUrl: item.hangoutLink,
      });
    }
    return out;
  }

  async createEvent(input: {
    title: string;
    start: string;
    end: string;
    location?: string;
    notes?: string;
  }): Promise<{ id: string; url?: string }> {
    const token = await this.token();
    const res = await this.fetchImpl(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.creds.calendarId)}/events`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          summary: input.title,
          location: input.location,
          description: input.notes,
          start: { dateTime: new Date(input.start).toISOString(), timeZone: 'UTC' },
          end: { dateTime: new Date(input.end).toISOString(), timeZone: 'UTC' },
        }),
      },
    );
    if (!res.ok) {
      throw new Error(`Google events.insert failed: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
    }
    const body = (await res.json()) as { id: string; htmlLink?: string };
    return { id: body.id, url: body.htmlLink };
  }
}
