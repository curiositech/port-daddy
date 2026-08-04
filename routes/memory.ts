import type { FastifyPluginAsync } from 'fastify';
import type { Database } from 'better-sqlite3';
import type { EpisodicMemory } from '../lib/episodic-memory.js';
import {
  HandoffBudgetError,
  HandoffScannerUnavailableError,
  HandoffSecretError,
  HandoffValidationError,
  renderHandoffSuccessorPrompt,
  sanitizeHandoffCapsule,
  sanitizeHandoffText,
  type GitleaksRunner,
  type HandoffCapsuleV0,
} from '../lib/handoff-capsule.js';
import { BACKEND_CATALOG, getBackendCatalogEntry, type BackendCatalogEntry } from '../lib/backend-catalog.js';
import {
  ContinuationIdempotencyConflictError,
  createContinuationStore,
  hashContinuationPrompt,
  type ContinuationMode,
  type ContinuationReceipt,
  type ContinuationStatus,
} from '../lib/continuation-runtime.js';
import {
  resolveSpawnRuntime,
  validateNativeResume,
  validateNativeResumeAdapter,
  type SpawnSpec,
  type Spawner,
} from '../lib/spawner.js';
import {
  captureNativeSessionWitness,
  verifyNativeSessionWitness,
  type NativeSessionWitnessResult,
} from '../lib/native-session-witness.js';
import { harvestSession, type HarvestResult } from '../lib/session-harvest.js';
import {
  captureWorkspaceIdentity,
  sameWorkspaceIdentity,
  type WorkspaceIdentity,
} from '../lib/workspace-identity.js';

interface MemoryRouteDeps {
  episodicMemory: EpisodicMemory;
  db?: Database;
  blobs?: {
    store(content: string, opts: { mimeType?: string; agentId?: string; metadata?: Record<string, unknown> }): Promise<{ id: string }>;
  };
  gitleaksRunner?: GitleaksRunner;
  spawner?: Pick<Spawner, 'spawn'>;
  captureNativeSessionWitnessFn?: typeof captureNativeSessionWitness;
  verifyNativeSessionWitnessFn?: typeof verifyNativeSessionWitness;
  harvestSessionFn?: typeof harvestSession;
  metrics: { errors: number };
  logger: {
    error(msg: string, meta?: Record<string, unknown>): void;
  };
}

interface HandoffRequestBody {
  capsule?: unknown;
  tokenBudget?: number;
  coordinationSessionId?: string;
}

interface ContinuationRequestBody {
  targetBackend?: unknown;
  mode?: unknown;
  model?: unknown;
  prompt?: unknown;
  idempotencyKey?: unknown;
  durableAgentId?: unknown;
  targetWorkdir?: unknown;
  timeoutMs?: unknown;
}

type RequestedContinuationMode = 'auto' | ContinuationMode;

type HandoffHarvestStatus =
  | ({ attempted: true; success: true } & HarvestResult)
  | { attempted: true; success: false; error: string }
  | { attempted: false; reason: string };

const CONTINUATION_STATUSES = new Set<ContinuationStatus>([
  'accepted', 'running', 'completed', 'failed', 'unsupported', 'orphaned',
]);

function handoffTitle(capsule: HandoffCapsuleV0): string {
  const firstLine = capsule.telos.split('\n')[0]?.trim() || capsule.source.sessionId;
  return `Handoff: ${firstLine}`.slice(0, 200);
}

function handoffSummary(capsule: HandoffCapsuleV0): string {
  const lines = [
    capsule.telos,
    ...capsule.operatorTurns.map((turn) => `Operator: ${turn.text}`),
    ...capsule.decisions.map((decision) => `Decision (${decision.source}): ${decision.text}`),
    ...capsule.coordination.map((item) => `${item.kind.toUpperCase()}: ${item.text}`),
  ];
  return lines.join('\n\n');
}

