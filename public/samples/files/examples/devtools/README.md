# Dev Tool Example

Port Daddy is useful as an application substrate, not only as a CLI. This
directory shows the kind of developer tool you can build on top of the daemon.

`agent-workbench.ts` renders a compact terminal workbench from live Port Daddy
state:

- claimed services and URLs
- active agents
- active sessions
- locks
- channels
- managed tunnels
- recent tuple-space facts

Run:

```bash
npx tsx examples/devtools/agent-workbench.ts
npx tsx examples/devtools/agent-workbench.ts --json
```

This example is read-only. It is a good starting point for building a status
bar, local dashboard, CI preflight tool, FleetBar companion, or editor extension.
