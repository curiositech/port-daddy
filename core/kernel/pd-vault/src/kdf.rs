//! Channel key derivation — HKDF-SHA256 from a harbor secret (ADR-0120 clause 1).
//!
//! One harbor secret fans out into many keys: one per `(channel, epoch)` pair.
//! [`derive_channel_key`] is the only way to make one, and it is a pure function —
//! same inputs, same key, on any machine, forever. Nothing is stored.
//!
//! # Why the info string is length-prefixed
//!
//! The interesting failure in a KDF like this one is never the hash. It is the
//! *encoding*. If the `info` string were built by concatenating the channel id
//! and the epoch, then
//!
//! ```text
//! channel = "a",  epoch = 11   ->   info = "a11"
//! channel = "a1", epoch = 1    ->   info = "a11"
//! ```
//!
//! and two different channels silently share a key. Every ciphertext in one is
//! then readable in the other, and no test that exercises either pair on its own
//! will ever notice. A delimiter (`"a|11"` vs `"a1|1"`) fixes the example but only
//! holds while no channel id ever contains the delimiter — a property enforced by
//! hope.
//!
//! So the info string goes through [`crate::unambiguous_encoding`], which writes
//! `u32_be(len) || bytes` for each component ahead of a component count. The
//! encoding is prefix-free, no byte is reserved, and distinct component lists are
//! guaranteed distinct info strings. `("a", 11)` and `("a1", 1)` are then
//! unambiguously different, whatever a channel id happens to contain.
//!
//! # Domain separation
//!
//! [`CHANNEL_KEY_LABEL`] (`pd-vault/v1/channel`) is used twice: as the HKDF-Extract
//! salt and as the first component of the info string. The salt use separates this
//! derivation from any other protocol that might one day share a harbor secret; the
//! info use keeps the label inside the same injective encoding as everything else,
//! so a future `pd-vault/v2/...` label can never produce a v1 info string. The `v1`
//! is a version of the *derivation*, not of the crate — changing the label changes
//! every key, which is exactly what a derivation change must do.
//!
//! # Epoch rotation
//!
//! `epoch` is a monotonic `u64` counter owned by the channel, not a timestamp.
//! Rotating means incrementing it:
//!
//! - **Forward.** A new epoch derives an entirely unrelated key. Nothing about
//!   epoch `n` helps an attacker who has epoch `n - 1`, because HKDF's output is
//!   independent per info string. New traffic is sealed under the new key.
//! - **Backward.** Every past epoch stays derivable from the same harbor secret.
//!   That is deliberate: archived ciphertext, replayed event logs, and backfill
//!   all need to open, and a rotation scheme that bricks history is a rotation
//!   scheme operators quietly stop using.
//! - **Honest scope: rotation is not forward secrecy.** Because old epochs stay
//!   derivable, compromise of the harbor secret compromises every epoch, past and
//!   future. Rotation limits the blast radius of a leaked *channel key* — the
//!   thing most likely to escape, since it travels to whoever is sealing — not of
//!   the harbor secret itself. Real forward secrecy needs a ratchet that destroys
//!   the previous state, which would trade away backfill; that is a separate
//!   decision, not something to drift into.
//! - The epoch is also bound into every AEAD tag (see [`crate::SealAad`]), so a
//!   ciphertext from epoch `n` will not open under epoch `n + 1` even if an
//!   attacker supplies the right key. Rotation is enforced by the tag, not just
//!   by key separation.

use hkdf::Hkdf;
use sha2::Sha256;
use subtle::ConstantTimeEq;
use zeroize::Zeroize;

use crate::{unambiguous_encoding, VaultError};

/// Domain-separation label for channel key derivation. Versioned: a change here
/// is a change to every derived key.
pub const CHANNEL_KEY_LABEL: &[u8] = b"pd-vault/v1/channel";

/// Length of a derived channel key, in bytes.
pub const CHANNEL_KEY_LEN: usize = 32;

/// Shortest accepted harbor secret. A derived key is never stronger than the
/// input keying material, so short secrets are refused rather than stretched.
pub const MIN_HARBOR_SECRET_LEN: usize = 32;

