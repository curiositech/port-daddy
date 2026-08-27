//! Doctrine evidence pane — the deep pd-console face of the CASE-13 loop.
//!
//! This surface reads the daemon's canonical Agent Harbor doctrine-evidence
//! projection. It does not cache authority and it does not call the CLI or MCP:
//! every inspection and mutation travels directly through the daemon contract.
//!
//! The pane deliberately keeps doctrine advisory. It makes the chain legible —
//! episode, candidate, preregistered factual arms, retrieval receipt, agent
//! response, and verifier-backed outcome — without turning any of it into a
//! merge, deployment, or spend approval.

use crate::agent::DaemonClient;
use crate::pane::{Block, Pane, SurfaceAction, Tone};
use anyhow::{anyhow, Context, Result};
use serde_json::{json, Map, Value};

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct StatusSummary {
    episodes: u64,
    candidates: u64,
    provisional: u64,
    established: u64,
    contested: u64,
}

impl StatusSummary {
    fn from_value(value: &Value) -> Self {
        let counts = value.get("counts").unwrap_or(value);
        Self {
            episodes: count(counts, "episodes"),
            candidates: count(counts, "candidates"),
            provisional: count(counts, "provisional"),
            established: count(counts, "established"),
            contested: count(counts, "contested"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Candidate {
    id: String,
    doctrine_id: Option<String>,
    project_dir: String,
    decision_class: String,
    title: String,
    when: String,
    prefer: String,
    over: String,
    because: String,
    school: Option<String>,
    status: String,
    experiment_id: Option<String>,
    harvest_id: Option<String>,
    supersedes_doctrine_id: Option<String>,
    contested_reason: Option<String>,
    citations: Vec<String>,
    admission_citations: Vec<String>,
}

impl Candidate {
    fn from_value(value: &Value) -> Self {
        Self {
            id: text(value, "id"),
            doctrine_id: optional_text(value, "doctrineId"),
            project_dir: text(value, "projectDir"),
            decision_class: text(value, "decisionClass"),
            title: text(value, "title"),
            when: text(value, "when"),
            prefer: text(value, "prefer"),
            over: text(value, "over"),
            because: text(value, "because"),
            school: optional_text(value, "school"),
            status: text(value, "status"),
            experiment_id: optional_text(value, "experimentId"),
            harvest_id: optional_text(value, "harvestId"),
            supersedes_doctrine_id: optional_text(value, "supersedesDoctrineId"),
            contested_reason: optional_text(value, "contestedReason"),
            citations: strings(value, "citations"),
            admission_citations: strings(value, "admissionCitations"),
        }
    }

    fn citation_set(&self) -> Vec<String> {
        let mut citations = self.citations.clone();
        for citation in &self.admission_citations {
            if !citations.contains(citation) {
                citations.push(citation.clone());
            }
        }
        citations
    }
}

/// The first four logbook writes retain the daemon's full typed evidence
/// envelope. The console deliberately accepts JSON here instead of inventing
/// a lossy form for a research record: the server owns validation and verified
/// actor attribution, while this pane stamps its own provenance and never
/// shells out through another client surface.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DoctrineRecord {
    Episode,
    Candidate,
    Experiment,
    Run { experiment_id: String },
}

/// Typed operator commands carried through the console's control channel. The
/// foreground parses intent; the background thread owns the daemon request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DoctrineCommand {
    Record {
        record: DoctrineRecord,
        payload_json: String,
    },
    Harvest {
        payload_json: String,
    },
    Supersede {
        doctrine_id: String,
        successor_doctrine_id: String,
        reason: String,
    },
    Retire {
        doctrine_id: String,
        reason: String,
    },
    Show {
        doctrine_id: String,
    },
    Retrieve {
        decision_id: String,
        decision_class: String,
    },
    Admit {
        candidate_id: String,
        experiment_id: String,
    },
    Apply {
        retrieval_id: String,
        doctrine_id: String,
        response: String,
        decision: String,
    },
    Outcome {
        application_id: String,
        doctrine_id: String,
        verdict: String,
        verified_by: String,
        summary: String,
    },
    Contest {
        doctrine_id: String,
        reason: String,
    },
}

impl DoctrineCommand {
    /// Parse the compact pd-console grammar documented by [`DoctrinePane::view`].
    /// `::` separates a verifier-backed outcome's stable verifier id from its
    /// free-form evidence summary, keeping both fields explicit.
    pub fn parse(input: &str) -> std::result::Result<Self, String> {
        let input = input.trim();
        let (verb, rest) = input
            .split_once(char::is_whitespace)
            .map(|(verb, rest)| (verb.to_ascii_lowercase(), rest.trim()))
            .unwrap_or_else(|| (input.to_ascii_lowercase(), ""));
        let required = |value: Option<&str>, usage: &str| {
            value
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .ok_or_else(|| usage.to_string())
        };

        match verb.as_str() {
            "logbook" => Ok(Self::Record {
                record: DoctrineRecord::Episode,
                payload_json: json_payload(rest, "usage: doctrine logbook :: <JSON episode>")?,
            }),
            "induce" => Ok(Self::Record {
                record: DoctrineRecord::Candidate,
                payload_json: json_payload(rest, "usage: doctrine induce :: <JSON candidate>")?,
            }),
            "war-game" | "preregister" => Ok(Self::Record {
                record: DoctrineRecord::Experiment,
                payload_json: json_payload(rest, "usage: doctrine war-game :: <JSON experiment>")?,
            }),
            "run" => {
                let (experiment_id, payload_json) = rest
                    .split_once("::")
                    .ok_or_else(|| "usage: doctrine run <experiment-id> :: <JSON factual arm>".to_string())?;
                let mut words = experiment_id.split_whitespace();
                let experiment_id = required(words.next(), "usage: doctrine run <experiment-id> :: <JSON factual arm>")?;
                if words.next().is_some() {
                    return Err("usage: doctrine run <experiment-id> :: <JSON factual arm>".into());
                }
                Ok(Self::Record {
                    record: DoctrineRecord::Run { experiment_id },
                    payload_json: required(Some(payload_json), "doctrine run needs a JSON factual arm after ::")?,
                })
            }
            "harvest" => Ok(Self::Harvest {
                payload_json: json_payload(rest, "usage: doctrine harvest :: <JSON cited harvest>")?,
            }),
            "supersede" => {
                let (prefix, reason) = rest
                    .split_once("::")
                    .ok_or_else(|| "usage: doctrine supersede <old-doctrine-id> <successor-doctrine-id> :: <reason>".to_string())?;
                let mut words = prefix.split_whitespace();
                let doctrine_id = required(words.next(), "usage: doctrine supersede <old-doctrine-id> <successor-doctrine-id> :: <reason>")?;
                let successor_doctrine_id = required(words.next(), "usage: doctrine supersede <old-doctrine-id> <successor-doctrine-id> :: <reason>")?;
                if words.next().is_some() {
                    return Err("usage: doctrine supersede <old-doctrine-id> <successor-doctrine-id> :: <reason>".into());
                }
                let reason = required(Some(reason), "doctrine supersede needs a reason after ::")?;
                Ok(Self::Supersede { doctrine_id, successor_doctrine_id, reason })
            }
            "retire" => {
                let mut words = rest.splitn(2, char::is_whitespace);
                let doctrine_id = required(words.next(), "usage: doctrine retire <doctrine-id> <reason>")?;
                let reason = required(words.next(), "usage: doctrine retire <doctrine-id> <reason>")?;
                Ok(Self::Retire { doctrine_id, reason })
            }
            "show" => {
                let mut words = rest.split_whitespace();
                let doctrine_id = required(words.next(), "usage: doctrine show <doctrine-id>")?;
                if words.next().is_some() {
                    return Err("usage: doctrine show <doctrine-id>".into());
                }
                Ok(Self::Show { doctrine_id })
            }
            "retrieve" => {
                let mut words = rest.split_whitespace();
                let decision_id = required(words.next(), "usage: doctrine retrieve <decision-id> <decision-class>")?;
                let decision_class = required(words.next(), "usage: doctrine retrieve <decision-id> <decision-class>")?;
                if words.next().is_some() {
                    return Err("usage: doctrine retrieve <decision-id> <decision-class>".into());
                }
                Ok(Self::Retrieve { decision_id, decision_class })
            }
            "admit" => {
                let mut words = rest.split_whitespace();
                let candidate_id = required(words.next(), "usage: doctrine admit <candidate-id> <experiment-id>")?;
                let experiment_id = required(words.next(), "usage: doctrine admit <candidate-id> <experiment-id>")?;
                if words.next().is_some() {
                    return Err("usage: doctrine admit <candidate-id> <experiment-id>".into());
                }
                Ok(Self::Admit { candidate_id, experiment_id })
            }
            "apply" => {
                let mut words = rest.splitn(4, char::is_whitespace);
                let retrieval_id = required(words.next(), "usage: doctrine apply <retrieval-id> <doctrine-id> <follow|adapt|reject> <decision>")?;
                let doctrine_id = required(words.next(), "usage: doctrine apply <retrieval-id> <doctrine-id> <follow|adapt|reject> <decision>")?;
                let response = required(words.next(), "usage: doctrine apply <retrieval-id> <doctrine-id> <follow|adapt|reject> <decision>")?;
                if !matches!(response.as_str(), "follow" | "adapt" | "reject") {
                    return Err("doctrine apply response must be follow, adapt, or reject".into());
                }
                let decision = required(words.next(), "usage: doctrine apply <retrieval-id> <doctrine-id> <follow|adapt|reject> <decision>")?;
                Ok(Self::Apply { retrieval_id, doctrine_id, response, decision })
            }
            "outcome" => {
                let (prefix, summary) = rest
                    .split_once("::")
                    .ok_or_else(|| "usage: doctrine outcome <application-id> <doctrine-id> <helped|harmed|inconclusive> <verifier-id> :: <evidence summary>".to_string())?;
                let mut words = prefix.split_whitespace();
                let application_id = required(words.next(), "usage: doctrine outcome <application-id> <doctrine-id> <helped|harmed|inconclusive> <verifier-id> :: <evidence summary>")?;
                let doctrine_id = required(words.next(), "usage: doctrine outcome <application-id> <doctrine-id> <helped|harmed|inconclusive> <verifier-id> :: <evidence summary>")?;
                let verdict = required(words.next(), "usage: doctrine outcome <application-id> <doctrine-id> <helped|harmed|inconclusive> <verifier-id> :: <evidence summary>")?;
                if !matches!(verdict.as_str(), "helped" | "harmed" | "inconclusive") {
                    return Err("doctrine outcome verdict must be helped, harmed, or inconclusive".into());
                }
                let verified_by = required(words.next(), "usage: doctrine outcome <application-id> <doctrine-id> <helped|harmed|inconclusive> <verifier-id> :: <evidence summary>")?;
                if words.next().is_some() {
                    return Err("verifier id cannot contain spaces; put the evidence after ::".into());
                }
                let summary = required(Some(summary), "outcome needs a verifier-backed evidence summary after ::")?;
                Ok(Self::Outcome { application_id, doctrine_id, verdict, verified_by, summary })
            }
            "contest" => {
                let mut words = rest.splitn(2, char::is_whitespace);
                let doctrine_id = required(words.next(), "usage: doctrine contest <doctrine-id> <reason>")?;
                let reason = required(words.next(), "usage: doctrine contest <doctrine-id> <reason>")?;
                Ok(Self::Contest { doctrine_id, reason })
            }
            _ => Err("doctrine commands: logbook, induce, war-game, run, harvest, supersede, retire, show, retrieve, admit, apply, outcome, contest".into()),
        }
    }
}

fn json_payload(rest: &str, usage: &str) -> std::result::Result<String, String> {
    let (before, payload) = rest.split_once("::").ok_or_else(|| usage.to_string())?;
    if !before.trim().is_empty() {
        return Err(usage.to_string());
    }
    payload
        .trim()
        .strip_prefix('{')
        .map(|_| payload.trim().to_string())
        .ok_or_else(|| format!("{usage}; payload must be a JSON object"))
}

/// Deep operator view of the daemon-owned doctrine ledger.
pub struct DoctrinePane {
    status: StatusSummary,
    candidates: Vec<Candidate>,
    selected_doctrine_id: Option<String>,
    detail: Option<Value>,
    last_error: Option<String>,
    last_notice: Option<String>,
    writer_identity: Option<String>,
}

impl Default for DoctrinePane {
    fn default() -> Self {
        Self {
            status: StatusSummary::default(),
            candidates: Vec::new(),
            selected_doctrine_id: None,
            detail: None,
            last_error: None,
            last_notice: None,
            writer_identity: None,
        }
    }
}

impl DoctrinePane {
    pub fn new() -> Self {
        Self::default()
    }

    fn selected_candidate(&self) -> Result<&Candidate> {
        let selected = self.selected_doctrine_id.as_deref().and_then(|id| {
            self.candidates
                .iter()
                .find(|candidate| candidate.doctrine_id.as_deref() == Some(id))
        });
        selected.or_else(|| self.candidates.first()).ok_or_else(|| {
            anyhow!("no doctrine candidate is available; record an episode and candidate first")
        })
    }

    fn candidate_for_doctrine(&self, doctrine_id: &str) -> Result<&Candidate> {
        self.candidates
            .iter()
            .find(|candidate| candidate.doctrine_id.as_deref() == Some(doctrine_id))
            .ok_or_else(|| {
                anyhow!("doctrine {doctrine_id} is not present in the current daemon projection")
            })
    }

    fn candidate_for_id(&self, candidate_id: &str) -> Result<&Candidate> {
        self.candidates
            .iter()
            .find(|candidate| candidate.id == candidate_id)
            .ok_or_else(|| {
                anyhow!("candidate {candidate_id} is not present in the current daemon projection")
            })
    }

    async fn json_response(response: reqwest::Response, operation: &str) -> Result<Value> {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(anyhow!("{operation} returned {status}: {body}"));
        }
        serde_json::from_str(&body).with_context(|| format!("{operation} returned invalid JSON"))
    }

    async fn get(daemon: &DaemonClient, path: &str) -> Result<Value> {
        let response = daemon
            .http_client()
            .get(format!("{}{}", daemon.base(), path))
            .send()
            .await
            .with_context(|| format!("GET {path}"))?;
        Self::json_response(response, &format!("GET {path}")).await
    }

    async fn post(daemon: &DaemonClient, path: &str, body: Value) -> Result<Value> {
        let response = daemon
            .with_actor_credential(
                daemon
                    .http_client()
                    .post(format!("{}{}", daemon.base(), path)),
            )
            .json(&body)
            .send()
            .await
            .with_context(|| format!("POST {path}"))?;
        Self::json_response(response, &format!("POST {path}")).await
    }

    /// Preserve the typed API envelope for the research logbook while making
    /// the writing surface itself auditable. We require the caller to name a
    /// project and supply immutable citations; the daemon remains the final
    /// schema and lifecycle authority.
    fn console_evidence_payload(payload_json: &str) -> Result<Value> {
        let mut payload: Value = serde_json::from_str(payload_json)
            .with_context(|| "doctrine evidence payload must be valid JSON")?;
        let object = payload
            .as_object_mut()
            .ok_or_else(|| anyhow!("doctrine evidence payload must be a JSON object"))?;
        let project_dir = object
            .get("projectDir")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        if project_dir.is_empty() {
            return Err(anyhow!("doctrine evidence payload requires projectDir"));
        }
        if object
            .get("citations")
            .and_then(Value::as_array)
            .map_or(true, Vec::is_empty)
        {
            return Err(anyhow!(
                "doctrine evidence payload requires at least one citation"
            ));
        }
        // Actor identity is deliberately not accepted from the command text.
        // Mutations carry the console's daemon-minted credential and the route
        // stamps the verified actor id. A forged body field must never become
        // a role-conditioned CASE-13 datum.
        object.remove("actorId");
        let provenance = object
            .entry("provenance")
            .or_insert_with(|| Value::Object(Map::new()))
            .as_object_mut()
            .ok_or_else(|| anyhow!("doctrine provenance must be a JSON object when supplied"))?;
        provenance.insert("harness".into(), Value::String("pd-console".into()));
        provenance.insert("environment".into(), Value::String("operator".into()));
        Ok(payload)
    }

    async fn reload(&mut self, daemon: &DaemonClient) -> Result<()> {
        let status = Self::get(daemon, "/doctrine/status").await?;
        let candidates_response = Self::get(daemon, "/doctrine/candidates").await?;
        let candidates: Vec<Candidate> = candidates_response
            .get("candidates")
            .and_then(Value::as_array)
            .map(|items| items.iter().map(Candidate::from_value).collect())
            .unwrap_or_default();

        let selected = self
            .selected_doctrine_id
            .as_deref()
            .filter(|id| {
                candidates
                    .iter()
                    .any(|candidate: &Candidate| candidate.doctrine_id.as_deref() == Some(*id))
            })
            .map(str::to_string)
            .or_else(|| {
                candidates
                    .iter()
                    .find_map(|candidate| candidate.doctrine_id.clone())
            });

        let detail = match selected.as_deref() {
            Some(doctrine_id) => {
                Some(Self::get(daemon, &format!("/doctrine/{}", path_segment(doctrine_id))).await?)
            }
            None => None,
        };

        self.status = StatusSummary::from_value(&status);
        self.candidates = candidates;
        self.selected_doctrine_id = selected;
        self.detail = detail;
        self.writer_identity = daemon.actor_id_hint();
        self.last_error = None;
        Ok(())
    }

    async fn mutate_command(
        &mut self,
        daemon: &DaemonClient,
        command: DoctrineCommand,
    ) -> Result<()> {
        match command {
            DoctrineCommand::Record {
                record,
                payload_json,
            } => {
                let payload = Self::console_evidence_payload(&payload_json)?;
                let (path, label, result_pointers) = match record {
                    DoctrineRecord::Episode => (
                        "/doctrine/episodes".to_string(),
                        "episode",
                        &["/episode/episodeId", "/episode/id"][..],
                    ),
                    DoctrineRecord::Candidate => (
                        "/doctrine/candidates".to_string(),
                        "candidate",
                        &["/candidate/candidateId", "/candidate/id"][..],
                    ),
                    DoctrineRecord::Experiment => (
                        "/doctrine/experiments".to_string(),
                        "war-game",
                        &["/experiment/experimentId", "/experiment/id"][..],
                    ),
                    DoctrineRecord::Run { experiment_id } => (
                        format!(
                            "/doctrine/experiments/{}/runs",
                            path_segment(&experiment_id)
                        ),
                        "factual arm",
                        &[
                            "/controlRun/controlRunId",
                            "/treatmentRun/treatmentRunId",
                            "/run/runId",
                            "/run/id",
                        ][..],
                    ),
                };
                let value = Self::post(daemon, &path, payload).await?;
                let receipt = result_pointers
                    .iter()
                    .find_map(|pointer| value.pointer(pointer).and_then(Value::as_str))
                    .unwrap_or("recorded");
                self.last_notice =
                    Some(format!("{label} {receipt} appended to the daemon logbook"));
            }
            DoctrineCommand::Harvest { payload_json } => {
                let payload = Self::console_evidence_payload(&payload_json)?;
                let value = Self::post(daemon, "/doctrine/harvests", payload).await?;
                let harvest = value
                    .pointer("/harvest/harvestId")
                    .and_then(Value::as_str)
                    .unwrap_or("recorded");
                self.last_notice = Some(format!("Admiralty harvest {harvest} recorded as a cited observation; it is not doctrine until a falsifiable candidate is induced"));
            }
            DoctrineCommand::Supersede {
                doctrine_id,
                successor_doctrine_id,
                reason,
            } => {
                let candidate = self.candidate_for_doctrine(&doctrine_id)?.clone();
                let value = Self::post(
                    daemon,
                    &format!("/doctrine/{}/supersede", path_segment(&doctrine_id)),
                    json!({
                        "projectDir": candidate.project_dir,
                        "citations": candidate.citation_set(),
                        "provenance": { "harness": "pd-console", "environment": "operator" },
                        "successorDoctrineId": successor_doctrine_id,
                        "reason": reason,
                    }),
                )
                .await?;
                let successor = value
                    .pointer("/supersession/successorDoctrineId")
                    .and_then(Value::as_str)
                    .unwrap_or("successor");
                self.selected_doctrine_id = Some(successor.to_string());
                self.last_notice = Some(format!("immutable revision recorded; {doctrine_id} is superseded by {successor} rather than rewritten"));
            }
            DoctrineCommand::Retire {
                doctrine_id,
                reason,
            } => {
                let candidate = self.candidate_for_doctrine(&doctrine_id)?.clone();
                Self::post(
                    daemon,
                    &format!("/doctrine/{}/retire", path_segment(&doctrine_id)),
                    json!({
                        "projectDir": candidate.project_dir,
                        "citations": candidate.citation_set(),
                        "provenance": { "harness": "pd-console", "environment": "operator" },
                        "reason": reason,
                    }),
                )
                .await?;
                self.last_notice = Some(format!("doctrine {doctrine_id} retired from future orders; historical receipts remain visible"));
            }
            DoctrineCommand::Show { doctrine_id } => {
                self.selected_doctrine_id = Some(doctrine_id.clone());
                self.last_notice = Some(format!("showing doctrine {doctrine_id}"));
            }
            DoctrineCommand::Retrieve {
                decision_id,
                decision_class,
            } => {
                let candidate = self.selected_candidate()?.clone();
                let response = Self::post(
                    daemon,
                    "/doctrine/orders",
                    json!({
                        "projectDir": candidate.project_dir,
                        "citations": candidate.citation_set(),
                        "provenance": { "harness": "pd-console", "environment": "operator" },
                        "decisionId": decision_id,
                        "decisionClass": decision_class,
                    }),
                )
                .await?;
                let receipt = response
                    .pointer("/receipt/id")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown receipt");
                self.last_notice = Some(format!(
                    "retrieval receipt {receipt} recorded; the packet remains advisory"
                ));
            }
            DoctrineCommand::Admit {
                candidate_id,
                experiment_id,
            } => {
                let candidate = self.candidate_for_id(&candidate_id)?.clone();
                let response = Self::post(
                    daemon,
                    &format!("/doctrine/candidates/{}/admit", path_segment(&candidate_id)),
                    json!({
                        "projectDir": candidate.project_dir,
                        "citations": candidate.citation_set(),
                        "provenance": { "harness": "pd-console", "environment": "operator" },
                        "experimentId": experiment_id,
                        "status": "provisional",
                    }),
                )
                .await?;
                let doctrine_id = response
                    .pointer("/doctrine/doctrineId")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown doctrine");
                self.selected_doctrine_id = Some(doctrine_id.to_string());
                self.last_notice = Some(format!("provisional advisory {doctrine_id} admitted after the daemon verified its factual arms"));
            }
            DoctrineCommand::Apply {
                retrieval_id,
                doctrine_id,
                response,
                decision,
            } => {
                let candidate = self.candidate_for_doctrine(&doctrine_id)?.clone();
                let value = Self::post(
                    daemon,
                    &format!(
                        "/doctrine/retrievals/{}/application",
                        path_segment(&retrieval_id)
                    ),
                    json!({
                        "projectDir": candidate.project_dir,
                        "citations": candidate.citation_set(),
                        "provenance": { "harness": "pd-console", "environment": "operator" },
                        "doctrineId": doctrine_id,
                        "response": response,
                        "decision": decision,
                        "note": "recorded in pd-console",
                    }),
                )
                .await?;
                let application = value
                    .pointer("/application/applicationId")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown application");
                self.last_notice = Some(format!("agent response receipt {application} recorded; verifier outcome remains pending"));
            }
            DoctrineCommand::Outcome {
                application_id,
                doctrine_id,
                verdict,
                verified_by,
                summary,
            } => {
                let candidate = self.candidate_for_doctrine(&doctrine_id)?.clone();
                let value = Self::post(
                    daemon,
                    &format!(
                        "/doctrine/applications/{}/outcome",
                        path_segment(&application_id)
                    ),
                    json!({
                        "projectDir": candidate.project_dir,
                        "citations": candidate.citation_set(),
                        "provenance": { "harness": "pd-console", "environment": "operator" },
                        "verdict": verdict,
                        "summary": summary,
                        "verifiedBy": verified_by,
                    }),
                )
                .await?;
                let outcome = value
                    .pointer("/outcome/outcomeId")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown outcome");
                self.last_notice = Some(format!("verifier-backed outcome {outcome} recorded"));
            }
            DoctrineCommand::Contest {
                doctrine_id,
                reason,
            } => {
                let candidate = self.candidate_for_doctrine(&doctrine_id)?.clone();
                Self::post(
                    daemon,
                    &format!("/doctrine/{}/contest", path_segment(&doctrine_id)),
                    json!({
                        "projectDir": candidate.project_dir,
                        "citations": candidate.citation_set(),
                        "provenance": { "harness": "pd-console", "environment": "operator" },
                        "reason": reason,
                        "severity": "medium",
                    }),
                )
                .await?;
                self.last_notice = Some(format!("doctrine {doctrine_id} contested; it will no longer be retrieved as active advice"));
            }
        }
        self.reload(daemon).await
    }
}

impl Pane for DoctrinePane {
    fn id(&self) -> &str {
        "doctrine"
    }

