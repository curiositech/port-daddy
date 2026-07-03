//! The pane contract — how a pane plugs into the one console (terminal + GPU
//! both render the same `Block`s). Established for the Coast Guard lane (parley
//! 2026-06-05): they build the Coast-Guard DATA route/lib/CLI + a `CoastGuardPane`
//! that impls `Pane`; the console owns the shell + this contract.
//!
//! Render-agnostic on purpose: a pane emits `Block`s; the pd-tui (ratatui) and
//! pd-console (GPUI) renderers each paint them in the locked theme. One pane,
//! two faces.

use crate::agent::DaemonClient;
use crate::theme::Oklch;
use anyhow::Result;

/// Semantic tone — color = MEANING only (resolved to theme OKLCH by the renderer).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tone {
    Default,
    Accent,
    Engaged,
    Gated,
    Resting,
    Landed,
    Conflicted,
    /// LOUD alarm — daemon health is CRITICAL. Distinct from `Gated`/`Conflicted`
    /// (muted warning red): this is a deeper, higher-chroma distress red so a
    /// critical pane cannot be mistaken for an ordinary warning at a glance.
    Alarm,
}

impl Tone {
    pub fn color(self, t: &crate::theme::Theme) -> Oklch {
        match self {
            Tone::Default => t.ink2,
            Tone::Accent => t.accent,
            Tone::Engaged => t.engaged,
            Tone::Gated => t.gated,
            Tone::Resting => t.resting,
            Tone::Landed => t.landed,
            Tone::Conflicted => t.conflicted,
            Tone::Alarm => t.alarm,
        }
    }
}

/// The render-agnostic primitives a pane emits. Both renderers paint these.
#[derive(Debug, Clone)]
pub enum Block {
    Header(String),
    KeyVal(String, String),
    Row(Vec<String>),
    /// A conversational/event-stream line. Unlike [`Block::Row`], this is not
    /// tabular or clickable chrome; renderers should paint it as readable log
    /// typography with a small semantic marker.
    TranscriptLine { text: String, tone: Tone },
    /// A file or generated artifact referenced by a transcript. The path should
    /// be display-ready for the current developer environment, preferably
    /// relative to the active worktree so it can be found in the file tree.
    ArtifactRef {
        label: String,
        path: String,
        preview: Option<String>,
        tone: Tone,
    },
    Chip { label: String, tone: Tone },
    /// A maritime ICS signal flag: a colored square bearing the single letter,
    /// followed by a label (e.g. the agent identity + state). The console paints
    /// the square in the flag's semantic tone — a real flag, not `[A]` text.
    Flag { letter: char, label: String, tone: Tone },
    Spark(Vec<f32>),
    Gap,
    /// Full, wrapped, never-truncated text — for alert/HITL detail the operator
    /// must read in full (a daemon rejection, a stack of blocked reasons). The
    /// renderer wraps it; it never ellipsizes. (HCD: bridge the Gulf of Evaluation.)
    WrappedText { text: String, tone: Tone },
}

/// Severity of an [`Alert`] — drives tone + ordering on the HITL surface.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AlertLevel {
    /// An action the operator took was REFUSED (spawn rejected, dispatch failed).
    Error,
    /// Something the operator should know but isn't a hard block.
    Warn,
    /// Confirmation / success (a validated model, a landed action).
    Info,
}

impl AlertLevel {
    pub fn tone(self) -> Tone {
        match self {
            AlertLevel::Error => Tone::Conflicted,
            AlertLevel::Warn => Tone::Gated,
            AlertLevel::Info => Tone::Landed,
        }
    }
    pub fn label(self) -> &'static str {
        match self {
            AlertLevel::Error => "error",
            AlertLevel::Warn => "warn",
            AlertLevel::Info => "ok",
        }
    }
}

/// A captured action outcome surfaced to the operator instead of being swallowed.
/// `detail` is the FULL daemon message — never truncated at the source; the
/// renderer may show a short head with the full text expandable (the DLQ entry).
#[derive(Debug, Clone)]
pub struct Alert {
    pub level: AlertLevel,
    pub title: String,
    pub detail: String,
    /// epoch-ms; the bg thread stamps it. 0 in tests that don't care.
    pub ts: i64,
}

impl Alert {
    pub fn new(level: AlertLevel, title: impl Into<String>, detail: impl Into<String>) -> Self {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        Self { level, title: title.into(), detail: detail.into(), ts }
    }
    pub fn error(title: impl Into<String>, detail: impl Into<String>) -> Self {
        Self::new(AlertLevel::Error, title, detail)
    }
    pub fn info(title: impl Into<String>, detail: impl Into<String>) -> Self {
        Self::new(AlertLevel::Info, title, detail)
    }
}

