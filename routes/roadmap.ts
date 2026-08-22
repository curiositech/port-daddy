/**
 * Roadmap Routes — `/roadmap/*`
 *
 * HTTP wrapper over `lib/roadmap-items.ts` and `lib/roadmap-promote.ts`.
 * Roadmap entries become first-class data instead of regex-parsed
 * markdown bullets. Cartographer (or any subscriber) calls these
 * endpoints to promote feedback to the roadmap, list current items,
 * or update status — all atomically and queryable.
 *
 *   POST   /roadmap/items                — upsert a roadmap item (owner validated
 *                                          against the durable-agent roster)
 *   GET    /roadmap/items                — list (filter by status/harbor/tag),
 *                                          owner display info joined per item
 *   GET    /roadmap/items/:slug          — the full Jira card: all fields + owner
 *                                          join + links + blocks/blocked-by +
 *                                          parent/children + planned-vs-actual
 *   GET    /roadmap/items/:slug/links    — list the item's typed links
 *   POST   /roadmap/items/:slug/links    — add a pr/doc/file/media link
 *   DELETE /roadmap/items/:slug/links    — remove one typed link
 *   POST   /roadmap/items/:slug/status   — update status (audit-trailed; the
 *                                          'done' transition stamps completed_at)
 *   POST   /roadmap/items/:slug/touch    — refresh last_touched_at
 *   POST   /roadmap/promote              — atomic feedback→item link
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
import { importMarkdownRoadmap } from '../lib/roadmap-import.js';
import { derivePlan, type MigrationItem } from '../lib/planner-migrate.js';
import { schedule } from '../lib/planner-schedule.js';
import { renderBoard, type AdrMeta } from '../lib/planner-board.js';
import {
  writePlanEdges,
  itemLinkEdge,
  listItemLinks,
  removeItemLink,
  HIERARCHY_SCOPE,
  ITEM_TYPE,
  type ItemLinkKind,
} from '../lib/planner-edges.js';
import type { GraphEdges } from '../lib/graph-edges.js';
import type { DurableAgentRoster, DurableAgentRecord } from '../lib/durable-agent-roster.js';
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
  tags?: unknown;
  actual?: unknown;
}

interface LinkBody {
  type?: unknown;
  target?: unknown;
  url?: unknown;
  title?: unknown;
  mime?: unknown;
  caption?: unknown;
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
const LINK_KINDS = new Set<ItemLinkKind>(['pr', 'doc', 'file', 'media']);

/** Owner display info joined from the durable-agent roster onto item reads. */
interface OwnerInfo {
  agentNodeId: string;
  slug: string;
  displayName: string;
  status: DurableAgentRecord['status'];
}

/** Thrown by assignee resolution; the route maps it to a 400 with the message intact. */
class AssigneeValidationError extends Error {}

/**
 * Resolve a caller-supplied assignee to a canonical durable-roster identity.
 *
 * Why validate at the write boundary: `assignee_id` is a bare TEXT column, and
 * before this slice any string ("bob", a typo'd id) was silently accepted —
 * an owner field that cannot be dereferenced is decoration, not ownership.
 * The design intent (2026-08-22 roadmap command-center mandate) is that the
 * durable-agent roster is the ONE owner registry, on ADR-0119's terms:
 * `AgentNode.agentNodeId` is the canonical durable principal and is what gets
 * STORED; a roster slug is only a scoped display alias, so it is accepted as
 * input sugar when it names exactly one live agent and is always resolved to
 * the agentNodeId (an ambiguous slug is escalated to the id rather than
 * guessed — an alias is never an authority key). Anything else is rejected
 * with the exact registration path, so the failure teaches the fix.
 *
 * @param roster - The durable-agent roster module.
 * @param value - Caller-supplied assignee: agentNodeId or roster slug.
 * @returns The canonical agentNodeId to store.
 * @throws AssigneeValidationError when the value names no (or >1) roster agent.
 */
