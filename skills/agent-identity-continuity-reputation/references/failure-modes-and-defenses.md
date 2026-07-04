# Failure Modes and Defenses (each one turns a link to theater)

Load this when auditing an existing identity/continuity/reputation design, or
when a Quality Gate in `SKILL.md` fails and you need the named failure mode,
its source, and the concrete defense — not just the checkbox.

| Link | Failure | Name + source | Defense |
|---|---|---|---|
| identity | respawn under new id buys clean slate | **Sybil-reset** (Douceur 2002) | daemon-minted id bound to a credential |
| identity | let rep rot, re-enter as newcomer | **whitewashing** (Friedman & Resnick 2001) | newcomer floor: full ability to *work*, reduced economic *ceiling* until clean-exit history accrues |
| continuity | "resurrection" only forwards a note | weak checkpointing dressed as strong | label honestly; it is continuity-of-record, not of-state |
| outcome | agent self-closes its own success | **Goodhart** (Strathern 1997) | close only against an oracle; sampled adversarial re-open |
| reputation | optimize the proxy, not the work | Goodhart again | gate on predicates, score as telemetry; pair with adversarial QA |
| reputation | cold start / new backend looks bad or untested | exploration starvation | TrueSkill uncertainty or bandit exploration bonus; never zero-out a newcomer |
| judge | self-preference / position / verbosity | LLM-judge bias (Zheng 2023) | blind, order-swap, pairwise, family-exclude |
| sanction | hollow compliance cheaper than honesty | incentive mis-design (Nisan 2007) | graduated, staked sanctions; audit-failed fake must cost MORE than honest non-completion |

## Why each row matters (one line of "so what")

- **Sybil-reset**: without a non-forgeable id, "reputation" is a number attached
  to a name the agent itself chose — worthless the moment it's inconvenient.
- **Whitewashing**: a reputation system with no newcomer floor either locks out
  every genuine first run (killing onboarding) or lets bad actors reset for
  free (killing the signal). The floor must price churn, not block it.
- **Weak checkpointing dressed as strong**: the single most common overclaim in
  practice — a text handoff note is not an outcome ledger, and calling it one
  hides exactly the audit trail a reputation system depends on.
- **Goodhart (outcome + reputation rows)**: the same failure appears twice
  because it recurs at two altitudes — first at outcome closure (self-graded
  success), then again at the reputation layer (optimizing the score instead
  of the work the score was meant to proxy).
- **Exploration starvation**: a naive Elo-only rollout will systematically
  starve every new backend/agent of tasks because it looks bad on a
  wide-uncertainty small sample — the fix is representing uncertainty, not
  hand-tuning a floor score.
- **LLM-judge bias (Zheng 2023)**: position, verbosity, and self-preference
  bias are measured, replicated effects, not theoretical concerns — treat any
  un-de-biased judge in a reputation pipeline as a known-broken component.
  Verify the citation before quoting specific bias magnitudes; do not cite
  numbers from memory.
- **Staked, graduated sanctions**: if the cost of getting caught faking
  compliance is lower than the cost of honest non-completion, faking wins in
  expectation — the sanction ladder must invert that inequality.
