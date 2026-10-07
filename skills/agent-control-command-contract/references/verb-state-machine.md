# Control verb and lifecycle distinctions

Use this reference when defining an operator-control profile or reviewing how its adapter and observer report command outcomes. The names below are a first-party vocabulary, not a guarantee that any backend implements them.

## Keep the verb's requested effect explicit

Binder chapter 13 lists `send operator message`, `pause`, `interrupt`, `kill`, `checkpoint`, and `fork successor` as distinct control-plane primitives. Chapter 15's control/lease diagram separately distinguishes request, delivery, acknowledgement, enforcement evidence, suspect state, revocation, and terminal reporting. The operator-control-panel packet labels send-message and interrupt separately, and places checkpoint/fork among click-first actions. This is the origin for the example vocabulary; a different product declares its own `profile.requiredVerbs` set.

| Verb | Requested intent | Evidence that would answer the effect question |
| --- | --- | --- |
| `steer` | Submit operator guidance for a later turn. | A command receipt proves delivery only; a transcript event can show whether the body later received the message. Do not infer behavioral compliance. |
| `interrupt` | Ask the body to stop its current turn or operation. | A body acknowledgement is self-report; an independent task/tool monitor is needed to observe cessation at the claimed boundary. |
| `pause` | Ask the body to remain quiescent while preserving its resumable state. | Observe that the relevant work boundary is idle and that resume state exists; absence of recent output alone is insufficient. |
| `kill` | Request termination of the addressed body/process. | Verify the scoped process or runtime state is gone. Descendants and remote effects are separate scopes and must not be implied. |
| `checkpoint` | Capture state for a later continuation. | Read the persisted checkpoint and bind its ID/hash to the run and predecessor. A success response without read-back is not persistence proof. |
| `fork` | Create a successor run from a named checkpoint. | Verify the successor ID and its checkpoint/predecessor links; `fork` is not just a copied command or an identity-preserving restart. |

These effect checks are a suggested evidence design, not one universal runtime protocol. A contract profile may require only a subset. When two verbs are offered, give each its own meaning, request identity, and lifecycle records; a generic `stop` argument can otherwise conceal whether the requested effect was interruption, quiescence, or termination.

## Lifecycle is not a list of terminal states

Use `lifecycleStates`; several entries are intermediate and some describe uncertainty rather than a terminal effect.

| State | Meaning and boundary |
| --- | --- |
| `requested` | The caller submitted a command identity and target. No policy decision or delivery is implied. |
| `policy-denied` | Admission policy rejected the request. It must be distinct from unsupported capability and no dispatch should follow. |
| `queued` | The control service accepted the request for later delivery. It is not delivered. |
| `delivered` | The declared receiver channel reports that it received the request. It does not prove runtime effect. |
| `acknowledged` | The receiver reports receipt or processing according to the protocol. It is not independent proof of changed state. |
| `effect-observed` | A separately named observer read back evidence of the claimed state change, with target and revision. |
| `failed` | Delivery or execution failure is known and recorded with a reason. If the system cannot know whether an effect happened, use `outcome-unknown`. |
| `expired-before-delivery` | The command expired and evidence establishes it was not delivered. A timer alone is not that evidence. |
| `outcome-unknown` | Delivery may have occurred, but no trustworthy effect result is available by the deadline. Reconcile before a non-idempotent retry. |
| `unsupported` | The declared target adapter cannot perform this verb. This is a capability answer, not an authorization denial or transient execution failure. |

The distinction prevents two common false conclusions: (1) an acknowledgement does not establish that a body stopped; (2) timeout after possible delivery does not establish no effect. Authorization denial is before dispatch; unsupported is a capability classification. Neither should be rendered as the other.

## Build a product-specific profile and matrix

1. Name the product profile and list its promised verbs in `requiredVerbs`.
2. Declare all backends in scope. Each `supportedVerbs` entry is a local assertion to test, not a fact inferred by this auditor.
3. Include one matrix row for every declared verb/backend pair. Pair support must exactly match the backend list.
4. For supported rows include the profile-required lifecycle distinctions, including acknowledgement, effect observation, and outcome unknown. For unsupported rows include `unsupported`, do not claim delivery/effect, and keep policy denial separately representable.
5. For every required verb require at least one backend that declares support. Other backends may mark that pair unsupported.
6. Keep the required verb set visible in the profile. No built-in rule in the auditor makes four or six verbs mandatory for all products.

The JSON Schema checks value shape. The JS auditor adds duplicate-name/pair checks, referential integrity, matrix cross-product coverage, support parity, lifecycle inclusion, and authorization declaration checks. Passing these means only “internally complete declaration.”

## Constructed contrast

Suppose profile `demo-profile` offers `interrupt` and has one command-capable adapter plus one observer-only adapter. The matrix should declare:

- command-capable + interrupt: `supported`, with request, policy-denied, delivery, acknowledgement, independently observed effect, failure, pre-delivery expiry, and unknown-after-send states;
- observer-only + interrupt: `unsupported` plus `policy-denied`, without delivered, acknowledged, or effect-observed states.

This tells an implementer which distinctions the *contract* must expose. It is not evidence that a real adapter stops a process. A real test must show the addressed target, delivery receipt, effect read-back or unknown result, and identity/revision joins.

## Failure cases to exercise

- The requested verb is absent from the profile declaration.
- A backend lists a verb that has no declaration or matrix row.
- A matrix pair is missing, repeated, or repeated with contradictory support.
- Support list and matrix disagree in either direction.
- A supported row omits `acknowledged`, `effect-observed`, or `outcome-unknown`.
- An unsupported row claims delivery or an observed effect.
- An acknowledgement arrives but effect read-back shows no change.
- Delivery occurs immediately before the deadline and observation is unavailable; record unknown, not “expired/no effect.”
- A retry carries a duplicate command id; the runtime test must establish the idempotency behavior rather than infer it from this declaration.

## References

- First-party profile origin: `docs/architecture/agent-harbor-technical-binder/13-platform-plays-and-runtime-surface-review.md` (“Control surface simplification”); `.../15-recursive-critical-synthesis.md` (“C3. Capability leases...” and “Diagram 2b - control and lease failure flow”); `docs/architecture/agent-harbor-technical-binder/work-packets/operator-control-panel-ux-flow.md` (“Session List”, “Controls”, and “Click-First Interaction Contract”). These are design packets, not deployment evidence.
- NIST SP 800-162 helps define subject, resource, operation, environment, policy decision, and enforcement roles. See [`authorization-sources.md`](authorization-sources.md) and [`evidence-scope.md`](evidence-scope.md).
