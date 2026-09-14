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

## Language, Process, Package, And Release Boundary

| Component | Language/runtime | Process identity | Package/release | Network/secrets | Positive authority | Negative authority only |
|---|---|---|---|---|---|---|
| Controller/core | | | | | | |
| Watchdog | | | | | | |
| Provider broker | | | | | | |
| Platform VM helper/VMM | | | | | | |
| Trial Basin | | | | | | |
| Switchboard | | | | | | |
| Observatory | | | | | | |

- Subject repository can build/replace/sign its judge: [yes/no + proof]
- Offline package contains provider adapter or credential loader: [yes/no + proof]
- Cross-process protocol version, frame limit, and rejection fixtures: [evidence]

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
| Canonical checkout/common directory | absent and invalid as source or target | | | |
| Source materialization | exact remote object -> bare vault -> fresh sealed worktree | | | |
| Promotion target | fresh linked review worktree; non-default branch | | | |
| Socket/vsock channels | none | | | |
| Credentials | none | | | |
| CPU/memory/PIDs/I/O/time | finite hard ceilings | | | |
| Output | bounded disposable slot | | | |
| Teardown/recovery | controller-owned | | | |

## Canonical Checkout and Worktree Integrity

- Canonical checkout path identity: [path plus device/inode or platform identity]
- Live remote witness: [normalized remote, refs/heads/main commit, observation receipt]
- Canonical HEAD/index/worktree/untracked proof before: [values]
- Canonical HEAD/index/worktree/untracked proof after: [values]
- Bare source-vault identity: [path identity, remote, object/commit/tree]
- Sealed source worktree: [path identity, detached commit, tree, common directory]
- Guest-local authoring worktree: [guest identity, commit/tree, no production remote]
- Quarantined output: [patch/bundle digest and ceilings]
- Host review worktree: [fresh path identity, non-default branch, base, remote, clean proof]
- Default-branch/canonical-target rejection receipt: [attack and denial]

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
- Dedicated external cell's configured limit: [amount]
- Documented and measured enforcement tolerance: [amount and test evidence]
- Maximum financial exposure = configured limit + tolerance: [amount]
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

### Fail-cheap controls

| Control | Sealed value | External witness | Failure state |
|---|---|---|---|
| Requests / total attempts / concurrency | | | |
| Tools / children / recursive work | | | |
| Automatic retry / refill / half-open | | | |
| Absolute deadline propagation | | | |
| Durable breaker and unresolved exposure | | | |
| Receipt-storage reserve | | | |

For the first T3 canary, the only acceptable values are one request, one attempt,
concurrency one, zero tools, zero children, zero retries, and no automatic refill.

## Durable State And Recovery

| Concern | Authority/store | Crash or corruption behavior | Receipt/evidence |
|---|---|---|---|
| approvals and one-shot grants | | | |
| reservations and settlement | | | |
| lease holder + fencing generation | | | |
| breaker and uncertain calls | | | |
| teardown and orphan recovery | | | |
| segment roots, blobs, retention, compaction | | | |

- SQLite resolved path and single-writer proof: [evidence]
- WAL/FULL transaction and migration probe: [evidence]
- backup/restore, integrity, chain, and conservation proof: [evidence]

## Agent Lifecycle And Spawn-Storm Control

| Identity or authority | Durable ID / binding | Writer or witness | Expiry / generation | Evidence |
|---|---|---|---|---|
| principal + work intent | | | | |
| durable agent node | | | | |
| admitted agent run | | | | |
| body lease | | | | |
| backend-native session | | | | |
| process/VM witness | | | | |
| transcript lineage | | | | |
| capability environment | | | | |

- Every launch ingress enters one admission writer: [yes/no + enumeration]
- Atomic global/project/backend/ancestry/resource/spend reservation: [evidence]
- Agent-birth retry owner and automatic attempt count: [component + integer]
- Child depth/direct child/total descendant ceilings: [values]
- Durable idempotency and equivalent-intent flood handling: [evidence]
- Boot state is admission-closed until reconciliation: [evidence]
- PID witness includes host boot, process start, nonce, executable, sandbox, and controller epoch: [evidence]
- Safety breaker persistence and authenticated reset preconditions: [evidence]
- At most one authoritative body generation: [invariant and race evidence]
- Cross-backend capability diff and credential non-transfer: [evidence]
- 1,000-request duplicate and varied-flood results: [process/reservation/queue counts]

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

## Operator Controls And Evidence Zoom

| Goal | Maximum actions | Command/receipt terminal state | Exact evidence target |
|---|---:|---|---|
| understand whether this run can spend | 0 | | |
| cut egress | 1 | | |
| kill guest | 1 | | |
| inspect warning/activity | 2 | | |
| export receipt | 2 | | |

- Mutation UI is separate from rich read-only evidence UI: [yes/no + proof]
- Honest stale/offline/unknown state: [evidence]
- Reduced-motion meaningful-activity indicator: [evidence]
- Visual manifest covers active/historical/blocked/stale/approval/kill/recovery: [evidence]

## Counterclaims and Residual Risks

- [Strongest case against the claimed tier]
- [Residual] — [owner] — [what would close it]

## Verdict

- Result: [PASS / FAIL / INVALID / INCOMPLETE / UNCERTAIN]
- Exact tier earned: [T0–T6 or none]
- Next permitted action: [one bounded action]
- Explicitly not authorized: [higher tiers/runtime/restart/provider/spend actions]
