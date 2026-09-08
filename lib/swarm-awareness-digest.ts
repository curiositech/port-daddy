/**
 * Swarm-awareness digest: the MCP-boundary compaction layer for the
 * `swarm_awareness` / `active_agent_roster` tools.
 *
 * The `/agent-roster` HTTP endpoint is a full-fidelity surface (FleetBar and
 * Control Center render every field of it). An MCP tool result is not: it has
 * to land inside a calling agent's context window, and harnesses hard-fail
 * tool results past ~25k tokens. In production we observed a single
 * swarm_awareness call return 256K characters across 5,792 lines — full squid
 * provider matrices, complete note bodies, and one agent carrying 120 file
 * claims, all pretty-printed. That is a broken contract at the most basic
 * level.
 *
 * This module fixes the contract in two stages:
 *
 *  1. **Shape** — {@link digestSwarmRoster} maps each roster item to only what
 *     an agent needs for awareness: who, what, where, how fresh, which files.
 *     Squid conformance collapses to `{level, score}`; notes collapse to a
 *     count plus one truncated latest note; file claims collapse to capped
 *     path lists.
 *  2. **Budget** — {@link serializeSwarmDigest} enforces a hard character
 *     ceiling on the serialized output, dropping least-alive agents from the
 *     tail until it fits. Compact JSON, never pretty-printed.
 *
 * Every cap is explicit: dropped agents, claims, and notes are surfaced as
 * `omittedAgents` / `omittedClaims` / `noteCount` counters so truncation never
 * masquerades as completeness.
 */

/** Tunables for digest shaping and the serialized-output budget. */
export interface SwarmDigestOptions {
  /** Most agents to include before tail-dropping. Default 25. */
  maxAgents?: number;
  /** Most claimed file paths listed per agent. Default 8. */
  maxClaimsPerAgent?: number;
  /** Longest latest-note excerpt per agent, in characters. Default 240. */
  maxNoteChars?: number;
  /**
   * Hard ceiling on the serialized digest, in characters. Default 30,000
   * (~7.5k tokens) — far under every harness's tool-result cap.
   */
  maxOutputChars?: number;
}

const DEFAULTS: Required<SwarmDigestOptions> = {
  maxAgents: 25,
  maxClaimsPerAgent: 8,
  maxNoteChars: 240,
  maxOutputChars: 30_000,
};

/** One agent's awareness-relevant slice of the full roster item. */
export interface SwarmDigestAgent {
  id: string;
  label: string | null;
  purpose: string | null;
  identity: string | null;
  project: string | null;
  status: string | null;
  liveness: string;
  lastHeartbeat: number | null;
  harness: { label: string | null; backend: string | null; model: string | null } | null;
  worktree: { branch: string | null; name: string | null } | null;
  squid: { level: string | null; score: number | null } | null;
  session: {
    id: string;
    purpose: string | null;
    phase: string | null;
    updatedAt: number | null;
    noteCount: number;
    latestNote: string | null;
  } | null;
  claimedFiles: string[];
  omittedClaims: number;
  steeringChannel: string | null;
}

/** The complete digest returned to the calling agent. */
export interface SwarmDigest {
  success: true;
  generatedAt: number;
  project: string | null;
  /** True total in the roster, before any capping. */
  totalAgents: number;
  /** Agents dropped to honor maxAgents and/or the output budget. */
  omittedAgents: number;
  squidSummary: Record<string, number> | null;
  agents: SwarmDigestAgent[];
  note: string;
}

type AnyRecord = Record<string, unknown>;