    fn title(&self) -> String {
        "Doctrine Evidence".into()
    }

    fn view(&self) -> Vec<Block> {
        let mut blocks = vec![
            Block::Header("Empirically Earned Doctrine".into()),
            Block::Chip {
                label: "ADVISORY — never authorizes merge, deploy, spend, or irreversible action"
                    .into(),
                tone: Tone::Accent,
            },
            Block::KeyVal(
                "canonical store".into(),
                "Agent Harbor doctrine-evidence ledger".into(),
            ),
            Block::KeyVal(
                "write identity".into(),
                self.writer_identity.clone().unwrap_or_else(|| {
                    "not enrolled — start a pd-console session or provide its daemon-minted credential"
                        .into()
                }),
            ),
            Block::KeyVal("episodes".into(), self.status.episodes.to_string()),
            Block::KeyVal("candidates".into(), self.status.candidates.to_string()),
            Block::KeyVal(
                "provisional / established / contested".into(),
                format!(
                    "{} / {} / {}",
                    self.status.provisional, self.status.established, self.status.contested,
                ),
            ),
        ];

        if let Some(error) = &self.last_error {
            blocks.push(Block::KeyVal(
                "daemon evidence unavailable".into(),
                error.clone(),
            ));
            return blocks;
        }
        if let Some(notice) = &self.last_notice {
            blocks.push(Block::WrappedText {
                text: notice.clone(),
                tone: Tone::Landed,
            });
        }
        if self.candidates.is_empty() {
            blocks.push(Block::Gap);
            blocks.push(Block::WrappedText {
                text: "No doctrine candidates exist. Record a historical decision episode and induce a candidate through the shared daemon contract; this console will never invent advisory state locally.".into(),
                tone: Tone::Resting,
            });
            return blocks;
        }

        blocks.push(Block::Gap);
        blocks.push(Block::Header("Candidate ledger".into()));
        for candidate in &self.candidates {
            let doctrine_id = candidate.doctrine_id.as_deref().unwrap_or("unassigned");
            blocks.push(Block::Row(vec![
                short(doctrine_id, 26),
                candidate.status.clone(),
                short(&candidate.decision_class, 26),
                short(&candidate.title, 52),
            ]));
        }

        if let (Some(detail), Ok(candidate)) = (&self.detail, self.selected_candidate()) {
            let doctrine_id = candidate.doctrine_id.as_deref().unwrap_or("unassigned");
            blocks.push(Block::Gap);
            blocks.push(Block::Header(format!("Selected: {}", candidate.title)));
            blocks.push(Block::KeyVal("candidate id".into(), candidate.id.clone()));
            blocks.push(Block::KeyVal("doctrine id".into(), doctrine_id.into()));
            blocks.push(Block::KeyVal(
                "decision class".into(),
                candidate.decision_class.clone(),
            ));
            blocks.push(Block::KeyVal(
                "school".into(),
                candidate
                    .school
                    .clone()
                    .unwrap_or_else(|| "unclassified".into()),
            ));
            blocks.push(Block::KeyVal("when".into(), candidate.when.clone()));
            blocks.push(Block::KeyVal(
                "prefer".into(),
                format!("{} over {}", candidate.prefer, candidate.over),
            ));
            blocks.push(Block::WrappedText {
                text: candidate.because.clone(),
                tone: Tone::Default,
            });
            if let Some(harvest_id) = &candidate.harvest_id {
                blocks.push(Block::KeyVal(
                    "Admiralty harvest".into(),
                    harvest_id.clone(),
                ));
            }
            if let Some(supersedes) = &candidate.supersedes_doctrine_id {
                blocks.push(Block::KeyVal(
                    "immutable successor to".into(),
                    supersedes.clone(),
                ));
            }
            if let Some(reason) = &candidate.contested_reason {
                blocks.push(Block::WrappedText {
                    text: format!("CONTESTED: {reason}"),
                    tone: Tone::Conflicted,
                });
            }

            if let Some(experiment) = detail.get("experiment").filter(|value| !value.is_null()) {
                blocks.push(Block::Gap);
                blocks.push(Block::Header("Preregistered factual experiment".into()));
                blocks.push(Block::KeyVal(
                    "experiment id".into(),
                    text(experiment, "id"),
                ));
                blocks.push(Block::KeyVal(
                    "hypothesis".into(),
                    text(experiment, "hypothesis"),
                ));
                blocks.push(Block::KeyVal("control".into(), text(experiment, "control")));
                blocks.push(Block::KeyVal(
                    "treatment".into(),
                    text(experiment, "treatment"),
                ));
                if let Some(sham) = optional_text(experiment, "sham") {
                    blocks.push(Block::KeyVal("sham".into(), sham));
                }
                let factual_gate = has_matched_factual_arms(experiment);
                blocks.push(Block::Chip {
                    label: if factual_gate {
                        "matched factual control + treatment recorded"
                    } else {
                        "factual admission gate incomplete"
                    }
                    .into(),
                    tone: if factual_gate {
                        Tone::Landed
                    } else {
                        Tone::Gated
                    },
                });
                for run in array(experiment, "runs") {
                    blocks.push(Block::Row(vec![
                        text(run, "arm"),
                        text(run, "fidelity"),
                        short(&text(run, "action"), 40),
                        short(&text(run, "outcome"), 40),
                    ]));
                    if let Some(context) = replay_context_summary(run) {
                        blocks.push(Block::KeyVal(
                            format!("{} replay context", text(run, "arm")),
                            context,
                        ));
                    }
                }
            } else {
                blocks.push(Block::WrappedText {
                    text: "No preregistered experiment is attached. A transcript or prompt-only replay cannot admit this candidate.".into(),
                    tone: Tone::Gated,
                });
            }

            if let Some(harvest) = detail.get("harvest").filter(|value| !value.is_null()) {
                blocks.push(Block::Gap);
                blocks.push(Block::Header("Admiralty harvest receipt".into()));
                blocks.push(Block::KeyVal("harvest id".into(), text(harvest, "id")));
                blocks.push(Block::KeyVal(
                    "decision class".into(),
                    text(harvest, "decisionClass"),
                ));
                blocks.push(Block::KeyVal(
                    "source episodes".into(),
                    strings(harvest, "episodeIds").join(", "),
                ));
                blocks.push(Block::WrappedText {
                    text: text(harvest, "summary"),
                    tone: Tone::Resting,
                });
                blocks.push(Block::Chip {
                    label: "observation only — a reviewed falsifiable candidate is still required"
                        .into(),
                    tone: Tone::Gated,
                });
            }

            if let Some(successor) = doctrine_reference(detail, "successor") {
                blocks.push(Block::Chip {
                    label: format!("superseded by immutable successor {successor}"),
                    tone: Tone::Resting,
                });
            }
            if let Some(prior) = optional_text(detail, "supersededDoctrine") {
                blocks.push(Block::Chip {
                    label: format!("successor of {prior}; prior receipts remain intact"),
                    tone: Tone::Resting,
                });
            }

            append_evidence_chain(&mut blocks, detail);
        }

        blocks.push(Block::Gap);
        blocks.push(Block::Header("Write through the daemon contract".into()));
        blocks.push(Block::WrappedText {
            text: "Use Ctrl-A : then `doctrine logbook :: <JSON episode>`, `doctrine harvest :: <JSON cited harvest>`, `doctrine induce :: <JSON candidate>`, `doctrine war-game :: <JSON experiment>`, `doctrine run <experiment-id> :: <JSON factual arm>`, `doctrine show <doctrine-id>`, `doctrine retrieve <decision-id> <decision-class>`, `doctrine admit <candidate-id> <experiment-id>`, `doctrine apply <retrieval-id> <doctrine-id> <follow|adapt|reject> <decision>`, `doctrine outcome <application-id> <doctrine-id> <helped|harmed|inconclusive> <verifier-id> :: <evidence summary>`, `doctrine supersede <old-doctrine-id> <successor-doctrine-id> :: <reason>`, `doctrine retire <doctrine-id> <reason>`, or `doctrine contest <doctrine-id> <reason>`. JSON intake retains required projectDir and citations, this pane stamps pd-console provenance, and the daemon stamps the verified writer identity. These commands append receipts to the same ledger that CLI, SDK, and MCP use.".into(),
            tone: Tone::Resting,
        });
        blocks
    }

