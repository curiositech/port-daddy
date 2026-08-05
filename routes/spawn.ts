/**
 * Spawn Routes — AI Agent Launcher
 *
 * POST /spawn        — launch an AI agent, body: SpawnSpec, returns SpawnResult
 * GET  /spawn        — list active spawned agents
 * DELETE /spawn/:id  — kill a spawned agent
 */

import type { FastifyPluginAsync } from 'fastify';
import type { BackendOverrideSource, SpawnResult, SpawnSpec, Spawner } from '../lib/spawner.js';
import { assessSpawnPreflight } from '../lib/spawn-preflight.js';
import type { CostTracker } from '../lib/cost-tracker.js';
import type { Transcripts } from '../lib/transcripts.js';
import { resolveFleetAgentRuntime, type FleetModelTier, type FleetRuntimeTarget } from '../lib/fleet-runtime.js';
import { validateChannel } from '../shared/validators.js';
import { KNOWN_BACKEND_IDS } from '../lib/backend-catalog.js';
import {
  AgentRunIdempotencyConflictError,
  createAgentRunReceiptStore,
  TERMINAL_AGENT_RUN_STATUSES,
  type AgentRunReceipt,
  type AgentRunReceiptStatus,
  type AgentRunReceiptStore,
  type PortableDatabase,
} from '../lib/agent-run-receipts.js';

interface SpawnRouteDeps {
  spawner: Spawner;
  costTracker?: CostTracker;
  metrics: { errors: number };
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
  // Durable agent-run receipt ledger. Supplied by the daemon's shared `deps`
  // (server.ts already passes `db`), so no server callsite changes are needed.
  // When absent, `Prefer: respond-async` is not honoured and POST /spawn behaves
  // exactly as the synchronous route always has.
  db?: PortableDatabase;
  // Transcript recorder, also from the shared `deps`. Async admission needs it to
  // resolve the real transcript id it attaches as run evidence (markStarting).
  transcripts?: Transcripts;
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

/** True when the request opted into asynchronous admission via `Prefer: respond-async`. */
function prefersRespondAsync(headers: Record<string, unknown>): boolean {
  const prefer = String(headers['prefer'] ?? '').toLowerCase();
  return prefer.split(',').some((token) => token.trim() === 'respond-async');
}

/** Fastify may deliver a header as string | string[]; take the first non-empty value. */
function firstHeaderValue(value: unknown): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' && raw.trim() ? raw : undefined;
}

/**
 * Maps a terminal SpawnResult.status onto the receipt-core terminal status.
 * A killed agent is an operator/supervisor cancellation, not a failure.
 */
function terminalReceiptStatus(status: SpawnResult['status']): AgentRunReceiptStatus {
  switch (status) {
    case 'completed': return 'completed';
    case 'over_budget': return 'over_budget';
    case 'killed': return 'cancelled';
    case 'failed':
    default: return 'failed';
  }
}

/**
 * The durable projection of a receipt returned by GET /spawn/:id and by an
 * idempotent replay. `live` is derived ONLY from the receipt-core status: the
 * core sets `live` exclusively after corroborating the recorded child PID with
 * defaultVerifyProcessAlive, and reconciles a lost-liveness receipt to `unknown`
 * on restart. This route therefore never upgrades a run to `live` off a bare
 * daemon/supervisor heartbeat, and never reports `live: true` for a status the
 * core did not itself prove.
 */
function receiptProjection(receipt: AgentRunReceipt) {
  const terminal = TERMINAL_AGENT_RUN_STATUSES.has(receipt.status);
  const outcomeUnknown = receipt.status === 'unknown';
  const live = receipt.status === 'live';
  return {
    success: terminal ? receipt.status === 'completed' : !outcomeUnknown,
    terminal,
    outcomeUnknown,
    live,
    receiptId: receipt.id,
    status: receipt.status,
    agentId: receipt.successorAgentId,
    sessionId: receipt.successorSessionId,
    transcriptId: receipt.transcriptId,
    telemetry: receipt.telemetry,
    error: receipt.error,
    monitorUrl: `/spawn/${encodeURIComponent(receipt.id)}`,
    receipt,
  };
}

