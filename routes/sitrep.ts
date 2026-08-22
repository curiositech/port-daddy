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
 *   curl http://127.0.0.1:9876/sitrep?since_minutes=120 | jq '.summary'
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
    pending(options?: { project?: string; stack?: string; limit?: number; noteLimit?: number }): unknown;
  };
  spawner?: {
    list(): unknown[];
  };
}

/**
 * Parse a positive integer from a query string value, falling back to a default.
 * Rejects negatives and NaN to keep the contract tight — callers bound the
 * daemon's work, not vice versa. The cap is part of the endpoint's resource
 * containment design and cannot be raised by an accidental huge query.
 *
 * @param value - Untrusted query-string value.
 * @param fallback - Default used when the value is absent or invalid.
 * @param cap - Hard upper bound for accepted values.
 * @returns A positive integer no larger than the cap.
 */
function pint(value: unknown, fallback: number, cap: number): number {
  if (typeof value !== 'string') return fallback;
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, cap) : fallback;
}

const SITREP_LIMITS = {
  activity: 30,
  notes: 20,
  salvage: 20,
  salvageNotes: 3,
  spawned: 20,
  approvals: 20,
  maxRecords: 100,
  maxNoteChars: 1_000,
  maxDetailChars: 500,
} as const;

type UnknownRecord = Record<string, unknown>;

/**
 * Normalize unknown service output before projecting it. The purpose is to
 * keep sitrep resilient to legacy bare-array and wrapped response shapes.
 *
 * @param value - Candidate service row.
 * @returns The row when it is a plain record, otherwise an empty record.
 */
function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

/**
 * Bound untrusted diagnostic text so one historical note cannot dominate the
 * sitrep payload. This is an output-boundary design, not a storage mutation.
 *
 * @param value - Value to stringify for diagnostic output.
 * @param maxChars - Maximum returned character count.
 * @returns Bounded text, or null for an absent value.
 */
function boundedText(value: unknown, maxChars: number): string | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === 'string' ? value : String(value);
  return text.length > maxChars ? `${text.slice(0, Math.max(0, maxChars - 1))}…` : text;
}

/**
 * Project an activity row onto the compact public sitrep schema. The design
 * intentionally removes arbitrary nested metadata while preserving identity,
 * timing, and a marker that richer metadata existed.
 *
 * @param value - Raw activity-log row.
 * @returns A bounded activity projection.
 */
function projectActivity(value: unknown): UnknownRecord {
  const row = asRecord(value);
  return {
    id: row.id,
    timestamp: row.timestamp,
    type: row.type,
    agentId: row.agentId ?? row.agent_id,
    agent_id: row.agent_id ?? row.agentId,
    targetId: row.targetId ?? row.target_id,
    target_id: row.target_id ?? row.targetId,
    details: boundedText(row.details, SITREP_LIMITS.maxDetailChars) ?? '',
    metadataTruncated: row.metadata !== null && row.metadata !== undefined,
  };
}

/**
 * Project a durable note while bounding both supported legacy text fields.
 * The purpose is compatibility without returning unbounded transcript data.
 *
 * @param value - Raw session-note row.
 * @returns A bounded note projection.
 */
function projectNote(value: unknown): UnknownRecord {
  const row = asRecord(value);
  return {
    id: row.id,
    sessionId: row.sessionId ?? row.session_id,
    session_id: row.session_id ?? row.sessionId,
    agentId: row.agentId ?? row.agent_id,
    agent_id: row.agent_id ?? row.agentId,
    timestamp: row.timestamp ?? row.created_at,
    created_at: row.created_at ?? row.timestamp,
    type: row.type,
    content: boundedText(row.content, SITREP_LIMITS.maxNoteChars),
    note: boundedText(row.note, SITREP_LIMITS.maxNoteChars),
  };
}

/**
 * Project one salvage candidate with a bounded recent-note window. The design
 * exposes truncation explicitly so operators do not mistake a preview for the
 * complete recovery ledger.
 *
 * @param value - Raw resurrection queue entry.
 * @param noteLimit - Maximum recent note strings to return.
 * @returns A bounded salvage projection with note-window metadata.
 */
