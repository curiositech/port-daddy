# Fleet tenant onboarding foundation

Status: immediate fail-closed admission contract; deployment not performed.

## Authority

Each GitHub App installation is bound to exactly one Port Daddy tenant. GitHub
credentials, served-roster admission, entitlements, reservations, and spending
are installation-scoped, so allowing an installation to straddle tenants would
also let one tenant consume another tenant's authority or credit. Repository
bindings are children of that installation binding and retain immutable numeric
GitHub identity; the mutable repository name is refreshed only after exact
GitHub authorization and is checked again by the executor before credentials.

Fleet tenancy is keyed by a Port Daddy account plus GitHub's immutable numeric
installation, repository, and owner-account identifiers. Repository names are
display metadata and never establish authority. Membership is an explicit link
between a signed-in Port Daddy user and a tenant account.

The resolver distinguishes permanent refusals from retryable infrastructure
failures. When production admission adopts this contract, lookup failure must
return a retryable 5xx response; it must not acknowledge and lose the delivery.

## Bespoke onboarding

`fleet_repository_onboarding` stores user-authored desired outcomes for each
authorized user/repository pair. Composite foreign keys require both the
server-owned repository binding and the user's tenant membership. It separately records:

- the customer's budget;
- the maximum provider cost allowed within that budget;
- the platform margin floor, never below 75 percent;
- proposal status; and
- execution status.

`fleet_configuration_proposals` stores reviewable proposed configurations. A
repository may have only one accepted proposal at a time. Accepting a proposal
does not start a Fleet.

Every onboarding row starts with execution status `blocked_pending_executor`.
The signed-in Shipwright onboarding route creates the server-owned tenant,
membership, immutable GitHub repository binding, and a proposed configuration.
The proposal is inert: onboarding neither creates billing entitlement nor adds
an installation to the served roster, and it never launches work.

## Immediate fail-closed contract

`FleetRunJobV2` is the only admitted queue envelope. The Relay resolves its
tenant from HMAC-verified numeric GitHub installation, repository, and owner
identities. D1 lookup failure returns retryable 503 before persistence; invalid
or unbound identities are acknowledged as permanent non-work. There is no
repository-name or legacy-envelope fallback.

Before credentials, GitHub reads, or model calls, the executor re-resolves the
same tuple and requires both the onboarding and one proposal to be explicitly
accepted. Managed billing then independently requires an active entitlement,
a served-installation row, a reservable retail balance, and per-call provider
authorization within the 25-percent cost ceiling.

## Release order

1. Apply all additive Relay D1 migrations and run the migration-chain check.
2. Create and read back the intended onboarding binding through the signed-in
   Relay UI. Do not hand-seed guessed GitHub numeric identifiers.
3. Configure and read back an accepted proposal, managed entitlement, and
   served-installation row through an approved control-plane release.
4. Deploy Relay and executor from the same reviewed main commit only after the
   stop-loss readiness check passes against the exact production D1 inventory.
5. Verify an unbound delivery starts no work, a D1 outage returns retryable 503,
   and the onboarded repository still starts no spend until every activation
   prerequisite is present.

Merging code does not apply migrations, accept a configuration, serve an
installation, grant credit, or deploy either Worker.
