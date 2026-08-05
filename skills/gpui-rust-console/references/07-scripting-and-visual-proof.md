# Scripting a live pd-console & capturing honest visual proof

Consult when you need to drive a RUNNING pd-console programmatically — switch
panes, read pane state as JSON, tune the galaxy query, rebind the daemon — or
when a PR needs screenshot evidence that will survive the visual-evidence
manifest gate. This is the console's REPL: stop debugging it with blind
screenshot loops.

## The control socket (the REPL)

The console serves a newline-JSON command socket when launched with
`--control-sock <path>` or `PD_CONSOLE_CONTROL_SOCK=<path>`
(`src/script.rs`; commands answered by the 500ms foreground drain with full
`ConsoleView` access, so scripting can never reach state the UI couldn't).

```bash
# Launch a devbuild with the socket. `open -n` forces a FRESH instance —
# a bare `open -a` re-activates a stale one and your env never applies.
open -n --env PD_CONSOLE_CONTROL_SOCK=~/.port-daddy/console-ctl.sock \
     -a ~/Applications/pd-console-dev-apps/pd-console_dev-<name>.app

# Drive it (stdlib client; non-zero exit on ok=false):
python3 core/pd-console/scripts/console-ctl.py ping
python3 core/pd-console/scripts/console-ctl.py panes
python3 core/pd-console/scripts/console-ctl.py focus galaxy
python3 core/pd-console/scripts/console-ctl.py galaxy --window-hours 720 --min-tokens 64
python3 core/pd-console/scripts/console-ctl.py state galaxy   # pane blocks + typed snapshot as JSON
# Rebind to the daemon-published endpoint after `eval "$(pd use <label>)"`.
: "${PORT_DADDY_URL:?run eval \"$(pd use <label>)\" first; daemon-published endpoint required}"
python3 core/pd-console/scripts/console-ctl.py rebind "$PORT_DADDY_URL"
python3 core/pd-console/scripts/console-ctl.py alerts
```

Wire protocol (one JSON object per line, reply per line):
`{"cmd":"ping"|"panes"|"alerts"}`, `{"cmd":"focus","pane":"<nav-id>"}`,
`{"cmd":"state","pane":"<nav-id>"}`, `{"cmd":"galaxy","windowHours":N,"minTokens":N}`,
`{"cmd":"rebind","url":"http://..."}`. Unknown commands and missing fields
come back as `{"ok":false,"error":"<why>"}`; a wedged foreground times out
at 5s instead of hanging your script.

## Daemon selection for a console instance

Discovery order (`DaemonClient::discover`): explicit `PORT_DADDY_URL` → the
canonical daemon's atomically published `~/.port-daddy/daemon.port`. Named
feature daemons are selected with `pd use <label>` and passed to the launched
console process. There is no persistent console-only selector to outlive a dev
daemon and shadow the healthy stable endpoint. Environment only reaches the
process on direct binary launches or `open --env`; LaunchServices does not
inherit your shell.

To serve worktree source (e.g. routes the release daemon lacks) on a named
profile:

```bash
pd dev up --from "$PWD" --label <name>
eval "$(pd use <name>)"
open -n --env PORT_DADDY_URL="$PORT_DADDY_URL" \
  -a ~/Applications/pd-console-dev-apps/pd-console-dev-<name>.app
```

The named daemon owns an isolated state plane and publishes the endpoint it
actually bound. If an endpoint stops identifying as that label, recreate the
berth and rebind through the new `pd use` output; never guess or preserve a port.

## The verify-then-capture doctrine

A screenshot you didn't verify is not proof (operator has rejected exactly
this). The pipeline that survives the `agent-visual-evidence-manifest` gate:

1. Rebuild the devbuild AT BRANCH HEAD (`bash ../../core/pd-console/scripts/package-console.sh
   --devbuild <name>`), relaunch with the socket.
2. Script the target state, then ASSERT it from `state` JSON (point counts,
   error==null) — fail loudly on mismatch, never capture a broken pane.
3. Enumerate windows (Quartz `CGWindowListCopyWindowInfo`, match the owner
   name `pd-console (dev: <name>)`, assert EXACTLY ONE — stale instances are
   how you screenshot the wrong console) and capture non-interruptively:
   `screencapture -x -l <windowId> out.png`.
4. Attach with a full six-field provenance manifest (daemonPort, runId,
   transcriptHeadHash — e.g. sha1 of the live endpoint response — agentNodeId,
   commit == the HEAD the binary was built from, sourceLabel real/fixture/mock)
   and re-run `proof_manifest_audit.mjs` — it fails closed on stale commits.

## Gotchas that burned real sessions

- The shared reqwest client is TIMEOUTED (3s connect / 15s total) precisely
  because one blackholed endpoint used to wedge all 26 serial pane refreshes
  on the launch splash forever. The Lane's SSE stream overrides the total
  deadline per-request — preserve that if you touch `DaemonClient`.
- Background processes launched from an agent's shell die with the shell's
  process group. Launch apps via `open -n --env ...`, never `nohup binary &`.
- `[profile.release]` in `core/pd-console/Cargo.toml` is IGNORED (non-root
  workspace member) — release knobs belong at the workspace root.
