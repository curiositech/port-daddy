/**
 * Spawn Routes — AI Agent Launcher
 *
 * POST /spawn        — launch an AI agent, body: SpawnSpec, returns SpawnResult
 * GET  /spawn        — list active spawned agents
 * DELETE /spawn/:id  — cancel a spawned agent and retain its evidence
 */

import type { FastifyPluginAsync } from 'fastify';
import type { BackendOverrideSource, SpawnAccepted, SpawnResult, SpawnSpec, Spawner } from '../lib/spawner.js';
import { assessSpawnPreflight } from '../lib/spawn-preflight.js';
import type { CostTracker } from '../lib/cost-tracker.js';
import { resolveFleetAgentRuntime, type FleetModelTier, type FleetRuntimeTarget } from '../lib/fleet-runtime.js';
import { validateChannel } from '../shared/validators.js';
import { KNOWN_BACKEND_IDS } from '../lib/backend-catalog.js';
import type Database from 'better-sqlite3';
import {
  AGENT_RUN_LIVE_EVIDENCE_MAX_AGE_MS,
  AgentRunIdempotencyConflictError,
  TERMINAL_AGENT_RUN_STATUSES,
  agentRunStatusForSpawnResult,
  createAgentRunReceiptStore,
  type AgentRunReceipt,
} from '../lib/agent-run-receipts.js';

interface SpawnRouteDeps {
  spawner: Spawner;
  db: Database.Database;
  costTracker?: CostTracker;
  metrics: { errors: number };
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
}

// The backend-id set is declared ONCE in lib/backend-catalog.ts
// (BACKEND_CATALOG / KNOWN_BACKEND_IDS) — this used to be a hand-maintained
// duplicate that drifted from routes/sorties.ts, cli/commands/spawn.ts, and
// lib/spawner.ts's own list (ADR-0057 model-abstraction unification).
const VALID_BACKENDS = KNOWN_BACKEND_IDS;

function backendOverrideSourceFromPreflight(source: unknown, forced: boolean): BackendOverrideSource {
  if (!forced) return 'none';
  if (source === 'env') return 'env';
  if (source === 'persisted') return 'persisted';
  return 'preflight';
}

function isFleetModelTier(value: unknown): value is FleetModelTier {
  return value === 'low' || value === 'mid' || value === 'high';
}

function requestedModelFromRequest(
  backend: string,
  model: unknown,
  modelTier: unknown,
): string | undefined {
  if (typeof model === 'string' && model.trim()) return model;
  if (!isFleetModelTier(modelTier)) return undefined;
  return resolveFleetAgentRuntime({ backend, modelTier }).model ?? undefined;
}

