/**
 * Planner migration — derive a Jira hierarchy from the existing flat roadmap (ADR-0086 Phase 2).
 *
 * This is the PURE, deterministic core: given the current `roadmap_items`, it produces a
 * `PlannerPlan` (one root Project → an Epic per ADR → a Task per phase, plus depends_on edges and
 * priorities) WITHOUT touching the DB. The IO layer (the `pd roadmap migrate-planner` command)
 * runs this, shows the plan as a dry-run, and only on `--apply` writes the edges (via
 * `lib/planner-edges.ts` → graph_edges) and the kind/priority columns.
 *
 * The hierarchy is derived from STRUCTURED fields we control — the `adr-NNNN-phase-X` slug
 * convention (ADR-0043) and the `adr:NNNN` note stamp — never fuzzy text classification. Items
 * that carry no ADR id land under a single `unsorted` epic and are flagged, not guessed at.
 *
 * Per the operator decision (structure-only): the duplicate slug and harbor inconsistency are
 * REPORTED in `flags`, never auto-merged or moved.
 */

import type { RoadmapStatus } from './roadmap-items.js';

export type IssueKind = 'project' | 'epic' | 'story' | 'task' | 'subtask' | 'bug' | 'chore';

/** Minimal roadmap-item shape the derivation needs (a structural subset of RoadmapItem). */
export interface MigrationItem {
  slug: string;
  summaryMd: string;
  status: RoadmapStatus;
  dependencies: string[];
  notes?: Array<{ text: string }>;
  harbor: string;
  /**
   * Optional Gantt date anchors (`RoadmapItem.startedAt`/`dueAt`, epoch ms).
   * `derivePlan` never reads these — they exist here only so a caller can
   * build one `MigrationItem[]` and feed it to both `derivePlan` (hierarchy)
   * and `renderBoard` (which structurally needs a `BoardItemView[]`,
   * `lib/planner-board.ts`) without a second, field-duplicating mapping pass.
   */
  startedAt?: number | null;
  dueAt?: number | null;
}

export interface PlanNode {
  id: string;
  kind: IssueKind;
  title: string;
  status?: RoadmapStatus;
  priority?: number;
  parent?: string;
  /** The originating roadmap slug (tasks only). */
  slug?: string;
  summaryMd?: string;
}

export interface PlannerPlan {
  project: PlanNode;
  epics: PlanNode[];
  tasks: PlanNode[];
  /** Containment edges (project→epic, epic→task) for graph_edges `parent_of`. */
  parentEdges: Array<{ parent: string; child: string }>;
  /** Blocking edges in scheduler form: `from` finishes before `to`. Built from dependencies
   *  (item depends_on d ⇒ edge d→item). Only edges between known items are emitted. */
  dependsOnEdges: Array<{ from: string; to: string }>;
  flags: {
    duplicates: Array<{ slug: string; count: number }>;
    harbors: Array<{ harbor: string; count: number }>;
    loose: string[];
    danglingDeps: Array<{ slug: string; missing: string }>;
  };
}

export const ROOT_PROJECT_ID = 'port-daddy';
export const UNSORTED_EPIC_ID = 'unsorted';

/** Priority (1 highest .. 5 lowest) derived from the workflow status. */
export function priorityForStatus(status: RoadmapStatus): number {
  switch (status) {
    case 'now':
    case 'merge':
      return 2;
    case 'backlog':
      return 3;
    case 'parked':
      return 4;
    case 'done':
      return 5;
    default:
      return 3;
  }
}

/**
 * Extract the owning ADR number (zero-padded 4-digit) from an item's structured fields:
 * the `adr-NNNN-…` slug first, then an `adr:NNNN` / `ADR-NNNN` token in the notes or summary.
 * Returns null when none is present (→ the item is "loose"). This reads an ID token, not prose.
 */
export function adrNumberOf(item: MigrationItem): string | null {
  const slugMatch = item.slug.match(/^adr-?(\d{2,4})\b/i);
  if (slugMatch) return slugMatch[1].padStart(4, '0');
  const hay = `${item.summaryMd ?? ''} ${(item.notes ?? []).map((n) => n.text).join(' ')}`;
  const tokenMatch = hay.match(/\badr[-:\s]?(\d{2,4})\b/i);
  if (tokenMatch) return tokenMatch[1].padStart(4, '0');
  return null;
}

