import type { SessionSummary, StoryNote } from './types';

export interface SessionDetail {
  session: SessionSummary;
  notes: StoryNote[];
}

/**
 * Order retained notes newest first without mutating the daemon response.
 * Design: note IDs break timestamp ties so a refresh cannot shuffle history.
 * @param notes Complete notes from the exact-session endpoint.
 * @returns A stable, newest-first copy.
 */
export function orderSessionNotes(notes: readonly StoryNote[]): StoryNote[] {
  return [...notes].sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);
}

/**
 * Select the latest typed plan, never an inferred checklist in another note.
 * @param notes Complete retained session notes.
 * @returns The newest todo_list or null; absence is not a completed plan.
 */
export function latestSessionPlan(notes: readonly StoryNote[]): StoryNote | null {
  return orderSessionNotes(notes).find((note) => note.type === 'todo_list') ?? null;
}

/**
 * Build an exact, same-dashboard deep link without carrying guessed identity.
 * @param sessionId Explicit Port Daddy session ID, not a native harness ID.
 * @param daemonUrl Explicit selected daemon so copied links keep their source.
 * @returns A relative URL whose only selector is the encoded session ID.
 */
export function sessionDetailHref(sessionId: string, daemonUrl?: string): string {
  const params = new URLSearchParams({ surface: 'agents', session: sessionId });
  if (daemonUrl) params.set('daemon', daemonUrl);
  return `?${params}`;
}

/**
 * Preserve an explicit selector, including an empty invalid value, so a bad
 * link cannot silently open a different session. The sessions alias is a
 * route alias only, not a second product surface or identity resolver.
 * @param params Browser query parameters.
 * @returns The exact requested selector or null when none was requested.
 */
export function requestedSessionId(params: URLSearchParams): string | null {
  return params.has('session') ? params.get('session')! : null;
}

/**
 * Allow only ordinary web evidence links. Notes are untrusted retained text;
 * they cannot execute scripts, open local files, or load background images.
 * @param target Markdown link target.
 * @returns A safe web URL or null (render the original text instead).
 */
export function safeEvidenceHref(target: string): string | null {
  try {
    const url = new URL(target);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Validate the response boundary before any session data reaches the view.
 * Design: even a buggy cache/backend must not retarget an explicit request.
 * @param value Exact-session JSON response.
 * @param sessionId Requested Port Daddy ID.
 * @returns Verified session and complete notes, or throws without fallback.
 */
export function verifySessionDetail(value: unknown, sessionId: string): SessionDetail {
  const data = value as { success?: boolean; session?: SessionSummary; notes?: StoryNote[] } | null;
  if (!data?.success || data.session?.id !== sessionId || !Array.isArray(data.notes)) {
    throw new Error('The daemon did not return the requested session and its complete notes. No other session was selected.');
  }
  if (data.notes.some((note) => note.sessionId !== sessionId || typeof note.content !== 'string'
    || typeof note.type !== 'string' || !Number.isSafeInteger(note.id) || !Number.isFinite(note.createdAt))) {
    throw new Error('The daemon returned invalid or differently attributed notes. No other session was selected.');
  }
  return { session: data.session, notes: data.notes };
}
