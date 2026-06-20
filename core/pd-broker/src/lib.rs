//! pd-broker — the credential-broker library (ADR-0087 Phase 4, the TCB slice).
//!
//! The single load-bearing invariant of this crate: **the agent never holds the
//! raw credential.** The broker process holds one secret internally (loaded from
//! an env var or a `0600` file at startup) and an internal ticket-signing key.
//! When an agent presents a macaroon grant plus its discharge over the socket,
//! the broker calls the kernel macaroon verifier (`pd_anchor::macaroon::verify`)
//! to render an authorize verdict. **Only** on an authorized verdict does it
//! return a *scoped, short-lived capability ticket* — a signed handle naming the
//! capability, scope, and a hard expiry — and **never** the raw secret string.
//!
//! Trust model (ADR-0053 / ADR-0087): the broker is a separate process whose job
//! is to be the *only* holder of the secret. The macaroon gate (ADR-0054, the
//! Rust verifier in `pd-anchor`) decides *whether* a request is authorized; the
//! broker decides *what crosses the wire* — a ticket, never the secret. The
//! ticket is the foundation that makes the discharge gate actually bite: an agent
//! that cannot present a paid-rent discharge gets no ticket, and a ticket alone
//! is not the credential.
//!
//! Honest scope (what this crate does NOT do, deferred to ADR-0050 phase 0a and
//! ADR-0053 phases 5–6):
//!   * It does not mint a *real* ephemeral GitHub token — that needs the GitHub
//!     App, which is not built. The ticket here is a signed scope handle.
//!   * It does not bind the ticket to actual git egress — that needs the
//!     operator-owned `pf` forced-egress layer (phases 5–6). A redemption layer
//!     that swaps a ticket for the live credential at the egress boundary is the
//!     remaining work; this crate stops at issuing the scoped ticket and proving
//!     the secret never leaks.
//!
//! Everything here is deterministic and clock-injected so the protocol is unit
//! testable without sockets; `main.rs` wires it to a Unix domain socket.

pub mod broker;
pub mod protocol;
pub mod ticket;
pub mod transport;

pub use broker::{Broker, BrokerConfig, BrokerError};
pub use protocol::{Request, Response};
pub use ticket::{CapabilityTicket, TicketSigner};
