//! Harbor card verification — the **hv:2 wire format** (ADR-0049, ADR-0120).
//!
//! # Why this crate exists in the shape it does
//!
//! ADR-0120 ruled that every security primitive gets exactly one canonical
//! implementation and that implementation is Rust. It also recorded the debt
//! this file pays off: the crate used to verify a *legacy, unversioned* card
//! format that nothing on the wire ever minted — it signed the raw bytes of
//! `header_b64 + "." + payload_b64` where the live format signs the SHA-256
//! digest of that string, and its `cap: Vec<String>` could not express a
//! structured capability at all. A "canonical verifier" of a format nobody
//! mints is worse than no verifier: it looks like a gate and is not one.
//!
//! The LIVE format is **hv:2**: an Ed25519 (`alg: EdDSA`) JWT-shaped token
//! minted by `apps/relay/src/handlers.ts` (`handleExchange`) and verified by
//! `apps/relay/src/auth.ts` (`verifyCard`). This crate is now the canonical
//! implementation of that verification, and the two implementations are locked
//! together by the shared fixture
//! `tests/fixtures/harbor-card-hv2-parity-vectors.json` — generated from THIS
//! code, asserted by both `tests/hv2_parity_vectors.rs` (here) and
//! `apps/relay/tests/harbor-card-hv2-parity.test.ts` (there). ADR-0120 rule 1:
//! no fixture, no second implementation.
//!
//! # What is deliberately NOT here
//!
//! **JTI revocation.** `verifyCard` also asks D1 whether the card's `jti` was
//! revoked. That is stateful relay policy backed by a database the kernel
//! cannot see — not a primitive — so it stays in the relay. A caller who needs
//! revocation must apply it *on top of* [`HarborCardVerifier::verify`]. See
//! [`HarborCardVerifier::verify`]'s "Boundary" section.
//!
//! # Signing input (the byte-level contract — get this exactly right)
//!
//! ```text
//! signing_input = ascii(header_b64) || "." || ascii(payload_b64)
//! signed_message = SHA-256(signing_input)          // the raw 32 digest bytes
//! signature      = Ed25519(issuer_sk, signed_message)
//! ```
//!
//! Note the double hash: Ed25519 internally hashes with SHA-512, and hv:2
//! hands it a SHA-256 digest rather than the signing input itself. That is
//! *not* the RFC 7515 JWT construction (which signs the signing input
//! directly), so a generic JWT library will NOT verify an hv:2 card. The relay
//! arrived at it because `verifyEd25519(pub, msgHex, sigHex)` takes a hex
//! message and the caller passes `toHex(sha256(input))` — `fromHex` turns that
//! straight back into the 32 digest bytes. Preserving this quirk is the whole
//! point of a parity fixture: it is the wire, whether or not it is the
//! construction anyone would pick today.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use zeroize::Zeroize;

/// Every way an hv:2 harbor card can be refused.
///
/// Each variant maps onto a `CardError` code raised by
/// `apps/relay/src/auth.ts`, so a divergence in *which* refusal fires is
/// visible in the parity fixture rather than hidden behind a boolean. The
/// mapping is recorded next to each variant; variants with no TS counterpart
/// say so explicitly.
#[derive(Error, Debug)]
pub enum HarborError {
    /// A base64url segment, the public key, or the signature was not decodable.
    /// TS counterpart: `base64UrlDecode` throwing out of `decodeCard`.
    #[error("Invalid encoding")]
    InvalidEncoding,
    /// Ed25519 verification failed. TS counterpart: `BAD_SIG`.
    #[error("Invalid signature")]
    InvalidSignature,
    /// `now_ts > exp`. TS counterpart: `EXPIRED`.
    #[error("Token expired")]
    Expired,
    /// `now_ts < nbf`. TS counterpart: `NOT_YET_VALID`.
    #[error("Token not yet valid")]
    NotYetValid,
    /// The payload's `hv` is not [`HARBOR_CARD_VERSION`]. TS counterpart:
    /// `WRONG_VERSION`.
    #[error("Unsupported harbor card version: expected hv:{expected}, got {actual}")]
    WrongVersion {
        /// The only version this verifier implements.
        expected: i64,
        /// What the card actually claimed.
        actual: i64,
    },
    /// Structurally not a card (wrong dot-part count), or internally
    /// incoherent (`iat > exp`). TS counterpart: `MALFORMED` for the former;
    /// the latter has NO TS counterpart — see [`HarborCardVerifier::verify`].
    #[error("Malformed token")]
    Malformed,
    /// The token's header declares a signature algorithm this implementation does
    /// not support. Only [`SUPPORTED_ALG`] (`EdDSA`) is accepted; anything else —
    /// including `none` — is rejected fail-closed before the claims are trusted.
    /// TS counterpart: `WRONG_ALG`.
    #[error("Unsupported algorithm")]
    UnsupportedAlgorithm,
    /// The token's `iat` (issued-at) is further in the future than the permitted
    /// clock-skew window ([`MAX_CLOCK_SKEW_SECS`]). A token that claims to have
    /// been issued after "now" is either a clock-skew abuse or a forgery attempt.
    /// This check has NO TS counterpart — the Rust verifier is strictly stricter
    /// here, and the parity fixture records that divergence rather than hiding it.
    #[error("Token issued in the future")]
    IssuedInFuture,
    /// The card carries no capability entry covering the requested
    /// `(op, channel)`. Raised only by
    /// [`HarborCardVerifier::verify_for_channel`]. TS counterpart:
    /// `INSUFFICIENT_CAP`.
    #[error("Card has no capability for the requested op/channel")]
    InsufficientCapability,
    /// The header or payload was not the JSON this format requires.
    #[error("JSON error: {0}")]
    JsonError(#[from] serde_json::Error),
}

/// The one signature algorithm this verifier implements: Ed25519 (`EdDSA`).
///
/// The token header carries an `alg` field. This crate always verifies with
/// Ed25519 regardless of what the field claims, so [`HarborCardVerifier::verify`]
/// cross-checks the declared `alg` against this constant and rejects any mismatch.
/// That closes the "algorithm confusion" class (e.g. a token forged with
/// `alg: none` or a symmetric algorithm) fail-closed, rather than silently
/// EdDSA-verifying whatever the header claims.
pub const SUPPORTED_ALG: &str = "EdDSA";

/// The only harbor card version on the wire: `hv: 2`.
///
/// The version lives in the *payload*, not the header, and is therefore covered
/// by the signature — an attacker cannot downgrade a card to a laxer format by
/// editing it. `apps/relay/src/auth.ts` pins the same constant; a card claiming
/// any other version is refused rather than best-effort parsed, because "parse
/// an unknown version leniently" is how a format migration becomes a bypass.
pub const HARBOR_CARD_VERSION: i64 = 2;

/// Maximum tolerated clock skew, in seconds, for the `iat` not-before check.
///
/// A token whose `iat` exceeds `now + MAX_CLOCK_SKEW_SECS` is rejected as
/// future-dated. The window absorbs benign clock drift between the issuer and the
/// verifier while still rejecting tokens dated meaningfully into the future.
pub const MAX_CLOCK_SKEW_SECS: i64 = 60;

/// The token header: `{"alg":"EdDSA","kid":"<issuer fingerprint>"}`.
///
/// Only `alg` is policy-relevant to this verifier and it is cross-checked
/// against [`SUPPORTED_ALG`]. `kid` is carried through because the *caller*
/// needs it — it names which issuer key to verify under (the relay looks the
/// fingerprint up in D1). This crate does not resolve keys; it verifies under
/// the key it was constructed with, so `kid` is informational here.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HarborCardHeader {
    /// Signature algorithm. Must equal [`SUPPORTED_ALG`].
    pub alg: String,
    /// Issuer key fingerprint (hex). Optional on the wire; used by callers to
    /// select the verifying key before they ever reach this crate.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kid: Option<String>,
}

