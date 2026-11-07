# RED report: 2026-11-06-R1

Three concrete modeling findings concern the historical isolation artifact. The bounded admission model passes its stated property and all declared reachability controls. The optional finite Python sweep found no counterexample in its tested family. Controls below are not research discoveries.

## Scope and provenance

Worktree `/Users/erichowens/coding/tmp/research-program-next-result-20261106`, branch `codex/research-program-next-result-20261106`, linked gitdir `/Users/erichowens/coding/port-daddy/.git/worktrees/research-program-next-result-20261106` were verified before writes. RED wrote only this directory and did not read WHITE/BLUE/coordinator findings. Local Port Daddy remained halted. No hostile host code was executed. These are host-reviewed model processes with **procedural blindness, not OS privacy**.

Authoritative Gate-A inputs are `../packet-r1/manifest.json`. Isolation SHA-256: `7c492e6788eb9492d188a1cf39f13376321ab881ba0b3002c52afecf08a7702f`. Admission model SHA-256: `b598c10513fe5dd3e4e35b2c3e3cd3cb41ead278c1c093e931e7a8db994f3e4c`. RED took an earlier preparation snapshot of the admission source before the coordinator corrected parser parentheses. It is retained under `inputs/` but **was never executed by RED**. Every TLC run uses the Gate-A model copied into `probes/`. Other target hashes match the frozen packet.

Applied skill: installed `mapskills-redteam-review`, its computational tooling and proof-gap persona; repository Port Daddy agent/internal guidance subject to the runtime halt; `skills/harbor-results/references/l3-tacit-lessons.md`, especially mutation validation and contract-specific witnesses. No new literature or runtime claims are made.

`run-index.json` maps each executed probe to exact raw stdout/stderr in `evidence/`. `transcript.jsonl` embeds all reviewed child command argv, outputs, status and duration. Initial orientation reads, generator/edit tool transports, and this report-writing transport were not mirrored as raw command records; their original tool outputs remain in the Codex conversation. Assignments/messages are labeled reconstructed records. This is a disclosed capture limitation, not a claim of a complete session transcript. Hash seals bind retained bytes; they do not prove completeness or authenticate an actor.

## R1-RED-001: initialization makes the original protocol vacuous

The top-level process emits to private `red_keychan` before constructing any receiving process. Every receiver is inside the continuation after three private outputs. The first private synchronous communication has no possible partner, so none of the role events executes.

The original three queries return `true`. Adding reachability queries for `RedWrites`, `LeadEmitsToDefense`, and `DefenseLearnsRed` produces **cannot be proved**, with “Could not find a trace corresponding to this derivation.” Do not treat the Horn derivation as an execution trace or this inconclusive result as a proof of unreachability. The deadlock argument comes from the process structure.

The counterfactual is decisive: `reachability-live.pv` retains the crypto and roles but directly provisions private parameters and starts the roles in parallel. All three security queries remain true, and all three negated reachability queries become false with concrete traces. Plaintext-leak controls that are inconclusive under the original initialization become false with concrete attacks in the live variant. Thus the proposed repair preserves the intended cryptographic claim while making its success and failure behaviors observable.

Required response: fix initialization and make positive reachability and seeded leaks part of acceptance. Passing only the original secrecy queries is insufficient.

## R1-RED-002: key fanout is one tuple short

Even after moving the three key sends into parallel with their receivers, there is only one send on `def_keychan` and two consuming inputs: the defense publisher and Gate-B receiver. They cannot both receive that tuple.

`parallel-one-defense-key.pv` adds `DefenseWrites` plus a joint marker reached only after defense publication and red receipt. Defense publication is reachable, but the joint marker yields no reconstructable trace. `parallel-two-defense-keys.pv` differs by one additional identical private send; now the joint marker is false-as-unreachability, with a concrete trace. The resource-counting argument establishes the defect; the first ProVerif result itself is inconclusive.

Required response: explicitly provision every participating role and require a joint trace, not merely separate traces across alternative executions.

