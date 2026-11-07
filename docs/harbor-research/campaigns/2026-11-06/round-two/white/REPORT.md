# White report: atomic dispatch admission, round two

The defended finite model completes with **602 distinct states**, one valid accepted effect, fifteen exact acceptance/rejection controls, and fifteen exact counterexamples to deliberately weakened gates. This supports the represented receipt-binding mechanism. It does not establish unbounded implementation safety, complete arbitrary-SQL mediation, or authority over worker launches and GitHub effects. Root owns acceptance of the combined White/Blue/Red evidence.

Work used `/Users/erichowens/coding/tmp/research-admission-binding-20261106`, branch `codex/research-admission-binding-20261106`, linked Git directory `/Users/erichowens/coding/port-daddy/.git/worktrees/research-admission-binding-20261106`, baseline `8ec96b55a7e048e6f18a472a54e94fcd1c150e41`. These were verified before writes. White edited only this directory and the two named Python checker/test scripts. No local Port Daddy runtime, hook, app, provider, or agent process was started. Team separation on this shared host is procedural.

## Concrete contract

The agreed implementation boundary is one registered, synchronous dispatch database mutation. The controller stores canonical policy/model bytes and an authority epoch; SQL triggers advance a durable global revision after every dispatch insertion, update or deletion. A process-local opaque receipt binds its issuing controller, exact operation, cloned arguments, checker decision, revision, policy/model and epoch. `prepare` issues it; `commit` burns it, acquires the SQLite write reservation, compares current authority, executes the original operation, checks its observed journal transitions, and commits. Ordinary queue methods go through `run`. A failed transaction rolls back database changes; a burned receipt cannot be retried.

The global clock deliberately invalidates on metadata-only writes and visible-state stutters. State ABA and delete/recreate therefore cannot revive a token. Canonical policy/model replacement advances the epoch; policy A → B → A cannot revive a token even though the final bytes match. Omitted or identical installation may retain the current epoch. An opaque handle from another controller is not authority, including after constructing a controller over a copied database.

Rollback needs an additional provenance condition. `prepareForRun` returns the prepared dispatch together with a rollback receipt issued after its write and before the caller awaits. `restorePreparedRun` consumes that original receipt. Fresh public issuance of the raw restoration operation and the former caller-snapshot overload are excluded. Merely checking current authority around old `before`/`prepared` snapshots would admit the rollback-refresh mutant below.

The executable policy in this slice is the restricted `forbiddenStates` specification, with an explicit exploration budget. The default empty forbidden set establishes transition and freshness checks; it asserts no substantive prohibition. A requested forbidden state reached by the complete future graph yields `unsafe`; exhausted exploration yields `unknown`; neither may commit. This is not arbitrary R17/deontic policy enforcement.

See [CONTRACT.md](CONTRACT.md) for preregistered requirements. The implementation mapping is `lib/dispatch/admission.ts` (`prepare`, `commit`, `run`, trigger installation and transition journal), `lib/dispatch/queue.ts` (mandatory registry plus rollback receipt), and the Harbormaster conflict-recovery receipt. Blue's concrete execution controls and Red's independent inventory remain separate evidence.

## Conditional refinement statement

Let `C` be the committed concrete dispatch database states, `M` the declared abstract workflow states, and `α` retain the dispatch state labels relevant to the installed policy. Let the concrete steps be exactly the named registered synchronous mutation domain, including construction imports explicitly admitted through the controller. The transfer argument requires all of the following:

1. **Initial coverage.** Every row created or touched by an operation belongs to its assessed roots or a represented creation edge. Multiple-row operations assess all potentially affected rows. A missing row does not allow an unassessed insertion.
2. **Step simulation.** Every successful concrete step maps under `α` to the corresponding operation-labeled edge or a label-preserving stutter. The journal checks every actual triggered step before commit; an omitted, mismatched or unassessed transition aborts the transaction. A complete source inventory is additional evidence for the chosen domain, not a proof about arbitrary SQL programs.
3. **Policy relevance.** The policy depends only on the retained labels. For this implementation that is membership of dispatch state in `forbiddenStates`. Lease ownership, timestamps, transcript identity, costs and other omitted fields cannot silently acquire policy meaning. The graph may overapproximate eligibility and retry possibilities; it may not omit a real successor.
4. **Sound check.** A `safe` result means complete exploration of the chosen finite model from those roots finds no forbidden state. Unsafe, unknown, malformed and incomplete decisions do not confer authority. Checker/model version identity denotes the installed executable semantics.
5. **Fresh, exact atomic consumption.** The global clock and authority epoch never reuse values within the live database authority. Every committed dispatch DML step advances the clock. The receipt is genuine, immutable, single use and bound to the originally authorized operation/input provenance. The equality checks, application and journal validation occupy one serialized write transaction.

