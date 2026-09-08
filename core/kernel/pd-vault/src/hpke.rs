//! RFC 9180 HPKE, base mode only — sealing a [`ChannelKey`] to one recipient
//! device's X25519 public key (ADR-0123 A4/B3).
//!
//! # Why this exists alongside [`mod@crate::seal`]
//!
//! [`mod@crate::seal`] answers "how does a holder of a channel key protect a
//! message inside that channel". This module answers a different question:
//! "how does the channel key itself reach a new device in the first place".
//! That is a one-recipient, one-message problem — deliver 32 bytes to the
//! X25519 public key one device just published — and HPKE is the RFC for
//! exactly that: encrypt to a public key with no prior shared state, using an
//! ephemeral key agreement the sender generates fresh for every wrap. A
//! symmetric primitive like [`crate::seal::seal`] cannot do this at all: there
//! is no channel key yet, because delivering one is the whole point.
//!
//! # Scope: base mode, one ciphersuite, single-shot, by construction
//!
//! RFC 9180 defines four modes (base, PSK, auth, auth+PSK) over a matrix of
//! KEM/KDF/AEAD choices, and a `Context` that can `Seal`/`Open` many messages
//! under an incrementing sequence number. None of that surface exists here,
//! and it is missing on purpose rather than merely unimplemented:
//!
//! - **Base mode only.** `psk` and `psk_id` are RFC 9180's own `default_psk`
//!   / `default_psk_id` — the empty string — hardcoded into every call this
//!   module makes into [`key_schedule_base`]. They are not parameters on any
//!   public function, so a caller cannot even attempt PSK or Auth mode: there
//!   is no argument through which to try. `VerifyPSKInputs` (RFC 9180 §5.1) is
//!   satisfied trivially and is not implemented, because the one case it would
//!   ever need to reject is unreachable.
//! - **One ciphersuite.** `kem_id = 0x0020` (DHKEM(X25519, HKDF-SHA256)),
//!   `kdf_id = 0x0001` (HKDF-SHA256), `aead_id = 0x0002` (AES-256-GCM), wired
//!   into [`KEM_SUITE_ID`] / [`HPKE_SUITE_ID`] as constants. ADR-0123 §1's
//!   "unknown suites ... are hard failures" is not a runtime check anywhere in
//!   this module — there is no suite parameter to mis-set, so an unknown suite
//!   is not a value this code can receive, let alone silently accept.
//! - **One Seal, one Open, per wrap.** RFC 9180's `Context` carries a sequence
//!   number precisely because a real HPKE session can send many messages under
//!   one encapsulation. A wrapped channel key is one message: [`WrappedKey`]
//!   is produced by exactly one `Setup+Seal` and consumed by exactly one
//!   `Setup+Open`, so `seq` is always `0`, `ComputeNonce` always returns
//!   `base_nonce` unmodified, and `IncrementSeq`'s message-limit bookkeeping
//!   has nothing to increment. Implementing a multi-message `Context` here
//!   would be surface with no caller and, worse, an invitation for a future
//!   caller to reuse an encapsulation across wraps — which is exactly the kind
//!   of key/nonce reuse [`mod@crate::seal`]'s own docs warn against.
//!
//! # What this module reuses from the rest of the crate, and why that matters
//!
//! This module invents as little as possible. The raw Diffie-Hellman step
//! (RFC 9180 §4.1's `dh`) goes through [`crate::keys::raw_diffie_hellman`] —
//! the same contributory-key check and the same zeroizing, non-readable
//! [`SharedSecret`] wrapper that [`HarborKemSecret::diffie_hellman`] and
//! [`DeviceKemSecret::diffie_hellman`] already use. The plaintext this module
//! encrypts and decrypts is a [`ChannelKey`]'s bytes via its existing
//! `pub(crate)` accessor — the same one [`crate::seal::seal`] uses, not a new
//! hole opened for HPKE. And every failure this module can produce is one of
//! the crate's *existing* [`VaultError`] variants — `Decrypt`, `Seal`,
//! `InvalidKey`, `Rng`, `EmptyComponent`, `ComponentTooLong` — never a new
//! HPKE-specific variant. The custody law and the "one opaque decryption
//! failure" law from the crate docs are both crate-wide properties; a second
//! AEAD construction that invented its own error taxonomy or its own key
//! wrapper would be two crates' worth of law to keep straight instead of one.
//!
//! # Failure is opaque here too, and for the same reason
//!
//! [`unwrap_channel_key_for_device`] has exactly one failure value for
//! everything below its AAD encoding step: [`VaultError::Decrypt`]. A wrong
//! recipient secret, a tampered `enc`, a tampered ciphertext, and a relabelled
//! [`KeyWrapAad`] field are one indistinguishable outcome, on the same
//! no-oracle footing [`crate::seal::open`]'s module docs argue for. This
//! collapses a case RFC 9180 itself does not: a forged `enc` can make the
//! recipient-side Diffie-Hellman non-contributory, which
//! [`crate::keys::raw_diffie_hellman`] reports as [`VaultError::InvalidKey`]
//! everywhere else in this crate. Left as `InvalidKey` here, it would be a
//! second, distinguishable failure shape available to whoever can tamper with
//! `enc` in transit — precisely the kind of oracle the AEAD-failure design
//! exists to deny. So [`unwrap_channel_key_for_device`] flattens it, along
//! with every other failure below the AAD step, into `Decrypt`.
//!
//! # The version/suite label is structural, not checked
//!
//! ADR-0123 §1 requires "version downgrade" to be a hard failure. There is no
//! version *field* to downgrade: [`KEY_WRAP_AAD_LABEL`] is a compile-time
//! constant, unconditionally the first component [`KeyWrapAad::encode`] writes,
//! and no public function takes a label as an argument. A hypothetical older
//! or newer sender using a different label is not something this code has to
//! detect at runtime, because the AAD it feeds into HPKE's `info` *and* the
//! AEAD's associated data always carries *this* build's label. A mismatched
//! label changes the info string wired into `key_schedule_base`, which changes
//! `key` and `base_nonce`; on the wire, the same mismatch changes what is fed
//! into the AEAD's associated data. Either way, the AEAD tag verification is
//! the enforcement — a version downgrade is just one more field mismatch, and
//! it is caught by the same single opaque `Decrypt` failure as everything else
//! in this module, not by a version comparison anyone could forget to write.
//!
//! # Known-answer vectors: two, with different jobs
//!
//! `tests::rfc9180_official_vector` pins this module's DHKEM, `LabeledExtract`
//! / `LabeledExpand`, and `KeySchedule` primitives against RFC 9180's own
//! reference implementation output — the CFRG working group's
//! `test-vectors.json`, mode 0 / kem_id 32 / kdf_id 1 / aead_id 2. That file is
//! not shipped with this crate; the test asserts against the values it
//! produced, and the module docs of that test record where they came from and
//! how they were obtained. `tests::wrap_kat` is a *self-generated* vector for
//! [`wrap_channel_key_for_device`] / [`unwrap_channel_key_for_device`]
//! specifically — the same honest-provenance pattern as every other KAT in
//! this crate (see [`crate::keys`], [`crate::kdf`], [`mod@crate::seal`]): bytes
//! this implementation produced and pasted back in, gating regression and
//! cross-implementation drift, not claimed as an independent authority.

use hkdf::Hkdf;
use sha2::Sha256;
use x25519_dalek::{PublicKey as XPublicKey, StaticSecret};
use zeroize::Zeroize;

use aes_gcm::aead::{Aead, AeadCore, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Key as AesKey, Nonce as AesGcmNonce};

use crate::kdf::ChannelKey;
use crate::keys::{self, DeviceKemSecret, X25519PublicKey};
use crate::{unambiguous_encoding, VaultError, CHANNEL_KEY_LEN};

