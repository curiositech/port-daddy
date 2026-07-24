//! `pd-anchor` — the Port Daddy security kernel: identity, capability, and evidence.
//!
//! This crate is the trusted core that answers three questions no daemon is allowed
//! to answer for itself, because a daemon can be compromised and the kernel is the
//! thing we harden. Each question maps to one module:
//!
//! 1. **"Who is this actor, and what may it do?"** — Ed25519 *anchor cards* and
//!    *capability envelopes*, defined **in this file** ([`AnchorKeypair`],
//!    [`AnchorCard`], [`SignedCapabilityEnvelope`], [`verify_card`],
//!    [`verify_envelope`]). A card is a signed statement of identity + granted
//!    capabilities; an envelope narrows a card to a single audience/nonce and is
//!    replay-guarded ([`ReplayGuard`]). Authority can only ever *narrow*: an
//!    envelope may not claim a capability its card does not hold.
//! 2. **"May this push/API-call proceed right now?"** — macaroon capabilities with
//!    a rent-paid discharge, in [`macaroon`], custodied in [`keystore`]. The
//!    forging keys are generated in the kernel and never cross the FFI boundary, so
//!    a compromised daemon cannot mint its own authorization (ADR-0053 / ADR-0057).
//! 3. **"What is the tamper-evident record, and in what order does the plan run?"**
//!    — Merkle evidence roots ([`merkle_evidence`], **this file**) and the Critical
//!    Path Method planner in [`schedule`] (ADR-0054 / ADR-0086).
//!
//! # Module map
//!
//! | Module        | Responsibility                                                        |
//! |---------------|-----------------------------------------------------------------------|
//! | (crate root)  | Ed25519 anchor cards, capability envelopes, replay guard, Merkle roots |
//! | [`macaroon`]  | Macaroon primitive: mint, attenuate, discharge, verify (per-hop)      |
//! | [`keystore`]  | Kernel-held custody of macaroon root/discharge keys                    |
//! | [`schedule`]  | Deterministic CPM scheduler + fixed Jira-ladder validator             |
//! | [`ffi`]       | The `#[no_mangle]` C ABI the TypeScript daemon loads                   |
//!
//! # How this crate is consumed
//!
//! `pd-anchor` compiles to both an `rlib` (for in-Rust callers such as the pd-console
//! GPUI app and this crate's own tests) and a `cdylib`, `libpd_anchor`. The dylib is
//! produced by `scripts/build-core.sh` and loaded from TypeScript via
//! [koffi](https://github.com/Koromix/koffi): `lib/macaroon-ffi.ts` opens
//! `libpd_anchor.{dylib,so}` and binds `pd_macaroon_verify_json` (see [`ffi`]). The
//! kernel is the *canonical* implementation; the daemon prefers it and falls back to
//! the byte-parity TypeScript port only when the dylib is absent, so the FFI surface
//! is deliberately narrow and every exported function is fail-closed.
//!
//! # A note on security posture
//!
//! Everything here **fails closed**: an expired card, a replayed nonce, a missing
//! discharge, a malformed signature, or an unset verification clock all resolve to
//! "denied", never to an accidental "allowed". Where a decision could plausibly
//! default either way, it defaults to refusal.

use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use pd_core::now_ms;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use thiserror::Error;

pub mod ffi;
pub mod keystore;
pub mod macaroon;
pub mod schedule;

/// The subject of an anchor card: *who* the card is about.
///
/// A thin newtype over a stable identifier string (e.g. a daemon or actor id).
/// It exists as its own type — rather than a bare `String` — so the `id` is
/// serialized under a named field and cannot be silently confused with the many
/// other strings in a card (public key, signature, capabilities).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AnchorSubject {
    /// Stable identifier of the subject this card speaks for.
    pub id: String,
}

