# Semantic scripting for pd-console

Launch a named development app with a unique, owner-only Unix socket, then use
`scripts/console-ctl.py` to discover and drive the controls the window actually
exposes. Automation names product actions, not screen coordinates.

```sh
python3 scripts/console-ctl.py --sock "$PD_CONSOLE_CONTROL_SOCK" describe
python3 scripts/console-ctl.py --sock "$PD_CONSOLE_CONTROL_SOCK" context
python3 scripts/console-ctl.py --sock "$PD_CONSOLE_CONTROL_SOCK" click nav.mission
python3 scripts/console-ctl.py --sock "$PD_CONSOLE_CONTROL_SOCK" type mission.composer "Inspect the active claims"
python3 scripts/console-ctl.py --sock "$PD_CONSOLE_CONTROL_SOCK" assert mission.composer.value "Inspect the active claims"
python3 scripts/console-ctl.py --sock "$PD_CONSOLE_CONTROL_SOCK" click mission.send
python3 scripts/console-ctl.py --sock "$PD_CONSOLE_CONTROL_SOCK" wait mission.awaitingReply false --timeout-ms 30000
```

`describe` is authoritative for the current window. Every selector reports its
action and enabled state. Mission context cards open the same contextual
companion surface as a pointer click while preserving Mission in the workspace.
The predefined `workspace.primary-companion.divider` is available only after
that two-region workspace is laid out. Unknown or disabled selectors fail with
structured errors.

`context` reports the daemon URL with credentials, query, and fragment removed;
the daemon-admitted Mission project directory; execution worktree; Mission IDs;
provider-neutral backend/model labels; terminal launch directory/binding state;
and explicit unknown tool/MCP availability. The shell's live working directory
is reported as unknown because pd-console does not yet consume an authoritative
OSC 7 update after `cd`. It never returns environment variables, tokens,
transcript prose, or arbitrary files. Repository identity is explicitly unknown
when the WorkIntent only proves a directory.

## Bounded scenarios

The stdlib driver owns waiting so the GPUI foreground never blocks. Pass a JSON
scenario inline, on stdin (`scenario -`), or from one explicitly named file
(`scenario --file repro.json`):

```json
{
  "schema": "pd-console.scenario.v1",
  "protocolVersion": 1,
  "onError": "abort",
  "steps": [
    {"cmd": "click", "target": "nav.mission"},
    {"cmd": "type", "target": "mission.composer", "text": "Inspect claims"},
    {"cmd": "assert", "path": "mission.composer.value", "value": "Inspect claims"},
    {"cmd": "click", "target": "mission.send"},
    {"cmd": "wait", "path": "mission.awaitingReply", "value": false, "timeoutMs": 30000}
  ]
}
```

Scenarios allow 1–64 steps, reject nesting, bound waits at 30 seconds, and return
per-step timestamps/results plus a SHA-256 replay receipt. The receipt excludes
timestamps and durations, so the same requests and structured results hash the
same way. `onError` is explicitly `abort` or `continue`.

The socket requires an absolute path under a real current-user-owned directory,
uses mode `0600`, refuses symlinks/non-sockets/live listeners/foreign ownership,
and bounds lines, responses, requests per connection, concurrent connections,
strings, deltas, and I/O timeouts. There is no shell execution, environment dump,
or arbitrary file access in the protocol. Every wire request must carry
`"protocolVersion": 1`; the bundled driver stamps it automatically and every
response reports the accepted protocol name/version. A missing or different
version fails closed.

Opening the terminal through its toolbar control, keyboard shortcut, or
`terminal.toggle` selector uses one shared transition. If its PTY belongs to a
different project, pd-console replaces it with a fresh login shell rooted at the
daemon-admitted Mission `projectDir`. The retired shell is checkpointed before
replacement, late events from it are ignored, and its bytes never enter the new
shell. `context` calls this `projectBoundAtLaunch`; it never claims the shell is
still there after an operator changes directories. The terminal stays closed
when the admitted directory is unavailable or invalid.
