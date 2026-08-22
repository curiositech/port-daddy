//! The broker core: secret custody + macaroon-gated, scoped-ticket issuance.
//!
//! `Broker::handle` is the pure, deterministic heart of the process. It takes a
//! parsed `Request` and a clock, renders an authorize verdict by calling the
//! kernel macaroon verifier, and returns a `Response`. It is the ONLY place a
//! ticket is minted, and it is structurally incapable of returning the secret:
//! the secret is held in `SecretVault` whose bytes are never serialized.

use std::collections::HashMap;

use pd_anchor::macaroon::{check_caveat, verify, Macaroon, RequestContext};

use crate::protocol::{Request, RequestCtx, Response};
use crate::ticket::{CapabilityTicket, TicketScope, TicketSigner};

/// Holds the protected credential. Deliberately NOT `Serialize`/`Debug`-leaking:
/// the bytes are exposed only through `redeem` (a future egress-side call) and
/// are never reachable from any code path that builds a `Response`.
pub struct SecretVault {
    secret: Vec<u8>,
}

impl SecretVault {
    pub fn new(secret: impl Into<Vec<u8>>) -> Self {
        Self {
            secret: secret.into(),
        }
    }

    /// Redact in any debug context. There is intentionally no getter that a
    /// response-building path can reach.
    pub(crate) fn len(&self) -> usize {
        self.secret.len()
    }
}

impl std::fmt::Debug for SecretVault {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "SecretVault(<{} bytes redacted>)", self.secret.len())
    }
}

/// Configuration for a broker instance.
pub struct BrokerConfig {
    /// The protected credential the agent must never see.
    pub secret: Vec<u8>,
    /// The macaroon root key for the grants this broker authorizes (held only
    /// by the minter+verifier; the agent cannot re-sign).
    pub macaroon_root_key: Vec<u8>,
    /// The internal ticket-signing key (distinct from secret and root key).
    pub ticket_signing_key: Vec<u8>,
    /// Discharge-key store: rent caveat id -> discharge root key. The broker
    /// resolves these when verifying third-party caveats.
    pub caveat_keys: HashMap<String, Vec<u8>>,
    /// How long an issued ticket lives, in ms.
    pub ticket_ttl_ms: i64,
}

/// The credential broker.
pub struct Broker {
    vault: SecretVault,
    macaroon_root_key: Vec<u8>,
    ticket_signer: TicketSigner,
    caveat_keys: HashMap<String, Vec<u8>>,
    ticket_ttl_ms: i64,
    /// Monotonic counter folded into ticket nonces so two tickets issued in the
    /// same millisecond are still distinct.
    ticket_seq: u64,
}

#[derive(Debug, thiserror::Error)]
pub enum BrokerError {
    #[error("secret is empty")]
    EmptySecret,
    #[error("macaroon root key is empty")]
    EmptyRootKey,
    #[error("ticket signing key is empty")]
    EmptyTicketKey,
}

impl Broker {
    pub fn new(config: BrokerConfig) -> Result<Self, BrokerError> {
        if config.secret.is_empty() {
            return Err(BrokerError::EmptySecret);
        }
        if config.macaroon_root_key.is_empty() {
            return Err(BrokerError::EmptyRootKey);
        }
        if config.ticket_signing_key.is_empty() {
            return Err(BrokerError::EmptyTicketKey);
        }
        Ok(Self {
            vault: SecretVault::new(config.secret),
            macaroon_root_key: config.macaroon_root_key,
            ticket_signer: TicketSigner::new(config.ticket_signing_key),
            caveat_keys: config.caveat_keys,
            ticket_ttl_ms: config.ticket_ttl_ms,
            ticket_seq: 0,
        })
    }

    /// The number of bytes held in the vault — for startup logging only, never
    /// the bytes themselves.
    pub fn secret_len(&self) -> usize {
        self.vault.len()
    }

    /// Handle one parsed request at clock `now_ms`. Pure and deterministic given
    /// the request, the clock, and the internal nonce counter. The ONLY success
    /// path returns a scoped ticket; the secret is never read here.
    pub fn handle(&mut self, req: Request, now_ms: i64) -> Response {
        match req {
            Request::Ping => Response::Pong,
            Request::BrokerCredential {
                grant,
                discharges,
                ctx,
            } => self.broker_credential(&grant, &discharges, &ctx, now_ms),
        }
    }

    fn broker_credential(
        &mut self,
        grant: &Macaroon,
        discharges: &[Macaroon],
        ctx: &RequestCtx,
        now_ms: i64,
    ) -> Response {
        // Build the macaroon RequestContext from the wire ctx, injecting OUR
        // clock — a client cannot supply its own `now_ms` to revive an expired
        // grant.
        let rc = RequestContext {
            op: ctx.op.clone(),
            repo: ctx.repo.clone(),
            branch: ctx.branch.clone(),
            host: ctx.host.clone(),
            spend_usd: ctx.spend_usd,
            session: ctx.session.clone(),
            now_ms,
        };

        // The first-party caveat checker (op/repo/branch/expiry/session) and the
        // discharge-key resolver are supplied to the kernel verifier. The broker
        // owns both — the caveat grammar and the discharge-key store.
        let check = |predicate: &str| check_caveat(predicate, &rc);
        let resolve = |caveat_id: &str| self.caveat_keys.get(caveat_id).cloned();

        let outcome = verify(grant, &self.macaroon_root_key, discharges, &check, &resolve);

        if !outcome.ok {
            // Refusal: point only at the verdict reason. No bypass, no secret.
            return Response::Refused {
                reason: outcome.reason,
            };
        }

        // Authorized. Mint a scoped ticket — NOT the secret. The scope is the
        // concrete request facts the gate just authorized; missing facts fail
        // closed (an authorized push always carries op/repo/branch/session).
        let scope = match Self::scope_from_ctx(ctx) {
            Some(s) => s,
            None => {
                return Response::Refused {
                    reason:
                        "authorized grant lacked required scope fields (op/repo/branch/session)"
                            .into(),
                }
            }
        };

        self.ticket_seq = self.ticket_seq.wrapping_add(1);
        let nonce = format!("tk-{now_ms}-{}", self.ticket_seq);
        let expires_at_ms = now_ms + self.ticket_ttl_ms;
        let ticket: CapabilityTicket = self.ticket_signer.mint(scope, expires_at_ms, nonce);

        Response::Ticket { ticket }
    }

    fn scope_from_ctx(ctx: &RequestCtx) -> Option<TicketScope> {
        Some(TicketScope {
            op: ctx.op.clone()?,
            repo: ctx.repo.clone()?,
            branch: ctx.branch.clone()?,
            session: ctx.session.clone()?,
        })
    }
}
