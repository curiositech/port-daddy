# Fleet tenant onboarding foundation

Status: schema foundation; production activation is intentionally blocked.

## Authority

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

Every foundation row has execution status
`blocked_pending_executor`. The database rejects any other value. This release
adds no onboarding route, model call, queue producer, scheduled trigger, or
automatic activation.

## Staged activation contract

Current webhook behavior remains unchanged in this release. `FleetRunJobV2`
and its pure builder exist only to pin the future queue envelope. A later,
coordinated release may activate it only after all of the following land and
are tested together:

1. the signed-in onboarding flow writes the server-owned identity tuple;
2. Relay returns retryable 5xx responses for tenant-store failures;
3. the executor rejects absent, malformed, inactive, or mismatched tenant
   tuples before acquiring credentials or authorizing spend;
4. accepted proposals still require a separate explicit activation decision;
5. stop-loss and margin authorization are enforced at every model-call
   boundary.

Until then, `FLEET_RUN_JOB_V2_ACTIVATION` is
`blocked-pending-executor-validation` and no existing webhook is changed to
emit the v2 envelope.
