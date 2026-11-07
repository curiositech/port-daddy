# Independent RED retest: Gate C, 2026-11-06-R1

**R1-RED-001, R1-RED-002 and R1-RED-003 are closed-in-model.** This verdict covers the revised one-session, one-receiver, one-complete-manifest symbolic model, with honest roles and private key provisioning. It does not close implementation conformance or OS privacy.

## Verified packet and execution

The exact dedicated worktree, feature branch and linked gitdir were reverified. RED wrote only `red-retest/`; original RED and WHITE seals were not changed. Local Port Daddy remained halted. WHITE's externally retained outer seal `6d4da545af5fbf9be21bc4932067adeb2ad6f966d6cd777d8e76d4d54d810244` matched. All 39 inventoried WHITE files and both external artifacts matched their hashes. Canonical repaired source: `1bb15bbc09eec6ad88d43acc092f7129df9e35fb053d51998cbad5d9b3eb3189`.

Fresh source inspection preceded independent execution. The baseline produced six true security queries and four false negated-reachability queries with concrete traces; no `cannot be proved` appeared. WHITE's wrapper passed. RED also executed each of WHITE's four mutants directly, retaining fresh raw outputs, and created five additional semantic probes. The 12 logged commands include ten direct ProVerif runs, the WHITE wrapper and RED's independent trace assertions. All exited 0 without stderr; false queries are expected semantic outcomes, not process failures.

`run-index.json` identifies raw evidence and `transcript.jsonl` embeds command argv, stdout/stderr, exits and timing. `verify_retest.py` independently checks the important trace contents. Tool execution is `host-reviewed-process`. Orientation/read and edit transports remain in the Codex transcript rather than raw campaign command rows; capture is not represented as a complete session recording. Hashes are byte-integrity receipts without actor authentication.

## Per-finding verdict

| Finding | Verdict | Independent reason |
|---|---|---|
| R1-RED-001: initialization deadlock | closed-in-model | Every role is instantiated in parallel with private parameters. No private key send precedes construction of its receiver. Red write, defense write and defense learn each have concrete traces. Plaintext leak mutations produce concrete attacks. |
| R1-RED-002: one key tuple for two consumers | closed-in-model | The publisher and receiver each receive the defense key as a parameter; they do not compete for a single message. One independently inspected JointRoles trace contains red publication, defense publication and defense learning. |
| R1-RED-003: authenticated release before sealing | closed-in-model | Lead acceptance requires a signature over the represented manifest identity and exact ciphertext. Honest RED emits that signature only after AttackManifestSealed. Matching seal precedes release and learning; independently seeded event-order and removed-check mutations each yield concrete early-event counterexamples. |

The joint observer is instrumentation after publication/learning events. It cannot itself create those earlier events; the joint trace is therefore stronger than separate alternative participation traces. It establishes possible success, not eventual delivery against an adversary that can drop traffic.

## Fresh semantic challenges

**1. Duplicate receiver: injectivity breaks on replay.** A single additional `DefenseReceiver` instance yields a concrete trace with one `LeadEmitsToDefense` and two `DefenseLearnsRed` events for the same identity/value. The injective correspondence becomes false; its noninjective counterpart, secrecy and seal order remain true. This is a scope-boundary control, not a failure of the stated one-receiver model. The current proof is not a general deduplication or at-most-once-delivery argument. It must not be promoted to multiple receivers or sessions without additional state and proofs.

**2. Publish seal token before recording the seal: order breaks.** Moving `AttackManifestSealed` to just after the public seal-token output leaves the signature check intact. Both seal-before-release and seal-before-learning become false with traces containing no prior seal event. Secrecy and sender authentication stay true. This directly checks causal order rather than merely removing the whole gate.

**3. Remove signature domain separation alone: the mutant survives.** Replacing the seal signature's `seal_statement(id,ct)` with `ct` in producer and verifier leaves all baseline properties true. The current `manifest_id` is private and is first made public by the post-seal message; the lead's equality input also waits for that otherwise unknown identity. This surviving mutant is retained and explained, not omitted or claimed as a break.

**4. Make the identifier public: the honest model still passes.** Changing only the declaration to public preserves all six security properties and all four participation witnesses. Thus the revised scheme can tolerate an initially known identifier; the implementation need not treat an identifier as a secret to obtain this bounded result.

**5. Public identifier plus removed domain separation: substitution breaks order.** Combining those two changes lets the daemon reuse RED's earlier ordinary ciphertext signature as the purported seal signature. Both seal-order correspondences become false with concrete traces and no seal event. This isolates what the separate signature domain provides when identity secrecy is unavailable. No actual source repair is required to close the original findings: the canonical model retains the signature domain and passes both the private-ID and public-ID honest cases. Keeping the public-ID control would make the intended dependency clearer for future changes.

WHITE's red and defense leak controls independently yield real confidentiality traces. Its removed-seal-check mutant yields early release/learning; its unauthenticated receiver accepts a defense-origin value without a matching lead emission. These are controls, not new research results.

## Remaining boundaries

The daemon is untrusted, but personas are honest and keys are assumed privately provisioned. The represented value is one complete manifest by modeling assumption; the proof does not show that a real manifest contains all attacks. Multisession replay, multiple receivers, key compromise, keyed curious personas, implementation/keystore correspondence, ACLs, host isolation, arbitrary code, and temporal or cardinality noninterference remain outside the result. The fresh duplicate-receiver trace supplies concrete evidence for one of those boundaries.

Gate C may close the three original findings **in this model only**. The actual research-team filesystem still provides procedural blindness; this retest establishes no OS privacy and contains no VM execution or new-agent confinement evidence.
