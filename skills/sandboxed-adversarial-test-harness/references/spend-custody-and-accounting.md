# Spend Custody And Accounting

Use this when a Drydock design mentions budgets, reservations, prepaid credits,
hard caps, provider limits, settlement, retries, refunds, or financial safety.

## Two claims that must never be collapsed

### Protocol-authority ceiling

The external broker admits only requests whose conservative maximum fits its
durable reservation. This bounds what the broker is authorized to dispatch.

### Financial-loss ceiling

The provider or payment rail independently refuses further charges after an
isolated balance or hard quota is exhausted. This bounds what can actually be
billed, subject to a separately measured enforcement lag or overshoot tolerance.

An internal ledger proves the first claim. It does not prove the second. API
credentials, OIDC, output-token limits, rate limits, usage dashboards, alerts, and
post-hoc reconciliation do not become financial custody by being combined.

OpenAI's current documentation is a useful warning: configured organization and
project spend limits are described as hard limits, but changes and enforcement are
not instantaneous and recorded spend can slightly exceed them. A Drydock provider
profile must therefore measure a conservative tolerance rather than promising an
exact zero-overshoot cutoff.

Primary source: [OpenAI: Troubleshooting API usage and spend limits](https://help.openai.com/en/articles/6614457).

## Broker admission authority

The broker, not the guest, computes:

```text
reserve(request) = fixed_fee
                 + broker_input_token_upper_bound * input_price
                 + broker_cached_token_upper_bound * cached_input_price
                 + policy_output_token_ceiling * output_price
                 + policy_tool_call_ceiling * maximum_tool_fee
                 + bounded_safety_margin
```

Required inputs:

- payload bytes or immutable payload reference resolved by the broker;
- broker-computed digest, byte count, attachment inventory, and token upper bound;
- sealed provider/model/price profile;
- host-policy output, tool, request, retry, and concurrency ceilings; and
- every fixed, image, audio, cache, search, tool, or platform fee the provider may
  charge for the admitted operation.

Guest-declared size or token fields are consistency hints. A guest may ask for a
lower output cap; it cannot understate a billable input or enlarge host policy.
Unknown media, unsupported tools, floating model identifiers, stale prices, or an
unresolved payload reference deny real dispatch.

## Ledger state and conservation

Use non-negative integer minor units. Never use binary floating point for money.

```text
gross_deposits + authorized_credits
  = available
  + outstanding_reservations
  + settled_provider_spend
  + external_withdrawals
  + adjudication_holds
```

`authorized_credits` includes externally verified provider reversals or explicitly
authorized adjustments. A reservation release is not a refund and is not a
cumulative equation term; it transfers value from `outstanding_reservations` back
to `available`.

### Canonical transitions

| Transition | Debit | Credit | Constraint |
|---|---|---|---|
| Deposit `D` | — | `gross_deposits += D`, `available += D` | external receipt unique |
| Reserve `R` | `available -= R` | `outstanding += R` | commit before provider connection |
| Release `R` | `outstanding -= R` | `available += R` | reservation not dispatched or remainder known |
| Settle `S` from `R` | `outstanding -= R` | `settled += S`, `available += R-S` | `0 <= S <= R`; otherwise uncertainty/adjudication |
| Credit `C` | — | `authorized_credits += C`, `available += C` | externally evidenced and idempotent |
| Withdraw `W` | `available -= W` | `external_withdrawals += W` | explicit authority |
| Hold `H` | `available -= H` | `adjudication_holds += H` | disputed value remains conserved |

Example: deposit 10; reserve 5 gives `available=5`, `outstanding=5`. Release gives
`available=10`, `outstanding=0`. Settle 2 from a reservation of 5 gives
`available=8`, `outstanding=0`, `settled=2`. Each state conserves 10.

## Crash, retry, and concurrency rules

- Reservation, dispatch intent, and idempotency key commit atomically before any
  provider byte is sent.
- One idempotency key identifies one logical provider operation and one terminal
  settlement. Duplicates return the existing state; they do not redispatch.
- Concurrent admission uses serializable transactions or an equivalent linearizable
  compare-and-swap over the same budget cell.
- Cancellation revokes new dispatch authority, terminates the broker connection,
  then conservatively settles or holds uncertain exposure.
- Missing usage never creates available balance. Use the reservation as the
  conservative terminal charge or move the uncertain amount into adjudication.
- Reconciliation may lower settled spend only after external provider evidence is
  bound to the exact request/account/time window.
- A controller restart reconstructs reservations and dispatch state from durable
  records before accepting new work.

Model these transitions under duplicate messages, crash between every pair of
writes, delayed provider responses, cancellation races, and two concurrent actors.

## Provider-custody qualification

A T3 real-provider lane is eligible only when all are true:

1. The account, project, key, or payment rail is dedicated to one run or one
   non-overlapping budget cell.
2. No other workload can consume the same quota or prepaid balance.
3. The guest never receives the vendor credential.
4. The broker credential cannot raise or bypass the configured limit.
5. The provider enforces the limit independently of the controller's health.
6. Existing unsettled usage is zero or included in the approved exposure.
7. Limit propagation and overshoot are measured under concurrency and delayed usage.
8. The approved financial-loss bound includes the worst observed/documented
   enforcement tolerance.
9. Provider usage and billing records can be reconciled to broker request IDs.
10. Revocation, account isolation, and post-run disablement leave receipts.

If any item is unknown, mark `financialCustody: unproven` and deny the real lane.

## What a receipt must say

- protocol ceiling, reservation formula, price/profile digest, and safety margin;
- broker-observed payload and billable-dimension bounds;
- provider account/project identity without exposing credentials;
- provider-side configured balance/quota and evidence timestamp;
- measured enforcement tolerance and test conditions;
- existing unsettled exposure at admission;
- reservation, dispatch, cancellation, settlement, credit, and hold transitions;
- provider-reported usage/invoice evidence and discrepancies; and
- whether the result proves protocol authority only or financial loss as well.

Use `cost-verification-auditor` for post-run price and usage reconciliation. It
cannot retroactively create pre-run custody.
