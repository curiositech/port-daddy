# Repository ship controls

Repository admins can permit or stop cloud review ships from their signed-in
Relay account, without editing YAML or starting the local daemon. This page
documents the source contract; production availability requires the release
sequence below.

## Operator flow

Open **Account → Ship controls**, select `owner/repository`, and choose **Turn
off** or **Turn on** beside a ship. **All cloud ships** controls the whole
repository. Each click saves immediately, then reloads the persisted state.
There is no second Save button. Repo settings also links directly to that
repository's controls.

On means permitted when a configured event arrives, not running. An individual
On cannot override All cloud ships Off or the global Fleet pause. Other
repositories are unaffected. The page lists trusted configuration and built-in
fallback ships, never the full skill catalog or operational prompts. A fallback
ship may be permitted without being selected for the current event.

| Decision | Enforcement | Boundary |
| --- | --- | --- |
| All cloud ships Off | Fresh database read at run entry and between ships | No new cloud review ship work in this repository |
| One ship Off | Fresh read before execution or checkpoint reuse | Other permitted ships can continue |
| XO Off | Before the optional editor and advisory triage | Original findings and proposals remain intact |
| Mediator Off | Before a new post-review scan | Existing signed human orders remain in force |
| Unavailable controls | No new ship work is permitted | Neutral, not an invented passing review |

Already-running ship work may finish. Off is not a process kill, a refund, or a
replacement for a hard spend cap. Local agents, GitHub Actions, and the separate
Steward service are outside this control. A skipped review is **not reviewed**;
it does not become a passing required review.

## Activity and cost evidence

Expand a ship's **activity, costs and transcripts** drawer. The repository
overview starts open. Both show 14 UTC days of recorded cost, tokens, models,
call errors/timeouts and mean latency, plus the latest three relevant runs,
their latest recorded step and an authorized transcript-attempt link. Models
observed in history are distinct from the currently configured model.

These are recorded estimates, not a Cloudflare invoice or a live process check.
Zero/unreported ledger rows are not proof of free usage. The snapshot includes
at most 200 recently created runs and 1,000 rows from each evidence source;
clipping and source failures are labelled. Long-running jobs created before
the window, queued jobs without a run receipt, and pruned history are outside
this view. Refresh is manual: opening the page does not poll or launch work.
Transcript links recheck repository access and may report missing retained R2
content; the overview does not copy raw messages or storage keys into HTML.

The additive `2026-09-08-repo-ship-telemetry.sql` migration supplies scoped
history indexes. It removes no data and is safe to apply repeatedly.

### Cloudflare configuration and remaining instrumentation

The committed Relay and executor deployment files enable Worker observability;
the executor accepts an optional `AI_GATEWAY_ID`. This is source configuration,
not proof of live deployment. On 2026-09-09 UTC, read-only settings requests for
`fleet-executor` and `port-daddy-relay` returned HTTP 403 / Cloudflare code 10000.
The available credential cannot verify their deployed logging or gateway binding.
No production settings, migrations, retention policies, or model calls were made.

The shared ship AI options preserve existing gateway routing and session affinity,
add repo/run/ship/attempt metadata where context exists, and request
`cf-aig-collect-log-payload: false`. They do not enable logging or change caching.
MAP, REDUCE, repair, Purser, and XO use these options. Standalone callers without
run context report only the ship; other provider/agent paths are not claimed
instrumented by this change. XO does not yet capture a full conversation in R2.

Before release, an authorized deployment owner must read back both Workers'
settings and the selected existing gateway. If a new gateway or logging policy
is needed, approve its exact ID, access controls and bounded retention separately.
Verify metadata-only entries and correlation on an explicitly approved fixture
run before claiming live telemetry. Do not enable full payload logs, add an
unbounded collector, delete retained evidence, or incur test-model spend implicitly.

Cloudflare documents [metadata-only payload suppression](https://developers.cloudflare.com/ai-gateway/observability/logging/),
[custom correlation metadata](https://developers.cloudflare.com/ai-gateway/observability/custom-metadata/),
and [Worker logging configuration](https://developers.cloudflare.com/workers/observability/logs/workers-logs/).

## Authority and persistence contract

The page uses the existing signed-in session. Every mutation requires a fresh
GitHub repository-admin witness and a same-origin form POST. Repository names
are case-folded; ship names must belong to the trusted default-branch inventory.
No GitHub credential is placed in the HTML. Requests are byte-bounded, responses
are not cached, and the page works without JavaScript.

`repo_ship_controls` stores one revisioned decision per repository and ship;
`*` is reserved for the repository-wide control. Atomic compare-and-swap refuses
a stale On form after another admin has saved Off. Database triggers append
`repo_ship_control_events` in the same transaction. Removing a personal repo
preference or user account cannot erase a repository-wide Off decision.

No saved decision inherits the trusted fleet configuration. A missing database,
missing migration, corrupt row, or failed read is different: execution stops.
The executor reads D1 freshly at each boundary, not an earlier KV snapshot. The
UI and executor share the same pure fleet document projection; each Worker
decodes YAML with its own installed dependency.

## Release order and acceptance

This change must not enter an uncoordinated auto-deploy. The executor workflow
deploys on relevant pushes to `main`; Relay latest rehearses migrations in
staging, while `relay.portdaddy.dev` is separately released by tag. Applying only
the executor before the production migration stops all cloud review work.

1. Have the deployment owner approve the exact release and preserve the current
   global pause. Do not lift any local Port Daddy halt.
2. Rehearse `2026-09-08-repo-ship-controls.sql` through the staging migration
   process together with `2026-09-08-repo-ship-telemetry.sql` and retain their
   receipts. Do not forge the staging ledger.
3. Through the approved production migration path, add both tables and audit
   triggers to the **same production D1 database** used by Relay and the executor.
   Read back the schema before admitting the executor update. Do not reset data.
4. Release the signed-in page and executor enforcement through their protected
   workflows. Verify actual deployed revisions, not just merged source.
5. With an explicitly approved fixture repository, save Off, reload from a
   second session, test stale-form rejection, and verify a subsequent delivery
   performs no model or sandbox work. No paid live probe is implied by this PR.

Offline evidence covers actual SQLite constraints/triggers, auth denials,
cross-repository isolation, queued continuation, changes between ships, XO, and
missing storage. The opt-in browser test serves the real handler through an
ephemeral loopback adapter with mocked GitHub identity/config. It records actual
click/save/redirect/read-back, mobile width, dark mode, and 200% text zoom; it is
not evidence that the production site has been deployed.

Source: `apps/relay/src/repo-ships-page.ts`,
`apps/shared/repo-ship-controls.ts`, `apps/shared/fleet-config.ts`, and
`apps/fleet-executor/src/execute.ts`. Tests live in the two Worker suites and run
in their existing required CI jobs. No local PD process is needed for them.
