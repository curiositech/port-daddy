# Cloud Fleet stop controls

Implementation record, September 8, 2026. Owner: Codex, solo implementation under
the operator halt; three read-only review subagents separately authorized by
Erich. Branch: `codex/fleet-cloud-controls-20260908`, based on `02a10b284`.
Reconciled with `origin/main` at `0aba23b58` before publishing the review fixes;
that upstream change did not overlap the control implementation or tests.
This work does not restart Port Daddy, enable workflows, or deploy Workers.
The operator explicitly requested a commit and PR for these controls.

## Plan

- [x] Add fresh, fail-closed global and installation-scoped control storage.
- [x] Add account settings and a Cloudflare-allowlisted global administrator page.
- [x] Enforce controls at webhook admission, queued/continuation deliveries,
  and running Fleet action boundaries; remove the old permissive KV path.
- [x] Test authorization, stale forms, storage failures, execution and rendered UI.
- [x] Obtain adversarial subagent reviews, fix demonstrated defects and add regressions.

Publication witness: the PR's actual commit, author and read-back, recorded in
its body. Local checkboxes are not a publication receipt.

## Contract

The account surface controls Cloud Fleet for the GitHub installations the
signed-in person administers. Organization membership alone is not administration.
The global control overrides every installation. Turning the global control on
does not turn any installation on. Missing or unreadable state means off.
An unreadable setting refuses the particular admission check; it does not save
a stop. The page labels failed reads unverified and warns that work may continue
if another consumer can read enabled state successfully.

