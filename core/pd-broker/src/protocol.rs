//! The broker wire protocol — newline-delimited JSON (NDJSON).
//!
//! Each request is one JSON object terminated by `\n`. Each response is one
//! JSON object terminated by `\n`. The transport (`main.rs`) buffers partial
//! reads until it sees a newline, so a message split across multiple `read()`
//! calls is reassembled before parsing (the `ipc-communication-patterns`
//! framing idiom for stream sockets).
//!
//! The protocol carries the macaroon grant, its discharges, and the request
//! context. It NEVER carries the raw secret in either direction. The only
//! success payload is a scoped `CapabilityTicket`.

use pd_anchor::macaroon::Macaroon;
use serde::{Deserialize, Serialize};

use crate::ticket::CapabilityTicket;

/// The concrete facts of the request being authorized — the wire form of the
/// macaroon `RequestContext`. The broker injects its own clock; a client-
/// supplied clock is ignored, so a client cannot rewind time to revive an
/// expired grant.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct RequestCtx {
    pub op: Option<String>,
    pub repo: Option<String>,
    pub branch: Option<String>,
    pub host: Option<String>,
    pub spend_usd: Option<f64>,
    pub session: Option<String>,
}

/// A request from an agent. Tagged on `type` for forward-compatibility.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Request {
    /// Ask the broker to authorize a grant and, if authorized, issue a scoped
    /// ticket. The agent presents the macaroon grant, the discharges it holds
    /// (already `prepare_for_request`-bound), and the request context.
    ///
    /// The macaroon-carrying fields are boxed so the `Ping` variant does not pay
    /// for the (much larger) credential variant's size — `Box` keeps the enum
    /// small and serializes transparently.
    BrokerCredential {
        grant: Box<Macaroon>,
        #[serde(default)]
        discharges: Vec<Macaroon>,
        ctx: Box<RequestCtx>,
    },
    /// Liveness probe. Returns `Pong`. Carries no authority.
    Ping,
}

/// A response from the broker. NEVER contains the raw secret.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Response {
    /// Authorized: a scoped, short-lived capability ticket. NOT the secret.
    Ticket { ticket: CapabilityTicket },
    /// Refused: the macaroon+discharge did not authorize the request. `reason`
    /// is the verifier's diagnostic; it points only at the correct action
    /// (coordinate / pay rent), never at a bypass.
    Refused { reason: String },
    /// The request was malformed (bad JSON, unknown field). No authority leaked.
    BadRequest { reason: String },
    /// Liveness reply.
    Pong,
}

impl Response {
    /// Serialize as a single NDJSON line (with trailing newline).
    pub fn to_ndjson_line(&self) -> String {
        // Response is a closed enum of serializable types; serialization cannot
        // fail. If it somehow did, emit a refusal rather than panicking.
        match serde_json::to_string(self) {
            Ok(mut s) => {
                s.push('\n');
                s
            }
            Err(_) => "{\"type\":\"bad-request\",\"reason\":\"serialize failed\"}\n".to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ping_pong_roundtrip() {
        let req = Request::Ping;
        let line = serde_json::to_string(&req).unwrap();
        let back: Request = serde_json::from_str(&line).unwrap();
        assert_eq!(req, back);
        assert_eq!(Response::Pong.to_ndjson_line(), "{\"type\":\"pong\"}\n");
    }

    #[test]
    fn broker_credential_request_parses() {
        // A minimal grant macaroon (no caveats) just to exercise the envelope.
        let json = r#"{"type":"broker-credential","grant":{"location":"loc","identifier":"g","caveats":[],"signature_hex":"00"},"ctx":{"op":"push"}}"#;
        let req: Request = serde_json::from_str(json).unwrap();
        match req {
            Request::BrokerCredential {
                ctx, discharges, ..
            } => {
                assert_eq!(ctx.op.as_deref(), Some("push"));
                assert!(discharges.is_empty());
            }
            _ => panic!("expected broker-credential"),
        }
    }

    #[test]
    fn response_lines_end_in_newline() {
        let r = Response::Refused {
            reason: "nope".into(),
        };
        let line = r.to_ndjson_line();
        assert!(line.ends_with('\n'));
        assert!(!line[..line.len() - 1].contains('\n'));
    }
}
