# LaunchAgent vs LaunchDaemon, and the Supervision-Integrity Pattern

Use this when deciding where a job lives, or when designing a check that verifies the supervisor itself.

## LaunchAgent vs LaunchDaemon Decision Ladder

| Question | Answer → | Placement |
| --- | --- | --- |
| Does it need a logged-in GUI session (Aqua windows, menu bar item, user notifications, keychain UI prompts, `osascript`)? | Yes | **LaunchAgent** — `~/Library/LaunchAgents/<label>.plist`, runs as the logged-in user, starts at login. |
| Must it be running before any user logs in, or with no user ever logging in (headless server, boot-time service)? | Yes | **LaunchDaemon** — `/Library/LaunchDaemons/<label>.plist`, runs as root (or a specified `UserName`), starts at boot, requires `sudo` to install/manage. |
| Does every user on a shared machine need their own instance? | Yes | **LaunchAgent** per user — each user's `~/Library/LaunchAgents` is independent. |
| Does it need to keep running across fast user switching / when nobody is logged in? | Yes | **LaunchDaemon** — Agents die when their user's GUI session ends. |
| Does it bind a privileged port (<1024) or need root-only filesystem access? | Yes | **LaunchDaemon**, run as root or with elevated `UserName`. |

A misplaced job fails in specific, diagnosable ways:
- **LaunchDaemon that assumes a GUI session** (e.g. calls `NSUserNotificationCenter`, opens an NSWindow, or shells out to `osascript "display notification"`): silently no-ops or errors, because daemons run outside any Aqua session.
- **LaunchAgent that must run at boot before login** (e.g. a network service other machines depend on): simply isn't running yet when needed, then starts only once someone logs in — and stops again at logout.

## Real Annotated Example: A Local Daemon LaunchAgent

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.example.myapp</string>

    <!-- Absolute path to the binary AND every arg. Never a bare command name. -->
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/myapp</string>
        <string>start</string>
        <string>--foreground</string>
    </array>

    <!-- Survives login/reboot; without this the job sits loaded-but-stopped. -->
    <key>RunAtLoad</key>
    <true/>

    <!-- Respawn on crash, but NOT on a deliberate clean stop (exit 0). -->
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
        <key>Crashed</key>
        <true/>
    </dict>

    <!-- Rate-limit respawns of a crash loop. -->
    <key>ThrottleInterval</key>
    <integer>10</integer>

    <!-- DURABLE log paths — never /tmp or /private/tmp. -->
    <key>StandardOutPath</key>
    <string>/Users/erich/Library/Logs/myapp/myapp.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/erich/Library/Logs/myapp/myapp.err.log</string>

    <!-- Pin PATH: launchd's default is /usr/bin:/bin:/usr/sbin:/sbin only. -->
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>

    <key>WorkingDirectory</key>
    <string>/Users/erich/.myapp</string>
</dict>
</plist>
```

## The Supervision-Integrity Pattern

**Why KeepAlive isn't enough:** `KeepAlive` is a property of a *loaded* job. It has no mechanism to notice that the job itself was unloaded — by `brew upgrade` reinstalling the formula and re-registering the service, by a user logout/login cycle, by `launchctl bootout`, or by a corrupted plist that fails to parse on the next bootstrap. In every one of those cases the daemon can die and **nothing is watching**, because the thing that was supposed to watch is gone too.

**Detecting an unloaded supervisor (the real Port Daddy fix, PR #607):** query launchctl for every label that legitimately supervises the daemon — there may legitimately be more than one candidate across install methods (Homebrew formula vs. a first-party installer), but exactly one should ever be loaded at a time:

```ts
export const DAEMON_SUPERVISOR_LABELS = [
  'homebrew.mxcl.port-daddy',
  'com.portdaddy.daemon',
] as const;
```

Then classify the combination of (how many supervisors are loaded) × (is the daemon actually reachable) into a 3-tier severity, because "the process is unreachable" and "the supervisor is missing" are different problems with different fixes:

| Loaded supervisors | Daemon reachable? | Severity | Meaning | Fix |
| --- | --- | --- | --- | --- |
| 0 | No | **critical** | No supervisor loaded AND the daemon is dead — this is the silent-death scenario, indistinguishable from "user never installed it" without this check. | Reinstall the supervisor, then start the daemon. |
| 0 | Yes | **warn** | Daemon is up right now, but nothing will resurrect it if it dies (e.g. it was started manually, bypassing the supervisor). | Reinstall/re-bootstrap the supervisor so `KeepAlive` resumes coverage. |
| ≥2 | either | **warn** | Duplicate `KeepAlive` jobs race the same listener/port — a classic install-script dedup bug (e.g. a first-party installer creating a second job on top of an existing Homebrew service). | Unload every supervisor but one: `launchctl bootout gui/$(id -u)/<duplicate-label>`. |
| 1 | Yes | **ok** | Exactly one supervisor loaded, daemon reachable. | Nothing — this is the healthy state. |
| 1 | No | **warn** | Supervisor is loaded but the process isn't responding — could be starting up, could be hung. | `launchctl kickstart -k gui/$(id -u)/<label>` to force a fresh start. |

**Where this check must live:** NOT inside the daemon (a dead daemon can't report its own death) and NOT solely inside `KeepAlive` (it can't detect its own absence). It has to be an independent, periodically-invoked check — a `doctor`/`health` CLI subcommand, a separate lightweight watchdog process, or a scheduled cron/LaunchAgent of its own — that shells out to `launchctl list` and reasons about the result. This is detection, not self-healing: pair it with a clear, actionable hint (the exact `launchctl`/reinstall command to run) rather than trying to have the check silently repair itself, which just adds a second thing that can silently fail.
