/**
 * Resolve untrusted Parley session assertions into daemon-selected participant
 * identity and delivery evidence.
 *
 * This module is intentionally local-only. Relay v2 may project the selected
 * evidence later, but it must not become a fallback identity source.
 */

import type { ActorId } from './actor-souls.js';
import type { LiveActorInboxResolution } from './agents.js';

export const MAX_PARLEY_IDENTITY_PARTICIPANTS = 32;
const MAX_PARLEY_IDENTITY_CHARS = 128;
const MAX_PARLEY_LINEAGE_DEPTH = 64;

export interface ExactSessionSuccessors {
  success: true;
  /** Proves this was an exact index lookup, not a capped generic list scan. */
  complete: true;
  sessions: unknown[];
}

export interface ParleyIdentitySessionSource {
  get(sessionId: string): unknown;
  findSuccessors(sessionId: string): ExactSessionSuccessors | { success: false; error?: string };
}

export interface ParleyIdentityInboxSource {
  resolveLiveActorInbox(actorId: string, harbor: string): LiveActorInboxResolution;
}

export interface ParleyParticipantIdentity {
  actorId: ActorId;
  harbor: string;
  inboxTarget: string;
  lineageRootSessionId: string;
  /** The caller assertion is evidence only and grants no actor or inbox authority. */
  asserted: {
    sessionId: string;
  };
  /** Persist this daemon-selected evidence separately from the assertion. */
  selected: {
    sessionId: string;
    actorId: ActorId;
    harbor: string;
    inboxTarget: string;
    inboxBoundAt: number;
    inboxLastHeartbeat: number;
  };
}

export type ParleyParticipantIdentityResolution =
  | { ok: true; participants: ParleyParticipantIdentity[] }
  | { ok: false; code: string; error: string; sessionId?: string };

