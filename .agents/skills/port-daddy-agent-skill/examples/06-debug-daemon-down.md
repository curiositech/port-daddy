# 06 — Debug a selected daemon that is unreachable

**Scenario:** a CLI, FleetBar, browser, or MCP call cannot reach Port Daddy.

Do not begin with a port number or a restart. First identify which runtime the
client selected.

```bash
pd status --json
pd dev list
printf 'selected URL: %s\n' "${PORT_DADDY_URL:-stable profile}"
printf 'selected port file: %s\n' "${PORT_DADDY_PORT_FILE:-$HOME/.port-daddy/daemon.port}"
```

## Stable runtime

The installed macOS daemon has one lifecycle owner: Homebrew through launchd.
FleetBar is the operator surface; these shell checks are for agent recovery.

```bash
launchctl print gui/$(id -u)/homebrew.mxcl.port-daddy
/opt/homebrew/bin/pd doctor --json
```

Compare the launchd program/PID with the installed keg. Then read the selected
port file and test the endpoint it publishes:

```bash
PD_PORT_FILE="${PORT_DADDY_PORT_FILE:-$HOME/.port-daddy/daemon.port}"
PD_URL="${PORT_DADDY_URL:-http://127.0.0.1:$(tr -d '\n' < "$PD_PORT_FILE")}"
curl -fsS "$PD_URL/health" | jq .
```

If launchd and health disagree, use FleetBar's restart action or the Homebrew
service control during release/recovery. Do not install a rival job, delete
sockets blindly, or kill an unrelated listener.

## Named development runtime

```bash
pd dev list
pd --daemon <label> status --json
eval "$(pd use <label>)"
pd status --json
```

Check the named profile's source directory, revision, PID, heartbeat, and
published endpoint. Rebuild that label from its feature worktree when its
revision is stale. Do not restart stable to test feature code.

## Interpreting evidence

| Evidence | What it proves |
|---|---|
| launchd PID | Stable supervisor owns a process |
| named profile PID | `pd dev` recorded a child process |
| fresh heartbeat | The supervisor/provider still observes it |
| socket response | Local IPC path works |
| published TCP health | Browser/HTTP path works |
| health source revision | Which code is actually serving |
| durable receipt/transcript | Agent work survived observer or daemon loss |

If process/transport evidence is ambiguous, stop mutations and leave an exact
coordination note. A healthy agent run is never converted to failure because an
observer disconnected.