/// A per-channel, per-epoch symmetric key.
///
/// Wiped on drop and redacted in `Debug`, so a key cannot reach a log line by
/// accident. There is no `Clone`: a channel key should exist in one place and be
/// dropped when the operation is done.
///
/// # The bytes do not leave the crate
///
/// Every accessor that would return key material is narrowed: `as_bytes` is
/// `pub(crate)`, and the hex encoder is `pub(crate)` *and* `cfg(test)`, so it does
/// not exist in a release build at all. The crate docs claim key material is
/// unobtainable *by construction* rather than by convention, and for this type
/// that claim is exactly those two keywords: outside `pd-vault` a channel key can
/// be constructed, compared, sealed with, opened with, and dropped, and there is
/// no expression that yields its 32 bytes.
///
/// ```compile_fail,E0624
/// use pd_vault::derive_channel_key;
///
/// let key = derive_channel_key(&[0x5au8; 32], "ops", 1).unwrap();
/// // `as_bytes` is pub(crate): the AEAD key does not leave the kernel.
/// let _raw = key.as_bytes();
/// ```
///
/// What a caller gets instead is [`PartialEq`], implemented in constant time. It
/// answers "are these the same key?" without answering "what is this key?".
pub struct ChannelKey([u8; CHANNEL_KEY_LEN]);

impl ChannelKey {
    /// Adopt raw key bytes, wiping the caller's buffer.
    ///
    /// Provided for callers that received a key through some other custody path
    /// (and for test vectors). The normal way to get one is [`derive_channel_key`].
    ///
    /// Taken by `&mut` for the same reason as [`crate::HarborKeypair::from_seed`]:
    /// `[u8; CHANNEL_KEY_LEN]` is `Copy`, so a by-value parameter could only ever
    /// wipe the call site's copy and would leave the caller's array live. By
    /// reference the wipe reaches the caller's own storage.
    pub fn from_bytes(bytes: &mut [u8; CHANNEL_KEY_LEN]) -> Self {
        let key = Self(*bytes);
        bytes.zeroize();
        key
    }

    /// The raw key bytes, for the AEAD.
    ///
    /// `pub(crate)` on purpose: [`crate::seal`] and [`crate::open`] live in this
    /// crate, so nothing outside it needs the bytes, and the crate-level custody
    /// law is only true by construction while this stays narrow.
    pub(crate) fn as_bytes(&self) -> &[u8; CHANNEL_KEY_LEN] {
        &self.0
    }

    /// Lowercase hex of the key, for known-answer vectors.
    ///
    /// This *does* expose the key, and it is compiled only under `cfg(test)`.
    /// Two reasons it is not a shipped accessor. First, a known-answer vector
    /// cannot be written without it, and that is the only need anyone has
    /// demonstrated. Second, the `String` it returns is a heap allocation that is
    /// never zeroized. It outlives the `Drop for ChannelKey` wipe further down
    /// this file, leaving the key readable on the heap after the key itself was
    /// destroyed — the accessor quietly defeats the destructor. A hex encoder for
    /// a secret is a leak with a helpful name; keeping it out of release builds is
    /// cheaper than remembering that.
    #[cfg(test)]
    pub(crate) fn to_hex(&self) -> String {
        hex::encode(self.0)
    }
}

impl std::fmt::Debug for ChannelKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ChannelKey(<redacted>)")
    }
}

/// Constant-time equality — the compare-without-read primitive that replaces the
/// public byte accessors. A variable-time `==` on key material would leak the
/// length of the matching prefix to anyone who can time it, so the comparison
/// always touches all [`CHANNEL_KEY_LEN`] bytes.
impl PartialEq for ChannelKey {
    fn eq(&self, other: &Self) -> bool {
        self.0.ct_eq(&other.0).into()
    }
}

impl Eq for ChannelKey {}

