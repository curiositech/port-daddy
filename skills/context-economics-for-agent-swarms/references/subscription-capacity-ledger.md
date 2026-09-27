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

## Dated provider evidence pointers — checked 2026-09-24

Provider products, plan terms, schemas, and quotas change. Treat these as dated source
observations to recheck for the exact client version, account, product, region, and
authentication mode. Do not copy them into a universal quota table or infer an individual
account's current capacity from documentation alone.

- **OpenAI Codex:** the public `openai/codex` app-server protocol defines structured
  account rate-limit snapshots, including optional ordinary-usage eligibility, reset
  windows, credits, and a multi-bucket view keyed by limit ID. See the
  [rate-limit response schema](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/json/v2/GetAccountRateLimitsResponse.json)
  and [account protocol types](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2/account.rs).
  These are client protocol fields; they are not a guarantee that every version, plan,
  or account returns every field. The official [Codex plan guide](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan)
  says applicable products can use shared allowances/credits and that consumption varies
  with model, task, context, reasoning, speed, and tools. Use the account's displayed
  usage source and exact active client version.
- **Claude Code:** its [status-line documentation](https://code.claude.com/docs/en/statusline#rate-limit-usage)
  documents optional five-hour and seven-day rate-limit fields for eligible Claude.ai
  subscription/gateway cases, after a first API response; each window may be absent.
  This is local client telemetry, not a provider-neutral quota endpoint. The docs say
  missing fields should be handled as absent, not filled with a guessed zero.
- **Gemini Code Assist:** Google's [consumer-account deprecation notice](https://developers.google.com/gemini-code-assist/docs/deprecations/code-assist-individuals),
  last updated 2026-09-02, states Gemini Code Assist for individuals/Google AI Pro/Ultra
  IDE and Gemini CLI access stopped on 2026-06-18; it says Standard/Enterprise access
  remains unchanged. The [quota guide](https://docs.cloud.google.com/gemini/docs/quotas)
  says Gemini Code Assist agent mode and Gemini CLI share request quotas, and one prompt
  may cause multiple model requests. These dated plan statements are not capacity evidence
  for an account and must be rechecked before use.
- **API pricing and prompt caching:** OpenAI's [pricing page](https://developers.openai.com/api/docs/pricing)
  separates model, input type, context tier, and service tier. Its [prompt-caching guide](https://developers.openai.com/api/docs/guides/prompt-caching)
  describes eligible-prefix reuse and model-specific cache conditions. Cached input may
  have a different price, but it still occupies the request context. Re-fetch the rate
  table and calculate the exact model/route/request mix; a cache hit is not guaranteed.

The original bundle retained only the following historical schema SHA-256 for the
2026-09-11 source snapshot; it did not retain an exact source revision. The hash is
reproducibility metadata for that snapshot, not a claim about the current `main` schema.
Any parser profile must bind an exact source revision when available, its parser
implementation, and a fixture used for that profile. Updating a
source pointer does not validate the parser or observe an account.

Historical schema snapshot SHA-256:
`76bc91758269a89f57cd16c618b91c1fba76aca3e9d2b6186205e6f107d6b28c`.

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
Within one declaration, the canonical bucket-window key is the operator scope plus
`capacityBucketId` plus `windowId`. Model names and aliases do not create independent
allowance pools. A route may legitimately draw two separately required provider windows
(for example a five-hour and weekly window), so one alias may recur across **distinct**
`windowId` values. It may not be split across two bucket IDs for the **same** `windowId`.
Two aliases may not each subtract an identical reservation from one bucket. The
immutable observation's
`outstandingReservations` value is the amount before its candidate reservation;
the compare-and-swap commit adds the candidate once to the durable bucket.
The forecast's selected route must be one of that bucket's own aliases. A
committed reservation is admissible only while
`issuedAt <= evaluatedAt < expiresAt`; equality at expiry is already stale.

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
required_amount = action_burn_p95 + checkpoint_tail_reserve
capacity_eligible = all_native_inputs_and_derived_values_are_finite
                    && forecast_route_is_a_bucket_alias
                    && reading_fresh
                    && quality_is_authoritative_or_observed
                    && discrepancies_are_empty
                    && required_amount <= allocatable

# risk remains a diagnostic ratio. It is not an eligibility substitute: zero
# burn divided by max(negative allocatable, epsilon) can be <= 1 while there is
# no allocatable native capacity.

# Separate reservation/evidence condition; still not launch authority.
evidence_admissible = all_buckets_eligible
                     && committed_atomic_reservation_is_fresh
                     && reservation_covers_each_bucket
                     && preemption_state_not_blocking_new_admission
```

Reserve all required buckets in one serializable compare-and-swap transaction
across every route alias. An unresolved attempt retains its worst-case hold.
Reserve checkpoint/stop capacity separately and reject an atomic action unless
its p95 burn plus that tail fits. These calculations return declarations about capacity evidence and
eligibility. Here, `admissible` means only that the submitted record is consistent
with the local capacity rule and reservation fields. `launchAuthority` remains false;
the checker does not observe an account or execute the described compare-and-swap.
It does not admit a body, authorize a model call, transfer identity, clear a halt,
or issue a rebodiment verdict.

The machine contract is `../schemas/capacity-evidence.schema.json`; verify its
cross-field arithmetic and strict timestamp profile with
`../scripts/validate-capacity-evidence.mjs`. This validator checks supplied-record consistency, not source authenticity, digest
contents, transaction atomicity, or deployment. It cannot detect a declaration that
renames both a provider bucket and its `windowId`; a parser/observation profile must bind
those identifiers to raw evidence and an exact source revision when available. A
schema-valid record with inconsistent math is invalid. The fake ready and
unknown fixtures under `../examples/` are the conformance baseline. Preserve
the explicit `executionClass`: fake/replay evidence may never satisfy a
real-provider proposal, even when all synthetic arithmetic is internally green.

Forecast by provider, model, effort, task class, context size, tool pack, and
execution mode. Keep p50/p90/p95 and calibration error, and reject non-monotone
quantiles. Recalibrate on held-out attempts for the same route/task profile. Never tell
the operator “N tasks remain”; report the dated native window and uncertainty instead.

## Preemption states

- `ROOMY`: continue under reservation.
- `TIGHTENING`: no new children; smaller phase pack; checkpoint sooner.
- `CHECKPOINT_NOW`: blocks a new admission. A separate authority may permit only an
  already-admitted bounded atomic action to finish using its separately reserved tail,
  then freeze effects and seal the capsule. The evidence checker neither authorizes that
  continuation nor treats it as a new reservation.
- `SWITCH_ELIGIBLE`: capacity evidence says a named route fits; a separate
  lifecycle authority still decides whether a switch may occur.
- `WAIT_FOR_RESET`: hibernate with no process.
- `EXHAUSTED`: deny model calls; evidence-only local work may continue.
- `UNKNOWN`: fake/replay/local only; real-provider use remains blocked until a
  supported fresh observation is available.

Settle observed allowance delta and uncertainty reserve after every attempt,
including failures and missing responses. A transport error does not prove the
provider charged nothing.