/// One structured capability grant, mirroring `CapabilityEntry` in
/// `apps/relay/src/types.ts`.
///
/// `op` is typed as a `String` rather than an enum on purpose. The TS type is
/// `'pub' | 'sub' | 'admin'`, but TypeScript types are not runtime checks:
/// `matchCapability` simply *skips* an entry whose `op` it does not recognise
/// and keeps scanning. A Rust enum would instead fail deserialization and
/// reject the entire card — a different accept/reject decision on the same
/// bytes, i.e. a silent divergence. Parity with the live verifier beats
/// prettier types here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CapabilityEntry {
    /// Requested operation: `pub`, `sub`, or `admin`. `admin` acts as an
    /// op-wildcard (see [`capability_matches`]).
    pub op: String,
    /// Exact channel name, or a glob (`*`, or a `prefix*`).
    pub channel: String,
    /// Optional publish-rate ceiling. Enforced by the relay, not here; carried
    /// so that attenuation checks can compare ceilings.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rate_per_min: Option<u64>,
    /// Optional per-message payload ceiling, same enforcement story as
    /// `rate_per_min`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_payload_bytes: Option<u64>,
}

/// The hv:2 card payload, mirroring `HarborCardPayload` in
/// `apps/relay/src/types.ts`.
///
/// Numeric claims are `i64` rather than a narrower type so that an out-of-range
/// value is a *policy* rejection (`WrongVersion`, `Expired`) instead of a
/// deserialization failure — again, so Rust and TS refuse the same bytes for
/// the same reason.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HarborCardClaims {
    /// Harbor card format version. Must equal [`HARBOR_CARD_VERSION`].
    pub hv: i64,
    /// Subject: the daemon fingerprint (hex) the card was minted for.
    pub sub: String,
    /// Issuer: the harbor fingerprint (hex).
    pub iss: String,
    /// Audience: the harbor fingerprint (hex) — equal to `iss` in Phase 2.
    pub aud: String,
    /// Expiry, unix seconds.
    pub exp: i64,
    /// Optional not-before, unix seconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nbf: Option<i64>,
    /// Issued-at, unix seconds.
    pub iat: i64,
    /// Unique token id. The relay checks this against its D1 revocation table;
    /// this crate deliberately does not (see the module docs).
    pub jti: String,
    /// The structured capability grants carried by the card.
    pub cap: Vec<CapabilityEntry>,
}

/// An hv:2 harbor card verifier bound to one issuer public key.
///
/// Key *selection* (which issuer signed this card) is the caller's job: the
/// relay reads the header's `kid` and looks the identity up in D1. Binding the
/// verifier to a single key makes it impossible to accidentally verify a card
/// under a key the caller never chose.
pub struct HarborCardVerifier {
    /// The Ed25519 public key every card presented to this verifier must
    /// verify under.
    pub public_key: VerifyingKey,
}

/// Does a capability entry's channel pattern match a *concrete* channel?
///
/// Byte-for-byte the grammar of `channelMatches` in `apps/relay/src/auth.ts`:
///
/// - `*` matches everything;
/// - an exact string match wins (so a channel literally named `a*` is matched
///   by the pattern `a*` via equality before the glob branch is reached);
/// - otherwise a trailing `*` is a prefix glob;
/// - anything else does not match. There is no `?`, no character class, no
///   interior `*`, and no regex. Widening this grammar widens every card in
///   circulation, so it is pinned by the parity fixture.
pub fn channel_matches(pattern: &str, channel: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    if pattern == channel {
        return true;
    }
    if let Some(prefix) = pattern.strip_suffix('*') {
        return channel.starts_with(prefix);
    }
    false
}

/// Find the first capability entry granting `required_op` on
/// `required_channel`, mirroring `matchCapability` in `apps/relay/src/auth.ts`.
///
/// Two rules, both load-bearing:
///
/// 1. **op with an admin wildcard** — an entry matches if its `op` equals the
///    required op *or* is exactly `admin`. `admin` is therefore a superuser op
///    on whatever channels it names, not merely a third peer of `pub`/`sub`.
/// 2. **glob channel matching** — via [`channel_matches`].
///
/// Returns the matching entry (not just a boolean) because the caller needs its
/// `rate_per_min` / `max_payload_bytes` to enforce the ceiling — exactly what
/// the TS version returns for the same reason. First match wins, in card order:
/// with two overlapping entries the earlier one's ceilings apply, so a minter
/// must order from tightest to loosest if it cares.
pub fn capability_matches<'a>(
    caps: &'a [CapabilityEntry],
    required_op: &str,
    required_channel: &str,
) -> Option<&'a CapabilityEntry> {
    caps.iter().find(|cap| {
        (cap.op == required_op || cap.op == "admin")
            && channel_matches(&cap.channel, required_channel)
    })
}

/// Does `root_pattern` cover every concrete channel `sub_pattern` could match?
///
/// This is **pattern-covers-pattern**, which is a strictly harder question than
/// [`channel_matches`]'s pattern-matches-channel, and it has **no counterpart in
/// `apps/relay/src/auth.ts`** — the relay only ever asks "does this card grant
/// the channel in front of me". It exists here for attenuation checks (does a
/// delegated card ask for no more than its parent granted), which run daemon-
/// side.
///
/// The rule is deliberately conservative, so that
/// `covers(p, q) ⟹ ∀c. channel_matches(q, c) → channel_matches(p, c)`
/// (asserted by a property test):
///
/// - `*` covers everything.
/// - `prefix*` covers any pattern that starts with `prefix` — glob or literal.
/// - a literal covers only itself, and only when the other side is not a glob:
///   the literal `a` does NOT cover `a*`, which reaches `ab`.
pub fn channel_pattern_covers(root_pattern: &str, sub_pattern: &str) -> bool {
    if root_pattern == "*" {
        return true;
    }
    if let Some(prefix) = root_pattern.strip_suffix('*') {
        return sub_pattern.starts_with(prefix);
    }
    // Root is a literal: only an identical literal is covered. A sub-pattern
    // ending in '*' is treated as a glob (thus not covered) even though
    // `channel_matches` would have matched it by equality — fail closed.
    root_pattern == sub_pattern && !sub_pattern.ends_with('*')
}

