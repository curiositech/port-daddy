/**
 * Usage telemetry routes.
 *
 * POST /usage/trace records a local product-usage event.
 * GET  /usage/summary returns aggregate counters for the developer pane.
 * GET  /usage/events returns recent raw trace rows.
 */

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { UsageTelemetry, UsageTelemetryRecordInput } from '../lib/usage-telemetry.js';

interface UsageDeps {
  usageTelemetry?: UsageTelemetry;
  VERSION?: string;
  CODE_HASH?: string;
}

function parseWindowMs(value: string | undefined): number {
  if (!value) return 7 * 86_400_000;
  const trimmed = value.trim().toLowerCase();
  const match = trimmed.match(/^(\d+)(m|h|d|w)?$/);
  if (!match) return 7 * 86_400_000;
  const amount = Math.max(1, parseInt(match[1], 10));
  const unit = match[2] ?? 's';
  if (unit === 'm') return amount * 60_000;
  if (unit === 'h') return amount * 3_600_000;
  if (unit === 'd') return amount * 86_400_000;
  if (unit === 'w') return amount * 7 * 86_400_000;
  return amount * 1_000;
}

function parseSince(query: Record<string, string | undefined>): number {
  if (query.since) {
    const numeric = Number(query.since);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric > 10_000_000_000 ? numeric : Date.now() - numeric * 1_000;
    }
  }
  return Date.now() - parseWindowMs(query.window);
}

function parseLimit(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Math.floor(parsed), 300));
}

function readHeader(request: FastifyRequest, name: string): string | null {
  const value = request.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === 'string' ? value : null;
}

export const usagePlugin: FastifyPluginAsync<{ deps: UsageDeps }> = async (fastify, opts) => {
  const { usageTelemetry } = opts.deps;

  fastify.post('/usage/trace', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!usageTelemetry) {
      return { success: false, disabled: true };
    }

    const body = (request.body ?? {}) as Partial<UsageTelemetryRecordInput>;
    if (typeof body.surface !== 'string' || typeof body.kind !== 'string') {
      reply.code(400);
      return { success: false, error: 'surface and kind are required' };
    }

    const result = usageTelemetry.record({
      surface: body.surface,
      kind: body.kind,
      name: typeof body.name === 'string' ? body.name : `${body.surface}.${body.kind}`,
      category: body.category,
      agentId: body.agentId ?? readHeader(request, 'x-agent-id'),
      agentType: body.agentType,
      agentModel: body.agentModel,
      backend: body.backend,
      model: body.model,
      project: body.project,
      projectDir: body.projectDir,
      route: body.route,
      method: body.method,
      status: body.status,
      durationMs: body.durationMs,
      workScope: body.workScope,
      inputTokens: body.inputTokens,
      cachedInputTokens: body.cachedInputTokens,
      outputTokens: body.outputTokens,
      totalTokens: body.totalTokens,
      turns: body.turns,
      toolCalls: body.toolCalls,
      costUsd: body.costUsd,
      costCurrency: body.costCurrency,
      costIsEstimate: body.costIsEstimate,
      context: body.context,
      metadata: body.metadata,
      version: body.version,
      codeHash: body.codeHash,
      buildDate: body.buildDate,
      cwd: body.cwd,
      userAgent: body.userAgent ?? readHeader(request, 'user-agent'),
    });

    return result;
  });

  fastify.get('/usage/summary', async (request: FastifyRequest) => {
    const query = request.query as Record<string, string | undefined>;
    const since = parseSince(query);
    if (!usageTelemetry) {
      return {
        success: true,
        generatedAt: Date.now(),
        since,
        periodMs: Date.now() - since,
        build: {
          version: opts.deps.VERSION ?? 'unknown',
          codeHash: opts.deps.CODE_HASH ?? 'unknown',
          buildDate: 'unknown',
        },
        totals: {
          events: 0,
          uniqueAgents: 0,
          uniqueProjects: 0,
          uniqueModels: 0,
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          turns: 0,
          toolCalls: 0,
          costUsd: 0,
        },
        costByScope: [],
        bySurface: [],
        byKind: [],
        byCategory: [],
        topNames: [],
        agentModels: [],
        capabilities: [],
        agentCapabilityMatrix: [],
        unusedCapabilities: [],
        recent: [],
      };
    }
    return usageTelemetry.summary({
      since,
      limit: parseLimit(query.limit, 80),
    });
  });

  fastify.get('/usage/events', async (request: FastifyRequest) => {
    const query = request.query as Record<string, string | undefined>;
    const since = parseSince(query);
    const limit = parseLimit(query.limit, 120);
    if (!usageTelemetry) {
      return {
        success: true,
        since,
        events: [],
      };
    }
    return {
      success: true,
      since,
      events: usageTelemetry.recent(limit, since),
    };
  });
};
