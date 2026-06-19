//! Cost Ledger pane — where the operator watches the money.
//!
//! The governance surface of the voyage loop. Joins two daemon reads:
//!   - `GET /metrics/cost`  → `{ totals, byProject, byBackend }` (last 24h spend)
//!   - `GET /wallets`       → `{ wallets: [{ project, balanceUsd, budgetUsdPerDay }] }`
//! into one legible ledger: today's burn hero, per-project spend-vs-cap bars
//! (color-coded by % of the daily budget), and where the money went by backend.
//!
//! Designed via the grafted `admin-dashboard` + `cost-accrual-tracker` skills:
//! one scannable hero metric, then progressive detail, thresholds as color.

use crate::agent::DaemonClient;
use crate::pane::{Block, Pane, Tone};
use crate::util::arr;
use anyhow::Result;
use serde_json::Value;

/// Tolerant float extractor (cost values are f64; daemon may send ints).
fn f(v: &Value, key: &str) -> f64 {
    v.get(key).and_then(|x| x.as_f64()).unwrap_or(0.0)
}

fn usd(x: f64) -> String {
    if x >= 100.0 {
        format!("${x:.0}")
    } else {
        format!("${x:.2}")
    }
}

/// A 10-cell proportional fill bar (`████████░░`) for spend-vs-cap.
fn burn_bar(pct: f64) -> String {
    let filled = ((pct / 10.0).round() as i64).clamp(0, 10) as usize;
    let mut s = String::with_capacity(10);
    for _ in 0..filled {
        s.push('█');
    }
    for _ in filled..10 {
        s.push('░');
    }
    s
}

#[derive(Default)]
pub struct LedgerPane {
    cost: Option<Value>,    // GET /metrics/cost
    wallets: Option<Value>, // GET /wallets (best-effort; 501 without db dep)
    last_error: Option<String>,
}

impl LedgerPane {
    pub fn new() -> Self {
        Self::default()
    }
}

impl Pane for LedgerPane {
    fn id(&self) -> &str {
        "ledger"
    }
    fn title(&self) -> String {
        "Cost".into()
    }

    fn view(&self) -> Vec<Block> {
        let mut blocks = vec![Block::Header("Cost Ledger — last 24h".into())];

        if let Some(err) = &self.last_error {
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            blocks.push(Block::Chip {
                label: "cost data unavailable".into(),
                tone: Tone::Gated,
            });
            return blocks;
        }

        // ── Today's spend hero ────────────────────────────────────────────────
        let totals = self.cost.as_ref().and_then(|c| c.get("totals"));
        let spent = totals.map(|t| f(t, "totalUsd")).unwrap_or(0.0);
        let spawns = totals.map(|t| f(t, "spawnCount") as i64).unwrap_or(0);
        let est = totals.map(|t| f(t, "estimatedCount") as i64).unwrap_or(0);

        blocks.push(Block::Chip {
            label: format!("spent (24h)  {}", usd(spent)),
            tone: Tone::Accent,
        });
        let detail = if est > 0 {
            format!("{spawns} spawns · {est} estimated")
        } else {
            format!("{spawns} spawns")
        };
        blocks.push(Block::KeyVal("activity".into(), detail));
        blocks.push(Block::Gap);

        // ── Per-project burn bars (join byProject ⨝ wallets) ──────────────────
        blocks.push(Block::Header("By project — spend vs daily cap".into()));
        let empty: &[Value] = &[];
        let by_project = self.cost.as_ref().map(|c| arr(c, "byProject")).unwrap_or(empty);
        let wallets = self
            .wallets
            .as_ref()
            .map(|w| arr(w, "wallets"))
            .unwrap_or(empty);

        let mut any = false;
        for row in by_project {
            any = true;
            let proj = row
                .get("projectName")
                .and_then(|v| v.as_str())
                .unwrap_or("(unattributed)")
                .to_string();
            let proj_spent = f(row, "totalUsd");
            let wallet = wallets.iter().find(|w| {
                w.get("project").and_then(|v| v.as_str()) == Some(proj.as_str())
            });
            let cap = wallet.map(|w| f(w, "budgetUsdPerDay")).filter(|c| *c > 0.0);

            match cap {
                Some(cap) => {
                    let pct = if cap > 0.0 { proj_spent / cap * 100.0 } else { 0.0 };
                    // Threshold tone: <70% landed (calm), 70–90% gated (watch),
                    // ≥90% conflicted (alarm). Color = the only meaning carried.
                    let tone = if pct >= 90.0 {
                        Tone::Conflicted
                    } else if pct >= 70.0 {
                        Tone::Gated
                    } else {
                        Tone::Landed
                    };
                    blocks.push(Block::Chip {
                        label: format!(
                            "{proj}  {bar}  {pct:.0}%   {sp} / {cp}",
                            bar = burn_bar(pct),
                            pct = pct,
                            sp = usd(proj_spent),
                            cp = usd(cap),
                        ),
                        tone,
                    });
                }
                None => {
                    blocks.push(Block::Row(vec![
                        proj,
                        usd(proj_spent),
                        "no cap".into(),
                    ]));
                }
            }
            if let Some(w) = wallet {
                let bal = f(w, "balanceUsd");
                blocks.push(Block::KeyVal("  balance".into(), usd(bal)));
            }
        }
        if !any {
            blocks.push(Block::KeyVal("(no spend)".into(), "last 24h".into()));
        }
        blocks.push(Block::Gap);

        // ── Where the money went (by backend) ─────────────────────────────────
        let by_backend = self
            .cost
            .as_ref()
            .map(|c| arr(c, "byBackend"))
            .unwrap_or(empty);
        if !by_backend.is_empty() {
            blocks.push(Block::Header("By backend".into()));
            for b in by_backend {
                let name = b
                    .get("backend")
                    .and_then(|v| v.as_str())
                    .unwrap_or("?")
                    .to_string();
                let total = f(b, "totalUsd");
                let count = f(b, "count") as i64;
                blocks.push(Block::Row(vec![name, usd(total), format!("{count}×")]));
            }
        }

        blocks
    }

    fn refresh<'a>(
        &'a mut self,
        daemon: &'a DaemonClient,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            // Cost metrics are the spine of this surface — a failure here is the
            // pane's error state.
            let cost_url = format!("{}/metrics/cost", daemon.base());
            match daemon.http_client().get(&cost_url).send().await {
                Err(e) => {
                    self.last_error = Some(format!("daemon unreachable: {e}"));
                    self.cost = None;
                }
                Ok(resp) => match resp.json::<Value>().await {
                    Err(e) => self.last_error = Some(format!("bad cost response: {e}")),
                    Ok(data) => {
                        self.last_error = None;
                        self.cost = Some(data);
                    }
                },
            }

            // Wallets are best-effort: the route 501s without a db dep, and the
            // ledger still reads (spend without caps) — never fail the pane on it.
            let wallets_url = format!("{}/wallets", daemon.base());
            if let Ok(resp) = daemon.http_client().get(&wallets_url).send().await {
                if let Ok(data) = resp.json::<Value>().await {
                    if data.get("wallets").is_some() {
                        self.wallets = Some(data);
                    }
                }
            }

            Ok(())
        })
    }
}