Under these hypotheses, a successful commit has the same assessed database/authority state as issuance and applies the same request. Any concrete future trace within the declared domain has an abstract trace by repeated step simulation. Since `safe` excludes forbidden labels on every reachable abstract state, that concrete trace has no such label. This is a conditional simulation argument. The TLC run below checks a small binding abstraction; it is not a machine-checked proof of this general statement or of the five implementation hypotheses.

Strictly increasing revision gives the freshness implication without an arbitrary trace-length bound: equal revision excludes an intervening committed DML step, provided overflow fails closed and no privileged reset occurs. A new opaque controller rejects old handles after storage recreation. **Restoring old database/clock bytes while keeping the same live controller and token is outside that premise**: issue at revision `r`, revoke, restore the old database to `r`, then consume can pass equality. The model's missing-clock mutants illustrate the violated premise; they do not demonstrate protection against active-process database restoration.

## Model and controls

[AtomicAdmission.tla](AtomicAdmission.tla) has one token, one abstract row, at most two environmental dispatch writes, and at most two authority changes. Row content and operation descriptors are two-valued abstractions. The checker decision is `safe`, `unsafe` or `unknown`, with explicit completeness. One `Commit` action represents the complete SQLite transaction. A dedicated no-op replay configuration consumes the token without advancing the database revision; the ordinary positive acceptance control includes a physical abstract write. An independent ghost write counter records actual interference even in mutants that fail to advance the stored revision.

The main configuration explores all represented environmental writes, deletion/recreation, policy/model changes, policy ABA, request substitution and decision classes. It reports 998 generated states, 602 distinct states, zero queued states and no violated invariant. TLC's state exploration uses fingerprints; this is its completed finite-model verdict, not an unbounded theorem.

Inverted invariants make acceptance and rejection controls nonvacuous: they must return the exact named counterexample and every full scalar state must match a separately written concrete trace oracle. A generic nonzero exit, parser failure, unrelated invariant or empty trace fails the gate.

| Control family | Defended witness | Deliberate weakening and observed result |
| --- | --- | --- |
| Fresh safe, complete receipt | Issue → commit; effect count is one | Positive acceptance, no mutation fault |
| Intervening write | Issue → write → reject | Omit revision check: stale commit |
| State ABA | Issue → write → write → reject | Omit revision check: ABA commit |
| Delete/recreate | Issue → delete → recreate → reject | Omit revision check: recreated-row commit |
| Policy replacement | Issue → policy change → reject | Omit authority tuple: commit under new policy |
| Model replacement | Issue → model change → reject | Omit authority tuple: commit under new model |
| Policy A → B → A | Issue → change → restore → reject | Omit authority tuple: stale policy-generation commit |
| Split check/effect race | Issue → validate → write → reject | Consume earlier validation without recheck: stale commit |
| Unsafe, unknown, incomplete | Each issues a result and rejects | Omit decision/completeness guard: each commits |
| Request substitution | Issue → substitute → reject | Omit request binding: substituted operation commits |
| Receipt replay | Both a mutating commit and a no-op commit reject replay; admitted invocation count remains one; no-op revision stays zero | No replay mutant asserted; no-op control isolates single use from revision advancement |
| Missing trigger clock | Defended write, ABA and recreation controls reject | Three mutants retain the stored clock; all commit despite ghost-observed writes |
| Stale rollback input provenance | Issue before await → two writes → reject | Refresh revision around retained old inputs → commit; exact six-state witness |

