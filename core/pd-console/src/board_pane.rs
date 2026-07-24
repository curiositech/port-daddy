//! Board pane — a clickable, status-column roadmap board (Jira-style "Board" tab),
//! sitting alongside Planner's tree view. Same data (`GET /roadmap/items?status=all`),
//! different projection: each item is a selectable [`Block::NodeRow`] "card" grouped
//! by status, with a detail panel for the selected card (master/detail, mirrors
//! `harbor_pane.rs`'s roster+detail conjoined pattern).
//!
//! Deliberately does NOT fabricate fields the data model doesn't have yet (owning
//! agent / PR / doc / skill / session links) — those need real cross-entity storage
//! first (see the roadmap-tool design doc). This pane only surfaces what
//! `roadmap_items` + `/cartographer/roadmap-claims` actually provide today.

use crate::agent::DaemonClient;
use crate::pane::{Block, Pane, SurfaceAction, Tone};
use crate::util::{arr, s, trunc};
use anyhow::Result;
use serde_json::Value;

#[derive(Debug, Clone)]
struct BoardItem {
    slug: String,
    summary: String,
    status: String,
    harbor: String,
    deps: Vec<String>,
}

impl BoardItem {
    fn from_value(v: &Value) -> Self {
        Self {
            slug: s(v, "slug"),
            summary: s(v, "summaryMd"),
            status: s(v, "status"),
            harbor: s(v, "harbor"),
            deps: arr(v, "dependencies")
                .iter()
                .filter_map(|d| d.as_str().map(|x| x.to_string()))
                .collect(),
        }
    }
}

/// Board columns, left to right — a subset/reordering of Planner's flat status
/// list into the classic Jira "todo / doing / done" swim-lane shape.
const COLUMNS: &[(&str, &[&str])] = &[
    ("backlog", &["backlog", "parked"]),
    ("now", &["now"]),
    ("merge", &["merge"]),
    ("done", &["done"]),
];

fn column_for(status: &str) -> &'static str {
    for (col, members) in COLUMNS {
        if members.contains(&status) {
            return col;
        }
    }
    "backlog"
}

fn status_flag_letter(status: &str) -> char {
    match status {
        "now" => 'N', // Foxtrot-equivalent "in progress" — kept alphabetic+mnemonic
        "merge" => 'M',
        "done" => 'D',
        "parked" | "rejected" => 'X',
        _ => 'B', // backlog
    }
}

fn status_tone(status: &str) -> Tone {
    match status {
        "done" | "merge" | "shipped" | "landed" => Tone::Landed,
        "now" | "in-progress" | "active" => Tone::Engaged,
        "blocked" | "rejected" | "parked" | "deferred" => Tone::Gated,
        _ => Tone::Resting,
    }
}

fn priority_for_status(status: &str) -> u8 {
    match status {
        "now" | "merge" => 2,
        "backlog" => 3,
        "parked" => 4,
        "done" => 5,
        _ => 3,
    }
}

pub struct BoardPane {
    items: Vec<BoardItem>,
    /// slug → who currently holds the live roadmap-pop claim.
    claims: std::collections::HashMap<String, String>,
    /// Index into `items` of the selected card, if any.
    selected: Option<usize>,
    last_error: Option<String>,
}

impl Default for BoardPane {
    fn default() -> Self {
        Self {
            items: Vec::new(),
            claims: std::collections::HashMap::new(),
            selected: None,
            last_error: None,
        }
    }
}

impl BoardPane {
    pub fn new() -> Self {
        Self::default()
    }

    fn card_block(&self, idx: usize) -> Block {
        let it = &self.items[idx];
        let claimed = self.claims.get(&it.slug);
        let p = priority_for_status(&it.status);
        let mut meta_parts: Vec<String> = vec![format!("P{p}"), it.harbor.clone()];
        if !it.deps.is_empty() {
            meta_parts.push(format!("⛓{}", it.deps.len()));
        }
        Block::NodeRow {
            index: idx,
            selected: self.selected == Some(idx),
            live: claimed.is_some(),
            flag: status_flag_letter(&it.status),
            name: trunc(&it.slug, 40),
            badge: claimed
                .map(|by| trunc(by, 20))
                .unwrap_or_else(|| it.status.clone()),
            badge_tone: if claimed.is_some() {
                Tone::Engaged
            } else {
                status_tone(&it.status)
            },
            meta: meta_parts.join(" · "),
            age: "—".into(),
            tone: status_tone(&it.status),
        }
    }