    fn refresh<'a>(
        &'a mut self,
        daemon: &'a DaemonClient,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            if let Err(error) = self.reload(daemon).await {
                self.last_error = Some(error.to_string());
            }
            Ok(())
        })
    }

    fn mutate<'a>(
        &'a mut self,
        daemon: &'a DaemonClient,
        action: SurfaceAction,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            match action {
                SurfaceAction::Doctrine { command } => self.mutate_command(daemon, command).await,
                _ => Err(anyhow!(
                    "DoctrinePane received an unsupported surface action"
                )),
            }
        })
    }
}

fn append_evidence_chain(blocks: &mut Vec<Block>, detail: &Value) {
    blocks.push(Block::Gap);
    blocks.push(Block::Header("Closed evidence loop".into()));
    let retrievals = array(detail, "retrievals");
    let applications = array(detail, "applications");
    let outcomes = array(detail, "outcomes");
    blocks.push(Block::KeyVal(
        "retrieval receipts".into(),
        retrievals.len().to_string(),
    ));
    blocks.push(Block::KeyVal(
        "agent responses".into(),
        applications.len().to_string(),
    ));
    blocks.push(Block::KeyVal(
        "verified outcomes".into(),
        outcomes.len().to_string(),
    ));
    for retrieval in retrievals {
        blocks.push(Block::Row(vec![
            "retrieved".into(),
            short(&text(retrieval, "id"), 28),
            short(&text(retrieval, "decisionClass"), 26),
            short(&text(retrieval, "decisionId"), 30),
        ]));
    }
    for application in applications {
        blocks.push(Block::Row(vec![
            "agent response".into(),
            short(&text(application, "id"), 28),
            text(application, "response"),
            short(&text(application, "decision"), 40),
        ]));
    }
    for outcome in outcomes {
        let verdict = text(outcome, "verdict");
        blocks.push(Block::Chip {
            label: format!(
                "verified {verdict}: {}",
                short(&text(outcome, "summary"), 88)
            ),
            tone: match verdict.as_str() {
                "helped" => Tone::Landed,
                "harmed" => Tone::Conflicted,
                _ => Tone::Gated,
            },
        });
    }
}

