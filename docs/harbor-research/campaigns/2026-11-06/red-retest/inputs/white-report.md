# WHITE response: 2026-11-06-R1, Gate B

All three RED findings are accepted. The revised one-session ProVerif model has six true security queries and four concrete participation traces. Four seeded mutations produce the intended counterexamples. These are proposed model repairs awaiting independent Gate C retest; WHITE does not close its own findings.

## Authority, inputs and scope

Verified worktree: `/Users/erichowens/coding/tmp/research-program-next-result-20261106`; branch: `codex/research-program-next-result-20261106`; gitdir: `/Users/erichowens/coding/port-daddy/.git/worktrees/research-program-next-result-20261106`. Owned writes are `proofs/coordination/isolation.pv`, its `.run.log`, and this `white/` directory. Other agents' files were left intact. Local Port Daddy remained halted.

Gate B authorized RED's sealed report, attacks and probes. Outer seal SHA-256 `9214dd9e55c9d15555dc2ccb73047e9f279fa2c8230731250717c126017978c5` matched before repair; all 107 inventoried RED file hashes also matched. `input-receipt.json` retains that verification. No BLUE or later RED retest material was read.

Applied skills: installed `mapskills-whitehat-defense` with its `proof-completer` persona and computational-tooling reference; checked-in Port Daddy agent/internal guidance subject to the runtime halt; Harbor Results with the mutation and contract-witness lessons; Lakatos with local/global counterexample triage. R1-RED-001/002 falsify participation assumptions in the old argument. R1-RED-003 falsifies the stronger lifecycle interpretation, requiring an explicit new gate. Existing broad language about an entire attack stream is withdrawn: the repaired artifact represents exactly one complete manifest value, one session and one instance of each role.

## Per-finding response

| Finding | Accepted defect | Repair and evidence | Proposed status |
|---|---|---|---|
| R1-RED-001 | Private synchronous initialization outputs precede every receiver; original true security results do not establish an executing protocol. | Provision private parameters directly into parallel role instances. `RedWrites`, `DefenseWrites` and `DefenseLearnsRed` negated-reachability queries are false with reconstructed execution traces. Both plaintext-leak mutants now produce actual confidentiality attacks. | Model repaired; independent retest required. |
| R1-RED-002 | One defense-key send cannot feed both consuming roles in the same run. | Explicitly supply the defense key to both publisher and receiver. Private completion markers feed one observer; `JointRoles` has a single concrete trace containing red write, defense write and defense learning. | Model repaired; independent retest required. |
| R1-RED-003 | Authenticated lead emission alone does not enforce manifest sealing before delivery. | Red encrypts `(manifest_id, red_msg)`, then emits `AttackManifestSealed` before publishing a domain-separated signature over `seal_statement(manifest_id, ciphertext)`. The lead verifies that exact token before `GateBRelease`; defense receives the same identity/value under authenticated encryption. Three correspondences establish release-before-learn, seal-before-release and seal-before-learn. Removing the seal input/check produces both early-release and early-learning traces. | Lifecycle modeled and checked at stated scope; independent retest and implementation conformance remain open. |

Direct private parameter provisioning is a symbolic initial-condition assumption. The private completion channels are instrumentation; they imply no operating-system access control. Defense publication carries an identity/value pair, allowing an attacker to offer a structurally valid defense ciphertext to the receiver. The pinned lead signature rejects it; removing that check exposes the intended sender-authentication failure.

## Executed results

Tool: `/Users/erichowens/.opam/default/bin/proverif`, locally identified as ProVerif 2.05. All 10 recorded commands completed with exit 0 and empty stderr; a false ProVerif query is a semantic result, not a process failure. `run-index.jsonl` maps names to raw stdout/stderr and elapsed time. The final repaired-model run took about 0.020 seconds on this host. A preparation run precedes the final defense payload-shape adjustment and is retained as `repaired-initial`; only `repaired` supplies the canonical log.

