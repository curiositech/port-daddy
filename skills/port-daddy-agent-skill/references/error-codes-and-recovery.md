# Error codes and recovery

Recover from the selected runtime and durable evidence. Never start with a
guessed port or a second supervisor.

## `ECONNREFUSED`, `ENOENT`, or request timeout

1. Identify the selected stable/named profile and its published endpoint.
2. Compare PID plus fresh heartbeat; neither alone is sufficient.
3. Test socket and published TCP transports separately.
4. Compare health version/source revision with the intended install/worktree.
5. Let only that runtime's lifecycle owner restart it.

Stable on macOS is Homebrew/launchd. Named feature daemons are owned by
`pd dev`. A foreign checkout or health checker does not restart stable.

## `EADDRINUSE`

The preferred bind seed is occupied. Correct behavior is for the binder to pick
another free loopback port and publish it. Re-resolve the selected endpoint.
Do not evict an unrelated listener merely to preserve a familiar number.

If startup still failed, inspect binder health/log evidence for exhaustion or a
profile publication failure.

## Coordination Guard: no active session

Confirm cwd/worktree and explicit context:

```bash
pwd
pd whoami --json
pd sessions --all-worktrees
```

Start or continue the intended durable session with roadmap linkage. If direct
context, `whoami`, and session storage disagree, record the exact IDs and treat
that as a coordination bug rather than silently creating unrelated work.

## Coordination Guard: file not claimed

Claim the smallest staged file or symbol region through `pd session files add`.
If another active session owns it, coordinate. If a dead/unprovable session owns
it, salvage or create a linked successor; never override silently.

## Native module ABI mismatch

`NODE_MODULE_VERSION` mismatches are local dependency evidence. Standardize on
the repository's Node version, reinstall with Bun, and rerun one affected suite
before expanding. See `examples/09-better-sqlite3-abi-rebuild.md`.

## Spawn backend unavailable

Inspect `pd backend` readiness and the launch receipt. Backend admission failure
is terminal only when the receipt records it. A disconnected observer or stale
heartbeat does not imply failure. Omit `--deadline-ms` unless the task has a
real caller-owned deadline.

## Spawn outcome unknown

Reconnect through the durable receipt/transcript cursor. Report `unknown` or
`no_runtime`; do not infer failure from a vanished process. Cancel with
`pd spawn cancel <agent-id> --reason <why>` only when intentional.

## Skill/mirror drift

Edit canonical `skills/port-daddy-agent-skill/`, run its validator, then run
`scripts/sync-skill-mirrors.mjs`. Never patch generated mirrors independently.

## Still unresolved

Leave a note with selected profile, endpoint source, health revision, PID,
heartbeat age, transports tested, literal error, receipt/session IDs, and the
next bounded check. Publish true coordination conflicts to
`coordination:inconsistency`.