/// Is every entry in `sub` no broader than something in `root`?
///
/// The structured-capability attenuation gate. An entry is covered when some
/// root entry (a) admits its op — same op, or root `admin` — (b) covers its
/// channel pattern per [`channel_pattern_covers`], and (c) does not loosen a
/// ceiling: if the root bounds `rate_per_min` / `max_payload_bytes`, the sub
/// entry must bound it too, at or below the root's value. An unbounded sub
/// entry under a bounded root is an escalation, not an omission.
///
/// An empty `sub` is vacuously a subset — dropping authority is always legal.
///
/// **Honest scope:** like [`channel_pattern_covers`], this has no TS
/// counterpart and is therefore NOT gated by the shared fixture's card
/// vectors. It is exercised by its own Rust-side vectors and property tests.
/// Do not describe it as "the same check the relay runs" — the relay runs
/// [`capability_matches`].
pub fn verify_capability_subset_structured(
    root: &[CapabilityEntry],
    sub: &[CapabilityEntry],
) -> bool {
    sub.iter().all(|s| {
        root.iter().any(|r| {
            (r.op == s.op || r.op == "admin")
                && channel_pattern_covers(&r.channel, &s.channel)
                && ceiling_is_attenuated(r.rate_per_min, s.rate_per_min)
                && ceiling_is_attenuated(r.max_payload_bytes, s.max_payload_bytes)
        })
    })
}

/// A `None` root ceiling permits anything; a `Some` root ceiling requires the
/// child to state a ceiling that is no larger. Split out so the two ceiling
/// fields cannot drift apart.
fn ceiling_is_attenuated(root: Option<u64>, sub: Option<u64>) -> bool {
    match (root, sub) {
        (None, _) => true,
        (Some(_), None) => false,
        (Some(r), Some(s)) => s <= r,
    }
}

impl HarborCardVerifier {
    /// Build a verifier from a raw 32-byte Ed25519 public key.
    ///
    /// Fails on a key that is not a valid curve point, so a mistyped or
    /// truncated key is a construction-time error rather than a verifier that
    /// silently rejects every card.
    pub fn new(pk_bytes: [u8; 32]) -> Result<Self, HarborError> {
        let public_key = Self::internal_pk_from_bytes(pk_bytes)?;
        Ok(Self { public_key })
    }

    /// Build a verifier from a hex-encoded public key — the shape the relay's
    /// identity table and the parity fixture both store.
    pub fn from_hex(pk_hex: &str) -> Result<Self, HarborError> {
        if pk_hex.len() != 64 {
            return Err(HarborError::InvalidEncoding);
        }
        let mut bytes = [0u8; 32];
        for (i, out) in bytes.iter_mut().enumerate() {
            *out = u8::from_str_radix(&pk_hex[i * 2..i * 2 + 2], 16)
                .map_err(|_| HarborError::InvalidEncoding)?;
        }
        Self::new(bytes)
    }

    fn internal_pk_from_bytes(bytes: [u8; 32]) -> Result<VerifyingKey, HarborError> {
        VerifyingKey::from_bytes(&bytes).map_err(|_| HarborError::InvalidEncoding)
    }

    fn internal_decode_b64(input: &str) -> Result<Vec<u8>, HarborError> {
        URL_SAFE_NO_PAD
            .decode(input)
            .map_err(|_| HarborError::InvalidEncoding)
    }

    /// Verify an Ed25519 signature over the SHA-256 digest of `signing_input`.
    ///
    /// The digest step is the hv:2 quirk documented at the module level: the
    /// signed message is the 32 raw digest bytes, not the signing input and not
    /// its hex text. `apps/relay/src/auth.ts` reaches the same bytes via
    /// `fromHex(toHex(sha256(input)))`.
    fn internal_verify_sig(
        &self,
        signing_input: &[u8],
        sig_bytes: &[u8],
    ) -> Result<(), HarborError> {
        let signature =
            Signature::from_slice(sig_bytes).map_err(|_| HarborError::InvalidSignature)?;
        let digest = Sha256::digest(signing_input);
        self.public_key
            .verify(digest.as_slice(), &signature)
            .map_err(|_| HarborError::InvalidSignature)
    }

    /// Compare two byte strings in time independent of their contents.
    ///
    /// Exported over FFI as `harbor_constant_time_compare` and named by
    /// ADR-0120 as one of this crate's two canonical exports. The length check
    /// short-circuits deliberately: lengths are not secret, contents are.
    pub fn constant_time_compare(a: &[u8], b: &[u8]) -> bool {
        if a.len() != b.len() {
            return false;
        }
        let mut result = 0u8;
        for i in 0..a.len() {
            result |= a[i] ^ b[i];
        }
        result == 0
    }

    /// Flat-string capability subset check — the **live FFI contract** that
    /// `lib/arbiter.ts` loads as `harbor_verify_caps_subset_json`.
    ///
    /// This is not the hv:2 capability grammar: it is set containment over
    /// opaque capability strings, which is what the daemon's Arbiter attenuation
    /// monitor speaks. It is kept, unchanged, because a live caller depends on
    /// it. The structured hv:2 equivalent is
    /// [`verify_capability_subset_structured`]; the two are separate functions
    /// on purpose so neither is quietly used where the other was meant.
    pub fn verify_capability_subset(root_caps: &[String], sub_caps: &[String]) -> bool {
        for sub in sub_caps {
            if !root_caps.contains(sub) {
                return false;
            }
        }
        true
    }

