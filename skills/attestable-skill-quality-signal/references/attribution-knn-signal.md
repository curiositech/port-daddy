# Attribution-kNN Signal: How WinDAGs Scores Skills from Past Observations

The attribution-kNN store is the live feedback loop that converts historical execution outcomes into a context-sensitive quality signal for skill selection. It is not a bandit algorithm, not a global average, and not a classification system — it is a retrieval-scored quality estimator operating on a SQLite log of past observations keyed by task embedding.

## The Store Structure

The store lives at `~/.windags/skill-state.db` (SQLite, WAL mode). The central table is `observations` in `packages/core/src/retrieval/attribution-db.ts`. Every completed node execution writes one row containing: `skill_id`, `task_description`, `task_embedding` (Float32 blob, serialized via `embeddingToBlob`), and five quality dimensions evaluated at execution time — `accuracy`, `completeness`, `relevance`, `structure`, `usability` (all REAL, [0,1]). The `eval_passed` and `envelope_score` columns record the binary gate and aggregate envelope. Subsidiary tables (`tool_call_signals`, `output_similarity_signals`, `self_reported_signals`) hang off `observation_id` via foreign keys and hold the sub-signals that feed into those quality scores.

The embedding stored per observation is the task embedding at invocation time — produced by `text-embedding-3-small` (1536 dimensions) via `EmbeddingService` — not a skill description embedding. This is the key design choice: neighbors are found by task similarity, not by skill name similarity.

## Attribution Computation (scoreSkill)

`AttributionDB.scoreSkill(skillId, taskEmbedding, options?)` at line 373 in `attribution-db.ts`:

1. Pull all `observations` rows for `skillId` where `task_embedding IS NOT NULL`.
2. Deserialize each stored blob back to `Float32Array` and compute cosine similarity to the current `taskEmbedding` using the inline `cosine()` function (dot product normalized by L2 norms).
3. Filter to `similarity >= minSimilarity` (default 0.3) and take the top `maxNeighbors` (default 10).
4. Compute similarity-weighted averages across the five quality dimensions: `predicted.accuracy = sum(n.accuracy * n.similarity) / sum(n.similarity)` — each neighbor votes in proportion to its distance-similarity to the current task.
5. `confidence = min(1.0, (neighborsUsed / maxK) * 0.6 + avgSimilarity * 0.4)` — two-component: how full the neighbor set is (volume) and how close those neighbors are (quality). Max is 1.0, but the formula saturates below that in sparse regimes.
6. Returns `KNNScoreResult` — not a scalar. Contains `predicted` (the five-dimensional quality vector), `confidence`, `neighborsUsed`, `avgSimilarity`, and averages for the three sub-signals.

## How skill-matcher.ts Uses the Signal

`applyAttributionScoring` at line 573 in `skill-matcher.ts` blends kNN-predicted quality into retrieval scores. The precondition is `scoredCandidates.length >= 2 && taskEmbedding !== null` — with fewer candidates or no embedding, it passes through unchanged.

For each candidate, `attributionDB.scoreSkill(candidate.skill.id, taskEmbedding)` is called. If `knnResult.neighborsUsed < 2`, the kNN data is treated as insufficient and the retrieval score is used unmodified. Otherwise:

- `knnOverall = mean(predicted.accuracy, .completeness, .relevance, .structure, .usability)` — collapses the five-dimensional vector to a scalar for blending
- `blendWeight = min(0.5, knnResult.confidence * 0.6)` — caps at 0.5 so kNN never dominates more than half the score
- `blendedScore = retrievalScore * (1 - blendWeight) + knnOverall * blendWeight`

The breakdown string appended to each candidate (`knn: 0.823 (7 neighbors, conf=0.71)`) is the audit trail for why a particular skill won or lost a comparison.

## What the Signal Tells You

The kNN signal tells you: **given tasks that looked like this one (by embedding proximity), how did this skill actually perform on them?** It is input-local quality, not marginal quality. A skill with 500 observations but all on tasks structurally unlike the current query will have `neighborsUsed = 0` and no kNN weight — the retrieval score decides. A skill with 8 observations all tightly clustered around the current task type will have `confidence ≈ 0.78` and meaningful blend weight.

The signal captures context-dependency that a global Beta-posterior cannot: a skill might have 0.9 mean accuracy on code tasks and 0.4 on prose tasks. Those two modes blend into a misleading 0.65 global average. The kNN score for the code task will recover the 0.9 because neighbors are filtered by task similarity.

The signal is deliberately not a binary accept/reject gate. It is an additive adjustment to retrieval rank, capped so retrieval still dominates when history is sparse. The gate semantics (conformal certificate, Merkle-verified posterior interval) are in the attestation bundle described in SKILL.md — those are for third-party verification, not for real-time routing.

## Key Points
- The embedding stored per observation is the **task embedding at invocation time** (1536-dim Float32), not a skill description embedding; neighbors are found by task similarity, enabling input-local quality estimation
- `scoreSkill` returns a **five-dimensional quality vector**, not a scalar; `applyAttributionScoring` in `skill-matcher.ts:573` collapses it to a scalar only for blending, and the blend weight is capped at 0.5 to prevent kNN from overriding retrieval on thin data
- Confidence formula is `min(1.0, (neighborsUsed/maxK)*0.6 + avgSimilarity*0.4)` — a two-component signal covering both neighbor volume and neighbor proximity; two or fewer neighbors triggers a pass-through with no blending
- The circuit breaker at `skill-matcher.ts:582-589` catches `better-sqlite3` unavailability and returns retrieval-only order silently; the system never crashes due to a missing attribution DB
- The kNN score is **not** Thompson sampling or UCB — it does not draw from a posterior for exploration; it produces a point estimate (similarity-weighted mean) used as a quality predictor, not an arm selector

## See Also
- `attribution-db.ts` `KNNScoreResult` type (line 59): full return structure from `scoreSkill`, including all three sub-signal averages that are available but not currently used in the blend
- SKILL.md "Attribution-kNN (task→skills→accept/reject store)" section: the theoretical framing and distinction from the conformal certificate (formal coverage guarantee) and Beta-Binomial posterior (Merkle-verifiable marginal estimate)
- `attribution-signals.ts`: the `SkillAttributionSignals` type defining the five signals that populate each observation row at recording time
