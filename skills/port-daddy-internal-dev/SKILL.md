---
name: port-daddy-internal-dev
description: "Contributor manual for agents working ON the Port Daddy codebase itself — the daemon, MCP server, FleetBar / Fleet Control Center, website, CLI surface, distribution mirrors, internal recovery ledger, and the named internal actors (Coxswain / Navigator / Cartographer / Lookout / Quartermaster + Shipwright). Use when editing the port-daddy repo. NOT for agents using Port Daddy on other projects (use port-daddy-agent-skill for that), and NOT distributed to public skill catalogs — this skill is private to the port-daddy repo."
license: FSL-1.1-MIT
allowed-tools: Read,Bash,Grep,Glob,Edit,Write
metadata:
  category: Coordination
  tags: [port-daddy, internal, contributor, daemon, fleetbar, mcp, distribution, release-surface, shipwright]
  pairs-with: [port-daddy-agent-skill, skill-architect]
  provenance:
    kind: first-party
    owners: [port-daddy]
    scope: internal
  authorship:
    maintainers: [port-daddy]
  distribution:
    public: false
    note: "Sync to internal coordination paths inside the port-daddy repo only. Do not publish to windags-skills, .claude marketplaces, or other public catalogs. The port-daddy-agent-skill is the public-facing companion."
  mirrors:
    repo: skills/port-daddy-internal-dev
    codex: .codex/skills/port-daddy-internal-dev
    claude: .claude/skills/port-daddy-internal-dev
    agents: .agents/skills/port-daddy-internal-dev
---

# Port Daddy — Internal Contributor Manual

You are editing the Port Daddy codebase itself: the daemon, MCP server,
FleetBar, Fleet Control Center, website, CLI, SDKs, distribution surfaces,
the recovery ledger, and the internal actor inboxes. This skill is private
to the port-daddy repo because most of what's here would be noise on a
project that just *uses* Port Daddy.

For the public skill — how any agent on any project should drive Port
Daddy — see the sibling `port-daddy-agent-skill`.

## NOT For

- Agents on other projects driving Port Daddy as a coordination tool — that's `port-daddy-agent-skill`.
- General coding without a Port Daddy surface change.
- Distribution to public skill catalogs.
- Replacing the live daemon, recovery ledger, or actor inboxes as sources of truth — those still come first.

## Operator vs Agent — the product rule

When designing or changing a Port Daddy surface, the test is "would the
operator have to drop to a terminal to do this routinely?" If yes, the design
is wrong. The operator's surface is FleetBar + the dashboard. `pd` CLI exists
for agents and emergencies. Every routine operator action (configure
credentials, restart daemon, see open feedback, harvest a roadmap entry, ack a
salvage item) must have a FleetBar button or dashboard panel as its primary
surface — CLI is the secondary path for agents and scripts.

Contributor implication: when you add a new actuator or data source, ship the
FleetBar/dashboard affordance in the same slice when reasonable, or file a
`high`-severity FleetBar feedback entry so cartographer promotes it to the
roadmap before the CLI-only path ships to operators. Examples in flight:
`fleetbar-secret-management-with-provider-deeplinks`,
`fleetbar-console-must-support-zoom-and-text-scaling`.

## How to work a slice (operating expectations)

The full posture lives in `AGENTS.md` § Agent Operating Expectations. The
repo-specific mechanics:

- **Coordinate + pay rent.** Clean linked worktree off `origin/main`,
  `pd begin … --lifecycle durable`, `pd session files add` before editing, a
  `pd note` per commit (the Coordination Guard enforces it), `pd done` at the end.
  When inheriting stale work, prefer `pd takeover <old-session-id> [reason]`
  (or `pd session takeover <old-session-id> [reason]`) over deleting or silently reusing the old session; notes and claim
  history are append-only evidence.
- **Assume broken; verify both ends.** After any write, read it back from the
  surface that should serve it, and prove cold start (daemon down → elegant
  operator instruction, never a stack trace), worktrees, a second user, and the
  GitHub round-trip. A green exit code is not evidence.
- **Confirm the telemetry trail.** Calls must show up in `pd usage` AND in the
  transcript saves (`lib/transcripts.ts`), and durable state must ride the
  Cloudflare fabric (`lib/relay-client.ts`) so posterity is cheap and survives the
  container — verify the read-back, don't assume it.
- **Dogfood novelly + capture wins.** Exercise a CLI/MCP/SDK surface you haven't
  before each slice; when a hard-won gambit lands, write it into this skill (or the
  public `port-daddy-agent-skill` if it generalizes).
- **Generalize.** Features must work for non-tsx/non-Rust repos, remote harbors,
  other machines, and shared GitHub teams — not just this checkout.
- **Whitepaper check.** Reconcile coordination/kernel work against the seven
  whitepapers registered in `website-v2/src/data/whitePapers.ts` (Legible Swarm,
  Single-Writer Kernel, Spawn to Person, Harbor Economy, Anchor Protocol, Bonded
  Commons, Federated Harbor); note drift in the PR.
- **Skill matching.** If you're missing a matching skill, pause and do skill
  research. The intended home is a **seamanship** match-cascade/graft selector
  (proposed, not yet built — modelled on windags `windags_skill_induct` /
  `windags_skill_graft`); until it lands, match by hand against `skills/`.
- **Launch work through PD spawn** (`pd spawn`, SDK `spawn()`, or MCP `spawn`),
  never a raw side-channel — so the work is registered, sandboxed, budgeted, salvageable.
- **Managers orchestrate; workers author PRs.** A manager lane delegates
  implementation edits, PR body drafting, and PR authoring to worker sessions.
  The manager reads returned artifacts, checks evidence, steel-mans the strongest
  case against shipping, retunes roles by round, and decides whether work
  advances.