    fn detail_blocks(&self, idx: usize) -> Vec<Block> {
        let it = &self.items[idx];
        let mut blocks = vec![Block::Header(format!("{} — {}", it.slug, it.status))];
        blocks.push(Block::KeyVal("harbor".into(), it.harbor.clone()));
        blocks.push(Block::KeyVal(
            "priority".into(),
            format!("P{}", priority_for_status(&it.status)),
        ));
        if let Some(by) = self.claims.get(&it.slug) {
            blocks.push(Block::KeyVal("claimed by".into(), by.clone()));
        }
        if !it.deps.is_empty() {
            blocks.push(Block::KeyVal("depends on".into(), it.deps.join(", ")));
        }
        if !it.summary.trim().is_empty() {
            blocks.push(Block::Gap);
            blocks.push(Block::WrappedText {
                text: it.summary.clone(),
                tone: Tone::Default,
            });
        }
        // Honest placeholder — no fabricated links. The design doc's data-model
        // phase is what turns this into real Block::ArtifactRef rows once
        // roadmap_items gains agent/PR/doc/skill/session junction data. A long
        // label doesn't fit KeyVal's fixed 150px key column (app.rs render_block)
        // — real overflow in the on-screen product, not just this raster preview
        // — so this goes in WrappedText instead, which the renderer wraps in full.
        blocks.push(Block::Gap);
        blocks.push(Block::WrappedText {
            text: "Links to owning agent / PR / docs / skills / sessions: not yet wired — see roadmap-tool design doc, Phase 2.".into(),
            tone: Tone::Resting,
        });
        blocks
    }
}

/// Shared seed data for the two offscreen visual-proof entrypoints below — the
/// same six cards either project renders, so a "list → detail" capture pair
/// shows a genuine before/after of the one real interaction (`selected`
/// toggling on a card click), not two unrelated snapshots.
#[cfg(feature = "gpui")]
fn seeded_board_pane() -> BoardPane {
    let mut p = BoardPane::new();
    p.items = vec![
        BoardItem { slug: "adr-0086-phase-1-planner-schema".into(), summary: "Add kind/priority/estimate columns to roadmap_items.".into(), status: "done".into(), harbor: "port-daddy".into(), deps: vec![] },
        BoardItem { slug: "board-pane-jira-columns".into(), summary: "Clickable status-column board view in pd-console.".into(), status: "now".into(), harbor: "port-daddy".into(), deps: vec!["adr-0086-phase-1-planner-schema".into()] },
        BoardItem { slug: "roadmap-dedup-cleanup".into(), summary: "Merge 77 duplicate slugs across harbors; fix import-markdown canonicalization.".into(), status: "now".into(), harbor: "port-daddy".into(), deps: vec![] },
        BoardItem { slug: "roadmap-search-embeddings".into(), summary: "Extend the shared MiniLM+BM25 hybrid search to roadmap items.".into(), status: "backlog".into(), harbor: "port-daddy".into(), deps: vec!["board-pane-jira-columns".into()] },
        BoardItem { slug: "task-detail-cross-links".into(), summary: "Link tasks to owning agent/PR/docs/skills/sessions.".into(), status: "backlog".into(), harbor: "port-daddy".into(), deps: vec!["board-pane-jira-columns".into()] },
        BoardItem { slug: "gantt-real-estimates".into(), summary: "Wire roadmap_items.estimate into the Gantt scheduler.".into(), status: "merge".into(), harbor: "port-daddy".into(), deps: vec![] },
    ];
    p.claims.insert("roadmap-dedup-cleanup".into(), "agent-dedup-cleanup-9f2a".into());
    p
}

/// Deterministic seeded blocks for offscreen visual proof (`--headless-capture-board`)
/// — no daemon round-trip, so capture runs from any agent shell in seconds.
/// Mirrors real API shapes exactly (same fields `BoardItem::from_value` reads).
/// Detail panel open (card 1 selected) — the "after a click" half of the pair.
#[cfg(feature = "gpui")]
pub fn sample_board_blocks() -> Vec<Block> {
    let mut p = seeded_board_pane();
    p.selected = Some(1);
    p.view()
}

/// Same seed, no card selected — the "before a click" half of the pair, used by
/// `--headless-capture-board-list` alongside [`sample_board_blocks`] to produce
/// a genuine two-frame list→detail capture (real rendered pixels, not fabricated
/// motion) for PR visual-artifact evidence.
#[cfg(feature = "gpui")]
pub fn sample_board_blocks_list_only() -> Vec<Block> {
    let p = seeded_board_pane();
    p.view()
}

impl Pane for BoardPane {
    fn id(&self) -> &str {
        "board"
    }
    fn title(&self) -> String {
        "Board".into()
    }

