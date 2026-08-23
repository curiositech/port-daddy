/**
 * Planner edges — the graph_edges vocabulary for the planner (ADR-0086 §3).
 *
 * ADR-0086 unifies hierarchy, dependencies, and artifact links into the existing `graph_edges`
 * table (migration 003) instead of bespoke columns/JSON. This module is the thin, typed
 * vocabulary over `lib/graph-edges.ts` — fixed scopes + edge types so every reader/writer agrees,
 * and `writePlanEdges` lays down a whole `PlannerPlan`'s structure idempotently via `replaceScope`.
 *
 *   planner:hierarchy  parent_of   roadmap:item → roadmap:item   (project→epic→task ladder)
 *   planner:deps       depends_on  roadmap:item → roadmap:item   (dependent → its dependency)
 *   planner:links      links       roadmap:item → commit|pr|adr|doc|file|media
 *                                  (artifacts; target_type discriminates the kind,
 *                                   metadata carries url/title/mime/caption)
 *
 * The Jira-grade item-link slice (operator-mandated roadmap command-center,
 * 2026-08-22) uses EXACTLY the ADR-0086 §3 vocabulary above: one `links`
 * edge_type, discriminated by target_type — never per-kind edge types.
 * `file` and `media` extend the target_type set the same way §3's table
 * anticipated for artifacts.
 *
 * Authorship split (load-bearing after `dependencies_json` retirement):
 *   - planner:deps and planner:links are AUTHORED scopes — written edge-by-edge
 *     (remember/forget) by `lib/roadmap-items.ts` upserts and the link routes.
 *     Nothing may `replaceScope` them: a wholesale replace derived from a
 *     partial item list would destroy authored facts.
 *   - planner:hierarchy remains a DERIVED projection converged by
 *     `writePlanEdges` from the board's `PlannerPlan`.
 */

import type { GraphEdges, GraphEdgeInput } from './graph-edges.js';
import type { PlannerPlan } from './planner-migrate.js';

export const HIERARCHY_SCOPE = 'planner:hierarchy';
export const DEPS_SCOPE = 'planner:deps';
export const LINKS_SCOPE = 'planner:links';

export const ITEM_TYPE = 'roadmap:item';
export type ArtifactType = 'commit' | 'pr' | 'adr' | 'doc' | 'file' | 'media';

/** A parent_of edge input: `parent` contains `child`. */
export function parentEdge(parent: string, child: string): GraphEdgeInput {
  return {
    scope: HIERARCHY_SCOPE,
    sourceType: ITEM_TYPE,
    sourceId: parent,
    edgeType: 'parent_of',
    targetType: ITEM_TYPE,
    targetId: child,
  };
}

/** A depends_on edge input: `dependent` is blocked by `dependency`. */
export function dependsOnEdge(dependent: string, dependency: string): GraphEdgeInput {
  return {
    scope: DEPS_SCOPE,
    sourceType: ITEM_TYPE,
    sourceId: dependent,
    edgeType: 'depends_on',
    targetType: ITEM_TYPE,
    targetId: dependency,
  };
}

/** A links edge input: roadmap item → an external artifact (commit/PR/ADR/doc/file/media). */
export function linkEdge(
  itemSlug: string,
  artifactType: ArtifactType,
  artifactId: string,
  label?: string,
): GraphEdgeInput {
  return {
    scope: LINKS_SCOPE,
    sourceType: ITEM_TYPE,
    sourceId: itemSlug,
    edgeType: 'links',
    targetType: artifactType,
    targetId: artifactId,
    metadata: label ? { label } : null,
  };
}

export interface WritePlanResult {
  hierarchyEdges: number;
}

/**
 * Lay down a plan's HIERARCHY edges into graph_edges, idempotently. `replaceScope` clears the
 * scope first, so re-running converges (no duplicate edges) and reflects deletions. Note
 * `parentEdges` use the scheduler/plan node ids directly (epic ids like `adr-0048` and the
 * `port-daddy` root are item-typed nodes too — they live in graph_edges, not roadmap_items).
 *
 * Why hierarchy ONLY: since `dependencies_json` retirement (ADR-0086 §3), the planner:deps scope
 * is AUTHORED truth written by `lib/roadmap-items.ts` upserts. This function used to replace it
 * from the derived plan, which was correct while the JSON column was the source — but a derived
 * replace now would delete authored edges the plan cannot see (dangling deps that `derivePlan`
 * drops, items beyond the board's query window). The design rule: derived projections converge
 * derived scopes; authored scopes are only ever edited edge-by-edge.
 *
 * @param graphEdges - The graph_edges module handle.
 * @param plan - The derived planner plan (board render input).
 * @returns The count of hierarchy edges written.
 */
export function writePlanEdges(graphEdges: GraphEdges, plan: PlannerPlan): WritePlanResult {
  const hierarchy: GraphEdgeInput[] = plan.parentEdges.map((e) => parentEdge(e.parent, e.child));
  graphEdges.replaceScope(HIERARCHY_SCOPE, hierarchy);
  return { hierarchyEdges: hierarchy.length };
}

// ─── Jira-grade item links (2026-08-22 roadmap command-center mandate) ───────

/** The link kinds the item-link routes/CLI can AUTHOR onto a card. */
export type ItemLinkKind = 'pr' | 'doc' | 'file' | 'media';

/**
 * Per-kind metadata whitelist: what an authored link may carry beyond its
 * target id. `commit`/`adr` appear because reads surface any `links` edge in
 * the ADR-0086 vocabulary, including ones other writers author with a label.
 */
