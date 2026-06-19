//! `pd vibe` — the comms officer TUI. Skeleton rendering ONE screen
//! against the Port Daddy design system. Quit with `q` or Esc.
//!
//! Run:
//!   cargo run --bin pd-vibe              # dark theme (default)
//!   PD_THEME=light cargo run --bin pd-vibe
//!
//! This is the v0 of the answer to "what does it do." It boots, it shows
//! the maritime palette in working ratatui, you can type, you can quit.

use anyhow::Result;
use crossterm::{
    event::{self, DisableMouseCapture, EnableMouseCapture, Event, KeyCode, KeyEventKind},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use pd_tui::{active_theme, flags, logo::AnimatedLogo};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Modifier, Style},
    symbols::Marker,
    text::{Line, Span},
    widgets::{
        canvas::{Canvas, Rectangle},
        Block, BorderType, Borders, Paragraph, Wrap,
    },
    Frame, Terminal,
};
use std::io::{self, Stdout};
use std::time::{Duration, Instant};

struct App {
    input: String,
    cursor_blink_on: bool,
    last_tick: Instant,
    started: Instant,
    splash: bool,
    quit: bool,
}

impl App {
    fn new() -> Self {
        Self {
            input: String::new(),
            cursor_blink_on: true,
            last_tick: Instant::now(),
            started: Instant::now(),
            splash: true,
            quit: false,
        }
    }

    /// Animation frame for the splash logo — one frame per 100ms.
    fn logo_frame(&self) -> u64 {
        self.started.elapsed().as_millis() as u64 / 100
    }

    fn on_key(&mut self, key: KeyCode) {
        if self.splash {
            // Any key docks into the main screen; q/Esc still quits.
            match key {
                KeyCode::Char('q') | KeyCode::Esc => self.quit = true,
                _ => self.splash = false,
            }
            return;
        }
        match key {
            KeyCode::Char('q') | KeyCode::Esc => self.quit = true,
            KeyCode::Char(c) => self.input.push(c),
            KeyCode::Backspace => {
                self.input.pop();
            }
            KeyCode::Enter => {
                // Skeleton: discard, would dispatch to comms officer in real impl.
                self.input.clear();
            }
            _ => {}
        }
    }

    fn tick(&mut self) {
        if self.last_tick.elapsed() >= Duration::from_millis(500) {
            self.cursor_blink_on = !self.cursor_blink_on;
            self.last_tick = Instant::now();
        }
    }
}

fn main() -> Result<()> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let res = run(&mut terminal);

    disable_raw_mode()?;
    execute!(
        terminal.backend_mut(),
        LeaveAlternateScreen,
        DisableMouseCapture
    )?;
    terminal.show_cursor()?;

    res
}

fn run(terminal: &mut Terminal<CrosstermBackend<Stdout>>) -> Result<()> {
    let mut app = App::new();
    let tick_rate = Duration::from_millis(100);

    while !app.quit {
        terminal.draw(|f| draw(f, &app))?;

        let timeout = tick_rate
            .checked_sub(app.last_tick.elapsed())
            .unwrap_or_else(|| Duration::from_millis(0));

        if event::poll(timeout)? {
            if let Event::Key(key) = event::read()? {
                if key.kind == KeyEventKind::Press {
                    app.on_key(key.code);
                }
            }
        }
        app.tick();
    }
    Ok(())
}

fn draw(frame: &mut Frame, app: &App) {
    let theme = active_theme();

    // Splash: the animated logo — glints, winks, melts into waves and a
    // sun, then reassembles. Any key docks into the main screen.
    if app.splash {
        frame.render_widget(AnimatedLogo::new(app.logo_frame()), frame.area());
        // The splash forces a dark backdrop (see AnimatedLogo), so the hint
        // resolves its color from the dark theme regardless of PD_THEME.
        let splash_theme: &dyn pd_tui::tokens::Theme = &pd_tui::tokens::dark::THEME;
        let hint = Line::from(Span::styled(
            "any key to dock · q to quit",
            Style::default().fg(splash_theme.text_body_subtle()),
        ))
        .centered();
        let area = frame.area();
        let hint_area = Rect {
            x: area.x,
            y: area.y + area.height.saturating_sub(2),
            width: area.width,
            height: 1,
        };
        frame.render_widget(Paragraph::new(hint), hint_area);
        return;
    }

    // Layout: 3-row vertical — top hero cost strip, chat scrollback, input.
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(5),
            Constraint::Min(8),
            Constraint::Length(5),
        ])
        .split(frame.area());

    draw_cost_strip(frame, chunks[0], theme);
    draw_scrollback(frame, chunks[1], theme);
    draw_input(frame, chunks[2], theme, app);
}

fn draw_cost_strip(frame: &mut Frame, area: Rect, theme: &dyn pd_tui::tokens::Theme) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Thick)
        .border_style(Style::default().fg(theme.bg_brand()))
        .style(Style::default().bg(theme.bg_inverse()).fg(theme.text_on_inverse()));

    let inner_text = vec![
        Line::from(vec![
            Span::styled(
                "▓ PD VIBE — comms officer",
                Style::default()
                    .fg(theme.bg_brand())
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw("   "),
            Span::styled(
                "$23.40 / $50.00 daily",
                Style::default().fg(theme.bg_brand()).add_modifier(Modifier::BOLD),
            ),
            Span::raw("   "),
            Span::styled(
                "47%",
                Style::default().fg(theme.text_body()),
            ),
        ]),
        Line::from(vec![
            Span::styled(
                "▕████████████████░░░░░░░░░░░░░░░░░░░▏",
                Style::default().fg(theme.bg_brand()),
            ),
        ]),
        Line::from(vec![
            Span::styled(
                "  routing → cloudflare/llama-3.2-1b · classifier · turn 14/22",
                Style::default().fg(theme.text_inverse_subtle()),
            ),
        ]),
    ];

    frame.render_widget(
        Paragraph::new(inner_text).block(block).wrap(Wrap { trim: false }),
        area,
    );
}

