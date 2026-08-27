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
import { randomUUID } from 'node:crypto';
import type { DatabaseInstance } from '../lib/sqlite-runtime.js';
import type { DaemonBerthIdentity } from '../shared/daemon-berths.js';
import { getBlackboard } from '../lib/agent-harbor/blackboard.js';
import {
  ensureEventLedgerSchema,
  sessionChainHeadHash,
  verifySessionChain,
} from '../lib/agent-harbor/event-ledger.js';
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
import {
  surfaceGatewayCapabilityProjection,
  validateSurfaceGatewayEnvelope,
} from '../lib/agent-harbor/surface-gateway.js';
import {
  dispatchIdForWorkIntent,
  type WorkIntentService,
  type WorkIntentSnapshot,
} from '../lib/agent-harbor/work-intent-service.js';
import type { DispatchQueue } from '../lib/dispatch/queue.js';
import type { DispatchWorker } from '../lib/dispatch/worker.js';
import {
  createDefaultCommandRunner,
  fetchPrInfo,
  type PrInfo,
} from '../lib/dispatch/auto-merge.js';
import {
  buildHarnessContinuationMatrix,
  collectHarnessConformanceWitnesses,
} from '../lib/harness-conformance.js';
import { listContextContinuity } from '../lib/agent-harbor/context-continuity.js';

