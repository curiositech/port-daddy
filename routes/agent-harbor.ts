/**
 * Agent Harbor read API (binder ch09 endpoint family; work order "C-routes").
 *
 * The daemon HTTP layer over C1's projections (lib/agent-harbor/projections.ts,
 * lib/agent-harbor/event-ledger.ts). This closes I0 Contradiction 1 ("the route
 * triangle"): C3 (pd-console roster/detail) and C8 (doctor) both assume
 * `GET /agent-nodes` exists, but no chain had built the HTTP route serving
 * C1's projections. These are READ routes only — commands stay with their
 * owning chains (C5 tool gates, future Work Intent service).
 *
 * Skill grafts honored (cited in the PR):
 *   - rest-api-design: nouns in paths, proper status codes (404/500 never a
 *     200-with-error), consistent `{ data, projection }` envelope, cursor
 *     pagination on the unbounded collection (transcript events), bounded
 *     limits everywhere.
 *   - server-sent-events-vs-websockets: transcript live tail is SSE (server →
 *     client only), `Cache-Control: no-cache` + `X-Accel-Buffering: no` +
 *     `retry:`, `id:` on every event with `Last-Event-ID` resume against the
 *     durable timeline projection (the replay buffer the skill demands),
 *     comment-line heartbeats ≤30s.
 *   - api-versioning-strategy: additive evolution — this family only adds
 *     routes; response envelopes carry the projection freshness metadata so
 *     new fields can ride along without breaking readers.
 *   - agent-interchange-formats / tolerant reader: unknown query params are
 *     ignored, projection rows pass through with any future columns intact,
 *     and payloads with unknown fields were already preserved by the ledger.
 *   - cqrs-event-sourcing-architect: queries display, commands decide — every
 *     response is labeled fresh/stale from the projection checkpoint, and a
 *     stale view is NEVER used to authorize anything (there is nothing to
 *     authorize here; the label is display truth for C3/C8).
 *
 * Freshness contract: by default each read catches the relevant projections up
 * to the ledger head first (read-through catch-up — cheap when nothing new).
 * `?refresh=false` serves the projection as-is; the envelope's
 * `projection.stale` label is then the honest signal (binder ch18: "a UI pane
 * can be stale, but a tool gate cannot be authorized from stale data").
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { DatabaseInstance } from '../lib/sqlite-runtime.js';
import { getBlackboard } from '../lib/agent-harbor/blackboard.js';
import { sessionChainHeadHash, verifySessionChain } from '../lib/agent-harbor/event-ledger.js';
import {
  ensureProjectionSchema,
  getCompliance,
  getCostSummary,
  getFilesTouched,
  getProjectionStatus,
  getRoster,
  getWorkReceipts,
  projectPending,
  type ProjectionName,
} from '../lib/agent-harbor/projections.js';

interface AgentHarborRouteDeps {
  db: DatabaseInstance;
  metrics: { errors: number };
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
}

export interface AgentHarborSseOptions {
  /** Poll cadence for new timeline rows on a live stream (ms). */
  pollMs?: number;
  /** Keepalive comment cadence (ms). Must be ≤ 30s per the SSE skill gate. */
  heartbeatMs?: number;
  /** Hard cap on a single SSE connection (ms). */
  connectionTimeoutMs?: number;
}

interface AgentHarborPluginOpts {
  deps: AgentHarborRouteDeps;
  sse?: AgentHarborSseOptions;
}

/** Freshness metadata attached to every response (stale labeled, never hidden). */
interface ProjectionMeta {
  name: ProjectionName;
  stale: boolean;
  lastLedgerSeq: number;
  headSeq: number;
  /** For multi-projection joins: exactly which projections are behind. */
  staleProjections?: ProjectionName[];
}

