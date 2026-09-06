//! Harbor identity — one Ed25519 seed, two curve roles (ADR-0120 / ADR-0087).
//!
//! A harbor has exactly one long-term secret: a 32-byte Ed25519 seed. From it
//! this module derives two things and never more:
//!
//! - the **signing identity** ([`HarborKeypair::sign`] / [`HarborPublicKey::verify`]),
//!   which answers "who said this";
//! - the **key-agreement identity** ([`HarborKeypair::derive_x25519`]), which
//!   answers "who may read this".
//!
//! One seed rather than two because a harbor that has to custody, back up, rotate,
//! and attest *two* independent secrets will eventually get one of them wrong. The
//! conversion is the standard birational map between the Edwards and Montgomery
//! forms of the same curve: RFC 8032 §5.1.5 defines the Ed25519 secret scalar as
//! `clamp(SHA-512(seed)[0..32])`, and that identical scalar is a well-formed
//! X25519 secret. So [`HarborKeypair::derive_x25519`] is deterministic — the same
//! seed always yields the same key-agreement keypair, on any machine, forever —
//! and no second secret needs a custody story.
//!
//! Nothing in this module returns private key material. [`HarborKeypair`] exposes
//! signatures and public keys; the seed goes in once and is not retrievable.
//! [`HarborKeypair::from_seed`] takes the seed by `&mut` and zeroizes the caller's
//! own storage as it adopts it, so afterwards the seed lives in exactly one place:
//! inside the returned keypair. The `&mut` is load-bearing rather than stylistic —
//! `[u8; 32]` is `Copy`, so a by-value parameter would only ever wipe the copy the
//! call site made, leaving the caller's array live while *looking* like a wipe.
//! Both `ed25519_dalek::SigningKey` and `x25519_dalek::StaticSecret` zeroize
//! themselves on drop.
//!
//! What that does **not** cover: any other copy of the seed the caller already
//! made — the buffer it was read into from disk, a decoded `Vec`, a clone passed
//! elsewhere. `from_seed` can reach exactly the one array it is handed; the rest
//! remain the caller's to zeroize.
//!
//! Honest scope: this is custody, not isolation. A process that can execute code
//! here can read the scalar out of memory regardless. See the crate docs.

use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use sha2::{Digest, Sha512};
use subtle::ConstantTimeEq;
use x25519_dalek::{PublicKey as XPublicKey, StaticSecret};
use zeroize::Zeroize;

use crate::kdf::ChannelKey;
use crate::VaultError;

/// Length of a harbor seed, an Ed25519/X25519 public key, and a shared secret.
pub const SEED_LEN: usize = 32;
/// Length of an Ed25519 signature.
pub const SIGNATURE_LEN: usize = 64;

/// A harbor's long-term Ed25519 identity.
///
/// The seed is held, used, and dropped inside the kernel. There is no accessor
/// that returns it, no `Serialize`, and no `Debug` that could put it in a log
/// line — the custody law is enforced by the absence of an escape hatch, not by
/// a comment asking callers not to look.
pub struct HarborKeypair {
    signing: SigningKey,
}

impl HarborKeypair {
    /// Adopt an existing 32-byte harbor seed, wiping the caller's buffer.
    ///
    /// The seed is taken by `&mut` deliberately. `[u8; SEED_LEN]` is `Copy`, so a
    /// by-value parameter would hand this function a *copy* to zeroize and leave
    /// the caller's array untouched — a wipe that reads correctly at the call site
    /// and does nothing. By reference the zeroize lands in the caller's own
    /// storage, and the seed exists in exactly one place afterwards: inside the
    /// returned keypair.
    ///
    /// Only the array passed in is reachable. Any *other* copy the caller made —
    /// the read buffer the seed arrived in, a decoded `Vec`, a clone — is still
    /// the caller's own to zeroize.
    ///
    /// # Examples
    ///
    /// ```
    /// use pd_vault::HarborKeypair;
    ///
    /// let mut seed = [7u8; 32];
    /// let harbor = HarborKeypair::from_seed(&mut seed);
    /// // The caller's own buffer is wiped, not a copy of it.
    /// assert_eq!(seed, [0u8; 32]);
    ///
    /// // Deterministic: the same seed is always the same identity.
    /// assert_eq!(harbor.public(), HarborKeypair::from_seed(&mut [7u8; 32]).public());
    /// ```
    pub fn from_seed(seed: &mut [u8; SEED_LEN]) -> Self {
        let signing = SigningKey::from_bytes(seed);
        seed.zeroize();
        Self { signing }
    }

