//! Claims pane — live view of file/symbol/region claims across all sessions.
//!
//! Calls `GET /claims?limit=60` on the daemon.
//! Shows who owns what: session, path, claim type, age.

use crate::agent::DaemonClient;
use crate::pane::{Block, Pane, Tone};
use anyhow::Result;
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaimEntry {
    #[serde(rename = "claimId", default)]
    claim_id: String,
    #[serde(rename = "sessionId", default)]
    session_id: Option<String>,
    #[serde(default)]
    path: String,
    #[serde(rename = "claimType", default)]
    claim_type: String,
    #[serde(default)]
    scope: Option<String>,
    #[serde(rename = "createdAt", default)]
    created_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ClaimsResponse {
    #[serde(default)]
    claims: Vec<ClaimEntry>,
}

fn ts_short(ts: Option<&str>) -> String {
    match ts {
        Some(s) if s.len() >= 19 => s[11..19].to_string(),
        Some(s) => s.to_string(),
        None => "—".into(),
    }
}

pub struct ClaimsPane {
    claims: Vec<ClaimEntry>,
    last_error: Option<String>,
}

impl Default for ClaimsPane {
    fn default() -> Self { Self { claims: Vec::new(), last_error: None } }
}

impl ClaimsPane {
    pub fn new() -> Self { Self::default() }
}

impl Pane for ClaimsPane {
    fn id(&self) -> &str { "claims" }
    fn title(&self) -> String { "Claims".into() }

    fn view(&self) -> Vec<Block> {
        let mut blocks = vec![Block::Header("File & Symbol Claims".into())];

        if let Some(err) = &self.last_error {
            blocks.push(Block::KeyVal("error".into(), err.clone()));
            return blocks;
        }

        if self.claims.is_empty() {
            blocks.push(Block::KeyVal("status".into(), "no active claims".into()));
        } else {
            blocks.push(Block::KeyVal("total".into(), self.claims.len().to_string()));
            blocks.push(Block::Gap);

            for claim in &self.claims {
                let ts = ts_short(claim.created_at.as_deref());
                let sess = claim.session_id.as_deref()
                    .map(|s| &s[..s.len().min(12)])
                    .unwrap_or("—");
                let path_short = if claim.path.len() > 40 {
                    format!("…{}", &claim.path[claim.path.len() - 39..])
                } else {
                    claim.path.clone()
                };
                let ctype = if claim.claim_type.is_empty() { "file" } else { &claim.claim_type };
                let tone = match ctype {
                    "symbol" | "region" => Tone::Accent,
                    _ => Tone::Engaged,
                };
                blocks.push(Block::Row(vec![
                    ts,
                    ctype.to_string(),
                    sess.to_string(),
                    path_short,
                ]));
                let _ = tone;
            }
        }

        blocks.push(Block::Gap);
        blocks.push(Block::Chip {
            label: format!("{} claim{}", self.claims.len(), if self.claims.len() == 1 { "" } else { "s" }),
            tone: if self.claims.is_empty() { Tone::Resting } else { Tone::Engaged },
        });
        blocks
    }

    fn refresh<'a>(
        &'a mut self,
        daemon: &'a DaemonClient,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            let url = format!("{}/claims?limit=60", daemon.base());
            match daemon.http_client().get(&url).send().await {
                Err(e) => {
                    self.last_error = Some(format!("daemon unreachable: {e}"));
                    self.claims.clear();
                }
                Ok(resp) => {
                    match resp.json::<ClaimsResponse>().await {
                        Err(e) => self.last_error = Some(format!("bad response: {e}")),
                        Ok(data) => {
                            self.last_error = None;
                            self.claims = data.claims;
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

    fn make_claim(path: &str, ctype: &str) -> ClaimEntry {
        ClaimEntry {
            claim_id: "claim-123".into(),
            session_id: Some("sess-abc".into()),
            path: path.into(),
            claim_type: ctype.into(),
            scope: None,
            created_at: Some("2026-06-10T15:00:00Z".into()),
        }
    }

    #[test]
    fn view_empty() {
        let p = ClaimsPane::default();
        let b = p.view();
        assert!(matches!(&b[0], Block::Header(h) if h.contains("Claims")));
    }

    #[test]
    fn view_claims() {
        let mut p = ClaimsPane::default();
        p.claims = vec![
            make_claim("core/pd-console/src/app.rs", "file"),
            make_claim("lib/agent.ts", "symbol"),
        ];
        let b = p.view();
        let rows = b.iter().filter(|blk| matches!(blk, Block::Row(_))).count();
        assert_eq!(rows, 2);
    }

    #[test]
    fn ts_short_extracts_time() {
        assert_eq!(ts_short(Some("2026-06-10T15:00:00Z")), "15:00:00");
    }
}
