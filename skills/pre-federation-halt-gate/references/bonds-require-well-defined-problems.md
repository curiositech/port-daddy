# Bonds Cannot Be Written on Ill-Defined Problems

A Port Daddy bond (`lib/bonds.ts`) is a collateralized work contract: the requester
signs a `FloatPlan`, the daemon debits the wallet into a SQLite escrow row, and settlement
is determined by an oracle over machine-checkable acceptance criteria. The oracle is the
load-bearing piece. It is defined explicitly as *a trusted source of ground truth the agent
cannot author* — a passing test id, a merged commit SHA, a satisfied Arbiter check. The
acceptance criteria must be checkable by that oracle, which means they must be **precisely
specified** before the bond is written.

An ill-defined problem breaks this in two ways:

**1. No oracle can grade it.** If the acceptance criteria are stated in natural language
("make the app feel better", "resolve the auth issue"), no automated oracle can return a
binary verdict. Without a binary verdict, settlement cannot reach `success`, `partial`,
`sabotage`, or `dispute` — it hangs. The bond stays in escrow, the conservation invariant
(`wallet + escrow + commons = supply`) holds but the funds are frozen, and the
operator's capital is locked with no resolution path. This is not a theoretical edge case:
pd-adr-041 (`lib/commitments.ts`) enforces exactly this — `state='done'` is reachable only
with a `closed_by_oracle_ref`; free-text notes do not close a commitment.

**2. Slashing becomes arbitrary.** When the problem is ambiguous, the worker cannot
determine whether they delivered what was asked. A dispute (`2-of-3 multi-oracle:
automated / evidence / human`) with ambiguous acceptance criteria devolves to the human
oracle, which destroys the automation value. Worse, an operator who didn't specify what
success looks like has no principled basis for declaring sabotage and triggering a slash.
The mechanism relies on unambiguous criteria; without them it is a tool for bad-faith claims.

## The RCP-0a Checkpoint

RCP-0a (from the WinDAGs → Port Daddy graft memo) names this formally: *the pre-federation
halt gate must fire before cross-operator parley; bonds require well-defined problems.* In
the WinDAGs pipeline this maps to the `preFederationHaltGate` function in
`packages/core/src/context/meta-dag-predict.ts` (lines 347–360): if
`sensemaker.confidence < 0.6` or `halt_reason` is set, the gate emits a `waves: []` stub
and returns `ESCALATE_TO_HUMAN`. No decomposition runs; no skill assignments are made; no
bonds are written. This is a **pre-federation** gate because once subtasks exist and skills
are assigned, reverting is expensive. Catching ambiguity before any allocation is cheap.

The gate operationalizes Polya's four principal parts: `unknown` (what are we solving),
`data` (what we have), `conditions` (testable constraints), `output_type` (the answer's
form). All four must be statable with precision before a float plan's acceptance criteria
can be written. The Sensemaker scores clarity (weight 0.4), feasibility (0.3), and
coherence (0.3) against these parts. Dimensional overrides: `clarity < 0.5` halts
immediately; `feasibility < 0.4` or `coherence < 0.4` also halts. These are not
conservative thresholds — they are the minimum below which no oracle can grade the work.

## Connection to Port Daddy Paper 4 (The Harbor Economy)

Paper IV (*The Harbor Economy: Float Plans, Bonds, and a Three-Sided Market*,
`docs/research/north-star/agent-economy-anchor.md`) frames bonds as the settlement
mechanism for a **three-sided market**: operator-for-hire (labor), rentable agents
(capital), and licensed skills (IP). All three sides settle on the same float-plan escrow;
conservation holds globally because `lib/bonds.ts` enforces it with a property test across
10,000 random operation traces (`tests/unit/bonds-conservation-property.test.js`).

The RCP-0a gate is the **supply-side precondition** for Paper IV to function: the three-sided
market is coherent only if every float plan entering it has oracle-checkable acceptance
criteria. A vague task cascades differently on each side. For a **skill licensor**, metered
release with clawback (`paid only on green settlement`) fails — you cannot have "green
settlement" without a binary acceptance check. For an **asset-rental** (a leased agent), the
residual control right that makes leasing contractible at all (the Arbiter jail, per the
Grossman & Hart incomplete-contracts argument in §3.4 of the paper) cannot be exercised
without knowing what the task is. For the **operator-for-hire**, margin is
`bounty − Σ(slashed sub-bonds) − ledger_fee`; you cannot price the risk of sub-bond slashing
without knowing what constitutes delivery.

**Honesty check on build-state.** `lib/bonds.ts` with its conservation invariant is **built**.
The three-sided market beyond it (operator-for-hire, rental, licensing sides) is **designed
but not running** — reputation/Elo has no implementation in `lib/`. RCP-0a applies today
within WinDAGs (single-operator pipeline); cross-operator bonds require the L3 federation
layer specified in ADR-0027 and Paper VII, which is whitepaper'd, not built.

## Key Points

- A Port Daddy bond settles via an oracle over machine-checkable acceptance criteria. Any
  problem that cannot produce those criteria cannot produce a bond. The gate's job is to
  enforce this before allocation begins.
- The 0.6 confidence threshold corresponds to the weighted validity formula
  `(clarity × 0.4) + (feasibility × 0.3) + (coherence × 0.3)`; below 0.6, at least one
  dimension is degraded to the point where acceptance criteria cannot be stated precisely
  enough for oracle grading.
- Dimensional overrides (`clarity < 0.5`, `feasibility < 0.4`, `coherence < 0.4`) halt
  immediately regardless of the weighted total. They fire before the float plan is written,
  not after.
- RCP-0a is named "pre-federation" because federation (multiple operators sharing a bond
  ledger) makes ambiguity more expensive in proportion to the number of parties. It must
  fire at the single-operator level too.
- Paper IV's three-sided market (labor / capital / IP) inherits this requirement: metered
  skill licensing, asset rental, and operator-for-hire margins are all computed relative to
  "green settlement," which requires binary acceptance criteria.

## See Also

- `SKILL.md` — halt gate pseudocode, validity formula, dimensional override thresholds
- `docs/research/north-star/agent-economy-anchor.md` — Paper IV; §3.1 (float plan), §3.3
  (oracle + four terminal states), §3.4 (three sides on one escrow)
- `docs/adr/pd-adr-041-durable-commitments-and-obligation-monitoring.md` — oracle-bound
  closure; the rule that `state='done'` requires a `closed_by_oracle_ref`, not free text;
  the commitment object that makes no-escape obligations machine-enforceable
