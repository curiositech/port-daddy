# Current Recovery Work

Last updated: 2026-04-07
Owner: Codex working session

This is the active execution ledger. If a task is in flight, it belongs here before it belongs in chat.

## Current Thread

Stabilize the live Port Daddy operator loop so one daemon, one fleet runtime, one control plane, and one native companion all tell the same truth.

Latest committed slice: `e7eba7b` — structured project activity attribution and legacy post-commit hook upgrade.
Current uncommitted slice: fleet lease self-healing, loopback TCP discovery cleanup, and richer briefing payloads for FleetBar/control-plane detail views.

## Active Tasks

1. Finish daemon discovery drift cleanup so `9876` is treated as the canonical preferred port, not a mandatory truth. The daemon can already fall back; the surrounding install/CLI/UI surfaces must stop pretending otherwise.
2. Finish the fleet lease recoverability pass so a project does not remain skipped forever when renewal sees `lock not held` and no other daemon owns the lease.
3. Finish the last raw project-trigger audit after `lib/fleet-channels.ts` + hook/template scoping so no checked-in path still publishes or inspects naked logical channels where a scoped physical channel is required.
4. Collapse duplicate chrome in Fleet Control Center when embedded:
   - FleetBar owns the outer nav
   - the embedded control plane must not render a second top-level nav/header stack
5. Make Activity, Channels, Inbox, and Sorties behave like real top-level pages instead of buried panels or empty shells.
6. Upgrade agent detail surfaces to show high-signal recent work:
   - non-empty messages
   - recent mutations
   - touched files
   - last active time
7. Improve FleetBar popover so it shows recent per-agent facts instead of only launch shortcuts.

## Immediate Next Cuts

1. Restart the current-checkout daemon against the latest server/runtime code and verify the lease-reacquire path actually recovers skipped fleets instead of leaving `/fleet` empty.
2. Kill or replace stale legacy `port-daddy-stable` watcher processes if they are still the source of cross-project `git:committed` bleed after the scoped channel audit.
3. Relaunch FleetBar against the latest build and verify the native wrapper picks up the committed activity attribution improvements plus the chrome-free embedded surfaces.
4. Wire the React control plane to consume the newly explicit backend activity attribution so per-agent timelines, files touched, and recent mutations stop falling back to prose matching.
5. Finish the remaining `9876` cleanup after the runtime callers:
   - diagnostics/startup doctor wording
   - docs/templates/website honesty sweep
   - any leftover FleetBar/operator labels
6. Verify whether Jest still has a real open-handle warning after the lease-renew timer `unref()` and daemon test teardown, then fix any remaining offender instead of assuming it is gone.
7. Commit the control-plane/FleetBar UI refactor once the latest native companion relaunch confirms the bundle is the truthful surface.

## Newly Confirmed Truths

- Embedded FleetBar routing needs two signals, not one: query-param embed plus an explicit WebView identity. Relying on `?embed=fleetbar` alone is brittle enough that duplicate chrome can come back.
- The modern fleet engine already scopes logical channels like `git:committed` through `lib/fleet-channels.ts`. If cross-project triggers still bleed, the likely culprit is leaked legacy detached watcher processes, not missing scoping code in the current runner.
- `port-daddy status` and browser reachability are separate truths. The CLI can look healthy over the Unix socket while TCP/browser consumers are still pointed at a brittle loopback URL or stale port assumption.
- The daemon should not permanently skip a project when lease renewal returns `lock not held` and `locks.check()` reports no holder. That is an empty-holder recovery case, not proof another daemon owns the fleet.
- The richer native/control-plane detail views need briefing payloads to carry explicit `summary` and `files`, not just raw activity prose.
- The current daemon-served bundle now renders embedded `Flow` and `Activity` without the inner header/tab stack. The native shell owns surface navigation, theme, and daemon chrome.
- Activity is no longer the empty liar from the earlier screenshot. The served `Activity` surface now shows project-scoped notes again after restoring `story.agentId` attribution and surfacing meaningful event types.
- The concrete Activity bug was project filtering: story notes were still being matched on free text and `identityProject`, but not `story.agentId`, so valid project-scoped handoffs could disappear from the main timeline.
- `pd init` was still writing its own bespoke post-commit hook body. The installer now copies the shared scoped hook template so hook behavior can stop drifting by command surface.
- `pd fleet` status was still sampling naked logical channels like `git:committed`. The operator-facing recent-event check now resolves those through the project-scoped physical channel path.
- Remaining `9876` drift still exists in docs/templates and some operator labels even after the runtime callers were cleaned up.
- The earlier `embed-flow-after` proof was wrong because it captured a loading state. A fresh settled screenshot now confirms embedded `Flow` does render the graph and agent cards correctly from the daemon-served bundle.
- Session notes already carry `agentId` and `identityProject` on the backend; the remaining bug is frontend attribution code still dropping that metadata and guessing from content.
- The activity bug was deeper than the UI. Recent project activity was being queried by `target_id` prefix even though real session and sugar rows often had `target_id = null`, so project-scoped Activity and FleetBar recent work could lie by omission.
- The live installed `.git/hooks/post-commit` in this checkout was still the pre-scope Port Daddy hook, publishing naked `git:committed`. Shared templates were correct, but installers were treating any hook mentioning `git:committed` as already upgraded.
- The fix is now source-level, not cosmetic:
  - session/file/sugar activity stamps `agentId`, `targetId`, and `identityProject`
  - briefing rebuilds project activity from structured metadata, session membership, and active agents
  - legacy Port Daddy hooks auto-upgrade in `pd init` / `pd fleet init`
- Runtime discovery now drives more of the real product surface: the JS SDK, MCP server, and FleetBar stores no longer default inline to `http://localhost:9876`; they resolve the live daemon URL through the shared discovery path or the user port file.
- Only `Flow` still warrants the persistent project rail. `Activity`, `Channels`, `Inbox`, `Sorties`, and `YAML` behave better as full-width top-level pages.
- FleetBar popover usefulness is now part of the active scope: recent per-agent summaries and touched files belong in the menu bar companion, not only in the full control center.
- Current build state after the latest control-plane and FleetBar edits: root `npm run typecheck`, `cd fleet-config-ui && npm run build`, and `cd apps/FleetBar && env CLANG_MODULE_CACHE_PATH=/tmp/clang-module-cache swift build` all passed.

## Explicit Non-Goals For This Pass

- New speculative agent products
- More website polishing unless it fixes a lie about live behavior
- Broad economy work beyond budget/cost truthfulness

## Operator Rules

- Update this file when the active recovery queue changes.
- Update `.cartographer/status.md` when the center of gravity moves or a track closes.
- If chat and this file disagree, fix this file first.
