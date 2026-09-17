---
name: github-app-actuator
description: >-
  Publish branches, pull requests, comments, review replies, readiness changes,
  reviewer requests, and merge-queue actions through Port Daddy's attributable
  GitHub App actuator without exposing or falling back to an operator's personal
  GitHub credentials. Use before any GitHub mutation, when a PR would otherwise
  appear as the human operator, when retiring ambient gh authentication, or when
  diagnosing a missing Fleetbot publication capability. NOT for read-only GitHub
  inspection unless repository policy brokers reads too, and not authority to
  start the halted local Port Daddy runtime.
license: Apache-2.0
allowed-tools: Read,Write,Edit,Bash,Grep,Glob
metadata:
  category: Agent & Orchestration
  tags:
    - github-app
    - fleetbot
    - actuator
    - credential-isolation
    - pull-request
  provenance:
    kind: first-party
    owners:
      - port-daddy
  pairs-with:
    - skill: agent-pr-authoring
      reason: Defines the PR lifecycle whose external mutations this actuator performs.
    - skill: agentic-zero-trust-security
      reason: Reviews credential custody, replay, scope, and same-UID isolation.
---

# GitHub App Actuator

The actuator performs an already-authorized GitHub effect. It does not decide
what should happen, and the proposing agent never receives a GitHub credential.

## Non-negotiable boundary

```text
agent proposal -> exact one-use grant -> protected actuator -> GitHub App token
                                              |                    |
                                              |                    +-- revoked
                                              +-- signed read-back receipt
```

- The operator's PAT, OAuth token, `pdu_` account bearer, browser session, and
  ambient `gh` login are never publication inputs.
- The GitHub App private key and installation token never enter agent memory,
  environment variables, command arguments, Git credential helpers, logs, or
  returned tool data.
- The actuator accepts a fixed operation and bounded structured fields, not a
  shell command, URL, arbitrary HTTP request, or Git configuration.
- Every grant binds the responsible actor and session, repository, operation,
  exact head/base, content digest, expiry, nonce, signing-key generation, and
  roadmap item or explicit sidequest reason.
- One logical mutation produces one durable receipt. An ambiguous response is
  resolved by exact read-back, never by a blind retry.

Same-UID policy files are guidance, not confinement. A durable installation must
run the credential custodian as a separate OS identity or remote service and
deny the agent account access to its keychain, private key, and service secrets.

## Use it

1. Finish and validate a coherent commit in a linked worktree. Fetch and
   reconcile before publication; keep inherited repository hooks inert when the
   local Port Daddy halt requires that.
2. Prepare the exact structured operation. Supported contract operations are
   `pull-request.publish`, `pull-request.update`, `pull-request.ready`,
   `pull-request.request-reviewers`, `pull-request.comment`,
   `pull-request.review-reply`, `pull-request.enqueue`, and
   `pull-request.inspect`.
3. Submit it only through the configured Fleetbot actuator. The canonical
   contract is `lib/github-publisher-contract.ts`; the protected Relay executor
   is `POST /v1/fleetbot/publish`. Do not invent a shell/CLI substitute.
4. Require the returned receipt to identify `port-daddy[bot]`, the exact
   repository and operation, source and GitHub head SHAs, responsible
   actor/session, roadmap scope, verification time, and token-cleanup result.
5. Read the provider state again. Match exact head/base, PR number/state, comment
   marker, or queue state as appropriate. Preserve the receipt with the work.
6. Continue owning the PR: answer reviews through the actuator, add tests, keep
   CI green, and verify the immutable merge result.

## Current admission status

The Relay publisher now rejects the former `pdu_` account-bearer path. GitHub
Actions can enroll an Ed25519 workload identity through OIDC, read a bounded
standing publisher-grant snapshot, sign an exact capability, and verify the
Relay-signed receipt. The protected workload client is
[`../../scripts/fleetbot-workload.mjs`](../../scripts/fleetbot-workload.mjs);
the reviewed-code smoke is
[`../../.github/workflows/fleetbot-workload-smoke.yml`](../../.github/workflows/fleetbot-workload-smoke.yml).

