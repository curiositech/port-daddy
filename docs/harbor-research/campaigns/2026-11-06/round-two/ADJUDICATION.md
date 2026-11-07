# Adjudication: dispatch writer coverage and atomic binding

Dated 6 November 2026, America/Los_Angeles. Lead: codex:/root. Base: `8ec96b55a7e048e6f18a472a54e94fcd1c150e41`. Worktree: `research-admission-binding-20261106`, branch `codex/research-admission-binding-20261106`.

**Accepted within the stated domain:** the real queue's registered synchronous mutations and Harbormaster conflict-recovery write use exact, fresh, single-use admission inside a SQLite transaction. The reviewed source inventory is complete for the candidates discovered by its specified TS/JS/SQL scanner and pinned lifecycle boundaries. This is not universal writer discovery, privileged database confinement, deployed-runtime evidence, or atomic remote action.

## Independent verification

Root read the production controller, queue registry, rollback caller, Harbormaster conflict path, seed/retention changes, independent source scanner, findings and formal contract. Root then executed the final checks against the same worktree:

| Evidence | Result | Interpretation |
| --- | --- | --- |
| Real implementation, lifecycle and regression suites | 269 tests, 10 suites, all pass | Includes 42 independent red cases, seed reconstruction, ordinary retention and restrictive-policy acceptance |
| Actual SQLite runtime adapter | 7 cases each under Node 22.17.1 and Bun 1.2.21 | Two connections per run; native SQLite 3.53.2 and compatibility adapter SQLite 3.51.0 |
| Full TypeScript check | Pass, no diagnostics | Isolated exact dependency overlay; no shared installation changes |
| Source-contract audit | 89 reviewed sites/boundaries, 1,784 scanned source files | Syntax-bounded audit, not 82 admitted APIs or a dataflow proof |
| Source-gate mutation controls | 16 pass | Unknown/changed/omitted writers, schema and wrapper/selector changes refuse |
| TLC binding model | 31 configurations pass; 602 states in defended exploration | 15 exact acceptance/rejection controls and 15 deliberately weakened counterexamples |
| TLC output validator | 9 tests pass | Wrong, partial or unrelated solver outcomes cannot count as the expected evidence |

Root's TLC run is `.cache/atomic-admission/run-m6ek06s7`; retained white inputs and final traces are byte-inventoried separately. Root command outputs are retained under `root-evidence/`. The first combined Jest invocation used a nonexistent `.js` filename for an existing `.ts` retention suite: 262 tests passed but the command failed. The corrected invocation passed all 269; the initial failure is retained as a harness error, not a product defect or success. Typecheck dependency failures are likewise preserved in blue's report.

The general conditional simulation argument is stated in [the research result](../../../research/dispatch-admission-binding.md) and white's contract. TLC does not prove that general theorem or all source-level premises. The source audit, concrete controls and formal abstraction provide complementary evidence.

## Findings disposition

| Finding | Disposition |
| --- | --- |
| RED-R2-ID: wrong affected dispatch | Reproduced in a faulty registered handler; fixed with exact ID binding; independent red and root retests pass |
| RED-R2-GENERIC: retention target escape | Callable helper gap fixed; 36 refusal/positive controls pass; no active production dispatch-retention registration was alleged |
| RED-01: successful Harbormaster merge across awaits | Open: external-effect authority |
| RED-02: auto-merge stale snapshot | Open: external-effect authority |
| RED-03: recovery lets an old worker join a new run | Open: run/lease ownership; state/revision freshness alone is insufficient |
| RED-04: selection outside recovery transaction | Closed for the registered synchronous queue API: the compulsory immediate transaction encloses selection and mutation; privileged raw SQL remains outside |
| RED-05: failover successor after cancellation/deletion | Open: successor/effect ownership and revocation |
| RED-06: cancellation does not revoke Conductor work | Open: external launch/cancellation protocol |
| RED-07: inline adapter external effects | Open: alternate launch/worktree/PR effect authority |
| RED-08: approval ABA overwrites conflict recovery | Closed for the local conflict write: its original revision-bound handle is issued before await; not a guarantee for successful GitHub merge |
| RED-09: settlement exceeds model | Complete operation graph includes legitimate shortcuts; terminal failed and rejected-to-settled escalation refuse; production tests pass |
| RED-10: seed resurrects legacy work | Reproduced on actual SQLite in both copy modes, fixed and independently retested |
| RED-11: copied database restores authority | New controller rejects foreign opaque handles; active-process restoration of old storage/clock bytes remains outside the non-reuse premise |
| Fresh authority around stale rollback inputs | Closed by issuing rollback permission before await and refusing public raw restoration issuance; formal mutant and actual API controls retained |
| Reentrant journal deletion/policy replacement | Current controller detects missing observation coverage or changed authority and rolls back; independent controls pass |

## Trust, privacy and preservation

The descriptor registry, root/target functions, synchronous callbacks, schema owner and SQLite connection remain trusted. A thenable refusal does not confine arbitrary JavaScript continuations. The empty default policy forbids no state. A state-only abstraction says nothing about lease ownership, semantic work quality, cost, truthful artifacts or arbitrary deontic obligations. The global clock deliberately invalidates unrelated pending admissions; no performance or liveness theorem is asserted.

The local Port Daddy runtime stayed halted. Test effects were synthetic and no provider, worker, daemon or GitHub merge was invoked by the tests. Tool-native teams shared a host; separation was procedural, not OS-enforced privacy. Public reports and raw solver/test outputs are retained. Visible root/team transcript prefixes are saved privately with hashes and explicit exclusions for hidden reasoning, credentials and unrelated records. Their manifest records the capture cutoff; it does not claim to contain future conversation. Hash inventories establish byte consistency, not signatures or authorship.

## Delivery and next experiment

Local acceptance, hosted checks, protected merge and public deployment are separate gates. The linked PR and public war-room receipt carry delivery status; this pre-merge report does not assert a deployment. No book manuscript or published PDF changed. The buildable source archive is refreshed only because its proof-corpus manifest includes this result.

Next: bind run/lease ownership and a durable effect intent to an independently checked external action. Begin with the real successful-merge path: revoke between each awaited command, preserve the exact reviewed artifact/head, and require either a final remote authority check or an explicit impossibility boundary. An outbox alone is not a distributed transaction.
