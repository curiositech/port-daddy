# 0040. Non-Forgeable Actor Identity

## Status

Proposed

## Context

This ADR is the prerequisite for durable agent accountability (ADR-0041) and
follows directly from the research synthesis in
`whitepaper/research/program/archive/accountability/agent-accountability-proposal.md`. That work found that **29 of 29**
proposed accountability mechanisms flagged a **Goodhart risk** (Goodhart 1975;
Strathern 1997 — *"when a measure becomes a target, it ceases to be a good measure"*),
and that **11 of 29** failed specifically to **Sybil-reset** (Douceur 2002, *The Sybil
Attack* — *defeating a reputation system by minting fresh identities*).

The root cause is concrete and present in the code today. Port Daddy identities are
**self-asserted strings** of the form `project:stack:context`, resolved by the
**actor-roster** (`lib/actor-roster.ts` — *maps agent-supplied identity fields to a
canonical actor id, freely aliasing one to another*). The **budget-guard**
(`lib/budget-guard.ts` — *admission control that throttles or kills an agent by token/$
spend*) keys its ledger on `(project, agentId, utcDay())`. So an agent that earns a
throttle, a slash, or a bad reputation simply re-registers under
`project:stack:context2` and inherits a clean slate. Every reputation-, sanction-, or
obligation-history mechanism built on this identity is, in the words of the adversarial
review, "climbing an imaginary staircase."

A reputation system is only **incentive-compatible** (Nisan et al. 2007, *Algorithmic
Game Theory* — *a mechanism is incentive-compatible when honest behavior is each agent's
best strategy*) if a bad record cannot be shed more cheaply than it can be earned. That
requires an identity the agent cannot freely re-pick.

## Decision

Introduce a **daemon-minted, non-forgeable actor id** as the canonical principal that all
accountability state keys on. (The **daemon** is `server.ts`, the always-on
`com.portdaddy.daemon` process on `localhost:9876` backed by SQLite — *the only component
that can hold state no agent can edit*.)

### Identity shape

- On first registration, the **daemon** mints an opaque `actor_id` (ULID) and binds it to
  a credential the agent cannot cheaply re-pick: a per-actor signing key, or the
  body-lease token from **actor-souls** (`docs/adr/0022-durable-actor-souls-and-body-leases.md`
  — *the durable identity/state of an agent that outlives any one process or session*).
- The self-asserted `project:stack:context` string becomes a **display alias**, resolved
  by `lib/actor-roster.ts` *to* the minted id — never the other way around. An agent may
  not assert a fresh canonical id.
- Re-registration with the same credential returns the same `actor_id`. Re-registration
  without it is a **new** actor that starts from the newcomer floor (below), and the event
  is logged.

### Anti-Sybil newcomer policy

A strict newcomer floor blocks legitimate new agents; a lenient one makes Sybil-reset
free. Resolve the dilemma without a scalar: a newcomer gets *full ability to work* but
*reduced economic ceiling* — lower default **bonds** (`lib/bonds.ts` — *collateral an
agent escrows on spawn, refunded on clean exit or slashed on failure*) ceiling and lower
`budget-guard.canSpawn` ceiling — until it has accrued daemon-witnessed clean exits. This
prices identity churn without locking out genuine first runs. For the single-operator
fleet, an operator-trusted credential bypasses the floor.

### What keys on the minted id

`lib/budget-guard.ts` ledger, `lib/bonds.ts` escrow/slash, the ADR-0041 obligation history,
the sanction ladder, and any future reputation projection. The `(project, agentId, utcDay)`
key in budget-guard is migrated to `(project, actor_id, utcDay)`.

## Consequences

- **Positive:** every downstream accountability mechanism becomes meaningful; a respawn no
  longer launders a record. Satisfies **Law 3** of the accountability proposal.
- **Cost:** a registration/identity migration touching `lib/actor-roster.ts`,
  `lib/budget-guard.ts`, and the `POST /agents` route. This is the *one* genuinely
  architectural piece of the accountability program — everything else is additive.
- **Non-goal:** cryptographic agent attestation against a malicious *human* operator. The
  threat model is a lazy/self-interested *agent* in a fleet the operator owns, not a
  hostile operator. Per-actor keys raise the cost of accidental and strategic churn; they
  are not a PKI. The cross-operator extension — the "unbuilt keystone" the marketplace
  (ADR-0051) waits on — is specified separately in **ADR-0094**, which profiles the
  boundary artifacts on SD-JWT-VC / JWS / JCS so external verifiers need no bespoke SDK;
  this ADR's local ULID + newcomer floor remains the right machinery *inside* one
  operator's fleet.

## Alternatives considered

- **Keep self-asserted ids, add a denylist.** Rejected: enumerating bad identities is the
  same losing game as a denylist of bad behavior — the agent picks a name not on the list.
- **Key on worktree/branch.** Rejected: worktrees are created and destroyed routinely
  (this very work spans three), so the key would churn as fast as a string.

## References

- `whitepaper/research/program/archive/accountability/agent-accountability-proposal.md` (Law 3; the 46→29→1 result)
- ADR-0022 (durable actor-souls / body-leases)
- ADR-0041 (durable commitments — the primary consumer of this identity)
- ADR-0094 (harbor cards as verifiable credentials — the cross-operator extension)