There are **31 configurations**: the complete defended exploration, **15** concrete acceptance/rejection controls and **15** mutant counterexamples. The authority mutant removes the tuple comparison as a unit; dropping only the policy comparison while retaining an independently advanced epoch would not necessarily break the gate. The report does not count redundant-protection mutants as failures they did not demonstrate.

The model abstracts the policy checker and operation/journal relation. It does not model all ten dispatch states, full row fields, multiple rows or simultaneous issued receipts, SQLite internals, crash recovery, unbounded epochs, storage replacement, trigger tampering, callback scheduling, or multiwrite rollback. Blue's real SQLite tests are required for the corresponding concrete mechanisms. A single transaction's intermediate journal rows are not separately observable committed states in this abstraction.

## Reproduction and evidence

Run from a verified dedicated linked worktree:

```sh
python3 -B scripts/harbor-research/check_atomic_admission_model.py \
  --java /opt/homebrew/opt/openjdk/bin/java \
  --jar /Users/erichowens/coding/tmp/research-program-next-result-20261106/.cache/admission-revision/tools/tla2tools-1.8.0.jar
python3 -B -m unittest discover -s scripts/harbor-research \
  -p test_atomic_admission_model.py -v
```

The Java and jar arguments are reusable local tool paths, not required installation locations. The runner accepts other explicit compatible paths, reads them without modifying them, confines generated traces and Java temporary files to the assigned worktree's `.cache/atomic-admission`, snapshots model and checker inputs, and preserves complete stdout/stderr plus command arrays. It uses one TLC worker, a 512 MiB Java heap and a 30-second timeout per configuration. No downloader or installer runs.

Final retained run: [evidence/final/summary.json](evidence/final/summary.json), copied from `.cache/atomic-admission/run-glufmeu_`. The final model SHA-256 is `96240af208968beed1701c02f9a7e0a0e975e40b41685ff03763d1cc13f78b18`; checker SHA-256 is `13fcf880bfd0b9452240684308fcfe12d3ca75a618dd9f353b426ec37a30a098`; the exact reused TLC jar SHA-256 is `e1f11b75c4b5bc4478ba0ac5cb6ae28e40a01b0016bc33e0aa97da22dfdbcd7f`. The filename is not a release attestation; the logs retain the tool's actual version string.

The **nine evidence-validator unit tests** pass. They reject vacuous/partial exploration, wrong exits/invariants, tool errors, malformed or duplicate state assignments, nonconsecutive states, wrong concrete witnesses, missing/duplicate summaries, contradictory verdicts and unexpected stderr. These test evidence interpretation; they do not independently verify the entire TLA semantics.

An early mutant run failed because an unparenthesized disjunction left `badEffect` unspecified. The checker refused that output; it was not counted as a counterexample. [evidence/rejected-model-attempt](evidence/rejected-model-attempt/summary.json) preserves the faulty model/checker snapshot and exact failing output. Parentheses corrected the model, followed by full reruns. The earlier epoch-only reinstall control was also replaced with policy ABA to match the implementation's actual identical-configuration semantics.

[evidence-index.json](evidence-index.json) inventories 106 retained files by byte count and SHA-256. This inventory establishes byte consistency only. It is not a signature, privacy proof, independently anchored seal, or proof that all possible relevant inputs were selected. Root's campaign sealing and adjudication remain separate.

## Residual boundaries

Raw SQL through a privileged connection can bypass admission while advancing the clock. Bootstrap migrations, copied databases, seeding, backup restoration and schema replacement require explicit lifecycle classification; they are not silently covered by queue wrappers. Trigger integrity and non-reset authority are trusted. A source scanner can flag new or changed writer sites in its language/path domain; it cannot prove the absence of arbitrary generated SQL or a privileged external writer.

The receipt covers database mutation freshness, not a run/lease ownership claim. Older workers can still request a newly admitted operation unless a separate ownership rule refuses them. Cancellation of an awaited Conductor launch, failover creation, worktree effects, auto-merge and successful GitHub merge require their own effect authority and idempotency boundaries. Harbormaster's protected conflict database write does not make its earlier/later external commands atomic with SQLite. Those concerns remain visible rather than being represented as closed by this result.
