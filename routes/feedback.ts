/**
 * Feedback Routes — `/feedback/*`
 *
 * HTTP wrapper over `lib/feedback.ts`. Lets agents in *any* repo drop
 * structured findings without knowing local file paths, and lets
 * humans (or cartographer) read/harvest the stream.
 *
 *   POST   /feedback              — drop a finding
 *   GET    /feedback              — list (filter by severity/surface/status)
 *   GET    /feedback/summary      — counts grouped by severity + surface
 *   GET    /feedback/:id          — fetch a specific entry
 *   POST   /feedback/:id/harvest  — mark as harvested (cartographer)
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type {
  Feedback,
  DropFeedbackInput,
  FeedbackSeverity,
  FeedbackStatus,
  FeedbackSource,
} from '../lib/feedback.js';

interface FeedbackDeps {
  feedback: Feedback;
}

interface DropBody {
  slug?: unknown;
  summary?: unknown;
  droppedBy?: unknown;
  surface?: unknown;
  severity?: unknown;
  source?: unknown;
  suggested?: unknown;
  hook?: unknown;
  fleetbotRunId?: unknown;
  project?: unknown;
  harbor?: unknown;
  ttlMs?: unknown;
}

interface HarvestBody {
  harvestedBy?: unknown;
  intoSlug?: unknown;
}

function asString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  return trimmed ? trimmed : undefined;
}

function asPosInt(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

function harborForProject(project: string | undefined): string | undefined {
  return project ? `${project}:fleet` : undefined;
}

const SEVERITY_VALUES = new Set<FeedbackSeverity>(['low', 'medium', 'high', 'critical']);
const STATUS_VALUES = new Set<FeedbackStatus | 'all'>(['open', 'harvested', 'wontfix', 'all']);
const SOURCE_VALUES = new Set<FeedbackSource>(['agent', 'human', 'mcp', 'cli', 'unknown']);

export const feedbackPlugin: FastifyPluginAsync<{ deps: FeedbackDeps }> = async (fastify, opts) => {
  const { feedback } = opts.deps;

  fastify.post('/feedback', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as DropBody;
    const slug = asString(body.slug);
    const summary = asString(body.summary);
    const droppedBy = asString(body.droppedBy);
    if (!slug || !summary || !droppedBy) {
      reply.code(400);
      return { success: false, error: 'slug, summary, and droppedBy are required' };
    }

    const input: DropFeedbackInput = { slug, summary, droppedBy };
    const surface = asString(body.surface);
    if (surface) input.surface = surface;
    const severityRaw = asString(body.severity);
    if (severityRaw && SEVERITY_VALUES.has(severityRaw as FeedbackSeverity)) {
      input.severity = severityRaw as FeedbackSeverity;
    }
    const sourceRaw = asString(body.source);
    if (sourceRaw && SOURCE_VALUES.has(sourceRaw as FeedbackSource)) {
      input.source = sourceRaw as FeedbackSource;
    }
    const suggested = asString(body.suggested);
    if (suggested) input.suggested = suggested;
    const hook = asString(body.hook);
    if (hook) input.hook = hook;
    const fleetbotRunId = asString(body.fleetbotRunId);
    if (fleetbotRunId) input.fleetbotRunId = fleetbotRunId;
    const project = asString(body.project);
    if (project) input.project = project;
    const harbor = asString(body.harbor);
    if (harbor) input.harbor = harbor;
    const ttlMs = asPosInt(body.ttlMs);
    if (ttlMs !== undefined) input.ttlMs = ttlMs;

    try {
      const entry = feedback.drop(input);
      reply.code(201);
      return { success: true, entry };
    } catch (error) {
      reply.code(400);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'drop failed',
      };
    }
  });

  fastify.get('/feedback', async (request: FastifyRequest) => {
    const q = (request.query ?? {}) as Record<string, unknown>;
    const project = asString(q.project);
    const harbor = asString(q.harbor) ?? harborForProject(project);
    const limit = asPosInt(q.limit);
    const surface = asString(q.surface);
    const severityRaw = asString(q.severity);
    const statusRaw = asString(q.status);

    const entries = feedback.list({
      harbor,
      limit,
      surface,
      severity:
        severityRaw && SEVERITY_VALUES.has(severityRaw as FeedbackSeverity)
          ? (severityRaw as FeedbackSeverity)
          : undefined,
      status:
        statusRaw && STATUS_VALUES.has(statusRaw as FeedbackStatus | 'all')
          ? (statusRaw as FeedbackStatus | 'all')
          : undefined,
    });
    return { success: true, entries, count: entries.length };
  });

  fastify.get('/feedback/summary', async (request: FastifyRequest) => {
    const q = (request.query ?? {}) as Record<string, unknown>;
    const project = asString(q.project);
    const harbor = asString(q.harbor) ?? harborForProject(project);
    return { success: true, summary: feedback.summary(harbor) };
  });

  fastify.get('/feedback/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { id?: string };
    const feedbackId = asString(params.id);
    if (!feedbackId) {
      reply.code(400);
      return { success: false, error: 'feedback id required in path' };
    }
    const entry = feedback.get(feedbackId);
    if (!entry) {
      reply.code(404);
      return { success: false, error: `feedback '${feedbackId}' not found` };
    }
    return { success: true, entry };
  });

  fastify.post('/feedback/:id/harvest', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { id?: string };
    const feedbackId = asString(params.id);
    if (!feedbackId) {
      reply.code(400);
      return { success: false, error: 'feedback id required in path' };
    }
    const body = (request.body ?? {}) as HarvestBody;
    const harvestedBy = asString(body.harvestedBy);
    if (!harvestedBy) {
      reply.code(400);
      return { success: false, error: 'harvestedBy is required' };
    }
    const intoSlug = asString(body.intoSlug);
    try {
      const entry = feedback.harvest({ feedbackId, harvestedBy, intoSlug });
      return { success: true, entry };
    } catch (error) {
      reply.code(400);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'harvest failed',
      };
    }
  });
};
