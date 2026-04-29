# 03 — Salvage a Dead Agent

**Scenario:** `pd sitrep` shows a dead agent in your project. You should claim and finish their work rather than start new work, when feasible.

## Confirm the salvage queue

```bash
pd salvage --project myapp
```

Sample output:

```text
Salvage queue for myapp:*  (2 pending)

  agent: abc-123
    identity:  myapp:api:feature-y
    purpose:   "Rewrite jose imports for ESM"
    dead for:  37 minutes
    session:   sess-9c2a
    notes:     6 (last: blocker, 41 min ago)

  agent: def-456
    identity:  myapp:web:dependabot-merge
    purpose:   "Merge 14 dependabot PRs"
    dead for:  2 hours
    session:   sess-7b1f
    notes:     2 (last: progress, 2h 5m ago)
```

## Read what they were doing

```bash
pd notes --session sess-9c2a --type handoff   # the dying agent's last message to you
pd notes --session sess-9c2a --type blocker   # what they were stuck on
pd notes --session sess-9c2a                  # full thread, oldest first
pd files --session sess-9c2a                  # files they were touching
```

If `handoff` is empty, the agent didn't write a graceful goodbye — it just died. You'll have to reconstruct from `progress` notes and the file claims.

## Claim it

```bash
pd salvage claim abc-123
```

This:
- Marks the entry `claimed` so other agents don't pick it up.
- Returns the dead session id; you continue inside it.
- Inherits their file claims.
- Logs the claim to activity.

You should now have:

```bash
pd whoami
# session: sess-9c2a (continued from abc-123)
# files:   src/auth/jwt.ts, src/auth/refresh.ts
```

## Do the work

Treat their notes as the spec. **Their code state is not preserved** — only their notes, file claims, and session metadata. You may have to:

- Pull the latest main and rebase mentally on what they intended.
- Re-derive uncommitted changes from `git diff` on the worktree if they had one (`pd whoami` may show `worktree_id`).
- Rerun any tests that the blocker note describes.

## Finish or abandon

If you got it done:

```bash
pd note --type handoff "Finished abc-123's work. jose ESM imports landed in commit fa6b66e. All tests green."
pd salvage complete abc-123
pd done
```

If you can't finish:

```bash
pd note --type handoff "Could not finish abc-123's work. Blocker: the jose v5 API removed RSAPrivateKey signing helpers we depended on. Recommend revisiting after researching the migration guide."
pd salvage abandon abc-123
pd done
```

`abandon` returns the entry to the queue for the next agent. If you were the only candidate and you're abandoning a second time, leave a `coordination:inconsistency` for a human to look at.

## Why salvage is not magic

- **No code state recovery.** If the dead agent had uncommitted edits in a regular working tree, those edits are gone unless they're in a worktree.
- **No test resumption.** You're starting tests from clean.
- **Notes are the only contract.** This is why every fleet agent should write a `progress` note per primitive milestone — see `assets/session-note.template.md`.

The skill is in **leaving good handoffs**, not in claiming dead work. Future you is dead-agent abc-123 to someone else.
