# Daemon and supervision

On macOS, `brew services` is the supported wrapper around `launchctl` for launchd-managed services [Homebrew manpage](https://docs.brew.sh/Manpage.html#services-subcommand). Apple describes `launchd` as the system launcher, recommends launchd-compliant jobs, and prefers on-demand jobs over ad hoc daemonizing [Creating Launch Daemons and Agents](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html), [The Life Cycle of a Daemon](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/Lifecycle.html).

Port Daddy follows that model for the stable daemon:

- one OS lifecycle supervisor owns the stable runtime;
- the daemon publishes its own endpoint and freshness evidence;
- clients observe the runtime, but do not supervise it.

## Contract

- `launchd` is the only lifecycle supervisor for the stable Port Daddy daemon.
- `brew services start|restart|stop port-daddy` is the supported macOS control path.
- The daemon publishes the port it actually bound and clients derive the URL from that evidence. `9876` is only the preferred bind seed, not a hard-coded contract.
- A healthy runtime requires both process evidence and fresh health evidence. A PID alone is not enough.
- Do not daemonize, double-spawn, or install a second supervisor for the stable runtime.
- KeepAlive belongs to the launchd job. It does not authorize a second lifecycle monitor or a fixed port.
- Use named dev daemons for testing. Target them with `pd daemon list`, `pd daemon status <profile>`, `pd daemon env <profile>`, and `pd daemon start <profile> --port <seed>`.
- Do not replace the stable daemon just to test a change. Keep stable and named dev runtimes separate.

## Why this exists

The daemon is a live process owned by launchd, but it is not the source of truth for spawn completion, transcript retention, or session lineage. Those rules live in [spawn lifecycle](./spawn-lifecycle.md) and [first-class agent sessions](../design/first-class-agent-sessions.md).

## Evidence model

- Process evidence: PID, launchd job state, or child handle.
- Freshness evidence: health or heartbeat timestamp, not filesystem mtime.
- Runtime identity: published URL, daemon label, and selected profile.
- Reconciliation source: the durable receipt store after restart.

If those disagree, trust the fresh runtime evidence and the durable receipt, not a cached port number.
