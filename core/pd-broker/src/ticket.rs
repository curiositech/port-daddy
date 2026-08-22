//! The scoped capability ticket — what the broker returns on an authorized
//! verdict *instead of* the raw secret.
//!
//! A `CapabilityTicket` names a capability (`op`, `repo`, `branch`, `session`),
//! a hard expiry, and a single-use nonce, and carries an HMAC-SHA256 tag over
//! exactly those fields keyed by an internal `ticket-signing key` that never
//! leaves the broker. It is the broker's analogue of an OAuth bearer handle:
//! presentable and verifiable, but it is *not* the credential. A future
//! redemption layer (ADR-0053 phases 5–6) swaps a valid, unexpired ticket for
//! the live credential at the egress boundary — that swap is out of scope here.
//!
//! Crucially, the ticket is derived from the *request scope and the signing
//! key*, never from the protected secret, so a leaked ticket reveals nothing
//! about the secret, and an attacker cannot mint a ticket without the signing
//! key (which is also never on the wire).

use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// The scope a ticket grants. These are the *facts the broker authorized*, not
/// the secret. Mirrors the macaroon `RequestContext` fields the gate checked.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TicketScope {
    /// The operation the ticket authorizes (e.g. `push`).
    pub op: String,
    /// The repository the ticket is scoped to.
    pub repo: String,
    /// The branch (glob already resolved to the concrete branch of the request).
    pub branch: String,
    /// The coordinating session that earned the ticket.
    pub session: String,
}

/// A signed, short-lived capability handle. Returned to the agent on an
/// authorized verdict. Contains NO secret material.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CapabilityTicket {
    /// What the ticket authorizes.
    pub scope: TicketScope,
    /// Unix ms after which the ticket is dead.
    pub expires_at_ms: i64,
    /// Per-ticket nonce — makes each issued ticket unique and supports
    /// single-use redemption in a later phase.
    pub nonce: String,
    /// HMAC-SHA256 tag (hex) over the scope, expiry, and nonce, keyed by the
    /// broker's internal ticket-signing key. The key is NOT carried here.
    pub tag_hex: String,
}

impl CapabilityTicket {
    /// True iff the ticket has not yet expired at `now_ms`.
    pub fn is_live(&self, now_ms: i64) -> bool {
        now_ms < self.expires_at_ms
    }
}

/// Holds the internal ticket-signing key and mints/verifies tickets. The key
/// never crosses the socket; only the broker process holds it.
pub struct TicketSigner {
    signing_key: Vec<u8>,
}

impl TicketSigner {
    /// `signing_key` is high-entropy material distinct from the protected
    /// credential and from any macaroon root key.
    pub fn new(signing_key: impl Into<Vec<u8>>) -> Self {
        Self {
            signing_key: signing_key.into(),
        }
    }

    /// Canonical bytes the tag is computed over. A fixed, length-prefixed
    /// encoding so two different scopes can never collide into the same preimage
    /// (e.g. repo "a" + branch "bc" vs repo "ab" + branch "c").
    fn preimage(scope: &TicketScope, expires_at_ms: i64, nonce: &str) -> Vec<u8> {
        let mut buf = Vec::new();
        for field in [
            scope.op.as_str(),
            scope.repo.as_str(),
            scope.branch.as_str(),
            scope.session.as_str(),
            nonce,
        ] {
            buf.extend_from_slice(&(field.len() as u64).to_le_bytes());
            buf.extend_from_slice(field.as_bytes());
        }
        buf.extend_from_slice(&expires_at_ms.to_le_bytes());
        buf
    }

    fn tag(&self, scope: &TicketScope, expires_at_ms: i64, nonce: &str) -> [u8; 32] {
        let mut mac =
            HmacSha256::new_from_slice(&self.signing_key).expect("HMAC accepts any key length");
        mac.update(&Self::preimage(scope, expires_at_ms, nonce));
        mac.finalize().into_bytes().into()
    }

    /// Mint a scoped ticket valid until `expires_at_ms`.
    pub fn mint(
        &self,
        scope: TicketScope,
        expires_at_ms: i64,
        nonce: impl Into<String>,
    ) -> CapabilityTicket {
        let nonce = nonce.into();
        let tag = self.tag(&scope, expires_at_ms, &nonce);
        CapabilityTicket {
            scope,
            expires_at_ms,
            nonce,
            tag_hex: hex::encode(tag),
        }
    }

    /// Constant-time verification that a ticket was minted by this signer and
    /// is still live. Used by the (future) redemption layer.
    pub fn verify(&self, ticket: &CapabilityTicket, now_ms: i64) -> bool {
        if !ticket.is_live(now_ms) {
            return false;
        }
        let expected = self.tag(&ticket.scope, ticket.expires_at_ms, &ticket.nonce);
        let presented = match hex::decode(&ticket.tag_hex) {
            Ok(b) if b.len() == 32 => b,
            _ => return false,
        };
        let mut diff = 0u8;
        for i in 0..32 {
            diff |= expected[i] ^ presented[i];
        }
        diff == 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn signer() -> TicketSigner {
        TicketSigner::new(b"ticket-signing-key-32-bytes-pad!".to_vec())
    }

    fn scope() -> TicketScope {
        TicketScope {
            op: "push".into(),
            repo: "curiositech/port-daddy".into(),
            branch: "feat/x".into(),
            session: "session-abc".into(),
        }
    }

    #[test]
    fn minted_ticket_verifies() {
        let s = signer();
        let t = s.mint(scope(), 2_000_000, "n1");
        assert!(s.verify(&t, 1_000_000));
    }

    #[test]
    fn expired_ticket_does_not_verify() {
        let s = signer();
        let t = s.mint(scope(), 2_000_000, "n1");
        assert!(!s.verify(&t, 2_000_001));
    }

    #[test]
    fn tampered_scope_breaks_tag() {
        let s = signer();
        let mut t = s.mint(scope(), 2_000_000, "n1");
        t.scope.branch = "main".into(); // privilege escalation attempt
        assert!(!s.verify(&t, 1_000_000));
    }

    #[test]
    fn wrong_signer_key_rejected() {
        let s = signer();
        let t = s.mint(scope(), 2_000_000, "n1");
        let other = TicketSigner::new(b"different-signing-key-32bytes-pd".to_vec());
        assert!(!other.verify(&t, 1_000_000));
    }

    #[test]
    fn length_prefix_prevents_field_boundary_collision() {
        let s = signer();
        let a = TicketScope {
            op: "push".into(),
            repo: "a".into(),
            branch: "bc".into(),
            session: "s".into(),
        };
        let b = TicketScope {
            op: "push".into(),
            repo: "ab".into(),
            branch: "c".into(),
            session: "s".into(),
        };
        assert_ne!(
            s.mint(a, 1, "n").tag_hex,
            s.mint(b, 1, "n").tag_hex,
            "field-boundary shift must change the tag"
        );
    }
}