// ==========================================================================
// Fastify plugin (dual-export)
// ==========================================================================
export const spawnPlugin: FastifyPluginAsync<{ deps: SpawnRouteDeps }> = async (fastify, opts) => {
  const { metrics, logger, spawner, costTracker, db } = opts.deps;
  // Recovery is idempotent: sessionsPlugin also opens this shared ledger so a
  // standalone spawnPlugin and the full daemon both fail honest after restart.
  const receipts = createAgentRunReceiptStore(db);
  const pendingAdmissions = new Map<string, Promise<void>>();

  const receiptMonitorUrl = (receipt: AgentRunReceipt) => `/spawn/receipts/${encodeURIComponent(receipt.id)}`;

  fastify.post('/spawn/preflight', async (request, reply) => {
    try {
      const body = (request.body as Record<string, unknown>) || {};
      const fallbacks = Array.isArray(body.fallbacks)
        ? (body.fallbacks.filter((value): value is FleetRuntimeTarget => !!value && typeof value === 'object'))
        : undefined;
      const budgetUsd = typeof body.budgetUsd === 'number'
        ? body.budgetUsd
        : typeof body.budgetUsd === 'string' && body.budgetUsd.trim()
          ? parseFloat(body.budgetUsd)
          : undefined;
      const parsedBudgetUsd = Number.isFinite(budgetUsd) ? budgetUsd : undefined;

      const preflight = await assessSpawnPreflight({
        backend: typeof body.backend === 'string' ? body.backend : undefined,
        model: typeof body.model === 'string' ? body.model : undefined,
        modelTier: typeof body.modelTier === 'string' ? body.modelTier as FleetModelTier : undefined,
        fallbacks,
        identity: typeof body.identity === 'string' ? body.identity : undefined,
        ...(parsedBudgetUsd === undefined ? {} : { budgetUsd: parsedBudgetUsd }),
      }, { costTracker });

      return { success: true, ...preflight };
    } catch (error) {
      metrics.errors++;
      logger.error('spawn_preflight_error', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // POST /spawn — Launch an AI agent
  fastify.post('/spawn', async (request, reply) => {
    try {
      const {
        backend,
        name,
        model,
        modelTier,
        identity,
        purpose,
        task,
        files,
        workdir,
        env,
        deadlineMs,
        transportTimeoutMs,
        allowedTools,
        maxTokens,
        permissionMode,
        injectSquidHooks,
        tubeChannel,
        budgetUsd: rawBudgetUsd,
      } = request.body as any;

      if (!backend || typeof backend !== 'string') {
        reply.code(400); return {
          success: false,
          error: 'backend is required. Valid values: ollama, claude, claude-cli, gemini, cloudflare, codex, aider, custom',
          code: 'VALIDATION_ERROR',
        };
      }

      if (!VALID_BACKENDS.has(backend)) {
        reply.code(400); return {
          success: false,
          error: `Invalid backend "${backend}". Valid values: ${[...VALID_BACKENDS].join(', ')}`,
          code: 'VALIDATION_ERROR',
        };
      }

      if (!task || typeof task !== 'string' || !task.trim()) {
        reply.code(400); return {
          success: false,
          error: 'task is required and must be a non-empty string',
          code: 'VALIDATION_ERROR',
        };
      }

      if (typeof task === 'string' && task.length > 100000) {
        reply.code(400); return {
          success: false,
          error: 'task must not exceed 100000 characters',
          code: 'VALIDATION_ERROR',
        };
      }

      if (backend === 'custom' && /[;&|`$(){}!<>]/.test(task as string)) {
        reply.code(400); return {
          success: false,
          error: 'Custom backend task contains shell metacharacters. Use explicit arguments instead of shell syntax.',
          code: 'VALIDATION_ERROR',
        };
      }

      if (tubeChannel !== undefined && tubeChannel !== null) {
        const channelValidation = validateChannel(tubeChannel);
        if (!channelValidation.valid) {
          reply.code(400); return {
            success: false,
            error: `tubeChannel ${channelValidation.error}`,
            code: 'VALIDATION_ERROR',
          };
        }
      }

      // workdir is interpolated into the Coast Guard's OS-sandbox profile
      // (lib/coast-guard.ts buildSeatbeltProfile → `(subpath "<workdir>")`). A
      // quote/backslash/newline/NUL in it is an SBPL-injection vector (#339), so
      // reject it at the boundary — same posture as `task`'s metachar check.
      // We also require an absolute path: the sandbox confines an absolute root,
      // and a relative workdir is ambiguous against the daemon's cwd.
      if (workdir !== undefined && workdir !== null) {
        if (typeof workdir !== 'string' || !workdir.trim()) {
          reply.code(400); return {
            success: false,
            error: 'workdir must be a non-empty string',
            code: 'VALIDATION_ERROR',
          };
        }
        if (/["\\\n\r\0]/.test(workdir)) {
          reply.code(400); return {
            success: false,
            error: 'workdir contains an illegal character (quote, backslash, newline, or NUL). Provide a plain absolute path.',
            code: 'VALIDATION_ERROR',
          };
        }
        if (!workdir.startsWith('/')) {
          reply.code(400); return {
            success: false,
            error: 'workdir must be an absolute path (start with "/").',
            code: 'VALIDATION_ERROR',
          };
        }
      }

      const parsedBudgetUsd = typeof rawBudgetUsd === 'number'
        ? rawBudgetUsd
        : typeof rawBudgetUsd === 'string' && rawBudgetUsd.trim()
          ? parseFloat(rawBudgetUsd)
          : undefined;
      const validBudgetUsd = Number.isFinite(parsedBudgetUsd) ? parsedBudgetUsd : undefined;
      const preflight = await assessSpawnPreflight({
        backend,
        model,
        modelTier: typeof modelTier === 'string' ? modelTier as FleetModelTier : undefined,
        identity,
        ...(validBudgetUsd === undefined ? {} : { budgetUsd: validBudgetUsd }),
      }, { costTracker });

      if (!preflight.launchReady) {
        reply.code(400);
        return {
          success: false,
          error: preflight.blockedReasons[0] || 'spawn preflight failed',
          code: 'PRECONDITION_FAILED',
          preflight,
        };
      }

      const selectedAttempt = preflight.attempts[0];
      const effectiveBackend = selectedAttempt?.backend || backend;
      const backendWasForced = effectiveBackend !== backend;
      const spec: SpawnSpec = {
        backend: effectiveBackend as SpawnSpec['backend'],
        task: task.trim(),
      };
      if (validBudgetUsd !== undefined) spec.budgetUsd = validBudgetUsd;
      if (backendWasForced) {
        spec.requestedBackend = backend as SpawnSpec['backend'];
        spec.requestedModel = requestedModelFromRequest(backend, model, modelTier);
        spec.backendOverrideSource = backendOverrideSourceFromPreflight(selectedAttempt?.backendSource, true);
      }

      if (!backendWasForced && model && typeof model === 'string') spec.model = model;
      else if (preflight.attempts[0]?.model) spec.model = preflight.attempts[0].model;
      if (name && typeof name === 'string') spec.name = name;
      if (!backendWasForced && typeof modelTier === 'string') spec.modelTier = modelTier as FleetModelTier;
      else if (preflight.attempts[0]?.modelTier) spec.modelTier = preflight.attempts[0].modelTier as FleetModelTier;
      if (identity && typeof identity === 'string') spec.identity = identity;
      if (purpose && typeof purpose === 'string') spec.purpose = purpose;
      if (Array.isArray(files)) spec.files = files as string[];
      if (workdir && typeof workdir === 'string') spec.workdir = workdir;
      if (env && typeof env === 'object' && !Array.isArray(env)) spec.env = env as Record<string, string>;
      if (typeof deadlineMs === 'number' && Number.isFinite(deadlineMs) && deadlineMs > 0) {
        spec.deadlineMs = Math.floor(deadlineMs);
      }
      if (typeof transportTimeoutMs === 'number' && Number.isFinite(transportTimeoutMs) && transportTimeoutMs > 0) {
        spec.transportTimeoutMs = Math.floor(transportTimeoutMs);
      }
      if (allowedTools && typeof allowedTools === 'string') spec.allowedTools = allowedTools;
      if (maxTokens && typeof maxTokens === 'number') spec.maxTokens = maxTokens;
      if (typeof tubeChannel === 'string') spec.tubeChannel = tubeChannel;
      // File-edit permission mode for the cli:claude-code backend. Only the three
      // CLI-recognised modes are accepted; anything else is ignored (the spawner
      // forwards it verbatim as --permission-mode, so the boundary validates it).
      if (permissionMode === 'default' || permissionMode === 'acceptEdits' || permissionMode === 'bypassPermissions') {
        spec.permissionMode = permissionMode;
      }
      // Giant Squid Harness opt-in (ADR-0091). Default false → backward-compatible:
      // an absent/false flag leaves the spawn byte-for-byte unchanged. When true,
      // the spawner's runClaudeCli (lib/spawner.ts) FIRST injects the pd-hook-*
      // tentacles into the workspace's .claude/settings.json, so a conjure-
      // dispatched vendor CLI runs UNDER PD coordination — its UserPromptSubmit /
      // PreToolUse / PostToolUse turns fire the lock gate + pheromone hooks inside
      // Claude Code's own loop (Claude Max Prime). The conjurer's Dispatch sets
      // this true (console DaemonClient::spawn with SpawnOpts::squid). codex /
      // gemini remain validate-then-add: their squid adapters throw, so the flag
      // is a harmless no-op for those backends until those adapters are written.
      if (injectSquidHooks === true) {
        spec.injectSquidHooks = true;
      }

      logger.info('spawn_start', {
        backend,
        model: spec.model || null,
        identity: spec.identity || null,
        purpose: spec.purpose || null,
      });

      const prefer = String(request.headers.prefer || '').toLowerCase();
      const respondAsync = prefer.split(',').some((token) => token.trim() === 'respond-async');
      let durableReceipt: AgentRunReceipt | null = null;
      if (respondAsync) {
        const rawKey = request.headers['idempotency-key'];
        const idempotencyKey = Array.isArray(rawKey) ? rawKey[0] : rawKey;
        if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
          reply.code(400);
          return {
            success: false,
            error: 'Idempotency-Key is required for asynchronous spawn admission',
            code: 'IDEMPOTENCY_KEY_REQUIRED',
          };
        }
        try {
          const admission = receipts.accept({
            idempotencyKey,
            kind: 'spawn',
            request: spec,
            budgetUsd: spec.budgetUsd ?? null,
          });
          durableReceipt = admission.receipt;
          if (admission.replayed) {
            if (!durableReceipt.successorAgentId && durableReceipt.status === 'accepted') {
              const admissionSettled = pendingAdmissions.get(durableReceipt.id);
              if (!admissionSettled) {
                const monitorUrl = receiptMonitorUrl(durableReceipt);
                reply.code(503);
                reply.header('Location', monitorUrl);
                reply.header('Retry-After', '1');
                return {
                  ...durableReceipt,
                  success: false,
                  accepted: false,
                  replayed: true,
                  code: 'ADMISSION_INDETERMINATE',
                  error: 'The owning admission is not observable yet; retry the stable receipt.',
                  monitorUrl,
                };
              }
              await admissionSettled;
              durableReceipt = receipts.get(durableReceipt.id) ?? durableReceipt;
            }
            const monitorUrl = receiptMonitorUrl(durableReceipt);
            const settled = TERMINAL_AGENT_RUN_STATUSES.has(durableReceipt.status)
              || durableReceipt.status === 'unknown';
            const terminal = TERMINAL_AGENT_RUN_STATUSES.has(durableReceipt.status);
            const successorAdmitted = Boolean(
              durableReceipt.successorAgentId
              && durableReceipt.successorSessionId
              && durableReceipt.transcriptId,
            );
            reply.code(settled ? 200 : 202);
            reply.header('Location', monitorUrl);
            if (!settled) reply.header('Retry-After', '1');
            return {
              success: terminal ? durableReceipt.status === 'completed' : durableReceipt.status !== 'unknown',
              accepted: successorAdmitted,
              replayed: true,
              ...durableReceipt,
              agentId: durableReceipt.successorAgentId,
              monitorUrl,
              cancelUrl: durableReceipt.successorAgentId
                ? `/spawn/${encodeURIComponent(durableReceipt.successorAgentId)}`
                : null,
            };
          }
        } catch (error) {
          if (error instanceof AgentRunIdempotencyConflictError) {
            reply.code(409);
            return {
              success: false,
              error: error.message,
              code: 'IDEMPOTENCY_CONFLICT',
              receiptId: error.receiptId,
            };
          }
          throw error;
        }
      }
      let settleDurableAdmission: (() => void) | null = null;
      if (durableReceipt) {
        const receiptId = durableReceipt.id;
        pendingAdmissions.set(receiptId, new Promise<void>((resolve) => {
          settleDurableAdmission = () => {
            resolve();
            pendingAdmissions.delete(receiptId);
            settleDurableAdmission = null;
          };
        }));
      }
      let acceptRun: ((accepted: SpawnAccepted) => void) | null = null;
      const accepted = new Promise<SpawnAccepted>((resolve) => { acceptRun = resolve; });
      const run = spawner.spawn(spec, (acceptedRun) => {
        if (durableReceipt) {
          durableReceipt = receipts.markStarting(durableReceipt.id, {
            successorAgentId: acceptedRun.agentId,
            successorSessionId: acceptedRun.sessionId,
            transcriptId: acceptedRun.transcriptId,
          });
          settleDurableAdmission?.();
        }
        acceptRun?.(acceptedRun);
      });
      const trackedRun = durableReceipt
        ? run.then((result) => {
            receipts.markStatus(durableReceipt!.id, agentRunStatusForSpawnResult(result), {
              error: result.error,
              telemetry: result.telemetry,
            });
            settleDurableAdmission?.();
            return result;
          }).catch((error) => {
            if (durableReceipt) {
              receipts.markStatus(durableReceipt.id, 'failed', {
                error: error instanceof Error ? error.message : String(error),
              });
            }
            settleDurableAdmission?.();
            throw error;
          })
        : run;

      if (respondAsync) {
        const first = await Promise.race([
          accepted.then((receipt) => ({ kind: 'accepted' as const, receipt })),
          trackedRun.then((result) => ({ kind: 'completed' as const, result })),
        ]);
        if (first.kind === 'accepted') {
          const monitorUrl = receiptMonitorUrl(durableReceipt!);
          void trackedRun.then((result) => {
            logger.info('spawn_complete', {
              agentId: result.agentId,
              backend: result.backend,
              status: result.status,
            });
          }).catch((error) => {
            metrics.errors++;
            logger.error('spawn_error', { error: (error as Error).message });
          });
          reply.code(202);
          reply.header('Location', monitorUrl);
          reply.header('Retry-After', '1');
          return {
            success: true,
            accepted: true,
            ...durableReceipt,
            agentId: first.receipt.agentId,
            monitorUrl,
            cancelUrl: `/spawn/${encodeURIComponent(first.receipt.agentId)}`,
            transcriptUrl: `/transcripts?agentId=${encodeURIComponent(first.receipt.agentId)}`,
          };
        }

        const result = first.result;
        logger.info('spawn_complete', {
          agentId: result.agentId,
          backend: result.backend,
          status: result.status,
        });
        return { success: result.status === 'completed', ...result };
      }

      const result = await trackedRun;

      logger.info('spawn_complete', {
        agentId: result.agentId,
        backend: result.backend,
        status: result.status,
      });

      return { success: result.status === 'completed', ...result };
    } catch (error) {
      metrics.errors++;
      logger.error('spawn_error', { error: (error as Error).message });
      reply.code(500); return { error: 'internal server error' };
    }
  });

  // GET /spawn/receipts/:id — stable collection handle across reconnects/restarts.
  fastify.get('/spawn/receipts/:id', async (request, reply) => {
    try {
      const id = String((request.params as any).id);
      let receipt = receipts.get(id);
      if (!receipt) {
        reply.code(404);
        return { success: false, error: `No spawn receipt found for ${id}` };
      }
      const agentId = receipt.successorAgentId;
      const run = agentId ? spawner.get(agentId) : null;
      const live = agentId ? spawner.list().find((agent) => agent.agentId === agentId) : null;
      const observedAt = Date.now();
      const hasLiveEvidence = Boolean(
        live?.status === 'running'
        && live.pid
        && live.pid > 0
        && observedAt - live.heartbeatAt >= 0
        && observedAt - live.heartbeatAt < AGENT_RUN_LIVE_EVIDENCE_MAX_AGE_MS,
      );
      if (run && !['running', 'unknown'].includes(run.status)) {
        receipt = receipts.markStatus(id, agentRunStatusForSpawnResult(run), {
          error: run.error,
          telemetry: run.telemetry,
        });
      } else if (hasLiveEvidence && !TERMINAL_AGENT_RUN_STATUSES.has(receipt.status)) {
        receipt = receipts.markStatus(id, 'live', {
          liveEvidence: {
            pid: live!.pid!,
            supervisorHeartbeatAt: live!.heartbeatAt,
          },
        });
      } else if (run?.status === 'unknown') {
        receipt = receipts.markStatus(id, 'unknown', { error: run.error });
      } else if (receipt.status === 'live' && !hasLiveEvidence) {
        receipt = receipts.markStatus(id, 'unknown', {
          error: 'The agent was previously live, but current PID and heartbeat evidence are unavailable.',
        });
      }
      const liveProven = receipt.status === 'live' && hasLiveEvidence;
      const outcomeUnknown = receipt.status === 'unknown';
      const terminal = TERMINAL_AGENT_RUN_STATUSES.has(receipt.status);
      if (!terminal && !outcomeUnknown) reply.header('Retry-After', '1');
      return {
        success: terminal ? receipt.status === 'completed' : !outcomeUnknown,
        terminal,
        outcomeUnknown,
        ...receipt,
        agentId,
        run,
        output: run?.output ?? null,
        accounting: {
          budgetUsd: receipt.budgetUsd,
          telemetry: receipt.telemetry,
          evidence: receipt.telemetry ? 'backend-reported-and-durable' : 'not-yet-reported',
        },
        liveness: live ? {
          live: liveProven,
          supervisorHeartbeatAt: live.heartbeatAt,
          lastActivityAt: live.lastActivityAt,
          pid: live.pid,
          deadlineAt: live.deadlineAt,
          evidence: liveProven ? 'pid-and-fresh-supervisor-heartbeat' : 'not-proven-live',
        } : null,
      };
    } catch (error) {
      metrics.errors++;
      logger.error('spawn_receipt_get_error', { error: (error as Error).message });
      reply.code(500); return { error: 'internal server error' };
    }
  });

  // GET /spawn — List active spawned agents
  fastify.get('/spawn', async (request, reply) => {
    try {
      const agents = spawner.list();
      return {
        success: true,
        agents,
        count: agents.length,
      };
    } catch (error) {
      metrics.errors++;
      logger.error('spawn_list_error', { error: (error as Error).message });
      reply.code(500); return { error: 'internal server error' };
    }
  });

  // GET /spawn/:id — reconnectable collection from live memory or transcript.
  fastify.get('/spawn/:id', async (request, reply) => {
    try {
      const id = String((request.params as any).id);
      const result: SpawnResult | null = spawner.get(id);
      if (!result) {
        reply.code(404);
        return { success: false, error: `No spawned run found for ${id}` };
      }
      const live = spawner.list().find((agent) => agent.agentId === id);
      const lifecycleState = live?.pid && live.pid > 0 && Date.now() - live.heartbeatAt < 65_000
        ? 'live'
        : result.status === 'running'
          ? 'starting'
          : result.status;
      const outcomeUnknown = result.status === 'unknown';
      const terminal = !['running', 'unknown'].includes(result.status);
      if (!terminal && !outcomeUnknown) reply.header('Retry-After', '1');
      return {
        success: terminal ? result.status === 'completed' : !outcomeUnknown,
        terminal,
        outcomeUnknown,
        lifecycleState,
        ...result,
        liveness: live ? {
          supervisorHeartbeatAt: live.heartbeatAt,
          lastActivityAt: live.lastActivityAt,
          pid: live.pid,
          deadlineAt: live.deadlineAt,
          evidence: lifecycleState === 'live' ? 'pid-and-fresh-supervisor-heartbeat' : 'not-proven-live',
        } : null,
      };
    } catch (error) {
      metrics.errors++;
      logger.error('spawn_get_error', { error: (error as Error).message });
      reply.code(500); return { error: 'internal server error' };
    }
  });

  // DELETE /spawn/:id — Cancel a running spawn and finalize durable evidence.
  fastify.delete('/spawn/:id', async (request, reply) => {
    try {
      const id = String((request.params as any).id);

      spawner.cancel(id);

      logger.info('spawn_cancel', { agentId: id });

      return {
        success: true,
        agentId: id,
        message: `Agent ${id} cancelled`,
      };
    } catch (error) {
      metrics.errors++;
      logger.error('spawn_cancel_error', { error: (error as Error).message });
      reply.code(500); return { error: 'internal server error' };
    }
  });
};
