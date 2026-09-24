---
name: attestable-skill-quality-signal
version: 0.1.0
description: >
  Produces a narrow-interval quality signal for a WinDAGs skill that a third party can
  verify without inspecting model weights or method internals. The mechanism is
  attribution-kNN over a tamper-evident outcome log (task→skills→accept/reject store),
  combined with a conformal-prediction calibration certificate that provides a formal
  coverage guarantee. Thompson/Beta sampling is explicitly rejected as a category error:
  it produces a selection signal for stationary i.i.d. rewards, not an attestation
  signal for context-dependent LLM output quality. The resulting bundle — outcome-log
  Merkle root + conformal threshold + optional TEE guardrail signature — constitutes a
  "narrow-interval trust" credential: verifiable, bounded, and internals-opaque.
author: soma-windags-graft
tags: [quality, attestation, conformal-prediction, knn, trust, verification, llm-skills]
pairs-with: []
---

# Attestable Skill Quality Signal

## When to Use

- A downstream operator or orchestrator needs to trust a skill's output quality without
  access to the skill's model weights, training data, or internal scoring logic.
- A WinDAGs DAG node must gate on a quality threshold before passing results downstream,
  and that gate must be auditable post-hoc (e.g., for compliance, SLA enforcement, or
  adversarial review).
- A skill has accumulated an outcome log (binary or scored accept/reject records) and you
  want to convert that log into a formal quality bound with coverage semantics.

NOT for:
- Online exploration of which skill variant to route to — use Thompson sampling or UCB
  for that (selection problem, not attestation problem).
- Per-invocation confidence scores that must be computed in milliseconds with no
  calibration data — conformal calibration requires a held-out calibration set.
- Subjective quality dimensions (creativity, tone) where no stable binary judge exists —
  the Bayesian interval requires a well-defined Bernoulli outcome per invocation.

## Core Concepts

**Attribution-kNN (task→skills→accept/reject store)**
The shipped mechanism. Each skill invocation record contains: input hash, output hash,
a binary judge result (pass/fail), and a timestamp. At query time, retrieve the k
nearest records to the current input (by embedding distance over input hashes) and
compute an empirical quality estimate from their judge outcomes. Unlike kNN-QE (ACL 2024,
Zerva et al.), this does not require access to model training data — it operates on the
skill's own outcome store and is usable by third parties with read access to the log.

**Conformal Calibration Certificate**
Given a calibration set of n outcome records with exchangeable samples, define a
non-conformity score s(x, y) over (input, output) pairs. The conformal threshold is
q = the ⌈(n+1)(1-α)⌉/n-th quantile of calibration scores. Any third party holding the
calibration set size n, significance level α, score-function identifier, and threshold q
can verify: P(Y_new in C(X_new)) >= 1-α, distribution-free. This is the only available
mechanism that provides a formal coverage guarantee without model internals access
(ConU, arxiv 2407.00499; Enhanced CP, arxiv 2406.09714).

**Beta-Binomial Posterior Interval**
Treat each invocation as a Bernoulli trial. Maintain Beta(alpha, beta) posterior over
true success rate p, updating on each observed outcome. The 95% credible interval
narrows as outcome count grows (width ~ 2 * 1.96 * sqrt(p(1-p)/n)). Trivially
computable; third-party verifiable if the underlying outcome log is tamper-evident.
This is NOT a Thompson sampling signal — the posterior is read for its interval, not
sampled for arm selection.

**Thompson/Beta as Category Error**
Thompson sampling assumes i.i.d., stationary reward distributions. LLM skill quality
is context-dependent (same skill, structurally incomparable inputs), non-stationary
(prompt distribution shifts over time), and evaluated by judges with systematic bias.
Converging a Beta posterior under these conditions tracks noise; no regret bound holds
for the uninformative-prior case without stationarity. More fundamentally: TS produces
a selection signal (which arm to pull next), not an attestation signal (what quality
this arm delivers). A third party cannot trust a Beta(alpha, beta) parameter pair
because it carries no coverage guarantee.

**Tamper-Evident Outcome Log (Merkle Commitment)**
A Merkle tree of outcome records (input hash, output hash, judge result, timestamp),
with the root committed to a transparency log or immutable ledger. A third-party
auditor receives the tree, verifies the root matches the committed value, and computes
the Beta-posterior interval and conformal threshold from the leaf records. Without
tamper-evidence, the Bayesian interval and conformal certificate are unverifiable in
practice. Components exist (RFC 9162 certificate transparency + standard Beta-Binomial);
no packaged skill-quality library exists yet as of mid-2026.

## Implementation Pattern

