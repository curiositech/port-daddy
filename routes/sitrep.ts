/**
 * Sitrep Route — "What happened while I was away?"
 *
 * The maritime sitrep (situation report): an agent returning from absence
 * radios in, the daemon replies with a single synthesis of what moved —
 * activity events, session notes, the salvage queue, and spawned agents —
 * bounded by a time window. One call. One mental model.
 *
 * This replaces the pattern of running `pd activity && pd notes && pd salvage`
 * in sequence, each with its own paging and decoding. It is the canonical
 * "catch up" surface and intentionally cheap (four indexed SQLite reads, all
 * via pre-compiled prepared statements in their respective modules).
 *
 * WHY NOT `catch_me_up`? That name was expedient and vague. Sitrep is the
 * exact semantic term from military/maritime radio (same family as `mayday`,
 * `pan-pan`, `securite` already used across the PD maritime module). Every
 * PD operator speaks that voice; this command should too.
 *
 * GET /sitrep?since_minutes=60&project=myapp&limit_activity=30&limit_notes=20
 *
 * Response shape:
 * {
 *   summary: "Last 60m: 12 events, 7 notes, 1 dead agent, 2 spawned agents",
 *   since_minutes, since_ms,
 *   activity: ActivityRow[],      // from activityLog.getRecent()
 *   notes: SessionNote[],         // from sessions.getNotes(null, ...)
 *   salvage_queue: Resurrection[], // from resurrection.pending()
 *   spawned_agents: SpawnedAgent[] // from spawner.list()
 * }
 *
 * @example
 *   // You woke up. What's the state of the harbor?
 *   curl "$PORT_DADDY_URL/sitrep?since_minutes=120" | jq '.summary'
 *   // → "Last 120m: 34 events, 12 notes, 0 dead agents, 3 spawned agents"
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';

interface SitrepDeps {
  activityLog: {
    getRecent(options?: { limit?: number; since?: number; agentId?: string }): {
      entries: unknown[];
      total?: number;
    };
  };
  sessions: {
    getNotes(
      sessionId: string | null,
      options?: { limit?: number; type?: string; since?: number; project?: string | null },
    ): { notes: unknown[] } | unknown[];
  };
  resurrection: {
    // Returns either a bare array or { agents, count } wrapped shape.
    pending(options?: { project?: string; stack?: string }): unknown;
  };
  spawner?: {
    list(): unknown[];
  };
}

/**
 * Parse a positive integer from a query string value, falling back to a default.
 * Rejects negatives and NaN to keep the contract tight — callers bound the
 * daemon's work, not vice versa.
 */
function pint(value: unknown, fallback: number): number {
  if (typeof value !== 'string') return fallback;
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const sitrepPlugin: FastifyPluginAsync<{ deps: SitrepDeps }> = async (fastify, opts) => {
  const { deps } = opts;
  const { activityLog, sessions, resurrection, spawner } = deps;

  fastify.get('/sitrep', async (request: FastifyRequest, _reply: FastifyReply) => {
    const q = request.query as Record<string, unknown>;

    const sinceMinutes = pint(q.since_minutes ?? q.sinceMinutes, 60);
    const limitActivity = pint(q.limit_activity ?? q.limitActivity, 30);
    const limitNotes = pint(q.limit_notes ?? q.limitNotes, 20);
    const project = typeof q.project === 'string' ? q.project : undefined;
    const stack = typeof q.stack === 'string' ? q.stack : undefined;

    const sinceMs = Date.now() - sinceMinutes * 60 * 1000;

    const activityResult = activityLog.getRecent({ limit: limitActivity, since: sinceMs });
    const activity = Array.isArray(activityResult)
      ? activityResult
      : (activityResult.entries ?? []);

    const notesResult = sessions.getNotes(null, { limit: limitNotes, since: sinceMs, project });
    const notes = Array.isArray(notesResult)
      ? notesResult
      : ((notesResult as { notes?: unknown[] }).notes ?? []);

    const salvageOpts: { project?: string; stack?: string } = {};
    if (project) salvageOpts.project = project;
    if (stack) salvageOpts.stack = stack;
    const pendingRaw = resurrection.pending(salvageOpts);
    const salvageQueue: unknown[] = Array.isArray(pendingRaw)
      ? pendingRaw
      : ((pendingRaw as { agents?: unknown[] })?.agents ?? []);

    const spawnedAgents = spawner ? spawner.list() : [];

    // Held trust-gate approvals lead the sitrep: a pending human gate is
    // the single most actionable item an operator/agent can see.
    let approvals: Array<{ id: string; agent: string; trigger: string; tier: string; project: string; timestamp: number }> = [];
    try {
      const { getSharedApprovalStream } = await import('../lib/fleet/approval-stream.js');
      approvals = getSharedApprovalStream().list().map((p) => ({
        id: p.id, agent: p.agent, trigger: p.trigger, tier: p.tier, project: p.project, timestamp: p.timestamp,
      }));
    } catch {
      // advisory; sitrep must not fail on this
    }

    const summary =
      `Last ${sinceMinutes}m: ${activity.length} events, ` +
      `${notes.length} notes, ${salvageQueue.length} dead ` +
      `agent${salvageQueue.length === 1 ? '' : 's'}, ` +
      `${spawnedAgents.length} spawned agent${spawnedAgents.length === 1 ? '' : 's'}` +
      (approvals.length > 0 ? `, ${approvals.length} APPROVAL${approvals.length === 1 ? '' : 'S'} WAITING` : '');

    return {
      success: true,
      summary,
      since_minutes: sinceMinutes,
      since_ms: sinceMs,
      activity,
      notes,
      salvage_queue: salvageQueue,
      spawned_agents: spawnedAgents,
      approvals,
    };
  });
};
