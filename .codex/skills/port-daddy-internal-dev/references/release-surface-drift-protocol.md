# Release-Surface Drift Protocol

Port Daddy's reach across the user's machine is broad: CLI, daemon, MCP
server, FleetBar Mac app, Fleet Control Center web UI, marketing website,
SDK packages, Homebrew formula, and the skill bundle that ships to other
projects. Every public surface change MUST update every mirror in the
same coherent slice — or leave a Lookout drift report naming the gaps.

## The full surface list (in update order)

### Tier 1 — code

| Surface | Path | Updated when |
|---|---|---|
| Daemon core | `lib/`, `routes/` | API behavior changes |
| MCP server | `mcp/server.ts`, `mcp/tools/*` | MCP tool added/changed/removed |
| CLI | `bin/port-daddy-cli.ts` and `--help` strings | Command added/changed/renamed |
| FleetBar Mac app | `apps/FleetBar/` | UI/UX changes |
| Fleet Control Center | `website-v2/` console routes | UI/UX changes |
| Tests | `tests/unit/`, `tests/integration/` | Any code change |

### Tier 2 — contracts

| Surface | Path | Updated when |
|---|---|---|
| OpenAPI spec | `docs/openapi.yaml` | Daemon HTTP API changes |
| SDK reference | `docs/sdk.md` | SDK signature changes |
| MCP tool catalog | tool listings + handshake test | MCP tool change |
| Schemas | `schemas/*.schema.json` | Wire format change |

### Tier 3 — docs

| Surface | Path | Updated when |
|---|---|---|
| README | `README.md` | High-level positioning, install, quickstart |
| CHANGELOG | `CHANGELOG.md` | Every release |
| Website /docs/cli | `website-v2/src/pages/docs/cli/*` | CLI surface change (every command must have a detail page) |
| Website /docs/api | `website-v2/src/pages/docs/api/*` | API surface change |
| Website /docs/mcp | `website-v2/src/pages/docs/mcp/*` | MCP tool change |
| Website /docs/concepts | `website-v2/src/pages/docs/concepts/*` | New core concept |

### Tier 4 — skill bundle

| Surface | Path | Updated when |
|---|---|---|
| Public skill | `skills/port-daddy-agent-skill/SKILL.md` | User-facing surface change |
| Public skill references | `skills/port-daddy-agent-skill/references/*` | Detailed surface change |
| Internal skill | `skills/port-daddy-internal-dev/SKILL.md` | Contributor-facing change (this skill) |
| CLI reference inside skill | `skills/port-daddy-agent-skill/references/cli-reference.md` | CLI surface change (must match website) |
| Examples | `skills/port-daddy-agent-skill/examples/*` | Behavior change that invalidates an example |

### Tier 5 — distribution

| Surface | Path | Updated when |
|---|---|---|
| Homebrew formula (primary, in-repo) | `Formula/port-daddy.rb` | Every release (url, sha256, version stamp) — also serves as a repo marker |
| Homebrew tap (downstream sync) | `~/coding/homebrew-port-daddy/Formula/port-daddy.rb` | Mirror of the in-repo primary; sync after the in-repo update lands |
| Mac app installer | `apps/FleetBar/install.sh` | Install path change, new resources |
| Codex extension | `.codex/skills/...` (synced via install.sh) | Skill bundle change |
| Claude extension | `.claude/skills/...` (synced via install.sh) | Skill bundle change |
| Gemini extension | `.gemini/extensions/port-daddy/` | Skill bundle change |
| AGENTS.md | `.agents/skills/...` | Skill bundle change |
| windags-skills mirror | `~/coding/windags-skills/skills/port-daddy-agent-skill/` | Public-skill change (manual `cp -r` from this repo) |

### Tier 6 — version stamps

| Surface | Path | Format |
|---|---|---|
| package.json | `package.json` | `"version": "X.Y.Z"` |
| Cargo.toml (if present) | `Cargo.toml` | `version = "X.Y.Z"` |
| Mac app Info.plist | the Info.plist under `apps/FleetBar/` | `CFBundleShortVersionString` |
| Website footer | the footer component under `website-v2/` | display version |
| `pd version` CLI output | `bin/port-daddy-cli.ts` | hard-coded or imported |
| Brew formula version (in-repo primary) | `Formula/port-daddy.rb` | inside the version-string echo |
| Brew formula version (tap mirror) | `homebrew-port-daddy/Formula/port-daddy.rb` | inside the version-string echo (must match in-repo primary) |

## Detection

Before commit, walk this checklist:

```
[ ] If you touched a route in lib/ or routes/, did you update OpenAPI?
[ ] If you added/changed a CLI command, did you update --help text AND website /docs/cli/<command>?
[ ] If you added an MCP tool, did you update mcp-handshake-test.mjs AND port-daddy-agent-skill MCP-Equivalents list?
[ ] If you renamed a concept, did you grep across docs/, website-v2/, skills/?
[ ] If this is a release, did you bump every version stamp in Tier 6?
[ ] If this is a release, did you compute the brew sha256 and update the formula?
```

A small script at `scripts/release-surface-audit.mjs` (proposed — not built yet)
should automate most of these checks; if it doesn't exist yet, write it (it's
the kind of internal-only tool that pays for itself within two releases).

## When you can't update everything in one slice

Send a Lookout message naming the exact gap:

```bash
pd actor lookout --message "DRIFT: pd swarm-status MCP tool added in commit <sha>; website /docs/mcp/swarm-status route not yet created. Follow-up issue: #N."
```

Then file the follow-up. Lookout's job is to make the gap visible; closing
it is the next contributor's job (or future-yours).

**Never close a slice with hidden drift.** The cost of one extra Lookout
message is bounded; the cost of an undocumented stale surface is unbounded
because it accumulates.
