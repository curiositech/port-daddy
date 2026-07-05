# Token Networks and Incremental Commitment: Building Schedules Without Over-Committing

## The Architecture of Commitment

Every planning and scheduling system must manage a fundamental tension: to make decisions, you must commit to something; but every commitment restricts future options and risks locking in a suboptimal or infeasible course. The question is not whether to commit — you must, eventually — but *when* and *to what level of specificity*.

Classical systems resolve this tension by committing fully and early: at the start of scheduling, assign resources; assign exact times; determine the complete execution order. This makes the decision-making procedure simple but makes recovery from bad decisions expensive.

HSTS resolves it differently: through a **token network** architecture that supports graduated, incremental commitment. Decisions are made at the coarsest level of specificity that is currently useful, and refined only when additional information justifies further commitment. The system maintains, at every stage, the most accurate possible picture of remaining flexibility.

## Tokens: The Unit of Partial Commitment

The fundamental data structure is the **token** — a 5-tuple:

`<token-type, state-variable, value-type, start-time, end-time>`

where `token-type` is one of `CONSTRAINT-TOKEN`, `SEQUENCE-TOKEN`, or `VALUE-TOKEN` (see
`token-networks-as-executable-knowledge-representation.md` for the full definition of each level).
The key point for the *commitment* story is that `token-type` is itself a dial the planner can turn:
the same slot in the timeline can be filled with a token that commits to almost nothing (a
constraint token, "some value from this set will occur here"), a token that commits to a process
shape but not its exact trajectory (a sequence token), or a token that commits to one specific value
(a value token). Nothing about the timeline's structure changes across these levels — only how much
of the token's content has been pinned down.

## Refinement Without Rebuilding

Because every token occupies a fixed position in the same temporal data structure regardless of its
commitment level, refining a decision never means rebuilding the plan. Turning a constraint token into
a value token is a local edit: the flanking constraint tokens absorb whatever slack is left over, the
time point network re-propagates locally, and every other token in the network is untouched unless it
was directly linked to the one being refined.

This is the practical payoff of graduated commitment: a planner can publish an early, coarse-grained
schedule (mostly constraint and sequence tokens) that is good enough to start execution, and then
progressively tighten specific tokens into full commitments as more information becomes available —
without ever having to discard and replant the parts of the schedule that already worked.

## Application to Agent Systems

For agent orchestration, this maps onto a familiar problem: how specific should a workflow plan be
before execution starts? The incremental-commitment answer is: as specific as is currently justified,
and no more. A workflow stage can be represented as a constraint token ("some validation step will run
here") long before the orchestrator knows which validator, which agent, or how long it will take. As
those decisions become available — a capability is selected, an estimate is produced, a dependency
resolves — the token is refined in place, narrowing from constraint to sequence to a fully bound value
token, without re-deriving the surrounding plan. The alternative — committing to a fully detailed DAG
before any agent has run — throws away exactly the flexibility that makes multi-agent orchestration
resilient to surprises.