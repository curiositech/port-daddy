# Envelope and ordering contract

Every supplied envelope binds protocol, conversation, epoch, sender principal, body generation, recipient principals, recipient-facing audience labels, scope, per-sender sequence, message identity, correlation/causation, payload type/digest, observation/expiry times, verification-reference string, and optional gather identity.

## Audience-label semantics

Each participant declares a nonempty audiences list of labels it accepts. Each message declares a nonempty, unique audienceLabels list. For every named recipient, every message label must appear in that recipient's list. Labels constrain this local trace namespace; they do not authenticate a recipient, grant read permission, or prove delivery.

## Supplied-sequence checks

The offline validator reads the array order supplied by the caller. It requires each non-null causation ID to refer to an earlier message in that sequence, rejects self-causation and forward/unknown parents, and requires contiguous per-sender sequence numbers. It does **not** implement a canonical replay order for concurrent events. A timestamp is checked only as an ISO date and local expiry/deadline boundary; it is not causal evidence.

A production canonical-replay contract would need a causal topological ordering, a tested stable tie-break for incomparable events, an explicit rule for per-sender sequencing, and a reducer. None is present in this schema-only validator.

## Duplicate boundary

A valid trace contains unique message IDs. The validator rejects duplicates with E_DUPLICATE_MESSAGE; it does not compare full envelope bytes and does not label an event “equivocation.” If a transport wants idempotent delivery, it must deduplicate before constructing the trace and document the byte/equality and persistence rule separately.

## Digest and receipt boundary

payloadDigest and stateDigest are checked only for the sha256 lower-hex format. The trace carries no payload bytes, reducer state, or reducer output, so neither digest is recomputed. verificationReceiptRef is checked only as a nonempty string: no cryptographic validation, identity binding, or external receipt lookup occurs.

This makes the validator useful for closed local structure and supplied-sequence semantics without overstating it as replay, delivery, or cryptographic proof.