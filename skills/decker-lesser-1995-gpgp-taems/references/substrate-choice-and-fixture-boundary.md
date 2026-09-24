# Substrate choice: source procedure versus a constructed policy

Root rechecked the institutional [TR 94-14](https://web.cs.umass.edu/publication/docs/1994/UM-CS-1994-014.pdf), §3.1 on printed p. 8 and continuation p. 9, on 2026-09-24. This targeted access supports the schedule comparison and revision sequence in [the scheduler reference](coordination-as-constraint-posting-not-control.md). It is not a new experiment or a review of all report equations.

The critical distinction is whose utility is available. A scheduler's local estimate can omit a task's contribution to another agent. The substrate retains commitment-associated estimates and can receive non-local updates; changing a commitment therefore cannot be evaluated solely by comparing two local schedule totals.

For a constructed sensitivity exercise, let a proposed replacement improve local utility by 4 while losing a commitment contribution estimated at 9 for another agent. Under a declared additive, non-overlapping utility model, the estimated change is minus 5. If that external contribution were 1, the same calculation would be plus 3. These invented values illustrate why local gain alone is insufficient; they are not report measurements, a complete GPGP implementation, or evidence that the estimates are accurate. Verify additivity and avoid double-counting before using such a calculation.

`examples/gpgp_local_models.py` contains narrow explanatory functions. Its named no-violation policy deliberately forbids a revision the source substrate might consider. Its negotiable-count tie-break is a local choice, not the report's specified aggregation formula. M1/M2 exchange information and results; M3–M5 supply applicable commitments. Local quiescence inspects the supplied local sets and cannot establish distributed termination or absence of messages in transit.

A complete implementation still needs scheduler interfaces, estimate provenance, revision alternatives, communication, and stopping semantics. These fixtures launch none of them. Treat a caller's declared record as an assumption, not evidence that an external source or protocol state was validated.