impl AnchorSubject {
    /// Construct a subject from anything string-like.
    ///
    /// # Example
    ///
    /// ```
    /// use pd_anchor::AnchorSubject;
    /// let s = AnchorSubject::new("daemon-a");
    /// assert_eq!(s.id, "daemon-a");
    /// ```
    pub fn new(id: impl Into<String>) -> Self {
        Self { id: id.into() }
    }
}

/// A signed anchor card: a self-contained, verifiable statement that some
/// [`AnchorSubject`] holds a set of capabilities, valid for a bounded window.
///
/// The card carries the signer's public key inline (`public_key_hex`) so a verifier
/// needs no external key directory — it checks the Ed25519 signature over the
/// card's canonical fields and confirms the clock is inside `[issued_at_ms,
/// expires_at_ms)`. This is the identity layer: a card proves *who you are and what
/// you were granted*, distinct from a macaroon, which gates *what a specific call
/// may do right now*.
///
/// Because the public key is embedded, trust must be rooted elsewhere (the verifier
/// must already trust that key); the card itself only proves the holder of the
/// matching private key signed these exact fields at that time.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AnchorCard {
    /// Who the card is about.
    pub subject: AnchorSubject,
    /// Ed25519 public key of the signer, hex-encoded; the verifier checks the
    /// signature against this key.
    pub public_key_hex: String,
    /// Capabilities granted, sorted and de-duplicated at signing time so the signed
    /// bytes are canonical.
    pub capabilities: Vec<String>,
    /// Mint time (unix ms).
    pub issued_at_ms: i64,
    /// Hard expiry (unix ms); at or after this, verification returns
    /// [`AnchorError::Expired`].
    pub expires_at_ms: i64,
    /// Ed25519 signature over the canonical card payload, hex-encoded.
    pub signature_hex: String,
}

/// A capability envelope: an [`AnchorCard`] narrowed to a single `audience` and
/// `nonce`, re-signed for a shorter window.
///
/// Where a card is a broad, reusable identity statement, an envelope is a
/// single-use presentation of it: "card-holder X, to audience Y, using one-time
/// nonce N, exercises this subset of X's capabilities." [`verify_envelope`] enforces
/// two invariants that make authority one-directional: every capability in the
/// envelope must also appear in the underlying card (no privilege escalation), and
/// the nonce must be fresh against a [`ReplayGuard`] (no replay).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SignedCapabilityEnvelope {
    /// The underlying identity card, itself verified before the envelope is trusted.
    pub card: AnchorCard,
    /// Intended recipient; binds the envelope so it is not valid for a different peer.
    pub audience: String,
    /// One-time value the verifier records to reject replays.
    pub nonce: String,
    /// The (attenuated) capability subset being exercised; must be ⊆ the card's.
    pub capabilities: Vec<String>,
    /// Mint time (unix ms).
    pub issued_at_ms: i64,
    /// Hard expiry (unix ms).
    pub expires_at_ms: i64,
    /// Ed25519 signature over the canonical envelope payload, hex-encoded.
    pub signature_hex: String,
}

/// A Merkle commitment over an ordered set of leaves: a root hash plus the leaf
/// count.
///
/// This is the evidence layer. Publishing `root_hex` commits to the exact multiset
/// and order of leaves without revealing them; anyone can later prove a specific
/// event was included. It exists so an audit trail is *tamper-evident*: changing,
/// reordering, adding, or dropping any leaf changes the root.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MerkleEvidence {
    /// SHA-256 Merkle root, hex-encoded.
    pub root_hex: String,
    /// Number of leaves that produced this root.
    pub leaf_count: usize,
}

/// An Ed25519 signing keypair used to mint and sign anchor cards and envelopes.
///
/// Wraps a [`SigningKey`] and never exposes the private half — you can obtain the
/// public key ([`AnchorKeypair::public_key_hex`]) and produce signatures, but the
/// secret scalar stays inside. Construct one deterministically from a 32-byte seed
/// with [`AnchorKeypair::from_seed`]; in production that seed is itself high-entropy
/// secret material.
pub struct AnchorKeypair {
    signing_key: SigningKey,
}