function resolveAssignee(roster: DurableAgentRoster, value: string): string {
  const registerHint =
    'Register one first: pd roster create <slug> --remit <text> --instructions <text> ' +
    '(or POST /durable-agents), then assign by its agentNodeId or slug. ' +
    'Browse the roster: pd roster list.';
  try {
    return roster.get(value).agentNodeId;
  } catch {
    // Not a known agentNodeId — fall through to slug resolution.
  }
  const matches = roster
    .list({ includeRetired: false, limit: 500 })
    .filter((agent) => agent.profile.slug === value);
  if (matches.length === 1) return matches[0].agentNodeId;
  if (matches.length > 1) {
    throw new AssigneeValidationError(
      `assigneeId '${value}' is ambiguous across roster scopes — assign by agentNodeId ` +
        `(${matches.map((m) => m.agentNodeId).join(', ')})`,
    );
  }
  throw new AssigneeValidationError(
    `assigneeId '${value}' is not on the durable-agent roster. ${registerHint}`,
  );
}

/**
 * Build a one-request owner lookup: agentNodeId → display info.
 *
 * Why one snapshot per request instead of roster.get per item: the roster is
 * event-ledger backed (every get replays the agent-node stream), so a
 * 1000-item list doing per-row lookups would be quadratic in ledger size.
 * One list() call gives a consistent snapshot; a stored assignee that no
 * longer resolves (retired-and-gone, pre-validation legacy text) joins as
 * null rather than failing the read — reads must never 500 on stale owners.
 *
 * @param roster - The durable-agent roster module, when wired.
 * @returns A lookup from agentNodeId to OwnerInfo (empty when no roster).
 */
function buildOwnerIndex(roster: DurableAgentRoster | undefined): Map<string, OwnerInfo> {
  const index = new Map<string, OwnerInfo>();
  if (!roster) return index;
  try {
    for (const agent of roster.list({ includeRetired: true, limit: 500 })) {
      index.set(agent.agentNodeId, {
        agentNodeId: agent.agentNodeId,
        slug: agent.profile.slug,
        displayName: agent.profile.displayName,
        status: agent.status,
      });
    }
  } catch {
    // Roster read failure degrades to unjoined owners, never a failed item read.
  }
  return index;
}

