# Port Daddy — Distribution

Two channels, one codebase.

## Channels

| Channel | Audience | Install | Updates |
|---|---|---|---|
| **Homebrew tap** (`curiositech/homebrew-tap`) | Developers, Port Daddy contributors | `brew install curiositech/tap/port-daddy` | `brew upgrade` |
| **Signed .pkg** | GUI-first Mac users | "Download for Mac" on the landing page | Sparkle *(follow-up)* |

Both install the same daemon. Users should pick one; the pkg postinstall
refuses to run if Homebrew already installed Port Daddy, and vice versa.

## Signed pkg layout

See `packaging/README.md` for the authoritative component table. Summary:

- `pd` CLI → `/usr/local/bin/pd`
- Daemon → `/usr/local/libexec/portdaddy/daemon`
- Bosun watchdog *(V4, pending — ADR-0021)* → `/usr/local/libexec/portdaddy/bosun`
- FleetBar.app → `/Applications/FleetBar.app`
- LaunchAgents written per-user by postinstall

## Build

Local smoke test (unsigned):
```bash
./packaging/build-pkg.sh --unsigned
```

Production build (requires Developer ID + notarytool credentials):
```bash
./packaging/build-pkg.sh \
  --sign "Developer ID Application: Erich Owens (TEAMID)" \
  --pkg-sign "Developer ID Installer: Erich Owens (TEAMID)" \
  --notarize-profile portdaddy-notary
```

Output: `dist/pkg/PortDaddy-<version>.pkg`

## CI

Tagging a release (`git tag v3.8.4 && git push --tags`) triggers
`.github/workflows/release-pkg.yml`. The workflow:

1. Imports the signing certificates from secrets.
2. Builds FleetBar.app with Xcode.
3. Signs binaries with the hardened runtime (`packaging/entitlements.plist`).
4. Builds component pkgs (`core.pkg`, `fleetbar.pkg`) with `pkgbuild`.
5. Assembles the distribution pkg with `productbuild`.
6. Submits to notarytool, waits, staples.
7. Uploads artifact + attaches to the GitHub release.

Without signing secrets configured, the workflow produces an unsigned smoke-test
pkg to verify the layout builds.

## Required secrets

| Secret | Purpose |
|---|---|
| `APPLE_APP_SIGN_ID` | "Developer ID Application: NAME (TEAMID)" |
| `APPLE_PKG_SIGN_ID` | "Developer ID Installer: NAME (TEAMID)" |
| `APPLE_TEAM_ID` | 10-char team identifier |
| `APPLE_CERTIFICATES_P12` | base64-encoded .p12 containing both certs |
| `APPLE_CERTIFICATES_P12_PASSWORD` | password for the .p12 |
| `APPLE_NOTARY_ISSUER` | App Store Connect issuer ID (UUID) |
| `APPLE_NOTARY_KEY_ID` | 10-char key ID |
| `APPLE_NOTARY_KEY` | Contents of AuthKey_XXX.p8 |

## Open questions — see roadmap

- **Node runtime packaging.** Options: bundle Node, use `node --experimental-sea-config`
  for a single executable, or compile with Bun. Decision blocks the first
  signed pkg release. Tracked in `docs/V4-UNIFIED-ROADMAP.md`.
- **Sparkle for FleetBar auto-updates.** Not required for v1. Adds an EdDSA
  signing key and an appcast feed. Tracked on roadmap.
- **MCP client detection in the installer.** Deliberately out of scope —
  `pd mcp install` runs at first launch so MCP client churn doesn't gate our
  release cadence.
- **Bosun V4 implementation.** Until `core/pd-bosun/` ships, the installer
  writes the Bosun plist template but doesn't load it. See ADR-0021.
