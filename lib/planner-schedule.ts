/**
 * Planner scheduler — pure TS byte-parity fallback for the Rust kernel (ADR-0086 / ADR-0054).
 *
 * The CANONICAL scheduler is the Rust kernel crate `pd-anchor` (`core/kernel/pd-anchor`,
 * `schedule.rs`), exposed over the C ABI as `pd_schedule_dag_json` and consumed natively by
 * pd-console (the Rust GPUI Gantt) and via koffi by the TS daemon. THIS module is the byte-parity
 * fallback used when the dylib is absent (source installs, CI), and the parity reference the
 * cross-runtime gate locks against (tests/fixtures/planner-schedule-parity-vectors.json).
 *
 * Two pure pieces, both mirrored 1:1 in Rust:
 *   1. `schedule(nodes, edges)` — Critical Path Method over the dependency DAG: topological
 *      order (Kahn), cycle detection, earliest/latest start-finish, slack, the critical path,
 *      and the makespan. This is what the Gantt renders.
 *   2. `validateLadder(nodes, parents)` — the fixed Jira hierarchy ladder
 *      (Project → Epic → Story → Task → Subtask; bug/chore at the story rank).
 *
 * Determinism is load-bearing for parity: every traversal is ordered by node id, so Rust and TS
 * produce identical results. "Byte-parity" here is value-parity over parsed JSON (the gate
 * compares structured output, as the macaroon parity test does).
 *
 * An edge `{ from, to }` means `from` must FINISH before `to` STARTS (from = predecessor). When
 * building input from `graph_edges`, a `depends_on` edge (source=dependent, target=dependency)
 * maps to `{ from: target, to: source }`.
 */

// ─── Scheduler (CPM) ─────────────────────────────────────────────────────────

export interface SchedNode {
  id: string;
  /** Duration in abstract effort units. Missing/negative is treated as 0. */
  estimate?: number;
}

export interface SchedEdge {
  /** Predecessor — must finish before `to` starts. */
  from: string;
  /** Successor. */
  to: string;
}

export interface NodeSchedule {
  id: string;
  earliestStart: number;
  earliestFinish: number;
  latestStart: number;
  latestFinish: number;
  slack: number;
  critical: boolean;
}

export interface ScheduleResult {
  ok: boolean;
  reason: string;
  cyclic: boolean;
  makespan: number;
  /** Topological order (empty when cyclic or on error). */
  order: string[];
  nodes: NodeSchedule[];
  /** A single deterministic longest (zero-slack) chain through the DAG. */
  criticalPath: string[];
}

function fail(reason: string, cyclic = false): ScheduleResult {
  return { ok: false, reason, cyclic, makespan: 0, order: [], nodes: [], criticalPath: [] };
}

function dur(n: SchedNode): number {
  const e = n.estimate;
  return typeof e === 'number' && e > 0 ? e : 0;
}

/**
 * Critical Path Method over a dependency DAG. Pure and deterministic (id-ordered).
 * Fails closed: duplicate ids, edges to unknown nodes, and cycles all return `ok:false`.
 */
export function schedule(nodes: SchedNode[], edges: SchedEdge[]): ScheduleResult {
  // Index nodes; reject duplicates.
  const byId = new Map<string, SchedNode>();
  for (const n of nodes) {
    if (byId.has(n.id)) return fail(`duplicate node id: ${n.id}`);
    byId.set(n.id, n);
  }
  // Adjacency + indegree, id-sorted for determinism. Reject edges to unknown nodes.
  const ids = [...byId.keys()].sort();
  const succ = new Map<string, string[]>();
  const pred = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const id of ids) {
    succ.set(id, []);
    pred.set(id, []);
    indeg.set(id, 0);
  }
  for (const e of edges) {
    if (!byId.has(e.from)) return fail(`edge references unknown node: ${e.from}`);
    if (!byId.has(e.to)) return fail(`edge references unknown node: ${e.to}`);
    succ.get(e.from)!.push(e.to);
    pred.get(e.to)!.push(e.from);
    indeg.set(e.to, indeg.get(e.to)! + 1);
  }
  for (const id of ids) {
    succ.get(id)!.sort();
    pred.get(id)!.sort();
  }

  // Kahn topological sort, id-ordered ready set.
  const order: string[] = [];
  const ready: string[] = ids.filter((id) => indeg.get(id) === 0);
  const work = new Map(indeg);
  while (ready.length > 0) {
    ready.sort();
    const id = ready.shift()!;
    order.push(id);
    for (const s of succ.get(id)!) {
      work.set(s, work.get(s)! - 1);
      if (work.get(s) === 0) ready.push(s);
    }
  }
  if (order.length !== ids.length) {
    return fail('cycle detected in dependency graph', true);
  }

  // Forward pass: earliest start/finish.
  const es = new Map<string, number>();
  const ef = new Map<string, number>();
  for (const id of order) {
    let start = 0;
    for (const p of pred.get(id)!) start = Math.max(start, ef.get(p)!);
    es.set(id, start);
    ef.set(id, start + dur(byId.get(id)!));
  }
  let makespan = 0;
  for (const id of ids) makespan = Math.max(makespan, ef.get(id)!);

  // Backward pass: latest finish/start (reverse topological order).
  const lf = new Map<string, number>();
  const ls = new Map<string, number>();
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    const s = succ.get(id)!;
    let finish = makespan;
    if (s.length > 0) {
      finish = Infinity;
      for (const c of s) finish = Math.min(finish, ls.get(c)!);
    }
    lf.set(id, finish);
    ls.set(id, finish - dur(byId.get(id)!));
  }

  const nodeSchedules: NodeSchedule[] = ids.map((id) => {
    const slack = ls.get(id)! - es.get(id)!;
    return {
      id,
      earliestStart: es.get(id)!,
      earliestFinish: ef.get(id)!,
      latestStart: ls.get(id)!,
      latestFinish: lf.get(id)!,
      slack,
      critical: slack === 0,
    };
  });

  return {
    ok: true,
    reason: '',
    cyclic: false,
    makespan,
    order,
    nodes: nodeSchedules,
    criticalPath: criticalChain(ids, succ, es, ef, ls),
  };
}

