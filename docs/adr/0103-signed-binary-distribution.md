# 0103. Signed Binary Distribution and Open Content Releases

## Status

PROPOSED — 2026-05-06

## Context

Today Port Daddy is distributed as a TypeScript checkout that runs through `tsx`/`node`. The shipping and update story is a stack of workarounds:

- `pd` is an npm `bin` entry pointing at `bin/port-daddy-cli.ts`, parsed via `tsx` at every invocation.
- The daemon runs from `~/port-daddy-stable/` via `npm link`, because linking from `~/coding/port-daddy/` would make every uncommitted edit live. This "stable worktree" exists purely as a stability gate against `npm link`'s source-following behavior.
- `promote-stable.sh` is a 250-line script that gates dev → stable behind a test pass + version bump + native rebuild + `npm install` + `npm link` + daemon restart, and writes `LaunchAgent` plists pointing at `node /Users/<user>/port-daddy-stable/server.ts`.
- The `port-daddy` npm package conflates four artifacts (daemon, CLI, MCP server, JS SDK) into one tarball. Latest published is **3.3.0** while local is **3.12.0** — publishing has drifted because the artifact is too coupled to keep current.
- `better-sqlite3` ABI rebuilds repeatedly burn agents (memory entry `feedback_briefing_first_always.md`).
- FleetBar already ships as a notarized Developer ID `.app` via brew cask (macOS only).

Apple notarization for Curiositech LLC (`P5H9P59X2M`) is fully wired: Developer ID Application cert valid through Feb 2027, `notarytool` keychain profile `port-daddy-notary` validated, full sign+notarize+staple pipeline in `scripts/package-fleetbar-preview.sh`. Pipeline proven against FleetBar (submission `7b440e08-…` Accepted 2026-04-29) and against spike-built CLI binaries during the work that produced this ADR.

Linux and Windows users are next on the runway. EV codesigning for Windows is a confirmed go-from-day-one decision (2026-05-05).

The daemon also **serves content** (skills, examples, tutorials, dashboard HTML, OpenAPI spec, schemas, generated assets) that other agents and the website consume independently of any local binary install. That content needs an open release channel separate from the platform binary.

## Decision

Move Port Daddy to a **signed binary distribution for code** plus an **open multi-channel release for content**, built on Bun's compile target and a single repo source-of-truth. Each runtime artifact ships as its own per-platform binary; each language SDK ships as its own package; content ships independently via tarball, npm, and CDN. Kill the `~/port-daddy-stable` worktree and the `npm link` install path entirely.

### Two release surfaces

| Surface | What's in it | How it ships | Cadence |
|---|---|---|---|
| **Code** | daemon, CLI, MCP server, FleetBar | Signed binaries → brew / winget / GitHub Releases | Versioned with daemon SemVer; releases gated by CI test pass + signing |
| **Content** | skills, examples, tutorials, dashboard HTML, OpenAPI spec, schemas, generated assets | Public + open. GitHub Releases tarball, npm `@port-daddy/skill`, CDN | Versioned independently (`content-x.y.z`); can ship faster than binary |

Both come from the same repo and the same release tag, but they're different artifacts with different consumers.

### Distribution shape (code surface)

| Artifact | Today | Tomorrow |
|---|---|---|
| Daemon | npm tarball + `node server.ts` | Signed Mach-O / signed PE / Linux ELF via channel-specific package |
| CLI (`pd`) | npm bin + `tsx` | Same — signed binary per platform |
| MCP server | npm tarball + `node mcp/server.ts` | Same — signed binary per platform |
| FleetBar.app | brew cask (macOS only) | Unchanged (macOS-specific) |
| TS/JS SDK | `port-daddy/client` export bundled with daemon | **Separate** `@port-daddy/client` npm package |
| Native SDKs (Swift / Rust / Python) | None | First-class — SwiftPM, crates.io, PyPI |

### Distribution shape (content surface)

The daemon serves authoritative live content over HTTP. The same content also publishes to open channels for consumers who don't have a daemon, or who want the latest without waiting for a binary release.

