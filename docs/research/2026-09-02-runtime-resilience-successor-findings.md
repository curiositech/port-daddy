# Runtime resilience findings retained for a successor

This is dated evidence, not roadmap authority. It preserves five concrete findings from the Embedding & Retrieval Architect's **2026-09-02** report. They are not part of [PR #9995](https://github.com/curiositech/port-daddy/pull/9995)'s architecture delivery, and publication does not claim a runtime repair or deployment.

## Evidence boundary

The owner reported deterministic, in-memory execution of actual modules using synthetic errors, clocks and sleep hooks: no provider traffic, real waits or daemon/Git writes. The original census inspected source equivalence but did **not** independently rerun that harness; neither did this publisher. Its main witness was `cc317ed193de5714ba8ff23ae8e0bb192f82b8ee`.

The relevant **backend resilience module** ([`lib/agent-resilience.ts`](../../lib/agent-resilience.ts)) classifies failures and controls retry/breaker behavior. The **gated loader** ([`lib/observability/gated-loader.ts`](../../lib/observability/gated-loader.ts)) loads expensive resources under those controls. **Dispatch failover** ([`lib/dispatch/failover.ts`](../../lib/dispatch/failover.ts)) consumes failure classification while choosing backend attempts. Source cited at the original witness: [resilience](https://github.com/curiositech/port-daddy/blob/cc317ed193de5714ba8ff23ae8e0bb192f82b8ee/lib/agent-resilience.ts), [loader](https://github.com/curiositech/port-daddy/blob/cc317ed193de5714ba8ff23ae8e0bb192f82b8ee/lib/observability/gated-loader.ts), [failover](https://github.com/curiositech/port-daddy/blob/cc317ed193de5714ba8ff23ae8e0bb192f82b8ee/lib/dispatch/failover.ts).

## Findings and required proof

| Boundary | Reported synthetic observation | Repair/test obligation |
| --- | --- | --- |
| Half-open breaker admission | Three calls admitted before any completed; transition to HALF_OPEN had no in-flight probe reservation | Define an admission quota, settle it on every terminal path, and test parallel probes and stale completions. A success threshold is not a concurrency quota. |
| Trusted failure classification | `HTTP 401 Unauthorized; untrusted detail mentions 429 timeout` became retryable/rate-limited | Trusted structured status/code must outrank untrusted descriptive text. Reordering text patterns alone does not establish that boundary. Test mixed messages and nested causes; ambiguous authorization failures must not become transient. |
| Gated-loader retries | Three configured attempts called a synthetic permanent 401 three times; breaker was checked only before the loop | A permanent failure must produce one attempt. Recheck admission before each downstream attempt; opening the breaker must prevent more work. |
| Diagnostic privacy | A synthetic private marker reached logging metadata through a raw error message | Sanitize before the logger boundary; retain safe structured cause/correlation fields. Exercise the actual logger path. This is not evidence of a real production-secret disclosure. |
| Server-directed retry delay | A supplied retry hint requested a 6,000,000,000,000,000 ms wait despite a 2 ms configured backoff cap | Validate safe finite values and the remaining total deadline. If the server's minimum wait cannot fit, return a bounded failure/deferred result; do not truncate it into an earlier retry. Test malformed, oversized, overflowing and deadline-exceeding hints with injected time. |

These are review requirements for the actual successor head, not proof that the current installed binary still has every historical defect. The manager has assigned a separate runtime-resilience lane; its source, test, public-PR, compiled-artifact and deployed-runtime receipts must remain distinguishable.

## Reuse and unresolved boundaries

Dispatch failover consumes classification; the gated loader consumes breaker/backoff behavior. Do not describe both as callers of `runResilientSpawn`. Shared hostile fixtures across those real seams are a useful proof obligation; another generic wrapper is not evidence of reuse.

The same review discipline applies to Porthole shutdown: the census found a 5,000 ms Keychain child timeout but no shared end-to-end cancellation budget, and unbounded native capture/writer completion and package-verification subprocesses. Passing race tests does not prove bounded termination. These are separate native/focused-owner obligations, not a reason to add retry loops to authorization or consent checks.

The source skill's illustrative retry arithmetic also required correction: three retries means four attempts. Four independent layers each allowing four attempts can cause `4^4 = 256` downstream attempts; `64` describes three such layers. Count the actual layers and attempt budgets. The cited local skill copy had no advertised audit script, so no script execution is claimed here.

Embedding-model choice, privacy-aware indexing, migration and retrieval architecture remain with #9995 and its successors. This report does not install a model or change the configured provider.

## Provenance

The original artifact `runtime-resilience-successor-findings-20260902.md` has SHA-256 `88c5f3758c454d7c894496913ffdff42c87778b3e754248a11096d5e301235ff`. Its private machine path is intentionally omitted. The [delivery census](2026-09-02-delivery-census.md) and [compact source record](2026-09-02-delivery-census.json) preserve attribution, historical observation time and the later merge readbacks. They retain evidence for the responsible agents without publishing raw transcripts or becoming another planning store.