| Query | Verdict | Interpretation |
|---|---|---|
| `not attacker(red_msg)` | true | Global daemon secrecy, even after authorized release to defense. |
| `not attacker(def_msg)` | true | Global daemon secrecy of the defense value. |
| `inj DefenseLearnsRed(id,x) ==> inj LeadEmitsToDefense(id,x)` | true | Authenticated delivery in this one-session model. |
| `DefenseLearnsRed(id,x) ==> GateBRelease(id,x)` | true | Learning follows matching lead release. |
| `GateBRelease(id,x) ==> AttackManifestSealed(id,x)` | true | Release follows matching seal. |
| `DefenseLearnsRed(id,x) ==> AttackManifestSealed(id,x)` | true | Learning follows matching seal. |
| `not RedWrites(red_msg)` | false, concrete trace | Red can run. |
| `not DefenseWrites(def_msg)` | false, concrete trace | Defense publisher can run. |
| `not DefenseLearnsRed(manifest_id,red_msg)` | false, concrete trace | Defense receiver can learn the released manifest. |
| `not JointRoles(manifest_id,red_msg,def_msg)` | false, concrete trace | Both defense roles and red participate in one execution. |

The joint witness executes defense write, red write, seal, lead release/emission, defense learning and the three completion handshakes before `JointRoles`. A `cannot be proved` result would fail acceptance; none appears in the final repaired run.

| Mutant | Intended failed property and concrete witness |
|---|---|
| `leak-red.pv` | Red secrecy false: the trace ends with the attacker obtaining `red_msg` from an explicit plaintext output. |
| `leak-defense.pv` | Defense secrecy false: the attacker obtains `def_msg` from the defense plaintext output. |
| `early-release.pv` | Seal-before-release and seal-before-learning false: the lead receives red ciphertext, releases it, and defense learns while no seal event has occurred. Secrecy and lead authenticity stay true. |
| `unauthenticated-receiver.pv` | Lead authentication false: the receiver accepts a defense-origin ciphertext and emits `DefenseLearnsRed(manifest_id,def_msg)` without matching lead emission. Both payload secrecy queries stay true. |

The mutants are exact, checked single-edit transformations of the repaired source. `verify_controls.py` reruns all five models read-only, requires the intended traces, checks both seal-order failures against traces containing no seal event, rejects archived mutant drift, and compares the repaired `RESULT` lines with the canonical log. Run from the repository root:

```sh
python3 docs/harbor-research/campaigns/2026-11-06/white/verify_controls.py --proverif /path/to/proverif
```

`proofs/coordination/isolation.run.log` is copied byte-for-byte from the final repaired ProVerif stdout, after the real execution. Its `RESULT` format matches the canonical `scripts/proofs/run-proverif.py` baseline convention. The four false reachability queries are required non-vacuity evidence, not failed security obligations. Root owns proof-estate/CI registration.

## Evidence and residual obligations

`inputs/isolation-before.pv` preserves the old model. `probes/repaired.pv` and the four mutants preserve exact executed sources. `evidence/` uses the authorized `war_room.py` recorder for argv, executable hashes, cwd, stdout, stderr, exit codes and duration. Run entries record source hashes where supplied. The outer seal binds this report, source snapshots, replay script, run index and evidence ledger. It is a byte-integrity receipt without an actor signature.

Capture limits: initial orientation reads, edit transports, the tool-version help command, outer-seal verification transport and report-writing transport remain in the Codex conversation rather than raw campaign command files. Assignment and message summaries are explicitly reconstructed visible records. The replay wrapper captures its own output; its five child outputs are separately available from the named individual proof runs. An initial whitespace command used paths relative to the evidence cwd and was ineffective; the retained diff-whitespace-root command corrects the cwd explicitly. No complete-session transcript claim is made. No secrets or hidden reasoning are retained.

Unresolved beyond this model: hostile tenant isolation, same-UID read denial, network containment, actual key distribution/keystore isolation, ACL enforcement, authenticating the human/team behind a seal, crash recovery, implementation conformance, multi-session/round replay, KDF rotation, stream completeness, malicious or curious keyed personas, compromise, and timing/cardinality noninterference. The model proves safety under arbitrary daemon message scheduling, while the reachability traces establish possible success; it does not prove eventual progress against dropping. Honest red sealing means it seals the represented whole value; the model cannot prove the value contains every real attack.

Handoff: fresh RED should independently verify the repaired source and controls, then report per-finding verdicts against the externally retained WHITE seal. BLUE should independently inspect scope, trace meaning and evidence provenance. Gate C and privacy remain unpassed here.