    /// Verify an hv:2 harbor card (`header.payload.signature`, each part
    /// URL-safe base64 without padding) against this verifier's public key and
    /// the supplied wall-clock time `now_ts` (unix seconds).
    ///
    /// The clock is injected, never read from the system: a verifier that reads
    /// the clock cannot be tested at a boundary, and every parity vector pins
    /// an exact `now_ts`.
    ///
    /// # Order of checks
    ///
    /// Fail-closed, and ordered so that no untrusted field is trusted before
    /// the signature is confirmed:
    ///
    /// 1. **Structure** — exactly three dot-separated parts, else [`HarborError::Malformed`].
    /// 2. **Signature** — Ed25519 over `SHA-256(header_b64 "." payload_b64)`. A
    ///    forged or tampered token fails here ([`HarborError::InvalidSignature`])
    ///    before any claim is read. The signature covers the header, so the
    ///    `alg` field below is authenticated, not attacker-chosen.
    /// 3. **Algorithm** — the header's `alg` must equal [`SUPPORTED_ALG`],
    ///    closing the "alg confusion" class (`alg: none`, symmetric-key
    ///    confusion) fail-closed.
    /// 4. **Version** — `hv` must equal [`HARBOR_CARD_VERSION`].
    /// 5. **Issued-at coherence** — `iat > exp` is incoherent
    ///    ([`HarborError::Malformed`]); `iat` beyond `now_ts +
    ///    MAX_CLOCK_SKEW_SECS` is future-dated
    ///    ([`HarborError::IssuedInFuture`]). There is deliberately no
    ///    independent max-age bound: `exp` already bounds the validity window.
    /// 6. **Expiry** — rejected as [`HarborError::Expired`] once `now_ts > exp`.
    /// 7. **Not-before** — rejected as [`HarborError::NotYetValid`] when `nbf`
    ///    is present, non-zero, and greater than `now_ts`.
    ///
    /// # Divergence from `apps/relay/src/auth.ts` (stated, not papered over)
    ///
    /// - **Order.** `verifyCard` checks `alg`/`hv`/`exp`/`nbf` *before* the
    ///   signature, so on a card with two faults it reports the claim error
    ///   where this reports `InvalidSignature`. Same accept/reject verdict,
    ///   different code. The parity fixture keeps negative vectors
    ///   single-fault so the codes agree.
    /// - **`iat`.** `verifyCard` ignores `iat` entirely. Steps 5's two checks
    ///   are Rust-only: this verifier is strictly stricter, and the fixture
    ///   carries a vector where TS accepts and Rust refuses, labelled as such.
    /// - **`nbf: 0`.** `verifyCard` writes `if (payload.nbf && now < payload.nbf)`,
    ///   and `0` is falsy in JavaScript, so an `nbf` of exactly 0 disables the
    ///   check. This mirrors that quirk rather than fixing it unilaterally;
    ///   fixing it is a wire-format change and belongs in an ADR, not here.
    ///
    /// # Boundary: revocation is not checked here
    ///
    /// `verifyCard` additionally asks D1 whether `jti` was revoked and refuses
    /// with `REVOKED`. That lookup is stateful relay policy over a database the
    /// kernel cannot reach, so it stays in the relay (ADR-0120: keep the TCB
    /// small). **A caller that needs revocation must check `claims.jti` against
    /// its own revocation store after this returns.** A card that verifies here
    /// is authentic and unexpired; it is not thereby un-revoked.
    ///
    /// ```
    /// # // Full happy-path verification needs the signing key, so it lives in the
    /// # // test module; this block pins the public policy constants the contract
    /// # // above refers to.
    /// use harbor_card_rs::{SUPPORTED_ALG, MAX_CLOCK_SKEW_SECS, HARBOR_CARD_VERSION};
    /// assert_eq!(SUPPORTED_ALG, "EdDSA");
    /// assert_eq!(MAX_CLOCK_SKEW_SECS, 60);
    /// assert_eq!(HARBOR_CARD_VERSION, 2);
    /// ```
    pub fn verify(&self, token: &str, now_ts: i64) -> Result<HarborCardClaims, HarborError> {
        let parts: Vec<&str> = token.split('.').collect();
        if parts.len() != 3 {
            return Err(HarborError::Malformed);
        }

        let header_b64 = parts[0];
        let payload_b64 = parts[1];
        let signature_b64 = parts[2];

        let signing_input = format!("{}.{}", header_b64, payload_b64);
        let mut sig_bytes = Self::internal_decode_b64(signature_b64)?;

        let sig_result = self.internal_verify_sig(signing_input.as_bytes(), &sig_bytes);
        sig_bytes.zeroize();
        sig_result?;

        // The header is authenticated by the signature above, so its `alg` claim
        // is now trustworthy — but "trustworthy" still means "must say what we
        // actually verify with". Reject any algorithm other than Ed25519 so a
        // future format extension (or a mis-issued token) cannot slip a different
        // algorithm past a verifier that only ever runs one.
        let mut header_bytes = Self::internal_decode_b64(header_b64)?;
        let header: Result<HarborCardHeader, _> = serde_json::from_slice(&header_bytes);
        header_bytes.zeroize();
        if header?.alg != SUPPORTED_ALG {
            return Err(HarborError::UnsupportedAlgorithm);
        }

        let mut payload_bytes = Self::internal_decode_b64(payload_b64)?;
        let claims: Result<HarborCardClaims, _> = serde_json::from_slice(&payload_bytes);
        payload_bytes.zeroize();
        let claims = claims?;

        if claims.hv != HARBOR_CARD_VERSION {
            return Err(HarborError::WrongVersion {
                expected: HARBOR_CARD_VERSION,
                actual: claims.hv,
            });
        }

        // Issued-at validation (Rust-only, see the divergence note above). A
        // token dated after its own expiry is incoherent; a token dated
        // meaningfully into the future is clock-skew abuse or a forgery attempt.
        if claims.iat > claims.exp {
            return Err(HarborError::Malformed);
        }
        if claims.iat > now_ts.saturating_add(MAX_CLOCK_SKEW_SECS) {
            return Err(HarborError::IssuedInFuture);
        }

        if now_ts > claims.exp {
            return Err(HarborError::Expired);
        }

        // `nbf == 0` is treated as absent to match auth.ts's JS-truthiness test.
        if let Some(nbf) = claims.nbf {
            if nbf != 0 && now_ts < nbf {
                return Err(HarborError::NotYetValid);
            }
        }

        Ok(claims)
    }

    /// [`HarborCardVerifier::verify`] plus the capability check `verifyCard`
    /// performs, so callers get the whole relay-side decision in one call.
    ///
    /// Refuses with [`HarborError::InsufficientCapability`] when no entry
    /// grants `required_op` on `required_channel` (TS: `INSUFFICIENT_CAP`).
    /// Revocation still belongs to the caller — see [`HarborCardVerifier::verify`].
    pub fn verify_for_channel(
        &self,
        token: &str,
        now_ts: i64,
        required_op: &str,
        required_channel: &str,
    ) -> Result<HarborCardClaims, HarborError> {
        let claims = self.verify(token, now_ts)?;
        if capability_matches(&claims.cap, required_op, required_channel).is_none() {
            return Err(HarborError::InsufficientCapability);
        }
        Ok(claims)
    }
}

// ─── Kani Verification Layer ─────────────────────────────────────────────────

#[cfg(kani)]
mod stubs {
    use super::*;

    pub fn pk_from_bytes_stub(_bytes: [u8; 32]) -> Result<VerifyingKey, HarborError> {
        Ok(VerifyingKey::from_bytes(&[0u8; 32]).unwrap())
    }

    pub fn decode_b64_stub(_input: &str) -> Result<Vec<u8>, HarborError> {
        if kani::any() {
            Ok(vec![0u8; 32])
        } else {
            Err(HarborError::InvalidEncoding)
        }
    }

    pub fn verify_sig_stub(
        _verifier: &HarborCardVerifier,
        _msg: &[u8],
        _sig: &[u8],
    ) -> Result<(), HarborError> {
        if kani::any() {
            Ok(())
        } else {
            Err(HarborError::InvalidSignature)
        }
    }
}

#[cfg(kani)]
#[kani::proof]
#[kani::stub(HarborCardVerifier::internal_pk_from_bytes, stubs::pk_from_bytes_stub)]
#[kani::stub(HarborCardVerifier::internal_decode_b64, stubs::decode_b64_stub)]
#[kani::stub(HarborCardVerifier::internal_verify_sig, stubs::verify_sig_stub)]
#[kani::unwind(128)]
fn proof_verify_logic_only() {
    let pk_bytes: [u8; 32] = kani::any();
    if let Ok(verifier) = HarborCardVerifier::new(pk_bytes) {
        let token_bytes: [u8; 32] = kani::any();
        if let Ok(token_str) = std::str::from_utf8(&token_bytes) {
            kani::assume(token_str.contains('.'));
            let _ = verifier.verify(token_str, 0);
        }
    }
}

