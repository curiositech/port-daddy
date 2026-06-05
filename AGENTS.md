# AGENTS.md

Project-specific shibboleths for proficient Port Daddy work. If you learn a new one that materially changes how to operate this repo, add it here immediately.

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

## Port Daddy First

- On this computer, use Port Daddy for repo work by default, not only when a task already looks multi-agent.
- Start recovery, debugging, and parallel-work sessions with Port Daddy before doing local archaeology:
  - `pd attention` — **first command of every session.** Reads unread inbox + subscribed channels in one call, marks them seen. Without this, other agents can route messages, file conflicts, or coordination signals at your agent id and you will never see them. The Claude Code SessionStart hook in `.claude/settings.json` runs this automatically and pins the output into context; for other harnesses, run it manually.
  - `pd status`
  - `pd briefing`
  - `pd salvage` when crash residue or abandoned work might matter
  - `pd begin --identity <project>:<task>`
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

## Ambient Collaboration

- Do not force agents into constant direct chat. Default collaboration should be ambient and structured:
  - publish scope, assumptions, touched files/symbols, validation, blockers, and handoffs through `pd note`
  - use claims/regions for edit intent, tuples for machine-readable facts, scoped channels for event notifications, and actor inboxes for durable role ownership
  - use pheromones/file heat for contention signals, not ordinary progress narration
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

## Pull Request Operating Procedure

Every PR opened in this repo MUST go through skeptical adversarial review
before merging. The author cannot self-approve by typing "looks good." The
flow is:

1. **Open the PR.** Branch claimed via `pd begin --identity` + `pd session
   files add ...`. CI must be green (or you must explicitly justify each
   red check in the PR body).
2. **Spawn a skeptical reviewer agent.** Use the `feature-dev:code-reviewer`
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
5. **Treat bot comments as real review findings.** Copilot, Claude review,
   Cloudflare Pages, CodeQL, release, or other automation comments are not
   background noise. Reply to every actionable bot thread with fixed /
   deferred / contested-because, and push a fixup commit for every valid
   high-confidence finding before asking a human to look.
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

### Create / Update / Land mechanics

The numbered flow above is the *review contract*. This subsection is the
*mechanical contract* — the exact command sequence each phase resolves to.

- **Create.** Branch in a linked Git worktree off `origin/main` under
  `~/coding/tmp/wt-<slug>` (never the main checkout — the main checkout
  carries the operator's WIP). Then `pd begin "<purpose>" --identity
  port-daddy:<type>:<slug>` → a scope `pd note` → `pd session files add
  <files>` *before* editing → edit → `pd guard check --staged` → commit
  (no Claude co-author trailer) → `git push -u origin <branch>` → `gh pr
  create` → `pd done`.
- **Update** (review + CI). Pull bot review comments with `gh api
  repos/curiositech/port-daddy/pulls/<n>/comments` and fix the real ones.
  Address every HIGH adversarial-review finding as a named fixup commit.
  Make `npx tsc --noEmit`, jest, `npm run parity`, and the build all
  green. Rebase onto the latest `origin/main`, resolving conflicts. Push.
- **Land.** Merge in dependency order: base PR before dependent PR, and
  *rebase the dependent after each merge* — mergeability can flip from
  MERGEABLE to CONFLICTING the instant the base lands. `gh pr merge <n>
  --squash --admin`. **`--admin` is correct here** because it bypasses both
  the BEHIND/up-to-date branch gate and the Cloudflare Pages check. The
  Cloudflare Pages check is an **external gate** (it lives in the Pages
  build pipeline, not the repo's CI) that always reports failure on PRs and
  is *never* a merge blocker — see the `## Website And Public Content`
  notes on the `port-daddy` Pages project.
- **Cleanup.** Delete a worktree ONLY when its branch is merged AND `git -C
  <wt> status --porcelain` is clean. Never delete a worktree that still has
  uncommitted work. Never `git reset` or otherwise clobber the main
  checkout — it carries WIP that is not yours.

### Shell gotchas (real and recurring)

These bite every contributor session; they are not theoretical.

- **`git add -A` is refused by the pd-shim.** When you truly mean "stage
  everything" (rare — prefer explicit paths), set `PD_SHIM_OFF=1 git add`
  deliberately so the bypass is intentional and visible in the command.
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
  - `docs/recovery/PD-AGENT-SORTIE-PLAN.md` for mission/sortie behavior
  - `docs/DELEGATION-MODES.md` for spawn vs agent vs sortie vs fleet vs harbor
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
- `fleet-config-ui` is the real control plane surface.
- `public/fleet-ui` is the built artifact served by the daemon.
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
- If fleet spawn counts are exploding, treat that as a budget-control bug. Check `singleton`, respawn policy, schedule/trigger churn, and project limits before allowing more agent launches.
- `pd fleet run <agent>` now inherits `limits.budget_usd_per_day` as its launch ceiling. If it still fails, inspect the live active-agent cap and queue pressure before assuming the agent prompt or backend is broken.
