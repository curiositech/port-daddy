# Candidate retrieval from current task records

## Representations and retrieval roles

Use a **bi-encoder** to retrieve a bounded candidate list from authorized, current records; it embeds query and records independently. A **pair reranker** consumes that bounded list and can compare both records jointly. Neither role establishes task identity. Derive immutable `spaceId` from exact model/config digests, preprocessing, pooling, dimensions, normalization, metric, coordinate precision and quantization. Record provider/runtime provenance separately; do not compare vectors across incompatible spaces.

Represent objective, deliverable, acceptance checks, scope facts, work version, dependencies, and authorized plan facts. `ownerId` is provenance or a review feature, never a task-identity rule.

## Hybrid candidate lists

Lexical and dense retrieval have different failure modes. Fuse **ranks**, not uncalibrated scores:

```text
rrf(candidate) = sum(1 / (k + rank_i(candidate)) for each available ranked list i)

eligible = active.filter(authorizes(query.scope, record.scope))
eligible = eligible.filter(record => record.workVersion.isCurrent)
eligible = eligible.filter(record => record.taskId != query.taskId)
compatible, omitted = partitionByExactSpace(eligible, query.spaceId)
recordUnknownCoverage(omitted)
ranked = RRF(lexical(query, compatible), dense(query, compatible))
```

Cormack, Clarke, and Buettcher introduced reciprocal-rank fusion for information-retrieval runs; its experiments and pilot constant do not calibrate this detector. Select depth, constant, and review budget on development data. If policy explicitly permits lexical-only retrieval after dense failure, label coverage `degraded-lexical-only`, emit a repair warning and retain the reason; otherwise return `unknown`. Handle retriever failure before attempting fusion; an empty valid ranking is different from an unavailable retriever.

Authorization filtering happens before retrieval. Remove superseded versions rather than smoothing them into a fresh snapshot. A different scope, missing version, or incompatible space is an unknown/omitted comparison, not a low score.

## Streaming records without invented checkpoint rules

Use buffered complete snapshots, full current records, or rolling windows under an explicit policy. Measure candidate recall, staleness, encoding cost, and latency. A window may discard acceptance facts; a buffered snapshot may be stale. Smoothing can stabilize repeated representations within one compatible version, but cannot bridge changed scope, version, or embedding space.

**Sources read.** Cormack, Clarke, and Buettcher, [Reciprocal Rank Fusion](https://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf), pp. 1–2 (accessed 2026-09-24): rank fusion and IR-only evaluation. This task-record use is proposed, not measured.
