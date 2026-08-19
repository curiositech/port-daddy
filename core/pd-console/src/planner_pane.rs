//! Planner pane — the roadmap as a Jira-like hierarchy (ADR-0086), replacing the
//! flat Roadmap and ADR panes.
//!
//! Calls `GET /roadmap/items?limit=2000` and derives Project → Epic(per ADR) →
//! Task from the structured `adr-NNNN-phase-…` slug + `adr:NNNN` note/summary
//! token (IDs we control — not fuzzy NLP), exactly like `lib/planner-migrate.ts`.
//! Renders a critical-path Gantt (CPM via the kernel's canonical scheduler,
//! ADR-0086) as the LEADING section, then the tree + status/priority chips + a
//! flags banner — all as render-agnostic Blocks (GPUI/ratatui/PNG paint them;
//! a bespoke Track-B Vello Gantt canvas can later supersede the Block bars
//! without changing this pane's data derivation).
//!
//! Item shape (v3.2x): `{ slug, summaryMd, status, dependencies: [slug], harbor,
//! notes:[{text}], estimate? }` — `estimate` is the ADR-0086 planner column the
//! daemon now serves; older daemons simply omit it and bars default to one unit.

use crate::agent::DaemonClient;
use crate::pane::{Block, Pane, Tone};
use crate::util::{arr, s, trunc};
use anyhow::Result;
use pd_anchor::schedule::{schedule, SchedEdge, SchedNode};
use serde_json::Value;

#[derive(Debug, Clone)]
struct PlannerItem {
    slug: String,
    summary: String,
    status: String,
    deps: Vec<String>,
    harbor: String,
    /// Owning ADR number (4-digit) derived from slug/notes/summary, or None (unsorted).
    adr: Option<String>,
    /// Effort estimate in abstract units (ADR-0086 planner column). None when
    /// the daemon predates the field or the item was never sized; the Gantt
    /// defaults such items to one unit so every task still earns a visible bar.
    estimate: Option<i64>,
}

impl PlannerItem {
    fn from_value(v: &Value) -> Self {
        let slug = s(v, "slug");
        let summary = s(v, "summaryMd");
        let notes_text: String = arr(v, "notes")
            .iter()
            .map(|n| s(n, "text"))
            .collect::<Vec<_>>()
            .join(" ");
        let deps = arr(v, "dependencies")
            .iter()
            .filter_map(|d| d.as_str().map(|x| x.to_string()))
            .collect();
        let adr = adr_number_of(&slug, &summary, &notes_text);
        let estimate = v.get("estimate").and_then(|e| e.as_i64()).filter(|e| *e > 0);
        Self {
            slug,
            summary,
            status: s(v, "status"),
            deps,
            harbor: s(v, "harbor"),
            adr,
            estimate,
        }
    }
}

/// Extract the owning ADR number (zero-padded 4-digit) from structured fields:
/// the `adr-NNNN-…` slug first, then an `adr:NNNN`/`ADR-NNNN` token in summary/notes.
/// Reads an ID token, never classifies prose. Mirrors `adrNumberOf` in planner-migrate.ts.
fn adr_number_of(slug: &str, summary: &str, notes: &str) -> Option<String> {
    if let Some(n) = leading_adr(slug) {
        return Some(n);
    }
    let hay = format!("{summary} {notes}");
    token_adr(&hay)
}

/// `adr-0048-phase-…` / `adr48-…` → "0048".
fn leading_adr(slug: &str) -> Option<String> {
    let rest = slug
        .strip_prefix("adr-")
        .or_else(|| slug.strip_prefix("adr"))?;
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    pad4(&digits)
}

/// First `adr[-:\s]NNNN` / `ADR-NNNN` token anywhere in `hay` → "NNNN".
fn token_adr(hay: &str) -> Option<String> {
    let lower = hay.to_ascii_lowercase();
    let bytes = lower.as_bytes();
    let mut i = 0;
    while let Some(pos) = lower[i..].find("adr") {
        let start = i + pos + 3;
        // skip a single separator
        let mut j = start;
        if j < bytes.len() && matches!(bytes[j], b'-' | b':' | b' ') {
            j += 1;
        }
        let digits: String = lower[j..]
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .collect();
        if let Some(n) = pad4(&digits) {
            return Some(n);
        }
        i = start;
    }
    None
}

