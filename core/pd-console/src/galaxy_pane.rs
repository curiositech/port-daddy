//! Sextant pane — the 2D embedding map of recent agent sessions over
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
/// and projected. `id` is the transcript id (the key for `GET /galaxy/session/:id`).
/// Parley calls send `session_id`; the daemon resolves actor, inbox, and lineage
/// authority from that durable session instead of trusting client-supplied parties.
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
    let clusters = arr(v, "clusters")
        .iter()
        .map(GalaxyCluster::from_value)
        .collect();
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

/// View camera for the normalized daemon layout. The daemon still owns the
/// [0, 1] embedding coordinates; this camera only decides how that world is
/// framed inside the GPUI canvas.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GalaxyViewport {
    /// Scale applied to the normalized map world. `1.0` shows the whole world
    /// with [`Self::EDGE_PAD`] around it; larger values zoom in.
    pub zoom: f32,
    /// Normalized world coordinate at the left edge of the visible data window.
    pub pan_x: f32,
    /// Normalized world coordinate at the top edge of the visible data window.
    pub pan_y: f32,
}

impl Default for GalaxyViewport {
    fn default() -> Self {
        Self {
            zoom: 1.0,
            pan_x: 0.0,
            pan_y: 0.0,
        }
    }
}

impl GalaxyViewport {
    /// Permanent visual breathing room around the daemon's normalized layout.
    pub const EDGE_PAD: f32 = 0.08;
    pub const MIN_ZOOM: f32 = 1.0;
    pub const MAX_ZOOM: f32 = 8.0;

    fn content_span() -> f32 {
        1.0 - (Self::EDGE_PAD * 2.0)
    }

    fn visible_world_span(&self) -> f32 {
        (1.0 / self.zoom.max(Self::MIN_ZOOM)).min(1.0)
    }

    fn clamp_pan(&mut self) {
        self.zoom = self.zoom.clamp(Self::MIN_ZOOM, Self::MAX_ZOOM);
        let visible = self.visible_world_span();
        if visible >= 1.0 {
            self.pan_x = 0.0;
            self.pan_y = 0.0;
        } else {
            let max_pan = 1.0 - visible;
            self.pan_x = self.pan_x.clamp(0.0, max_pan);
            self.pan_y = self.pan_y.clamp(0.0, max_pan);
        }
    }

    pub fn reset(&mut self) {
        *self = Self::default();
    }

    /// Convert normalized world coordinates into relative canvas coordinates.
    pub fn world_to_view(&self, x: f32, y: f32) -> (f32, f32) {
        let span = Self::content_span() * self.zoom.max(Self::MIN_ZOOM);
        (
            Self::EDGE_PAD + ((x - self.pan_x) * span),
            Self::EDGE_PAD + ((y - self.pan_y) * span),
        )
    }

    /// Convert relative canvas coordinates back into normalized world coords.
    pub fn view_to_world(&self, x: f32, y: f32) -> (f32, f32) {
        let span = Self::content_span() * self.zoom.max(Self::MIN_ZOOM);
        (
            ((x - Self::EDGE_PAD) / span) + self.pan_x,
            ((y - Self::EDGE_PAD) / span) + self.pan_y,
        )
    }

    /// Zoom around a relative canvas anchor, preserving the world point under
    /// the cursor/buttons as closely as the map bounds allow.
    pub fn zoom_at(&mut self, factor: f32, anchor_x: f32, anchor_y: f32) {
        let factor = factor.clamp(0.25, 4.0);
        let anchor_x = anchor_x.clamp(0.0, 1.0);
        let anchor_y = anchor_y.clamp(0.0, 1.0);
        let before = self.view_to_world(anchor_x, anchor_y);
        self.zoom = (self.zoom * factor).clamp(Self::MIN_ZOOM, Self::MAX_ZOOM);
        let after = self.view_to_world(anchor_x, anchor_y);
        self.pan_x += before.0 - after.0;
        self.pan_y += before.1 - after.1;
        self.clamp_pan();
    }