    /// Mint a fresh harbor identity from the operating system CSPRNG.
    ///
    /// # Errors
    ///
    /// [`VaultError::Rng`] if the OS entropy source is unavailable. The kernel
    /// refuses to mint an identity rather than fall back to a weaker source.
    ///
    /// # Examples
    ///
    /// ```
    /// use pd_vault::HarborKeypair;
    ///
    /// let harbor = HarborKeypair::generate()?;
    /// let other = HarborKeypair::generate()?;
    /// assert_ne!(harbor.public(), other.public());
    /// # Ok::<(), pd_vault::VaultError>(())
    /// ```
    pub fn generate() -> Result<Self, VaultError> {
        let mut seed = [0u8; SEED_LEN];
        getrandom::getrandom(&mut seed).map_err(|e| VaultError::Rng(e.to_string()))?;
        // `from_seed` zeroizes `seed` in place, so the freshly drawn entropy does
        // not outlive this frame.
        Ok(Self::from_seed(&mut seed))
    }

    /// The public half of the signing identity — safe to publish anywhere.
    pub fn public(&self) -> HarborPublicKey {
        HarborPublicKey(self.signing.verifying_key())
    }

    /// Sign a message with the harbor identity.
    ///
    /// # Examples
    ///
    /// ```
    /// use pd_vault::HarborKeypair;
    ///
    /// let harbor = HarborKeypair::from_seed(&mut [3u8; 32]);
    /// let signature = harbor.sign(b"berth 4 is clear");
    /// harbor.public().verify(b"berth 4 is clear", &signature)?;
    /// # Ok::<(), pd_vault::VaultError>(())
    /// ```
    pub fn sign(&self, message: &[u8]) -> [u8; SIGNATURE_LEN] {
        self.signing.sign(message).to_bytes()
    }

    /// Derive this harbor's X25519 key-agreement secret, deterministically.
    ///
    /// The scalar is `clamp(SHA-512(seed)[0..32])` — the same value RFC 8032
    /// §5.1.5 defines as the Ed25519 secret scalar — so the resulting X25519
    /// public key is the Montgomery form of the Ed25519 public key above. One
    /// seed, one identity, two curve encodings of it.
    ///
    /// Determinism is what makes this usable for a KEM without a second custody
    /// story: a harbor can re-derive its agreement key from backup at any time,
    /// and a peer that knows the harbor's identity knows where to send.
    ///
    /// # Examples
    ///
    /// ```
    /// use pd_vault::HarborKeypair;
    ///
    /// let harbor = HarborKeypair::from_seed(&mut [9u8; 32]);
    /// let again = HarborKeypair::from_seed(&mut [9u8; 32]);
    /// assert_eq!(harbor.derive_x25519().public(), again.derive_x25519().public());
    /// ```
    pub fn derive_x25519(&self) -> HarborKemSecret {
        let mut hash = Sha512::digest(self.signing.to_bytes());
        let mut scalar = [0u8; SEED_LEN];
        scalar.copy_from_slice(&hash[..SEED_LEN]);
        hash.as_mut_slice().zeroize();

        // RFC 7748 clamping: clear the low three bits, clear the top bit, set the
        // second-highest. Applied here rather than left to the callee so the
        // derivation is fully specified by this function for any future
        // cross-implementation twin.
        scalar[0] &= 248;
        scalar[SEED_LEN - 1] &= 127;
        scalar[SEED_LEN - 1] |= 64;

        let secret = StaticSecret::from(scalar);
        scalar.zeroize();
        HarborKemSecret { secret }
    }
}

/// A harbor's public signing key.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HarborPublicKey(VerifyingKey);

impl HarborPublicKey {
    /// Parse a public key from its 32-byte encoding.
    ///
    /// # Errors
    ///
    /// [`VaultError::InvalidKey`] if the bytes are not a valid curve point.
    pub fn from_bytes(bytes: &[u8; SEED_LEN]) -> Result<Self, VaultError> {
        VerifyingKey::from_bytes(bytes)
            .map(Self)
            .map_err(|_| VaultError::InvalidKey)
    }

    /// Parse a public key from 64 hex characters.
    ///
    /// # Errors
    ///
    /// [`VaultError::Hex`] if the string is not hex, [`VaultError::InvalidKey`] if
    /// it is the wrong length or not a valid curve point.
    pub fn from_hex(encoded: &str) -> Result<Self, VaultError> {
        let bytes: [u8; SEED_LEN] = hex::decode(encoded)?
            .try_into()
            .map_err(|_| VaultError::InvalidKey)?;
        Self::from_bytes(&bytes)
    }

    /// The 32-byte encoding.
    pub fn to_bytes(&self) -> [u8; SEED_LEN] {
        self.0.to_bytes()
    }