fn pad4(digits: &str) -> Option<String> {
    if digits.len() < 2 || digits.len() > 4 || !digits.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    Some(format!("{:0>4}", digits))
}

/// Priority 1 (highest) .. 5 from workflow status — mirrors priorityForStatus.
fn priority_for_status(st: &str) -> u8 {
    match st {
        "now" | "merge" => 2,
        "backlog" => 3,
        "parked" => 4,
        "done" => 5,
        _ => 3,
    }
}

fn status_tone(st: &str) -> Tone {
    match st {
        "done" | "merge" | "shipped" | "landed" => Tone::Landed,
        "now" | "in-progress" | "active" => Tone::Engaged,
        "blocked" | "rejected" | "parked" | "deferred" => Tone::Gated,
        _ => Tone::Resting,
    }
}

/// One epic = an ADR (or the unsorted catch-all), with its task slugs.
struct Epic {
    /// `adr-0048` or `unsorted`.
    id: String,
    /// `ADR-0048` or `Unsorted`.
    title: String,
    tasks: Vec<usize>, // indices into items
}

pub struct PlannerPane {
    items: Vec<PlannerItem>,
    /// slug → who currently holds the live roadmap-pop claim, when present.
    /// From GET /cartographer/roadmap-claims (active = releasedAt null).
    claims: std::collections::HashMap<String, String>,
    /// The live fleet: (identity, purpose, status) per running agent, from
    /// GET /agents. This is the cockpit's "what agents are working on what" axis —
    /// each agent's `purpose` is the real task it was spawned on.
    agents: Vec<(String, String, String)>,
    last_error: Option<String>,
}

impl Default for PlannerPane {
    fn default() -> Self {
        Self {
            items: Vec::new(),
            claims: std::collections::HashMap::new(),
            agents: Vec::new(),
            last_error: None,
        }
    }
}

impl PlannerPane {
    pub fn new() -> Self {
        Self::default()
    }

    /// Group items into ADR epics (sorted by number; unsorted last), deduping by slug
    /// (first occurrence wins) — the derivation half of planner-migrate.ts.
    fn epics(&self) -> Vec<Epic> {
        use std::collections::BTreeMap;
        let mut by_id: BTreeMap<String, Epic> = BTreeMap::new();
        let mut seen: std::collections::HashSet<&str> = std::collections::HashSet::new();
        // Stable: items sorted by slug.
        let mut order: Vec<usize> = (0..self.items.len()).collect();
        order.sort_by(|&a, &b| self.items[a].slug.cmp(&self.items[b].slug));
        for idx in order {
            let it = &self.items[idx];
            if !seen.insert(it.slug.as_str()) {
                continue; // duplicate slug collapses
            }
            let (id, title) = match &it.adr {
                Some(n) => (format!("adr-{n}"), format!("ADR-{n}")),
                None => ("unsorted".to_string(), "Unsorted".to_string()),
            };
            by_id
                .entry(id.clone())
                .or_insert_with(|| Epic {
                    id,
                    title,
                    tasks: Vec::new(),
                })
                .tasks
                .push(idx);
        }
        // BTreeMap iterates id-sorted; pull `unsorted` to the end.
        let mut epics: Vec<Epic> = by_id.into_values().collect();
        epics.sort_by(|a, b| match (a.id == "unsorted", b.id == "unsorted") {
            (true, false) => std::cmp::Ordering::Greater,
            (false, true) => std::cmp::Ordering::Less,
            _ => a.id.cmp(&b.id),
        });
        epics
    }

    fn duplicate_slugs(&self) -> Vec<String> {
        use std::collections::BTreeMap;
        let mut counts: BTreeMap<&str, usize> = BTreeMap::new();
        for it in &self.items {
            *counts.entry(it.slug.as_str()).or_insert(0) += 1;
        }
        counts
            .into_iter()
            .filter(|(_, n)| *n > 1)
            .map(|(s, n)| format!("{s} ×{n}"))
            .collect()
    }

