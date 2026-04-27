# 0024. Named Daemon Profiles

## Status

Accepted

## Context

Port Daddy needs one canonical daemon for the normal operator path, but local
development also needs safe parallel daemon instances. The old escape hatches
already existed at the environment level (`PORT_DADDY_PREFIX`,
`PORT_DADDY_SOCK`, `PORT_DADDY_PORT_FILE`, isolated test daemons, and `pd dev`),
but they were not exposed as a coherent operator model.

Accidental duplicate daemons are still dangerous. They can split lock/session
truth, confuse FleetBar, and arm duplicate fleet runners. The missing piece is
explicit multiplicity: named, isolated sidecars that are obviously not the
canonical daemon.

## Decision Drivers

- Preserve a single canonical user-facing daemon by default.
- Make deliberate sidecar daemons easy to start, inspect, target, and stop.
- Keep sidecars isolated by runtime directory, socket, IPC path, pid file, port
  file, heartbeat, and SQLite database.
- Prevent sidecars from arming project fleets or launching FleetBar unless the
  operator explicitly opts in.
- Leave full daemon mesh consensus as a later architecture, not a prerequisite
  for local sidecar workflows.

## Considered Options

- Keep only `pd dev` as a special case.
- Allow arbitrary duplicate daemons on fallback ports.
- Add named daemon profiles.
- Build the full daemon mesh first.

## Decision

Add named daemon profiles as the local multiplicity primitive.

Profiles live under `~/.port-daddy/instances/<profile>/` and are managed by:

```bash
pd daemon start <profile> [--port <port>] [--fleet] [--fleetbar]
pd daemon status <profile>
pd daemon list
pd daemon env <profile>
pd daemon stop <profile>
```

The canonical daemon remains the default target for normal `pd` commands. A
profile is targeted explicitly by evaluating the environment printed by
`pd daemon env <profile>`, which points clients at the profile socket, IPC path,
and port file.

## Rationale

Named profiles give operators the thing they wanted from multiple daemons
without removing the safety of a canonical singleton. A profile is not "another
daemon happened to grab a port"; it is a named runtime with a known home,
state file, socket, pid, port, database, and opt-in side effects.

The implementation intentionally reuses `PORT_DADDY_PREFIX`, which already
isolates the daemon's runtime files. This keeps the slice small and compatible
with ephemeral test daemons, while giving the CLI enough structure to inspect
and manage profile lifecycle.

Fleet and FleetBar default off for profiles because those are operator-facing
global behaviors. A sidecar should be safe for API, UI, and integration testing
without silently duplicating always-on project automation.

## Consequences

### Positive

- Developers can run a dogfood daemon beside the canonical daemon.
- Tests and UI experiments can use a named long-lived runtime without touching
  stable state.
- Runtime files are discoverable and explainable.
- The profile model is a stepping stone toward daemon mesh nodes.

### Negative

- There is one more daemon lifecycle surface to maintain.
- Operators must opt into a profile environment before ordinary `pd` commands
  target that profile.
- Sidecar fleet testing requires an explicit `--fleet` flag.

### Neutral

- This does not implement cross-daemon consensus.
- This does not change the canonical daemon promotion path.
- `pd dev` can later be reduced to a convenience wrapper over the `dev` profile.