const ITEM_LINK_METADATA_KEYS: Record<ArtifactType, string[]> = {
  pr: ['url', 'title'],
  doc: ['title'],
  file: ['title'],
  media: ['mime', 'caption'],
  commit: ['label', 'title'],
  adr: ['label', 'title'],
};

/** One typed link on a roadmap item's card, as read back from graph_edges. */
export interface ItemLink {
  /** The artifact kind — the edge's target_type per ADR-0086 §3. */
  kind: ArtifactType;
  /** PR number (as a string) for `pr`; repo path for `doc`/`file`; path or URL for `media`. */
  targetId: string;
  metadata: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * Build the graph_edges input for one authored item link.
 *
 * This is EXACTLY the ADR-0086 §3 `links` edge: edge_type is the single
 * `links` verb, and target_type discriminates the artifact kind — never a
 * per-kind edge_type, so every reader of the vocabulary (board, console,
 * card detail) shares one query shape with `linkEdge` above.
 *
 * Why the metadata whitelist: link metadata renders on operator surfaces
 * (board, console, dashboard), so the design intent is a closed contract per
 * kind — `pr` carries url/title, `media` carries mime/caption — instead of an
 * open bag that silently grows renderer obligations. Unknown keys are dropped,
 * not rejected: an over-eager writer degrades to a plain link, never a 500.
 *
 * @param itemSlug - The roadmap item's slug (the graph node id).
 * @param kind - Which typed link: pr | doc | file | media.
 * @param targetId - PR number (string), repo path, or media path/URL.
 * @param metadata - Optional per-kind extras (whitelisted per kind).
 * @returns A GraphEdgeInput ready for `graphEdges.remember` / `forget`.
 */
export function itemLinkEdge(
  itemSlug: string,
  kind: ItemLinkKind,
  targetId: string,
  metadata?: Record<string, unknown> | null,
): GraphEdgeInput {
  const allowed = ITEM_LINK_METADATA_KEYS[kind];
  let clean: Record<string, unknown> | null = null;
  if (metadata && typeof metadata === 'object') {
    const entries = Object.entries(metadata).filter(
      ([key, value]) => allowed.includes(key) && typeof value === 'string' && value.trim(),
    );
    if (entries.length > 0) clean = Object.fromEntries(entries);
  }
  return {
    scope: LINKS_SCOPE,
    sourceType: ITEM_TYPE,
    sourceId: itemSlug,
    edgeType: 'links',
    targetType: kind,
    targetId,
    metadata: clean,
  };
}

const ARTIFACT_TYPES = new Set<ArtifactType>(['commit', 'pr', 'adr', 'doc', 'file', 'media']);

/**
 * Read every `links` edge on one roadmap item, newest-updated first.
 *
 * One query, one vocabulary: the ADR-0086 §3 contract is a single `links`
 * edge_type with target_type as the discriminator, so the card read lists
 * that edge_type once and maps target_type to the link kind — links authored
 * by the routes (pr/doc/file/media) and by any other §3 writer (commit/adr)
 * surface uniformly. The design intent is that a card never hides evidence
 * because a different writer authored it.
 *
 * @param graphEdges - The graph_edges module handle.
 * @param itemSlug - The roadmap item's slug.
 * @returns Typed links across all artifact kinds, updatedAt-descending.
 */
export function listItemLinks(graphEdges: GraphEdges, itemSlug: string): ItemLink[] {
  const edges = graphEdges.list({
    scope: LINKS_SCOPE,
    sourceType: ITEM_TYPE,
    sourceId: itemSlug,
    edgeType: 'links',
    limit: 500,
  });
  const links: ItemLink[] = [];
  for (const edge of edges) {
    if (!ARTIFACT_TYPES.has(edge.targetType as ArtifactType)) continue;
    links.push({
      kind: edge.targetType as ArtifactType,
      targetId: edge.targetId,
      metadata: edge.metadata,
      createdAt: edge.createdAt,
      updatedAt: edge.updatedAt,
    });
  }
  links.sort((a, b) => b.updatedAt - a.updatedAt || a.targetId.localeCompare(b.targetId));
  return links;
}

/**
 * Remove one typed link from a roadmap item.
 *
 * Design: removal is keyed by (item, kind, targetId) — the same identity the
 * unique index enforces on write (scope + source + `links` edge_type +
 * target_type + target_id) — so unlinking is surgical and idempotent.
 * The motivation for returning a boolean (rather than throwing) is that
 * unlink is a cleanup verb: retrying an unlink that already happened is
 * success-shaped, and the caller decides whether absence deserves a 404.
 *
 * @param graphEdges - The graph_edges module handle.
 * @param itemSlug - The roadmap item's slug.
 * @param kind - Which typed link: pr | doc | file | media.
 * @param targetId - The exact target the link was created with.
 * @returns true when a link existed and was removed.
 */
export function removeItemLink(
  graphEdges: GraphEdges,
  itemSlug: string,
  kind: ItemLinkKind,
  targetId: string,
): boolean {
  return graphEdges.forget({
    scope: LINKS_SCOPE,
    sourceType: ITEM_TYPE,
    sourceId: itemSlug,
    edgeType: 'links',
    targetType: kind,
    targetId,
  });
}

/** Read the hierarchy back as parent→children adjacency (for the board / tree view). */
export function readHierarchy(graphEdges: GraphEdges): Map<string, string[]> {
  const edges = graphEdges.list({ scope: HIERARCHY_SCOPE, edgeType: 'parent_of', limit: 1000 });
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const arr = adj.get(e.sourceId) ?? [];
    arr.push(e.targetId);
    adj.set(e.sourceId, arr);
  }
  for (const arr of adj.values()) arr.sort();
  return adj;
}