    fn harbor_split(&self) -> Vec<(String, usize)> {
        use std::collections::BTreeMap;
        let mut counts: BTreeMap<String, usize> = BTreeMap::new();
        for it in &self.items {
            *counts.entry(it.harbor.clone()).or_insert(0) += 1;
        }
        let mut v: Vec<_> = counts.into_iter().collect();
        v.sort_by(|a, b| b.1.cmp(&a.1));
        v
    }

    /// Critical-path schedule over the remaining (not-done) work.
    ///
    /// Why forward-looking only: the Gantt answers "what is the plan from here" —
    /// finished items are history, so they contribute no bars and any dependency
    /// on a done item is treated as already satisfied (the edge is dropped).
    /// Dedupes by slug (first occurrence wins, matching `epics()`), defaults an
    /// unsized item to one effort unit so every task earns visible geometry, and
    /// drops edges pointing outside the node set because the kernel scheduler
    /// deliberately fails closed on unknown ids.
    ///
    /// Returns the CPM rows sorted for display (earliest start, critical first,
    /// then slug) plus the makespan, or the scheduler's refusal reason (e.g. a
    /// dependency cycle) so the pane can report it instead of hiding it.
    fn gantt(&self) -> Result<(Vec<GanttRow>, i64), String> {
        let mut seen: std::collections::HashSet<&str> = std::collections::HashSet::new();
        let mut nodes: Vec<SchedNode> = Vec::new();
        let mut est_by_slug: std::collections::HashMap<&str, i64> =
            std::collections::HashMap::new();
        for it in &self.items {
            if it.status == "done" || !seen.insert(it.slug.as_str()) {
                continue;
            }
            let est = it.estimate.unwrap_or(1).max(1);
            est_by_slug.insert(it.slug.as_str(), est);
            nodes.push(SchedNode {
                id: it.slug.clone(),
                estimate: Some(est),
            });
        }
        if nodes.is_empty() {
            return Ok((Vec::new(), 0));
        }
        let ids: std::collections::HashSet<&str> =
            nodes.iter().map(|n| n.id.as_str()).collect();
        let mut edges: Vec<SchedEdge> = Vec::new();
        let mut edge_seen: std::collections::HashSet<(String, String)> =
            std::collections::HashSet::new();
        for it in &self.items {
            if it.status == "done" || !ids.contains(it.slug.as_str()) {
                continue;
            }
            for dep in &it.deps {
                if ids.contains(dep.as_str())
                    && dep != &it.slug
                    && edge_seen.insert((dep.clone(), it.slug.clone()))
                {
                    edges.push(SchedEdge {
                        from: dep.clone(),
                        to: it.slug.clone(),
                    });
                }
            }
        }
        let sched = schedule(&nodes, &edges);
        if !sched.ok {
            return Err(sched.reason);
        }
        let mut rows: Vec<GanttRow> = sched
            .nodes
            .iter()
            .map(|n| GanttRow {
                slug: n.id.clone(),
                start: n.earliest_start,
                finish: n.earliest_finish,
                critical: n.critical,
                slack: n.slack,
                estimate: *est_by_slug.get(n.id.as_str()).unwrap_or(&1),
            })
            .collect();
        rows.sort_by(|a, b| {
            a.start
                .cmp(&b.start)
                .then(b.critical.cmp(&a.critical))
                .then(a.slug.cmp(&b.slug))
        });
        Ok((rows, sched.makespan))
    }

