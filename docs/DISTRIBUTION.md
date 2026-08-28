# Port Daddy Distribution — the honest map

*Audited 2026-08-09. This is the answer to "we ship too many surfaces — does
Homebrew even install all of this?" Keep it current: any change to what a
surface ships through must update this file.*

## The one-paragraph answer

Homebrew is the **primary and only supported install path**, and it installs
the daemon, the CLI, and (from v3.28.0) the full runtime cargo — squid
tentacles, statusline, SessionStart hook, the agent skill, and the Pilot agent
source. It does **not** install FleetBar or pd-console (separate signed .zip
downloads from the GitHub Release), and it never will install the cloud
surfaces (relay, fleet executor, GitHub App) because those are deployed
services, not installed software. The SDK and MCP server ship *inside* the
brew artifacts. Everything else on the list below is either dev-only,
cloud-deployed, or documentation.

## Surface inventory

| Surface | What it is | Distribution channel | In `brew install port-daddy`? |
|---|---|---|---|
| Daemon (`port-daddy`) | The always-on coordination daemon | GitHub Release tarball → brew formula; `brew services` supervises it | **Yes** |
| CLI (`pd`) | Launcher/CLI binary | Same tarball | **Yes** |
| Squid harness | `pd-hook-prompt/-pre-tool/-post-tool` tentacles + `pd-statusline`; `pd-hook-precompact` is Claude-only source work pending release-cargo inclusion | Same tarball, under `bin/` (pkgshare from 3.28) | **Yes, except pending precompact cargo** |
| Hooks | `hooks/sessionstart-pilot.mjs` SessionStart steering | Same tarball | **Yes** |
| Agent skill | `skills/port-daddy-agent-skill` — `pd setup` symlinks it into every runtime | Same tarball from **3.28.0** (pre-binary npm formula shipped it from source; the binary tarballs 3.14–3.27 silently did NOT) | **Yes (3.28+)** |
| Pilot agent | `agents/port-daddy-pilot` — rendered by `pd setup` per runtime | Same tarball from **3.28.0** | **Yes (3.28+)** |
| MCP server | `mcp/server.ts`, compiled into the binaries; wired by `pd mcp install` | Inside the daemon/CLI binaries | **Yes** (wiring is a post-install `pd mcp install`) |
| SDK (`port-daddy/client`) | Zero-dep JS client (`lib/client.ts`, docs/sdk.md) | **npm — RETIRED 2026-07-04 and ~8 releases stale.** docs/sdk.md still says `npm install port-daddy` | No — and its documented channel is dead (see Gaps) |
| FleetBar | macOS menu-bar GUI | Signed .zip on each GitHub Release (`PortDaddy-FleetBar-macOS-*.zip`); `latest.json` feed for updates | **No** — manual download |
| pd-console | GPUI console .app | Signed .zip on each GitHub Release | **No** — manual download |
| Relay / storefront | portdaddy.dev cloud relay (accounts, run pages) | Cloudflare Workers deploy (`deploy-relay*.yml`) | No (cloud service) |
| Fleet executor | Cloud fleet runner | Cloudflare deploy (`deploy-fleet-executor.yml`) | No (cloud service) |
| GitHub App | `apps/github-app-fleet`, `apps/github-app-receiver` | GitHub App installation + Cloudflare deploy | No (cloud service) |
| Chrome extension | `apps/pd-scout-extension` (screen scout) | **Unpacked dev-load only** (`chrome://extensions`); plan of record is absorption into pd-console | No — dev-only, pre-release |
| Examples | `examples/*` | Git checkout only | No (docs/dev material) |
| Update feed | `latest.json` per release | GitHub Release asset; consumed by `pd upgrade` + GUIs | n/a (it's the feed) |

## How the pipeline hangs together (since 2026-08)

```
release-train.yml (Mon/Thu cron)
  measures unreleased daemon-surface commits
  → check-formula-compat preflight (tap formula must accept the layout)
  → version-bump PR (sync-version, CHANGELOG stamp), auto-merge
  → on merge: tag + GitHub Release
      → release.yml: build → sign/notarize → 180s soak of the exact packaged
        binary → pd batten verify → formula-compat preflight → tar → imprint
        → FleetBar + pd-console .apps → latest.json → tap roll
          → fresh-install.yml: downloads the PUBLISHED artifacts on pristine
            macOS/Linux runners (checksums, Gatekeeper, daemon /health, mcp)
            AND does the literal `brew tap && brew install` user path;
            any failure files/refreshes a tracking issue
release-cadence.yml (weekly) — watchdog: if the train stalls, it nags loudly
```

Two invariants with teeth:

- **The tap formula's tarball gate** (curiositech/homebrew-tap) odies at
  install time if the tarball's top-level entries don't hash to the layout it
  was reviewed against.
- **`scripts/check-formula-compat.mjs`** enforces the same contract from the
  producing side, before anything is sealed. Changing the tarball layout
  requires changing both sides in one coordinated move; either side alone
  fails loudly instead of shipping a brew-breaking release.

## Gaps and standing decisions

1. **Notarization is broken repo-wide** (as of v3.27.0): the App Store Connect
   notary key fails validation in every release job, so all macOS artifacts
   ship signed-but-unnotarized and Gatekeeper quarantines the downloaded
   .apps. **Operator action: rotate the notary key** (`APPLE_NOTARY_KEY_*`
   secrets; see docs/RELEASING.md § Code signing). Until then `latest.json`
   now tells the truth (`signed:false` for unnotarized apps) and the
   fresh-install smoke warns instead of shipping the lie.
2. **The SDK's documented install is dead.** docs/sdk.md says `npm install
   port-daddy` but npm publishing was retired 2026-07-04 with the registry
   stale since 3.15.0. Either `npm deprecate` the package and rewrite
   docs/sdk.md around a brew-installed import path, or revive the npm publish
   with a working token inside release.yml. Don't leave the doc pointing at a
   stale package.
3. **FleetBar/pd-console are not brew-installable.** A `brew install --cask
   port-daddy-fleetbar` cask in the same tap is the obvious consolidation once
   notarization works (casks of quarantined apps are a support nightmare).
4. **The Chrome extension is pre-release by design** — absorption into
   pd-console is the plan of record; don't build a Web Store pipeline for it.
5. **Operator machines still upgrade by hand** (`brew upgrade port-daddy &&
   brew services restart port-daddy`). The train makes fresh versions exist;
   it cannot reach into a laptop. `pd doctor` flags a stale daemon vs the
   `latest.json` feed.