function projectSalvage(value: unknown, noteLimit: number): UnknownRecord {
  const row = asRecord(value);
  const rawNotes = Array.isArray(row.notes) ? row.notes : [];
  const notes = rawNotes.slice(-noteLimit).map((note) => boundedText(note, SITREP_LIMITS.maxNoteChars) ?? '');
  const reportedTotal = Number(row.noteCount ?? row.note_count);
  const totalNotes = Number.isSafeInteger(reportedTotal) && reportedTotal >= 0
    ? Math.max(reportedTotal, rawNotes.length)
    : rawNotes.length;
  return {
    id: row.id ?? row.agentId ?? row.agent_id,
    agentId: row.agentId ?? row.agent_id ?? row.id,
    agent_id: row.agent_id ?? row.agentId ?? row.id,
    name: boundedText(row.name, 240),
    purpose: boundedText(row.purpose, SITREP_LIMITS.maxDetailChars),
    sessionId: row.sessionId ?? row.session_id,
    lastHeartbeat: row.lastHeartbeat,
    staleSince: row.staleSince,
    status: row.status,
    identityProject: row.identityProject,
    identityStack: row.identityStack,
    identityContext: row.identityContext,
    notes,
    noteWindow: {
      total: totalNotes,
      returned: notes.length,
      truncated: totalNotes > notes.length,
    },
  };
}

/**
 * Project spawned-agent state without leaking arbitrary backend payloads. The
 * purpose is a small stable summary suitable for every harness and provider.
 *
 * @param value - Raw spawner state row.
 * @returns A bounded spawned-agent projection.
 */
function projectSpawned(value: unknown): UnknownRecord {
  const row = asRecord(value);
  return {
    id: row.id,
    agentId: row.agentId ?? row.agent_id,
    identity: boundedText(row.identity, 240),
    status: row.status,
    purpose: boundedText(row.purpose ?? row.task, SITREP_LIMITS.maxDetailChars),
    startedAt: row.startedAt ?? row.started_at,
    updatedAt: row.updatedAt ?? row.updated_at,
  };
}

