# Why Thompson/Beta Is a Category Error for LLM Skill Quality

Thompson sampling (TS) with a Beta(α, β) prior is the standard answer to the multi-armed bandit problem: maintain one distribution per arm, sample from each, pull the arm with the highest sample. It works beautifully when arms are stationary, rewards are i.i.d., and the goal is minimizing cumulative regret over pulls. None of those conditions hold for LLM skill quality assessment, and the failure modes are not marginal — they are structural.

## The IID Assumption Is Violated by Construction

TS requires that the reward r_t for arm k at time t be drawn i.i.d. from a fixed distribution F_k. LLM skill quality is context-dependent: the same skill applied to structurally dissimilar inputs produces outcomes from different distributions. A skill that achieves 0.92 pass rate on short legal summaries and 0.61 on long technical specifications is not sampling from a single Bernoulli(p_k). Collapsing these into one Beta(α, β) produces a posterior over a parameter that does not exist. The α and β values accumulate evidence about the marginal over all inputs ever seen — not about quality for the current input. Running a kNN lookup over the outcome log with the current input embedding surfaces the input-local quality signal that Beta(α, β) discards by averaging.

## Non-Stationarity: The Posterior Tracks Drift Incorrectly

Prompt distributions shift over time as users, tasks, and models evolve. A Beta posterior with no forgetting mechanism assigns equal weight to an outcome from 18 months ago and one from yesterday. Windowed forgetting (e.g., exponential decay) is sometimes proposed but breaks the Bayesian update formula — you are no longer computing a posterior over a fixed Bernoulli p, you are heuristically warping one. The TS regret bound (Russo & Van Roy 2014, Theorem 3) requires stationarity; there is no general regret bound for non-stationary TS without additional assumptions that LLM workflows do not satisfy.

## The α/β Values Are Not Interpretable as Task Counts

The Jeffreys prior for a Bernoulli is Beta(0.5, 0.5). The uninformative prior is Beta(1, 1). After observing s successes and f failures, the posterior is Beta(1+s, 1+f) under a uniform prior. This means α = 1+s and β = 1+f — clean and interpretable only when outcomes really are i.i.d. Bernoulli. In the skill context, outcomes are judge-dependent: a different judge (LLM-as-judge model version, human evaluator, automated metric) produces a different s and f from the same invocations. The α and β values encode a mixture of true skill quality and judge calibration bias. A third-party auditor receiving Beta(47, 12) cannot decompose these. By contrast, a Merkle-committed outcome log with judge-function identifier exposes every individual (input_hash, output_hash, judge_result) record — the auditor recomputes the posterior themselves and can identify judge drift.

## The Selection vs. Attestation Distinction

This is the sharpest failure. TS is an exploration-exploitation algorithm: it produces a signal of the form "pull arm k next." It is designed for the decision problem of which arm to choose under uncertainty. Attestation requires a different signal: "here is a formal bound on what quality this skill delivers, with a stated coverage guarantee, verifiable without model access." Those are categorically different outputs. A Beta credible interval is not an attestation — it is a summary of posterior uncertainty under a model whose assumptions are wrong. A conformal calibration certificate (ConU, arxiv:2407.00499) provides: for any new (input, output) pair drawn exchangeably from the calibration distribution, P(y_new in prediction set) >= 1 - alpha, with no distributional assumption beyond exchangeability. That guarantee is absent from any Beta-derived interval over i.i.d.-violated data.

## The windags CLAUDE.md:86 Rejection

CLAUDE.md line 86 makes the architectural decision explicit: "Skills are heterogeneous, not fungible arms. The mechanism is contextual retrieval + attribution k-NN over a private triple store of (task, selected skills, accept/reject). Any code or comment that uses bandit vocabulary is a category error and should be rewritten." The `SkillQualityStore` Beta(α, β) implementation that existed prior to this decision is scheduled for removal (CLAUDE.md:313, :394). Do not extend it. Do not port it. Do not wrap it in a new name. The correct mechanism for quality assessment is the attestation bundle (Merkle log + conformal certificate + Beta-Binomial posterior read as interval, not sampled for selection). The correct mechanism for skill routing is attribution-kNN over the outcome triple store.

## Key Points

- TS/Beta requires i.i.d., stationary rewards; LLM skill outcomes are context-dependent and non-stationary — the assumption failure is structural, not marginal.
- After iid violation, α and β values are uninterpretable: they encode a mixture of true skill quality and judge calibration bias that no third party can decompose without the full outcome log.
- TS produces a selection signal (which arm to pull); attestation requires a coverage-guaranteed bound. Conformal prediction (ConU, arxiv:2407.00499) provides that bound; Beta posteriors under violated assumptions do not.
- The windags codebase encodes this explicitly at CLAUDE.md:86 and :313. The old `SkillQualityStore` Beta path is a category error pending removal — do not extend it.
- The correct quality mechanism is: Merkle-committed outcome log + conformal calibration certificate + attribution-kNN local estimate. These are verifiable, bounded, and internals-opaque.

## See Also

- `SKILL.md` — "Thompson/Beta as Category Error" section for the concise statement; "Beta-Binomial Posterior Interval" section for how Beta is correctly used (as an auditable interval read from a Merkle-verified log, never sampled for arm selection).
- ConU (arxiv:2407.00499) — the conformal-prediction-for-LLMs paper providing the formal coverage guarantee that replaces TS as the attestation mechanism.
- `windags/CLAUDE.md:86` — architectural decision record rejecting bandit vocabulary for skill selection; `SkillQualityStore` Beta path scheduled for removal at `:313` and `:394`.