    /// Render the Gantt section: one bar row per remaining task, critical path
    /// in solid fill, everything else hatched, capped so the pane's first screen
    /// stays a chart rather than a scroll. The design intent is that this is the
    /// FIRST thing an operator sees on launch (mux default workspace), so the
    /// section leads with the makespan/critical-path summary the chart answers.
    fn gantt_blocks(&self) -> Vec<Block> {
        const BAR_CELLS: i64 = 40;
        const MAX_ROWS: usize = 24;
        let mut blocks = Vec::new();
        match self.gantt() {
            Err(reason) => {
                blocks.push(Block::Header("Gantt — critical path".into()));
                blocks.push(Block::Chip {
                    label: format!("schedule unavailable: {}", trunc(&reason, 70)),
                    tone: Tone::Conflicted,
                });
            }
            Ok((rows, _)) if rows.is_empty() => {
                blocks.push(Block::Header("Gantt — critical path".into()));
                blocks.push(Block::KeyVal(
                    "status".into(),
                    "no remaining work to schedule".into(),
                ));
            }
            Ok((rows, makespan)) => {
                let crit_n = rows.iter().filter(|r| r.critical).count();
                blocks.push(Block::Header(format!(
                    "Gantt — critical path · {} task(s) · makespan {} unit(s)",
                    rows.len(),
                    makespan
                )));
                blocks.push(Block::Chip {
                    label: format!("{crit_n} on the critical path"),
                    tone: if crit_n > 0 {
                        Tone::Engaged
                    } else {
                        Tone::Resting
                    },
                });
                let span = makespan.max(1);
                for r in rows.iter().take(MAX_ROWS) {
                    let lead = (r.start * BAR_CELLS / span) as usize;
                    let fill = (((r.finish - r.start) * BAR_CELLS + span - 1) / span).max(1) as usize;
                    let glyph = if r.critical { '█' } else { '▓' };
                    let bar = format!(
                        "{}{}",
                        " ".repeat(lead),
                        glyph.to_string().repeat(fill)
                    );
                    let claim = self
                        .claims
                        .get(&r.slug)
                        .map(|by| format!(" ◆ {}", trunc(by, 18)))
                        .unwrap_or_default();
                    let meta = if r.critical {
                        format!("e{} CRIT{}", r.estimate, claim)
                    } else {
                        format!("e{} s{}{}", r.estimate, r.slack, claim)
                    };
                    blocks.push(Block::Row(vec![trunc(&r.slug, 30), bar, meta]));
                }
                if rows.len() > MAX_ROWS {
                    blocks.push(Block::KeyVal(
                        "…".into(),
                        format!("+{} more scheduled task(s)", rows.len() - MAX_ROWS),
                    ));
                }
            }
        }
        blocks
    }
}

/// One bar of the Planner Gantt: a task's CPM window plus the fields the
/// operator reads off the chart (estimate, slack, critical membership).
#[derive(Debug)]
struct GanttRow {
    slug: String,
    start: i64,
    finish: i64,
    critical: bool,
    slack: i64,
    estimate: i64,
}

impl Pane for PlannerPane {
    fn id(&self) -> &str {
        "planner"
    }
    fn title(&self) -> String {
        "Planner".into()
    }

