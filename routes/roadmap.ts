/**
 * Roadmap Routes — `/roadmap/*`
 *
 * HTTP wrapper over `lib/roadmap-items.ts` and `lib/roadmap-promote.ts`.
 * Roadmap entries become first-class data instead of regex-parsed
 * markdown bullets. Cartographer (or any subscriber) calls these
 * endpoints to promote feedback to the roadmap, list current items,
 * or update status — all atomically and queryable.
 *
 *   POST   /roadmap/items                — upsert a roadmap item
 *   GET    /roadmap/items                — list (filter by status/harbor)
 *   GET    /roadmap/items/:slug          — fetch a specific item
 *   POST   /roadmap/items/:slug/status   — update status (audit-trailed)
 *   POST   /roadmap/items/:slug/touch    — refresh last_touched_at
 *   POST   /roadmap/promote              — atomic feedback→item link
 *   POST   /roadmap/chomp                — general planning-doc ingestion
 *   POST   /roadmap/import-markdown      — legacy 3-pile alias over chomp
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type {
  RoadmapItems,
  RoadmapKind,
  RoadmapStatus,
  UpsertRoadmapItemInput,
} from '../lib/roadmap-items.js';
import type { RoadmapPromote, PromoteFromFeedbackInput } from '../lib/roadmap-promote.js';
import { renderNextCutsMarkdown, applyRoadmapMarkdown } from '../lib/roadmap-render.js';
import { importMarkdownRoadmap, chompRoadmap, type ChompEnrichOptions } from '../lib/roadmap-chomp.js';
import { resolveLLMBackend } from '../lib/llm-backend-resolver.js';
import { derivePlan, type MigrationItem } from '../lib/planner-migrate.js';
import { schedule } from '../lib/planner-schedule.js';
import { renderBoard, type AdrMeta } from '../lib/planner-board.js';
import { writePlanEdges } from '../lib/planner-edges.js';
import type { GraphEdges } from '../lib/graph-edges.js';
import { parseAdrIdentity } from '../lib/adr-matrix.js';
import { renderMarkdown } from '../lib/mini-markdown.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

interface RoadmapDeps {
  roadmapItems: RoadmapItems;
  roadmapPromote: RoadmapPromote;
}

interface UpsertBody {
  slug?: unknown;
  summaryMd?: unknown;
  status?: unknown;
  promotedFromFeedbackId?: unknown;
  promotedByAgentId?: unknown;
  promotedAt?: unknown;
  dependencies?: unknown;
  notes?: unknown;
  harbor?: unknown;
  project?: unknown;
  ttlMs?: unknown;
  kind?: unknown;
  priority?: unknown;
  assigneeId?: unknown;
  descriptionMd?: unknown;
  startedAt?: unknown;
  dueAt?: unknown;
  estimate?: unknown;
}

interface PromoteBody {
  feedbackId?: unknown;
  slug?: unknown;
  summaryMd?: unknown;
  status?: unknown;
  dependencies?: unknown;
  notes?: unknown;
  promotedBy?: unknown;
  harbor?: unknown;
}

interface StatusBody {
  status?: unknown;
  by?: unknown;
  harbor?: unknown;
}

interface RoadmapNoteBody {
  at?: unknown;
  by?: unknown;
  text?: unknown;
}

function asString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  return trimmed ? trimmed : undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function asPosInt(v: unknown): number | undefined {
  const n = asNumber(v);
  return typeof n === 'number' && n > 0 ? Math.floor(n) : undefined;
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item === 'string' && item.trim()) out.push(item.trim());
  }
  return out;
}

function asRoadmapNotes(v: unknown): Array<{ at: number; by: string; text: string }> | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: Array<{ at: number; by: string; text: string }> = [];
  for (const item of v) {
    if (!item || typeof item !== 'object') continue;
    const note = item as RoadmapNoteBody;
    const by = asString(note.by);
    const text = asString(note.text);
    const at = asNumber(note.at);
    if (!by || !text || at === undefined) continue;
    out.push({ at, by, text });
  }
  return out;
}

function harborForProject(project: string | undefined): string | undefined {
  return project ? `${project}:fleet` : undefined;
}

const STATUS_VALUES = new Set<RoadmapStatus>(['now', 'backlog', 'parked', 'merge', 'done']);
const KIND_VALUES = new Set<RoadmapKind>([
  'project',
  'epic',
  'story',
  'task',
  'subtask',
  'bug',
  'chore',
]);

export const roadmapPlugin: FastifyPluginAsync<{ deps: RoadmapDeps }> = async (fastify, opts) => {
  const { roadmapItems, roadmapPromote } = opts.deps;
  // routes/index.ts registers this plugin with the FULL server deps, so repoRoot/graphEdges are
  // present even though RoadmapDeps only names the two it strictly requires. graphEdges is
  // undefined in unit fixtures that only stand up the roadmap dep pair (see
  // tests/unit/roadmap-board-route.test.js) — the persistence step below tolerates that.
  const repoRoot = (opts.deps as { repoRoot?: string }).repoRoot;
  const graphEdges = (opts.deps as { graphEdges?: GraphEdges }).graphEdges;

  // GET /roadmap/board — the live, browsable planner board (ADR-0086 §5). Derives the
  // Project→Epic→Task hierarchy from roadmap_items on each request (so it reflects live state
  // without needing the migration applied), computes the critical-path schedule, enriches epics
  // with their ADR title + inline ADR text (from repoRoot/docs/adr), and serves self-contained
  // HTML. Same-origin, so the board's poll + tube layer goes live (no CORS, unlike file://).
  //
  // ADR-0086 §3 designed graph_edges to hold this hierarchy/dependency structure, but
  // `writePlanEdges` (lib/planner-edges.ts) had zero callers — the table stayed empty forever.
  // This is the one place a PlannerPlan is already derived from live roadmap_items, so persist it
  // here: idempotent (replaceScope), so every render converges graph_edges to the current plan
  // without duplicating rows. Purely a side effect — the returned HTML is unchanged either way.
  fastify.get('/roadmap/board', async (_request: FastifyRequest, reply: FastifyReply) => {
    const rows = roadmapItems.list({ status: 'all', limit: 2000 });
    const items: MigrationItem[] = rows.map((r) => ({
      slug: r.slug,
      summaryMd: r.summaryMd,
      status: r.status,
      dependencies: r.dependencies ?? [],
      notes: (r.notes ?? []).map((n) => ({ text: n.text })),
      harbor: r.harbor,
    }));
    const plan = derivePlan(items);
    if (graphEdges) {
      try {
        writePlanEdges(graphEdges, plan);
      } catch (err) {
        _request.log?.warn?.({ err }, 'roadmap_board_write_plan_edges_failed');
      }
    }
    // Real ADR-0086 estimates drive the Gantt bars; an unsized item defaults to
    // one effort unit so it still earns visible geometry (the board renders a
    // duration chart now, not an unweighted topological-depth chart).
    const estimateBySlug = new Map(rows.map((r) => [r.slug, r.estimate ?? 1]));
    const sched = schedule(
      plan.tasks.map((t) => ({
        id: t.slug as string,
        estimate: estimateBySlug.get(t.slug as string) ?? 1,
      })),
      plan.dependsOnEdges,
    );
    const adrs: Record<string, AdrMeta> = {};
    if (repoRoot) {
      try {
        const dir = join(repoRoot, 'docs', 'adr');
        const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
        for (const epic of plan.epics) {
          if (!epic.id.startsWith('adr-')) continue;
          const num = epic.id.replace('adr-', '');
          // Defense-in-depth: num is derived from item slugs; require digits-only before any
          // filesystem lookup so a crafted slug can never drive a path beyond docs/adr.
          if (!/^\d{2,4}$/.test(num)) {
            adrs[num] = {};
            continue;
          }
          const file = files.find((f) => f.startsWith(`${num}-`));
          if (!file) {
            adrs[num] = {};
            continue;
          }
          const md = readFileSync(join(dir, file), 'utf8');
          adrs[num] = { title: parseAdrIdentity(md)?.title, html: renderMarkdown(md), path: `docs/adr/${file}` };
        }
      } catch {
        /* repo docs unavailable (packaged daemon); the board still renders without ADR text */
      }
    }
    // pdBase '' → the board's JS fetches '/roadmap/items' and posts '/messages' same-origin.
    const html = renderBoard({ plan, schedule: sched, items, adrs, generatedAt: Date.now(), pdBase: '' });
    reply.type('text/html; charset=utf-8');
    return html;
  });

  fastify.post('/roadmap/items', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as UpsertBody;
    const slug = asString(body.slug);
    const summaryMd = asString(body.summaryMd);
    if (!slug || !summaryMd) {
      reply.code(400);
      return { success: false, error: 'slug and summaryMd are required' };
    }
    const input: UpsertRoadmapItemInput = { slug, summaryMd };
    const statusRaw = asString(body.status);
    if (statusRaw && STATUS_VALUES.has(statusRaw as RoadmapStatus)) {
      input.status = statusRaw as RoadmapStatus;
    }
    const promotedFromFeedbackId = asString(body.promotedFromFeedbackId);
    if (promotedFromFeedbackId) input.promotedFromFeedbackId = promotedFromFeedbackId;
    const promotedByAgentId = asString(body.promotedByAgentId);
    if (promotedByAgentId) input.promotedByAgentId = promotedByAgentId;
    const promotedAt = asNumber(body.promotedAt);
    if (promotedAt !== undefined) input.promotedAt = promotedAt;
    const dependencies = asStringArray(body.dependencies);
    if (dependencies) input.dependencies = dependencies;
    const notes = asRoadmapNotes(body.notes);
    if (notes) input.notes = notes;
    const harbor = asString(body.harbor);
    if (harbor) input.harbor = harbor;
    const project = asString(body.project);
    if (project) input.project = project;
    const ttlMs = asPosInt(body.ttlMs);
    if (ttlMs !== undefined) input.ttlMs = ttlMs;
    // Planner columns (ADR-0086): omitted fields preserve the stored value in
    // upsert; only explicitly-sent fields write through.
    const kindRaw = asString(body.kind);
    if (kindRaw && KIND_VALUES.has(kindRaw as RoadmapKind)) input.kind = kindRaw as RoadmapKind;
    const priority = asNumber(body.priority);
    if (priority !== undefined) input.priority = priority;
    const assigneeId = asString(body.assigneeId);
    if (assigneeId) input.assigneeId = assigneeId;
    const descriptionMd = asString(body.descriptionMd);
    if (descriptionMd) input.descriptionMd = descriptionMd;
    const startedAt = asPosInt(body.startedAt);
    if (startedAt !== undefined) input.startedAt = startedAt;
    const dueAt = asPosInt(body.dueAt);
    if (dueAt !== undefined) input.dueAt = dueAt;
    const estimate = asPosInt(body.estimate);
    if (estimate !== undefined) input.estimate = estimate;

    try {
      const item = roadmapItems.upsert(input);
      reply.code(201);
      return { success: true, item };
    } catch (error) {
      reply.code(400);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'upsert failed',
      };
    }
  });

  fastify.get('/roadmap/items', async (request: FastifyRequest) => {
    const q = (request.query ?? {}) as Record<string, unknown>;
    const project = asString(q.project);
    const harbor = asString(q.harbor) ?? harborForProject(project);
    const limit = asPosInt(q.limit);
    const statusRaw = asString(q.status);
    const status =
      statusRaw === 'all'
        ? 'all'
        : statusRaw && STATUS_VALUES.has(statusRaw as RoadmapStatus)
          ? (statusRaw as RoadmapStatus)
          : undefined;
    const items = roadmapItems.list({ harbor, limit, status });
    return { success: true, items, count: items.length };
  });

  fastify.get('/roadmap/items/:slug', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { slug?: string };
    const slug = asString(params.slug);
    if (!slug) {
      reply.code(400);
      return { success: false, error: 'slug required in path' };
    }
    const q = (request.query ?? {}) as Record<string, unknown>;
    const harbor = asString(q.harbor);
    const item = roadmapItems.get(slug, harbor);
    if (!item) {
      reply.code(404);
      return { success: false, error: `roadmap item '${slug}' not found` };
    }
    return { success: true, item };
  });

  fastify.delete('/roadmap/items/:slug', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { slug?: string };
    const slug = asString(params.slug);
    if (!slug) {
      reply.code(400);
      return { success: false, error: 'slug required in path' };
    }
    const q = (request.query ?? {}) as Record<string, unknown>;
    const harbor = asString(q.harbor);
    const result = roadmapItems.remove(slug, harbor);
    if (!result.removed) {
      reply.code(404);
      return {
        success: false,
        error: `roadmap item '${slug}'${harbor ? ` in harbor '${harbor}'` : ''} not found`,
      };
    }
    return { success: true, removed: true, item: result.item };
  });

  fastify.post('/roadmap/items/:slug/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { slug?: string };
    const slug = asString(params.slug);
    if (!slug) {
      reply.code(400);
      return { success: false, error: 'slug required in path' };
    }
    const body = (request.body ?? {}) as StatusBody;
    const statusRaw = asString(body.status);
    const by = asString(body.by);
    if (!statusRaw || !STATUS_VALUES.has(statusRaw as RoadmapStatus)) {
      reply.code(400);
      return { success: false, error: 'status must be one of now|backlog|parked|merge|done' };
    }
    if (!by) {
      reply.code(400);
      return { success: false, error: 'by (agent id) is required' };
    }
    try {
      const item = roadmapItems.updateStatus({
        slug,
        status: statusRaw as RoadmapStatus,
        by,
        harbor: asString(body.harbor),
      });
      return { success: true, item };
    } catch (error) {
      reply.code(404);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'updateStatus failed',
      };
    }
  });

  fastify.post('/roadmap/items/:slug/touch', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { slug?: string };
    const slug = asString(params.slug);
    if (!slug) {
      reply.code(400);
      return { success: false, error: 'slug required in path' };
    }
    const q = (request.query ?? {}) as Record<string, unknown>;
    const harbor = asString(q.harbor);
    const item = roadmapItems.touch(slug, harbor);
    if (!item) {
      reply.code(404);
      return { success: false, error: `roadmap item '${slug}' not found` };
    }
    return { success: true, item };
  });

  fastify.post('/roadmap/render', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const harbor = asString(body.harbor);
    const project = asString(body.project);
    const effectiveHarbor = harbor ?? harborForProject(project);
    const statusRaw = asString(body.status);
    const status =
      statusRaw === 'all'
        ? 'all'
        : statusRaw && STATUS_VALUES.has(statusRaw as RoadmapStatus)
          ? (statusRaw as RoadmapStatus)
          : 'now';
    const limit = asPosInt(body.limit);
    const items = roadmapItems.list({ harbor: effectiveHarbor, status, limit });
    const markdown = renderNextCutsMarkdown(items, { status, limit });

    const rootDir = asString(body.rootDir);
    const write = body.write === true;
    if (write && !rootDir) {
      reply.code(400);
      return { success: false, error: 'write=true requires rootDir' };
    }
    if (write && rootDir) {
      try {
        const result = applyRoadmapMarkdown(rootDir, items, { status, limit });
        return {
          success: true,
          markdown,
          count: items.length,
          write: { path: result.path, changed: result.changed, insertedMarkers: result.insertedMarkers },
        };
      } catch (error) {
        reply.code(500);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'render write failed',
        };
      }
    }
    return { success: true, markdown, count: items.length };
  });

  // POST /roadmap/chomp — general planning-doc ingestion (operator mandate
  // 2026-08-22). Reads the named markdown docs from rootDir, extracts a
  // project→epic→story→task tree (headings), checklist tasks, and explicit
  // depends-on references, and upserts them into roadmap_items with the same
  // never-clobber-enriched-rows discipline the legacy importer documented.
  // `enrich: true` opts into one-line summary polish through the daemon's
  // real request-shape LLM path (lib/llm-backend-resolver.ts, actor 'chomp');
  // with no backend configured the result is deterministic extraction plus an
  // honest `enrichment.backend: null` report — nothing is faked.
  fastify.post('/roadmap/chomp', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const rootDir = asString(body.rootDir) ?? asString(body.root);
    if (!rootDir) {
      reply.code(400);
      return { success: false, error: 'rootDir is required (repo root to read planning docs from)' };
    }
    const paths = asStringArray(body.paths);
    if (!paths || paths.length === 0) {
      reply.code(400);
      return { success: false, error: 'paths is required (planning docs to chomp, relative to rootDir)' };
    }
    const statusRaw = asString(body.defaultStatus);
    const defaultStatus =
      statusRaw && STATUS_VALUES.has(statusRaw as RoadmapStatus)
        ? (statusRaw as RoadmapStatus)
        : undefined;
    const dryRun = body.dryRun === true || body.dryRun === 'true';
    const enrichRequested = body.enrich === true || body.enrich === 'true';

    let enrich: ChompEnrichOptions | undefined;
    let enrichmentUnavailable: { requested: true; attempted: 0; applied: 0; backend: null } | null = null;
    if (enrichRequested) {
      const resolved = resolveLLMBackend({ actor: 'chomp' });
      if (resolved) {
        enrich = {
          transport: resolved.transport,
          model: resolved.model,
          label: `${resolved.backend}:${resolved.model}`,
        };
      } else {
        // Honest degradation: no configured backend means deterministic-only.
        enrichmentUnavailable = { requested: true, attempted: 0, applied: 0, backend: null };
      }
    }

    try {
      const result = await chompRoadmap(
        { roadmapItems, graphEdges },
        {
          rootDir,
          paths,
          defaultStatus,
          harbor: asString(body.harbor),
          project: asString(body.project),
          by: asString(body.by),
          dryRun,
          sourceCommit: asString(body.sourceCommit),
          enrich,
        },
      );
      if (enrichmentUnavailable) {
        result.enrichment = enrichmentUnavailable;
        result.warnings.push(
          'enrich requested but no LLM backend is configured (set PD_CHOMP_BACKEND or PD_FLEET_DEFAULT_BACKEND); deterministic extraction only',
        );
      }
      return { success: true, ...result };
    } catch (error) {
      reply.code(500);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'chomp failed',
      };
    }
  });

  fastify.post('/roadmap/import-markdown', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const rootDir = asString(body.rootDir) ?? asString(body.root);
    if (!rootDir) {
      reply.code(400);
      return { success: false, error: 'rootDir is required (repo root to read markdown piles from)' };
    }
    const harbor = asString(body.harbor);
    const project = asString(body.project);
    const by = asString(body.by) ?? asString(body.promotedBy);
    const dryRun = body.dryRun === true || body.dryRun === 'true';
    try {
      const result = importMarkdownRoadmap(roadmapItems, {
        rootDir,
        harbor,
        project,
        by,
        dryRun,
      });
      return { success: true, ...result };
    } catch (error) {
      reply.code(500);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'import-markdown failed',
      };
    }
  });

  fastify.post('/roadmap/promote', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as PromoteBody;
    const feedbackId = asString(body.feedbackId);
    const promotedBy = asString(body.promotedBy);
    if (!feedbackId || !promotedBy) {
      reply.code(400);
      return { success: false, error: 'feedbackId and promotedBy are required' };
    }
    const input: PromoteFromFeedbackInput = { feedbackId, promotedBy };
    const slug = asString(body.slug);
    if (slug) input.slug = slug;
    const summaryMd = asString(body.summaryMd);
    if (summaryMd) input.summaryMd = summaryMd;
    const statusRaw = asString(body.status);
    if (statusRaw && STATUS_VALUES.has(statusRaw as RoadmapStatus)) {
      input.status = statusRaw as RoadmapStatus;
    }
    const dependencies = asStringArray(body.dependencies);
    if (dependencies) input.dependencies = dependencies;
    const harbor = asString(body.harbor);
    if (harbor) input.harbor = harbor;

    try {
      const result = roadmapPromote.promoteFromFeedback(input);
      reply.code(201);
      return { success: true, ...result };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'promote failed';
      reply.code(/no feedback/.test(message) ? 404 : 400);
      return { success: false, error: message };
    }
  });
};
