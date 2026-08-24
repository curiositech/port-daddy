/**
 * Keep Sugar's human-facing semantic identity separate from the ADR-0092 room
 * key used to replicate its session rows.
 *
 * A Fleet actor such as `fleet:run-123` has semantic project `fleet`, while
 * the room is scoped to the verified repository (`owner/repository`). The
 * coordination peer snapshots only rows in that exact room. This facade makes
 * Sugar persist starts/takeovers under the room project and projects the
 * semantic project back only while Sugar performs its idempotent resume scan.
 * The underlying sessions service remains unchanged for routes, replication,
 * and every non-coordination daemon.
 */

import { parseIdentity } from './identity.js';

type SessionRecord = Record<string, unknown>;

interface SessionsLike {
  start(purpose: string, options?: Record<string, unknown>): Record<string, unknown>;
  list(options?: Record<string, unknown>): Record<string, unknown>;
  takeover?(sessionId: string, options?: Record<string, unknown>): Record<string, unknown>;
  [key: string]: unknown;
}

function metadataRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function semanticProject(session: SessionRecord): string | null {
  const metadata = metadataRecord(session.metadata);
  const identity = typeof metadata?.semanticIdentity === 'string'
    ? metadata.semanticIdentity
    : typeof metadata?.identity === 'string'
      ? metadata.identity
      : null;
  if (!identity) return null;
  const parsed = parseIdentity(identity);
  return parsed.valid ? parsed.project : null;
}

function projectResumeRows(result: Record<string, unknown>, roomProject: string): Record<string, unknown> {
  if (!Array.isArray(result.sessions)) return result;
  return {
    ...result,
    sessions: result.sessions.map((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
      const session = value as SessionRecord;
      if (session.identityProject !== roomProject) return session;
      const project = semanticProject(session);
      return project ? { ...session, identityProject: project } : session;
    }),
  };
}

/**
 * Scope only the Sugar-facing sessions API to an enabled coordination room.
 * Null means coordination is disabled and returns the original API by identity.
 */
export function scopeSugarSessionsToCoordinationProject<T extends SessionsLike>(
  sessions: T,
  roomProject: string | null,
): T {
  if (!roomProject) return sessions;

  return new Proxy(sessions, {
    get(target, property, receiver) {
      if (property === 'start') {
        return (purpose: string, options: Record<string, unknown> = {}) =>
          target.start(purpose, { ...options, project: roomProject });
      }
      if (property === 'takeover' && typeof target.takeover === 'function') {
        return (sessionId: string, options: Record<string, unknown> = {}) =>
          target.takeover!(sessionId, { ...options, project: roomProject });
      }
      if (property === 'list') {
        return (options?: Record<string, unknown>) =>
          projectResumeRows(target.list(options), roomProject);
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
