use pd_core::{ActorId, JobId, ObligationId, RoomId};
use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Modifier, Style},
    text::Line,
    widgets::{Block, Borders, List, ListItem, Paragraph},
    Frame,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DashboardState {
    pub daemon_status: String,
    pub event_head: String,
    pub actors: Vec<ActorId>,
    pub rooms: Vec<RoomId>,
    pub jobs: Vec<JobId>,
    pub obligations: Vec<ObligationId>,
    pub mesh_peers: Vec<String>,
    pub selected_transaction: Option<String>,
}

impl DashboardState {
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
