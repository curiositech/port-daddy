# Compaction methods, local evaluation, and cost/context arithmetic

Use this reference when selecting a compaction procedure, testing summary quality, or comparing a smaller-context workflow with an uncompressed baseline. The methods below come from distinct papers and settings. They are not interchangeable guarantees.

## ACON v3: failure-driven instruction refinement

Kang et al., *Acon: Optimizing Context Compression for Long-horizon LLM Agents*, arXiv:2510.00615v3 (revised 2026-06-01), [full paper](https://arxiv.org/html/2510.00615v3). Reviewed abstract and §§3.1–3.3, including the optimization loop. In the paper, a task agent's base model and task prompt are held fixed while the compression guideline is iteratively optimized. The method:

1. Run task examples without compression and with the current compressor on training cases.
2. Select contrastive cases where the uncompressed run succeeds but the compressed run fails.
3. Compare the source history/observation with its compressed form and ask an optimizer model to identify information loss and suggest guideline changes.
4. Aggregate feedback across selected failures, revise the natural-language compression guideline, then evaluate the next candidate.
5. Keep history compression and latest-observation compression as distinct inputs: observation compression may condition on the prior history, while history compression works over an accumulated range.

The paper's setup treats final task reward as sparse and compression costs as discrete, motivating its contrastive feedback procedure rather than direct gradient optimization. This does not prove the optimizer's diagnosis is correct, that the guideline converges, or that a candidate generalizes outside its task distribution. The paper also studies compressor distillation, but that method is outside the inspected sections here. Do not transfer the paper's benchmark results to another model or workflow without a local comparison.

## Parallel Context Compaction v1: ordered prefix/block workers

*Parallel Context Compaction for Long-Horizon LLM Agent Serving*, arXiv:2605.23296v1 (2026-05-22), [full paper](https://arxiv.org/html/2605.23296v1). Reviewed §§3–4 and the adjacent measurement discussion. The paper snapshots and partitions a chronological history. Worker *k* receives earlier prefix blocks together with its assigned block placed last; concurrent partial summaries are merged in original chronological order. This differs from summarizing isolated chunks independently and from giving every worker one entire, repeatedly marked-up history.

The evaluation used named agent/QA tasks, specified backbones, and a serving setup with vLLM, prefix caching/chunked prefill, and dedicated H100 hardware. Its reported latency and output behavior are conditional on that environment. It does not establish arbitrary concurrency, summary fidelity, API-billing savings, or permission to spawn workers. For a local cost model, count each worker's prefix exposure, summary input/output, merge call, retries, and any cache-hit evidence separately. Do not credit a cache discount merely because prefixes match on paper.

## Slipstream v1: bounded continuation check before adoption

*Slipstream: Trajectory-Grounded Compaction Validation for Long-Horizon Agents*, arXiv:2605.08580v1 (2026), [full paper](https://arxiv.org/html/2605.08580v1). Reviewed §4.1–4.3 and the neighboring experiment setup/results. The paper allows the original-context agent to continue while a candidate summary is produced. A judge checks facts and forward intent used in the next *k* continuation steps. A passing candidate is adopted; a failing check triggers targeted correction. The tested horizon is finite and timing-dependent: facts used after that horizon can escape detection.

Treat this as trajectory-grounded validation, not semantic equivalence or an error-free judge. Local implementations should use authorized observable plans, action records, tool receipts, and artifacts; the paper's access to model reasoning is not a portable interface requirement. Keep the source context until adoption is decided, bind the candidate to the exact snapshot, and record the intervening actions exactly once. Do not replay external effects to reconstruct a trajectory.

## A bounded local comparison recipe

This is a proposed evaluation, not a run result or a claim made by the papers.

1. **Freeze a task contract.** Write the required facts, constraints, prohibited actions, expected next-step scope, and source artifacts. Include negative facts such as a request that was denied or an effect that remains unknown.
2. **Bind each run.** Record source digests/versions, model and route, system/developer prompt, tool definitions, task seed where available, execution mode, and the compression candidate. A pointer is usable only if it resolves to the intended version and the evaluator has permission to read it.
3. **Use a paired baseline.** Run the same task from the original context and each candidate representation under matched tool/evidence conditions. If the task is stochastic, repeat with the same set of task instances and report paired outcomes instead of comparing unrelated averages.
4. **Exercise known failure modes.** Make constructed candidates that (a) omit a required constraint, (b) broaden a prescribed patch, (c) turn a denied request into a success claim, (d) remove a source link or misbind its version, and (e) omit a fact whose consequence appears only after the candidate's limited continuation horizon.
5. **Check both summary and continuation.** Score required-fact coverage, unsupported-claim count, denied/unknown-state preservation, scope adherence, and observable continuation actions. A judge's decision is one measurement; retain the source-grounded checks and reviewer disagreements.
6. **Measure the full trade-off.** Report task success and error classes alongside visible input, cached input, output, compressor calls, tool calls, retries, latency, and retrieval/human costs. Separate cache-price savings from context occupancy. Keep a held-out set for final comparison; do not tune the compression instructions on it.
7. **State a local adoption rule.** Set acceptable error bounds from task harm and operational needs, not a universal accuracy or token threshold. A finite-window pass does not certify later facts or untested task classes.

Keep each trial inert unless a separate owner authorizes live actions. The experiment must not retry an external side effect to recover missing context evidence.

## Worked cost and context example

The following uses OpenAI API **Standard short-context** GPT-6 Luna rates displayed in the [official pricing page](https://developers.openai.com/api/docs/pricing) when rechecked on 2026-09-24: $0.10/M uncached input, $0.01/M cached input, $0.125/M cache writes, and $0.50/M output. The example has **no cache-write tokens**. It does not model storage, tools, human work, subscription charges, regional-processing uplift, long-context rates, or any unlisted token category. Rates and model categories change; re-read the pricing page for a real estimate.

- **Call 1:** 20,000 uncached input + 1,000 output costs `20,000 × .10 / 1,000,000 + 1,000 × .50 / 1,000,000 = $0.00250`.
- **Call 2:** 10,000 eligible cached-prefix input + 2,000 fresh input + 1,000 output costs `.00010 + .00020 + .00050 = $0.00080`. It contains 12,000 input tokens in this simplified count; cached status changes the rate, not the fact that input occupies context. Actual model accounting may include other token categories.
- **Two-call total:** `$0.00330`. If the prefix misses cache, Call 2 costs `$0.00170` and the total is `$0.00420`; the modeled cache-input difference is `$0.00090`.

Now insert a constructed compaction/reload call using 4,000 summary/pointer input + 3,000 rehydrated source input + 1,000 output, all uncached: `$0.00120`. A following compact-context work call with 4,000 input + 1,000 output costs `$0.00090`. Including Call 1, this three-call path costs `$0.00460`, more than the two-call cached path in this small scenario, although the following work request has 4,000 rather than 12,000 input tokens. This is a cash arithmetic comparison only. It does not show a quality gain, exact internal context size, or any subscription-capacity effect. Retrieval permissions, latency, retries, cache hits, cache writes, storage, and future reuse can change the comparison.

## Source and result boundary

Primary-source review is limited to the cited sections and version markers above. This reference records their method shape, not a systematic survey. No local compaction benchmark or provider usage experiment was executed in authoring this bundle. See `subscription-capacity-ledger.md` for native-unit capacity arithmetic and its independent static-validator limits.