    /// Drag the map like a grabbable surface. Positive screen deltas move
    /// content in the same direction as the pointer.
    pub fn pan_by_screen_delta(&mut self, dx_px: f32, dy_px: f32, w_px: f32, h_px: f32) {
        let scale = Self::content_span() * self.zoom.max(Self::MIN_ZOOM);
        self.pan_x -= dx_px / w_px.max(1.0) / scale;
        self.pan_y -= dy_px / h_px.max(1.0) / scale;
        self.clamp_pan();
    }

    /// Fit the current points while keeping the same edge breathing room.
    pub fn fit_points(&mut self, points: &[GalaxyPoint]) {
        if points.is_empty() {
            self.reset();
            return;
        }

        let (mut min_x, mut max_x) = (1.0_f32, 0.0_f32);
        let (mut min_y, mut max_y) = (1.0_f32, 0.0_f32);
        for p in points {
            min_x = min_x.min(p.x);
            max_x = max_x.max(p.x);
            min_y = min_y.min(p.y);
            max_y = max_y.max(p.y);
        }

        let range_x = (max_x - min_x).max(0.04);
        let range_y = (max_y - min_y).max(0.04);
        let desired_visible_x = (range_x + 0.16).min(1.0);
        let desired_visible_y = (range_y + 0.16).min(1.0);
        self.zoom = (1.0 / desired_visible_x)
            .min(1.0 / desired_visible_y)
            .clamp(Self::MIN_ZOOM, Self::MAX_ZOOM);

        let visible = self.visible_world_span();
        self.pan_x = ((min_x + max_x) * 0.5) - (visible * 0.5);
        self.pan_y = ((min_y + max_y) * 0.5) - (visible * 0.5);
        self.clamp_pan();
    }
}

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

