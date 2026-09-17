# Fleetbot agent actuator rollout

## Outcome

Every supported agent harness can propose a bounded GitHub action without seeing
the operator's credential or the GitHub App key. A protected remote workload
validates the proposal against a standing grant, binds it to exact repository
state and responsible-agent provenance, performs one typed action, reads GitHub
back, and returns a Relay-signed receipt.

The actuator is an effects boundary, not a free-form GitHub proxy. It will never
accept a shell command, arbitrary URL, arbitrary HTTP request, personal GitHub
token, or ambient `gh` login.

## Delivery sequence

Each phase is its own mergeable PR. A later phase may depend on a merged earlier
phase, but no phase may accumulate unpublished work behind the next one.

| Phase | Roadmap item | Mergeable result | Exit evidence |
| --- | --- | --- | --- |
| A | `fleetbot-pr-authorship` | The enrolled GitHub Actions workload can post one typed PR comment with explicit responsible-agent provenance. | Hostile request fixtures, operation-specific signed receipt verification, protected manual workflow, exact GitHub readback in staging. |
| B | `fleetbot-pr-authorship` | Typed review reply, ready-for-review, reviewer request, and enqueue operations share the same bounded client. | Per-operation fixtures, least-privilege grant tests, ambiguous-write readback tests, staging receipts for every operation. |
| C | `fleetbot-host-workload-enrolment` | A Relay proposal inbox accepts bounded action proposals from admitted host agents without handing them publisher authority. | Agent identity, repository and operation scope, proposal digest, expiry, deduplication, denial fixtures, durable status API. |
| D | `fleetbot-host-workload-enrolment` | One protected remote executor claims proposals, evaluates the standing grant, and drives the actuator. | Claim fencing, retry/readback behavior, executor recovery, spend/rate ceilings, signed proposal-to-receipt lineage. |
| E | `fleetbot-pr-authorship` | Codex, Claude Code, Antigravity, Gemini, and Agy adapters submit the same typed proposal and poll the same receipt contract. | Cross-harness conformance fixtures; no adapter receives an App key, installation token, account bearer, or personal token. |
| F | `fleetbot-pr-authorship` | Typed branch publication and PR create/update complete the PR lifecycle. | Exact base/head/tree binding, path and byte limits, roadmap trailer validation, draft/readiness flow, branch/PR readback, merge-queue evidence. |
| G | `fleetbot-pr-authorship` | Operator UI shows workloads, grants, proposals, denials, mutations, cost/rate use, and receipts, with revocation controls. | Light/dark screenshots, Porthole recording, accessibility checks, production smoke, operator revocation drill. |

## Phase A boundary

Phase A deliberately does not make local agents autonomous. It proves the first
write through the already-merged OIDC workload and standing publisher grant.
The workflow runs reviewed code from `main`, uses the protected
`fleetbot-workload` environment, fetches PR state with a read-only Actions token,
and delegates the mutation to Relay. Relay alone mints and revokes the
repository-scoped GitHub App installation token.

The comment request binds:

- repository, PR number, exact base SHA, and exact head SHA;
- standing grant id, epoch, signing-key generation, nonce, and expiry;
- operation and canonical request digest;
- responsible actor, agent, session, purpose, roadmap item or sidequest reason,
  worktree identity when available, and source branch;
- comment body, including its exact bytes.

Relay stamps the visible Fleetbot signature, resolves ambiguous writes through
complete paginated readback, and signs the final receipt. The client accepts only
`created` or `reused` for a comment receipt.

Conversational effects and state-changing effects have deliberately different
target policy. A comment or review reply may target an ordinary same-repository
pull request, but only at the exact repository, PR number, base SHA, and head SHA
bound into the signed capability and standing operation grant. Readiness,
reviewer requests, enqueue, update, and publication remain restricted to a
uniquely receipted Fleetbot publication on a governed `pd-agent/*` branch. This
lets Fleetbot discuss and answer review on existing work without granting it the
power to advance or merge work it does not own.

## Phase C and D trust split

The host-facing endpoint accepts a **proposal**, not a publisher capability.
Admission to propose does not imply authority to mutate GitHub. The remote
executor is the only holder of the workload signing key and may act only when
the current standing grant covers the exact repository and operation.

This avoids two bad designs:

1. distributing the workload seed to every local harness; and
2. requiring local agents to possess GitHub Actions or operator credentials just
   to request an attributable effect.

Proposal state is append-only: `submitted -> admitted|denied -> claimed ->
executed|ambiguous|failed`. Every transition names its actor and digest. Fencing
prevents two executors from owning the same proposal. GitHub readback decides an
ambiguous mutation; blind retries are forbidden.

## Release discipline

For every phase:

1. Start from a fresh linked worktree at current `origin/main`.
2. Add focused hostile tests before widening the operation set.
3. Commit, push, and open a ready-for-review PR with exact commands and observed
   output in its Test Plan.
4. Answer actionable review through Fleetbot once the preceding phase makes that
   operation available; until then preserve the exact prepared action and name
   the missing operation rather than posting as the operator.
5. Reconcile against the latest base, make required checks green, and use the
   protected merge queue.
6. Verify the merged commit and production/staging receipt before advancing.

Roadmap-Spawns: fleetbot-pr-authorship, fleetbot-host-workload-enrolment
