# Context IR and continuation boundary

Each item needs immutable identity, kind, principal reference, trust class, authority envelope, scope, provenance, validity, retention, droppable flag, causal parents, optional retrieval space, obligation/effect state, capability requirements, and content digest/size/token estimate.

The partitioner does not authenticate those claims. It preserves and checks supplied references, rejects missing joins, and labels uncertainty.

`PrepareContinuation` may package assignments, authorized transfers, coverage proof, omissions, translation requirements, and a separately supplied one-use nonce. Every transferred disposition names its one authorized `sourceTargetRef`; each disclosure edge must originate there and terminate at one declared destination. A transfer proof cannot manufacture a different source. `AdmitSuccessor` belongs to a different lifecycle writer and independently checks predecessor fence, effect disposition, capacity, current guidance, context coverage, and nonce consumption.

An abstract destination slot describes requirements. It cannot contain process ID, provider session, credential, execution lease, active principal, or body generation.
