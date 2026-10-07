# P5 — Capability constitution and consequential effects

**Round 1 · independent · sealed · anchor `6c2c30d74b889b4d8037ce5d43b265bfbf21a686`**

## Evidence posture

| Classification | Finding |
|---|---|
| **SOURCE_PRESENT** | Static contracts distinguish `ActionProposal`, `AdjudicationReceipt`, and `EffectReceipt`, with a pure fail-closed verifier and negative fixtures ([contract](../../../../lib/agent-harbor/governance/action-adjudication.ts), [tests](../../../../tests/unit/action-adjudication.test.js)). The Rust broker has actor-, harbor-, tenant-, operation-, and resource-bound expiring capabilities with durable one-use redemption ([capability](../../../../core/pd-broker/src/capability.rs), [broker](../../../../core/pd-broker/src/broker.rs)). |
| **PROPOSED** | The Grand Harbor constitution is expressly provisional and leaves permit delegation, revocation, and caching undecided ([constitution](../../../grand-harbor/00-constitution.md)). ADR-0140's policy IR, Rust proof binding, external controller, and production wiring remain backlog or blocked ([ADR-0140](../../../adr/0140-provable-action-adjudication-contract.md)). |
| **UNKNOWN** | No canonical inventory proves that every credential, filesystem, network, process, provider, UI, and tool effect reaches one reference monitor. Existing tool gates have no production callers and are not universal permits. |
| **BLOCKED_BY_HALT** | Live mediation, stale-body denial, separate-UID/VM isolation, provider reconciliation, revocation latency, and operator approval ceremonies cannot be witnessed. Dynamic tiers remain blocked rather than passing. |

## Thesis

Authority is not a property of a person, credential, actor, body, tool, policy, or receipt. It is a one-use relationship over one exact action. A change of person, repository, harbor epoch, body generation, actuator/tool, or effect identity invalidates the permit. Policy and approval may justify minting that permit; only a non-bypassable controller that owns the effect channel can make it effective. A later receipt can report an effect but can never manufacture earlier permission.

## Non-negotiables

