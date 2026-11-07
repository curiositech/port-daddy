---
name: resource-scope-grant-attenuation
description: >-
  Adversarially review and test ResourceScope grant delegation without creating a
  second authorization system. Use for hostile multi-hop attenuation, revocation,
  expiry, repository/world binding, read-only federation, or unknown-caveat cases
  against Port Daddy's existing resource-scope kernel. NOT for minting credentials,
  modifying the policy kernel, wiring daemon routes, or replacing the
  authoritative scope/grant store.
license: FSL-1.1-MIT
allowed-tools: Read,Bash(npm:*),Grep,Glob
metadata:
  category: Security
  tags: [resource-scope, capabilities, attenuation, adversarial-testing, federation]
  provenance:
    kind: first-party
    owners: [port-daddy]
  pairs-with:
    - skill: macaroon-capability-credentials
      reason: Supplies the canonical caveat-chain and verification invariants.
    - skill: agentic-zero-trust-security
      reason: Supplies the capability-delegation threat model.
  mirrors:
    repo: skills/resource-scope-grant-attenuation
    codex: .codex/skills/resource-scope-grant-attenuation
    claude: .claude/skills/resource-scope-grant-attenuation
    agents: .agents/skills/resource-scope-grant-attenuation
---

# ResourceScope Grant Attenuation

Attack delegated resource authority through the public policy seams that already
ship in `lib/resource-scope.ts`. This skill is an adversarial test method, not a
minter, parser, store, or second policy engine.

## Canonical seams

Use these functions directly:

- `assessScopeGrantAttenuation(parent, child)` for every parent-to-child hop.
- `authorizeScopedResource(intent, verifiedContext, snapshot)` for the terminal
  request against one authoritative, read-consistent snapshot.
- `resourceScopeCovers(anchor, target)` when testing repository and world
  containment.
- The existing builders in `lib/macaroon/caveats.ts` and envelope shape in
  `lib/harbor-envelope.ts`; do not reproduce their grammars in the skill.

Before writing a case, read the exact branch versions of those modules and
`tests/unit/resource-scope.test.ts`. If a desired guarantee has no public seam,
report that boundary. Do not simulate a passing guarantee with a local helper.

## Build one hostile chain

Use a fixed injected clock and immutable fixtures. A useful minimum chain is:

```text
repository grant (remainingDelegations 3)
  -> bounded worker grant (2)
    -> read-only task grant (1)
```

At each hop, keep the immutable bindings identical: scope, actor, device,
perspective, session, request-body digest, and audience. Then require all of the
following:

- child actions are a subset of the parent actions;
- child expiry is no later than the parent expiry;
- remaining delegation depth strictly decreases;
- each envelope allowlist is a subset and the cost ceiling never increases;
- the parent macaroon caveats remain an exact prefix, with only narrowing
  caveats appended;
- federation stays the same or narrows from `read-only` to `none`; it never
  grows from `none` to `read-only`.

Call `assessScopeGrantAttenuation` on **every adjacent hop**. A root-to-leaf
comparison alone can hide a malicious or malformed intermediate grant.

## Mutation matrix

Start from a chain that passes. Mutate one dimension per case and assert the
exact decision code, not only `allowed: false`.

| Attack | Public seam | Expected result |
| --- | --- | --- |
| Add an action or wildcard | `assessScopeGrantAttenuation` | `ATTENUATION_DENIED` |
| Extend expiry or retain delegation depth | `assessScopeGrantAttenuation` | `ATTENUATION_DENIED` |
| Add filesystem/tool/skill/MCP/backend/channel authority or raise cost | `assessScopeGrantAttenuation` | `ATTENUATION_DENIED` |
| Remove, reorder, or loosen an otherwise valid caveat chain | `assessScopeGrantAttenuation` | `ATTENUATION_DENIED` |
| Append an unknown field or invalid field/operator pair | attenuation or terminal authorization | `ATTENUATION_DENIED` or `GRANT_INVALID` |
| Rebind actor/device/perspective/session/body/audience/scope | `assessScopeGrantAttenuation` | `ATTENUATION_DENIED` |
| Use an exact revoked grant id | `authorizeScopedResource` | `GRANT_REVOKED` |
| Use `nowMs > expiresAtMs` | `authorizeScopedResource` | `GRANT_EXPIRED` |
| Cross immutable repository authority or lineage | `authorizeScopedResource` | `GRANT_SCOPE_MISMATCH` |
| Use a worktree grant for a sibling world | `authorizeScopedResource` | `GRANT_SCOPE_MISMATCH` |
| Federate a local grant | `assessScopeGrantAttenuation` | `ATTENUATION_DENIED` |
| Put a write action in a read-only grant, or request a write it does not carry | `authorizeScopedResource` | `GRANT_INVALID` or `ACTION_DENIED` |

