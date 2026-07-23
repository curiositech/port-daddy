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

/// Critical Path Method over a dependency DAG.
///
/// CPM is the classic project-scheduling algorithm: given a set of tasks with
/// durations and a "must finish before" dependency graph, find (a) the
/// earliest every task *could* start/finish, (b) the latest it *could*
/// start/finish without delaying the whole project, and (c) which tasks have
/// zero slack — the **critical path**, the chain that actually determines the
/// project's total duration (the "makespan"). Slip a critical-path task and
/// the whole project slips; slip a task with slack and nothing downstream
/// notices.
///
/// The algorithm is two topological passes over the DAG:
/// 1. **Forward pass** (earliest start/finish): walk tasks in dependency
///    order; a task's earliest start is the latest of its predecessors'
///    earliest finishes (it can't begin until everything it depends on is
///    done). The makespan is the latest earliest-finish across all tasks.
/// 2. **Backward pass** (latest start/finish): walk tasks in *reverse*
///    dependency order, anchored at the makespan; a task's latest finish is
///    the earliest of its successors' latest starts (it must finish in time
///    for whatever depends on it). `slack = latestStart - earliestStart`; a
///    task is critical iff `slack == 0`.
///
/// Pure and deterministic: every internal traversal is ordered by node id
/// (`BTreeMap`/`BTreeSet`), so the same graph always produces byte-identical
/// output — this is what lets `lib/planner-schedule.ts` (the TS byte-parity
/// fallback) and this Rust implementation agree exactly, locked by
/// `tests/parity_schedule.rs`.
///
/// **Fails closed**, never panics on bad input: a duplicate node id, an edge
/// referencing an unknown node, or a cycle in the dependency graph all return
/// `ScheduleResult { ok: false, .. }` with a human-readable `reason` — never
/// a crash, never a wrong answer presented as a right one.
///
/// # Examples
///
/// A three-task linear chain — everything is on the critical path, since
/// there's no parallelism to create slack:
///
/// ```
/// use pd_anchor::schedule::{schedule, SchedNode, SchedEdge};
///
/// let nodes = vec![
///     SchedNode { id: "design".into(), estimate: Some(2) },
///     SchedNode { id: "build".into(), estimate: Some(3) },
///     SchedNode { id: "ship".into(), estimate: Some(1) },
/// ];
/// let edges = vec![
///     SchedEdge { from: "design".into(), to: "build".into() },
///     SchedEdge { from: "build".into(), to: "ship".into() },
/// ];
///
/// let result = schedule(&nodes, &edges);
/// assert!(result.ok);
/// assert_eq!(result.makespan, 6); // 2 + 3 + 1, no parallelism possible
/// assert_eq!(result.critical_path, vec!["design", "build", "ship"]);
/// ```
///
/// A cycle is rejected, not silently mis-scheduled:
///
/// ```
/// use pd_anchor::schedule::{schedule, SchedNode, SchedEdge};
///
/// let nodes = vec![
///     SchedNode { id: "a".into(), estimate: Some(1) },
///     SchedNode { id: "b".into(), estimate: Some(1) },
/// ];
/// let edges = vec![
///     SchedEdge { from: "a".into(), to: "b".into() },
///     SchedEdge { from: "b".into(), to: "a".into() }, // cycle!
/// ];
///
/// let result = schedule(&nodes, &edges);
/// assert!(!result.ok);
/// assert!(result.cyclic);
/// ```
pub fn schedule(nodes: &[SchedNode], edges: &[SchedEdge]) -> ScheduleResult {
    // Index nodes; reject duplicates.
    let mut by_id: BTreeMap<String, &SchedNode> = BTreeMap::new();
    for n in nodes {
        if by_id.insert(n.id.clone(), n).is_some() {
            return fail(format!("duplicate node id: {}", n.id), false);
        }
    }

    // Adjacency + indegree (BTreeMap keys stay id-sorted). Reject edges to unknown nodes.
    let mut succ: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut pred: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut indeg: BTreeMap<String, i64> = BTreeMap::new();
    for id in by_id.keys() {
        succ.insert(id.clone(), Vec::new());
        pred.insert(id.clone(), Vec::new());
        indeg.insert(id.clone(), 0);
    }
    for e in edges {
        if !by_id.contains_key(&e.from) {
            return fail(format!("edge references unknown node: {}", e.from), false);
        }
        if !by_id.contains_key(&e.to) {
            return fail(format!("edge references unknown node: {}", e.to), false);
        }
        succ.get_mut(&e.from).unwrap().push(e.to.clone());
        pred.get_mut(&e.to).unwrap().push(e.from.clone());
        *indeg.get_mut(&e.to).unwrap() += 1;
    }
    for v in succ.values_mut() {
        v.sort();
    }
    for v in pred.values_mut() {
        v.sort();
    }

    // Kahn topological sort, id-ordered ready set.
    let ids: Vec<String> = by_id.keys().cloned().collect();
    let mut order: Vec<String> = Vec::new();
    let mut ready: BTreeSet<String> = ids
        .iter()
        .filter(|id| indeg[*id] == 0)
        .cloned()
        .collect();
    let mut work = indeg.clone();
    while let Some(id) = ready.iter().next().cloned() {
        ready.remove(&id);
        order.push(id.clone());
        for s in &succ[&id] {
            let w = work.get_mut(s).unwrap();
            *w -= 1;
            if *w == 0 {
                ready.insert(s.clone());
            }
        }
    }
    if order.len() != ids.len() {
        return fail("cycle detected in dependency graph", true);
    }

    // Forward pass: earliest start/finish.
    let mut es: BTreeMap<String, i64> = BTreeMap::new();
    let mut ef: BTreeMap<String, i64> = BTreeMap::new();
    for id in &order {
        let mut start = 0i64;
        for p in &pred[id] {
            start = start.max(ef[p]);
        }
        es.insert(id.clone(), start);
        ef.insert(id.clone(), start + dur(by_id[id]));
    }
    let makespan = ids.iter().map(|id| ef[id]).max().unwrap_or(0);

    // Backward pass: latest finish/start (reverse topological order).
    let mut lf: BTreeMap<String, i64> = BTreeMap::new();
    let mut ls: BTreeMap<String, i64> = BTreeMap::new();
    for id in order.iter().rev() {
        let s = &succ[id];
        let finish = if s.is_empty() {
            makespan
        } else {
            s.iter().map(|c| ls[c]).min().unwrap()
        };
        lf.insert(id.clone(), finish);
        ls.insert(id.clone(), finish - dur(by_id[id]));
    }

    let node_schedules: Vec<NodeSchedule> = ids
        .iter()
        .map(|id| {
            let slack = ls[id] - es[id];
            NodeSchedule {
                id: id.clone(),
                earliest_start: es[id],
                earliest_finish: ef[id],
                latest_start: ls[id],
                latest_finish: lf[id],
                slack,
                critical: slack == 0,
            }
        })
        .collect();

    let critical_path = critical_chain(&ids, &succ, &es, &ef, &ls);

    ScheduleResult {
        ok: true,
        reason: String::new(),
        cyclic: false,
        makespan,
        order,
        nodes: node_schedules,
        critical_path,
    }
}

