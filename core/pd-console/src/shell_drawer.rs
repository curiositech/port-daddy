//! Native PTY session backing pd-console's persistent CLI drawer.
//!
//! The drawer is deliberately a terminal, not a second command API: the
//! operator gets their real login shell, so `pd`, zsh/bash builtins, and normal
//! interactive programs share one honest process boundary. Bytes are parsed by
//! `vt100`; the GPUI view only renders the resulting terminal screen.

use anyhow::{Context, Result};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::ops::Range;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::mpsc as tokio_mpsc;

#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

pub const DEFAULT_ROWS: u16 = 24;
pub const DEFAULT_COLS: u16 = 120;
const RECOVERY_STATE_VERSION: u8 = 1;
const CHECKPOINT_INTERVAL: Duration = Duration::from_secs(2);
const MAX_RECOVERY_LINES: usize = 80;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellFailure {
    code: &'static str,
    summary: String,
    detail: String,
    next_action: String,
}

impl ShellFailure {
    pub fn new(
        code: &'static str,
        summary: impl Into<String>,
        detail: impl Into<String>,
        next_action: impl Into<String>,
    ) -> Self {
        Self {
            code,
            summary: sanitize_operator_text(&summary.into()),
            detail: sanitize_operator_text(&detail.into()),
            next_action: sanitize_operator_text(&next_action.into()),
        }
    }

    pub fn unavailable(detail: impl Into<String>) -> Self {
        Self::new(
            "PTY_UNAVAILABLE",
            "The CLI shell is unavailable.",
            detail,
            "Relaunch pd-console to start a fresh shell.",
        )
    }

    pub fn code(&self) -> &'static str {
        self.code
    }

    pub fn summary(&self) -> &str {
        &self.summary
    }

    pub fn detail(&self) -> &str {
        &self.detail
    }

    pub fn next_action(&self) -> &str {
        &self.next_action
    }

    pub fn operator_message(&self) -> String {
        format!(
            "{} {} {} Next: {}",
            self.code, self.summary, self.detail, self.next_action
        )
    }
}

impl From<String> for ShellFailure {
    fn from(detail: String) -> Self {
        Self::unavailable(detail)
    }
}