```
INPUTS:
  outcome_log     -- list of {input_hash, output_hash, judge_result (0|1), timestamp}
  calibration_set -- held-out subset of outcome_log for conformal calibration
  alpha           -- desired miscoverage rate (e.g. 0.05 for 95% coverage)
  score_fn_id     -- identifier of non-conformity score function (e.g. "self-consistency-v1")
  k               -- neighbors for attribution-kNN lookup
  query_input     -- embedding of current task input

STEP 1 — BUILD TAMPER-EVIDENT LOG:
  merkle_root = merkle_tree(outcome_log).root
  commit(merkle_root, transparency_log)  # or on-chain

STEP 2 — CONFORMAL CALIBRATION CERTIFICATE:
  scores = [score_fn(record.input, record.output) for record in calibration_set]
  n = len(calibration_set)
  q = quantile(scores, ceil((n+1)*(1-alpha)) / n)
  certificate = {alpha, n, score_fn_id, threshold: q}
  # Third party can verify: predict set = {y : score(x,y) <= q}
  # Coverage guarantee: P(y_new in set) >= 1-alpha (no model access needed)

STEP 3 — BETA-BINOMIAL POSTERIOR:
  successes = sum(r.judge_result for r in outcome_log)
  failures  = len(outcome_log) - successes
  posterior = Beta(alpha=1+successes, beta=1+failures)
  interval  = posterior.credible_interval(0.95)
  # Verifiable from Merkle-proven outcome_log without model access

STEP 4 — ATTRIBUTION-kNN ESTIMATE:
  neighbors = knn(query_input, outcome_log, k=k)  # embedding distance on input_hash
  local_quality = mean(n.judge_result for n in neighbors)
  # Provides input-local quality signal vs. marginal posterior above

STEP 5 — ATTESTATION BUNDLE:
  bundle = {
    identity_anchor:     DID + Ed25519-signed capability VC,   # arxiv 2511.02841
    merkle_commitment:   merkle_root + transparency_log_proof,
    conformal_cert:      certificate,        # formal coverage guarantee
    posterior_interval:  interval,           # Beta-Binomial, Merkle-verifiable
    local_knn_estimate:  local_quality,      # input-specific signal
    guardrail_sig:       TEE_sig (optional), # arxiv 2603.05786, higher trust tier
  }

VERIFICATION (third-party, no model access):
  1. Resolve DID, verify VC signature (Ed25519)
  2. Recompute Merkle root from provided leaf records, check against committed root
  3. Recompute conformal threshold q from calibration scores and check certificate
  4. Compute Beta(1+successes, 1+failures) from Merkle-verified log, check interval
  5. If TEE sig present: verify against hardware root of trust (Nitro Enclave cert)
  6. Accept bundle iff posterior interval lower bound >= quality_floor AND
     conformal coverage >= 1-alpha
```

**What is built vs. aspirational (mid-2026):**
- Conformal prediction for LLMs: BUILT (ConU, Enhanced CP, ICLR 2025 reasoning paper)
- Beta-Binomial posterior from outcome log: BUILT (trivial; challenge is stable judge)
- DID + VC identity/capability layer: BUILT (arxiv 2511.02841); quality schema: NOT YET
- TEE guardrail attestation: PROTOTYPE (Proof-of-Guardrail, AWS Nitro Enclaves)
- Packaged Merkle + Beta + CP skill-quality library: NOT YET (composite from parts)
- Thompson sampling for skill quality: REJECTED (category error, use for routing only)

## Key References

1. **ConU: Conformal Uncertainty in LLMs with Correctness Coverage Guarantees**
   Ren et al., 2024. arxiv:2407.00499.
   Self-consistency non-conformity score; tested on 7 LLMs x 4 datasets. Core
   conformal-prediction-for-LLM implementation with formal marginal coverage proof.

2. **Large Language Model Validity via Enhanced Conformal Prediction Methods**
   Quach et al., 2024. arxiv:2406.09714.
   Addresses conditional validity failures (guarantee varies by topic); adaptive
   conformal procedures tested on biography and medical QA.

3. **Proof-of-Guardrail in AI Agents and What (Not) to Trust from It**
   2025. arxiv:2603.05786.
   TEE-based cryptographic attestation prototype (AWS Nitro Enclaves). Verifies code
   hash + guardrail application; does not verify calibration of quality metric inside
   guardrail. Only built cross-operator quality attestation mechanism as of mid-2026.

4. **Quality Estimation with k-nearest Neighbors and Automatic Evaluation for
   Model-Specific Quality Estimation**
   Zerva et al., 2024. ACL 2024 / EAMT.
   Defines kNN-QE and establishes that training-data access is required for the
   model-specific variant — the key limitation distinguishing it from the
   attribution-kNN-over-outcome-log approach used here.