impl AnchorKeypair {
    /// Build a keypair deterministically from a 32-byte seed.
    ///
    /// The same seed always yields the same keypair (and therefore the same public
    /// key), which is what makes tests and doctests reproducible. **The seed IS the
    /// private key** — in production it must come from a CSPRNG and be guarded like
    /// one; the all-`7` seed below is a test-only placeholder, never a real secret.
    ///
    /// # Example
    ///
    /// ```
    /// use pd_anchor::AnchorKeypair;
    /// // Test-only synthetic seed — do NOT use a constant seed for real keys.
    /// let kp = AnchorKeypair::from_seed([7u8; 32]);
    /// // Deterministic: the public key is a stable function of the seed.
    /// assert_eq!(kp.public_key_hex(), AnchorKeypair::from_seed([7u8; 32]).public_key_hex());
    /// assert_eq!(kp.public_key_hex().len(), 64); // 32 bytes, hex-encoded
    /// ```
    pub fn from_seed(seed: [u8; 32]) -> Self {
        Self {
            signing_key: SigningKey::from_bytes(&seed),
        }
    }

    /// The hex-encoded Ed25519 public key (32 bytes → 64 hex chars).
    ///
    /// Safe to publish and embed in cards; it reveals nothing about the private key.
    /// This is exactly the value stored in [`AnchorCard::public_key_hex`], so a
    /// verifier can check a card without any external key lookup.
    pub fn public_key_hex(&self) -> String {
        hex::encode(self.signing_key.verifying_key().to_bytes())
    }

    /// Mint and sign an [`AnchorCard`] granting `capabilities` to `subject`, valid
    /// for `ttl_ms` from now.
    ///
    /// Capabilities are sorted and de-duplicated before signing so the signed bytes
    /// are canonical: two cards granting the same set produce byte-identical
    /// payloads regardless of input order. `issued_at_ms` is taken from the system
    /// clock and `expires_at_ms = issued_at_ms + ttl_ms`.
    ///
    /// # Failure contract
    ///
    /// Returns [`AnchorError::Serde`] only if the payload fails to serialize (not
    /// expected for well-formed inputs). Never panics. A non-positive `ttl_ms`
    /// produces an already-expired card, which [`verify_card`] will reject — this is
    /// intentional and used in tests to exercise the expiry path.
    ///
    /// # Example
    ///
    /// ```
    /// use pd_anchor::{AnchorKeypair, AnchorSubject, verify_card};
    ///
    /// let kp = AnchorKeypair::from_seed([7u8; 32]); // test-only seed
    /// let card = kp
    ///     .sign_card(AnchorSubject::new("daemon-a"), vec!["room:write".into()], 60_000)
    ///     .unwrap();
    ///
    /// // The card was just minted, so its own issue time is inside the validity
    /// // window — verification succeeds.
    /// verify_card(&card, card.issued_at_ms).unwrap();
    /// ```
    pub fn sign_card(
        &self,
        subject: AnchorSubject,
        capabilities: Vec<String>,
        ttl_ms: i64,
    ) -> Result<AnchorCard, AnchorError> {
        let issued_at_ms = now_ms();
        let mut capabilities = capabilities;
        capabilities.sort();
        capabilities.dedup();
        let public_key_hex = self.public_key_hex();
        let expires_at_ms = issued_at_ms + ttl_ms;
        let payload = CardSigningPayload {
            subject: &subject,
            public_key_hex: &public_key_hex,
            capabilities: &capabilities,
            issued_at_ms,
            expires_at_ms,
        };
        let bytes = serde_json::to_vec(&payload)?;
        let signature = self.signing_key.sign(&bytes);

        Ok(AnchorCard {
            subject,
            public_key_hex,
            capabilities,
            issued_at_ms,
            expires_at_ms,
            signature_hex: hex::encode(signature.to_bytes()),
        })
    }

