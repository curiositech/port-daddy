# Candidate constitution

**Status:** PROPOSED · every invariant below is a provisional import until review ratifies it.  
**Change rule:** only an accepted constitutional amendment may modify an accepted invariant.

This file contains only the promises that should be difficult to overturn accidentally. It does not select Cedar, a database, a policy syntax, a proof assistant, a UI framework, a deployment topology, permit delegation semantics, or a marketplace mechanism.

### GH-I-001 — Effects pass through typed authority and evidence stages

For Port Daddy-mediated consequential effects, an agent or human proposes an `ActionIntent`; an adjudicator decides; an exact `ActionPermit` authorizes; an actuator effects; and an `ActionReceipt` records what was observed. An assertion by an agent, actuator, or UI cannot replace a missing stage.

**Rationale:** imported from the [keystone amendment](https://github.com/curiositech/port-daddy/pull/9987#issuecomment-5504065272).  
**Does not imply:** that a permit proves execution, that a receipt proves the desired business outcome, or that every internal read requires a permit.

### GH-I-002 — Credentials are mechanisms, not authority

Possessing a credential, provider session, token, claim, model role, or secret does not by itself establish permission. Authority must be attributable, scoped, current, and independently adjudicated.

**Grounding:** **Harbor authority** (`docs/adr/0122-harbor-authority.md`) requires attributable one-writer authority and explicit epochs; **Harbor cards** (`docs/adr/0094-harbor-cards-as-verifiable-credentials.md`) are verifiable credentials rather than a universal grant.

### GH-I-003 — Actor, incarnation, session, backend, office, and role are distinct

A durable Actor cannot freely reselect its identity through a new body. Incarnations, model/provider sessions, backends, organizational offices, and protocol roles bind to an Actor but do not become that Actor.

**Grounding:** **actor soul/body lease** (`docs/adr/0022-durable-actor-souls-and-body-leases.md`) separates persistent identity from revocable live authority; **AgentNode** (`docs/adr/0121-durable-agent-roster.md`) is the durable person rather than an alias, process, session, or backend.  
**Does not decide:** recovery ceremony, credential rotation, simultaneous incarnations, or inherited memory.

### GH-I-004 — Goals are not intentions

A candidate desire, task, or operator idea is not an accepted persistent intention. An accepted commitment survives interruption until an explicit, attributable transition completes, resumes, supersedes, abandons, cancels, or otherwise disposes of it.

**Source direction:** AgentSpeak/BDI research and `docs/adr/0041-durable-commitments-and-obligation-monitoring.md`.  
**Does not imply:** a literal AgentSpeak interpreter.

### GH-I-005 — Event, observation, evidence, receipt, and outcome are distinct

Unknown, partial, stale, denied, cancelled, failed, indeterminate, and compensation-pending are first-class states. Command completion and absence of contrary evidence are not success.

**Grounding:** **honest attestation** (`docs/adr/0045-loud-fail-invariants-and-honest-attestation.md`) fails loudly when critical truth is missing; the Grand Harbor addendum defines causal proof as `Stimulus → Perception → Governed action → Durable evidence`.

### GH-I-006 — A Harbor remains an authority and trust boundary

Collaboration, Relay transport, Convoy composition, or shared projections do not silently merge Harbor sovereignty. Cross-Harbor rights must be explicit, attributable, scoped, revocable, and conflict-resolved by a named contract.

**Grounding:** **Relay** (`docs/adr/0049-relay-architecture.md`) is a transport/federation fabric, not automatically canonical authority.

### GH-I-007 — Convoy is a composition, not a rename

A Convoy is a durable application/program composition of participants, actors, offices, intentions, resources, governance, budgets, protocols, embodiments, outcome policy, and one or more Harbor relationships. It is not a synonym for Harbor, Fleet, session, or repository.

**Accepted source:** [PR #9987 RFC at exact head](https://github.com/curiositech/port-daddy/blob/9a4f8a515acbf97fe6bf504702f665613e1221da/docs/design/convoy-platform-requirements.md).

### GH-I-008 — Claims are hard coordination state; pheromones are advisory

Claims coordinate occupancy or ownership but confer neither actuator permission nor completion proof. Pheromones are provenance-bearing, graded, decaying signals that may influence attention or selection; they cannot grant authority, establish ownership, or prove facts.

**Maturity note:** `docs/adr/0038-claim-tree.md` is Proposed; `docs/design/pheromone-vocabulary-v1.md` is accepted design only; implementation and full claim hierarchy remain incomplete.

### GH-I-009 — Protocols use explicit roles and honest terminal semantics

A protocol must define participants by role, admissible transitions, timeouts, cancellation, exceptions, failure, and terminal states. Message transmission or receipt alone establishes neither agreement nor common knowledge.

**Source direction:** the FIPA protocol/communicative-act corpus and Big Brother communication-epistemics material registered in the skill graft plan.

### GH-I-010 — Every canonical fact has one named authority

Chartroom, the event ledger, identity store, budget ledger, and policy store must each have a named authoritative writer or conflict rule. Porthole, Claim Tree, FleetBar, pd-console, PWA views, caches, and generated roadmaps are projections; they cannot silently become competing stores.

**Grounding:** **Rust kernel boundary** (`docs/adr/0120-rust-kernel-boundary.md`) centralizes security primitives; **Harbor authority** (`docs/adr/0122-harbor-authority.md`) rejects unowned replicated truth.

### GH-I-011 — Models propose interpretations; attributed transitions make them authoritative

Natural language is source material. A model may propose `refines`, `adds`, `interrupts`, `contradicts`, `supersedes`, `questions`, or `parks`; an explicit, attributable authority event must create the canonical mutation. Unknown or ambiguous interpretation stays unknown or ambiguous.

**Does not decide:** whether the gesture is a signature, passkey confirmation, standing policy, or another reviewed mechanism.

### GH-I-012 — Identity and witnessed outcomes precede reputation and markets

Reputation, routing, bonds, escrow, and a paid skill market cannot manufacture missing durable identity or witnessed outcomes. The dependency is identity → outcomes → scoring/selection → reputation → market.

**Grounding:** `skills/agent-identity-continuity-reputation/SKILL.md` and `docs/research/north-star/identity-reputation.md`.

### GH-I-013 — Unresolved questions and tensions are valid architecture state

An unanswered question is not a defect to hide. An irreducible tension is not resolved by selecting one attractive pole and deleting the other. Implementations and assistants must preserve them until an authorized decision bounds both sides.

### GH-I-014 — Maturity claims require stage-appropriate evidence

`DESIGNED`, `CONTRACTED`, `IMPLEMENTED`, `PROVED`, `DOGFOODED`, and `SHIPPED` are different claims. Each later claim requires exact revision, verifier, artifact, and freshness evidence appropriate to that stage.

**Grounding:** the repository’s BUILT/DESIGNED/VISION honesty discipline and `AGENTS.md` requirement that command success is not proof.

## Deliberately non-constitutional

The following stay in contracts, questions, or hypotheses: Cedar adoption; evaluator backend; policy syntax; permit delegation/revocation/caching; exact identity mint/recovery; concurrent incarnations; memory inheritance; Chartroom consistency; claim takeover; pheromone weights; market pricing; literal BDI interpreter; universal Lean use; database; language; event bus; UI framework; and deployment vendor.

