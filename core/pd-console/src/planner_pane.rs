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
//! notes:[{text}], estimate?, startedAt?, dueAt? }` — `estimate` is the
//! ADR-0086 planner column the daemon now serves; older daemons simply omit
//! it and bars default to one unit. `startedAt`/`dueAt` (epoch ms, from
//! `lib/roadmap-items.ts`) are the Gantt's wall-clock date anchors: when BOTH
//! are present and valid on an item, its bar is drawn at its real dates
//! instead of the CPM-relative offset (see `PlannerPane::gantt`'s
//! date-anchoring pass); missing either field leaves the item on the
//! relative schedule exactly as before this field pair was read.

use crate::agent::DaemonClient;
use crate::pane::{Block, LedgerCell, Pane, SurfaceAction, Tone};
use crate::roadmap_projection::{
    RoadmapOwnershipAgent, RoadmapOwnershipProjection, RoadmapProjection,
};
use crate::util::{arr, n, s, trunc};
use anyhow::Result;
use pd_anchor::schedule::{schedule, SchedEdge, SchedNode};
use serde_json::Value;
use std::cmp::Ordering;

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
    /// Actual start, epoch milliseconds — `lib/roadmap-items.ts`'s `startedAt`,
    /// documented there as "the Gantt's left date anchor when present". None
    /// when unset, non-numeric, or non-positive (`positiveOrNull` on the write
    /// path never persists 0/negative, so a non-positive read is treated the
    /// same as absent rather than trusted as a real date).
    started_at: Option<i64>,
    /// Target finish, epoch milliseconds — `dueAt`, "the Gantt's right date
    /// anchor when present". Same validity rule as `started_at`. Only when
    /// BOTH fields are present (and `due_at` lands after `started_at`) does
    /// `gantt()` switch that row's bar from the CPM-relative offset to real
    /// wall-clock geometry — see `gantt()`'s date-anchoring pass.
    due_at: Option<i64>,
    /// Typed, daemon-verified ownership state. Grand Harbor renders this fact;
    /// it never infers ownership from presence, a live body, or a roadmap
    /// claim held by an unadmitted chat session.
    ownership: RoadmapOwnershipProjection,
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
        let estimate = v
            .get("estimate")
            .and_then(|e| e.as_i64())
            .filter(|e| *e > 0);
        // startedAt/dueAt ride the wire as JSON numbers (epoch ms) or JSON
        // null — `lib/roadmap-items.ts` stores them as `number | null` and
        // spreads the raw row into the `GET /roadmap/items` response with no
        // re-encoding (confirmed in `routes/roadmap.ts`'s list handler), so
        // `.as_i64()` is the correct extraction with no string/ISO parsing.
        let started_at = v
            .get("startedAt")
            .and_then(|e| e.as_i64())
            .filter(|e| *e > 0);
        let due_at = v.get("dueAt").and_then(|e| e.as_i64()).filter(|e| *e > 0);
        Self {
            slug,
            summary,
            status: s(v, "status"),
            deps,
            harbor: s(v, "harbor"),
            adr,
            estimate,
            started_at,
            due_at,
            ownership: RoadmapOwnershipProjection::default(),
        }
    }
}

#[derive(Debug, Clone)]
struct JiraItem {
    id: String,
    key: String,
    url: String,
    summary: String,
    status: String,
    status_category: String,
    priority: String,
    assignee: String,
    issue_type: String,
    parent_key: String,
    labels: Vec<String>,
    created: String,
    updated: String,
    due_date: String,
}

impl JiraItem {
    fn from_value(v: &Value) -> Self {
        Self {
            id: s(v, "id"),
            key: s(v, "key"),
            url: s(v, "url"),
            summary: s(v, "summary"),
            status: s(v, "status"),
            status_category: s(v, "statusCategory"),
            priority: s(v, "priority"),
            assignee: s(v, "assignee"),
            issue_type: s(v, "issueType"),
            parent_key: s(v, "parentKey"),
            labels: arr(v, "labels")
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect(),
            created: s(v, "created"),
            updated: s(v, "updated"),
            due_date: s(v, "dueDate"),
        }
    }