/// The literal 7 ASCII bytes RFC 9180 §4 prefixes into every `LabeledExtract`
/// / `LabeledExpand` call, across every mode and every ciphersuite the RFC
/// defines. Domain-separates HPKE's internal HKDF uses from any other
/// protocol that might independently decide to label its own HKDF calls
/// `"eae_prk"` or `"secret"`.
const HPKE_V1: &[u8] = b"HPKE-v1";

/// `suite_id` for DHKEM's own `LabeledExtract` / `LabeledExpand` calls (RFC
/// 9180 §4.1): `"KEM" || I2OSP(kem_id, 2)`, fixed to kem_id `0x0020` —
/// DHKEM(X25519, HKDF-SHA256), the only KEM this module implements.
///
/// Distinct from [`HPKE_SUITE_ID`] on purpose: RFC 9180 defines two different
/// `suite_id` values that both ultimately drive the same HKDF-SHA256, one
/// scoped to the KEM and one scoped to everything outside it, so that a KEM
/// output and a KeySchedule output can never collide even if some future
/// ciphersuite reused a label string across the two contexts.
const KEM_SUITE_ID: [u8; 5] = *b"KEM\x00\x20";

/// `suite_id` for every `LabeledExtract` / `LabeledExpand` call outside the
/// KEM — i.e. inside `KeySchedule` (RFC 9180 §5.1): `"HPKE" ||
/// I2OSP(kem_id, 2) || I2OSP(kdf_id, 2) || I2OSP(aead_id, 2)`, fixed to
/// kem_id `0x0020`, kdf_id `0x0001` (HKDF-SHA256), aead_id `0x0002`
/// (AES-256-GCM) — the one ciphersuite this module implements.
const HPKE_SUITE_ID: [u8; 10] = *b"HPKE\x00\x20\x00\x01\x00\x02";

/// RFC 9180 §5 mode byte for base mode — the only mode value this module ever
/// writes into a `key_schedule_context`.
const MODE_BASE: u8 = 0x00;

/// AES-256-GCM authentication tag length, in bytes (RFC 9180 §7.3, aead_id
/// `0x0002`, `Nt`). A ciphertext shorter than this cannot carry a tag and is
/// rejected before it reaches the AEAD at all — same early-exit shape as
/// [`crate::seal::open`]'s `TAG_LEN` check, and for the same reason: a length
/// check on attacker-controlled input is not the thing worth hiding, only
/// which *cryptographic* check failed is.
const AEAD_TAG_LEN: usize = 16;

/// Domain-separation label for the join-time / rotation channel-key wrap
/// (ADR-0123 A4/B3), and the version component of [`KeyWrapAad`]. The first
/// component [`KeyWrapAad::encode`] writes, unconditionally — see the module
/// docs' "version/suite label is structural" section for what that buys.
pub const KEY_WRAP_AAD_LABEL: &[u8] = b"pd-vault/keywrap/v1";

/// The context a wrapped channel key is bound to — HPKE's `info` and the
/// AEAD's associated data, fed the *same* encoded bytes for both roles.
///
/// Every field is authenticated: `info` personalizes the KDF context (RFC
/// 9180 base mode), and `aad` additionally binds every field into the
/// AES-256-GCM tag, so the relay — which must read `account_id` / `harbor_id`
/// / `recipient_device_id` in cleartext framing to route the envelope — can
/// see these fields but cannot move a `WrappedKey` to a different account,
/// harbor, device, epoch, grant, purpose, or key without invalidating the tag.
/// This is the same "context bound into the tag, not just carried alongside
/// it" design as [`crate::seal::SealAad`], applied to a one-shot HPKE
/// encapsulation instead of a symmetric channel.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct KeyWrapAad<'a> {
    /// The account the wrapped key belongs to.
    pub account_id: &'a str,
    /// The harbor that owns the channel (or content/snapshot key) being
    /// wrapped.
    pub harbor_id: &'a str,
    /// The authority epoch in force when the key was wrapped. Not required to
    /// be non-zero or non-repeating in the way [`crate::seal::SealAad::epoch`]
    /// is: it exists here so a wrapped key cannot be replayed as valid for an
    /// authority epoch it was never actually wrapped under.
    pub authority_epoch: u64,
    /// The device the key is being wrapped *to*. Binding it stops a captured
    /// envelope from being replayed at a device it was never addressed to,
    /// even one that separately holds a valid [`DeviceKemSecret`] for some
    /// *other* wrap.
    pub recipient_device_id: &'a str,
    /// The access grant this key carries for the recipient device — `"use"`,
    /// `"read"`, or `"manage"` (ADR-0042's ladder). Binding it stops a
    /// `"use"`-grant envelope from being relabelled as a `"manage"`-grant one
    /// in transit; the ladder position itself is enforced by whatever consults
    /// this string, not by this crate.
    pub grant: &'a str,
    /// What kind of key this is — `"channel"`, `"content"`, or `"snapshot"`.
    pub key_purpose: &'a str,
    /// The identifier of the specific key within its purpose — e.g. the
    /// `channel_id` for a `"channel"`-purpose key.
    pub key_id: &'a str,
}

impl KeyWrapAad<'_> {
    /// The canonical byte encoding fed to HPKE as `info` *and* to the AEAD as
    /// associated data — the same bytes serve both roles, by the wire
    /// contract this type implements (ADR-0123 A4/B3).
    ///
    /// Goes through [`unambiguous_encoding`], the same anti-collision encoding
    /// [`crate::kdf::derive_channel_key`]'s `info` string and
    /// [`crate::seal::SealAad::encode`]'s associated data both use, for the
    /// identical reason: eight components concatenated naively can collide
    /// across a field boundary (`account_id="a", harbor_id="bc"` vs.
    /// `account_id="ab", harbor_id="c"`), and a length-prefixed, separator-free
    /// encoding cannot.
    ///
    /// # Errors
    ///
    /// [`VaultError::EmptyComponent`] if any of `account_id`, `harbor_id`,
    /// `recipient_device_id`, `grant`, `key_purpose`, or `key_id` is empty — an
    /// empty id binds nothing, turning that field's binding into a no-op.
    /// [`VaultError::ComponentTooLong`] if a component overflows the
    /// encoding's 32-bit length field.
    ///
    /// # Examples
    ///
    /// ```
    /// use pd_vault::KeyWrapAad;
    ///
    /// let here = KeyWrapAad {
    ///     account_id: "acct-1",
    ///     harbor_id: "harbor-1",
    ///     authority_epoch: 1,
    ///     recipient_device_id: "device-1",
    ///     grant: "use",
    ///     key_purpose: "channel",
    ///     key_id: "harbor/alpha",
    /// };
    /// let relabelled = KeyWrapAad { grant: "manage", ..here };
    /// assert_ne!(here.encode()?, relabelled.encode()?);
    /// # Ok::<(), pd_vault::VaultError>(())
    /// ```
    pub fn encode(&self) -> Result<Vec<u8>, VaultError> {
        for (field, value) in [
            ("account id", self.account_id),
            ("harbor id", self.harbor_id),
            ("recipient device id", self.recipient_device_id),
            ("grant", self.grant),
            ("key purpose", self.key_purpose),
            ("key id", self.key_id),
        ] {
            if value.is_empty() {
                return Err(VaultError::EmptyComponent { field });
            }
        }

        unambiguous_encoding(&[
            KEY_WRAP_AAD_LABEL,
            self.account_id.as_bytes(),
            self.harbor_id.as_bytes(),
            &self.authority_epoch.to_be_bytes(),
            self.recipient_device_id.as_bytes(),
            self.grant.as_bytes(),
            self.key_purpose.as_bytes(),
            self.key_id.as_bytes(),
        ])
    }
}

