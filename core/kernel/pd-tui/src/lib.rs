//! Ratatui operator dashboard for the Port Daddy Rust kernel — the terminal control plane.
//!
//! This crate renders a read-only, at-a-glance view of a kernel daemon: its status and event
//! head across the top, then panes for the fleet (actors), rooms, jobs, obligations, and
//! mesh peers, and finally a detail pane for whichever transaction is selected. It is
//! deliberately split into two rendering paths:
//!
//! - [`render`] draws the full multi-pane TUI into a ratatui [`Frame`]. This is what the live
//!   operator surface calls each tick.
//! - [`render_text_summary`] produces a plain multi-line string of the same core facts. It
//!   needs no terminal, which makes it the path used by `pd-rs tui --once`, by smoke tests,
//!   and by anywhere a headless one-shot summary is more useful than an interactive screen.
//!
//! The model, [`DashboardState`], is a pure `Serialize`/`Deserialize` snapshot. Rendering is
//! a pure function of that snapshot: pass state in, get pixels (or text) out, with no hidden
//! I/O. That separation is what lets the text path be unit-tested and doctested directly.
//!
//! The interactive event loop (key handling, live daemon feed) is a later implementation
//! slice; today this crate renders a supplied snapshot, it does not yet subscribe to one.

use pd_core::{ActorId, JobId, ObligationId, RoomId};
use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Modifier, Style},
    text::Line,
    widgets::{Block, Borders, List, ListItem, Paragraph},
    Frame,
};
use serde::{Deserialize, Serialize};

/// A full snapshot of what the operator dashboard should display.
///
/// This is the single input to both [`render`] and [`render_text_summary`]. It is a plain
/// data record — no behavior beyond construction — so it can be serialized over the wire from
/// a daemon and rendered on the other side. The typed id vectors (`actors`, `rooms`, `jobs`,
/// `obligations`) come straight from the kernel's `pd-core` domain types; `mesh_peers` are
/// plain strings because at the TUI layer a peer is just a label to list.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DashboardState {
    /// Human-readable daemon status line (e.g. `"local-only kernel scaffold"`).
    pub daemon_status: String,
    /// The daemon's current event-log head, rendered as `"{sequence}:{root}"`.
    pub event_head: String,
    /// The fleet: actor ids known to this kernel.
    pub actors: Vec<ActorId>,
    /// Rooms currently tracked.
    pub rooms: Vec<RoomId>,
    /// Jobs in the queue.
    pub jobs: Vec<JobId>,
    /// Outstanding obligations.
    pub obligations: Vec<ObligationId>,
    /// Connected mesh peers, as display labels.
    pub mesh_peers: Vec<String>,
    /// The transaction shown in the detail pane, or `None` for "nothing selected".
    pub selected_transaction: Option<String>,
}

impl DashboardState {
    /// An empty dashboard for a fresh local-only kernel: all lists empty, genesis event head,
    /// nothing selected.
    ///
    /// This is the "cold start" state the TUI shows before any daemon data has arrived, and
    /// the base other states are built up from in tests.
    ///
    /// ```
    /// use pd_tui::DashboardState;
    ///
    /// let state = DashboardState::empty_local();
    /// assert!(state.actors.is_empty());
    /// assert!(state.selected_transaction.is_none());
    /// assert_eq!(state.event_head, "0:genesis");
    /// ```
    pub fn empty_local() -> Self {
        Self {
            daemon_status: "local-only kernel scaffold".to_owned(),
            event_head: "0:genesis".to_owned(),
            actors: Vec::new(),
            rooms: Vec::new(),
            jobs: Vec::new(),
            obligations: Vec::new(),
            mesh_peers: Vec::new(),
            selected_transaction: None,
        }
    }
}

