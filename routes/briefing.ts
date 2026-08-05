/**
 * Briefing Routes
 *
 * POST /briefing          — Generate .portdaddy/ in projectRoot, write to disk
 * GET  /briefing/:project — Return briefing as JSON (no disk write)
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { validateProjectRoot } from '../lib/utils.js';
import {
  buildArrivalBriefing,
  renderArrivalBriefing,
  type NeighbourCandidate,
  type RoadmapCandidate,
  type SalvageCandidate,
  type SkillCandidate,
} from '../lib/arrival-briefing.js';

/**
 * Stores the arrival briefing ranks over.
 *
 * All optional: a daemon missing one simply produces a briefing without that
 * section. Unlike the reconcile loop — where an absent source must not be
 * confused with an empty one, because keys get deleted on the strength of the
 * answer — nothing here is destructive, so a missing store degrades to silence
 * with no further consequence.
 */
interface ArrivalDeps {
  resurrection?: { listPending(options?: Record<string, unknown>): unknown };
  sessions?: { list(options?: Record<string, unknown>): unknown; listAllActiveClaims?(o?: Record<string, unknown>): unknown };
  roadmapItems?: { list(options?: Record<string, unknown>): unknown };
  skills?: { list(options?: Record<string, unknown>): unknown };
}

interface BriefingRouteDeps extends ArrivalDeps {
  briefing: {
    generate(projectRoot: string, options?: { project?: string | null; writeToDisk?: boolean; full?: boolean }): {
      success: boolean;
      briefingPath?: string;
      files?: string[];
      briefing?: Record<string, unknown>;
      error?: string;
    };
    sync(projectRoot: string, options?: { project?: string | null; full?: boolean }): {
      success: boolean;
      briefingPath?: string;
      files?: string[];
      archivedSessions?: number;
      archivedAgents?: number;
      error?: string;
    };
    gatherData(project: string, projectRoot: string): Record<string, unknown>;
    detectProject(projectRoot: string, explicitProject?: string | null): string;
  };
}


// =============================================================================
// Fastify plugin export
// =============================================================================

export const briefingPlugin: FastifyPluginAsync<{ deps: BriefingRouteDeps }> = async (fastify, opts) => {
  const { deps } = opts;
  const { briefing } = deps;

  fastify.post('/briefing', async (request: FastifyRequest, reply: FastifyReply) => {
    const { projectRoot, project, full } = request.body as any;

    if (!projectRoot || typeof projectRoot !== 'string') {
      reply.code(400);
      return { success: false, error: 'projectRoot is required' };
    }

    const validation = validateProjectRoot(projectRoot);
    if (!validation.ok) {
      reply.code(400);
      return { success: false, error: validation.error };
    }

    try {
      if (full) {
        const result = briefing.sync(projectRoot, { project, full: true });
        if (!result.success) { reply.code(400); return result; }
        return result;
      } else {
        const result = briefing.generate(projectRoot, { project });
        if (!result.success) { reply.code(400); return result; }
        return result;
      }
    } catch (err) {
      reply.code(500);
      return { success: false, error: (err as Error).message };
    }
  });

  fastify.get('/briefing/:project', async (request: FastifyRequest, reply: FastifyReply) => {
    const { project } = request.params as any;
    const projectRoot = ((request.query as any).projectRoot as string) || process.cwd();

    const validation = validateProjectRoot(projectRoot);
    if (!validation.ok) {
      reply.code(400);
      return { success: false, error: validation.error };
    }

    try {
      const result = briefing.generate(projectRoot, { project, writeToDisk: false });
      if (!result.success) { reply.code(400); return result; }
      return { success: true, briefing: result.briefing };
    } catch (err) {
      reply.code(500);
      return { success: false, error: (err as Error).message };
    }
  });

  /**
   * GET /briefing/arrival — what an arriving agent should be told, ranked.
   *
   * Distinct from `/briefing/:project`, which projects project state wholesale.
   * This answers a narrower question: of everything the daemon knows, what is
   * relevant to *this* agent starting *this* work right now. Sections that match
   * nothing are omitted, and a briefing where nothing matches renders as the
   * empty string — the harness stays quiet by default, and a block that always
   * prints is a block agents learn to skip.
   *
   * Every store is read defensively: one unavailable corpus costs its own
   * section and nothing else, because a session-start path that throws is a
   * session-start path that blocks the agent's first turn.
   */
  fastify.get('/briefing/arrival', async (request: FastifyRequest, reply: FastifyReply) => {
    const q = request.query as Record<string, string | undefined>;
    const actor = (q.actor ?? '').trim();
    if (!actor) {
      reply.code(400);
      return { success: false, error: 'actor is required' };
    }
    const ctx = {
      actor,
      ...(q.purpose ? { purpose: q.purpose } : {}),
      ...(q.project ? { project: q.project } : {}),
      ...(q.files ? { files: q.files.split(',').map((f) => f.trim()).filter(Boolean) } : {}),
      ...(q.hints ? { hints: q.hints.split(',').map((h) => h.trim()).filter(Boolean) } : {}),
    };

    // Read straight off the shared route deps: `sessions`, `resurrection` and
    // `roadmapItems` are already registered there for the other plugins, so
    // there is nothing extra for the composition root to wire.
    const a: ArrivalDeps = deps;
    const corpora = {
      salvage: safely(() => toSalvage(a.resurrection?.listPending({ limit: 100 }))),
      roadmap: safely(() => toRoadmap(a.roadmapItems?.list({ limit: 200 }))),
      skills: safely(() => toSkills(a.skills?.list({ limit: 500 }))),
      neighbours: safely(() => toNeighbours(a.sessions?.list({ status: 'active', allWorktrees: true, limit: 100 }))),
    };

    const result = buildArrivalBriefing(ctx, corpora);
    return { success: true, briefing: result, rendered: renderArrivalBriefing(result) };
  });
};