/// A single deterministic critical chain: start at the id-smallest zero-slack node with
/// earliestStart 0, then follow the id-smallest zero-slack successor whose start is bound by this
/// node's finish (EF[cur] == ES[succ]).
fn critical_chain(
    ids: &[String],
    succ: &BTreeMap<String, Vec<String>>,
    es: &BTreeMap<String, i64>,
    ef: &BTreeMap<String, i64>,
    ls: &BTreeMap<String, i64>,
) -> Vec<String> {
    let is_critical = |id: &String| ls[id] - es[id] == 0;
    let mut starts: Vec<String> = ids
        .iter()
        .filter(|id| is_critical(id) && es[*id] == 0)
        .cloned()
        .collect();
    starts.sort();
    if starts.is_empty() {
        return Vec::new();
    }
    let mut path: Vec<String> = Vec::new();
    let mut seen: BTreeSet<String> = BTreeSet::new();
    let mut cur = Some(starts[0].clone());
    while let Some(id) = cur {
        if seen.contains(&id) {
            break;
        }
        seen.insert(id.clone());
        path.push(id.clone());
        let mut next: Vec<String> = succ[&id]
            .iter()
            .filter(|s| is_critical(s) && es[*s] == ef[&id])
            .cloned()
            .collect();
        next.sort();
        cur = next.into_iter().next();
    }
    path
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