/// Draw the full dashboard into `frame` from `state`.
///
/// The layout is fixed: a 3-line header, then a 45%-height row of three panes (Fleet / Rooms
/// / Jobs), then a 35%-height row of two panes (Obligations / Mesh Peers), then a detail pane
/// filling the rest with the selected transaction. Rendering is a pure function of `state`
/// with no I/O of its own — it only issues widget draws against the frame — so calling it
/// twice with the same state produces the same screen.
///
/// This is exercised end-to-end against a ratatui `TestBackend` in this crate's `tests`
/// module (`dashboard_renders_kernel_panes`); it takes a live `Frame`, which a doctest cannot
/// cheaply construct, so the runnable example lives there.
pub fn render(frame: &mut Frame<'_>, state: &DashboardState) {
    let area = frame.area();
    let vertical = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),
            Constraint::Percentage(45),
            Constraint::Percentage(35),
            Constraint::Min(5),
        ])
        .split(area);

    render_header(frame, vertical[0], state);

    let top = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage(35),
            Constraint::Percentage(35),
            Constraint::Percentage(30),
        ])
        .split(vertical[1]);
    render_list(
        frame,
        top[0],
        "Fleet",
        state.actors.iter().map(ToString::to_string).collect(),
    );
    render_list(
        frame,
        top[1],
        "Rooms",
        state.rooms.iter().map(ToString::to_string).collect(),
    );
    render_list(
        frame,
        top[2],
        "Jobs",
        state.jobs.iter().map(ToString::to_string).collect(),
    );

    let middle = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
        .split(vertical[2]);
    render_list(
        frame,
        middle[0],
        "Obligations",
        state.obligations.iter().map(ToString::to_string).collect(),
    );
    render_list(frame, middle[1], "Mesh Peers", state.mesh_peers.clone());

    let detail = state
        .selected_transaction
        .as_deref()
        .unwrap_or("No transaction selected");
    frame.render_widget(
        Paragraph::new(detail).block(
            Block::default()
                .title("Selected Transaction")
                .borders(Borders::ALL),
        ),
        vertical[3],
    );
}

/// Render `state` as a headless, multi-line plain-text summary — no terminal required.
///
/// This is the counterpart to [`render`] for contexts that have no TTY: `pd-rs tui --once`,
/// CI smoke tests, log lines, and anywhere a one-shot digest beats an interactive screen. It
/// reports the status, event head, and the *counts* of actors, rooms, jobs, and mesh peers
/// (not their full contents), which is what makes it cheap and stable to assert against.
///
/// ```
/// use pd_tui::DashboardState;
/// use pd_tui::render_text_summary;
///
/// let mut state = DashboardState::empty_local();
/// state.actors.push("agent-a".into());
/// state.mesh_peers.push("peer-a".to_owned());
///
/// let summary = render_text_summary(&state);
/// assert!(summary.contains("Port Daddy Rust Kernel"));
/// assert!(summary.contains("actors: 1"));
/// assert!(summary.contains("mesh peers: 1"));
/// ```
pub fn render_text_summary(state: &DashboardState) -> String {
    format!(
        "Port Daddy Rust Kernel\nstatus: {}\nevent head: {}\nactors: {}\nrooms: {}\njobs: {}\nmesh peers: {}",
        state.daemon_status,
        state.event_head,
        state.actors.len(),
        state.rooms.len(),
        state.jobs.len(),
        state.mesh_peers.len()
    )
}

/// Draw the bold, bordered title/status banner into `area`.
fn render_header(frame: &mut Frame<'_>, area: Rect, state: &DashboardState) {
    let title = Line::from("Port Daddy Rust Kernel");
    let body = format!("{} | event head {}", state.daemon_status, state.event_head);
    frame.render_widget(
        Paragraph::new(vec![title, Line::from(body)])
            .style(Style::default().add_modifier(Modifier::BOLD))
            .block(Block::default().borders(Borders::ALL)),
        area,
    );
}

/// Draw a bordered, titled list pane, substituting a single `"empty"` row when there is
/// nothing to show so a pane is never blank and ambiguous.
fn render_list(frame: &mut Frame<'_>, area: Rect, title: &'static str, items: Vec<String>) {
    let items = if items.is_empty() {
        vec![ListItem::new("empty")]
    } else {
        items.into_iter().map(ListItem::new).collect()
    };
    frame.render_widget(
        List::new(items).block(Block::default().title(title).borders(Borders::ALL)),
        area,
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::{backend::TestBackend, Terminal};

    #[test]
    fn dashboard_renders_kernel_panes() {
        let backend = TestBackend::new(100, 30);
        let mut terminal = Terminal::new(backend).unwrap();
        let mut state = DashboardState::empty_local();
        state.actors.push(ActorId::from("agent-a"));
        state.rooms.push(RoomId::from("room-a"));
        state.jobs.push(JobId::from("job-a"));
        state.mesh_peers.push("peer-a".to_owned());

        terminal.draw(|frame| render(frame, &state)).unwrap();

        let summary = render_text_summary(&state);
        assert!(summary.contains("Port Daddy Rust Kernel"));
        assert!(summary.contains("actors: 1"));
        assert!(summary.contains("mesh peers: 1"));
    }
}
