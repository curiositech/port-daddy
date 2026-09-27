# Monitoring boundary and evaluation contract

For each property, pin its version, state/event source, covered transitions, state authority, ordering/clock assumptions, missing-event behavior, monitor-health witness, and claimed decision latency. For each consequential effect, inventory every path and identify the independently controlled decision point that checks a fresh verdict before dispatch. An after-the-fact alert is detection only.

Return `UNKNOWN/INDETERMINATE` when events are missing, state is stale, ordering is ambiguous, or the monitor's integrity is in doubt. Timeout indicates suspected failure only. Reconcile from independent authoritative state before recovery/retry. Keep event time and ingest time distinct.

A finite injected corpus supports a claim about those declared cases. It does not establish general correctness. Choose corpus size, false-positive policy, cadence, latency budget, and crash response from the property and deployment objective; measure the selected implementation and report the observed distribution.

**Accessed:** 2026-09-24. Source limits: Schneider, [Enforceable Security Policies](https://doi.org/10.1145/353323.353382) (2000; abstract/source-identity depth); NIST [SP 800-137](https://csrc.nist.gov/pubs/sp/800/137/final) (2011; official guidance); Chandra and Toueg, [Unreliable Failure Detectors](https://hdl.handle.net/1813/7192) (1996; source identity/research summary depth). These sources do not provide universal thresholds for a specific monitor.