interface VerifiedSessionEvidence {
  id: string;
  status: string;
  actorId: ActorId;
  predecessorSessionId: string | null;
  inboxStamp: {
    actorId: ActorId;
    harbor: string;
    inboxTarget: string;
  } | null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function record(value: unknown): Record<string, unknown> | null {
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

function boundedIdentity(value: string): boolean {
  return value.length <= MAX_PARLEY_IDENTITY_CHARS;
}

function readVerifiedSession(
  sessions: ParleyIdentitySessionSource,
  requestedSessionId: string,
):
  | { ok: true; evidence: VerifiedSessionEvidence }
  | { ok: false; code: string; error: string; sessionId: string } {
  let lookup: unknown;
  try {
    lookup = sessions.get(requestedSessionId);
  } catch {
    return {
      ok: false,
      code: 'PARLEY_SESSION_LOOKUP_FAILED',
      error: `session '${requestedSessionId}' could not be read`,
      sessionId: requestedSessionId,
    };
  }

  const result = record(lookup);
  const session = result?.success === true ? record(result.session) : null;
  if (!session) {
    return {
      ok: false,
      code: 'PARLEY_SESSION_NOT_FOUND',
      error: `session '${requestedSessionId}' was not found`,
      sessionId: requestedSessionId,
    };
  }

  const id = nonEmptyString(session.id);
  if (id !== requestedSessionId) {
    return {
      ok: false,
      code: 'PARLEY_SESSION_EVIDENCE_MISMATCH',
      error: `session lookup for '${requestedSessionId}' returned mismatched evidence`,
      sessionId: requestedSessionId,
    };
  }

  const metadata = record(session.metadata) ?? {};
  const identity = record(metadata.identity);
  const actorId = identity?.verified === true ? nonEmptyString(identity.actorId) : null;
  if (!actorId) {
    return {
      ok: false,
      code: 'PARLEY_SESSION_IDENTITY_UNVERIFIED',
      error: `session '${requestedSessionId}' has no daemon-verified actor identity`,
      sessionId: requestedSessionId,
    };
  }
  if (!boundedIdentity(actorId)) {
    return {
      ok: false,
      code: 'PARLEY_SESSION_IDENTITY_OVERSIZE',
      error: `session '${requestedSessionId}' actor identity exceeds ${MAX_PARLEY_IDENTITY_CHARS} characters`,
      sessionId: requestedSessionId,
    };
  }

  const status = nonEmptyString(session.status);
  if (!status) {
    return {
      ok: false,
      code: 'PARLEY_SESSION_STATUS_INVALID',
      error: `session '${requestedSessionId}' has no durable status`,
      sessionId: requestedSessionId,
    };
  }

  let predecessorSessionId: string | null = null;
  if (Object.prototype.hasOwnProperty.call(metadata, 'predecessorSessionId')) {
    predecessorSessionId = nonEmptyString(metadata.predecessorSessionId);
    if (!predecessorSessionId || !boundedIdentity(predecessorSessionId)) {
      return {
        ok: false,
        code: 'PARLEY_LINEAGE_INVALID',
        error: `session '${requestedSessionId}' has an invalid predecessor reference`,
        sessionId: requestedSessionId,
      };
    }
  }

  const rawInbox = record(metadata.actorInbox);
  let inboxStamp: VerifiedSessionEvidence['inboxStamp'] = null;
  if (rawInbox?.verified === true) {
    const stampActorId = nonEmptyString(rawInbox.actorId);
    const harbor = nonEmptyString(rawInbox.harbor);
    const inboxTarget = nonEmptyString(rawInbox.inboxTarget);
    if (
      !stampActorId
      || !harbor
      || !inboxTarget
      || !boundedIdentity(stampActorId)
      || !boundedIdentity(harbor)
      || !boundedIdentity(inboxTarget)
    ) {
      return {
        ok: false,
        code: 'PARLEY_INBOX_BINDING_INVALID',
        error: `session '${requestedSessionId}' has malformed actor inbox evidence`,
        sessionId: requestedSessionId,
      };
    }
    inboxStamp = {
      actorId: stampActorId as ActorId,
      harbor,
      inboxTarget,
    };
  }

  return {
    ok: true,
    evidence: {
      id,
      status,
      actorId: actorId as ActorId,
      predecessorSessionId,
      inboxStamp,
    },
  };
}

function verifySessionScope(
  evidence: VerifiedSessionEvidence,
  expectedHarbor: string,
): { ok: true } | { ok: false; code: string; error: string; sessionId: string } {
  const stamp = evidence.inboxStamp;
  if (!stamp) {
    return {
      ok: false,
      code: 'PARLEY_SESSION_HARBOR_UNVERIFIED',
      error: `session '${evidence.id}' has no daemon-selected harbor/inbox evidence`,
      sessionId: evidence.id,
    };
  }
  if (stamp.actorId !== evidence.actorId || stamp.inboxTarget !== evidence.actorId) {
    return {
      ok: false,
      code: 'PARLEY_INBOX_BINDING_MISMATCH',
      error: `session '${evidence.id}' attempts to substitute another actor inbox`,
      sessionId: evidence.id,
    };
  }
  if (stamp.harbor !== expectedHarbor) {
    return {
      ok: false,
      code: 'PARLEY_HARBOR_MISMATCH',
      error: `session '${evidence.id}' belongs to harbor '${stamp.harbor}', not '${expectedHarbor}'`,
      sessionId: evidence.id,
    };
  }
  return { ok: true };
}

function findLineageRoot(
  sessions: ParleyIdentitySessionSource,
  leaf: VerifiedSessionEvidence,
  expectedHarbor: string,
): { ok: true; sessionId: string } | { ok: false; code: string; error: string; sessionId: string } {
  const visited = new Set<string>();
  let current = leaf;
  for (let depth = 0; depth < MAX_PARLEY_LINEAGE_DEPTH; depth += 1) {
    if (visited.has(current.id)) {
      return {
        ok: false,
        code: 'PARLEY_LINEAGE_CYCLE',
        error: `session lineage for '${leaf.id}' contains a cycle at '${current.id}'`,
        sessionId: current.id,
      };
    }
    visited.add(current.id);
    if (!current.predecessorSessionId) return { ok: true, sessionId: current.id };
    const predecessor = readVerifiedSession(sessions, current.predecessorSessionId);
    if (!predecessor.ok) return predecessor;
    const predecessorScope = verifySessionScope(predecessor.evidence, expectedHarbor);
    if (!predecessorScope.ok) return predecessorScope;
    if (predecessor.evidence.actorId !== leaf.actorId) {
      return {
        ok: false,
        code: 'PARLEY_LINEAGE_ACTOR_MISMATCH',
        error: `session lineage for '${leaf.id}' crosses actor authority at '${predecessor.evidence.id}'`,
        sessionId: predecessor.evidence.id,
      };
    }
    current = predecessor.evidence;
  }
  return {
    ok: false,
    code: 'PARLEY_LINEAGE_TOO_DEEP',
    error: `session lineage for '${leaf.id}' exceeds ${MAX_PARLEY_LINEAGE_DEPTH} records`,
    sessionId: leaf.id,
  };
}

function selectLiveSuccessor(
  sessions: ParleyIdentitySessionSource,
  asserted: VerifiedSessionEvidence,
  expectedHarbor: string,
):
  | { ok: true; selected: VerifiedSessionEvidence }
  | { ok: false; code: string; error: string; sessionId: string } {
  const visited = new Set<string>();
  let current = asserted;
  for (let depth = 0; depth < MAX_PARLEY_LINEAGE_DEPTH; depth += 1) {
    if (visited.has(current.id)) {
      return {
        ok: false,
        code: 'PARLEY_SUCCESSOR_CYCLE',
        error: `successor lineage for '${asserted.id}' contains a cycle at '${current.id}'`,
        sessionId: current.id,
      };
    }
    visited.add(current.id);

    let lookup: ReturnType<ParleyIdentitySessionSource['findSuccessors']>;
    try {
      lookup = sessions.findSuccessors(current.id);
    } catch {
      return {
        ok: false,
        code: 'PARLEY_SUCCESSOR_INDEX_UNAVAILABLE',
        error: `exact successor evidence for '${current.id}' could not be read`,
        sessionId: current.id,
      };
    }
    if (lookup.success !== true || lookup.complete !== true || !Array.isArray(lookup.sessions)) {
      return {
        ok: false,
        code: 'PARLEY_SUCCESSOR_INDEX_UNAVAILABLE',
        error: `exact successor evidence for '${current.id}' is unavailable; capped session scans are not authoritative`,
        sessionId: current.id,
      };
    }

    const successors: VerifiedSessionEvidence[] = [];
    const successorIds = new Set<string>();
    for (const raw of lookup.sessions) {
      const rawSession = record(raw);
      const successorId = nonEmptyString(rawSession?.id)
        ?? nonEmptyString(record(rawSession?.session)?.id);
      if (!successorId) {
        return {
          ok: false,
          code: 'PARLEY_SUCCESSOR_EVIDENCE_INVALID',
          error: `successor evidence for '${current.id}' has no session id`,
          sessionId: current.id,
        };
      }
      const successor = readVerifiedSession(sessions, successorId);
      if (!successor.ok) return successor;
      const successorScope = verifySessionScope(successor.evidence, expectedHarbor);
      if (!successorScope.ok) return successorScope;
      if (successor.evidence.predecessorSessionId !== current.id) {
        return {
          ok: false,
          code: 'PARLEY_SUCCESSOR_EVIDENCE_INVALID',
          error: `session '${successorId}' is not a direct successor of '${current.id}'`,
          sessionId: successorId,
        };
      }
      if (successor.evidence.actorId !== asserted.actorId) {
        return {
          ok: false,
          code: 'PARLEY_LINEAGE_ACTOR_MISMATCH',
          error: `successor lineage for '${asserted.id}' crosses actor authority at '${successorId}'`,
          sessionId: successorId,
        };
      }
      if (!successorIds.has(successorId)) {
        successorIds.add(successorId);
        successors.push(successor.evidence);
      }
    }

    if (successors.length > 1) {
      return {
        ok: false,
        code: 'PARLEY_SUCCESSOR_AMBIGUOUS',
        error: `session '${current.id}' has ${successors.length} verified successors; refusing to guess`,
        sessionId: current.id,
      };
    }
    if (successors.length === 0) {
      if (current.status !== 'active') {
        return {
          ok: false,
          code: 'PARLEY_SUCCESSOR_STALE',
          error: `historical session '${asserted.id}' has no live verified successor`,
          sessionId: current.id,
        };
      }
      return { ok: true, selected: current };
    }
    current = successors[0];
  }

  return {
    ok: false,
    code: 'PARLEY_LINEAGE_TOO_DEEP',
    error: `successor lineage for '${asserted.id}' exceeds ${MAX_PARLEY_LINEAGE_DEPTH} records`,
    sessionId: asserted.id,
  };
}

/**
 * Convert caller-asserted session ids into tenant-scoped, live participants.
 */
export function resolveParleyParticipantIdentities(
  sessionIds: unknown,
  sessions: ParleyIdentitySessionSource,
  inboxes: ParleyIdentityInboxSource,
  options: { harbor?: unknown },
): ParleyParticipantIdentityResolution {
  const expectedHarbor = nonEmptyString(options.harbor);
  if (!expectedHarbor) {
    return {
      ok: false,
      code: 'PARLEY_HARBOR_SCOPE_REQUIRED',
      error: 'Parley participant identity requires a server-selected harbor scope',
    };
  }
  if (!boundedIdentity(expectedHarbor)) {
    return {
      ok: false,
      code: 'PARLEY_HARBOR_SCOPE_INVALID',
      error: `Parley harbor scope exceeds ${MAX_PARLEY_IDENTITY_CHARS} characters`,
    };
  }
  if (!Array.isArray(sessionIds)) {
    return { ok: false, code: 'PARLEY_SESSION_IDS_REQUIRED', error: 'sessionIds[] is required' };
  }
  if (sessionIds.length < 2) {
    return { ok: false, code: 'PARLEY_PARTICIPANTS_TOO_FEW', error: 'at least two sessionIds are required' };
  }
  if (sessionIds.length > MAX_PARLEY_IDENTITY_PARTICIPANTS) {
    return {
      ok: false,
      code: 'PARLEY_PARTICIPANTS_LIMIT',
      error: `at most ${MAX_PARLEY_IDENTITY_PARTICIPANTS} sessionIds are allowed`,
    };
  }

  const normalized: string[] = [];
  const assertedIds = new Set<string>();
  for (const raw of sessionIds) {
    const sessionId = nonEmptyString(raw);
    if (!sessionId || !boundedIdentity(sessionId)) {
      return {
        ok: false,
        code: sessionId ? 'PARLEY_SESSION_ID_OVERSIZE' : 'PARLEY_SESSION_ID_INVALID',
        error: `every sessionIds entry must be a non-empty string of at most ${MAX_PARLEY_IDENTITY_CHARS} characters`,
        sessionId: sessionId ?? undefined,
      };
    }
    if (assertedIds.has(sessionId)) {
      return {
        ok: false,
        code: 'PARLEY_SESSION_DUPLICATE',
        error: `session '${sessionId}' was supplied more than once`,
        sessionId,
      };
    }
    assertedIds.add(sessionId);
    normalized.push(sessionId);
  }

  const participants: ParleyParticipantIdentity[] = [];
  const actorIds = new Set<string>();
  const inboxTargets = new Set<string>();
  for (const assertedSessionId of normalized) {
    const asserted = readVerifiedSession(sessions, assertedSessionId);
    if (!asserted.ok) return asserted;
    const assertedScope = verifySessionScope(asserted.evidence, expectedHarbor);
    if (!assertedScope.ok) return assertedScope;
    const root = findLineageRoot(sessions, asserted.evidence, expectedHarbor);
    if (!root.ok) return root;
    const successor = selectLiveSuccessor(sessions, asserted.evidence, expectedHarbor);
    if (!successor.ok) return successor;
    const selected = successor.selected;
    const stamp = selected.inboxStamp;
    // Defensive typed invariant: every row was scope-checked above, but never
    // turn malformed daemon evidence into an exception or compatibility path.
    if (!stamp) {
      return {
        ok: false,
        code: 'PARLEY_SESSION_HARBOR_UNVERIFIED',
        error: `selected session '${selected.id}' has no daemon-selected harbor/inbox evidence`,
        sessionId: selected.id,
      };
    }

    const live = inboxes.resolveLiveActorInbox(selected.actorId, expectedHarbor);
    if (!live.success) {
      return {
        ok: false,
        code: live.code === 'ACTOR_INBOX_STALE' ? 'PARLEY_INBOX_STALE' : 'PARLEY_INBOX_UNBOUND',
        error: live.error,
        sessionId: selected.id,
      };
    }
    if (
      live.binding.actorId !== selected.actorId
      || live.binding.harbor !== expectedHarbor
      || live.binding.inboxTarget !== stamp.inboxTarget
    ) {
      return {
        ok: false,
        code: 'PARLEY_INBOX_BINDING_MISMATCH',
        error: `selected session '${selected.id}' does not match the live actor inbox registry`,
        sessionId: selected.id,
      };
    }
    if (actorIds.has(selected.actorId)) {
      return {
        ok: false,
        code: 'PARLEY_ACTOR_DUPLICATE',
        error: `multiple asserted sessions select actor '${selected.actorId}'`,
        sessionId: assertedSessionId,
      };
    }
    if (inboxTargets.has(live.binding.inboxTarget)) {
      return {
        ok: false,
        code: 'PARLEY_INBOX_DUPLICATE',
        error: `multiple actors select inbox '${live.binding.inboxTarget}'`,
        sessionId: assertedSessionId,
      };
    }
    actorIds.add(selected.actorId);
    inboxTargets.add(live.binding.inboxTarget);
    participants.push({
      actorId: selected.actorId,
      harbor: expectedHarbor,
      inboxTarget: live.binding.inboxTarget,
      lineageRootSessionId: root.sessionId,
      asserted: { sessionId: assertedSessionId },
      selected: {
        sessionId: selected.id,
        actorId: selected.actorId,
        harbor: expectedHarbor,
        inboxTarget: live.binding.inboxTarget,
        inboxBoundAt: live.binding.boundAt,
        inboxLastHeartbeat: live.binding.lastHeartbeat,
      },
    });
  }

  return { ok: true, participants };
}
