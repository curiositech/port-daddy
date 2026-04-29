# Port Daddy macOS Distribution

Signed, notarized `.pkg` installer for the full Port Daddy stack.

## What ships in the pkg

| Component | Install location | Supervisor |
|---|---|---|
| `pd` CLI | `/usr/local/bin/pd` | — |
| Port Daddy daemon | `/usr/local/libexec/portdaddy/daemon` | launchd |
| Bosun watchdog *(V4, pending — ADR-0021)* | `/usr/local/libexec/portdaddy/bosun` | launchd |
| FleetBar.app | `/Applications/FleetBar.app` | user-launched |
| Launch Agent — daemon | `~/Library/LaunchAgents/com.portdaddy.daemon.plist` | installed by postinstall |
| Launch Agent — bosun *(V4)* | `~/Library/LaunchAgents/com.portdaddy.bosun.plist` | installed by postinstall |

MCP config is **not** installed by the pkg. Users run `pd mcp install` after
first launch so MCP clients (Claude Code, Desktop, Cursor, Windsurf, etc.) can
change independently of our release cadence.

## Distribution channels

1. **Homebrew tap** (`curiositech/homebrew-tap`) for developers — existing
   formula continues to install daemon + CLI via brew services.
2. **Signed `.pkg`** for GUI-first users — the "Download for Mac" button on
   the landing page. Ships FleetBar as the entry point.

Pick one per install. The pkg postinstall refuses to run if Homebrew already
installed Port Daddy, and vice versa.

## Signing + notarization requirements

The following must exist in the build environment (GitHub Actions secrets or
local keychain) to produce a shippable pkg:

- **Developer ID Application** certificate (signs the daemon, bosun, FleetBar)
- **Developer ID Installer** certificate (signs the .pkg itself)
- **App-specific password** or **API key** for `notarytool`
- Team ID

## Local build (developer smoke test)

```bash
# Unsigned build for testing the layout
./packaging/build-pkg.sh --unsigned

# Signed + notarized build (requires secrets)
./packaging/build-pkg.sh \
  --sign "Developer ID Application: Erich Owens (TEAMID)" \
  --pkg-sign "Developer ID Installer: Erich Owens (TEAMID)" \
  --notarize-profile portdaddy-notary
```

Output: `dist/pkg/PortDaddy-<version>.pkg`

## CI

See `.github/workflows/release-pkg.yml`. Triggers on tags matching `v*.*.*`.
Requires the secrets above. Uploads the signed pkg as a release artifact.

## Known caveats

- **Per-user vs system install.** LaunchAgents go in `~/Library/LaunchAgents/`
  (per-user), installed by a postinstall script that runs as the installing
  user. LaunchDaemons (`/Library/LaunchDaemons/`) would need root — we don't
  want that.
- **FleetBar is not sandboxed.** It talks to the daemon over a local socket.
  We use the hardened runtime + Developer ID, not the App Sandbox, not the
  Mac App Store.
- **better-sqlite3** is precompiled via prebuildify and bundled in the pkg
  payload. No node-gyp at install time.
- **Sparkle** (FleetBar auto-updates) is a follow-up, not required for the
  first signed release.
