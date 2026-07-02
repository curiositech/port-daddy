/**
 * Visual Task Routes — browser/FleetBar issue intake.
 *
 * POST /visual-tasks accepts one product-level visual issue envelope from a
 * browser extension, FleetBar, or another UI. It persists screenshots as blobs,
 * publishes the payload to visual-feedback, optionally messages a target agent,
 * and opens a reviewable work item without exposing dispatch/worker vocabulary
 * to the UI.
 */

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  createVisualTaskIntake,
  type VisualTaskSubmission,
  type VisualTaskIntakeDeps,
} from '../lib/visual-task-intake.js';

interface VisualTasksRouteDeps {
  deps: VisualTaskIntakeDeps;
}

export const visualTasksPlugin: FastifyPluginAsync<VisualTasksRouteDeps> = async (fastify, opts) => {
  const intake = createVisualTaskIntake(opts.deps);

  fastify.post(
    '/visual-tasks',
    { bodyLimit: 8 * 1024 * 1024 },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const result = await intake.submit(request.body as VisualTaskSubmission);
        return reply.code(201).send(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(400).send({
          success: false,
          error: message,
        });
      }
    },
  );
};
