# Repository status at the replacement anchor

Use this receipt when the task concerns Port Daddy itself. Re-inspect current
source before relying on it; paths are evidence locators, not installed-runtime
claims.

At commit `6c2c30d74b889b4d8037ce5d43b265bfbf21a686`:

## Source present

- closed proposal, adjudication-receipt, and effect-receipt schemas under
  [`schemas/agent-harbor/v0/governance/`](../../../schemas/agent-harbor/v0/governance/);
- the Phase-0 relationship verifier in
  [`action-adjudication.ts`](../../../lib/agent-harbor/governance/action-adjudication.ts);
- negative fixtures and assertions in
  [`action-adjudication.test.js`](../../../tests/unit/action-adjudication.test.js)
  and [`pr-10104-force-merge.json`](../../../tests/fixtures/action-adjudication/pr-10104-force-merge.json);
- a capability and redemption nucleus in `core/pd-broker`; and
- [ADR-0140](../../../docs/adr/0140-provable-action-adjudication-contract.md),
  which explicitly frames Phase 0 as a contract/verifier rather than a runtime
  reference monitor.

These support `CONTRACT_PARSED` and bounded `VERIFIER_TESTED` claims when exact
tests and digests are recorded.

## Not established by those files

- that every consequential effect path is intercepted;
- that proposal, authority, decision, permit, controller, actuator, and witness
  have independent keys/custody/failure domains;
- that decisions occur before every real effect;
- that direct shell, process, socket, credential, plugin, hook, app, provider,
  or human-UI paths cannot bypass mediation;
- that a provider accepted, rejected, or settled an operation; or
- that the installed or running product corresponds to this source commit.

Those are dynamic or external-witness claims. While the operator halt remains in
force they are `BLOCKED_BY_HALT`, not failures to be worked around.
