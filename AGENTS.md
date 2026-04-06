# AGENTS.md

Project-specific shibboleths for proficient Port Daddy work. If you learn a new one that materially changes how to operate this repo, add it here immediately.

## Canonical Runtime

- Do not assume the live daemon is running the current checkout.
- Verify live truth with:
  - `port-daddy status`
  - `launchctl print gui/501/com.portdaddy.daemon`
  - `curl -sS http://localhost:9876/fleet`
- If those disagree, trust the live process and launchd output, not docs or memory.
- There should be exactly one canonical daemon on `9876`.
- If another Port Daddy daemon is already sitting on the canonical socket/port, treat it as replaceable stale runtime, not sacred state.
- Extra daemons are only acceptable when they are explicitly opt-in on different ports/sockets/prefixes.
- Check the shell shim too: `which port-daddy` and `realpath`/symlink inspection can still point at an old checkout even after the daemon is promoted.
- A promoted canonical daemon plus a stale global CLI shim is an inconsistent operator state; relink the CLI if you intentionally move the canonical runtime to a different checkout.

## Promotion

- The real promotion path is `./scripts/promote-stable.sh`.
- Do not hand-roll daemon promotion with ad hoc `launchctl` commands if the script exists.
- If the user asks to "promote the daemon", run the script first and report the exact blocker if it fails.
- If promotion is blocked by dirty archaeology, split green feature/parity slices from intentionally red bug-battery tests; do not bundle known-red test files into an otherwise promotable commit.
- The script expects:
  - current branch is `main`
  - no uncommitted source changes in `lib/`, `server.ts`, `mcp/`, `routes/`, `bin/`, or `tests/`

## Fleet Identity

- Logical fleet names are not unique enough. `port-daddy-dev` can exist in more than one checkout.
- Use `projectDir` as the durable identity in UI state, routing, and daemon/API lookups.
- Only use logical project name as a display label.

## Control Plane

- `fleet-config-ui` is the real control plane surface.
- `public/fleet-ui` is the built artifact served by the daemon.
- FleetBar should open the real control plane, not a shadow dashboard with reduced functionality.
- FleetBar is the top-level navigator when embedded. The embedded control plane must receive `?embed=fleetbar` and hide duplicate in-app surface tabs.
- Project changes must preserve the current surface. Selecting a different project should not silently dump the user back to Flow.

## Operator UX Expectations

- Top-level tabs must behave like top-level pages. Do not hide a selected tab's main content inside a collapsed lower panel.
- Agent detail should default to non-empty, high-signal activity:
  - recent meaningful messages
  - mutations / touched files
  - handoffs / artifacts
- Filter low-signal system noise instead of surfacing empty or trivial channel traffic.

## Current Gotchas

- If multiple Port Daddy checkouts exist, duplicate fleet names can make project selection and routing look broken unless everything keys by `projectDir`.
- Before concluding a UI fix "didn't work", verify the daemon being queried is the one serving this checkout's `public/fleet-ui`.
