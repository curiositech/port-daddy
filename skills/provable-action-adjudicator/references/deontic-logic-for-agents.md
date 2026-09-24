# Obligations, prohibitions, permissions, and repair duties

Use this reference to design an explicit policy semantics. It is not evidence that Port Daddy runs a deontic engine, Soufflé compiler, or complete reference monitor.

## State the logic before deriving permissions

Write `O(p)` for an obligation, `F(p)` for a prohibition, and `P(p)` for permission. In a normal deontic formalization one may define `F(p) = O(not p)` and weak permission `P(p) = not O(not p)`. An explicit operational grant is different from the absence of a prohibition: missing facts, an expired grant, and a proved denial need distinct treatment at a real effect boundary.

Do not assume every policy system shares these interdefinitions. Pin the chosen semantics and specify how conflicts, missing information, time and authority map to `ALLOW`, `DENY`, or `INDETERMINATE`. The derivation from `O(p)` and `O(p implies q)` to `O(q)` is ordinary modal distribution, not by itself a derivation of arbitrary conclusions. Calling it “deontic explosion” obscures the actual conflict and consistency assumptions. An explicit rule engine still needs a defined inference semantics; naming its predicates `oblige` or `deny` does not solve consistency.

## What the cited input/output logic establishes

[Makinson and van der Torre, Input/Output Logics (2000)](https://icr.uni.lu/leonvandertorre/papers/jpl00.pdf), sections 3–5, distinguishes simple-minded output, basic output, and reusable versions of each. With classical consequence `Cn`, simple-minded output is `out1(G,A) = Cn(G(Cn(A)))`. Its rules include strengthening inputs, conjoining outputs and weakening outputs. Basic output adds disjunctive-input reasoning; reusable variants add cumulative transitivity. Non-reusable does not mean “no logical closure,” and the paper does not establish a universally safe enforcement-engine default. The previous bare set-of-fired-heads formula omitted closure and mischaracterized basic output. Accessed 2026-09-24: author-hosted paper metadata and those sections; no local implementation correspondence was proved.

For an implementation, publish the exact supported fragment, rule closure, negation/missing-fact behavior, cycle handling and conflict query. Prove or test that translation for its stated scope instead of claiming that arbitrary Datalog realizes one of the paper's operators.

## Existing policy languages are not one binary abstraction

- [XACML 3.0 sections 7.17–7.18](https://docs.oasis-open.org/xacml/3.0/xacml-3.0-core-spec-os-en.html) define Permit, Deny, Indeterminate and NotApplicable decisions, with obligations and advice. Returning an obligation does not prove its external fulfillment.
- [Rego](https://www.openpolicyagent.org/docs/policy-language) reasons over structured documents and supports author-defined rules and decisions; describing the language as intrinsically a binary permit/deny model is too narrow.
- [Cedar](https://docs.cedarpolicy.com/policies/syntax-policy.html#effect) defines permit and forbid policies, with implicit denial absent an applicable permit and overriding applicable forbids. That operational rule is not the same as deriving a grant from weak permission in a modal logic.

These are source-level distinctions, checked against official documentation on 2026-09-24, not benchmark comparisons or evidence of integrations here.

## Concrete proposed obligation record

For a protected data read, a **local design** might require an audit intent before dispatch and a completion receipt afterward. Keep these separate:

```json
{
  "obligationId": "illustrative-read-audit-1",
  "sourcePolicyDigest": "<pinned digest>",
  "trigger": "<exact authorized read intent>",
  "phase": "post-effect",
  "owner": "<authorized audit writer>",
  "deadlinePolicy": "<declared policy>",
  "satisfactionEvidence": "<durable receipt locator or unknown>",
  "repairAuthority": "<separate grant, if needed>"
}
```

This is a conceptual record, not a validated wire schema. Specify which obligations are preconditions and which become due afterward. A postcondition cannot be established before its event merely by attaching it to an envelope. Preserve partial completion and ambiguous effects.

## Contrary-to-duty repair

A repair duty is triggered after a primary duty is violated. For example, unauthorized credential exposure may trigger containment and a separately authorized rotation. Record the violation, current credential generation, accountable owner, deadline policy, repair permit and independent completion evidence. Rotation is a new consequential effect; the duty does not mint authority to execute it. Preserve the original violation even after repair succeeds.

A two-stage primary/repair workflow is one useful implementation proposal, not a theorem that all contrary-to-duty reasoning requires exactly two levels or is impossible in every other formalism. An unresolved or failed repair remains an obligation state with its own escalation policy.

## Detecting and resolving policy conflicts

Reject statically detectable contradictions in the supported fragment. Context-dependent authority, facts and time can expose additional conflicts during evaluation; retain `INDETERMINATE` or the declared conflict result rather than assuming compilation resolved everything.

[Soufflé magic-set transformation](https://souffle-lang.github.io/magicset) optimizes evaluation by avoiding irrelevant intermediate tuples. It is not an automatic contradiction detector. An application must define its own conflict relations, their semantics and tests.

Do not impose a universal source-priority hierarchy or “most specific time window wins” rule. Record the policy owner's authorized precedence, scope, override conditions and tie behavior. An illustrative conflict query is “the same grounded action, principal, scope and interval is both required and forbidden”; the implementation must define those joins and its treatment of incomplete inputs.

## Mapping to an agent coordination system

A proposed mapping can bind an explicit permission to a scoped grant and a lifecycle duty to an obligation record. A cooperative file claim, port allocation, session status or note is not automatically such a grant. Verify the actual enforcement point and authority semantics in source and separately in runtime evidence before describing a product behavior. Under the local runtime halt, keep that implementation claim unestablished and do not start a runtime to fill the gap.

Review with the [claim and threat-model reference](claim-ladder-and-threat-model.md) and [external source ledger](source-ledger.md). No missing `datalog-policy-dag.md` or nonexistent entrypoint section is required by this repaired reference.