    fn view(&self) -> Vec<Block> {
        let mut blocks = vec![Block::Header("Planner".into())];

        if let Some(err) = &self.last_error {
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            return blocks;
        }
        if self.items.is_empty() {
            blocks.push(Block::KeyVal("status".into(), "no roadmap items".into()));
            return blocks;
        }

        // The Gantt leads — the console's first screen answers "what is the
        // plan and where is the critical path" before any tree or roster.
        blocks.extend(self.gantt_blocks());
        blocks.push(Block::Gap);

        let epics = self.epics();
        let task_total: usize = epics.iter().map(|e| e.tasks.len()).sum();
        let now_n = self.items.iter().filter(|i| i.status == "now").count();

        blocks.push(Block::KeyVal("epics".into(), epics.len().to_string()));
        blocks.push(Block::KeyVal("tasks".into(), task_total.to_string()));
        blocks.push(Block::Chip {
            label: format!("{now_n} now · {task_total} tasks · {} epics", epics.len()),
            tone: if now_n > 0 {
                Tone::Engaged
            } else {
                Tone::Resting
            },
        });
        // Who's working on what: tasks under an active claim + distinct claimers.
        let claimed_n = self
            .items
            .iter()
            .filter(|i| self.claims.contains_key(&i.slug))
            .count();
        if claimed_n > 0 {
            let agents: std::collections::HashSet<&String> = self.claims.values().collect();
            blocks.push(Block::Chip {
                label: format!("{claimed_n} claimed · {} agent(s) working", agents.len()),
                tone: Tone::Engaged,
            });
        }

        // Flags banner (reported, never auto-fixed — mirrors the HTML board).
        let dups = self.duplicate_slugs();
        let harbors = self.harbor_split();
        let unsorted = epics
            .iter()
            .find(|e| e.id == "unsorted")
            .map(|e| e.tasks.len())
            .unwrap_or(0);
        if !dups.is_empty() || harbors.len() > 1 || unsorted > 0 {
            blocks.push(Block::Gap);
            blocks.push(Block::Header("flagged — not auto-fixed".into()));
            if !dups.is_empty() {
                blocks.push(Block::Chip {
                    label: format!("{} duplicate slug(s): {}", dups.len(), dups.join(", ")),
                    tone: Tone::Conflicted,
                });
            }
            if harbors.len() > 1 {
                let txt = harbors
                    .iter()
                    .map(|(h, n)| format!("{h} ({n})"))
                    .collect::<Vec<_>>()
                    .join(", ");
                blocks.push(Block::Chip {
                    label: format!("harbor split: {txt}"),
                    tone: Tone::Gated,
                });
            }
            if unsorted > 0 {
                blocks.push(Block::Chip {
                    label: format!("{unsorted} unsorted (no ADR)"),
                    tone: Tone::Gated,
                });
            }
        }

        // Fleet — who's working on what: the live agents and their real purposes
        // (GET /agents). This answers "what agents are working on what" directly.
        if !self.agents.is_empty() {
            blocks.push(Block::Gap);
            blocks.push(Block::Header(format!(
                "fleet — {} agent(s) working",
                self.agents.len()
            )));
            for (identity, purpose, status) in self.agents.iter().take(12) {
                blocks.push(Block::Row(vec![trunc(identity, 34), trunc(purpose, 46)]));
                blocks.push(Block::Chip {
                    label: status.clone(),
                    tone: status_tone(status),
                });
            }
            if self.agents.len() > 12 {
                blocks.push(Block::KeyVal(
                    "…".into(),
                    format!("+{} more agents", self.agents.len() - 12),
                ));
            }
        }

        // The tree: epic header, then a row per task with status + priority + deps.
        for epic in &epics {
            blocks.push(Block::Gap);
            blocks.push(Block::Header(format!(
                "{} · {} task(s)",
                epic.title,
                epic.tasks.len()
            )));
            for &idx in &epic.tasks {
                let it = &self.items[idx];
                let p = priority_for_status(&it.status);
                let dep_note = if it.deps.is_empty() {
                    String::new()
                } else {
                    format!("⛓{}", it.deps.len())
                };
                let claimed = self.claims.get(&it.slug);
                let claim_col = claimed
                    .map(|b| format!("◆ {}", trunc(b, 24)))
                    .unwrap_or_default();
                blocks.push(Block::Row(vec![
                    trunc(&it.slug, 38),
                    it.status.clone(),
                    format!("P{p}"),
                    dep_note,
                    claim_col,
                ]));
                // Status chip; and when an agent holds the live claim, surface it
                // (the "who's working on this task" axis) in the Engaged tone.
                if let Some(by) = claimed {
                    blocks.push(Block::Chip {
                        label: format!("working: {}", trunc(by, 30)),
                        tone: Tone::Engaged,
                    });
                } else {
                    blocks.push(Block::Chip {
                        label: it.status.clone(),
                        tone: status_tone(&it.status),
                    });
                }
            }
        }
        blocks
    }

