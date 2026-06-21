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
 *   planner:links      links       roadmap:item → commit|pr|adr|doc   (artifacts, in metadata)
 */

import type { GraphEdges, GraphEdgeInput } from './graph-edges.js';
import type { PlannerPlan } from './planner-migrate.js';

export const HIERARCHY_SCOPE = 'planner:hierarchy';
export const DEPS_SCOPE = 'planner:deps';
export const LINKS_SCOPE = 'planner:links';

export const ITEM_TYPE = 'roadmap:item';
export type ArtifactType = 'commit' | 'pr' | 'adr' | 'doc';

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

/** A links edge input: roadmap item → an external artifact (commit/PR/ADR/doc). */
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
  dependsOnEdges: number;
}

/**
 * Lay down a plan's hierarchy + dependency edges into graph_edges, idempotently. `replaceScope`
 * clears each scope first, so re-running converges (no duplicate edges) and reflects deletions.
 * Note `parentEdges` use the scheduler/plan node ids directly (epic ids like `adr-0048` and the
 * `port-daddy` root are item-typed nodes too — they live in graph_edges, not roadmap_items).
 */
export function writePlanEdges(graphEdges: GraphEdges, plan: PlannerPlan): WritePlanResult {
  const hierarchy: GraphEdgeInput[] = plan.parentEdges.map((e) => parentEdge(e.parent, e.child));
  // dependsOnEdges are in scheduler form { from: dependency, to: dependent }.
  const deps: GraphEdgeInput[] = plan.dependsOnEdges.map((e) => dependsOnEdge(e.to, e.from));

  graphEdges.replaceScope(HIERARCHY_SCOPE, hierarchy);
  graphEdges.replaceScope(DEPS_SCOPE, deps);

  return { hierarchyEdges: hierarchy.length, dependsOnEdges: deps.length };
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