/**
 * A single deterministic critical chain: start at the id-smallest zero-slack node with no
 * zero-slack predecessor binding it (earliestStart 0), then follow the id-smallest zero-slack
 * successor whose start is bound by this node's finish (EF[cur] === ES[succ]).
 */
function criticalChain(
  ids: string[],
  succ: Map<string, string[]>,
  es: Map<string, number>,
  ef: Map<string, number>,
  ls: Map<string, number>,
): string[] {
  const isCritical = (id: string) => ls.get(id)! - es.get(id)! === 0;
  const starts = ids.filter((id) => isCritical(id) && es.get(id) === 0).sort();
  if (starts.length === 0) return [];
  const path: string[] = [];
  let cur: string | undefined = starts[0];
  const seen = new Set<string>();
  while (cur !== undefined && !seen.has(cur)) {
    const curId: string = cur; // narrow once; TS won't narrow `cur` inside the closure below
    seen.add(curId);
    path.push(curId);
    const next = succ
      .get(curId)!
      .filter((s) => isCritical(s) && es.get(s) === ef.get(curId))
      .sort();
    cur = next[0];
  }
  return path;
}

// ─── Fixed Jira ladder (hierarchy) ───────────────────────────────────────────

export type IssueKind = 'project' | 'epic' | 'story' | 'task' | 'subtask' | 'bug' | 'chore';

/** Canonical spine: Project(0) → Epic(1) → Story(2) → Task(3) → Subtask(4); bug/chore at story rank. */
export const KIND_RANK: Record<IssueKind, number> = {
  project: 0,
  epic: 1,
  story: 2,
  bug: 2,
  chore: 2,
  task: 3,
  subtask: 4,
};

/** Which parent kinds each child kind may attach to under the fixed ladder. */
const ALLOWED_PARENT: Record<IssueKind, IssueKind[]> = {
  project: [],
  epic: ['project'],
  story: ['epic'],
  bug: ['epic'],
  chore: ['epic'],
  task: ['story', 'bug', 'chore'],
  subtask: ['task'],
};

export interface LadderNode {
  id: string;
  kind: IssueKind;
}

export interface ParentEdge {
  parent: string;
  child: string;
}

export interface LadderViolation {
  child: string;
  childKind: IssueKind | null;
  parent: string | null;
  parentKind: IssueKind | null;
  reason: string;
}

export interface LadderResult {
  ok: boolean;
  violations: LadderViolation[];
}

/**
 * Validate parent edges against the fixed Jira ladder. Deterministic (violations id-sorted by
 * child). Catches: unknown ids, a child with more than one parent, a `project` given a parent,
 * and any parent whose kind isn't allowed for the child's kind.
 */
export function validateLadder(nodes: LadderNode[], parents: ParentEdge[]): LadderResult {
  const kindOf = new Map<string, IssueKind>();
  for (const n of nodes) kindOf.set(n.id, n.kind);

  const violations: LadderViolation[] = [];
  const parentSeen = new Map<string, string>(); // child -> parent already recorded

  const sorted = [...parents].sort((a, b) =>
    a.child < b.child ? -1 : a.child > b.child ? 1 : a.parent < b.parent ? -1 : a.parent > b.parent ? 1 : 0,
  );

  for (const e of sorted) {
    const childKind = kindOf.get(e.child) ?? null;
    const parentKind = kindOf.get(e.parent) ?? null;

    if (childKind === null) {
      violations.push({ child: e.child, childKind: null, parent: e.parent, parentKind, reason: `unknown child node: ${e.child}` });
      continue;
    }
    if (parentKind === null) {
      violations.push({ child: e.child, childKind, parent: e.parent, parentKind: null, reason: `unknown parent node: ${e.parent}` });
      continue;
    }
    if (parentSeen.has(e.child)) {
      violations.push({ child: e.child, childKind, parent: e.parent, parentKind, reason: `${e.child} has more than one parent (a node may have at most one)` });
      continue;
    }
    parentSeen.set(e.child, e.parent);

    const allowed = ALLOWED_PARENT[childKind];
    if (!allowed.includes(parentKind)) {
      const expect = allowed.length > 0 ? allowed.join('/') : '(none — project is a root)';
      violations.push({
        child: e.child,
        childKind,
        parent: e.parent,
        parentKind,
        reason: `${childKind} '${e.child}' cannot have a ${parentKind} parent; allowed: ${expect}`,
      });
    }
  }

  return { ok: violations.length === 0, violations };
}