/// A [`ChannelKey`] sealed to one recipient device via HPKE base mode.
///
/// `enc` is the sender's one-time ephemeral X25519 public key — RFC 9180
/// §7.1.1's `SerializePublicKey`, which for X25519 is the identity function,
/// so this is the raw 32-byte public key with no framing. `ciphertext` is the
/// AES-256-GCM output, tag appended, exactly the layout
/// [`crate::seal::seal`] already produces for its own AEAD.
///
/// Both fields are `pub`: a `WrappedKey` is safe to serialize and hand to the
/// relay, because it never contains a usable key. The 32 bytes inside
/// `ciphertext` become a [`ChannelKey`] only for the one holder of the
/// matching [`DeviceKemSecret`], via [`unwrap_channel_key_for_device`] — this
/// struct being public does not reopen the custody law any more than
/// [`crate::seal::seal`]'s `Vec<u8>` return value does.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WrappedKey {
    /// The sender's ephemeral X25519 public key (RFC 9180's `enc`).
    pub enc: [u8; 32],
    /// AES-256-GCM ciphertext with the 16-byte tag appended.
    pub ciphertext: Vec<u8>,
}

// -----------------------------------------------------------------------
// RFC 9180 §4 LabeledExtract / LabeledExpand
// -----------------------------------------------------------------------

/// RFC 9180 §4 `LabeledExtract`: `Extract(salt, "HPKE-v1" || suite_id ||
/// label || ikm)`.
///
/// Returns both the raw PRK bytes (needed by callers that fold the PRK
/// directly into another structure, e.g. `key_schedule_context`'s
/// `psk_id_hash` / `info_hash`) and an `Hkdf` handle already keyed by that PRK
/// and ready for [`labeled_expand`] — reusing the handle for multiple expands
/// under one extract (as `KeySchedule` does for `key`, `base_nonce`, and
/// `exp`) needs no second `HKDF-Extract` call.
fn labeled_extract(
    salt: &[u8],
    suite_id: &[u8],
    label: &[u8],
    ikm: &[u8],
) -> ([u8; 32], Hkdf<Sha256>) {
    let labeled_ikm = [HPKE_V1, suite_id, label, ikm].concat();
    let (prk, hkdf) = Hkdf::<Sha256>::extract(Some(salt), &labeled_ikm);
    let mut prk_bytes = [0u8; 32];
    prk_bytes.copy_from_slice(&prk);
    (prk_bytes, hkdf)
}

/// RFC 9180 §4 `LabeledExpand`: `Expand(prk, I2OSP(L, 2) || "HPKE-v1" ||
/// suite_id || label || info, L)`.
///
/// Takes the `Hkdf` handle [`labeled_extract`] already produced rather than
/// raw PRK bytes, so a `KeySchedule` that expands the same `secret` three
/// times (`key`, `base_nonce`, `exp`) keys the underlying HMAC once.
///
/// # Errors
///
/// [`VaultError::Derive`] if `out.len()` does not fit in RFC 9180's 2-byte `L`
/// field, or if HKDF-Expand itself refuses the length (unreachable for the
/// fixed 12/32-byte outputs this module requests, since HKDF-SHA256 supports
/// up to `255 * 32` bytes).
fn labeled_expand(
    hkdf: &Hkdf<Sha256>,
    suite_id: &[u8],
    label: &[u8],
    info: &[u8],
    out: &mut [u8],
) -> Result<(), VaultError> {
    let len = u16::try_from(out.len()).map_err(|_| VaultError::Derive)?;
    let labeled_info = [&len.to_be_bytes()[..], HPKE_V1, suite_id, label, info].concat();
    hkdf.expand(&labeled_info, out)
        .map_err(|_| VaultError::Derive)
}

// -----------------------------------------------------------------------
// RFC 9180 §4.1 DHKEM(X25519, HKDF-SHA256)
// -----------------------------------------------------------------------

/// RFC 9180 §4.1 `ExtractAndExpand`: turns a raw X25519 Diffie-Hellman output
/// plus the KEM context (`enc || pkRm`) into the KEM's shared secret.
///
/// A pure function of `dh` and `kem_context`. Both [`encap_with`] and
/// [`decap`] compute the *same* `dh` (one X25519 scalar multiplication, two
/// different ways to reach the same product) and the *same* `kem_context`
/// (`enc` travels on the wire; `pkRm` is derivable by both sides — the sender
/// already has it as its addressing target, the recipient re-serializes its
/// own public key), so this always agrees between a matched Encap/Decap pair
/// without either side coordinating beyond the DH itself.
fn extract_and_expand(dh: &[u8; 32], kem_context: &[u8]) -> Result<[u8; 32], VaultError> {
    let (_eae_prk, hkdf) = labeled_extract(b"", &KEM_SUITE_ID, b"eae_prk", dh);
    let mut shared_secret = [0u8; 32];
    labeled_expand(
        &hkdf,
        &KEM_SUITE_ID,
        b"shared_secret",
        kem_context,
        &mut shared_secret,
    )?;
    Ok(shared_secret)
}

/// RFC 9180 §4.1 `Encap`, deterministic core: given the sender's ephemeral
/// secret rather than drawing one.
///
/// Exists so `tests::rfc9180_official_vector` can pin the ephemeral secret to
/// the RFC's `skEm` and reproduce its `enc` / `shared_secret` exactly.
/// [`encap`] — the only path production code reaches — draws `ske` fresh from
/// the OS CSPRNG on every call and is the sole way anything outside this test
/// module can supply one; there is no public or `pub(crate)` way to pin it.
fn encap_with(
    ske: &StaticSecret,
    recipient_public: &X25519PublicKey,
) -> Result<([u8; 32], [u8; 32]), VaultError> {
    // SerializePublicKey is the identity function for X25519 (RFC 9180
    // §7.1.1): `enc` is simply the raw 32-byte ephemeral public key.
    let enc = XPublicKey::from(ske).to_bytes();
    let dh = keys::raw_diffie_hellman(ske, recipient_public)?;

    let mut kem_context = Vec::with_capacity(64);
    kem_context.extend_from_slice(&enc);
    kem_context.extend_from_slice(&recipient_public.to_bytes());

    let shared_secret = extract_and_expand(dh.as_bytes(), &kem_context)?;
    Ok((shared_secret, enc))
}

/// RFC 9180 §4.1 `Encap`: generate a fresh one-time X25519 keypair, agree with
/// the recipient's public key, and derive the KEM shared secret.
///
/// The ephemeral secret is drawn straight from the OS CSPRNG and used exactly
/// once — this is RFC 9180's own `GenerateKeyPair() can be implemented as
/// DeriveKeyPair(random(Nsk))` note, taken at its simplest: X25519 scalar
/// multiplication clamps internally (`curve25519-dalek`'s
/// `mul_base_clamped` / `mul_clamped`, underneath [`StaticSecret`]), so 32
/// random bytes are already a valid private key with no separate
/// `DeriveKeyPair` HKDF step needed. Zeroized immediately after use — nothing
/// outside this function ever sees the ephemeral scalar, and nothing needs to:
/// it is discarded the moment its one Diffie-Hellman is computed.
///
/// # Errors
///
/// [`VaultError::Rng`] if the OS entropy source is unavailable, or
/// [`VaultError::InvalidKey`] if `recipient_public` is a non-contributory
/// (degenerate) point — see [`crate::keys::raw_diffie_hellman`]. Both are the
/// sender's own precondition failures, not something an attacker who only
/// controls the wire can trigger, so both are reported plainly rather than
/// folded into [`VaultError::Decrypt`] (contrast [`decap`], called from
/// [`unwrap_channel_key_for_device`], where the *recipient* is on the
/// receiving end of a possibly-adversarial `enc`).
fn encap(recipient_public: &X25519PublicKey) -> Result<([u8; 32], [u8; 32]), VaultError> {
    let mut ske_bytes = [0u8; 32];
    getrandom::getrandom(&mut ske_bytes).map_err(|e| VaultError::Rng(e.to_string()))?;
    let ske = StaticSecret::from(ske_bytes);
    ske_bytes.zeroize();

    encap_with(&ske, recipient_public)
}

