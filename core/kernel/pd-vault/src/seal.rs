//! Sealed payloads — XChaCha20-Poly1305 with context bound into the tag.
//!
//! [`seal`] turns a plaintext into ciphertext that only a holder of the right
//! [`ChannelKey`] can open, and — this is the part that matters — only *in the
//! place it was sealed for*. [`open`] is its exact inverse and fails closed.
//!
//! # Why XChaCha20-Poly1305
//!
//! The 24-byte extended nonce is the whole reason. With a 12-byte nonce, random
//! generation is not safe at volume (birthday collisions arrive around 2^32
//! messages) so the construction has to carry a counter, and a counter has to be
//! durably stored, and a restore-from-backup then silently reuses a nonce and
//! destroys the confidentiality of two messages at once. At 24 bytes, a random
//! nonce per message is safe without any state at all — see [`random_nonce`].
//!
//! # What the associated data binds, and why
//!
//! A ciphertext is not just bytes; it is bytes that *meant something in a place*.
//! Strip the place away and the ciphertext becomes a token an attacker can move
//! around: lift it from channel `ops` into channel `billing`, or from epoch 4 into
//! epoch 5, or replay message 3 as message 9. None of those need the key — only
//! the ability to relabel an envelope in transit.
//!
//! So [`SealAad`] binds all four coordinates — harbor, channel, epoch, sequence —
//! into the Poly1305 tag. The associated data is not encrypted (the relay must
//! still be able to route on it) but it is *authenticated*: change any coordinate
//! and the tag stops verifying, so every relabel above is a decryption failure
//! rather than a successful cross-context read.
//!
//! The AAD goes through the same [`crate::unambiguous_encoding`] as the KDF info
//! string, for the same reason: `harbor="a", channel="b"` and `harbor="ab",
//! channel=""` must not produce the same associated data, or the binding they are
//! supposed to provide has a hole in it exactly where an attacker would look.
//!
//! # Failure is opaque on purpose
//!
//! [`open`] has exactly one failure value, [`VaultError::Decrypt`], with one
//! message. It does not distinguish a wrong key from a tampered tag from a
//! tampered AAD from a truncated ciphertext, and the length check for a too-short
//! input returns that same value rather than a helpful "too short". A decryption
//! routine that explains *which* check failed is an oracle: an attacker who can
//! submit candidates and read the reason learns the shape of the secret one query
//! at a time. Padding-oracle attacks are the canonical example, and the defence is
//! not to pad differently but to say nothing.
//!
//! Errors that describe the *caller's own arguments* — an empty harbor id, an
//! oversized component — are still explicit. Those are not attacker-controlled
//! inputs to a decryption; they are programming mistakes in the kernel's own
//! caller, and hiding them helps no one.

use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};

use crate::kdf::ChannelKey;
use crate::{unambiguous_encoding, VaultError};

/// Nonce length for XChaCha20-Poly1305, in bytes.
pub const NONCE_LEN: usize = 24;

/// Poly1305 authentication tag length, in bytes. Ciphertext from [`seal`] is the
/// plaintext length plus this.
pub const TAG_LEN: usize = 16;

/// Domain-separation label for sealed-payload associated data. Distinct from
/// [`crate::CHANNEL_KEY_LABEL`] so an AAD string can never be mistaken for a KDF
/// info string.
pub const SEAL_AAD_LABEL: &[u8] = b"pd-vault/v1/seal";

/// The context a ciphertext is bound to.
///
/// Every field is authenticated by the AEAD tag. Opening with any field different
/// from the one used to seal fails — that is the anti-replay property, and it is
/// enforced by the tag rather than by a check a caller might forget to perform.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SealAad<'a> {
    /// The harbor that owns the channel.
    pub harbor_id: &'a str,
    /// The channel the payload belongs to.
    pub channel_id: &'a str,
    /// The key epoch in force when the payload was sealed.
    pub epoch: u64,
    /// The payload's position in the channel. Binding it stops a replay of an
    /// earlier message as a later one within the same channel and epoch.
    pub seq: u64,
}