fn draw_scrollback(frame: &mut Frame, area: Rect, theme: &dyn pd_tui::tokens::Theme) {
    // Two-pane: chat bubbles on left, flag canvas on right.
    let split = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Min(20), Constraint::Length(22)])
        .split(area);

    // Left: chat bubbles
    let chat = vec![
        Line::from(vec![
            Span::styled("you · 14:22:30", Style::default().fg(theme.text_body_subtle())),
        ]),
        Line::from(vec![
            Span::styled(
                "  who's working on lib/auth.ts right now?",
                Style::default().fg(theme.text_heading()),
            ),
        ]),
        Line::from(""),
        Line::from(vec![
            Span::styled(
                "  comms · navigator · 14:22:31",
                Style::default().fg(theme.bg_brand()).add_modifier(Modifier::BOLD),
            ),
        ]),
        Line::from(vec![
            Span::styled("  two actors hold claims:", Style::default().fg(theme.text_body())),
        ]),
        Line::from(vec![
            Span::styled("    [A] ", Style::default().fg(theme.bg_brand())),
            Span::styled("simplifier  ", Style::default().fg(theme.bg_danger()).add_modifier(Modifier::BOLD)),
            Span::styled("claim-active · 4m", Style::default().fg(theme.text_body_subtle())),
        ]),
        Line::from(vec![
            Span::styled("    [A] ", Style::default().fg(theme.bg_brand())),
            Span::styled("qa          ", Style::default().fg(theme.bg_danger()).add_modifier(Modifier::BOLD)),
            Span::styled("claim-active · 11m", Style::default().fg(theme.text_body_subtle())),
        ]),
        Line::from(""),
        Line::from(vec![
            Span::styled("you · 14:23:01", Style::default().fg(theme.text_body_subtle())),
        ]),
        Line::from(vec![
            Span::styled(
                "  show me scout's flag.",
                Style::default().fg(theme.text_heading()),
            ),
        ]),
        Line::from(""),
        Line::from(vec![
            Span::styled(
                "  comms · navigator · 14:23:02",
                Style::default().fg(theme.bg_brand()).add_modifier(Modifier::BOLD),
            ),
        ]),
        Line::from(vec![
            Span::styled(
                "  scout flies Mike — vessel stopped, making no way.",
                Style::default().fg(theme.text_body()),
            ),
        ]),
        Line::from(vec![
            Span::styled(
                "  rendered live →",
                Style::default().fg(theme.text_body_subtle()),
            ),
        ]),
    ];

    let chat_block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .title(Span::styled(
            " conversation ",
            Style::default().fg(theme.text_inverse_subtle()),
        ))
        .style(Style::default().bg(theme.bg_inverse()).fg(theme.text_on_inverse()));

    frame.render_widget(
        Paragraph::new(chat).block(chat_block).wrap(Wrap { trim: false }),
        split[0],
    );

    // Right: flag rendered via Canvas + Marker::HalfBlock at 16x16 px in 16x8 cell area
    let flag_block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::QuadrantOutside)
        .border_style(Style::default().fg(theme.bg_brand()))
        .title(Span::styled(
            " ICS Mike ",
            Style::default()
                .fg(theme.bg_inverse())
                .bg(theme.bg_brand())
                .add_modifier(Modifier::BOLD),
        ))
        .style(Style::default().bg(theme.bg_inverse()));

    let mike_rects = flags::mike();
    let canvas = Canvas::default()
        .block(flag_block)
        .marker(Marker::HalfBlock)
        .x_bounds([0.0, 16.0])
        .y_bounds([0.0, 16.0])
        .paint(move |ctx| {
            for r in &mike_rects {
                ctx.draw(&Rectangle {
                    x: r.x,
                    y: r.y,
                    width: r.w,
                    height: r.h,
                    color: r.color,
                });
            }
        });

    frame.render_widget(canvas, split[1]);
}

fn draw_input(frame: &mut Frame, area: Rect, theme: &dyn pd_tui::tokens::Theme, app: &App) {
    let cursor = if app.cursor_blink_on { "█" } else { " " };
    let display = format!("  {}{}", app.input, cursor);

    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Thick)
        .border_style(Style::default().fg(theme.bg_brand()))
        .title(Span::styled(
            " ▓ INPUT ▓ ",
            Style::default()
                .fg(theme.bg_inverse())
                .bg(theme.bg_brand())
                .add_modifier(Modifier::BOLD),
        ))
        .style(Style::default().bg(theme.bg_inverse()));

    let lines = vec![
        Line::from(Span::styled(
            display,
            Style::default().fg(theme.text_on_inverse()),
        )),
        Line::from(vec![Span::styled(
            "  ↑/↓ history · Ctrl+J newline · ⏎ send · Esc/q quit · PD_THEME=light to flip",
            Style::default().fg(theme.text_inverse_subtle()),
        )]),
    ];

    frame.render_widget(Paragraph::new(lines).block(block), area);
}
