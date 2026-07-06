# Swarm Invocation Patterns

Use this when designing the operator-facing "summon agents" action.

## Pattern: Lead And Specialists

- Lead agent decomposes and owns merge.
- Specialists own disjoint files or roles.
- Good for: feature work with research/test/doc lanes.
- Risk: lead bottleneck or vague handoff.

Required receipt:

- decomposition
- role map
- file claims
- merge plan
- specialist outputs
- final validation

## Pattern: Tournament

- Multiple agents attempt the same task in isolated worktrees.
- Reviewer compares outputs.
- Good for: uncertain design choices, bug diagnosis, prompts/evals.
- Risk: spend and duplicate effort.

Required receipt:

- branch/worktree per entrant
- comparison rubric
- winner rationale
- discarded work cleanup

## Pattern: Relay Chain

- Research -> design -> implementation -> test -> review.
- Good for: high-risk changes where each stage has a different quality bar.
- Risk: contract mismatch between stages.

Required receipt:

- output contract per stage
- artifacts passed forward
- blockers and assumptions

## Pattern: Ambient Watchers

- Background agents monitor CI, review comments, docs drift, or costs.
- Good for: long-running PR finish line and operations.
- Risk: noisy alerts and unclear owner.

Required receipt:

- watch scope
- alert threshold
- owner for action
- unsubscribe/cancel path
