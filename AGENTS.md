# AGENTS.md

Project-specific shibboleths for proficient Port Daddy work. If you learn a new one that materially changes how to operate this repo, add it here immediately.

## Recently Shipped Surfaces (verify before you depend on them)

These landed on `main` in the last few weeks. The installed Homebrew `pd` binary **lags `main`** — a feature being in source does not mean it is in the operator's `pd`. Run `pd <verb> --help` to confirm, and rebuild + relaunch the daemon when dogfooding a just-landed route. Canonical docs are cited; read them, do not paraphrase from memory.

- **Relay — cross-machine pub/sub** (`docs/adr/0049-relay-architecture.md`). Zero-trust event fabric: a Cloudflare Worker (`apps/relay/`) federates channels across machines; the daemon holds an outbound SSE connection (`lib/relay-client.ts`), routes in `routes/relay.ts`. CLI: `pd relay url <url> | --clear`, `pd relay status`, `pd relay exchange --oidc-token <t>` (CI OIDC → PD card). MCP: `relay_status()` (read-only).
- **Dispatch — autonomous feature-dev queue** (ADR-0035; `cli/commands/dispatch.ts`, `lib/dispatch/runner.ts`, `lib/dispatch/spawn-adapter.ts`, `docs/proposals/pd-nightshift.md`). `pd dispatch propose|queue|list|show|run|cancel`. `run` is **dry-run by default**; `--really-run` spawns a backend (default `cli:codex`) in an isolated worktree under `~/coding/tmp/port-daddy-dispatch-<id>` and opens a **draft PR**. Per-dispatch `--budget` (default 5 USD, max 25) and `--timeout` (default 3h, max 6h). `pd nightshift` is a **deprecated alias** for one minor version — `pd dispatch` is the verb.
- **Coast Guard — OS-sandbox confinement + compulsion rent** (`docs/adr/0050-coast-guard.md`; `lib/coast-guard.ts`, `lib/coast-guard/compulsion.ts`). Every spawned subprocess is confined (Seatbelt on macOS, bubblewrap/Landlock on Linux), managed secrets scrubbed from the child env, hard egress cap (`402 Spend Cap Exceeded`); wired into `lib/spawner.ts` as the default. The compulsion: an un-noted commit blocks the next commit (`requireNotePerCommit`); a silent, drifted sandbox becomes reclaim-eligible but reclaim never touches the live main checkout. Read path: `pd coast-guard status` (alias `pd cg`).
- **Attest — honest self-report** (ADR-0045; `cli/commands/attest.ts`, `lib/attest.ts`). `pd attest` exits NON-ZERO when any CRITICAL invariant fails (safe for boot/CI gates); `pd attest --json` for the merged report. No subcommands.
- **Tube — conversational pipe over channels** (`cli/commands/tube.ts`). Multi-subscriber, relay-independent. `pd tube <channel>` listens; `--send`, `--reply`, `--once`. Prefer a persistent tube channel over point-to-point inboxes for agent↔agent back-and-forth — see `## Architecture truths` below.
- **Rust surfaces** (in `core/`): the kernel is landed at `core/kernel/` (pd-anchor / pd-mesh / pd-eventlog / pd-runtime / pd-core / pd-compat / pd-tui / pd-rs), alongside `core/pd-broker` (ADR-0087 TCB), `core/harbor-card-rs` (FFI), `core/pd-bosun`, and `core/pd-console` (GPUI operator console). **ADR-0120 is the standing boundary rule**: security primitives once, in Rust, FFI-reached, fixture-gated where FFI can't reach (Workers); product planes stay TypeScript on purpose; the console is Rust for GPU, not crypto. Reconcile against ADR-0120 and the pd-console lane rules before scaffolding any new Rust crate.
- **Design-stage / in-flight (do NOT document as shipped):** marketplace (ADR-0051), trajectory export + RL loop (ADR-0052), out-of-band enforcement / "DOM DADDY" (ADR-0053, in-flight PR #366), and a release-cadence + Rust-surface-alignment ADR (ADR-0054, being written in parallel — the canonical answer to "is this in my installed `pd`?" once it lands). These are not on every branch; reference by number, do not invent their verbs.

The PR review gate is **backend-agnostic**: any Port Daddy fleet agent — any backend, not specifically Claude — acting adversarial, skeptical, and PM-minded. Respond to every Copilot / bot review comment; create tests where you can. See `## Pull Request Operating Procedure`.

## Operator vs Agent — know which surface you are

The CLI is for agents and emergencies. **The operator does not run `pd` commands, does not edit `.env.local` files, does not run `launchctl kickstart`, does not tail logs.** That work is yours.

The operator's surface is the **FleetBar app and the dashboard at `localhost:9876`** — buttons, panels, deep-links to provider token pages. If the operator has to drop to a terminal to do something routine (configure credentials, restart the daemon, see open feedback, harvest a roadmap entry, see why the fleet is silently failing), that is a product bug — file it as `high`-severity feedback on the `FleetBar` surface so cartographer promotes it to the roadmap.

Concretely:
- Secrets live in the macOS Keychain, surfaced through a FleetBar Credentials panel with deep links to the provider's actual token page. No `.env.local`. (See open feedback `fleetbar-secret-management-with-provider-deeplinks`.)
- Daemon health and restart are buttons in FleetBar, not `launchctl` incantations.
- Roadmap, open feedback, fleet status, salvage queue — all visible in the dashboard's panels, not via grep on log files.
- The UI must support zoom and OS text-scaling (Dynamic Type on macOS, browser zoom on the web). Minimum 14px body text. Never `user-scalable=no`. See open feedback `fleetbar-console-must-support-zoom-and-text-scaling`.

Agents read this file. Operators do not. If an agent's instructions push a CLI command at a human, the instruction is wrong; rewrite it to point at the FleetBar/dashboard surface, and file the gap as feedback if no surface exists yet.

## Skill maintenance is part of every slice

The two Port Daddy skills are the operating instructions for *all* future agents working in port-daddy-protected projects. Treat them as load-bearing code:

- **`skills/port-daddy-agent-skill/SKILL.md`** — the public skill. Edit when the lesson would help any agent on any project (new verb, deprecated flag, anti-pattern, decision-table gap, inefficient worked example, stale or wrong content).
- **`skills/port-daddy-internal-dev/SKILL.md`** — the contributor-only skill. Edit when the lesson is specific to editing *this* repo (release ceremony, internal actor embodiments, drift protocol, worked contributor examples).

You are explicitly invited to fix errors, sharpen inefficient passages, and add anti-patterns the moment you notice them — no issue, ticket, or permission required. Same-slice edits (landing the doc fix alongside the code change that revealed the problem) are the default; retrospective edits days later are still owed and welcome. Both skills carry their own "Maintain These Skills" sections with the small ceremony (worktree, explicit-path staging, tests, Cartographer ping). Internal agents working on port-daddy itself own *both* surfaces continuously — split-decision rule lives in `port-daddy-internal-dev`.

## Search & Matching Policy — hybrid, one shared embedder

Operator directive (2026-07-04). Any search, matching, or classification over unstructured text — in a skill, a lib, a script, or the daemon — follows two rules:

1. **Never ship lexical-only search.** BM25/TF-IDF alone is the floor, not the ship gate. Pair it with semantic similarity and fuse (RRF or equivalent). Keyword/substring lists remain banned outright.
2. **One embedding model for everything.** The canonical local model is `Xenova/all-MiniLM-L6-v2` in the shared cache `~/.port-daddy/transformers-cache` (ADR-0061). TypeScript reuses `createLocalEmbedder()` from `lib/semantic-resolver.ts`; everything else (Python skills, shell scripts) shells out to **`pd embed`** (`text`/`stdin` → normalized 384-dim vectors as JSON; `status`/`prefetch` manage the cache). Do not introduce a second model, a per-skill model choice, or a remote embedding API for local matching.

Lifecycle: `pd setup` offers the one-time ~27 MB download (cancellable); `pd doctor` detects a missing model and offers the same fetch as a repair; `pd embed prefetch` is the manual path. Degrading to lexical-only is allowed **only** as an explicit fallback that warns and points at `pd doctor`.

## Port Daddy First

- On this computer, use Port Daddy for repo work by default, not only when a task already looks multi-agent.
- Start recovery, debugging, and parallel-work sessions with Port Daddy before doing local archaeology:
  - `pd attention` — **first command of every session.** Reads unread inbox + subscribed channels in one call, marks them seen. Without this, other agents can route messages, file conflicts, or coordination signals at your agent id and you will never see them. The Claude Code SessionStart hook in `.claude/settings.json` runs this automatically and pins the output into context; for other harnesses, run it manually.
  - `pd status`
  - `pd sitrep --template` to synthesize the current state
  - `pd briefing`
  - `pd salvage` when crash residue or abandoned work might matter
  - `pd begin --identity <project>:<task>`
  - `pd plan set "- [ ] My plan"` to define the steps required for the task. You must maintain this plan and use `pd plan check` as you make progress.
- If you are going to edit files, coordinate through Port Daddy primitives, not only prose:
  - leave a `pd note` describing scope and intended files
  - prefer symbol/region claims for code edits when the symbol index knows the file; use whole-file claims only when the edit truly spans the file or no symbol/section identity exists
  - use `pd lock` / `pd with-lock` for scarce critical sections, generated artifacts, migrations, promotion, or other work that really must be exclusive
  - use tuples, inbox, pheromones, or other shared state when the task benefits from machine-readable coordination
- New edit sessions should start from a linked Git worktree. `pd begin` and
  `pd session start` refuse the main worktree by default; use
  `--allow-main-worktree` only for explicit integration or release work where
  the main checkout is the point.
- Treat plain shell inspection without a Port Daddy session as insufficient for this repo unless you are doing truly trivial read-only work.
- During active repo work, keep listening. Re-read live `pd notes`, `pd activity`, `pd sessions --all-worktrees`, and relevant file ownership before switching scope, before editing a contested surface, and after daemon/session restarts. A stale local plan is not coordination.
- Treat multi-day resumes as continuity work, not a fresh vibe reset. If the same user goal, worktree or successor worktree, branch lineage, and touched surface are still in flight, resume or explicitly link to the old session instead of inventing a new isolated purpose. If the prior session is stale, abandoned, or cannot be made active, start a new session with the same identity family and put the old session id in the first note.
- Re-anchor before editing when a session crosses a calendar day, after a compacted conversation resumes, after daemon/session drift, or whenever the worktree is behind the canonical branch. The re-anchor pass is: `pd status`, `pd briefing`, `pd sessions --all-worktrees`, `pd notes --limit 20`, `pd salvage --project <project> --limit 20`, `git status --short --branch`, and `git fetch origin` unless fetching would disrupt the current operation.
- A re-anchor note must be concrete enough for another agent to continue without transcript archaeology: old session id, new session id if any, identity, worktree, branch, base drift from `origin/main`, dirty files or claimed files, last validation that is still trusted, validation that is stale, current blockers, and next intended edit.
- Do not reuse an old session just because the "vibe" feels the same. Start a new linked session when the user goal changed, the previous slice was completed or merged, the branch/worktree no longer descends cleanly from the old work, or continuing would mutate unrelated surfaces. Preserve continuity by linking the predecessor in the note, not by overloading the old purpose.
- Prefer explicit session ids for notes and file claims after drift. If `pd whoami`, implicit active context, TCP port-file routing, and direct session storage disagree, name that as a coordination bug, leave the best available durable evidence, and either fix the bounded runtime bug or proceed only with a clearly scoped note about the degraded coordination path.
- Before every commit, push, or deploy, fetch and reconcile against the canonical remote branch (`origin/main` for this repo) so you do not publish stale work over another agent's moved surface.
- When handing work to another agent, give it the live Port Daddy identity/session anchor and tell it to coordinate through briefing, salvage, notes, claims/locks, and tuples instead of “being careful.”
- If dogfooding exposes a Port Daddy bug, fix it while it is fresh when the slice is bounded and safe. If it is not bounded, leave a failing repro or exact evidence, a `pd note`, and a targeted actor message before switching away. Framework friction is product feedback and often product work, not an annoyance to route around.
- If Port Daddy coordination primitives disagree with each other, for example active sessions exist but active-context lookup or file-claim commands say no active session, stop treating that as incidental CLI friction. Re-anchor safely, leave exact evidence in notes, and either fix the coordination bug immediately if bounded or file a targeted handoff before continuing feature work.
- Coordination Guard is expected in enforce mode for this repo. If `pd guard status` is missing, advisory, or stale, run `pd guard install --mode enforce` before editing toward a commit. Before every commit, push, or deploy, fetch the canonical remote branch, rebase or merge current work onto it (`origin/main` here; `origin/master` only when that remote branch exists), re-read `pd sessions --all-worktrees`, `pd notes --limit 20`, activity, and relevant ownership, then run `pd guard check --staged`.
- Durable handoffs go into Port Daddy notes, actor inboxes, tuples, or scoped channels. Chat-only coordination is not enough.
- Agent-CLI coordination hooks: `pd hooks install` (run by `pd init`/`pd setup`) wires the Giant Squid Harness tentacles into the **interactive** sessions of `claude`/`codex`/`gemini`/`agy` for the current project. Wiring is **per-project** (claude/gemini config lives in the repo; codex/agy are user-level) and **daemon-gated** — every hook routes through a wrapper that no-ops unless the daemon is running and the cwd is inside a `.portdaddy/` project, so hooks never fire machine-wide or when Port Daddy is down. Hook shapes are defined once in `lib/squid/hook-shape.ts` and shared by the headless squid adapter and the interactive installer so they cannot drift. Codex needs a one-time `/hooks` trust. Remove with `pd hooks uninstall`. The one-command toggle is `pd squid on` / `pd squid off` (adds the `◆ PD` statusline identity, the Pilot SessionStart steering hook, and the `/squid` in-session command); inspect the live background machinery with `pd squid status` and preview the next-turn injection with `pd squid tap`.

## Ambient Collaboration

- Do not force agents into constant direct chat. Default collaboration should be ambient and structured:
  - publish scope, assumptions, touched files/symbols, validation, blockers, and handoffs through `pd note`
  - use claims/regions for edit intent, tuples for machine-readable facts, scoped channels for event notifications, and actor inboxes for durable role ownership
  - use pheromones/file heat for contention signals, not ordinary progress narration
- **Target: durable role ledgers augment notes.** Notes remain immutable evidence;
  role ledgers are curated projections that future intelligent briefings can read
  for codebase context, operator preferences/interaction style, current
  coordination truth, and cross-repo tactics. Keep authority explicit: local-only
  facts stay local unless sync is enabled; operator preference entries need
  provenance, redaction, account/team scope, and staleness metadata.
- Coordination means thinking about each other's goals, not merely avoiding file collisions. If another session's assumptions, API shape, release surface, runtime state, or product goal changes what you are doing, tell that agent or the relevant durable actor and adjust your plan.
- Escalate to the user only for material inconsistencies:
  - two active sessions appear to own or mutate the same scarce surface
  - a UI/UX, planning, roadmap, docs, or skill decision in one slice conflicts with another slice
  - a slice violates an implied operator goal even if it has no local bug
  - security, auth, privacy, data-retention, trust-boundary, or API-shape assumptions diverge across slices
  - one feature exposes raw text, unauthenticated data, weak tokens, or unreviewed side effects while adjacent work implies authenticated/secure API guarantees
  - live daemon/runtime truth disagrees with source/docs/control-plane truth
  - an agent is stale, orphaned, or marked active in one surface and dead in another
  - a budget/spawn/readiness policy would activate more fleet work than the situation justifies
- Think at the goal/invariant level, not just the bug level. If the user is building secure API surfaces in one thread, flag nearby raw or unauthenticated API work as a likely inconsistency even if the user did not explicitly ask whether that endpoint should be secured.
- Durable actors own this escalation layer:
  - Coxswain watches claims, locks, stale assets, and symbolic coordination
  - Navigator/Cartographer watches roadmap, recovery-ledger, work-slice, and status-map drift
  - Lookout watches docs, README, OpenAPI, SDK/MCP/CLI references, skills,
    website, Mac app/FleetBar documentation, and product-truth drift
  - Quartermaster watches spawn discipline, model/backend readiness, and spend
- Use `coordination:inconsistency` as the worktree-scoped callout channel for operator-worthy conflicts. Routine progress belongs in notes, not that channel.
- If the infrastructure cannot prove agents are talking, make that visible. “Active sessions” plus “zero live registered agents” is itself a coordination inconsistency, not a healthy fleet.

## Symbol And Region Claims

- Do not default to whole-file ownership for code files if the work is naturally function/class scoped.
- Current truth: Port Daddy has AST-backed `symbolPath` region claims in the session API/SDK, and CLI/MCP pass-through affordances for region claims. Symbol discovery and freshness are still too manual; treat that as UX/tooling debt, not product intent.
- For code edits with likely overlap:
  - inspect available symbols with `/symbols?file=<absolute-path>`; parse first with `POST /symbols/parse` if the file is stale or missing
  - claim `{ path, symbolPath }` through `POST /sessions/:id/files` or the SDK `claimFiles(..., { regions: [...] })`
  - fall back to explicit `startLine`/`endLine` only when no canonical `symbolPath` exists
- If you do not know the exact functions yet, start with a narrow note plus the smallest plausible whole-file claim, then refine to symbol/region claims as soon as inspection identifies the touched symbols.
- Stale symbol indexes are coordination hazards. If claim resolution says a `symbolPath` is missing or stale, refresh the symbol index before widening to a file claim.
- File claims remain advisory. Locks are stronger and should be rarer: use them for non-mergeable resources, not as a substitute for symbol-level edit intent.

## Canonical Runtime

- **Full topology map: [`docs/operations/daemon-and-supervision.md`](docs/operations/daemon-and-supervision.md)** — the TWO `pd` installs (Homebrew runs the live daemon + is your default `pd`; the repo is dev-only), every supervisor/watchdog (`homebrew.mxcl.port-daddy`, `com.portdaddy.bosun`, the rival `com.bosun.daemon`), and the ONLY correct redeploy path. Read it before any daemon surgery — it exists because agents keep re-discovering this the hard way.
- Do not assume the live daemon is running the current checkout.
- Verify live truth with:
  - `port-daddy status`
  - `launchctl print gui/501/homebrew.mxcl.port-daddy` (the canonical supervisor; `com.portdaddy.daemon` was removed 2026-06-01)
  - `curl -sS "$(cat ~/.port-daddy/daemon.port 2>/dev/null | sed 's#^#http://localhost:#')/fleet"` or the daemon URL surfaced by `port-daddy status`
- `port-daddy status` proves the Unix socket path works. It does not prove the TCP/browser path works. If the control plane or FleetBar is lying, verify both the socket client and the TCP URL from the port file.
- If those disagree, trust the live process and launchd output, not docs or memory.
- There should be exactly one canonical daemon on `9876`.
- If another Port Daddy daemon is already sitting on the canonical socket/port, treat it as replaceable stale runtime, not sacred state.
- Extra daemons are only acceptable when they are explicitly opt-in on different ports/sockets/prefixes.
- Check the shell shim too: `which port-daddy` and `realpath`/symlink inspection can still point at an old checkout even after the daemon is promoted.
- A promoted canonical daemon plus a stale global CLI shim is an inconsistent operator state; relink the CLI if you intentionally move the canonical runtime to a different checkout.
- Freshness auto-restart is only allowed for interactive commands from the same install root as the live daemon. Background/watcher/MCP commands and foreign-checkout invocations must not decide they are entitled to SIGTERM the canonical daemon.
- If you change runtime-serving code (`server.ts`, `routes/`, `lib/` runtime paths, CLI commands that hit daemon routes), rebuild and relaunch the daemon before trusting any dogfood result. Source truth without a daemon restart is not operator truth in this repo.
- If a command exists in source but the installed CLI gets `Not Found`, suspect a stale daemon or stale `dist/` before assuming the feature is imaginary.
- Very long daemon uptime after runtime-route work is a smell. If the daemon has been up for hours and new routes/surfaces are “missing,” verify build + restart first.

## Agent Operating Expectations

How you are expected to *work* a slice here — the standing posture, not a per-task
checklist. These extend (don't repeat) `## Port Daddy First`, `## Skill maintenance
is part of every slice`, `## Operator UX Expectations`, and `## Writing Technical
Documents`.

- **Supplant, don't migrate (operator directive, 2026-08-22, VERY IMPORTANT).**
  Port Daddy has no users yet. When a new feature or mechanism overlaps an old
  one, the new one REPLACES the old exhaustively in the same slice: delete the
  legacy code path, update every caller, and leave behind no compat shims, no
  feature-flagged "legacy mode", no downgrade fallbacks, and no deprecation
  windows. Backwards compatibility is built ONLY when the operator explicitly
  asks for it, per surface, in their own words. Origin incident: the
  2026-08-22 identity-write-boundary review, where a "loud legacy downgrade"
  path that still admitted self-asserted identities was rejected — enforcement
  is theater as long as the legacy path survives.

- **Never assert a competitor/platform claim without researching and citing it
  (operator directive, VERY IMPORTANT).** Before you state what a competitor or
  external platform can or can't do — a Cloudflare/OpenAI/GitHub feature,
  a model's price, an API's shape — research it against the live source and
  include the citation URL. Do not answer from memory or stale receiver code; both
  go out of date. Two real misses this rule exists to prevent: claiming Workers AI
  "has no prompt caching" (it does — prefix caching, per
  <https://developers.cloudflare.com/workers-ai/features/prompt-caching/>), and
  quoting `@cf/qwen/qwen2.5-coder-32b` at "$0.09" when the
  [pricing page](https://developers.cloudflare.com/workers-ai/platform/pricing/)
  says $0.66/$1.00. If you can't cite it, say you're unsure and go look.
- **Coordinate, and pay rent.** Work in a clean linked worktree off
  `origin/main` (§ Create / Update / Land), never the operator's main checkout.
  `pd begin --identity … --lifecycle durable` → scope `pd note` → `pd session
  files add` before editing → `pd done` at the end. Rent is real: every commit
  carries a `pd note` (the Coordination Guard's `requireNotePerCommit` /
  Coast Guard). A silent agent is a non-durable agent.
- **Establish a Plan and check off milestones.** Every agent must plan. After calling `pd begin`, you must run `pd plan set "- [ ] Step 1\n- [ ] Step 2"` to register a todo list before touching files. Update the plan with `pd plan check <index>` as you work. The `pd done` command refuses to close a completed session while checklist items remain; finish or explicitly abandon the session instead of manufacturing an override.
- **Run `pd sitrep` when starting or resuming work.** Call `pd sitrep` at the beginning of each turn or session to catch up on what happened while you were away.
- **Dogfood, and dogfood *novelly*.** Reach deep into the CLI, MCP, and SDK each
  slice; deliberately exercise a surface you have not used before instead of
  living on `claim`/`note`/`done`. File feature feedback as you go. When a
  genuinely novel gambit finally works — especially after a run of failures —
  write it down: the public `skills/port-daddy-agent-skill` if any agent on any
  project could reuse it, the internal `skills/port-daddy-internal-dev` if it is
  repo-specific. A win nobody recorded did not happen.
- **Assume every feature is broken until you watch it work.** A zero exit code is
  not proof. Confirm the write landed where you think (right DB, right harbor,
  right channel, right worktree-scoped name), then that it is read back from that
  same place, then that it survives the hard cases: cold start (daemon down → the
  first command must *instruct the operator elegantly*, not stack-trace), git
  operations, linked worktrees, a second user on the same box, and GitHub
  round-trips. Read the row back before you believe it.
- **Confirm the telemetry trail.** A call you cannot see did not durably happen.
  Check that CLI / MCP / SDK / tool calls land in both raw usage statistics
  (`pd usage`) and explicit transcript saves (`lib/transcripts.ts`), and that
  durable state rides the intended Cloudflare fabric (relay / R2 / D1 / KV via
  `lib/relay-client.ts`) so posterity is stable and cheap. Prove the read-back
  from durable storage; do not assume persistence.
- **Build for any repo, not just this one.** Port Daddy is not a tsx/Rust tool and
  not a port-daddy-only tool. A new feature must generalize to other languages,
  other machines, remote harbors, shared users, and GitHub-mediated teams. If a
  design only works in this checkout, it is wrong — same root as the Agent-neutral
  killer item.
- **GUIs: assume you are bad at them.** Claude and Codex ship clumsy UI by
  default. Before committing pixels to any FleetBar / console / website surface,
  go get reference, the house design system, and human feedback, and make it feel
  professional and hand-built. The visual-artifact gate proves it *renders*, not
  that it is *good* (§ Operator UX Expectations).
- **Avoid AI tropes; humanize.** No "Certainly!", no hedge-everything prose, no
  manufactured confidence, no em-dash confetti. Use the `make-human` skill and
  keep the customer-personae skill in agreement. Write like the person who
  maintains this repo.
- **Mind the whitepapers.** Before shipping coordination/kernel work, check it
  against the seven Port Daddy whitepapers — the canon registered in
  `website-v2/src/data/whitePapers.ts` (Legible Swarm, Single-Writer Kernel, Spawn
  to Person, Harbor Economy, Anchor Protocol, Bonded Commons, Federated Harbor;
  sources + PDFs under `website-v2/public/whitepaper/`): have you drifted from the
  model, or built something a paper should now describe? They need not be 1:1 — the
  papers are the lofty theory, the code is what we actually shipped — but each
  should correct the other. Note drift in the PR.
- **Work at maximal tool + skill access, and pause to find the right skill.** Start
  with the broadest toolset you can reach. If you catch yourself working without a
  matching skill, stop and run `pd jury-rig query "<task>"` before improvising
  what a skill already encodes. Jury-rig is Port Daddy's native hybrid discovery
  surface: it ranks the local, explicitly configured catalog and reads requested
  references through the guarded `pd jury-rig reference` path. A third-party skill
  remains provenance-labelled catalog input; its scripts, hooks, MCP servers,
  subagents, and planning pipelines never become executable authority merely
  because Jury-rig selected it. Planning authority remains this guide plus the
  session's `pd plan`. **Seamanship** is the planned native planning/orchestration
  module and is not yet a shipped verb; until it lands, do not register or invoke
  an external planning runtime as a substitute.
- **Launch other agents *through* Port Daddy.** When you need more hands, spawn
  them through PD's own fabric — `pd agent` / `pd sortie` / `pd dispatch` and the
  tube → spawner router (conductor) — never a raw side-channel, so the work is
  registered, sandboxed (Coast Guard), budgeted, and salvageable.
- **Managers orchestrate; workers author PRs.** A manager lane should not become
  an unregistered solo contributor. Delegate implementation edits, PR body
  drafting, and PR authoring to worker sessions; the manager reads returned
  artifacts, checks evidence, steel-mans the strongest case against shipping,
  retunes roles by round, and decides whether the work advances.
- **Keep durable roles briefing-ready.** When a Pilot or named role maintains a
  ledger, treat it as a curated projection over notes, not a replacement for
  notes. Privacy, authority, and staleness metadata travel with the entry.
- **Keep the README current.** When a slice changes a surface an operator or
  contributor reads about, update `README.md` in the same PR — a stale README is a
  caught lie just like a stale citation. This is now enforced at commit time:
  the pre-commit hook runs `scripts/check-readme-freshness.mjs`, which blocks a
  commit that stages `cli/permission-tiers.ts`, `mcp/server.ts`,
  `docs/openapi.yaml`, `pd-fleet.yml`, `features.manifest.json`, or a NEW
  `cli/commands/` file without a staged README.md. If the change is genuinely internal, bypass with
  `PD_README_OK=1 git commit …` (the bypass is logged). The README's title
  version is a synced surface (`scripts/sync-version.ts` +
  `check-version-drift.mjs`), so never hand-edit the version number.

## Pull Request Operating Procedure

**This lifecycle is autonomous — never gated on operator confirmation.**
Once you open a PR, you drive it all the way to merge without pausing to
ask "should I push?" or "should I merge?". Solicit bot reviews, run the
adversarial agent review, respond to every comment, add unit tests wired
into CI, get CI green the right way, and merge. The only legitimate pause
is a real red you cannot fix unilaterally (missing secrets, infra outage).
Operator, 2026-06-11: "Why are you waiting on me? Why do I have to tell
every Claude this?" — don't be the Claude that has to be told.

**Two PR-body checks are REQUIRED and fail closed — fill them in or the PR is
bounced (it cannot enter the merge queue):**

1. **`pr-requirements-guard`** — the body needs a real `## Summary` (≥10 words of
   prose) and `## Test Plan` (≥12 words: commands + their output), plus a
   screenshot + a GIF/recording for any visual-surface change, plus a **changelog
   fragment** for any user-visible change. Self-check before pushing:
   `npm run check:pr-requirements -- --body-file <draft.md>`.
2. **`roadmap-link`** — the body needs exactly one `Roadmap-Item: <slug>` trailer
   (or `Roadmap-Item: none — <reason>` for a chore/docs/hotfix). No slug yet?
   `npx tsx scripts/roadmap-link.ts <pr-number>` creates the item and stamps it.

The PR template (`.github/PULL_REQUEST_TEMPLATE.md`) pre-stubs both — keep the
headings and the trailer line, fill in the prose. Both report on `merge_group`
as pass-throughs, so a PR that is green at PR time never hangs the queue.

**Never hand-edit `CHANGELOG.md`'s `[Unreleased]` section.** It is ASSEMBLED at
release time from one file per PR under `changelog.d/`. Write
`changelog.d/<pr>-<slug>.md` (or `draft-<slug>.md` before you have a number) —
format and rationale in `changelog.d/README.md`, validate with
`npm run check:changelog`. This exists because every PR used to insert its bullet
at the same line 11 of the same file: two branches cut from the same base conflict
on nearly every pair, and a resolver taking "ours" silently drops the other PR's
entry with nothing failing. One file per PR removes the conflict entirely. If a
change genuinely ships nothing a user would notice, put
`<!-- changelog-exempt: <reason> -->` in the body; the reason is required.

**Branch protection on `main` is a ruleset** (`main merge queue`, id `17604542`),
not classic protection — 18 required checks with `strict` off, merge queue
(REBASE), linear history, and an admin `pull_request` bypass valve (never remove
it: a stuck required check would otherwise freeze every merge). Full runbook:
[`docs/operator/branch-protection-ruleset.md`](docs/operator/branch-protection-ruleset.md).
Two rules learned the hard way when touching it:
- **Edit the ruleset with `PUT`, not `PATCH`** — `PATCH` returns a misleading
  `404`. Build the full body from a live `GET` (a partial body wipes the required
  checks). The operator runs the mutation via `!` (auto-mode blocks ruleset edits).
- **Never require a workflow filtered only by `on.*.paths`** — it never reports on
  unrelated PRs and freezes the queue. A required workflow must also trigger on
  `merge_group` (always-run, or skip = pass). `proofs`, `whitepaper-build`, and
  `whitepaper-metadata` are now `merge_group`-safe for exactly this reason.

Every PR opened in this repo MUST go through skeptical adversarial review
before merging. The author cannot self-approve by typing "looks good." The
flow is:

1. **Open the PR.** Branch claimed via `pd begin --identity` + `pd session
   files add ...`. CI must be green (or you must explicitly justify each
   red check in the PR body).
2. **Spawn a skeptical reviewer agent.** An always-on neutral adversary already
   runs in CI on every PR — the `claude-adversarial-review` workflow, which
   assumes laziness/slop/lies/corner-cutting and ends with a
   `SHIP / SHIP-AFTER-FIX / DO-NOT-SHIP` verdict (note: GitHub's action-validation
   rule skips it on the PR that first introduces it — run your own there). For
   non-trivial changes, ALSO spawn your own: use the `feature-dev:code-reviewer`
   subagent type (or `auditor` for whole-codebase concerns). Brief it with
   the PR's context, the change's invariants, the failure modes you're
   worried about, and SPECIFIC hunting prompts ("could this leak X? does
   this handle symlinks? what about Windows path separators?"). Demand a
   verdict prefix: `SHIP / SHIP-AFTER-FIX / DO-NOT-SHIP`. Cap word count so
   you get signal, not a wall of text.
3. **Address every HIGH-confidence finding** as a fixup commit on the
   branch. Don't squash until merge. Each fixup commit message names the
   finding it addresses so the audit trail survives.
4. **Comment on the PR** with what changed, the validation evidence
   (test counts, `tsc --noEmit` exit, focused jest output), and an explicit
   line for each reviewer finding marked done / deferred / contested-because.
5. **Treat bot comments as real review findings — fleetbot included.** The
   `port-daddy-fleet` bot (a.k.a. fleetbot) posts `[pd-code-reviewer]` and
   `[pd-qa]` threads on every PR; these are first-class review findings, NOT
   background noise — the same goes for Copilot, Claude review, Cloudflare
   Pages, CodeQL, release, and the `roadmap-link-gate` GitHub Action. Read
   every bot comment, and reply to every actionable thread with fixed /
   deferred / contested-because, and push a fixup commit for every valid
   high-confidence finding before asking a human to look. Do not declare a PR
   done while a `port-daddy-fleet` or other actionable bot thread sits
   unanswered. Operator, 2026-06-23: "Why did you ignore fleetbot?" — the
   answer must never be "I didn't read its comments."
6. **Get the full CI/CD surface clean.** "CI is green" means the GitHub
   matrix, review checks, deploy previews, release/package jobs, and external
   statuses attached to the PR are green. If a red status is truly external,
   inspect the linked logs, name the external owner/root cause in a PR
   comment, and leave a `pd note`; otherwise fix the repo branch.
7. **Re-spawn the reviewer** (or a fresh one) if the change set is
   non-trivial. Don't ship with a stale verdict.
8. **`pd note` the result + `pd done`** before merge. The PD audit trail
   is part of the ship contract — a merge without it is not durable.
9. **Merge in the right order.** When PRs stack (e.g. a doctor PR bases on
   a binary-daemon PR), merge the base first, rebase the dependent onto
   `main`, re-run CI, then merge.

Skeptical review is parallelizable: when multiple PRs are in flight, fire
the reviewer agents in a single message so they run concurrently. Always
read the diff yourself before delegating — the reviewer can't catch what
you don't brief it on.

For multi-PR ship campaigns, track the state in `TaskCreate` so the merge
sequence is explicit. The user can interrupt at any boundary; the task
list is the recovery surface.

### Migration and removal land together (operator directive, 2026-08-22)

**A PR that adds a replacement removes what it replaces, in the same PR, with
the tests still passing.** Not "addition now, removal in a follow-up." The
follow-up is what never happens, and two implementations of the same thing is
the condition every parsimony rule in this file exists to prevent.

Three obligations, all of them before the fact:

1. **Write the tests first, for BOTH sides.** Complete, non-tautological,
   comprehensive, adversarial tests for the thing being created *and* for the
   thing being replaced. "The old tests still pass" is not coverage of the old
   behaviour — old tests were written against the old implementation and often
   pin its accidents rather than its properties. Write the tests you would want
   if you had to defend the swap to someone who thinks it is a regression.

2. **Name the losses, plainly, in the PR body.** A replacement almost never
   does everything the old thing did. **That is allowed.** What is not allowed
   is discovering it later. List what the old path could do that the new one
   cannot, and say so as a decision rather than an oversight.

3. **Behavioural identity is NOT required.** Do not contort the new thing into
   bug-for-bug compatibility with the old one. If the old behaviour was wrong,
   the new behaviour should be right and the difference should appear under
   "losses" — or under "fixes". The operator's words: *"Call out losses that
   are just gone now. Those are OK, too. No need for identity."*

The failure this closes: a PR lands a new module, claims N consumers, and has
zero — because migrating the consumers was the deferred half. The new module
then rots beside the old paths it was supposed to retire, and the next agent
finds two ways to do one thing and picks the wrong one.

If the removal genuinely cannot land in the same PR — the call sites are in
another language, another repo, or another PR — say so in the body, name every
site by path, and do not describe the replacement as adopted. A projection with
no consumers is a projection with no consumers.

### Respond to every review comment — no silent ignores

A review comment is a question you owe an answer, not a notification you may
swipe away. **Before a PR merges, every review comment — inline diff thread or
top-level, human or bot (Copilot, the Claude code-review / adversarial reviewer,
FleetBot `[pd-*]`, CodeQL, Cloudflare) — must get a substantive response.** That
means one of:

- **Fixed** — you changed the code; say what you changed (and ideally link the
  fixup commit), then resolve the thread.
- **Deferred** — not now, with a reason and where it's tracked (issue / roadmap
  item / follow-up PR). "Later" without a destination is ignoring it.
- **Contested** — you disagree; say *why*, specifically, citing the code or the
  invariant. A reviewer can be wrong — but you have to make the argument, not
  stay silent.

What does **not** count: resolving a thread with no reply, a one-word "done" with
no evidence, closing the PR to dodge the comment, or letting a bot finding scroll
off the page. "Seriously" is load-bearing — engage the substance.

**Auto-pilot (operator directive, 2026-07-07).** When you are subscribed to a
PR, work the review comments *autonomously* — do not ask permission each round.
Triage every incoming comment yourself: fix + resolve the legitimate ones (push
the fixup, resolve the thread), resolve duplicates / already-addressed /
hallucinated findings with a one-line reason, and skip pure-noise notifications.
Only pause to ask the operator when a comment is genuinely ambiguous or
architecturally significant (per the subscription rules). Keep the status
checklist live; reply on the thread only when it resolves the task or raises a
real question — the diff is the record, not a running commentary.

`[M]` Machine-flagged, advisory. `scripts/check-pr-comments-answered.mjs` (the
`pr-comments-guard` check / its own `pr-comments.yml` workflow) inspects the PR's
review threads and, when a reviewer spoke last on an **open** thread, marks the
PR red and applies the `needs-comment-replies` label. Only two things clear a
thread: a reply from you, or resolving it. **Outdated does not count.** GitHub
marks a thread outdated the moment you push a change to the lines it points at —
that is you *acting on the feedback*, so it is when you most owe the reviewer a
sentence saying what you changed. The guard lists those separately ("you changed
these lines — say what you changed, or resolve") precisely so they read as a
report to file, not as a fresh nit. It re-runs every
time a comment, review, or reply lands, so the label clears the moment you
respond. It is **advisory — it does not block the merge** (a genuinely
bot-only/no-op PR can opt out with `<!-- pr-comments-exempt: <reason> -->`). The
teeth that judge whether your reply is *real* vs. dismissive are the adversarial
reviewer and the operator — the script only checks that you engaged at all.

### Visual artifacts for UI diffs (hard requirement — forever)

Every PR that touches a **GPUI** surface (`core/pd-console` window), the
**console** (any pd-console pane / renderer), or the **website / dashboard**
(`website-v2/`, `fleet-config-ui/`, `public/fleet-ui/`) MUST ship comprehensive
visual artifacts in its Test Plan: **screenshots, a GIF, and a short screen
recording** of the actual change. A green build proves it compiles, not that it
renders correctly — the operator reviews these surfaces by looking at the
artifacts, so a UI PR without them is incomplete and must not merge. Operator,
2026-06-11: *"I demand all GPUI diffs and console and website diffs include
comprehensive screenshot artifacts, GIFs and screen recording in the test plan.
Forever."*

`[M]` This is now machine-enforced. `scripts/check-pr-requirements.mjs` (the
`pr-requirements-guard` check, its own `pr-requirements.yml` workflow) fails the PR
when a change under a visual surface (`core/pd-console/`, `website-v2/`,
`fleet-config-ui/`, `public/fleet-ui/`, `public/`, `dashboard/`, `apps/FleetBar/`)
ships without at least one screenshot AND one motion artifact (GIF / recording) in
the body — committed media in the diff or embedded `raw.githubusercontent` links
both count. The escape hatch for a genuinely non-visual change is an explicit
`<!-- visual-exempt: <reason> -->` (a reason is required). The guard checks
*presence*; whether the artifacts actually show ideal behavior (vs. an error or
loading state) is judged by the `claude-adversarial-review` workflow, which presumes
failure on sparse evidence.

**How to capture without interrupting the operator** — the operator is usually
LIVE on this machine; never open windows, launch headed browsers, or click the
real menu bar to pose screenshots. The full decision ladder (headless
Playwright for web, `screencapture -x -l <window-id>` for already-open windows,
capture harnesses / dev-lane bundles for native apps, computer-use MCP as last
resort, honest partials over staged evidence) lives in
`skills/port-daddy-agent-skill/references/visual-evidence.md`. Read it before
producing any visual artifact. Runtime screenshot evidence flows through the
default blob store at `~/.port-daddy/blobs` (`lib/blob.ts`) — intake fails
loudly rather than dropping evidence.

- **TUI / pd-console panes**: record with `vhs` (tape committed under
  `core/pd-console/docs/artifacts/`) — capture per-pane stills + a tour GIF.
- **GPUI native window**: `cargo build --release --features gpui --bin pd-console`,
  launch it, and capture window stills + a recording with `screencapture`
  (`core/pd-console/scripts/capture-gpui.sh` automates a representative pane set).
  This needs macOS **Screen Recording** permission for the capturing process — a
  headless/background host is denied by TCC (`screencapture` prints "could not
  create image from display"); run the capture from a permitted Terminal.

### Building, installing & running pd-console (don't relearn this the hard way)

`core/pd-console` ships **two** binaries from one crate, on **crates.io gpui 0.2.2**
(NOT the Zed git pin — published, versioned, reproducible; the git pin rots):
- `pd-console` — the GPU-native window (Metal/macOS), gated behind `--features gpui`.
- `pd-console-repl` — headless TUI of the same panes; builds everywhere; the CI/Linux gate.

**Build** (from `core/pd-console`): GPU = `cargo build --release --bin pd-console --features gpui`
(clean build pulls gpui + deps, ~5 min; incremental ~secs). REPL = `cargo build --release --bin pd-console-repl`.

**Install — there are TWO launch surfaces, keep BOTH current or you'll demo a stale build:**
1. `cp core/target/release/pd-console ~/.port-daddy/bin/pd-console` — the PATH binary (`which pd-console`).
2. `cp core/target/release/pd-console ~/Applications/pd-console.app/Contents/MacOS/pd-console`
   — the **`.app` double-clickers launch; it has its OWN embedded binary and does NOT use PATH**,
   so updating only `~/.port-daddy/bin` leaves GUI launches on the old build (the "old POS" trap).
   **After replacing the .app binary you MUST re-sign or macOS rejects the bundle:**
   `codesign --force --deep --sign - ~/Applications/pd-console.app`. (The re-signed binary's
   hash differs from the unsigned source — that's the embedded signature, expected.)

**Run:** `pd-console` (PATH) or double-click the .app. Daemon discovery: `PORT_DADDY_URL` env →
`~/.port-daddy/daemon.port` → default; if discovery fails it **panics**, so launch with
`PORT_DADDY_URL=http://127.0.0.1:9876` when the port file is absent.

**Theme:** `PD_CONSOLE_THEME=light|dark` seeds startup; `Ctrl-A g` toggles live. Palette lives in
`core/pd-console/src/palette.rs` (light+dark, maritime/neobrutalism). `theme.rs` is the *REPL's*
OKLCH system — distinct module, don't conflate. All colors are guard-safe (no cinnabar/brass/patina;
`scripts/check-brand-colors.mjs` fails CI on those, hex AND rgb, comments included).

**Spawning agents from the console** (`POST /spawn`) clears real daemon guards — the console must send
`task` + `identity` + `budgetUsd>0` + `model` (for ollama) + a worktree `workdir` (the daemon BLOCKS
main-checkout spawns), and the **operator must fund the project wallet** (`pd wallet top-up <project>
--usd N`) + set a daily budget (`pd wallet budget <project> --usd-per-day N`). One-shot backends (ollama)
return output inline in the spawn response (not on the tube). Missing any of these = "spawn looks
wired but does nothing" — the historical hollowness.

**gpui 0.2.2 idioms** (no fluent transform exists): express "lift/glow/spring" via `shadow(vec![BoxShadow{
color:Hsla, offset:point(px,px), blur_radius, spread_radius}])` + hover color, and `with_animation(id,
Animation::new(dur).with_easing(f) [.repeat()], |el,delta| el.opacity(delta))` for timelines
(`pulsating_between`, `ease_out_quint` available). **Inside a `.hover(|s| …)` closure pass bare `rgb(x)`
to `bg`/`text_color`/`border_color` — NOT `.into()` (Rgba has 4 `Into` targets → E0283 ambiguity).**
A one-shot replays only when its `ElementId` changes (suffix a nonce); a stable id + `.repeat()` loops
without restarting each render.

Console work lives on `feat/console-tmux-multiplexer`; the v12 feel-pass design slices are in
`docs/design/fleetbar-mockups/v12-feelpass-slices/`.
- **Website / dashboard**: headless Playwright (`headless=True`), dark + light
  pairs, 100% and 200% zoom where layout matters. Read the PNGs back to confirm a
  settled render (not a loading state) before attaching.
- Embed artifacts in the PR body Test Plan (commit them and reference
  `raw.githubusercontent.com/<repo>/<sha>/<path>` URLs so they survive the squash).

### Create / Update / Land mechanics

The numbered flow above is the *review contract*. This subsection is the
*mechanical contract* — the exact command sequence each phase resolves to.

- **Create.** Branch in a linked Git worktree under `~/coding/tmp/wt-<slug>`
  (never the main checkout — the main checkout carries the operator's WIP).
  **Pick the base by dependency, not reflex:**
  - *Independent change* → branch off `origin/main`.
  - **Stacked / dependent change** (it needs code from an open PR that has not
    landed) → **branch off that PR's branch, not `origin/main`**, and open with
    `gh pr create --base <prior-pr-branch>`. Each PR in a stack bases on the one
    before it, so reviewers see a minimal diff and the dependency is explicit.
    When the base PR squash-merges, retarget the dependent (`gh pr edit <n>
    --base main`) and rebase onto the post-merge `main` — mergeability flips the
    instant the base lands (see **Land**). Do NOT rebuild a feature on
    `origin/main` when it actually depends on an unmerged PR; that strands the
    work on the wrong base (the v0.2.0-console-vs-v0.3.0-mux trap, 2026-06-20:
    a console pane was built on stale `main` while the mux it needed sat in an
    open PR, forcing a full rebuild).

  Then `pd begin "<purpose>" --identity port-daddy:<type>:<slug>` → a scope
  `pd note` → `pd session files add <files>` *before* editing → edit →
  `pd guard check --staged` → commit (no Claude co-author trailer) →
  `git push -u origin <branch>` → `gh pr create [--base <prior-pr-branch>]` →
  `pd done`.
- **Update** (review + CI). Pull bot review comments with `gh api
  repos/curiositech/port-daddy/pulls/<n>/comments` and fix the real ones.
  Address every HIGH adversarial-review finding as a named fixup commit.
  Make `npx tsc --noEmit`, jest, `npm run parity`, and the build all
  green. Rebase onto the latest `origin/main`, resolving conflicts. Push.
- **Land.** Merge in dependency order: base PR before dependent PR, and
  *rebase the dependent after each merge* — mergeability can flip from
  MERGEABLE to CONFLICTING the instant the base lands. Use the protected
  flow: `gh pr merge <n> --auto` when the merge queue is active, and let
  branch protection choose the merge strategy. Do not add `--squash`,
  `--merge`, `--rebase`, or `--admin` as routine agent flow. A human
  maintainer can make an explicit, documented emergency bypass;
  an agent cannot use admin to skip a real required gate. Cloudflare Pages may
  be external/advisory, but prove that from branch protection and record the
  evidence before treating it as non-blocking.
- **Cleanup.** Delete a worktree ONLY when its branch is merged AND `git -C
  <wt> status --porcelain` is clean. Never delete a worktree that still has
  uncommitted work. Never `git reset` or otherwise clobber the main
  checkout — it carries WIP that is not yours.

### Roadmap link gate (every PR declares its roadmap item)

Every PR must say which roadmap item it advances, so a merge writes back to
tracked work instead of vanishing. The mechanism:

- **Declare it.** Put one trailer line in the PR description:
  `Roadmap-Item: <slug>` — or, for a chore/docs/hotfix, the explicit opt-out
  `Roadmap-Item: none — <reason>`. The PR template carries the prompt.
- **No item yet? Create + stamp in one step** (runs locally — the roadmap
  lives in the daemon's SQLite, which CI can't reach):
  `npx tsx scripts/roadmap-link.ts <pr-number>`. It POSTs a real
  `roadmap_items` row (`POST /roadmap/items`) and edits the trailer into the
  PR body. Then `npx tsx scripts/export-roadmap-snapshot.ts` and commit so CI
  sees it.
- **The check is REQUIRED and fails closed.** `.github/workflows/roadmap-link.yml`
  reads the committed mirror `docs/roadmap/roadmap.snapshot.json` (via the pure,
  unit-tested `lib/roadmap-link-core.ts`) and is a **required status check** in
  branch protection (operator, 2026-06). A PR with no valid `Roadmap-Item:`
  trailer **cannot merge** — it is bounced back until you add the link or the
  explicit opt-out. It reports on `merge_group` heads as a pass-through, so the
  merge queue never hangs on it.
- **Belt and suspenders: the label too.** A PR with no valid link also gets
  `needs-roadmap-link`, and the land/auto-merge flow treats that label as *hold
  for a human*. With the check now required, the merge is also blocked
  mechanically — so an unlinked PR is stopped two ways.
- **Keep the snapshot fresh — it fails closed.** If `roadmap.snapshot.json` is
  missing, empty, or >21d stale, the gate shouts (🔴 comment + step summary) AND,
  because it is required + fail-closed, **blocks every PR** — even correctly
  linked ones — until someone regenerates and commits it:
  `npx tsx scripts/export-roadmap-snapshot.ts`. A stale mirror must never read as
  "all clear". (This is the operator's deliberate trade-off: a stale roadmap
  halts the line rather than letting unverified links through.)
- **Planning docs must spawn downstream work.** A PR that adds/edits an ADR, a
  `PLAN`/`ROADMAP` file, or a `docs/` proposal must also enumerate the roadmap
  items it creates: `Roadmap-Spawns: <slug-a>, <slug-b>` (or
  `Roadmap-Spawns: none — <reason>` when it only supersedes/clarifies). A plan
  exists to generate work; without the spawn line the PR gets
  `needs-roadmap-spawn` and waits for a human. Detection is by file path, so it
  fires on the actual document, not on prose.

### Shell gotchas (real and recurring)

These bite every contributor session; they are not theoretical.

- **`git add -A` is refused by the pd-shim.** Stage explicit paths. If the
  refusal is factually wrong, fix the claim/session input and publish the
  inconsistency; an agent does not disable the guard it is meant to obey.
- **The `~/.port-daddy/bin/git` shim sets `core.pager=delta`, which falls
  back to `bat`.** If `bat` is not installed, `git log` / `git show` /
  `git commit` emit `command not found: bat` and can swallow output. Run
  those through `git -c core.pager=cat …` or export `GIT_PAGER=cat`.
- **Inline `node -e` and heredocs get mangled by zsh.** Write a `.cjs`
  helper under the repo's `.scratch/` (gitignored, and it resolves
  `node_modules` because it is inside the repo) and run that instead.
- **Secrets go through `pd secret set`** (hidden stdin prompt). Never pass
  a secret as an argv argument — it leaks into shell history and process
  listings.

## Release

- **Full playbook lives in [`docs/RELEASING.md`](docs/RELEASING.md).** It covers public releases, candidate/hotfix builds, and local feature dev (with the binary smoke-test path you must run before merging anything in `lib/`, `routes/`, `server.ts`, or `mcp/`). [`docs/VERSIONING.md`](docs/VERSIONING.md) is the canonical list of version surfaces and the semver policy.
- Port Daddy ships as **signed binaries** per [ADR-0028](docs/adr/0028-signed-binary-distribution.md). There is no `~/port-daddy-stable` worktree, no `promote-stable.sh`, and no `npm link` install path.
- The release boundary is a git tag plus a GitHub Release. `.github/workflows/release.yml` builds notarized binaries on the tag; `.github/workflows/publish.yml` is the manual companion that rolls the `curiositech/homebrew-tap` formula. Hold `pd lock release-publish` for the duration of the brew-tap roll — the formula is shared state.
- Versioning is operator-trust. If users will get a behavior change after `brew upgrade port-daddy`, the binary they download must report a newer version than the one they had.
- User-facing runtime/control-plane fixes still need a prompt cut, or the live daemon/UI will keep lying from an older binary.
- **A DAEMON OR CLI-SURFACE CHANGE AND ITS RELEASE ARE ONE ATOMIC UNIT.** If a change alters the shipped `pd` — a new, renamed, or removed verb; a change to what the single binary registers; anything an operator would observe after `brew upgrade` — then the version bump, the embedded-version sync, and the Homebrew formula roll land *with* it, not in a follow-up. Shipping the daemon change alone leaves a binary that disagrees with the formula, which is precisely the drift `version-drift-guard` and `tests/unit/embedded-version-sync.test.js` exist to catch — do not make them the thing that discovers it. Before finishing such a change, state plainly whether the shipped surface actually changed: correcting a stale test expectation or harness wiring does NOT require a release, and claiming it does is its own kind of noise. If part of the release genuinely cannot run from your environment (a tag push the git proxy blocks, a tarball SHA that does not exist yet), do every part that can be done and report the exact remaining command instead of skipping it silently.

## Fleet Identity

- Logical fleet names are not unique enough. `port-daddy-dev` can exist in more than one checkout.
- Use `projectDir` as the durable identity in UI state, routing, and daemon/API lookups.
- Only use logical project name as a display label.
- Fleet trigger channels are project-scoped by default.
- The current fleet engine already scopes trigger and publish channels through `lib/fleet-channels.ts`. If cross-project wakeups still happen, suspect leaked legacy `port-daddy-cli watch git:committed ...` processes before assuming the current engine lacks scoping.
- Daemon-owned YAML watchers must use in-process messaging subscriptions. A stable daemon spawning long-lived `pd watch ... --exec` children for its own watchers is a regression: those children can survive daemon restart, reconnect-storm SSE, and poison Bosun heartbeat truth.
- Do not treat any hook containing `git:committed` as "already correct". Legacy Port Daddy hooks published naked `git:committed`; installers must detect and replace those in place.
- Keep YAML logical channels human-readable like `git:committed`, but publish/subscribe on a physical scoped channel derived from `projectDir`.
- Reserve `global:<channel>` for intentional cross-project fanout. Cross-project wakeups are a bug unless explicitly marked global.

## Control Plane

- Before changing delegation UX, reread the product docs first:
  - `docs/DELEGATION-MODES.md` for spawn vs agent vs sortie vs fleet vs harbor (the standalone sortie plan doc was removed with the sortie surface in #638)
  - if source/docs promise a command or surface and the build does not have it, treat that as a drift bug to fix instead of silently redefining the product
- `skills/port-daddy-agent-skill/SKILL.md` and `skills/port-daddy-agent-skill/references/api-reference.md` are release surfaces, not optional afterthoughts. If Port Daddy’s CLI, SDK, MCP, delegation model, website story, Mac app/FleetBar behavior, README install flow, or operator workflows change, update those skill docs and the matching docs/website/README surface in the same slice.
- `pd agent` is a thin ad hoc wrapper over `/sugar/begin` + `/spawn` + `/sugar/done`, not a sortie object. Treat its UI presence as a manual job/run unless the launch explicitly came from the sortie workflow.
- Operator-facing agent launches are fail-closed on telemetry now. Do not treat a run as acceptable unless Port Daddy can attach exact token counts, an exact nonzero model rate, and a persisted exact nonzero cost record to the completed launch.
- Operator-facing launches also require daemon-proven backend readiness. `manual_check` is not launchable; only `ready` runtimes should power agents.
- `createSpawner()` defaults telemetry enforcement on. Any code that opts out with `enforceTelemetryPolicy: false` must attach explicit HITL confirmation metadata; a silent bypass is a policy violation.
- Opaque backends are not "good enough for now." If a backend cannot prove exact telemetry end to end, it should stay blocked in readiness, preflight, and the live spawner.
- The backend catalog is broader than the currently launchable surface. Right now, operator-facing launches are only expected to succeed on ready, exact-rate backends such as Cloudflare Workers AI or the Claude SDK when their credentials/dependencies are setup. Other listed backends remain implementation surfaces until readiness and telemetry parity exist.
- Checked-in fleet definitions, starter templates, and public examples must not pin Ollama or other blocked/manual-check runtimes. Use Fleet Control Center's bulk runtime control to move agents onto whichever backend is setup and ready on the operator's machine.
- A failed or completed `pd agent` run can disappear from the live agent registry while still existing in spawned-agent history and session notes. Operator UIs need a separate ad hoc-job lens instead of assuming the live agent registry is the whole truth.
- The `codex` backend is a Codex CLI integration, not an SDK backend. Port Daddy should launch it via `codex exec` and prefer `--output-last-message` over parsing noisy stdout.
- Codex defaults should stay spend-aware:
  - low: `gpt-5.4-mini`
  - mid: `gpt-5.3-codex`
  - high: `gpt-5.4`
- Expensive Codex launches should be explicit. Do not silently bump a run from mini to the high model.
- Every backend in this repo needs a distinct low/mid/high ladder. Current built-ins are:
  - Claude SDK: `claude-haiku-4-5-20251001` / `claude-sonnet-4-5-20250929` / `claude-opus-4-1-20250805`
  - Claude CLI: `haiku` / `sonnet` / `opus`
  - Gemini: `gemini-2.0-flash-exp` / `gemini-2.5-flash` / `gemini-2.5-pro`
  - Codex: `gpt-5.4-mini` / `gpt-5.3-codex` / `gpt-5.4`
  - Ollama: `qwen2.5-coder:7b` / `llama3.1:8b` / `qwen2.5-coder:14b`
  - Aider: `gpt-4.1-mini` / `gpt-4.1` / `gpt-5`
  - Custom: `custom-low` / `custom-mid` / `custom-high`, forwarded to wrapper commands via env
- `fleet-config-ui` is deprecated. Do not add new operator features, demo
  surfaces, tabs, or agent-control-plane UI there. The one sanctioned exception is
  the **Galaxy** surface (`SessionGalaxyPanel`), the Fleet UI face of the four-surface
  session-embedding map; it also renders natively in Fleet Control Center, so the
  fleet-config-ui tab is a transitional compatibility surface, not a net-new one.
- Fleet Control Center in `apps/FleetBar/FleetBar` is the real operator control
  plane surface.
- `public/fleet-ui` is a legacy built artifact served by the daemon for
  compatibility while old webview surfaces are folded into Fleet Control Center.
- Agent Harbor runtime-refactor target truth lives in
  `docs/adr/0100-destructive-daemon-runtime-authority.md`: `pd-console` is the
  deep proof surface, FleetBar is ambient consent/status/re-entry, Scout is
  evidence-backed intake, and CLI/MCP are automation adapters. Native surfaces do
  not call CLI or MCP internally; they use the shared daemon contract / Surface
  Gateway path.
- `pd use` is per-shell/per-process berth context. It emits environment for the
  current shell or launched process; it is not a global daemon switch. Native
  surfaces must show the active berth/codebase/dev lane they are actually
  connected to, not infer state from an unrelated shell.
- Do not preserve legacy route/verb/MCP bridges as long-lived product surface
  when WorkIntent plus Surface Gateway owns the family. Keep any old path as a
  temporary internal adapter with a deletion plan, or fail closed with a
  migration message.
- FleetBar should open the real control plane, not a shadow dashboard with reduced functionality.
- FleetBar is the top-level navigator when embedded. The embedded control plane must receive `?embed=fleetbar` and hide duplicate in-app surface tabs.
- FleetBar embed detection should not rely on query params alone. The WebView must identify itself too, so a dropped query string does not resurrect duplicate chrome.
- The control plane must carry both logical and physical channel names. Humans should still see `git:committed`; reads and writes must use the resolved project-scoped physical channel.
- Fleet Control Center needs an explicit project switcher in native chrome. Embedded mode must not auto-force the first project and strand the operator there.
- Only `Flow` keeps the persistent project rail. `Activity`, `Channels`, `Inbox`, `Sorties`, and `YAML` should use the full page width.
- Project changes must preserve the current surface. Selecting a different project should not silently dump the user back to Flow.
- Do not claim an embedded surface is fixed from a loading-state screenshot. Wait for a settled render and verify the actual surface content is visible.
- Session notes and handoffs carry explicit `agentId` and `identityProject`; use those fields for attribution before falling back to text matching.
- Project-scoped Activity filtering must include `story.agentId`; if you only filter note text and `identityProject`, valid handoffs will disappear from the timeline.
- Session lifecycle activity is also structured data. `session.start`, `session.end`, `session.note`, `file.claim`, `file.release`, and sugar begin/done events should stamp `agentId`, `targetId`, and `identityProject` so briefing/FleetBar/UI do not have to reverse-engineer scope from prose.

## Operator UX Expectations

- Top-level tabs must behave like top-level pages. Do not hide a selected tab's main content inside a collapsed lower panel.
- If a page already has its own per-agent focus view, clicking an agent there should update that in-page focus first. Do not also auto-open the global slide-in inspector unless the user explicitly asked for settings/details from Flow.
- Agent detail should default to non-empty, high-signal activity:
  - recent meaningful messages
  - mutations / touched files
  - handoffs / artifacts
- If the UI shows touched files or mutation paths, it needs explicit `Open in Finder` and `Open with default editor` actions. A bare path chip is not sufficient operator affordance.
- Relative mutation paths are not enough for those actions. Resolve them against the project/workdir first, or explain why the path could not be resolved instead of dropping a useless `Not Found`.
- Activity must still list configured agents even when structured signals are sparse. “No signals” is not permission to pretend the fleet has no agents.
- Filter low-signal system noise instead of surfacing empty or trivial channel traffic.
- FleetBar popover is not just a launcher. It should surface recent per-agent summaries, last-active hints, and touched files that can be opened directly.
- Successful launch flows must preserve the operator’s chosen backend/model in the draft UI. If the launch fails, surface the daemon’s real error inline instead of collapsing to a generic HTTP status.
- Backend readiness must verify dependencies too, not only env/auth. Do not claim Claude SDK is ready unless `@anthropic-ai/sdk` is actually installed, and do not claim Gemini is ready unless `@google/generative-ai` exists.

## Writing Technical Documents

This applies to every technical document, design doc, tutorial, blog post, ADR, and reference page — not just the website.

- **Cite-and-define on first use.** The *first* time a document uses an external technical term (e.g. *Goodhart's law*, *fail-closed*, *Sybil attack*, *liveness*, *closure*, *idempotent*), **bold the term, give a citation, and add a one-line gloss** (parenthetical is fine). The reader is a sharp engineer who may not share our exact background; a document should be legible without a glossary lookup.
- **Cite the code for our own abstractions.** The *first* mention of a Port Daddy abstraction (e.g. *daemon*, *Arbiter*, *Coordination Guard*, *claim-tree*, *actor-soul*, *bonds*, *resurrection*) gets **bold + the source-file path relative to repo root + one sentence** on what it is. This forces every claim to be checked against real code and keeps docs honest as code moves.
- **Why this rule exists.** It makes documents portable to readers outside the immediate context, and the act of citing the file is a built-in correctness check — a path that no longer exists is a caught lie. The exemplar is `docs/research/agent-accountability-proposal.md`.
- Pick a Diátaxis mode and stay in it: tutorial (learning), how-to (task), explanation (understanding), or reference (lookup). Do not blend an explanation into a tutorial.

## Website And Public Content

- When adding or refreshing website, docs, blog, examples, tutorial, or launch pages, include Nano Banana/Gemini-generated imagery by default to keep the page visually alive. Treat generated images as product-supporting assets: they should clarify the real Port Daddy workflow, not replace screenshots, CLI proof, or live product truth.
- Reuse existing prompt sheets, generated assets, optimization scripts, and visual-review artifacts before inventing a new image pipeline. If new imagery is needed, leave the prompt/source path and optimized outputs discoverable in the repo.
- Tutorial and docs command surfaces must show the expected result, not only the invocation. Never render a naked `pd ...` command in a terminal/code box without the matching output, resulting state, or explicit next observable effect on the next line.
- Console UI screenshots on the website, tutorials, docs, blog, and launch pages must be real Port Daddy captures, not staged mockups, and they must ship as light/dark pairs that follow the active website theme. If the paired capture does not exist yet, capture it before publishing the page.
- The public website deploy target is Cloudflare Pages project `port-daddy`, serving `port-daddy.pages.dev` and `portdaddy.dev`. Build with `npm --prefix website-v2 run build`, then deploy from `website-v2/` with `npx wrangler pages deploy dist --project-name port-daddy --branch main --commit-hash "$(git rev-parse HEAD)" --commit-message "$(git log -1 --pretty=%s)"`.
- Deploy from a clean checkout or clean temporary worktree. If `origin/main` moved after your local website commit, deploy latest `origin/main` unless the user explicitly requested a specific commit. After deploy, smoke `https://portdaddy.dev/...` and at least one changed asset/page; for visual work, verify with Playwright or the in-app browser instead of trusting Wrangler success alone.

### Domain Portfolio (owned, operator-registered 2026-08)

The operator holds these domains; consult before naming/branding decisions and never suggest
buying a name on this list:

- `portdaddy.dev` — primary product site (live, Cloudflare Pages `port-daddy`).
- `portdaddy.app` — reserved for the packaged desktop/app-store distribution surface (FleetBar/Control Center installers or app deep links).
- `portholed.com` — Porthole: terminal capture/replay/share/test product (see `demos/porthole/PRODUCT.md`); target home for hosted cast sharing + the marketing site.
- `harbord.ai` — Harbor brand (editor/governed-workspace surface).
- `agentsd.ai` — agentsd greenfield scaffold (operator decision 2026-07-15): the agents-daemon brand.
- `agentsdaemon.com` — long-form/defensive twin of agentsd.ai; redirect to agentsd.ai when live.


### Blog Post Hard Requirements

Any PR that adds, rewrites, or runs a "voice pass" on a post under `website-v2/src/data/blog/` MUST satisfy the following before merging. These are floors, not aspirations — a "voice pass" that skips them is a process bug.

1. **Run the `port-daddy-marketing-copy` skill on every touched post.** The skill at `skills/port-daddy-marketing-copy/SKILL.md` is mandatory. Read it before editing. The "Seven rewriting moves" and the "How to know you're done" checklist are the success criteria.
2. **Cold-start framing in the first three paragraphs.** Port Daddy has zero users. Assume the reader has never heard of it. No insider jargon, no "as we discussed in PR #X," no unexplained primitives. Show the problem before naming the system.
3. **TL;DR up top.** Two sentences. What does the post argue? Why should the reader care?
4. **At least 2 nano-banana / Gemini-generated images** — one hero, at least one inline. Use the `nano-banana-image-gen` skill or the existing Qwen Image pipeline. Generic placeholder art from `/img/generated/` does NOT count. Custom imagery only.
5. **At least 2 diagrams** — mermaid, sequence, flowchart, illustration, doodle, or annotated screenshot. Diagrams explain joinery; prose alone is harder to remember.
6. **At least 3 deep links** — to the whitepaper, related posts, docs pages, primitive references, or external authority (skill catalog, ADRs). If the post mentions a concept that has its own page, link it inline.
7. **At least one concrete villain / vivid example.** Not "expected loss"; "the agent that locks every file in the repo and walks away at 4am." Specific scenarios beat abstractions. Make the reader feel the failure mode.
8. **Closing CTA.** Install command, next post in the series, or a deeper doc. Never end on a sentence that doesn't move the reader.

### Blog post layout

- Article container is `max-w-[80ch]` (~720px). Hero image is `max-w-6xl`. Both are intentional and must not regress to `max-w-prose` (~600px feels like a column in a void on desktop).
- Byline uses `text-sm sm:text-base` with the author name in `text-text-primary` (NOT muted). The author is the highest-trust signal on the page; treat them that way.

## Current Gotchas

- If multiple Port Daddy checkouts exist, duplicate fleet names can make project selection and routing look broken unless everything keys by `projectDir`.
- Before concluding a UI fix "didn't work", verify the daemon being queried is the one serving this checkout's `public/fleet-ui`.
- `docs/recovery/CURRENT-WORK.md` is the canonical in-flight queue. Update it as the active thread changes; then reflect larger closures in `.cartographer/status.md`.
- Do not hardcode `9876` as if it is guaranteed truth. `9876` is the preferred canonical port, but runtime code must discover the live daemon via the shared socket/port-file helper because the daemon can fall back.
- Do not hardcode `localhost` as if it is harmless truth either. TCP callers should go through the shared loopback host helper instead of sprinkling new `http://localhost:9876` literals around the repo.
- If a runtime/helper/UI path needs the daemon URL, prefer the shared discovery helper over inline `http://localhost:9876` defaults.
- Bosun heartbeat truth is canonical-daemon truth, not "any server.ts process is alive" truth. A daemon must only write the shared heartbeat after it owns the canonical PID file, and `pd-bosun` must treat heartbeat/PID-file mismatches as foreign provenance rather than healthy supervision.
- Do not `unref()` the daemon's Bosun heartbeat interval. Unlike SDK or spawner helper heartbeats, this timer is the mandatory liveness contract that keeps the external supervisor from killing an otherwise reachable but idle daemon.
- Legacy Barnacle is gone from runtime. `pd-bosun` is authoritative; do not add HTTP Barnacle watchers, `guardians.barnacle` compatibility fields, or `PORT_DADDY_ENABLE_LEGACY_BARNACLE` escape hatches back into source.
- Hot operator routes must not perform broad synchronous filesystem discovery. In particular, `/projects` must not scan `~/` or recursively walk inside discovered project roots from the daemon request thread; that starves heartbeat and lets Bosun kill an otherwise booted daemon.

### Canonical daemon URL — enforced by CI

The rule above is enforced by `tests/unit/no-hardcoded-daemon-url.test.js`. Production source paths (`lib/`, `routes/`, `cli/`, `bin/`, `mcp/`, `shared/`, `apps/FleetBar/`, `public/`, `fleet-config-ui/src/`, `dashboard/`, `website-v2/src/lib/`, plus `server.ts`) must NOT contain `http://localhost:9876` or `http://127.0.0.1:9876` literals. Use:

- **Node — to CONNECT (socket-first):** `resolveDaemonTarget()` from `shared/daemon-discovery.ts`. This is the ONE canonical resolver of socket-vs-TCP for the whole repo (precedence: `PORT_DADDY_SOCK` → `PORT_DADDY_URL` → the daemon socket file → loopback TCP from `daemon.port`). `cli/utils/fetch.ts` (`pdFetch`, ~48 importers), `lib/request.ts` (`pdRequest`), and the `lib/client.ts` SDK all delegate to it — do not hand-roll a fourth `resolveTarget`.
- **Node — to DISPLAY/log a base URL string:** `getDaemonTcpUrl(process.env.PORT_DADDY_URL)` from `shared/daemon-discovery.ts` (TCP URL only; not a connection target).
- **Swift:** `DaemonLocation.resolveBaseURL()`
- **Web (dashboard, FleetBar webview):** relative paths (no scheme/host)
- **Web (cross-origin, e.g. fleet-config-ui):** the canonical web resolver in `website-v2/src/lib/daemon-url.ts`

Examples, scripts, tests, and docs/marketing copy in `website-v2/src/{data,docs-content,pages}/` are exempt — they show canonical URLs as part of user-facing guidance. If you legitimately need a literal in an enforced path (e.g. you're writing the resolver itself), add the file to `ALLOWED_FILES` in the parity test with a one-line reason. Reviewer sign-off required.

This rule has bitten us repeatedly when the daemon ran on a non-default port (CI, multi-machine, custom installs) and one drifted literal made the daemon unreachable. The CI guard makes regressions impossible without a deliberate allowlist edit.
- `pd init` and any hook installer should copy the shared project-scoped post-commit template instead of writing bespoke inline hook logic that can drift.
- If a fleet project drops into `skipped` with `owner: null` and `fleet lease lost: lock not held`, treat that as a recoverability bug. The daemon should reacquire the lease when nobody else owns it, not sit idle forever.
- Daemon logs can mix truths from different client generations. A fresh `fleet-ui` load now polls scoped `project:...:` channels correctly, but older already-open FleetBar/browser clients can keep hitting naked `git:committed` until they reload onto the new bundle.
- Generated spider connection markdowns under `.spider/connections/` are not automatically promotable repo truth. Treat them as research residue unless the user explicitly wants them curated or a real feature/docs change depends on them.
- Hidden generated work dirs are default-ignore residue unless explicitly promoted. Current examples: `.spark/`, `.spider/connections/`, and `.dogfood/`. Do not cargo-cult this into `.*` blanket ignores, because real repo truth also lives under tracked dotdirs like `.cartographer/` and `.claude-plugin/`.
- Stable-only Spark/Spider residue is salvage material at most, not authority. Compare it against current `.spark/` / `.spider/` and only promote discrete ideas that are still missing here.
- The stable-only Spark ideas currently most worth considering are:
  - capability-aware discovery via DNS + harbor join
  - persistent fleet run journal / history
  - forensic context windows on Arbiter violations
  - IPC disconnect -> instant salvage / cascade cleanup
  - tuple-triggered fleet agents and IPC tuple fast path
- Untracked archaeology tests are only promotable if they assert desired behavior or cover a real blind spot. Do not commit redundant bug batteries that merely freeze known-bad behavior as the expected outcome.
- Treat this repo’s tests adversarially. Assume they are often tautological, trivial, stale, or asserting the wrong behavior until you prove otherwise. Favor tests that would have caught the operator-visible bug, not just tests that ratify the current implementation.
- Run tests frequently, but do not confuse “green” with “done.” After any meaningful bug fix, ask what important failure mode is still untested.
- `npm test` is the minimum repo-health gate here. Focused bundles are useful for iteration, but always rerun the full suite before claiming broad health.
- A green exit code is still not clean truth if Jest prints `A worker process has failed to exit gracefully`. Treat that as remaining teardown debt and go hunting with `--detectOpenHandles` on the likely long-running suites.
- Oversized JSON requests over the Unix socket can surface client-side `EPIPE` / `ECONNRESET` before the daemon’s 413 body is readable. In integration tests, normalize that transport failure back into the daemon’s intended oversized-payload rejection instead of pretending the daemon accepted the body.
- `pd fleet run <agent>` now inherits `limits.budget_usd_per_day` as its launch ceiling. If it still fails, inspect the live active-agent cap and queue pressure before assuming the agent prompt or backend is broken.
- **Session context is deterministic, not first-match state**: `PD_SESSION_ID` and `PD_AGENT_ID` form one atomic identity. A partial environment pair does not suppress a complete context slot; a complete environment pair that disagrees with the slot fails with `CONTEXT_CONFLICT` and both provenances. Do not clear variables to route around that conflict. Select the intended slot or pass an exact `--session` + `--agent` tuple. Agent-only mutation with more than one active session fails with `AMBIGUOUS_ACTIVE_SESSION` and candidates. Raw IPC and direct SQLite are read-only for session, note, claim, lock, and salvage authority; use the credentialed daemon HTTP path.
- **Binary drift in integration tests on dev machine**: Ephemeral test daemons started by the integration test framework (`tests/helpers/integration-setup.js` / `tests/helpers/ephemeral-daemon.js`) will verify binary hashes. If there's a global Homebrew or PATH-installed `pd` binary, it may cause false positive "binary drift" checks (since the running test daemon runs under `tsx` Node while PATH resolves to the global executable). Fix this by overriding the comparable on-disk path by setting `PORT_DADDY_BIN_OVERRIDE: process.execPath` inside the test environment for both the CLI runs and the ephemeral daemon spawns.
- **Roadmap receipts for core coordination changes**: Changes to core coordination paths (like `cli/commands/sessions.ts`) are monitored by the Coordination Guard. The guard will block commits affecting these files unless the committing agent has touched/upserted a corresponding roadmap item (e.g. via `pd roadmap touch <slug> --harbor port-daddy --note <why>`). Note that `--harbor port-daddy` must be specified if you are working in a temporary sandboxed worktree where the folder name diverges from the default repo name.
- **Rich Docstring Mandate (TypeScript and Rust)**: Every library function and method in the codebase must carry rich, informative documentation. This is enforced by the `npm run check:rich-docs` (under `scripts/check-rich-docs.mjs`) validation loop. TypeScript functions/methods must use `/** ... */` JSDoc blocks including `@param` and `@returns` tags (when parameters/return values are present) and discuss design, motivation, or philosophical rationale (e.g., matching keywords: `motivation`, `purpose`, `philosophy`, `why`, `design`, `intent`). Rust functions must use `///` doc comments discussing the same motivation/philosophy keywords and parameter/return usage. You can run `npm run check:rich-docs -- --staged` to fast-audit only your changed/staged files.

## Architecture truths — hard-won 2026-06-05 (read before any "console / Rust / coordination" work)

- **The Rust kernel is landed IN-TREE at `core/kernel/`** (formerly the sibling
  `~/coding/port-daddy-kernel-rs` build — that path is history, stop citing it).
  Crates map the product's spine: **pd-anchor** (signed cards + capability
  envelopes + evidence roots + the CANONICAL macaroon discharge gate, ADR-0054),
  **pd-mesh** (anchor-authenticated mesh = *remote harbors*), **pd-eventlog**
  (WAL append-only = the durable bus), **pd-runtime** (queue/scheduler =
  voyages), **pd-core** (deterministic kernel transitions), **pd-compat**
  (read-only TS→Rust import bridge), **pd-tui/pd-rs** (kernel console/CLI).
  **ADR-0120 is the standing boundary rule** — security primitives once, in
  Rust; product planes TypeScript on purpose; parity fixtures wherever both
  languages must speak one format. **Do NOT scaffold yet-another Rust
  UI/daemon without reconciling against ADR-0120 first** — `core/pd-tui`
  (ratatui, landed), `core/pd-console` (GPUI), and `core/kernel/pd-tui` must
  not fork into rival shells.
- **Coordinate over DURABLE ids/channels, never `cli-<pid>`.** `cli-<pid>` is ephemeral
  (new per CLI invocation) — two agents using it can never reach each other and there
  is no delivery receipt. `pd inbox`/`pd agents` now resolve `readCurrentContext().agentId`
  first (fixed). For agent↔agent back-and-forth, converge on a **persistent tube
  channel** (`pd tube <channel>`) — it persists + delivers to all subscribers — not
  point-to-point inboxes. The bus must *deliver*; that's the precondition for "agents
  actually communicate."
- **Coordination works as of v3.18.0** — the `pd` CLI speaks (the 3.17.0 mute is gone)
  and `pd begin` is idempotent per (identity, worktree). Use `pd begin` / `pd note` /
  `pd session files add` / `pd done` for real. Do not bypass the guard with `--no-verify`.
- **The unified model** is `docs/design/2026-06-05-the-unified-model.md`: harbor → console
  → voyages → Coast Guard (coordination = the price of sandbox access: the compulsion
  keystone) → cartographer/suggestibility, all encrypted. Voyage is the one noun;
  spawn/sortie/nightshift/fleet are launch verbs. The console (v11 spec, PR #274) is the
  one surface; design system = General Sans + IBM Plex Mono, OKLCH (no hex), no emoji as icon.
- **Delete rule (operator-updated):** never-delete is demote-by-default, BUT you may
  **delete** a thing once its value is merged into its near twin — consolidation is the
  licensed exception. Coordinate the delete on the bus first; never solo-delete live-fleet code.

## pd-console — build LANES (prod / latest / dev). Read before building the console.

There is **no longer one `~/Applications/pd-console.app`** that every agent clobbers.
That single bundle is why you could hit `Ctrl-A Space` on a month-old build and see
nothing. The console now ships in three lanes, each a distinct bundle with a distinct
icon colour + label so you can tell them apart in the Dock at a glance:

| Lane | Bundle | Built from | Icon | PATH shim |
|------|--------|-----------|------|-----------|
| **prod** | `~/Applications/pd-console-prod.app` | the Homebrew cut | **blue**, `vX.Y.Z` badge | yes |
| **latest** | `~/Applications/pd-console-latest.app` | `main` | **green**, `latest` badge | yes |
| **dev** | `~/Applications/pd-console-dev-apps/pd-console-dev-<YYYYMMDD-HHMM>-<name>.app` | your worktree | **amber**, `dev·<name>` badge | no |

Dev bundle filenames lead with the build stamp (`YYYYMMDD-HHMM`) so the folder
sorts chronologically — newest build is visually obvious. Rebuilding the same
`<name>` retires that name's older bundles (`PD_CONSOLE_KEEP_OLD_DEV=1` keeps them).

The one tool is `core/pd-console/scripts/package-console.sh`:

```bash
bash scripts/package-console.sh                       # latest (default)
bash scripts/package-console.sh --prod                # version-stamped prod (Homebrew cut)
bash scripts/package-console.sh --devbuild parley-pane # YOUR isolated build — never touches prod/latest
```

**Rules for everyone:**
- **Working on the console in Rust? Build your own dev lane** (`--devbuild <feature>`) and
  test against *that* window. Never rebuild `-latest`/`-prod` to try a half-finished change —
  that is the shared-bundle trap this replaced. Each lane is a separate `CFBundleIdentifier`,
  so dev builds never overwrite prod/latest icon caches or Dock entries.
- **When a pd-console change lands on `main`, rebuild the latest lane** (`bash scripts/package-console.sh`)
  so `-latest.app` actually reflects main. A stale `-latest` is the bug, not a cosmetic.
  **Automate it once:** `bash core/pd-console/scripts/install-console-hooks.sh` installs a
  `post-merge` git hook that rebuilds the latest lane (detached, no window-steal) whenever a
  pull into `main` touches `core/pd-console/`. Idempotent; chains onto any existing hook.
- **Prod is owned by the Homebrew cut.** `release.yml` builds, signs (Developer ID, reusing
  `scripts/sign-and-notarize.mjs`), and ships `pd-console-prod.app` alongside `pd`/`port-daddy`.
  Set `PD_CONSOLE_SIGN_IDENTITY` for a real-signed local prod build; default is ad-hoc.
- Dev lane never touches the `~/.port-daddy/bin/pd-console` PATH shim — only prod/latest do.

## FleetBar lanes + the app watcher (auto-refresh on main / Homebrew cuts)

FleetBar mirrors the console's lane model via `apps/FleetBar/scripts/package-fleetbar-lane.sh`:

| Lane | Bundle | launchd label |
|------|--------|---------------|
| **prod** | `~/Applications/Port Daddy/FleetBar.app` | `com.portdaddy.fleetbar` |
| **latest** | `~/Applications/Port Daddy/FleetBar (dev-latest).app` | `com.portdaddy.fleetbar.devlatest` |
| **dev** | `~/Applications/Port Daddy/FleetBar-dev-<YYYYMMDD-HHMM>-<name>.app` | none (`open` once) |

prod/latest are KeepAlive menu-bar agents, so the lane script swaps the bundle and
`launchctl` re-bootstraps + kickstarts the label — "close running, launch new" is one command.

**The operator's machine keeps itself fresh** via `scripts/pd-app-watch.sh`
(LaunchAgent `com.portdaddy.appwatch`, installed by `scripts/install-app-watch.sh`,
polling every 3 min):

- `origin/main` moved → rebuild + relaunch **pd-console-latest.app** and
  **FleetBar (dev-latest).app**. Polling, not a git hook, because main mostly moves
  via the GitHub merge queue where no local hook fires.
- the Homebrew tap cut a new `port-daddy` version → `brew upgrade` (re-starting the
  daemon service if brew churn unloaded it), then rebuild + relaunch
  **pd-console-prod.app** and **FleetBar.app** from that release tag.

Builds run in a dedicated clone at `~/.port-daddy/app-watch/repo` — never in anyone's
working checkout. State + per-build logs live in `~/.port-daddy/app-watch/`; the main
log is `~/.port-daddy/app-watch.log`. A SHA/version whose build fails is not retried
until it moves again (the failure notification tells the operator); force a rerun with
`~/.port-daddy/bin/pd-app-watch.sh --force-latest` / `--force-prod`.

## Show-me runbook (operator demos)

When the operator asks to *see* any pd-console / FleetBar / daemon feature, run this
sequence. Every item below is a real failure from a live demo (2026-07-12), not theory.

1. **Build the TRIPLE from the feature branch** via `scripts/dev-triple.sh <label>`, and
   make sure the daemon carries its berth identity: it must launch with
   `PD_DAEMON_TIER=dev PD_DAEMON_LABEL=<label> PD_DAEMON_COLOR=<hex>
   PD_DAEMON_SOURCE_DIR=<worktree>` (the `BERTH_ENV` keys in `shared/daemon-berths.ts`)
   so it self-registers into `~/.port-daddy/dev-daemons.json`. An unregistered berth is
   an invisible daemon — FleetBar's Daemons list never shows it. `dev-triple.sh` now
   exports these itself; if you launch a daemon any other way, export them yourself.
2. **Seed live state before the operator looks.** An empty daemon renders empty panes —
   it can't render what it has no backend for. For claim/conflict surfaces: create two
   sessions and file overlapping `POST /sessions/:id/files` claims (`agentId` is
   required in the body).
3. **Feature spans multiple unmerged PRs? Build a COMBINED local preview branch** —
   merge the PR branches locally (do not push it) so the operator sees the sum, not one
   slice. An operator looking at branch A files rage-bugs about everything branch B
   already fixed.
4. **`pd-console-repl` / terminal-face artifacts are never operator review material.**
   They are machine-gate evidence only. Operator review = the GPUI app, running, seeded.
5. **Emoji sweeps must grep BOTH literal emoji AND unicode escapes**
   (`\u{2693}`, `\u{1F...}`) — escaped emoji are still emoji on screen, and the
   no-emoji-as-icons rule applies to what renders, not what greps.
6. **Never create virtual displays or modify display settings.** On-primary-screen
   window openings are allowed only with explicit operator consent, per action.

## HITL escalation & event-cued execution (operator directive, 2026-08-19 — IMPORTANT)

- **A question that blocks progress is asked in a way that blocks execution.** The moment
  work is blocked on operator input — a merge policy, a deploy on the operator's side, a
  scope decision, a spend approval — raise it through the MOST IMMEDIATE human-in-the-loop
  structure the surface offers (`AskUserQuestion` in Claude Code sessions; the HITL
  interruption surface elsewhere) and WAIT for the answer. Never park blocked work behind
  timers, polling loops, silent re-arms, or "the next event will tell me."
- **Blocked longer than one wake cycle = a blocking question.** A gate, merge, or deploy
  waiting on operator action does not get babysat; it gets elevated as a direct question
  the operator must answer before loads continue.
- **Wake on events, not timers.** PR subscriptions, operator messages, and system events
  are the wake signals. Never poll unchanged state on a schedule; never re-fetch what an
  event would have delivered.
- **Launch gates gate launch, not development.** Client surfaces (iOS, web account
  sections, console, FleetBar) build in parallel against staging keys; do not serialize
  development behind a launch gate or hold parallel-authorized waves on unrelated merges.
