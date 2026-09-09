# Drydock Review: [Subject]

## Halt and Scope

- Operator/runtime halt: [active/inactive; source]
- Review mode: [static design only / approved laboratory execution]
- Exact proposition: [falsifiable bounded claim]
- Requested capability tier: [T0–T6]
- Verdict applies to: [exact subject, controller, scenario, policy, and tier]

## Immutable Inputs

| Input | URI or origin | Digest/version | Sealed by | Executed where |
|---|---|---|---|---|
| Controller | | | | host/control plane |
| Guest image/kernel | | | | guest boot |
| Source tree/archive | | | | guest only |
| Test runner/config/tests | | | | guest/test-runner guest only |
| Scenario/fixtures/seed policy | | | | guest/controller as declared |
| Capability/effect/resource policy | | | | controller/broker |
| Provider/model/price profile | | | | broker |

## Trusted Computing Base

| Component | Trusted for | Outside subject control? | Evidence | Residual |
|---|---|---:|---|---|
| Controller | | | | |
| Hypervisor/VMM and host kernel | | | | |
| Effect broker | | | | |
| Ledger and provider custody | | | | |
| Receipt signer/store | | | | |
| Operator approval surface | | | | |

Explicitly untrusted: [subject, dependencies, tests, guest, agent, output, inputs].

## Isolation Topology

| Dimension | Absent-by-default state | Added mechanism | External witness | Residual |
|---|---|---|---|---|
| Network devices/routes | none | | | |
| Directory/host mounts | none | | | |
| Socket/vsock channels | none | | | |
| Credentials | none | | | |
| CPU/memory/PIDs/I/O/time | finite hard ceilings | | | |
| Output | bounded disposable slot | | | |
| Teardown/recovery | controller-owned | | | |

## Typed Effects and Capabilities

| Operation | Destination | Request/response ceilings | Concurrency/deadline | Idempotency/cancel | Receipt witness |
|---|---|---|---|---|---|
| | | | | | |

## Spend Proof

### Protocol-authority ceiling

- Broker-observed payload and attachments: [evidence]
- Host-policy output/tool ceilings: [evidence]
- Price profile/freshness: [evidence]
- Conservative reservation: [integer minor units and formula]
- Durable pre-dispatch transition: [receipt]

### Financial-loss ceiling

- Isolated provider account/project/key/payment rail: [evidence or ABSENT]
- Provider-enforced balance/quota: [amount]
- Measured enforcement tolerance: [amount and test evidence]
- Existing/unsettled exposure in that custody domain: [amount]
- Eligible for T3: [yes/no; no when any proof is absent]

### Conservation

```text
gross_deposits + authorized_credits
  = available + outstanding_reservations + settled_provider_spend
  + external_withdrawals + adjudication_holds
```

List every transition vector, crash point, duplicate, retry, hold, credit, and
reconciliation outcome.

## Trial Basin Scenario

- Scenario digest:
- Seed / virtual epoch:
- Schedule policy / preemption bound:
- Fault budget and exact fault set:
- Safety invariants:
- Liveness properties and fairness assumptions:
- Replay command or portable procedure:
- Counterexample minimization rule:

## Adversarial Gates

| Stable ID | Attack/failure | Required witness class | Expected observation | Actual evidence | Result |
|---|---|---|---|---|---|
| | | | | | |

## Evidence Inventory

| Evidence class | Artifact/receipt | Digest | What it establishes | What it cannot establish |
|---|---|---|---|---|
| `HOST_OBSERVED` | | | | |
| `BROKER_OBSERVED` | | | | |
| `PROVIDER_RECONCILED` | | | | |
| `GUEST_ASSERTED` | | | | |
| `MODEL_CHECKED` | | | | |
| `REPLAYED` | | | | |
| `HUMAN_APPROVED` | | | | |

## Counterclaims and Residual Risks

- [Strongest case against the claimed tier]
- [Residual] — [owner] — [what would close it]

## Verdict

- Result: [PASS / FAIL / INVALID / INCOMPLETE / UNCERTAIN]
- Exact tier earned: [T0–T6 or none]
- Next permitted action: [one bounded action]
- Explicitly not authorized: [higher tiers/runtime/restart/provider/spend actions]
