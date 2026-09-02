# Anchor repair: remaining integration dependencies

Status: integration contract, not an installed recovery or publication feature.
This clarifies existing work under `agent-delivery-merge-lifecycle-and-recovery`;
it does not create another identity registry, action database, or entitlement.

## Evidence and dependency order

The library checkpoint `62f659a3d50fdaddb022203babdb6eee4c6d8a77` extends
[the existing ownership coordinator](../../lib/durable-ownership.ts) on the
published [PR #9993](https://github.com/curiositech/port-daddy/pull/9993) head
`bbeb4f8109ef8c9e191f3790b85d8a8d4b3a5583`. Its transaction tests do not prove
new-body admission, a mounted repair route, or operator-facing recovery.

```text
existing ownership/claim-forest core
  -> canonical continuation admission + matching ownership validator
  -> authenticated repair route/client + isolated compiled integration proof
  -> separately authorized release
  -> explicit signed repair, exact claim read-back, historical ownership retained
```

The old 61-claim session and other held sessions remain untouched until the last
step is independently authorized. A fresh source worktree can author and test
these dependencies without inheriting old claims or pretending it is admitted
to their AgentNode. Source authoring is not publication or repair authority.

## Canonical admission must be attainable without replacing the AgentNode

[AgentRun admission](../../lib/agent-run-admission.ts) currently admits a
verified session promotion; the ownership validator requires that session to
match `profile.origin.sourceSessionId/sourceAgentId`. The repair fixture uses
an already-promoted destination body. A newly spawned continuation cannot pass
that condition merely by naming the same roster id.

The [managed spawner](../../lib/spawner.ts) also starts each spawned body through
an uncredentialed begin that mints a new actor. Same-node admission alone therefore
does not satisfy the repair core's same-actor condition for a fresh managed
successor. Explicit actor delegation or the operator-authorized ownership route
is a separate prerequisite for the stranded 61-claim session.

Extend this existing admission service and its [AgentRun contract](../../schemas/agent-harbor/v0/agent-run.schema.json):

- Authenticate the new body through the existing actor-credential/session path.
  A new logical agent may use verified promotion; a continuation must not mint a
  replacement AgentNode just to publish or erase the original profile origin.
- Resolve the existing node from an authorized continuation/ownership decision,
  not a caller-selected alias. Bind the consenting actor, successor actor/body,
  predecessor run/session, current owner/epoch when applicable, harbor/repository,
  physical worktree, exact Git state, validity and replay key in durable evidence.
- Append a successor AgentRun and admission receipt to the existing Agent Harbor
  ledger. Preserve the immutable origin and prior runs. Materialize only the
  exact successor session after revalidation; keep claims untouched until the
  ownership writer consumes explicit transfer/release consent.
- Validate promotion and authorized continuation as distinct, strict evidence
  cases through one shared validator. Test a real promotion followed by a fresh
  continuation, not manually manufactured admission rows alone.
- Do not silently relax the repair core's **same-node, same-verified-actor** rule.
  A different successor actor needs explicit owner delegation or recent operator
  authorization through the existing ownership/admission controls. Neither a
  new credential nor a recording grants that authority; copying predecessor
  credentials or rewriting `profile.origin` is never the solution.

Thin transport wiring must enforce authenticated actor/harbor scope, strict
bounded inputs, nonce/idempotency handling, expiry and non-secret receipts. It
must call the existing coordinator, not perform separate session/claim writes.
Hostile tests must cover wrong actor/node/repository, changed physical identity,
retirement, stale/revoked consent, competing successors, lost responses, silent
database write failures, and complete rollback of admission and transfer stages.

## Publication is an independent missing integration

Read-only observation on 2026-09-02: stable daemon 3.30.6, source revision
`66e8d3d36d`, returned HTTP 200 from
`GET /agent-harbor/surface-gateway/capabilities`. That response advertises the
universal envelope and its authority checks; it does not prove a GitHub publish
operation. The inspected gateway executes WorkIntent list/get/capture/start.

The unpublished runtime checkpoint `53a2351c6d44f42d8b1d685e97c223428cb730df`
requires an injected `GitHubAppAuthority`, but provides no production injection
or branch-publication actuator. Installing it or setting an App token is not
enough. Existing App token-mint/macaroons are reusable primitives, not a publisher.
Relay's operator-gated `/v1/fleet/save` creates per-file API commits; it is not an
exact-head, per-agent ownership/claim-adjudicated publication route.

Wire publication through Agent Harbor's existing intent/decision/receipt ledger
and server-controlled App credentials. Revalidate canonical AgentNode/AgentRun,
verified actor/session, authorized roadmap relation, active diff-covering claims,
physical linked worktree, repository/installation, exact base/head/tree, lease,
idempotency and evidence before any mutation. Tracked task ownership, claim
ownership and responsible author must name the same canonical node; an epic's
owner is not an implicit assignment of every worker's subtask. Publish non-force,
then read back provider refs, PR and App identity before recording success.

Keep the existing `Roadmap-Item: none — <reason>` exemption in
[roadmap-link-core](../../lib/roadmap-link-core.ts) for legitimate docs/chore/hotfix
work. Publication must record the accepted exemption and its authorization verdict
instead of demanding a fictitious roadmap item or ownership epoch. It still
requires canonical agent admission, verified actor/session, exact claims/repo/head
and an allowed action. A reason string alone does not authorize a write, and this
tracked feature does not use that exemption. Represent tracked versus exempt
roadmap evidence explicitly in the existing intent/receipt contract.

An existing operator-authorized Fleetbot bootstrap may publish a reviewed slice
within its approved repository, branch and PR-action scope. It must preserve
exact source/base/head and provider/App read-back, and disclose that the normal
governed publisher was not used. That approval does not establish canonical
AgentNode admission or authorize credential disclosure, merge, deployment,
admission, or live claim repair.

Scoped publication authority supports reviewed documentation corrections, ordinary
review fixes and rebases, with renewed head/tree, owner/claim/lease and policy
validation for each resulting action. An agent-authored plan must not invent an
additional per-commit human-approval gate. Material scope or authority changes
still require the appropriate consent; the bootstrap is not generic permission
for agents to bypass governed publishing.

Grand Harbor's hot interaction and Porthole/Logbook evidence remain projections
and citations of these durable facts, never substitute authorization. Recovery
briefings expose digested plans, decisions, questions, receipts and known gaps;
they never imply access to hidden reasoning.
