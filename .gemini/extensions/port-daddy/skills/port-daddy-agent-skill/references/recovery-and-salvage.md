# Recovery And Salvage

Salvage is not cleanup. It is the continuation path for interrupted work.

Start with:

```bash
pd status
pd briefing
pd salvage --project <project> --limit 20
pd sessions --all-worktrees
pd notes --limit 40
```

Claim abandoned work only when the recovered purpose overlaps your task:

```bash
pd salvage claim <agent-id>
pd note "Recovered <agent-id>; preserving original scope: <summary>."
```

## What To Preserve

- original task and operator intent
- claimed files and symbols
- last note and validation state
- exact blocker text
- whether the daemon or UI was stale
- any active session that has superseded the old work

## Do Not

- Restart from filenames alone.
- Treat a dead body as proof the actor has no useful state.
- Present a partial interrupted review as complete.
- Revert unrelated dirty work to make the salvage easier.
- Commit archaeology tests that freeze known-bad behavior as expected.

## Good Salvage Note

```text
Recovered agent-123. Original scope: FleetBar readiness copy and backend
dependency checks. Current tree already contains the UI copy but not the
dependency validation. I am claiming lib/backend-readiness.ts and will validate
with npm test -- --no-coverage plus FleetBar screenshot proof.
```