Expiry is inclusive at the exact millisecond: `nowMs === expiresAtMs` may pass;
one millisecond later must fail. The clock comes from
`VerifiedScopeEvaluationContext`, never from request input or wall time.

## Repository and world attacks

Ambient similarity is not authority. Reuse the same display project, account,
harbor, actor, device number, and branch across two fixtures while changing the
immutable repository authority. A repository-world grant may cover an exact
same-lineage descendant worktree/ref/commit. A worktree-world grant may not
cover a sibling worktree, and no anchor may cross account, team, harbor,
project, classification, or repository identity.

For repository-world anchors, display scope and world ids do not split the same
immutable repository authority: the anchor covers another repository-world
record for that exact repository as well as its descendant worktree/ref/commit
worlds. Worktree-world anchors stay exact and cannot cover siblings. Canonical
paths are provenance for local repository records. The daemon-minted repository
UUID plus recorded device/inode tuple is the authority comparison.

## Revocation and federation boundaries

`ScopeKernelSnapshot.revokedGrantIds` names exact grant ids. Test the presented
leaf id as revoked. The current policy record does not carry a parent-grant id,
so do not claim that the kernel independently expands an ancestor revocation to
all descendants. A store or route that promises cascade revocation must provide
and test that lineage expansion before constructing the snapshot.

Federation is read-only authority, never an action channel. A federated request
needs a `read-only` grant and a read action. A local-only parent cannot mint a
federated child. Public-catalog reads remain a separate zero-cost,
non-private-data path and are not evidence that private federation works.

## Unknown and malformed input

Unknown caveat fields and invalid field/operator pairs are invalid structured
input, not text to classify. Keep them in the real caveat array and assert
fail-closed parsing. Also mutate snapshot arrays, duplicate grant or revoked
ids, and malformed scope records where the integration boundary could supply
them. No throw, coercion, lexical fallback, or best-effort allow is acceptable.

Do not overstate the current grammar. A syntactically legal numeric caveat with
a nonnumeric value, such as `spend_usd <= banana`, currently parses and may pass
the attenuation seam; terminal caveat evaluation still denies it with
`MACAROON_CONTEXT_DENIED`. Record this as an unresolved kernel-validation gap,
not as proof that delegation rejected the grant.

## Evidence contract

Return a compact table with: case id, hop, single mutation, invoked public seam,
expected decision code, actual decision code, and pass/fail. Include the exact
test command and total. Separate three claims explicitly:

1. policy behavior proven in source tests;
2. runtime route/store wiring, if any, proven elsewhere;
3. remaining guarantees that the current public record cannot express.

## Validation

For the in-repo contract, run:

```bash
npm test -- --runInBand tests/unit/resource-scope-grant-attenuation-skill.test.ts
npm test -- --runInBand tests/unit/resource-scope.test.ts tests/unit/harbor-envelope.test.js tests/unit/macaroon.test.js tests/unit/macaroon-caveats.test.js
```

The first suite is the reusable hostile-chain proof. The related security
suites ensure the skill did not drift from the kernel, envelope, or caveat
grammar it delegates to.

## Do not use this skill for

- minting or signing credentials;
- implementing or modifying the policy kernel itself;
- constructing `VerifiedScopeEvaluationContext` from request data;
- inventing a route adapter, persistence schema, or revocation lineage;
- claiming the unwired policy kernel already protects a live store;
- keyword or substring classification over unstructured input.

## Skill bundle

- [`agents/openai.yaml`](agents/openai.yaml) supplies the agent-facing name,
  user-facing UI description, and default invocation prompt. Skill frontmatter
  remains the activation contract.
