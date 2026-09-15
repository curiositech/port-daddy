---
title: "Parent's handoff checklist when forking"
purpose: "Everything the parent must hand to a sub-agent so the sub-agent can coordinate properly."
---

# Handoff Checklist

A sub-agent that doesn't know its parent's coordination state will either duplicate work or break it. The parent's handoff is the only path for that knowledge.

## Required handoff fields

Pass these in the fork persona or via `--parent-session`:

```yaml
inherited_from_parent:
  parent_session_id: session-...               # the parent's active session
  parent_agent_id: agent-...                   # for actor messaging back
  parent_branch: feature/...                   # which branch the parent is on
  parent_worktree: /Users/.../port-daddy-...   # which worktree (for cwd-bound state)
  parent_rent_flag: --roadmap                  # --roadmap or --sidequest
  parent_rent_value: roadmap-slug-or-reason    # inherit the exact parent rent
  files_partition: [...]                       # what files/symbols this fork owns
  shared_assumptions:                          # facts parent has already verified
    - "origin/main is at <hash>"
    - "test suite was green at <hash>"
    - "no other active session claims <files>"
  task_specific:
    scope: "..."
    return_shape: "..."
```

## Why each field matters

**parent_session_id**: The sub-agent will leave its result note via the parent's session (or its own session that references the parent). Without this, the result is orphaned.

**parent_agent_id**: For inbox messages back to the parent. Some patterns route through actors; others go agent-to-agent.

**parent_branch**: Sub-agents working in the SAME worktree as the parent must know what branch they're on. Without this, they may switch branches or commit on the wrong base.

**parent_worktree**: Determines where `.portdaddy/contexts/` lives, where `pd begin` writes context files, and which `git status` they see. Sub-agents in a different worktree need their own `pd begin`.

**parent_rent_flag / parent_rent_value**: Editing sub-agents inherit the
parent's exact rent. A parent started with `--roadmap-new` passes its resolved
slug as `--roadmap`; a sidequest parent passes `--sidequest` with the same
reason. Never silently promote a sidequest into a roadmap item or invent a slug.

**files_partition**: The sub-agent's authority to claim. Without an explicit partition, sub-agents either claim too broadly (collision) or too narrowly (incomplete work).

**shared_assumptions**: The parent's already-validated facts. Without them, the sub-agent re-validates everything (waste) or assumes things that are no longer true (bugs).

**task_specific.scope**: What to do AND what NOT to do. The negative scope is critical — without it, sub-agents drift.

**task_specific.return_shape**: A schema or template for the output. Without it, you get prose the parent can't reliably parse.

## Pre-fork checks the parent must do

```bash
# 1. Confirm the parent's session is healthy.
pd whoami

# 2. Confirm the partition files aren't claimed by other sessions.
for f in $PARTITION_FILES; do
  pd files who-owns "$f"
done

# 3. Confirm origin/main is fresh (parent's "shared_assumptions" must be current).
git fetch origin main
git log --oneline HEAD..origin/main | head

# 4. Run the prologue scripts to capture state.
HANDOFF_DIR="$HOME/coding/tmp/pd-handoff-$(date +%s)"
mkdir -p "$HANDOFF_DIR"
skills/port-daddy-agent-skill/scripts/prologue/pd-context.sh > "$HANDOFF_DIR/parent-ctx.json"
skills/port-daddy-agent-skill/scripts/prologue/git-state.sh > "$HANDOFF_DIR/parent-git.json"

# 5. Drop a pd note describing the fork:
pd note "Forking subagent <name> for <task>. Partition: <files>. Will rejoin at: <expected-time>."
```

## What the parent must NOT do during the fork

- Edit files in the partition. Those belong to the sub-agent until rejoin.
- Move the parent branch (no rebases, no cherry-picks).
- Switch worktrees in a way that invalidates the sub-agent's `parent_worktree` assumption.
- Close the parent session via `pd done` until all sub-agents have rejoined.

## What the sub-agent must do on receipt

```bash
# 1. Run prologue scripts to read live state.
skills/port-daddy-agent-skill/scripts/prologue/pd-context.sh

# 2. Compare to parent's shared_assumptions.
#    - If origin/main has moved beyond what parent saw → STOP, publish to
#      coordination:inconsistency, do not proceed.
#    - If a file in partition is now claimed by another session → STOP.
#    - Otherwise: continue.

# 3. Begin its own session.
pd begin "<task slug>" --identity port-daddy:subagent:<task> --lifecycle durable <parent-rent-flag> "<parent-rent-value>"

# 4. Claim the partition.
pd session files claim <each-partition-file>
# (with --symbol-path for symbol-level partitions)

# 5. Drop a scope note that references the parent.
pd note "Subagent for parent <parent-session-id>. Scope: <inherited>. Partition: <files>."

# 6. Do the work. Drop progress notes as needed.

# 7. Final note matching return_shape, then exit.
```

## Failure modes

**Sub-agent finds partition is now claimed by someone else.**

Don't override. The state shifted between fork-prep and sub-agent-start. Publish:

```bash
pd tube coordination:inconsistency --send "Subagent <task> partition collision: <file> now claimed by <other-session>. Aborting."
pd note "Aborted at fork-start: partition collision."
exit
```

The parent re-evaluates and either re-partitions or sequences the work.

**Sub-agent finds origin/main has moved.**

Same protocol. The parent's "shared assumptions" are now stale. Abort and let the parent re-fetch and re-fork.

**Sub-agent realizes scope is bigger than expected.**

```bash
pd actor <parent-agent-id> --message "Subagent <task> scope expanded: <details>. Suggest re-fork or in-line completion by parent."
pd note "Aborted: scope expansion."
exit
```

**Parent doesn't get a result.**

Sub-agent crashed or timed out. Parent should:

1. Read the salvage queue for the sub-agent's session.
2. Decide: pick up the partial work yourself, or re-fork with adjusted scope.

## Related

- `when-to-fork.md` — should you even fork?
- `partition-by-symbol.md` — how to compute the partition.
- `rejoin-protocol.md` — how to re-integrate results.
- `agents/subagent-fork-template.yaml` — the canonical fork persona.
- `decisions/should-i-fork-subagent.md` — full decision tree.
