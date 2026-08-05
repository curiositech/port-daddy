/**
 * Cloud app telemetry routes.
 *
 * POST /telemetry/cloud-app          — authenticated remote Worker/App ingest
 * GET  /telemetry/cloud-app          — summary for operator dashboards
 * GET  /telemetry/cloud-app/events   — recent raw remote telemetry events
 */

import { timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { CloudAppTelemetry, CloudAppTelemetryInput } from '../lib/cloud-app-telemetry.js';
import { getSecret } from '../lib/secret-env.js';

interface CloudAppTelemetryDeps {
  cloudAppTelemetry?: CloudAppTelemetry;
  remoteTelemetryToken?: string | null;
}

function parseSince(query: Record<string, string | undefined>): number {
  if (!query.since) return Date.now() - 86_400_000;
  const numeric = Number(query.since);
  if (!Number.isFinite(numeric) || numeric <= 0) return Date.now() - 86_400_000;
  return numeric > 10_000_000_000 ? numeric : Date.now() - numeric * 1_000;
}

function parseLimit(value: string | undefined, fallback = 50): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Math.floor(parsed), 200));
}

function expectedToken(deps: CloudAppTelemetryDeps): string | null {
  return (
    deps.remoteTelemetryToken?.trim()
    || getSecret('PD_CLOUD_APP_TELEMETRY_TOKEN')?.trim()
    || getSecret('PD_REMOTE_TELEMETRY_TOKEN')?.trim()
    || null
  );
}

function readBearer(request: FastifyRequest): string | null {
  const value = request.headers.authorization;
  if (typeof value !== 'string') return null;
  if (!value.startsWith('Bearer ')) return null;
  const token = value.slice('Bearer '.length).trim();
  return token || null;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export const cloudAppTelemetryPlugin: FastifyPluginAsync<{ deps: CloudAppTelemetryDeps }> = async (fastify, opts) => {
  const { cloudAppTelemetry } = opts.deps;

  fastify.post('/telemetry/cloud-app', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!cloudAppTelemetry) {
      reply.code(501);
      return { success: false, error: 'cloud app telemetry store not wired' };
    }

    const configuredToken = expectedToken(opts.deps);
    if (!configuredToken) {
      reply.code(503);
      return { success: false, error: 'remote telemetry token is not configured' };
    }

    const bearer = readBearer(request);
    if (!bearer || !safeEqual(bearer, configuredToken)) {
      reply.code(401);
      return { success: false, error: 'unauthorized' };
    }

    const body = (request.body ?? {}) as Partial<CloudAppTelemetryInput>;
    if (body.metadata !== undefined && (body.metadata === null || typeof body.metadata !== 'object' || Array.isArray(body.metadata))) {
      reply.code(400);
      return { success: false, error: 'metadata must be an object when provided' };
    }

    const event = cloudAppTelemetry.record(body as CloudAppTelemetryInput);
    if (!event) {
      reply.code(400);
      return { success: false, error: 'could not record cloud app telemetry event' };
    }

    return { success: true, event };
  });

  fastify.get('/telemetry/cloud-app', async (request: FastifyRequest) => {
    const query = request.query as Record<string, string | undefined>;
    const since = parseSince(query);
    if (!cloudAppTelemetry) {
      return {
        success: true,
        generatedAt: Date.now(),
        since,
        totals: {
          events: 0,
          uniqueDeliveries: 0,
          shipEvents: 0,
          checkRunEvents: 0,
          commentEvents: 0,
          errorEvents: 0,
          costUsd: 0,
          estimatedCostEvents: 0,
          unknownCostEvents: 0,
        },
        byRepo: [],
        byShip: [],
        byBackend: [],
        recent: [],
      };
    }
    return cloudAppTelemetry.summary({ since, limit: parseLimit(query.limit) });
  });

  fastify.get('/telemetry/cloud-app/events', async (request: FastifyRequest) => {
    const query = request.query as Record<string, string | undefined>;
    const since = parseSince(query);
    const limit = parseLimit(query.limit, 100);
    return {
      success: true,
      since,
      events: cloudAppTelemetry ? cloudAppTelemetry.recent(limit, since) : [],
    };
  });
};