/// Distinct durable session ids across the selected transcript points.
///
/// These are the only participant references a manual Parley call may send.
/// Points without a session id remain inspectable but cannot grant participant
/// authority, so they are omitted rather than downgraded to an agent id.
pub fn distinct_sessions(points: &[GalaxyPoint], selected: &HashSet<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for p in points.iter().filter(|p| selected.contains(&p.id)) {
        if let Some(session_id) = p.session_id.as_ref().filter(|id| !id.is_empty()) {
            if seen.insert(session_id.clone()) {
                out.push(session_id.clone());
            }
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
/// `sextant:<top selection-cluster terms, kebab-joined, <=64 chars total>`.
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
    let mut surface = format!("sextant:{topic}");
    if surface.len() > 64 {
        surface.truncate(64); // kebab() output is pure ASCII — safe to byte-cut
        while surface.ends_with('-') {
            surface.pop();
        }
    }
    surface
}

/// The default operator reason when none is typed, per the contract:
/// `Operator convened parley from Sextant cluster "<label>" (<n> sessions)`.
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
    format!("Operator convened parley from Sextant cluster \"{label}\" ({n_sel} sessions)")
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
    /// Full-transcript turns, each carrying its own epoch-ms timestamp.
    pub messages: Vec<DetailMessage>,
    /// Session start, epoch ms — `0` when the daemon hasn't surfaced one
    /// (checked with `> 0`, never assumed present: the top-level
    /// `startedAt`/`endedAt` fields are a concurrent daemon-lane addition,
    /// so this stays defensive against an older daemon).
    pub started_at: i64,
    /// Session end, epoch ms — `0` while still running / unknown.
    pub ended_at: i64,
}

/// One transcript turn: who spoke, what they said, and when (epoch ms; `0` if
/// the daemon didn't send a per-message timestamp for this row).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct DetailMessage {
    pub speaker: String,
    pub text: String,
    pub epoch_ms: i64,
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

/// A message's epoch-ms timestamp — tried across every key name the daemon
/// has used for one (`TranscriptMessage.timestamp` is the canonical field;
/// `at`/`createdAt`/`ts` cover drift), `0` when none parse.
fn message_epoch_ms(m: &Value) -> i64 {
    ["timestamp", "at", "createdAt", "ts"]
        .iter()
        .map(|k| n(m, k))
        .find(|v| *v > 0)
        .unwrap_or(0)
}

// ── Time formatting (pure — no chrono; timezone-free by construction, the
// same doctrine as `util::age_short`) ────────────────────────────────────────

/// UTC time-of-day `HH:MM:SS` from an epoch-ms timestamp. Empty string for
/// non-positive/missing timestamps so a row with no time renders blank —
/// never a fake `00:00:00`.
pub fn hhmmss(epoch_ms: i64) -> String {
    if epoch_ms <= 0 {
        return String::new();
    }
    let day_s = (epoch_ms / 1000).rem_euclid(86_400);
    let (h, m, sec) = (day_s / 3600, (day_s % 3600) / 60, day_s % 60);
    format!("{h:02}:{m:02}:{sec:02}")
}

/// A short duration string from a millisecond span: `"45s"`, `"3m12s"`,
/// `"1h05m"`. Non-positive spans render `"0s"` (never negative).
pub fn duration_short(span_ms: i64) -> String {
    if span_ms <= 0 {
        return "0s".into();
    }
    let total_s = span_ms / 1000;
    let (h, m, sec) = (total_s / 3600, (total_s % 3600) / 60, total_s % 60);
    if h > 0 {
        format!("{h}h{m:02}m")
    } else if m > 0 {
        format!("{m}m{sec:02}s")
    } else {
        format!("{sec}s")
    }
}

/// Prefix a transcript turn's text with its `HH:MM:SS` (blank when the
/// message carries no timestamp — the text renders unprefixed rather than a
/// dangling blank tag).
fn format_turn_text(text: &str, epoch_ms: i64) -> String {
    let ts = hhmmss(epoch_ms);
    if ts.is_empty() {
        text.to_string()
    } else {
        format!("{ts}  {text}")
    }
}

/// The window-hours cycle shared by the inline Sextant window controls and the
/// `sextant` control-socket command: `24 → 72 → 168 → 720 → 24`. A current
/// value off the cycle (a scripted arbitrary hour count) advances to the next
/// stop greater than it, wrapping to the first stop past the top.
pub fn next_window_hours(current: u32) -> u32 {
    const STOPS: [u32; 4] = [24, 72, 168, 720];
    match STOPS.iter().position(|&stop| stop == current) {
        Some(i) => STOPS[(i + 1) % STOPS.len()],
        None => STOPS
            .iter()
            .copied()
            .find(|&stop| stop > current)
            .unwrap_or(STOPS[0]),
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
        agent_id: first_s(
            transcript,
            &["spawned_agent_id", "spawnedAgentId", "agentId"],
        ),
        ship: s(transcript, "ship"),
        project: s(transcript, "project"),
        status: s(transcript, "status"),
        ..GalaxyDetail::default()
    };
    if let Some(sv) = session {
        d.session_id = s(sv, "id");
        d.purpose = s(sv, "purpose");
    }
    // Top-level startedAt/endedAt (camelCase, a concurrent daemon-lane
    // addition) win when present; otherwise fall back to the transcript's
    // own snake_case fields — an older daemon still renders a real value.
    d.started_at = {
        let top = n(detail, "startedAt");
        if top > 0 {
            top
        } else {
            n(transcript, "started_at")
        }
    };
    d.ended_at = {
        let top = n(detail, "endedAt");
        if top > 0 {
            top
        } else {
            n(transcript, "ended_at")
        }
    };
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
            let speaker = if role.is_empty() {
                "agent".to_string()
            } else {
                role
            };
            DetailMessage {
                speaker,
                text: message_text(mv),
                epoch_ms: message_epoch_ms(mv),
            }
        })
        .filter(|m| !m.text.trim().is_empty())
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
    if d.started_at > 0 {
        blocks.push(Block::KeyVal("started".into(), hhmmss(d.started_at)));
    }
    if d.ended_at > 0 {
        blocks.push(Block::KeyVal("ended".into(), hhmmss(d.ended_at)));
    }
    match (d.started_at > 0, d.ended_at > 0) {
        (true, true) if d.ended_at >= d.started_at => {
            blocks.push(Block::KeyVal(
                "duration".into(),
                duration_short(d.ended_at - d.started_at),
            ));
        }
        (true, false) => {
            blocks.push(Block::KeyVal("duration".into(), "running".into()));
        }
        _ => {}
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
        blocks.push(Block::KeyVal(
            "  files".into(),
            "no file claims recorded".into(),
        ));
    } else {
        // ArtifactRef (not Row) with the `"file"` label — the galaxy canvas
        // renders THESE specifically as click-to-open-Editor rows (repo-
        // relative paths, per the daemon-lane contract), distinct from the
        // `"artifact"`-labeled PR/commit refs above which stay inert.
        for file in &d.files {
            blocks.push(Block::ArtifactRef {
                label: "file".into(),
                path: file.clone(),
                preview: None,
                tone: Tone::Engaged,
            });
        }
    }
    blocks.push(Block::Gap);

    blocks.push(Block::Chip {
        label: "tool uses".into(),
        tone: Tone::Resting,
    });
    if d.tool_uses.is_empty() {
        blocks.push(Block::KeyVal(
            "  tools".into(),
            "no tool calls recorded".into(),
        ));
    } else {
        for tool in d.tool_uses.iter().take(DETAIL_TOOL_CAP) {
            blocks.push(Block::Row(vec!["⚙".into(), tool.clone()]));
        }
        if d.tool_uses.len() > DETAIL_TOOL_CAP {
            blocks.push(Block::KeyVal(
                "  more".into(),
                format!(
                    "+{} further tool calls",
                    d.tool_uses.len() - DETAIL_TOOL_CAP
                ),
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
        blocks.push(Block::KeyVal(
            "  transcript".into(),
            "no messages recorded".into(),
        ));
    } else {
        let skipped = d.messages.len().saturating_sub(DETAIL_TURN_CAP);
        if skipped > 0 {
            blocks.push(Block::KeyVal(
                "  earlier".into(),
                format!("{skipped} earlier turn(s) omitted — showing the tail"),
            ));
        }
        for m in d.messages.iter().skip(skipped) {
            let tone = match m.speaker.to_ascii_lowercase().as_str() {
                "operator" | "user" => Tone::Accent,
                "tool" | "system" => Tone::Resting,
                _ => Tone::Engaged,
            };
            blocks.push(Block::ChatTurn {
                speaker: m.speaker.clone(),
                text: format_turn_text(&m.text, m.epoch_ms),
                tone,
            });
        }
    }
    blocks
}

// ── The pane ─────────────────────────────────────────────────────────────────

/// A cloneable frame of the Sextant map the producer thread ships to the GPUI view
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
    /// Whether the daemon's k-means clustering was requested for this frame.
    /// `false` ⇒ the canvas paints every point in one neutral tone with no
    /// centroid labels, regardless of whatever `cluster_id`/`clusters` the
    /// response still carries (defensive against a daemon that hasn't wired
    /// `cluster=false` all the way through yet).
    pub cluster: bool,
}

pub struct GalaxyPane {
    pub points: Vec<GalaxyPoint>,
    pub clusters: Vec<GalaxyCluster>,
    pub computed_at: Option<i64>,
    last_error: Option<String>,
    /// Query window in hours. Scriptable (control socket `sextant` command);
    /// the daemon clamps its own bounds.
    window_hours: u32,
    /// Significance floor; `None` inherits the daemon default.
    min_tokens: Option<u32>,
    /// Clustering toggle (canvas header chip). `true` (the default) inherits
    /// the daemon's k-means clustering by omitting the param entirely;
    /// `false` sends `cluster=false` on the wire.
    cluster: bool,
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
            cluster: true,
        }
    }
}