impl SealAad<'_> {
    /// The canonical byte encoding fed to the AEAD as associated data.
    ///
    /// Public because a cross-implementation twin would have to reproduce it
    /// exactly, and because it is the one part of the construction worth reading
    /// before trusting the rest.
    ///
    /// # Errors
    ///
    /// [`VaultError::EmptyComponent`] if the harbor or channel id is empty, and
    /// [`VaultError::ComponentTooLong`] if one overflows the 32-bit length field.
    ///
    /// # Examples
    ///
    /// ```
    /// use pd_vault::SealAad;
    ///
    /// let here = SealAad { harbor_id: "harbor-1", channel_id: "ops", epoch: 1, seq: 0 };
    /// let elsewhere = SealAad { channel_id: "billing", ..here };
    /// assert_ne!(here.encode()?, elsewhere.encode()?);
    ///
    /// // Field boundaries are unambiguous: "ab"+"c" and "a"+"bc" do not collide.
    /// let left = SealAad { harbor_id: "ab", channel_id: "c", epoch: 1, seq: 0 };
    /// let right = SealAad { harbor_id: "a", channel_id: "bc", epoch: 1, seq: 0 };
    /// assert_ne!(left.encode()?, right.encode()?);
    /// # Ok::<(), pd_vault::VaultError>(())
    /// ```
    pub fn encode(&self) -> Result<Vec<u8>, VaultError> {
        if self.harbor_id.is_empty() {
            return Err(VaultError::EmptyComponent { field: "harbor id" });
        }
        if self.channel_id.is_empty() {
            return Err(VaultError::EmptyComponent {
                field: "channel id",
            });
        }

        unambiguous_encoding(&[
            SEAL_AAD_LABEL,
            self.harbor_id.as_bytes(),
            self.channel_id.as_bytes(),
            &self.epoch.to_be_bytes(),
            &self.seq.to_be_bytes(),
        ])
    }
}

/// Draw a fresh 24-byte nonce from the operating system CSPRNG.
///
/// At 24 bytes a random nonce needs no counter and no durable state: the
/// collision probability stays negligible far past any realistic message volume,
/// so a restore-from-backup cannot resurrect a used nonce.
///
/// # Errors
///
/// [`VaultError::Rng`] if the OS entropy source is unavailable. The kernel
/// refuses to seal rather than fall back to a weaker nonce source.
///
/// # Examples
///
/// ```
/// use pd_vault::random_nonce;
///
/// assert_ne!(random_nonce()?, random_nonce()?);
/// # Ok::<(), pd_vault::VaultError>(())
/// ```
pub fn random_nonce() -> Result<[u8; NONCE_LEN], VaultError> {
    let mut nonce = [0u8; NONCE_LEN];
    getrandom::getrandom(&mut nonce).map_err(|e| VaultError::Rng(e.to_string()))?;
    Ok(nonce)
}

/// Seal a plaintext under a channel key, bound to its context.
///
/// The nonce must be unique for the lifetime of the key. [`random_nonce`] is the
/// intended source; a nonce reused under the same key destroys confidentiality
/// for both messages sealed with it.
///
/// Returns ciphertext with the 16-byte tag appended.
///
/// # Errors
///
/// - [`VaultError::EmptyComponent`] / [`VaultError::ComponentTooLong`] if the AAD
///   cannot be encoded.
/// - [`VaultError::Seal`] if the AEAD refuses the message length.
///
/// # Examples
///
/// ```
/// use pd_vault::{derive_channel_key, open, random_nonce, seal, SealAad};
///
/// let key = derive_channel_key(&[0x11u8; 32], "harbor/alpha", 4)?;
/// let aad = SealAad { harbor_id: "harbor-1", channel_id: "harbor/alpha", epoch: 4, seq: 9 };
///
/// let nonce = random_nonce()?;
/// let sealed = seal(&key, &nonce, b"berth 4 is clear", &aad)?;
/// assert_eq!(sealed.len(), b"berth 4 is clear".len() + 16);
/// assert_eq!(open(&key, &nonce, &sealed, &aad)?, b"berth 4 is clear");
/// # Ok::<(), pd_vault::VaultError>(())
/// ```
pub fn seal(
    key: &ChannelKey,
    nonce: &[u8; NONCE_LEN],
    plaintext: &[u8],
    aad: &SealAad<'_>,
) -> Result<Vec<u8>, VaultError> {
    let associated_data = aad.encode()?;
    let cipher = XChaCha20Poly1305::new(key.as_bytes().into());
    cipher
        .encrypt(
            XNonce::from_slice(nonce),
            Payload {
                msg: plaintext,
                aad: &associated_data,
            },
        )
        .map_err(|_| VaultError::Seal)
}

