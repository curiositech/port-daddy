/**
 * Caches the Port Daddy coordination session this MCP server process
 * established via `begin_session`, so session-scoped tool calls
 * (`add_note`, `claim_files`, ...) don't require the caller to re-supply
 * `session_id`/`agent_id` on every single call.
 *
 * Why this is the right shape here: `mcp/server.ts` runs over
 * `StdioServerTransport`, which is already a 1:1 process-per-client
 * transport — there is no MCP-protocol multi-session concern to solve
 * (contrast `StreamableHTTPServerTransport`, which maps an
 * `mcp-session-id` header to a transport instance because one HTTP
 * server multiplexes many client connections). Port Daddy's "session" is
 * a daemon-side coordination object, not an MCP-protocol session — but
 * the underlying principle is the same one that pattern uses: establish
 * once, cache server-side, stop asking the caller to keep re-supplying an
 * identifier that hasn't changed since the last call.
 *
 * Before this: an agent that called `begin_session` successfully still
 * had to pass `session_id` on every subsequent `add_note`/`claim_files`/
 * etc. call, or the daemon fell back to guessing "the most recent active
 * session in this worktree" — which throws `AMBIGUOUS_ACTIVE_SESSION`
 * the moment more than one session is active, even though the calling
 * agent's own session id was sitting right there in `begin_session`'s
 * response a few tool calls ago.
 */

export interface ActiveSession {
  agentId: string;
  sessionId: string;
  /**
   * The ADR-0040 daemon-minted actor credential `begin_session` returned
   * (minted once for this process's soul). Every subsequent attributed write
   * (#8877 / ADR-0122 — add_note, claim_files, locks, salvage, done) must
   * present it as the `x-actor-credential` header; the MCP HTTP helper reads
   * it from here.
   */
  credential?: string;
}

let active: ActiveSession | null = null;

/** Record the session this process is now attached to (call on begin_session success). */
export function setActiveSession(session: ActiveSession): void {
  active = session;
}

/** Forget the cached session (call on end_session_full success). */
export function clearActiveSession(): void {
  active = null;
}

/** The session this process is currently attached to, if any. */
export function getActiveSession(): ActiveSession | null {
  return active;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/**
 * Resolve a session id for a tool call: an explicit `args.session_id`
 * always wins (a caller acting on another agent's session is a normal,
 * intentional case); otherwise fall back to this process's cached session.
 */
export function resolveSessionId(args: Record<string, unknown>): string | undefined {
  return nonEmptyString(args.session_id) ?? active?.sessionId;
}

/** Same resolution rule as {@link resolveSessionId}, for agent ids. */
export function resolveAgentId(args: Record<string, unknown>): string | undefined {
  return nonEmptyString(args.agent_id) ?? active?.agentId;
}

/**
 * The actor credential this process should present on daemon writes.
 *
 * Resolution order: the credential captured from this process's own
 * `begin_session` (the common case — begin mints and returns it once), then
 * the PORT_DADDY_ACTOR_CREDENTIAL env var (a harness that pre-registered via
 * POST /actors/register and injected the credential). Returns undefined when
 * neither exists — attributed writes will then be rejected 401 by the daemon
 * (#8877 / ADR-0122), which is the correct fail-closed outcome.
 */
export function resolveActorCredential(): string | undefined {
  return active?.credential ?? nonEmptyString(process.env.PORT_DADDY_ACTOR_CREDENTIAL);
}
