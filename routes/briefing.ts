/**
 * Briefing Routes
 *
 * POST /briefing          — Generate .portdaddy/ in projectRoot, write to disk
 * GET  /briefing/:project — Return briefing as JSON (no disk write)
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { validateProjectRoot } from '../lib/utils.js';
import {
  VECTOR_KIND,
  buildArrivalBriefing,
  buildArrivalBriefingSemantic,
  renderArrivalBriefing,
  type SemanticStoreLike,
  type NeighbourCandidate,
  type NoteCandidate,
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
  sessions?: {
    list(options?: Record<string, unknown>): unknown;
    listAllActiveClaims?(o?: Record<string, unknown>): unknown;
    getNotes?(sessionId?: string | null, options?: Record<string, unknown>): unknown;
  };
  roadmapItems?: { list(options?: Record<string, unknown>): unknown };
  skills?: { list(options?: Record<string, unknown>): unknown };
}

interface BriefingRouteDeps extends ArrivalDeps {
  /**
   * Shared vector store, when the daemon has one.
   *
   * Optional so a daemon whose embedder never loaded still serves arrivals —
   * the briefing degrades to lexical and SAYS so, rather than 500ing on an
   * agent's first turn.
   */
  vectors?: SemanticStoreLike & {
    warm(kind: string, items: readonly { id: string; text: string }[], opts?: { prune?: boolean }): Promise<unknown>;
  };
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
    // Fill anything the caller did not supply from this actor's live session.
    //
    // **Without this the default invocation is dead.** The ranking query is
    // built from purpose + hints + file basenames — `actor` is deliberately NOT
    // part of it, since matching on an agent's own name would introduce it to
    // everything it has ever touched. So a bare `pd arrive`, which knows only
    // who it is, produces an EMPTY query, and an empty query matches nothing in
    // any of the four corpora. The briefing would render as silence and look
    // exactly like "nothing relevant" rather than "I was never told what I am
    // working on".
    //
    // Derived here rather than in the CLI so every caller benefits — the
    // session-start hook, `pd arrive`, and anything that reaches the route
    // later — and because the daemon already holds the session, so this costs
    // no extra round trip.
    const own = ownSession(deps, actor);
    const purpose = q.purpose ?? own?.purpose;
    const project = q.project ?? own?.project;
    const files = q.files
      ? q.files.split(',').map((f) => f.trim()).filter(Boolean)
      : own?.files;

    const ctx = {
      actor,
      ...(purpose ? { purpose } : {}),
      ...(project ? { project } : {}),
      ...(files && files.length ? { files } : {}),
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
      // Notes are the least discoverable corpus and the most valuable: they are
      // where an agent wrote down what it learned the hard way, into a session
      // that then ended. Nobody browses another session's notes, so without
      // this the knowledge dies with the session.
      notes: safely(() => toNotes(a.sessions?.getNotes?.(null, { limit: 300 }))),
    };

    // Warm the four corpora before ranking. Content-addressed, so the steady
    // state is a hash per item and zero model calls; only genuinely new or
    // edited text costs anything. Best-effort: a failed warm leaves those
    // vectors stale or absent and the fusion path degrades accordingly.
    const store = deps.vectors;
    if (store) {
      await Promise.all([
        store.warm(VECTOR_KIND.salvage, corpora.salvage.map((c) => ({ id: c.agentId, text: [c.purpose, ...(c.notes ?? [])].filter(Boolean).join(' ') })), { prune: true }).catch(() => {}),
        store.warm(VECTOR_KIND.roadmap, corpora.roadmap.map((c) => ({ id: c.id, text: [c.title, c.body, ...(c.tags ?? [])].filter(Boolean).join(' ') })), { prune: true }).catch(() => {}),
        store.warm(VECTOR_KIND.skills, corpora.skills.map((c) => ({ id: c.id, text: [c.id.replace(/[-_]/g, ' '), c.description, ...(c.tags ?? [])].filter(Boolean).join(' ') })), { prune: true }).catch(() => {}),
        store.warm(VECTOR_KIND.neighbours, corpora.neighbours.map((c) => ({ id: c.sessionId, text: [c.purpose, ...(c.files ?? [])].filter(Boolean).join(' ') })), { prune: true }).catch(() => {}),
        store.warm(VECTOR_KIND.notes, corpora.notes.map((c) => ({ id: c.id, text: [c.content, c.sessionPurpose].filter(Boolean).join(' ') })), { prune: true }).catch(() => {}),
      ]);
    }

    const result = store
      ? await buildArrivalBriefingSemantic(ctx, corpora, store)
      : buildArrivalBriefing(ctx, corpora);
    return { success: true, briefing: result, rendered: renderArrivalBriefing(result) };
  });
};

/**
 * This actor's own active session, for filling in an unspecified context.
 *
 * Returns the most recently created active session belonging to `actor`. An
 * agent can legitimately hold several; the newest is the one it just started,
 * which is the arrival this briefing is for.
 *
 * Fails soft to `null` — a daemon with no sessions store, or a store that
 * throws, should cost the caller a thinner briefing, never an error on the
 * first turn of a session.
 */
function ownSession(
  deps: ArrivalDeps,
  actor: string,
): { purpose?: string; project?: string; files?: string[] } | null {
  try {
    const listed = deps.sessions?.list({ status: 'active', allWorktrees: true, limit: 100 });
    const mine = rows(listed, 'sessions').filter(
      (r) => String(r.agentId ?? r.agent_id ?? '') === actor,
    );
    if (!mine.length) return null;
    const newest = mine.reduce((a, b) =>
      Number(b.createdAt ?? b.created_at ?? 0) > Number(a.createdAt ?? a.created_at ?? 0) ? b : a,
    );
    return {
      ...(str(newest.purpose) ? { purpose: str(newest.purpose)! } : {}),
      ...(str(newest.identityProject ?? newest.project)
        ? { project: str(newest.identityProject ?? newest.project)! }
        : {}),
      ...(strList(newest.files) ? { files: strList(newest.files)! } : {}),
    };
  } catch {
    return null;
  }
}

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

function toNotes(listed: unknown): NoteCandidate[] {
  return rows(listed, 'notes')
    .map((r) => ({
      id: String(r.id ?? ''),
      content: typeof r.content === 'string' ? r.content : String(r.content ?? ''),
      ...(str(r.sessionId ?? r.session_id) ? { sessionId: str(r.sessionId ?? r.session_id)! } : {}),
      ...(str(r.agentId ?? r.agent_id) ? { agentId: str(r.agentId ?? r.agent_id)! } : {}),
      ...(str(r.sessionPurpose) ? { sessionPurpose: str(r.sessionPurpose)! } : {}),
      ...(str(r.identityProject ?? r.project) ? { project: str(r.identityProject ?? r.project)! } : {}),
    }))
    .filter((c) => c.id && c.content);
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