- **Target: durable roles keep ledgers.** Notes are immutable evidence; role
  ledgers are curated projections for future briefings. Do not claim this as a
  fully shipped runtime unless the branch/live daemon proves it. Ledger entries
  that summarize operator preferences or cross-repo tactics must carry
  provenance, redaction/sync posture, account/team authority, and staleness.
- **Keep `README.md` current** in the same PR when a slice changes a documented surface.
- **Prove Squid from release cargo.** Adding a hook to source is not enough.
  Declare every required tentacle/identity/steering asset in
  `release-artifacts.json`, stage it in `release.yml`, then run
  `scripts/smoke-squid-release.mjs` against the compiled binary outside the
  source tree. The proof must cover Claude/Gemini project config, Codex/agy
  user config, exact-root gating, statusline, Pilot SessionStart, `/squid`, and
  machine-readable READY/LIVE state. A source-suite pass cannot substitute for
  this artifact-boundary proof.

## Core Decision Tree

```mermaid
flowchart TD
    start[Edit lands on port-daddy] --> what{What changed?}
    what -->|CLI surface| cli[Update CLI help → references → website /docs/cli → MCP tools → skill bundle. Send Lookout drift report when scope > 2 surfaces.]
    what -->|Daemon API| api[Update lib + routes + OpenAPI + SDK ref. Run pd integration ready signals. Audit pd guard for new contracts.]
    what -->|MCP tool| mcp[Update mcp/server.ts + handshake test + skill catalog. Re-validate all 10 tool schemas.]
    what -->|FleetBar / Console| ui[Update Mac app + screenshots in references/fleetbar-and-console.md. Test from a clean install root.]
    what -->|Distribution mirrors| dist[Update brew formula sha256. Bump version in 4 places. Rerun install.sh end-to-end. Lookout review.]
    what -->|Internal actor| actor[Update routes/+ lib/ owning module + actor-roster.md + decisions/who-do-i-message.md. Backfill inbox tests.]
    what -->|Recovery ledger| ledger[Edit docs/recovery/CURRENT-WORK.md only via Cartographer/Navigator. Don't bypass the actors.]
    cli & api & mcp & ui & dist & actor & ledger --> ship[Reconcile + guard + tag + push]
```

## Internal Actor Embodiments

The five actor roles in the public skill are *concepts*. In this repo,
each one has a concrete **embodiment**: a route, a lib module, a fleet
persona, and a status surface. When you edit any one of these, you are
editing a piece of the actor's body, and the corresponding inboxes,
contracts, and operator surfaces must stay coherent.

| Actor | Route | Lib module | Fleet persona | Status surface |
|---|---|---|---|---|
| **Coxswain** | `routes/claims.ts`, `routes/locks.ts` | `lib/claims/`, `lib/locks/`, `lib/symbol-index/` | `agents/coxswain.yaml` (when present) | claim density + lock health in `pd briefing` | <!-- cite-exempt: illustrative role/template path -->
| **Navigator** | `routes/sessions.ts`, `routes/recovery.ts` | `lib/sessions/`, `lib/salvage.ts` | `agents/navigator.yaml` | `docs/recovery/CURRENT-WORK.md` | <!-- cite-exempt: illustrative role/template path -->
| **Cartographer** | `routes/cartographer.ts` | `lib/roadmap-progress.ts`, `lib/feedback.ts` | `agents/cartographer.yaml` (also lives at `.claude/agents/cartographer/`) | `.cartographer/status.md`, `IDEAS-TROVE.md`, `DOGFOOD-FEEDBACK.md` |
| **Lookout** | `routes/lookout.ts` | release-surface scanners under `lib/` | `fleet/documentarian.sh` (current shell-script form) | drift reports posted to lookout inbox | <!-- cite-exempt: illustrative role/template path -->
| **Quartermaster** | `routes/spawn.ts`, `routes/fleet.ts` | `lib/spawner.ts`, `lib/cost-tracker.ts`, `lib/backend-readiness.ts`, `lib/resource-governance.ts` | `agents/quartermaster.yaml` | spawn budget + readiness in FleetBar |

**Shipwright** is a sixth, internal-only role: it owns skill-bundle
ingestion, archetype classification, and survey aggregation across the
fleet. Lives at `lib/shipwright/{archetypes.ts, skill-index.ts, survey.ts}`
and `routes/shipwright.ts`. Tests under `tests/unit/shipwright-*.test.js`.
Don't expose Shipwright in the public skill — it's a port-daddy-internal
abstraction.

## Recently Shipped Surfaces — contributor module map

These landed on `main` in the last few weeks. When you touch one, you own
its full mirror set (Release-Surface Drift, below). Each is a release
surface: CLI help, manifest, MCP catalog, and skill docs must move with the
code. The public-facing summary lives in `skills/port-daddy-agent-skill/SKILL.md`
§ *Recently Shipped Surfaces* — keep the two in sync.

