# Uncertainty and Confidence in Agent Decision-Making: When to Act vs. When to Reason

## The Confidence-Based Switching Heuristic

The paper evaluates a routing method between internal reasoning and external action; its sample-agreement heuristic is a task-specific signal, not a general confidence measure. The paper proposes two switching heuristics:

**CoT-SC → ReAct**: "When the majority answer among n CoT-SC samples occurs less than n/2 times (i.e. internal knowledge might not support the task confidently), back off to ReAct."

This uses self-consistency as a proxy for confidence. If you sample 21 reasoning traces and 15 give answer A while 6 give other answers, the 71% agreement is an internal agreement statistic; it needs calibration before it is used as a confidence estimate. If answers are split 8-7-6 across three options, the 38% maximum agreement is a reason to seek evidence or abstain under a configured policy; it does not prove an answer false or show that a model lacks relevant knowledge.

In the paper configuration, the named switching rule is applied under its task/action limits (7 HotpotQA steps and 5 FEVER steps). Outside that setting, select and calibrate a routing policy with authority, cost, and abstention rules.

**ReAct → CoT-SC**: "When ReAct fails to return an answer within given steps, back off to CoT-SC."

The paper uses a step limit to switch from ReAct to CoT-SC in its tested setup. This is a paper-specific fallback procedure; it does not establish that the fallback has evidence when retrieval is incomplete or unavailable. An application must declare any different limit and validate its recovery behavior.

In Figure 2, the paper reports that its combined configurations reach the CoT-SC result at 21 samples using 3–5 samples on the reported tasks and setup. Treat this as a configuration-specific result, not a general sample-efficiency guarantee.

## Measuring Uncertainty in Agent Systems

The self-consistency approach (sampling multiple reasoning traces and checking agreement) is one way to estimate uncertainty. Other approaches agent systems should consider:

**1. Token-level probability scores**: Language models assign probabilities to generated tokens. Token probability can be an input feature, but it is not a calibrated correctness probability without empirical validation. Such numeric features would be constructed routing inputs, not ReAct evidence or calibrated confidence. Validate their relationship to correctness before using them for routing.

**2. Semantic consistency across rephrasings**: Ask the same question multiple ways. Agreement or variation is a proposed feature; neither establishes calibrated correctness without task-specific evaluation.

**3. Consistency between reasoning and answer**: If the reasoning trace supports a different answer than the final answer given, that's a red flag. Example: Reasoning says "1844 < 1989, so Arthur's Magazine came first" but answer is "First for Women"—inconsistency suggests low confidence or reasoning error.

**4. Presence of hedging language**: When models are uncertain, they hedge: "It seems likely that...", "Probably...", "Based on common patterns...". Confident statements are more direct: "The answer is X." Generated hedging language can be a feature, but it does not reliably reveal uncertainty or hidden model state.

**5. Factual specificity**: Specificity and vagueness are proposed text features, not validated uncertainty measures.

For agent systems, consider these only as candidate features in a calibrated routing evaluation; bind any resulting action to evidence authority, cost, and a stopping rule.

## The Cost-Benefit Analysis of External Grounding

External grounding (ReAct) has costs that internal reasoning (CoT) doesn't:

**Latency**: API calls take time. Wikipedia searches, database queries, web scraping—each adds milliseconds to seconds. For time-sensitive tasks, this matters.

**API costs**: Many external data sources charge per call. GPT-4 API calls, specialized data APIs, paid research databases—costs accumulate with heavy use.

**Rate limits**: External services limit request rates. An agent making thousands of queries might hit rate limits, forcing delays or failures.

**Availability**: External services can be unavailable, slow, rate-limited, or return errors. An application needs an explicit failure path; internal generation may also fail or lack the required evidence.

**Source and retrieval errors**: a result can be stale, incomplete, irrelevant, or misrepresented. Retrieval does not generally outrank model-generated claims; compare each against an authoritative source, its date, and the claim it is meant to support.

