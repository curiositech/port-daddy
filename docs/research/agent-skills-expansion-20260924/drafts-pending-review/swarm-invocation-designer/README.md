# Swarm Invocation Designer

This bundle defines and reviews a static, controller-owned invocation contract. It does not launch, supervise, stop, or transport agents; it does not grant authority; and it makes no live latency or throughput claim.

## Static contract scope

Use the canonical [SKILL.md](SKILL.md) to specify and review:

- a sealed execution plan, including inputs, outputs, authority boundary, and explicit stop conditions;
- a bounded capacity and budget envelope;
- signed or otherwise verifiable identity and plan binding where the surrounding system provides those mechanisms;
- receipts that make each attempted invocation and observed outcome auditable; and
- an escalation and recovery path for unavailable, rejected, or uncertain outcomes.

A static contract is evidence about intended authorization and reviewable constraints. It is not evidence that a swarm ran, that a transport delivered a message, or that an effect completed.

## Static review sequence

1. Read [SKILL.md](SKILL.md) and identify the controller and effect boundary.
2. Enumerate permitted actions, budget limits, stop conditions, and required receipts.
3. Reject ambiguous authority, unbounded fan-out, missing recovery, or claims that a planned contract proves execution.
4. Record the contract version and the evidence needed to verify an actual run separately.

## Optional descriptive context

- [Invocation patterns](references/invocation-patterns.md) summarizes product and coordination patterns. It is descriptive only and grants no launch authority.
- [Fast agent bus](references/fast-agent-bus.md) discusses conceptual transport trade-offs. It does not select or operate a transport and provides no local latency guarantee.
- Schemas and examples in this bundle illustrate contract shape; validate them in the owning system before relying on them for an actual operation.
