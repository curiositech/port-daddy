# Gathers and terminals

A protocol design freezes a gather's membership, policy, threshold, input kind, reducer, and deadline before contributions. The offline validator checks the declared members, policy/reducer enums, quorum shape, contribution kind, one contribution per member/gather, and that a contribution's observedAt is not after the gather deadline. It does not invoke a reducer or inspect a payload.

ALL requires one accepted contribution from every declared member; QUORUM uses the declared integer threshold; FIRST_SUCCESS requires the FIRST_BY_CANONICAL_ORDER reducer label. That label is a design declaration only: because canonical ordering and payload success semantics are not implemented, the validator does not select a winner or assert success.

A production reducer should retain ordered input IDs, unresolved members, dissent IDs, and a semantic result. This trace schema does not contain reducer output or payloads, therefore a terminal stateDigest is format-checked input rather than evidence of a recomputed semantic state.

## Terminal fence and acknowledgement

The validator requires exactly one TERMINAL_FENCE whose ID matches the terminal record. Only ACK messages may occur later, and each ACK must be after the fence and directly caused by it. Declared acknowledgement references must be unique known participants, must be a subset of the required set, and must have matching ACK evidence. COMPLETED additionally requires all required acknowledgements, all gather thresholds, and an empty unresolvedParticipants array.

An acknowledgement is protocol receipt in this supplied trace only. It does not prove transport delivery, storage, reducer application, lifecycle transition, payment, task completion, or an external effect. CANCELLED similarly records local protocol cancellation rather than a remote halt.