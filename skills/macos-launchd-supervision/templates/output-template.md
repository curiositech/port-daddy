# Launchd Supervision Plan

## Job Identity

- Label: `[reverse-DNS label]`
- Placement: `[agent | daemon]` — because `[GUI-session need / boot-time need]`

## Plist

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>[label]</string>
    <key>ProgramArguments</key>
    <array>
        <string>[absolute path to binary]</string>
        <string>[arg]</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
        <key>Crashed</key>
        <true/>
    </dict>
    <key>ThrottleInterval</key>
    <integer>[>=10]</integer>
    <key>StandardOutPath</key>
    <string>[durable log path, never /tmp]</string>
    <key>StandardErrorPath</key>
    <string>[durable log path, never /tmp]</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>[full absolute search path]</string>
    </dict>
</dict>
</plist>
```

## Load Plan

```bash
[launchctl bootstrap gui/$(id -u) <plist>  OR  sudo launchctl bootstrap system <plist>]
launchctl list [label]
```

## Lint

Run:

```bash
node skills/macos-launchd-supervision/scripts/plist_lint.mjs --input launchd-plan.json
```

Paste the lint report and resolve every `critical` finding before loading the job.

## Supervision-Integrity Check

- Supervisor label(s) this job depends on: `[label list]`
- Who runs the check and how often: `[doctor subcommand / cron / watchdog process]`
- Severity mapping: `[ok / warn / critical per the loaded-count × reachability table]`
- Fix action surfaced to the operator on each severity: `[exact launchctl/reinstall command]`