These costs must be weighed against benefits:

**Sampled error category**: Table 2 reports 0% ReAct and 56% CoT hallucination categories within its selected incorrect-answer examples (50 per method; a separate 50 correct-answer examples per method were also studied). These are reported category percentages, not reconstructed counts or population rates. This is not a mechanism guarantee; observations can be incomplete, wrong, or only partially relevant.

**Potential freshness**: an external source may be more current than the model’s learned information, but its publication/update date and retrieval time must be checked. Retrieval does not guarantee current data.

**Inspectability**: a retained source receipt can be checked against a claim. A generated internal claim has no external provenance by default; a visible reasoning trace does not reveal its true origin.

**Domain coverage**: A designated external source may contain a relevant fact that is absent from a model’s generated answer, but coverage must be checked for the particular source and claim.

Choose candidate routes based on the task’s evidence needs and constraints; no route in this table is a guarantee:

| Example task condition | Candidate route to evaluate | Boundary and required check |
|---|---|---|
| Freshness-sensitive claim | Authorized source retrieval, if available | Check source authority, date, scope, and claim support; disclose as-of time or abstain. |
| Mathematical task | Direct derivation, calculator, or proof/checking tool as appropriate | Check premises and computation; retrieval may help establish a premise. |
| Rare or specialized fact | Retrieval from a designated source | Verify the result is relevant and authoritative; search rank alone is not support. |
| Familiar low-consequence question | Direct-generation baseline | Familiarity is not a correctness guarantee; compare to task criteria. |
| High-consequence decision | Domain-approved evidence and accountable review | ReAct or retrieval alone does not establish safety, accuracy, or authorization. |
| Latency-constrained task | Lowest-cost route that satisfies evidence requirements | A faster answer may be stale or unsupported; disclose limits or abstain. |
| Logical deduction | Derive from explicit premises, optionally with a checker | Valid inference requires sound premises; sources may be needed for factual premises. |
| Fact verification | Claim-specific authoritative evidence | Link evidence to the claim; support/refute/unknown must be permitted outcomes. |

## Uncertainty as a First-Class Signal in Orchestration

For DAG-based agent orchestration, a locally evaluated uncertainty signal can be one input to routing. Keep it separate from evidence authority and execution permission:

**1. Locally calibrated routing signals**: A system may return confidence-related features, but downstream policy should use them only after task-specific evaluation; a score is not authority:
```
# Constructed, uncalibrated illustration — not a ReAct rule.
if calibrated_signal == "passes local policy":
    return answer_with_evidence_status
elif authorized_evidence_route_available:
    validate_with_named_source()
else:
    abstain_or_use_configured_review()
```

**2. Uncertainty-aware composition**: A local policy may route selected uncertain outputs for review or additional evidence. Define the trigger, approved sources, cost, and abstention route; multiple sources do not automatically mean independent or correct evidence.

**3. Adaptive sampling**: Use confidence to decide how many samples to generate. Choose sample count from a task-specific cost/quality evaluation; no universal count follows from ReAct.

**4. Human-in-the-loop triggers**: A calibrated policy may route selected cases to configured review; an uncalibrated score is not authority. Rather than failing or guessing, the system signals "I'm uncertain about X, please advise."

**5. Cascading confidence**: Track evidence and assumptions across steps; any confidence aggregation needs a task-specific model and evaluation.

## The Self-Consistency Paradox: When Agreement Doesn't Mean Correctness

Self-consistency agreement can be tested as a confidence-related feature; it is not a calibrated probability by default. The paper reports comparisons under its prompts, models, and tasks. Correlation with correctness needs target-task calibration.

But there are failure modes:

**Consistent error**: Samples may agree on a wrong answer. Self-consistency measures agreement among generated answers, not external correctness.

**Agreement despite sampling**: In a sampling decoder, changing the random draw does not ensure different answers. A dominant answer can still be wrong.

