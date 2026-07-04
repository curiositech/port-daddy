/**
 * Visual Task Routes — browser/FleetBar issue intake.
 *
 * POST /visual-tasks accepts one product-level visual issue envelope from a
 * browser extension, FleetBar, or another UI. It persists screenshots as blobs,
 * publishes the payload to visual-feedback, optionally messages a target agent,
 * and opens a reviewable work item without exposing dispatch/worker vocabulary
 * to the UI.
 *
 * Error contract (matches routes/blob.ts and routes/actors.ts conventions):
 * client input problems answer 400 with code VALIDATION_ERROR; a missing blob
 * store answers 503 BLOB_STORE_UNCONFIGURED; runtime dependency failures
 * (blob write, publish, dispatch) answer 500 with a distinct code. Screenshot
 * evidence is never dropped: when the caller wires no blob store, the plugin
 * roots a default filesystem store at ~/.port-daddy/blobs.
 */

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  createVisualTaskIntake,
  VisualTaskInputError,
  VisualTaskDependencyError,
  VisualTaskInternalError,
  type VisualTaskSubmission,
  type VisualTaskIntakeDeps,
} from '../lib/visual-task-intake.js';
import { createBlobStore, type CreateBlobStoreOptions } from '../lib/blob.js';

interface VisualTasksRouteDeps {
  deps: VisualTaskIntakeDeps;
  /** Overrides for the default blob store used when deps.blobs is absent (tests). */
  blobStoreOptions?: CreateBlobStoreOptions;
}

function classifyError(err: unknown): { statusCode: number; code: string; message: string } {
  if (
    err instanceof VisualTaskInputError ||
    err instanceof VisualTaskDependencyError ||
    err instanceof VisualTaskInternalError
  ) {
    return { statusCode: err.statusCode, code: err.code, message: err.message };
  }
  return {
    statusCode: 500,
    code: 'VISUAL_TASK_INTAKE_FAILED',
    message: err instanceof Error ? err.message : String(err),
  };
}

export const visualTasksPlugin: FastifyPluginAsync<VisualTasksRouteDeps> = async (fastify, opts) => {
  // Screenshot evidence must never be lost to partial wiring: if the daemon
  // deps carry no blob store, wire the default filesystem-backed store
  // (~/.port-daddy/blobs) so dataUrl submissions always persist.
  const deps: VisualTaskIntakeDeps = opts.deps.blobs
    ? opts.deps
    : { ...opts.deps, blobs: createBlobStore(opts.blobStoreOptions) };
  const intake = createVisualTaskIntake(deps);

  fastify.post(
    '/visual-tasks',
    { bodyLimit: 8 * 1024 * 1024 },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const result = await intake.submit(request.body as VisualTaskSubmission);
        return reply.code(201).send(result);
      } catch (err) {
        const { statusCode, code, message } = classifyError(err);
        if (statusCode >= 500) {
          request.log?.error?.({ err, code }, 'visual task intake failed');
        }
        return reply.code(statusCode).send({
          success: false,
          error: message,
          code,
        });
      }
    },
  );
};
