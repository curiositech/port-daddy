# Embedding Similarity Approaches for Runtime Task Overlap Detection

Overlap detection over partial agent outputs requires embeddings that are fast, semantically precise, and tolerant of incomplete sentence fragments. The three models worth knowing in depth:

**Sentence-BERT (SBERT)** — `all-MiniLM-L6-v2` (384-dim) and `all-mpnet-base-v2` (768-dim). MiniLM runs at ~14k sentences/sec on CPU with ~80ms per batch of 32; mpnet is ~3x slower but scores ~5 points higher on STS benchmarks. Both use mean pooling over last hidden state. For overlap detection, MiniLM is the default: latency wins at the detection loop frequency (50–200ms polling intervals). The `sentence-transformers` library gives you `.encode(texts, batch_size=32, normalize_embeddings=True)` — normalize in the library, not post-hoc, to avoid fp32 rounding drift.

**E5 (Microsoft)** — `intfloat/e5-small-v2` (384-dim) and `e5-large-v2` (1024-dim). E5 requires prompt prefixes: queries get `"query: "`, passages/documents get `"passage: "`. For symmetric tasks like agent-vs-agent output comparison, use `"query: "` on both sides. E5-small is faster than MiniLM-L6 on batches of 1–4 (common in streaming detection) because its architecture optimizes for shorter sequences. E5 was trained on MS-MARCO + multi-task NLI and tends to outperform SBERT on paraphrase detection at short lengths (< 50 tokens), which is exactly the streaming partial-output regime.

**Mixedbread AI MxBAI** — `mixedbread-ai/mxbai-embed-large-v1` (1024-dim). Tops MTEB as of late 2025. Uses `"Represent this sentence for searching relevant passages: "` prefix for asymmetric tasks; no prefix needed for symmetric comparison. At ~35ms/sentence on GPU and ~180ms on M-series CPU, it sits between E5-large and commercial APIs on latency. Best used when you can batch 4+ agent outputs together and tolerate ~200ms total; not suitable for per-token streaming detection.

## Cosine Similarity Thresholds

Cosine similarity in normalized embedding space is dot product. Empirical thresholds for task overlap (not semantic similarity in general):

- `> 0.92` — Near-duplicate: same task described differently, or one agent has already started the other's work. Trigger hard conflict.
- `0.82–0.92` — High overlap: agents are in the same problem subspace. Flag for human gate or priority arbitration.
- `0.70–0.82` — Topical proximity: related work but likely complementary. Log and monitor; don't block.
- `< 0.70` — Disjoint: no meaningful overlap for blocking purposes.

These cutoffs were calibrated against the STS-B benchmark (Pearson r = 0.87 on MiniLM) and hold reasonably well for technical task descriptions. Adjust upward (toward 0.95) for domains with high within-domain semantic density (e.g., all agents work on the same codebase, so most outputs are topically related by default).

## Handling Incomplete/Streaming Text

Partial outputs break sentence-boundary assumptions baked into SBERT's pooling. Three mitigations:

1. **Prefix buffering**: Buffer until you have a complete sentence (period/newline) or a token count threshold (32–48 tokens). Don't embed mid-sentence fragments — their embeddings are unstable because mean pooling over 3 tokens collapses to approximately the centroid of those tokens, which is noise.

2. **Sliding window with stride**: For longer streaming outputs, embed the last N complete tokens (N=64 works well) as a rolling window. Compare the rolling window embedding to the snapshot of other agents' last-known embedding. Update snapshots every 200ms or every 50 new tokens, whichever comes first.

3. **Incremental EMA smoothing**: Maintain an exponential moving average of embeddings as tokens arrive: `e_t = α * encode(new_chunk) + (1-α) * e_{t-1}`, α = 0.3. This gives a stable running estimate without waiting for sentence boundaries. EMA dampens the volatility of mid-sentence fragments without introducing the lag of waiting for completion.

## Latency Budget for Real-Time Detection

Target end-to-end detection latency: < 300ms for interactive agents, < 1000ms for batch agents.

- Encoding (MiniLM, CPU, batch=4): ~40ms
- Cosine similarity matrix (4 agents, 384-dim): < 1ms (pure numpy dot)
- Threshold check + notification: < 5ms
- Total: ~50ms per detection cycle, well within budget

For GPU-accelerated deployments, MiniLM encoding drops to ~8ms per batch; use a 100ms polling interval. For edge/serverless where cold-start matters, pre-warm the model and keep it resident — SBERT model load is 200–400ms (weights + tokenizer), which blows the budget if triggered on demand.

ONNX-exported MiniLM (`optimum` library) cuts CPU inference to ~18ms per batch of 4 with INT8 quantization and less than 1% quality loss on STS-B.

## Key Points

- Use MiniLM-L6 as default; switch to E5-small only when you have many short fragments (< 30 tokens) where E5's architecture advantage is measurable
- Apply the `"query: "` prefix symmetrically when using E5; skip prefixes for SBERT and MxBAI in agent-vs-agent comparison
- Never embed fewer than ~20 tokens — partial fragments produce unreliable embeddings; use prefix buffering or EMA smoothing for streaming
- Cosine threshold of 0.85 is a safe default starting point; tune upward in high-density domains where false positives are costly
- ONNX/INT8 quantization of MiniLM is the right path for latency-sensitive CPU deployments; GPU inference is fast enough that quantization is optional

## See Also

- `cosine-threshold-calibration.md` — Domain-specific threshold tuning methodology and calibration dataset construction
- `streaming-agent-output-chunking.md` — Token buffer management, sentence boundary detection, and EMA update schedules
- `overlap-detection-latency-profiling.md` — Benchmark results across model/hardware combinations with P50/P99 latency numbers
