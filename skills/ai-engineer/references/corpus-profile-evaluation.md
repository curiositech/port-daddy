# Corpus-profile retrieval evaluation

Define an immutable `spaceId` from the embedding model and configuration,
preprocessing, pooling, dimensions, normalization, metric, coordinate precision,
and quantization. Do not compare vectors across spaceIds. Apply repository,
tenant, disclosure, retention, and redaction filters before lexical or dense ranking.

Evaluate lexical, dense, hybrid, and bounded-rerank variants on a versioned corpus
and held-out task set. Record retrieval coverage, answer support, latency, token and
provider cost, failures, and model/harness versions. Calibrate thresholds and top-k
on a development split; freeze them before the holdout. An illustrative plan may
show a number, but must label it hypothetical until this receipt exists.

The emphasis on cost-quality tradeoffs, adequate holdouts, and reproducibility follows
[AI Agents That Matter, 2024](https://arxiv.org/abs/2407.01502).
