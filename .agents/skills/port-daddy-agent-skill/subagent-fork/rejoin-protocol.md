---
title: "Re-join protocol"
purpose: "How the parent re-integrates a sub-agent's result without losing context or breaking coordination."
---

# Rejoin Protocol

A sub-agent's return is the second-most-critical handoff (after fork). Mishandling it loses context, drops claims, or merges bad work.

## When the sub-agent finishes

The sub-agent should have:

1. Released its file claims (`pd session files release ...`).
2. Dropped its final result note in its own session.
3. Produced output matching `task_specific.return_shape`.
4. Called `pd done "<outcome>"` on its session.

If any of those is missing, the parent should treat the sub-agent as INCOMPLETE — see "incomplete sub-agent" below.

## Parent's rejoin sequence

```
START: sub-agent has returned (foreground) or notification fired (background)

1. Read the sub-agent's final note.
   pd notes --session <subagent-session-id> --limit 5
   The final note is the source of truth for what the sub-agent did.

2. Parse the structured output (matches task_specific.return_shape).
   - If parsing fails → sub-agent is incomplete or scope-drifted; see below.

3. Verify the sub-agent's claims were released.
   pd session files --session <subagent-session-id>
   - If files are still claimed → release them now (`pd session files release`).
   - Stale claims block your re-claim or downstream agents.

4. Re-claim the files in YOUR session for the merge.
   pd session files add <each-file-the-subagent-touched>

5. Validate the sub-agent's edits.
   - Run the targeted test for the partition.
   - Read the diff.
   - Confirm it matches the scope you handed off.

6. Integrate.
   - For parallel-edit forks: apply each sub-agent's diff in deterministic order.
   - For research forks: parse findings into your context, decide next step.
   - For verification forks: act on the second opinion.
   - For background forks: rehydrate result, decide whether it's still valid.

7. Drop a note recording the rejoin.
   pd note "Rejoined subagent <id>. Result: <summary>. Action taken: <merged/discarded/escalated>."

8. If the sub-agent was the last outstanding fork, you can close your session
   when your overall task is done. Until then, keep the parent session open.
```

## Validating the sub-agent's output

Before integrating, check:

| Check | If fails |
|---|---|
| Parses as `return_shape` | INCOMPLETE — re-fork or finish manually |
| Files modified ⊆ files_partition | SCOPE DRIFT — review additions for correctness |
| Tests for the partition still pass | BUGGED — escalate or re-fork |
| Diff is sensible (no debug prints, no unrelated reformatting) | NEEDS CLEANUP |
| pd notes show coordination obligations met | COORDINATION HOLE — note publicly |

## Incomplete sub-agent

A sub-agent counts as incomplete if any of:

- It exited without a final note
- Its final note doesn't match `return_shape`
- Files it claimed are still claimed (didn't release)
- Tests on its partition fail
- Its scope drifted beyond what was handed off

Recovery options:

```
INCOMPLETE → choose one:

A) Pick up the work yourself.
   - Read whatever it did write.
   - Read salvage entry for it.
   - Continue from where it stopped.

B) Re-fork with adjusted scope.
   - If the original scope was too large, partition smaller.
   - If shared_assumptions are now stale, re-validate first.

C) Discard and do it sequentially.
   - If parallel was a bad call, drop the parallelism.

D) Escalate.
   - If the sub-agent's incomplete state is a coordination bug
     (e.g., it found a real conflict you didn't anticipate),
     publish to coordination:inconsistency.
```

## Background fork rejoin

For background forks, you'll get a notification when the sub-agent completes. The sequence is the same as foreground, but with one extra check:

**Did the parent's foreground state drift while the sub-agent worked?**

```bash
# Compare your shared_assumptions with current state.
# If origin/main moved, files got claimed, or branch shifted →
# the sub-agent's work might no longer apply cleanly.
```

If state drifted, integrate the sub-agent's result against CURRENT state, not against what they thought was current. Sometimes that means rebasing their diff; sometimes that means discarding it.

## Releasing parent session after rejoin

DO NOT call `pd done` on the parent session until:

- All sub-agents have rejoined or been declared incomplete.
- Their work is integrated or explicitly abandoned.
- A final note records the integration outcome.

Closing parent early orphans pending sub-agents (they can't message back into a closed session). The salvage queue picks them up but you've lost the context.

## Anti-patterns

| Don't | Why |
|---|---|
| Trust the sub-agent's claim that it succeeded without verifying | Sub-agents lie about success more often than humans |
| Skip the structured-output check | Prose returns are unparseable; future-you will hate present-you |
| Re-claim files before sub-agent releases them | Race condition; daemon may reject |
| Merge sub-agent diffs incrementally and re-test in between | Hides cross-cutting failures; merge once, test once |
| Close parent session while sub-agents are still in-flight | Loses re-join target |

## Related

- `when-to-fork.md` — should you fork?
- `partition-by-symbol.md` — partitioning.
- `handoff-checklist.md` — what parent hands off.
- `agents/INDEX.md` — supported receipt-backed helper launch surfaces.
- `examples/05-tuple-swarm-handoff.md` — concrete handoff via tuples.