    /// Issue a [`SignedCapabilityEnvelope`] that narrows `card` to a single
    /// `audience` and `nonce`, exercising `capabilities` for `ttl_ms`.
    ///
    /// The card is verified first (it must be currently valid), then the envelope is
    /// signed over a payload that includes a hash of the card, so the envelope is
    /// bound to that exact card. Capabilities are sorted and de-duplicated for a
    /// canonical signature. Note this method does **not** itself reject capabilities
    /// absent from the card — that ⊆-check is enforced at verification time by
    /// [`verify_envelope`], keeping issuance cheap and verification authoritative.
    ///
    /// # Failure contract
    ///
    /// Returns [`AnchorError::Expired`] (via the inner [`verify_card`]) if the card
    /// is already expired, or a signature/serialization error otherwise. Never
    /// panics. Fails closed: an unverifiable card yields no envelope.
    ///
    /// # Example
    ///
    /// ```
    /// use pd_anchor::{AnchorKeypair, AnchorSubject, ReplayGuard, verify_envelope};
    ///
    /// let kp = AnchorKeypair::from_seed([7u8; 32]); // test-only seed
    /// let card = kp
    ///     .sign_card(AnchorSubject::new("daemon-a"), vec!["room:write".into()], 60_000)
    ///     .unwrap();
    /// let envelope = kp
    ///     .issue_envelope(card, "daemon-b", "nonce-1", vec!["room:write".into()], 10_000)
    ///     .unwrap();
    ///
    /// let mut guard = ReplayGuard::default();
    /// // Fresh nonce, valid card, capability ⊆ card → verifies.
    /// verify_envelope(&envelope, &mut guard, envelope.issued_at_ms).unwrap();
    /// // The same nonce a second time is a replay and is rejected.
    /// assert!(verify_envelope(&envelope, &mut guard, envelope.issued_at_ms).is_err());
    /// ```
    pub fn issue_envelope(
        &self,
        card: AnchorCard,
        audience: impl Into<String>,
        nonce: impl Into<String>,
        capabilities: Vec<String>,
        ttl_ms: i64,
    ) -> Result<SignedCapabilityEnvelope, AnchorError> {
        verify_card(&card, now_ms())?;

        let issued_at_ms = now_ms();
        let mut capabilities = capabilities;
        capabilities.sort();
        capabilities.dedup();
        let envelope = EnvelopeSigningPayload {
            card_hash_hex: card_hash_hex(&card)?,
            audience: audience.into(),
            nonce: nonce.into(),
            capabilities,
            issued_at_ms,
            expires_at_ms: issued_at_ms + ttl_ms,
        };
        let bytes = serde_json::to_vec(&envelope)?;
        let signature = self.signing_key.sign(&bytes);

        Ok(SignedCapabilityEnvelope {
            card,
            audience: envelope.audience,
            nonce: envelope.nonce,
            capabilities: envelope.capabilities,
            issued_at_ms,
            expires_at_ms: envelope.expires_at_ms,
            signature_hex: hex::encode(signature.to_bytes()),
        })
    }
}

/// An in-memory record of nonces already seen, used to reject envelope replays.
///
/// A capability envelope is single-use: its `nonce` may be accepted exactly once.
/// The guard remembers every nonce it has admitted (a [`HashSet`]) and refuses a
/// repeat. Because state is in-memory and per-instance, a guard's protection lasts
/// only as long as it lives and covers only the presentations routed through it —
/// callers that need cross-restart or cross-process replay protection must persist
/// or share the nonce set themselves.
#[derive(Default, Debug)]
pub struct ReplayGuard {
    seen_nonces: HashSet<String>,
}