Do not overstate that foundation. The client exposes enrollment, read-only
inspection, and typed requests for PR comments, review replies,
ready-for-review, reviewer requests, and merge-queue enrollment;
[`../../.github/workflows/fleetbot-actuator.yml`](../../.github/workflows/fleetbot-actuator.yml)
is the protected reviewed-code entry point for those writes. Its steady-state
write path does not request OIDC or exchange identity again. Source presence is
not deployment evidence: publishing is available only after the environment,
grant operation, workload key, Relay receipt key, and deployed Relay version are
verified together. Comments and review replies may target an ordinary
same-repository PR at its capability-bound exact head; readiness, reviewer,
enqueue, update, and publication operations remain restricted to uniquely
receipted Fleetbot-owned branches. Phase A verifies the GitHub dispatcher; its
agent and session fields remain explicitly labeled as dispatcher-supplied until
the proposal broker admits them from durable identity state. Local harnesses do
not yet have a proposal broker.

The protected actuator prepares and uploads a signed, non-secret recovery
manifest before its first mutation attempt. Do not rerun that mutation job:
GitHub's upload-artifact tracker documents attempt-one artifacts becoming
unavailable after a rerun begins
([actions/upload-artifact#585](https://github.com/actions/upload-artifact/issues/585)).
Instead, dispatch the separate protected **Fleetbot receipt
recovery** workflow with the original run id. It retrieves the original-run
artifact and calls only `POST /v1/fleetbot/publisher-receipts/recover` with a
fresh domain-separated read proof. Recovery returns an already finalized,
Relay-signed receipt. It never reads the current PR, obtains a GitHub token,
consumes another mutation capability, or calls the publish endpoint. Missing,
running, failed, ambiguous, corrupt, and legacy-unbound intents stop without a
fallback write. This recovers loss of Relay's final response; it does not claim
that an ambiguous GitHub effect is safe to retry. Never blind-retry a write.
Recovery currently requires the original publisher grant, workload identity,
signing-key generation, and Relay receipt key to remain current. Expiry,
revocation, or rotation fails closed; artifact retention does not extend
authority. Planned cross-rotation recovery requires the separately reviewed
key-lineage phase rather than accepting an untrusted historical key.
Never copy the Actions workload seed into
Codex, Claude Code,
Antigravity, Gemini, Agy,
or a local helper to bridge that gap. Follow
[`../../docs/plans/FLEETBOT-AGENT-ACTUATOR-ROLLOUT.md`](../../docs/plans/FLEETBOT-AGENT-ACTUATOR-ROLLOUT.md).
Direct use of an operator credential or ambient `gh` login does **not** satisfy this
skill's boundary, even when the intended GitHub effect is otherwise authorized.

## Missing actuator

Do not turn infrastructure absence into authorship fraud. Preserve the commit,
branch name, exact base/head, prepared PR body or comment, and required operation.
Report which actuator operation or grant is missing. Publication remains pending;
the code is recoverable but not delivered.

## Personal-credential retirement ceremony

This is exceptional and must name the one final allowed operation.

1. Publish the cutover through `port-daddy[bot]` and verify bot authorship and
   exact provider state.
2. Remove the operator login from every agent-visible `gh` host configuration,
   Git credential helper, environment injection, launcher, and CI secret.
3. Revoke the credential at GitHub. Local `gh auth logout` alone is not remote
   revocation.
4. Rotate any credential ever printed, copied into a prompt, exposed to a
   same-UID process, or stored in an agent-readable file.
5. Verify without printing secrets: no `GH_TOKEN`/`GITHUB_TOKEN`; no authenticated
   `gh auth status`; no credential returned for GitHub; unauthenticated `/user`
   returns 401; the App actuator can still perform a separately authorized test.
6. Record only token kind, storage location removed, revocation timestamp,
   verification results, and actor. Never record a token or recoverable prefix.

## Reject these shortcuts

- “Use `gh` just this once” outside the named retirement ceremony.
- Passing the App private key to a helper running as the agent.
- Treating token expiry as proof of revocation.
- Commenting as the operator and adding a bot signature in the text.
- Retrying a timed-out write without provider read-back.
- Re-running a mutation after losing Relay's final response instead of sending
  the original run id to the separate receipt-recovery workflow.
- Claiming a policy prompt prevents credential use by a malicious same-UID process.

## Completion evidence

- GitHub mutation author is the configured App, not the operator.
- Exact mutation state and responsible-agent provenance read back.
- Installation-token cleanup is confirmed or explicitly ambiguous.
- No personal credential was supplied to the agent or actuator request.
- For a retirement: local removal and GitHub-side revocation are both proven.