| Surface | ADR | Edit these together |
|---|---|---|
| **Relay** — cross-machine pub/sub | `docs/adr/0049-relay-architecture.md` | Worker `apps/relay/` (D1 schema `apps/relay/schema.sql`, `wrangler.toml`) · daemon routes `routes/relay.ts` · outbound SSE `lib/relay-client.ts` · CLI `cli/commands/relay.ts` · MCP `relay_status` in `mcp/server.ts` |
| **Dispatch** — autonomous feature-dev queue | ADR-0035 | `cli/commands/dispatch.ts` (+ deprecated alias `cli/commands/nightshift.ts`) · `lib/dispatch/{runner,spawn-adapter,queue,state-machine}.ts` · `routes/dispatches.ts` · `pd review` · `docs/proposals/pd-nightshift.md` | <!-- cite-exempt: illustrative role/template path -->
| **Coast Guard** — sandbox + compulsion rent | `docs/adr/0050-coast-guard.md` | `lib/coast-guard.ts` (`buildSeatbeltProfile`, `wrapWithSandbox`) · `lib/coast-guard/{compulsion,compulsion-facts,egress-meter}.ts` · default in `lib/spawner.ts` · read path `cli/commands/coast-guard.ts` (`operator_coast_guard` feature) · `requireNotePerCommit` wiring in the Coordination Guard (`cli/commands/guard.ts`) | <!-- cite-exempt: illustrative role/template path -->
| **Attest** — honest self-report | ADR-0045 | `cli/commands/attest.ts` · `lib/attest.ts` · `lib/attest-invariants.ts` · `GET /attest` · the `attest` manifest feature |
| **Tube** — conversational pipe | — | `cli/commands/tube.ts` · message-channel store · `pd_discover` listing |

Contributor gotchas specific to these:

- **Dispatch is dry-run by default.** `pd dispatch run <id>` prints the plan;
  only `--really-run` spawns. The worktree root is `~/coding/tmp/port-daddy-dispatch-<id>`
  (never `os.tmpdir()` / `/tmp`). If you change the spawn path, keep it under
  the scratch root — the Coast Guard reclaim gate (`isReclaimableSandbox`)
  assumes disposable sandboxes live there and the operator's main checkout
  does not.
- **No artifact means no reap.** A review launch may finish with useful dirty
  files while push/PR publication returns no URL. The Conductor adapter must
  route that outcome to `salvage` and preserve the worktree plus transcript.
  `settled` is disposable only when `resultArtifact` proves the work is durable.
- **`pd nightshift` must keep delegating.** The alias rewrites legacy flags
  (`--auto-queue` → `--auto-claim`, `--status` → `--state`) before calling
  `handleDispatch`. If you add a dispatch flag, check the alias still maps it.
- **Coast Guard is opt-out and never advertised.** It is the default for
  every subprocess backend in `lib/spawner.ts`; the agent-facing refusal must
  never name the opt-out (same rule as the guard bypass — guardrails do not
  advertise their bypass).
- **`pd attest` is a loud-fail gate.** Adding an invariant means it can flip
  CI/boot gates red. New CRITICAL invariants go in `lib/attest-invariants.ts`
  with a test; mark non-blocking checks as such so a green exit keeps meaning
  "every CRITICAL invariant holds."
- **Manifest bijection.** `features.manifest.json` is the parity source of
  truth (`npm run parity`). The `dispatch`/`relay`/`attest`/`operator_coast_guard`
  feature rows carry `_note` fields explaining intentionally-omitted routes
  (e.g. generic-typed Fastify handlers the route-parser cannot extract) — keep
  those notes accurate when you add or remove a route.

### Rust surfaces — four crates, no single kernel (be honest)

`core/` holds four separate crates on `main`: `core/pd-tui` (ratatui),
`core/pd-bosun`, `core/harbor-card-rs`, and `core/pd-console` (the landed GPUI
conversation-multiplexer). There is **no single landed "rust kernel."**
`core/pd-console` is not the sibling kernel-rs runtime and is no longer only an
old planning surface; keep prod/latest/dev pd-console lanes distinct when
building or reviewing it. A sibling WIP build `~/coding/port-daddy-kernel-rs`
maps the product spine (pd-anchor / pd-mesh / pd-eventlog / pd-runtime /
pd-core) but is not this repo. **Do not scaffold a fourth Rust shell** without
reconciling against `AGENTS.md` § *Architecture truths*. A release-cadence +
Rust-surface-alignment ADR (ADR-0054) is being written in parallel; cite it by
number until it lands.

#### Building / installing / running `pd-console` (full detail in `AGENTS.md` § *Building, installing & running pd-console*)

Two binaries from one crate on **crates.io gpui 0.2.2** (not the Zed git pin):
`pd-console` (GPU window, `--features gpui`, macOS) and `pd-console-repl` (headless TUI, CI gate).
Build: `cargo build --release --bin pd-console --features gpui` (from `core/pd-console`).
**Install BOTH launch surfaces or you demo a stale build:** the PATH binary
`~/.port-daddy/bin/pd-console` *and* the double-clickable `~/Applications/pd-console.app`
(embeds its own binary — does NOT read PATH). After replacing the .app binary,
`codesign --force --deep --sign - ~/Applications/pd-console.app` or macOS rejects it.
Launch with `PORT_DADDY_URL=http://127.0.0.1:9876` if daemon discovery panics;
`PD_CONSOLE_THEME=light|dark` / `Ctrl-A g` for theme. Spawning from the console clears real
guards (`task`+`identity`+`budgetUsd`+`model`+ worktree `workdir`, plus a funded project wallet +
daily budget) — miss one and spawn "looks wired but does nothing." gpui 0.2.2 has no transform:
glow/lift = `shadow(BoxShadow)` + hover color; timelines = `with_animation`; inside `.hover(|s|…)`
pass bare `rgb(x)` (NOT `.into()` — ambiguous). Console branch: `feat/console-tmux-multiplexer`.

## Release-Surface Drift (the contributor's prime directive)

When Port Daddy itself ships, the cost of inconsistency lands on every
project on the user's machine. **Every change to a public surface MUST
update every mirror in the same coherent slice.**

