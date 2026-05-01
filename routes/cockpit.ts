/**
 * Cockpit Routes — App-Native Development Cockpit intake surface.
 *
 * GET /cockpit/missions?projectDir=...&status=blocked,uncommitted&limit=20
 *
 * Returns a typed work queue parsed from the project's roadmap/recovery
 * markdown. This is the read-only first slice of the cockpit; mission plan
 * creation, claim cross-reference, and skill graft live in later slices.
 *
 * Defaults to deps.repoRoot (the daemon's own checkout) when projectDir is
 * omitted so the cockpit is useful in single-project mode without ceremony.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { readMissions, type MissionStatus } from '../lib/cockpit-missions.js';
import { validateProjectRoot } from '../lib/utils.js';

interface CockpitDeps {
  repoRoot?: string;
  metrics: { errors: number };
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
}

const ALLOWED_STATUSES: ReadonlySet<MissionStatus> = new Set<MissionStatus>([
  'closed',
  'blocked',
  'drifting',
  'stalled',
  'mostly-resolved',
  'mostly-committed',
  'uncommitted',
  'in-flight',
  'unknown',
]);

function parseStatusFilter(raw: unknown): MissionStatus[] | undefined {
  if (typeof raw !== 'string') return undefined;
  const parts = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  const valid: MissionStatus[] = [];
  for (const p of parts) {
    if (ALLOWED_STATUSES.has(p as MissionStatus)) valid.push(p as MissionStatus);
  }
  return valid.length > 0 ? valid : undefined;
}

function parseLimit(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  if (typeof raw === 'string' && raw.trim()) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

export const cockpitPlugin: FastifyPluginAsync<{ deps: CockpitDeps }> = async (fastify, opts) => {
  const { repoRoot, metrics, logger } = opts.deps;

  fastify.get('/cockpit/missions', async (request: FastifyRequest, reply: FastifyReply) => {
    const q = (request.query as Record<string, unknown>) ?? {};
    let projectDir = typeof q.projectDir === 'string' && q.projectDir.trim()
      ? q.projectDir
      : repoRoot;

    if (!projectDir) {
      reply.code(400);
      return { success: false, error: 'projectDir required (no daemon repoRoot configured)' };
    }

    const validation = validateProjectRoot(projectDir);
    if (!validation.ok) {
      reply.code(400);
      return { success: false, error: validation.error };
    }

    const status = parseStatusFilter(q.status);
    const limit = parseLimit(q.limit);

    try {
      const intake = readMissions({ projectDir, status, limit });
      return {
        success: true,
        intake,
        count: intake.missions.length,
      };
    } catch (error) {
      metrics.errors++;
      logger.error('cockpit_missions_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });
};