    fn view(&self) -> Vec<Block> {
        let mut blocks = vec![Block::Header("Board".into())];

        if let Some(err) = &self.last_error {
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            return blocks;
        }
        if self.items.is_empty() {
            blocks.push(Block::KeyVal("status".into(), "no roadmap items".into()));
            return blocks;
        }

        let total = self.items.len();
        let claimed_n = self
            .items
            .iter()
            .filter(|i| self.claims.contains_key(&i.slug))
            .count();
        blocks.push(Block::Chip {
            label: format!("{total} item(s) · {claimed_n} claimed"),
            tone: if claimed_n > 0 { Tone::Engaged } else { Tone::Resting },
        });

        // One header + one card per column, in swim-lane order — a real board
        // shape using the render-agnostic Block vocabulary we have today
        // (Block::Columns for true side-by-side lanes is a follow-up primitive;
        // stacked column sections are the honest interim shape both GPUI and
        // ratatui already know how to paint).
        for (col, _) in COLUMNS {
            let idxs: Vec<usize> = (0..self.items.len())
                .filter(|&i| column_for(&self.items[i].status) == *col)
                .collect();
            if idxs.is_empty() {
                continue;
            }
            blocks.push(Block::Gap);
            blocks.push(Block::Header(format!("{} · {} card(s)", col, idxs.len())));
            for i in idxs {
                blocks.push(self.card_block(i));
            }
        }

        // Detail panel for the selected card, if any.
        if let Some(idx) = self.selected {
            if idx < self.items.len() {
                blocks.push(Block::Gap);
                blocks.push(Block::Header("— selected —".into()));
                blocks.extend(self.detail_blocks(idx));
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
                        self.items = arr(&data, "items").iter().map(BoardItem::from_value).collect();
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
                        if let Some(idx) = self.selected {
                            if idx >= self.items.len() {
                                self.selected = None;
                            }
                        }
                    }
                },
            }
            Ok(())
        })
    }

    fn mutate<'a>(
        &'a mut self,
        _daemon: &'a DaemonClient,
        action: SurfaceAction,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            if let SurfaceAction::SelectRow { index } = action {
                if index < self.items.len() {
                    self.selected = if self.selected == Some(index) {
                        None // click again to deselect/close detail
                    } else {
                        Some(index)
                    };
                }
            }
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::util::block_on;
    use serde_json::json;

    fn item(slug: &str, status: &str) -> BoardItem {
        BoardItem::from_value(&json!({
            "slug": slug, "status": status, "summaryMd": "x",
            "harbor": "port-daddy", "dependencies": []
        }))
    }

    #[test]
    fn view_empty() {
        let p = BoardPane::default();
        let b = p.view();
        assert!(matches!(&b[0], Block::Header(h) if h == "Board"));
        assert!(b.iter().any(|blk| matches!(blk, Block::KeyVal(k, _) if k == "status")));
    }

    #[test]
    fn view_error_state() {
        let mut p = BoardPane::default();
        p.last_error = Some("conn refused".into());
        let b = p.view();
        assert!(b.iter().any(|blk| matches!(blk, Block::KeyVal(k, _) if k == "error")));
    }

    #[test]
    fn view_groups_into_columns() {
        let mut p = BoardPane::default();
        p.items = vec![
            item("a", "now"),
            item("b", "now"),
            item("c", "done"),
            item("d", "backlog"),
        ];
        let b = p.view();
        let now_header = b
            .iter()
            .any(|blk| matches!(blk, Block::Header(h) if h.starts_with("now · 2 card")));
        assert!(now_header);
        let cards = b.iter().filter(|blk| matches!(blk, Block::NodeRow { .. })).count();
        assert_eq!(cards, 4);
    }

    #[test]
    fn select_row_toggles_detail_panel() {
        let mut p = BoardPane::default();
        p.items = vec![item("a", "now")];
        let daemon = DaemonClient::new("http://127.0.0.1:1".into());
        block_on(p.mutate(&daemon, SurfaceAction::SelectRow { index: 0 })).unwrap();
        assert_eq!(p.selected, Some(0));
        let b = p.view();
        assert!(b.iter().any(|blk| matches!(blk, Block::Header(h) if h == "— selected —")));

        // clicking the same row again deselects
        block_on(p.mutate(&daemon, SurfaceAction::SelectRow { index: 0 })).unwrap();
        assert_eq!(p.selected, None);
    }

    #[test]
    fn claimed_card_shows_claimant_as_badge() {
        let mut p = BoardPane::default();
        p.items = vec![item("a", "now")];
        p.claims.insert("a".into(), "agent-foo".into());
        let b = p.view();
        assert!(b.iter().any(
            |blk| matches!(blk, Block::NodeRow { badge, live: true, .. } if badge == "agent-foo")
        ));
    }
}
