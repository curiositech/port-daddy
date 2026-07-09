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
python3 core/pd-console/scripts/console-ctl.py rebind http://127.0.0.1:9893
python3 core/pd-console/scripts/console-ctl.py alerts
```

Wire protocol (one JSON object per line, reply per line):
`{"cmd":"ping"|"panes"|"alerts"}`, `{"cmd":"focus","pane":"<nav-id>"}`,
`{"cmd":"state","pane":"<nav-id>"}`, `{"cmd":"galaxy","windowHours":N,"minTokens":N}`,
`{"cmd":"rebind","url":"http://..."}`. Unknown commands and missing fields
come back as `{"ok":false,"error":"<why>"}`; a wedged foreground times out
at 5s instead of hanging your script.

## Daemon selection for a console instance

Discovery order (`DaemonClient::discover`): `PORT_DADDY_URL` env →
`~/.port-daddy/console-daemon.url` (one-line URL file — the operator's
"use this daemon" switch; DELETE it when done or every future console launch
silently pins to your dev daemon) → canonical `~/.port-daddy/daemon.port`.
Env only reaches the process on DIRECT binary launches or `open --env`;
LaunchServices does not inherit your shell.

To serve worktree source (e.g. routes the release daemon lacks) on a named
profile:

```bash
PORT_DADDY_ALLOW_SOURCE_DAEMON=1 npx tsx bin/port-daddy-cli.ts daemon start <name> --port <p>
# Profile DB is ISOLATED at ~/.port-daddy/instances/<name>/port-daddy.db —
# seed real data with:  sqlite3 <source.db> ".backup '<profile db path>'"
```

Beware port squatters: if a stopped profile's port starts answering again
with 404s on your new routes, a RELEASE daemon respawned there (split-brain
fallback). Don't fight it — move to a fresh port and `rebind` via the socket.

## The verify-then-capture doctrine

A screenshot you didn't verify is not proof (operator has rejected exactly
this). The pipeline that survives the `agent-visual-evidence-manifest` gate:

1. Rebuild the devbuild AT BRANCH HEAD (`bash scripts/package-console.sh
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