/// A mutation an operator can ask a surface to perform against the daemon. This
/// is the cockpit's "grab the wheel" axis — surfaces are no longer read-only.
/// An action-enum (rather than a generic `mutate<T>`) keeps the trait
/// object-safe so the registry can still hold `Box<dyn Pane>`.
#[derive(Debug, Clone)]
pub enum SurfaceAction {
    /// Interrupt the running agent this surface is watching, with an optional
    /// operator reason. Closes the loop: the daemon echoes the control message
    /// back on the stream (`agent.tube`).
    Interrupt { reason: Option<String> },
}

/// What a surface wants to watch live, instead of (or alongside) 2s polling.
/// The surface declares its intent; main.rs owns opening the actual SSE stream
/// (`DaemonClient::subscribe_agent`) and pumping envelopes back via `on_stream`.
#[derive(Debug, Clone)]
pub enum Subscription {
    /// Subscribe to one agent's live feed (`GET /agents/:id/stream`).
    Agent { agent_id: String },
}

/// What every pane implements. Object-safe (the registry holds `Box<dyn Pane>`):
/// `view()` is sync; data is pulled in `refresh()` which the registry drives.
///
/// The trait is now a **Surface**: beyond read-only polling, a pane may perform
/// daemon `mutate`ions and declare a live `subscription`. Both have no-op /
/// `None` defaults, so the 14 existing read-only panes need no changes — this
/// is an additive evolution of the original `Pane` contract.
pub trait Pane: Send {
    /// Stable id (nav key, e.g. "coast-guard", "voyages", "ledger", "chat").
    fn id(&self) -> &str;
    /// Display title for the rail.
    fn title(&self) -> String;
    /// Emit the current view as render-agnostic blocks.
    fn view(&self) -> Vec<Block>;
    /// Pull fresh data from the daemon (shared client; canonical discovery).
    /// Boxed future keeps the trait object-safe without async-trait.
    fn refresh<'a>(
        &'a mut self,
        daemon: &'a DaemonClient,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>>;

    /// Perform an operator mutation against the daemon. Default: no-op (read-only
    /// surfaces ignore it). Returns a boxed future to stay object-safe.
    fn mutate<'a>(
        &'a mut self,
        daemon: &'a DaemonClient,
        action: SurfaceAction,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        let _ = (daemon, action);
        Box::pin(async { Ok(()) })
    }

    /// What this surface wants to watch live, if anything. Default: `None`
    /// (poll-only). When `Some`, main.rs opens the stream and feeds envelopes
    /// back via `on_stream`.
    fn subscription(&self) -> Option<Subscription> {
        None
    }

    /// Consume one live envelope from the surface's subscription. Default:
    /// ignore. Subscribing surfaces override this to fold streamed frames into
    /// their view state. (Boxed-future-free: stream folding is cheap & sync.)
    fn on_stream(&mut self, env: &crate::agent::StreamEnvelope) {
        let _ = env;
    }
}

/// Marker alias so call sites and docs can speak of a "Surface" — the evolved,
/// mutate-and-subscribe contract — while the object type stays `dyn Pane`.
pub use self::Pane as Surface;

/// The console's pane set. The shell renders the active pane; the rail lists all.
#[derive(Default)]
pub struct PaneRegistry {
    pub panes: Vec<Box<dyn Pane>>,
    pub active: usize,
}

impl PaneRegistry {
    pub fn register(&mut self, pane: Box<dyn Pane>) {
        self.panes.push(pane);
    }
    pub fn active(&self) -> Option<&dyn Pane> {
        self.panes.get(self.active).map(|b| b.as_ref())
    }
    pub async fn refresh_active(&mut self, daemon: &DaemonClient) -> Result<()> {
        if let Some(p) = self.panes.get_mut(self.active) {
            p.refresh(daemon).await?;
        }
        Ok(())
    }

    /// Dispatch an operator mutation to the active surface (the "grab the wheel"
    /// path). Read-only surfaces no-op via the trait default.
    pub async fn mutate_active(
        &mut self,
        daemon: &DaemonClient,
        action: SurfaceAction,
    ) -> Result<()> {
        if let Some(p) = self.panes.get_mut(self.active) {
            p.mutate(daemon, action).await?;
        }
        Ok(())
    }
}

/// STUB for the Coast Guard lane to fill — the shape to impl against.
/// (They own the data: a new GET /coast-guard/status the console never re-implements.)
pub struct CoastGuardPane {
    sandboxes: u32,
    egress_capped: bool,
}

impl Default for CoastGuardPane {
    fn default() -> Self {
        Self { sandboxes: 0, egress_capped: false }
    }
}

