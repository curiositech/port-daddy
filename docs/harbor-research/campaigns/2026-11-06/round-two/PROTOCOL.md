# Round two: dispatch writer coverage and atomic admission

Date: 6 November 2026 (America/Los_Angeles). Parent result: PR #10359, base commit 8ec96b55a7e048e6f18a472a54e94fcd1c150e41. Canonical research work: NEXT-P6 in Omni.

The claim under examination is that every in-scope implementation mutation is represented by the transition model, and admission cannot be consumed after the checked state, model or policy has changed. A graph traversal alone establishes neither premise.

## Plan and ownership

- [x] Red inventories every production dispatch writer, bootstrap/migration/destruction path and external-effect caller, then constructs independent attacks.
- [x] Root and white fix the scope and admissibility contract; blue implements one coherent production mutation boundary.
- [x] Blue exercises real SQLite methods; red challenges omitted writers, stale/ABA/replayed decisions and identity/policy substitutions; white checks the abstraction with positive and negative model controls.
- [x] Root independently verifies, adjudicates findings, updates Omni and publishes reproducible evidence.
- [ ] Exact-head reviews/checks, normal protected rebase merge, and production readback establish delivery separately from scientific claims.

Red owns discovery and independent attacks. White owns the safety argument, assumptions and bounded model. Blue owns production dispatch code and implementation tests. Root owns integration, ledger and final adjudication. No team closes its own finding.

## Execution and evidence boundaries

All work uses the linked research-admission-binding-20261106 worktree and codex/research-admission-binding-20261106 branch. The local Port Daddy runtime stays halted. The remote Register returned HTTP 401; no authenticated claim is asserted. No local daemon, agents, providers or actual Git merge effects are run by tests. SQLite tests use synthetic databases and injected effects.

Team separation on this host is procedural, not OS privacy. No private-team confinement claim is made. Only reviewed synthetic workloads run here. Visible interactions, command results and short public rationales are retained; hidden reasoning, credentials and unrelated conversations are excluded. The existing transcript exporter and evidence recorder preserve declared prefixes and hash consistency, not signatures or a completeness proof.

Coverage must name its domain. A source inventory cannot exclude arbitrary privileged SQL, schema replacement or external process effects. Any residual trusted administrative boundary, initialization exception or incomplete observation remains explicit. Missing/unknown proof results cannot authorize an effect. Valid admission, cancellation/recovery, stale rejection, ABA, policy/model replacement, replay and rollback controls are mandatory.
