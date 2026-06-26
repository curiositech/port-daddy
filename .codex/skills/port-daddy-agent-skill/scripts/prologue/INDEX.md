# Prologue Scripts

Run before any agent work. Each emits JSON the agent can parse to decide whether the local plan still matches reality.

| Script | Purpose | When to run |
|---|---|---|
| [pd-context.sh](pd-context.sh) | Compact snapshot: whoami, sessions count, recent notes, branch state, drift vs origin/main, daemon status | First thing in any agent session, including "just diagnostics" |
| [git-state.sh](git-state.sh) | Worktree-local: branch, active rebase/merge/cherry-pick, ahead/behind, dirty counts, all worktrees | Before editing in a shared checkout, or whenever `git status` looks odd |
| [live-fleet.sh](live-fleet.sh) | Full fleet: briefing + sessions + notes + activity + salvage + actor inboxes | When considering whether to start work that might collide with active sessions |

## Why these exist

Each `pd` subcommand can take 50-200ms. Running 4-5 of them sequentially at the start of every task adds up. These scripts:

1. Run them in parallel where safe.
2. Tolerate individual failures (so a slow daemon doesn't kill the whole prologue).
3. Emit structured JSON the agent can route on without re-parsing prose.
4. Include `warnings` arrays surfacing likely problems (drift, contention, mid-rebase).

## Recommended invocation pattern

```bash
# At the start of any non-trivial task:
ctx=$(skills/port-daddy-agent-skill/scripts/prologue/pd-context.sh)
echo "$ctx" | python3 -c 'import sys,json; d=json.load(sys.stdin); w=d.get("drift_warning"); print(f"WARN: {w}") if w else None'

# If you'll edit files in a shared worktree:
git_state=$(skills/port-daddy-agent-skill/scripts/prologue/git-state.sh --expect "$EXPECTED_BRANCH")
echo "$git_state" | python3 -c 'import sys,json; w=json.load(sys.stdin)["warnings"]; print("\n".join(w))'

# If you're about to start parallel/contentious work:
fleet=$(skills/port-daddy-agent-skill/scripts/prologue/live-fleet.sh)
```

## When NOT to use

- The user pasted a single file and asked a question. Just answer.
- You're already inside a verified-fresh session that began <60s ago.
- A pure shell command like `which`, `git log` for orientation.

See `decisions/skip-coordination-when.md` for the full skip-decision tree.

## Output is JSON; route on it

These scripts are designed to be parsed, not just printed. The agent should:

1. Capture stdout.
2. Parse as JSON.
3. Branch on `warnings`, `drift_warning`, `active_op`, `branch_mismatch`, etc.
4. Surface the parsed signals in its plan or scope note.

Example agent prologue logic:

```bash
ctx=$(skills/port-daddy-agent-skill/scripts/prologue/pd-context.sh)
drift=$(echo "$ctx" | jq -r '.drift_warning // empty')
rebase=$(echo "$ctx" | jq -r '.rebase_active')

if [ "$rebase" = "true" ]; then
  echo "ABORT: active rebase in this worktree; switch to a fresh worktree." >&2
  exit 1
fi

if [ -n "$drift" ]; then
  echo "WARN: $drift" >&2
  # decide: rebase, or skip and start fresh worktree
fi
```

## Related

- `decisions/something-broke.md` — uses these to confirm "is the daemon really down?"
- `decisions/before-publish.md` — uses these as pre-publish gates.
- `examples/11-briefing-first-even-for-diagnostics.md` — why this whole dir exists.