function continuationIdentifier(value: unknown, field: string, maxBytes = 1_024): string {
  if (typeof value !== 'string') throw new HandoffValidationError(`${field} must be a string`);
  const normalized = value.trim();
  if (!normalized || Buffer.byteLength(normalized, 'utf8') > maxBytes || /[\0\r\n]/.test(normalized)) {
    throw new HandoffValidationError(`${field} must be a safe non-empty string up to ${maxBytes} bytes`);
  }
  return normalized;
}

function optionalContinuationIdentifier(value: unknown, field: string, maxBytes = 1_024): string | undefined {
  return value === undefined ? undefined : continuationIdentifier(value, field, maxBytes);
}

function workspaceIdentityHash(identity: WorkspaceIdentity): string {
  return hashContinuationPrompt(`${identity.canonicalPath}\0${identity.device}:${identity.inode}`);
}

function continuationWorkspaceRequestHash(
  requested: WorkspaceIdentity | null,
  effective: WorkspaceIdentity | null,
): string | null {
  if (!requested && !effective) return null;
  return hashContinuationPrompt(JSON.stringify({
    requested: requested ? workspaceIdentityHash(requested) : null,
    effective: effective ? workspaceIdentityHash(effective) : null,
  }));
}

function continuationErrorMessage(error: unknown, gitleaksRunner?: GitleaksRunner): string {
  const raw = error instanceof Error ? error.message : String(error);
  try {
    return sanitizeHandoffText(raw || 'target harness failed', { gitleaksRunner, maxBytes: 4_000 });
  } catch {
    return 'target harness failed; detailed error quarantined by continuation safety policy';
  }
}

const KNOWN_ADAPTER_FAMILIES: ReadonlySet<string> = new Set(
  BACKEND_CATALOG.map((entry) => entry.adapter.family),
);

function sourceAdapterFamily(adapter: string): string {
  // A backend id maps to its family; a raw family name passes through. An
  // UNREGISTERED adapter must never silently mint a witness that could later
  // collide with a future family name: it is tagged `unregistered:<raw>`.
  // Receipts stay append-only truthful; the conformance matrix simply never
  // matches an `unregistered:` family.
  const catalogued = getBackendCatalogEntry(adapter)?.adapter.family;
  if (catalogued) return catalogued;
  return KNOWN_ADAPTER_FAMILIES.has(adapter) ? adapter : `unregistered:${adapter}`;
}

function requestedContinuationMode(value: unknown): RequestedContinuationMode {
  if (value === undefined) return 'auto';
  if (value === 'auto' || value === 'native' || value === 'handoff') return value;
  throw new HandoffValidationError('mode must be auto, native, or handoff');
}

function resolveContinuationMode(
  requested: RequestedContinuationMode,
  sourceAdapter: string,
  targetEntry: BackendCatalogEntry,
): ContinuationMode {
  if (requested !== 'auto') return requested;
  return sourceAdapter === targetEntry.adapter.family
    && targetEntry.adapter.resume.native
    && targetEntry.adapter.resume.scope === 'session'
    ? 'native'
    : 'handoff';
}

function unavailableNativeSessionWitness(reason: string): NativeSessionWitnessResult {
  return {
    verified: false,
    witness: null,
    reason,
    canonicalWorkspace: null,
    workspaceIdentity: null,
  };
}