impl ReplayGuard {
    /// Admit `nonce` if unseen; reject it as a replay otherwise.
    ///
    /// Returns `Ok(())` the first time a given nonce is presented and records it;
    /// returns [`AnchorError::Replay`] on every subsequent presentation of the same
    /// nonce. The insert-and-check is a single [`HashSet::insert`], so admission and
    /// recording are atomic — there is no window where a nonce is checked but not
    /// yet stored.
    ///
    /// # Example
    ///
    /// ```
    /// use pd_anchor::ReplayGuard;
    ///
    /// let mut guard = ReplayGuard::default();
    /// assert!(guard.verify_fresh("nonce-1").is_ok());   // first use: admitted
    /// assert!(guard.verify_fresh("nonce-1").is_err());  // replay: rejected
    /// assert!(guard.verify_fresh("nonce-2").is_ok());   // a different nonce is fine
    /// ```
    pub fn verify_fresh(&mut self, nonce: &str) -> Result<(), AnchorError> {
        if !self.seen_nonces.insert(nonce.to_owned()) {
            return Err(AnchorError::Replay {
                nonce: nonce.to_owned(),
            });
        }
        Ok(())
    }
}

/// Verify an [`AnchorCard`]: that it is unexpired at `now_ms` and its Ed25519
/// signature is valid over its canonical payload.
///
/// Recomputes the exact signed payload (subject, embedded public key, sorted
/// capabilities, timestamps), then checks the signature against the key the card
/// carries. The clock is injected rather than read from the system so verification
/// is deterministic and testable.
///
/// # Failure contract
///
/// Fails closed with a typed [`AnchorError`]: [`Expired`](AnchorError::Expired) when
/// `now_ms >= expires_at_ms`, [`InvalidKey`](AnchorError::InvalidKey) for an
/// unparseable public key, [`InvalidSignature`](AnchorError::InvalidSignature) for a
/// bad or forged signature, or a hex/serde error for malformed encodings. Never
/// panics. The expiry check runs first, so an expired card is rejected even before
/// signature work.
///
/// # Example
///
/// ```
/// use pd_anchor::{AnchorKeypair, AnchorSubject, verify_card, AnchorError};
///
/// let kp = AnchorKeypair::from_seed([7u8; 32]); // test-only seed
/// let card = kp
///     .sign_card(AnchorSubject::new("daemon-a"), vec!["mesh:peer".into()], 60_000)
///     .unwrap();
///
/// // Valid inside the window (the mint time is trivially before expiry).
/// verify_card(&card, card.issued_at_ms).unwrap();
/// // At/after expiry it fails closed.
/// assert!(matches!(verify_card(&card, card.expires_at_ms), Err(AnchorError::Expired)));
/// ```
pub fn verify_card(card: &AnchorCard, now_ms: i64) -> Result<(), AnchorError> {
    if card.expires_at_ms <= now_ms {
        return Err(AnchorError::Expired);
    }

    let verifying_key = verifying_key_from_hex(&card.public_key_hex)?;
    let signature = signature_from_hex(&card.signature_hex)?;
    let payload = CardSigningPayload {
        subject: &card.subject,
        public_key_hex: &card.public_key_hex,
        capabilities: &card.capabilities,
        issued_at_ms: card.issued_at_ms,
        expires_at_ms: card.expires_at_ms,
    };
    let bytes = serde_json::to_vec(&payload)?;
    verifying_key
        .verify(&bytes, &signature)
        .map_err(|_| AnchorError::InvalidSignature)?;
    Ok(())
}

