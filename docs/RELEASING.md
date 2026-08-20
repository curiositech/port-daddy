# Releasing Port Daddy

Three workflows live here. They share the same coordination shape — Port Daddy session, file claims, scoped notes — and diverge on how far the bits travel.

1. **[Public release](#1-public-release)** — `v3.14.0` → users on `brew upgrade port-daddy`.
2. **[Candidate or hotfix build](#2-candidate-or-hotfix-build)** — `v3.14.1-rc.1` → smoke-test before promoting.
3. **[Local feature dev](#3-local-feature-dev)** — worktree work, binary smoke-test, PR. No release.

See [`VERSIONING.md`](VERSIONING.md) for semver policy and the canonical list of version surfaces. See [`adr/0028-signed-binary-distribution.md`](adr/0028-signed-binary-distribution.md) for why the binary distribution flow looks the way it does.

---

## 1. Public release

**The release train does this for you.** `.github/workflows/release-train.yml`
runs Mondays + Thursdays: it measures unreleased daemon-surface commits, runs
the formula-compat preflight (`scripts/check-formula-compat.mjs` — the tap
formula must accept the tarball layout release.yml will produce), opens a
version-bump PR with every version surface synced and the CHANGELOG stamped,
auto-merges it on green, then tags and publishes the Release. To pause it,
open an issue titled `Release train: hold`; to force a cut now, dispatch the
workflow. The manual recipe below remains the fallback when the train can't
run (and for major bumps, which stay human).

The release boundary is a git tag plus a GitHub Release. The workflow `.github/workflows/release.yml` builds notarized binaries from the tagged commit — soaking the exact packaged binary for 180s, running `pd batten verify` and the formula-compat preflight before sealing anything — and automatically dispatches to `curiositech/homebrew-tap` to roll the formula. After publish, `.github/workflows/fresh-install.yml` smokes the published artifacts AND the literal `brew install` path on pristine runners, and files an issue if either fails.

**npm distribution is retired** (2026-07-04, operator decision): brew, the release binaries, and `latest.json` cover every supported install path; the npm token had been dead since 3.15.0 so the registry was eight releases stale anyway. `.github/workflows/publish.yml` remains as the manual path if npm is ever revived — if so, `npm deprecate` the stale versions first.

### Recipe

```bash
# A. Worktree off origin/main — pd refuses the main checkout by default
git fetch origin
git worktree add ../pd-release-3.15.0 -b chore/release-3.15.0 origin/main
cd ../pd-release-3.15.0

# B. PD session
pd begin --identity port-daddy:release-3.15.0 \
  --lifecycle durable \
  --purpose "Cut 3.15.0: <one-line headline>"
pd note "Scope: version surfaces + CHANGELOG. Validation: binary builds + distribution-freshness test."
pd session files add package.json package-lock.json mcp-server.json \
  .claude-plugin/plugin.json .gemini/extensions/port-daddy/gemini-extension.json \
  mcp/server.ts website-v2/src/data/referenceCatalog.ts CHANGELOG.md

# C. Bump
npm version minor --no-git-tag-version       # patch / minor / major
npx tsx scripts/sync-version.ts              # syncs EVERY version surface
#
# sync-version.ts now stamps all of them — the JSON manifests AND mcp/server.ts
# (MCP version), server.ts (EMBEDDED_PACKAGE_VERSION bun-bundle fallback), and
# website-v2/src/data/referenceCatalog.ts (PORT_DADDY_VERSION). No hand-bumps.
# distribution-freshness.test.js fails CI if any surface drifts.

# D. CHANGELOG.md
# Rename [Unreleased] → [3.15.0] - YYYY-MM-DD, prepend a fresh [Unreleased].
$EDITOR CHANGELOG.md

# E. Validate locally
npm ci
npm run check:version-drift
npm test -- --runTestsByPath tests/unit/distribution-freshness.test.js
npm run build:daemon:dist                                  # → dist/daemon/port-daddy-daemon
bash scripts/smoke-compiled-daemon.sh
npm run build:bin                                          # → dist/port-daddy
node scripts/build-single-binary.mjs --outfile=dist/pd     # release workflow shape
./dist/port-daddy --version                                # reports 3.15.0
SOAK_SECONDS=180 SOAK_PORT=19876 bash scripts/soak-binary.sh dist/port-daddy

# F. PR
pd guard check --staged
git add <explicit paths>
git commit -m "chore(release): bump to 3.15.0"
git push -u origin chore/release-3.15.0
gh pr create --title "chore(release): bump to 3.15.0" --body-file .scratch/pr-body.md
# wait for CI green, address review, then:
gh pr merge --squash --delete-branch

# G. Tag the merged commit on main
git fetch origin
git checkout main && git pull --ff-only
git tag -a v3.15.0 -m "Port Daddy 3.15.0 — <headline>"
git push origin v3.15.0

# H. GitHub Release → triggers release.yml
gh release create v3.15.0 --generate-notes --title "v3.15.0 — <headline>"

# I. Babysit the binary build
gh run watch $(gh run list --workflow=release.yml --limit 1 --json databaseId --jq '.[0].databaseId')
#
# Confirm the daemon/CLI binaries land on the release:
#   pd-darwin-arm64.tar.gz
#   pd-linux-x64.tar.gz
# plus the FleetBar preview .zip and pd-console artifact.

# J. Brew tap rolls automatically via release.yml → update-homebrew job.
#    If it failed (e.g. after a manual workflow_dispatch re-run), dispatch it:
pd lock release-publish
gh api repos/curiositech/homebrew-tap/dispatches \
  --input - <<JSON
{"event_type":"update-formula","client_payload":{"version":"v3.15.0"}}
JSON
# wait for update-formula.yml to commit to curiositech/homebrew-tap
pd release release-publish

# K. Verify users can actually upgrade
brew update && brew upgrade port-daddy
brew services restart port-daddy
/opt/homebrew/bin/pd --version                            # reports 3.15.0
/opt/homebrew/bin/pd status                               # daemon reports 3.15.0
/opt/homebrew/bin/pd doctor --json                        # supervision + crash checks are not critical

# L. Close
pd note "Result: v3.15.0 cut. Validation: <release URL>. Brew: <tap PR URL>."
pd done "v3.15.0 shipped"
```

### Known failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `Could not resolve: "@clack/prompts"` (and friends) in `release.yml` | Workflow ran `bun build --compile` without first running `bun install`. `node_modules` empty in the checkout. | `release.yml` must have a `bun install` step between `setup-bun` and `bun build`. Validated in the workflow today. |
| `distribution-freshness.test.js` fails with `Expected: "3.15.0" / Received: "3.14.0"` | A version surface drifted — usually you forgot to run `sync-version.ts` after `npm version`. | Run `npx tsx scripts/sync-version.ts` (it stamps every surface, incl. `mcp/server.ts` + `referenceCatalog.ts`), restage, recommit. |
| Tag pushed but `release.yml` didn't fire | Tag push alone doesn't fire release.yml — only the GitHub *Release* event does. | `gh release create v<x.y.z> --generate-notes`. |
| Release created but binaries missing | release.yml failed; check `gh run view --log-failed`. | Fix workflow, re-run via `gh workflow run release.yml --ref v<x.y.z>` (works because workflow_dispatch is also enabled). |
| `brew upgrade port-daddy` still serves the old version | The `update-homebrew` job in `release.yml` hasn't run or failed (common after a `workflow_dispatch` re-run, which skips that job). | Manually dispatch: `gh api repos/curiositech/homebrew-tap/dispatches --input - <<<'{"event_type":"update-formula","client_payload":{"version":"vX.Y.Z"}}'`. Until the commit lands in the tap, the bottle URL points at the previous release. |

---

### Code signing (Apple Developer ID)

Every macOS artifact `release.yml` produces is signed with the **Developer ID
Application: Curiositech LLC (P5H9P59X2M)** identity, and notarized + stapled by
Apple — the daemon (`pd` + `port-daddy`), the `pd-console.app`, and FleetBar.
This is automatic on every release; **nothing to do per-release** once the secrets
below are set. (ADR-0057; the daemon path is ADR-0028's signing recipe, finally wired.)

**Repo secrets** (set once, in `Settings → Secrets and variables → Actions`):

| Secret | What it is | Required? |
|---|---|---|
| `APPLE_CERT_P12_BASE64` | base64 of the Developer ID Application `.p12` (cert **+ private key** — export from Keychain Access › *My Certificates*, which prompts for an export password) | **yes** — without it, binaries ship adhoc/unsigned |
| `APPLE_CERT_PASSWORD` | the `.p12` export password | **yes** |
| `APPLE_NOTARY_KEY_P8_BASE64` | base64 of the App Store Connect API `.p8` key (Users and Access › Integrations › App Store Connect API, role *Developer*) | optional — absent ⇒ signed but **not** notarized |
| `APPLE_NOTARY_KEY_ID` | the API Key ID (10 chars) | with the `.p8` |
| `APPLE_NOTARY_KEY_ISSUER` | the API Issuer ID (a UUID — note the top-of-page UUID, NOT the Key ID) | with the `.p8` |

**Graceful degradation:** the signing step is gated and fail-soft. No `APPLE_CERT_*`
⇒ the build still ships an (adhoc) binary with a `::warning::`. Notary creds present
but failing validation ⇒ the binary is **signed-only** with a warning, never a broken
release. So a rotated/expired notary key cannot block shipping a signed daemon.

**Verify it yourself** (no destructive release needed): the `_sign-smoke` pattern —
import the cert into a temp keychain, sign + notarize a trivial Mach-O — is how this
was validated end-to-end (2026-06-20). `xcrun notarytool store-credentials … ` failing
locally is the fastest way to catch a bad Key ID / Issuer / `.p8` triple.

---

## 2. Candidate or hotfix build

Same shape as a public release, two shortcuts:

```bash
# Patch bump (after a hotfix lands on main)
npm version patch --no-git-tag-version
npx tsx scripts/sync-version.ts

# Cut a PRERELEASE — does NOT trigger brew tap roll, candidates are opt-in
gh release create v3.14.1-rc.1 --prerelease --generate-notes --title "v3.14.1-rc.1"

# Download the candidate binary and exercise it
gh release download v3.14.1-rc.1 -p 'pd-darwin-arm64.tar.gz' -D .scratch/rc
cd .scratch/rc && tar -xzf pd-darwin-arm64.tar.gz
./pd --version                                             # 3.14.1
./pd status                                                # talks to whatever owns localhost:9876
./pd sitrep                                                # any deep command exercising HTTP

# Promote to a real v3.14.1 once you're happy
git tag -a v3.14.1 -m "Port Daddy 3.14.1 — <hotfix description>"
git push origin v3.14.1
gh release create v3.14.1 --generate-notes --title "v3.14.1 — <hotfix>"
# ... then babysit release.yml as in §1 step I/J (binaries + brew tap roll)
```

### Anti-pattern

Don't tag `v3.14.1` directly without an `-rc` first. The brew tap pull is irreversible — once a bad formula merges, every `brew upgrade port-daddy` ships the bad bottle until you cut another release.

---

## 3. Local feature dev

You're adding a daemon route, a CLI command, an MCP tool. No release involved — just merge to main, the next public release picks it up.

```bash
# A. Worktree off latest main
git fetch origin
git worktree add ../pd-feat-foo -b feat/foo origin/main
cd ../pd-feat-foo

# B. Session + scope note + claims
pd begin --identity port-daddy:feat-foo --purpose "Add <feature>" --lifecycle durable
pd note "Scope: <files>. Approach: <plan>. Validation: <commands>."
pd session files add <files...>

# C. Develop and run unit tests in source mode (fast)
npm test -- tests/unit/<area>.test.js

# D. Smoke-test the binaries — these are what users hit, not tsx server.ts
npm ci                                               # if not already
npm run build:daemon:dist                            # → dist/daemon/port-daddy-daemon
bash scripts/smoke-compiled-daemon.sh
npm run build:bin                                    # → dist/port-daddy

# Isolated test daemon on a claimed port so you don't clobber the canonical one
PORT=$(pd claim port-daddy-feat-foo-test -q)
SCRATCH=$(mktemp -d)
PORT_DADDY_PORT=$PORT \
  PORT_DADDY_DB="$SCRATCH/registry.db" \
  PORT_DADDY_PREFIX="$SCRATCH" \
  ./dist/daemon/port-daddy-daemon &
TEST_DAEMON_PID=$!

curl -sf "http://localhost:$PORT/your/new/route" | jq .
PORT_DADDY_URL="http://localhost:$PORT" ./dist/port-daddy <new-subcommand>

# Tear down
kill $TEST_DAEMON_PID
rm -rf "$SCRATCH"
pd release port-daddy-feat-foo-test

# E. If you need launchd behavior, use a dev berth or a disposable LaunchAgent.
# Do not hot-swap the stable Homebrew daemon for feature work.
pd dev up --from "$(git branch --show-current)" --label feat-foo
eval "$(pd use feat-foo)"
pd status
eval "$(pd use stable)"
pd dev down feat-foo

# F. Standard PR flow
pd guard check --staged
git push -u origin feat/foo
gh pr create ...
# CI green, review, merge

# G. Close
pd done "<feature> shipped to main via PR #N"
```

### The bright lines

- **`lib/`, `routes/`, `server.ts`, `mcp/` changes → require a binary smoke-test** (step D). Source-mode `tsx server.ts` lies about what users actually run — module resolution, dependency boundaries, and the CSP all behave differently in the compiled binary.
- **Workflow files (`.github/workflows/*`) → can only be validated by actually running CI.** Dispatch on a feature branch before relying on them in a release path. PR #75 (`bun install` missing from `release.yml`) bit us specifically because nobody dry-ran the workflow before tagging.
- **Brew tap changes → serialized by `pd lock release-publish`.** Always.

---

## How agents and you coordinate this through PD

Not decoration — these primitives matter:

| Signal | When to use it |
|---|---|
| `pd begin --identity port-daddy:<work> --lifecycle durable` | Always. Session is the atomic unit of "who's editing what". |
| `pd session files add <path>` | Before any edit. Advisory, but visible to other agents via `pd sessions --all-worktrees`. |
| `pd lock release-publish` | **Only for §1 step J** (manual Homebrew-tap `repository_dispatch`, used when `release.yml`'s automatic roll fails). Brew formula is shared state; two agents racing here = duplicate PRs to the tap. Hold the lock until the tap PR merges. |
| `pd note "..."` | Scope notes, milestones, blockers. Use `pd say --pin` for cross-session truths (`"3.15.0 binaries published"`). |
| `pd pub promotion:release-surfaces` | Manual fire of the channel that `pd-fleet.yml`'s documentarian listens on. After a release, this kicks the docs-review fleet. |
| `pd claim <port-name> -q` | For isolated test daemons in worktrees. Don't hardcode ports. |
| `pd guard check --staged` | Before every commit. Coordination Guard is in enforce mode here. |
| Worktree-by-default | `pd begin` refuses the main worktree. `--allow-main-worktree` is the explicit override for §1 step G (tagging) and only that. |

### Cross-agent signaling for releases

Releases are multi-agent by design — Documentarian wants to scan release surfaces, Lookout wants to spot drift, Cartographer wants to update the roadmap.

After §1 step H lands a release:

```bash
pd pub promotion:release-surfaces "$(cat <<JSON
{"version": "v3.15.0", "tag_sha": "$(git rev-parse v3.15.0)",
 "release_url": "https://github.com/curiositech/port-daddy/releases/tag/v3.15.0",
 "changed_files": $(git diff --name-only "$(git describe --tags --abbrev=0 HEAD^)..v3.15.0" | jq -R . | jq -s .)}
JSON
)"
```

Subscribers (per `pd-fleet.yml`):
- `documentarian` reviews docs/CHANGELOG/README/website/tutorials/skill bundles against the diff
- Future: `lookout` runs the release-surface drift audit

If those fleet agents are not running, the channel is still durable — they pick it up on next start. You can also `pd actor message documentarian "Release v3.15.0 cut — please scan surfaces"` for explicit handoff.

---

## Migrating off the stable worktree (one-time, per machine)

Pre-ADR-0028 machines have:

- `~/port-daddy-stable/` — a full checkout that the canonical daemon serves from
- `~/Library/LaunchAgents/com.portdaddy.daemon.plist` — points `tsx server.ts` at that checkout
- `~/.zshrc` aliases like `pdship` that promoted main → stable via `npm link`

The binary distribution makes all three obsolete. The migration only runs once per machine, and only after a successful binary release + brew tap roll:

```bash
# 0. Prerequisites: a tagged version has binaries attached on the GitHub
#    release, and the update-homebrew job has updated the tap. Verify:
gh release view v<X.Y.Z> | grep -E 'pd-darwin-arm64|pd-linux-x64'
gh api repos/curiositech/homebrew-tap/contents/Formula/port-daddy.rb \
  --jq '.content' | base64 -d | grep -E 'version|url'

# 1. Install the brew bottle
#    NOTE: tap name is curiositech/tap (repo = curiositech/homebrew-tap)
brew tap curiositech/tap
brew install port-daddy

# 2. Stop the old launchd-managed daemon
launchctl unload ~/Library/LaunchAgents/com.portdaddy.daemon.plist
rm ~/Library/LaunchAgents/com.portdaddy.daemon.plist

# 3. Start the new brew-managed daemon
brew services start port-daddy

# 4. Verify: should report the new version, new PID, new install dir
pd status

# 5. Scrub the shell config
$EDITOR ~/.zshrc       # remove `pdship` alias and any PATH/cd refs to port-daddy-stable

# 6. Now safe to delete the old checkout
rm -rf ~/port-daddy-stable
```

If `pd status` after step 4 still shows the old PID/version, the old daemon hasn't been killed. `pgrep -fl 'port-daddy-stable'` should be empty before you proceed.

## Picking up a brew formula change (env vars, run line, service block)

`brew services restart port-daddy` regenerates `~/Library/LaunchAgents/homebrew.mxcl.port-daddy.plist` on every invocation — but from the **installed keg under `Cellar/`**, not from the tap's current formula. `brew services` doesn't know about the tap. Service-block changes (`environment_variables`, `run [...]`, `keep_alive`, etc.) only land after `brew reinstall` pulls a new keg.

The trap: if you make a manual edit to the plist, `brew services restart` will silently overwrite it on the next restart (regenerated from the keg). If a tap PR updates the service block, `brew update && brew services restart` will *not* apply the change (keg unchanged, regenerated plist looks the same).

To pick up a tap service-block change locally:

```bash
brew update                                            # pull the tap's latest formula
brew services stop port-daddy
brew reinstall port-daddy                              # replace the keg
brew services start port-daddy                         # plist regenerates from the new keg
grep -A 1 EnvironmentVariables ~/Library/LaunchAgents/homebrew.mxcl.port-daddy.plist
```

`brew services restart` alone is enough for routine restarts and for binary changes that come with a normal `brew upgrade` (which replaces the keg). It is **not** enough when a tap PR changes the service block without a version bump — `brew update` won't pull a new keg for an unchanged version, so neither will `restart`.

A future `pd doctor` check should diff the live plist against the current formula spec and hint at `brew reinstall` on drift — tracked as roadmap item [`pd-doctor-detect-drift-between-live`](https://github.com/curiositech/port-daddy/issues?q=label%3Aroadmap+pd-doctor-detect-drift) (severity MEDIUM).

## See also

- [`VERSIONING.md`](VERSIONING.md) — semver policy + the canonical list of version surfaces
- [`adr/0028-signed-binary-distribution.md`](adr/0028-signed-binary-distribution.md) — why the flow looks like this
- [`AGENTS.md` § Release](../AGENTS.md) — short pointer for agents working in this repo
- [`skills/port-daddy-internal-dev/SKILL.md`](../skills/port-daddy-internal-dev/SKILL.md) — full contributor playbook
