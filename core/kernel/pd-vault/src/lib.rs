//! Harbor key vault — identity, channel-key derivation, and sealed payloads (ADR-0120).
//!
//! # The custody law
//!
//! **Key material lives and operates ONLY inside the kernel. An agent body never
//! holds it.** Everything in this crate is built so that the answer to "can the
//! caller obtain the secret?" is no by construction rather than by convention:
//!
//! - A private key is never returned, printed, serialized, or `Debug`-formatted.
//!   [`HarborKeypair`] hands out signatures and public keys; it does not hand out
//!   its seed, and [`HarborKeypair::from_seed`] takes the seed by `&mut` so the
//!   wipe reaches the caller's own buffer rather than a copy of it.
//! - [`ChannelKey`] and [`SharedSecret`] redact themselves in `Debug`, wipe
//!   themselves on drop, and — this is the load-bearing part — expose **no public
//!   accessor for their bytes**. The raw-byte and hex getters on both are
//!   `pub(crate)`, so "can the caller obtain the secret?" is answered by the
//!   compiler rather than by a naming convention a reviewer is asked to catch in a
//!   diff. What a caller gets instead is a constant-time [`PartialEq`]: it can
//!   *compare* a key against one it already holds, it cannot *read* one.
//!   `compile_fail` doctests on both types keep it that way, so a future `pub`
//!   fails `cargo test --doc` rather than quietly widening the surface.
//! - The kernel is the only place a key is *used*. A caller asks for an operation
//!   (sign this, seal this, derive the key for that channel) and receives the
//!   result. This is the "use without see" primitive ADR-0042 §3 names as
//!   load-bearing: the plaintext of a secret never enters the requesting body's
//!   address space, environment, logs, or wire.
//! - Secrets are zeroized on drop wherever a type owns them, so a heap scrape
//!   after a drop finds zeros rather than a live key.
//!
//! # FFI is deliberately NOT in this slice
//!
//! `pd-anchor` compiles to a `cdylib` because ADR-0054 requires the daemon to
//! reach the macaroon gate over a C ABI. `pd-vault` compiles to an `rlib` only.
//! That is a decision, not an omission: an FFI export is precisely the moment a
//! kernel key becomes reachable from a process the kernel does not control, and
//! ADR-0087 is blunt about why that matters —
//!
//! > Code written in Rust but running in the *same process and UID* as an
//! > agent-reachable daemon is exactly as forgeable as TypeScript.
//!
//! Rust buys memory safety and one canonical implementation; it does not buy
//! isolation. So this crate ships the primitives first and the boundary later,
//! when there is a caller whose trust story has been reviewed. Nothing here is
//! wired to the relay: producing the sealed envelopes the relay routes is a
//! follow-on slice, and the envelope schema itself lives on the relay side.
//!
//! # Threat model
//!
//! In scope: an attacker who holds ciphertext, nonces, and channel/epoch
//! metadata, and who can replay, reorder, truncate, or splice them across
//! channels and epochs. Against that attacker the AEAD tag plus the bound
//! associated data ([`SealAad`]) make every such splice a decryption failure.
//!
//! Out of scope, honestly: an attacker who already executes code in this
//! process. It reads the key out of memory or simply calls [`seal`] itself. Only
//! a separate UID or a separate machine changes that (ADR-0087 phases 5-6), and
//! no amount of care in this file substitutes for it.
//!
//! Also out of scope: forward secrecy. Epochs rotate keys forward, but every past
//! epoch stays derivable from the harbor secret — that is a deliberate trade for
//! replay/backfill decryption, and [`kdf`] documents it in full.
//!
//! # Shape of the crate
//!
//! 1. [`keys`] — [`HarborKeypair`], the Ed25519 signing identity, plus its
//!    deterministic X25519 counterpart for key agreement, and
//!    [`DeviceKemSecret`], the independently-generated X25519 counterpart a
//!    device (rather than a harbor) uses for the same role.
//! 2. [`kdf`] — [`derive_channel_key`], HKDF-SHA256 from a harbor secret to a
//!    per-channel, per-epoch [`ChannelKey`].
//! 3. [`seal`] — [`seal`] / [`open`], XChaCha20-Poly1305 over that channel key
//!    with harbor, channel, epoch, and sequence bound into the associated data.
//! 4. [`hpke`] — [`wrap_channel_key_for_device`] / [`unwrap_channel_key_for_device`],
//!    RFC 9180 HPKE base mode over X25519/HKDF-SHA256/AES-256-GCM, for handing a
//!    [`ChannelKey`] to one recipient device across the join-time / rotation
//!    wire (ADR-0123 A4/B3) rather than inside a channel the recipient already
//!    holds the key for.
//!
//! Every public function carries a runnable doctest, so `cargo test --doc -p
//! pd-vault` doubles as a worked tutorial for the whole path.