    fn tone(&self) -> Tone {
        match self.status_category.to_ascii_lowercase().as_str() {
            "done" => Tone::Landed,
            "in progress" => Tone::Engaged,
            "blocked" => Tone::Conflicted,
            _ => Tone::Resting,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum JiraSort {
    Key,
    Summary,
    Status,
    Priority,
    Assignee,
    IssueType,
    Updated,
    Due,
}

impl JiraSort {
    fn key(self) -> &'static str {
        match self {
            Self::Key => "key",
            Self::Summary => "summary",
            Self::Status => "status",
            Self::Priority => "priority",
            Self::Assignee => "assignee",
            Self::IssueType => "type",
            Self::Updated => "updated",
            Self::Due => "due",
        }
    }

    fn parse(key: &str) -> Option<Self> {
        Some(match key {
            "key" => Self::Key,
            "summary" => Self::Summary,
            "status" => Self::Status,
            "priority" => Self::Priority,
            "assignee" => Self::Assignee,
            "type" => Self::IssueType,
            "updated" => Self::Updated,
            "due" => Self::Due,
            _ => return None,
        })
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

fn ownership_tone(state: &str) -> Tone {
    match state {
        "current" => Tone::Engaged,
        "transferred" => Tone::Landed,
        "stale" | "abandoned" => Tone::Gated,
        "inconsistent" => Tone::Conflicted,
        _ => Tone::Resting,
    }
}

fn ownership_agent_label(agent: &RoadmapOwnershipAgent) -> String {
    let alias = agent
        .display_name
        .as_deref()
        .or(agent.identity.as_deref())
        .unwrap_or(&agent.agent_node_id);
    if alias == agent.agent_node_id {
        alias.to_string()
    } else {
        format!("{alias} · {}", agent.agent_node_id)
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
    jira_items: Vec<JiraItem>,
    jira_loaded: bool,
    jira_configured: bool,
    jira_missing: Vec<String>,
    jira_error: Option<String>,
    jira_project_key: String,
    jira_base_url: String,
    jira_page_count: i64,
    jira_truncated: bool,
    selected_jira_key: Option<String>,
    jira_sort: JiraSort,
    jira_descending: bool,
    /// slug → who currently holds the live roadmap-pop claim, when present.
    /// From GET /cartographer/roadmap-claims (active = releasedAt null).
    claims: std::collections::HashMap<String, String>,
    /// The live fleet: (identity, purpose, status) per running agent, from
    /// GET /agents. This is the cockpit's "what agents are working on what" axis —
    /// each agent's `purpose` is the real task it was spawned on.
    agents: Vec<(String, String, String)>,
    /// Projection failures do not erase the roadmap, but they must remain
    /// visible: an absent ownership projection is unknown, never unassigned.
    ownership_projection_error: Option<String>,
    last_error: Option<String>,
}

impl Default for PlannerPane {
    fn default() -> Self {
        Self {
            items: Vec::new(),
            jira_items: Vec::new(),
            jira_loaded: false,
            jira_configured: false,
            jira_missing: Vec::new(),
            jira_error: None,
            jira_project_key: String::new(),
            jira_base_url: String::new(),
            jira_page_count: 0,
            jira_truncated: false,
            selected_jira_key: None,
            jira_sort: JiraSort::Updated,
            jira_descending: true,
            claims: std::collections::HashMap::new(),
            agents: Vec::new(),
            ownership_projection_error: None,
            last_error: None,
        }
    }
}

impl PlannerPane {
    pub fn new() -> Self {
        Self::default()
    }

    /// Render the daemon's signed ownership projection. The pane never derives
    /// an owner from the live fleet or from Porthole presence: those remain
    /// useful witnesses, while the ownership epoch is the authority fact.
    fn ownership_blocks(item: &PlannerItem) -> Vec<Block> {
        let ownership = &item.ownership;
        let mut blocks = Vec::new();
        let epoch = ownership
            .current_epoch_number
            .map(|number| format!(" · epoch {number}"))
            .unwrap_or_default();
        let projection_loaded = !ownership.detail_visibility.is_empty();
        let owner = ownership
            .current_owner
            .as_ref()
            .map(ownership_agent_label)
            .unwrap_or_else(|| {
                if ownership.current_state == "inconsistent" {
                    "no canonical owner".into()
                } else if projection_loaded {
                    "unassigned".into()
                } else {
                    "unknown · projection unavailable".into()
                }
            });
        let state = if ownership.current_state.is_empty() {
            "unknown"
        } else {
            &ownership.current_state
        };
        blocks.push(Block::Chip {
            label: format!("OWNER · {owner}{epoch} · {}", state.to_ascii_uppercase()),
            tone: ownership_tone(state),
        });

        if !ownership.state_evidence.is_empty() && ownership.state_evidence != "none" {
            blocks.push(Block::KeyVal(
                "owner evidence".into(),
                ownership.state_evidence.clone(),
            ));
        }

        if !ownership.prior_owners.is_empty() {
            let prior = ownership
                .prior_owners
                .iter()
                .map(|entry| {
                    format!(
                        "epoch {} · {} · {} · {}",
                        entry.epoch_number,
                        ownership_agent_label(&entry.owner),
                        entry.state,
                        entry.cause
                    )
                })
                .collect::<Vec<_>>()
                .join("\n");
            blocks.push(Block::WrappedText {
                text: format!("PRIOR OWNERS\n{prior}"),
                tone: Tone::Resting,
            });
        }

        let full = ownership.detail_visibility == "full";
        if ownership.claim_count > 0 {
            if full {
                let claims = ownership
                    .claims
                    .iter()
                    .take(12)
                    .map(|claim| {
                        let target = if claim.file_path.is_empty() {
                            "(repository)".to_string()
                        } else {
                            planner_breakable(&claim.file_path)
                        };
                        format!(
                            "{} · {} · {} · {}",
                            claim.disposition, claim.selector_kind, target, claim.claim_node_id
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n");
                let remainder = ownership
                    .claim_count
                    .saturating_sub(ownership.claims.len().min(12));
                blocks.push(Block::WrappedText {
                    text: if remainder == 0 {
                        format!("CLAIMS · {}\n{claims}", ownership.claim_count)
                    } else {
                        format!(
                            "CLAIMS · {}\n{claims}\n+{remainder} more",
                            ownership.claim_count
                        )
                    },
                    tone: Tone::Engaged,
                });
            } else {
                blocks.push(Block::KeyVal(
                    "claims".into(),
                    format!(
                        "{} · exact selectors require a verified ownership-party credential",
                        ownership.claim_count
                    ),
                ));
            }
        }

        if let Some(summary) = &ownership.briefing_summary {
            blocks.push(Block::KeyVal(
                "successor briefing".into(),
                format!(
                    "{} gaps · {} unresolved · {} citations · {} omitted sources",
                    summary.known_gap_count,
                    summary.unresolved_question_count,
                    summary.evidence_count,
                    summary.omitted_source_count
                ),
            ));
        }
        if let Some(briefing) = &ownership.briefing {
            let mut lines = vec![format!(
                "digest {} · generated {}",
                briefing.content_hash, briefing.generated_at
            )];
            lines.extend(
                briefing
                    .known_gaps
                    .iter()
                    .take(8)
                    .map(|gap| format!("known gap · {gap}")),
            );
            lines.extend(
                briefing
                    .unresolved_questions
                    .iter()
                    .take(8)
                    .map(|question| format!("unresolved · {}", question.text)),
            );
            lines.extend(briefing.evidence.iter().take(12).map(|evidence| {
                format!(
                    "{} · {} · {}",
                    evidence.source, evidence.reference, evidence.label
                )
            }));
            if !briefing.omitted_sources.is_empty() {
                lines.push(format!("omitted · {}", briefing.omitted_sources.join(", ")));
            }
            blocks.push(Block::WrappedText {
                text: format!("SANITIZED HANDOFF BRIEFING\n{}", lines.join("\n")),
                tone: Tone::Default,
            });
        }

        if ownership.takeover.available {
            let (label, tone) = if ownership.takeover.active_grant_id.is_some() {
                ("TAKEOVER · signed one-shot grant issued", Tone::Engaged)
            } else if ownership.takeover.operator_presence_available {
                (
                    "TAKEOVER · eligible for action-bound operator recovery",
                    Tone::Gated,
                )
            } else {
                (
                    "TAKEOVER · operator recovery gated; voluntary handoff remains",
                    Tone::Gated,
                )
            };
            blocks.push(Block::Chip {
                label: label.into(),
                tone,
            });
            if let Some(url) = &ownership.takeover.action_url {
                let (action, suffix) = if ownership.takeover.active_grant_id.is_some() {
                    ("grant acceptance", "requires the signed grant and nonce")
                } else {
                    (
                        "takeover preparation",
                        "requires an admitted successor and explicit claim dispositions",
                    )
                };
                blocks.push(Block::KeyVal(action.into(), format!("{url} · {suffix}")));
            }
            blocks.push(Block::WrappedText {
                text: format!("RECOVERY CONTRACT\n{}", ownership.takeover.note),
                tone: Tone::Gated,
            });
        } else if !ownership.takeover.note.is_empty() {
            blocks.push(Block::KeyVal(
                "takeover".into(),
                ownership.takeover.note.clone(),
            ));
        }
        blocks
    }

    fn sorted_jira_indices(&self) -> Vec<usize> {
        let mut indices: Vec<usize> = (0..self.jira_items.len()).collect();
        indices.sort_by(|a, b| {
            let left = &self.jira_items[*a];
            let right = &self.jira_items[*b];
            let order = match self.jira_sort {
                JiraSort::Key => planner_cmp(&left.key, &right.key),
                JiraSort::Summary => planner_cmp(&left.summary, &right.summary),
                JiraSort::Status => planner_cmp(&left.status, &right.status),
                JiraSort::Priority => planner_cmp(&left.priority, &right.priority),
                JiraSort::Assignee => planner_cmp(&left.assignee, &right.assignee),
                JiraSort::IssueType => planner_cmp(&left.issue_type, &right.issue_type),
                JiraSort::Updated => planner_cmp(&left.updated, &right.updated),
                JiraSort::Due => planner_cmp(&left.due_date, &right.due_date),
            };
            let order = if self.jira_descending {
                order.reverse()
            } else {
                order
            };
            order.then_with(|| left.key.cmp(&right.key))
        });
        indices
    }

    fn selected_jira(&self) -> Option<&JiraItem> {
        let key = self.selected_jira_key.as_deref()?;
        self.jira_items.iter().find(|item| item.key == key)
    }

    fn jira_blocks(&self) -> Vec<Block> {
        let mut blocks = vec![Block::Gap, Block::Header("Jira · live read-through".into())];
        blocks.push(Block::KeyVal(
            "authority".into(),
            "Jira Cloud · read only".into(),
        ));
        if !self.jira_loaded {
            blocks.push(Block::KeyVal(
                "status".into(),
                "loading Jira configuration…".into(),
            ));
            return blocks;
        }
        if !self.jira_configured {
            let missing = if self.jira_missing.is_empty() {
                "Jira connection tuple".into()
            } else {
                self.jira_missing.join(", ")
            };
            blocks.push(Block::WrappedText {
                text: format!(
                    "JIRA NOT CONFIGURED\nSet {missing} in FleetBar Credentials. Port Daddy's local roadmap remains available."
                ),
                tone: Tone::Gated,
            });
            return blocks;
        }
        blocks.push(Block::KeyVal(
            "project".into(),
            format!("{} · {}", self.jira_project_key, self.jira_base_url),
        ));
        if let Some(error) = &self.jira_error {
            blocks.push(Block::WrappedText {
                text: format!("JIRA READ FAILED\n{error}\nLocal roadmap data is unaffected."),
                tone: Tone::Conflicted,
            });
            return blocks;
        }
        blocks.push(Block::KeyVal(
            "issues".into(),
            self.jira_items.len().to_string(),
        ));
        blocks.push(Block::KeyVal(
            "fetch".into(),
            format!(
                "{} page(s) · {}",
                self.jira_page_count,
                if self.jira_truncated {
                    "partial result"
                } else {
                    "complete result"
                }
            ),
        ));
        if self.jira_truncated {
            blocks.push(Block::WrappedText {
                text: "JIRA RESULT CAPPED\nThe bounded read has more issues upstream; this list is explicitly partial."
                    .into(),
                tone: Tone::Gated,
            });
        }
        if self.jira_items.is_empty() {
            blocks.push(Block::KeyVal(
                "status".into(),
                "Jira returned no visible issues".into(),
            ));
            return blocks;
        }

        blocks.push(Block::LedgerHeader {
            surface: self.id().into(),
            columns: vec![
                ("key".into(), "Key".into()),
                ("summary".into(), "Summary".into()),
                ("status".into(), "Status".into()),
                ("priority".into(), "Priority".into()),
                ("assignee".into(), "Assignee".into()),
                ("type".into(), "Type".into()),
                ("updated".into(), "Updated".into()),
                ("due".into(), "Due".into()),
            ],
            active_sort: self.jira_sort.key().into(),
            descending: self.jira_descending,
        });
        for (row_index, item_index) in self.sorted_jira_indices().into_iter().enumerate() {
            let item = &self.jira_items[item_index];
            blocks.push(Block::LedgerRow {
                surface: self.id().into(),
                index: row_index,
                selected: self.selected_jira_key.as_deref() == Some(item.key.as_str()),
                cells: vec![
                    LedgerCell::standard("source", "JIRA"),
                    LedgerCell::standard("key", planner_breakable(&item.key)),
                    LedgerCell::wide("summary", planner_breakable(&item.summary)),
                    LedgerCell::standard("status", item.status.clone()),
                    LedgerCell::standard("priority", item.priority.clone()),
                    LedgerCell::standard("assignee", planner_breakable(&item.assignee)),
                    LedgerCell::standard("type", item.issue_type.clone()),
                    LedgerCell::standard("updated", planner_breakable(&item.updated)),
                    LedgerCell::standard("due", planner_breakable(&item.due_date)),
                ],
                tone: item.tone(),
            });
        }
        if let Some(item) = self.selected_jira() {
            blocks.push(Block::Gap);
            blocks.push(Block::Header(format!("Jira inspector · {}", item.key)));
            let fields = [
                ("source", "Jira Cloud".into()),
                ("id", item.id.clone()),
                ("key", item.key.clone()),
                ("url", item.url.clone()),
                ("summary", item.summary.clone()),
                ("status", item.status.clone()),
                ("status category", item.status_category.clone()),
                ("priority", item.priority.clone()),
                ("assignee", item.assignee.clone()),
                ("issue type", item.issue_type.clone()),
                ("parent", item.parent_key.clone()),
                ("labels", item.labels.join(", ")),
                ("created", item.created.clone()),
                ("updated", item.updated.clone()),
                ("due", item.due_date.clone()),
            ];
            blocks.extend(fields.into_iter().map(|(label, value)| Block::WrappedText {
                text: format!(
                    "{}\n{}",
                    label.to_ascii_uppercase(),
                    planner_breakable(&value)
                ),
                tone: if value.is_empty() {
                    Tone::Resting
                } else {
                    item.tone()
                },
            }));
        } else {
            blocks.push(Block::WrappedText {
                text: "Select a Jira issue to inspect its complete metadata and permalink.".into(),
                tone: Tone::Resting,
            });
        }
        blocks
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
    ///
    /// Date anchoring (additive, backward-compatible): after the kernel
    /// computes the CPM window, any row whose item carries BOTH a valid
    /// `started_at` and `due_at` has its `start`/`finish` REPLACED with the
    /// real wall-clock day-offsets from today (same "1 unit = 1 day, anchored
    /// at today" convention the axis already uses — see `axis_rows`), so the
    /// bar lines up with the same ticks a relative bar would. `critical` and
    /// `slack` are left exactly as the kernel scheduler computed them — dates
    /// never feed back into dependency-order math, only into where the bar is
    /// drawn. An item missing either field, or with `due_at` not after
    /// `started_at`, keeps the plain CPM offset unchanged (today's behavior).
    fn gantt(&self) -> Result<(Vec<GanttRow>, i64), String> {
        let mut seen: std::collections::HashSet<&str> = std::collections::HashSet::new();
        let mut nodes: Vec<SchedNode> = Vec::new();
        let mut est_by_slug: std::collections::HashMap<&str, i64> =
            std::collections::HashMap::new();
        let mut dates_by_slug: std::collections::HashMap<&str, (i64, i64)> =
            std::collections::HashMap::new();
        for it in &self.items {
            if it.status == "done" || !seen.insert(it.slug.as_str()) {
                continue;
            }
            let est = it.estimate.unwrap_or(1).max(1);
            est_by_slug.insert(it.slug.as_str(), est);
            if let (Some(started), Some(due)) = (it.started_at, it.due_at) {
                if due > started {
                    dates_by_slug.insert(it.slug.as_str(), (started, due));
                }
            }
            nodes.push(SchedNode {
                id: it.slug.clone(),
                estimate: Some(est),
            });
        }
        if nodes.is_empty() {
            return Ok((Vec::new(), 0));
        }
        let ids: std::collections::HashSet<&str> = nodes.iter().map(|n| n.id.as_str()).collect();
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
                date_anchored: false,
            })
            .collect();

        // Date-anchoring pass: today is the same unit-0 the axis anchors to
        // (`axis_rows`), so converting startedAt/dueAt to day-offsets from it
        // keeps a wall-clock bar on the identical coordinate system a
        // CPM-relative bar uses — the two kinds of bar share one axis, one
        // tick ladder, one BAR_CELLS budget. Offsets are clamped to a
        // non-negative, ≥1-unit-wide window so an overdue startedAt (in the
        // past) or a same-day due date never produces a negative `lead` or a
        // zero-width bar downstream in `gantt_blocks`.
        let today = time::OffsetDateTime::now_utc().date();
        for row in rows.iter_mut() {
            if let Some(&(started_ms, due_ms)) = dates_by_slug.get(row.slug.as_str()) {
                let start_u = day_offset_from(today, started_ms).max(0);
                let finish_u = day_offset_from(today, due_ms).max(start_u + 1);
                row.start = start_u;
                row.finish = finish_u;
                row.date_anchored = true;
            }
        }

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
    /// section leads with the makespan/critical-path summary the chart answers,
    /// and the bars sit under a labeled time axis (see [`axis_rows`]) so the
    /// chart reads in dates, not just relative geometry.
    fn gantt_blocks(&self) -> Vec<Block> {
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
                    "Gantt — critical path · {} task(s) · makespan {} day(s) · 1 est unit = 1 day · ticks {}d",
                    rows.len(),
                    makespan,
                    axis_tick_step(makespan.max(1)),
                )));
                blocks.push(Block::Chip {
                    label: format!("{crit_n} on the critical path"),
                    tone: if crit_n > 0 {
                        Tone::Engaged
                    } else {
                        Tone::Resting
                    },
                });
                // The render span is the CPM makespan UNLESS a date-anchored
                // bar's real due date lands past it — the header's "makespan"
                // stays the kernel's untouched CPM answer, but the bar lane
                // and axis widen to fit whichever is farther out, so a
                // wall-clock bar can never overflow BAR_CELLS the way a raw
                // `r.finish > span` would (negative-cast/huge-repeat panic).
                let span = rows
                    .iter()
                    .map(|r| r.finish)
                    .fold(makespan.max(1), i64::max);
                let today = time::OffsetDateTime::now_utc().date();
                blocks.extend(axis_rows(span, today));
                for r in rows.iter().take(MAX_ROWS) {
                    let lead = (r.start * BAR_CELLS / span) as usize;
                    let fill =
                        (((r.finish - r.start) * BAR_CELLS + span - 1) / span).max(1) as usize;
                    // Preserve the polished native distinction between a solid
                    // critical path and a shaded non-critical path. The
                    // deterministic proof raster carries explicit bitmap glyphs
                    // for both characters, so visual proof does not dictate a
                    // lower-quality alphabet for GPUI or the terminal renderer.
                    let glyph = if r.critical { '█' } else { '▓' };
                    let bar = format!("{}{}", " ".repeat(lead), glyph.to_string().repeat(fill));
                    let claim = self
                        .claims
                        .get(&r.slug)
                        .map(|by| format!(" ◆ {}", trunc(by, 18)))
                        .unwrap_or_default();
                    // Text tag, not a glyph/emoji (repo convention: no
                    // emoji-as-icon) — "DATED" marks a bar anchored to real
                    // startedAt/dueAt instead of the CPM-relative offset.
                    let dated = if r.date_anchored { " DATED" } else { "" };
                    let meta = if r.critical {
                        format!("e{} CRIT{}{}", r.estimate, dated, claim)
                    } else {
                        format!("e{} s{}{}{}", r.estimate, r.slack, dated, claim)
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

fn planner_cmp(left: &str, right: &str) -> Ordering {
    left.to_ascii_lowercase().cmp(&right.to_ascii_lowercase())
}

fn planner_breakable(value: &str) -> String {
    value
        .replace('/', "/\u{200b}")
        .replace(':', ":\u{200b}")
        .replace('-', "-\u{200b}")
}

/// One bar of the Planner Gantt: a task's CPM window plus the fields the
/// operator reads off the chart (estimate, slack, critical membership).
///
/// `start`/`finish` are day-offsets from the axis anchor (today, unit 0) — by
/// default straight from the kernel's CPM schedule, but overridden to real
/// wall-clock offsets when the item carries a valid `startedAt`+`dueAt` pair
/// (see `gantt()`'s date-anchoring pass and `date_anchored`). `critical` and
/// `slack` always come from the untouched CPM result regardless of anchoring —
/// the kernel scheduler (ADR-0120 TCB boundary) is never consulted about real
/// dates, only about dependency order and effort.
#[derive(Debug)]
struct GanttRow {
    slug: String,
    start: i64,
    finish: i64,
    critical: bool,
    slack: i64,
    estimate: i64,
    /// True when `start`/`finish` were overridden with real wall-clock dates
    /// (`startedAt`/`dueAt`) instead of the CPM-relative offset. Additive
    /// display metadata only — never consulted for critical-path math.
    date_anchored: bool,
}

/// Width of the Gantt bar lane in character cells — shared by the bars and the
/// time axis so tick cells land exactly where bar starts land (both use the
/// same `value * BAR_CELLS / span` integer mapping).
const BAR_CELLS: i64 = 40;

/// Whole-day offset of an epoch-millisecond timestamp from `today`, under the
/// exact same "1 unit = 1 day, unit 0 = today" convention `axis_rows` already
/// draws the axis with. Used to convert a real `startedAt`/`dueAt` (wall
/// clock) into the same relative-unit coordinate space CPM bars live in, so a
/// date-anchored bar and a CPM-relative bar share one axis without a second
/// rendering code path. Negative for a timestamp before today (e.g. a task
/// started in the past); callers clamp as needed for their own invariants —
/// this function reports the true signed offset, it does not clamp.
///
/// An out-of-range timestamp (implausible after the `> 0` filter in
/// `PlannerItem::from_value`, but defensive here since this is TCB-adjacent
/// date math) falls back to `today` itself (offset 0) rather than panicking —
/// a pane must degrade, never crash, on a malformed payload (see `util.rs`'s
/// module doc: "never hard-fail decoding").
///
/// @param today - The axis anchor date (unit 0).
/// @param epoch_ms - The wall-clock timestamp to place on the axis.
/// @returns The signed day offset from `today` (why signed: a start date in
/// the past must still report a real negative offset — the caller, not this
/// function, decides whether/how to clamp it for rendering).
fn day_offset_from(today: time::Date, epoch_ms: i64) -> i64 {
    let d = time::OffsetDateTime::from_unix_timestamp(epoch_ms.div_euclid(1000))
        .map(|dt| dt.date())
        .unwrap_or(today);
    (d - today).whole_days()
}

/// Pick the tick spacing (in schedule units ≈ days) for a Gantt time axis.
///
/// Why adaptive: the schedule's span varies from a couple of days to a year+,
/// and a fixed cadence either crowds the lane with labels or leaves it bare.
/// The ladder is calendar-shaped on purpose — day, 2-day, week, fortnight,
/// 4-week, quarter, half-year, year — so the ticks the operator sees are the
/// time units they plan in (days → weeks → months-ish), not arbitrary decimals.
/// The chosen step is the smallest rung that keeps the lane at ≤ 8 ticks,
/// which leaves room for a date label per tick in a 40-cell lane.
///
/// @param span - Schedule makespan in units (1 unit = 1 day by convention).
/// @returns The tick step in units, always ≥ 1.
fn axis_tick_step(span: i64) -> i64 {
    const LADDER: [i64; 8] = [1, 2, 7, 14, 28, 91, 182, 364];
    for step in LADDER {
        // Ceiling division: count INTERVALS the span actually needs — plain
        // integer division under-counts a partial trailing interval and lets
        // one tick too many crowd the lane.
        if (span + step - 1) / step <= 8 {
            return step;
        }
    }
    // Beyond the ladder: whole multiples of a year until ≤ 8 ticks fit.
    let years = span / (364 * 8) + 1;
    years * 364
}

/// Build the two time-axis rows that sit directly above the Gantt bars: a
/// date-label row and a tick ruler row, both in the bar column so the
/// consecutive-`Row` alignment of every renderer (terminal pad-to-column,
/// raster fixed thirds, GPUI) lines the ticks up with the bars beneath.
///
/// Why the axis exists: bars without an x-axis are only relative geometry —
/// the operator asked for actual time units. The kernel's CPM schedule
/// itself is still purely relative (ADR-0086: the scheduler has no
/// absolute-date anchor, and this function never asks it for one), so the
/// axis anchors unit 0 at TODAY under the declared planning convention 1
/// estimate unit = 1 day; tick 0 is labeled `today` (the today-marker) and
/// later ticks carry real `MM-DD` dates at the adaptive cadence of
/// [`axis_tick_step`]. `gantt()`'s date-anchoring pass overrides individual
/// BARS with real `startedAt`/`dueAt` offsets when an item has them, but
/// every bar — anchored or relative — is placed on this SAME today-anchored
/// axis, so "day 3" always means the same wall-clock day regardless of which
/// kind of bar is drawn there. The convention is stated in the meta column
/// so the axis never pretends to more precision than the schedule has.
///
/// @param span - Schedule makespan in units (clamped ≥ 1 by the caller).
/// @param today - The anchor date for unit 0 (injected so tests are stable).
/// @returns Two `Block::Row`s (labels, then ruler) to push before the bars.
fn axis_rows(span: i64, today: time::Date) -> Vec<Block> {
    let step = axis_tick_step(span);
    let lane = (BAR_CELLS + 1) as usize;
    let mut ruler: Vec<char> = vec!['-'; lane];
    let mut labels: Vec<char> = vec![' '; lane];
    let mut last_label_end: Option<usize> = None;
    let mut t = 0;
    while t <= span {
        let cell = (t * BAR_CELLS / span.max(1)) as usize;
        ruler[cell] = '|';
        let text = if t == 0 {
            "today".to_string()
        } else {
            let d = today + time::Duration::days(t);
            format!("{:02}-{:02}", u8::from(d.month()), d.day())
        };
        // Place the label at its tick cell unless it would collide with the
        // previous label (≥1 space gap) or run past the lane — dropped labels
        // keep their tick mark, so geometry stays exact even when text won't fit.
        let start = cell;
        let end = start + text.len();
        let collides = last_label_end.is_some_and(|prev| start <= prev);
        if end <= lane && !collides {
            for (i, ch) in text.chars().enumerate() {
                labels[start + i] = ch;
            }
            last_label_end = Some(end); // end index +1 gap is implied by `<=`
        }
        t += step;
    }
    // Close the frame: the schedule's end always gets a tick, even when the
    // makespan is not a multiple of the step (its date label is often what
    // the operator wants most — "when does the plan land").
    ruler[BAR_CELLS as usize] = '|';
    // The meta (third) column stays EMPTY on axis rows: the raster renderer
    // lays Row columns out in fixed thirds, and a 41-cell lane overflows its
    // column — over an empty meta cell that overflow is harmless (bars do the
    // same), while meta text there would collide with the axis. The unit
    // convention lives in the Gantt header instead.
    vec![
        Block::Row(vec![
            String::new(),
            labels
                .into_iter()
                .collect::<String>()
                .trim_end()
                .to_string(),
            String::new(),
        ]),
        Block::Row(vec![
            String::new(),
            ruler.into_iter().collect(),
            String::new(),
        ]),
    ]
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
            blocks.extend(self.jira_blocks());
            return blocks;
        }
        if self.items.is_empty() {
            blocks.push(Block::KeyVal("status".into(), "no roadmap items".into()));
            blocks.extend(self.jira_blocks());
            return blocks;
        }

        // The Gantt leads — the console's first screen answers "what is the
        // plan and where is the critical path" before any tree or roster.
        blocks.extend(self.gantt_blocks());
        blocks.push(Block::Gap);
        blocks.push(Block::Chip {
            label: format!("PORT DADDY · LOCAL AUTHORITY · {} ITEMS", self.items.len()),
            tone: Tone::Accent,
        });
        blocks.extend(self.jira_blocks());
        blocks.push(Block::Gap);
        blocks.push(Block::Header("Port Daddy · local roadmap detail".into()));

        if let Some(error) = &self.ownership_projection_error {
            blocks.push(Block::WrappedText {
                text: format!(
                    "OWNERSHIP PROJECTION UNAVAILABLE\n{error}\nOwner state is unknown; live agents and presence are not substituted as authority."
                ),
                tone: Tone::Conflicted,
            });
        }

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
            for (index, (identity, purpose, status)) in self.agents.iter().take(12).enumerate() {
                blocks.push(Block::LedgerRow {
                    surface: String::new(),
                    index,
                    selected: false,
                    cells: vec![
                        LedgerCell::standard("identity", planner_breakable(identity)),
                        LedgerCell::wide("purpose", planner_breakable(purpose)),
                        LedgerCell::standard("status", status.clone()),
                    ],
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
                let claim_col = claimed.map(|by| format!("◆ {by}")).unwrap_or_default();
                blocks.push(Block::LedgerRow {
                    surface: String::new(),
                    index: idx,
                    selected: false,
                    cells: vec![
                        LedgerCell::standard("source", "PORT DADDY"),
                        LedgerCell::wide("item", planner_breakable(&it.slug)),
                        LedgerCell::wide("summary", planner_breakable(&it.summary)),
                        LedgerCell::standard("status", it.status.clone()),
                        LedgerCell::standard("priority", format!("P{p}")),
                        LedgerCell::standard("dependencies", dep_note),
                        LedgerCell::standard("working", planner_breakable(&claim_col)),
                    ],
                    tone: status_tone(&it.status),
                });
                // Status chip; and when an agent holds the live claim, surface it
                // (the "who's working on this task" axis) in the Engaged tone.
                if let Some(by) = claimed {
                    blocks.push(Block::Chip {
                        label: format!("working: {by}"),
                        tone: Tone::Engaged,
                    });
                } else {
                    blocks.push(Block::Chip {
                        label: it.status.clone(),
                        tone: status_tone(&it.status),
                    });
                }
                blocks.extend(Self::ownership_blocks(it));
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
                Ok(resp) => {
                    let status = resp.status();
                    match resp.json::<Value>().await {
                        Err(e) => {
                            self.last_error = Some(format!("invalid local roadmap response: {e}"))
                        }
                        Ok(data) if !status.is_success() => {
                            self.last_error = Some(format!(
                                "GET /roadmap/items returned {status}: {}",
                                s(&data, "error")
                            ));
                            self.items.clear();
                        }
                        Ok(data) => {
                            self.last_error = None;
                            self.items = arr(&data, "items")
                                .iter()
                                .map(PlannerItem::from_value)
                                .collect();
                            // Ownership is a separate signed projection. Fetch
                            // it with the held actor credential so the daemon,
                            // not the pane, decides whether summary or full
                            // detail is authorized. One projection per harbor
                            // prevents same-slug cross-harbor identity bleed.
                            self.ownership_projection_error = None;
                            let projection_url = format!("{}/roadmap/projection", daemon.base());
                            let harbors = self
                                .items
                                .iter()
                                .map(|item| item.harbor.clone())
                                .collect::<std::collections::BTreeSet<_>>();
                            let mut ownership_by_item = std::collections::HashMap::new();
                            let mut projection_errors = Vec::new();
                            for harbor in harbors {
                                let mut request = daemon.authenticated_get(&projection_url);
                                if !harbor.is_empty() {
                                    request = request.query(&[("harbor", harbor.as_str())]);
                                }
                                match request.send().await {
                                    Err(error) => projection_errors.push(format!(
                                        "{}: {error}",
                                        if harbor.is_empty() {
                                            "default harbor"
                                        } else {
                                            &harbor
                                        }
                                    )),
                                    Ok(response) => {
                                        let status = response.status();
                                        match response.json::<RoadmapProjection>().await {
                                            Err(error) => projection_errors.push(format!(
                                                "{}: invalid response: {error}",
                                                if harbor.is_empty() {
                                                    "default harbor"
                                                } else {
                                                    &harbor
                                                }
                                            )),
                                            Ok(_) if !status.is_success() => {
                                                projection_errors.push(format!(
                                                    "{}: GET /roadmap/projection returned {status}",
                                                    if harbor.is_empty() {
                                                        "default harbor"
                                                    } else {
                                                        &harbor
                                                    }
                                                ));
                                            }
                                            Ok(projection) => {
                                                if !harbor.is_empty() && projection.harbor != harbor
                                                {
                                                    projection_errors.push(format!(
                                                        "{harbor}: daemon returned harbor {}",
                                                        projection.harbor
                                                    ));
                                                    continue;
                                                }
                                                for projected in projection.items {
                                                    ownership_by_item.insert(
                                                        (harbor.clone(), projected.slug),
                                                        projected.ownership,
                                                    );
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            for item in &mut self.items {
                                if let Some(ownership) = ownership_by_item
                                    .remove(&(item.harbor.clone(), item.slug.clone()))
                                {
                                    item.ownership = ownership;
                                }
                            }
                            if !projection_errors.is_empty() {
                                self.ownership_projection_error =
                                    Some(projection_errors.join("; "));
                            }
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
                    }
                }
            }

            // Jira is an independent read-through source. Its failure must not
            // erase or relabel Port Daddy's local roadmap authority.
            self.jira_loaded = true;
            self.jira_error = None;
            let jira_url = format!("{}/roadmap/jira", daemon.base());
            match daemon.http_client().get(&jira_url).send().await {
                Err(error) => {
                    self.jira_configured = true;
                    self.jira_items.clear();
                    self.jira_error = Some(format!("GET /roadmap/jira unavailable: {error}"));
                }
                Ok(response) => {
                    let status = response.status();
                    match response.json::<Value>().await {
                        Err(error) => {
                            self.jira_configured = true;
                            self.jira_items.clear();
                            self.jira_error =
                                Some(format!("Invalid Jira roadmap response: {error}"));
                        }
                        Ok(data) => {
                            self.jira_configured = data
                                .get("configured")
                                .and_then(Value::as_bool)
                                .unwrap_or(false);
                            self.jira_missing = arr(&data, "missing")
                                .iter()
                                .filter_map(Value::as_str)
                                .map(str::to_string)
                                .collect();
                            self.jira_project_key = s(&data, "projectKey");
                            self.jira_base_url = s(&data, "baseUrl");
                            self.jira_page_count = n(&data, "pageCount");
                            self.jira_truncated = data
                                .get("truncated")
                                .and_then(Value::as_bool)
                                .unwrap_or(false);
                            if !status.is_success() {
                                self.jira_items.clear();
                                let detail = s(&data, "error");
                                self.jira_error = Some(if detail.is_empty() {
                                    format!("GET /roadmap/jira returned {status}")
                                } else {
                                    detail
                                });
                            } else if !self.jira_configured {
                                self.jira_items.clear();
                                self.jira_error = None;
                            } else {
                                self.jira_items = arr(&data, "issues")
                                    .iter()
                                    .map(JiraItem::from_value)
                                    .filter(|item| !item.key.is_empty())
                                    .collect();
                            }
                        }
                    }
                }
            }
            if self
                .selected_jira_key
                .as_deref()
                .is_some_and(|key| !self.jira_items.iter().any(|item| item.key == key))
            {
                self.selected_jira_key = None;
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
            match action {
                SurfaceAction::SelectRow { index } => {
                    if let Some(item_index) = self.sorted_jira_indices().get(index).copied() {
                        self.selected_jira_key = Some(self.jira_items[item_index].key.clone());
                    }
                }
                SurfaceAction::Sort { key } => {
                    if let Some(sort) = JiraSort::parse(&key) {
                        if self.jira_sort == sort {
                            self.jira_descending = !self.jira_descending;
                        } else {
                            self.jira_sort = sort;
                            self.jira_descending =
                                matches!(sort, JiraSort::Updated | JiraSort::Due);
                        }
                    }
                }
                _ => {}
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

    fn jira_item(key: &str, summary: &str, updated: &str) -> JiraItem {
        JiraItem::from_value(&json!({
            "id": format!("id-{key}"),
            "key": key,
            "url": format!("https://example.atlassian.net/browse/{key}"),
            "summary": summary,
            "status": "In Progress",
            "statusCategory": "In Progress",
            "priority": "High",
            "assignee": "Ada Lovelace",
            "issueType": "Story",
            "parentKey": "HARBOR-1",
            "labels": ["harbor", "console"],
            "created": "2026-08-01T10:00:00.000+0000",
            "updated": updated,
            "dueDate": "2026-09-15"
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

    #[test]
    fn view_exposes_owner_history_claims_briefing_and_gated_takeover() {
        let mut pane = PlannerPane::default();
        let mut owned = item("durable-takeover", "now", "Continue unfinished work safely");
        owned.ownership = serde_json::from_value(json!({
            "detailVisibility": "full",
            "currentOwner": {
                "agentNodeId": "agent_node_successor",
                "displayName": "Successor Custodian",
                "identity": "port-daddy:roster:successor-custodian"
            },
            "currentEpochId": "ownership_epoch_2",
            "currentEpochNumber": 2,
            "currentState": "stale",
            "stateEvidence": "session-stale",
            "priorOwners": [{
                "epochId": "ownership_epoch_1",
                "epochNumber": 1,
                "owner": { "agentNodeId": "agent_node_predecessor" },
                "state": "transferred",
                "cause": "assignment",
                "reason": "Initial owner",
                "createdAt": 1
            }],
            "claimCount": 1,
            "claims": [{
                "claimNodeId": "claim_1",
                "filePath": "lib/unfinished.ts",
                "selectorKind": "file",
                "claimedAt": 1,
                "worldKind": "worktree",
                "worldId": "worktree_1",
                "mode": "X",
                "disposition": "transfer"
            }],
            "briefingSummary": {
                "generatedAt": 2,
                "knownGapCount": 1,
                "omittedSourceCount": 1,
                "unresolvedQuestionCount": 1,
                "evidenceCount": 1
            },
            "briefing": {
                "briefingId": "brief_1",
                "contentHash": "sha256:brief",
                "generatedAt": 2,
                "knownGaps": ["Hosted Fleet verdict is still unknown."],
                "omittedSources": ["hidden reasoning is unavailable"],
                "unresolvedQuestions": [{
                    "id": "q1", "text": "Which exact PR head should continue?"
                }],
                "evidence": [{
                    "source": "porthole", "ref": "porthole:capture:1", "label": "source-pane witness"
                }]
            },
            "takeover": {
                "available": true,
                "operatorPresenceAvailable": false,
                "actionUrl": "/roadmap/items/durable-takeover/takeovers",
                "activeGrantId": null,
                "requires": "verified-current-owner-or-recent-operator-presence",
                "note": "Operator takeover is fail-closed; a current owner may hand off voluntarily."
            }
        }))
        .expect("ownership projection");
        pane.items = vec![owned];

        let blocks = pane.view();
        assert!(blocks.iter().any(|block| matches!(
            block,
            Block::Chip { label, .. }
                if label.contains("Successor Custodian")
                    && label.contains("epoch 2")
                    && label.contains("STALE")
        )));
        assert!(blocks.iter().any(|block| matches!(
            block,
            Block::WrappedText { text, .. }
                if text.contains("PRIOR OWNERS") && text.contains("agent_node_predecessor")
        )));
        assert!(blocks.iter().any(|block| matches!(
            block,
            Block::WrappedText { text, .. }
                if text.contains("CLAIMS · 1")
                    && text.replace('\u{200b}', "").contains("lib/unfinished.ts")
        )));
        assert!(blocks.iter().any(|block| matches!(
            block,
            Block::WrappedText { text, .. }
                if text.contains("SANITIZED HANDOFF BRIEFING")
                    && text.contains("hidden reasoning is unavailable")
                    && text.contains("porthole:capture:1")
        )));
        assert!(blocks.iter().any(|block| matches!(
            block,
            Block::Chip { label, .. } if label.contains("operator recovery gated")
        )));
    }

    fn item_with(slug: &str, status: &str, deps: &[&str], estimate: Option<i64>) -> PlannerItem {
        PlannerItem::from_value(&json!({
            "slug": slug, "status": status, "summaryMd": slug,
            "dependencies": deps, "harbor": "port-daddy", "notes": [],
            "estimate": estimate,
        }))
    }

    /// Like `item_with`, plus `startedAt`/`dueAt` (epoch ms) — the shape a
    /// daemon serving ADR-0086 date-anchor data actually sends.
    fn item_with_dates(
        slug: &str,
        status: &str,
        deps: &[&str],
        estimate: Option<i64>,
        started_at: Option<i64>,
        due_at: Option<i64>,
    ) -> PlannerItem {
        PlannerItem::from_value(&json!({
            "slug": slug, "status": status, "summaryMd": slug,
            "dependencies": deps, "harbor": "port-daddy", "notes": [],
            "estimate": estimate, "startedAt": started_at, "dueAt": due_at,
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
    fn gantt_picks_the_longer_diamond_branch_as_the_critical_path() {
        // A chain can only have one answer; a DIAMOND is where a CPM scheduler
        // can be wrong and still look plausible. Fork into two branches of
        // different duration, rejoin, and the join must wait on the LONGER one.
        //
        //   fork(2)  0..2
        //     ├─ b-short(1)  2..3   → slack 4, hatched
        //     └─ c-long(5)   2..7   → critical, solid
        //   d-join(2)  7..9                 makespan 9
        //
        // The slugs are chosen so the SHORT branch sorts first: the scheduler
        // walks predecessors id-ordered, so a join that took its first (or its
        // last-written) predecessor instead of the MAXIMUM finish would start
        // d-join at 3 and crown b-short critical. That is the wrong-branch bug
        // this test exists to catch — see the negative assertions below.
        let mut p = PlannerPane::default();
        p.items = vec![
            item_with("fork", "now", &[], Some(2)),
            item_with("b-short", "backlog", &["fork"], Some(1)),
            item_with("c-long", "backlog", &["fork"], Some(5)),
            item_with("d-join", "backlog", &["b-short", "c-long"], Some(2)),
        ];
        let (rows, makespan) = p.gantt().expect("schedules");
        let row = |slug: &str| {
            rows.iter()
                .find(|r| r.slug == slug)
                .unwrap_or_else(|| panic!("no scheduled row for {slug}"))
        };

        // The join waits on the long branch: 2 + 5 + 2, not 2 + 1 + 2.
        assert_eq!(makespan, 9, "makespan must follow the long branch");
        assert_eq!(row("c-long").finish, 7);
        assert_eq!(row("b-short").finish, 3);
        assert_eq!(
            row("d-join").start,
            7,
            "join must start at the LONGER predecessor's finish, not the first one's"
        );

        // The critical path is exactly fork → c-long → d-join.
        for slug in ["fork", "c-long", "d-join"] {
            let r = row(slug);
            assert!(
                r.critical,
                "{slug} sits on the longer branch: must be critical"
            );
            assert_eq!(r.slack, 0, "{slug} is critical: slack must be 0");
        }
        // …and the short branch is off it, holding exactly the branch
        // difference (5 − 1) as slack. Both halves matter: a scheduler that
        // marked everything critical would pass the loop above alone.
        let short = row("b-short");
        assert!(!short.critical, "the shorter branch must NOT be critical");
        assert_eq!(short.slack, 4, "slack is the branch difference");
        assert_eq!(rows.iter().filter(|r| r.critical).count(), 3);

        // What the operator actually sees: critical bars solid, slack hatched.
        let blocks = p.gantt_blocks();
        let bar = |slug: &str| -> String {
            blocks
                .iter()
                .find_map(|b| match b {
                    Block::Row(cells) if cells[0] == slug => Some(cells[1].clone()),
                    _ => None,
                })
                .unwrap_or_else(|| panic!("no bar row for {slug}"))
        };
        let long_bar = bar("c-long");
        assert!(
            long_bar.contains('█') && !long_bar.contains('▓'),
            "critical bar must render solid: {long_bar:?}"
        );
        let short_bar = bar("b-short");
        assert!(
            short_bar.contains('▓') && !short_bar.contains('█'),
            "slack bar must render hatched, not solid: {short_bar:?}"
        );
    }

    #[test]
    fn gantt_join_waits_on_the_longest_path_not_the_direct_edge() {
        // The other diamond shape: a → b, then b reaches c BOTH directly and
        // the long way round through d. Only the detour has a node of its own,
        // so nothing here can carry slack (every task is on the longest path) —
        // what this pins is that the direct b → c edge does not let c start
        // early once a longer route to the same join exists.
        //
        //   a(2) 0..2 → b(3) 2..5 ─┬─────────────→ c(2)
        //                          └→ d(4) 5..9 ──┘  9..11   makespan 11
        let mut p = PlannerPane::default();
        p.items = vec![
            item_with("a", "now", &[], Some(2)),
            item_with("b", "backlog", &["a"], Some(3)),
            item_with("c", "backlog", &["b", "d"], Some(2)),
            item_with("d", "backlog", &["b"], Some(4)),
        ];
        let (rows, makespan) = p.gantt().expect("schedules");
        let row = |slug: &str| rows.iter().find(|r| r.slug == slug).unwrap();
        assert_eq!(makespan, 11);
        assert_eq!(
            row("c").start,
            9,
            "c must wait for the detour through d, not the direct edge from b"
        );
        // Every task lies on the longest path, so all four are critical.
        assert_eq!(rows.iter().filter(|r| r.critical).count(), 4);
        assert!(rows.iter().all(|r| r.slack == 0));
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
    fn axis_tick_step_adapts_from_days_to_weeks_to_quarters() {
        assert_eq!(axis_tick_step(1), 1);
        assert_eq!(axis_tick_step(8), 1); // 8 daily ticks still fit
        assert_eq!(axis_tick_step(9), 2); // …9 don't: step up to 2-day
        assert_eq!(axis_tick_step(16), 2);
        assert_eq!(axis_tick_step(17), 7); // weeks
        assert_eq!(axis_tick_step(56), 7);
        assert_eq!(axis_tick_step(57), 14); // fortnights
        assert_eq!(axis_tick_step(200), 28); // 4-week blocks
        assert_eq!(axis_tick_step(700), 91); // quarters
        assert_eq!(axis_tick_step(3000), 364 * 2); // beyond the ladder: whole years
    }

    #[test]
    fn axis_rows_anchor_today_and_align_ticks_with_bar_cells() {
        let today = time::Date::from_calendar_date(2026, time::Month::August, 22).unwrap();
        let rows = axis_rows(9, today);
        assert_eq!(rows.len(), 2);
        let (labels, ruler) = match (&rows[0], &rows[1]) {
            (Block::Row(a), Block::Row(b)) => (a.clone(), b.clone()),
            other => panic!("axis must be two Rows, got {other:?}"),
        };
        // Today-marker: unit 0 is labeled `today`, and later ticks carry real
        // MM-DD dates at the adaptive step (span 9 → 2-day ticks).
        assert!(labels[1].starts_with("today"), "labels: {:?}", labels[1]);
        assert!(labels[1].contains("08-24"), "labels: {:?}", labels[1]);
        // Meta cells stay empty on axis rows — the raster renderer's fixed
        // column thirds would collide meta text with the overflowing lane.
        assert_eq!(labels[2], "");
        assert_eq!(ruler[2], "");
        // Tick cells use the same integer mapping as bar lead cells, so a bar
        // starting at unit 2 begins exactly under the unit-2 tick.
        let ruler_cells: Vec<char> = ruler[1].chars().collect();
        assert_eq!(ruler_cells.len() as i64, BAR_CELLS + 1);
        assert_eq!(ruler_cells[0], '|'); // today
        assert_eq!(ruler_cells[(2 * BAR_CELLS / 9) as usize], '|');
        assert_eq!(ruler_cells[BAR_CELLS as usize], '|'); // schedule end is always framed
    }

    #[test]
    fn axis_drops_colliding_labels_but_never_their_ticks() {
        let today = time::Date::from_calendar_date(2026, time::Month::August, 22).unwrap();
        // span 364 → 91-day ticks: five labels of 5 chars across 41 cells fit
        // only where they keep a gap; every tick must still be marked.
        let rows = axis_rows(364, today);
        let (labels, ruler) = match (&rows[0], &rows[1]) {
            (Block::Row(a), Block::Row(b)) => (a.clone(), b.clone()),
            other => panic!("axis must be two Rows, got {other:?}"),
        };
        assert!(labels[1].len() <= (BAR_CELLS + 1) as usize);
        let ticks = ruler[1].chars().filter(|c| *c == '|').count();
        assert!(ticks >= 5, "expected ≥5 ticks on a year span, got {ticks}");
    }

    #[test]
    fn axis_stays_readable_at_the_tightest_spans() {
        // Sub-day spans are not representable: estimates are whole units and
        // `gantt_blocks` clamps with `.max(1)`, so ONE DAY is the tightest axis
        // this pane can ever be asked to draw. Every span on the bottom ladder
        // rung (step 1, up to 8 daily ticks) must still produce two well-formed
        // rows whose labels never run into one another — at these spans the
        // ticks are only 5 cells apart while a label is 5 chars wide, so the
        // collision-dropping in `axis_rows` is doing real work here.
        let today = time::Date::from_calendar_date(2026, time::Month::August, 22).unwrap();
        let lane = (BAR_CELLS + 1) as usize;
        for span in 1..=8 {
            assert_eq!(axis_tick_step(span), 1, "span {span} is a 1-day-step span");
            let rows = axis_rows(span, today);
            let (labels, ruler) = match (&rows[0], &rows[1]) {
                (Block::Row(a), Block::Row(b)) => (a[1].clone(), b[1].clone()),
                other => panic!("axis must be two Rows, got {other:?}"),
            };
            // The axis still renders: a full-width ruler framed at both ends.
            assert_eq!(
                ruler.chars().count(),
                lane,
                "span {span}: ruler must fill the bar lane"
            );
            assert!(
                ruler.starts_with('|') && ruler.ends_with('|'),
                "span {span}: today and the landing day must both be ticked: {ruler:?}"
            );
            assert!(
                labels.chars().count() <= lane,
                "span {span}: labels must not overrun the lane: {labels:?}"
            );
            // No collisions: a label written over its neighbour would splice
            // the two into a token that is neither `today` nor `MM-DD`.
            for tok in labels.split_whitespace() {
                let is_date = tok.len() == 5
                    && tok.as_bytes()[2] == b'-'
                    && tok.chars().filter(char::is_ascii_digit).count() == 4;
                assert!(
                    tok == "today" || is_date,
                    "span {span}: spliced/overlapping label {tok:?} in {labels:?}"
                );
            }
            // Labels are placed left to right with at least one space between
            // them, so the printed order is the chronological order.
            let printed: Vec<&str> = labels.split_whitespace().collect();
            assert_eq!(
                printed.first().copied(),
                Some("today"),
                "span {span}: unit 0 is always the today-marker: {labels:?}"
            );
            assert!(
                printed.len() <= 8,
                "span {span}: at most 8 labels fit the lane, got {}",
                printed.len()
            );
        }

        // The degenerate floor spelled out: a one-day plan is `today` at cell 0
        // and the landing tick at cell 40. The landing label does not fit
        // beside it (5 chars from cell 40 would overrun the 41-cell lane), so
        // it is dropped — but its TICK survives, which is the invariant that
        // keeps the geometry honest when the text will not fit.
        let rows = axis_rows(1, today);
        let (labels, ruler) = match (&rows[0], &rows[1]) {
            (Block::Row(a), Block::Row(b)) => (a[1].clone(), b[1].clone()),
            other => panic!("axis must be two Rows, got {other:?}"),
        };
        assert_eq!(labels, "today");
        assert_eq!(ruler.matches('|').count(), 2, "ruler: {ruler:?}");
        assert_eq!(ruler.chars().nth(BAR_CELLS as usize), Some('|'));
    }

    #[test]
    fn gantt_blocks_lead_with_the_time_axis_above_the_bars() {
        let mut p = PlannerPane::default();
        p.items = vec![
            item_with("a", "now", &[], Some(2)),
            item_with("b", "backlog", &["a"], Some(3)),
        ];
        let blocks = p.gantt_blocks();
        // Header, chip, then the axis label row, the ruler row, then bars —
        // one consecutive Row run so every renderer column-aligns axis + bars.
        let rows: Vec<&Vec<String>> = blocks
            .iter()
            .filter_map(|b| match b {
                Block::Row(cells) => Some(cells),
                _ => None,
            })
            .collect();
        assert!(rows.len() >= 4, "axis rows + bar rows expected");
        assert!(rows[0][1].starts_with("today"));
        assert!(rows[1][1].starts_with('|'));
        assert!(rows[2][1].contains('█') || rows[3][1].contains('█'));
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
        assert!(b.iter().any(|blk| matches!(
            blk,
            Block::LedgerRow { cells, .. }
                if cells.iter().any(|cell| {
                    cell.label == "purpose"
                        && cell.value.replace('\u{200b}', "").contains("roadmap delete verb")
                })
        )));
    }

    #[test]
    fn jira_unconfigured_state_names_the_missing_connection_without_hiding_local_authority() {
        let mut pane = PlannerPane::default();
        pane.items = vec![item("harbor-chat", "now", "Conversation-first console")];
        pane.jira_loaded = true;
        pane.jira_missing = vec![
            "PD_JIRA_BASE_URL".into(),
            "PD_JIRA_PROJECT_KEY".into(),
            "PD_JIRA_EMAIL".into(),
            "PD_JIRA_API_TOKEN".into(),
        ];

        let blocks = pane.view();
        assert!(blocks.iter().any(|block| matches!(
            block,
            Block::Chip { label, .. }
                if label == "PORT DADDY · LOCAL AUTHORITY · 1 ITEMS"
        )));
        assert!(blocks.iter().any(|block| matches!(
            block,
            Block::WrappedText { text, .. }
                if text.contains("JIRA NOT CONFIGURED")
                    && text.contains("PD_JIRA_API_TOKEN")
                    && text.contains("local roadmap remains available")
        )));
    }

    #[tokio::test]
    async fn jira_rows_sort_select_and_reveal_complete_source_metadata() {
        let mut pane = PlannerPane::default();
        pane.jira_loaded = true;
        pane.jira_configured = true;
        pane.jira_project_key = "HARBOR".into();
        pane.jira_base_url = "https://example.atlassian.net".into();
        pane.jira_items = vec![
            jira_item(
                "HARBOR-22",
                "Zeta: preserve every claim identity in narrow windows",
                "2026-08-28T12:00:00.000+0000",
            ),
            jira_item(
                "HARBOR-11",
                "Alpha: expose the complete shared Harbor roadmap",
                "2026-08-29T12:00:00.000+0000",
            ),
        ];
        let daemon = DaemonClient::new("http://127.0.0.1:9".into());

        pane.mutate(
            &daemon,
            SurfaceAction::Sort {
                key: "summary".into(),
            },
        )
        .await
        .unwrap();
        pane.mutate(&daemon, SurfaceAction::SelectRow { index: 0 })
            .await
            .unwrap();

        assert_eq!(pane.selected_jira_key.as_deref(), Some("HARBOR-11"));
        let blocks = pane.jira_blocks();
        assert!(blocks.iter().any(|block| matches!(
            block,
            Block::LedgerHeader {
                active_sort,
                descending: false,
                columns,
                ..
            } if active_sort == "summary"
                && columns.iter().any(|(key, label)| key == "assignee" && label == "Assignee")
                && columns.iter().any(|(key, label)| key == "due" && label == "Due")
        )));
        assert!(blocks.iter().any(|block| matches!(
            block,
            Block::LedgerRow {
                selected: true,
                cells,
                ..
            } if cells.iter().any(|cell| {
                cell.label == "summary"
                    && cell.value.replace('\u{200b}', "")
                        == "Alpha: expose the complete shared Harbor roadmap"
            })
        )));
        assert!(blocks.iter().any(|block| matches!(
            block,
            Block::WrappedText { text, .. }
                if text.replace('\u{200b}', "")
                    == "URL\nhttps://example.atlassian.net/browse/HARBOR-11"
        )));
        assert!(blocks.iter().any(|block| matches!(
            block,
            Block::WrappedText { text, .. } if text == "LABELS\nharbor, console"
        )));
    }

    #[tokio::test]
    async fn jira_priority_and_assignee_sorts_follow_the_visible_order() {
        let mut pane = PlannerPane::default();
        pane.jira_loaded = true;
        pane.jira_configured = true;
        let mut critical = jira_item(
            "HARBOR-22",
            "Critical issue owned by Grace",
            "2026-08-28T12:00:00.000+0000",
        );
        critical.priority = "Critical".into();
        critical.assignee = "Grace Hopper".into();
        let mut low = jira_item(
            "HARBOR-11",
            "Low issue owned by Ada",
            "2026-08-29T12:00:00.000+0000",
        );
        low.priority = "Low".into();
        low.assignee = "Ada Lovelace".into();
        pane.jira_items = vec![low, critical];
        let daemon = DaemonClient::new("http://127.0.0.1:9".into());

        pane.mutate(
            &daemon,
            SurfaceAction::Sort {
                key: "priority".into(),
            },
        )
        .await
        .unwrap();
        pane.mutate(&daemon, SurfaceAction::SelectRow { index: 0 })
            .await
            .unwrap();
        assert_eq!(pane.selected_jira_key.as_deref(), Some("HARBOR-22"));

        pane.mutate(
            &daemon,
            SurfaceAction::Sort {
                key: "assignee".into(),
            },
        )
        .await
        .unwrap();
        pane.mutate(&daemon, SurfaceAction::SelectRow { index: 0 })
            .await
            .unwrap();
        assert_eq!(pane.selected_jira_key.as_deref(), Some("HARBOR-11"));
        assert!(pane.jira_blocks().iter().any(|block| matches!(
            block,
            Block::LedgerHeader {
                active_sort,
                descending: false,
                ..
            } if active_sort == "assignee"
        )));
    }

    /// Epoch ms of `now + days` — the same shape `lib/roadmap-items.ts` stores
    /// for `startedAt`/`dueAt` (see `PlannerItem::from_value`'s doc comment).
    fn ms_days_from_now(days: i64) -> i64 {
        (time::OffsetDateTime::now_utc() + time::Duration::days(days)).unix_timestamp() * 1000
    }

    #[test]
    fn gantt_anchors_the_bar_to_real_dates_when_both_are_present() {
        // "dated" carries startedAt/dueAt 3 and 8 days out; "relative" carries
        // only an estimate and must stay on the plain CPM offset — proving
        // the two coexist in one schedule without cross-contaminating.
        let started = ms_days_from_now(3);
        let due = ms_days_from_now(8);
        let mut p = PlannerPane::default();
        p.items = vec![
            item_with_dates("dated", "now", &[], Some(1), Some(started), Some(due)),
            item_with("relative", "now", &[], Some(1)),
        ];
        let (rows, _makespan) = p.gantt().expect("schedules");

        let dated = rows.iter().find(|r| r.slug == "dated").unwrap();
        assert!(
            dated.date_anchored,
            "startedAt+dueAt present and valid: must date-anchor"
        );
        assert_eq!(
            dated.start, 3,
            "start must be the real wall-clock day-offset, not the CPM offset"
        );
        assert_eq!(
            dated.finish, 8,
            "finish must be the real wall-clock day-offset, not the CPM offset"
        );

        let relative = rows.iter().find(|r| r.slug == "relative").unwrap();
        assert!(
            !relative.date_anchored,
            "no startedAt/dueAt: must stay on the relative schedule"
        );
        assert_eq!(relative.start, 0);
        assert_eq!(relative.finish, 1);

        // What the operator actually sees: only the anchored row's meta
        // column carries the DATED tag.
        let blocks = p.gantt_blocks();
        let meta_for = |slug: &str| -> String {
            blocks
                .iter()
                .find_map(|b| match b {
                    Block::Row(cells) if cells[0] == slug => Some(cells[2].clone()),
                    _ => None,
                })
                .unwrap_or_else(|| panic!("no bar row for {slug}"))
        };
        assert!(meta_for("dated").contains("DATED"));
        assert!(!meta_for("relative").contains("DATED"));
    }

    #[test]
    fn gantt_falls_back_to_relative_schedule_when_dates_are_absent_regression_pin() {
        // Backward-compat pin: an item with NO startedAt/dueAt must produce
        // the exact same GanttRow geometry as before date-anchoring existed —
        // this is `gantt_chains_dependencies_and_marks_critical_path`'s fixture,
        // re-asserted here so a future change to the date-anchoring pass can
        // never silently regress the far-more-common no-dates path.
        let mut p = PlannerPane::default();
        p.items = vec![
            item_with("a", "now", &[], Some(2)),
            item_with("b", "backlog", &["a"], Some(3)),
            item_with("c", "backlog", &[], Some(1)),
        ];
        let (rows, makespan) = p.gantt().expect("schedules");
        assert_eq!(makespan, 5);
        assert!(
            rows.iter().all(|r| !r.date_anchored),
            "no item in this fixture carries startedAt/dueAt"
        );
        let b = rows.iter().find(|r| r.slug == "b").unwrap();
        assert_eq!(b.start, 2);
        assert_eq!(b.finish, 5);
        assert!(b.critical);
        let c = rows.iter().find(|r| r.slug == "c").unwrap();
        assert!(!c.critical);
        assert_eq!(c.slack, 4);
    }

    #[test]
    fn gantt_requires_both_started_and_due_to_anchor() {
        // Only startedAt, only dueAt, or a due date before the start date —
        // each is a partial/invalid pair and must fall back to the CPM
        // offset exactly like an item carrying neither field.
        let started = ms_days_from_now(2);
        let due = ms_days_from_now(6);
        let mut p = PlannerPane::default();
        p.items = vec![
            item_with_dates("only-started", "now", &[], Some(1), Some(started), None),
            item_with_dates("only-due", "now", &[], Some(1), None, Some(due)),
            item_with_dates(
                "due-before-started",
                "now",
                &[],
                Some(1),
                Some(due),
                Some(started),
            ),
        ];
        let (rows, _makespan) = p.gantt().expect("schedules");
        for r in &rows {
            assert!(
                !r.date_anchored,
                "{}: partial/invalid date pair must not anchor",
                r.slug
            );
        }
    }

    #[test]
    fn gantt_blocks_widen_the_render_span_for_a_date_anchored_bar_beyond_the_cpm_makespan() {
        // A date-anchored due date can land well past the CPM makespan (the
        // schedule only knows about effort/deps, not real dates). The bar
        // lane must still stay inside its cell budget — the panic-safety
        // regression pin for the render-span-widening logic in gantt_blocks
        // (a raw `r.finish > span` would have gone negative/overflowed the
        // usize cast on `lead`/`fill`).
        let started = ms_days_from_now(50);
        let due = ms_days_from_now(120);
        let mut p = PlannerPane::default();
        p.items = vec![item_with_dates(
            "far-out",
            "now",
            &[],
            Some(1),
            Some(started),
            Some(due),
        )];
        let blocks = p.gantt_blocks();
        for b in &blocks {
            if let Block::Row(cols) = b {
                assert_eq!(cols.len(), 3);
                assert!(
                    cols[1].chars().count() <= 41,
                    "bar must stay inside the 40-cell lane (+rounding): {} cells",
                    cols[1].chars().count()
                );
            }
        }
    }
}