/** Run a corpus fetch, degrading to an empty section rather than a 500. */
function safely<T>(fn: () => readonly T[]): readonly T[] {
  try {
    return fn();
  } catch {
    return [];
  }
}

/** Unwrap whichever envelope a store's list surface returns. */
function rows(listed: unknown, key: string): readonly Record<string, unknown>[] {
  if (Array.isArray(listed)) return listed as Record<string, unknown>[];
  if (listed && typeof listed === 'object') {
    const inner = (listed as Record<string, unknown>)[key];
    if (Array.isArray(inner)) return inner as Record<string, unknown>[];
  }
  return [];
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
const strList = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined;

function toSalvage(listed: unknown): SalvageCandidate[] {
  return rows(listed, 'agents')
    .map((r) => ({
      agentId: String(r.agentId ?? r.agent_id ?? ''),
      ...(str(r.purpose) ? { purpose: str(r.purpose)! } : {}),
      ...(str(r.identityProject ?? r.project) ? { project: str(r.identityProject ?? r.project)! } : {}),
      ...(strList(r.files) ? { files: strList(r.files)! } : {}),
      ...(strList(r.notes) ? { notes: strList(r.notes)! } : {}),
    }))
    .filter((c) => c.agentId);
}

function toRoadmap(listed: unknown): RoadmapCandidate[] {
  return rows(listed, 'items')
    .map((r) => ({
      id: String(r.id ?? ''),
      title: String(r.title ?? r.name ?? ''),
      ...(str(r.body ?? r.description) ? { body: str(r.body ?? r.description)! } : {}),
      ...(str(r.status) ? { status: str(r.status)! } : {}),
      ...(strList(r.tags) ? { tags: strList(r.tags)! } : {}),
    }))
    .filter((c) => c.id && c.title);
}

function toSkills(listed: unknown): SkillCandidate[] {
  return rows(listed, 'skills')
    .map((r) => ({
      id: String(r.id ?? r.name ?? ''),
      ...(str(r.description) ? { description: str(r.description)! } : {}),
      ...(strList(r.tags) ? { tags: strList(r.tags)! } : {}),
    }))
    .filter((c) => c.id);
}

function toNeighbours(listed: unknown): NeighbourCandidate[] {
  return rows(listed, 'sessions')
    .map((r) => ({
      actor: String(r.agentId ?? r.agent_id ?? ''),
      sessionId: String(r.id ?? ''),
      ...(str(r.purpose) ? { purpose: str(r.purpose)! } : {}),
      ...(str(r.identityProject ?? r.project) ? { project: str(r.identityProject ?? r.project)! } : {}),
      ...(strList(r.files) ? { files: strList(r.files)! } : {}),
    }))
    .filter((c) => c.actor);
}
