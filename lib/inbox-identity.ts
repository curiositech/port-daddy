/**
 * lib/inbox-identity.ts — the strict sender gate for the agent inbox plane
 * (#8877 / ADR-0122; the deferral recorded in
 * docs/security/identity-write-boundary-audit.md).
 *
 * ════════════════════════════════════════════════════════════════════════════
 *  WHY THE INBOX NEEDS ITS OWN GATE AND NOT JUST THE LOCKS ONE
 * ════════════════════════════════════════════════════════════════════════════
 * The audit filed the inbox under "display plane: `from` is unverified". That
 * classification is wrong, and it is why this was deferred. `from` is not a
 * display string — `lib/fleet-engine.ts` writes it into the prompt of a
 * spawned code-editing agent as the `- sender:` line, directly above the
 * message and above "Take one bounded pass in response to this trigger". An
 * unverified `from` is a FORGED AUTHORITY LABEL ON AN EXECUTED INSTRUCTION.
 *
 * The obvious fix — copy `routes/locks.ts` and hand the asserted name to
 * `resolveWriteIdentity({ assertedAgentId })` — does NOT close the hole.
 * That check only rejects a name that resolves to a DIFFERENT minted soul
 * (`resolved.soulClass !== 'unknown'`). A name that was NEVER MINTED sails
 * through and becomes the record's attribution. Every `from` string in
 * production use today ('fleet-ui', 'mcp-user', 'suggestion-broker',
 * 'system-test', tutorial ids) is un-minted, so a locks-shaped gate would
 * admit all of them verbatim. Proof lives in the suite
 * tests/unit/inbox-identity-boundary.test.js ("a NEVER-MINTED from string").
 *
 * The pattern that does reject an unknown name is `routes/commitments.ts`'s:
 * resolve the asserted id and require it to land on the credential's own
 * soul. But applied naively that 403s every real `pd inbox send`, because
 * `POST /sugar/begin` deliberately does NOT bind the alias
 * (routes/sugar.ts — identities like "proj:node:dev" are shared display
 * strings across a fleet, and binding one would lock every other legitimate
 * agent out). So `resolveActor('my-agent-id')` is 'unknown' for every agent
 * that got its soul from `pd begin`.
 *
 * The way out is the SESSION BINDING: `pd begin` stamps the daemon's identity
 * verdict into the session row's metadata, and the session row also carries
 * the display `agentId`. That is an existing, daemon-witnessed mapping from
 * display agentId → minted soul, and no caller can write it. So a sender may
 * claim a `from` when EITHER
 *
 *   (a) the name resolves through the souls store to the caller's own soul
 *       (a bound alias, or the actorId itself), OR
 *   (b) an ACTIVE session for that display agentId carries the caller's own
 *       minted actorId in its identity stamp.
 *
 * Anything else is 403 INBOX_FROM_MISMATCH, and a request with no `from` at
 * all is attributed to the credential's actorId — server-derived, never
 * forgeable. There is no anonymous state: `requireIdentity: true`.
 *
 * This EXTENDS lib/identity-write-boundary.ts rather than inventing a
 * parallel credential scheme — the credential format, verification and alias
 * resolution are ADR-0040's, unchanged.
 */

import {
  extractActorCredential,
  resolveWriteIdentity,
  type IdentityVerifier,
  type IdentityWriteVerdict,
} from './identity-write-boundary.js';
import { resolveSessionSoul, type SessionBindingLookup } from './agent-soul-binding.js';

/** The verified half of a write verdict — the only success shape this gate returns. */
export type VerifiedWriteVerdict = Extract<IdentityWriteVerdict, { ok: true; kind: 'verified' }>;

/** The subset of the sessions manager the binding lookup needs. */
export interface InboxSessionLookup extends SessionBindingLookup {
  activeSessionIdsByAgent(agentId: string): string[];
  get(sessionId: string): { success: boolean; session?: unknown };
}

/** Structured logger shape (matches the daemon's route logger). */
export interface InboxIdentityLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

/** A rejected gate call: the HTTP status plus the body the route should send. */
export interface InboxIdentityRejection {
  success: false;
  httpStatus: number;
  result: { success: false; error: string; code: string };
}

/** An accepted sender: the verdict plus the sender fields the route persists. */
export interface InboxSenderVerdict {
  success: true;
  verdict: VerifiedWriteVerdict;
  /** Display attribution for the message (`agent_inbox.from_agent`). */
  from: string;
  /** The daemon's verified principal (`agent_inbox.from_actor_id`). */
  fromActorId: string;
  /** The verified principal's class (`agent_inbox.from_soul_class`). */
  fromSoulClass: string;
}