export const sitrepPlugin: FastifyPluginAsync<{ deps: SitrepDeps }> = async (fastify, opts) => {
  const { deps } = opts;
  const { activityLog, sessions, resurrection, spawner } = deps;

  fastify.get('/sitrep', async (request: FastifyRequest, _reply: FastifyReply) => {
    const q = request.query as Record<string, unknown>;

    const sinceMinutes = pint(q.since_minutes ?? q.sinceMinutes, 60, 30 * 24 * 60);
    const limitActivity = pint(q.limit_activity ?? q.limitActivity, SITREP_LIMITS.activity, SITREP_LIMITS.maxRecords);
    const limitNotes = pint(q.limit_notes ?? q.limitNotes, SITREP_LIMITS.notes, SITREP_LIMITS.maxRecords);
    const limitSalvage = pint(q.limit_salvage ?? q.limitSalvage, SITREP_LIMITS.salvage, SITREP_LIMITS.maxRecords);
    const limitSalvageNotes = pint(q.limit_salvage_notes ?? q.limitSalvageNotes, SITREP_LIMITS.salvageNotes, 10);
    const limitSpawned = pint(q.limit_spawned ?? q.limitSpawned, SITREP_LIMITS.spawned, SITREP_LIMITS.maxRecords);
    const summaryOnly = q.summary_only === '1' || q.summaryOnly === '1' || q.summary_only === 'true' || q.summaryOnly === 'true';
    const project = typeof q.project === 'string' ? q.project : undefined;
    const stack = typeof q.stack === 'string' ? q.stack : undefined;

    const sinceMs = Date.now() - sinceMinutes * 60 * 1000;

    const activityResult = activityLog.getRecent({ limit: limitActivity + 1, since: sinceMs });
    const activityRaw = Array.isArray(activityResult)
      ? activityResult
      : (activityResult.entries ?? []);
    const activityHasMore = activityRaw.length > limitActivity || (!Array.isArray(activityResult) && (activityResult.total ?? 0) > limitActivity);
    const activity = activityRaw.slice(0, limitActivity).map(projectActivity);

    const notesResult = sessions.getNotes(null, { limit: limitNotes + 1, since: sinceMs, project });
    const notesRaw = Array.isArray(notesResult)
      ? notesResult
      : ((notesResult as { notes?: unknown[] }).notes ?? []);
    const notesHasMore = notesRaw.length > limitNotes;
    const notes = notesRaw.slice(0, limitNotes).map(projectNote);

    const salvageOpts: { project?: string; stack?: string; limit?: number; noteLimit?: number } = {};
    if (project) salvageOpts.project = project;
    if (stack) salvageOpts.stack = stack;
    salvageOpts.limit = limitSalvage + 1;
    salvageOpts.noteLimit = limitSalvageNotes;
    const pendingRaw = resurrection.pending(salvageOpts);
    const salvageRaw: unknown[] = Array.isArray(pendingRaw)
      ? pendingRaw
      : ((pendingRaw as { agents?: unknown[] })?.agents ?? []);
    const salvageHasMore = salvageRaw.length > limitSalvage;
    const salvageQueue = salvageRaw.slice(0, limitSalvage).map((entry) => projectSalvage(entry, limitSalvageNotes));

    const spawnedRaw = spawner ? spawner.list() : [];
    const spawnedHasMore = spawnedRaw.length > limitSpawned;
    const spawnedAgents = spawnedRaw.slice(0, limitSpawned).map(projectSpawned);

    // Held trust-gate approvals lead the sitrep: a pending human gate is
    // the single most actionable item an operator/agent can see.
    let approvals: Array<{ id: string; agent: string; trigger: string; tier: string; project: string; timestamp: number }> = [];
    let approvalsHasMore = false;
    try {
      const { getSharedApprovalStream } = await import('../lib/fleet/approval-stream.js');
      const approvalRows = getSharedApprovalStream().list();
      approvalsHasMore = approvalRows.length > SITREP_LIMITS.approvals;
      approvals = approvalRows.slice(0, SITREP_LIMITS.approvals).map((p) => ({
        id: p.id, agent: p.agent, trigger: p.trigger, tier: p.tier, project: p.project, timestamp: p.timestamp,
      }));
    } catch {
      // advisory; sitrep must not fail on this
    }

    const summary =
      `Last ${sinceMinutes}m: ${activity.length}${activityHasMore ? '+' : ''} events, ` +
      `${notes.length}${notesHasMore ? '+' : ''} notes, ${salvageQueue.length}${salvageHasMore ? '+' : ''} dead ` +
      `agent${salvageQueue.length === 1 ? '' : 's'}, ` +
      `${spawnedAgents.length}${spawnedHasMore ? '+' : ''} spawned agent${spawnedAgents.length === 1 ? '' : 's'}` +
      (approvals.length > 0 ? `, ${approvals.length} APPROVAL${approvals.length === 1 ? '' : 'S'} WAITING` : '');

    return {
      success: true,
      summary,
      since_minutes: sinceMinutes,
      since_ms: sinceMs,
      activity: summaryOnly ? [] : activity,
      notes: summaryOnly ? [] : notes,
      salvage_queue: summaryOnly ? [] : salvageQueue,
      spawned_agents: summaryOnly ? [] : spawnedAgents,
      approvals: summaryOnly ? [] : approvals,
      window: {
        summaryOnly,
        activity: { limit: limitActivity, returned: summaryOnly ? 0 : activity.length, truncated: activityHasMore },
        notes: { limit: limitNotes, returned: summaryOnly ? 0 : notes.length, truncated: notesHasMore },
        salvage: { limit: limitSalvage, returned: summaryOnly ? 0 : salvageQueue.length, truncated: salvageHasMore, notesPerAgent: limitSalvageNotes },
        spawned: { limit: limitSpawned, returned: summaryOnly ? 0 : spawnedAgents.length, truncated: spawnedHasMore },
        approvals: { limit: SITREP_LIMITS.approvals, returned: summaryOnly ? 0 : approvals.length, truncated: approvalsHasMore },
      },
    };
  });
};