## R1-RED-003: S3 authenticates a sender, not a sealed-manifest gate

The comms protocol promises that WHITE learns the attack manifest only after it is sealed. S3 proves only `DefenseLearnsRed(x) ==> LeadEmitsToDefense(x)`. The model has no seal state, manifest identity, phase transition, or completeness condition on the attack stream.

A concrete probe uses live private provisioning, inserts `AttackManifestSealed` immediately after RED's existing ciphertext output, and queries `DefenseLearnsRed(red_msg) ==> AttackManifestSealed`. ProVerif finds a trace violating that correspondence while the original S1/S2/S3 all remain true:

1. RED writes and publishes its ciphertext.
2. The daemon immediately delivers it to the lead.
3. The lead authenticates, decrypts, re-encrypts, and emits the defense ciphertext.
4. Defense receives and learns the plaintext before RED executes its sealing continuation.

This falsifies the stronger lifecycle interpretation of S3 in the operational repaired model. It is not a cryptographic break and is not evidence about deployed code. Required response: represent and bind a complete sealed-manifest identity and an explicit release event; prove sealing precedes release, with both reachable success and early-release negative control.

## What the isolation result does and does not establish

The adversary is a daemon that never holds either fleet key. Both team roles are honest processes. That differs from a curious keyed team member and from a same-UID process able to inspect shared files. S1 is global daemon secrecy, not an explicit pre-Gate-B team-knowledge property; S2 is also daemon secrecy. No host read/write denial, key-store isolation, namespace ACL, network egress policy, or audit-signature implementation was probed. The campaign protocol already acknowledges this boundary, so it is recorded as a scope limitation, not an additional discovery.

## Admission model: exact bounded result and controls

The authoritative model has one safe revision (0), one conflicting revision (1), a remembered check revision and certificate, and sticky history flags. `Check` assumes a correct complete verdict. `ChangeModel` advances revision and makes the model conflicting. `Admit` compares revisions and performs admission atomically. `SafeAdmission` means no admission action has occurred while conflict was true; it does not mean a prior admitted fact can never coexist with a later conflict.

| Probe | Observation | Classification |
|---|---|---|
| bound | 22 generated / 12 distinct states; no error | Positive control |
| unbound | Check -> ChangeModel -> Admit violates SafeAdmission | Known negative control |
| accepted | Check -> Admit reaches admission | Known non-vacuity control |
| stale_rejected | Check -> ChangeModel -> RejectStale reaches rejection | Known non-vacuity control |
| stable-revision mutant | ChangeModel sets conflict but keeps revision 0; Check -> ChangeModel -> Admit violates SafeAdmission | Assumption-sensitivity control |

The three declared witness configurations exit 12 because their negated reachability invariants deliberately fail. They are not test failures or new findings. TLC here does not prove the Python checker, unbounded revision handling, authenticity of model declarations, collision resistance, liveness, or a concrete concurrent implementation. The README already limits those claims. RED found no counterexample to the actual bounded claim.

## Optional Python API sweep

The frozen `future_fact_reachability.py` was tested on all 32,768 combinations of three state labels drawn from four subsets of `{p,q}` and all 512 directed graphs, starting at s0, with one fixed overlapping obligation/prohibition policy. An independently written graph fixed point checked each reachable state directly with R17, without the maximal-set reduction. Status, complete reachability, and every unsafe witness replay agreed. Another 1,024 cases used tight exploration budgets; safe results were complete and unsafe witnesses replayed.

This checks graph exploration, label retraction/branch separation, the maximal-set reduction and limited budget behavior for that family. It reuses R17 as the conflict oracle and covers neither arbitrary policies nor all malformed input types. Zero mismatches is bounded evidence, not a general proof.

## Handoff

WHITE owns a response to each of R1-RED-001 through R1-RED-003. BLUE should independently rerun repaired initialization, joint participation, seal order and mutation controls. Parent should retain this directory's external seal digest before Gate B delivery. The privacy gate remains unpassed; neither this report nor the hashes imply hostile-tenant confinement.
