/**
 * lib/agent-soul-binding.ts — resolve a DISPLAY agent handle to the minted
 * soul it provably belongs to (ADR-0040 / #8877 / ADR-0122).
 *
 * ════════════════════════════════════════════════════════════════════════════
 *  WHY THIS EXISTS
 * ════════════════════════════════════════════════════════════════════════════
 * `agents.id` is a display handle: uncredentialed, caller-chosen, and
 * auto-created by a single `POST /agents/:id/heartbeat`. `actor_souls.actor_id`
 * is a minted principal. The identity-write-boundary audit's rule is that
 * durable authority must key on the second, never the first — but there is no
 * runtime discriminator between them (`ActorId` is a phantom brand and
 * `asActorId()` is an unchecked cast; `resolveActor()` even returns an
 * un-souled handle branded as an ActorId).
 *
 * So any code that must decide "does this display handle actually belong to
 * that soul?" needs a real lookup. This module supplies the strongest one:
 * the SESSION STAMP — `sessions.metadata.identity.actorId`, written by the
 * daemon through `stampIdentityMetadata` from a verified credential, and
 * never fillable from a request body. A session row bearing `agent_id = H`
 * and a verified stamp for soul S can only exist because someone holding S's
 * credential opened a session under display name H.
 *
 * It deliberately does NOT consult the alias table. An alias answers a weaker
 * question ("does this NAME belong to S?") that is not sufficient for either
 * caller here — see the note on createReaperSoulResolver.
 *
 * Callers differ on which sessions count:
 *   - the inbox sender gate asks "may this caller SEND as this name right
 *     now?" and must use ACTIVE sessions only — a completed session must not
 *     leave its agentId as a permanent forging handle;
 *   - the stale-agent reaper asks "was this dying handle ever an act of that
 *     soul?" and must include closed sessions, because reaping happens after
 *     the session is abandoned.
 */

/** The subset of the sessions manager a binding lookup needs. */
export interface SessionBindingLookup {
  activeSessionIdsByAgent?(agentId: string): string[];
  list?(options: Record<string, unknown>): { sessions?: Array<Record<string, unknown>> } | unknown;
  get?(sessionId: string): { success: boolean; session?: unknown };
}

/**
 * Read a verified minted actorId out of a session record's metadata.
 *
 * @param session - A formatted session record (metadata may be an object or
 *        the raw JSON string, depending on the caller's read path).
 * @returns The stamped actorId, or null when the record carries no verified
 *          stamp.
 */