    /// The 64-character lowercase hex encoding.
    pub fn to_hex(&self) -> String {
        hex::encode(self.0.to_bytes())
    }

    /// Verify a signature produced by [`HarborKeypair::sign`].
    ///
    /// # Errors
    ///
    /// [`VaultError::InvalidSignature`] on any failure. As with [`crate::open`],
    /// there is one failure value and it does not say which check failed.
    ///
    /// # Examples
    ///
    /// ```
    /// use pd_vault::HarborKeypair;
    ///
    /// let harbor = HarborKeypair::from_seed(&mut [1u8; 32]);
    /// let signature = harbor.sign(b"manifest");
    /// assert!(harbor.public().verify(b"manifest", &signature).is_ok());
    /// assert!(harbor.public().verify(b"manifest!", &signature).is_err());
    /// ```
    pub fn verify(
        &self,
        message: &[u8],
        signature: &[u8; SIGNATURE_LEN],
    ) -> Result<(), VaultError> {
        self.0
            .verify(message, &Signature::from_bytes(signature))
            .map_err(|_| VaultError::InvalidSignature)
    }
}

/// A harbor's X25519 key-agreement secret, derived from its Ed25519 seed.
///
/// Like [`HarborKeypair`], it exposes operations and never the scalar. The
/// underlying `StaticSecret` zeroizes on drop.
pub struct HarborKemSecret {
    secret: StaticSecret,
}

impl HarborKemSecret {
    /// The public half — publish this so peers can agree with the harbor.
    pub fn public(&self) -> X25519PublicKey {
        X25519PublicKey(XPublicKey::from(&self.secret).to_bytes())
    }

    /// Agree a raw shared secret with a peer's X25519 public key.
    ///
    /// The result is **not** a channel key and must not be used as one: run it
    /// through HKDF with [`SharedSecret::derive_channel_key`], which binds the
    /// channel and epoch. A raw Diffie-Hellman output is a curve point, not a
    /// uniform key — and [`SharedSecret`] deliberately has no public accessor for
    /// its bytes, so that is the only thing a caller outside this crate can do
    /// with one.
    ///
    /// # Errors
    ///
    /// [`VaultError::InvalidKey`] if the agreement is non-contributory — i.e. the
    /// peer supplied a low-order point, which would force the shared secret to a
    /// fixed all-zero value the peer already knows. Rejecting it closes the
    /// small-subgroup confinement path.
    ///
    /// # Examples
    ///
    /// ```
    /// use pd_vault::HarborKeypair;
    ///
    /// let harbor = HarborKeypair::from_seed(&mut [1u8; 32]).derive_x25519();
    /// let peer = HarborKeypair::from_seed(&mut [2u8; 32]).derive_x25519();
    ///
    /// // Both sides agree the same secret. Note what this compares: the secrets
    /// // themselves, in constant time. There is no way to read their bytes.
    /// let ours = harbor.diffie_hellman(&peer.public())?;
    /// let theirs = peer.diffie_hellman(&harbor.public())?;
    /// assert_eq!(ours, theirs);
    ///
    /// // ...and the same agreement derives the same channel key on both sides.
    /// assert_eq!(ours.derive_channel_key("ops", 1)?, theirs.derive_channel_key("ops", 1)?);
    /// # Ok::<(), pd_vault::VaultError>(())
    /// ```
    pub fn diffie_hellman(&self, peer: &X25519PublicKey) -> Result<SharedSecret, VaultError> {
        raw_diffie_hellman(&self.secret, peer)
    }
}

/// The DH-agree-then-wrap step shared by every X25519 static secret in this
/// crate, regardless of where the secret came from.
///
/// `pub(crate)` rather than a method on one type because three different
/// callers reduce to exactly this: [`HarborKemSecret::diffie_hellman`] (a
/// harbor's identity-derived agreement key), [`DeviceKemSecret::diffie_hellman`]
/// (a device's independently generated one), and the one-shot ephemeral
/// agreement [`crate::hpke`] performs on every HPKE encapsulation, whose secret
/// is discarded after a single use and never becomes either of the named types
/// above. Three copies of "agree, check contributory, wrap" would be three
/// places the contributory check could independently go missing; one function
/// makes that impossible by construction.
///
/// # Errors
///
/// [`VaultError::InvalidKey`] if the agreement is non-contributory — the peer
/// supplied a low-order point, which would force the shared secret to a fixed
/// value the peer already knows. See [`HarborKemSecret::diffie_hellman`] for the
/// full rationale; it applies identically here.
pub(crate) fn raw_diffie_hellman(
    secret: &StaticSecret,
    peer: &X25519PublicKey,
) -> Result<SharedSecret, VaultError> {
    let agreed = secret.diffie_hellman(&XPublicKey::from(peer.0));
    if !agreed.was_contributory() {
        return Err(VaultError::InvalidKey);
    }
    Ok(SharedSecret(agreed.to_bytes()))
}

