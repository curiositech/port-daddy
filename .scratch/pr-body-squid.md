## Summary

This successor consolidates the broken Giant Squid and release branches into one truthful operator path. `pd squid on` now stages and wires the complete interactive harness for Claude, Codex, Gemini, and agy; user-scoped provider configs remain inert unless the exact physical project root is armed and the daemon heartbeat is fresh. The duplicate `pd squid hooks` command is removed, while `pd hooks install` remains the explicit hook-only repair surface.

The CLI now fails closed when any required asset, provider config, visible identity, Pilot hook, or slash command cannot be installed. One shared conformance model publishes `LIVE`, `READY`, `PARTIAL`, or `UNPROTECTED` truth to the CLI, `/agent-roster`, FleetBar, and the Rust `pd-console`. Every agent row names its score, active TURN/EDIT/TRACE/INBOX/PARLEY capabilities, missing protection, and exact repair. The hooks explicitly narrate the value added outside the conversation: fresh context before turns, collision protection before edits, and fleet traces after tools.

Release packaging now has one shared runtime asset resolver, stages every Squid repair companion for every local or release build, requires the Pilot SessionStart hook in the Batten manifest, and launches the staged compiled binary outside the source tree to prove all four provider scopes and identity assets before packaging. Prompt injection is bounded to an exact project, 30-minute freshness, 12 entries, and 4 KiB. The slice also closes the outstanding Fleetbot Batten findings: incomplete imprints never print success, verify/imprint permission tiers are truthful, module fallback is exercised, and the local ephemeral daemon no longer mistakes an installed Homebrew binary for its own runtime.

The canonical daemon lifecycle is now one launchd-owned generation. Start/restart/status/Doctor share the same launchd, PID, port-file, `/health`, heartbeat, and binary truth; stable startup fails closed on occupied `9876`; PID and heartbeat publish before heavy bootstrap; packaged SQLite integrity runs read-only out of process. The installed Developer-ID-signed binary, including Bun JIT entitlements, is live on one PID and one port with a converged control-plane verdict.

`pd attention` no longer answers a channel-less agent with a dead end. It ranks exact declared and protocol channels from structured scope/activity facts, explains why each matters, and offers `--subscribe-recommended`. Direct inbox and Parley delivery remain explicit; the product does not claim automatic Parley convening, unsaved-buffer backup, or automatic skill grafting.

The Fleet merge gate now drains instead of silently reviewing obsolete heads. Production consumes its dead-letter queue, processes the main queue through one-message batches with one active consumer invocation, acknowledges stale PR heads before model spend, and evaluates independent MAP chunks with an ordered concurrency cap of eight. Hook status inspection is read-only, and inbox/sent/agent-inbox previews safely render structured agent messages instead of crashing on non-string content.

This PR supersedes #3496 and #4306. It incorporates their watchdog/Batten/release-cargo intent and preserves #4262 as a separate skill-generalization follow-up rather than duplicating its product path. Separately, the live `main merge queue` ruleset was repaired from 18 stale individual contexts to the four merge-group-safe aggregators: `ci-gate`, `roadmap-link`, `pr-requirements-guard`, and `Port Daddy Fleet`.

## Test Plan

