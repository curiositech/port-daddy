# Conformal Prediction Sets as Distribution-Free Quality Bounds for Skill Outcomes

Conformal prediction (CP) produces prediction sets C(x) with a guaranteed marginal coverage property: P(Y_new ∈ C(X_new)) ≥ 1 − α. The guarantee is distribution-free — it requires only **exchangeability** of calibration and test samples, not IID, parametric distributional assumptions, or access to model internals. This makes it uniquely suited to the attestation context, where a third-party verifier has an outcome log but no model weights.

## Exchangeability vs. IID

IID implies exchangeability, but exchangeability is strictly weaker. A sequence (z_1, ..., z_n, z_{n+1}) is exchangeable if its joint distribution is invariant to any permutation. In practice this holds when:

- Calibration and deployment data are drawn from the same underlying process (no distribution shift between calibration window and test window).
- The outcome log is not sorted by time in a way that breaks permutation-invariance (a monotone quality drift violates this; random temporal interleaving does not).

For skill quality over historical outcomes, exchangeability is plausible within a stable deployment window. If prompt distribution shifts markedly (e.g., a new task category enters the DAG), the calibration set must be refreshed — coverage degrades gracefully (the guarantee no longer holds) but is recoverable by recalibrating on recent records. ConU (arxiv:2407.00499) empirically characterizes this degradation on 7 LLM × 4 dataset combinations.

## Non-Conformity Score for Binary Skill Outcomes

The score function s(x, y) assigns higher values to more "surprising" (x, y) pairs. For binary accept/reject outcomes from a judge, the natural score for a record with outcome y ∈ {0, 1} and local quality estimate q̂(x) ∈ [0, 1] is:

```
s(x, y) = 1 - q̂(x)  if y = 1  (accepted: score = residual uncertainty)
s(x, y) = q̂(x)      if y = 0  (rejected: score = how confident model was, wrong)
```

Alternatively, use **self-consistency** as in ConU: generate k outputs, compute entropy of the judge-majority vote, use entropy as score. This avoids defining a residual over a scalar estimate and works purely from the outcome log if judge responses are stored.

## Split Conformal (the Default)

Split (or inductive) conformal partitions the labeled data into a training portion (used to fit any model or score estimator) and a **calibration set** of size n (untouched). Steps:

1. Compute s_i = s(x_i, y_i) for each calibration record i = 1..n.
2. Sort scores ascending. Threshold: q̂ = the ⌈(n+1)(1−α)⌉/n-th empirical quantile.
   - Concretely: index k = ⌈(n+1)(1−α)⌉; q̂ = s_{(k)} (the k-th order statistic).
3. Prediction set for new input: C(x_{n+1}) = {y : s(x_{n+1}, y) ≤ q̂}.

**Coverage guarantee** (Vovk et al., 2005; Angelopoulos & Bates, 2023): P(Y_{n+1} ∈ C(X_{n+1})) ≥ 1−α exactly. For finite n, coverage is at most 1−α + 1/(n+1). At n=100, α=0.05, the upper bound slack is 0.01 — negligible.

The calibration certificate for a third-party verifier is: (n, α, score_fn_id, q̂). They need the calibration set to recompute q̂ and confirm it matches. With a Merkle-committed log, they can audit the calibration records and verify the threshold without any model access.

## Cross-Conformal (When Calibration Data Is Scarce)

Split conformal wastes data — the calibration split cannot be used for training. Cross-conformal (also: cross-conformal prediction, Vovk 2015; or **jackknife+**, Barber et al. 2021 for regression) recovers this by using all data. For K-fold cross-conformal:

1. Partition n records into K folds.
2. For each fold k: train score estimator on remaining K−1 folds, compute scores on fold k.
3. Pool all n out-of-fold scores. Apply quantile rule as in split CP.

Coverage guarantee holds approximately (asymptotically exact under mild conditions; finite-sample bound: P(Y_{n+1} ∈ C) ≥ 1−α − δ for small δ depending on K and n). The certificate is harder to serialize for third-party verification because the score estimator was fit on subsets — you must commit the fold assignments and the per-fold model artifacts, not just a single threshold. For the skill attestation use case, **split conformal is strongly preferred**: the certificate is a single (n, α, score_fn_id, q̂) tuple verifiable from the Merkle-committed calibration subset.

## Applying to Skill Quality Over Historical Outcomes

Concretely, for a skill with an outcome log:

1. Reserve a **time-contiguous calibration split** (e.g., last 20% of records before the certification date). Time-contiguous preserves exchangeability better than random split when there is mild temporal correlation.
2. Fit or freeze the score function (e.g., self-consistency entropy from stored judge outputs, or kNN local quality estimate). Freeze means: do not retrain score estimator after calibration set is fixed.
3. Compute calibration scores, extract q̂ at ⌈(n+1)(0.95)⌉/n.
4. Commit calibration set Merkle root alongside (n, α, score_fn_id, q̂).

At inference time: compute s(x_new, y_proposed). If s ≤ q̂, the output is in the conformal prediction set — formally, it is consistent with the 95%-covered region. **This is not a per-invocation confidence score**; it is a set-membership test. The set may be large (low rejection rate, wide coverage) or small (high rejection rate, tight coverage) depending on the score function calibration.

**Recalibration trigger**: if the deployment distribution shifts (detectable via covariate shift tests on input embeddings — e.g., maximum mean discrepancy above a threshold), the coverage guarantee lapses. Re-run calibration on a fresh window; re-commit the Merkle root. Log the recalibration event with timestamp in the transparency log.

## Key Points

- Conformal prediction requires only **exchangeability**, not IID. For skill quality attestation, this holds within a stable deployment window and lapses under prompt distribution shift — triggering recalibration.
- **Split conformal produces the simplest attestable certificate**: a single threshold q̂ computed from a Merkle-committed calibration set at a declared (n, α, score_fn_id). Third-party verification is a quantile recomputation, no model access needed.
- The threshold index formula is k = ⌈(n+1)(1−α)⌉, not simply ⌈n(1−α)⌉ — the +1 accounts for the new test point and is what makes the coverage guarantee exact (not conservative).
- Cross-conformal is data-efficient but produces a certificate that is hard to serialize and verify externally. Prefer split conformal for attestation; use cross-conformal only for internal calibration quality benchmarking.
- Coverage is **marginal** (averaged over inputs), not **conditional** (per-input). For conditional validity under covariate shift, use the adaptive conformal methods in Quach et al. (arxiv:2406.09714) — these produce topic-specific thresholds at the cost of a larger calibration requirement per topic bucket.

## See Also

- `SKILL.md §Conformal Calibration Certificate` — pseudocode for computing and serializing the certificate into the attestation bundle.
- `references/tamper-evident-outcome-log.md` — Merkle tree commitment structure required for the calibration set to be third-party verifiable.
- Angelopoulos & Bates (2023), "A Gentle Introduction to Conformal Prediction and Distribution-Free Uncertainty Quantification" — arxiv:2107.07511. Canonical tutorial; sections 2–4 cover split conformal and cross-conformal with finite-sample coverage proofs.
