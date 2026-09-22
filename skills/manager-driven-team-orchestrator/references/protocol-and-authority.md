# Protocol and authority details

The manager receives a packet receipt; it never mints one. Every proposal, review, extraction, correction, beat, claim, and dissent binds that packet digest. Late evidence produces packet invalidation, resealing, and downstream restart.

Dissent statuses are `OPEN`, `INCORPORATED`, `RETAINED`, `REJECTED_WITH_EVIDENCE`, and `WITHDRAWN_BY_ORIGINATOR`. Only the originator may withdraw. The manager submission references every open or retained dissent item.

Fresh Engineering, Product, and Design authors must be identity-distinct from position authors, reciprocal reviewers, correction authors, and the manager. Identity distinction is necessary but not sufficient evidence of cognitive independence.

An external decision reference is nullable during manager submission. A record claiming external acceptance without one is invalid. External acceptance still says nothing about runtime containment or effect authority.
