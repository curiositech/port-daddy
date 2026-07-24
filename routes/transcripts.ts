/**
 * Fleet Transcript Routes — operator-facing surface for ship-run records.
 *
 * Read paths:
 *   GET    /transcripts                List recent (filter: ship, pr, since, limit, status)
 *   GET    /transcripts/compliance     Backend matrix + live transcript-flow health
 *   GET    /transcripts/cost           Cost rollup (?since=ms&until=ms)
 *   GET    /transcripts/stream         SSE — live tail of start/update/end events
 *   GET    /transcripts/:id            Full transcript with messages + outputs
 *
 * Write paths (operator-only / spawner-internal):
 *   POST   /transcripts                Append a full transcript (idempotent upsert)
 *   POST   /transcripts/:id/messages   Append a single message (used by external recorders)
 *   POST   /transcripts/:id/outputs    Append a ship output artifact (pr-comment URL etc.)
 *   DELETE /transcripts/:id            Delete (destructive — gated)
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type {
  Transcripts,
  TranscriptEntry,
  TranscriptMessage,
  TranscriptOutput,
  TranscriptFilter,
} from '../lib/transcripts.js';
import {
  assessTranscriptRun,
  buildTranscriptComplianceReport,
  findLatestTranscriptForAgent,
  type TranscriptTrackedRun,
} from '../lib/transcript-compliance.js';
import {
  buildTranscriptEmergencyFromSources,
  parseTranscriptEmergencyPositiveIntQuery,
  type TranscriptEmergencySourceDeps,
} from '../lib/transcript-emergency.js';

interface TranscriptRouteDeps {
  transcripts?: Transcripts;
  spawner?: {
    list(): TranscriptTrackedRun[];
  };
  cloudAppTelemetry?: TranscriptEmergencySourceDeps['cloudAppTelemetry'];
  metrics: { errors: number };
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
}

const VALID_ROLES = new Set(['system', 'user', 'assistant', 'tool', 'thinking']);
const VALID_OUTPUT_TYPES = new Set([
  'pr-comment', 'issue', 'draft-pr', 'commit', 'noop', 'message', 'other',
]);

export const transcriptsPlugin: FastifyPluginAsync<{ deps: TranscriptRouteDeps }> = async (
  fastify,
  opts,
) => {
  const { transcripts, spawner, metrics, logger } = opts.deps;

  function notWired(reply: FastifyReply): unknown {
    reply.code(501);
    return { success: false, error: 'transcripts module not wired into this daemon' };
  }

  function complianceReport(stallAfterMs?: number) {
    if (!transcripts) return null;
    const runs = (spawner?.list() || []).map((run) =>
      assessTranscriptRun(
        run,
        findLatestTranscriptForAgent(transcripts, run.agentId),
        { now: Date.now(), stallAfterMs },
      ),
    );
    return buildTranscriptComplianceReport(runs, { stallAfterMs });
  }

  // ── GET /transcripts ─────────────────────────────────────────────────────
  fastify.get('/transcripts', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!transcripts) return notWired(reply);
    try {
      const q = (request.query as Record<string, string>) || {};
      const filter: TranscriptFilter = {};
      if (q.ship) filter.ship = q.ship;
      if (q.agentId) filter.agentId = q.agentId;
      if (q.status) filter.status = q.status as TranscriptFilter['status'];
      if (q.pr) {
        const n = parseInt(q.pr, 10);
        if (Number.isFinite(n)) filter.pr = n;
      }
      if (q.since) {
        const n = parseInt(q.since, 10);
        if (Number.isFinite(n)) filter.since = n;
      }
      if (q.until) {
        const n = parseInt(q.until, 10);
        if (Number.isFinite(n)) filter.until = n;
      }
      if (q.limit) {
        const n = parseInt(q.limit, 10);
        if (Number.isFinite(n)) filter.limit = n;
      }
      const rows = transcripts.listTranscripts(filter);
      return { success: true, transcripts: rows, count: rows.length };
    } catch (error) {
      metrics.errors++;
      logger.error('transcripts_list_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  // ── GET /transcripts/compliance ──────────────────────────────────────────
  fastify.get('/transcripts/compliance', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!transcripts) return notWired(reply);
    try {
      const q = (request.query as Record<string, string>) || {};
      const stallAfterMs = parseTranscriptEmergencyPositiveIntQuery(q.stallAfterMs);
      if (q.stallAfterMs !== undefined && stallAfterMs === undefined) {
        reply.code(400);
        return { success: false, error: 'stallAfterMs must be a positive integer duration in milliseconds' };
      }
      const report = complianceReport(stallAfterMs);
      return { success: true, ...(report || buildTranscriptComplianceReport([])) };
    } catch (error) {
      metrics.errors++;
      logger.error('transcripts_compliance_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  // ── GET /transcripts/emergency ───────────────────────────────────────────
  fastify.get('/transcripts/emergency', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!transcripts) return notWired(reply);
    try {
      const q = (request.query as Record<string, string>) || {};
      const stallAfterMs = parseTranscriptEmergencyPositiveIntQuery(q.stallAfterMs);
      if (q.stallAfterMs !== undefined && stallAfterMs === undefined) {
        reply.code(400);
        return { success: false, error: 'stallAfterMs must be a positive integer duration in milliseconds' };
      }
      const cloudSinceMs = parseTranscriptEmergencyPositiveIntQuery(q.since);
      if (q.since !== undefined && cloudSinceMs === undefined) {
        reply.code(400);
        return { success: false, error: 'since must be a positive integer duration in milliseconds' };
      }
      const report = buildTranscriptEmergencyFromSources({
        transcripts,
        spawner,
        cloudAppTelemetry: opts.deps.cloudAppTelemetry,
      }, {
        stallAfterMs,
        cloudSinceMs,
      });
      return { success: true, ...report };
    } catch (error) {
      metrics.errors++;
      logger.error('transcripts_emergency_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  // ── GET /transcripts/cost ────────────────────────────────────────────────
  fastify.get('/transcripts/cost', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!transcripts) return notWired(reply);
    try {
      const q = (request.query as Record<string, string>) || {};
      const since = q.since ? parseInt(q.since, 10) : Date.now() - 24 * 60 * 60 * 1000;
      const until = q.until ? parseInt(q.until, 10) : Date.now();
      if (!Number.isFinite(since) || !Number.isFinite(until)) {
        reply.code(400);
        return { success: false, error: 'since/until must be epoch ms' };
      }
      const rollup = transcripts.costRollup({ since, until });
      return { success: true, ...rollup };
    } catch (error) {
      metrics.errors++;
      logger.error('transcripts_cost_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  // ── GET /transcripts/stream  (SSE) ───────────────────────────────────────
  fastify.get('/transcripts/stream', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!transcripts) return notWired(reply);

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    raw.write('event: connected\ndata: {"channel":"fleet:transcript-stream"}\n\n');

    const unsubscribe = transcripts.subscribe((event) => {
      // Stream the header only on start/update; emit the complete row on 'end'.
      // Listings can already be huge, so omit the messages array except on 'end'.
      const payload = event.type === 'end'
        ? event.entry
        : {
            id: event.entry.id,
            ship: event.entry.ship,
            spawned_agent_id: event.entry.spawned_agent_id,
            status: event.entry.status,
            started_at: event.entry.started_at,
            ended_at: event.entry.ended_at,
            backend: event.entry.backend,
            model: event.entry.model,
            trigger: event.entry.trigger,
            pr_number: event.entry.pr_number,
          };
      try {
        raw.write(`event: ${event.type}\ndata: ${JSON.stringify(payload)}\n\n`);
      } catch { /* client disconnected */ }
    });

    const heartbeat = setInterval(() => {
      try { raw.write(':heartbeat\n\n'); } catch { /* dead conn */ }
    }, 30000);

    const cleanup = (): void => {
      clearInterval(heartbeat);
      unsubscribe();
      try { raw.end(); } catch { /* already ended */ }
    };
    request.raw.on('close', cleanup);
    request.raw.on('error', cleanup);
  });

  // ── GET /transcripts/:id ─────────────────────────────────────────────────
  fastify.get('/transcripts/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!transcripts) return notWired(reply);
    try {
      const id = String((request.params as Record<string, string>).id);
      const tx = transcripts.getTranscript(id);
      if (!tx) {
        reply.code(404);
        return { success: false, error: 'transcript not found' };
      }
      return { success: true, transcript: tx };
    } catch (error) {
      metrics.errors++;
      logger.error('transcripts_get_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  // ── POST /transcripts  (operator upsert path) ────────────────────────────
  fastify.post('/transcripts', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!transcripts) return notWired(reply);
    try {
      const body = (request.body as TranscriptEntry) || {} as TranscriptEntry;
      if (!body.id || !body.ship || !body.spawned_agent_id || !body.trigger || !body.backend || !body.model) {
        reply.code(400);
        return { success: false, error: 'id, ship, spawned_agent_id, trigger, backend, model are required' };
      }
      // Coerce messages and outputs to safe defaults.
      const entry: TranscriptEntry = {
        ...body,
        messages: Array.isArray(body.messages) ? body.messages : [],
        outputs: Array.isArray(body.outputs) ? body.outputs : [],
      };
      transcripts.recordTranscript(entry);
      return { success: true, id: entry.id };
    } catch (error) {
      metrics.errors++;
      logger.error('transcripts_record_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  // ── POST /transcripts/:id/messages ───────────────────────────────────────
  fastify.post('/transcripts/:id/messages', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!transcripts) return notWired(reply);
    try {
      const id = String((request.params as Record<string, string>).id);
      const body = (request.body as TranscriptMessage) || ({} as TranscriptMessage);
      if (!body.role || !VALID_ROLES.has(body.role)) {
        reply.code(400);
        return { success: false, error: `role must be one of: ${[...VALID_ROLES].join(', ')}` };
      }
      if (typeof body.content !== 'string') {
        reply.code(400);
        return { success: false, error: 'content must be a string' };
      }
      transcripts.appendMessage(id, {
        role: body.role,
        content: body.content,
        timestamp: body.timestamp || Date.now(),
        tool_calls: body.tool_calls,
      });
      return { success: true, id };
    } catch (error) {
      const msg = (error as Error).message;
      if (msg.includes('no transcript with id')) {
        reply.code(404);
        return { success: false, error: msg };
      }
      metrics.errors++;
      logger.error('transcripts_message_error', { error: msg });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  // ── POST /transcripts/:id/outputs ────────────────────────────────────────
  fastify.post('/transcripts/:id/outputs', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!transcripts) return notWired(reply);
    try {
      const id = String((request.params as Record<string, string>).id);
      const body = (request.body as TranscriptOutput) || ({} as TranscriptOutput);
      if (!body.type || !VALID_OUTPUT_TYPES.has(body.type)) {
        reply.code(400);
        return { success: false, error: `type must be one of: ${[...VALID_OUTPUT_TYPES].join(', ')}` };
      }
      if (typeof body.summary !== 'string' || !body.summary.trim()) {
        reply.code(400);
        return { success: false, error: 'summary must be a non-empty string' };
      }
      transcripts.appendOutput(id, {
        type: body.type,
        summary: body.summary,
        url: body.url,
      });
      return { success: true, id };
    } catch (error) {
      const msg = (error as Error).message;
      if (msg.includes('no transcript with id')) {
        reply.code(404);
        return { success: false, error: msg };
      }
      metrics.errors++;
      logger.error('transcripts_output_error', { error: msg });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  // ── DELETE /transcripts/:id  (destructive) ───────────────────────────────
  fastify.delete('/transcripts/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!transcripts) return notWired(reply);
    try {
      const id = String((request.params as Record<string, string>).id);
      // Confirmation is enforced at CLI layer; the daemon honors any delete.
      const removed = transcripts.deleteTranscript(id);
      if (!removed) {
        reply.code(404);
        return { success: false, error: 'transcript not found' };
      }
      return { success: true, id, deleted: true };
    } catch (error) {
      metrics.errors++;
      logger.error('transcripts_delete_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  // Retention backfill — durably re-archive every transcript in the DB to the
  // JSONL archive (ADR-0058), so "log ALL transcripts" covers history, not just
  // runs since the archive was enabled. Run once after first enabling retention.
  fastify.post('/transcripts/archive/backfill', async (_request: FastifyRequest, reply: FastifyReply) => {
    if (!transcripts) return notWired(reply);
    try {
      const result = transcripts.backfillArchive();
      return { success: true, ...result };
    } catch (error) {
      metrics.errors++;
      logger.error('transcripts_backfill_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });
};
