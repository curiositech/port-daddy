//! Session Galaxy pane — the 2D embedding map of recent agent sessions over
//! `GET /galaxy/map`. The DAEMON precomputes everything expensive (MiniLM tail
//! embeddings, seeded t-SNE coords normalized to [0,1], k-means clusters with
//! MI term labels); this engine only fetches, parses, and answers geometry
//! queries. Deliberately gpui-free so parsing, hit-testing, selection math, and
//! detail formatting are all unit-tested in the headless REPL bin (the
//! rust-console CI gate). The interactive canvas lives in `galaxy_canvas.rs`.

use crate::agent::DaemonClient;
use crate::pane::{Block, Pane, Tone};
use crate::util::{age_short, arr, n, s, trunc};
use anyhow::Result;
use serde_json::Value;
use std::collections::{HashMap, HashSet};

/// Float field — 0.0 when missing/null. Accepts numeric strings (schema drift).
fn f(v: &Value, key: &str) -> f32 {
    match v.get(key) {
        Some(Value::Number(x)) => x.as_f64().unwrap_or(0.0) as f32,
        Some(Value::String(x)) => x.parse().unwrap_or(0.0),
        _ => 0.0,
    }
}

/// Optional string field — `None` when missing/null/empty.
fn opt_s(v: &Value, key: &str) -> Option<String> {
    let out = s(v, key);
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

/// First non-empty string across candidate keys (the daemon's wire casing has
/// drifted between snake_case sqlite rows and camelCase JSON before).
fn first_s(v: &Value, keys: &[&str]) -> String {
    keys.iter()
        .map(|k| s(v, k))
        .find(|out| !out.is_empty())
        .unwrap_or_default()
}

/// One session point on the map: a `fleet_transcripts` row the daemon embedded
/// and projected. `id` is the transcript id (the key for `GET /galaxy/session/:id`);
/// `agent_id` is the PARLEY party id (`spawned_agent_id`) — never the session id.
#[derive(Debug, Clone)]
pub struct GalaxyPoint {
    pub id: String,
    pub session_id: Option<String>,
    pub agent_id: String,
    pub ship: Option<String>,
    pub project: Option<String>,
    pub purpose: Option<String>,
    pub status: String,
    /// Normalized map coords in [0, 1] — the daemon owns the layout math.
    pub x: f32,
    pub y: f32,
    /// 0..k-1, reindexed by cluster size desc (0 = biggest) for stable-ish colors.
    pub cluster_id: usize,
    pub snippet: String,
    pub pr_number: Option<i64>,
    pub tail_tokens: i64,
}

impl GalaxyPoint {
    pub fn from_value(v: &Value) -> Self {
        Self {
            id: s(v, "id"),
            session_id: opt_s(v, "sessionId"),
            agent_id: s(v, "agentId"),
            ship: opt_s(v, "ship"),
            project: opt_s(v, "project"),
            purpose: opt_s(v, "purpose"),
            status: s(v, "status"),
            x: f(v, "x").clamp(0.0, 1.0),
            y: f(v, "y").clamp(0.0, 1.0),
            cluster_id: n(v, "clusterId").max(0) as usize,
            snippet: s(v, "snippet"),
            pr_number: v.get("prNumber").and_then(Value::as_i64),
            tail_tokens: n(v, "tailTokens"),
        }
    }
}

/// One k-means cluster: MI-term label + centroid (normalized map space) for
/// label placement. `id` matches `GalaxyPoint::cluster_id`.
#[derive(Debug, Clone)]
pub struct GalaxyCluster {
    pub id: usize,
    pub label: String,
    pub terms: Vec<String>,
    pub size: usize,
    pub cx: f32,
    pub cy: f32,
}

impl GalaxyCluster {
    pub fn from_value(v: &Value) -> Self {
        let (cx, cy) = match v.get("centroid") {
            Some(Value::Array(a)) => (
                a.first().and_then(Value::as_f64).unwrap_or(0.5) as f32,
                a.get(1).and_then(Value::as_f64).unwrap_or(0.5) as f32,
            ),
            _ => (0.5, 0.5),
        };
        Self {
            id: n(v, "id").max(0) as usize,
            label: s(v, "label"),
            terms: arr(v, "terms")
                .iter()
                .map(|t| s(t, "term"))
                .filter(|t| !t.is_empty())
                .collect(),
            size: n(v, "size").max(0) as usize,
            cx: cx.clamp(0.0, 1.0),
            cy: cy.clamp(0.0, 1.0),
        }
    }
}

/// Parse a whole `GET /galaxy/map` response body. Tolerates missing keys,
/// nulls, and empty maps — degenerate responses parse to empty vecs, never an
/// error (the pane renders stale-but-sane, per the util.rs doctrine).
pub fn from_value(v: &Value) -> (Vec<GalaxyPoint>, Vec<GalaxyCluster>, Option<i64>) {
    let points = arr(v, "points")
        .iter()
        .map(GalaxyPoint::from_value)
        .filter(|p| !p.id.is_empty())
        .collect();
    let clusters = arr(v, "clusters").iter().map(GalaxyCluster::from_value).collect();
    let computed = n(v, "computedAt");
    (points, clusters, (computed > 0).then_some(computed))
}

/// The cluster → semantic-tone contract shared with fleet-ui: `clusterId % 8`
/// into the SAME order both UIs use — accent, engaged, gated, resting, landed,
/// conflicted, alarm, muted. No hex literals; the renderer resolves the tone
/// through the live theme.
pub fn cluster_tone(cluster_id: usize) -> Tone {
    match cluster_id % 8 {
        0 => Tone::Accent,
        1 => Tone::Engaged,
        2 => Tone::Gated,
        3 => Tone::Resting,
        4 => Tone::Landed,
        5 => Tone::Conflicted,
        6 => Tone::Alarm,
        _ => Tone::Default, // ink2/muted — the 8th slot of the shared cycle
    }
}

// ── Pure geometry (the canvas delegates here so the REPL bin tests it) ───────

/// Point ids inside the (inclusive) rectangle in NORMALIZED map space. Corners
/// may arrive in any order (a drag can travel up-left); they are re-sorted here.
pub fn rect_hits(points: &[GalaxyPoint], x0: f32, y0: f32, x1: f32, y1: f32) -> Vec<String> {
    let (lo_x, hi_x) = (x0.min(x1), x0.max(x1));
    let (lo_y, hi_y) = (y0.min(y1), y0.max(y1));
    points
        .iter()
        .filter(|p| p.x >= lo_x && p.x <= hi_x && p.y >= lo_y && p.y <= hi_y)
        .map(|p| p.id.clone())
        .collect()
}

/// The nearest point within `max_d` (normalized distance) of (x, y), or `None`.
/// Ties break toward the earlier point (stable — the daemon sends
/// most-recent-first, so the newer session wins an exact overlap).
pub fn nearest_point<'a>(
    points: &'a [GalaxyPoint],
    x: f32,
    y: f32,
    max_d: f32,
) -> Option<&'a GalaxyPoint> {
    let max_sq = max_d * max_d;
    let mut best: Option<(&GalaxyPoint, f32)> = None;
    for p in points {
        let (dx, dy) = (p.x - x, p.y - y);
        let d_sq = dx * dx + dy * dy;
        if d_sq <= max_sq && best.map(|(_, b)| d_sq < b).unwrap_or(true) {
            best = Some((p, d_sq));
        }
    }
    best.map(|(p, _)| p)
}