/// RFC 9180 §4.1 `Decap`: recover the KEM shared secret from `enc` and the
/// recipient's own static secret.
///
/// `DeserializePublicKey(enc)` is likewise the identity function for X25519
/// (RFC 9180 §7.1.1) — a bare 32-byte parse, [`X25519PublicKey::from_bytes`],
/// nothing to reject. Every 32-byte string is a syntactically valid Montgomery
/// u-coordinate, so a tampered `enc` never fails to parse; it fails later,
/// either as a non-contributory agreement ([`VaultError::InvalidKey`], from
/// [`crate::keys::raw_diffie_hellman`]) or — the overwhelmingly likely
/// outcome for an arbitrary bit flip — as a `shared_secret` that derives the
/// wrong `key` and fails the AEAD tag. [`unwrap_channel_key_for_device`]
/// collapses both into [`VaultError::Decrypt`]; see the module docs.
fn decap(enc: &[u8; 32], recipient_secret: &DeviceKemSecret) -> Result<[u8; 32], VaultError> {
    let peer_public = X25519PublicKey::from_bytes(*enc);
    let dh = recipient_secret.diffie_hellman(&peer_public)?;

    let mut kem_context = Vec::with_capacity(64);
    kem_context.extend_from_slice(enc);
    kem_context.extend_from_slice(&recipient_secret.public().to_bytes());

    extract_and_expand(dh.as_bytes(), &kem_context)
}

// -----------------------------------------------------------------------
// RFC 9180 §5.1 KeySchedule, base mode
// -----------------------------------------------------------------------

/// RFC 9180 §5.1 `key_schedule_context = concat(mode, psk_id_hash,
/// info_hash)`, specialized to base mode (`mode = 0x00`, `psk_id =
/// default_psk_id = ""`).
///
/// A 1 + 32 + 32 = 65-byte string for HKDF-SHA256's `Nh = 32`. Split out from
/// [`key_schedule_base`] so `tests::rfc9180_official_vector` can assert it
/// against the RFC vector's own `key_schedule_context` field directly — an
/// intermediate value the vector publishes precisely so implementations can
/// pinpoint which half of `KeySchedule` disagrees, rather than only ever
/// comparing the final `key` / `base_nonce`.
fn key_schedule_context(info: &[u8]) -> [u8; 65] {
    // Base mode's `default_psk_id` is the empty string, so `psk_id_hash` here
    // is a fixed value for every base-mode call — not a shortcut this module
    // takes, but exactly what RFC 9180's own pseudocode computes when `psk_id
    // = ""`.
    let (psk_id_hash, _) = labeled_extract(b"", &HPKE_SUITE_ID, b"psk_id_hash", b"");
    let (info_hash, _) = labeled_extract(b"", &HPKE_SUITE_ID, b"info_hash", info);

    let mut context = [0u8; 65];
    context[0] = MODE_BASE;
    context[1..33].copy_from_slice(&psk_id_hash);
    context[33..65].copy_from_slice(&info_hash);
    context
}

/// The two values a single-shot HPKE context needs: the AEAD key and the
/// nonce for message index 0.
///
/// RFC 9180's `Context` also carries `seq` and an `exporter_secret`. Neither
/// is here: `seq` is always `0` for the reasons the module docs give (one
/// `Seal` or one `Open` per wrap, never more), so `base_nonce` alone — never
/// XORed against anything — is already `ComputeNonce(0)`; and no caller in
/// this crate ever calls `Context.Export`, so carrying `exporter_secret` past
/// the point it is derived would only be one more copy of key material to
/// zeroize for a value nothing reads. `tests::rfc9180_official_vector` still
/// derives and checks it, directly, to validate [`labeled_expand`] against
/// every output the RFC vector publishes.
struct Context {
    /// The AES-256-GCM key (RFC 9180 `Nk = 32` for aead_id `0x0002`).
    key: [u8; 32],
    /// The nonce for message index 0 (RFC 9180 `Nn = 12` for AES-256-GCM),
    /// i.e. `base_nonce` itself — see the struct docs for why no XOR is ever
    /// applied.
    base_nonce: [u8; 12],
}

impl Drop for Context {
    fn drop(&mut self) {
        self.key.zeroize();
    }
}

/// RFC 9180 §5.1 `KeySchedule`, specialized to base mode: `key =
/// LabeledExpand(secret, "key", key_schedule_context, Nk)`, `base_nonce =
/// LabeledExpand(secret, "base_nonce", key_schedule_context, Nn)`, where
/// `secret = LabeledExtract(shared_secret, "secret", default_psk)`.
///
/// `VerifyPSKInputs` (RFC 9180 §5.1) is not implemented: with `psk` and
/// `psk_id` both hardcoded to `default_psk = ""` and never taken as
/// parameters, every precondition it checks holds by construction, and there
/// is no PSK-mode call site anywhere in this crate for it to guard.
///
/// # Errors
///
/// [`VaultError::Derive`] only — see [`labeled_expand`]; unreachable in
/// practice for these fixed output lengths.
fn key_schedule_base(shared_secret: &[u8; 32], info: &[u8]) -> Result<Context, VaultError> {
    let context = key_schedule_context(info);

    // Base mode's `default_psk` is the empty string.
    let (_secret_prk, hkdf) = labeled_extract(shared_secret, &HPKE_SUITE_ID, b"secret", b"");

    let mut key = [0u8; 32];
    labeled_expand(&hkdf, &HPKE_SUITE_ID, b"key", &context, &mut key)?;

    let mut base_nonce = [0u8; 12];
    labeled_expand(
        &hkdf,
        &HPKE_SUITE_ID,
        b"base_nonce",
        &context,
        &mut base_nonce,
    )?;

    Ok(Context { key, base_nonce })
}

// -----------------------------------------------------------------------
// RFC 9180 §5.2 / §6.1 Seal / Open, single-shot (seq always 0)
// -----------------------------------------------------------------------

fn aes_key(ctx: &Context) -> &AesKey<Aes256Gcm> {
    AesKey::<Aes256Gcm>::from_slice(&ctx.key)
}

fn aes_nonce(ctx: &Context) -> &AesGcmNonce<<Aes256Gcm as AeadCore>::NonceSize> {
    AesGcmNonce::<<Aes256Gcm as AeadCore>::NonceSize>::from_slice(&ctx.base_nonce)
}

/// `ContextS.Seal(aad, pt)` at `seq = 0`: AES-256-GCM under `ctx.key` and
/// `ctx.base_nonce`, exactly (RFC 9180 §5.2's `ComputeNonce(0) = base_nonce`).
///
/// # Errors
///
/// [`VaultError::Seal`] if the AEAD refuses the message (message-length
/// overflow — unreachable for a 32-byte [`ChannelKey`]).
fn context_seal(ctx: &Context, aad: &[u8], plaintext: &[u8]) -> Result<Vec<u8>, VaultError> {
    let cipher = Aes256Gcm::new(aes_key(ctx));
    cipher
        .encrypt(
            aes_nonce(ctx),
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| VaultError::Seal)
}

/// `ContextR.Open(aad, ct)` at `seq = 0`. Fails closed, opaquely — see
/// [`unwrap_channel_key_for_device`], which is the only caller and the one
/// that owns collapsing every failure this function and everything upstream
/// of it can produce into one [`VaultError::Decrypt`].
fn context_open(ctx: &Context, aad: &[u8], ciphertext: &[u8]) -> Result<Vec<u8>, VaultError> {
    if ciphertext.len() < AEAD_TAG_LEN {
        return Err(VaultError::Decrypt);
    }
    let cipher = Aes256Gcm::new(aes_key(ctx));
    cipher
        .decrypt(
            aes_nonce(ctx),
            Payload {
                msg: ciphertext,
                aad,
            },
        )
        .map_err(|_| VaultError::Decrypt)
}

