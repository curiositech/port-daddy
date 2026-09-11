# Proof catalog

**Status:** PROPOSED ACCEPTANCE PROOFS

Every proof names an exact code revision, policy/schema epoch, fixture or live boundary, and evidence retention location. A mock, design review, green aggregate, or actor assertion cannot substitute for the declared proof.

## GH-P-001 — Durable person, replaceable body

Provider-A body performs work, dies, and a provider-B body proves the right to embody the same `AgentNode`. Obligations, claims, grants, intention lineage, and outcome attribution remain; uncertain external state is re-observed. Negative cases include forged identity, simultaneous unapproved embodiment, stale capsule, and omitted-state disclosure.

## GH-P-002 — Intent capture and signed mutation

Ten raw instructions are durably captured before interpretation. Proposals classify relationships with evidence. Commit/reject/ambiguity paths preserve source and prior decisions. Signed readback at the same Chartroom revision proves mutation authority.

## GH-P-003 — Interrupt and resume

An accepted intention moves to interrupted while urgent work proceeds. After urgent termination, drift is shown and the original moves only through an explicit resume, replan, abandon, or supersede transition.

## GH-P-004 — GitHub governed effect

`UpdatePullRequestBody` submits an immutable typed request bound to actor/body, Harbor, repository, pull request, expected state, exact payload, grant, budget, policy/schema/entity/resource versions, expiry, nonce, and idempotency key. The actuator owns the credential, performs compare/read-after-write, and records success, mismatch, partial, or indeterminate evidence. Unauthorized, stale-head, replay, and TOCTOU cases deny or retry adjudication.

## GH-P-005 — Hard claims, advisory signals

Two actors and a human request compatible and incompatible scopes. Claim Forest is the hard coordination decision. Pheromones display source, strength, evidence, and decay. Running the same authorization/ownership/completion tests with all signals disabled produces identical hard outcomes.

## GH-P-006 — Evidence chain from “shipped”

From an assertion, Porthole traverses accepted requirement → implementation artifact → test/evaluator → action request → permit → actuator → external observation → receipt → outcome policy. Negative cases identify the first missing, stale-head, conflicting, redacted, or untrusted link. Replay exposes no live-effect control.

## GH-P-007 — Role-bound Parley

A disputed proposition runs through a parameterized protocol with role binding, delivery/seen evidence, refusal, `not-understood`, duplicate, out-of-order, timeout, cancellation, protocol violation, impasse, and resolution. Terminal state splits agreed, rejected, and unresolved propositions; Chartroom changes remain separate proposals.

## GH-P-008 — Sanctioned runtime confinement

The Harbor owns body spawn, resource grants, sandbox profile, capability endpoint, and credential broker. A same-UID adversarial body cannot obtain reusable provider/GitHub secrets or effect a sanctioned mutation outside actuators. Budget truth is observed at the credential/provider boundary. The proof states platform limits and does not conflate coordination locks with OS enforcement.

## GH-P-009 — Cross-Harbor grant and revoke race

Two sovereign Harbors create a directional grant, perform one authorized remote-request/local-adjudication flow, and preserve separate acceptance/evidence states. Revocation is tested before permit, after permit, after actuator admission, during partition, and after remote effect. Any divergent state remains visible.

## GH-P-010 — Selection-policy learning

A predeclared, stratified control/shadow/treatment experiment records candidates, evidence at selection, policy version, chosen module, outcome vector, uncertainty, regret, and rollback. A held-out result supports or rejects a policy change without naïve co-occurrence credit.

## GH-P-011 — Paid skill settlement

Buyer payment, execution COGS authority, platform compensation, reservations, observed usage, outcome evidence, disclosure, refund/failure handling, and settlement each have independent lineage. A negative concurrent-oversubscription case cannot spend the same authority twice. Failure retains real incurred COGS. Settlement relies on an independent outcome oracle.

## GH-P-012 — Complete-mediation inventory

For sanctioned operation, enumerate filesystem writes, process spawn, Git commit/push, GitHub mutation, agent/body spawn, browser/native actions, secret use, network egress, and budget-consuming calls. Each is either mediated with proof, explicitly prohibited, or labeled outside the security claim. Search and adversarial tests demonstrate no undocumented privileged path.

## Evidence quality levels

| Level | Meaning |
|---|---|
| Fixture | deterministic product demonstration; no live-boundary claim |
| Integration | multiple real repository components; controlled boundary |
| Live proof | actual target/provider observed at an exact revision |
| Dogfood interval | sustained operator use with counterevidence collection |
| Shipped telemetry | production behavior under declared privacy/evidence policy |