function stampedActorId(session: unknown): string | null {
  if (!session || typeof session !== 'object') return null;
  let metadata = (session as { metadata?: unknown }).metadata;
  if (typeof metadata === 'string') {
    try {
      metadata = JSON.parse(metadata);
    } catch {
      return null;
    }
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const stamp = (metadata as { identity?: unknown }).identity;
  if (!stamp || typeof stamp !== 'object' || Array.isArray(stamp)) return null;
  const { verified, actorId } = stamp as { verified?: unknown; actorId?: unknown };
  return verified === true && typeof actorId === 'string' && actorId ? actorId : null;
}

/**
 * Collect EVERY minted soul stamped onto a display agentId's sessions.
 *
 * A display agentId is not owned by a single soul: `POST /sugar/begin`
 * deliberately binds no alias, so several honest agents can each open a session
 * under one shared display string (e.g. `proj:node:dev`). Each such session
 * carries its own soul's verified stamp. Membership in THIS set — not "the
 * first stamp found" — is the correct authorization question. Returning only
 * the first stamp both (a) let one shared-agent user lock the others out with a
 * spurious mismatch, and (b) invited trusting a soul the caller does not own.
 *
 * @param sessions - The sessions manager (or null when not wired).
 * @param agentId - The display agent id.
 * @param options.includeClosed - When true, consider sessions of any status,
 *        not just active ones (historical question); when false, ACTIVE only
 *        (live authorization).
 * @returns The set of minted actorIds stamped for that agentId (possibly empty).
 */
function collectStampedActorIds(
  sessions: SessionBindingLookup | null | undefined,
  agentId: string,
  options: { includeClosed?: boolean } = {},
): Set<string> {
  const found = new Set<string>();
  if (!sessions || !agentId) return found;

  if (!options.includeClosed) {
    if (typeof sessions.activeSessionIdsByAgent !== 'function' || typeof sessions.get !== 'function') {
      return found;
    }
    let sessionIds: string[];
    try {
      sessionIds = sessions.activeSessionIdsByAgent(agentId);
    } catch {
      return found;
    }
    for (const sessionId of sessionIds) {
      let record: { success: boolean; session?: unknown };
      try {
        record = sessions.get(sessionId);
      } catch {
        continue;
      }
      if (!record?.success) continue;
      const actorId = stampedActorId(record.session);
      if (actorId) found.add(actorId);
    }
    return found;
  }

  if (typeof sessions.list !== 'function') return found;
  let rows: Array<Record<string, unknown>>;
  try {
    const listed = sessions.list({ agentId, allWorktrees: true, limit: 50 }) as
      { sessions?: Array<Record<string, unknown>> } | undefined;
    rows = Array.isArray(listed?.sessions) ? listed.sessions : [];
  } catch {
    return found;
  }
  for (const row of rows) {
    const actorId = stampedActorId(row);
    if (actorId) found.add(actorId);
  }
  return found;
}

/**
 * Does `actorId` belong to the set of souls stamped onto `agentId`'s sessions?
 *
 * This is the membership test both callers actually need: the inbox sender gate
 * asks "is the CALLER's own soul among the active sessions stamped for this
 * display name?", and the reaper asks "was the lock's stamped soul ever an act
 * of this dying handle?". Both are keyed to a specific actorId, so neither may
 * trust whichever stamp happens to sort first.
 *
 * @param sessions - The sessions manager (or null when not wired).
 * @param agentId - The display agent id.
 * @param actorId - The minted soul whose membership is being tested.
 * @param options.includeClosed - Active-only (false) vs any-status (true).
 * @returns true when `actorId` is stamped on a matching session.
 */
export function sessionSoulIncludes(
  sessions: SessionBindingLookup | null | undefined,
  agentId: string,
  actorId: string,
  options: { includeClosed?: boolean } = {},
): boolean {
  if (!actorId) return false;
  return collectStampedActorIds(sessions, agentId, options).has(actorId);
}

/**
 * Resolve a display agentId to a minted soul through the SESSION stamp.
 *
 * Prefer {@link sessionSoulIncludes} for any authorization decision: this
 * returns an ARBITRARY member of the stamped set (the first found) and so
 * cannot answer "does THIS soul own the name?" when a display string is shared
 * by several souls. It remains for diagnostics and single-soul callers.
 *
 * @param sessions - The sessions manager (or null when not wired).
 * @param agentId - The display agent id.
 * @param options.includeClosed - When true, consider sessions of any status.
 * @returns One bound minted actorId, or null.
 */
export function resolveSessionSoul(
  sessions: SessionBindingLookup | null | undefined,
  agentId: string,
  options: { includeClosed?: boolean } = {},
): string | null {
  for (const actorId of collectStampedActorIds(sessions, agentId, options)) {
    return actorId;
  }
  return null;
}

/**
 * Build the resolver `lib/agents.ts` `cleanup()` uses to decide whether a
 * dying display handle may take a stamped lock with it.
 *
 * ── Why this deliberately does NOT use the alias table ──────────────────
 * The alias binding answers "does this NAME belong to soul S?". The reaper
 * needs to answer something stronger: "was the thing that just died an act
 * of S?". Those come apart, because the row whose staleness triggers the
 * reap is created by an UNCREDENTIALED `POST /agents/:id/heartbeat` (which
 * auto-registers). If the reaper trusted the alias table, an attacker could
 * register an agents row under a name S had bound, stop heartbeating, and the
 * reaper would dutifully resolve the name to S and force-release S's lock —
 * the very hole this is closing, merely one indirection further along.
 *
 * The SESSION stamp does answer the stronger question: a session row bearing
 * `agent_id = H` and a verified stamp for soul S can only exist because
 * someone holding S's credential opened a session under display name H. So
 * the reaper accepts that binding and nothing else.
 *
 * Residual, stated plainly: an attacker can still heartbeat an EXISTING
 * handle into `draining` (a 5-minute dead threshold) to make a legitimate
 * agent's locks be reaped sooner than its TTL. That is a timing attack on
 * the uncredentialed heartbeat plane itself, not a forgery of ownership, and
 * closing it means credentialing heartbeats — a different slice.
 *
 * @param deps.sessions - The sessions manager.
 * @returns A `(agentId, actorId) => boolean` membership predicate that includes
 *          closed sessions (the reaper runs after the session is abandoned) and
 *          tests whether the lock's stamped soul is among the souls that opened
 *          a session under the dying handle — not whichever stamp sorts first,
 *          which for a shared display handle could be a different soul.
 */
export function createReaperSoulResolver(deps: {
  sessions?: SessionBindingLookup | null;
}): (agentId: string, actorId: string) => boolean {
  return (agentId: string, actorId: string) =>
    sessionSoulIncludes(deps.sessions, agentId, actorId, { includeClosed: true });
}
