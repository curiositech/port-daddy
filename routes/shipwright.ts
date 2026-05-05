/**
 * Shipwright Route — `POST /shipwright/survey`
 *
 * Wraps `lib/shipwright/survey.ts` so the dashboard, FleetBar, and
 * `pd shipwright survey` CLI can request a structured `ProjectSurvey`
 * over HTTP. The survey itself is deterministic (no LLM by default) — see
 * `docs/shipwright/SHIPWRIGHT-DESIGN.md §4`.
 *
 * Read-only relative to the surveyed root: the route never writes back
 * to the project being inspected. The optional LLM augmentation runs in
 * the daemon's process, so the daemon-level rate limits and budget kill
 * apply to the call.
 *
 * Body: { root: string, withLlm?: boolean, model?: string }
 *  - root      : absolute path to the project to survey (required)
 *  - withLlm   : if true and an LLM client is wired, run the intent +
 *                purpose summarization step (confidence 0.55 → 0.82)
 *  - model     : override the default model id when withLlm is true
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { isAbsolute } from 'node:path';
import { surveyProject } from '../lib/shipwright/survey.js';
import type { LLMClient } from '../lib/llm-call.js';

interface ShipwrightDeps {
  /** Optional LLM client for survey intent/purpose summarization. */
  llmClient?: LLMClient;
  /** Default model id used when the request asks for LLM augmentation. */
  defaultLlmModel?: string;
}

interface SurveyRequestBody {
  root?: string;
  withLlm?: boolean;
  model?: string;
}

export const shipwrightPlugin: FastifyPluginAsync<{ deps: ShipwrightDeps }> = async (
  fastify,
  opts,
) => {
  const { deps } = opts;

  fastify.post('/shipwright/survey', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as SurveyRequestBody;
    const root = body.root;

    if (!root || typeof root !== 'string') {
      reply.code(400);
      return { success: false, error: 'root (absolute path) is required' };
    }
    if (!isAbsolute(root)) {
      reply.code(400);
      return { success: false, error: 'root must be an absolute path' };
    }

    const wantLlm = Boolean(body.withLlm);
    const client = wantLlm ? deps.llmClient : undefined;
    const model = wantLlm ? (body.model || deps.defaultLlmModel) : undefined;

    if (wantLlm && (!client || !model)) {
      // Fall through silently to the heuristic path — the survey will
      // just return confidence 0.55. Surface a `degraded` flag so the
      // caller can show the operator that no LLM was wired.
      try {
        const survey = await surveyProject(root);
        return { success: true, survey, degraded: true, reason: 'no LLM client configured' };
      } catch (error) {
        reply.code(500);
        return { success: false, error: errMessage(error) };
      }
    }

    try {
      const survey = await surveyProject(root, { client, model });
      return { success: true, survey };
    } catch (error) {
      reply.code(500);
      return { success: false, error: errMessage(error) };
    }
  });
};

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'shipwright survey failed';
}