1. **No boundary substitution.** A permit binds the accountable principal and approving person, exact repo identity and revision, harbor plus authority epoch, body ID plus generation and key, actuator audience and build digest, and normalized effect target and parameters. Aliases, sessions, paths, branch names, or possession of a bearer cannot substitute.
2. **Attenuation is componentwise and monotonic.** A child may reduce expiry, use count, destination, operation, parameter range, or audience. It may never change person, repo, harbor, body generation, or semantic effect. No union of partial permits is allowed. Macaroons support caveat-based attenuation and third-party approval, but remain bearer credentials unless separately sender-constrained ([Macaroons](https://theory.stanford.edu/~ataly/Papers/macaroons.pdf)); proof-of-possession binding should follow the request/key-binding principles of [RFC 9449](https://www.rfc-editor.org/rfc/rfc9449.html).
3. **Human approval is evidence, not executable authority.** The human sees independently computed blast radius, exact target, parameters, cost, body, tool, and expiry. A WebAuthn ceremony can bind a server challenge derived from those digests; user presence or verification proves a ceremony occurred, not that the person understood an altered or hidden action ([WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/)). The adjudicator may still deny.
4. **Unknown and ambiguous effects quarantine.** `DISPATCHED` without authoritative result becomes `AMBIGUOUS`; neither a successor body nor a retry layer may repeat it. Fencing and reconciliation precede replacement.
5. **No self-completing trust loop.** Requester, approver, adjudicator, actuator, and effect witness must not collapse into one compromise domain. Independent means separately keyed, released, and protected, not merely another function in the same mutable process.

## Strongest implementation proposal

Adopt a closed pipeline:

`ActionIntent → ApprovalAssertion? → AdjudicationReceipt → ActionPermitV1 → atomic redemption → EffectReceipt → Obligation/CompensationReceipt`.

`ActionPermitV1` binds the proposal digest; action type; person/principal; repo remote, tree, and ref; harbor and epoch; actor, body generation, and body public-key thumbprint; exact tool/actuator audience and binary digest; effect class, target, normalized parameters, and idempotency slot; policy and evaluator digests; approval assertion; parent permit; obligations; nonce; validity interval; and `maxUses: 1`. Unknown action types or fields fail closed, following the typed, reject-unknown posture of [RFC 9396](https://www.rfc-editor.org/rfc/rfc9396.html).

The policy engine decides but never releases credentials. A separately installed controller verifies the permit and body proof, atomically reserves its nonce, then exposes only the named channel. The actuator receives a key-bound child permit, not the parent credential. The current broker's one-use reservation and audience/expiry attenuation are a useful nucleus, but it does not consume ADR-0140 adjudication and CAP0 lacks authenticated consumer binding.

After dispatch, the controller seeks independent resource or provider readback. Lost responses remain ambiguous unless an idempotency key or authoritative state proves the original effect. Automatic retry is admissible only for semantically idempotent actions or proof that nothing applied; [RFC 9110 §9.2.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2) cautions against automatic retry of non-idempotent requests. Compensation is a new effect requiring a new permit.

Policy alone is not containment. Saltzer and Schroeder require fail-safe defaults, complete mediation, separation of privilege, and least privilege ([paper](https://web.mit.edu/Saltzer/www/publications/protection/Basic.html)); NIST's reference monitor must be always invoked, tamper-resistant, and small enough to verify ([NIST reference monitor](https://csrc.nist.gov/glossary/term/reference_monitor)). The repository itself labels all current same-UID bodies “governed, never contained” in [`policy-matrix.ts`](../../../../lib/agent-harbor/governance/policy-matrix.ts). Hard claims therefore require controller-owned credentials, egress, mounts, process control, and provider channels outside the subject's UID or VM.

## Falsification tests

The constitution fails if any one-byte mutation of person, repo, harbor epoch, body generation, tool audience, effect, parameters, policy, approval, or expiry still redeems; if two concurrent redeemers both win; if a fenced predecessor can act; if approval can be replayed; if a direct credential/socket/network path bypasses the controller; or if crash windows before reservation, after dispatch, or before response produce a duplicate rather than `AMBIGUOUS`.

What would change this position is exact-build, adversarial, operator-witnessed evidence that a narrower mechanism is non-bypassable under a clearly weaker threat model. It would narrow the claim; it would not turn policy into containment.

### Impossible combinations

- Hostile same-UID arbitrary code plus hard containment.
- Ambient credentials plus broker-exclusive authority.
- Transferable bearers plus body-generation fencing.
- Automatic retry of ambiguous non-idempotent effects plus at-most-once semantics.
- Subject-operated adjudication plus independent judgment.
- Long-lived offline permits plus immediate revocation.

## Skill audit

Scores are 0–2 for activation (A), boundaries (B), local shibboleths (S), evidence (E), evaluations (V), phantom-reference hygiene (P), and changelog (C).

| Skill | A/B/S/E/V/P/C | Total | Concrete patch |
|---|---:|---:|---|
| `drydock-program-architecture` | 2/2/2/2/2/2/2 | 14/14 | Add `ActionPermitV1` to the output contract and a six-axis substitution fixture. |
| `sandboxed-adversarial-test-harness` | 2/2/2/2/1/2/2 | 13/14 | Replace its legacy T0-only policy schema with a closed permit/mediation schema and direct-channel bypass evaluations. |
| `agent-resurrection-and-body-continuity` | 2/2/2/2/2/2/2 | 14/14 | Require destination-generation key binding in every fresh grant; add stale-body redemption and lost-response fixtures. |
| `agentic-zero-trust-security` | 1/0/0/1/0/0/0 | 2/14 | Supplant generic threat tiers and weak container claims; fix frontmatter, add halt/status/witness semantics, evaluations, and changelog, and remove phantom routes. |

## Missing skill proposal

**`consequential-effect-authority`**

Activate when a person, agent, body, tool, broker, policy, credential, or harbor may request, approve, delegate, execute, retry, compensate, or attest a consequential effect, especially across principal, repo, harbor, body-generation, tool, or effect boundaries.

Do not activate for read-only analysis with no effect channel; VM isolation implementation; ordinary authentication; body continuity alone; generic policy writing; or provider-client correctness absent an authority or side-effect question.

Required evaluations: cross-axis substitution, attenuation widening, concurrent redemption, stale-generation use, approval replay, ambiguous dispatch, bypass discovery, and witness self-certification.

## Confidence and unknowns

Confidence is **0.94** in the static diagnosis and **0.62** in deployability. Unknowns are the complete effect inventory, installed broker/UID/firewall state, operator-key recovery, actual approval UX, provider idempotency, and live revocation bounds. These require dynamic evidence and remain **BLOCKED_BY_HALT**.

**SEALED — P5 — 2026-09-16.**