/**
 * Read the minted actorId that an ACTIVE session binds to a display agentId.
 *
 * This is the daemon-witnessed half of the sender rule (branch (b) in the
 * module header). `pd begin` writes the identity verdict into the session's
 * metadata through `stampIdentityMetadata`, which reserves the `identity`
 * key for the daemon — a request body can never pre-fill it. Reading it back
 * is therefore a trustworthy display-agentId → soul mapping, and it is the
 * only one that exists for agents minted through `POST /sugar/begin` (which
 * deliberately binds no alias).
 *
 * Only ACTIVE sessions count: a completed or abandoned session must not keep
 * granting its agentId to whoever held it, or a dead agent's display name
 * becomes a permanent forging handle.
 *
 * @param sessions - The sessions manager (or null when not wired).
 * @param agentId - The display agent id being claimed.
 * @returns The minted actorId bound to that display id, or null when no
 *          active session carries a verified stamp for it.
 */
export function resolveAgentSoul(
  sessions: InboxSessionLookup | null | undefined,
  agentId: string,
): string | null {
  // ACTIVE sessions only. This is a live authorization question ("may this
  // caller send as this name right now?"), so a completed session must not
  // leave its agentId behind as a permanent forging handle. The reaper asks
  // the historical version of this question and passes includeClosed — see
  // lib/agent-soul-binding.ts.
  return resolveSessionSoul(sessions, agentId, { includeClosed: false });
}

export interface InboxIdentityDeps {
  souls?: IdentityVerifier | null;
  sessions?: InboxSessionLookup | null;
  logger?: InboxIdentityLogger;
}

/**
 * Build the inbox plane's identity gate.
 *
 * One factory shared by `routes/agents.ts` (POST /agents/:id/inbox) and
 * `routes/actors.ts` (POST /actors/:id/message) so the two doors into the
 * same `agent_inbox` table cannot drift — credentialing only one of them is
 * bypassable in a single line of curl.
 *
 * @param deps - The souls store, the sessions manager, and the route logger.
 * @returns The `requireInboxSender` gate.
 */
export function createInboxIdentity(deps: InboxIdentityDeps) {
  const { souls, sessions, logger } = deps;

  /**
   * Resolve the sender a message must be attributed to, rejecting forgery.
   *
   * @param headers - The request headers (credential carrier).
   * @param body - The parsed request body (fallback credential carrier).
   * @param bodyFrom - The caller-supplied `from` field, if any.
   * @param route - Route label for the structured reject logs.
   * @returns The accepted sender, or the status and body to reply with.
   */
  function requireInboxSender(
    headers: Record<string, unknown>,
    body: unknown,
    bodyFrom: unknown,
    route: string,
  ): InboxSenderVerdict | InboxIdentityRejection {
    const verdict = resolveWriteIdentity({
      souls,
      credential: extractActorCredential(headers, body),
      // The asserted name is checked below against BOTH the alias table and
      // the session binding. Handing it to resolveWriteIdentity here would
      // silently admit any never-minted string (see the module header).
      assertedAgentId: null,
      route,
      logger,
      requireIdentity: true,
    });
    if (!verdict.ok) {
      return {
        success: false,
        httpStatus: verdict.httpStatus,
        result: { success: false, error: verdict.error, code: verdict.code },
      };
    }
    // requireIdentity guarantees the success case is `verified`.
    const verified = verdict as VerifiedWriteVerdict;

    const asserted = typeof bodyFrom === 'string' && bodyFrom.trim() ? bodyFrom.trim() : null;
    if (!asserted) {
      // Server-derived attribution: nothing for the caller to forge.
      return {
        success: true,
        verdict: verified,
        from: verified.actorId,
        fromActorId: verified.actorId,
        fromSoulClass: verified.soulClass,
      };
    }

    const resolvedAlias = souls ? souls.resolveActor(asserted).actorId : null;
    const boundBySession = resolveAgentSoul(sessions, asserted);
    if (resolvedAlias !== verified.actorId && boundBySession !== verified.actorId) {
      logger?.error('identity_write_rejected', {
        route,
        code: 'INBOX_FROM_MISMATCH',
        actorId: verified.actorId,
        assertedFrom: asserted,
      });
      return {
        success: false,
        httpStatus: 403,
        result: {
          success: false,
          error: `from "${asserted}" is not a name the presented credential's actor may send under; omit "from" to be attributed automatically, or send under an alias bound to your soul or the agentId of your active session`,
          code: 'INBOX_FROM_MISMATCH',
        },
      };
    }

    return {
      success: true,
      verdict: verified,
      from: asserted,
      fromActorId: verified.actorId,
      fromSoulClass: verified.soulClass,
    };
  }

  return { requireInboxSender };
}

export type InboxIdentity = ReturnType<typeof createInboxIdentity>;
