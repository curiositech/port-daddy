//! Planner pane — the roadmap as a Jira-like hierarchy (ADR-0086), replacing the
//! flat Roadmap and ADR panes.
//!
//! Calls `GET /roadmap/items?limit=2000` and derives Project → Epic(per ADR) →
//! Task from the structured `adr-NNNN-phase-…` slug + `adr:NNNN` note/summary
//! token (IDs we control — not fuzzy NLP), exactly like `lib/planner-migrate.ts`.
//! Renders the tree + status/priority chips + a flags banner as render-agnostic
//! Blocks (GPUI/ratatui paint them; per the gpui-rust-console contract the text is
//! GPUI's, the bespoke critical-path Gantt is the Track-B Vello surface).
//!
//! Item shape (v3.2x): `{ slug, summaryMd, status, dependencies: [slug], harbor, notes:[{text}] }`.

use crate::agent::DaemonClient;
use crate::pane::{Block, Pane, Tone};
use crate::util::{arr, s, trunc};
use anyhow::Result;
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
        Self {
            slug,
            summary,
            status: s(v, "status"),
            deps,
            harbor: s(v, "harbor"),
            adr,
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
    let rest = slug.strip_prefix("adr-").or_else(|| slug.strip_prefix("adr"))?;
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
        let digits: String = lower[j..].chars().take_while(|c| c.is_ascii_digit()).collect();
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
    last_error: Option<String>,
}

impl Default for PlannerPane {
    fn default() -> Self {
        Self { items: Vec::new(), last_error: None }
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
                .or_insert_with(|| Epic { id, title, tasks: Vec::new() })
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

        let epics = self.epics();
        let task_total: usize = epics.iter().map(|e| e.tasks.len()).sum();
        let now_n = self.items.iter().filter(|i| i.status == "now").count();

        blocks.push(Block::KeyVal("epics".into(), epics.len().to_string()));
        blocks.push(Block::KeyVal("tasks".into(), task_total.to_string()));
        blocks.push(Block::Chip {
            label: format!("{now_n} now · {task_total} tasks · {} epics", epics.len()),
            tone: if now_n > 0 { Tone::Engaged } else { Tone::Resting },
        });

        // Flags banner (reported, never auto-fixed — mirrors the HTML board).
        let dups = self.duplicate_slugs();
        let harbors = self.harbor_split();
        let unsorted = epics.iter().find(|e| e.id == "unsorted").map(|e| e.tasks.len()).unwrap_or(0);
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
                let txt = harbors.iter().map(|(h, n)| format!("{h} ({n})")).collect::<Vec<_>>().join(", ");
                blocks.push(Block::Chip { label: format!("harbor split: {txt}"), tone: Tone::Gated });
            }
            if unsorted > 0 {
                blocks.push(Block::Chip { label: format!("{unsorted} unsorted (no ADR)"), tone: Tone::Gated });
            }
        }

        // The tree: epic header, then a row per task with status + priority + deps.
        for epic in &epics {
            blocks.push(Block::Gap);
            blocks.push(Block::Header(format!("{} · {} task(s)", epic.title, epic.tasks.len())));
            for &idx in &epic.tasks {
                let it = &self.items[idx];
                let p = priority_for_status(&it.status);
                let dep_note = if it.deps.is_empty() { String::new() } else { format!("⛓{}", it.deps.len()) };
                blocks.push(Block::Row(vec![
                    trunc(&it.slug, 40),
                    it.status.clone(),
                    format!("P{p}"),
                    dep_note,
                ]));
                blocks.push(Block::Chip { label: it.status.clone(), tone: status_tone(&it.status) });
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
                        self.items = arr(&data, "items").iter().map(PlannerItem::from_value).collect();
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
        assert_eq!(adr_number_of("adr-0048-phase-0-ratify", "", ""), Some("0048".into()));
        assert_eq!(adr_number_of("adr-50-phase-1", "", ""), Some("0050".into()));
    }

    #[test]
    fn adr_from_summary_token() {
        assert_eq!(adr_number_of("planner-scheduler-kernel", "ADR-0086 Phase 1a", ""), Some("0086".into()));
        assert_eq!(adr_number_of("x", "", "adr:0043 phase 1"), Some("0043".into()));
    }

    #[test]
    fn adr_none_when_absent() {
        assert_eq!(adr_number_of("mcp-parity-no-copouts", "no identifier here", ""), None);
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
        assert!(b.iter().any(|blk| matches!(blk, Block::KeyVal(k, _) if k == "status")));
    }

    #[test]
    fn view_error_state() {
        let mut p = PlannerPane::default();
        p.last_error = Some("conn refused".into());
        let b = p.view();
        assert!(b.iter().any(|blk| matches!(blk, Block::KeyVal(k, _) if k == "error")));
    }

    #[test]
    fn view_groups_into_adr_epics() {
        let mut p = PlannerPane::default();
        p.items = vec![
            item("adr-0048-phase-0-ratify", "now", "ratify"),
            item("adr-0048-phase-1-proto", "now", "protocol"),
            item("planner-scheduler-kernel", "now", "ADR-0086 Phase 1a kernel"),
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
}