// ==========================================================================
// Fastify plugin (dual-export)
// ==========================================================================
export const spawnPlugin: FastifyPluginAsync<{ deps: SpawnRouteDeps }> = async (fastify, opts) => {
  const { metrics, logger, spawner, costTracker, db, transcripts } = opts.deps;

  // Durable receipt ledger for asynchronous spawn admission. Constructing the
  // store reconciles any receipt left non-terminal by a previous daemon
  // (accepted/starting/live -> unknown): lost liveness is never silently
  // treated as success. Requires both a database and a transcript recorder —
  // async admission attaches a real transcript id as run evidence, so without
  // transcripts we fall back to the synchronous path rather than fabricate one.
  const receipts: AgentRunReceiptStore | null = db ? createAgentRunReceiptStore(db) : null;
  const asyncAdmissionEnabled = Boolean(receipts && transcripts);

  /** Resolve the real transcript id the spawner opened for this agent, if any. */
  function resolveTranscriptId(agentId: string): string | null {
    if (!transcripts || !agentId) return null;
    try {
      const [head] = transcripts.listTranscripts({ agentId, limit: 1 });
      return head?.id ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Runs the actual backend for an admitted receipt and records its durable
   * lifecycle. This runs detached from the HTTP response (the caller already
   * received 202). Evidence is attached at completion — this branch's spawner
   * is blocking (`spawn(spec): Promise<SpawnResult>`) and exposes no mid-run
   * child PID, so there is no honest window to assert `live`; the run advances
   * accepted -> starting (with agent/session/transcript evidence) -> terminal.
   * A backend that never opens a runtime is recorded as `no_runtime`, never as
   * a completion.
   */
  async function runAdmittedSpawn(receiptId: string, spec: SpawnSpec): Promise<void> {
    if (!receipts) return;
    try {
      const result = await spawner.spawn(spec);
      const transcriptId = resolveTranscriptId(result.agentId);
      if (result.agentId && transcriptId) {
        receipts.markStarting(receiptId, {
          successorAgentId: result.agentId,
          successorSessionId: result.harnessSessionId ?? null,
          transcriptId,
        });
        receipts.markStatus(receiptId, terminalReceiptStatus(result.status), {
          successorSessionId: result.harnessSessionId ?? null,
          error: result.error,
          telemetry: result.telemetry,
        });
      } else {
        // The run returned but left no attachable agent/transcript evidence.
        // Record honestly instead of inventing a completion.
        receipts.markStatus(receiptId, 'no_runtime', {
          error: result.error ?? 'spawn returned no attachable agent/transcript evidence',
        });
      }
      logger.info('spawn_complete', {
        agentId: result.agentId,
        backend: result.backend,
        status: result.status,
      });
    } catch (error) {
      // The backend threw before opening a runtime: admission stands but nothing
      // ran. `no_runtime` is a terminal status, so this never masquerades as a
      // completed run.
      try {
        receipts.markStatus(receiptId, 'no_runtime', {
          error: error instanceof Error ? error.message : String(error),
        });
      } catch { /* best-effort durable record */ }
      metrics.errors++;
      logger.error('spawn_error', { error: (error as Error).message });
    }
  }

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
        timeout,
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
      if (timeout && typeof timeout === 'number') spec.timeout = timeout;
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

      // Asynchronous admission (RFC 7240 `Prefer: respond-async`). Reuses the
      // single preflight + `spec` built above; the synchronous path below is
      // left byte-for-byte unchanged. Only engages when a durable ledger and a
      // transcript recorder are both wired — otherwise the request falls through
      // to the existing synchronous behaviour.
      if (asyncAdmissionEnabled && prefersRespondAsync(request.headers as Record<string, unknown>)) {
        const idempotencyKey = firstHeaderValue((request.headers as Record<string, unknown>)['idempotency-key']);
        if (!idempotencyKey) {
          reply.code(400);
          return {
            success: false,
            error: 'Idempotency-Key header is required for Prefer: respond-async spawn admission',
            code: 'IDEMPOTENCY_KEY_REQUIRED',
          };
        }
        let admission: { receipt: AgentRunReceipt; replayed: boolean };
        try {
          // One atomic INSERT ... ON CONFLICT ... RETURNING: two concurrent
          // callers racing the same key can never both admit a run.
          admission = receipts!.accept({
            idempotencyKey,
            kind: 'spawn',
            request: spec,
            budgetUsd: spec.budgetUsd ?? null,
          });
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

        if (admission.replayed) {
          // A prior request already owns this key: return its durable projection
          // WITHOUT launching the backend a second time.
          const projection = receiptProjection(admission.receipt);
          const settled = projection.terminal || projection.outcomeUnknown;
          reply.code(settled ? 200 : 202);
          reply.header('Location', projection.monitorUrl);
          if (!settled) reply.header('Retry-After', '1');
          return { ...projection, replayed: true, accepted: true };
        }

        // Fresh admission: launch the real backend detached from this response
        // and return 202 immediately with a stable collection handle.
        void runAdmittedSpawn(admission.receipt.id, spec);
        reply.code(202);
        reply.header('Location', `/spawn/${encodeURIComponent(admission.receipt.id)}`);
        reply.header('Retry-After', '1');
        return {
          success: true,
          accepted: true,
          replayed: false,
          receiptId: admission.receipt.id,
          status: admission.receipt.status,
          monitorUrl: `/spawn/${encodeURIComponent(admission.receipt.id)}`,
        };
      }

      const result = await spawner.spawn(spec);

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

  // GET /spawn/:id — Collect the durable projection of an admitted spawn.
  // `:id` is a receipt id (run-*) minted by Prefer: respond-async admission,
  // distinct from the agent id namespace used by DELETE /spawn/:id. Reads the
  // durable ledger only: it reports `unknown` for a run whose liveness the
  // daemon lost across a restart (never `live`, never a 500), and it never
  // upgrades a run to `live` from a bare heartbeat — the receipt core is the
  // sole authority that proves `live` via defaultVerifyProcessAlive.
  fastify.get('/spawn/:id', async (request, reply) => {
    try {
      if (!receipts) {
        reply.code(404);
        return { success: false, error: 'Durable spawn receipts are not available on this daemon' };
      }
      const id = String((request.params as any).id);
      const receipt = receipts.get(id);
      if (!receipt) {
        reply.code(404);
        return { success: false, error: `No spawn receipt found for ${id}` };
      }
      const projection = receiptProjection(receipt);
      if (!projection.terminal && !projection.outcomeUnknown) reply.header('Retry-After', '1');
      return projection;
    } catch (error) {
      metrics.errors++;
      logger.error('spawn_receipt_get_error', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
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

  // DELETE /spawn/:id — Kill a spawned agent
  fastify.delete('/spawn/:id', async (request, reply) => {
    try {
      const id = String((request.params as any).id);

      spawner.kill(id);

      logger.info('spawn_kill', { agentId: id });

      return {
        success: true,
        agentId: id,
        message: `Agent ${id} killed`,
      };
    } catch (error) {
      metrics.errors++;
      logger.error('spawn_kill_error', { error: (error as Error).message });
      reply.code(500); return { error: 'internal server error' };
    }
  });
};
