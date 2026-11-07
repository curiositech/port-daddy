# Future admission and bonded incentives

Research date: 6 November 2026. Canonical work records: NEXT-P6 and REVIEW-MATH-20261106 in the Omni ledger.

## What this lets an operator do

Before accepting a promise, enumerate a declared finite workflow's possible future states and ask whether the resulting obligations can conflict. Today's facts can be consistent while a deadline activates incompatible obligations. Conversely, combining mutually exclusive futures can reject a promise for a conflict that cannot occur. The provider distinguishes those cases and returns a concrete transition trace when it finds a conflict.

The supplied two-operation example has eight reachable states and four maximal effective fact sets. The initial policy is safe in this model; the additional promise admits a one-transition future conflict. This is a constructed example, not a deployed scheduler or an agent trial.

## Precise contract and argument

Let S be a finite transition system with a nonempty initial set, R its reachable states, and L(s) the current fact label of s. Fix positive Horn rules, deontic rules, scopes, intervals, resource claims and difference constraints. Let B be the unconditional baseline facts, and C(F) the R17 conflict predicate. C is upward closed: adding facts cannot retract a Horn consequence or a fired obligation; unconditional resource and temporal conflicts do not depend on the added facts.

For the finite nonempty family F={B union L(s):s in R}, every member is contained in an inclusion-maximal member. Thus every reachable state is conflict-free iff every maximal member is conflict-free. One direction uses upward closure; the other uses the fact that every maximal member is itself a reachable label. No monotonicity of transitions is required.

This argument does not justify pruning state exploration by label inclusion. Two control states can have identical labels and different successors. The implementation explores concrete state IDs first and filters labels afterward. Labels replace current facts rather than accumulating expired facts. The checker returns safe only after complete exploration, unknown on truncation without a witness, or unsafe with a replayable path. Its digests bind supplied artifacts; they neither authenticate a model author nor prove runtime coverage. Bounds limit exploration, not parsing, filtering or the underlying quadratic pair scan.

## Independent checks

`test_future_fact_reachability.py` uses transitive closure rather than the provider's BFS, and intersection of satisfying truth assignments rather than its Horn propagation. Its 49,152 small graph/label/policy decisions include 18,624 safe and 30,528 unsafe outcomes; all unsafe witnesses replay. The 27 tests also cover retraction, unreachable unions, equal-label control states, closed interval endpoints, resource and temporal conflicts, malformed inputs, exact/zero budgets, and changed bindings. A paired model test shows that omitting a transition can change unsafe to safe: complete graph traversal is not runtime conformance.

These are new bounded checks. They do not inherit old experiment counts or establish unbounded operational behavior.

## Bonded trigger audit

The second checker evaluates both persistent principals at every public state C,P1,...,Pk, with exact rational Bellman equations and one-action deviations. It assumes perfect public observation, risk-neutral discounted utility, third-party forfeiture and unlimited exogenous funding. Exit, finite bankroll, coalitions and participation are outside the model.

Three distinct games are explicit: every F is fined; only F in cooperation is fined; or any action that deviates from the public state's prescription is fined. The last also fines T during punishment. For the illustrative payoff matrix (T,T)=3, (F,T)=4, (T,F)=0, (F,F)=1 and fine t, the cooperation inequality is 1-t <= (2+t) sum(delta^j,j=1..k) when every F is fined; it is 1-t <= 2 sum(delta^j,j=1..k) when prescribed punishment is exempt. The latter inequality alone cannot distinguish the two exemption policies' off-path incentives.

With t=2, delta=1/10, k=3 and every F fined, a deviation in cooperation loses 361/250, but a deviation at P3 gains 249/250. Cooperation-only checking would miss the failure of credible punishment. At k=1, delta=1/2, t=0, equality gives weak obedience, not strict action deterrence. Subtracting a constant from all payoffs can preserve obedience while making participation unattractive.

The 14-test suite compares 192 configurations and 1,440 independently derived state/player values and gains. It includes asymmetric payoffs and altered-transition controls. This is an executable finite-game audit, not a new equilibrium theorem, a proof-assistant certificate, or an empirical payoff estimate.

## Prior art and next result

[Doyen and Raskin, Antichain Algorithms for Finite Automata](https://lsv.ens-paris-saclay.fr/~doyen/papers/Antichains_Algorithms_Finite_Automata.pdf), sections 2–3, treats antichain representations and simulation-compatible reachability. Our post-enumeration filtering does not supply the simulation relation needed to reduce exploration. The present contribution is the explicit contract, adapter and falsifiable witnesses, not the maximal-set observation. The campaign literature review records further neighboring compliance and enforcement work.

The next useful result is a conformance theorem for one real workflow: all implementation transitions, including crash/retry/recovery routes, map to the model; admissions are atomically bound to the checked model, policy and state revision; and incomplete exploration cannot authorize an effect. A state-table-only adapter is insufficient when implementation recovery routes bypass that table. A finite-bankroll extension is a separate game, requiring bankroll states and outside options.