/// A device's own X25519 key-agreement secret — independently generated, not
/// derived from any harbor's Ed25519 seed.
///
/// [`HarborKemSecret`] is deliberately not reused for this role, even though the
/// shape is identical (an X25519 `StaticSecret` plus its public key) and the
/// custody properties are identical (no accessor for the scalar, agreement
/// yields a [`SharedSecret`] rather than raw bytes). The difference is
/// provenance, and provenance is exactly the thing a type should make hard to
/// mix up: a harbor's agreement key is *derived* — [`HarborKeypair::derive_x25519`]
/// takes no randomness at all, so the same seed is the same key-agreement
/// identity on any machine, forever. A device's is *generated* — fresh entropy,
/// no seed behind it, nothing to re-derive from if it is lost. Giving
/// `HarborKemSecret` a `generate()` alongside its `derive_x25519`-only
/// construction would let a caller accidentally mint a harbor agreement key with
/// no recoverable identity backing it; giving `DeviceKemSecret` a derivation
/// path would claim a determinism devices do not have. Two constructors on one
/// type cannot express "exactly one of these is how this kind of secret comes
/// into existence" — two types can.
///
/// This is the recipient side of HPKE base-mode decapsulation
/// ([`crate::hpke::unwrap_channel_key_for_device`]): a device publishes
/// [`DeviceKemSecret::public`] once (e.g. at enrollment), and every sender
/// wrapping a key to that device uses the published key as HPKE's `pkR`.
pub struct DeviceKemSecret {
    secret: StaticSecret,
}

impl DeviceKemSecret {
    /// Mint a fresh device key-agreement identity from the operating system
    /// CSPRNG.
    ///
    /// Unlike [`HarborKeypair::derive_x25519`], there is no seed to recover this
    /// from — losing the returned value loses the identity. That trade is the
    /// point: a device is not expected to carry a portable long-term seed the
    /// way a harbor does, so the key it publishes is only as durable as the
    /// device's own key storage, and that is a decision for the caller, not
    /// this crate.
    ///
    /// # Errors
    ///
    /// [`VaultError::Rng`] if the OS entropy source is unavailable. The kernel
    /// refuses to mint an identity rather than fall back to a weaker source.
    ///
    /// # Examples
    ///
    /// ```
    /// use pd_vault::DeviceKemSecret;
    ///
    /// let device = DeviceKemSecret::generate()?;
    /// let other = DeviceKemSecret::generate()?;
    /// assert_ne!(device.public(), other.public());
    /// # Ok::<(), pd_vault::VaultError>(())
    /// ```
    pub fn generate() -> Result<Self, VaultError> {
        let mut bytes = [0u8; SEED_LEN];
        getrandom::getrandom(&mut bytes).map_err(|e| VaultError::Rng(e.to_string()))?;
        // `from_bytes` zeroizes `bytes` in place, so the freshly drawn entropy
        // does not outlive this frame.
        Ok(Self::from_bytes(&mut bytes))
    }

    /// Adopt an existing 32-byte X25519 secret scalar, wiping the caller's
    /// buffer.
    ///
    /// For a device restoring its own persisted key-agreement identity from
    /// wherever it keeps device-local secrets, and for known-answer vectors that
    /// need a fixed keypair. The normal way to mint one is [`Self::generate`].
    ///
    /// Taken by `&mut` for the same reason as [`HarborKeypair::from_seed`] and
    /// [`crate::ChannelKey::from_bytes`]: a by-value `[u8; 32]` parameter would
    /// only ever wipe the call site's copy, leaving the caller's own array live.
    pub fn from_bytes(bytes: &mut [u8; SEED_LEN]) -> Self {
        let secret = StaticSecret::from(*bytes);
        bytes.zeroize();
        Self { secret }
    }

    /// The public half — publish this so senders can wrap keys to the device.
    pub fn public(&self) -> X25519PublicKey {
        X25519PublicKey(XPublicKey::from(&self.secret).to_bytes())
    }