    fn refresh<'a>(
        &'a mut self,
        daemon: &'a DaemonClient,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            let url = format!("{}/roadmap/items?status=all&limit=2000", daemon.base());
            match daemon.http_client().get(&url).send().await {
                Err(e) => {
                    self.last_error = Some(format!("daemon unreachable: {e}"));
                    self.items.clear();
                }
                Ok(resp) => match resp.json::<Value>().await {
                    Err(e) => self.last_error = Some(format!("bad response: {e}")),
                    Ok(data) => {
                        self.last_error = None;
                        self.items = arr(&data, "items")
                            .iter()
                            .map(PlannerItem::from_value)
                            .collect();
                        // Who's working on what: active roadmap claims (releasedAt null).
                        self.claims.clear();
                        let curl = format!("{}/cartographer/roadmap-claims", daemon.base());
                        if let Ok(cr) = daemon.http_client().get(&curl).send().await {
                            if let Ok(cv) = cr.json::<Value>().await {
                                for c in arr(&cv, "claims") {
                                    let active =
                                        matches!(c.get("releasedAt"), None | Some(Value::Null));
                                    let slug = s(c, "slug");
                                    let by = s(c, "claimedBy");
                                    if active && !slug.is_empty() && !by.is_empty() {
                                        self.claims.insert(slug, by);
                                    }
                                }
                            }
                        }
                        // The live fleet — who's working on what (each agent's purpose).
                        self.agents.clear();
                        let aurl = format!("{}/agents", daemon.base());
                        if let Ok(ar) = daemon.http_client().get(&aurl).send().await {
                            if let Ok(av) = ar.json::<Value>().await {
                                for a in arr(&av, "agents") {
                                    let identity = s(a, "identity");
                                    if !identity.is_empty() {
                                        self.agents.push((
                                            identity,
                                            s(a, "purpose"),
                                            s(a, "status"),
                                        ));
                                    }
                                }
                            }
                        }
                    }
                },
            }
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn item(slug: &str, status: &str, summary: &str) -> PlannerItem {
        PlannerItem::from_value(&json!({
            "slug": slug, "status": status, "summaryMd": summary,
            "dependencies": [], "harbor": "port-daddy", "notes": []
        }))
    }

    #[test]
    fn adr_from_slug() {
        assert_eq!(
            adr_number_of("adr-0048-phase-0-ratify", "", ""),
            Some("0048".into())
        );
        assert_eq!(adr_number_of("adr-50-phase-1", "", ""), Some("0050".into()));
    }

    #[test]
    fn adr_from_summary_token() {
        assert_eq!(
            adr_number_of("planner-scheduler-kernel", "ADR-0086 Phase 1a", ""),
            Some("0086".into())
        );
        assert_eq!(
            adr_number_of("x", "", "adr:0043 phase 1"),
            Some("0043".into())
        );
    }

    #[test]
    fn adr_none_when_absent() {
        assert_eq!(
            adr_number_of("mcp-parity-no-copouts", "no identifier here", ""),
            None
        );
    }

    #[test]
    fn priority_mapping() {
        assert_eq!(priority_for_status("now"), 2);
        assert_eq!(priority_for_status("backlog"), 3);
        assert_eq!(priority_for_status("done"), 5);
    }

    #[test]
    fn view_empty() {
        let p = PlannerPane::default();
        let b = p.view();
        assert!(matches!(&b[0], Block::Header(h) if h == "Planner"));
        assert!(b
            .iter()
            .any(|blk| matches!(blk, Block::KeyVal(k, _) if k == "status")));
    }

    #[test]
    fn view_error_state() {
        let mut p = PlannerPane::default();
        p.last_error = Some("conn refused".into());
        let b = p.view();
        assert!(b
            .iter()
            .any(|blk| matches!(blk, Block::KeyVal(k, _) if k == "error")));
    }

    #[test]
    fn view_groups_into_adr_epics() {
        let mut p = PlannerPane::default();
        p.items = vec![
            item("adr-0048-phase-0-ratify", "now", "ratify"),
            item("adr-0048-phase-1-proto", "now", "protocol"),
            item(
                "planner-scheduler-kernel",
                "now",
                "ADR-0086 Phase 1a kernel",
            ),
            item("a-loose-idea", "backlog", "no adr token"),
        ];
        let epics = p.epics();
        let ids: Vec<&str> = epics.iter().map(|e| e.id.as_str()).collect();
        assert!(ids.contains(&"adr-0048"));
        assert!(ids.contains(&"adr-0086"));
        assert_eq!(ids.last(), Some(&"unsorted")); // unsorted sorts last
                                                   // ADR-0048 epic has both its phases.
        let e48 = epics.iter().find(|e| e.id == "adr-0048").unwrap();
        assert_eq!(e48.tasks.len(), 2);
    }

