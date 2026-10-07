# Envelope and ordering contract

Every accepted envelope binds protocol, conversation, epoch, sender principal, exact body generation, audience, scope, per-sender sequence, message identity, correlation and causation, payload type and digest, observation and expiry times, verification receipt, and optional gather identity.

Canonical replay orders messages by explicit causal constraints and then by `(observedAt, senderPrincipalRef, senderSequence, messageId)` for concurrent events. The tie-break is a serialization device, not proof that one concurrent event caused another.

A byte-identical duplicate is not reduced twice. Reusing the same protocol, conversation, epoch, principal, generation, and sequence with a different message or payload digest is equivocation.

Verification receipts are inputs. This skill checks that a nonempty reference is present; it does not authenticate signatures or principals.