| Channel | URL pattern | Audience |
|---|---|---|
| **Daemon HTTP** (live, embedded snapshot) | `GET http://127.0.0.1:9876/content/skills/<name>/SKILL.md` | Agents talking to a local daemon. Authoritative. Always available offline. |
| **Daemon HTTP** (live, optional CDN proxy) | Same URL, `PORT_DADDY_CONTENT_PROXY=cdn` env | Agents that want the latest content without a binary upgrade |
| **GitHub Release tarball** | `port-daddy-content-1.4.2.tar.gz` | CI, scripts, anyone with `curl` and no daemon |
| **npm `@port-daddy/skill`** | `import skill from '@port-daddy/skill/SKILL.md?raw'` (with subpath exports) | JS/TS consumers wanting skills + examples without HTTP |
| **CDN URL** | `https://content.port-daddy.dev/v1/skills/<name>/SKILL.md` | Website, third-party docs sites, agents without a local daemon |

The CDN sits on Cloudflare R2 + Workers, backed by the same content tarball that lands in GitHub Releases. R2 storage is ~$0.015/GB/month, Workers free tier covers the foreseeable read volume.

### Versioning model

- **Code**: `daemon@3.x.y`, `cli@3.x.y`, `mcp@3.x.y` — synced because they share the wire protocol implementation. Released together.
- **Content**: `content@1.x.y` — independent. The daemon snapshot at any code version is pinned to a specific content baseline (e.g. daemon 3.13.0 ships with content 1.4.2 baked in). Newer content can be picked up via the CDN proxy without a binary upgrade.
- **JS SDK**: `@port-daddy/client@1.x.y` — pinned to a wire-protocol version, not a daemon implementation version. Daemon 3.x and 4.x can both expose protocol v1; SDK 1.x speaks v1 against either.
- **Skill content npm package**: `@port-daddy/skill@1.x.y` — tracks the content version. Republished on every content release.

`GET /version` from the daemon returns the full picture:

```json
{
  "daemon": "3.13.0",
  "protocol": ["v1", "v2"],
  "content": { "version": "1.4.2", "channel": "embedded" }
}
```

`channel` flips to `"proxy"` when the CDN proxy is enabled.

### Compilation (code surface)

`bun build --compile --target=<triple>` for daemon / CLI / MCP. Bun supports the targets we need: `bun-darwin-arm64`, `bun-darwin-x64`, `bun-linux-x64`, `bun-linux-arm64`, `bun-windows-x64`.

Spike results (macOS arm64):

| Artifact | Compile | Sign | Notarize | Functional |
|---|---|---|---|---|
| `pd` CLI (61 MB) | OK 110 ms | OK Curiositech LLC | OK submission `503ff7ae-…` Accepted | OK `pd status` against live daemon |
| `pd-mcp` MCP server (60 MB) | OK 161 ms | OK same cert + entitlements | OK submission `e10f290c-…` Accepted | OK JSON-RPC `initialize` + `tools/list` |
| `pd-daemon` (65 MB) | OK 161 ms | not yet | not yet | BLOCKED — see below |

### Blockers for the daemon (all platforms)

Two distinct issues, both fixable, both platform-agnostic:

1. **`__dirname` resolves to Bun's read-only virtual fs.** `winston.transports.File` in `server.ts:147-164` joins `__dirname` with log filenames. Inside a compiled binary, that path is `/$bunfs/root/`, which is read-only. Fix: resolve log paths against a runtime-writable directory (`$PORT_DADDY_PREFIX/logs/`, falling back to `$HOME/.port-daddy/logs/` on Unix or `%LOCALAPPDATA%\port-daddy\logs\` on Windows).
2. **`better-sqlite3` cannot find its native binding inside the virtual fs.** The `bindings` package walks parent directories looking for `package.json` to anchor `build/Release/better_sqlite3.node` lookup. The virtual fs has no `package.json` to walk to. Fix: see SQLite migration below.

### SQLite migration

