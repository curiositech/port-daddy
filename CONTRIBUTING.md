# Contributing to Port Daddy

Port Daddy is a local coordination kernel, daemon, CLI, MCP server, SDK,
operator console, and a set of native/web surfaces. This guide is deliberately
short. `AGENTS.md` is the operating contract; `README.md` is the product map;
`docs/operations/daemon-and-supervision.md` is runtime authority.

## Prerequisites

- macOS or Linux
- Node.js 20 or newer
- Bun for repository scripts and release builds
- a clean linked Git worktree under `~/coding/tmp/`

Do not work in the main checkout, install from a source checkout, or replace
the stable daemon to test a branch.

## Start a slice

```bash
git fetch origin
git worktree add ~/coding/tmp/port-daddy-<slice> -b codex/<slice> origin/main
cd ~/coding/tmp/port-daddy-<slice>
bun install

pd attention
pd sitrep
pd begin --identity port-daddy:<slice> --lifecycle durable
pd note "scope: <goal and intended files>"
pd session files add <smallest-real-edit-surface>
```

The installed Homebrew daemon is stable. Backend, route, Squid, MCP, or browser
changes require a named development daemon built from the feature worktree:

```bash
pd dev up --from "$(pwd)" --label <slice>
eval "$(pd use <slice>)"
pd status --json
```

The selector exports the endpoint the daemon actually published. Never type a
daemon port into runtime code, tests, docs, or shell examples.

## Where changes belong

| Surface | Primary locations |
|---|---|
| Daemon and durable state | `server.ts`, `lib/`, `routes/`, `shared/` |
| CLI | `bin/port-daddy-cli.ts`, `cli/commands/` |
| MCP and SDK | `mcp/`, `lib/client.ts`, `features.manifest.json` |
| Web control center | `fleet-config-ui/`, generated `public/fleet-ui/` |
| macOS operator surface | `apps/FleetBar/` |
| Rust operator surfaces | `core/` |
| Squid harness | `lib/squid/`, `hooks/`, `scripts/smoke-squid-release.mjs` |
| Public guidance | `README.md`, `docs/`, `skills/`, `AGENTS.md`, `CLAUDE.md` |

Do not hand-edit generated `public/fleet-ui/` assets. Build them from
`fleet-config-ui/` while holding the generated-assets lock.

## Implementation rules

- Claim symbols or the narrowest file region before editing.
- Prefer one authoritative implementation over compatibility fallbacks.
- A spawn is a durable receipt, not a PID. Disconnect detaches; only an
  explicit cancel, explicit caller deadline, budget boundary, or terminal
  backend result ends the run.
- Stable is one Homebrew/launchd service. Named `pd dev` daemons are isolated
  feature builds. No competing watchdog or source-stable lane.
- Managed credentials live in the OS Keychain through FleetBar or `pd secret`.
- New user-facing capabilities require CLI/MCP/SDK/route/completion/docs parity
  unless the PR explains why a surface cannot apply.
- Update the public and internal Port Daddy skills when a reusable operating
  lesson changes.

## Test in proportion to risk

```bash
# Focused Jest file(s)
node --experimental-vm-modules node_modules/jest/bin/jest.js \
  --runInBand tests/unit/<surface>.test.js

# Type safety and repository contracts
bun run typecheck
bun run parity
bun run check:version-drift
```

Integration tests start an ephemeral daemon and consume the URL published by
their global setup. They must not assume the preferred port is free. Runtime
changes also need named-daemon dogfood: prove the write, read it back, restart
or reconnect when relevant, and capture the transcript/receipt/artifact trail.

Visual changes require close-up screenshots plus a GIF or recording from the
actual revision. A build or stale screenshot is not interaction proof.

## Commit and pull request lifecycle

Before every commit, push, or deploy:

```bash
git fetch origin
git rebase origin/main
pd sessions --all-worktrees
pd notes --limit 20
pd activity
git add -- <explicit paths>
pd guard check --staged
```

Leave a result note before the commit and an exact-SHA note after it. Keep each
commit independently reviewable: one behavior or one documentation truth,
with its focused regression coverage.

Every PR must include:

- a substantive `## Summary` and `## Test Plan`;
- exactly one `Roadmap-Item:` trailer;
- visual proof when a visual surface changed;
- an adversarial `SHIP`, `SHIP-AFTER-FIX`, or `DO-NOT-SHIP` review;
- answers and fixes for every high-confidence review finding.

Validate the drafted body with:

```bash
bun run check:pr-requirements -- --body-file <draft.md>
```

The author carries the PR through CI, review, merge queue, and merge. Do not
stop at “branch pushed.”

## Release policy

Port Daddy stable releases are Homebrew distributions, not npm publications.
Follow `docs/RELEASING.md` exactly. In outline:

1. synchronize the version through `scripts/set-version.mjs` and
   `scripts/sync-version.ts`;
2. build and test the release archive from the exact candidate SHA;
3. collect the required exact-SHA documentation and adversarial release-review
   evidence;
4. merge, tag the merged SHA, and let the release workflow publish artifacts;
5. update the external Homebrew tap and verify the installed daemon, CLI,
   Squid assets, published endpoint, and a real harnessed flow.

Release automation never publishes from an unmerged worktree or a different
revision than the one reviewed.

## Help

- [README.md](./README.md)
- [AGENTS.md](./AGENTS.md)
- [daemon and supervision](./docs/operations/daemon-and-supervision.md)
- [spawn lifecycle](./docs/operations/spawn-lifecycle.md)
- [release guide](./docs/RELEASING.md)

Contributions are licensed under the [MIT License](./LICENSE).