#[cfg(kani)]
#[kani::proof]
fn proof_constant_time_behavior() {
    let a: [u8; 16] = kani::any();
    let b: [u8; 16] = kani::any();
    let _ = HarborCardVerifier::constant_time_compare(&a, &b);
}

#[cfg(kani)]
#[kani::proof]
fn proof_capability_attenuation() {
    let root = vec!["read".to_string(), "write".to_string()];
    let mut sub = vec!["read".to_string()];
    assert!(HarborCardVerifier::verify_capability_subset(&root, &sub));
    sub.push("admin".to_string());
    assert!(!HarborCardVerifier::verify_capability_subset(&root, &sub));
}

// ─── FFI / Shared Library Boundary ──────────────────────────────────────────

use std::os::raw::c_char;
use std::panic::{catch_unwind, AssertUnwindSafe};

/// FFI: Constant-time byte comparison.
///
/// # Safety
/// `a` must point to at least `a_len` readable bytes (or be null); same for `b`/`b_len`.
/// Never panics across the FFI boundary — any panic is caught and reported as `false`.
#[no_mangle]
pub unsafe extern "C" fn harbor_constant_time_compare(
    a: *const u8,
    a_len: usize,
    b: *const u8,
    b_len: usize,
) -> bool {
    catch_unwind(AssertUnwindSafe(|| {
        if a.is_null() || b.is_null() || a_len == 0 || b_len == 0 {
            return false;
        }
        // Prevent pathological sizes from causing out-of-memory or massive hangs
        if a_len > 1024 || b_len > 1024 {
            return false;
        }

        let a_slice = unsafe { std::slice::from_raw_parts(a, a_len) };
        let b_slice = unsafe { std::slice::from_raw_parts(b, b_len) };
        HarborCardVerifier::constant_time_compare(a_slice, b_slice)
    }))
    .unwrap_or(false)
}

/// FFI: Verify if sub_caps JSON string is a subset of root_caps JSON string.
/// Returns true if valid, false if escalation detected or malformed.
///
/// Speaks the **flat string** capability grammar
/// ([`HarborCardVerifier::verify_capability_subset`]), which is what
/// `lib/arbiter.ts` passes. The structured hv:2 grammar is intentionally not
/// exposed over FFI: no native caller needs it today, and every exported symbol
/// is TCB surface someone must trust.
///
/// # Safety
/// `root_json` must point to at least `root_len` readable bytes (or be null); same for
/// `sub_json`/`sub_len`. Never panics across the FFI boundary — any panic is caught and
/// reported as `false`.
#[no_mangle]
pub unsafe extern "C" fn harbor_verify_caps_subset_json(
    root_json: *const c_char,
    root_len: usize,
    sub_json: *const c_char,
    sub_len: usize,
) -> bool {
    catch_unwind(AssertUnwindSafe(|| {
        if root_json.is_null() || sub_json.is_null() || root_len == 0 || sub_len == 0 {
            return false;
        }

        let root_bytes = unsafe { std::slice::from_raw_parts(root_json as *const u8, root_len) };
        let sub_bytes = unsafe { std::slice::from_raw_parts(sub_json as *const u8, sub_len) };

        let root_str = match std::str::from_utf8(root_bytes) {
            Ok(s) => s,
            Err(_) => return false,
        };
        let sub_str = match std::str::from_utf8(sub_bytes) {
            Ok(s) => s,
            Err(_) => return false,
        };

        let root_vec: Vec<String> = match serde_json::from_str(root_str) {
            Ok(v) => v,
            Err(_) => return false,
        };

        let sub_vec: Vec<String> = match serde_json::from_str(sub_str) {
            Ok(v) => v,
            Err(_) => return false,
        };

        HarborCardVerifier::verify_capability_subset(&root_vec, &sub_vec)
    }))
    .unwrap_or(false)
}