// ── Selection math (parley preconditions live here, tested headlessly) ───────

/// Distinct agent ids across the selected points, in selection-iteration order.
/// These are the PARLEY PARTIES (`spawned_agent_id`) — the daemon 400s below 2,
/// so the UIs disable the button on `len() < 2`.
pub fn distinct_agents(points: &[GalaxyPoint], selected: &HashSet<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for p in points.iter().filter(|p| selected.contains(&p.id)) {
        if !p.agent_id.is_empty() && seen.insert(p.agent_id.clone()) {
            out.push(p.agent_id.clone());
        }
    }
    out
}

/// The cluster holding the most selected points (ties → the smaller id, i.e.
/// the bigger cluster, since the daemon reindexes by size desc).
pub fn dominant_cluster<'a>(
    points: &[GalaxyPoint],
    clusters: &'a [GalaxyCluster],
    selected: &HashSet<String>,
) -> Option<&'a GalaxyCluster> {
    let mut counts: HashMap<usize, usize> = HashMap::new();
    for p in points.iter().filter(|p| selected.contains(&p.id)) {
        *counts.entry(p.cluster_id).or_default() += 1;
    }
    clusters
        .iter()
        .filter(|c| counts.contains_key(&c.id))
        .max_by_key(|c| (counts[&c.id], std::cmp::Reverse(c.id)))
}

/// Kebab a free-text label for the parley surface string: lowercase ascii
/// alphanumerics joined by single dashes, everything else collapsed.
fn kebab(text: &str) -> String {
    let mut out = String::new();
    for ch in text.chars() {
        let c = ch.to_ascii_lowercase();
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.is_empty() && !out.ends_with('-') {
            out.push('-');
        }
    }
    out.trim_end_matches('-').to_string()
}

/// The `surface` string for `POST /parley/call`, per the cross-lane contract:
/// `galaxy:<top selection-cluster terms, kebab-joined, <=64 chars total>`.
pub fn parley_surface(
    points: &[GalaxyPoint],
    clusters: &[GalaxyCluster],
    selected: &HashSet<String>,
) -> String {
    let topic = dominant_cluster(points, clusters, selected)
        .map(|c| {
            if c.terms.is_empty() {
                kebab(&c.label)
            } else {
                kebab(&c.terms.join(" "))
            }
        })
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| "selection".to_string());
    let mut surface = format!("galaxy:{topic}");
    if surface.len() > 64 {
        surface.truncate(64); // kebab() output is pure ASCII — safe to byte-cut
        while surface.ends_with('-') {
            surface.pop();
        }
    }
    surface
}