function projectionMeta(db: DatabaseInstance, name: ProjectionName): ProjectionMeta {
  const status = getProjectionStatus(db).find((s) => s.projection === name);
  return {
    name,
    stale: status ? status.stale : true,
    lastLedgerSeq: status ? status.lastLedgerSeq : 0,
    headSeq: status ? status.headSeq : 0,
  };
}

function wantsRefresh(query: Record<string, unknown>): boolean {
  const raw = query.refresh;
  if (typeof raw !== 'string') return true; // default: read-through catch-up
  return !(raw === 'false' || raw === '0' || raw === 'no');
}

function boundedLimit(raw: unknown, fallback: number, max: number): number {
  const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), max);
}

function parseSequence(raw: unknown): number | null {
  const parsed = typeof raw === 'string' ? Number.parseFloat(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

interface TimelineRow {
  session_id: string;
  sequence: number;
  event_id: string;
  [key: string]: unknown;
}

/** Cursor-paged timeline read straight off the projection table (rest-api-design: never unbounded). */
function readTimelinePage(
  db: DatabaseInstance,
  sessionId: string,
  afterSequence: number | null,
  limit: number,
): TimelineRow[] {
  ensureProjectionSchema(db);
  return db
    .prepare(
      `SELECT * FROM harbor_proj_timeline
       WHERE session_id = ? AND sequence > ?
       ORDER BY sequence ASC LIMIT ?`,
    )
    .all(sessionId, afterSequence ?? -1, limit) as TimelineRow[];
}

function sseWrite(raw: NodeJS.WritableStream, row: TimelineRow): void {
  // WHATWG wire format: id enables Last-Event-ID resume; single-line JSON data.
  raw.write(`event: transcript\nid: ${row.event_id}\ndata: ${JSON.stringify(row)}\n\n`);
}

export const agentHarborPlugin: FastifyPluginAsync<AgentHarborPluginOpts> = async (fastify, opts) => {
  const { db, metrics, logger } = opts.deps;
  const pollMs = opts.sse?.pollMs ?? 1000;
  const heartbeatMs = Math.min(opts.sse?.heartbeatMs ?? 25_000, 30_000);
  const connectionTimeoutMs = opts.sse?.connectionTimeoutMs ?? 30 * 60 * 1000;

  function fail(reply: FastifyReply, where: string, error: unknown): { error: string; code: string } {
    metrics.errors++;
    logger.error(`agent_harbor_${where}_failed`, { error: (error as Error).message });
    reply.code(500);
    return { error: 'internal server error', code: 'AGENT_HARBOR_INTERNAL' };
  }

  // ── GET /agent-nodes — the roster projection (binder ch09 agent registry) ──
  fastify.get('/agent-nodes', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = request.query as Record<string, unknown>;
      if (wantsRefresh(query)) projectPending(db, { projection: 'roster' });
      const roster = getRoster(db);
      const limit = boundedLimit(query.limit, 250, 1000);
      return {
        data: roster.rows.slice(0, limit),
        projection: {
          name: 'roster',
          stale: roster.stale,
          lastLedgerSeq: roster.lastLedgerSeq,
          headSeq: roster.headSeq,
        } satisfies ProjectionMeta,
      };
    } catch (error) {
      return fail(reply, 'roster', error);
    }
  });

  // ── GET /agent-nodes/:id — detail join across the read models ──
  fastify.get('/agent-nodes/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const query = request.query as Record<string, unknown>;
      if (wantsRefresh(query)) projectPending(db);

      const roster = getRoster(db);
      const node = roster.rows.find((r) => (r as { agent_node_id?: unknown }).agent_node_id === id);
      if (!node) {
        reply.code(404);
        return { error: `agent node ${id} not found in roster projection`, code: 'AGENT_NODE_NOT_FOUND' };
      }
      const compliance = getCompliance(db, id);
      const costs = getCostSummary(db, { agentNodeId: id });
      const receipts = getWorkReceipts(db, { agentNodeId: id });
      const files = getFilesTouched(db, { agentNodeId: id });
      // The detail view joins five projections: the envelope's freshness must
      // describe the JOIN, not just the roster — lastLedgerSeq is the least
      // caught-up checkpoint, headSeq the furthest head seen, and
      // staleProjections names exactly which read models are behind.
      const joined: Array<{ name: ProjectionName; stale: boolean; lastLedgerSeq: number; headSeq: number }> = [
        { name: 'roster', stale: roster.stale, lastLedgerSeq: roster.lastLedgerSeq, headSeq: roster.headSeq },
        { name: 'compliance', stale: compliance.stale, lastLedgerSeq: compliance.lastLedgerSeq, headSeq: compliance.headSeq },
        { name: 'costs', stale: costs.stale, lastLedgerSeq: costs.lastLedgerSeq, headSeq: costs.headSeq },
        { name: 'work-receipts', stale: receipts.stale, lastLedgerSeq: receipts.lastLedgerSeq, headSeq: receipts.headSeq },
        { name: 'files-touched', stale: files.stale, lastLedgerSeq: files.lastLedgerSeq, headSeq: files.headSeq },
      ];
      const staleProjections = joined.filter((p) => p.stale).map((p) => p.name);
      return {
        data: {
          node,
          compliance: compliance.rows[0] ?? null,
          costs: costs.rows,
          receipts: receipts.rows,
          filesTouched: files.rows,
        },
        projection: {
          name: 'roster',
          stale: staleProjections.length > 0,
          lastLedgerSeq: Math.min(...joined.map((p) => p.lastLedgerSeq)),
          headSeq: Math.max(...joined.map((p) => p.headSeq)),
          staleProjections,
        } satisfies ProjectionMeta,
      };
    } catch (error) {
      return fail(reply, 'node_detail', error);
    }
  });

  // ── GET /agent-nodes/:id/files — files-touched projection for a node ──
  fastify.get('/agent-nodes/:id/files', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const query = request.query as Record<string, unknown>;
      if (wantsRefresh(query)) projectPending(db, { projection: 'files-touched' });
      const sessionId = typeof query.sessionId === 'string' && query.sessionId ? query.sessionId : undefined;
      const files = getFilesTouched(db, { agentNodeId: id, ...(sessionId ? { sessionId } : {}) });
      return {
        data: files.rows,
        projection: {
          name: 'files-touched',
          stale: files.stale,
          lastLedgerSeq: files.lastLedgerSeq,
          headSeq: files.headSeq,
        } satisfies ProjectionMeta,
      };
    } catch (error) {
      return fail(reply, 'files', error);
    }
  });

  // ── GET /sessions/:id/events — transcript timeline: paged history + SSE live tail ──
  fastify.get('/sessions/:id/events', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id: sessionId } = request.params as { id: string };
    const query = request.query as Record<string, unknown>;
    const accept = typeof request.headers.accept === 'string' ? request.headers.accept : '';
    const streaming = accept.includes('text/event-stream') || query.stream === 'true' || query.stream === '1';

    if (!streaming) {
      // Paged history (cursor-based: sequence is the cursor — stable, monotonic per session).
      try {
        if (wantsRefresh(query)) projectPending(db, { projection: 'transcript-timeline' });
        const limit = boundedLimit(query.limit, 200, 1000);
        const afterSequence = parseSequence(query.afterSequence);
        const rows = readTimelinePage(db, sessionId, afterSequence, limit + 1);
        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        return {
          data: page,
          cursor: {
            afterSequence,
            nextAfterSequence: page.length > 0 ? page[page.length - 1].sequence : afterSequence,
            hasMore,
          },
          projection: projectionMeta(db, 'transcript-timeline'),
        };
      } catch (error) {
        return fail(reply, 'session_events', error);
      }
    }

    // SSE live tail. The timeline projection IS the replay buffer, so
    // Last-Event-ID resume actually replays (the skill's "honored but no
    // buffer" anti-pattern is structurally impossible here).
    try {
      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      raw.write('retry: 5000\n\n');

      // Resume point: Last-Event-ID (WHATWG) wins, else ?afterSequence, else full replay.
      let lastSequence: number = parseSequence(query.afterSequence) ?? -1;
      const lastEventId = request.headers['last-event-id'];
      if (typeof lastEventId === 'string' && lastEventId) {
        ensureProjectionSchema(db);
        const row = db
          .prepare('SELECT sequence FROM harbor_proj_timeline WHERE session_id = ? AND event_id = ?')
          .get(sessionId, lastEventId) as { sequence: number } | undefined;
        if (row) lastSequence = row.sequence;
      }

      const drain = (): void => {
        projectPending(db, { projection: 'transcript-timeline' });
        for (;;) {
          const rows = readTimelinePage(db, sessionId, lastSequence, 500);
          if (rows.length === 0) break;
          for (const row of rows) {
            sseWrite(raw, row);
            lastSequence = row.sequence;
          }
        }
      };

      drain(); // initial replay from the resume point
      raw.write('event: caught-up\ndata: {"status":"live"}\n\n');

      const poll = setInterval(() => {
        try {
          drain();
        } catch (error) {
          logger.error('agent_harbor_sse_poll_failed', { error: (error as Error).message });
        }
      }, pollMs);
      const heartbeat = setInterval(() => {
        raw.write(': keep-alive\n\n');
      }, heartbeatMs);
      const timeout = setTimeout(() => {
        cleanup();
        raw.write('event: timeout\ndata: {"reason":"connection timeout"}\n\n');
        raw.end();
      }, connectionTimeoutMs);

      let done = false;
      const cleanup = (): void => {
        if (done) return;
        done = true;
        clearInterval(poll);
        clearInterval(heartbeat);
        clearTimeout(timeout);
      };
      request.raw.on('close', () => {
        cleanup();
        logger.info('agent_harbor_sse_disconnected', { sessionId });
      });
      logger.info('agent_harbor_sse_connected', { sessionId });
      return;
    } catch (error) {
      metrics.errors++;
      logger.error('agent_harbor_sse_failed', { error: (error as Error).message });
      try {
        reply.raw.end();
      } catch {
        /* already gone */
      }
      return;
    }
  });

  // ── GET /costs — cost projection, optionally per node ──
  fastify.get('/costs', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = request.query as Record<string, unknown>;
      if (wantsRefresh(query)) projectPending(db, { projection: 'costs' });
      const agentNodeId = typeof query.agentNodeId === 'string' && query.agentNodeId ? query.agentNodeId : undefined;
      const costs = getCostSummary(db, agentNodeId ? { agentNodeId } : {});
      return {
        data: costs.rows,
        projection: {
          name: 'costs',
          stale: costs.stale,
          lastLedgerSeq: costs.lastLedgerSeq,
          headSeq: costs.headSeq,
        } satisfies ProjectionMeta,
      };
    } catch (error) {
      return fail(reply, 'costs', error);
    }
  });

  // ── GET /receipts/:id — Work Receipt + hash-chain verification ──
  fastify.get('/receipts/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const query = request.query as Record<string, unknown>;
      if (wantsRefresh(query)) projectPending(db, { projection: 'work-receipts' });
      ensureProjectionSchema(db);
      const receipt = db
        .prepare('SELECT * FROM harbor_proj_work_receipts WHERE receipt_id = ?')
        .get(id) as Record<string, unknown> | undefined;
      if (!receipt) {
        reply.code(404);
        return { error: `receipt ${id} not found`, code: 'RECEIPT_NOT_FOUND' };
      }

      // Verify against the LEDGER (source of truth), not the projection: the
      // per-session hash chain must be intact and the receipt's committed
      // transcript head must equal the ledger's actual chain head.
      const sessionId = typeof receipt.session_id === 'string' ? receipt.session_id : null;
      let chainBrokenAt: Record<string, unknown> | null = null;
      let ledgerHeadHash: string | null = null;
      if (sessionId) {
        const broken = verifySessionChain(db, sessionId);
        chainBrokenAt = broken ? { ...broken } : null;
        // Chain head via a single ORDER BY ledger_seq DESC LIMIT 1 read — a
        // bounded bulk load would compute the wrong head for very long sessions.
        ledgerHeadHash = sessionChainHeadHash(db, sessionId);
      }
      const receiptHeadHash =
        typeof receipt.transcript_head_hash === 'string' ? receipt.transcript_head_hash : null;
      const chainIntact = sessionId !== null && chainBrokenAt === null;
      const headHashMatch =
        chainIntact && receiptHeadHash !== null && ledgerHeadHash !== null && receiptHeadHash === ledgerHeadHash;

      return {
        data: {
          receipt,
          verification: {
            chainIntact,
            chainBrokenAt,
            headHashMatch,
            receiptHeadHash,
            ledgerHeadHash,
            verified: chainIntact && headHashMatch,
          },
        },
        projection: projectionMeta(db, 'work-receipts'),
      };
    } catch (error) {
      return fail(reply, 'receipt', error);
    }
  });

  // ── GET /blackboard — the READ-ONLY M6 blackboard (binder ch05; ADR-0097 §5) ──
  //
  // One legible read surface over BlackboardItem cards: explicit Longshoreman
  // assertions from the ledger, active claims, contested-file conflict
  // warnings, and recent compaction/receipt events. GET only, deliberately:
  // ch05 defers blackboard write/parley semantics to Milestone 8, so this
  // route family gains no POST/PUT/DELETE for the blackboard — a write
  // attempt 404s because no write route exists, which is the honest answer.
  //
  // `?refresh` is accepted-and-ignored (tolerant reader): the blackboard reads
  // the ledger head directly at request time, so there is no projection
  // checkpoint to catch up — the envelope says exactly that.
  fastify.get('/blackboard', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = request.query as Record<string, unknown>;
      const board = getBlackboard(db, {
        ...(typeof query.kind === 'string' && query.kind ? { kind: query.kind } : {}),
        ...(typeof query.sessionId === 'string' && query.sessionId ? { sessionId: query.sessionId } : {}),
        ...(typeof query.agentNodeId === 'string' && query.agentNodeId
          ? { agentNodeId: query.agentNodeId }
          : {}),
        limit: boundedLimit(query.limit, 100, 500),
      });
      return {
        data: board.items,
        // A misbehaving asserter is visible, never silently absorbed.
        droppedInvalid: board.droppedInvalid,
        generatedAt: board.generatedAt,
        projection: {
          name: 'blackboard',
          // Read-at-head view: no materialized checkpoint exists to go stale.
          stale: false,
          lastLedgerSeq: board.headSeq,
          headSeq: board.headSeq,
        },
      };
    } catch (error) {
      return fail(reply, 'blackboard', error);
    }
  });

  // ── GET /compliance/:agentNodeId — daemon-witnessed compliance record ──
  fastify.get('/compliance/:agentNodeId', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { agentNodeId } = request.params as { agentNodeId: string };
      const query = request.query as Record<string, unknown>;
      if (wantsRefresh(query)) projectPending(db, { projection: 'compliance' });
      const compliance = getCompliance(db, agentNodeId);
      if (compliance.rows.length === 0) {
        reply.code(404);
        return {
          error: `no compliance probe recorded for agent node ${agentNodeId}`,
          code: 'COMPLIANCE_NOT_FOUND',
        };
      }
      return {
        data: compliance.rows[0],
        projection: {
          name: 'compliance',
          stale: compliance.stale,
          lastLedgerSeq: compliance.lastLedgerSeq,
          headSeq: compliance.headSeq,
        } satisfies ProjectionMeta,
      };
    } catch (error) {
      return fail(reply, 'compliance', error);
    }
  });
};
