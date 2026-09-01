/**
 * Authenticated Harbor Editor recovery routes.
 *
 * Registration is scaffolding, not a usable recovery pipeline. P1 receipt
 * production, P1B, canonical Rust Loro recovery, verified scope witnesses,
 * content-bound symbol/file-mutation authorities, and the P3 same-database
 * transfer adapter remain external gates; until they land, every public
 * mutation fails closed with 503 and persists no phase effect.
 */

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type Database from 'better-sqlite3';
import {
  createEditorRecovery,
  type CanonicalLoroAuthority,
  type EditorClaimTransferAuthority,
  type EditorFileMutationAuthority,
  type EditorRecovery,
  type EditorRecoveryFailure,
  type EditorRecoveryProvenanceDrainScheduler,
  type EditorRecoveryProvenancePublisher,
  type EditorRecoveryScopeAuthority,
  type EditorSymbolAuthority,
} from '../lib/editor-recovery.js';
import {
  extractActorCredential,
  resolveWriteIdentity,
  type IdentityVerifier,
  type IdentityWriteVerdict,
} from '../lib/identity-write-boundary.js';

interface EditorRecoveryRouteDeps {
  db: Database.Database;
  editorRecovery?: EditorRecovery;
  editorRecoveryScopeAuthority?: EditorRecoveryScopeAuthority | null;
  canonicalLoroAuthority?: CanonicalLoroAuthority | null;
  editorSymbolAuthority?: EditorSymbolAuthority | null;
  editorClaimTransferAuthority?: EditorClaimTransferAuthority | null;
  editorFileMutationAuthority?: EditorFileMutationAuthority | null;
  editorRecoveryProvenancePublisher?: EditorRecoveryProvenancePublisher | null;
  actorSouls?: IdentityVerifier | null;
  logger?: {
    info?(msg: string, meta?: Record<string, unknown>): void;
    error?(msg: string, meta?: Record<string, unknown>): void;
  };
}

function sendResult(reply: FastifyReply, result: Record<string, unknown> | EditorRecoveryFailure, successStatus = 200) {
  if (result.success === false) {
    const rejected = result as EditorRecoveryFailure;
    return reply.status(rejected.httpStatus).send({
      success: false,
      error: rejected.error,
      code: rejected.code,
      ...(rejected.conflicts ? { conflicts: rejected.conflicts } : {}),
    });
  }
  return reply.status(successStatus).send(result);
}