Global administrators are authenticated accounts whose immutable GitHub numeric
ID is in Cloudflare's `FLEET_ADMIN_GITHUB_IDS` Worker variable. The committed
production allowlist contains only `2093678` (GitHub's read-back for `erichowens`).
An account role, login name, request header or break-glass token is not this grant.
Missing/malformed configuration grants nobody global control.

Controls are read from D1's primary on every admission boundary, without an
allow cache. [KV is eventually consistent](https://developers.cloudflare.com/kv/concepts/how-kv-works/#consistency),
so it cannot be the stop authority. [D1 first-primary sessions](https://developers.cloudflare.com/d1/best-practices/read-replication/#start-a-session-with-all-latest-data)
select current data for each check. Saving a control uses a revision precondition
and an atomic audit record, so a stale browser cannot silently resume a later stop.

A stop prevents newly admitted work. Already-issued network requests cannot be
recalled; running work observes the next guarded boundary. This is not an OS
process kill, a deployment receipt, or a claim that older installed clients obey
new code. Local daemon/FleetBar settings and unrelated Steward automation remain
separate controls. Deployment must not resume the operator's local halt.

## Surfaces and authority

| Surface | Read/change authority | Stop scope |
| --- | --- | --- |
| `/account/fleet` | Signed-in personal installation owner or active organization admin, checked against GitHub on every request | Exact immutable installation ID |
| `/admin/fleet` | Verified GitHub user ID in Cloudflare `FLEET_ADMIN_GITHUB_IDS` | All Cloud Fleet installations |
| `POST /v1/fleet/pause` | Same allowlist, authenticated browser or existing account-backed `pdu_` token | Global only; `{paused, revision}` required |
| `GET /v1/fleet/health` | Existing observability authorization | Read-only; includes `controlRevision` and `controlAvailable` |

Browser writes require an exact same-origin `Origin` and bounded, allowlisted
form fields. The server derives actor and target; form data cannot nominate an
administrator or a global scope. GitHub's [accessible installation list](https://docs.github.com/en/rest/apps/installations#list-app-installations-accessible-to-the-user-access-token)
is not an admin grant. Organization control additionally verifies an
[active admin membership](https://docs.github.com/en/rest/orgs/members#get-an-organization-membership-for-the-authenticated-user).
The GitHub App must have the necessary organization-membership read permission;
unavailable authorization exposes no installation controls and makes no change.
A definitive organization membership 404 denies that organization alone;
independently verified personal/admin installation controls remain available.

`fleet_controls` stores one setting per `global` or `installation:<id>` scope.
SQL triggers append every successful revision to `fleet_control_audit` in the
same transaction. If that audit fails, the change rolls back and the UI reports
failure; never assume a failed stop was saved. Neither table stores credentials,
prompts, repository content or email addresses, only scope, boolean, revision,
authenticated account ID and timestamp. These are shared control/security
records, not private chat history: account erasure must not delete a shared
installation stop or silently enable other users' automation. Audit retention
and operator-authorized audit export remain database-administration operations;
this PR does not add an audit browser or account-export UI.

Stopped queue deliveries, including continuation and dead-letter deliveries,
are acknowledged and marked cancelled where storage is available. They do not
mint GitHub tokens or publish a neutral check. Enabling later does not replay
cancelled work; a newly admitted delivery is required. Model calls recheck even
between chunks/retries, and returned model output is discarded if the next
publication boundary observes a stop. Relay's manual Fleet model-test and prompt
optimization endpoints also require global enablement; they have no tenant job.
An observed stop is retained for the rest of an executor invocation, even if
storage recovers or a nested best-effort handler sees the error. Stop exceptions
remain terminal through model resilience/repair. Fresh checks run after cache,
signing, metadata and channel-tail waits, immediately before new credential or
publication requests; completion retries recheck too. Every new sandbox command,
process and coordination grant is guarded. Cleanup remains allowed.

## Deployment and rollback gate

No deployment was performed for this change. The next authorized release must:

1. Keep the local operator halt in force. Independently contain old cloud
   consumers before replacing them; old versions do not obey this D1 contract.
2. Apply `2026-09-08-fleet-controls.sql` to the intended D1 database. Verify the
   two tables and two audit triggers. The migration inserts **no enables** and
   does not import old KV flags.
3. Deploy every executor consumer (review, merge-group and dead-letter queues)
   with its `DB` pointing to that same database, then deploy Relay with this
   migration and the matching database. A missing binding/table closes admission.
4. Verify Cloudflare's production `FLEET_ADMIN_GITHUB_IDS` is exactly `2093678`.
   Configure each environment explicitly; production and `latest` are separate
   D1 stores. Do not expose this list as an account-editable field.
5. With Fleet still off, verify signed-in account/admin pages, ordinary-user 403,
   stale-form rejection, a persisted stop/readback and stopped queue behavior.
   Resume globally or per installation only on a separate explicit operator
   decision. No deployment or migration should perform that decision.

Older native clients that send only `{paused}` or a break-glass credential are
now refused. Use the account/admin web controls until those clients implement
the new revision/authentication contract; this PR does not claim native parity.
An existing required Fleet check may remain pending after a stop. Do not spend
or post merely to satisfy that check; required-check policy is separate work.

Do **not** roll back to a pre-control Worker and assume a saved D1 stop protects
you. Contain its queue consumer independently first. Keep control and audit data;
never undo the migration as a way to resume or erase a stop.

The current automatic deployment path filters do not include shared-only edits
to `shared/fleet-controls.ts`. Do not infer deployment of a later shared-contract
fix from a merge or a skipped workflow: an authorized release must explicitly
publish both consumers and verify their versions. This slice does not change,
enable or dispatch deployment workflows.

## Validation and product evidence

- Relay: 1,455 tests pass. Executor: 1,041 tests pass. Both suites use synthetic
  GitHub/model bindings, not paid agents or live services. Both application
  typechecks, the repository-root typecheck and offline Worker bundles pass. Migration-chain
  check passes (25 migrations, 64 tables).
- Real SQLite proves compare-and-swap, trigger audit, audit-failure rollback,
  missing state and independent installation decisions. Tests cover unavailable
  primary reads/timeouts, old-token rejection, cross-origin/other-tenant writes,
  revoked organization authorization and stop during an actual stubbed model call.
- [Offline render evidence](../artifacts/fleet-cloud-controls-20260908/README.md):
  light/dark desktop/mobile screenshots, real browser video, layout geometry and
  200% text-scaling checks. These are labelled fixtures, not deployment receipts.
- Shared account styles moved to dependency-free `account-theme.ts` after the
  real renderer exposed an auth/page import cycle. Existing account pages use
  the exact same tokens; no alternate theme or authentication path was added.
- Three read-only adversarial subagents reviewed account/admin security,
  execution boundaries, and rollout/UI truth at `1e77bc12`. Ten demonstrated
  defects were fixed and re-reviewed; see the [review record](../artifacts/fleet-cloud-controls-20260908/adversarial-review.md).
  No Fleet reviewer, daemon, app launch, workflow dispatch, merge or deployment.
  The PR owns source/test evidence only.

Architecture check: this slice enforces explicit, revocable, scoped admission;
it does not claim new cryptographic authority, an autonomous actuator or complete
epistemology. The federated/least-authority model remains unchanged. The gap
between source, deployed versions and observed cloud behavior stays explicit.