function rec(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as AnyRecord) : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}… [truncated]`;
}

const LIVENESS_ORDER: Record<string, number> = { alive: 0, stale: 1, dead: 2 };

/**
 * Extract the freshest note text from a session record's `notes` array.
 * Notes arrive newest-last from the roster builder; fall back gracefully on
 * unknown shapes.
 */
function latestNoteText(notes: unknown, maxChars: number): { text: string | null; count: number } {
  if (!Array.isArray(notes) || notes.length === 0) return { text: null, count: 0 };
  const last = rec(notes[notes.length - 1]);
  const body = str(last?.content) ?? str(last?.message) ?? str(last?.text);
  return { text: body ? truncate(body, maxChars) : null, count: notes.length };
}

function digestAgent(item: AnyRecord, opts: Required<SwarmDigestOptions>): SwarmDigestAgent {
  const harness = rec(item.harness);
  const worktree = rec(item.worktree);
  const squid = rec(item.squid);
  const session = rec(item.activeSession);
  const control = rec(item.control);

  const claims = Array.isArray(item.touchedFiles) ? item.touchedFiles : [];
  const claimedFiles: string[] = [];
  for (const claim of claims) {
    if (claimedFiles.length >= opts.maxClaimsPerAgent) break;
    const path = str(rec(claim)?.filePath);
    if (path && !claimedFiles.includes(path)) claimedFiles.push(path);
  }
  const distinctPaths = new Set(
    claims.map((claim) => str(rec(claim)?.filePath)).filter((p): p is string => p !== null),
  );

  let sessionDigest: SwarmDigestAgent['session'] = null;
  if (session && str(session.id)) {
    const { text, count } = latestNoteText(session.notes, opts.maxNoteChars);
    sessionDigest = {
      id: str(session.id) as string,
      purpose: str(session.purpose),
      phase: str(session.phase),
      updatedAt: num(session.updatedAt),
      noteCount: count,
      latestNote: text,
    };
  }

  return {
    id: str(item.id) ?? 'unknown',
    label: str(item.label),
    purpose: str(item.purpose),
    identity: str(item.identity),
    project: str(item.project),
    status: str(item.status),
    liveness: str(item.liveness) ?? 'unknown',
    lastHeartbeat: num(item.lastHeartbeat),
    harness: harness
      ? { label: str(harness.label), backend: str(harness.backend), model: str(harness.model) }
      : null,
    worktree: worktree ? { branch: str(worktree.branch), name: str(worktree.name) } : null,
    squid: squid ? { level: str(squid.level), score: num(squid.score) } : null,
    session: sessionDigest,
    claimedFiles,
    omittedClaims: Math.max(0, distinctPaths.size - claimedFiles.length),
    steeringChannel: str(control?.steeringChannel),
  };
}

/**
 * Shape a full `/agent-roster` response into a bounded awareness digest.
 *
 * Agents are ordered most-alive-first (alive → stale → dead, freshest
 * heartbeat first within each class) so tail-dropping under the output budget
 * always sacrifices the least-relevant entries.
 */
export function digestSwarmRoster(roster: unknown, options?: SwarmDigestOptions): SwarmDigest {
  const opts = { ...DEFAULTS, ...options };
  const root = rec(roster) ?? {};
  const items = (Array.isArray(root.agents) ? root.agents : [])
    .map((item) => rec(item))
    .filter((item): item is AnyRecord => item !== null);

  const digested = items
    .map((item) => digestAgent(item, opts))
    .sort((a, b) => {
      const byLiveness = (LIVENESS_ORDER[a.liveness] ?? 3) - (LIVENESS_ORDER[b.liveness] ?? 3);
      if (byLiveness !== 0) return byLiveness;
      return (b.lastHeartbeat ?? 0) - (a.lastHeartbeat ?? 0);
    });

  const kept = digested.slice(0, opts.maxAgents);
  return {
    success: true,
    generatedAt: num(root.generatedAt) ?? Date.now(),
    project: str(root.project),
    totalAgents: digested.length,
    omittedAgents: digested.length - kept.length,
    squidSummary: rec(root.squidSummary) as Record<string, number> | null,
    agents: kept,
    note:
      'Compact digest. Full-fidelity roster (complete notes, claims, squid detail) is at GET /agent-roster.',
  };
}

/**
 * Serialize a digest under a hard character budget.
 *
 * Emits compact JSON (no indentation). If the result exceeds
 * `maxOutputChars`, agents are dropped from the tail — least-alive first,
 * thanks to {@link digestSwarmRoster}'s ordering — with `omittedAgents`
 * incremented each time, until the output fits. The budget therefore holds
 * for any roster size; a single pathological agent can shrink coverage but
 * can never overflow the caller's context.
 */
export function serializeSwarmDigest(roster: unknown, options?: SwarmDigestOptions): string {
  const opts = { ...DEFAULTS, ...options };
  const digest = digestSwarmRoster(roster, options);

  let serialized = JSON.stringify(digest);
  while (serialized.length > opts.maxOutputChars && digest.agents.length > 0) {
    digest.agents.pop();
    digest.omittedAgents += 1;
    serialized = JSON.stringify(digest);
  }
  return serialized;
}

/**
 * Compact the legacy four-endpoint fallback (`/agents`, `/sessions`,
 * `/files`, `/salvage/pending`) used against pre-3.8.4 daemons. Applies the
 * same philosophy: capped lists, stripped note bodies, explicit omission
 * counters, compact JSON, hard output budget.
 */
export function serializeLegacySwarmSnapshot(
  input: {
    agents?: unknown[];
    sessions?: unknown[];
    claims?: unknown[];
    deadAgents?: unknown[];
  },
  options?: SwarmDigestOptions,
): string {
  const opts = { ...DEFAULTS, ...options };
  const agents = (input.agents ?? []).slice(0, opts.maxAgents).map((a) => {
    const r = rec(a) ?? {};
    return {
      id: str(r.id),
      identity: str(r.identity),
      purpose: str(r.purpose),
      status: str(r.status),
      lastHeartbeat: num(r.lastHeartbeat),
    };
  });
  const sessions = (input.sessions ?? []).slice(0, opts.maxAgents).map((s) => {
    const r = rec(s) ?? {};
    const { text, count } = latestNoteText(r.notes, opts.maxNoteChars);
    return {
      id: str(r.id),
      purpose: str(r.purpose),
      status: str(r.status),
      phase: str(r.phase),
      noteCount: count,
      latestNote: text,
    };
  });
  const claimPaths: string[] = [];
  for (const claim of input.claims ?? []) {
    if (claimPaths.length >= opts.maxAgents * opts.maxClaimsPerAgent) break;
    const path = str(rec(claim)?.filePath) ?? str(rec(claim)?.path);
    if (path && !claimPaths.includes(path)) claimPaths.push(path);
  }
  const dead = (input.deadAgents ?? []).slice(0, opts.maxAgents).map((d) => {
    const r = rec(d) ?? {};
    return { id: str(r.id), identity: str(r.identity), purpose: str(r.purpose) };
  });

  const snapshot = {
    active_agents: agents,
    omitted_agents: Math.max(0, (input.agents ?? []).length - agents.length),
    sessions,
    omitted_sessions: Math.max(0, (input.sessions ?? []).length - sessions.length),
    file_claims: claimPaths,
    omitted_file_claims: Math.max(0, (input.claims ?? []).length - claimPaths.length),
    dead_agents: dead,
    omitted_dead_agents: Math.max(0, (input.deadAgents ?? []).length - dead.length),
    note: 'Compact legacy digest. Full detail is at the daemon HTTP API.',
  };

  let serialized = JSON.stringify(snapshot);
  while (serialized.length > opts.maxOutputChars && snapshot.file_claims.length > 0) {
    snapshot.file_claims.pop();
    snapshot.omitted_file_claims += 1;
    serialized = JSON.stringify(snapshot);
  }
  while (serialized.length > opts.maxOutputChars && snapshot.sessions.length > 0) {
    snapshot.sessions.pop();
    snapshot.omitted_sessions += 1;
    serialized = JSON.stringify(snapshot);
  }
  return serialized;
}