    #[test]
    fn duplicate_slug_collapses_and_is_flagged() {
        let mut p = PlannerPane::default();
        p.items = vec![
            item("dup", "now", "a"),
            item("dup", "now", "b"),
            item("adr-0048-phase-0", "now", "x"),
        ];
        // collapse: dup appears once across all epics' tasks
        let total: usize = p.epics().iter().map(|e| e.tasks.len()).sum();
        assert_eq!(total, 2);
        assert_eq!(p.duplicate_slugs(), vec!["dup ×2".to_string()]);
    }

    #[test]
    fn view_annotates_claimed_tasks_with_working_agent() {
        let mut p = PlannerPane::default();
        p.items = vec![
            item("adr-0048-phase-0", "now", "x"),
            item("adr-0048-phase-1", "now", "y"),
        ];
        p.claims
            .insert("adr-0048-phase-0".into(), "agent-foo".into());
        let b = p.view();
        // the claimed task shows its working agent
        assert!(b.iter().any(
            |blk| matches!(blk, Block::Chip { label, .. } if label.contains("working: agent-foo"))
        ));
        // and a summary chip reports how many agents are working
        assert!(b.iter().any(
            |blk| matches!(blk, Block::Chip { label, .. } if label.contains("agent(s) working"))
        ));
        // an unclaimed task keeps a plain status chip (no working: prefix)
        let working_chips = b
            .iter()
            .filter(|blk| matches!(blk, Block::Chip { label, .. } if label.starts_with("working:")))
            .count();
        assert_eq!(working_chips, 1);
    }

    fn item_with(slug: &str, status: &str, deps: &[&str], estimate: Option<i64>) -> PlannerItem {
        PlannerItem::from_value(&json!({
            "slug": slug, "status": status, "summaryMd": slug,
            "dependencies": deps, "harbor": "port-daddy", "notes": [],
            "estimate": estimate,
        }))
    }

    #[test]
    fn gantt_chains_dependencies_and_marks_critical_path() {
        let mut p = PlannerPane::default();
        p.items = vec![
            item_with("a", "now", &[], Some(2)),
            item_with("b", "backlog", &["a"], Some(3)),
            item_with("c", "backlog", &[], Some(1)),
        ];
        let (rows, makespan) = p.gantt().expect("schedules");
        assert_eq!(makespan, 5); // a(2) then b(3) is the critical chain
        let b = rows.iter().find(|r| r.slug == "b").unwrap();
        assert_eq!(b.start, 2);
        assert_eq!(b.finish, 5);
        assert!(b.critical);
        let c = rows.iter().find(|r| r.slug == "c").unwrap();
        assert!(!c.critical);
        assert_eq!(c.slack, 4);
    }

    #[test]
    fn gantt_excludes_done_items_and_their_edges() {
        let mut p = PlannerPane::default();
        p.items = vec![
            item_with("shipped", "done", &[], Some(9)),
            item_with("next", "now", &["shipped"], Some(1)),
        ];
        let (rows, makespan) = p.gantt().expect("schedules");
        assert_eq!(rows.len(), 1); // done work casts no bar
        assert_eq!(rows[0].slug, "next");
        assert_eq!(rows[0].start, 0); // satisfied dep imposes no offset
        assert_eq!(makespan, 1);
    }

    #[test]
    fn gantt_defaults_unsized_items_to_one_unit() {
        let mut p = PlannerPane::default();
        p.items = vec![item("unsized", "backlog", "no estimate")];
        let (rows, makespan) = p.gantt().expect("schedules");
        assert_eq!(rows[0].estimate, 1);
        assert_eq!(makespan, 1);
    }

    #[test]
    fn gantt_reports_cycles_instead_of_hiding_them() {
        let mut p = PlannerPane::default();
        p.items = vec![
            item_with("x", "now", &["y"], Some(1)),
            item_with("y", "now", &["x"], Some(1)),
        ];
        let err = p.gantt().expect_err("cycle must fail closed");
        assert!(err.contains("cycle"), "reason should name the cycle: {err}");
        let blocks = p.gantt_blocks();
        assert!(blocks.iter().any(
            |b| matches!(b, Block::Chip { label, .. } if label.contains("schedule unavailable"))
        ));
    }