- `npm run typecheck` -> exit 0, no TypeScript diagnostics.
- Atomic daemon regression: 203 focused tests passed; packaged artifact passed a 75-second load soak; final signed install reports launchd, `/health`, PID file, port file, and Bosun heartbeat converged on PID `58288` at `:9876`.
- Current Squid/attention/roster/package regression on Node 22 -> 6 suites, 96 tests passed, 0 failed.
- `cargo test -p pd-console active_agents_pane` -> 2 roster/conformance tests passed, 0 failed.
- `website-v2: npm run build` -> 297/297 skill audit and production Vite build passed.
- Live read-back -> this worktree is `LIVE` at 100% with 4/4 provider integrations; `/agent-roster` reports 10 agents: 8 `LIVE`, 2 `PARTIAL` legacy `/private/tmp` sessions with safe `~/coding/tmp` resume guidance.
- Focused runtime regression: 12 suites, 271 tests passed, 0 failed (Squid, hooks, asset resolution, Batten, permissions, FFI fallback, skill sync).
- Full Jest pass on direct Node 22 -> 504 suites passed, 11,090 tests passed, 3 suites / 9 tests intentionally skipped, 0 failures.
- `swift test --package-path apps/FleetBar` -> 103 tests passed, 2 opt-in snapshot tests skipped, 0 failures.
- `./dist/pd batten verify --staged-dir dist` -> all 10 declared release artifacts present and valid.
- `node scripts/smoke-squid-release.mjs dist/pd dist` -> `SQUID RELEASE SMOKE PASS: 4 providers, state READY` from outside source, with fake isolated homes for every provider.
- `npm run check:skill-mirrors` -> 13 checked-in mirrors synchronized; deterministic skill audit -> 297/297 valid; auditor tests -> 10/10 passed.
- Exact-root adversarial cases cover an armed repo, an unarmed sibling with its own `.portdaddy`, missing packaged assets, no supported CLIs, invalid provider config, stale prompt entries, 12-entry/4-KiB bounds, and a forced TypeScript macaroon fallback.
- Fleet executor regression -> 190 tests passed, 0 failed; typecheck and Wrangler dry-run passed. Live production lists consumers for both `fleet-runs` and `fleet-runs-dlq`; deploy-contract tests require `max_batch_size = 1` and `max_concurrency = 1` on the main queue. Each ship's MAP chunks complete through ordered eight-wide fan-out without concurrent PR deliveries multiplying that load.
- Hook status regression -> 18 tests passed, 0 failed; `pd hooks status` cannot fall through to installation.
- Inbox formatting regression -> 14 tests passed, 0 failed; string, object, scalar, and null message bodies render safely across `pd inbox`, `pd sent`, and `pd agent inbox`.
- DB open guard regression on Node 22 -> 22 tests passed, 0 failed; the packaged read-only integrity helper now runs the same fail-closed production-DB test guard as `initDatabase` without a circular dependency. Root typecheck passes.
- Compiled Doctor identity regression -> clean daemon and CLI binaries built; `doctor --json` and `doctor --ci` both exited 0 with 37 ok, 8 warn, and 0 critical. The isolated runtime converged across `/health`, `daemon.pid`, `daemon.port`, and Bosun heartbeat on its selected private port while production remained strict on canonical `:9876`.

## Visual Proof

The FleetBar screenshots are the real production `SquidHarnessStrip` SwiftUI view. The terminal recordings are fresh action-to-outcome runs of the installed harness contract; the rejected four-second FleetBar recording is intentionally omitted because it never displayed the final green frame.

### Needs repair

![Giant Squid needs repair](https://raw.githubusercontent.com/curiositech/port-daddy/codex/squid-harness-recovery-20260801/apps/FleetBar/docs/artifacts/squid-harness/01-needs-repair.png)

### Live after Repair

![Giant Squid live](https://raw.githubusercontent.com/curiositech/port-daddy/codex/squid-harness-recovery-20260801/apps/FleetBar/docs/artifacts/squid-harness/02-live.png)

### PARTIAL to LIVE motion proof

![Giant Squid conformance activation](https://raw.githubusercontent.com/curiositech/port-daddy/codex/squid-harness-recovery-20260801/website-v2/public/demos/harness/harness-conformance-live.gif)

### Actionable attention motion proof

![Port Daddy attention ranking and arming recommended watches](https://raw.githubusercontent.com/curiositech/port-daddy/codex/squid-harness-recovery-20260801/website-v2/public/demos/harness/harness-attention-activation.gif)

The real GPUI `active-agents` window was built and rendered at 1200x800, and its pane tests pass, but macOS denied Screen Recording to the agent, Terminal, and iTerm2. This PR therefore does not reuse the stale native-console screenshot or claim a fresh GPUI capture.

## Surface Parity & Docs

- [x] `npm run parity` passes all 112 manifest features (48 pre-existing README documentation warnings only); this consolidates existing Squid/hooks subcommands and adds a JSON status representation for FleetBar.
- [x] README, CHANGELOG, public skill, internal contributor skill, and checked-in tool mirrors are updated.
- [x] The operator surface has committed literal FleetBar screenshots and two fresh action-to-outcome recordings; the unavailable GPUI capture is disclosed above.

## Coverage & Build

- [x] New TypeScript and Swift code has behavior and failure-path tests.
- [x] `npx tsc --noEmit` clean.
- [x] Full repository suite is green: 504 suites and 11,090 tests passed with zero failures.
- [x] Compiled single-binary build, Batten cargo verification, and source-independent release smoke pass.
- [x] Installed Developer-ID-signed runtime and exact-root 4/4 LIVE conformance read back from the canonical daemon.
- [x] Existing bridge, hook-only repair, provider configs, user-owned statusline preservation, and FleetBar refresh behavior remain covered.

## Roadmap link

Roadmap-Item: giant-squid-hook-reliability-and-operator-proof

## Changelog & Parsimony

- [x] `CHANGELOG.md` updated.
- [x] One product path: `pd squid on|off|status|tap`; the misleading duplicate install command is gone and `pd hooks install` has the narrower repair contract.

## Adversarial review

- [ ] CI Fleet and adversarial review must run; every HIGH finding will be fixed or contested with evidence before queueing.
- Verdict: PENDING REVIEW
