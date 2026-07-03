# Example Output: macOS Launchd Supervision

Scenario: Port Daddy's own daemon (`pd start --foreground`) needs a LaunchAgent that survives
`brew upgrade` churn, logs durably, and is checked by an external supervision-integrity command.

## Job Identity

- Label: `homebrew.mxcl.port-daddy`
- Placement: **agent** — the daemon serves the local dev CLI/console for a logged-in user; it does not need to run before login, so a LaunchDaemon would be unnecessary root-level surface area.

## Plist

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>homebrew.mxcl.port-daddy</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/opt/port-daddy/bin/pd</string>
        <string>start</string>
        <string>--foreground</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>StandardOutPath</key>
    <string>/opt/homebrew/var/log/port-daddy.log</string>
    <key>StandardErrorPath</key>
    <string>/opt/homebrew/var/log/port-daddy.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
</dict>
</plist>
```

## Lint Input

```json
{
  "label": "homebrew.mxcl.port-daddy",
  "programArgs": ["/opt/homebrew/opt/port-daddy/bin/pd", "start", "--foreground"],
  "runAtLoad": true,
  "keepAlive": true,
  "throttleInterval": 10,
  "stdoutPath": "/opt/homebrew/var/log/port-daddy.log",
  "stderrPath": "/opt/homebrew/var/log/port-daddy.log",
  "env": { "PATH": "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" },
  "agentVsDaemon": "agent",
  "requiresGuiSession": false,
  "runsAtSystemBoot": false,
  "hasExternalIntegrityCheck": true
}
```

## Lint Report

```json
{
  "label": "homebrew.mxcl.port-daddy",
  "agentVsDaemon": "agent",
  "pass": true,
  "findings": [],
  "recommendations": []
}
```

## Supervision-Integrity Check (the part `KeepAlive` cannot do for itself)

- Supervisor labels this daemon depends on: `homebrew.mxcl.port-daddy` (canonical), `com.portdaddy.daemon` (legacy, should never coexist).
- Who runs the check: `pd doctor supervision-integrity`, invoked on-demand and from the periodic freshness tick.
- Severity mapping used: zero supervisors loaded + daemon unreachable → `critical` ("silent death" — this is exactly what a `brew upgrade` unload leaves behind); zero loaded + daemon reachable → `warn` (running unsupervised); two or more loaded → `warn` (duplicate `KeepAlive` jobs racing the listener); exactly one loaded and reachable → `ok`.
- Fix surfaced on `critical`: `port-daddy install` then `port-daddy start`. Fix surfaced on the duplicate-supervisor `warn`: `launchctl bootout gui/$(id -u)/<duplicate-label>`.

## Anti-Pattern This Example Avoids

Before this check existed, `pd doctor` looked only for the legacy `com.portdaddy.daemon` label and reported "LaunchAgent not installed" on a perfectly-healthy, brew-supervised daemon — a false positive caused by checking the wrong label instead of checking supervision as a set. The fix generalized the check to every legitimate supervisor label, not just one hardcoded name.