impl GalaxyPane {
    pub fn new() -> Self {
        Self::default()
    }

    /// Apply scripted query params (control socket `sextant` command). Only the
    /// provided fields change; the next 2s refresh picks them up.
    pub fn set_params(&mut self, window_hours: Option<u32>, min_tokens: Option<u32>) {
        if let Some(h) = window_hours {
            self.window_hours = h.max(1);
        }
        if let Some(m) = min_tokens {
            self.min_tokens = Some(m);
        }
    }

    /// Toggle daemon-side clustering (the canvas header chip / a scripted
    /// `cluster` param). A separate setter from [`Self::set_params`] so the
    /// existing 2-arg wire contract (window/minTokens) never has to change
    /// shape for callers that don't care about clustering.
    pub fn set_cluster(&mut self, enabled: bool) {
        self.cluster = enabled;
    }

    /// The query string the next refresh will send — pure, so tests can pin
    /// the scripted-params → wire-request contract without HTTP. `cluster` is
    /// omitted when `true` (the daemon default); `cluster=false` is explicit.
    pub fn query(&self) -> String {
        let mut q = match self.min_tokens {
            Some(m) => format!("windowHours={}&minTokens={}", self.window_hours, m),
            None => format!("windowHours={}", self.window_hours),
        };
        if !self.cluster {
            q.push_str("&cluster=false");
        }
        q
    }