    /// Agree a raw shared secret with a peer's X25519 public key.
    ///
    /// See [`HarborKemSecret::diffie_hellman`] — the contract is identical: the
    /// result is a curve point, not a uniform key, has no public byte accessor,
    /// and a non-contributory peer key is rejected rather than silently
    /// producing the shared all-zero secret. [`crate::hpke`] is the intended
    /// caller: it feeds this into HPKE's `ExtractAndExpand`, never into
    /// [`SharedSecret::derive_channel_key`] — a device's HPKE agreement and a
    /// harbor's channel-key agreement are different protocols that happen to
    /// share the same curve, and nothing here lets one be used in place of the
    /// other.
    ///
    /// # Errors
    ///
    /// [`VaultError::InvalidKey`] if the agreement is non-contributory.
    pub fn diffie_hellman(&self, peer: &X25519PublicKey) -> Result<SharedSecret, VaultError> {
        raw_diffie_hellman(&self.secret, peer)
    }
}

/// A peer's X25519 public key.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct X25519PublicKey([u8; SEED_LEN]);

impl X25519PublicKey {
    /// Adopt a 32-byte X25519 public key.
    ///
    /// Every 32-byte string is a syntactically valid Montgomery u-coordinate, so
    /// there is nothing to reject here; a degenerate (low-order) key is caught at
    /// agreement time by [`HarborKemSecret::diffie_hellman`].
    pub fn from_bytes(bytes: [u8; SEED_LEN]) -> Self {
        Self(bytes)
    }

    /// Parse from 64 hex characters.
    ///
    /// # Errors
    ///
    /// [`VaultError::Hex`] if the string is not hex, [`VaultError::InvalidKey`] if
    /// it is the wrong length.
    pub fn from_hex(encoded: &str) -> Result<Self, VaultError> {
        let bytes: [u8; SEED_LEN] = hex::decode(encoded)?
            .try_into()
            .map_err(|_| VaultError::InvalidKey)?;
        Ok(Self(bytes))
    }

    /// The 32-byte encoding.
    pub fn to_bytes(&self) -> [u8; SEED_LEN] {
        self.0
    }

    /// The 64-character lowercase hex encoding.
    pub fn to_hex(&self) -> String {
        hex::encode(self.0)
    }
}

/// A raw Diffie-Hellman output. Wiped on drop; redacted in `Debug`; its bytes are
/// not reachable from outside this crate.
///
/// This is deliberately a distinct type from [`crate::ChannelKey`] so that the
/// type system refuses the one mistake that matters here: a raw agreement output
/// cannot be handed to [`crate::seal`], only turned into a channel key by
/// [`SharedSecret::derive_channel_key`].
///
/// The custody law in the crate docs is enforced here by visibility, not by a
/// warning: `as_bytes` is `pub(crate)`, so a caller outside the kernel cannot
/// obtain the agreement output at all.
///
/// ```compile_fail,E0624
/// use pd_vault::HarborKeypair;
///
/// let harbor = HarborKeypair::from_seed(&mut [1u8; 32]).derive_x25519();
/// let peer = HarborKeypair::from_seed(&mut [2u8; 32]).derive_x25519();
/// let agreed = harbor.diffie_hellman(&peer.public()).unwrap();
///
/// // `as_bytes` is pub(crate): the raw DH output does not leave the kernel.
/// let _raw = agreed.as_bytes();
/// ```
pub struct SharedSecret([u8; SEED_LEN]);

impl SharedSecret {
    /// The raw bytes, as input keying material for [`crate::derive_channel_key`].
    ///
    /// `pub(crate)` on purpose. This is the one value in the agreement path that
    /// is neither a public key nor a derived key, and handing it out would let a
    /// caller re-derive every channel key this harbor pair will ever share. The
    /// supported way out of a `SharedSecret` is [`Self::derive_channel_key`].
    pub(crate) fn as_bytes(&self) -> &[u8; SEED_LEN] {
        &self.0
    }

    /// Run this agreement output through HKDF into a per-channel, per-epoch key.
    ///
    /// This is the whole public surface of a `SharedSecret`: agree, then derive.
    /// A raw Diffie-Hellman output is a curve point rather than a uniform key, so
    /// it is never used directly — see [`crate::derive_channel_key`], which this
    /// forwards to with the agreement as input keying material.
    ///
    /// # Errors
    ///
    /// Whatever [`crate::derive_channel_key`] returns: [`VaultError::EmptyComponent`]
    /// for an empty `channel_id`, or [`VaultError::ComponentTooLong`] if it
    /// overflows the encoding's length field. The length check cannot fire — a
    /// shared secret is always [`SEED_LEN`] bytes.
    ///
    /// # Examples
    ///
    /// ```
    /// use pd_vault::HarborKeypair;
    ///
    /// let harbor = HarborKeypair::from_seed(&mut [1u8; 32]).derive_x25519();
    /// let peer = HarborKeypair::from_seed(&mut [2u8; 32]).derive_x25519();
    ///
    /// let ours = harbor.diffie_hellman(&peer.public())?.derive_channel_key("ops", 3)?;
    /// let theirs = peer.diffie_hellman(&harbor.public())?.derive_channel_key("ops", 3)?;
    /// assert_eq!(ours, theirs);
    ///
    /// // Rotating the epoch derives an unrelated key, as always.
    /// let rotated = harbor.diffie_hellman(&peer.public())?.derive_channel_key("ops", 4)?;
    /// assert_ne!(ours, rotated);
    /// # Ok::<(), pd_vault::VaultError>(())
    /// ```
    pub fn derive_channel_key(
        &self,
        channel_id: &str,
        epoch: u64,
    ) -> Result<ChannelKey, VaultError> {
        crate::derive_channel_key(self.as_bytes(), channel_id, epoch)
    }
}

