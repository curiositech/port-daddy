# Plist Field Reference

Use this when writing or reviewing the actual `.plist` keys, not just the high-level plan.

## Core Keys

| Key | Type | Meaning | Failure Mode If Wrong |
| --- | --- | --- | --- |
| `Label` | string | Unique job identifier, reverse-DNS style (`com.example.myapp`). Used by every `launchctl` command that targets this job. | Duplicate labels across plists silently shadow each other or race the same listener port. |
| `ProgramArguments` | array of strings | The argv to exec, element 0 is the binary. | Element 0 as a bare command name (`node`, `python3`) resolves against launchd's minimal `PATH` and fails with "command not found" even though it works in a terminal. |
| `RunAtLoad` | bool | Start immediately when the job is bootstrapped (Agent: at login; Daemon: at boot). | Omitted (defaults false): the job sits loaded-but-stopped until something else triggers it — looks "installed" but never actually runs. |
| `KeepAlive` | bool or dict | Whether launchd respawns the process after it exits, and under what conditions. | Bare `true` respawns even on a deliberate clean exit (e.g. a graceful `pd stop`), fighting the operator. Absent entirely: a crash is never restarted. |
| `KeepAlive.SuccessfulExit` | bool | `false` (with `Crashed: true`) means "don't respawn on exit code 0, but do respawn on a crash/signal." | Set to `true`: a deliberate stop gets treated as a crash and instantly restarted — you can't stop the daemon by killing it. |
| `KeepAlive.Crashed` | bool | Restart specifically on abnormal termination (signal, non-zero exit). | Omitted while `SuccessfulExit: false` is set: a real crash is never restarted either — worse than `KeepAlive: true`. |
| `ThrottleInterval` | number (seconds) | Minimum time launchd waits between respawns of a crash-looping job. Default is 10s if the key is absent, but relying on the implicit default hides intent. | Set too low (or explicitly 0): a crash loop burns CPU and fills logs at the fastest rate the process can fail. |
| `StandardOutPath` / `StandardErrorPath` | string | Absolute file path launchd redirects stdout/stderr to (launchd does not rotate or size-cap these — pair with `newsyslog`/`logrotate` config for long-lived jobs). | Pointed at `/tmp` or `/private/tmp`: macOS purges these paths on a schedule and on reboot, so the log needed to diagnose a boot-time crash is gone. |
| `EnvironmentVariables` | dict of string→string | Explicit environment for the process; launchd does NOT source `.zshrc`/`.bash_profile`/`.zprofile`. | Omitted `PATH`: the job runs with `PATH=/usr/bin:/bin:/usr/sbin:/sbin` only — Homebrew, nvm, and rbenv shims are invisible. |
| `WorkingDirectory` | string | `cwd` for the process. | Omitted: defaults to `/`, which breaks relative-path assumptions (config files, `node_modules`, SQLite files opened with relative paths). |
| `ProcessType` | string (`Interactive`, `Standard`, `Adaptive`, `Background`) | Hints to the OS scheduler about CPU/IO priority tier. | Wrong tier for a long-lived background daemon (`Interactive`) causes it to be treated like a foreground app for power/thermal throttling. |
| `LimitLoadToSessionType` | string or array | Restricts an Agent to specific session types (`Aqua`, `LoginWindow`, `Background`). | Omitted on an Agent meant only for the GUI session: it also loads under `Background`/SSH sessions where GUI calls fail. |
| `AbandonProcessGroup` | bool | If true, launchd does not kill child processes when the parent exits (default false: it kills the whole process group). | Left false for a job that intentionally daemonizes/forks helpers: launchd reaps the helpers out from under it. |

## Modern Load/Unload Commands

The pre-macOS-10.10 `launchctl load`/`unload` verbs are deprecated. Use the bootstrap/bootout pair, which are domain-scoped and give clearer errors:

```bash
# Agent (per-user GUI session), UID via `id -u`
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.example.myapp.plist
launchctl bootout   gui/$(id -u)/com.example.myapp

# Daemon (system-wide, requires sudo)
sudo launchctl bootstrap system /Library/LaunchDaemons/com.example.myapp.plist
sudo launchctl bootout system/com.example.myapp

# Force an immediate respawn without touching the plist
launchctl kickstart -k gui/$(id -u)/com.example.myapp

# Query load state + PID (empty/error output means NOT loaded)
launchctl list com.example.myapp
```

`launchctl list <label>` exits `0` and prints a `"PID" = N;` line when loaded and running; exits `0` with no PID line when loaded-but-stopped; exits non-zero ("Could not find service") when not loaded at all. That three-way distinction is the basis of any supervision-integrity check — see `agent-vs-daemon-and-integrity.md`.

## Binary vs XML Plists

`plutil -convert binary1 -o - x.plist` and several installers (Homebrew formulae included) emit binary plists. Reading those bytes as UTF-8 to grep for a stale path yields garbage and silently false-negatives. Detect the binary magic (`bplist` at byte 0) and normalize first:

```bash
plutil -convert xml1 -o - ~/Library/LaunchAgents/com.example.myapp.plist
```