// ─── Unit tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{SecretKey, Signer, SigningKey};

    fn test_verifier() -> (SigningKey, HarborCardVerifier) {
        let seed: SecretKey = [7u8; 32];
        let signing_key = SigningKey::from_bytes(&seed);
        let public_key = signing_key.verifying_key();
        (signing_key, HarborCardVerifier { public_key })
    }

    fn cap(op: &str, channel: &str) -> CapabilityEntry {
        CapabilityEntry {
            op: op.to_string(),
            channel: channel.to_string(),
            rate_per_min: None,
            max_payload_bytes: None,
        }
    }

    fn issue_token(signing_key: &SigningKey, claims: &serde_json::Value) -> String {
        issue_token_with_header(signing_key, &serde_json::json!({"alg": "EdDSA"}), claims)
    }

    /// Issue a token with a caller-chosen header (still correctly signed over
    /// `SHA-256(header.payload)`). Used to exercise the `alg` cross-check: an
    /// attacker who could influence the header would still have to produce a
    /// valid signature, so these tokens verify at the signature step and must be
    /// rejected at the algorithm step.
    fn issue_token_with_header(
        signing_key: &SigningKey,
        header: &serde_json::Value,
        claims: &serde_json::Value,
    ) -> String {
        let header_b64 = URL_SAFE_NO_PAD.encode(serde_json::to_vec(header).unwrap());
        let payload_b64 = URL_SAFE_NO_PAD.encode(serde_json::to_vec(claims).unwrap());
        let signing_input = format!("{}.{}", header_b64, payload_b64);
        let sig = signing_key.sign(Sha256::digest(signing_input.as_bytes()).as_slice());
        let sig_b64 = URL_SAFE_NO_PAD.encode(sig.to_bytes());
        format!("{}.{}.{}", header_b64, payload_b64, sig_b64)
    }

    fn sample_claims(exp: i64) -> serde_json::Value {
        claims_with(0, exp)
    }

    fn claims_with(iat: i64, exp: i64) -> serde_json::Value {
        serde_json::json!({
            "hv": 2,
            "sub": "agent-1",
            "iss": "harbor-fp",
            "aud": "harbor-fp",
            "exp": exp,
            "iat": iat,
            "jti": "abc123",
            "cap": [{"op": "sub", "channel": "logs.*"}],
        })
    }

    #[test]
    fn constant_time_compare_equal_bytes() {
        assert!(HarborCardVerifier::constant_time_compare(
            b"same-bytes",
            b"same-bytes"
        ));
    }

    #[test]
    fn constant_time_compare_different_length() {
        assert!(!HarborCardVerifier::constant_time_compare(
            b"short",
            b"much-longer"
        ));
    }

    #[test]
    fn constant_time_compare_same_length_different_content() {
        assert!(!HarborCardVerifier::constant_time_compare(
            b"aaaaaaaa",
            b"aaaaaaab"
        ));
    }

    #[test]
    fn constant_time_compare_empty_slices_are_equal() {
        assert!(HarborCardVerifier::constant_time_compare(b"", b""));
    }

    #[test]
    fn verify_capability_subset_true_for_subset() {
        let root = vec!["read".to_string(), "write".to_string()];
        let sub = vec!["read".to_string()];
        assert!(HarborCardVerifier::verify_capability_subset(&root, &sub));
    }

    #[test]
    fn verify_capability_subset_false_on_escalation() {
        let root = vec!["read".to_string()];
        let sub = vec!["read".to_string(), "admin".to_string()];
        assert!(!HarborCardVerifier::verify_capability_subset(&root, &sub));
    }

    #[test]
    fn verify_capability_subset_true_for_empty_sub() {
        let root = vec!["read".to_string()];
        let sub: Vec<String> = vec![];
        assert!(HarborCardVerifier::verify_capability_subset(&root, &sub));
    }

    #[test]
    fn verify_roundtrip_valid_token() {
        let (signing_key, verifier) = test_verifier();
        let claims = sample_claims(9_999_999_999);
        let token = issue_token(&signing_key, &claims);

        let verified = verifier
            .verify(&token, 0)
            .expect("valid token should verify");
        assert_eq!(verified.sub, "agent-1");
        assert_eq!(verified.hv, 2);
        assert_eq!(verified.cap.len(), 1);
        assert_eq!(verified.cap[0].channel, "logs.*");
    }

    #[test]
    fn verify_rejects_expired_token() {
        let (signing_key, verifier) = test_verifier();
        let claims = sample_claims(100);
        let token = issue_token(&signing_key, &claims);

        let err = verifier.verify(&token, 200).unwrap_err();
        assert!(matches!(err, HarborError::Expired));
    }

    #[test]
    fn verify_accepts_token_at_exactly_exp() {
        // auth.ts refuses on `now > exp`, so `now == exp` is still valid. Pinned
        // because an off-by-one here is a silently shorter card lifetime.
        let (signing_key, verifier) = test_verifier();
        let claims = sample_claims(1_000);
        let token = issue_token(&signing_key, &claims);
        assert!(verifier.verify(&token, 1_000).is_ok());
    }

    #[test]
    fn verify_rejects_malformed_token_wrong_part_count() {
        let (_signing_key, verifier) = test_verifier();
        let err = verifier.verify("only.two", 0).unwrap_err();
        assert!(matches!(err, HarborError::Malformed));
    }

    #[test]
    fn verify_rejects_tampered_payload() {
        let (signing_key, verifier) = test_verifier();
        let claims = sample_claims(9_999_999_999);
        let token = issue_token(&signing_key, &claims);
        let parts: Vec<&str> = token.split('.').collect();
        let tampered_payload = URL_SAFE_NO_PAD.encode(br#"{"sub":"attacker"}"#);
        let tampered = format!("{}.{}.{}", parts[0], tampered_payload, parts[2]);

        let err = verifier.verify(&tampered, 0).unwrap_err();
        assert!(matches!(err, HarborError::InvalidSignature));
    }

    #[test]
    fn verify_rejects_wrong_signing_key() {
        let (_signing_key, verifier) = test_verifier();
        let other_seed: SecretKey = [9u8; 32];
        let other_key = SigningKey::from_bytes(&other_seed);
        let claims = sample_claims(9_999_999_999);
        let token = issue_token(&other_key, &claims);

        let err = verifier.verify(&token, 0).unwrap_err();
        assert!(matches!(err, HarborError::InvalidSignature));
    }

    #[test]
    fn verify_rejects_rfc7515_style_signature_over_raw_signing_input() {
        // The legacy format this crate used to implement signed the raw
        // `header.payload` bytes. hv:2 signs their SHA-256 digest. A token
        // signed the old way must NOT verify — that non-acceptance is the whole
        // reason the port was needed.
        let (signing_key, verifier) = test_verifier();
        let claims = sample_claims(9_999_999_999);
        let header_b64 = URL_SAFE_NO_PAD.encode(br#"{"alg":"EdDSA"}"#);
        let payload_b64 = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap());
        let signing_input = format!("{}.{}", header_b64, payload_b64);
        let legacy_sig = signing_key.sign(signing_input.as_bytes());
        let token = format!(
            "{}.{}.{}",
            header_b64,
            payload_b64,
            URL_SAFE_NO_PAD.encode(legacy_sig.to_bytes())
        );

        let err = verifier.verify(&token, 0).unwrap_err();
        assert!(matches!(err, HarborError::InvalidSignature));
    }

    // ─── alg-confusion hardening ──────────────────────────────────────────────

    #[test]
    fn verify_rejects_alg_none_even_when_signed() {
        // Classic "alg: none" forgery shape. The token is correctly Ed25519-signed
        // (so it passes the signature step), but its header claims no algorithm.
        // The cross-check must reject it rather than honoring the claims.
        let (signing_key, verifier) = test_verifier();
        let claims = sample_claims(9_999_999_999);
        let token =
            issue_token_with_header(&signing_key, &serde_json::json!({"alg": "none"}), &claims);

        let err = verifier.verify(&token, 0).unwrap_err();
        assert!(matches!(err, HarborError::UnsupportedAlgorithm));
    }

    #[test]
    fn verify_rejects_symmetric_alg_confusion() {
        // A token declaring a symmetric algorithm (HS256) must be rejected: this
        // verifier only ever runs Ed25519, and must not let the header pretend
        // otherwise.
        let (signing_key, verifier) = test_verifier();
        let claims = sample_claims(9_999_999_999);
        let token =
            issue_token_with_header(&signing_key, &serde_json::json!({"alg": "HS256"}), &claims);

        let err = verifier.verify(&token, 0).unwrap_err();
        assert!(matches!(err, HarborError::UnsupportedAlgorithm));
    }

    #[test]
    fn verify_rejects_missing_alg_field() {
        // A header with no `alg` at all is malformed JSON for HarborCardHeader.
        let (signing_key, verifier) = test_verifier();
        let claims = sample_claims(9_999_999_999);
        let token = issue_token_with_header(&signing_key, &serde_json::json!({}), &claims);

        let err = verifier.verify(&token, 0).unwrap_err();
        assert!(matches!(err, HarborError::JsonError(_)));
    }

    #[test]
    fn verify_preserves_kid_when_present() {
        // `kid` selects the issuer key upstream of this crate; it must survive
        // header parsing rather than being rejected as an unknown field.
        let (signing_key, verifier) = test_verifier();
        let claims = sample_claims(9_999_999_999);
        let token = issue_token_with_header(
            &signing_key,
            &serde_json::json!({"alg": "EdDSA", "kid": "ff00"}),
            &claims,
        );
        assert!(verifier.verify(&token, 0).is_ok());
    }

    // ─── hv version pinning ───────────────────────────────────────────────────

    #[test]
    fn verify_rejects_wrong_hv() {
        let (signing_key, verifier) = test_verifier();
        let mut claims = sample_claims(9_999_999_999);
        claims["hv"] = serde_json::json!(1);
        let token = issue_token(&signing_key, &claims);

        let err = verifier.verify(&token, 0).unwrap_err();
        assert!(matches!(
            err,
            HarborError::WrongVersion {
                expected: 2,
                actual: 1
            }
        ));
    }

    #[test]
    fn verify_rejects_missing_hv() {
        let (signing_key, verifier) = test_verifier();
        let mut claims = sample_claims(9_999_999_999);
        claims.as_object_mut().unwrap().remove("hv");
        let token = issue_token(&signing_key, &claims);

        let err = verifier.verify(&token, 0).unwrap_err();
        assert!(matches!(err, HarborError::JsonError(_)));
    }

    // ─── nbf (not-before) ────────────────────────────────────────────────────

    #[test]
    fn verify_rejects_not_yet_valid_token() {
        let (signing_key, verifier) = test_verifier();
        let mut claims = claims_with(0, 9_999_999_999);
        claims["nbf"] = serde_json::json!(5_000);
        let token = issue_token(&signing_key, &claims);

        let err = verifier.verify(&token, 1_000).unwrap_err();
        assert!(matches!(err, HarborError::NotYetValid));
    }

    #[test]
    fn verify_accepts_token_at_exactly_nbf() {
        // auth.ts refuses on `now < nbf`, so `now == nbf` is valid.
        let (signing_key, verifier) = test_verifier();
        let mut claims = claims_with(0, 9_999_999_999);
        claims["nbf"] = serde_json::json!(5_000);
        let token = issue_token(&signing_key, &claims);
        assert!(verifier.verify(&token, 5_000).is_ok());
    }

    #[test]
    fn verify_treats_nbf_zero_as_absent_matching_js_truthiness() {
        // Documented parity quirk: `if (payload.nbf && ...)` in auth.ts skips the
        // check for nbf === 0. Mirrored deliberately; see verify()'s doc.
        let (signing_key, verifier) = test_verifier();
        let mut claims = claims_with(0, 9_999_999_999);
        claims["nbf"] = serde_json::json!(0);
        let token = issue_token(&signing_key, &claims);
        assert!(verifier.verify(&token, -5).is_ok());
    }

    // ─── iat (issued-at) validation — Rust-only strictness ───────────────────

    #[test]
    fn verify_rejects_future_iat() {
        // Token dated well into the future relative to `now_ts`: clock-skew abuse.
        let (signing_key, verifier) = test_verifier();
        let claims = claims_with(10_000, 9_999_999_999);
        let token = issue_token(&signing_key, &claims);

        let err = verifier.verify(&token, 1_000).unwrap_err();
        assert!(matches!(err, HarborError::IssuedInFuture));
    }

    #[test]
    fn verify_accepts_iat_within_clock_skew() {
        // Token issued slightly ahead of the verifier's clock, inside the skew
        // window: benign drift, must still verify.
        let (signing_key, verifier) = test_verifier();
        let iat = 1_000 + MAX_CLOCK_SKEW_SECS - 1;
        let claims = claims_with(iat, 9_999_999_999);
        let token = issue_token(&signing_key, &claims);

        let verified = verifier
            .verify(&token, 1_000)
            .expect("iat within skew window should verify");
        assert_eq!(verified.sub, "agent-1");
    }

    #[test]
    fn verify_rejects_iat_after_exp() {
        // Incoherent token: issued after it expires. Rejected as malformed.
        let (signing_key, verifier) = test_verifier();
        let claims = claims_with(9_000, 8_000);
        let token = issue_token(&signing_key, &claims);

        // now_ts large enough that the future-iat and expiry checks don't fire
        // first — we want the iat>exp coherence check to be what rejects it.
        let err = verifier.verify(&token, 10_000).unwrap_err();
        assert!(matches!(err, HarborError::Malformed));
    }

    // ─── structured capability matching (mirrors auth.ts matchCapability) ─────

    #[test]
    fn capability_exact_channel_matches() {
        let caps = vec![cap("pub", "alerts")];
        assert!(capability_matches(&caps, "pub", "alerts").is_some());
        assert!(capability_matches(&caps, "pub", "alerts.x").is_none());
    }

    #[test]
    fn capability_star_matches_every_channel() {
        let caps = vec![cap("sub", "*")];
        assert!(capability_matches(&caps, "sub", "anything.at.all").is_some());
    }

    #[test]
    fn capability_prefix_glob_matches() {
        let caps = vec![cap("sub", "logs.")];
        assert!(capability_matches(&caps, "sub", "logs.").is_some());
        assert!(capability_matches(&caps, "sub", "logs.app").is_none());

        let globbed = vec![cap("sub", "logs.*")];
        assert!(capability_matches(&globbed, "sub", "logs.app").is_some());
        assert!(capability_matches(&globbed, "sub", "metrics.app").is_none());
    }

    #[test]
    fn capability_admin_op_is_a_wildcard_over_ops() {
        let caps = vec![cap("admin", "ops.*")];
        assert!(capability_matches(&caps, "pub", "ops.deploy").is_some());
        assert!(capability_matches(&caps, "sub", "ops.deploy").is_some());
        assert!(capability_matches(&caps, "admin", "ops.deploy").is_some());
        // The channel still has to match — admin is not a channel wildcard.
        assert!(capability_matches(&caps, "pub", "logs.x").is_none());
    }

    #[test]
    fn capability_op_mismatch_is_refused() {
        let caps = vec![cap("sub", "*")];
        assert!(capability_matches(&caps, "pub", "anything").is_none());
    }

    #[test]
    fn capability_unknown_op_is_skipped_not_fatal() {
        // Parity with matchCapability: an entry with an unrecognised op is
        // skipped, and a later valid entry can still match.
        let caps = vec![cap("delete", "*"), cap("pub", "alerts")];
        assert!(capability_matches(&caps, "pub", "alerts").is_some());
    }

    #[test]
    fn capability_first_match_wins_in_card_order() {
        let mut tight = cap("pub", "alerts");
        tight.rate_per_min = Some(10);
        let mut loose = cap("pub", "*");
        loose.rate_per_min = Some(1000);
        let caps = vec![tight, loose];
        assert_eq!(
            capability_matches(&caps, "pub", "alerts")
                .unwrap()
                .rate_per_min,
            Some(10)
        );
    }

    #[test]
    fn verify_for_channel_refuses_uncovered_channel() {
        let (signing_key, verifier) = test_verifier();
        let claims = sample_claims(9_999_999_999); // cap: sub on logs.*
        let token = issue_token(&signing_key, &claims);

        assert!(verifier
            .verify_for_channel(&token, 0, "sub", "logs.app")
            .is_ok());
        let err = verifier
            .verify_for_channel(&token, 0, "pub", "logs.app")
            .unwrap_err();
        assert!(matches!(err, HarborError::InsufficientCapability));
    }

    // ─── structured attenuation (Rust-only; no TS counterpart) ───────────────

    #[test]
    fn structured_subset_accepts_narrowing() {
        let root = vec![cap("admin", "logs.*")];
        let sub = vec![cap("pub", "logs.app")];
        assert!(verify_capability_subset_structured(&root, &sub));
    }

    #[test]
    fn structured_subset_rejects_channel_escalation() {
        let root = vec![cap("pub", "logs.*")];
        let sub = vec![cap("pub", "metrics.app")];
        assert!(!verify_capability_subset_structured(&root, &sub));
    }

    #[test]
    fn structured_subset_rejects_op_escalation() {
        let root = vec![cap("sub", "*")];
        let sub = vec![cap("admin", "*")];
        assert!(!verify_capability_subset_structured(&root, &sub));
    }

    #[test]
    fn structured_subset_rejects_glob_widening_under_a_literal_root() {
        // The literal root `logs.app` must not cover the glob `logs.app*`,
        // which reaches `logs.append`.
        let root = vec![cap("pub", "logs.app")];
        let sub = vec![cap("pub", "logs.app*")];
        assert!(!verify_capability_subset_structured(&root, &sub));
    }

    #[test]
    fn structured_subset_rejects_dropping_a_ceiling() {
        let mut root = cap("pub", "*");
        root.rate_per_min = Some(60);
        let sub = cap("pub", "*"); // no ceiling at all — unbounded
        assert!(!verify_capability_subset_structured(&[root], &[sub]));
    }

    #[test]
    fn structured_subset_rejects_raising_a_ceiling() {
        let mut root = cap("pub", "*");
        root.max_payload_bytes = Some(1024);
        let mut sub = cap("pub", "*");
        sub.max_payload_bytes = Some(4096);
        assert!(!verify_capability_subset_structured(&[root], &[sub]));
    }

    #[test]
    fn structured_subset_accepts_tightening_a_ceiling() {
        let mut root = cap("pub", "*");
        root.rate_per_min = Some(60);
        let mut sub = cap("pub", "*");
        sub.rate_per_min = Some(10);
        assert!(verify_capability_subset_structured(&[root], &[sub]));
    }

    #[test]
    fn structured_subset_empty_sub_is_vacuously_true() {
        assert!(verify_capability_subset_structured(&[cap("pub", "*")], &[]));
    }

    #[test]
    fn structured_subset_empty_root_grants_nothing() {
        assert!(!verify_capability_subset_structured(
            &[],
            &[cap("pub", "anything")]
        ));
    }

    // ─── FFI wrapper tests (exercise the extern "C" boundary directly) ────────

    #[test]
    fn ffi_constant_time_compare_matches_safe_impl() {
        let a = b"identical".to_vec();
        let b = b"identical".to_vec();
        let result =
            unsafe { harbor_constant_time_compare(a.as_ptr(), a.len(), b.as_ptr(), b.len()) };
        assert!(result);
    }

    #[test]
    fn ffi_constant_time_compare_null_pointer_returns_false() {
        let result =
            unsafe { harbor_constant_time_compare(std::ptr::null(), 4, std::ptr::null(), 4) };
        assert!(!result);
    }

    #[test]
    fn ffi_constant_time_compare_oversized_input_returns_false() {
        let a = vec![0u8; 2048];
        let result =
            unsafe { harbor_constant_time_compare(a.as_ptr(), a.len(), a.as_ptr(), a.len()) };
        assert!(!result);
    }

    #[test]
    fn ffi_verify_caps_subset_json_valid_subset() {
        let root = b"[\"read\",\"write\"]".to_vec();
        let sub = b"[\"read\"]".to_vec();
        let result = unsafe {
            harbor_verify_caps_subset_json(
                root.as_ptr() as *const c_char,
                root.len(),
                sub.as_ptr() as *const c_char,
                sub.len(),
            )
        };
        assert!(result);
    }

    #[test]
    fn ffi_verify_caps_subset_json_rejects_escalation() {
        let root = b"[\"read\"]".to_vec();
        let sub = b"[\"read\",\"admin\"]".to_vec();
        let result = unsafe {
            harbor_verify_caps_subset_json(
                root.as_ptr() as *const c_char,
                root.len(),
                sub.as_ptr() as *const c_char,
                sub.len(),
            )
        };
        assert!(!result);
    }

    #[test]
    fn ffi_verify_caps_subset_json_rejects_malformed_json() {
        let root = b"not json".to_vec();
        let sub = b"[\"read\"]".to_vec();
        let result = unsafe {
            harbor_verify_caps_subset_json(
                root.as_ptr() as *const c_char,
                root.len(),
                sub.as_ptr() as *const c_char,
                sub.len(),
            )
        };
        assert!(!result);
    }

    #[test]
    fn ffi_verify_caps_subset_json_rejects_null() {
        let sub = b"[\"read\"]".to_vec();
        let result = unsafe {
            harbor_verify_caps_subset_json(
                std::ptr::null(),
                0,
                sub.as_ptr() as *const c_char,
                sub.len(),
            )
        };
        assert!(!result);
    }
}

