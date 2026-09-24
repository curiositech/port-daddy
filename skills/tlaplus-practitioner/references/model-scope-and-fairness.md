# Model scope, fairness, and claim limits

Translate one concrete race/lifecycle claim at a time. State abstract variables,
initial states, transitions, invariants, temporal properties, and excluded
behavior (pauses, delayed messages, restarts, fencing, clock skew). A finite
counterexample is useful within those assumptions; a pass does not establish
excluded behavior or implementation correctness.

Weak fairness means a continuously enabled action eventually occurs; strong
fairness means an action enabled infinitely often eventually occurs. Add only
assumptions justified by the modeled environment. Fairness excludes behaviors
and can hide realistic starvation/crash paths. Confirm the selected
`SPECIFICATION` includes the fairness clause supporting the liveness claim.
Liveness depends on both the property and scheduling/environment assumptions.

Bounded clocks need explicit saturation or terminal-state policy. A disabled
`Tick` at the maximum may deadlock; a stuttering saturated clock is an
abstraction whose adequacy still needs review. Constants and state counts are
descriptive, not coverage targets. Keep spec/config/tool version/output/trace
together. TLC was not run for this research draft.

The bundled BondedCommons model treats `Crash` as irrevocable: stale agents
cannot heartbeat again. It excludes live-but-paused agents, delayed/reordered
heartbeat, restart, and external lease fencing. `UniqueOwnerMapping` follows
largely from `portOwner` being a function; it is not independent two-claimer
evidence. Finite clock and saturated `Tick` are abstractions. `SPECIFICATION
Spec` is needed for its declared `WF_vars` clauses to apply.