impl Drop for ChannelKey {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

/// Derive the key for one `(channel, epoch)` pair from a harbor secret.
///
/// The harbor secret is input keying material — a harbor root secret, or a shared
/// secret from [`crate::HarborKemSecret::diffie_hellman`]. It is never stored and
/// never returned.
///
/// # Errors
///
/// - [`VaultError::WeakHarborSecret`] if the secret is shorter than
///   [`MIN_HARBOR_SECRET_LEN`].
/// - [`VaultError::EmptyComponent`] if `channel_id` is empty — an empty id binds
///   nothing, so every channel would share a key.
/// - [`VaultError::ComponentTooLong`] if `channel_id` overflows the encoding's
///   32-bit length field.
///
/// # Examples
///
/// ```
/// use pd_vault::derive_channel_key;
///
/// let harbor_secret = [0x5au8; 32];
///
/// // Same inputs, same key. Keys compare in constant time; their bytes are not
/// // reachable from outside the crate, so comparison is all a caller can do.
/// let key = derive_channel_key(&harbor_secret, "harbor/alpha", 7)?;
/// let again = derive_channel_key(&harbor_secret, "harbor/alpha", 7)?;
/// assert_eq!(key, again);
///
/// // Rotating the epoch derives an unrelated key...
/// let rotated = derive_channel_key(&harbor_secret, "harbor/alpha", 8)?;
/// assert_ne!(key, rotated);
///
/// // ...and the old epoch stays derivable, so archived traffic still opens.
/// assert_eq!(derive_channel_key(&harbor_secret, "harbor/alpha", 7)?, key);
///
/// // The concatenation collision cannot happen: ("a", 11) and ("a1", 1) differ.
/// assert_ne!(
///     derive_channel_key(&harbor_secret, "a", 11)?,
///     derive_channel_key(&harbor_secret, "a1", 1)?
/// );
/// # Ok::<(), pd_vault::VaultError>(())
/// ```
pub fn derive_channel_key(
    harbor_secret: &[u8],
    channel_id: &str,
    epoch: u64,
) -> Result<ChannelKey, VaultError> {
    if harbor_secret.len() < MIN_HARBOR_SECRET_LEN {
        return Err(VaultError::WeakHarborSecret {
            len: harbor_secret.len(),
            minimum: MIN_HARBOR_SECRET_LEN,
        });
    }
    if channel_id.is_empty() {
        return Err(VaultError::EmptyComponent {
            field: "channel id",
        });
    }

    let info = unambiguous_encoding(&[
        CHANNEL_KEY_LABEL,
        channel_id.as_bytes(),
        &epoch.to_be_bytes(),
    ])?;

    let hkdf = Hkdf::<Sha256>::new(Some(CHANNEL_KEY_LABEL), harbor_secret);
    let mut okm = [0u8; CHANNEL_KEY_LEN];
    hkdf.expand(&info, &mut okm)
        .map_err(|_| VaultError::Derive)?;

    // `from_bytes` zeroizes `okm` in place, so the derived bytes do not outlive
    // this frame outside the returned key.
    Ok(ChannelKey::from_bytes(&mut okm))
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

    const KAT_HARBOR_SECRET: [u8; 32] = [0x5a; 32];
    const KAT_CHANNEL: &str = "harbor/alpha";
    const KAT_EPOCH: u64 = 7;
    const KAT_CHANNEL_KEY_HEX: &str =
        "eecdca153c0521429707dd6ed523314c6faff8060928b731738214cef69b4c35";
    const KAT_CHANNEL_KEY_EPOCH8_HEX: &str =
        "c80f75976ac60d87e08aa8e22ce26dd74a46ea514824a4ddc518f1e956e25c5b";

    #[test]
    fn kat_channel_key_is_stable() {
        let key = derive_channel_key(&KAT_HARBOR_SECRET, KAT_CHANNEL, KAT_EPOCH).unwrap();
        assert_eq!(key.to_hex(), KAT_CHANNEL_KEY_HEX);

        let rotated = derive_channel_key(&KAT_HARBOR_SECRET, KAT_CHANNEL, KAT_EPOCH + 1).unwrap();
        assert_eq!(rotated.to_hex(), KAT_CHANNEL_KEY_EPOCH8_HEX);
    }

    #[test]
    fn derivation_is_deterministic() {
        let first = derive_channel_key(&KAT_HARBOR_SECRET, KAT_CHANNEL, KAT_EPOCH).unwrap();
        let second = derive_channel_key(&KAT_HARBOR_SECRET, KAT_CHANNEL, KAT_EPOCH).unwrap();
        assert_eq!(first.to_hex(), second.to_hex());
    }

    #[test]
    fn distinct_channels_derive_distinct_keys() {
        let alpha = derive_channel_key(&KAT_HARBOR_SECRET, "alpha", 1).unwrap();
        let beta = derive_channel_key(&KAT_HARBOR_SECRET, "beta", 1).unwrap();
        assert_ne!(alpha.to_hex(), beta.to_hex());
    }

    #[test]
    fn distinct_epochs_derive_distinct_keys() {
        let first = derive_channel_key(&KAT_HARBOR_SECRET, "alpha", 1).unwrap();
        let second = derive_channel_key(&KAT_HARBOR_SECRET, "alpha", 2).unwrap();
        assert_ne!(first.to_hex(), second.to_hex());
    }

    #[test]
    fn distinct_harbor_secrets_derive_distinct_keys() {
        let ours = derive_channel_key(&[0x01; 32], "alpha", 1).unwrap();
        let theirs = derive_channel_key(&[0x02; 32], "alpha", 1).unwrap();
        assert_ne!(ours.to_hex(), theirs.to_hex());
    }

    #[test]
    fn old_epochs_stay_derivable_after_rotation() {
        // The rotation contract: incrementing the epoch must not cost the ability
        // to open archived traffic.
        let historical: Vec<String> = (0..5)
            .map(|epoch| {
                derive_channel_key(&KAT_HARBOR_SECRET, KAT_CHANNEL, epoch)
                    .unwrap()
                    .to_hex()
            })
            .collect();

        for (epoch, expected) in historical.iter().enumerate() {
            let rederived =
                derive_channel_key(&KAT_HARBOR_SECRET, KAT_CHANNEL, epoch as u64).unwrap();
            assert_eq!(&rederived.to_hex(), expected);
        }
    }

    #[test]
    fn channel_epoch_pairs_cannot_collide_by_concatenation() {
        // The headline anti-ambiguity property. ("a", 11) and ("a1", 1) concatenate
        // to the same string; they must not derive the same key.
        let left = derive_channel_key(&KAT_HARBOR_SECRET, "a", 11).unwrap();
        let right = derive_channel_key(&KAT_HARBOR_SECRET, "a1", 1).unwrap();
        assert_ne!(left.to_hex(), right.to_hex());

        // Same trap one digit over, and with a separator-flavoured id that a
        // delimiter scheme would mishandle.
        assert_ne!(
            derive_channel_key(&KAT_HARBOR_SECRET, "ab", 1)
                .unwrap()
                .to_hex(),
            derive_channel_key(&KAT_HARBOR_SECRET, "a", 0x6200_0000_0000_0001)
                .unwrap()
                .to_hex()
        );
        assert_ne!(
            derive_channel_key(&KAT_HARBOR_SECRET, "a/1", 1)
                .unwrap()
                .to_hex(),
            derive_channel_key(&KAT_HARBOR_SECRET, "a", 1)
                .unwrap()
                .to_hex()
        );
    }

    #[test]
    fn short_harbor_secret_is_refused() {
        assert!(matches!(
            derive_channel_key(&[0u8; 31], "alpha", 1),
            Err(VaultError::WeakHarborSecret {
                len: 31,
                minimum: 32
            })
        ));
    }

    #[test]
    fn empty_channel_id_is_refused() {
        assert!(matches!(
            derive_channel_key(&KAT_HARBOR_SECRET, "", 1),
            Err(VaultError::EmptyComponent {
                field: "channel id"
            })
        ));
    }

    #[test]
    fn channel_key_equality_matches_the_bytes() {
        // `PartialEq` is what callers get in place of the byte accessors, so it
        // has to agree with the bytes it is standing in for — in both directions.
        let key = derive_channel_key(&KAT_HARBOR_SECRET, KAT_CHANNEL, KAT_EPOCH).unwrap();
        let same = derive_channel_key(&KAT_HARBOR_SECRET, KAT_CHANNEL, KAT_EPOCH).unwrap();
        let rotated = derive_channel_key(&KAT_HARBOR_SECRET, KAT_CHANNEL, KAT_EPOCH + 1).unwrap();

        assert_eq!(key, same);
        assert_eq!(key.as_bytes(), same.as_bytes());
        assert_ne!(key, rotated);
        assert_ne!(key.as_bytes(), rotated.as_bytes());

        // A single flipped bit anywhere must not compare equal.
        for index in 0..CHANNEL_KEY_LEN {
            let mut bytes = *key.as_bytes();
            bytes[index] ^= 0x01;
            assert_ne!(
                key,
                ChannelKey::from_bytes(&mut bytes),
                "a key differing at byte {index} compared equal"
            );
        }
    }

    #[test]
    fn from_bytes_wipes_the_callers_buffer() {
        // Same hazard as HarborKeypair::from_seed: `[u8; 32]` is `Copy`, so a
        // by-value constructor can only wipe the call site's copy. Taken by `&mut`
        // the wipe lands in the caller's storage.
        let mut bytes = [0x5au8; CHANNEL_KEY_LEN];
        let key = ChannelKey::from_bytes(&mut bytes);
        assert_eq!(
            bytes, [0u8; CHANNEL_KEY_LEN],
            "from_bytes left the caller's key buffer live"
        );
        assert_eq!(key.as_bytes(), &[0x5au8; CHANNEL_KEY_LEN]);
    }

    #[test]
    fn channel_key_debug_redacts() {
        let key = derive_channel_key(&KAT_HARBOR_SECRET, KAT_CHANNEL, KAT_EPOCH).unwrap();
        assert_eq!(format!("{key:?}"), "ChannelKey(<redacted>)");
    }
}
