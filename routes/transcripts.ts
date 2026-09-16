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
 * This plugin is read-only. Credentialless HTTP mutation routes are not
 * registered. Trusted in-process producers use the Transcripts API directly.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type {
  Transcripts,
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

};