impl std::fmt::Debug for SharedSecret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SharedSecret(<redacted>)")
    }
}

/// Constant-time equality. This is what a caller gets *instead* of the bytes: it
/// can check that two agreements match without either one becoming readable, and
/// the comparison does not leak the position of the first differing byte.
impl PartialEq for SharedSecret {
    fn eq(&self, other: &Self) -> bool {
        self.0.ct_eq(&other.0).into()
    }
}

impl Eq for SharedSecret {}

impl Drop for SharedSecret {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---------------------------------------------------------------------
    // Known-answer vectors, v1 — SELF-GENERATED.
    //
    // Provenance, stated plainly: these bytes came out of THIS implementation
    // and were pasted back in. They are NOT RFC vectors, not from an official
    // test suite, and not from any shipping third-party implementation.
    //
    // They were each reproduced during development by a throwaway reference
    // implementation written straight from RFC 8032 / RFC 7748 / RFC 8439, which
    // is why they are believed correct rather than merely self-consistent. That
    // check was a one-off: it is not committed, it does not run in CI, and it is
    // not a second implementation in the ADR-0120 sense.
    //
    // So what these vectors actually gate is regression — this crate changing its
    // bytes without anyone noticing. Cross-implementation validation against a
    // real twin is still PENDING, and until one exists these constants are the
    // thing under suspicion when a disagreement appears, not the evidence.
    // ---------------------------------------------------------------------

    /// Seed 0x00,0x01,...,0x1f.
    const KAT_SEED: [u8; SEED_LEN] = [
        0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e,
        0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d,
        0x1e, 0x1f,
    ];
    const KAT_MESSAGE: &[u8] = b"pd-vault known-answer message v1";
    const KAT_ED25519_PUBLIC_HEX: &str =
        "03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8";
    const KAT_X25519_PUBLIC_HEX: &str =
        "4701d08488451f545a409fb58ae3e58581ca40ac3f7f114698cd71deac73ca01";
    const KAT_SIGNATURE_HEX: &str =
        "588d2ad262f7fb08e7214a7a2860f8d9414049dc07827f7f9884d59eb1d8e8f6\
         226a1c0abd573c355bd442c40f5c96175c6ca379ae48cb8e38b986d20eedad02";

    #[test]
    fn kat_identity_is_stable() {
        let mut seed = KAT_SEED;
        let harbor = HarborKeypair::from_seed(&mut seed);
        assert_eq!(
            seed, [0u8; SEED_LEN],
            "from_seed must wipe the caller's buffer"
        );
        assert_eq!(harbor.public().to_hex(), KAT_ED25519_PUBLIC_HEX);
        assert_eq!(
            harbor.derive_x25519().public().to_hex(),
            KAT_X25519_PUBLIC_HEX
        );
        assert_eq!(hex::encode(harbor.sign(KAT_MESSAGE)), KAT_SIGNATURE_HEX);
    }

    // --- custody: the seed wipe reaches the CALLER, not a copy -------------

    #[test]
    fn from_seed_wipes_the_callers_buffer() {
        // The regression this pins: `from_seed` used to take `[u8; SEED_LEN]` by
        // value. `[u8; 32]` is `Copy`, so the zeroize inside wiped the copy the
        // call site had just made and the caller's array stayed live — while both
        // the module docs and the function docs promised the opposite. Taking the
        // seed by `&mut` is what makes the promise true, and this asserts it from
        // the caller's side rather than trusting the signature to stay that way.
        let mut seed = [0xABu8; SEED_LEN];
        let harbor = HarborKeypair::from_seed(&mut seed);

        assert_eq!(
            seed, [0u8; SEED_LEN],
            "from_seed left the caller's seed buffer live"
        );

        // ...and the wipe did not cost the identity: it is still the identity for
        // the seed that was passed in.
        assert_eq!(
            harbor.public(),
            HarborKeypair::from_seed(&mut [0xABu8; SEED_LEN]).public()
        );
    }