// -----------------------------------------------------------------------
// Public surface
// -----------------------------------------------------------------------

/// Seal a [`ChannelKey`] to one recipient device's X25519 public key.
///
/// This is the one place outside [`mod@crate::seal`] allowed to read a
/// `ChannelKey`'s raw bytes ([`ChannelKey::as_bytes`] is `pub(crate)`), and the
/// custody law holds anyway: those bytes never leave this function as
/// plaintext. They leave only inside `WrappedKey.ciphertext`, an AES-256-GCM
/// envelope addressed — via HPKE's key agreement — to exactly one recipient's
/// public key.
///
/// `aad.encode()` is used *twice*: once as HPKE's `info` (personalizes the KDF
/// context) and once as the AEAD's associated data (authenticates every field
/// into the tag). Both roles get the identical bytes, by the wire contract
/// this function implements — see [`KeyWrapAad`]'s docs for why the relay
/// needs to read these fields in cleartext without being able to move them.
///
/// # Errors
///
/// - [`VaultError::EmptyComponent`] / [`VaultError::ComponentTooLong`] if
///   `aad` cannot be encoded — see [`KeyWrapAad::encode`].
/// - [`VaultError::Rng`] if the OS entropy source is unavailable for the fresh
///   ephemeral keypair.
/// - [`VaultError::InvalidKey`] if `recipient_pubkey` is a non-contributory
///   (degenerate) point.
/// - [`VaultError::Seal`] if the AEAD refuses the message (unreachable for a
///   32-byte key).
///
/// # Examples
///
/// ```
/// use pd_vault::{
///     derive_channel_key, unwrap_channel_key_for_device, wrap_channel_key_for_device,
///     DeviceKemSecret, KeyWrapAad,
/// };
///
/// let key = derive_channel_key(&[0x11u8; 32], "harbor/alpha", 4)?;
/// let device = DeviceKemSecret::generate()?;
/// let aad = KeyWrapAad {
///     account_id: "acct-1",
///     harbor_id: "harbor-1",
///     authority_epoch: 4,
///     recipient_device_id: "device-1",
///     grant: "use",
///     key_purpose: "channel",
///     key_id: "harbor/alpha",
/// };
///
/// let wrapped = wrap_channel_key_for_device(&key, &device.public(), &aad)?;
/// let recovered = unwrap_channel_key_for_device(&wrapped, &device, &aad)?;
/// assert_eq!(key, recovered);
/// # Ok::<(), pd_vault::VaultError>(())
/// ```
pub fn wrap_channel_key_for_device(
    key: &ChannelKey,
    recipient_pubkey: &X25519PublicKey,
    aad: &KeyWrapAad<'_>,
) -> Result<WrappedKey, VaultError> {
    let info_and_aad = aad.encode()?;

    let (mut shared_secret, enc) = encap(recipient_pubkey)?;
    let ctx = key_schedule_base(&shared_secret, &info_and_aad)?;
    shared_secret.zeroize();

    let ciphertext = context_seal(&ctx, &info_and_aad, key.as_bytes())?;
    Ok(WrappedKey { enc, ciphertext })
}

/// Open a [`WrappedKey`] produced by [`wrap_channel_key_for_device`], or fail.
///
/// Succeeds only when `recipient_secret` is the X25519 secret matching the
/// public key the envelope was wrapped to, `wrapped.enc` and
/// `wrapped.ciphertext` are exactly what sealing produced, and every field of
/// `aad` matches what was used to wrap. Recovers the 32 raw key bytes into a
/// stack buffer and hands them to [`ChannelKey::from_bytes`] immediately,
/// zeroizing the AEAD's plaintext `Vec` afterward — the same
/// derive-then-zeroize-the-intermediate-buffer pattern
/// [`crate::derive_channel_key`] ends on.
///
/// # Errors
///
/// [`VaultError::Decrypt`] for every cryptographic failure below the AAD
/// encoding step — see the module docs' "Failure is opaque here too" section.
/// [`VaultError::EmptyComponent`] / [`VaultError::ComponentTooLong`] if `aad`
/// itself cannot be encoded — a mistake in the caller's own arguments, not an
/// attacker-controlled input, so it is still reported plainly (same split as
/// [`crate::seal::open`]).
///
/// # Examples
///
/// ```
/// use pd_vault::{
///     derive_channel_key, unwrap_channel_key_for_device, wrap_channel_key_for_device,
///     DeviceKemSecret, KeyWrapAad, VaultError,
/// };
///
/// let key = derive_channel_key(&[0x22u8; 32], "ops", 2)?;
/// let device = DeviceKemSecret::generate()?;
/// let stranger = DeviceKemSecret::generate()?;
/// let aad = KeyWrapAad {
///     account_id: "acct-1",
///     harbor_id: "harbor-1",
///     authority_epoch: 2,
///     recipient_device_id: "device-1",
///     grant: "use",
///     key_purpose: "channel",
///     key_id: "ops",
/// };
///
/// let wrapped = wrap_channel_key_for_device(&key, &device.public(), &aad)?;
///
/// // The device it was actually wrapped to recovers it...
/// assert_eq!(unwrap_channel_key_for_device(&wrapped, &device, &aad)?, key);
/// // ...a different device's secret does not.
/// assert!(matches!(
///     unwrap_channel_key_for_device(&wrapped, &stranger, &aad),
///     Err(VaultError::Decrypt)
/// ));
/// # Ok::<(), pd_vault::VaultError>(())
/// ```
pub fn unwrap_channel_key_for_device(
    wrapped: &WrappedKey,
    recipient_secret: &DeviceKemSecret,
    aad: &KeyWrapAad<'_>,
) -> Result<ChannelKey, VaultError> {
    let info_and_aad = aad.encode()?;
    open_wrapped(wrapped, recipient_secret, &info_and_aad).map_err(|_| VaultError::Decrypt)
}