/// The default operator reason when none is typed, per the contract:
/// `Operator convened parley from session galaxy cluster "<label>" (<n> sessions)`.
pub fn default_reason(
    points: &[GalaxyPoint],
    clusters: &[GalaxyCluster],
    selected: &HashSet<String>,
) -> String {
    let n_sel = points.iter().filter(|p| selected.contains(&p.id)).count();
    let label = dominant_cluster(points, clusters, selected)
        .map(|c| c.label.clone())
        .filter(|l| !l.is_empty())
        .unwrap_or_else(|| "mixed".to_string());
    format!("Operator convened parley from session galaxy cluster \"{label}\" ({n_sel} sessions)")
}

// ── Session detail (GET /galaxy/session/:id) ─────────────────────────────────

/// Parsed session detail — everything the drawer renders, pre-formatted into
/// display strings so the gpui layer stays dumb.
#[derive(Debug, Clone, Default)]
pub struct GalaxyDetail {
    pub transcript_id: String,
    pub agent_id: String,
    pub ship: String,
    pub project: String,
    pub status: String,
    pub session_id: String,
    pub purpose: String,
    pub notes: Vec<String>,
    pub files: Vec<String>,
    pub tool_uses: Vec<String>,
    /// Best-effort linked artifacts (PRs/commits/issues). Absence ≠ no PRs were
    /// produced — the spawner only records what it captured.
    pub prs: Vec<String>,
    /// (speaker, text) turns from the full transcript.
    pub messages: Vec<(String, String)>,
}