impl From<&str> for ShellFailure {
    fn from(detail: &str) -> Self {
        Self::unavailable(detail)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShellRetention {
    Off,
    Metadata,
    Screen,
}

impl ShellRetention {
    pub fn label(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Metadata => "metadata",
            Self::Screen => "screen",
        }
    }

    fn next(self) -> Self {
        match self {
            Self::Off => Self::Metadata,
            Self::Metadata => Self::Screen,
            Self::Screen => Self::Off,
        }
    }
}

impl Default for ShellRetention {
    fn default() -> Self {
        Self::Metadata
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellRecoveryReceipt {
    saved_at_unix_ms: u64,
    shell: String,
    launch_cwd: PathBuf,
    status: String,
    rows: u16,
    cols: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    screen_lines: Option<Vec<String>>,
}

impl ShellRecoveryReceipt {
    pub fn shell_label(&self) -> String {
        sanitize_operator_text(&self.shell)
    }

    pub fn launch_cwd_label(&self) -> String {
        sanitize_operator_text(&self.launch_cwd.to_string_lossy())
    }

    pub fn honest_status(&self) -> String {
        match self.status.as_str() {
            "live" | "starting" => {
                format!("{} at last checkpoint; process not resumed", self.status)
            }
            _ => self.status.clone(),
        }
    }

    pub fn size(&self) -> (u16, u16) {
        (self.rows, self.cols)
    }

    pub fn screen_preview_label(&self) -> Option<String> {
        self.screen_lines
            .as_deref()?
            .iter()
            .rev()
            .find(|line| !line.trim().is_empty())
            .map(|line| sanitize_operator_text(line))
    }

    pub fn age_label(&self) -> String {
        let now = unix_ms();
        let seconds = now.saturating_sub(self.saved_at_unix_ms) / 1_000;
        match seconds {
            0..=59 => "less than a minute ago".into(),
            60..=3_599 => format!("{}m ago", seconds / 60),
            3_600..=86_399 => format!("{}h ago", seconds / 3_600),
            _ => format!("{}d ago", seconds / 86_400),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShellRecoveryState {
    version: u8,
    retention: ShellRetention,
    receipt: Option<ShellRecoveryReceipt>,
}

impl Default for ShellRecoveryState {
    fn default() -> Self {
        Self {
            version: RECOVERY_STATE_VERSION,
            retention: ShellRetention::default(),
            receipt: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShellStatus {
    Starting,
    Running,
    Exited(u32),
    Failed(ShellFailure),
}

impl ShellStatus {
    pub fn label(&self) -> String {
        match self {
            Self::Starting => "starting".into(),
            Self::Running => "live".into(),
            Self::Exited(code) => format!("exited {code}"),
            Self::Failed(_) => "failed".into(),
        }
    }
}

#[derive(Debug)]
pub enum ShellEvent {
    Ready,
    Bytes(Vec<u8>),
    Exited(u32),
    Failed(ShellFailure),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerminalColor {
    Default,
    Indexed(u8),
    Rgb(u8, u8, u8),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalSpan {
    pub range: Range<usize>,
    pub foreground: TerminalColor,
    pub background: TerminalColor,
    pub bold: bool,
    pub italic: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalLine {
    pub text: String,
    pub spans: Vec<TerminalSpan>,
    pub cursor: Option<Range<usize>>,
}

#[derive(Debug)]
enum ShellInput {
    Bytes(Vec<u8>),
    Resize { rows: u16, cols: u16 },
}

/// Mutable terminal-screen model owned by the GPUI view.
pub struct ShellTerminal {
    parser: vt100::Parser,
    input_tx: Option<mpsc::Sender<ShellInput>>,
    status: ShellStatus,
    shell: String,
    cwd: PathBuf,
    last_output_at: Option<Instant>,
    size: (u16, u16),
    recovery_path: Option<PathBuf>,
    retention: ShellRetention,
    previous_receipt: Option<ShellRecoveryReceipt>,
    recovery_failure: Option<ShellFailure>,
    last_checkpoint_at: Option<Instant>,
}

impl ShellTerminal {
    /// Start the operator's login shell in a native PTY and return its event bus.
    pub fn spawn(cwd: PathBuf) -> Result<(Self, tokio_mpsc::UnboundedReceiver<ShellEvent>)> {
        let recovery_path = default_recovery_path();
        let (recovery, recovery_failure) = load_recovery_state(&recovery_path);
        let shell = resolve_shell();
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: DEFAULT_ROWS,
                cols: DEFAULT_COLS,
                pixel_width: 0,
                pixel_height: 0,
            })
            .context("open native PTY for the pd-console CLI drawer")?;

        let mut command = CommandBuilder::new(&shell);
        command.arg("-l");
        command.cwd(&cwd);
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        command.env("PORT_DADDY_SURFACE", "pd-console");

        let mut child = pair
            .slave
            .spawn_command(command)
            .with_context(|| format!("launch {} as a login shell", shell.display()))?;
        drop(pair.slave);

        let mut reader = pair
            .master
            .try_clone_reader()
            .context("clone the pd-console PTY reader")?;
        let mut writer = pair
            .master
            .take_writer()
            .context("take the pd-console PTY writer")?;
        let master = pair.master;

        let (event_tx, event_rx) = tokio_mpsc::unbounded_channel();
        let (input_tx, input_rx) = mpsc::channel::<ShellInput>();
        let boot_command = std::env::var("PD_CONSOLE_CLI_BOOT_COMMAND")
            .ok()
            .filter(|command| !command.contains(['\0', '\r', '\n']))
            .map(|command| format!("{command}\r").into_bytes());

        let ready_tx = event_tx.clone();
        thread::Builder::new()
            .name("pd-console-pty-input".into())
            .spawn(move || {
                let _ = ready_tx.send(ShellEvent::Ready);
                if let Some(command) = boot_command {
                    // The PTY is writable before a login shell has completed its
                    // startup files. Wait only in explicit visual-proof runs so
                    // the captured command enters at the same boundary as typing.
                    thread::sleep(Duration::from_millis(650));
                    if let Err(error) = writer.write_all(&command).and_then(|_| writer.flush()) {
                        let _ = ready_tx.send(ShellEvent::Failed(ShellFailure::new(
                            "PTY_BOOT_INPUT_FAILED",
                            "The proof command did not reach the shell.",
                            error.to_string(),
                            "Type the command in the drawer or relaunch pd-console.",
                        )));
                    }
                }
                while let Ok(input) = input_rx.recv() {
                    let result = match input {
                        ShellInput::Bytes(bytes) => {
                            writer.write_all(&bytes).and_then(|_| writer.flush())
                        }
                        ShellInput::Resize { rows, cols } => master
                            .resize(PtySize {
                                rows,
                                cols,
                                pixel_width: 0,
                                pixel_height: 0,
                            })
                            .map_err(std::io::Error::other),
                    };
                    if let Err(error) = result {
                        let _ = ready_tx.send(ShellEvent::Failed(ShellFailure::new(
                            "PTY_INPUT_FAILED",
                            "Input could not reach the CLI shell.",
                            error.to_string(),
                            "Relaunch pd-console to start a fresh shell.",
                        )));
                        break;
                    }
                }
            })
            .context("start the pd-console PTY input thread")?;

        let output_tx = event_tx.clone();
        thread::Builder::new()
            .name("pd-console-pty-output".into())
            .spawn(move || {
                let mut buffer = [0_u8; 8192];
                loop {
                    match reader.read(&mut buffer) {
                        Ok(0) => break,
                        Ok(read) => {
                            if output_tx
                                .send(ShellEvent::Bytes(buffer[..read].to_vec()))
                                .is_err()
                            {
                                break;
                            }
                        }
                        Err(error) => {
                            let _ = output_tx.send(ShellEvent::Failed(ShellFailure::new(
                                "PTY_OUTPUT_FAILED",
                                "The CLI shell output stream stopped.",
                                error.to_string(),
                                "Inspect the previous shell receipt, then relaunch pd-console.",
                            )));
                            break;
                        }
                    }
                }
            })
            .context("start the pd-console PTY output thread")?;

        thread::Builder::new()
            .name("pd-console-pty-child".into())
            .spawn(move || match child.wait() {
                Ok(status) => {
                    let _ = event_tx.send(ShellEvent::Exited(status.exit_code()));
                }
                Err(error) => {
                    let _ = event_tx.send(ShellEvent::Failed(ShellFailure::new(
                        "PTY_WAIT_FAILED",
                        "The CLI shell exit status is unknown.",
                        error.to_string(),
                        "Inspect the previous shell receipt, then relaunch pd-console.",
                    )));
                }
            })
            .context("start the pd-console PTY child monitor")?;

        let mut terminal = Self {
            parser: vt100::Parser::new(DEFAULT_ROWS, DEFAULT_COLS, 2_000),
            input_tx: Some(input_tx),
            status: ShellStatus::Starting,
            shell: display_shell(&shell),
            cwd,
            last_output_at: None,
            size: (DEFAULT_ROWS, DEFAULT_COLS),
            recovery_path: Some(recovery_path),
            retention: recovery.retention,
            previous_receipt: recovery.receipt,
            recovery_failure,
            last_checkpoint_at: None,
        };
        terminal.checkpoint(true);
        Ok((terminal, event_rx))
    }

    pub fn disconnected(cwd: PathBuf, error: impl Into<String>) -> Self {
        let shell = resolve_shell();
        Self {
            parser: vt100::Parser::new(DEFAULT_ROWS, DEFAULT_COLS, 2_000),
            input_tx: None,
            status: ShellStatus::Failed(ShellFailure::unavailable(error.into())),
            shell: display_shell(&shell),
            cwd,
            last_output_at: None,
            size: (DEFAULT_ROWS, DEFAULT_COLS),
            recovery_path: None,
            retention: ShellRetention::Off,
            previous_receipt: None,
            recovery_failure: None,
            last_checkpoint_at: None,
        }
    }

    pub fn disconnected_with_recovery(cwd: PathBuf, failure: ShellFailure) -> Self {
        let recovery_path = default_recovery_path();
        let (recovery, recovery_failure) = load_recovery_state(&recovery_path);
        let shell = resolve_shell();
        let mut terminal = Self {
            parser: vt100::Parser::new(DEFAULT_ROWS, DEFAULT_COLS, 2_000),
            input_tx: None,
            status: ShellStatus::Failed(failure),
            shell: display_shell(&shell),
            cwd,
            last_output_at: None,
            size: (DEFAULT_ROWS, DEFAULT_COLS),
            recovery_path: Some(recovery_path),
            retention: recovery.retention,
            previous_receipt: recovery.receipt,
            recovery_failure,
            last_checkpoint_at: None,
        };
        terminal.checkpoint(true);
        terminal
    }

    pub fn apply(&mut self, event: ShellEvent) {
        let force_checkpoint = !matches!(&event, ShellEvent::Bytes(_));
        match event {
            ShellEvent::Ready => self.status = ShellStatus::Running,
            ShellEvent::Bytes(bytes) => {
                self.parser.process(&bytes);
                self.last_output_at = Some(Instant::now());
                if matches!(self.status, ShellStatus::Starting) {
                    self.status = ShellStatus::Running;
                }
            }
            ShellEvent::Exited(code) => self.status = ShellStatus::Exited(code),
            ShellEvent::Failed(error) => self.status = ShellStatus::Failed(error),
        }
        self.checkpoint(force_checkpoint);
    }

    pub fn send(&self, bytes: impl Into<Vec<u8>>) -> bool {
        self.input_tx
            .as_ref()
            .is_some_and(|tx| tx.send(ShellInput::Bytes(bytes.into())).is_ok())
    }

    pub fn resize(&mut self, rows: u16, cols: u16) -> bool {
        let rows = rows.max(2);
        let cols = cols.max(20);
        if self.size == (rows, cols) {
            return true;
        }
        self.size = (rows, cols);
        self.parser.set_size(rows, cols);
        self.input_tx
            .as_ref()
            .is_some_and(|tx| tx.send(ShellInput::Resize { rows, cols }).is_ok())
    }

    fn plain_lines(&self, max_lines: usize) -> Vec<String> {
        let mut lines: Vec<String> = self
            .parser
            .screen()
            .contents()
            .lines()
            .map(str::to_owned)
            .collect();
        while lines.last().is_some_and(|line| line.trim().is_empty()) {
            lines.pop();
        }
        let start = lines.len().saturating_sub(max_lines);
        lines.drain(..start);
        if lines.is_empty() {
            lines.push(String::new());
        }
        lines
    }

    #[cfg(test)]
    pub fn lines(&self, max_lines: usize) -> Vec<String> {
        self.plain_lines(max_lines)
    }

    /// Return visible terminal rows with ANSI cell attributes preserved as
    /// byte ranges over one shaped string per row. Rendering a StyledText per
    /// row keeps Parley batching intact; there is never a GPUI div per cell.
    pub fn styled_lines(&self, max_lines: usize) -> Vec<TerminalLine> {
        #[derive(Debug, Clone, Copy, PartialEq, Eq)]
        struct CellStyle {
            foreground: TerminalColor,
            background: TerminalColor,
            bold: bool,
            italic: bool,
        }

        let screen = self.parser.screen();
        let (rows, cols) = screen.size();
        let (cursor_row, cursor_col) = screen.cursor_position();
        let mut rendered = Vec::with_capacity(rows as usize);

        for row in 0..rows {
            let mut text = String::new();
            let mut spans = Vec::new();
            let mut active_style: Option<(CellStyle, usize)> = None;
            let mut cursor = None;

            let mut last_col = 0;
            for col in 0..cols {
                if screen
                    .cell(row, col)
                    .is_some_and(|cell| cell.has_contents())
                {
                    last_col = col + 1;
                }
            }
            if row == cursor_row {
                last_col = last_col.max((cursor_col + 1).min(cols));
            }

            for col in 0..last_col {
                let Some(cell) = screen.cell(row, col) else {
                    continue;
                };
                if cell.is_wide_continuation() {
                    continue;
                }

                let mut foreground = terminal_color(cell.fgcolor());
                let mut background = terminal_color(cell.bgcolor());
                if cell.inverse() {
                    std::mem::swap(&mut foreground, &mut background);
                }
                let style = CellStyle {
                    foreground,
                    background,
                    bold: cell.bold(),
                    italic: cell.italic(),
                };

                if active_style.map(|(active, _)| active) != Some(style) {
                    if let Some((active, start)) = active_style.take() {
                        spans.push(TerminalSpan {
                            range: start..text.len(),
                            foreground: active.foreground,
                            background: active.background,
                            bold: active.bold,
                            italic: active.italic,
                        });
                    }
                    active_style = Some((style, text.len()));
                }

                let start = text.len();
                if cell.has_contents() {
                    text.push_str(&cell.contents());
                } else {
                    text.push(' ');
                }
                if row == cursor_row && col == cursor_col {
                    cursor = Some(start..text.len());
                }
            }

            if let Some((active, start)) = active_style.take() {
                spans.push(TerminalSpan {
                    range: start..text.len(),
                    foreground: active.foreground,
                    background: active.background,
                    bold: active.bold,
                    italic: active.italic,
                });
            }
            rendered.push(TerminalLine {
                text,
                spans,
                cursor,
            });
        }

        while rendered
            .last()
            .is_some_and(|line| line.text.trim().is_empty() && line.cursor.is_none())
        {
            rendered.pop();
        }
        while rendered
            .first()
            .is_some_and(|line| line.text.trim().is_empty() && line.cursor.is_none())
        {
            rendered.remove(0);
        }
        let start = rendered.len().saturating_sub(max_lines);
        rendered.drain(..start);
        if rendered.is_empty() {
            rendered.push(TerminalLine {
                text: " ".into(),
                spans: Vec::new(),
                cursor: Some(0..1),
            });
        }
        rendered
    }

    pub fn status(&self) -> &ShellStatus {
        &self.status
    }

    pub fn status_label(&self) -> String {
        self.status.label()
    }

    pub fn failure(&self) -> Option<&ShellFailure> {
        match &self.status {
            ShellStatus::Failed(error) => Some(error),
            _ => None,
        }
    }

    pub fn recovery_failure(&self) -> Option<&ShellFailure> {
        self.recovery_failure.as_ref()
    }

    pub fn retention(&self) -> ShellRetention {
        self.retention
    }

    pub fn cycle_retention(&mut self) -> ShellRetention {
        self.retention = self.retention.next();
        if self.retention == ShellRetention::Off {
            self.previous_receipt = None;
        }
        self.checkpoint(true);
        self.retention
    }

    pub fn previous_receipt(&self) -> Option<&ShellRecoveryReceipt> {
        self.previous_receipt.as_ref()
    }

    pub fn clear_previous_receipt(&mut self) {
        self.previous_receipt = None;
        self.recovery_failure = None;
        self.checkpoint(true);
    }

    pub fn shell(&self) -> &str {
        &self.shell
    }

    pub fn launch_cwd_label(&self) -> String {
        sanitize_operator_text(&self.cwd.to_string_lossy())
    }

    pub fn size(&self) -> (u16, u16) {
        self.size
    }

    pub fn is_live(&self) -> bool {
        matches!(self.status, ShellStatus::Starting | ShellStatus::Running)
    }

    fn checkpoint(&mut self, force: bool) {
        let Some(path) = self.recovery_path.as_ref() else {
            return;
        };
        if !force
            && self
                .last_checkpoint_at
                .is_some_and(|last| last.elapsed() < CHECKPOINT_INTERVAL)
        {
            return;
        }

        let receipt = if self.retention == ShellRetention::Off {
            None
        } else {
            Some(ShellRecoveryReceipt {
                saved_at_unix_ms: unix_ms(),
                shell: self.shell.clone(),
                launch_cwd: self.cwd.clone(),
                status: self.status_label(),
                rows: self.size.0,
                cols: self.size.1,
                screen_lines: (self.retention == ShellRetention::Screen)
                    .then(|| self.plain_lines(MAX_RECOVERY_LINES)),
            })
        };
        let state = ShellRecoveryState {
            version: RECOVERY_STATE_VERSION,
            retention: self.retention,
            receipt,
        };
        if let Err(error) = persist_recovery_state(path, &state) {
            self.recovery_failure = Some(ShellFailure::new(
                "PTY_RECEIPT_WRITE_FAILED",
                "The previous-shell receipt could not be saved.",
                error.to_string(),
                "Check ~/.port-daddy permissions or set receipt retention to off.",
            ));
        }
        self.last_checkpoint_at = Some(Instant::now());
    }
}

impl Drop for ShellTerminal {
    fn drop(&mut self) {
        self.checkpoint(true);
    }
}

pub fn default_cwd() -> PathBuf {
    std::env::var_os("PD_CONSOLE_WORKDIR")
        .map(PathBuf::from)
        .filter(|path| path.is_dir())
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(|| PathBuf::from("/"))
}

pub fn default_recovery_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/"))
        .join(".port-daddy")
        .join("pd-console")
        .join("shell-state.json")
}

/// Translate a platform keystroke into the byte sequence expected by a VT100
/// PTY. The GPUI view keeps Ctrl-A as its leader and calls this for every other
/// terminal-owned key; the function itself is renderer-independent and tested
/// without constructing a native window.
pub fn terminal_key_bytes(
    key: &str,
    typed: Option<&str>,
    control: bool,
    alt: bool,
    platform: bool,
    function: bool,
) -> Option<Vec<u8>> {
    if platform || function {
        return None;
    }

    if control {
        if key.len() == 1 {
            let byte = key.as_bytes()[0].to_ascii_lowercase();
            if byte.is_ascii_lowercase() {
                return Some(vec![byte - b'a' + 1]);
            }
        }
        return match key {
            "space" => Some(vec![0]),
            "[" => Some(vec![0x1b]),
            "\\" => Some(vec![0x1c]),
            "]" => Some(vec![0x1d]),
            "^" => Some(vec![0x1e]),
            "_" => Some(vec![0x1f]),
            _ => None,
        };
    }

    let mut bytes = match key {
        "enter" => vec![b'\r'],
        "backspace" => vec![0x7f],
        "tab" => vec![b'\t'],
        "escape" => vec![0x1b],
        "up" => b"\x1b[A".to_vec(),
        "down" => b"\x1b[B".to_vec(),
        "right" => b"\x1b[C".to_vec(),
        "left" => b"\x1b[D".to_vec(),
        "home" => b"\x1b[H".to_vec(),
        "end" => b"\x1b[F".to_vec(),
        "pageup" => b"\x1b[5~".to_vec(),
        "pagedown" => b"\x1b[6~".to_vec(),
        "delete" => b"\x1b[3~".to_vec(),
        "space" => vec![b' '],
        _ => typed?.as_bytes().to_vec(),
    };
    if alt {
        bytes.insert(0, 0x1b);
    }
    Some(bytes)
}

fn unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn sanitize_operator_text(value: &str) -> String {
    const MAX_CHARS: usize = 800;
    let mut sanitized = String::with_capacity(value.len().min(MAX_CHARS));
    for character in value.chars().take(MAX_CHARS) {
        if character.is_control() {
            sanitized.push(' ');
        } else {
            sanitized.push(character);
        }
    }
    sanitized.trim().to_string()
}

fn load_recovery_state(path: &Path) -> (ShellRecoveryState, Option<ShellFailure>) {
    if !path.exists() {
        return (ShellRecoveryState::default(), None);
    }
    let result = fs::read(path)
        .with_context(|| format!("read {}", path.display()))
        .and_then(|bytes| {
            let state: ShellRecoveryState = serde_json::from_slice(&bytes)
                .with_context(|| format!("parse {}", path.display()))?;
            anyhow::ensure!(
                state.version == RECOVERY_STATE_VERSION,
                "unsupported receipt version {}",
                state.version
            );
            Ok(state)
        });
    match result {
        Ok(state) => (state, None),
        Err(error) => (
            ShellRecoveryState::default(),
            Some(ShellFailure::new(
                "PTY_RECEIPT_READ_FAILED",
                "The previous-shell receipt could not be read.",
                error.to_string(),
                "Clear the receipt; the new shell is unaffected.",
            )),
        ),
    }
}

fn persist_recovery_state(path: &Path, state: &ShellRecoveryState) -> Result<()> {
    let parent = path
        .parent()
        .context("shell recovery path has no parent directory")?;
    fs::create_dir_all(parent)
        .with_context(|| format!("create recovery directory {}", parent.display()))?;
    #[cfg(unix)]
    fs::set_permissions(parent, fs::Permissions::from_mode(0o700))
        .with_context(|| format!("protect recovery directory {}", parent.display()))?;

    let temp_path = path.with_extension(format!("tmp-{}", std::process::id()));
    let bytes = serde_json::to_vec_pretty(state).context("serialize shell recovery receipt")?;
    let mut options = OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options
        .open(&temp_path)
        .with_context(|| format!("open temporary receipt {}", temp_path.display()))?;
    file.write_all(&bytes)
        .and_then(|_| file.flush())
        .with_context(|| format!("write temporary receipt {}", temp_path.display()))?;
    drop(file);
    fs::rename(&temp_path, path)
        .with_context(|| format!("install recovery receipt {}", path.display()))?;
    #[cfg(unix)]
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .with_context(|| format!("protect recovery receipt {}", path.display()))?;
    Ok(())
}

fn resolve_shell() -> PathBuf {
    std::env::var_os("SHELL")
        .map(PathBuf::from)
        .filter(|path| path.is_file())
        .unwrap_or_else(|| PathBuf::from("/bin/zsh"))
}

fn display_shell(path: &Path) -> String {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("shell")
        .to_string();
    sanitize_operator_text(&name)
}

fn terminal_color(color: vt100::Color) -> TerminalColor {
    match color {
        vt100::Color::Default => TerminalColor::Default,
        vt100::Color::Idx(index) => TerminalColor::Indexed(index),
        vt100::Color::Rgb(red, green, blue) => TerminalColor::Rgb(red, green, blue),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_model_parses_screen_and_exit_state() {
        let mut terminal = ShellTerminal::disconnected(PathBuf::from("/tmp"), "offline");
        terminal.apply(ShellEvent::Bytes(b"PORT DADDY\r\n$ pd status".to_vec()));
        assert_eq!(terminal.lines(4), vec!["PORT DADDY", "$ pd status"]);
        terminal.apply(ShellEvent::Exited(7));
        assert_eq!(terminal.status_label(), "exited 7");
    }

    #[test]
    fn failed_status_exposes_recovery_message() {
        let terminal = ShellTerminal::disconnected(PathBuf::from("/tmp"), "launch denied");
        let failure = terminal.failure().expect("typed shell failure");
        assert_eq!(failure.code(), "PTY_UNAVAILABLE");
        assert_eq!(failure.detail(), "launch denied");
        assert_eq!(
            failure.next_action(),
            "Relaunch pd-console to start a fresh shell."
        );
        assert!(!terminal.is_live());
    }

    #[test]
    fn failure_text_neutralizes_control_characters() {
        let failure = ShellFailure::new(
            "PTY_TEST",
            "unsafe\nsummary",
            "detail\x1b[31m",
            "retry\rnow",
        );
        assert_eq!(failure.summary(), "unsafe summary");
        assert_eq!(failure.detail(), "detail [31m");
        assert_eq!(failure.next_action(), "retry now");
    }

    #[test]
    fn recovery_labels_neutralize_persisted_control_characters() {
        let receipt = ShellRecoveryReceipt {
            saved_at_unix_ms: unix_ms(),
            shell: "zsh\nspoof".into(),
            launch_cwd: PathBuf::from("/tmp/work"),
            status: "exited 0".into(),
            rows: 24,
            cols: 120,
            screen_lines: Some(vec!["daemon\x1b[31m healthy".into()]),
        };

        assert_eq!(receipt.shell_label(), "zsh spoof");
        assert_eq!(
            receipt.screen_preview_label().as_deref(),
            Some("daemon [31m healthy")
        );
    }

    #[test]
    fn metadata_receipt_excludes_screen_and_environment() {
        let root = std::env::temp_dir().join(format!(
            "pd-console-shell-receipt-{}-{}",
            std::process::id(),
            unix_ms()
        ));
        let path = root.join("shell-state.json");
        let state = ShellRecoveryState {
            version: RECOVERY_STATE_VERSION,
            retention: ShellRetention::Metadata,
            receipt: Some(ShellRecoveryReceipt {
                saved_at_unix_ms: unix_ms(),
                shell: "zsh".into(),
                launch_cwd: PathBuf::from("/tmp/work"),
                status: "live at prior console close".into(),
                rows: 24,
                cols: 120,
                screen_lines: None,
            }),
        };

        persist_recovery_state(&path, &state).expect("persist recovery receipt");
        let raw = fs::read_to_string(&path).expect("read recovery receipt");
        assert!(!raw.contains("environment"));
        assert!(!raw.contains("screenLines"));
        let (loaded, failure) = load_recovery_state(&path);
        assert!(failure.is_none());
        assert_eq!(loaded, state);

        fs::remove_dir_all(root).expect("remove receipt fixture");
    }

    #[test]
    fn screen_receipt_is_explicit_and_versioned() {
        let state = ShellRecoveryState {
            version: RECOVERY_STATE_VERSION,
            retention: ShellRetention::Screen,
            receipt: Some(ShellRecoveryReceipt {
                saved_at_unix_ms: unix_ms(),
                shell: "zsh".into(),
                launch_cwd: PathBuf::from("/tmp/work"),
                status: "exited 0".into(),
                rows: 24,
                cols: 120,
                screen_lines: Some(vec!["$ pd status".into(), "daemon healthy".into()]),
            }),
        };
        let json = serde_json::to_value(state).expect("serialize recovery receipt");
        assert_eq!(json["version"], RECOVERY_STATE_VERSION);
        assert_eq!(json["retention"], "screen");
        assert_eq!(json["receipt"]["screenLines"][1], "daemon healthy");
    }

    #[test]
    fn styled_lines_preserve_truecolor_attributes() {
        let mut terminal = ShellTerminal::disconnected(PathBuf::from("/tmp"), "offline");
        terminal.apply(ShellEvent::Bytes(
            b"\x1b[38;2;12;34;56mPORT\x1b[0m".to_vec(),
        ));
        let lines = terminal.styled_lines(2);
        let line = lines
            .iter()
            .find(|line| line.text.contains("PORT"))
            .expect("colored terminal row");
        assert!(line.spans.iter().any(|span| {
            span.foreground == TerminalColor::Rgb(12, 34, 56)
                && &line.text[span.range.clone()] == "PORT"
        }));
    }

    #[test]
    fn printable_navigation_control_and_alt_keys_use_vt100_bytes() {
        assert_eq!(
            terminal_key_bytes("x", Some("x"), false, false, false, false),
            Some(vec![b'x'])
        );
        assert_eq!(
            terminal_key_bytes("up", None, false, false, false, false),
            Some(b"\x1b[A".to_vec())
        );
        assert_eq!(
            terminal_key_bytes("c", None, true, false, false, false),
            Some(vec![0x03])
        );
        assert_eq!(
            terminal_key_bytes("x", Some("x"), false, true, false, false),
            Some(vec![0x1b, b'x'])
        );
    }
}
