# Protocol and authority details

The manager receives a packet receipt; it never mints one. The supplied record binds proposals, reviews, corrections, beats, dissent, and manager submission to the packet digest; claims inherit that enclosing context. Extraction has no separate typed record in this schema. The digest binds selected bytes, not truth or occurrence of the described activity. Late evidence produces packet invalidation, resealing, and downstream restart.

Dissent statuses are `OPEN`, `INCORPORATED`, `RETAINED`, `REJECTED_WITH_EVIDENCE`, and `WITHDRAWN_BY_ORIGINATOR`. Only the originator may withdraw under the protocol. This schema has no authenticated withdrawal event, so the checker validates the status label without establishing that actor authority. The manager submission references every open or retained dissent item.

Fresh Engineering, Product, and Design authors must be identity-distinct from position authors, reciprocal reviewers, correction authors, and the manager. Identity distinction is necessary but not sufficient evidence of cognitive independence.

An external decision reference is nullable during manager submission. External acceptance is not a manager status in this schema; a non-null reference names evidence for separate inspection, without proving that acceptance occurred. External acceptance still says nothing about runtime containment or effect authority.
