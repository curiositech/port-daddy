//! Planner scheduler — the CANONICAL implementation (ADR-0086 / ADR-0054).
//!
//! Critical Path Method over a dependency DAG plus the fixed Jira hierarchy ladder. This Rust
//! kernel impl is the source of truth; `lib/planner-schedule.ts` is the byte-parity TS fallback,
//! and `tests/fixtures/planner-schedule-parity-vectors.json` locks the two together (see
//! `tests/parity_schedule.rs`). pd-console (the Rust GPUI Gantt) calls this natively; the TS
//! daemon calls it over the C ABI via koffi (`pd_schedule_dag_json` in `ffi.rs`).
//!
//! Determinism is load-bearing for parity: every traversal is ordered by node id (BTree*), so
//! this and the TS impl produce identical output. An edge `{from,to}` means `from` finishes
//! before `to` starts (from = predecessor).

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

// ─── Scheduler (CPM) ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
pub struct SchedNode {
    pub id: String,
    /// Duration in abstract effort units. Missing/negative is treated as 0.
    #[serde(default)]
    pub estimate: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SchedEdge {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NodeSchedule {
    pub id: String,
    pub earliest_start: i64,
    pub earliest_finish: i64,
    pub latest_start: i64,
    pub latest_finish: i64,
    pub slack: i64,
    pub critical: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleResult {
    pub ok: bool,
    pub reason: String,
    pub cyclic: bool,
    pub makespan: i64,
    pub order: Vec<String>,
    pub nodes: Vec<NodeSchedule>,
    pub critical_path: Vec<String>,
}

fn fail(reason: impl Into<String>, cyclic: bool) -> ScheduleResult {
    ScheduleResult {
        ok: false,
        reason: reason.into(),
        cyclic,
        makespan: 0,
        order: Vec::new(),
        nodes: Vec::new(),
        critical_path: Vec::new(),
    }
}

fn dur(n: &SchedNode) -> i64 {
    match n.estimate {
        Some(e) if e > 0 => e,
        _ => 0,
    }
}

/// Critical Path Method over a dependency DAG. Pure and deterministic (id-ordered).
/// Fails closed: duplicate ids, edges to unknown nodes, and cycles all return `ok:false`.
///
/// # Determinism / parity
/// Node ids are interned once into integer indices assigned in *sorted id order*,
/// so index order is byte-for-byte the same traversal order the old
/// `BTreeMap<String, _>` produced — every output (`order`, `nodes`,
/// `criticalPath`) matches `lib/planner-schedule.ts` and the canonical parity
/// vectors. The interning is a pure performance change: it removes ~10·N
/// short-`String` heap allocations and the per-lookup `BTreeMap<String, _>`
/// string comparisons in favour of flat `Vec` indexing (measured ~2.7× faster
/// at 195 nodes; see `benches/schedule_bench.rs`). Strings are re-materialized
/// only for the owned output fields, which are unavoidable.
pub fn schedule(nodes: &[SchedNode], edges: &[SchedEdge]) -> ScheduleResult {
    // ── Intern ids → sorted integer indices ────────────────────────────────
    // A borrowed BTreeSet gives us both duplicate detection (in input order,
    // preserving the original's first-duplicate message) and, once collected,
    // the sorted id spine that fixes the deterministic index assignment.
    let mut seen: BTreeSet<&str> = BTreeSet::new();
    for node in nodes {
        if !seen.insert(node.id.as_str()) {
            return fail(format!("duplicate node id: {}", node.id), false);
        }
    }
    let ids: Vec<&str> = seen.into_iter().collect(); // sorted, unique
    let n = ids.len();
    let index_of = |id: &str| ids.binary_search(&id).ok();

    // Durations indexed by sorted position.
    let mut dur_idx = vec![0i64; n];
    for node in nodes {
        // Safe: every node id is in `ids` (we just built it from these nodes).
        let i = index_of(node.id.as_str()).expect("node id was interned");
        dur_idx[i] = dur(node);
    }

    // Adjacency + indegree by index. Reject edges to unknown nodes in input
    // order (from-first, then to), matching the original messages exactly.
    let mut succ: Vec<Vec<usize>> = vec![Vec::new(); n];
    let mut pred: Vec<Vec<usize>> = vec![Vec::new(); n];
    let mut indeg: Vec<i64> = vec![0i64; n];
    for e in edges {
        let from = match index_of(e.from.as_str()) {
            Some(i) => i,
            None => return fail(format!("edge references unknown node: {}", e.from), false),
        };
        let to = match index_of(e.to.as_str()) {
            Some(i) => i,
            None => return fail(format!("edge references unknown node: {}", e.to), false),
        };
        // Parallel edges are kept (not deduped): indegree counts each, matching
        // the original's push-per-edge accounting so the topo sort is identical.
        succ[from].push(to);
        pred[to].push(from);
        indeg[to] += 1;
    }
    // Sorting index lists ascending == sorting by id (index order = sorted id
    // order), so successor/predecessor iteration stays deterministic.
    for v in succ.iter_mut() {
        v.sort_unstable();
    }
    for v in pred.iter_mut() {
        v.sort_unstable();
    }

    // ── Kahn topological sort, smallest-index (== smallest id) ready first ──
    let mut order: Vec<usize> = Vec::with_capacity(n);
    let mut ready: BTreeSet<usize> = (0..n).filter(|&i| indeg[i] == 0).collect();
    // `indeg` is unused after seeding `ready`, so reuse it as the mutable work
    // array (avoids cloning a whole map as the original did).
    let mut work = indeg;
    while let Some(&i) = ready.iter().next() {
        ready.remove(&i);
        order.push(i);
        for &s in &succ[i] {
            work[s] -= 1;
            if work[s] == 0 {
                ready.insert(s);
            }
        }
    }
    if order.len() != n {
        return fail("cycle detected in dependency graph", true);
    }

    // ── Forward pass: earliest start/finish ────────────────────────────────
    let mut es = vec![0i64; n];
    let mut ef = vec![0i64; n];
    for &i in &order {
        let mut start = 0i64;
        for &p in &pred[i] {
            start = start.max(ef[p]);
        }
        es[i] = start;
        ef[i] = start + dur_idx[i];
    }
    let makespan = ef.iter().copied().max().unwrap_or(0);

    // ── Backward pass: latest finish/start (reverse topological order) ─────
    let mut lf = vec![0i64; n];
    let mut ls = vec![0i64; n];
    for &i in order.iter().rev() {
        let finish = if succ[i].is_empty() {
            makespan
        } else {
            succ[i].iter().map(|&c| ls[c]).min().unwrap()
        };
        lf[i] = finish;
        ls[i] = finish - dur_idx[i];
    }

    let node_schedules: Vec<NodeSchedule> = (0..n)
        .map(|i| {
            let slack = ls[i] - es[i];
            NodeSchedule {
                id: ids[i].to_string(),
                earliest_start: es[i],
                earliest_finish: ef[i],
                latest_start: ls[i],
                latest_finish: lf[i],
                slack,
                critical: slack == 0,
            }
        })
        .collect();

    let critical_path = critical_chain(&ids, &succ, &es, &ef, &ls);
    let order_ids: Vec<String> = order.iter().map(|&i| ids[i].to_string()).collect();

    ScheduleResult {
        ok: true,
        reason: String::new(),
        cyclic: false,
        makespan,
        order: order_ids,
        nodes: node_schedules,
        critical_path,
    }
}

/// A single deterministic critical chain: start at the id-smallest zero-slack node with
/// earliestStart 0, then follow the id-smallest zero-slack successor whose start is bound by this
/// node's finish (EF[cur] == ES[succ]).
///
/// Operates in the interned index space (`ids[i]` is the sorted id for index
/// `i`), so "id-smallest" == "smallest index"; results are byte-identical to the
/// former string-keyed traversal.
fn critical_chain(
    ids: &[&str],
    succ: &[Vec<usize>],
    es: &[i64],
    ef: &[i64],
    ls: &[i64],
) -> Vec<String> {
    let is_critical = |i: usize| ls[i] - es[i] == 0;
    // Smallest index (== smallest id) that is critical and starts at 0.
    let start = (0..ids.len()).find(|&i| is_critical(i) && es[i] == 0);
    let mut cur = match start {
        Some(s) => Some(s),
        None => return Vec::new(),
    };
    let mut path: Vec<usize> = Vec::new();
    let mut on_path = vec![false; ids.len()];
    while let Some(i) = cur {
        if on_path[i] {
            break;
        }
        on_path[i] = true;
        path.push(i);
        // Smallest-index critical successor bound by this node's finish. `succ`
        // is sorted ascending, so `.min()` picks the id-smallest match.
        cur = succ[i]
            .iter()
            .copied()
            .filter(|&s| is_critical(s) && es[s] == ef[i])
            .min();
    }
    path.into_iter().map(|i| ids[i].to_string()).collect()
}

// ─── Fixed Jira ladder (hierarchy) ───────────────────────────────────────────

/// Rank on the fixed spine: Project(0) → Epic(1) → Story(2) → Task(3) → Subtask(4).
/// bug/chore sit at the story rank. Unknown kinds return None.
pub fn kind_rank(kind: &str) -> Option<i64> {
    match kind {
        "project" => Some(0),
        "epic" => Some(1),
        "story" | "bug" | "chore" => Some(2),
        "task" => Some(3),
        "subtask" => Some(4),
        _ => None,
    }
}

/// Which parent kinds a given child kind may attach to under the fixed ladder.
fn allowed_parents(child_kind: &str) -> Option<&'static [&'static str]> {
    match child_kind {
        "project" => Some(&[]),
        "epic" => Some(&["project"]),
        "story" | "bug" | "chore" => Some(&["epic"]),
        "task" => Some(&["story", "bug", "chore"]),
        "subtask" => Some(&["task"]),
        _ => None,
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct LadderNode {
    pub id: String,
    pub kind: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ParentEdge {
    pub parent: String,
    pub child: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct LadderViolation {
    pub child: String,
    pub child_kind: Option<String>,
    pub parent: Option<String>,
    pub parent_kind: Option<String>,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct LadderResult {
    pub ok: bool,
    pub violations: Vec<LadderViolation>,
}

/// Validate parent edges against the fixed Jira ladder. Deterministic (child-sorted).
pub fn validate_ladder(nodes: &[LadderNode], parents: &[ParentEdge]) -> LadderResult {
    let kind_of: BTreeMap<String, String> =
        nodes.iter().map(|n| (n.id.clone(), n.kind.clone())).collect();

    let mut sorted: Vec<&ParentEdge> = parents.iter().collect();
    sorted.sort_by(|a, b| a.child.cmp(&b.child).then(a.parent.cmp(&b.parent)));

    let mut violations: Vec<LadderViolation> = Vec::new();
    let mut parent_seen: BTreeSet<String> = BTreeSet::new();

    for e in sorted {
        let child_kind = kind_of.get(&e.child).cloned();
        let parent_kind = kind_of.get(&e.parent).cloned();

        let ck = match &child_kind {
            None => {
                violations.push(LadderViolation {
                    child: e.child.clone(),
                    child_kind: None,
                    parent: Some(e.parent.clone()),
                    parent_kind: parent_kind.clone(),
                    reason: format!("unknown child node: {}", e.child),
                });
                continue;
            }
            Some(k) => k.clone(),
        };
        let pk = match &parent_kind {
            None => {
                violations.push(LadderViolation {
                    child: e.child.clone(),
                    child_kind: Some(ck),
                    parent: Some(e.parent.clone()),
                    parent_kind: None,
                    reason: format!("unknown parent node: {}", e.parent),
                });
                continue;
            }
            Some(k) => k.clone(),
        };

        if parent_seen.contains(&e.child) {
            violations.push(LadderViolation {
                child: e.child.clone(),
                child_kind: Some(ck),
                parent: Some(e.parent.clone()),
                parent_kind: Some(pk),
                reason: format!("{} has more than one parent (a node may have at most one)", e.child),
            });
            continue;
        }
        parent_seen.insert(e.child.clone());

        let allowed = allowed_parents(&ck).unwrap_or(&[]);
        if !allowed.contains(&pk.as_str()) {
            let expect = if allowed.is_empty() {
                "(none — project is a root)".to_string()
            } else {
                allowed.join("/")
            };
            violations.push(LadderViolation {
                child: e.child.clone(),
                child_kind: Some(ck.clone()),
                parent: Some(e.parent.clone()),
                parent_kind: Some(pk.clone()),
                reason: format!(
                    "{} '{}' cannot have a {} parent; allowed: {}",
                    ck, e.child, pk, expect
                ),
            });
        }
    }

    LadderResult {
        ok: violations.is_empty(),
        violations,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn n(id: &str, est: i64) -> SchedNode {
        SchedNode { id: id.into(), estimate: Some(est) }
    }
    fn edge(from: &str, to: &str) -> SchedEdge {
        SchedEdge { from: from.into(), to: to.into() }
    }

    #[test]
    fn linear_chain_is_all_critical() {
        let r = schedule(&[n("a", 2), n("b", 3), n("c", 1)], &[edge("a", "b"), edge("b", "c")]);
        assert!(r.ok);
        assert_eq!(r.makespan, 6);
        assert_eq!(r.critical_path, vec!["a", "b", "c"]);
    }

    #[test]
    fn cycle_fails_closed() {
        let r = schedule(&[n("a", 1), n("b", 1)], &[edge("a", "b"), edge("b", "a")]);
        assert!(!r.ok);
        assert!(r.cyclic);
    }

    #[test]
    fn ladder_rejects_rank_skip() {
        let r = validate_ladder(
            &[
                LadderNode { id: "p".into(), kind: "project".into() },
                LadderNode { id: "t".into(), kind: "task".into() },
            ],
            &[ParentEdge { parent: "p".into(), child: "t".into() }],
        );
        assert!(!r.ok);
        assert_eq!(r.violations[0].child, "t");
    }
}
