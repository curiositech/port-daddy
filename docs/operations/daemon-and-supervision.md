# Daemon and supervision

Port Daddy has two runtime roles, not a stack of competing watchdogs:

1. The installed stable daemon is a Homebrew service. On macOS, Homebrew
   delegates it to `launchd`.
2. Named development daemons are disposable feature-build processes selected
   explicitly by label. They never replace or supervise stable.

Homebrew documents `brew services` as its service-manager wrapper, and Apple
recommends one launchd job own a daemon's lifecycle rather than having programs
daemonize or monitor one another. Sources:
[Homebrew services](https://docs.brew.sh/Manpage.html#services-subcommand),
[Creating launchd jobs](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html),
[The life cycle of a daemon](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/Lifecycle.html).

## The whole topology

| Runtime | Lifecycle owner | Purpose | How clients select it |
|---|---|---|---|
| Stable | Homebrew service / `launchd` | Normal FleetBar, Control Center, MCP, and agent work | Default installed selection |
| Named development daemon | `pd dev` process record | Prove one feature worktree without disturbing stable | `pd --daemon <label> …` or `pd use <label>` |

There is no second stable watchdog, standing “latest” lane, fixed development
port, or client-side auto-restart authority. A health checker may report a
problem; only the lifecycle owner restarts the process it owns.

## Stable service

The supported macOS service controls are:

```bash
brew services start port-daddy
brew services restart port-daddy
brew services stop port-daddy
```

Agents normally use FleetBar's health and restart controls instead of asking
the operator to run these commands. The shell commands are recovery and release
tools.

Stable health requires all of the following:

- the Homebrew launchd job names the installed binary;
- the live process belongs to that job;
- the daemon's health response is fresh;
- the daemon's published endpoint matches the endpoint clients selected;
- the reported version and binary identity match the installed release.

A PID, socket file, old browser tab, or successful CLI command proves only its
own transport. It does not prove the browser endpoint or installed revision.

## Named feature daemons

Every backend or route change is tested through a named daemon built from the
feature worktree:

```bash
pd dev up --from "$(pwd)" --label session-continuation
pd dev list
pd --daemon session-continuation status
eval "$(pd use session-continuation)"

# run focused dogfood against the selected daemon

pd dev down session-continuation
eval "$(pd use stable)"
```

`pd dev up` builds the dedicated daemon binary and installs a profile-local
`pd` shim that executes the same worktree's CLI. The daemon prepends that shim
to spawned-agent `PATH`, exports it as `PORT_DADDY_CLI`, and provides an
isolated profile-local shell startup file so login shells cannot reset back to
the Homebrew CLI. A backend therefore cannot silently pair a feature daemon
with an older installed CLI. It also preserves
that label's isolated state across ordinary down/up cycles and records source
directory, branch, revision, PID, and the endpoint the daemon actually
published. `--purge` is a separate destructive action and is never part of
routine rebuilds.

## Endpoint authority

The daemon binder chooses a free loopback port and writes the port it actually
bound into the selected profile's `daemon.port`. Clients resolve the selected
profile, then read that publication. They do not guess a number or cache a URL
from a different profile.

Use the selector instead of constructing a URL:

```bash
pd --daemon session-continuation status --json
eval "$(pd use session-continuation)"
pd status --json
```

Tests that need raw HTTP must first read the selected profile's published port
or consume the URL emitted by `pd use`. If the daemon falls forward because a
port is occupied, every correct client follows automatically.

## Evidence and recovery

| Question | Authoritative evidence |
|---|---|
| Which runtime did this client select? | Selected profile label and resolved endpoint |
| Which source produced a named daemon? | Health `daemon.sourceDir`, branch, revision, and build time |
| Which CLI do its spawned agents use? | The selected profile's source-matched `PORT_DADDY_CLI` shim |
| Is the process alive now? | PID plus fresh daemon/supervisor heartbeat |
| Does the browser path work? | Request to the published TCP endpoint |
| Does the CLI path work? | Socket or selected-endpoint request, identified separately |
| Did an agent run survive restart? | Durable run receipt and transcript cursor, not daemon uptime |

When evidence disagrees:

1. stop issuing mutations through an ambiguous client;
2. resolve the selected profile and its published endpoint again;
3. compare live health identity with the intended install or worktree revision;
4. let the proper lifecycle owner restart only its own runtime;
5. reconcile open agent receipts using [spawn lifecycle](./spawn-lifecycle.md).

The stable service is ordinary Homebrew/launchd supervision. Port Daddy's extra
complexity belongs in durable agent receipts and multi-runtime selection, not in
multiple processes fighting to keep one daemon alive.

## See also

- [Spawn lifecycle](./spawn-lifecycle.md)
- [First-class agent sessions](../design/first-class-agent-sessions.md)
