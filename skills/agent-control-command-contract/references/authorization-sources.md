# Command authorization: resolve current bindings at admission

Use this reference to declare which attributes and checks a command path must resolve before dispatch. A label such as `lease-store`, `event-store`, or `policy-service` is a description of the declared source; it does not prove the source is fresh, authoritative, or actually used at runtime.

## Source method and limits

NIST SP 800-162 defines ABAC authorization around attributes of the subject, protected object/resource, requested operation, and sometimes the environment, evaluated against policy. It describes a policy decision point (PDP) that computes a decision and a policy enforcement point (PEP) that enforces it. Its caching section frames attribute caching as a tradeoff between performance and freshness/security; it does not categorically prohibit caches or declare a specific lease/event store trustworthy. See [Evidence scope](evidence-scope.md) for the version and sections reviewed.

The Harbor binder adds a local design requirement: a command boundary should bind the principal, body/resource, scope, current policy, expiry, and monotone fencing epoch. Binder ch15 C3 describes lease-envelope fields and rejection tests. These control-envelope details are first-party design proposals; NIST does not validate Port Daddy’s command implementation.

## Admission worksheet

For each profile, fill the declaration fields and connect each field to a runtime owner/test:

| Binding | Ask | Example field name (constructed) |
| --- | --- | --- |
| Principal | Which authenticated operator/device is asking? | `principal_id` |
| Target | Which Agent Node, body, run, or guarded resource is addressed? | `target_run_id` |
| Scope | Which verb and resource scope does the grant authorize? | `verb_scope` |
| Policy revision | Which current rule set rendered the decision? | `policy_revision` |
| Expiry | When does the command authority stop being valid? | `expires_at` |
| Fencing epoch | Which authority generation prevents stale/replayed owners acting? | `authority_epoch` |

At admission, resolve the bindings from a source whose trust and freshness are documented; compare them with the request; verify current policy, expiry, scope, and fencing epoch; then enforce that decision at the guarded effect boundary. If any input is absent, inconsistent, stale, or unavailable, deny or return an explicit unknown/unavailable result without dispatch. The semantic audit requires a declaration for these checks; it cannot inspect the real read path.

Example, deliberately synthetic: operator `subject-17` requests `interrupt` on `run-42`; the policy grants only `interrupt` on that run until a listed expiry; the command carries epoch `12`. If the current authority read returns a different principal, target, scope, policy revision, expired grant, or epoch `11`, admission must deny. A static `checks.*: true` value merely states the design assertion; the adapter test must prove it.

## Read model and authorization are different jobs

The Session List in the operator-control packet is a user-facing read model that groups live, waiting, blocked, stale, historical, and completed runs. It can select a target and display its last known state. A button click still needs a new server-side admission decision; the row itself is not a capability.

| Source declaration | What it may describe | What must still be tested |
| --- | --- | --- |
| `lease-store` | A lease or authority record that can be resolved at command admission. | Does the handler read the current generation, check expiry and revocation, bind subject/target/scope, and reject a stale fencing epoch? |
| `event-store` | A durable event source from which some authorization facts can be derived. | Is it complete and current enough for this decision? Does the PEP re-evaluate current policy and ownership instead of trusting the last event label? |
| `policy-service` | A policy decision or policy evaluation path. | Which identity, target, operation, environment, policy version and enforcement point participate? How do stale input and service failure behave? |
| `cached-projection` | A roster, session-list row, or dashboard projection for display. | It may inform the operator; it must not be accepted as command authority by this profile. |
| `ui-state` | Client-local state from an earlier read. | Never sufficient to authorize a command after time, reconnect, or another writer. |

NIST allows organizations to assess caching according to freshness and security impact. This profile chooses a narrower rule for consequential control: a display cache does not authorize the effect. A different profile may document a cache policy, but the name `authoritative` alone is not its justification.

## Separate denial, unsupported capability, and uncertain observation

- **Policy denial:** the principal or requested operation is not admitted; do not dispatch.
- **Unsupported:** the named backend declares it cannot perform the verb. It is not an authorization answer.
- **Unavailable authority:** current bindings cannot be checked. Do not dispatch; report unavailable/unknown rather than silently accepting stale data.
- **Effect unknown:** command delivery may have happened but no trusted observer can resolve its effect. Do not relabel it as denied, unsupported, or “nothing happened.”

## Negative and positive tests

For a constructed adapter fixture, test both sides for each binding:

1. Matching principal/target/scope, current policy, unexpired grant, and current epoch reaches the policy-approved adapter branch. Then independently check effect or unknown; do not treat the audit's declared `supported` cell as proof.
2. Change exactly one field—principal, target, scope, policy revision, expiry, or epoch—and verify the admission boundary denies before adapter dispatch.
3. Freeze the Session List/projection while changing the target authority; a click must be re-resolved and rejected.
4. Make the authority source unavailable; verify no command is dispatched and the UI reports the unavailable state.
5. Change authority after admission but before the effect. Verify the adapter/resource rechecks the fencing/authority token or otherwise rejects stale work. The contract auditor cannot prove atomicity of this race.

These are test shapes. Do not write their results as observed unless you ran a real isolated fixture against the implementation and retained its trace.
