# Subscription Capacity Ledger

Load this reference when a model route is covered by a recurring subscription,
shared account allowance, product-native credit, or quota window rather than a
stable per-call invoice.

## Never call a subscription route free

Separate three economic modes in every observation:

1. **included subscription:** scarce reset-window allowance, recurring committed
   payment, usually no trustworthy per-call dollar price;
2. **product-native overage or credits:** provider credits with their own balance
   and settlement rules; and
3. **API billing:** metered cash exposure, which may silently replace subscription
   use when an API key takes precedence.

Authentication mode is part of the capacity identity. A model and account label
without auth mode can join unlike economics into one misleading pool.

## Provider truth available in September 2026

- OpenAI Codex app-server publishes structured account rate-limit readings with
  ordinary-usage eligibility, used percentages, reset timestamps, and window
  durations. Historical token usage is not remaining allowance.
- Claude Code may include five-hour and seven-day percentages and reset times in
  documented status-line JSON for subscription accounts. The fields are optional
  and may appear only after provider activity. Missing remains unknown.
- Google ended personal Google AI Pro/Ultra and Code Assist Individual
  authentication in Gemini CLI on 18 June 2026. Code Assist Standard/Enterprise
  publish daily model-request limits and historical monitoring counters, but one
  user prompt may consume multiple model requests. Do not manufacture personal
  Gemini subscription capacity or derive authoritative remaining requests from a
  lagging counter.

Primary sources:

- <https://github.com/openai/codex/blob/7b491281c89023fc3efebcf338ed30d166098cc8/codex-rs/app-server-protocol/src/protocol/v2/account.rs#L291-L323>
- <https://github.com/openai/codex/blob/7b491281c89023fc3efebcf338ed30d166098cc8/codex-rs/app-server-protocol/schema/json/v2/GetAccountRateLimitsResponse.json>
- <https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan>
- <https://code.claude.com/docs/en/statusline#rate-limit-usage>
- <https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan>
- <https://developers.google.com/gemini-code-assist/docs/deprecations/code-assist-individuals>
- <https://docs.cloud.google.com/gemini/docs/quotas>
- <https://docs.cloud.google.com/gemini/docs/codeassist/monitor-gemini-code-assist>

The Codex source and schema were pinned and read on 2026-09-11. The captured
schema SHA-256 is
`76bc91758269a89f57cd16c618b91c1fba76aca3e9d2b6186205e6f107d6b28c`;
parser promotion must bind that revision and a fixture digest.

## Native-unit record

```text
capacityBucketId, accountId, provider, authMode, productScope
modelRouteAliases[], windowId, unit, limit, remaining, resetsAt
observedAt, source, parser/profile version
quality = authoritative | observed | estimated | stale | unknown
confidence, discrepancy, raw-evidence digest
outstandingReservations, unresolvedAttemptHolds, driftMargin
```

`null` is not zero or infinity. Never normalize unlike provider percentages,
requests, or opaque weighted usage into one pretend currency.
`capacityBucketId` identifies the actual shared workspace/seat/product/limit
window. Model names and aliases do not create independent allowance pools.
Every alias for one real provider window resolves to the same bucket row and
revision. Two aliases may not each subtract an identical reservation, and two
different bucket IDs may not claim the same alias. The immutable observation's
`outstandingReservations` value is the amount before its candidate reservation;
the compare-and-swap commit adds the candidate once to the durable bucket.

## Observation quality

| Grade | Evidence | Automated use |
|---|---|---|
| A | documented structured provider/host response | reserve within freshness and parser contract |
| B | documented first-party client field | observe; automate only with versioned fixture |
| C | before/after delta around a bounded run | train forecast, never overwrite fresher A/B |
| D | provider refusal or exhausted response | deny new use until re-observed |
| E | operator-entered snapshot | display and plan, no silent authority |
| F | missing, stale, malformed, contradictory, unsupported | UNKNOWN; fake/replay/local only; real-provider use blocked |

Never screen-scrape a private account page as an enforcement boundary. Store
bounded usage metadata, not a subscription bearer.

## Forecast and admission

For each native window:

```text
allocatable = observed_remaining
              - operator_reserve
              - outstanding_reservations
              - unresolved_attempt_holds
              - drift_margin
risk = (action_burn_p95 + checkpoint_tail_reserve)
       / max(allocatable, epsilon)
admissible = reading_fresh && risk <= 1
```

Reserve all required buckets in one serializable compare-and-swap transaction
across every route alias. An unresolved attempt retains its worst-case hold.
Reserve checkpoint/stop capacity separately and reject an atomic action unless
its p95 burn plus that tail fits. These calculations return evidence and
eligibility; they do not admit a body, authorize a model call, transfer
identity, clear a halt, or issue a rebodiment verdict.

The machine contract is `../schemas/capacity-evidence.schema.json`; verify its
cross-field arithmetic with `../scripts/validate-capacity-evidence.mjs`. A
schema-valid record with inconsistent math is invalid. The fake ready and
unknown fixtures under `../examples/` are the conformance baseline. Preserve
the explicit `executionClass`: fake/replay evidence may never satisfy a
real-provider proposal, even when all synthetic arithmetic is internally green.

Forecast by provider, model, effort, task class, context size, tool pack, and
execution mode. Keep p50/p90/p95 and calibration error. Never tell the operator
“N tasks remain”; report the observed window and a probabilistic episode burden.

## Preemption states

- `ROOMY`: continue under reservation.
- `TIGHTENING`: no new children; smaller phase pack; checkpoint sooner.
- `CHECKPOINT_NOW`: finish only an already-admitted bounded atomic action using
  the separately reserved tail, freeze effects, and seal the capsule.
- `SWITCH_ELIGIBLE`: capacity evidence says a named route fits; a separate
  lifecycle authority still decides whether a switch may occur.
- `WAIT_FOR_RESET`: hibernate with no process.
- `EXHAUSTED`: deny model calls; evidence-only local work may continue.
- `UNKNOWN`: fake/replay/local only; real-provider use remains blocked until a
  supported fresh observation is available.

Settle observed allowance delta and uncertainty reserve after every attempt,
including failures and missing responses. A transport error does not prove the
provider charged nothing.
