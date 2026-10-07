# Claim ladder and threat model

## Why a ladder

“Policy passed” can mean six materially different things. The ladder prevents a
proof about one layer from laundering the next.

1. **Contract:** bytes have a known shape.
2. **Verifier:** declared relationships and mutations produce expected results.
3. **Authority:** current identity, scope, audience, epoch, expiry, and
   revocation are bound.
4. **Pre-effect:** one permit is redeemed before one exact channel opens.
5. **Inventory:** every in-scope effect route has an owner, boundary, witness,
   and bypass case.
6. **Witnessed mediation:** an independent observer saw all declared bypasses
   fail for one exact build and environment.

Each rung has a different falsifier. A valid schema does not falsify a bypass; a
passing bypass test does not prove a provider outcome; a provider receipt does
not prove the operator understood the action.

## Adversary

Assume the requester, agent output, guest process, tool arguments, environment,
plugins, and any self-reported confidence may be malicious. Also test:

- stale but valid credentials or generations;
- replayed decisions and duplicated delivery;
- changed policy or state after evaluation;
- confused-deputy scope and audience mismatches;
- controller crash before or after durable intent;
- lost provider acknowledgement;
- compromised adjudicator, controller, or witness in isolation;
- common-control “independent” roles; and
- alternate effect paths outside the declared tool adapter.

## Witness classes

- `SOURCE_INSPECTOR`: knows source bytes and static structure.
- `VERIFIER_RUNNER`: knows observed validator/test behavior for exact inputs.
- `HOST_OBSERVER`: may know process, VM, filesystem, socket, and mediation facts
  outside the subject.
- `PROVIDER_RECONCILER`: may know externally settled provider/target state.

A witness is admissible only for facts it could observe and only when its key,
custody, and failure domain are independent of the claimant for that fact.

## Minimum mediation inventory

For each effect class record:

```text
effectClass, exact target domain, route, boundary owner, credential owner,
permit fields, intent record, witness, bypass cases, coverage, unknowns
```

Do not write “network mediated” when only one HTTP client is wrapped. Enumerate
raw sockets, child processes, inherited descriptors, package hooks, credential
files, provider-native sessions, browser/app paths, and human handoffs.

## Terminal semantics

- `DENY` and `INDETERMINATE`: channel stays closed.
- `ALLOW / UNREDEEMED`: no effect authority yet.
- `ALLOW / REDEEMED / NOT_EXECUTED`: authority consumed; no observed transmit.
- `ALLOW / REDEEMED / AMBIGUOUS`: possibly transmitted; do not retry or release.
- `ALLOW / REDEEMED / EXECUTED / SETTLED`: external witness closed the outcome.

Compensation never changes the historical result. It is a later action with its
own proposal, authority, permit, effect, and settlement.
