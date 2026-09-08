/**
 * Advisor Routes — coordination suggestibility for humans and agents.
 *
 * GET  /advisor  — lightweight query form for CLI/browser probes
 * POST /advisor  — structured preflight body for CLI/MCP/SDK callers
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import { createAdvisor, type AdvisorDeps, type AdvisorInput } from '../lib/advisor.js';

interface AdvisorRouteDeps extends AdvisorDeps {
  db: Database.Database;
}

function parseFiles(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function queryToInput(query: Record<string, unknown>): AdvisorInput {
  return {
    projectRoot: typeof query.projectRoot === 'string' ? query.projectRoot : undefined,
    project: typeof query.project === 'string' ? query.project : undefined,
    sessionId: typeof query.sessionId === 'string' ? query.sessionId : undefined,
    agentId: typeof query.agentId === 'string' ? query.agentId : undefined,
    task: typeof query.task === 'string' ? query.task : undefined,
    files: parseFiles(query.files ?? query.file),
    changedFiles: parseFiles(query.changedFiles),
    includeChannels: parseBoolean(query.includeChannels),
    includeTupleHints: parseBoolean(query.includeTupleHints),
  };
}

export const advisorPlugin: FastifyPluginAsync<{ deps: AdvisorRouteDeps }> = async (fastify, opts) => {
  const advisor = createAdvisor(opts.deps.db, {
    resurrection: opts.deps.resurrection,
    messaging: opts.deps.messaging,
  });

  fastify.get('/advisor', async (request: FastifyRequest, _reply: FastifyReply) => {
    const input = queryToInput(request.query as Record<string, unknown>);
    return advisor.evaluate(input);
  });

  fastify.post('/advisor', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as AdvisorInput;
    if (body.files !== undefined && !Array.isArray(body.files)) {
      reply.code(400);
      return { success: false, error: 'files must be an array when provided' };
    }
    if (body.changedFiles !== undefined && !Array.isArray(body.changedFiles)) {
      reply.code(400);
      return { success: false, error: 'changedFiles must be an array when provided' };
    }
    return advisor.evaluate(body);
  });
};