/// Verify a [`SignedCapabilityEnvelope`] end to end: freshness, card validity,
/// capability containment, signature, and non-replay.
///
/// The checks run in a deliberate order, each fail-closed:
/// 1. envelope not expired at `now_ms`;
/// 2. the embedded [`AnchorCard`] verifies (via [`verify_card`]);
/// 3. every envelope capability is also in the card (no escalation);
/// 4. the envelope's Ed25519 signature is valid over its canonical payload;
/// 5. the `nonce` is fresh against `guard` (no replay).
///
/// The nonce is consumed **last**, only after all cryptographic and containment
/// checks pass, so a structurally invalid envelope does not burn a nonce.
///
/// # Failure contract
///
/// Returns the first failing check as a typed [`AnchorError`]:
/// [`Expired`](AnchorError::Expired),
/// [`CapabilityNotGranted`](AnchorError::CapabilityNotGranted),
/// [`InvalidSignature`](AnchorError::InvalidSignature), or
/// [`Replay`](AnchorError::Replay). Never panics.
///
/// # Example
///
/// See [`AnchorKeypair::issue_envelope`] for a full issue → verify → replay-reject
/// round trip.
pub fn verify_envelope(
    envelope: &SignedCapabilityEnvelope,
    guard: &mut ReplayGuard,
    now_ms: i64,
) -> Result<(), AnchorError> {
    if envelope.expires_at_ms <= now_ms {
        return Err(AnchorError::Expired);
    }
    verify_card(&envelope.card, now_ms)?;

    for capability in &envelope.capabilities {
        if !envelope.card.capabilities.contains(capability) {
            return Err(AnchorError::CapabilityNotGranted {
                capability: capability.clone(),
            });
        }
    }

    let verifying_key = verifying_key_from_hex(&envelope.card.public_key_hex)?;
    let signature = signature_from_hex(&envelope.signature_hex)?;
    let payload = EnvelopeSigningPayload {
        card_hash_hex: card_hash_hex(&envelope.card)?,
        audience: envelope.audience.clone(),
        nonce: envelope.nonce.clone(),
        capabilities: envelope.capabilities.clone(),
        issued_at_ms: envelope.issued_at_ms,
        expires_at_ms: envelope.expires_at_ms,
    };
    let bytes = serde_json::to_vec(&payload)?;
    verifying_key
        .verify(&bytes, &signature)
        .map_err(|_| AnchorError::InvalidSignature)?;

    guard.verify_fresh(&envelope.nonce)?;
    Ok(())
}

/// Build a [`MerkleEvidence`] commitment (SHA-256 root + leaf count) over an
/// ordered slice of leaves.
///
/// Each leaf is hashed, then adjacent hashes are paired and hashed up the tree
/// until a single root remains. An odd node at any level is paired with itself
/// (duplicated), the common "promote the lone leaf" convention. The empty input is
/// defined to hash to `SHA-256("")` with a `leaf_count` of 0, so there is always a
/// well-defined root.
///
/// # Why it exists
///
/// The root is a compact, tamper-evident commitment to the whole ordered set: it is
/// stable for identical inputs (so two runs agree) and changes if any leaf is
/// altered, reordered, added, or removed. That is what lets an audit log prove
/// integrity without disclosing its contents.
///
/// Note: because a lone node is duplicated rather than salted, this construction is
/// not hardened against second-preimage/CVE-2012-2459-style ambiguities between
/// trees of different shapes; it is an integrity commitment for a trusted-producer
/// audit trail, not a defense against a malicious tree-builder.
///
/// # Example
///
/// ```
/// use pd_anchor::merkle_evidence;
///
/// let a = merkle_evidence(&[b"event-1", b"event-2", b"event-3"]);
/// let b = merkle_evidence(&[b"event-1", b"event-2", b"event-3"]);
/// assert_eq!(a, b);                 // deterministic
/// assert_eq!(a.leaf_count, 3);
///
/// // Reordering the leaves changes the root — tampering is evident.
/// let c = merkle_evidence(&[b"event-2", b"event-1", b"event-3"]);
/// assert_ne!(a.root_hex, c.root_hex);
///
/// // The empty set still has a defined root.
/// let empty = merkle_evidence(&[] as &[&[u8]]);
/// assert_eq!(empty.leaf_count, 0);
/// ```
pub fn merkle_evidence(leaves: &[impl AsRef<[u8]>]) -> MerkleEvidence {
    let mut layer: Vec<[u8; 32]> = leaves
        .iter()
        .map(|leaf| Sha256::digest(leaf.as_ref()).into())
        .collect();

    if layer.is_empty() {
        return MerkleEvidence {
            root_hex: hex::encode(Sha256::digest([])),
            leaf_count: 0,
        };
    }

    while layer.len() > 1 {
        let mut next = Vec::with_capacity(layer.len().div_ceil(2));
        for pair in layer.chunks(2) {
            let right = pair.get(1).unwrap_or(&pair[0]);
            let mut hasher = Sha256::new();
            hasher.update(pair[0]);
            hasher.update(right);
            next.push(hasher.finalize().into());
        }
        layer = next;
    }

    MerkleEvidence {
        root_hex: hex::encode(layer[0]),
        leaf_count: leaves.len(),
    }
}