    #[test]
    fn generate_wipes_its_own_seed_draw() {
        // `generate` routes its CSPRNG draw through `from_seed`, so the same wipe
        // applies to entropy the caller never sees. Observable only indirectly:
        // two draws must still be distinct identities.
        let first = HarborKeypair::generate().unwrap();
        let second = HarborKeypair::generate().unwrap();
        assert_ne!(first.public(), second.public());
    }

    // --- custody: a shared secret is compared, not read --------------------

    #[test]
    fn shared_secrets_compare_by_value() {
        let harbor = HarborKeypair::from_seed(&mut [11u8; SEED_LEN]).derive_x25519();
        let peer = HarborKeypair::from_seed(&mut [22u8; SEED_LEN]).derive_x25519();
        let stranger = HarborKeypair::from_seed(&mut [33u8; SEED_LEN]).derive_x25519();

        let ours = harbor.diffie_hellman(&peer.public()).unwrap();
        let theirs = peer.diffie_hellman(&harbor.public()).unwrap();
        let wrong = harbor.diffie_hellman(&stranger.public()).unwrap();

        assert_eq!(ours, theirs);
        assert_ne!(ours, wrong);
    }

    #[test]
    fn shared_secret_derives_the_same_channel_key_on_both_sides() {
        // The supported way out of a SharedSecret for a caller outside the crate:
        // agree, then derive. No byte accessor is involved.
        let harbor = HarborKeypair::from_seed(&mut [11u8; SEED_LEN]).derive_x25519();
        let peer = HarborKeypair::from_seed(&mut [22u8; SEED_LEN]).derive_x25519();

        let ours = harbor
            .diffie_hellman(&peer.public())
            .unwrap()
            .derive_channel_key("ops", 3)
            .unwrap();
        let theirs = peer
            .diffie_hellman(&harbor.public())
            .unwrap()
            .derive_channel_key("ops", 3)
            .unwrap();
        assert_eq!(ours, theirs);

        // Same agreement, different channel, unrelated key.
        let other_channel = harbor
            .diffie_hellman(&peer.public())
            .unwrap()
            .derive_channel_key("billing", 3)
            .unwrap();
        assert_ne!(ours, other_channel);

        // And it agrees with the free function on the same input keying material.
        let agreed = harbor.diffie_hellman(&peer.public()).unwrap();
        assert_eq!(
            agreed.derive_channel_key("ops", 3).unwrap(),
            crate::derive_channel_key(agreed.as_bytes(), "ops", 3).unwrap()
        );
    }

    #[test]
    fn derive_x25519_is_deterministic() {
        let first = HarborKeypair::from_seed(&mut [42u8; SEED_LEN])
            .derive_x25519()
            .public();
        let second = HarborKeypair::from_seed(&mut [42u8; SEED_LEN])
            .derive_x25519()
            .public();
        assert_eq!(first, second);
    }

    #[test]
    fn distinct_seeds_give_distinct_agreement_keys() {
        let first = HarborKeypair::from_seed(&mut [1u8; SEED_LEN])
            .derive_x25519()
            .public();
        let second = HarborKeypair::from_seed(&mut [2u8; SEED_LEN])
            .derive_x25519()
            .public();
        assert_ne!(first, second);
    }

    #[test]
    fn agreement_is_symmetric() {
        let harbor = HarborKeypair::from_seed(&mut [11u8; SEED_LEN]).derive_x25519();
        let peer = HarborKeypair::from_seed(&mut [22u8; SEED_LEN]).derive_x25519();

        let ours = harbor.diffie_hellman(&peer.public()).unwrap();
        let theirs = peer.diffie_hellman(&harbor.public()).unwrap();
        assert_eq!(ours.as_bytes(), theirs.as_bytes());
    }

    #[test]
    fn agreement_with_a_third_party_differs() {
        let harbor = HarborKeypair::from_seed(&mut [11u8; SEED_LEN]).derive_x25519();
        let peer = HarborKeypair::from_seed(&mut [22u8; SEED_LEN]).derive_x25519();
        let stranger = HarborKeypair::from_seed(&mut [33u8; SEED_LEN]).derive_x25519();

        let intended = harbor.diffie_hellman(&peer.public()).unwrap();
        let wrong = harbor.diffie_hellman(&stranger.public()).unwrap();
        assert_ne!(intended.as_bytes(), wrong.as_bytes());
    }

