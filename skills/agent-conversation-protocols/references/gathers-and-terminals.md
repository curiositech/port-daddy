# Gathers and terminals

A gather freezes its membership, policy, threshold, input kind, and reducer before the first contribution. Contributions from nonmembers or after the gather terminal fail closed.

Reducer output contains the ordered input message IDs, unresolved members, dissent message IDs, and a semantic digest. A reducer cannot emit an execution permit, identity assertion, lifecycle mutation, or external truth verdict.

The terminal fence is a sequence-checked envelope whose ID is copied into the terminal record. Once accepted, no semantic message may follow. Required acknowledgements are fixed participant references; each acknowledgement causally references the fence and comes from the exact current body generation.

`COMPLETED` requires the protocol predicate and every required fence acknowledgement. A missing acknowledgement leaves the trace `BLOCKED`. `CANCELLED` records protocol cancellation only; it does not prove an external process or effect stopped.