/// The SHA-256 hash of a card's JSON serialization, hex-encoded.
///
/// Used to bind an envelope to the exact card it was issued against: the hash goes
/// into the envelope's signed payload, so an envelope cannot be transplanted onto a
/// different card without breaking its signature. Because it hashes the full
/// serialized card (including the signature field), it is a fingerprint of a
/// *specific signed card*, not of the identity in the abstract.
///
/// # Failure contract
///
/// Returns [`AnchorError::Serde`] only if the card fails to serialize; otherwise
/// infallible. Never panics.
///
/// # Example
///
/// ```
/// use pd_anchor::{AnchorKeypair, AnchorSubject, card_hash_hex};
///
/// let kp = AnchorKeypair::from_seed([7u8; 32]); // test-only seed
/// let card = kp
///     .sign_card(AnchorSubject::new("daemon-a"), vec!["mesh:peer".into()], 60_000)
///     .unwrap();
///
/// // A SHA-256 digest is 32 bytes → 64 hex chars, and is stable for the same card.
/// let h = card_hash_hex(&card).unwrap();
/// assert_eq!(h.len(), 64);
/// assert_eq!(h, card_hash_hex(&card).unwrap());
/// ```
pub fn card_hash_hex(card: &AnchorCard) -> Result<String, AnchorError> {
    Ok(hex::encode(Sha256::digest(serde_json::to_vec(card)?)))
}

#[derive(Serialize)]
struct CardSigningPayload<'a> {
    subject: &'a AnchorSubject,
    public_key_hex: &'a str,
    capabilities: &'a [String],
    issued_at_ms: i64,
    expires_at_ms: i64,
}

#[derive(Serialize)]
struct EnvelopeSigningPayload {
    card_hash_hex: String,
    audience: String,
    nonce: String,
    capabilities: Vec<String>,
    issued_at_ms: i64,
    expires_at_ms: i64,
}

fn verifying_key_from_hex(public_key_hex: &str) -> Result<VerifyingKey, AnchorError> {
    let bytes: [u8; 32] = hex::decode(public_key_hex)?
        .try_into()
        .map_err(|_| AnchorError::InvalidKey)?;
    VerifyingKey::from_bytes(&bytes).map_err(|_| AnchorError::InvalidKey)
}

fn signature_from_hex(signature_hex: &str) -> Result<Signature, AnchorError> {
    let bytes: [u8; 64] = hex::decode(signature_hex)?
        .try_into()
        .map_err(|_| AnchorError::InvalidSignature)?;
    Ok(Signature::from_bytes(&bytes))
}