interface AgentHarborRouteDeps {
  db: DatabaseInstance;
  workIntentService?: WorkIntentService;
  dispatchQueue?: DispatchQueue;
  dispatchWorker?: DispatchWorker;
  missionArtifactStatus?: (url: string) => Promise<PrInfo>;
  daemonBerth?: DaemonBerthIdentity;
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

/** One restart-safe mission projection for operator surfaces. */
function projectMissionExecution(snapshot: WorkIntentSnapshot, queue?: DispatchQueue) {
  if (!queue) return null;
  const dispatchId = snapshot.intent.compat?.dispatchId
    ?? dispatchIdForWorkIntent(snapshot.intent.intentId);
  const dispatch = queue.get(dispatchId);
  if (!dispatch) return null;
  return {
    projection: 'governed-mission',
    dispatchId: dispatch.id,
    state: dispatch.state,
    launchId: dispatch.launchId,
    agentId: dispatch.agentId,
    transcriptId: dispatch.transcriptId,
    backend: dispatch.backend,
    model: dispatch.model,
    sessionId: dispatch.sessionId,
    worktreePath: dispatch.worktreePath,
    branch: dispatch.branch,
    resultArtifact: dispatch.resultArtifact,
    costUsd: dispatch.costUsd,
    errorMessage: dispatch.errorMessage,
    createdAt: dispatch.createdAt,
    claimedAt: dispatch.claimedAt,
    startedAt: dispatch.startedAt,
    producedAt: dispatch.producedAt,
    settledAt: dispatch.settledAt,
  };
}

function projectMissionSnapshot(snapshot: WorkIntentSnapshot, queue?: DispatchQueue) {
  return { ...snapshot, execution: projectMissionExecution(snapshot, queue) };
}

const missionArtifactRunner = createDefaultCommandRunner();
const missionArtifactCache = new Map<string, { fetchedAt: number; status: PrInfo }>();
const MISSION_ARTIFACT_CACHE_MS = 15_000;

async function defaultMissionArtifactStatus(url: string): Promise<PrInfo> {
  const cached = missionArtifactCache.get(url);
  if (cached && Date.now() - cached.fetchedAt < MISSION_ARTIFACT_CACHE_MS) {
    return cached.status;
  }
  const status = await fetchPrInfo(url, missionArtifactRunner);
  missionArtifactCache.set(url, { fetchedAt: Date.now(), status });
  return status;
}

async function projectMissionSnapshotWithArtifact(
  snapshot: WorkIntentSnapshot,
  queue: DispatchQueue | undefined,
  includeArtifactStatus: boolean,
  statusProvider: (url: string) => Promise<PrInfo>,
) {
  const projected = projectMissionSnapshot(snapshot, queue);
  if (!includeArtifactStatus || !projected.execution?.resultArtifact) return projected;
  return {
    ...projected,
    execution: {
      ...projected.execution,
      artifactStatus: await statusProvider(projected.execution.resultArtifact),
    },
  };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLoopback(address: string): boolean {
  const normalized = address.replace(/^::ffff:/, '');
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost';
}

function gatewayBerthTarget(berth?: DaemonBerthIdentity) {
  const tier = berth?.tier ?? 'stable';
  const canonical = berth?.canonical ?? tier === 'stable';
  const domain = tier === 'stable'
    ? 'canonical-local'
    : tier === 'dev-latest'
      ? 'dev-lane'
      : 'worktree-lane';
  return {
    targetId: `berth_target_${tier}_${berth?.port ?? 'local'}`,
    tier,
    label: berth?.label ?? tier,
    canonical,
    authority: {
      domain,
      canCommand: true,
      canQuery: true,
      canSubscribeEvents: true,
    },
  } as const;
}

function ledgerHead(db: DatabaseInstance): number {
  ensureEventLedgerSchema(db);
  const row = db.prepare('SELECT COALESCE(MAX(ledger_seq), 0) AS head FROM harbor_events').get() as
    | { head: number }
    | undefined;
  return row?.head ?? 0;
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

  // ── GET /agent-harbor/surface-gateway/capabilities ──
  //
  // Read-only discovery for the one command/query/event envelope family.
  // This does not dispatch commands; it tells native surfaces, CLI, MCP, and
  // tests which v0 nouns, modes, authority checks, and bus targets the daemon
  // expects before the mutating gateway ingress route lands.
  fastify.get(
    '/agent-harbor/surface-gateway/capabilities',
    async () => surfaceGatewayCapabilityProjection({ mounted: true }),
  );

  fastify.get('/harness-adapters/continuation-matrix', async (_request, reply) => {
    try {
      const witnesses = collectHarnessConformanceWitnesses(db);
      return { data: buildHarnessContinuationMatrix({ witnesses }) };
    } catch (error) {
      return fail(reply, 'harness_continuation_matrix', error);
    }
  });

  // Operator proof for the formerly disconnected context-memory chain. This
  // is a disposable CQRS projection: the append-only context/packet events
  // and idempotent continuation receipts remain the source evidence.
  fastify.get('/agent-harbor/context-continuity', async (request, reply) => {
    try {
      const query = request.query as Record<string, unknown>;
      const parsed = typeof query.limit === 'string' ? Number.parseInt(query.limit, 10) : 50;
      const limit = Number.isFinite(parsed) ? parsed : 50;
      const projectDir = typeof query.projectDir === 'string' && query.projectDir.trim()
        ? query.projectDir.trim()
        : null;
      return listContextContinuity(db, { limit, projectDir });
    } catch (error) {
      return fail(reply, 'context_continuity', error);
    }
  });

  // ── POST /agent-harbor/surface-gateway ──
  //
  // One ingress for native surface commands and queries. The daemon, not the
  // caller, binds the actual berth, projection freshness, and allow decision.
  // WorkIntent.start is the only executable surface command: it materializes
  // the durable intent into the existing compatibility queue and nudges the
  // Conductor-backed worker. The compatibility projection is returned in the
  // receipt and never becomes a second frontend launch vocabulary.
  fastify.post('/agent-harbor/surface-gateway', async (request, reply) => {
    const raw = request.body;
    if (!isRecord(raw)) {
      reply.code(400);
      return { code: 'SURFACE_GATEWAY_REJECTED', errors: ['surface gateway request must be an object'] };
    }
    if (!isLoopback(request.ip)) {
      reply.code(403);
      return {
        code: 'SURFACE_GATEWAY_REMOTE_AUTH_REQUIRED',
        error: 'remote Surface Gateway ingress is unavailable without device/account authority',
      };
    }

    const now = new Date();
    const target = gatewayBerthTarget(opts.deps.daemonBerth);
    const head = ledgerHead(db);
    const operation = typeof raw.operation === 'string' ? raw.operation : '';
    const surface = typeof raw.surface === 'string' ? raw.surface : '';
    const mode = typeof raw.mode === 'string' ? raw.mode : '';
    const admitted = {
      ...raw,
      surfaceIssuedAt: raw.issuedAt,
      issuedAt: now.toISOString(),
      berthTarget: target,
      projection: { stale: false, lastLedgerSeq: head, headSeq: head },
      ...(mode === 'command'
        ? {
            capabilityDecision: {
              schema: 'pd.agent-harbor.capability-decision.v0',
              decisionId: `cap_decision_${randomUUID()}`,
              agentNodeId: null,
              runId: null,
              bodyId: null,
              surface,
              operation,
              capability: 'work-intent',
              decision: 'allow',
              authority: {
                domain: 'policy',
                decidedBy: 'daemon:local-surface-gateway',
                leaseId: null,
              },
              reason: 'A local operator surface may command a WorkIntent on the addressed daemon berth.',
              evidence: { berthTargetId: target.targetId },
              issuedAt: now.toISOString(),
              expiresAt: new Date(now.getTime() + 30_000).toISOString(),
            },
          }
        : {}),
    };
    const validation = validateSurfaceGatewayEnvelope(admitted);
    if (!validation.ok) {
      reply.code(400);
      return { code: 'SURFACE_GATEWAY_REJECTED', errors: validation.errors };
    }
    if (validation.envelope.noun !== 'WorkIntent') {
      reply.code(501);
      return {
        code: 'SURFACE_GATEWAY_OPERATION_UNSUPPORTED',
        error: `${validation.envelope.noun} ${validation.envelope.operation} has no daemon-owned runtime service yet`,
      };
    }
    if (!opts.deps.workIntentService) {
      reply.code(503);
      return {
        code: 'WORK_INTENT_SERVICE_UNAVAILABLE',
        error: 'WorkIntent service is unavailable; no side effect was started',
        correlationId: validation.envelope.correlationId ?? validation.envelope.envelopeId,
      };
    }

    if (validation.envelope.mode === 'query') {
      const payload = validation.envelope.payload as Record<string, unknown>;
      const includeArtifactStatus = payload.includeArtifactStatus === true;
      const statusProvider = opts.deps.missionArtifactStatus ?? defaultMissionArtifactStatus;
      if (validation.envelope.operation === 'work-intent.list') {
        const limit = typeof payload.limit === 'number' ? payload.limit : 100;
        return {
          schema: 'pd.agent-harbor.surface-gateway.query-result.v0',
          correlationId: validation.envelope.correlationId ?? validation.envelope.envelopeId,
          data: await Promise.all(opts.deps.workIntentService
            .list(limit)
            .map((snapshot) => projectMissionSnapshotWithArtifact(
              snapshot,
              opts.deps.dispatchQueue,
              includeArtifactStatus,
              statusProvider,
            ))),
          projection: validation.envelope.projection,
        };
      }
      if (validation.envelope.operation === 'work-intent.get') {
        const intentId = typeof payload.intentId === 'string' ? payload.intentId : '';
        const snapshot = intentId ? opts.deps.workIntentService.get(intentId) : null;
        if (!snapshot) {
          reply.code(404);
          return { code: 'WORK_INTENT_NOT_FOUND', error: `WorkIntent ${intentId || '(missing id)'} not found` };
        }
        return {
          schema: 'pd.agent-harbor.surface-gateway.query-result.v0',
          correlationId: validation.envelope.correlationId ?? validation.envelope.envelopeId,
          data: await projectMissionSnapshotWithArtifact(
            snapshot,
            opts.deps.dispatchQueue,
            includeArtifactStatus,
            statusProvider,
          ),
          projection: validation.envelope.projection,
        };
      }
      reply.code(501);
      return {
        code: 'SURFACE_GATEWAY_OPERATION_UNSUPPORTED',
        error: `WorkIntent query ${validation.envelope.operation} is not implemented`,
      };
    }

    if (
      validation.envelope.mode !== 'command'
      || !['work-intent.capture', 'work-intent.start'].includes(validation.envelope.operation)
    ) {
      reply.code(501);
      return {
        code: 'SURFACE_GATEWAY_OPERATION_UNSUPPORTED',
        error: `WorkIntent ${validation.envelope.mode} ${validation.envelope.operation} is not implemented`,
      };
    }

    const payload = validation.envelope.payload as Record<string, unknown>;
    if (validation.envelope.operation === 'work-intent.start') {
      const intentId = typeof payload.intentId === 'string' ? payload.intentId.trim() : '';
      if (!intentId) {
        reply.code(400);
        return {
          code: 'WORK_INTENT_PAYLOAD_REJECTED',
          error: 'WorkIntent start requires payload.intentId',
        };
      }
      if (!opts.deps.dispatchQueue || !opts.deps.dispatchWorker) {
        reply.code(503);
        return {
          code: 'WORK_INTENT_RUNTIME_UNAVAILABLE',
          error: 'The addressed daemon has no governed WorkIntent runtime worker; no side effect was started',
          correlationId: validation.envelope.correlationId ?? validation.envelope.envelopeId,
        };
      }
      const snapshot = opts.deps.workIntentService.get(intentId);
      if (!snapshot) {
        reply.code(404);
        return { code: 'WORK_INTENT_NOT_FOUND', error: `WorkIntent ${intentId} not found` };
      }
      try {
        const started = opts.deps.workIntentService.start(intentId, opts.deps.dispatchQueue);
        let launchedThisTick = 0;
        if (started.dispatch.state === 'proposed') {
          launchedThisTick = await opts.deps.dispatchWorker.poll();
        }
        const execution = projectMissionExecution(started, opts.deps.dispatchQueue);
        reply.code(started.duplicate ? 200 : 202);
        return {
          schema: 'pd.agent-harbor.surface-gateway.command-receipt.v0',
          correlationId: validation.envelope.correlationId ?? validation.envelope.envelopeId,
          status: started.duplicate ? 'confirmed' : 'accepted',
          duplicate: started.duplicate,
          intent: started.intent,
          plan: started.plan,
          execution: {
            ...(execution ?? {
              projection: 'governed-mission',
              dispatchId: started.dispatch.id,
              state: started.dispatch.state,
            }),
            launchedThisTick,
          },
          nextAction: {
            code: 'WORK_RUNTIME_STARTED',
            message:
              'Port Daddy accepted this mission. Its exact running agent, live output, checks, artifacts, and PR remain attached to this mission.',
          },
        };
      } catch (error) {
        return fail(reply, 'surface_gateway_work_intent_start', error);
      }
    }

    if (
      !isRecord(payload.source)
      || !isRecord(payload.goal)
      || typeof payload.goal.text !== 'string'
      || payload.goal.text.trim().length === 0
    ) {
      reply.code(400);
      return {
        code: 'WORK_INTENT_PAYLOAD_REJECTED',
        error: 'WorkIntent capture requires a structured source and a non-empty goal.text',
      };
    }
    const source = payload.source;
    const goal = payload.goal;
    if (payload.idempotencyKey !== validation.idempotency.key) {
      reply.code(400);
      return {
        code: 'WORK_INTENT_IDEMPOTENCY_MISMATCH',
        error: 'WorkIntent payload idempotencyKey must match the Surface Gateway command key',
      };
    }
    if (validation.envelope.surface === 'pd-console') {
      if (source.kind !== 'console' || source.legacyVerb != null) {
        reply.code(400);
        return {
          code: 'WORK_INTENT_SOURCE_REJECTED',
          error: 'pd-console creates console-sourced WorkIntent records; legacy launch verbs are not runtime commands',
        };
      }
      const constraints = isRecord(payload.constraints) ? payload.constraints : {};
      const providerOwnedFields = ['backend', 'body', 'bodyPreference', 'model', 'provider'];
      const suppliedProviderField = providerOwnedFields.find(
        (field) => payload[field] != null || constraints[field] != null,
      );
      if (suppliedProviderField) {
        reply.code(400);
        return {
          code: 'WORK_INTENT_PROVIDER_AUTHORITY_REJECTED',
          error: `pd-console cannot choose ${suppliedProviderField}; provider and body attachment belong to the daemon planner and Squid harness`,
        };
      }
      const materializationFields = ['agentNode', 'agentRun', 'nodeSpecs', 'run'];
      const suppliedMaterializationField = materializationFields.find((field) => payload[field] != null);
      if (suppliedMaterializationField) {
        reply.code(400);
        return {
          code: 'WORK_INTENT_MATERIALIZATION_AUTHORITY_REJECTED',
          error: `pd-console cannot author ${suppliedMaterializationField}; AgentNode and AgentRun materialization belong to the daemon planner`,
        };
      }
    }

    try {
      const captured = opts.deps.workIntentService.captureWithInitialPlan({
        intentId: payload.intentId as string,
        idempotencyKey: validation.idempotency.key!,
        source: source as Parameters<WorkIntentService['capture']>[0]['source'],
        goalText: goal.text as string,
        contextRefs: Array.isArray(goal.contextRefs)
          ? goal.contextRefs.filter(isRecord)
          : undefined,
        constraints: isRecord(payload.constraints) ? payload.constraints : undefined,
        startPolicy: payload.startPolicy as Parameters<WorkIntentService['capture']>[0]['startPolicy'],
        attachExisting: payload.attachExisting === true,
        operator: typeof payload.operator === 'string' ? payload.operator : undefined,
        status: payload.status as Parameters<WorkIntentService['capture']>[0]['status'],
        createdAt: payload.createdAt as string,
      });
      reply.code(captured.append.duplicate && captured.planAppend.duplicate ? 200 : 202);
      return {
        schema: 'pd.agent-harbor.surface-gateway.command-receipt.v0',
        correlationId: validation.envelope.correlationId ?? validation.envelope.envelopeId,
        status: captured.append.duplicate && captured.planAppend.duplicate ? 'confirmed' : 'accepted',
        duplicate: captured.append.duplicate && captured.planAppend.duplicate,
        intent: captured.intent,
        plan: captured.plan,
        ledger: {
          intentSeq: captured.append.ledgerSeq,
          planSeq: captured.planAppend.ledgerSeq,
        },
        nextAction: {
          code: 'WORK_PLANNER_REQUIRED',
          message:
            'Intent is durable. Execution is blocked until the daemon can shape and materialize a governed WorkPlan through AgentNode/AgentRun.',
        },
      };
    } catch (error) {
      return fail(reply, 'surface_gateway_work_intent', error);
    }
  });

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
