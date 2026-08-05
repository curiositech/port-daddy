---
title: "Partitioning for parallel-edit forks"
purpose: "How to split work across N sub-agents without merge conflicts."
---

# Partition By Symbol, Not By Phase

The most common parallel-edit failure: spawning N agents with overlapping responsibility on the same file. Result: every agent's diff conflicts with every other agent's, and the merge becomes a manual reconstruction.

## The wrong axes

**Phase**: "Agent 1 does the model layer, Agent 2 does the controller, Agent 3 does the view." Sounds clean but if the model and controller are in the same file (or the controller imports the model), you've just guaranteed conflicts.

**Concern**: "Agent 1 handles validation, Agent 2 handles persistence, Agent 3 handles UI." Same problem — concerns cross file boundaries.

**Time**: "Agent 1 does the first half of the function, Agent 2 does the second half." Almost always overlap on shared variables.

## The right axes

### File partition (simplest)

Each sub-agent owns one or more whole files. Pre-condition:

- Files don't import each other (or imports are read-only references).
- Each file is the natural unit of the work.

```yaml
# In your fork persona:
files_partition:
  - src/users/UserProfile.tsx          # Sub-agent 1
  - src/users/UserSettings.tsx         # Sub-agent 2
  - src/users/UserActivityLog.tsx      # Sub-agent 3
```

Claim each file in the sub-agent's session before editing.

### Symbol partition (use when files must be shared)

When work spans a single large file (a SKILL.md, a router, a schema), partition by symbol — that is, by AST node range, NOT by line range.

```yaml
files_partition:
  - path: routes/fleet.ts
    symbols:
      - GET_FleetStatus              # Sub-agent 1
  - path: routes/fleet.ts
    symbols:
      - POST_FleetSpawn              # Sub-agent 2
  - path: routes/fleet.ts
    symbols:
      - DELETE_FleetAgent            # Sub-agent 3
```

Then in the sub-agent's session:

```bash
pd session files add routes/fleet.ts --symbol-path GET_FleetStatus
```

Port Daddy's symbol-aware claim system (lib/symbol-index.ts) ensures the parent's authoritative claim is for the whole file, but each sub-agent's claim is scoped to its symbol range. The merge order can then be deterministic: sort by symbol position, apply in order, no overlap.

### Read-only baseline + write deltas (advanced)

For tasks where every sub-agent reads the same large baseline (e.g., a config file) but writes only its delta:

- Parent claims the baseline file with `read-only` intent.
- Each sub-agent receives a diff to APPLY, not a region to MUTATE.
- Parent applies all deltas in deterministic order at re-join time.

This pattern requires the diffs to commute (independent regions). For dependent regions, fall back to symbol partition or sequential.

## Pre-fork validation

Before spawning N sub-agents, verify:

```bash
# 1. Check that the planned partitions don't overlap.
for partition in "${PARTITIONS[@]}"; do
  echo "$partition" | jq -r '.symbols[]' | sort
done | sort | uniq -d
# Output should be empty — no symbol claimed by two sub-agents.

# 2. Check that no other active session claims any of these files.
for partition in "${PARTITIONS[@]}"; do
  file=$(echo "$partition" | jq -r '.path')
  pd who-owns "$file"
done
# Each owner should be either nobody or YOU (the parent).

# 3. Confirm the symbol index is fresh.
pd symbols parse <file>
# Stale index → wrong claim resolution → race conditions.
```

## When partition isn't possible

If you can't find a clean partition:

- The work is sequential by nature (each step depends on the prior). Don't fork.
- The work is small enough you should just do it yourself.
- The "task" is actually multiple distinct tasks pretending to be one. Decompose first.

## Re-join order for parallel edits

When sub-agents return:

1. Pull each sub-agent's commit / diff into a staging area.
2. Apply in symbol-position order (or file-name alphabetic for whole-file partition).
3. Run the test suite once after ALL deltas are applied. Don't merge incrementally — that hides cross-cutting failures.
4. If conflicts somehow occurred (despite the partition validation), don't manually resolve — re-spawn a sub-agent to redo the conflicted region with full context of the other deltas.

## Related

- `when-to-fork.md` — is forking even right?
- `handoff-checklist.md` — what each sub-agent receives from parent.
- `rejoin-protocol.md` — how parent re-integrates results.
- `lib/symbol-index.ts` — symbol-aware claim implementation.