// pd-vault has no FFI surface (see the module docs above), so unlike pd-anchor it
// can prove the absence of unsafe rather than merely intending it. This is the
// first crate-level lint attribute in the kernel workspace — a deliberate new
// precedent for a crate that only holds keys and crypto, not a house convention
// being copied from a sibling.
#![forbid(unsafe_code)]

use thiserror::Error;

pub mod hpke;
pub mod kdf;
pub mod keys;
pub mod seal;

pub use hpke::{
    unwrap_channel_key_for_device, wrap_channel_key_for_device, KeyWrapAad, WrappedKey,
    KEY_WRAP_AAD_LABEL,
};
pub use kdf::{derive_channel_key, ChannelKey, CHANNEL_KEY_LABEL, CHANNEL_KEY_LEN};
pub use keys::{
    DeviceKemSecret, HarborKemSecret, HarborKeypair, HarborPublicKey, SharedSecret, X25519PublicKey,
};
pub use seal::{open, random_nonce, seal, SealAad, NONCE_LEN, SEAL_AAD_LABEL, TAG_LEN};

/// Encode a component list so that no two distinct lists share an encoding.
///
/// This is the single anti-ambiguity primitive the crate is built on, and both
/// the HKDF `info` string ([`derive_channel_key`]) and the AEAD associated data
/// ([`SealAad::encode`]) go through it.
///
/// The failure it exists to prevent is concatenation collision. Naively building
/// an info string as `channel_id || epoch` makes `("a", 11)` and `("a1", 1)`
/// encode to the same bytes `a11`, so two different channel/epoch pairs derive
/// the *same* key — a silent cross-channel key reuse that no test of either pair
/// in isolation would ever catch.
///
/// The encoding is:
///
/// ```text
/// u32_be(component_count) || for each component: u32_be(len) || bytes
/// ```
///
/// Because every component's length is written before its bytes, and the count is
/// written before everything, the encoding is prefix-free and parses back to
/// exactly one component list. **No byte value is reserved as a separator**, so
/// callers may put arbitrary bytes — any UTF-8, any punctuation, a `/`, a `\0` —
/// inside a channel id without creating an ambiguity. That is the property a
/// separator-based scheme cannot offer, since a separator is only unambiguous for
/// as long as nobody types it.
///
/// # Examples
///
/// ```
/// use pd_vault::unambiguous_encoding;
///
/// // The classic concatenation collision does not survive the encoding.
/// // Both component lists concatenate to the same bytes `a11`, so a naive
/// // `channel_id || epoch` cannot tell them apart. Note the epochs are the
/// // VARIABLE-WIDTH renderings `b"11"` and `b"1"`: fixed-width components are
/// // self-delimiting and would not collide under concatenation either, so a
/// // fixed-width example would demonstrate nothing.
/// assert_eq!([&b"a"[..], b"11"].concat(), [&b"a1"[..], b"1"].concat());
/// let left = unambiguous_encoding(&[b"a", b"11"])?;
/// let right = unambiguous_encoding(&[b"a1", b"1"])?;
/// assert_ne!(left, right);
/// # Ok::<(), pd_vault::VaultError>(())
/// ```
pub fn unambiguous_encoding(components: &[&[u8]]) -> Result<Vec<u8>, VaultError> {
    let count = u32::try_from(components.len()).map_err(|_| VaultError::ComponentTooLong)?;
    let capacity = 4 + components.iter().map(|c| 4 + c.len()).sum::<usize>();

    let mut encoded = Vec::with_capacity(capacity);
    encoded.extend_from_slice(&count.to_be_bytes());
    for component in components {
        let len = u32::try_from(component.len()).map_err(|_| VaultError::ComponentTooLong)?;
        encoded.extend_from_slice(&len.to_be_bytes());
        encoded.extend_from_slice(component);
    }
    Ok(encoded)
}