**Semantic variation**: Different phrasings of the same answer might be counted as disagreement. "Paris," "The capital is Paris," and "It's Paris" are the same answer but might not match exactly in self-consistency voting.

For agent systems, this suggests:

**1. Route consequential claims to designated review**: require the task’s authoritative evidence process and accountable reviewer where policy calls for them. Retrieval from an arbitrary source is not enough; low agreement may also trigger abstention or clarification.

**2. Normalize answer equivalence deliberately**: Exact string match can treat paraphrases as different answers. A semantic matcher is another candidate and needs an error check; its own false matches can distort agreement.

**3. Calibration**: Test whether self-consistency correlation with correctness holds on your domain. Some domains might need higher agreement thresholds than others.

**4. Evaluate sampling diversity**: compare decoding settings, prompts, or model configurations on the target task and report answer diversity, validity, cost, and calibration. Higher temperature or a different prompt may change outputs but does not ensure useful diversity.

## Graceful Degradation: Handling Irreducible Uncertainty

Sometimes uncertainty cannot be resolved. External sources have no information, multiple sources conflict, or the question is genuinely ambiguous.

One reported FEVER trace ends with the task label "NOT ENOUGH INFO." This illustrates a permitted answer in that task; it does not show that the system reliably detects all insufficient-evidence cases:

"The song peaked at number two on the Billboard Hot 100 in the United States, but not sure if it was in 2003." → Answer: NOT ENOUGH INFO

Under an application policy that permits abstention, an explicit unknown can be preferable to an unsupported guess. For agent systems:

**1. Make "I don't know" a valid response**: Systems should be allowed to report insufficient information rather than forced to guess.

**2. Distinguish types of uncertainty**: 
   - "I lack supporting information" (additional authorized retrieval might help)
   - "Not found within this searched scope" (does not prove no answer exists)
   - "Information is conflicting" (sources disagree)
   - "Question is ambiguous" (needs clarification)

**3. Provide partial answers**: "I found X and Y but not Z" is more useful than refusing to answer because Z is missing.

**4. Suggest next steps**: "I couldn't find this information in Wikipedia, but it might be in specialized databases" guides users toward resolution.

## The Temperature-Confidence Relationship

The paper uses decoding temperature 0.7 for its CoT-SC setup. The effect of a temperature parameter depends on model API and decoder configuration. Under the common temperature-scaled categorical distribution, increasing temperature flattens token probabilities, but this alone does not predict sequence diversity, correctness, or coherence.

Do not assume qualitative “low/medium/high” bands have portable effects. If sampling is part of a local uncertainty policy, predeclare candidate decoder settings and compare output diversity, correctness, coherence where relevant, and resource use on held-out examples. The result applies to the tested model/API and task.

For self-consistency, the paper’s temperature is an experiment setting. A local setting must be evaluated against task outcomes; sampling may change agreement and quality in either direction, and no coherence guarantee follows.

## Transferable Principles for WinDAGs

1. **Evaluate self-consistency as a candidate feature**: measure agreement and calibration on a named task before routing.

2. **Route by evaluated policy**: include evidence authority, costs, and a stopping/abstention condition.

3. **Keep uncertainty distinct from authority**: Skills may return an uncertainty feature when defined and evaluated; downstream policy decides whether it can affect routing.

4. **Calibrate local thresholds if used**: name the data, error target, authority, and review path; do not attribute them to ReAct.

5. **Allow "I don't know" responses**: Forcing guesses under uncertainty creates unreliable outputs.

6. **Evaluate candidate uncertainty features together**: Self-consistency, hedging language, specificity, and reasoning-answer consistency may be compared on labeled target-task examples; combining them does not itself calibrate a score.

7. **Measure evidence tradeoffs**: record scope, latency, cost, authority, and outcome; retrieval alone does not establish correctness.

8. **Calibrate for your domain**: Test whether uncertainty measures correlate with correctness in your specific tasks.