export const memoryPlugin: FastifyPluginAsync<{ deps: MemoryRouteDeps }> = async (fastify, opts) => {
  const { episodicMemory, metrics, logger } = opts.deps;
  const continuationStore = opts.deps.db
    ? createContinuationStore(opts.deps.db, { recoverExpired: true })
    : null;

  fastify.post('/memory/handoffs', { bodyLimit: 2 * 1024 * 1024 }, async (request, reply) => {
    const body = (request.body as HandoffRequestBody | undefined) ?? {};
    try {
      if (
        body.coordinationSessionId !== undefined
        && (
          typeof body.coordinationSessionId !== 'string'
          || body.coordinationSessionId.trim().length === 0
          || Buffer.byteLength(body.coordinationSessionId, 'utf8') > 1_024
        )
      ) {
        throw new HandoffValidationError('coordinationSessionId must be a non-empty string up to 1024 bytes');
      }

      const capsule = sanitizeHandoffCapsule(body.capsule, {
        tokenBudget: body.tokenBudget,
        gitleaksRunner: opts.deps.gitleaksRunner,
      });
      const adapterFamily = sourceAdapterFamily(capsule.source.adapter);
      let nativeSessionWitness: NativeSessionWitnessResult;
      try {
        nativeSessionWitness = (opts.deps.captureNativeSessionWitnessFn ?? captureNativeSessionWitness)(
          capsule,
          adapterFamily,
        );
      } catch {
        nativeSessionWitness = unavailableNativeSessionWitness(
          'daemon could not witness the claimed native session in local harness storage',
        );
      }

      const sourceAgent = capsule.source.agentId ?? capsule.source.adapter;
      const episode = episodicMemory.remember({
        projectDir: capsule.identity.projectDir ?? capsule.workspace.repoRoot ?? capsule.workspace.cwd,
        project: capsule.identity.project,
        harbor: capsule.identity.harbor,
        agentId: capsule.source.agentId,
        episodeType: 'handoff',
        title: handoffTitle(capsule),
        summary: handoffSummary(capsule),
        sourceType: 'handoff-capsule',
        sourceId: `${sourceAgent}:${capsule.source.sessionId}`,
        worktreeId: capsule.workspace.worktreeId,
        branchName: capsule.workspace.branch,
        metadata: {
          capsule,
          coordinationSessionId: body.coordinationSessionId ?? null,
          nativeSessionWitness: nativeSessionWitness.witness,
          nativeSessionWitnessReason: nativeSessionWitness.reason,
        },
      });

      let harvest: HandoffHarvestStatus = {
        attempted: false,
        reason: 'no coordinationSessionId',
      };
      if (body.coordinationSessionId !== undefined) {
        if (!opts.deps.db) {
          metrics.errors++;
          logger.error('memory_handoff_harvest_unavailable', { errorType: 'MissingDatabaseDependency' });
          harvest = { attempted: true, success: false, error: 'session harvest unavailable' };
        } else {
          try {
            const result = await (opts.deps.harvestSessionFn ?? harvestSession)(
              body.coordinationSessionId,
              opts.deps.db,
              {
                episodicMemory,
                blobs: opts.deps.blobs,
              },
            );
            harvest = { attempted: true, success: true, ...result };
          } catch (error) {
            metrics.errors++;
            logger.error('memory_handoff_harvest_failed', {
              errorType: error instanceof Error ? error.name : 'unknown',
            });
            harvest = { attempted: true, success: false, error: 'session harvest unavailable' };
          }
        }
      }

      reply.code(201);
      return {
        success: true,
        capsule,
        episode,
        harvest,
        nativeResume: {
          verified: nativeSessionWitness.verified,
          adapterFamily,
          method: nativeSessionWitness.witness?.method ?? null,
          reason: nativeSessionWitness.reason,
        },
      };
    } catch (error) {
      if (error instanceof HandoffValidationError) {
        reply.code(400);
        return { success: false, error: error.message };
      }
      if (error instanceof HandoffBudgetError) {
        reply.code(413);
        return {
          success: false,
          error: 'handoff capsule exceeds token budget without dropping operator context',
          requestedTokens: error.requestedTokens,
          minimumRequiredTokens: error.minimumRequiredTokens,
        };
      }
      if (error instanceof HandoffSecretError) {
        reply.code(422);
        return {
          success: false,
          error: 'handoff capsule quarantined by secret scanning',
          findingCount: error.findingCount,
        };
      }
      if (error instanceof HandoffScannerUnavailableError) {
        metrics.errors++;
        logger.error('memory_handoff_scanner_unavailable', { errorType: error.name });
        reply.code(503);
        return {
          success: false,
          error: error.message,
          failClosed: true,
        };
      }
      metrics.errors++;
      logger.error('memory_handoff_error', {
        errorType: error instanceof Error ? error.name : 'unknown',
      });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  fastify.post('/memory/handoffs/:episodeId/continue', { bodyLimit: 256 * 1024 }, async (request, reply) => {
    if (!continuationStore || !opts.deps.spawner) {
      reply.code(503);
      return { success: false, error: 'continuation runtime unavailable', failClosed: true };
    }

    try {
      const episodeId = Number.parseInt((request.params as { episodeId?: string }).episodeId ?? '', 10);
      if (!Number.isInteger(episodeId) || episodeId < 1) {
        throw new HandoffValidationError('episodeId must be a positive integer');
      }
      const episode = episodicMemory.get(episodeId);
      if (!episode || episode.episodeType !== 'handoff' || episode.sourceType !== 'handoff-capsule') {
        reply.code(404);
        return { success: false, error: 'handoff episode not found' };
      }

      const storedCapsule = episode.metadata?.capsule;
      const capsule = sanitizeHandoffCapsule(storedCapsule, {
        gitleaksRunner: opts.deps.gitleaksRunner,
      });
      const body = (request.body as ContinuationRequestBody | undefined) ?? {};
      const requestedBackend = continuationIdentifier(body.targetBackend, 'targetBackend', 128);
      const requestedEntry = getBackendCatalogEntry(requestedBackend);
      if (!requestedEntry) throw new HandoffValidationError(`unknown targetBackend: ${requestedBackend}`);
      const idempotencyKey = continuationIdentifier(body.idempotencyKey, 'idempotencyKey', 512);
      const requestedModel = optionalContinuationIdentifier(body.model, 'model', 512);
      const durableAgentId = optionalContinuationIdentifier(body.durableAgentId, 'durableAgentId');
      const targetWorkdir = optionalContinuationIdentifier(body.targetWorkdir, 'targetWorkdir', 32 * 1024);
      const requestedWorkspaceIdentity = targetWorkdir
        ? captureWorkspaceIdentity(targetWorkdir)
        : null;
      if (targetWorkdir && !requestedWorkspaceIdentity) {
        throw new HandoffValidationError('targetWorkdir must resolve to a current user-owned absolute directory');
      }
      let timeout: number | undefined;
      if (body.timeoutMs !== undefined) {
        if (typeof body.timeoutMs !== 'number' || !Number.isInteger(body.timeoutMs) || body.timeoutMs < 1_000 || body.timeoutMs > 6 * 60 * 60 * 1_000) {
          throw new HandoffValidationError('timeoutMs must be an integer from 1000 to 21600000');
        }
        timeout = body.timeoutMs;
      }

      const continuationRequest = sanitizeHandoffText(body.prompt ?? capsule.telos, {
        gitleaksRunner: opts.deps.gitleaksRunner,
      });
      const requestedMode = requestedContinuationMode(body.mode);
      const adapterFamily = sourceAdapterFamily(capsule.source.adapter);
      const durableIdentity = durableAgentId ?? capsule.target?.agentId ?? capsule.source.agentId ?? null;
      const spawnSpec: SpawnSpec = {
        backend: requestedBackend as SpawnSpec['backend'],
        requestedBackend: requestedBackend as SpawnSpec['backend'],
        ...(requestedModel ? { model: requestedModel, requestedModel } : {}),
        task: continuationRequest,
        purpose: `Continue ${durableIdentity ?? adapterFamily}`,
        identity: durableIdentity ?? undefined,
        timeout,
      };
      const runtime = resolveSpawnRuntime(spawnSpec);
      const targetEntry = getBackendCatalogEntry(runtime.effectiveBackend);
      if (!targetEntry) throw new HandoffValidationError(`unknown effective targetBackend: ${runtime.effectiveBackend}`);
      const targetAdapter = targetEntry.adapter.family;
      const mode = resolveContinuationMode(requestedMode, adapterFamily, targetEntry);
      if (mode === 'native') {
        spawnSpec.nativeResume = {
          adapterFamily,
          sessionId: capsule.source.sessionId,
        };
      } else {
        spawnSpec.task = sanitizeHandoffText(
          renderHandoffSuccessorPrompt(capsule, continuationRequest, durableIdentity),
          {
            gitleaksRunner: opts.deps.gitleaksRunner,
            maxBytes: 1024 * 1024,
          },
        );
      }

      let sourceWitness: NativeSessionWitnessResult;
      try {
        sourceWitness = (opts.deps.verifyNativeSessionWitnessFn ?? verifyNativeSessionWitness)(
          capsule,
          adapterFamily,
          episode.metadata?.nativeSessionWitness,
        );
      } catch {
        sourceWitness = unavailableNativeSessionWitness(
          'daemon could not reverify the claimed native session in local harness storage',
        );
      }
      const witnessedWorkspaceIdentity = sourceWitness.verified
        && sourceWitness.canonicalWorkspace
        && sourceWitness.workspaceIdentity
        ? sourceWitness.workspaceIdentity
        : null;
      const effectiveWorkspaceIdentity = witnessedWorkspaceIdentity
        ?? (mode === 'handoff' ? requestedWorkspaceIdentity : null);

      const accepted = continuationStore.accept({
        idempotencyKey,
        sourceEpisodeId: episode.id,
        sourceCapsuleId: capsule.capsuleId,
        durableAgentId: durableIdentity,
        mode,
        sourceAdapter: adapterFamily,
        sourceSessionId: capsule.source.sessionId,
        sourceAgentId: capsule.source.agentId ?? null,
        predecessorRunId: capsule.source.workflowId ?? null,
        targetAdapter,
        requestedBackend,
        effectiveBackend: runtime.effectiveBackend,
        requestedModel: runtime.requestedModel,
        effectiveModel: runtime.effectiveModel,
        workspaceIdentityHash: continuationWorkspaceRequestHash(
          requestedWorkspaceIdentity,
          effectiveWorkspaceIdentity,
        ),
        promptHash: hashContinuationPrompt(spawnSpec.task),
      });
      if (accepted.replayed) {
        const replayStatus = accepted.receipt.status;
        if (replayStatus === 'accepted' || replayStatus === 'running') {
          reply.code(202);
          return {
            success: false,
            pending: true,
            replayed: true,
            receipt: accepted.receipt,
          };
        }
        if (replayStatus === 'unsupported') reply.code(422);
        if (replayStatus === 'failed') reply.code(502);
        if (replayStatus === 'orphaned') reply.code(409);
        const success = replayStatus === 'completed';
        return {
          success,
          replayed: true,
          ...(success ? {} : { error: accepted.receipt.error ?? `continuation is ${replayStatus}` }),
          receipt: accepted.receipt,
        };
      }

      if (mode === 'handoff' && !targetEntry.adapter.acceptsInitialPrompt) {
        const error = `effective adapter ${targetAdapter} cannot accept a handoff successor prompt`;
        const receipt = continuationStore.markUnsupported(accepted.receipt.id, error);
        if (!receipt || receipt.status !== 'unsupported') {
          const current = continuationStore.get(accepted.receipt.id) ?? accepted.receipt;
          reply.code(409);
          return {
            success: false,
            error: 'continuation ownership changed before the unsupported result was recorded',
            receipt: current,
          };
        }
        reply.code(422);
        return { success: false, error, receipt };
      }

      let handoffWorkspaceIdentity: WorkspaceIdentity | null = null;
      if (mode === 'handoff') {
        if (sourceWitness.verified && sourceWitness.canonicalWorkspace && sourceWitness.workspaceIdentity) {
          if (targetWorkdir && !sameWorkspaceIdentity(targetWorkdir, sourceWitness.workspaceIdentity)) {
            const error = 'targetWorkdir does not match the daemon-witnessed source workspace';
            const receipt = continuationStore.markUnsupported(accepted.receipt.id, error);
            if (!receipt || receipt.status !== 'unsupported') {
              const current = continuationStore.get(accepted.receipt.id) ?? accepted.receipt;
              reply.code(409);
              return { success: false, error: 'continuation ownership changed before spawn', receipt: current };
            }
            reply.code(422);
            return { success: false, error, receipt };
          }
          spawnSpec.workdir = sourceWitness.canonicalWorkspace;
          spawnSpec.workspaceIdentity = sourceWitness.workspaceIdentity;
          handoffWorkspaceIdentity = sourceWitness.workspaceIdentity;
        } else if (requestedWorkspaceIdentity) {
          spawnSpec.workdir = requestedWorkspaceIdentity.canonicalPath;
          spawnSpec.workspaceIdentity = requestedWorkspaceIdentity;
          handoffWorkspaceIdentity = requestedWorkspaceIdentity;
        } else {
          const witnessReason = sourceWitness.reason ?? 'source session evidence is unavailable';
          const error = `handoff successor requires a daemon-witnessed source workspace or explicit targetWorkdir; ${witnessReason}`;
          const receipt = continuationStore.markUnsupported(accepted.receipt.id, error);
          if (!receipt || receipt.status !== 'unsupported') {
            const current = continuationStore.get(accepted.receipt.id) ?? accepted.receipt;
            reply.code(409);
            return { success: false, error: 'continuation ownership changed before spawn', receipt: current };
          }
          reply.code(422);
          return { success: false, error, receipt };
        }
      }

      if (mode === 'native') {
        const unsupported = validateNativeResumeAdapter(spawnSpec, runtime);
        if (unsupported) {
          const receipt = continuationStore.markUnsupported(accepted.receipt.id, unsupported);
          if (!receipt || receipt.status !== 'unsupported') {
            const current = continuationStore.get(accepted.receipt.id) ?? accepted.receipt;
            reply.code(409);
            return {
              success: false,
              error: 'continuation ownership changed before the unsupported result was recorded',
              receipt: current,
            };
          }
          reply.code(422);
          return { success: false, error: unsupported, receipt };
        }

        if (!sourceWitness.verified) {
          const error = sourceWitness.reason ?? 'native session evidence is unavailable';
          const receipt = continuationStore.markUnsupported(accepted.receipt.id, error);
          if (!receipt || receipt.status !== 'unsupported') {
            const current = continuationStore.get(accepted.receipt.id) ?? accepted.receipt;
            reply.code(409);
            return {
              success: false,
              error: 'continuation ownership changed before the witness result was recorded',
              receipt: current,
            };
          }
          reply.code(422);
          return { success: false, error, receipt };
        }
        if (!sourceWitness.canonicalWorkspace || !sourceWitness.workspaceIdentity) {
          const error = 'native session witness did not provide a canonical workspace';
          const receipt = continuationStore.markUnsupported(accepted.receipt.id, error);
          if (!receipt || receipt.status !== 'unsupported') {
            const current = continuationStore.get(accepted.receipt.id) ?? accepted.receipt;
            reply.code(409);
            return { success: false, error: 'continuation ownership changed before spawn', receipt: current };
          }
          reply.code(422);
          return { success: false, error, receipt };
        }
        if (targetWorkdir && !sameWorkspaceIdentity(targetWorkdir, sourceWitness.workspaceIdentity)) {
          const error = 'targetWorkdir does not match the daemon-witnessed source workspace';
          const receipt = continuationStore.markUnsupported(accepted.receipt.id, error);
          if (!receipt || receipt.status !== 'unsupported') {
            const current = continuationStore.get(accepted.receipt.id) ?? accepted.receipt;
            reply.code(409);
            return { success: false, error: 'continuation ownership changed before spawn', receipt: current };
          }
          reply.code(422);
          return { success: false, error, receipt };
        }
        spawnSpec.workdir = sourceWitness.canonicalWorkspace;
        spawnSpec.nativeResume = {
          adapterFamily,
          sessionId: capsule.source.sessionId,
          workspaceIdentity: sourceWitness.workspaceIdentity,
        };
        const workspaceUnsupported = validateNativeResume(spawnSpec, runtime);
        if (workspaceUnsupported) {
          const receipt = continuationStore.markUnsupported(accepted.receipt.id, workspaceUnsupported);
          if (!receipt || receipt.status !== 'unsupported') {
            const current = continuationStore.get(accepted.receipt.id) ?? accepted.receipt;
            reply.code(409);
            return { success: false, error: 'continuation ownership changed before spawn', receipt: current };
          }
          reply.code(422);
          return { success: false, error: workspaceUnsupported, receipt };
        }
      }

      if (
        mode === 'handoff'
        && (
          !handoffWorkspaceIdentity
          || !spawnSpec.workdir
          || !sameWorkspaceIdentity(spawnSpec.workdir, handoffWorkspaceIdentity)
        )
      ) {
        const error = 'handoff successor blocked: canonical workspace identity changed before spawn';
        const receipt = continuationStore.markFailed(accepted.receipt.id, { error });
        if (!receipt || receipt.status !== 'failed') {
          const current = continuationStore.get(accepted.receipt.id) ?? accepted.receipt;
          reply.code(409);
          return { success: false, error: 'continuation ownership changed before spawn', receipt: current };
        }
        reply.code(409);
        return { success: false, error, receipt };
      }

      const running = continuationStore.markRunning(
        accepted.receipt.id,
        (timeout ?? 5 * 60 * 1_000) + 60_000,
      );
      if (!running || running.status !== 'running') {
        const current = continuationStore.get(accepted.receipt.id) ?? accepted.receipt;
        reply.code(409);
        return {
          success: false,
          error: 'continuation lease ownership changed before spawn',
          receipt: current,
        };
      }
      let result;
      try {
        result = await opts.deps.spawner.spawn(spawnSpec);
      } catch (error) {
        const safeError = continuationErrorMessage(error, opts.deps.gitleaksRunner);
        const receipt = continuationStore.markFailed(accepted.receipt.id, { error: safeError });
        if (!receipt || receipt.status !== 'failed') {
          const current = continuationStore.get(accepted.receipt.id) ?? running;
          reply.code(409);
          return {
            success: false,
            error: 'continuation ownership changed while the target harness was running',
            receipt: current,
          };
        }
        reply.code(502);
        return { success: false, error: safeError, receipt };
      }

      let receipt: ContinuationReceipt;
      if (result.status === 'completed' && !result.error) {
        const completed = continuationStore.markCompleted(accepted.receipt.id, {
          effectiveBackend: result.effectiveBackend ?? result.backend,
          effectiveModel: result.effectiveModel ?? result.model,
          successorRunId: result.agentId,
          successorSessionId: result.harnessSessionId ?? (mode === 'native' ? capsule.source.sessionId : null),
        });
        if (!completed || completed.status !== 'completed') {
          const current = continuationStore.get(accepted.receipt.id) ?? running;
          reply.code(409);
          return {
            success: false,
            error: 'continuation ownership changed before completion was recorded',
            receipt: current,
          };
        }
        receipt = completed;
        reply.code(201);
        return { success: true, replayed: false, receipt };
      }

      const safeError = continuationErrorMessage(result.error ?? `target harness returned ${result.status}`, opts.deps.gitleaksRunner);
      const failed = continuationStore.markFailed(accepted.receipt.id, {
        effectiveBackend: result.effectiveBackend ?? result.backend,
        effectiveModel: result.effectiveModel ?? result.model,
        successorRunId: result.agentId === 'blocked' ? null : result.agentId,
        successorSessionId: result.harnessSessionId ?? null,
        error: safeError,
      });
      if (!failed || failed.status !== 'failed') {
        const current = continuationStore.get(accepted.receipt.id) ?? running;
        reply.code(409);
        return {
          success: false,
          error: 'continuation ownership changed before failure was recorded',
          receipt: current,
        };
      }
      receipt = failed;
      reply.code(502);
      return { success: false, error: safeError, receipt };
    } catch (error) {
      if (error instanceof ContinuationIdempotencyConflictError) {
        reply.code(409);
        return {
          success: false,
          error: error.message,
          continuationId: error.continuationId,
        };
      }
      if (error instanceof HandoffValidationError) {
        reply.code(400);
        return { success: false, error: error.message };
      }
      if (error instanceof HandoffSecretError) {
        reply.code(422);
        return { success: false, error: 'continuation quarantined by secret scanning', findingCount: error.findingCount };
      }
      if (error instanceof HandoffScannerUnavailableError) {
        metrics.errors++;
        logger.error('memory_continuation_scanner_unavailable', { errorType: error.name });
        reply.code(503);
        return { success: false, error: error.message, failClosed: true };
      }
      metrics.errors++;
      logger.error('memory_continuation_error', { errorType: error instanceof Error ? error.name : 'unknown' });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  fastify.get('/memory/continuations/:continuationId', async (request, reply) => {
    if (!continuationStore) {
      reply.code(503);
      return { success: false, error: 'continuation runtime unavailable', failClosed: true };
    }
    try {
      const continuationId = continuationIdentifier(
        (request.params as { continuationId?: string }).continuationId,
        'continuationId',
      );
      const receipt = continuationStore.get(continuationId);
      if (!receipt) {
        reply.code(404);
        return { success: false, error: 'continuation receipt not found' };
      }
      return { success: true, receipt };
    } catch (error) {
      if (error instanceof HandoffValidationError) {
        reply.code(400);
        return { success: false, error: error.message };
      }
      throw error;
    }
  });

  fastify.get('/memory/continuations', async (request, reply) => {
    if (!continuationStore) {
      reply.code(503);
      return { success: false, error: 'continuation runtime unavailable', failClosed: true };
    }
    const query = (request.query as Record<string, string | undefined>) ?? {};
    const sourceEpisodeId = query.sourceEpisodeId === undefined ? undefined : Number.parseInt(query.sourceEpisodeId, 10);
    if (sourceEpisodeId !== undefined && (!Number.isInteger(sourceEpisodeId) || sourceEpisodeId < 1)) {
      reply.code(400);
      return { success: false, error: 'sourceEpisodeId must be a positive integer' };
    }
    const status = query.status as ContinuationStatus | undefined;
    if (status !== undefined && !CONTINUATION_STATUSES.has(status)) {
      reply.code(400);
      return { success: false, error: 'invalid continuation status' };
    }
    const limit = query.limit === undefined ? undefined : Number.parseInt(query.limit, 10);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 500)) {
      reply.code(400);
      return { success: false, error: 'limit must be an integer from 1 to 500' };
    }
    const receipts = continuationStore.list({
      sourceEpisodeId,
      durableAgentId: query.durableAgentId,
      status,
      limit,
    });
    return { success: true, receipts, count: receipts.length };
  });

  fastify.get('/memory/episodes', async (request, reply) => {
    try {
      const query = (request.query as Record<string, string | undefined>) || {};
      const episodes = episodicMemory.list({
        projectDir: query.projectDir,
        project: query.project,
        harbor: query.harbor,
        agentId: query.agentId,
        episodeType: query.episodeType,
        query: query.query || query.q,
        limit: query.limit ? parseInt(query.limit, 10) : undefined,
      });
      return { success: true, episodes, count: episodes.length };
    } catch (error) {
      metrics.errors++;
      logger.error('memory_episodes_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  fastify.get('/memory/stats', async (request, reply) => {
    try {
      const query = (request.query as Record<string, string | undefined>) || {};
      return {
        success: true,
        ...episodicMemory.stats(query.projectDir, query.project),
      };
    } catch (error) {
      metrics.errors++;
      logger.error('memory_stats_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });
};