/// Every way a vault operation can fail.
///
/// Note what is *missing*: there is exactly one decryption-failure variant,
/// [`VaultError::Decrypt`], and it carries nothing. See [`open`] for why.
#[derive(Debug, Error)]
pub enum VaultError {
    /// The input keying material is below [`kdf::MIN_HARBOR_SECRET_LEN`]. A short
    /// harbor secret would make the derived channel key only as strong as the
    /// secret, so the derivation refuses rather than quietly stretching it.
    #[error("harbor secret too short: {len} bytes, minimum {minimum}")]
    WeakHarborSecret { len: usize, minimum: usize },
    /// An identifier that must be bound into a key or an AEAD tag was empty.
    /// Empty ids are rejected because they turn a binding into a no-op.
    #[error("empty {field}")]
    EmptyComponent { field: &'static str },
    /// A component (or the component list) exceeds the encoding's 32-bit length
    /// field. Unreachable for real identifiers; checked rather than truncated.
    #[error("binding component exceeds the encoding length limit")]
    ComponentTooLong,
    /// HKDF-Expand rejected the requested output length.
    #[error("channel key derivation failed")]
    Derive,
    /// AEAD encryption failed (message length overflow).
    #[error("sealing failed")]
    Seal,
    /// AEAD decryption failed. Deliberately opaque and deliberately singular —
    /// wrong key, tampered ciphertext, tampered associated data, a replay into
    /// another channel, and a replay into another epoch all produce exactly this
    /// value with exactly this message.
    #[error("decryption failed")]
    Decrypt,
    /// A public key was not a valid curve point, or a key agreement produced a
    /// non-contributory (all-zero) shared secret.
    #[error("invalid harbor public key")]
    InvalidKey,
    /// A signature was malformed or did not verify.
    #[error("invalid harbor signature")]
    InvalidSignature,
    /// A secure-random draw failed. Carries the underlying reason.
    #[error("rng failure: {0}")]
    Rng(String),
    #[error(transparent)]
    Hex(#[from] hex::FromHexError),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encoding_is_injective_across_the_classic_collision() {
        // The inputs must actually EXHIBIT the collision this test is named
        // for, or it asserts nothing: `("a", 11)` and `("a1", 1)` collide only
        // when the epoch is rendered variable-width. With `11u64.to_be_bytes()`
        // the two lists are 9 and 10 bytes and differ under plain
        // concatenation too, so such a test passes against an encoder that
        // does nothing at all. Pin the premise first, then the property.
        let naive_left = [&b"a"[..], b"11"].concat();
        let naive_right = [&b"a1"[..], b"1"].concat();
        assert_eq!(
            naive_left, naive_right,
            "premise: these collide under concatenation"
        );

        let left = unambiguous_encoding(&[b"a", b"11"]).unwrap();
        let right = unambiguous_encoding(&[b"a1", b"1"]).unwrap();
        assert_ne!(left, right);
    }

    #[test]
    fn encoding_separates_component_boundaries() {
        // ("ab", "c") and ("a", "bc") concatenate identically; they must not encode
        // identically.
        let left = unambiguous_encoding(&[b"ab", b"c"]).unwrap();
        let right = unambiguous_encoding(&[b"a", b"bc"]).unwrap();
        assert_ne!(left, right);
    }

    #[test]
    fn encoding_separates_arity() {
        let left = unambiguous_encoding(&[b"a"]).unwrap();
        let right = unambiguous_encoding(&[b"a", b""]).unwrap();
        assert_ne!(left, right);
    }

    #[test]
    fn encoding_admits_any_byte_in_a_component() {
        // No byte is reserved as a separator, so an id containing the bytes a
        // delimiter scheme would choke on is still unambiguous.
        let left = unambiguous_encoding(&[b"a\x00/b", b"c"]).unwrap();
        let right = unambiguous_encoding(&[b"a\x00", b"/bc"]).unwrap();
        assert_ne!(left, right);
    }

    #[test]
    fn encoding_layout_is_stable() {
        // Length-prefix layout is part of the wire contract for any future
        // cross-implementation twin, so it is asserted byte for byte.
        let encoded = unambiguous_encoding(&[b"hi", &[0xff, 0x00]]).unwrap();
        assert_eq!(
            encoded,
            vec![
                0, 0, 0, 2, // two components
                0, 0, 0, 2, b'h', b'i', // "hi"
                0, 0, 0, 2, 0xff, 0x00, // two raw bytes
            ]
        );
    }
}