pub(crate) fn has_matched_factual_arms(experiment: &Value) -> bool {
    let runs = array(experiment, "runs");
    let mut controls = runs
        .iter()
        .filter(|run| text(run, "arm") == "control" && text(run, "fidelity") == "matched");
    let treatments: Vec<&Value> = runs
        .iter()
        .filter(|run| text(run, "arm") == "treatment" && text(run, "fidelity") == "matched")
        .collect();
    controls.any(|control| {
        treatments
            .iter()
            .any(|treatment| compatible_replay_contexts(control, treatment))
    })
}

/// The visual gate must not downgrade the daemon's factual gate into a green
/// string label. A compatible control/treatment pair shares the complete replay
/// setup and comes from two independently identified replicas. The daemon
/// repeats this check authoritatively before admitting a candidate.
fn compatible_replay_contexts(control: &Value, treatment: &Value) -> bool {
    let Some(control_context) = control.get("replayContext") else {
        return false;
    };
    let Some(treatment_context) = treatment.get("replayContext") else {
        return false;
    };
    for field in [
        "model",
        "modelVersion",
        "harness",
        "worktree",
        "environment",
        "checkpoint",
    ] {
        let control_value = text(control_context, field);
        if control_value.is_empty() || control_value != text(treatment_context, field) {
            return false;
        }
    }
    let control_replica = text(control_context, "replicaId");
    let treatment_replica = text(treatment_context, "replicaId");
    !control_replica.is_empty()
        && !treatment_replica.is_empty()
        && control_replica != treatment_replica
}

