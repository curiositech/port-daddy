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
#[derive(Debug, Clone, Copy)]
pub enum Tone {
    Default,
    Accent,
    Engaged,
    Gated,
    Resting,
    Landed,
    Conflicted,
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
        }
    }
}

/// The render-agnostic primitives a pane emits. Both renderers paint these.
#[derive(Debug, Clone)]
pub enum Block {
    Header(String),
    KeyVal(String, String),
    Row(Vec<String>),
    Chip { label: String, tone: Tone },
    Spark(Vec<f32>),
    Gap,
}

/// What every pane implements. Object-safe (the registry holds `Box<dyn Pane>`):
/// `view()` is sync; data is pulled in `refresh()` which the registry drives.
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
}

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
    fn pane_is_object_safe_and_emits_blocks() {
        let mut reg = PaneRegistry::default();
        reg.register(Box::new(CoastGuardPane::default()));
        let p = reg.active().expect("active pane");
        assert_eq!(p.id(), "coast-guard");
        assert!(!p.view().is_empty());
    }
}