/// Open a ciphertext produced by [`seal`], or fail.
///
/// Succeeds only when the key, the nonce, and every field of the associated data
/// match what was used to seal. A ciphertext lifted into another channel, another
/// epoch, another harbor, or another sequence position does not open.
///
/// # Errors
///
/// [`VaultError::Decrypt`] — always, for every cryptographic failure. Wrong key,
/// tampered ciphertext, tampered associated data, cross-channel replay,
/// cross-epoch replay, and a truncated input are one indistinguishable outcome.
/// This is deliberate; see the module docs. Structural errors about the caller's
/// own AAD arguments ([`VaultError::EmptyComponent`]) are still reported plainly.
///
/// # Examples
///
/// ```
/// use pd_vault::{derive_channel_key, open, seal, SealAad, VaultError};
///
/// let key = derive_channel_key(&[0x22u8; 32], "ops", 2)?;
/// let nonce = [0x42u8; 24];
/// let aad = SealAad { harbor_id: "harbor-1", channel_id: "ops", epoch: 2, seq: 1 };
/// let sealed = seal(&key, &nonce, b"all fast", &aad)?;
///
/// // The same ciphertext relabelled into another channel will not open.
/// let elsewhere = SealAad { channel_id: "billing", ..aad };
/// assert!(matches!(open(&key, &nonce, &sealed, &elsewhere), Err(VaultError::Decrypt)));
/// # Ok::<(), pd_vault::VaultError>(())
/// ```
pub fn open(
    key: &ChannelKey,
    nonce: &[u8; NONCE_LEN],
    ciphertext: &[u8],
    aad: &SealAad<'_>,
) -> Result<Vec<u8>, VaultError> {
    let associated_data = aad.encode()?;

    // A short input cannot carry a tag. Reported as the same opaque failure as a
    // bad tag on purpose: "too short" would tell a prober exactly where the tag
    // boundary is.
    if ciphertext.len() < TAG_LEN {
        return Err(VaultError::Decrypt);
    }

    let cipher = XChaCha20Poly1305::new(key.as_bytes().into());
    cipher
        .decrypt(
            XNonce::from_slice(nonce),
            Payload {
                msg: ciphertext,
                aad: &associated_data,
            },
        )
        .map_err(|_| VaultError::Decrypt)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::derive_channel_key;

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
    const KAT_HARBOR: &str = "harbor-kat";
    const KAT_CHANNEL: &str = "harbor/alpha";
    const KAT_EPOCH: u64 = 7;
    const KAT_SEQ: u64 = 42;
    const KAT_NONCE: [u8; NONCE_LEN] = [
        0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e,
        0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17,
    ];
    const KAT_PLAINTEXT: &[u8] = b"pd-vault known-answer payload v1";
    // Line breaks mark the encoded fields: component count, then
    // (len || label), (len || harbor), (len || channel), then the
    // fixed-width epoch and seq. Every field carries its own length, which
    // is the whole anti-ambiguity property, visible here in the bytes.
    const KAT_AAD_HEX: &str = "00000005\
         0000001070642d7661756c742f76312f7365616c\
         0000000a686172626f722d6b6174\
         0000000c686172626f722f616c706861\
         00000008000000000000000700000008000000000000002a";
    const KAT_CIPHERTEXT_HEX: &str =
        "8a0df028d33f1b412d8203db5b459600c432b7718f27653b846d194c8026f07a\
         64f66592b2ea4677a8f9269def4e41df";

    fn kat_key() -> ChannelKey {
        derive_channel_key(&KAT_HARBOR_SECRET, KAT_CHANNEL, KAT_EPOCH).unwrap()
    }

    fn kat_aad() -> SealAad<'static> {
        SealAad {
            harbor_id: KAT_HARBOR,
            channel_id: KAT_CHANNEL,
            epoch: KAT_EPOCH,
            seq: KAT_SEQ,
        }
    }

    #[test]
    fn kat_sealed_payload_is_stable() {
        assert_eq!(hex::encode(kat_aad().encode().unwrap()), KAT_AAD_HEX);

        let sealed = seal(&kat_key(), &KAT_NONCE, KAT_PLAINTEXT, &kat_aad()).unwrap();
        assert_eq!(hex::encode(&sealed), KAT_CIPHERTEXT_HEX);
        assert_eq!(
            open(&kat_key(), &KAT_NONCE, &sealed, &kat_aad()).unwrap(),
            KAT_PLAINTEXT
        );
    }

    #[test]
    fn round_trip_recovers_the_plaintext() {
        let nonce = random_nonce().unwrap();
        let sealed = seal(&kat_key(), &nonce, KAT_PLAINTEXT, &kat_aad()).unwrap();
        assert_ne!(sealed.as_slice(), KAT_PLAINTEXT);
        assert_eq!(sealed.len(), KAT_PLAINTEXT.len() + TAG_LEN);
        assert_eq!(
            open(&kat_key(), &nonce, &sealed, &kat_aad()).unwrap(),
            KAT_PLAINTEXT
        );
    }

    #[test]
    fn empty_plaintext_round_trips() {
        let sealed = seal(&kat_key(), &KAT_NONCE, b"", &kat_aad()).unwrap();
        assert_eq!(sealed.len(), TAG_LEN);
        assert!(open(&kat_key(), &KAT_NONCE, &sealed, &kat_aad())
            .unwrap()
            .is_empty());
    }

    // --- negative tests: every one of these must fail closed ---------------

    #[test]
    fn wrong_key_fails() {
        let sealed = seal(&kat_key(), &KAT_NONCE, KAT_PLAINTEXT, &kat_aad()).unwrap();
        let wrong = derive_channel_key(&[0x01; 32], KAT_CHANNEL, KAT_EPOCH).unwrap();
        assert!(matches!(
            open(&wrong, &KAT_NONCE, &sealed, &kat_aad()),
            Err(VaultError::Decrypt)
        ));
    }

    #[test]
    fn wrong_nonce_fails() {
        let sealed = seal(&kat_key(), &KAT_NONCE, KAT_PLAINTEXT, &kat_aad()).unwrap();
        let mut nonce = KAT_NONCE;
        nonce[0] ^= 0x01;
        assert!(matches!(
            open(&kat_key(), &nonce, &sealed, &kat_aad()),
            Err(VaultError::Decrypt)
        ));
    }

    #[test]
    fn tampered_ciphertext_fails_at_every_byte() {
        let sealed = seal(&kat_key(), &KAT_NONCE, KAT_PLAINTEXT, &kat_aad()).unwrap();
        for index in 0..sealed.len() {
            let mut tampered = sealed.clone();
            tampered[index] ^= 0x01;
            assert!(
                matches!(
                    open(&kat_key(), &KAT_NONCE, &tampered, &kat_aad()),
                    Err(VaultError::Decrypt)
                ),
                "flipping a bit at byte {index} was accepted"
            );
        }
    }

    #[test]
    fn truncated_ciphertext_fails() {
        let sealed = seal(&kat_key(), &KAT_NONCE, KAT_PLAINTEXT, &kat_aad()).unwrap();
        for cut in [0usize, 1, TAG_LEN - 1, TAG_LEN, sealed.len() - 1] {
            assert!(matches!(
                open(&kat_key(), &KAT_NONCE, &sealed[..cut], &kat_aad()),
                Err(VaultError::Decrypt)
            ));
        }
    }

    #[test]
    fn tampered_aad_fails() {
        let sealed = seal(&kat_key(), &KAT_NONCE, KAT_PLAINTEXT, &kat_aad()).unwrap();
        let tampered = SealAad {
            harbor_id: "harbor-kat-evil",
            ..kat_aad()
        };
        assert!(matches!(
            open(&kat_key(), &KAT_NONCE, &sealed, &tampered),
            Err(VaultError::Decrypt)
        ));
    }

    #[test]
    fn cross_channel_replay_fails() {
        // Same harbor, same epoch, same key, relabelled channel. The key alone is
        // not enough because the channel is inside the tag.
        let sealed = seal(&kat_key(), &KAT_NONCE, KAT_PLAINTEXT, &kat_aad()).unwrap();
        let elsewhere = SealAad {
            channel_id: "harbor/beta",
            ..kat_aad()
        };
        assert!(matches!(
            open(&kat_key(), &KAT_NONCE, &sealed, &elsewhere),
            Err(VaultError::Decrypt)
        ));
    }

    #[test]
    fn cross_epoch_replay_fails_even_with_the_sealing_key() {
        // Two independent barriers, asserted separately.
        let sealed = seal(&kat_key(), &KAT_NONCE, KAT_PLAINTEXT, &kat_aad()).unwrap();
        let next_epoch = SealAad {
            epoch: KAT_EPOCH + 1,
            ..kat_aad()
        };

        // 1. The next epoch's own key does not open it.
        let rotated = derive_channel_key(&KAT_HARBOR_SECRET, KAT_CHANNEL, KAT_EPOCH + 1).unwrap();
        assert!(matches!(
            open(&rotated, &KAT_NONCE, &sealed, &next_epoch),
            Err(VaultError::Decrypt)
        ));

        // 2. Nor does the ORIGINAL key when the epoch is relabelled — so an
        //    attacker who somehow holds the old key still cannot forge an
        //    epoch-n+1 message out of an epoch-n one.
        assert!(matches!(
            open(&kat_key(), &KAT_NONCE, &sealed, &next_epoch),
            Err(VaultError::Decrypt)
        ));
    }

    #[test]
    fn cross_harbor_replay_fails() {
        let sealed = seal(&kat_key(), &KAT_NONCE, KAT_PLAINTEXT, &kat_aad()).unwrap();
        let other_harbor = SealAad {
            harbor_id: "harbor-other",
            ..kat_aad()
        };
        assert!(matches!(
            open(&kat_key(), &KAT_NONCE, &sealed, &other_harbor),
            Err(VaultError::Decrypt)
        ));
    }

    #[test]
    fn sequence_replay_fails() {
        let sealed = seal(&kat_key(), &KAT_NONCE, KAT_PLAINTEXT, &kat_aad()).unwrap();
        let later = SealAad {
            seq: KAT_SEQ + 1,
            ..kat_aad()
        };
        assert!(matches!(
            open(&kat_key(), &KAT_NONCE, &sealed, &later),
            Err(VaultError::Decrypt)
        ));
    }

    #[test]
    fn every_decryption_failure_is_indistinguishable() {
        // The no-oracle invariant, asserted on the rendered message rather than
        // just the variant: a caller that logs the error must not be able to tell
        // these apart.
        let sealed = seal(&kat_key(), &KAT_NONCE, KAT_PLAINTEXT, &kat_aad()).unwrap();
        let wrong_key = derive_channel_key(&[0x01; 32], KAT_CHANNEL, KAT_EPOCH).unwrap();
        let mut tampered = sealed.clone();
        tampered[0] ^= 0x01;

        let failures = [
            open(&wrong_key, &KAT_NONCE, &sealed, &kat_aad()),
            open(&kat_key(), &KAT_NONCE, &tampered, &kat_aad()),
            open(
                &kat_key(),
                &KAT_NONCE,
                &sealed,
                &SealAad {
                    channel_id: "harbor/beta",
                    ..kat_aad()
                },
            ),
            open(
                &kat_key(),
                &KAT_NONCE,
                &sealed,
                &SealAad {
                    epoch: KAT_EPOCH + 1,
                    ..kat_aad()
                },
            ),
            open(&kat_key(), &KAT_NONCE, &sealed[..4], &kat_aad()),
        ];

        let rendered: Vec<String> = failures
            .iter()
            .map(|result| result.as_ref().unwrap_err().to_string())
            .collect();
        assert!(
            rendered
                .iter()
                .all(|message| message == "decryption failed"),
            "a failure path leaked a distinguishing message: {rendered:?}"
        );
    }

    // --- associated-data encoding ------------------------------------------

    #[test]
    fn aad_encoding_is_unambiguous_across_field_boundaries() {
        // harbor="ab"/channel="c" and harbor="a"/channel="bc" concatenate the
        // same; they must not encode the same.
        let left = SealAad {
            harbor_id: "ab",
            channel_id: "c",
            epoch: 1,
            seq: 1,
        };
        let right = SealAad {
            harbor_id: "a",
            channel_id: "bc",
            epoch: 1,
            seq: 1,
        };
        assert_ne!(left.encode().unwrap(), right.encode().unwrap());
    }

    #[test]
    fn aad_encoding_is_unambiguous_across_epoch_and_seq() {
        let left = SealAad {
            harbor_id: "h",
            channel_id: "c",
            epoch: 0x0000_0000_0000_0001,
            seq: 0x0000_0000_0000_0002,
        };
        let right = SealAad {
            harbor_id: "h",
            channel_id: "c",
            epoch: 0x0000_0000_0000_0002,
            seq: 0x0000_0000_0000_0001,
        };
        assert_ne!(left.encode().unwrap(), right.encode().unwrap());
    }

    #[test]
    fn empty_ids_are_refused() {
        assert!(matches!(
            SealAad {
                harbor_id: "",
                channel_id: "c",
                epoch: 1,
                seq: 1
            }
            .encode(),
            Err(VaultError::EmptyComponent { field: "harbor id" })
        ));
        assert!(matches!(
            SealAad {
                harbor_id: "h",
                channel_id: "",
                epoch: 1,
                seq: 1
            }
            .encode(),
            Err(VaultError::EmptyComponent {
                field: "channel id"
            })
        ));
    }

    #[test]
    fn aad_label_separates_from_the_kdf_label() {
        assert_ne!(SEAL_AAD_LABEL, crate::CHANNEL_KEY_LABEL);
    }

    #[test]
    fn distinct_nonces_give_distinct_ciphertext_for_one_plaintext() {
        let first = seal(&kat_key(), &KAT_NONCE, KAT_PLAINTEXT, &kat_aad()).unwrap();
        let mut nonce = KAT_NONCE;
        nonce[NONCE_LEN - 1] ^= 0xff;
        let second = seal(&kat_key(), &nonce, KAT_PLAINTEXT, &kat_aad()).unwrap();
        assert_ne!(first, second);
    }

    #[test]
    fn a_null_byte_in_the_channel_id_round_trips_and_does_not_collide() {
        // The module docs claim a channel id may contain arbitrary bytes,
        // including a NUL, without creating an AAD collision — the
        // length-prefixed encoding has no reserved separator byte. Prove it:
        // seal/open round-trips with a NUL embedded, and the NUL'd channel
        // does not produce the same associated data as its NUL-stripped
        // sibling (the collision a naive C-string-style encoding would have).
        let with_nul = SealAad {
            harbor_id: KAT_HARBOR,
            channel_id: "harbor/al\0pha",
            epoch: KAT_EPOCH,
            seq: KAT_SEQ,
        };
        let without_nul = SealAad {
            channel_id: "harbor/alpha",
            ..with_nul
        };
        assert_ne!(with_nul.encode().unwrap(), without_nul.encode().unwrap());

        let sealed = seal(&kat_key(), &KAT_NONCE, KAT_PLAINTEXT, &with_nul).unwrap();
        assert_eq!(
            open(&kat_key(), &KAT_NONCE, &sealed, &with_nul).unwrap(),
            KAT_PLAINTEXT
        );
        // And it must not open under the NUL-stripped AAD — that would be
        // exactly the collision this test exists to rule out.
        assert!(matches!(
            open(&kat_key(), &KAT_NONCE, &sealed, &without_nul),
            Err(VaultError::Decrypt)
        ));
    }
}