/// A message's display text: plain string content, or a content-parts array
/// (each a string or `{text}` object), or a `text` field — whichever is there.
fn message_text(m: &Value) -> String {
    match m.get("content") {
        Some(Value::String(t)) => t.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .map(|p| match p {
                Value::String(t) => t.clone(),
                other => s(other, "text"),
            })
            .filter(|t| !t.is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        _ => s(m, "text"),
    }
}

/// Parse a whole `GET /galaxy/session/:id` response body (tolerates being
/// handed either the envelope or the bare detail object).
pub fn detail_from_value(v: &Value) -> GalaxyDetail {
    let detail = v.get("detail").unwrap_or(v);
    let null = Value::Null;
    let transcript = detail.get("transcript").unwrap_or(&null);
    let session = detail.get("session").filter(|sv| !sv.is_null());

    let mut d = GalaxyDetail {
        transcript_id: s(transcript, "id"),
        agent_id: first_s(transcript, &["spawned_agent_id", "spawnedAgentId", "agentId"]),
        ship: s(transcript, "ship"),
        project: s(transcript, "project"),
        status: s(transcript, "status"),
        ..GalaxyDetail::default()
    };
    if let Some(sv) = session {
        d.session_id = s(sv, "id");
        d.purpose = s(sv, "purpose");
    }
    d.notes = arr(detail, "notes")
        .iter()
        .map(|nv| {
            let kind = s(nv, "type");
            let content = s(nv, "content");
            if kind.is_empty() {
                content
            } else if content.is_empty() {
                String::new()
            } else {
                format!("[{kind}] {content}")
            }
        })
        .filter(|x| !x.is_empty())
        .collect();
    d.files = arr(detail, "files")
        .iter()
        .map(|fv| {
            let mut out = first_s(fv, &["filePath", "file_path"]);
            if out.is_empty() {
                return out;
            }
            let (start, end) = (n(fv, "startLine"), n(fv, "endLine"));
            if start > 0 && end > 0 {
                out.push_str(&format!(":{start}-{end}"));
            }
            let symbol = s(fv, "symbol");
            if !symbol.is_empty() {
                out.push_str(&format!(" · {symbol}"));
            }
            out
        })
        .filter(|x| !x.is_empty())
        .collect();
    d.tool_uses = arr(detail, "toolUses")
        .iter()
        .map(|tv| {
            let name = s(tv, "name");
            if name.is_empty() {
                return name;
            }
            let args = tv
                .get("args")
                .filter(|a| !a.is_null())
                .and_then(|a| serde_json::to_string(a).ok())
                .unwrap_or_default();
            if args.is_empty() {
                name
            } else {
                format!("{name} {}", trunc(&args, 120))
            }
        })
        .filter(|x| !x.is_empty())
        .collect();
    d.prs = arr(detail, "prs")
        .iter()
        .map(|pv| {
            let mut parts = Vec::new();
            if let Some(num) = pv.get("prNumber").and_then(Value::as_i64) {
                parts.push(format!("PR #{num}"));
            }
            let kind = s(pv, "type");
            if !kind.is_empty() {
                parts.push(kind);
            }
            let summary = s(pv, "summary");
            if !summary.is_empty() {
                parts.push(trunc(&summary, 140));
            }
            let url = s(pv, "url");
            if !url.is_empty() {
                parts.push(url);
            }
            parts.join(" · ")
        })
        .filter(|x| !x.is_empty())
        .collect();
    d.messages = arr(transcript, "messages")
        .iter()
        .map(|mv| {
            let role = s(mv, "role");
            let speaker = if role.is_empty() { "agent".to_string() } else { role };
            (speaker, message_text(mv))
        })
        .filter(|(_, text)| !text.trim().is_empty())
        .collect();
    d
}

/// Cap on rendered tool-use rows / transcript turns so a monster session can't
/// wedge the render; the omission is stated, never silent.
const DETAIL_TOOL_CAP: usize = 40;
const DETAIL_TURN_CAP: usize = 60;

/// The drawer's render-agnostic blocks (the GPUI canvas paints these via the
/// shared Block renderer; the terminal face could paint the same list).
pub fn detail_blocks(d: &GalaxyDetail) -> Vec<Block> {
    let mut blocks = vec![Block::Header(format!(
        "Session detail — {}",
        trunc(&d.transcript_id, 28)
    ))];
    if !d.purpose.is_empty() {
        blocks.push(Block::KeyVal("purpose".into(), d.purpose.clone()));
    }
    if !d.agent_id.is_empty() {
        blocks.push(Block::KeyVal("agent".into(), d.agent_id.clone()));
    }
    if !d.ship.is_empty() {
        blocks.push(Block::KeyVal("ship".into(), d.ship.clone()));
    }
    if !d.project.is_empty() {
        blocks.push(Block::KeyVal("project".into(), d.project.clone()));
    }
    if !d.status.is_empty() {
        blocks.push(Block::KeyVal("status".into(), d.status.clone()));
    }
    if !d.session_id.is_empty() {
        blocks.push(Block::KeyVal("session".into(), d.session_id.clone()));
    }
    blocks.push(Block::Gap);

    // PR provenance is BEST-EFFORT (the spawner default records only
    // message/noop outputs) — say "linked artifacts", render an explicit
    // "none recorded" state, and never imply no PRs were produced.
    blocks.push(Block::Chip {
        label: "linked artifacts (best-effort)".into(),
        tone: Tone::Accent,
    });
    if d.prs.is_empty() {
        blocks.push(Block::KeyVal("  artifacts".into(), "none recorded".into()));
    } else {
        for pr in &d.prs {
            blocks.push(Block::ArtifactRef {
                label: "artifact".into(),
                path: pr.clone(),
                preview: None,
                tone: Tone::Landed,
            });
        }
    }
    blocks.push(Block::Gap);

    blocks.push(Block::Chip {
        label: "files touched".into(),
        tone: Tone::Engaged,
    });
    if d.files.is_empty() {
        blocks.push(Block::KeyVal("  files".into(), "no file claims recorded".into()));
    } else {
        for file in &d.files {
            blocks.push(Block::Row(vec!["▸".into(), file.clone()]));
        }
    }
    blocks.push(Block::Gap);

    blocks.push(Block::Chip {
        label: "tool uses".into(),
        tone: Tone::Resting,
    });
    if d.tool_uses.is_empty() {
        blocks.push(Block::KeyVal("  tools".into(), "no tool calls recorded".into()));
    } else {
        for tool in d.tool_uses.iter().take(DETAIL_TOOL_CAP) {
            blocks.push(Block::Row(vec!["⚙".into(), tool.clone()]));
        }
        if d.tool_uses.len() > DETAIL_TOOL_CAP {
            blocks.push(Block::KeyVal(
                "  more".into(),
                format!("+{} further tool calls", d.tool_uses.len() - DETAIL_TOOL_CAP),
            ));
        }
    }

    if !d.notes.is_empty() {
        blocks.push(Block::Gap);
        blocks.push(Block::Chip {
            label: "session notes".into(),
            tone: Tone::Landed,
        });
        for note in &d.notes {
            blocks.push(Block::WrappedText {
                text: note.clone(),
                tone: Tone::Default,
            });
        }
    }

    blocks.push(Block::Gap);
    blocks.push(Block::Chip {
        label: "transcript".into(),
        tone: Tone::Accent,
    });
    if d.messages.is_empty() {
        blocks.push(Block::KeyVal("  transcript".into(), "no messages recorded".into()));
    } else {
        let skipped = d.messages.len().saturating_sub(DETAIL_TURN_CAP);
        if skipped > 0 {
            blocks.push(Block::KeyVal(
                "  earlier".into(),
                format!("{skipped} earlier turn(s) omitted — showing the tail"),
            ));
        }
        for (speaker, text) in d.messages.iter().skip(skipped) {
            let tone = match speaker.to_ascii_lowercase().as_str() {
                "operator" | "user" => Tone::Accent,
                "tool" | "system" => Tone::Resting,
                _ => Tone::Engaged,
            };
            blocks.push(Block::ChatTurn {
                speaker: speaker.clone(),
                text: text.clone(),
                tone,
            });
        }
    }
    blocks
}

// ── The pane ─────────────────────────────────────────────────────────────────

/// A cloneable frame of the galaxy the producer thread ships to the GPUI view
/// each refresh (alongside the pane blocks), so the bespoke canvas renders the
/// REAL points, not a re-parse of display text.
#[derive(Debug, Clone, Default)]
pub struct GalaxySnapshot {
    pub points: Vec<GalaxyPoint>,
    pub clusters: Vec<GalaxyCluster>,
    pub computed_at: Option<i64>,
    pub last_error: Option<String>,
    /// The query window the map was fetched with — the canvas header renders
    /// it, so a scripted param change is visible, not silently applied.
    pub window_hours: u32,
}

pub struct GalaxyPane {
    pub points: Vec<GalaxyPoint>,
    pub clusters: Vec<GalaxyCluster>,
    pub computed_at: Option<i64>,
    last_error: Option<String>,
    /// Query window in hours. Scriptable (control socket `galaxy` command);
    /// the daemon clamps its own bounds.
    window_hours: u32,
    /// Significance floor; `None` inherits the daemon default.
    min_tokens: Option<u32>,
}

impl Default for GalaxyPane {
    fn default() -> Self {
        Self {
            points: Vec::new(),
            clusters: Vec::new(),
            computed_at: None,
            last_error: None,
            window_hours: 24,
            min_tokens: None,
        }
    }
}

impl GalaxyPane {
    pub fn new() -> Self {
        Self::default()
    }

    /// Apply scripted query params (control socket `galaxy` command). Only the
    /// provided fields change; the next 2s refresh picks them up.
    pub fn set_params(&mut self, window_hours: Option<u32>, min_tokens: Option<u32>) {
        if let Some(h) = window_hours {
            self.window_hours = h.max(1);
        }
        if let Some(m) = min_tokens {
            self.min_tokens = Some(m);
        }
    }

    /// The query string the next refresh will send — pure, so tests can pin
    /// the scripted-params → wire-request contract without HTTP.
    pub fn query(&self) -> String {
        match self.min_tokens {
            Some(m) => format!("windowHours={}&minTokens={}", self.window_hours, m),
            None => format!("windowHours={}", self.window_hours),
        }
    }

    /// The frame the producer ships to the view each refresh.
    pub fn snapshot(&self) -> GalaxySnapshot {
        GalaxySnapshot {
            points: self.points.clone(),
            clusters: self.clusters.clone(),
            computed_at: self.computed_at,
            last_error: self.last_error.clone(),
            window_hours: self.window_hours,
        }
    }
}

impl Pane for GalaxyPane {
    fn id(&self) -> &str {
        "galaxy"
    }

    fn title(&self) -> String {
        "Galaxy".into()
    }

    fn view(&self) -> Vec<Block> {
        let mut blocks = vec![Block::Header("Session Galaxy".into())];

        if let Some(err) = &self.last_error {
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            return blocks;
        }

        blocks.push(Block::KeyVal("sessions".into(), self.points.len().to_string()));
        blocks.push(Block::KeyVal("clusters".into(), self.clusters.len().to_string()));
        if let Some(at) = self.computed_at {
            blocks.push(Block::KeyVal("computed".into(), age_short(at)));
        }

        if self.points.is_empty() {
            blocks.push(Block::KeyVal(
                "status".into(),
                "no sessions in the window — fleet ships and harnessed agents appear here".into(),
            ));
            return blocks;
        }

        blocks.push(Block::Gap);
        for cluster in &self.clusters {
            blocks.push(Block::Chip {
                label: format!("{} — {} session(s)", trunc(&cluster.label, 48), cluster.size),
                tone: cluster_tone(cluster.id),
            });
            if !cluster.terms.is_empty() {
                blocks.push(Block::KeyVal(
                    "  terms".into(),
                    trunc(&cluster.terms.join(" · "), 92),
                ));
            }
        }
        blocks
    }

    fn refresh<'a>(
        &'a mut self,
        daemon: &'a DaemonClient,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            // Daemon-owned defaults: omitting tailTokens/limit inherits them;
            // the daemon's 30s response cache absorbs the 2s pane cadence.
            // window/minTokens are pane state so the control socket can steer them.
            let url = format!("{}/galaxy/map?{}", daemon.base(), self.query());
            match daemon.http_client().get(&url).send().await {
                Err(e) => {
                    self.last_error = Some(format!("daemon unreachable: {e}"));
                    self.points.clear();
                    self.clusters.clear();
                }
                Ok(resp) => {
                    let status = resp.status();
                    if !status.is_success() {
                        self.last_error = Some(format!("GET /galaxy/map -> {status}"));
                        self.points.clear();
                        self.clusters.clear();
                        return Ok(());
                    }
                    match resp.json::<Value>().await {
                        Err(e) => self.last_error = Some(format!("bad response: {e}")),
                        Ok(data) => {
                            self.last_error = None;
                            let (points, clusters, computed_at) = from_value(&data);
                            self.points = points;
                            self.clusters = clusters;
                            self.computed_at = computed_at;
                        }
                    }
                }
            }
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn map_fixture() -> Value {
        json!({
            "success": true,
            "computedAt": 1_751_600_000_000_i64,
            "params": { "windowHours": 24, "tailTokens": 4000, "minTokens": 256, "limit": 500, "project": null },
            "points": [
                {
                    "id": "tr-1", "sessionId": "sess-1", "agentId": "agent-a",
                    "ship": "night-watch", "project": "port-daddy", "identity": null,
                    "purpose": "fix sqlite wal", "status": "completed",
                    "startedAt": 1, "endedAt": 2, "tailTokens": 900,
                    "x": 0.10, "y": 0.20, "clusterId": 0,
                    "snippet": "migrated the wal", "prNumber": 662
                },
                {
                    "id": "tr-2", "sessionId": null, "agentId": "agent-b",
                    "ship": null, "project": "port-daddy", "purpose": null,
                    "status": "running", "startedAt": 3, "endedAt": null, "tailTokens": 512,
                    "x": 0.90, "y": 0.85, "clusterId": 1,
                    "snippet": "polishing the console", "prNumber": null
                },
                {
                    "id": "tr-3", "agentId": "agent-a", "status": "failed",
                    "x": 0.12, "y": 0.22, "clusterId": 0,
                    "snippet": "wal checkpoint", "tailTokens": 300
                }
            ],
            "clusters": [
                {
                    "id": 0, "label": "sqlite migration · wal",
                    "terms": [ { "term": "sqlite migration", "mi": 0.4 }, { "term": "wal", "mi": 0.3 } ],
                    "size": 2, "centroid": [0.11, 0.21]
                },
                {
                    "id": 1, "label": "console polish",
                    "terms": [ { "term": "console", "mi": 0.5 } ],
                    "size": 1, "centroid": [0.9, 0.85]
                }
            ],
            "stats": { "sessionCount": 3, "embeddedNow": 1, "cacheHits": 2, "elapsedMs": 40 }
        })
    }

    fn selected(ids: &[&str]) -> HashSet<String> {
        ids.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn parses_the_map_response() {
        let (points, clusters, computed_at) = from_value(&map_fixture());
        assert_eq!(points.len(), 3);
        assert_eq!(clusters.len(), 2);
        assert_eq!(computed_at, Some(1_751_600_000_000));

        let p = &points[0];
        assert_eq!(p.id, "tr-1");
        assert_eq!(p.session_id.as_deref(), Some("sess-1"));
        assert_eq!(p.agent_id, "agent-a");
        assert_eq!(p.purpose.as_deref(), Some("fix sqlite wal"));
        assert_eq!(p.status, "completed");
        assert_eq!(p.cluster_id, 0);
        assert_eq!(p.pr_number, Some(662));
        assert!((p.x - 0.10).abs() < 1e-6 && (p.y - 0.20).abs() < 1e-6);

        // Nulls become None, not "" masquerading as data.
        assert_eq!(points[1].session_id, None);
        assert_eq!(points[1].ship, None);
        assert_eq!(points[1].pr_number, None);

        let c = &clusters[0];
        assert_eq!(c.label, "sqlite migration · wal");
        assert_eq!(c.terms, vec!["sqlite migration", "wal"]);
        assert_eq!(c.size, 2);
        assert!((c.cx - 0.11).abs() < 1e-6 && (c.cy - 0.21).abs() < 1e-6);
    }

    #[test]
    fn tolerates_empty_and_malformed_json() {
        let (points, clusters, computed_at) = from_value(&json!({}));
        assert!(points.is_empty() && clusters.is_empty() && computed_at.is_none());

        // Wrong types everywhere — parses to sane defaults, never panics.
        let (points, clusters, _) = from_value(&json!({
            "computedAt": "soon",
            "points": [ { "id": "ok", "x": "0.5", "y": null, "clusterId": -3 }, { "x": 1 } ],
            "clusters": [ { "id": null, "centroid": "not-an-array", "terms": null } ]
        }));
        // The id-less point is dropped; the string-x point parses.
        assert_eq!(points.len(), 1);
        assert!((points[0].x - 0.5).abs() < 1e-6);
        assert_eq!(points[0].y, 0.0);
        assert_eq!(points[0].cluster_id, 0, "negative clusterId clamps to 0");
        assert_eq!(clusters.len(), 1);
        assert!((clusters[0].cx - 0.5).abs() < 1e-6, "missing centroid → center");
    }

    #[test]
    fn rect_hits_is_inclusive_and_corner_order_free() {
        let (points, _, _) = from_value(&map_fixture());
        // Rect around the sqlite pair — corners given inverted on purpose.
        let hits = rect_hits(&points, 0.15, 0.25, 0.05, 0.15);
        assert_eq!(hits, vec!["tr-1".to_string(), "tr-3".to_string()]);
        // Boundary-inclusive: a rect whose edge sits exactly on the point.
        let edge = rect_hits(&points, 0.10, 0.20, 0.10, 0.20);
        assert_eq!(edge, vec!["tr-1".to_string()]);
        // Far corner excludes everything.
        assert!(rect_hits(&points, 0.4, 0.4, 0.6, 0.6).is_empty());
    }

    #[test]
    fn nearest_point_respects_max_d_and_ties_break_stable() {
        let (points, _, _) = from_value(&map_fixture());
        let hit = nearest_point(&points, 0.11, 0.21, 0.05).expect("a near point");
        assert_eq!(hit.id, "tr-1");
        assert!(nearest_point(&points, 0.5, 0.5, 0.05).is_none());
        // Exact tie between two equidistant points → the earlier one wins.
        let mut twin = points.clone();
        twin[2].x = 0.10;
        twin[2].y = 0.30; // tr-1 at (0.10,0.20), tr-3 at (0.10,0.30); probe midway
        let tie = nearest_point(&twin, 0.10, 0.25, 0.10).expect("a tie hit");
        assert_eq!(tie.id, "tr-1");
    }

    #[test]
    fn distinct_agents_dedupes_for_parley_parties() {
        let (points, _, _) = from_value(&map_fixture());
        // tr-1 and tr-3 share agent-a: one party, not two — parley must stay disabled.
        let one = distinct_agents(&points, &selected(&["tr-1", "tr-3"]));
        assert_eq!(one, vec!["agent-a".to_string()]);
        let two = distinct_agents(&points, &selected(&["tr-1", "tr-2", "tr-3"]));
        assert_eq!(two, vec!["agent-a".to_string(), "agent-b".to_string()]);
        assert!(distinct_agents(&points, &HashSet::new()).is_empty());
    }

    #[test]
    fn parley_surface_and_default_reason_follow_the_contract() {
        let (points, clusters, _) = from_value(&map_fixture());
        let sel = selected(&["tr-1", "tr-2", "tr-3"]);
        // Cluster 0 holds 2 of 3 selected points → its terms drive the surface.
        assert_eq!(parley_surface(&points, &clusters, &sel), "galaxy:sqlite-migration-wal");
        assert_eq!(
            default_reason(&points, &clusters, &sel),
            "Operator convened parley from session galaxy cluster \"sqlite migration · wal\" (3 sessions)"
        );
        // Empty selection degrades honestly.
        assert_eq!(parley_surface(&points, &clusters, &HashSet::new()), "galaxy:selection");
    }

    #[test]
    fn parley_surface_truncates_to_64_chars() {
        let long_terms: Vec<Value> = (0..12)
            .map(|i| json!({ "term": format!("extraordinarily-long-term-{i}"), "mi": 0.1 }))
            .collect();
        let v = json!({
            "points": [ { "id": "tr-1", "agentId": "a", "x": 0.5, "y": 0.5, "clusterId": 0 } ],
            "clusters": [ { "id": 0, "label": "long", "terms": long_terms, "size": 1, "centroid": [0.5, 0.5] } ]
        });
        let (points, clusters, _) = from_value(&v);
        let surface = parley_surface(&points, &clusters, &selected(&["tr-1"]));
        assert!(surface.len() <= 64, "surface too long: {} chars", surface.len());
        assert!(surface.starts_with("galaxy:"));
        assert!(!surface.ends_with('-'), "never ends on a dangling dash: {surface}");
    }

    #[test]
    fn detail_parses_and_renders_the_honest_no_pr_state() {
        let v = json!({
            "success": true,
            "detail": {
                "transcript": {
                    "id": "tr-1",
                    "spawned_agent_id": "agent-a",
                    "ship": "night-watch",
                    "project": "port-daddy",
                    "status": "completed",
                    "messages": [
                        { "role": "user", "content": "fix the wal checkpoint" },
                        { "role": "assistant", "content": [ { "type": "text", "text": "done — see the diff" } ] }
                    ]
                },
                "session": { "id": "sess-1", "purpose": "sqlite hardening", "status": "completed",
                              "phase": null, "agentId": "agent-a", "identityProject": "port-daddy",
                              "createdAt": 1, "updatedAt": 2, "completedAt": 2 },
                "notes": [ { "id": "n1", "content": "Scope: lib/db.ts", "type": "scope", "createdAt": 1 } ],
                "files": [ { "filePath": "lib/db.ts", "startLine": 10, "endLine": 42,
                              "symbol": "checkpoint", "claimedAt": 1, "releasedAt": null } ],
                "toolUses": [ { "name": "Bash", "args": { "command": "npm test" }, "at": 1 } ],
                "prs": []
            }
        });
        let d = detail_from_value(&v);
        assert_eq!(d.transcript_id, "tr-1");
        assert_eq!(d.agent_id, "agent-a");
        assert_eq!(d.purpose, "sqlite hardening");
        assert_eq!(d.files, vec!["lib/db.ts:10-42 · checkpoint".to_string()]);
        assert_eq!(d.notes, vec!["[scope] Scope: lib/db.ts".to_string()]);
        assert_eq!(d.messages.len(), 2);
        assert_eq!(d.messages[1].1, "done — see the diff", "content-parts arrays flatten");
        assert!(d.tool_uses[0].starts_with("Bash "));

        // PR-provenance honesty: empty prs renders an explicit "none recorded",
        // never an implied "no PRs were produced".
        let blocks = detail_blocks(&d);
        assert!(blocks.iter().any(
            |b| matches!(b, Block::KeyVal(k, v) if k.trim() == "artifacts" && v == "none recorded")
        ));
        assert!(blocks
            .iter()
            .any(|b| matches!(b, Block::Chip { label, .. } if label.contains("best-effort"))));
        assert!(blocks
            .iter()
            .any(|b| matches!(b, Block::ChatTurn { speaker, .. } if speaker == "assistant")));
    }

    #[test]
    fn detail_with_prs_renders_artifact_refs() {
        let v = json!({
            "detail": {
                "transcript": { "id": "tr-9", "spawnedAgentId": "agent-z", "status": "completed", "messages": [] },
                "session": null,
                "notes": [], "files": [], "toolUses": [],
                "prs": [ { "prNumber": 655, "url": "https://github.com/x/y/pull/655",
                            "type": "draft-pr", "summary": "backend dropdown" } ]
            }
        });
        let d = detail_from_value(&v);
        assert_eq!(d.session_id, "", "null session parses to empty enrichment");
        assert_eq!(d.prs.len(), 1);
        assert!(d.prs[0].contains("PR #655") && d.prs[0].contains("draft-pr"));
        let blocks = detail_blocks(&d);
        assert!(blocks
            .iter()
            .any(|b| matches!(b, Block::ArtifactRef { path, .. } if path.contains("PR #655"))));
    }

    #[test]
    fn pane_view_surfaces_errors_and_cluster_chips() {
        let mut pane = GalaxyPane::new();
        pane.last_error = Some("daemon unreachable: connect refused".into());
        let blocks = pane.view();
        assert!(blocks
            .iter()
            .any(|b| matches!(b, Block::KeyVal(k, v) if k == "error" && v.contains("unreachable"))));

        pane.last_error = None;
        let (points, clusters, computed_at) = from_value(&map_fixture());
        pane.points = points;
        pane.clusters = clusters;
        pane.computed_at = computed_at;
        let blocks = pane.view();
        assert!(blocks
            .iter()
            .any(|b| matches!(b, Block::Chip { label, .. } if label.contains("sqlite migration"))));
        assert!(blocks
            .iter()
            .any(|b| matches!(b, Block::KeyVal(k, v) if k == "sessions" && v == "3")));
    }

    #[test]
    fn scripted_params_change_the_wire_query() {
        let mut pane = GalaxyPane::new();
        assert_eq!(pane.query(), "windowHours=24");
        pane.set_params(Some(720), None);
        assert_eq!(pane.query(), "windowHours=720");
        pane.set_params(None, Some(64));
        assert_eq!(pane.query(), "windowHours=720&minTokens=64");
        pane.set_params(Some(0), None); // floor: never a zero-hour window
        assert_eq!(pane.query(), "windowHours=1&minTokens=64");
    }

    #[test]
    fn cluster_tones_cycle_the_shared_8_slot_contract() {
        assert_eq!(cluster_tone(0), Tone::Accent);
        assert_eq!(cluster_tone(5), Tone::Conflicted);
        assert_eq!(cluster_tone(6), Tone::Alarm);
        assert_eq!(cluster_tone(8), Tone::Accent, "wraps at 8 like both UIs");
    }

    #[test]
    fn snapshot_carries_the_full_frame() {
        let mut pane = GalaxyPane::new();
        let (points, clusters, computed_at) = from_value(&map_fixture());
        pane.points = points;
        pane.clusters = clusters;
        pane.computed_at = computed_at;
        let snap = pane.snapshot();
        assert_eq!(snap.points.len(), 3);
        assert_eq!(snap.clusters.len(), 2);
        assert_eq!(snap.computed_at, Some(1_751_600_000_000));
        assert!(snap.last_error.is_none());
    }
}