    #[test]
    fn low_order_peer_key_is_rejected() {
        let harbor = HarborKeypair::from_seed(&mut [7u8; SEED_LEN]).derive_x25519();
        // The all-zero u-coordinate is the canonical low-order point; agreement
        // with it yields an all-zero secret the peer already knows.
        let degenerate = X25519PublicKey::from_bytes([0u8; SEED_LEN]);
        assert!(matches!(
            harbor.diffie_hellman(&degenerate),
            Err(VaultError::InvalidKey)
        ));
    }

    // --- DeviceKemSecret: same custody contract, different provenance -------

    #[test]
    fn device_kem_secret_generate_gives_distinct_identities() {
        let first = DeviceKemSecret::generate().unwrap();
        let second = DeviceKemSecret::generate().unwrap();
        assert_ne!(first.public(), second.public());
    }

    #[test]
    fn device_kem_secret_from_bytes_wipes_the_callers_buffer() {
        let mut bytes = [0x77u8; SEED_LEN];
        let device = DeviceKemSecret::from_bytes(&mut bytes);
        assert_eq!(
            bytes, [0u8; SEED_LEN],
            "from_bytes left the caller's key buffer live"
        );

        // ...and the wipe did not cost the identity: it is still the identity
        // for the bytes that were passed in.
        assert_eq!(
            device.public(),
            DeviceKemSecret::from_bytes(&mut [0x77u8; SEED_LEN]).public()
        );
    }

    #[test]
    fn device_kem_secret_from_bytes_is_deterministic() {
        let first = DeviceKemSecret::from_bytes(&mut [9u8; SEED_LEN]).public();
        let second = DeviceKemSecret::from_bytes(&mut [9u8; SEED_LEN]).public();
        assert_eq!(first, second);
    }

    #[test]
    fn device_kem_secret_agreement_is_symmetric_and_rejects_low_order_peers() {
        // A device and a harbor agreeing with each other exercises the same
        // `raw_diffie_hellman` both types now share, from the two different
        // entry points.
        let device = DeviceKemSecret::from_bytes(&mut [11u8; SEED_LEN]);
        let harbor = HarborKeypair::from_seed(&mut [22u8; SEED_LEN]).derive_x25519();

        let ours = device.diffie_hellman(&harbor.public()).unwrap();
        let theirs = harbor.diffie_hellman(&device.public()).unwrap();
        assert_eq!(ours, theirs);

        let degenerate = X25519PublicKey::from_bytes([0u8; SEED_LEN]);
        assert!(matches!(
            device.diffie_hellman(&degenerate),
            Err(VaultError::InvalidKey)
        ));
    }

    #[test]
    fn signature_rejects_a_tampered_message() {
        let harbor = HarborKeypair::from_seed(&mut [5u8; SEED_LEN]);
        let signature = harbor.sign(b"cast off");
        assert!(matches!(
            harbor.public().verify(b"cast on", &signature),
            Err(VaultError::InvalidSignature)
        ));
    }

    #[test]
    fn signature_rejects_a_foreign_signer() {
        let harbor = HarborKeypair::from_seed(&mut [5u8; SEED_LEN]);
        let impostor = HarborKeypair::from_seed(&mut [6u8; SEED_LEN]);
        let signature = impostor.sign(b"cast off");
        assert!(matches!(
            harbor.public().verify(b"cast off", &signature),
            Err(VaultError::InvalidSignature)
        ));
    }

    #[test]
    fn public_keys_round_trip_through_hex() {
        let harbor = HarborKeypair::from_seed(&mut [13u8; SEED_LEN]);
        let signing = harbor.public();
        assert_eq!(
            HarborPublicKey::from_hex(&signing.to_hex()).unwrap(),
            signing
        );

        let agreement = harbor.derive_x25519().public();
        assert_eq!(
            X25519PublicKey::from_hex(&agreement.to_hex()).unwrap(),
            agreement
        );
    }

    #[test]
    fn malformed_public_key_hex_is_rejected() {
        assert!(matches!(
            HarborPublicKey::from_hex("not hex at all"),
            Err(VaultError::Hex(_))
        ));
        assert!(matches!(
            HarborPublicKey::from_hex("00112233"),
            Err(VaultError::InvalidKey)
        ));
    }

    #[test]
    fn shared_secret_debug_redacts() {
        let harbor = HarborKeypair::from_seed(&mut [1u8; SEED_LEN]).derive_x25519();
        let peer = HarborKeypair::from_seed(&mut [2u8; SEED_LEN]).derive_x25519();
        let agreed = harbor.diffie_hellman(&peer.public()).unwrap();

        let rendered = format!("{agreed:?}");
        assert_eq!(rendered, "SharedSecret(<redacted>)");
        assert!(!rendered.contains(&hex::encode(agreed.as_bytes())));
    }
}
