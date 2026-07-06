# Deontic Logic for Agent Action Policies: O, F, P and Contrary-to-Duty Obligations

Standard access control engines (XACML, Rego, Cedar) operate in a binary permit/deny world. Real policy languages are trimodal: **O(do x)** — the agent is obligated to perform x; **F(do x)** — x is forbidden (equivalently O(¬do x)); **P(do x)** — x is permitted, meaning ¬F(do x). The three are interdefined: F(do x) ≡ ¬P(do x), P(do x) ≡ ¬O(¬do x). An obligation O(do x) without a corresponding permission P(do x) is incoherent — it demands an action while forbidding it — and is a contradiction the policy DAG compilation step must catch.

## Standard Deontic Logic (SDL) and Its Failure Modes

SDL treats O, F, P as modal operators over a Kripke frame where accessibility relates "ideal" worlds. The problematic theorem is **deontic explosion**: from O(p) and O(p → q), SDL derives O(q), even when q is independently forbidden. This is harmless in legal philosophy but catastrophic in an enforcement engine — you cannot let obligation-chaining silently permit forbidden actions. The adjudicator avoids this by treating deontic operators as annotated predicates in Datalog, not modal operators in a classical frame. No logical closure; only explicit rules derive new obligations.

## Input/Output Logic (Makinson and van der Torre, 2000)

Makinson–van der Torre reformulate deontic logic as an **input/output system**: a set of pairs (a, x) read "given condition a, output norm x." The output logic is not classical entailment — you cannot feed an output back as input without explicit throughput rules, preventing the runaway-obligation problem. Four variants matter:

- **Simple-minded output (out₁):** {x : (a,x) ∈ G, A ⊢ a} — ground truth normative consequents given facts A.
- **Basic output (out₂):** Closes under AND-elimination and weakening in the output only.
- **Reusable output (out₃):** Allows putting outputs back into the input set when computing further outputs — this is where cycles become dangerous; restrict to stratified acyclic norm sets.
- **Basic reusable output (out₄):** out₂ + out₃.

In the adjudicator's policy DAG, each norm is an (a, x) pair where a is a Datalog conjunction over the substrate (agent ID, target resource, provenance chain) and x is a deontic conclusion (`permit(Action)`, `oblige(Action, postcondition)`, `deny(Action)`). Out₁ is the safe default for an enforcement engine — no output recycling, no risk of norm cascade.

**Concrete mapping:** The policy rule "if the agent reads PII, then it must log the access" is the pair (reads_pii(Agent, Resource), O(log_access(Agent, Resource, Timestamp))). At runtime, Datalog fires this to produce an `obligation` record. The reference monitor checks the obligation record before allowing the action to proceed and attaches the postcondition to the action execution envelope.

## Contrary-to-Duty (CTD) Obligations

A CTD obligation fires when a primary obligation has already been violated: "agents must not access credentials directly (primary); if they do, they must immediately rotate the credential (CTD)." SDL cannot represent CTDs without paradox (Chisholm's paradox, 1963). The standard resolution is **two-level normative systems**: primary norms at level L1, reparative/compensatory norms at level L2 that only activate when L1 is violated.

In the adjudicator this maps to enforcement modes:

- **Preventive mode** (L1): The action is blocked before execution if it violates O or F.
- **Corrective mode** (L2): If a hard-prevent fails or a soft constraint is violated, a CTD obligation triggers a compensating action (credential rotation, rollback, alert). The corrective obligation is itself a deferrable action, must be queued and tracked to completion, and failure to execute the correction is itself a new violation that escalates.

CTD tracking requires the provenance DAG to record violations as first-class events. A Datalog rule then joins on violation records: `oblige_corrective(Agent, Action) :- violation(Agent, PrimaryAction, T), not corrected(Agent, PrimaryAction).`

## Conflict Resolution: When O and F Collide

Policy conflicts — O(do x) and F(do x) in the same rule set — are compile-time errors, not runtime decisions. The policy DAG contradiction check (Soufflé's magic-sets evaluation) must flag this before deployment. For temporal conflicts (O(do x) in one time window, F(do x) in another), the resolution rule is temporal precedence with explicit override: the more specific time window wins, and ties escalate to human review.

When legitimate normative conflict exists (two organizational policies with different authorities), use a **priority ordering** over norm sources: regulatory > organizational > operational. The adjudicator's rule selection applies the highest-priority applicable rule; lower-priority conflicting rules are preempted and logged.

## Mapping to Port Daddy Permission Model

Port Daddy permissions are capability grants: a service claims a port identity and receives scoped access to coordination primitives (sessions, notes, claims, locks). The deontic mapping:

- **P(do x):** Port Daddy issues a capability (claim, lock, note) to an agent identity — explicit grant.
- **F(do x):** No capability issued AND the action type is in the deny list for that identity scope.
- **O(do x):** Post-conditions attached to session lifecycle: `begin_session` creates O(end_session_full) — the agent is obligated to close its session. Failure triggers the CTD: Port Daddy marks the session as abandoned and runs `pd salvage`.

The adjudicator's substrate query for Port Daddy actions includes `session_active(Agent)`, `capability_held(Agent, CapType)`, and `prior_violation(Agent, Window)`. A DENY verdict for `pd claim_port` when `session_active = false` maps to F(claim_port) unless the agent has an active session context — a precondition obligation, not a capability check.

## Key Points

- O, F, P are interdefined: implement exactly one as primitive; derive the others. Implementing all three independently creates inconsistency risk.
- Use Makinson–van der Torre out₁ (no output recycling) as the policy output logic in enforcement engines — it prevents obligation cascade without explicit throughput rules.
- Contrary-to-duty obligations require a two-level normative system and provenance DAG violation records; they cannot be represented as simple Datalog rules without tracking violation state.
- Policy contradictions (O(x) and F(x) for the same action type) are compile-time failures, not runtime decisions. The policy DAG compilation step must catch them with Soufflé contradiction checking before deployment.
- Port Daddy's capability model maps cleanly to P (capability granted) and F (capability absent + deny-list), but O (lifecycle obligations like must-end-session) requires the adjudicator's obligation tracking layer that Port Daddy's native enforcement does not provide.

## See Also

- `SKILL.md §Deontic operators` — brief operator survey; this document is the deep reference for that section.
- `references/datalog-policy-dag.md` — how norms compile to Soufflé rules and the contradiction-detection query.
- Makinson & van der Torre (2000), "Input/Output Logics," Journal of Philosophical Logic 29(4):383–408 — the canonical formalization; out₁–out₄ taxonomy originates here.