/// The cryptographic core of [`unwrap_channel_key_for_device`], kept as a
/// separate function so the public entry point can collapse every error this
/// one produces — a non-contributory `enc`, a `KeySchedule` derive failure, a
/// bad AEAD tag, a wrong-length plaintext — into the single opaque
/// [`VaultError::Decrypt`] the module docs describe, with `map_err` at exactly
/// one call site rather than scattered through the pipeline.
fn open_wrapped(
    wrapped: &WrappedKey,
    recipient_secret: &DeviceKemSecret,
    info_and_aad: &[u8],
) -> Result<ChannelKey, VaultError> {
    let mut shared_secret = decap(&wrapped.enc, recipient_secret)?;
    let ctx = key_schedule_base(&shared_secret, info_and_aad)?;
    shared_secret.zeroize();

    let mut plaintext = context_open(&ctx, info_and_aad, &wrapped.ciphertext)?;
    if plaintext.len() != CHANNEL_KEY_LEN {
        // A genuine wrap never produces any length but CHANNEL_KEY_LEN; this
        // only fires for ciphertext that forged a valid tag over the wrong
        // plaintext length, which the tag check above already makes
        // astronomically unlikely. Reported the same as any other failure
        // here, not specially — see `open_wrapped`'s caller.
        plaintext.zeroize();
        return Err(VaultError::Decrypt);
    }

    let mut key_bytes = [0u8; CHANNEL_KEY_LEN];
    key_bytes.copy_from_slice(&plaintext);
    plaintext.zeroize();

    // `ChannelKey::from_bytes` zeroizes `key_bytes` in place, so the recovered
    // key does not outlive this frame outside the returned `ChannelKey`.
    Ok(ChannelKey::from_bytes(&mut key_bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::derive_channel_key;

    // =======================================================================
    // RFC 9180 official test vector — DHKEM / LabeledExtract / LabeledExpand
    // / KeySchedule / Seal, base mode, kem_id=0x0020, kdf_id=0x0001,
    // aead_id=0x0002.
    //
    // Provenance: this exact 5-tuple (mode=base, X25519+HKDF-SHA256+AES-256-
    // GCM) is not one of the 7 ciphersuite combinations RFC 9180's own
    // Appendix A prints inline. It IS present in the IRTF CFRG working
    // group's reference test-vectors.json — the file the RFC's own Appendix A
    // vectors are mechanically generated from, and the file every major HPKE
    // implementation (Cloudflare CIRCL, hpke-js, hpke-rs, BoringSSL) uses for
    // interop conformance — fetched directly from
    // https://raw.githubusercontent.com/cfrg/draft-irtf-cfrg-hpke/master/test-vectors.json
    // (rfc-editor.org / datatracker.ietf.org / ietf.org are unreachable from
    // this crate's build sandbox), entry index 4 of 128, filtered by
    // mode==0 && kem_id==32 && kdf_id==1 && aead_id==2. The hex constants
    // below were extracted from that file programmatically (parsed as JSON,
    // never hand-transcribed into this source) to rule out the exact
    // transcription error a human copying 32-byte hex strings by hand is
    // prone to.
    //
    // What this test independently confirms, not merely quotes: `enc` /
    // `shared_secret` (a REAL X25519 elliptic-curve Diffie-Hellman via
    // `encap_with` / `decap`, not a mocked DH), `key_schedule_context`,
    // `secret`, `key`, `base_nonce`, and `exporter_secret` (this crate's own
    // from-scratch `LabeledExtract` / `LabeledExpand` over HKDF-SHA256), and —
    // closing the one gap RFC 9180's reference vectors leave for a from-
    // scratch implementation to prove for itself — the AES-256-GCM
    // ciphertext for encryption index 0, via this module's own `context_seal`
    // / `context_open`.
    // =======================================================================

    const RFC_INFO_HEX: &str = "4f6465206f6e2061204772656369616e2055726e";
    const RFC_SKE_M_HEX: &str = "179d4b53b6365c45b600c4163b61d95cbc2f4d9e36f1695558dce265ab8bab11";
    const RFC_PKE_M_HEX: &str = "6c93e09869df3402d7bf231bf540fadd35cd56be14f97178f0954db94b7fc256";
    const RFC_SKR_M_HEX: &str = "497b4502664cfea5d5af0b39934dac72242a74f8480451e1aee7d6a53320333d";
    const RFC_PKR_M_HEX: &str = "430f4b9859665145a6b1ba274024487bd66f03a2dd577d7753c68d7d7d00c00c";
    const RFC_ENC_HEX: &str = "6c93e09869df3402d7bf231bf540fadd35cd56be14f97178f0954db94b7fc256";
    const RFC_SHARED_SECRET_HEX: &str =
        "3101c54c3a4f87439eaac080699ed9bbcc726ffe44e860c0424ccb7e3e2ead7b";
    const RFC_KEY_SCHEDULE_CONTEXT_HEX: &str = "004ce5472ecdd5093ba0aecb8f871ff13f1fbc90ee76f0e18\
         ace1a1b7e565bafa306f6ef962c9ee7cea40407b5d60f0f26990472faae3ac44c78366f1cac1ecde1";
    const RFC_SECRET_HEX: &str = "2058ac9b02c1f52c1aaf08bedbec9198219751a94ef67b7d5f0c8b6e2b54ebfb";
    const RFC_KEY_HEX: &str = "f50b0609186798729ed0564b36ef2ef8044f1f9d05636874d1f46c819c7a669f";
    const RFC_BASE_NONCE_HEX: &str = "151d9929e2449747889bc923";
    const RFC_EXPORTER_SECRET_HEX: &str =
        "86017151bbff6a1940e8abae2ac9e0e7032e33df1eaaecc02ca6259b130d62df";

    // encryptions[0]: seq=0, nonce == base_nonce unmodified.
    const RFC_AAD_0_HEX: &str = "436f756e742d30";
    const RFC_PT_0_HEX: &str = "4265617574792069732074727574682c20747275746820626561757479";
    const RFC_CT_0_HEX: &str = "e5d84cd531cfb583096e7cfa9641bd3079cf3a91cda813c52deb5f512be9931\
         980a41de125a925cdad859d5b7a";

    fn hex32(s: &str) -> [u8; 32] {
        let bytes = hex::decode(s).unwrap();
        bytes.try_into().unwrap()
    }

    #[test]
    fn rfc9180_official_vector() {
        let info = hex::decode(RFC_INFO_HEX).unwrap();
        let ske = StaticSecret::from(hex32(RFC_SKE_M_HEX));
        let mut skr_bytes = hex32(RFC_SKR_M_HEX);
        let recipient = DeviceKemSecret::from_bytes(&mut skr_bytes);

        // --- Encap, sender side: real X25519 DH, not a stand-in. ---
        let (shared_secret, enc) = encap_with(&ske, &recipient.public()).unwrap();
        assert_eq!(hex::encode(enc), RFC_ENC_HEX, "enc must equal pkEm");
        assert_eq!(
            hex::encode(enc),
            RFC_PKE_M_HEX,
            "enc must equal the vector's pkEm"
        );
        assert_eq!(hex::encode(shared_secret), RFC_SHARED_SECRET_HEX);

        // --- Decap, recipient side: independently reaches the same secret. ---
        let decapped = decap(&enc, &recipient).unwrap();
        assert_eq!(hex::encode(decapped), RFC_SHARED_SECRET_HEX);
        assert_eq!(recipient.public().to_hex(), RFC_PKR_M_HEX);

        // --- KeySchedule: intermediate values, not just the final key. ---
        let context = key_schedule_context(&info);
        assert_eq!(hex::encode(context), RFC_KEY_SCHEDULE_CONTEXT_HEX);

        let (secret_prk, hkdf) = labeled_extract(&shared_secret, &HPKE_SUITE_ID, b"secret", b"");
        assert_eq!(hex::encode(secret_prk), RFC_SECRET_HEX);

        let mut exporter_secret = [0u8; 32];
        labeled_expand(
            &hkdf,
            &HPKE_SUITE_ID,
            b"exp",
            &context,
            &mut exporter_secret,
        )
        .unwrap();
        assert_eq!(hex::encode(exporter_secret), RFC_EXPORTER_SECRET_HEX);

        let ctx = key_schedule_base(&shared_secret, &info).unwrap();
        assert_eq!(hex::encode(ctx.key), RFC_KEY_HEX);
        assert_eq!(hex::encode(ctx.base_nonce), RFC_BASE_NONCE_HEX);

        // --- Seal / Open, encryption index 0 (seq=0): this module's own
        // AES-256-GCM call against the RFC's published ciphertext. This is
        // the one link the spec pass for this task flagged as not
        // independently re-run (no working AEAD tool in that sandbox); this
        // test is that conformance check. ---
        let aad = hex::decode(RFC_AAD_0_HEX).unwrap();
        let pt = hex::decode(RFC_PT_0_HEX).unwrap();
        let ct = context_seal(&ctx, &aad, &pt).unwrap();
        assert_eq!(hex::encode(&ct), RFC_CT_0_HEX);
        assert_eq!(context_open(&ctx, &aad, &ct).unwrap(), pt);
    }

    // ---------------------------------------------------------------------
    // Known-answer vector, wrap/unwrap — SELF-GENERATED.
    //
    // Provenance, stated plainly (same words as every other KAT in this
    // crate): these bytes came out of THIS implementation and were pasted
    // back in. They are NOT RFC vectors, NOT from an official test suite, and
    // NOT from any shipping third-party implementation — the RFC 9180 vector
    // above already covers that ground for the primitives underneath. What
    // this KAT pins is `wrap_channel_key_for_device` /
    // `unwrap_channel_key_for_device` specifically: the `KeyWrapAad` encoding,
    // its double use as `info` and `aad`, and the full wrap pipeline
    // end-to-end, against regression in this crate and against drift from the
    // TS twin (lib/pd-vault-ts.ts) that asserts the same constants.
    // ---------------------------------------------------------------------

    const WRAP_KAT_CHANNEL_KEY_HEX: &str =
        "eecdca153c0521429707dd6ed523314c6faff8060928b731738214cef69b4c35";
    const WRAP_KAT_SKE_HEX: &str =
        "0101010101010101010101010101010101010101010101010101010101010101";
    const WRAP_KAT_SKR_HEX: &str =
        "0202020202020202020202020202020202020202020202020202020202020202";

    // `hex32` panics loudly on a length mismatch rather than silently
    // truncating, so a mistyped constant above fails this test immediately
    // instead of quietly deriving a different, wrong "known" answer.

    fn wrap_kat_key() -> ChannelKey {
        let mut bytes = hex32(WRAP_KAT_CHANNEL_KEY_HEX);
        ChannelKey::from_bytes(&mut bytes)
    }

    fn wrap_kat_device() -> DeviceKemSecret {
        let mut bytes = hex32(WRAP_KAT_SKR_HEX);
        DeviceKemSecret::from_bytes(&mut bytes)
    }

    fn wrap_kat_aad() -> KeyWrapAad<'static> {
        KeyWrapAad {
            account_id: "acct-kat",
            harbor_id: "harbor-kat",
            authority_epoch: 7,
            recipient_device_id: "device-kat",
            grant: "use",
            key_purpose: "channel",
            key_id: "harbor/alpha",
        }
    }

    // Byte-for-byte layout pin, same spirit as lib.rs's
    // `encoding_layout_is_stable`: component count (8), then (len || bytes)
    // per component in KeyWrapAad field order — label, account_id, harbor_id,
    // authority_epoch (fixed-width u64 BE, not length-prefixed text),
    // recipient_device_id, grant, key_purpose, key_id.
    const WRAP_KAT_AAD_HEX: &str =
        "000000080000001370642d7661756c742f6b6579777261702f76310000000861\
         6363742d6b61740000000a686172626f722d6b6174000000080000000000000007\
         0000000a6465766963652d6b617400000003757365000000076368616e6e656c00\
         00000c686172626f722f616c706861";

    // Filled in from this implementation's own output (see hpke.rs's module
    // docs on provenance) — a fixed ephemeral secret makes `encap_with`
    // deterministic, so `enc` and `ciphertext` here are stable across runs.
    const WRAP_KAT_ENC_HEX: &str =
        "a4e09292b651c278b9772c569f5fa9bb13d906b46ab68c9df9dc2b4409f8a209";
    const WRAP_KAT_CIPHERTEXT_HEX: &str = "a80babcec0b2cea3e013d52667bd621d1c7c7024e6dd46b968c2e0554caf8f67f73b8d4d7798247a063507c276ce911f";

    #[test]
    fn wrap_kat_is_stable() {
        let ske = StaticSecret::from(hex32(WRAP_KAT_SKE_HEX));
        let device = wrap_kat_device();
        let key = wrap_kat_key();
        let aad = wrap_kat_aad();

        assert_eq!(hex::encode(aad.encode().unwrap()), WRAP_KAT_AAD_HEX);

        let (mut shared_secret, enc) = encap_with(&ske, &device.public()).unwrap();
        let info_and_aad = aad.encode().unwrap();
        let ctx = key_schedule_base(&shared_secret, &info_and_aad).unwrap();
        shared_secret.zeroize();
        let ciphertext = context_seal(&ctx, &info_and_aad, key.as_bytes()).unwrap();

        assert_eq!(hex::encode(enc), WRAP_KAT_ENC_HEX);
        assert_eq!(hex::encode(&ciphertext), WRAP_KAT_CIPHERTEXT_HEX);

        let wrapped = WrappedKey { enc, ciphertext };
        let recovered = open_wrapped(&wrapped, &device, &info_and_aad).unwrap();
        assert_eq!(recovered, key);

        // And the public entry points agree with the low-level pieces above.
        let via_public_api = wrap_channel_key_for_device(&key, &device.public(), &aad).unwrap();
        assert_eq!(
            unwrap_channel_key_for_device(&via_public_api, &device, &aad).unwrap(),
            key
        );
    }

    // --- negative tests: every one of these must fail closed, opaquely -----

    #[test]
    fn wrong_recipient_key_fails_to_open() {
        let device = wrap_kat_device();
        let stranger = DeviceKemSecret::from_bytes(&mut [0x99u8; 32]);
        let key = wrap_kat_key();
        let aad = wrap_kat_aad();

        let wrapped = wrap_channel_key_for_device(&key, &device.public(), &aad).unwrap();
        assert!(matches!(
            unwrap_channel_key_for_device(&wrapped, &stranger, &aad),
            Err(VaultError::Decrypt)
        ));
    }

    #[test]
    fn tampered_enc_fails_to_open() {
        let device = wrap_kat_device();
        let key = wrap_kat_key();
        let aad = wrap_kat_aad();
        let wrapped = wrap_channel_key_for_device(&key, &device.public(), &aad).unwrap();

        for index in 0..wrapped.enc.len() {
            let mut tampered = wrapped.clone();
            tampered.enc[index] ^= 0x01;
            assert!(
                matches!(
                    unwrap_channel_key_for_device(&tampered, &device, &aad),
                    Err(VaultError::Decrypt)
                ),
                "flipping enc byte {index} was accepted"
            );
        }
    }

    #[test]
    fn tampered_ciphertext_fails_at_every_byte() {
        let device = wrap_kat_device();
        let key = wrap_kat_key();
        let aad = wrap_kat_aad();
        let wrapped = wrap_channel_key_for_device(&key, &device.public(), &aad).unwrap();

        for index in 0..wrapped.ciphertext.len() {
            let mut tampered = wrapped.clone();
            tampered.ciphertext[index] ^= 0x01;
            assert!(
                matches!(
                    unwrap_channel_key_for_device(&tampered, &device, &aad),
                    Err(VaultError::Decrypt)
                ),
                "flipping ciphertext byte {index} was accepted"
            );
        }
    }

    #[test]
    fn truncated_ciphertext_fails() {
        let device = wrap_kat_device();
        let key = wrap_kat_key();
        let aad = wrap_kat_aad();
        let wrapped = wrap_channel_key_for_device(&key, &device.public(), &aad).unwrap();

        for cut in [
            0usize,
            1,
            AEAD_TAG_LEN - 1,
            AEAD_TAG_LEN,
            wrapped.ciphertext.len() - 1,
        ] {
            let truncated = WrappedKey {
                enc: wrapped.enc,
                ciphertext: wrapped.ciphertext[..cut].to_vec(),
            };
            assert!(matches!(
                unwrap_channel_key_for_device(&truncated, &device, &aad),
                Err(VaultError::Decrypt)
            ));
        }
    }

    #[test]
    fn every_single_tampered_aad_field_fails_to_open() {
        // ADR-0123 A4/B3: every one of the eight KeyWrapAad components is
        // authenticated into the tag, individually. Relabelling any one of
        // them — with everything else held fixed — must fail to open, the
        // same opaque way a wrong key or a tampered tag does.
        let device = wrap_kat_device();
        let key = wrap_kat_key();
        let aad = wrap_kat_aad();
        let wrapped = wrap_channel_key_for_device(&key, &device.public(), &aad).unwrap();

        let tampered_aads = [
            KeyWrapAad {
                account_id: "acct-kat-evil",
                ..aad
            },
            KeyWrapAad {
                harbor_id: "harbor-kat-evil",
                ..aad
            },
            KeyWrapAad {
                authority_epoch: aad.authority_epoch + 1,
                ..aad
            },
            KeyWrapAad {
                recipient_device_id: "device-kat-evil",
                ..aad
            },
            KeyWrapAad {
                grant: "manage",
                ..aad
            },
            KeyWrapAad {
                key_purpose: "content",
                ..aad
            },
            KeyWrapAad {
                key_id: "harbor/beta",
                ..aad
            },
        ];

        for (index, tampered) in tampered_aads.iter().enumerate() {
            assert!(
                matches!(
                    unwrap_channel_key_for_device(&wrapped, &device, tampered),
                    Err(VaultError::Decrypt)
                ),
                "tampered AAD field at index {index} was accepted: {tampered:?}"
            );
        }
    }

    #[test]
    fn tampered_version_label_fails_to_open() {
        // The label ([`KEY_WRAP_AAD_LABEL`]) is not a `KeyWrapAad` field at
        // all — it is compiled in — so there is no way to construct a
        // `KeyWrapAad` carrying a different one. What this test proves
        // instead: an envelope whose AAD used a *different* label entirely
        // (standing in for a hypothetical older/newer wire version) does not
        // open under this build's label, the same opaque way any other AAD
        // mismatch fails. This is the "version downgrade is a hard failure"
        // property from ADR-0123 §1, demonstrated at the one point a version
        // mismatch could ever surface.
        let device = wrap_kat_device();
        let key = wrap_kat_key();
        let aad = wrap_kat_aad();

        let mut other_version_info_and_aad = unambiguous_encoding(&[
            b"pd-vault/keywrap/v2",
            aad.account_id.as_bytes(),
            aad.harbor_id.as_bytes(),
            &aad.authority_epoch.to_be_bytes(),
            aad.recipient_device_id.as_bytes(),
            aad.grant.as_bytes(),
            aad.key_purpose.as_bytes(),
            aad.key_id.as_bytes(),
        ])
        .unwrap();

        let (mut shared_secret, enc) = encap(&device.public()).unwrap();
        let ctx = key_schedule_base(&shared_secret, &other_version_info_and_aad).unwrap();
        shared_secret.zeroize();
        let ciphertext = context_seal(&ctx, &other_version_info_and_aad, key.as_bytes()).unwrap();
        other_version_info_and_aad.zeroize();

        let wrapped = WrappedKey { enc, ciphertext };
        assert!(matches!(
            unwrap_channel_key_for_device(&wrapped, &device, &aad),
            Err(VaultError::Decrypt)
        ));
    }

    #[test]
    fn every_wrap_failure_is_indistinguishable() {
        // The no-oracle invariant, asserted on the rendered message, mirroring
        // seal.rs's `every_decryption_failure_is_indistinguishable`.
        let device = wrap_kat_device();
        let stranger = DeviceKemSecret::from_bytes(&mut [0x99u8; 32]);
        let key = wrap_kat_key();
        let aad = wrap_kat_aad();
        let wrapped = wrap_channel_key_for_device(&key, &device.public(), &aad).unwrap();

        let mut tampered_ciphertext = wrapped.clone();
        tampered_ciphertext.ciphertext[0] ^= 0x01;

        let mut tampered_enc = wrapped.clone();
        tampered_enc.enc[0] ^= 0x01;

        let failures = [
            unwrap_channel_key_for_device(&wrapped, &stranger, &aad),
            unwrap_channel_key_for_device(&tampered_ciphertext, &device, &aad),
            unwrap_channel_key_for_device(&tampered_enc, &device, &aad),
            unwrap_channel_key_for_device(
                &wrapped,
                &device,
                &KeyWrapAad {
                    grant: "manage",
                    ..aad
                },
            ),
        ];

        let rendered: Vec<String> = failures
            .iter()
            .map(|result| result.as_ref().unwrap_err().to_string())
            .collect();
        assert!(
            rendered
                .iter()
                .all(|message| message == "decryption failed"),
            "a wrap failure path leaked a distinguishing message: {rendered:?}"
        );
    }

    #[test]
    fn key_wrap_aad_rejects_empty_components() {
        let base = wrap_kat_aad();
        let cases: [(&str, KeyWrapAad<'_>); 6] = [
            (
                "account id",
                KeyWrapAad {
                    account_id: "",
                    ..base
                },
            ),
            (
                "harbor id",
                KeyWrapAad {
                    harbor_id: "",
                    ..base
                },
            ),
            (
                "recipient device id",
                KeyWrapAad {
                    recipient_device_id: "",
                    ..base
                },
            ),
            ("grant", KeyWrapAad { grant: "", ..base }),
            (
                "key purpose",
                KeyWrapAad {
                    key_purpose: "",
                    ..base
                },
            ),
            ("key id", KeyWrapAad { key_id: "", ..base }),
        ];
        for (field, case) in cases {
            assert!(
                matches!(case.encode(), Err(VaultError::EmptyComponent { field: f }) if f == field),
                "expected EmptyComponent{{field: {field:?}}}"
            );
        }
    }

    #[test]
    fn key_wrap_aad_field_boundaries_are_unambiguous() {
        // Same anti-collision property as SealAad, exercised across the
        // account/harbor boundary specifically since those are the two
        // leading variable-width string fields.
        let left = KeyWrapAad {
            account_id: "ab",
            harbor_id: "c",
            authority_epoch: 1,
            recipient_device_id: "d",
            grant: "use",
            key_purpose: "channel",
            key_id: "k",
        };
        let right = KeyWrapAad {
            account_id: "a",
            harbor_id: "bc",
            ..left
        };
        assert_ne!(left.encode().unwrap(), right.encode().unwrap());
    }

    #[test]
    fn distinct_channel_keys_wrap_to_distinct_ciphertext() {
        let device = wrap_kat_device();
        let aad = wrap_kat_aad();
        let a = derive_channel_key(&[0x01; 32], "alpha", 1).unwrap();
        let b = derive_channel_key(&[0x02; 32], "alpha", 1).unwrap();

        let wrapped_a = wrap_channel_key_for_device(&a, &device.public(), &aad).unwrap();
        let wrapped_b = wrap_channel_key_for_device(&b, &device.public(), &aad).unwrap();
        assert_ne!(wrapped_a.ciphertext, wrapped_b.ciphertext);

        assert_eq!(
            unwrap_channel_key_for_device(&wrapped_a, &device, &aad).unwrap(),
            a
        );
        assert_eq!(
            unwrap_channel_key_for_device(&wrapped_b, &device, &aad).unwrap(),
            b
        );
    }

    #[test]
    fn distinct_wraps_of_the_same_key_use_distinct_ephemeral_keys() {
        // encap() draws a fresh ephemeral secret every call, so wrapping the
        // same key to the same device twice must not reuse enc — reusing an
        // ephemeral key across encapsulations is exactly the kind of nonce/key
        // reuse crate::seal's docs warn about, just one layer up.
        let device = wrap_kat_device();
        let key = wrap_kat_key();
        let aad = wrap_kat_aad();

        let first = wrap_channel_key_for_device(&key, &device.public(), &aad).unwrap();
        let second = wrap_channel_key_for_device(&key, &device.public(), &aad).unwrap();
        assert_ne!(first.enc, second.enc);
        assert_ne!(first.ciphertext, second.ciphertext);

        assert_eq!(
            unwrap_channel_key_for_device(&first, &device, &aad).unwrap(),
            key
        );
        assert_eq!(
            unwrap_channel_key_for_device(&second, &device, &aad).unwrap(),
            key
        );
    }
}