fn replay_context_summary(run: &Value) -> Option<String> {
    let context = run.get("replayContext")?;
    let model = text(context, "model");
    let version = text(context, "modelVersion");
    let harness = text(context, "harness");
    let checkpoint = text(context, "checkpoint");
    let replica = text(context, "replicaId");
    if [
        model.as_str(),
        version.as_str(),
        harness.as_str(),
        checkpoint.as_str(),
        replica.as_str(),
    ]
    .iter()
    .any(|field| field.is_empty())
    {
        return None;
    }
    Some(format!(
        "{model}@{version} · {harness} · {checkpoint} · replica {replica}"
    ))
}

fn array<'a>(value: &'a Value, key: &str) -> &'a [Value] {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

fn text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn optional_text(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

/// The projection returns related doctrine records rather than a mutable
/// pointer. Accept compact historical strings too, so the daemon remains the
/// authority while this pane stays legible across retained receipts.
fn doctrine_reference(value: &Value, key: &str) -> Option<String> {
    optional_text(value, key).or_else(|| {
        value
            .get(key)
            .and_then(Value::as_object)
            .and_then(|reference| {
                reference
                    .get("doctrineId")
                    .or_else(|| reference.get("id"))
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|id| !id.is_empty())
                    .map(str::to_string)
            })
    })
}