export const roadmapPlugin: FastifyPluginAsync<{ deps: RoadmapDeps }> = async (fastify, opts) => {
  const { roadmapItems, roadmapPromote } = opts.deps;
  // routes/index.ts registers this plugin with the FULL server deps, so repoRoot/graphEdges are
  // present even though RoadmapDeps only names the two it strictly requires. graphEdges is
  // undefined in unit fixtures that only stand up the roadmap dep pair (see
  // tests/unit/roadmap-board-route.test.js) — the persistence step below tolerates that.
  const repoRoot = (opts.deps as { repoRoot?: string }).repoRoot;
  const graphEdges = (opts.deps as { graphEdges?: GraphEdges }).graphEdges;
  // Durable-agent roster: the owner registry item assignees validate against
  // and reads join for display info. Optional for the same fixture reason as
  // graphEdges — when absent, writes skip validation and reads join null.
  const durableAgentRoster = (opts.deps as { durableAgentRoster?: DurableAgentRoster }).durableAgentRoster;

  // GET /roadmap/board — the live, browsable planner board (ADR-0086 §5). Derives the
  // Project→Epic→Task hierarchy from roadmap_items on each request (so it reflects live state
  // without needing the migration applied), computes the critical-path schedule, enriches epics
  // with their ADR title + inline ADR text (from repoRoot/docs/adr), and serves self-contained
  // HTML. Same-origin, so the board's poll + tube layer goes live (no CORS, unlike file://).
  //
  // ADR-0086 §3 designed graph_edges to hold this hierarchy/dependency structure. This is the
  // one place a PlannerPlan is derived from live roadmap_items, so the derived HIERARCHY is
  // persisted here: idempotent (replaceScope), every render converges planner:hierarchy to the
  // current plan without duplicating rows. Dependency edges are NOT written here any more —
  // since the dependencies_json retirement they are AUTHORED truth written by
  // lib/roadmap-items.ts upserts, and a derived replace would destroy authored edges the plan
  // cannot see. Purely a side effect — the returned HTML is unchanged either way.
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
    // Durable owner (2026-08-22 mandate): a set assignee must dereference into
    // the durable-agent roster; explicit null (or '') clears; omission
    // preserves the stored owner. Unknown owners are a 400 that names the
    // registration path — silent acceptance of free text is what made
    // assignee_id decoration instead of ownership.
    if ('assigneeId' in body) {
      const raw = body.assigneeId;
      if (raw === null || (typeof raw === 'string' && !raw.trim())) {
        input.assigneeId = null;
      } else {
        const assigneeId = asString(raw);
        if (!assigneeId) {
          reply.code(400);
          return { success: false, error: 'assigneeId must be a roster agentNodeId/slug string, or null to clear' };
        }
        if (durableAgentRoster) {
          try {
            input.assigneeId = resolveAssignee(durableAgentRoster, assigneeId);
          } catch (error) {
            reply.code(400);
            return {
              success: false,
              error: error instanceof Error ? error.message : `assigneeId '${assigneeId}' failed roster validation`,
            };
          }
        } else {
          input.assigneeId = assigneeId;
        }
      }
    }
    const descriptionMd = asString(body.descriptionMd);
    if (descriptionMd) input.descriptionMd = descriptionMd;
    const startedAt = asPosInt(body.startedAt);
    if (startedAt !== undefined) input.startedAt = startedAt;
    const dueAt = asPosInt(body.dueAt);
    if (dueAt !== undefined) input.dueAt = dueAt;
    const estimate = asPosInt(body.estimate);
    if (estimate !== undefined) input.estimate = estimate;
    // Jira-grade fields: tags replace-when-sent ([] clears); actual mirrors
    // estimate's units and accepts explicit null to clear.
    const tags = asStringArray(body.tags);
    if (tags !== undefined) input.tags = tags;
    if ('actual' in body) {
      input.actual = body.actual === null ? null : asPosInt(body.actual) ?? null;
    }

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
    const tag = asString(q.tag);
    const statusRaw = asString(q.status);
    const status =
      statusRaw === 'all'
        ? 'all'
        : statusRaw && STATUS_VALUES.has(statusRaw as RoadmapStatus)
          ? (statusRaw as RoadmapStatus)
          : undefined;
    const rows = roadmapItems.list({ harbor, limit, status, tag });
    // Owner join: one roster snapshot per request, so every item's assignee
    // resolves to display info without per-row ledger replays.
    const owners = buildOwnerIndex(durableAgentRoster);
    const items = rows.map((item) => ({
      ...item,
      owner: item.assigneeId ? owners.get(item.assigneeId) ?? null : null,
    }));
    return { success: true, items, count: items.length };
  });

  // GET /roadmap/items/:slug — the full Jira card (2026-08-22 mandate §6):
  // every stored field, the owner joined from the durable-agent roster, typed
  // links, both blocking directions (blockedBy = my dependencies; blocks =
  // items depending on me, derived from the same data that projects into
  // depends_on edges), hierarchy (parent/children from the persisted
  // parent_of edges), and planned-vs-actual. Consumers that only want the raw
  // item keep reading `.item`; the card facets ride alongside it.
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
    const owners = buildOwnerIndex(durableAgentRoster);
    const owner = item.assigneeId ? owners.get(item.assigneeId) ?? null : null;
    const links = graphEdges ? listItemLinks(graphEdges, slug) : [];
    const blockedBy = [...item.dependencies].sort();
    const blocks = roadmapItems.listDependents(slug, item.harbor).map((i) => i.slug);
    let parent: string | null = null;
    let children: string[] = [];
    if (graphEdges) {
      parent =
        graphEdges.list({
          scope: HIERARCHY_SCOPE,
          edgeType: 'parent_of',
          targetType: ITEM_TYPE,
          targetId: slug,
          limit: 10,
        })[0]?.sourceId ?? null;
      children = graphEdges
        .list({
          scope: HIERARCHY_SCOPE,
          edgeType: 'parent_of',
          sourceType: ITEM_TYPE,
          sourceId: slug,
          limit: 1000,
        })
        .map((e) => e.targetId)
        .sort();
    }
    const plannedVsActual = {
      estimate: item.estimate,
      actual: item.actual,
      variance: item.estimate != null && item.actual != null ? item.actual - item.estimate : null,
      startedAt: item.startedAt,
      dueAt: item.dueAt,
      completedAt: item.completedAt,
    };
    return {
      success: true,
      item: { ...item, owner },
      owner,
      links,
      blocks,
      blockedBy,
      parent,
      children,
      plannedVsActual,
    };
  });

  // ── Typed item links (pr/doc/file/media) — graph_edges planner:links scope ──

  /**
   * The shared 503 for link verbs when graph_edges is not wired.
   *
   * Why 503 and not a silent no-op: links are durable evidence, so a daemon
   * that cannot persist them must refuse loudly — the design intent is that a
   * degraded fixture/deployment never fakes success on an evidence write.
   *
   * @param reply - The Fastify reply to mark 503.
   * @returns The failure body naming the missing dependency.
   */
  const linksUnavailable = (reply: FastifyReply) => {
    reply.code(503);
    return { success: false, error: 'graph_edges is not wired on this daemon; item links are unavailable' };
  };

  /**
   * Parse and validate the (type, target) pair every link verb needs.
   *
   * Why one shared parser: add, list-by-key, and remove all identify a link by
   * the same (kind, target) identity the graph_edges unique index enforces, so
   * the design keeps the validation in one place — a PR target must be a bare
   * number (the metadata carries its URL), and unknown kinds are rejected
   * before they can mint an untyped edge nothing renders.
   *
   * @param type - Candidate link kind from body or query.
   * @param target - Candidate target id (PR number / path / URL).
   * @returns The validated kind+target, or an `{ error }` for the 400 path.
   */
  const parseLinkKey = (
    type: string | undefined,
    target: string | undefined,
  ): { kind: ItemLinkKind; target: string } | { error: string } => {
    if (!type || !LINK_KINDS.has(type as ItemLinkKind)) {
      return { error: 'type must be one of pr|doc|file|media' };
    }
    if (!target) {
      return { error: 'target is required (PR number for pr; path for doc/file; path or URL for media)' };
    }
    if (type === 'pr' && !/^\d+$/.test(target)) {
      return { error: `pr link target must be a PR number, got '${target}'` };
    }
    return { kind: type as ItemLinkKind, target };
  };

  fastify.get('/roadmap/items/:slug/links', async (request: FastifyRequest, reply: FastifyReply) => {
    const slug = asString((request.params as { slug?: string }).slug);
    if (!slug) {
      reply.code(400);
      return { success: false, error: 'slug required in path' };
    }
    if (!graphEdges) return linksUnavailable(reply);
    if (!roadmapItems.slugExists(slug)) {
      reply.code(404);
      return { success: false, error: `roadmap item '${slug}' not found` };
    }
    const links = listItemLinks(graphEdges, slug);
    return { success: true, links, count: links.length };
  });

  fastify.post('/roadmap/items/:slug/links', async (request: FastifyRequest, reply: FastifyReply) => {
    const slug = asString((request.params as { slug?: string }).slug);
    if (!slug) {
      reply.code(400);
      return { success: false, error: 'slug required in path' };
    }
    if (!graphEdges) return linksUnavailable(reply);
    if (!roadmapItems.slugExists(slug)) {
      reply.code(404);
      return { success: false, error: `roadmap item '${slug}' not found` };
    }
    const body = (request.body ?? {}) as LinkBody;
    const key = parseLinkKey(asString(body.type), asString(body.target));
    if ('error' in key) {
      reply.code(400);
      return { success: false, error: key.error };
    }
    const metadata: Record<string, unknown> = {};
    const url = asString(body.url);
    if (url) metadata.url = url;
    const title = asString(body.title);
    if (title) metadata.title = title;
    const mime = asString(body.mime);
    if (mime) metadata.mime = mime;
    const caption = asString(body.caption);
    if (caption) metadata.caption = caption;
    const edge = graphEdges.remember(itemLinkEdge(slug, key.kind, key.target, metadata));
    reply.code(201);
    return {
      success: true,
      link: {
        kind: key.kind,
        targetId: edge.targetId,
        metadata: edge.metadata,
        createdAt: edge.createdAt,
        updatedAt: edge.updatedAt,
      },
    };
  });

  fastify.delete('/roadmap/items/:slug/links', async (request: FastifyRequest, reply: FastifyReply) => {
    const slug = asString((request.params as { slug?: string }).slug);
    if (!slug) {
      reply.code(400);
      return { success: false, error: 'slug required in path' };
    }
    if (!graphEdges) return linksUnavailable(reply);
    // Accept the (type, target) key from query OR body — DELETE bodies are
    // legal but some clients cannot send them.
    const q = (request.query ?? {}) as Record<string, unknown>;
    const body = (request.body ?? {}) as LinkBody;
    const key = parseLinkKey(
      asString(body.type) ?? asString(q.type),
      asString(body.target) ?? asString(q.target),
    );
    if ('error' in key) {
      reply.code(400);
      return { success: false, error: key.error };
    }
    const removed = removeItemLink(graphEdges, slug, key.kind, key.target);
    if (!removed) {
      reply.code(404);
      return { success: false, error: `no ${key.kind} link to '${key.target}' on '${slug}'` };
    }
    return { success: true, removed: true };
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
