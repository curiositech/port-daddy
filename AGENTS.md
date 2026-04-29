# AGENTS.md

Project-specific shibboleths for proficient Port Daddy work. If you learn a new one that materially changes how to operate this repo, add it here immediately.

## Port Daddy First

- On this computer, use Port Daddy for repo work by default, not only when a task already looks multi-agent.
- Start recovery, debugging, and parallel-work sessions with Port Daddy before doing local archaeology:
  - `pd status`
  - `pd briefing`
  - `pd salvage` when crash residue or abandoned work might matter
  - `pd begin --identity <project>:<task>`
- If you are going to edit files, coordinate through Port Daddy primitives, not only prose:
  - leave a `pd note` describing scope and intended files
  - prefer symbol/region claims for code edits when the symbol index knows the file; use whole-file claims only when the edit truly spans the file or no symbol/section identity exists
  - use `pd lock` / `pd with-lock` for scarce critical sections, generated artifacts, migrations, promotion, or other work that really must be exclusive
  - use tuples, inbox, pheromones, or other shared state when the task benefits from machine-readable coordination
- Treat plain shell inspection without a Port Daddy session as insufficient for this repo unless you are doing truly trivial read-only work.
- During active repo work, keep listening. Re-read live `pd notes`, `pd activity`, `pd sessions --all-worktrees`, and relevant file ownership before switching scope, before editing a contested surface, and after daemon/session restarts. A stale local plan is not coordination.
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

- Do not assume the live daemon is running the current checkout.
- Verify live truth with:
  - `port-daddy status`
  - `launchctl print gui/501/com.portdaddy.daemon`
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

## Promotion

- The real promotion path is `./scripts/promote-stable.sh`.
- Do not hand-roll daemon promotion with ad hoc `launchctl` commands if the script exists.
- If the user asks to "promote the daemon", run the script first and report the exact blocker if it fails.
- Promotion to stable is not a rare release ceremony here; user-facing runtime/control-plane fixes often need prompt promotion, or the live daemon/UI will keep lying from an older checkout.
- `/Users/erichowens/port-daddy-stable` is a clean promotion target, not a live dogfood sandbox.
- Do not run fleets, background daemons, Spark, Spider, or local build outputs in the stable checkout.
- If stable accumulates `.spark/`, `.spider/`, `port-daddy.log`, `port-registry.db`, `public/fleet-ui`, or tracked build garbage, treat that as operator misuse to rehabilitate before the next promotion.
- If promotion is blocked by dirty archaeology, split green feature/parity slices from intentionally red bug-battery tests; do not bundle known-red test files into an otherwise promotable commit.
- The script expects:
  - current branch is `main`
  - no uncommitted source changes in `lib/`, `server.ts`, `mcp/`, `routes/`, `bin/`, or `tests/`

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
- `createSpawner()` defaults telemetry enforcement on. Any code that opts out with `enforceTelemetryPolicy: false` must attach explicit HITL confirmation metadata; a silent bypass is a policy violation.
- Opaque backends are not "good enough for now." If a backend cannot prove exact telemetry end to end, it should stay blocked in readiness, preflight, and the live spawner.
- The backend catalog is broader than the currently launchable surface. Right now, operator-facing launches are only expected to succeed on the Claude SDK path with an exact-rate model entry; the other listed backends remain implementation surfaces until telemetry parity exists.
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

## Website And Public Content

- When adding or refreshing website, docs, blog, examples, tutorial, or launch pages, include Nano Banana/Gemini-generated imagery by default to keep the page visually alive. Treat generated images as product-supporting assets: they should clarify the real Port Daddy workflow, not replace screenshots, CLI proof, or live product truth.
- Reuse existing prompt sheets, generated assets, optimization scripts, and visual-review artifacts before inventing a new image pipeline. If new imagery is needed, leave the prompt/source path and optimized outputs discoverable in the repo.
- The public website deploy target is Cloudflare Pages project `port-daddy`, serving `port-daddy.pages.dev` and `portdaddy.dev`. Build with `npm --prefix website-v2 run build`, then deploy from `website-v2/` with `npx wrangler pages deploy dist --project-name port-daddy --branch main --commit-hash "$(git rev-parse HEAD)" --commit-message "$(git log -1 --pretty=%s)"`.
- Deploy from a clean checkout or clean temporary worktree. If `origin/main` moved after your local website commit, deploy latest `origin/main` unless the user explicitly requested a specific commit. After deploy, smoke `https://portdaddy.dev/...` and at least one changed asset/page; for visual work, verify with Playwright or the in-app browser instead of trusting Wrangler success alone.

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

- **Node:** `getDaemonTcpUrl(process.env.PORT_DADDY_URL)` from `shared/daemon-discovery.ts`
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