export const editorRecoveryPlugin: FastifyPluginAsync<{ deps: EditorRecoveryRouteDeps }> = async (
  fastify,
  opts,
) => {
  const { db, actorSouls, logger } = opts.deps;
  const ownsEditorRecovery = !opts.deps.editorRecovery;
  /**
   * Reports a timer failure without letting a logger exception become an
   * unhandled rejection. The design intent is honest daemon diagnostics with
   * process-safe scheduler callbacks.
   *
   * @param event stable daemon log event
   * @param error rejected scheduler callback value
   * @returns nothing; reporting is deliberately best-effort
   */
  const reportDrainFailure = (event: string, error: unknown): void => {
    try {
      logger?.error?.(event, { error: error instanceof Error ? error.message : String(error) });
    } catch {
      // Timer callbacks must never create an unhandled rejection via logging.
    }
  };
  const provenanceDrainScheduler: EditorRecoveryProvenanceDrainScheduler | null =
    opts.deps.editorRecoveryProvenancePublisher
      ? {
        scheduleStartup(run) {
          queueMicrotask(() => {
            void run().catch(error => reportDrainFailure('editor_recovery_provenance_startup_drain_failed', error));
          });
        },
        schedulePeriodic(run, intervalMs) {
          const timer = setInterval(() => {
            void run().catch(error => reportDrainFailure('editor_recovery_provenance_periodic_drain_failed', error));
          }, intervalMs);
          timer.unref?.();
          return { dispose: () => clearInterval(timer) };
        },
      }
      : null;
  const editorRecovery = opts.deps.editorRecovery ?? createEditorRecovery(db, {
    scopeAuthority: opts.deps.editorRecoveryScopeAuthority,
    canonicalLoro: opts.deps.canonicalLoroAuthority,
    symbolAuthority: opts.deps.editorSymbolAuthority,
    claimTransferAuthority: opts.deps.editorClaimTransferAuthority,
    fileMutationAuthority: opts.deps.editorFileMutationAuthority,
    provenancePublisher: opts.deps.editorRecoveryProvenancePublisher,
    provenanceDrainScheduler,
    cleanupDiagnosticReporter(diagnostic) {
      logger?.error?.('editor_recovery_cleanup_failed', { ...diagnostic });
    },
  });
  if (ownsEditorRecovery) {
    fastify.addHook('onClose', async () => {
      await editorRecovery.dispose();
    });
  }

  const requireEditorIdentity = (
    request: FastifyRequest,
    route: string,
  ):
    | { success: true; verdict: Extract<IdentityWriteVerdict, { ok: true; kind: 'verified' }> }
    | { success: false; httpStatus: number; result: Record<string, unknown> } => {
    const verdict = resolveWriteIdentity({
      souls: actorSouls,
      credential: extractActorCredential(request.headers as Record<string, unknown>, request.body),
      assertedAgentId: null,
      route,
      logger: logger as any,
      requireIdentity: true,
    });
    if (!verdict.ok) {
      return {
        success: false,
        httpStatus: verdict.httpStatus,
        result: { success: false, error: verdict.error, code: verdict.code },
      };
    }
    return {
      success: true,
      verdict: verdict as Extract<IdentityWriteVerdict, { ok: true; kind: 'verified' }>,
    };
  };

  fastify.post('/editor/recovery/request', async (request: FastifyRequest, reply: FastifyReply) => {
    const identity = requireEditorIdentity(request, 'POST /editor/recovery/request');
    if (!identity.success) return reply.status(identity.httpStatus).send(identity.result);
    const body = request.body as {
      dead_session_id?: unknown;
      requester_session_id?: unknown;
      file_path?: unknown;
    };
    const result = await editorRecovery.requestEvidence({
      deadSessionId: typeof body?.dead_session_id === 'string' ? body.dead_session_id : '',
      requesterSessionId: typeof body?.requester_session_id === 'string' ? body.requester_session_id : '',
      filePath: typeof body?.file_path === 'string' ? body.file_path : '',
      requestedByActorId: identity.verdict.actorId,
    });
    if (result.success === true) logger?.info?.('editor_recovery_requested', { actorId: identity.verdict.actorId });
    return sendResult(reply, result, 201);
  });

  fastify.post('/editor/recovery/prepare', async (request: FastifyRequest, reply: FastifyReply) => {
    const identity = requireEditorIdentity(request, 'POST /editor/recovery/prepare');
    if (!identity.success) return reply.status(identity.httpStatus).send(identity.result);
    const body = request.body as { token?: unknown; successor_session_id?: unknown };
    const result = await editorRecovery.prepareForReplay({
      token: typeof body?.token === 'string' ? body.token : '',
      successorSessionId: typeof body?.successor_session_id === 'string' ? body.successor_session_id : '',
      preparedByActorId: identity.verdict.actorId,
    });
    if (result.success === true) logger?.info?.('editor_recovery_prepared', { actorId: identity.verdict.actorId });
    return sendResult(reply, result);
  });

  fastify.post('/editor/recovery/replay', async (request: FastifyRequest, reply: FastifyReply) => {
    const identity = requireEditorIdentity(request, 'POST /editor/recovery/replay');
    if (!identity.success) return reply.status(identity.httpStatus).send(identity.result);
    const body = request.body as { preparation_id?: unknown; successor_session_id?: unknown };
    const result = await editorRecovery.validatePreparedReplay({
      preparationId: typeof body?.preparation_id === 'string' ? body.preparation_id : '',
      successorSessionId: typeof body?.successor_session_id === 'string' ? body.successor_session_id : '',
      validatedByActorId: identity.verdict.actorId,
    });
    if (result.success === true) logger?.info?.('editor_recovery_replay_validated', { actorId: identity.verdict.actorId });
    return sendResult(reply, result);
  });

  fastify.post('/editor/recovery/finalize', async (request: FastifyRequest, reply: FastifyReply) => {
    const identity = requireEditorIdentity(request, 'POST /editor/recovery/finalize');
    if (!identity.success) return reply.status(identity.httpStatus).send(identity.result);
    const body = request.body as {
      token?: unknown;
      preparation_id?: unknown;
      successor_session_id?: unknown;
    };
    const result = await editorRecovery.finalizeRecovery({
      token: typeof body?.token === 'string' ? body.token : '',
      preparationId: typeof body?.preparation_id === 'string' ? body.preparation_id : '',
      successorSessionId: typeof body?.successor_session_id === 'string' ? body.successor_session_id : '',
      finalizedByActorId: identity.verdict.actorId,
    });
    if (result.success === true) logger?.info?.('editor_recovery_finalized', { actorId: identity.verdict.actorId });
    return sendResult(reply, result);
  });
};