    #[test]
    fn gantt_reports_multi_node_cycles() {
        // A → B → C → A: the kernel scheduler must refuse the whole schedule,
        // not silently drop an edge.
        let mut p = PlannerPane::default();
        p.items = vec![
            item_with("a", "now", &["c"], Some(1)),
            item_with("b", "now", &["a"], Some(1)),
            item_with("c", "now", &["b"], Some(1)),
        ];
        let err = p.gantt().expect_err("3-node cycle must fail closed");
        assert!(err.contains("cycle"), "reason should name the cycle: {err}");
    }

    #[test]
    fn gantt_clamps_explicit_zero_estimates_to_one_unit() {
        // estimate: 0 is "unsized", not "instant" — the parser drops it and the
        // Gantt sizes the bar at one unit so the task stays visible.
        let mut p = PlannerPane::default();
        p.items = vec![item_with("zero", "now", &[], Some(0))];
        let (rows, makespan) = p.gantt().expect("schedules");
        assert_eq!(rows[0].estimate, 1);
        assert_eq!(makespan, 1);
    }

    #[test]
    fn gantt_bars_stay_inside_the_cell_budget_and_slugs_truncate() {
        // One giant estimate must not overflow the 40-cell bar lane, and a slug
        // longer than the label column truncates instead of shoving the bar.
        let long = "a-very-long-roadmap-slug-that-exceeds-thirty-characters-easily";
        let mut p = PlannerPane::default();
        p.items = vec![
            item_with(long, "now", &[], Some(500)),
            item_with("tiny", "now", &[], Some(1)),
        ];
        let blocks = p.gantt_blocks();
        for b in &blocks {
            if let Block::Row(cols) = b {
                assert_eq!(cols.len(), 3);
                assert!(
                    cols[0].chars().count() <= 31, // 30 label chars + the ellipsis
                    "label column must truncate: {}",
                    cols[0]
                );
                assert!(
                    cols[1].chars().count() <= 41,
                    "bar must stay inside the 40-cell lane (+rounding): {} cells",
                    cols[1].chars().count()
                );
            }
        }
    }

    #[test]
    fn view_leads_with_the_gantt_section() {
        let mut p = PlannerPane::default();
        p.items = vec![
            item_with("a", "now", &[], Some(2)),
            item_with("b", "backlog", &["a"], Some(3)),
        ];
        let blocks = p.view();
        // Block 0 is the pane header; block 1 opens the Gantt — before any
        // epic tree or fleet roster (the chart is the first screen).
        assert!(matches!(&blocks[0], Block::Header(h) if h == "Planner"));
        assert!(
            matches!(&blocks[1], Block::Header(h) if h.starts_with("Gantt — critical path")),
            "gantt must lead the view, got {:?}",
            blocks[1]
        );
        // Bar rows render with critical fill for the critical chain.
        assert!(blocks
            .iter()
            .any(|b| matches!(b, Block::Row(c) if c.len() == 3 && c[1].contains('█'))));
    }

    #[test]
    fn view_shows_live_fleet_with_purposes() {
        let mut p = PlannerPane::default();
        p.items = vec![item("adr-0048-phase-0", "now", "x")];
        p.agents = vec![
            (
                "port-daddy:roadmap-delete".into(),
                "roadmap delete verb + harbor fix".into(),
                "ready".into(),
            ),
            (
                "port-daddy:release-3211".into(),
                "Cut 3.21.1".into(),
                "ready".into(),
            ),
        ];
        let b = p.view();
        assert!(b.iter().any(
            |blk| matches!(blk, Block::Header(h) if h.contains("fleet") && h.contains("2 agent"))
        ));
        assert!(b.iter().any(|blk| matches!(blk, Block::Row(c) if c.iter().any(|x| x.contains("roadmap delete verb")))));
    }
}