    /// The frame the producer ships to the view each refresh.
    pub fn snapshot(&self) -> GalaxySnapshot {
        GalaxySnapshot {
            points: self.points.clone(),
            clusters: self.clusters.clone(),
            computed_at: self.computed_at,
            last_error: self.last_error.clone(),
            window_hours: self.window_hours,
            cluster: self.cluster,
        }
    }
}

impl Pane for GalaxyPane {
    fn id(&self) -> &str {
        "sextant"
    }

    fn title(&self) -> String {
        "Sextant".into()
    }

    fn view(&self) -> Vec<Block> {
        let mut blocks = vec![Block::Header("Sextant".into())];

        if let Some(err) = &self.last_error {
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            return blocks;
        }

        blocks.push(Block::KeyVal(
            "sessions".into(),
            self.points.len().to_string(),
        ));
        blocks.push(Block::KeyVal(
            "clusters".into(),
            self.clusters.len().to_string(),
        ));
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
                label: format!(
                    "{} — {} session(s)",
                    trunc(&cluster.label, 48),
                    cluster.size
                ),
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

    fn assert_close(left: f32, right: f32) {
        assert!(
            (left - right).abs() < 1e-5,
            "expected {left} to be close to {right}"
        );
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
        assert!(
            (clusters[0].cx - 0.5).abs() < 1e-6,
            "missing centroid → center"
        );
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
    fn viewport_default_gives_points_edge_room() {
        let viewport = GalaxyViewport::default();
        let (left, top) = viewport.world_to_view(0.0, 0.0);
        let (right, bottom) = viewport.world_to_view(1.0, 1.0);

        assert_close(left, GalaxyViewport::EDGE_PAD);
        assert_close(top, GalaxyViewport::EDGE_PAD);
        assert_close(right, 1.0 - GalaxyViewport::EDGE_PAD);
        assert_close(bottom, 1.0 - GalaxyViewport::EDGE_PAD);

        let world = viewport.view_to_world(right, bottom);
        assert_close(world.0, 1.0);
        assert_close(world.1, 1.0);
    }

    #[test]
    fn viewport_zoom_preserves_anchor_world_point() {
        let mut viewport = GalaxyViewport::default();
        let before = viewport.view_to_world(0.40, 0.65);

        viewport.zoom_at(2.0, 0.40, 0.65);

        let after = viewport.view_to_world(0.40, 0.65);
        assert_close(before.0, after.0);
        assert_close(before.1, after.1);
        assert!(viewport.zoom > 1.0);
    }

    #[test]
    fn viewport_pan_moves_content_with_the_pointer_and_clamps() {
        let mut viewport = GalaxyViewport::default();
        viewport.zoom_at(3.0, 0.5, 0.5);
        let original = viewport.pan_x;

        viewport.pan_by_screen_delta(120.0, 0.0, 600.0, 400.0);
        assert!(
            viewport.pan_x < original,
            "dragging right moves content right"
        );

        viewport.pan_by_screen_delta(-10_000.0, -10_000.0, 600.0, 400.0);
        let max_pan = 1.0 - (1.0 / viewport.zoom);
        assert!(viewport.pan_x <= max_pan && viewport.pan_y <= max_pan);
        assert!(viewport.pan_x >= 0.0 && viewport.pan_y >= 0.0);
    }

    #[test]
    fn viewport_fit_points_zooms_dense_clusters_without_losing_padding() {
        let (points, _, _) = from_value(&map_fixture());
        let dense = vec![points[0].clone(), points[2].clone()];
        let mut viewport = GalaxyViewport::default();

        viewport.fit_points(&dense);

        assert!(viewport.zoom > 1.0);
        for point in dense {
            let (x, y) = viewport.world_to_view(point.x, point.y);
            assert!(x > GalaxyViewport::EDGE_PAD && x < 1.0 - GalaxyViewport::EDGE_PAD);
            assert!(y > GalaxyViewport::EDGE_PAD && y < 1.0 - GalaxyViewport::EDGE_PAD);
        }
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
    fn distinct_sessions_is_the_manual_parley_authority_input() {
        let (mut points, _, _) = from_value(&map_fixture());
        points[1].session_id = Some("sess-2".into());
        points[2].session_id = Some("sess-1".into());

        let sessions = distinct_sessions(&points, &selected(&["tr-1", "tr-2", "tr-3"]));
        assert_eq!(sessions, vec!["sess-1".to_string(), "sess-2".to_string()]);

        points[1].session_id = None;
        assert_eq!(
            distinct_sessions(&points, &selected(&["tr-1", "tr-2"])),
            vec!["sess-1".to_string()],
            "an unbound transcript never falls back to its client-visible agent id"
        );
    }

    #[test]
    fn parley_surface_and_default_reason_follow_the_contract() {
        let (points, clusters, _) = from_value(&map_fixture());
        let sel = selected(&["tr-1", "tr-2", "tr-3"]);
        // Cluster 0 holds 2 of 3 selected points → its terms drive the surface.
        assert_eq!(
            parley_surface(&points, &clusters, &sel),
            "sextant:sqlite-migration-wal"
        );
        assert_eq!(
            default_reason(&points, &clusters, &sel),
            "Operator convened parley from Sextant cluster \"sqlite migration · wal\" (3 sessions)"
        );
        // Empty selection degrades honestly.
        assert_eq!(
            parley_surface(&points, &clusters, &HashSet::new()),
            "sextant:selection"
        );
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
        assert!(
            surface.len() <= 64,
            "surface too long: {} chars",
            surface.len()
        );
        assert!(surface.starts_with("sextant:"));
        assert!(
            !surface.ends_with('-'),
            "never ends on a dangling dash: {surface}"
        );
    }

    #[test]
    fn detail_parses_and_renders_the_honest_no_pr_state() {
        let v = json!({
            "success": true,
            "detail": {
                // Top-level startedAt/endedAt — the concurrent daemon-lane
                // addition; wins over transcript.started_at/ended_at below.
                "startedAt": 47_109_000_i64,
                "endedAt": 47_863_000_i64,
                "transcript": {
                    "id": "tr-1",
                    "spawned_agent_id": "agent-a",
                    "ship": "night-watch",
                    "project": "port-daddy",
                    "status": "completed",
                    "started_at": 1, "ended_at": 2,
                    "messages": [
                        { "role": "user", "content": "fix the wal checkpoint", "timestamp": 47_109_000_i64 },
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
        assert_eq!(
            d.messages[1].text, "done — see the diff",
            "content-parts arrays flatten"
        );
        assert!(d.tool_uses[0].starts_with("Bash "));

        // Top-level startedAt/endedAt won over transcript's started_at/ended_at.
        assert_eq!(d.started_at, 47_109_000);
        assert_eq!(d.ended_at, 47_863_000);
        assert_eq!(d.messages[0].epoch_ms, 47_109_000);
        assert_eq!(
            d.messages[1].epoch_ms, 0,
            "no timestamp on this message → 0, never a fake time"
        );

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

        // Header shows started/ended (HH:MM:SS) + a computed duration.
        assert!(blocks
            .iter()
            .any(|b| matches!(b, Block::KeyVal(k, v) if k == "started" && v == "13:05:09")));
        assert!(blocks
            .iter()
            .any(|b| matches!(b, Block::KeyVal(k, v) if k == "ended" && v == "13:17:43")));
        assert!(blocks
            .iter()
            .any(|b| matches!(b, Block::KeyVal(k, v) if k == "duration" && v == "12m34s")));

        // Files touched render as a labeled, click-to-editor ArtifactRef —
        // not the plain Row they used to be.
        assert!(blocks.iter().any(|b| matches!(
            b,
            Block::ArtifactRef { label, path, .. }
                if label == "file" && path == "lib/db.ts:10-42 · checkpoint"
        )));

        // Transcript turn text carries the HH:MM:SS prefix when the message
        // had a timestamp, and stays unprefixed when it didn't.
        assert!(blocks.iter().any(|b| matches!(
            b,
            Block::ChatTurn { speaker, text, .. }
                if speaker == "user" && text == "13:05:09  fix the wal checkpoint"
        )));
        assert!(blocks.iter().any(|b| matches!(
            b,
            Block::ChatTurn { speaker, text, .. }
                if speaker == "assistant" && text == "done — see the diff"
        )));
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
        assert_eq!(pane.title(), "Sextant");
        assert!(matches!(pane.view().first(), Some(Block::Header(h)) if h == "Sextant"));

        pane.last_error = Some("daemon unreachable: connect refused".into());
        let blocks = pane.view();
        assert!(blocks.iter().any(
            |b| matches!(b, Block::KeyVal(k, v) if k == "error" && v.contains("unreachable"))
        ));

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
        assert!(
            !pane.query().contains("project="),
            "Sextant is context-free; repo/berth selection belongs outside this pane"
        );
    }

    #[test]
    fn cluster_toggle_extends_the_wire_query_only_when_off() {
        let mut pane = GalaxyPane::new();
        // Default (true) omits the param entirely — the daemon's own default.
        assert_eq!(pane.query(), "windowHours=24");
        assert!(pane.snapshot().cluster);

        pane.set_cluster(false);
        assert_eq!(pane.query(), "windowHours=24&cluster=false");
        assert!(!pane.snapshot().cluster);

        pane.set_params(Some(72), Some(64));
        assert_eq!(pane.query(), "windowHours=72&minTokens=64&cluster=false");

        pane.set_cluster(true);
        assert_eq!(
            pane.query(),
            "windowHours=72&minTokens=64",
            "flipping back to on drops the param again"
        );
    }

    #[test]
    fn next_window_hours_cycles_the_4_stop_contract() {
        assert_eq!(next_window_hours(24), 72);
        assert_eq!(next_window_hours(72), 168);
        assert_eq!(next_window_hours(168), 720);
        assert_eq!(next_window_hours(720), 24, "wraps back to the first stop");
        // Off-cycle values (a scripted arbitrary hour count) advance to the
        // next stop greater than them, never getting stuck.
        assert_eq!(next_window_hours(48), 72);
        assert_eq!(next_window_hours(1), 24);
        assert_eq!(
            next_window_hours(1000),
            24,
            "past the top stop wraps to the first"
        );
    }

    #[test]
    fn hhmmss_formats_utc_time_of_day_and_blanks_on_absence() {
        assert_eq!(hhmmss(47_109_000), "13:05:09");
        assert_eq!(
            hhmmss(0),
            "",
            "non-positive epoch renders blank, not 00:00:00"
        );
        assert_eq!(hhmmss(-5), "");
    }

    #[test]
    fn duration_short_formats_by_magnitude() {
        assert_eq!(duration_short(45_000), "45s");
        assert_eq!(duration_short(754_000), "12m34s");
        assert_eq!(duration_short(3_900_000), "1h05m");
        assert_eq!(duration_short(0), "0s");
        assert_eq!(duration_short(-100), "0s", "never a negative duration");
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
        assert!(snap.cluster, "clustering defaults to on");
    }
}
