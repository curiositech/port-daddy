# Example Output: Honest Drydock Block

## Halt and scope

- Operator halt: active.
- Review mode: static design only; no subject, test, daemon, agent, or provider was launched.
- Proposition: exact source digest `sha256:subject` may execute its submitted Jest
  suite at T2 without host execution, host/canonical access, external network, or
  real provider authority, while an external controller records teardown.
- Requested tier: T3 canary.

## Boundary findings

| Finding | Evidence class | Result |
|---|---|---|
| Rust controller release is signed outside the subject repository; Swift helper accepts one fixed profile | design artifact | Architecture selected; binaries and signatures do not exist |
| VM manifest declares no network or directory-sharing devices | `HOST_OBSERVED` design artifact | Not yet instantiated or adversarially tested |
| Submitted Jest config and transforms are staged as inert bytes and assigned to a second guest | `HOST_OBSERVED` design artifact | Runner image and implementation are not built |
| Guest probe script expects canonical port failure | `GUEST_ASSERTED` planned test | Cannot prove host-route absence |
| Broker computes payload digest and byte count | `BROKER_OBSERVED` design | No implementation receipt |
| Internal ledger reserves 50 cents | design/model only | Proves no financial custody |
| Provider project has a displayed $5 monthly budget | screenshot/claim | No isolated per-run enforcement or measured lag |

## Spend conclusion

The planned internal reservation could bound broker protocol authority after it is
implemented and crash-tested. The provider project is shared, its limit exceeds the
run amount, and enforcement lag is unknown. T3 therefore cannot claim a fifty-cent
financial-loss ceiling. Use fake/replay/local-model T0–T2 only.

The first eventual T3 profile is one request and one attempt, with no tools,
children, retry, automatic refill, or automatic breaker half-open. That profile is
still denied here because the external loss bound is unproved.

## Required gates

| Stable ID | Attack | Expected external observation | Current result |
|---|---|---|---|
| `DRY-TEST-01` | Submitted Jest transform writes host canary | host canary absent; transform executes only in guest | `INCOMPLETE` |
| `DRY-NET-01` | Raw socket ignores proxy | host packet witness records zero undeclared packets | `INCOMPLETE` |
| `DRY-SPEND-01` | Two requests race last reservation | one dispatch maximum; ledger conserves | `MODEL_CHECKED` only |
| `DRY-LIFE-01` | Controller dies during teardown | recovery revokes listener and destroys orphan | `INCOMPLETE` |
| `DRY-EVID-01` | Guest signs false PASS | verifier retains `GUEST_ASSERTED`; final verdict unchanged | `INCOMPLETE` |

## Verdict

- Result: `INCOMPLETE`.
- Exact tier earned: T0 design review only.
- Next permitted action: implement and statically review the external controller
  manifest and guest-runner packaging without launching the subject.
- Explicitly not authorized: Port Daddy restart, repository tests, T1/T2 execution,
  real-provider canary, credentials, network, or spend.

The old five-class `containment_audit.mjs` may still lint a legacy JSON policy, but
even a green result would not change this verdict.