fn strings(value: &Value, key: &str) -> Vec<String> {
    array(value, key)
        .iter()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect()
}

fn count(value: &Value, key: &str) -> u64 {
    value.get(key).and_then(Value::as_u64).unwrap_or_default()
}

/// Encode one daemon route parameter without letting a doctrine, candidate,
/// retrieval, or application id change the route shape. IDs are evidence
/// supplied by a human/agent and often contain `:`, `/`, or `#`; only the
/// RFC3986 unreserved set may remain literal inside a path segment.
fn path_segment(value: &str) -> String {
    use std::fmt::Write;

    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            encoded.push(byte as char);
        } else {
            let _ = write!(encoded, "%{byte:02X}");
        }
    }
    encoded
}

fn short(value: &str, maximum: usize) -> String {
    let mut chars = value.chars();
    let head: String = chars.by_ref().take(maximum).collect();
    if chars.next().is_some() {
        format!("{head}…")
    } else {
        head
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_full_operator_grammar_without_implicit_verifier() {
        assert_eq!(
            DoctrineCommand::parse("outcome application-1 doctrine:candidate-1 helped reviewer-42 :: CI and production evidence agree"),
            Ok(DoctrineCommand::Outcome {
                application_id: "application-1".into(),
                doctrine_id: "doctrine:candidate-1".into(),
                verdict: "helped".into(),
                verified_by: "reviewer-42".into(),
                summary: "CI and production evidence agree".into(),
            }),
        );
        assert!(DoctrineCommand::parse("outcome application doctrine helped reviewer").is_err());
        assert!(DoctrineCommand::parse("apply retrieval doctrine invent decision").is_err());
        assert_eq!(
            DoctrineCommand::parse(
                "logbook :: {\"projectDir\":\"/repo\",\"citations\":[\"receipt:episode\"]}"
            ),
            Ok(DoctrineCommand::Record {
                record: DoctrineRecord::Episode,
                payload_json: "{\"projectDir\":\"/repo\",\"citations\":[\"receipt:episode\"]}"
                    .into(),
            }),
        );
        assert_eq!(
            DoctrineCommand::parse(
                "run experiment-13 :: {\"arm\":\"control\",\"fidelity\":\"matched\"}"
            ),
            Ok(DoctrineCommand::Record {
                record: DoctrineRecord::Run {
                    experiment_id: "experiment-13".into()
                },
                payload_json: "{\"arm\":\"control\",\"fidelity\":\"matched\"}".into(),
            }),
        );
        assert_eq!(
            DoctrineCommand::parse("admit candidate-13 experiment-13"),
            Ok(DoctrineCommand::Admit {
                candidate_id: "candidate-13".into(),
                experiment_id: "experiment-13".into(),
            }),
        );
        assert!(DoctrineCommand::parse("admit candidate-13").is_err());
        assert_eq!(
            DoctrineCommand::parse("supersede doctrine:old doctrine:new :: revised experiment separates the role effect"),
            Ok(DoctrineCommand::Supersede {
                doctrine_id: "doctrine:old".into(),
                successor_doctrine_id: "doctrine:new".into(),
                reason: "revised experiment separates the role effect".into(),
            }),
        );
        assert_eq!(
            DoctrineCommand::parse("retire doctrine:old contradicted by verified incident"),
            Ok(DoctrineCommand::Retire {
                doctrine_id: "doctrine:old".into(),
                reason: "contradicted by verified incident".into(),
            }),
        );
        assert!(DoctrineCommand::parse("induce not-json").is_err());
        assert!(DoctrineCommand::parse("show doctrine-1 extra").is_err());
    }

    #[test]
    fn console_intake_requires_provenance_and_removes_asserted_actor_identity() {
        let payload = DoctrinePane::console_evidence_payload(
            r#"{"projectDir":"/repo","actorId":"forged","citations":["receipt:one"],"provenance":{"model":"test"}}"#,
        )
        .expect("typed evidence envelope");
        assert_eq!(payload.pointer("/actorId").and_then(Value::as_str), None);
        assert_eq!(
            payload
                .pointer("/provenance/harness")
                .and_then(Value::as_str),
            Some("pd-console")
        );
        assert_eq!(
            payload.pointer("/provenance/model").and_then(Value::as_str),
            Some("test")
        );
        assert!(
            DoctrinePane::console_evidence_payload(r#"{"citations":["receipt:one"]}"#).is_err()
        );
        assert!(
            DoctrinePane::console_evidence_payload(r#"{"projectDir":"/repo","citations":[]}"#)
                .is_err()
        );
    }

    #[test]
    fn factual_gate_requires_matched_control_and_treatment() {
        let matched = json!({ "runs": [
            { "arm": "control", "fidelity": "matched", "replayContext": {
                "model": "model-a", "modelVersion": "1", "harness": "harness-a", "worktree": "/repo",
                "environment": "dev", "checkpoint": "checkpoint-13", "replicaId": "control-1"
            } },
            { "arm": "treatment", "fidelity": "matched", "replayContext": {
                "model": "model-a", "modelVersion": "1", "harness": "harness-a", "worktree": "/repo",
                "environment": "dev", "checkpoint": "checkpoint-13", "replicaId": "treatment-1"
            } },
        ] });
        let prompt_only = json!({ "runs": [
            { "arm": "control", "fidelity": "matched", "replayContext": {
                "model": "model-a", "modelVersion": "1", "harness": "harness-a", "worktree": "/repo",
                "environment": "dev", "checkpoint": "checkpoint-13", "replicaId": "control-1"
            } },
            { "arm": "treatment", "fidelity": "mismatched", "replayContext": {
                "model": "model-a", "modelVersion": "1", "harness": "harness-a", "worktree": "/repo",
                "environment": "dev", "checkpoint": "checkpoint-13", "replicaId": "treatment-1"
            } },
        ] });
        let same_replica = json!({ "runs": [
            { "arm": "control", "fidelity": "matched", "replayContext": {
                "model": "model-a", "modelVersion": "1", "harness": "harness-a", "worktree": "/repo",
                "environment": "dev", "checkpoint": "checkpoint-13", "replicaId": "same-run"
            } },
            { "arm": "treatment", "fidelity": "matched", "replayContext": {
                "model": "model-a", "modelVersion": "1", "harness": "harness-a", "worktree": "/repo",
                "environment": "dev", "checkpoint": "checkpoint-13", "replicaId": "same-run"
            } },
        ] });
        assert!(has_matched_factual_arms(&matched));
        assert!(!has_matched_factual_arms(&prompt_only));
        assert!(!has_matched_factual_arms(&same_replica));
    }

    #[test]
    fn renders_related_doctrine_records_without_collapsing_their_identity() {
        let relation = json!({ "successor": { "doctrineId": "doctrine:case13-revised" } });
        assert_eq!(
            doctrine_reference(&relation, "successor"),
            Some("doctrine:case13-revised".into())
        );
        assert_eq!(
            doctrine_reference(&json!({ "successor": "doctrine:historical" }), "successor"),
            Some("doctrine:historical".into())
        );
    }

    #[test]
    fn encodes_untrusted_daemon_path_segments() {
        assert_eq!(
            path_segment("doctrine:case/13?#"),
            "doctrine%3Acase%2F13%3F%23"
        );
        assert_eq!(path_segment("candidate-13._~"), "candidate-13._~");
    }

    #[test]
    fn view_keeps_advisory_boundary_and_closed_loop_visible() {
        let candidate = Candidate::from_value(&json!({
            "id": "candidate-1", "doctrineId": "doctrine:candidate-1", "projectDir": "/repo",
            "decisionClass": "integration.merge", "title": "Evidence over thread count",
            "when": "review evidence exists", "prefer": "inspect evidence", "over": "count threads",
            "because": "thread state is only a proxy", "status": "provisional", "citations": ["receipt://episode"],
            "admissionCitations": ["receipt://control"], "experimentId": "experiment-1"
        }));
        let pane = DoctrinePane {
            status: StatusSummary {
                candidates: 1,
                provisional: 1,
                ..StatusSummary::default()
            },
            candidates: vec![candidate],
            selected_doctrine_id: Some("doctrine:candidate-1".into()),
            detail: Some(json!({
                "experiment": { "runs": [
                    { "arm": "control", "fidelity": "matched", "action": "hold", "outcome": "recorded", "replayContext": {
                        "model": "model-a", "modelVersion": "1", "harness": "harness-a", "worktree": "/repo",
                        "environment": "dev", "checkpoint": "checkpoint-13", "replicaId": "control-1"
                    } },
                    { "arm": "treatment", "fidelity": "matched", "action": "merge", "outcome": "recorded", "replayContext": {
                        "model": "model-a", "modelVersion": "1", "harness": "harness-a", "worktree": "/repo",
                        "environment": "dev", "checkpoint": "checkpoint-13", "replicaId": "treatment-1"
                    } }
                ] },
                "retrievals": [{ "id": "retrieval-1", "decisionClass": "integration.merge", "decisionId": "PR-13" }],
                "applications": [{ "id": "application-1", "response": "adapt", "decision": "inspect facts" }],
                "outcomes": [{ "verdict": "inconclusive", "summary": "awaiting incident correlation" }]
            })),
            last_error: None,
            last_notice: None,
            writer_identity: Some("actor-13".into()),
        };
        let rendered = format!("{:?}", pane.view());
        assert!(rendered.contains("ADVISORY"));
        assert!(rendered.contains("Closed evidence loop"));
        assert!(rendered.contains("matched factual control + treatment"));
        assert!(rendered.contains("doctrine harvest"));
        assert!(rendered.contains("doctrine supersede"));
        assert!(!rendered.contains("authorize merge"));
    }
}