Replace `better-sqlite3` with **`bun:sqlite`** (Bun's built-in SQLite, compiled into the Bun runtime). Bun ships `bun:sqlite` on every supported target, so this fix lands the daemon on macOS, Linux, and Windows simultaneously. API is compatible for the operations Port Daddy uses (`new Database`, `.exec`, `.prepare`, `.run`, `.all`, `.get`, `.transaction`). Verified during the spike with a one-liner that opened an in-memory database, created a table, inserted a row, and read it back — the result was `[ { x: 42 } ]`.

Scope: `lib/db.ts` and direct call sites in `lib/messaging.ts`, `lib/resurrection.ts`, `lib/webhooks.ts`, `lib/episodic-memory.ts`, `lib/projects.ts`, `lib/shipwright/skill-index.ts`. Most use the `import type Database from 'better-sqlite3'` pattern, so type-only imports are erased at compile — only the **value** imports in `lib/db.ts` and `lib/shipwright/skill-index.ts` need to change.

Tests run under Node and need an adapter. Two options:

- **Adapter module** (`lib/sqlite-runtime.ts`) that re-exports `Database` from `bun:sqlite` when running under Bun and from `better-sqlite3` otherwise. Modules import from this module instead of either backend directly.
- **Migrate tests to Bun.** Larger move but eliminates the dual-runtime surface entirely. Bun's test runner is API-compatible with Jest at the level Port Daddy uses; risk is in `tests/setup-unit.js` and `tests/helpers/ephemeral-daemon.js`.

Recommendation: **adapter first**, Bun-test migration as a follow-up if the dual-runtime surface starts costing more than it saves.

## Open content distribution (the second surface)

### Source of truth

A single set of paths in the repo:

- `skills/` — port-daddy-agent-skill and any future first-party skills.
- `examples/` — runnable example scripts and tutorial walkthroughs.
- `docs/recipes/` — how-to docs that the dashboard embeds.
- `public/` — dashboard HTML/CSS/JS plus generated assets (recordings, screenshots).
- `schemas/` — JSON schemas for coordination notes, handoffs, validation reports.
- `mcp/openapi.json` (planned, not yet shipped) — generated OpenAPI spec for the daemon's HTTP surface.

These are checked into git, versioned alongside code, but published on a separate cadence.

### How content gets out

A `content-release.yml` CI workflow runs on every push to `main` AND can be manually triggered. It:

1. Computes the next content version (SemVer based on git-tag-driven Conventional Commits or manual bump).
2. Builds a content tarball: `tar -czf port-daddy-content-1.4.2.tar.gz skills/ examples/ docs/recipes/ public/ schemas/ mcp/openapi.json`.
3. Uploads the tarball to GitHub Releases with tag `content-1.4.2`.
4. Publishes `@port-daddy/skill@1.4.2` to npm with `exports` declarations for each subpath:
   ```json
   {
     "exports": {
       "./SKILL.md": "./skills/port-daddy-agent-skill/SKILL.md",
       "./examples/*": "./examples/*",
       "./schemas/*": "./schemas/*"
     }
   }
   ```
5. Mirrors content to Cloudflare R2 under `content/v1/<version>/...` with a `content/v1/latest/...` alias updated atomically at the end.
6. Invalidates the CDN edge cache for `content.port-daddy.dev/v1/latest/*`.

### How the daemon serves content

The daemon ships with an embedded snapshot of the content version it was built against. Bun's virtual fs is read-only but readable — `bun build --compile` bundles `skills/`, `examples/`, `public/`, etc. as static assets, and the daemon serves them via Fastify static plugins.

```
GET /content/skills/port-daddy-agent-skill/SKILL.md  → embedded
GET /content/examples/08-launchd-respawn-window.md   → embedded
GET /content/openapi.json                            → embedded
GET /                                                 → public/index.html
```

When `PORT_DADDY_CONTENT_PROXY=cdn` is set, the daemon proxies `/content/*` requests to `https://content.port-daddy.dev/v1/latest/*` with a 5-minute edge cache, falling back to the embedded snapshot on CDN failure. Operators who want bleeding-edge content opt in; everyone else gets the frozen snapshot they signed up for.

### Dashboard specifically

`public/index.html` and its assets are content. For v1 they're bundled in the binary (frozen at compile time), served from `GET /`. For "ship a dashboard fix without cutting a binary release" we add a `PORT_DADDY_DASHBOARD_URL` env that, when set, redirects `GET /` to an external dashboard origin (e.g. `https://dashboard.port-daddy.dev/`). Same backing R2 bucket, separate path.

## Per-platform signing & distribution (code surface)

### macOS

- **Signing**: Developer ID Application cert (`Curiositech LLC, P5H9P59X2M`), already in keychain. Hardened runtime + secure timestamp.
- **JIT entitlements** (required for Bun's V8 — discovered when first signed binary aborted with `Ran out of executable memory while allocating 128 bytes`):
  ```xml
  <dict>
    <key>com.apple.security.cs.allow-jit</key><true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
    <key>com.apple.security.cs.disable-library-validation</key><true/>
  </dict>
  ```
- **Notarization**: `xcrun notarytool submit … --keychain-profile port-daddy-notary --wait`. Apple processes in 4–7 minutes. Stapling applies to `.app`/`.pkg`/`.dmg` only; raw Mach-O CLI binaries rely on Apple's online ticket lookup (Gatekeeper accepts via `spctl --type install`).
- **Distribution**: brew formula bottle from custom tap `curiositech/homebrew-tap`; brew cask for FleetBar.
- **Install**: brew formula bottles the three signed Mach-Os under `bin/`, embeds the content snapshot under `share/port-daddy/`, registers daemon as a `service` so `brew services start port-daddy` works.

### Linux

- **Signing**: not required for execution. Linux distros enforce package signatures, not binary signatures. Tarballs ship with detached GPG `.asc` files.
- **Distribution**: Homebrew on Linux (same formula), GitHub Releases tarball, optional `.deb`/`.rpm` via `nfpm` when a real user asks. Sandboxed snap/flatpak out of scope.
- **Service**: `systemd --user` unit. `systemctl --user enable --now port-daddy.service`.
- **Paths**: install to `/opt/port-daddy/`, runtime data at `~/.port-daddy/` (matches macOS).

### Windows

- **Signing**: **EV cert from day one** — confirmed 2026-05-05. ~$300–$600/yr from Sectigo/DigiCert/SSL.com, hardware token (USB HSM or Azure Key Vault). Immediate SmartScreen reputation, no warning on first launch. Same Curiositech LLC entity as the Apple cert. OV alternative was considered and rejected (would require building reputation through hundreds of downloads first).
- **Signing tool**: `signtool sign /tr http://timestamp.sectigo.com /fd sha256 /td sha256 /a port-daddy.exe`. Timestamping is mandatory.
- **Distribution**: `winget install Curiositech.PortDaddy` (first-party, ships with Windows 11), `scoop` (developer-friendly), GitHub Release `.zip`. Optional `chocolatey` later.
- **Service**: Windows Service via `sc.exe create PortDaddy …` for production; Run-key registry entry for early users.
- **Paths**: install to `%PROGRAMFILES%\PortDaddy\` or `%LOCALAPPDATA%\Programs\PortDaddy\`. Runtime data at `%LOCALAPPDATA%\port-daddy\` (mirrors `~/.port-daddy/` Unix convention).
- **IPC concession**: Bun doesn't currently support named pipes. The daemon binds TCP-only on `127.0.0.1` on Windows. CLI discovery already handles socket-missing → TCP fallback; that path becomes the default on Windows.

### Per-platform code that may need to change

| Concern | Today | Tomorrow |
|---|---|---|
| Default runtime dir | `~/.port-daddy/` (Unix) | `~/.port-daddy/` Unix, `%LOCALAPPDATA%\port-daddy\` Windows. Single `getRuntimeDir()` helper. |
| IPC transport | Unix domain socket | Same on Unix; TCP-only on `127.0.0.1` on Windows. |
| Service registration | `LaunchAgent` plist | `LaunchAgent` (macOS), `systemd --user` unit (Linux), Windows Service or Run-key (Windows). One file per OS, generated by `pd install`. |
| Path separators | `path.join` everywhere | No change; existing code already uses `node:path`. |
| Shell completion | bash/zsh/fish | Same on Unix; PowerShell completion via `Register-ArgumentCompleter`. |
| Log location | `__dirname/logs/` | `$PORT_DADDY_PREFIX/logs/` with per-OS fallback. |
| Content paths | `skills/` from cwd | `getContentRoot()` resolves to the embedded snapshot or the CDN proxy. |

## What goes away

- `~/port-daddy-stable/` worktree.
- `npm link` from anywhere in the install story.
- The "NEVER `npm link` from `~/coding/port-daddy`" footgun in CLAUDE.md.
- `scripts/promote-stable.sh`'s "merge main → stable, npm install, npm link, restart daemon" dance. Test gate moves to CI; the artifact CI emits is a signed bottle (or per-platform package). <!-- cite-exempt: local operator script, retired by this ADR — not a repo file -->
- `better-sqlite3`'s ABI rebuild class of failures (after SQLite migration).
- The 9-version drift between local (3.12.x) and npm (3.3.0) for the monolithic `port-daddy` package, by virtue of splitting it.
- The "agents must read SKILL.md from a specific path on disk" coupling. After this ADR, any agent can fetch from `/content/skills/...` against any reachable daemon, or pull from the CDN, or import from npm — the daemon is no longer the only source.

## SDK split

The TS/JS SDK (`port-daddy/client`) becomes its own npm package `@port-daddy/client`. ~200 KB, zero native deps, browser-friendly. Pinned to a **wire-protocol version**, not a daemon implementation version, which lets daemon and SDK release independently.

Native SDK targets follow:

- **Swift** — `PortDaddyKit.xcframework` via Swift Package Manager. Code-signed with the same Curiositech cert so consuming apps don't break their own notarization.
- **Rust** — `port-daddy-client` crate to crates.io.
- **Python** — `port-daddy-client` wheel to PyPI. Pure-Python, `httpx`-based.

The unscoped `port-daddy` npm name itself is either deprecated or repointed to a meta-package whose `postinstall` prints "install via brew / winget / your-distro-package-manager".

## Release pipeline

Each artifact gets its own CI workflow on its own cadence:

**Code surface** (per-platform matrix):
- `daemon-release.yml` — matrix `[macos-arm64, macos-x64, linux-x64, linux-arm64, windows-x64]`. Each entry: `bun build --compile`, codesign for that platform, upload artifact. Aggregate job publishes brew bottle, GitHub Release tarballs, winget/scoop manifest PRs.
- `cli-release.yml` — same matrix, same flow.
- `mcp-release.yml` — same (or fold into daemon bottle).

**Content surface** (single workflow, multi-channel publish):
- `content-release.yml` — tarball → GitHub Release → npm `@port-daddy/skill` → R2 mirror → CDN cache invalidate.

**SDK surface** (one workflow per target language):
- `sdk-js-release.yml` — `tsc -p packages/client-js` → `npm publish @port-daddy/client`.
- `sdk-swift-release.yml` — macOS only; `xcodebuild -create-xcframework` → SwiftPM tag.
- `sdk-rust-release.yml` — `cargo publish`.
- `sdk-python-release.yml` — `python -m build` → `twine upload`.

CI secrets:
- **macOS**: App Store Connect API key for headless notarization. Local `port-daddy-notary` keychain profile remains for ad-hoc developer releases.
- **Windows**: signing cert in Azure Key Vault. Use `AzureSignTool` for HSM-backed signing.
- **Linux**: GPG private key for tarball signing.
- **CDN**: Cloudflare R2 access keys + Workers deploy token.

## Consequences

### Positive

- **One install command per platform** — `brew install port-daddy` on macOS/Linux, `winget install Curiositech.PortDaddy` on Windows.
- **No Node/npm on user machines.** Users without a JS toolchain can adopt Port Daddy.
- **Reproducible builds.** Signed binary CI emits is bit-for-bit what users run.
- **Cold start is faster.** Compiled binary loads in milliseconds vs. `tsx` parsing 50+ TS files.
- **Auto-update.** `brew upgrade` / `winget upgrade` / `apt upgrade` replaces `git pull` + `promote-stable.sh` + restart.
- **Decoupled SDK cadence.** Daemon refactors don't drag SDK consumers; SDK ergonomic fixes don't need a daemon release.
- **Decoupled content cadence.** Skill/example/dashboard updates ship via CDN without waiting for a binary release. Operators choose embedded-snapshot vs. CDN-proxy stance.
- **Content is independently consumable.** The website, third-party docs sites, and agents-without-a-daemon can all pull from the same source without running Port Daddy locally.
- **`better-sqlite3` ABI failure mode disappears** (after SQLite migration).
- **Linux and Windows users land at the same time as macOS** rather than as a v2 retrofit.

### Negative

- **Native consumers (Swift, Rust, Python) become first-class** — each needs its own CI pipeline and version. Initial cost is real.
- **Two SQLite backends in the codebase** during the adapter phase. One indirection layer until tests migrate to Bun.
- **JIT entitlements** widen the macOS attack surface slightly compared to a fully sealed binary; mitigated by hardened runtime + secure timestamp + Apple notarization.
- **Dropping the npm `port-daddy` install path** breaks any existing consumer that runs `npm install -g port-daddy`. Migration message ships in the deprecated package's `postinstall`.
- **Windows EV codesigning**: ~$300–$600/yr ongoing + initial HSM/Key Vault setup.
- **Windows IPC fallback to TCP-only** until Bun supports named pipes natively. Not a blocker; CLI discovery already handles fallback.
- **CDN ops surface**: Cloudflare R2 bucket + Workers + a content-release CI workflow are new infrastructure to maintain. Mitigated by the workflow being one file and R2 being cheap.
- **Two version namespaces** (daemon SemVer + content SemVer) to communicate to users. Mitigated by the daemon's `/version` endpoint reporting both.

### Neutral

- **FleetBar.app remains macOS-only** — SwiftUI menu bar app, not portable. Linux/Windows users get the dashboard via the existing web UI, which the daemon already serves.

## Implementation Plan

1. **bun:sqlite adapter** (`lib/sqlite-runtime.ts`). Replace value imports of `better-sqlite3` in `lib/db.ts` and `lib/shipwright/skill-index.ts`. Keep type imports as-is. Verify `npm test` still passes under Node.
2. **Winston log path fix** (`server.ts:147-164`). Resolve filenames against `$PORT_DADDY_PREFIX/logs/` with a per-OS runtime-writable fallback.
3. **Content-root abstraction** (`lib/content-root.ts`, proposed). Resolves `skills/`, `examples/`, `public/`, `schemas/` paths to either the embedded snapshot or the configured CDN proxy. Daemon's static-serving plugins use this helper.
4. **Compile + sign + notarize the daemon on macOS arm64.** Confirm it boots, hits `/health`, accepts CLI traffic, serves `/content/skills/...` from the embedded snapshot, registers as a brew service.
5. **Brew formula update** (macOS arm64 + x64). Bottle the three Mach-Os; add the daemon as a `service` block; install content snapshot to `pkgshare`.
6. **Linux build matrix.** `bun-linux-x64` and `bun-linux-arm64` compile; GitHub Release tarballs; systemd-user unit; brew-on-Linux formula entry.
7. **Windows EV signing and build.** Acquire EV cert + Azure Key Vault setup. Build `bun-windows-x64` binary; sign via `AzureSignTool`; ship via `winget` manifest PR + GitHub Release `.zip`.
8. **Content release pipeline** (`.github/workflows/content-release.yml`). Tarball → GitHub Release → npm `@port-daddy/skill` → R2 mirror → CDN invalidate. Set up `content.port-daddy.dev` Cloudflare Worker.
9. **SDK split.** Extract `lib/client.ts` and types into `packages/client-js/`. Publish `@port-daddy/client@0.1.0`.
10. **Deprecate the monolithic npm package.** `postinstall` prints migration message naming the right channel for the user's OS.
11. **Kill `~/port-daddy-stable`** and `scripts/promote-stable.sh` (replaced by CI). <!-- cite-exempt: retired local script, not a repo file -->
12. **Native SDKs** (Swift, Rust, Python) on demand — each is its own project once a real consumer exists.

Steps 1–4 unlock the macOS daemon. Step 5 lands macOS distribution. Step 6 lands Linux (cheap — no signing infrastructure). Step 7 lands Windows (signed from day one). Step 8 lands the open content channel. Steps 9–11 retire legacy npm install. Step 12 is open-ended.

## References

- ADR-0024 (Daemon Profiles) — establishes that the daemon already has multiple runtime configurations.
- `scripts/package-fleetbar-preview.sh` — the proven sign+notarize+staple pipeline this ADR generalizes.
- Spike artifacts: `/tmp/pd-bun-spike/pd` (notarized CLI), `/tmp/pd-bun-spike/pd-mcp` (notarized MCP), `/tmp/pd-bun-spike/pd-daemon` (compiled, blocked on the two issues documented above).
- Memory entries: `feedback_briefing_first_always.md` (better-sqlite3 ABI rebuild incident), Standing Policy: Always-On Daemon in CLAUDE.md.
- Bun targets: <https://bun.sh/docs/bundler/executables#supported-targets>
- Microsoft EV cert reputation rules: applies to user-mode apps via the same SmartScreen reputation system used for drivers.
- `nfpm` for `.deb`/`.rpm`: <https://nfpm.goreleaser.com/>
- Cloudflare R2 pricing: <https://developers.cloudflare.com/r2/pricing/>
