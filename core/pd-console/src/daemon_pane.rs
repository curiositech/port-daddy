// Constructed by the gpui `pd-console` bin; the no-gpui repl bin compiles it for
// its unit tests but doesn't build the window, so allow dead_code there.
#![allow(dead_code)]
//! Daemon picker surface (ADR-0084) — lists the named daemon berths and marks
//! the one the console is currently bound to. The operator switches with the
//! `u` command (`ControlMsg::RebindDaemon`); this pane is the visible list of
//! names to choose from, mirroring FleetBar's "Daemons" section.
//!
//! Render-agnostic like every pane: it emits `Block`s with a `Tone`, never a
//! colour. The active berth is detected by comparing each berth's url against
//! the live `DaemonClient::base()` it is refreshed with — so after a rebind the
//! producer swaps the client and the next refresh re-marks the active one, with
//! no extra plumbing.

use std::future::Future;
use std::pin::Pin;

use anyhow::Result;

use crate::agent::DaemonClient;
use crate::berths::{self, Berth};
use crate::pane::{Block, Pane, Tone};

pub struct DaemonPane {
    berths: Vec<Berth>,
    active_url: String,
}

impl DaemonPane {
    pub fn new() -> Self {
        Self {
            berths: Vec::new(),
            active_url: String::new(),
        }
    }

    /// Tier → tone (meaning, resolved to OKLCH by the renderer): the canonical
    /// stable lane reads "landed", the shared dev-latest lane "accent", a named
    /// codebase berth "engaged".
    fn tone_for(tier: &str) -> Tone {
        match tier {
            "stable" => Tone::Landed,
            "dev-latest" => Tone::Accent,
            _ => Tone::Engaged,
        }
    }

    fn is_active(&self, b: &Berth) -> bool {
        !self.active_url.is_empty() && self.active_url == b.url()
    }
}

impl Pane for DaemonPane {
    fn id(&self) -> &str {
        "daemons"
    }

    fn title(&self) -> String {
        "Daemons".into()
    }

    fn view(&self) -> Vec<Block> {
        let mut blocks = vec![Block::Header("Daemons".into())];
        if self.berths.is_empty() {
            blocks.push(Block::KeyVal("status".into(), "no daemons found".into()));
            return blocks;
        }
        for b in &self.berths {
            let active = self.is_active(b);
            let label = if active {
                format!("{}  ◀ active", b.display())
            } else {
                b.display()
            };
            blocks.push(Block::Flag {
                letter: b.tier.chars().next().unwrap_or('?').to_ascii_uppercase(),
                label,
                tone: if active {
                    Tone::Accent
                } else {
                    Self::tone_for(&b.tier)
                },
            });
        }
        blocks.push(Block::Gap);
        blocks.push(Block::KeyVal(
            "switch".into(),
            "press u, type a name / :port / tier".into(),
        ));
        blocks
    }

    fn refresh<'a>(
        &'a mut self,
        daemon: &'a DaemonClient,
    ) -> Pin<Box<dyn Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            // fs-only enumeration (registry + synthesized stable berth) — cheap,
            // no network. Reachability/version probing is a follow-up.
            self.berths = berths::discover();
            self.active_url = daemon.base().trim_end_matches('/').to_string();
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PUBLISHED_STABLE_PORT: u16 = 43121;

    fn pane_with(berths: Vec<Berth>, active_url: &str) -> DaemonPane {
        DaemonPane {
            berths,
            active_url: active_url.to_string(),
        }
    }

    fn sample_berths() -> Vec<Berth> {
        vec![
            Berth {
                label: "stable".into(),
                tier: "stable".into(),
                port: PUBLISHED_STABLE_PORT,
                canonical: true,
            },
            Berth {
                label: "dev-latest".into(),
                tier: "dev-latest".into(),
                port: 9886,
                canonical: false,
            },
        ]
    }

    #[test]
    fn empty_state_renders_a_status_line() {
        let pane = pane_with(Vec::new(), "");
        let blocks = pane.view();
        assert!(matches!(blocks[0], Block::Header(_)));
        assert!(matches!(blocks[1], Block::KeyVal(ref k, _) if k == "status"));
    }

    #[test]
    fn populated_state_lists_every_berth_as_a_flag() {
        let pane = pane_with(sample_berths(), "");
        let flags = pane
            .view()
            .into_iter()
            .filter(|b| matches!(b, Block::Flag { .. }))
            .count();
        assert_eq!(flags, 2);
    }

    #[test]
    fn marks_the_active_berth_by_matching_the_client_base() {
        let pane = pane_with(sample_berths(), "http://127.0.0.1:9886");
        let labels: Vec<String> = pane
            .view()
            .into_iter()
            .filter_map(|b| match b {
                Block::Flag { label, .. } => Some(label),
                _ => None,
            })
            .collect();
        // dev-latest is active; stable is not.
        assert!(labels
            .iter()
            .any(|l| l.contains("dev-latest") && l.contains("active")));
        assert!(labels
            .iter()
            .any(|l| l.contains("stable") && !l.contains("active")));
    }

    #[test]
    fn id_is_stable() {
        assert_eq!(pane_with(Vec::new(), "").id(), "daemons");
    }
}
