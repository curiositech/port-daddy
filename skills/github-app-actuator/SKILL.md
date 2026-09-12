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

## Current admission defect

The publisher implementation introduced with the Fleetbot route authenticates
its outer request with an operator `pdu_` account bearer and binds that bearer
hash into the capability. That keeps a personal account credential in the agent
path and does **not** satisfy this skill's boundary. Until the route is replaced
with a non-human workload identity and an upstream operator grant, do not give an
agent the bearer or describe the route as credential-separated. A protected
bootstrap publisher may be used only during an explicitly authorized retirement
ceremony; it is not the steady-state agent interface.

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
- Claiming a policy prompt prevents credential use by a malicious same-UID process.

## Completion evidence

- GitHub mutation author is the configured App, not the operator.
- Exact mutation state and responsible-agent provenance read back.
- Installation-token cleanup is confirmed or explicitly ambiguous.
- No personal credential was supplied to the agent or actuator request.
- For a retirement: local removal and GitHub-side revocation are both proven.
