# Atomic dispatch admission and writer coverage

Research date: 6 November 2026. Omni records: NEXT-P6 and ADMISSION-BINDING-20261106. Evidence: [round-two adjudication](../campaigns/2026-11-06/round-two/ADJUDICATION.md).

## What this permits

A local dispatch mutation can consume a decision only while the database and installed policy/model still match the state assessed for that exact operation, arguments and affected dispatch IDs. Cancellation followed by reapproval, metadata edits, row replacement, policy replacement and reused receipts cannot silently reuse that permission. A rejected operation rolls back its database writes. This makes a finite future-state check useful at a real effect boundary.

The implemented policy is deliberately narrow: forbidden dispatch states. A fully explored future graph with no forbidden state is safe; a reachable forbidden state is unsafe; exhausted exploration is unknown. Only safe complete results admit. The empty default forbidden set imposes no substantive prohibition; it still checks freshness, request binding and transition conformance. This is not the full deontic R17 language or authorization of a remote launch or merge.

## Mechanism and conditional claim

The production queue and Harbormaster conflict recovery share `createDispatchAdmission`. A private, one-use handle binds copied arguments, operation, allowed affected IDs, assessed states, durable revision, authority epoch, and canonical policy/model bytes. Three SQLite triggers advance the global revision on every dispatch insertion, update and deletion, including metadata stutters. Comparison, the registered synchronous effect and the transition-journal checks occur in one immediate write transaction. Preparation issues the rollback handle before the caller awaits; old row snapshots cannot mint a fresh rollback permission.

SQLite serializes writers; `BEGIN IMMEDIATE` reserves the write transaction before its reads and can refuse with `SQLITE_BUSY`. These are prerequisites supplied by the database, not new concurrency results. See the primary [transaction documentation](https://www.sqlite.org/lang_transaction.html) and [isolation documentation](https://www.sqlite.org/isolation.html). The implementation tests also exercise separate connections and the actual adapters.

**Conditional safety statement.** Suppose (1) every mutation in the declared domain uses the registry, (2) the clock and authority epoch never reset or reuse a value, (3) triggers and synchronous transaction semantics are intact, (4) each concrete state change simulates an operation-labeled model edge or permitted stutter, and (5) policy depends only on retained state labels. If complete exploration returns safe and its original handle commits, the committed request is the assessed request at the same authority state; every represented future concrete trace avoids the forbidden labels.

For freshness, equal strictly increasing revision excludes any intervening committed dispatch write; epoch and canonical bytes similarly bind authority. For policy transfer, initial coverage and repeated step simulation map any in-domain concrete trace to a reachable abstract trace. Complete safe exploration excludes forbidden labels on that trace. The transaction prevents an intervening writer between comparison and effect. This is a standard conditional simulation and transactional validation argument. The bounded TLC model tests its binding abstraction; it does not mechanically prove these implementation premises.

## Coverage and adversarial findings

The source gate inventories recognized TypeScript/JavaScript SQL syntax, SQL migrations, and explicitly pinned lifecycle functions and selectors. Every discovered candidate must have the exact reviewed classification and content hash. Changing a writer, deleting a wrapper or adding an unclassified candidate fails the gate. Generated SQL with no recognizable source syntax, other languages, native filesystem writes and arbitrary privileged connections are outside that completeness claim.

The adversarial round produced repairs with concrete witnesses:

- A receipt for one dispatch could accompany a faulty handler writing another in the same state. The journal now checks affected IDs as well as states and operation edges.
- Seeding a database could clear current dispatches but retain legacy jobs, which queue construction then imported. Both executable queues are cleared transactionally in either seeding mode.
- Generic retention builders accepted dispatch/control table names. They now reject protected tables and ambiguous identifiers while ordinary retention remains functional.
- Refreshing a rollback receipt around retained old snapshots could defeat freshness. Rollback now consumes the original handle; public raw restore issuance is refused.
- Missing or replaced clock triggers, mutable registry descriptors, authority changes inside effects and missing journal observations receive explicit rejection controls.

The [red report](../campaigns/2026-11-06/round-two/red/FINAL.md), [white report](../campaigns/2026-11-06/round-two/white/REPORT.md) and [blue report](../campaigns/2026-11-06/round-two/blue/implementation-report.md) retain the concrete cases, including limitations and failed exploratory attempts.

## Remaining work

The global revision is conservative: an unrelated dispatch write invalidates a pending handle. No throughput, fairness or liveness benefit is established. Raw SQL can bypass admission while advancing the revision. A privileged schema owner or an active-process rollback of database/clock bytes violates the trusted-authority premise. A source scan does not confine those actors.

The next result needs run/lease identity and effect authority across awaits. An old worker may request a freshly checked operation unless ownership rejects it. Successful GitHub merge, auto-merge, Conductor launch/cancellation and failover effects are not made atomic with SQLite by this controller. Their safety requires an explicit external protocol, replay and cancellation tests, and an effect receipt at the actual authority boundary. They remain open in Omni.
