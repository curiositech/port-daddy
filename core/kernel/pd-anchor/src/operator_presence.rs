//! Verification for FleetBar operator-presence signatures.
//!
//! FleetBar signs the daemon's exact challenge bytes with a Secure Enclave
//! P-256 key. The daemon never reconstructs or reserializes the challenge: it
//! passes the received bytes, the enrolled X9.63 public key, and the DER ECDSA
//! signature into this kernel verifier. Authorization has no TypeScript crypto
//! fallback; an unavailable kernel is an unavailable authorization surface.

use ring::signature::{UnparsedPublicKey, ECDSA_P256_SHA256_ASN1};
use thiserror::Error;

/// CryptoKit's `P256.Signing.PublicKey.x963Representation` is an uncompressed
/// SEC1 point: 0x04 followed by the 32-byte X and Y coordinates.
pub const X963_PUBLIC_KEY_BYTES: usize = 65;
/// DER-encoded P-256 signatures are at most 72 bytes. Keep a small explicit
/// ceiling so pathological input is rejected before it reaches the verifier.
pub const MAX_DER_SIGNATURE_BYTES: usize = 80;
/// Recovery challenges are intentionally bounded coordination records, not a
/// general document-signing API. JSON FFI hex encoding doubles this size.
pub const MAX_CHALLENGE_BYTES: usize = 64 * 1024;

#[derive(Clone, Copy, Debug, Error, PartialEq, Eq)]
pub enum OperatorPresenceError {
    #[error("operator presence public key must be a 65-byte uncompressed X9.63 P-256 point")]
    InvalidPublicKey,
    #[error("operator presence challenge is empty")]
    EmptyChallenge,
    #[error("operator presence challenge exceeds the 64 KiB limit")]
    ChallengeTooLarge,
    #[error("operator presence signature is empty or exceeds the DER size limit")]
    InvalidSignatureEncoding,
    #[error("operator presence signature did not verify for the exact challenge bytes")]
    InvalidSignature,
}

impl OperatorPresenceError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::InvalidPublicKey => "INVALID_PUBLIC_KEY",
            Self::EmptyChallenge => "EMPTY_CHALLENGE",
            Self::ChallengeTooLarge => "CHALLENGE_TOO_LARGE",
            Self::InvalidSignatureEncoding => "INVALID_SIGNATURE_ENCODING",
            Self::InvalidSignature => "INVALID_SIGNATURE",
        }
    }
}

/// Verify one Secure Enclave signature over the exact bytes supplied by the
/// daemon. `ring` performs SHA-256 + ECDSA P-256 verification and requires an
/// ASN.1 DER signature. No normalization, JSON parsing, or hashing happens in
/// this function before verification.
pub fn verify_operator_presence_signature(
    public_key_x963: &[u8],
    signature_der: &[u8],
    challenge: &[u8],
) -> Result<(), OperatorPresenceError> {
    if public_key_x963.len() != X963_PUBLIC_KEY_BYTES || public_key_x963[0] != 0x04 {
        return Err(OperatorPresenceError::InvalidPublicKey);
    }
    if challenge.is_empty() {
        return Err(OperatorPresenceError::EmptyChallenge);
    }
    if challenge.len() > MAX_CHALLENGE_BYTES {
        return Err(OperatorPresenceError::ChallengeTooLarge);
    }
    if signature_der.is_empty() || signature_der.len() > MAX_DER_SIGNATURE_BYTES {
        return Err(OperatorPresenceError::InvalidSignatureEncoding);
    }

    UnparsedPublicKey::new(&ECDSA_P256_SHA256_ASN1, public_key_x963)
        .verify(challenge, signature_der)
        .map_err(|_| OperatorPresenceError::InvalidSignature)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PUBLIC_KEY: &str = "04f3385b5cd2dcc139e29e813df7609cdc2eddc16948aeebfcd946d14a32b11cc075fe887e81da93d221b3faa1c0c915cd8d9410d5cffc99714897367cb8f84bff";
    const SIGNATURE: &str = "3045022100daa6fe68875717027c47581de53ba12b0f034e42801a0fc7eb0dc7a6e60e9f0502200dafedd299acbb67a7cf21448d47e16754ac51d217c2f84aa19c279000076789";
    const MESSAGE: &[u8] = b"port-daddy operator presence vector v1";

    #[test]
    fn fixed_cryptokit_encoding_vector_verifies() {
        verify_operator_presence_signature(
            &hex::decode(PUBLIC_KEY).unwrap(),
            &hex::decode(SIGNATURE).unwrap(),
            MESSAGE,
        )
        .unwrap();
    }

    #[test]
    fn wrong_message_and_key_fail_closed() {
        let key = hex::decode(PUBLIC_KEY).unwrap();
        let signature = hex::decode(SIGNATURE).unwrap();
        assert_eq!(
            verify_operator_presence_signature(&key, &signature, b"different bytes"),
            Err(OperatorPresenceError::InvalidSignature)
        );

        let mut wrong_key = key;
        wrong_key[32] ^= 0x01;
        assert_eq!(
            verify_operator_presence_signature(&wrong_key, &signature, MESSAGE),
            Err(OperatorPresenceError::InvalidSignature)
        );
    }

    #[test]
    fn malformed_and_oversize_inputs_fail_before_crypto() {
        let key = hex::decode(PUBLIC_KEY).unwrap();
        let signature = hex::decode(SIGNATURE).unwrap();
        assert_eq!(
            verify_operator_presence_signature(&key[..64], &signature, MESSAGE),
            Err(OperatorPresenceError::InvalidPublicKey)
        );
        assert_eq!(
            verify_operator_presence_signature(&key, &[], MESSAGE),
            Err(OperatorPresenceError::InvalidSignatureEncoding)
        );
        assert_eq!(
            verify_operator_presence_signature(&key, &signature, &[]),
            Err(OperatorPresenceError::EmptyChallenge)
        );
        assert_eq!(
            verify_operator_presence_signature(
                &key,
                &signature,
                &vec![0_u8; MAX_CHALLENGE_BYTES + 1]
            ),
            Err(OperatorPresenceError::ChallengeTooLarge)
        );
    }
}