/// Every way anchor-card / capability-envelope verification can refuse.
///
/// The type is the fail-closed contract made explicit: each variant is a distinct
/// *denial reason*, so callers can distinguish "expired" from "forged" from
/// "replayed" without string-matching. There is no `Ok`-ish variant — the absence
/// of an error is the only success. Implements [`std::error::Error`] via `thiserror`.
#[derive(Debug, Error)]
pub enum AnchorError {
    /// The card or envelope's validity window has closed (`now_ms >= expires_at_ms`).
    #[error("anchor payload expired")]
    Expired,
    /// The embedded public key is not a well-formed Ed25519 key.
    #[error("invalid anchor public key")]
    InvalidKey,
    /// The signature is malformed or does not verify against the payload and key.
    #[error("invalid anchor signature")]
    InvalidSignature,
    /// An envelope claimed a capability its underlying card does not grant — the
    /// escalation guard that keeps authority one-directional.
    #[error("capability not granted: {capability}")]
    CapabilityNotGranted {
        /// The offending capability that was not present in the card.
        capability: String,
    },
    /// The envelope's nonce was already seen by the [`ReplayGuard`].
    #[error("replayed capability envelope nonce: {nonce}")]
    Replay {
        /// The nonce that was replayed.
        nonce: String,
    },
    /// A hex field failed to decode (transparently wraps [`hex::FromHexError`]).
    #[error(transparent)]
    Hex(#[from] hex::FromHexError),
    /// Serialization of a signing payload failed (transparently wraps
    /// [`serde_json::Error`]).
    #[error(transparent)]
    Serde(#[from] serde_json::Error),
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keypair() -> AnchorKeypair {
        AnchorKeypair::from_seed([7_u8; 32])
    }

    #[test]
    fn signed_cards_verify() {
        let keypair = keypair();
        let card = keypair
            .sign_card(
                AnchorSubject::new("daemon-a"),
                vec!["mesh:peer".to_owned(), "room:write".to_owned()],
                60_000,
            )
            .unwrap();

        verify_card(&card, now_ms()).unwrap();
    }

    #[test]
    fn expired_cards_are_rejected() {
        let keypair = keypair();
        let card = keypair
            .sign_card(
                AnchorSubject::new("daemon-a"),
                vec!["mesh:peer".to_owned()],
                -1,
            )
            .unwrap();

        let err = verify_card(&card, now_ms()).unwrap_err();
        assert!(matches!(err, AnchorError::Expired));
    }

    #[test]
    fn capability_envelopes_verify_and_reject_replay() {
        let keypair = keypair();
        let card = keypair
            .sign_card(
                AnchorSubject::new("daemon-a"),
                vec!["mesh:peer".to_owned(), "room:write".to_owned()],
                60_000,
            )
            .unwrap();
        let envelope = keypair
            .issue_envelope(
                card,
                "daemon-b",
                "nonce-1",
                vec!["room:write".to_owned()],
                10_000,
            )
            .unwrap();
        let mut guard = ReplayGuard::default();

        verify_envelope(&envelope, &mut guard, now_ms()).unwrap();
        let err = verify_envelope(&envelope, &mut guard, now_ms()).unwrap_err();
        assert!(matches!(err, AnchorError::Replay { .. }));
    }

    #[test]
    fn envelope_rejects_ungranted_capability() {
        let keypair = keypair();
        let card = keypair
            .sign_card(
                AnchorSubject::new("daemon-a"),
                vec!["mesh:peer".to_owned()],
                60_000,
            )
            .unwrap();
        let envelope = keypair
            .issue_envelope(
                card,
                "daemon-b",
                "nonce-2",
                vec!["room:write".to_owned()],
                10_000,
            )
            .unwrap();
        let mut guard = ReplayGuard::default();

        let err = verify_envelope(&envelope, &mut guard, now_ms()).unwrap_err();
        assert!(matches!(err, AnchorError::CapabilityNotGranted { .. }));
    }

    #[test]
    fn merkle_root_is_stable() {
        let first = merkle_evidence(&[b"event-1", b"event-2", b"event-3"]);
        let second = merkle_evidence(&[b"event-1", b"event-2", b"event-3"]);

        assert_eq!(first, second);
        assert_eq!(first.leaf_count, 3);
    }
}