#[cfg(test)]
mod proptests {
    use super::*;
    use proptest::prelude::*;

    fn cap(op: &str, channel: &str) -> CapabilityEntry {
        CapabilityEntry {
            op: op.to_string(),
            channel: channel.to_string(),
            rate_per_min: None,
            max_payload_bytes: None,
        }
    }

    proptest! {
        #[test]
        fn constant_time_compare_agrees_with_equality(a: Vec<u8>, b: Vec<u8>) {
            let expected = a == b;
            prop_assert_eq!(HarborCardVerifier::constant_time_compare(&a, &b), expected);
        }

        #[test]
        fn subset_of_itself_is_always_true(caps: Vec<String>) {
            prop_assert!(HarborCardVerifier::verify_capability_subset(&caps, &caps));
        }

        #[test]
        fn appending_a_novel_cap_breaks_subset(root: Vec<String>, extra in "[a-z]{1,10}") {
            prop_assume!(!root.contains(&extra));
            let mut sub = root.clone();
            sub.push(extra);
            prop_assert!(!HarborCardVerifier::verify_capability_subset(&root, &sub));
        }

        /// The soundness obligation for [`channel_pattern_covers`]: if the root
        /// pattern covers the sub pattern, then every concrete channel the sub
        /// pattern admits is one the root pattern admits too. Without this, an
        /// attenuation check that says "narrower" could hand out access the
        /// parent never had.
        #[test]
        fn pattern_coverage_implies_channel_coverage(
            root in "[a-c.]{0,4}\\*?",
            sub in "[a-c.]{0,4}\\*?",
            channel in "[a-c.]{0,6}",
        ) {
            if channel_pattern_covers(&root, &sub) && channel_matches(&sub, &channel) {
                prop_assert!(channel_matches(&root, &channel));
            }
        }

        /// Structured attenuation is monotone: a card can never grant a concrete
        /// (op, channel) that its parent could not.
        #[test]
        fn structured_subset_never_grants_more_than_root(
            root_ch in "[a-c.]{0,4}\\*?",
            sub_ch in "[a-c.]{0,4}\\*?",
            channel in "[a-c.]{0,6}",
        ) {
            let root = vec![cap("pub", &root_ch)];
            let sub = vec![cap("pub", &sub_ch)];
            if verify_capability_subset_structured(&root, &sub)
                && capability_matches(&sub, "pub", &channel).is_some()
            {
                prop_assert!(capability_matches(&root, "pub", &channel).is_some());
            }
        }
    }
}