/**
 * Derive the full planner hierarchy from the current roadmap items. Pure and deterministic
 * (everything id/slug-sorted). Duplicate slugs collapse to a single task (first occurrence wins
 * for placement) and are reported in `flags.duplicates`.
 */
export function derivePlan(items: MigrationItem[], projectTitle = 'Port Daddy'): PlannerPlan {
  // Count slugs for duplicate detection; first occurrence is the canonical placement.
  const slugCounts = new Map<string, number>();
  for (const it of items) slugCounts.set(it.slug, (slugCounts.get(it.slug) ?? 0) + 1);

  const known = new Set(slugCounts.keys());
  const seen = new Set<string>();
  const epicIds = new Set<string>();
  const tasks: PlanNode[] = [];
  const parentEdges: Array<{ parent: string; child: string }> = [];
  const dependsOnEdges: Array<{ from: string; to: string }> = [];
  const loose: string[] = [];
  const danglingDeps: Array<{ slug: string; missing: string }> = [];

  // Stable order: by slug.
  const ordered = [...items].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));

  for (const it of ordered) {
    if (seen.has(it.slug)) continue; // collapse duplicates; first (slug-sorted) wins
    seen.add(it.slug);

    const adr = adrNumberOf(it);
    const epicId = adr ? `adr-${adr}` : UNSORTED_EPIC_ID;
    if (!adr) loose.push(it.slug);
    epicIds.add(epicId);

    tasks.push({
      id: it.slug,
      slug: it.slug,
      kind: 'task',
      title: it.slug,
      summaryMd: it.summaryMd,
      status: it.status,
      priority: priorityForStatus(it.status),
      parent: epicId,
    });
    parentEdges.push({ parent: epicId, child: it.slug });

    for (const dep of [...it.dependencies].sort()) {
      if (!known.has(dep)) {
        danglingDeps.push({ slug: it.slug, missing: dep });
        continue;
      }
      // item depends_on dep ⇒ dep must finish before item ⇒ scheduler edge dep→item.
      dependsOnEdges.push({ from: dep, to: it.slug });
    }
  }

  // Epics, sorted: ADR epics by number, then the unsorted catch-all last.
  const epics: PlanNode[] = [...epicIds]
    .sort((a, b) => {
      if (a === UNSORTED_EPIC_ID) return 1;
      if (b === UNSORTED_EPIC_ID) return -1;
      return a < b ? -1 : a > b ? 1 : 0;
    })
    .map((id) => ({
      id,
      kind: 'epic' as IssueKind,
      title: id === UNSORTED_EPIC_ID ? 'Unsorted' : `ADR-${id.replace(/^adr-/, '')}`,
      parent: ROOT_PROJECT_ID,
    }));

  const project: PlanNode = { id: ROOT_PROJECT_ID, kind: 'project', title: projectTitle };
  for (const e of epics) parentEdges.unshift({ parent: ROOT_PROJECT_ID, child: e.id });

  const duplicates = [...slugCounts.entries()]
    .filter(([, n]) => n > 1)
    .map(([slug, count]) => ({ slug, count }))
    .sort((a, b) => (a.slug < b.slug ? -1 : 1));

  const harborCounts = new Map<string, number>();
  for (const it of items) harborCounts.set(it.harbor, (harborCounts.get(it.harbor) ?? 0) + 1);
  const harbors = [...harborCounts.entries()]
    .map(([harbor, count]) => ({ harbor, count }))
    .sort((a, b) => b.count - a.count);

  return {
    project,
    epics,
    tasks: tasks.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    parentEdges,
    dependsOnEdges,
    flags: { duplicates, harbors, loose: loose.sort(), danglingDeps },
  };
}

/** Summary counts for a dry-run banner. */
export function planSummary(plan: PlannerPlan): {
  epics: number;
  tasks: number;
  dependsOnEdges: number;
  loose: number;
  duplicates: number;
  harbors: number;
} {
  return {
    epics: plan.epics.length,
    tasks: plan.tasks.length,
    dependsOnEdges: plan.dependsOnEdges.length,
    loose: plan.flags.loose.length,
    duplicates: plan.flags.duplicates.length,
    harbors: plan.flags.harbors.length,
  };
}