For the actual release ceremony (tagging, GitHub Release, `release.yml`,
brew tap roll via `publish.yml`), follow `docs/RELEASING.md`.
For semver policy and the canonical list of *version surfaces* that must
all bump in lockstep, see `docs/VERSIONING.md`.

The list below is the broader surface area a contributor touches *before*
the release ceremony fires — the docs, examples, manifests, and CLI help
that lie about behavior if not updated alongside the code.

Public surfaces, in approximate update order:

1. Source code (`lib/`, `routes/`, `mcp/`, `apps/FleetBar/`).
2. CLI help text (`bin/port-daddy-cli.ts` and any `--help` strings touched).
3. The skill bundle (this repo's `skills/port-daddy-agent-skill/SKILL.md`, references, templates, examples).
4. The website (`apps/website-v2/` — `/docs/cli`, `/docs/api`, `/docs/mcp`, command detail routes, screenshots).
5. The OpenAPI spec, SDK reference, MCP tool catalog.
6. README + CHANGELOG + the eight version surfaces in `docs/VERSIONING.md`.
7. Any plugin/extension manifests (Codex `.codex/skills/`, Gemini `.gemini/extensions/port-daddy/`, Claude `.claude/skills/`).
8. **Binary smoke-test** (per `docs/RELEASING.md` §3, "local feature dev") for any change in `lib/`, `routes/`, `server.ts`, or `mcp/`. Source-mode `tsx server.ts` lies about what users actually run.

The Homebrew formula is no longer a per-PR concern — it rolls during the release ceremony via the `curiositech/homebrew-tap` repo and `publish.yml`. See `docs/RELEASING.md` §1 ("public release") step J.

If you cannot land all of these in one commit, leave a `pd actor lookout`
message naming the gaps and link the follow-up issue. Lookout is the role
that watches for release-surface drift; making the drift visible is your
job, fixing it is theirs (or future-yours).

## PR Finish Line Discipline

For Port Daddy repo PRs, local validation is not the finish line. Before
calling a branch ready, inspect and close the full PR surface:

- Inline bot comments from Copilot, Claude review, Cloudflare Pages, CodeQL,
  package/release jobs, or deploy previews count as review findings. Reply to
  each actionable thread with fixed / deferred / contested-because.
- A neutral adversarial reviewer runs in CI on **every** PR (the
  `claude-adversarial-review` workflow — assumes laziness/slop/lies/corner-cutting,
  ends with a `SHIP / SHIP-AFTER-FIX / DO-NOT-SHIP` verdict). Also run your own
  skeptical reviewer agent for non-trivial changes. Fix high-confidence findings
  as named fixup commits on the branch.
- **The PR description is gated.** `.github/PULL_REQUEST_TEMPLATE.md` is the form,
  and `scripts/check-pr-requirements.mjs` (CI job `pr-requirements-guard`) fails the
  merge queue on an empty/boilerplate Summary or Test Plan, or a visual diff with no
  artifacts. Draft-check locally: `npm run check:pr-requirements -- --body-file <draft.md>`.
- Treat GitHub CI, external deploy checks, release-package jobs, and Cloudflare
  Pages as one CI/CD surface. If one is red, inspect the linked logs. Only call
  it external after proving the branch is not the cause, and record that proof
  in both the PR and a `pd note`.
- Do not leave a PR with "CI green except..." as an unresolved aside. Either
  make it green, file/assign the external blocker with evidence, or hand off the
  exact next action to an active Port Daddy session.
- **UI diffs ship visual artifacts — forever (now `[M]`).** A PR touching a GPUI
  surface (`core/pd-console` window), the console (any pane/renderer), or the
  website/dashboard (`website-v2/`, `fleet-config-ui/`, `public/fleet-ui/`,
  `public/`, `dashboard/`, `apps/FleetBar/`) is incomplete without screenshots + a
  GIF + a short screen recording of the real change in its Test Plan, and
  `pr-requirements-guard` now fails the PR without at least a screenshot + a motion
  artifact. Green CI proves compilation, not rendering. TUI panes →
  `vhs` (tape under `core/pd-console/docs/artifacts/`); GPUI window →
  `cargo build --release --features gpui` then `core/pd-console/scripts/capture-gpui.sh`
  (needs macOS Screen Recording permission — a headless host is TCC-denied);
  website/dashboard → headless Playwright dark+light pairs. See AGENTS.md
  § "Visual artifacts for UI diffs". Operator rule, 2026-06-11.

## PR Lifecycle (Create / Update / Land)

The Finish Line Discipline above is the *review contract*; this is the
*mechanical contract*. `AGENTS.md` (`## Pull Request Operating Procedure`)
carries the canonical copy — this is the contributor-repo mirror.

**Create.** Linked worktree off `origin/main` under `~/coding/tmp/wt-<slug>`
(never the main checkout — it carries the operator's WIP) → `pd begin
"<purpose>" --identity port-daddy:contrib:<slug>` → scope `pd note` → `pd
session files add <files>` *before* editing → edit → `pd guard check
--staged` → commit (no Claude co-author trailer) → `git push -u origin
<branch>` → `gh pr create` → `pd done`.

**Update** (review + CI). Pull bot comments with `gh api
repos/curiositech/port-daddy/pulls/<n>/comments` and fix the real ones.
Land every HIGH adversarial finding as a named fixup commit. Get `npx tsc
--noEmit`, jest, `npm run parity`, and the build green. Rebase onto latest
`origin/main`, resolve conflicts, push.

**Land.** Merge in dependency order: base before dependent, and rebase the
dependent after *each* merge — mergeability can flip MERGEABLE → CONFLICTING
the moment the base lands. Use the protected flow: `gh pr merge <n> --auto`
when the merge queue is active, and let branch protection choose the merge
strategy. Do not add `--squash`, `--merge`,
`--rebase`, or `--admin` as routine agent flow. A human maintainer may make an
explicit, documented emergency bypass; an agent does not admin-skip a real
required gate. Cloudflare Pages may be external/advisory, but prove that from
branch protection and record the evidence before treating it as non-blocking.

**Cleanup.** Delete a worktree only when its branch is merged AND `git -C
<wt> status --porcelain` is clean. Never delete a worktree with uncommitted
work; never reset or clobber the main checkout.

### Shell gotchas (real and recurring)

- **`git add -A` is refused by the pd-shim.** When you truly mean all (rare;
  prefer explicit paths), use `PD_SHIM_OFF=1 git add` so the bypass is
  deliberate.
- **The `~/.port-daddy/bin/git` shim sets `core.pager=delta` → `bat`.** If
  `bat` is absent, `git log` / `git show` / `git commit` emit `command not
  found: bat` and can swallow output. Use `git -c core.pager=cat …` or
  `GIT_PAGER=cat`.
- **Inline `node -e` and heredocs get mangled by zsh.** Write a `.cjs` under
  the repo's `.scratch/` (gitignored, resolves `node_modules`) and run it.
- **Secrets go through `pd secret set`** (hidden stdin prompt) — never as an
  argv argument.

### Test + session gotchas (dev-loop shibboleths)

The friction below costs every fresh session real time. Internalize it.

- **Tests are Jest, not vitest.** `tests/unit/*.test.js` import from
  `@jest/globals`; run them with `npm test` (which is `node
  --experimental-vm-modules node_modules/jest/bin/jest.js`). Invoking `vitest`
  fails at import with *"Do not import `@jest/globals` outside of the Jest test
  environment"* — that's a wrong-runner error, not a broken test.
- **A fresh linked worktree has no `node_modules`.** `git worktree add` copies
  tracked files only, so `npm test` / `jest` / `tsc` all fail with
  `MODULE_NOT_FOUND` until you install. Either `npm ci` in the worktree, or run
  the parent checkout's binary directly against the worktree:
  `node --experimental-vm-modules
  /Users/erichowens/coding/port-daddy/node_modules/jest/bin/jest.js --rootDir .
  <path/to/test>`. A bare `node_modules` symlink to the parent does **not**
  work — Node resolves the symlink target and looks for `node_modules` beside
  *it*, not inside it.
- **Headless `pd begin` needs an explicit lifecycle and closed stdin.** With no
  TTY, `pd begin` blocks waiting for interactive input, and even with a purpose
  it errors without `--lifecycle`. Use `pd begin "<purpose>" --lifecycle
  durable < /dev/null` (or `--lifecycle ephemeral` for heartbeat-bound process
  sessions). Sessions launched via the Bash background-job wrapper never
  register — run `pd begin` in the foreground.
- **Coordination-Guard claims are per-file, not per-directory.** `pd session
  files add skills/foo/` does not cover `skills/foo/SKILL.md`; the guard rejects
  the commit file-by-file. Claim exactly what you staged:
  `pd session files add $(git diff --cached --name-only)` right before `pd guard
  check --staged`.
- **A `git add -A` / `reset --hard` / `rebase` refused with "coordination
  guard … could not be verified"** (not the routine advisory refusal) means the
  daemon-side guard couldn't confirm your session. Re-run `pd begin`, then
  retry; only fall back to `PD_SHIM_OFF=1` for a genuinely session-less isolated
  worktree that holds nothing but your own commit.

## Distribution Mirror Sync

The skill bundle is mirrored to several locations. Inside this repo the
canonical copy is `skills/port-daddy-agent-skill/`. The `metadata.mirrors`
block in its frontmatter declares targets:

| Target | Purpose | Sync trigger |
|---|---|---|
| `.codex/skills/` | Codex CLI agents on this repo | install.sh + brew post_install |
| `.claude/skills/` | Claude Code agents on this repo | install.sh + brew post_install |
| `.agents/skills/` | Generic AGENTS.md-aware tools | install.sh |
| `.gemini/extensions/port-daddy/skills/` | Gemini CLI extension surface | install.sh |
| windags-skills (out of repo) | Public catalog distribution | manual `cp -r` from this repo to `~/coding/windags-skills/skills/` |

`port-daddy-internal-dev` (this skill) **is intentionally absent** from
the mirrors-list above. Do not propose distributing it. Its presence on a
non-port-daddy machine would be confusing noise.

## Recovery Ledger Discipline

`docs/recovery/CURRENT-WORK.md` is owned by Navigator + Cartographer.
**Do not edit it directly.** Send messages to those actors:

```bash
pd actor navigator --message "ROADMAP: <slice> completed at <commit>. Suggest promoting next: <item>."
pd actor cartographer --message "DOGFOOD: <synthesis>. Suggest roadmap entry: <name>."
```

Mailbox delivery is durable but not synchronous. After messaging an actor,
keep working from the actual source of truth: `docs/recovery/CURRENT-WORK.md`,
`.cartographer/README.md`, `.cartographer/status.md`, live notes, sessions,
and the checked-in release surfaces.

If `docs/recovery/CURRENT-WORK.md` contradicts the live fleet, that is a
**Navigator** issue. File it; do not silently overwrite.

## Git Discipline (inherited; see ADR 0001)

The five rules from `port-daddy-agent-skill` apply here too — and harder,
because this repo has the highest agent density on the user's machine.

1. **Worktree mandatory** for any background contributor work — even small ones. The repo has 70+ existing worktrees and dozens of WIP branches; sweeping up someone's WIP is a near-certainty without isolation.
2. **No `git add -A` ever.** No exceptions. The repo has too many drafts in flight.
3. **Pre-commit `git status --porcelain` check.** Abort on foreign files. The pre-commit hook from `pd guard install --mode enforce` should be on at all times in this repo.
4. **Lock the staging area** if you must work in the main checkout: `pd lock port-daddy:git:write` (or `pd with-lock port-daddy:git:write -- <command>`). MCP-aware clients can call `acquire_lock` with the same name.
5. **Push only what you tagged.** Never `git push --follow-tags` from a contributor agent.

See `references/git-discipline-internal.md` for port-daddy-specific
extensions (release-tag immutability, the v-prefix convention, the brew
formula update protocol).

## Catalog-First Reflex (windags MCP, internal edition)

Port Daddy contributors are not exempt from the catalog. The 600+ skills
in `~/coding/windags-skills/` cover most patterns you'll hit while
editing this codebase: rate limiting, caching, websocket protocols,
distributed transactions, pre-mortems, evaluation harnesses, design
systems for the website, and more.

```bash
windags_skill_search "<the thing you're about to do>"
windags_skill_graft <skill-id> [skill-id...]
```

**Before every contributor slice**, one search. Examples that have paid off:

- Editing the daemon's lock-acquire path? `windags_skill_search "distributed lock semantics"` → grafts `distributed-algorithms` and `sagas-garcia-molina-salem-1987`.
- Adding a new MCP tool description? `windags_skill_search "MCP tool description writing"` → grafts `mcp-creator` if relevant.
- Touching the website? `windags_skill_search "responsive layout master"` and friends — the design-system skills ship with usable component patterns.
- Writing pre-release tests? `windags_skill_search "adversarial QA"` → grafts `qa-automation-specialist` or `webapp-testing`.

If the catalog is wrong or stale for our domain, that's a Cartographer
issue: `pd actor cartographer --message "Catalog gap: <what skill should exist>. Use case: <internal slice>."`

## Maintain These Skills (port-daddy-internal-dev edition)

This skill is alive. It improves when contributors update it. **When you
finish a slice — any slice on this repo — ask: did I just learn something
that this skill *or* `port-daddy-agent-skill` should have warned me about?**

Contributors are the only agents who write to *both* surfaces. As an
internal agent you own a continuous maintenance duty for both:

- **Public** (`skills/port-daddy-agent-skill/SKILL.md`) — anything that helps an agent on *any* project using Port Daddy. New verb, deprecated flag, decision row, anti-pattern, clarification, brevity win.
- **Internal** (this skill) — anything specific to *editing this repo*: release ceremony, internal actor embodiments, drift protocol, worked contributor examples.

Drive-by edits are explicitly welcome on both. No issue required, no
permission required. Same-slice fixes — landing the skill update alongside
the code change that revealed the problem — are the default; that is what
keeps the documentation from going stale between releases. Retrospective
edits (the lesson surfaced days later) are still owed; open a tiny PR.

Concrete triggers:

- **You hit a release-surface gap** the protocol didn't cover. Update `references/release-surface-drift-protocol.md`.
- **An internal actor's body moved** (new route, lib reshuffle). Update the Internal Actor Embodiments table.
- **A worked example would have saved an hour** for a recurring slice. Add it to `examples/`.
- **A new useful internal-only tool** (audit script, fleet persona, debugger) was written. Cross-link from this skill.

Update mechanics:

```bash
git worktree add ../port-daddy-internal-skill-$(date +%s) origin/main
cd ../port-daddy-internal-skill-*
pd begin "Update port-daddy-internal-dev: <what>" --identity port-daddy:contrib:internal-skill-update
$EDITOR skills/port-daddy-internal-dev/SKILL.md   # or references/<file>.md
git add skills/port-daddy-internal-dev/<paths>
git status --porcelain                             # must be clean of foreign files
git commit -m "skill: port-daddy-internal-dev — <change>"
```

If the wisdom is **public** (any agent on any project would benefit), put
it in `port-daddy-agent-skill` instead. The split-decision rule: *would
this help an agent on a non-port-daddy repo?* Yes → public. No → internal.
Both? → public, with a port-daddy-specific extension page in this skill.

After landing, send Cartographer:
`pd actor cartographer --message "port-daddy-internal-dev updated: <section>. Reason: <session/incident>."`

## Advance (the invocable "move it along" call)

When the operator invokes this skill with `advance` (or any phrasing like
"move things along", "go on", "keep going", "you know what to do"), run the
standing autonomous sweep. **Do not ask permission at any step** — review is
the gate, not the operator. These are the operator's recorded expectations;
re-asking them is the failure mode this section exists to kill.

1. **Recon.** `pd status` / `pd briefing` / `pd sessions --all-worktrees`,
   then `env -u GITHUB_HOST gh pr list --author @me --state open` (plus any
   PRs this fleet opened under other identities). Snapshot main's CI:
   `gh run list --branch main --limit 5`.
2. **Classify each open PR**: green-and-mergeable → land it now; stale base →
   rebase; red required check → root-cause it; superseded by a landed PR →
   close it with a comment naming the superseding PR (never merge a
   semantically obsolete diff — see the #353 incident); draft → leave unless
   its gate condition is met.
3. **Red required check = STOP and fix the root cause**, even when the debt
   is inherited from main. Never `--admin` over a real red. Cloudflare Pages
   may be external/advisory, but prove that from branch protection before
   treating it as non-blocking.
4. **Answer every review thread.** Copilot and claude-review inline comments
   are first-class reviews: fix-and-reply, or dismiss-with-reason against
   origin/main. A PR with unanswered threads is not "ready".
5. **Land in dependency order**, base before dependent, rebasing the
   dependent after each merge. Use `gh pr merge <n> --auto` for merge-queue
   repos and let the protected branch choose strategy. Admin bypass is not a
   routine agent landing path.
6. **Clean up**: delete only worktrees whose branch is merged AND whose
   `git status --porcelain` is clean. Never touch the main checkout.
7. **Close the ledger**: `pd note "Result: ... Validation: ... Remaining: ..."`,
   `pd done`, `pd feedback` — and if the sweep taught this skill something,
   land the skill edit in the same sweep.

Built bundles (`public/fleet-ui/`) conflict on every rebase because both
sides rebuilt them: resolve toward main's bundle, finish the rebase, rebuild
from the rebased source (`cd fleet-config-ui && npx vite build`), and commit
the fresh bundle. Never hand-merge a minified asset.

## Operating Loop (contributor)

```bash
# 1. Anchor + reconnaissance
pd status
pd briefing
pd salvage --project port-daddy --limit 20
pd sessions --all-worktrees

# 2. Worktree (always)
git worktree add ../port-daddy-$(date +%s)-$WORK_SLUG origin/main
cd ../port-daddy-$(date +%s)-$WORK_SLUG

# 3. Identity and scope
pd begin "<bounded slice>" --identity port-daddy:contrib:$WORK_SLUG
pd note "Scope: <surfaces>. Assumptions: <truth>. Validation: <commands + tests>."
pd session files add <path>...

# 4. Work
# ... edits ...

# 5. Reconcile
git fetch origin
git rebase origin/main
pd notes --limit 20
pd guard check --staged

# 6. Cross-surface coherence (the contributor-specific bit)
node scripts/release-surface-audit.mjs   # if present
# OR walk the Release-Surface Drift list above by hand

# 7. Commit + push (NOT tag — tags are release work, see RELEASING.md §1)
git add <explicit paths>
git status --porcelain          # MUST be clean of foreign files
git commit -m "<scope>: <change>"
git push -u origin <feature-branch>
gh pr create ...                # standard PR flow

# 8. Close
pd note "Result: <change>. Validation: <evidence>. Remaining: <Lookout drifts, follow-ups>."
pd done "<outcome>"
pd feedback "<contributor experience report>"   # bare form; auto slug + agent
```

**For releases** (cutting `v3.X.Y`, building binaries, rolling the brew tap): follow `docs/RELEASING.md`, not this loop. Tagging here is a footgun — feature branches must not push tags. The "binary smoke-test before merging anything in `lib/`, `routes/`, `server.ts`, or `mcp/`" rule is in RELEASING.md §3; honor it.

## Anti-Patterns (port-daddy contributor edition)

### Editing The Recovery Ledger Directly
**Detection:** Diff includes `docs/recovery/CURRENT-WORK.md` without a Navigator message in the same slice.
**Symptoms:** Live fleet contradicts the ledger; salvage routes to wrong sessions; Cartographer status falls out of sync with reality.
**Fix:** Always route ledger updates through `pd actor navigator` or `pd actor cartographer`. The actor is the writer of record.
**Why:** The ledger is the audit trail. Direct edits are silent rewrites of audit history.

### Bumping One Surface, Forgetting Six
**Detection:** A `pd ...` command's behavior changed; CLI help is current; website `/docs/cli/<command>` page is stale; OpenAPI is stale; skill `references/cli-reference.md` is stale.
**Symptoms:** Operators read four different versions of "what does this command do" depending on where they look. Lookout inbox fills.
**Fix:** Walk the Release-Surface Drift list before commit. If you can't update all of them in this slice, send `pd actor lookout` a message naming the gaps with a link to the follow-up.
**Timeline:** Single-surface tools could ship one update at a time; Port Daddy spans CLI + daemon + MCP + website + Mac app + skill bundle + brew. Each new surface compounds the drift cost.

### Treating Shipwright As Public
**Detection:** Shipwright concepts (archetype classification, skill-index aggregation, survey rollups) appear in `port-daddy-agent-skill` or `references/actor-roster.md`.
**Symptoms:** Users on other projects see internal abstractions in their docs; the public skill bloats; Shipwright's contract leaks before it stabilizes.
**Fix:** Keep Shipwright references in this skill (`port-daddy-internal-dev`) only. The public surface should expose its *outputs* (better skill matches, better classifications) without naming the internal mechanism.

### Force-Pushing A Release Tag
**Detection:** A `vX.Y.Z` tag points to a different commit than the one originally tagged.
**Symptoms:** Brew formulas with frozen sha256 break for users; CI caches invalidate; users on the old tag see different code than users on the new one with the same tag string.
**Fix:** Tags are immutable. If a release was wrong, ship `vX.Y.Z+1` with a CHANGELOG entry explaining the recall. Never `git push --force origin vX.Y.Z`.

### Skipping `pd feedback` On Contributor Friction
**Detection:** Internal contributor sessions end clean but the friction isn't recorded; the same friction visits the next contributor.
**Symptoms:** "Why is this so hard" gets discovered repeatedly. The roadmap doesn't reflect the actual pain. Cartographer's priorities lag reality.
**Fix:** End every contributor session with `pd feedback "<one-liner>"` (bare form) or `drop_feedback({ slug, summary, droppedBy })` from MCP, even (especially) if everything went smoothly — record what worked too. Friction patterns and frictionless patterns are both signal.

### Rewriting The Registry In Place
**Detection:** A DB consolidation, backup, restore, or berth-seeding script writes directly over `~/.port-daddy/port-registry.db`, skips dry-run by default, or archives fragments while a daemon still has any candidate DB open.
**Symptoms:** The live daemon keeps an old SQLite handle, `-wal`/`-shm` sidecars are orphaned, rollback depends on manual archaeology, or same-basename fragments overwrite each other in the archive.
**Fix:** Use the `lib/backup.ts` pattern: durable scratch under `~/.port-daddy`, a read-only source handle for `VACUUM INTO`, a staged destination file, `PRAGMA integrity_check`, archive the existing canonical DB family first, rename the staged DB into place, and roll back the old canonical DB automatically if install fails. Default the script to dry-run; require an explicit apply flag and fail closed when `lsof` shows a daemon holding a candidate DB.

## Worked Examples

### Example 1: Adding a new MCP tool

> Full step-by-step walkthrough with the actual diffs: `examples/01-add-mcp-tool.md`.

**Slice:** Add `pd_swarm_status` MCP tool that returns aggregate fleet health.

1. Worktree: `git worktree add ../port-daddy-$(date +%s)-mcp-swarm-status origin/main && cd $_`.
2. `pd begin "Add pd_swarm_status MCP tool" --identity port-daddy:contrib:mcp-swarm-status`.
3. Implement in `mcp/server.ts` (new tool registration).
4. Implement the underlying lib in `lib/swarm-status.ts` if not present. <!-- cite-exempt: illustrative role/template path -->
5. Update `scripts/mcp-handshake-test.mjs` — bump REQUIRED_TOOLS count and assert. <!-- cite-exempt: illustrative role/template path -->
6. Update `port-daddy-agent-skill/SKILL.md` "MCP Equivalents" list.
7. Update website `apps/website-v2/.../mcp-catalog.tsx` (or equivalent route). <!-- cite-exempt: illustrative role/template path -->
8. `pd actor lookout --message "NEW MCP TOOL pd_swarm_status: tested, surfaces updated."`
9. Commit with explicit paths; tag if this is part of a numbered release.

### Example 2: Renaming an internal actor

**Slice:** Rename `Lookout` to `Watchstander`.

This is enormous: it touches the public skill, this skill, every reference,
every actor message ever sent, the website, the CLI, the MCP. **Do not do
it in one commit.** Land the rename in phases through Cartographer:

1. `pd actor cartographer --message "PROPOSAL: rename Lookout → Watchstander. Scope spans 12+ surfaces. Suggest milestone breakdown."`
2. Wait for Cartographer to publish the milestone breakdown.
3. Land aliases first (both names work; Lookout is deprecated).
4. Migrate one surface per slice with Lookout's drift discipline.
5. Cut the Lookout name only after the public skill, website, and brew formula have shipped two consecutive versions with the alias.

### Example 3: Bumping the brew formula

**Slice:** Ship `v0.42.0`.

1. Worktree, identity, scope note.
2. Tag locally: `git tag -a v0.42.0 -m "<changelog summary>"`.
3. Compute tarball sha256: `curl -sSL <github tag tarball> | shasum -a 256`.
4. Update the **in-repo** primary `Formula/port-daddy.rb`: `url`, `sha256`, version-string-in-tests if present, post_install if `install.sh` changed. Then mirror the same change into the external tap repo (`homebrew-port-daddy/Formula/port-daddy.rb`) — both must match before the brew install command in step 5 will succeed for users.
5. `brew install --build-from-source ./Formula/port-daddy.rb` locally; confirm install path, daemon launches, `pd status` healthy.
6. `pd actor lookout --message "Brew formula v0.42.0 ready: <sha256>. Surfaces audited: README, CHANGELOG, website, skill bundle."`
7. Push the tag from port-daddy first, then commit + push the formula.

## Quality Gates (contributor)

- [ ] You worked in a worktree (not the main port-daddy checkout).
- [ ] You ran `pd guard check --staged`; it passed cleanly.
- [ ] You staged by explicit path; `git add -A` does not appear in your shell history for this slice.
- [ ] Every public surface affected has been updated in this slice OR a Lookout message names the gap.
- [ ] If you touched an internal actor's body, you updated the actor-roster reference and the matching `decisions/` entry.
- [ ] If you renamed or removed a CLI / API / MCP surface, you provided a migration path and a deprecation window.
- [ ] You did not edit `docs/recovery/CURRENT-WORK.md` directly.
- [ ] You ended with `pd done` AND `pd feedback "..."` (CLI bare form) or MCP `drop_feedback`.
- [ ] If you skipped any of the above, you owned up to it explicitly in the feedback.
- [ ] You ran `windags_skill_search` for the slice's domain before starting.
- [ ] **Two-skill maintenance check.** You asked: "did the public `port-daddy-agent-skill` or this internal skill mislead me, mis-instruct me, or under-equip me?" If yes, you landed the fix on the correct surface (public vs. internal — see "Maintain These Skills") *in the same slice*. Drive-by edits are explicitly welcome; no separate ticket required.
- [ ] You did NOT propagate internal-only wisdom into `port-daddy-agent-skill` (that's the public skill's split-decision rule).

## Sources

- ADR 0001 — Background-Agent Git Discipline.
- `port-daddy-agent-skill/SKILL.md` — public companion this skill extends.
- `lib/shipwright/` — internal skill-bundle ingestion + classification (the contributor-facing "Shipwright" concept).
- `routes/cartographer.ts`, `routes/spawn.ts`, `routes/sessions.ts` — actor route ownership.
- `references/release-surface-drift-protocol.md` (this skill) — the full mirror-update walk.
- `references/git-discipline-internal.md` (this skill) — port-daddy-specific git extensions.