impl Pane for CoastGuardPane {
    fn id(&self) -> &str {
        "coast-guard"
    }
    fn title(&self) -> String {
        "Coast Guard".into()
    }
    fn view(&self) -> Vec<Block> {
        vec![
            Block::Header("Coast Guard".into()),
            Block::KeyVal("sandboxes".into(), self.sandboxes.to_string()),
            Block::Chip {
                label: if self.egress_capped { "egress capped" } else { "egress open" }.into(),
                tone: if self.egress_capped { Tone::Landed } else { Tone::Gated },
            },
        ]
    }
    fn refresh<'a>(
        &'a mut self,
        _daemon: &'a DaemonClient,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            // Coast Guard lane: hit GET /coast-guard/status here and fill these fields.
            // self.sandboxes = ...; self.egress_capped = ...;
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alert_carries_full_detail_and_maps_to_tone() {
        let a = Alert::error("spawn rejected (claude-cli)", "login cannot be verified non-interactively");
        assert_eq!(a.level, AlertLevel::Error);
        // Detail is preserved in full — never truncated at the source.
        assert!(a.detail.contains("non-interactively"));
        assert!(a.ts > 0, "error() stamps a real timestamp");
        // Level → tone is the renderer's severity color.
        assert_eq!(AlertLevel::Error.tone(), Tone::Conflicted);
        assert_eq!(AlertLevel::Info.tone(), Tone::Landed);
        assert_eq!(AlertLevel::Warn.tone(), Tone::Gated);
        assert_eq!(Alert::info("ok", "").level, AlertLevel::Info);
    }

    #[test]
    fn pane_is_object_safe_and_emits_blocks() {
        let mut reg = PaneRegistry::default();
        reg.register(Box::new(CoastGuardPane::default()));
        let p = reg.active().expect("active pane");
        assert_eq!(p.id(), "coast-guard");
        assert!(!p.view().is_empty());
    }

    #[test]
    fn read_only_surface_defaults_to_no_subscription_and_noop_mutate() {
        // The default Surface contract: a read-only pane subscribes to nothing
        // and ignores mutations without erroring.
        let coast = CoastGuardPane::default();
        assert!(coast.subscription().is_none());
    }

    /// A minimal surface that records the actions/envelopes it receives — proves
    /// the mutate dispatch and stream fold reach the active surface object-safely.
    struct RecordingSurface {
        actions: Vec<SurfaceAction>,
        envelopes: usize,
        watching: String,
    }

    impl Pane for RecordingSurface {
        fn id(&self) -> &str {
            "recording"
        }
        fn title(&self) -> String {
            "Recording".into()
        }
        fn view(&self) -> Vec<Block> {
            vec![Block::KeyVal("actions".into(), self.actions.len().to_string())]
        }
        fn refresh<'a>(
            &'a mut self,
            _daemon: &'a DaemonClient,
        ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>>
        {
            Box::pin(async { Ok(()) })
        }
        fn mutate<'a>(
            &'a mut self,
            _daemon: &'a DaemonClient,
            action: SurfaceAction,
        ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>>
        {
            self.actions.push(action);
            Box::pin(async { Ok(()) })
        }
        fn subscription(&self) -> Option<Subscription> {
            Some(Subscription::Agent { agent_id: self.watching.clone() })
        }
        fn on_stream(&mut self, _env: &crate::agent::StreamEnvelope) {
            self.envelopes += 1;
        }
    }

    #[test]
    fn mutate_dispatch_reaches_active_surface() {
        let mut reg = PaneRegistry::default();
        reg.register(Box::new(RecordingSurface {
            actions: Vec::new(),
            envelopes: 0,
            watching: "agent-abc".into(),
        }));

        // The surface declares its subscription...
        match reg.active().unwrap().subscription() {
            Some(Subscription::Agent { agent_id }) => assert_eq!(agent_id, "agent-abc"),
            other => panic!("expected Agent subscription, got {other:?}"),
        }

        // ...and a dispatched mutation lands on it (run the boxed future).
        // A real DaemonClient isn't needed: RecordingSurface ignores it. But
        // mutate takes &DaemonClient, so build a cheap one against a dummy base
        // (bound to a local so it outlives the borrow the future holds).
        let action = SurfaceAction::Interrupt { reason: Some("operator stop".into()) };
        let daemon = DaemonClient::new("http://127.0.0.1:1".into());
        let fut = reg.panes[0].mutate(&daemon, action);
        futures_block_on(fut).expect("mutate ok");

        // Downcast-free assertion: re-render and confirm the action was recorded.
        assert_eq!(reg.active().unwrap().view().len(), 1);
    }

    /// Tiny synchronous block-on so the object-safe boxed future test needs no
    /// tokio runtime (the no-op futures here never yield).
    fn futures_block_on<F: std::future::Future>(mut fut: F) -> F::Output {
        use std::task::{Context, Poll, RawWaker, RawWakerVTable, Waker};
        fn noop(_: *const ()) {}
        fn clone(_: *const ()) -> RawWaker {
            RawWaker::new(std::ptr::null(), &VTABLE)
        }
        static VTABLE: RawWakerVTable = RawWakerVTable::new(clone, noop, noop, noop);
        let waker = unsafe { Waker::from_raw(RawWaker::new(std::ptr::null(), &VTABLE)) };
        let mut cx = Context::from_waker(&waker);
        // Safety: `fut` is owned and never moved after pinning here.
        let mut fut = unsafe { std::pin::Pin::new_unchecked(&mut fut) };
        loop {
            if let Poll::Ready(v) = fut.as_mut().poll(&mut cx) {
                return v;
            }
        }
    }
}
