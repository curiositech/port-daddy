# Embedding, Reranking, and Multimodal Retrieval Landscape (2026)

**Research date:** 2026-09-01; model-card and source reconciliation: 2026-09-02
**Decision served:** candidate discovery for `provider-neutral-retrieval-fabric`
**Original researcher:** `cli-93505`; publication steward actor `01M1HHCB63KA5BR59M53SSC873`
**Rule:** no candidate below is approved for production without Port Daddy golden-corpus,
privacy, latency, cost, and conformance evidence.

## Research question

Which current local/open-weight and remote embedding or reranking families are credible
candidates for Port Daddy's text, code, UI/multimodal, and reranking roles, and what can be
concluded from primary sources before running our own evaluation?

This is not a leaderboard recap or a model recommendation. It records candidates and the
tests needed to make an attributable promotion decision.

## Method

- Primary sources only for product/model capability claims: official model cards, vendor
  documentation, and research papers.
- Provider documentation was initially checked on 2026-09-01; the cited BGE, Qwen,
  Nomic, Jina, Voyage, and OpenAI model/capability pages were revisited on 2026-09-02.
  This was documentation-only: no model download, inference, or benchmark experiment.
  Provider aliases, limits,
  availability, pricing, and policies can change; execution profiles must pin a revision
  and refresh evidence.
- Vendor benchmark claims are labeled as claims, not independently reproduced results.
- External benchmarks choose candidates and shape slices. Port Daddy's versioned golden
  corpus is the promotion authority.
- No live customer, source, transcript, Porthole, or private repository data was sent to a
  model provider during this research.

## Existing foundation and baseline

### Xenova all-MiniLM-L6-v2

The installed stable runtime currently uses the Transformers.js ONNX packaging of
`sentence-transformers/all-MiniLM-L6-v2`. The official Xenova model card identifies it as
an ONNX conversion intended for Transformers.js. That makes it a valuable low-friction,
offline baseline, but the model card does not establish Port Daddy quality across code,
multilingual, long-document, or visual tasks.

Primary source: [Xenova/all-MiniLM-L6-v2 model card](https://huggingface.co/Xenova/all-MiniLM-L6-v2).

**Research disposition:** retain as the `local_fast` baseline and explicit degraded
fallback. Re-promote it only for named corpora where it meets the same thresholds as newer
candidates.

### BAAI bge-base-en-v1.5

[PR #9982](https://github.com/curiositech/port-daddy/pull/9982) is merged; its
[`config/models.yaml`](../../config/models.yaml) declares the BGE Base English v1.5
target alongside MiniLM. The generated rows remain `degraded-fallback` and
`declarative-only`, not runtime conformance or quality promotion. The official BAAI model
card describes a 768-dimensional, 512-token English model
and publishes self-reported MTEB results. That is enough to justify a text-retrieval
candidate, not enough to activate it without exact runtime conformance and Port Daddy
evaluation.

Primary source: [BAAI/bge-base-en-v1.5 model card](https://huggingface.co/BAAI/bge-base-en-v1.5).

**Research disposition:** first compatibility target for the identity kernel and one
bounded text-corpus benchmark. Do not generalize its English text evidence to code or UI.

## Current open-weight or locally deployable candidates

### Qwen3 Embedding and Reranker

Qwen publishes embedding and reranking families at 0.6B, 4B, and 8B sizes. Its model cards
and paper describe 32K context, more than 100 languages, task instructions, flexible
dimensions for embeddings, and evaluation on text and code retrieval. The reranker is a
separate cross-encoder-style ranking role rather than an embedding-space substitute.

Primary sources:

- [Qwen3-Embedding-0.6B model card](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B)
- [Qwen3-Reranker-8B model card](https://huggingface.co/Qwen/Qwen3-Reranker-8B)
- [Qwen3 Embedding paper](https://arxiv.org/abs/2506.05176)

**Candidate roles:** `text_dense`, `code_dense`, and `rerank`, each with independent profile
and evaluation. The 0.6B model is the first practical local candidate; larger sizes should
enter only if measured lift pays for their latency and memory.

**Required tests:** local Apple Silicon and CI-compatible runtime conformance, instruction
digest stability, 256/512/1024-dimensional space separation, multilingual slices, CoIR,
Port Daddy symbol/diff retrieval, reranker lift, memory use, and p95 latency.

### Nomic Embed Text v2 MoE

Nomic's official model card describes an open-weight multilingual mixture-of-experts model
with 475M total and 305M active parameters, 768-dimensional embeddings truncatable to 256,
a 512-token maximum, and required query/document prefixes. It publishes training code and
data references and self-reported BEIR/MIRACL comparisons.

Primary sources:

- [nomic-embed-text-v2-moe model card](https://huggingface.co/nomic-ai/nomic-embed-text-v2-moe)
- [Training Sparse Mixture of Experts Text Embedding Models](https://arxiv.org/abs/2502.07972)

**Candidate role:** multilingual `text_dense` for local-quality operation.

**Required tests:** runtime support for the custom architecture, prefix/preprocessing
identity, 768 and 256 as separate spaces, 512-token truncation behavior, multilingual
Port Daddy queries, batch throughput, and RAM/latency relative to Qwen and BGE.

### Jina Embeddings v4

Jina's official model card identifies `Qwen2.5-VL-3B-Instruct` as the base for multilingual
text, images, visually rich documents, and code-related tasks. It supports dense single vectors,
late-interaction multi-vectors, task-specific adapters, a 32K context window, and
Matryoshka dimensions from 128 through 2048. The published repository is large and requires
custom model code, so "open weights" does not mean "fits Port Daddy's default local path."

Primary sources:

- [jina-embeddings-v4 model card](https://huggingface.co/jinaai/jina-embeddings-v4)
- [Jina Embeddings v4 technical report](https://arxiv.org/abs/2506.18902)

**Candidate roles:** `ui_multimodal_dense`, visual-document retrieval, and an exploratory
`code_dense` profile. Dense and late-interaction outputs are different index contracts and
must never share a `spaceId`.

**Required tests:** sanitized screenshots and diagrams, text-to-image and image-to-image
queries, OCR-heavy controls, visual grounding, ViDoRe, code slices, adapter identity,
local hardware feasibility, index size, and privacy leakage. A smaller quantized build is a
new execution profile and may also be a new logical space depending on its exact output
recipe.

## Current managed-provider candidates

Remote candidates are eligible only for corpora whose policy permits provider egress,
retention terms, residency, data class, and cost. Model quality cannot override that gate.

### Voyage 4, Code 4, Multimodal 3.5, and Rerank 2.5

Voyage's current official documentation lists a 4-series text family with compatible
provider-declared output dimensions, `voyage-code-4` for code/coding-agent retrieval,
`voyage-multimodal-3.5` for interleaved text, image, document, and video inputs, and
`rerank-2.5`/`rerank-2.5-lite` for query-document reranking. The docs expose input types,
dimension/encoding controls, context and batch limits, and provider usage accounting.

Primary sources:

- [Voyage text embeddings](https://docs.voyageai.com/docs/embeddings)
- [Voyage multimodal embeddings](https://docs.voyageai.com/docs/multimodal-embeddings)
- [Voyage rerankers](https://docs.voyageai.com/docs/reranker)
- [Voyage pricing and usage units](https://docs.voyageai.com/docs/pricing)

**Candidate roles:** remote-quality `text_dense`, `code_dense`, `ui_multimodal_dense`, and
`rerank`.

**Required tests:** exact API revision and conformance vectors, each output dimension and
encoding as an exact profile, Port Daddy text/code/visual slices, reranker lift after hybrid
fusion, truncation behavior, p50/p95/p99 latency, request failures, data-policy review, and
actual per-index/per-query cost receipts. Provider-declared series compatibility is recorded
but does not replace Port Daddy's exact `spaceId` calculation.

**Documentation caveat:** the model-choice table lists `voyage-code-4`, while some parameter
and example lists on the same page still name `voyage-code-3`. The exact deployed API
revision and supported arguments therefore remain an integration verification requirement,
not something this research infers from the family name.

### OpenAI text-embedding-3-large

OpenAI's current official model page describes `text-embedding-3-large` as its most capable
embedding model for English and non-English tasks. OpenAI's release documentation describes
up to 3072 dimensions and supports shortening through the dimensions parameter. This is a
managed text candidate, not a code-, multimodal-, or reranking claim.

Primary sources:

- [OpenAI text-embedding-3-large model page](https://developers.openai.com/api/docs/models/text-embedding-3-large)
- [OpenAI embedding-model release](https://openai.com/index/new-embedding-models-and-api-updates/)
- [OpenAI embeddings FAQ](https://help.openai.com/en/articles/6824809-embeddings-faq)

**Candidate role:** remote-quality multilingual `text_dense`.

**Required tests:** every requested dimension as a separate exact profile, provider policy
and retention review, Port Daddy text and long-context slices, latency, availability,
batching, cost, and comparison with local candidates under identical hybrid retrieval.

## Evaluation sources and what they do not prove

### MTEB and MMTEB

[MTEB](https://arxiv.org/abs/2210.07316) standardized broad text-embedding evaluation;
[MMTEB](https://arxiv.org/abs/2502.13595) expanded the benchmark across languages and tasks,
including long-document and code retrieval. They are useful for candidate discovery and
regression context.

They do not test Port Daddy's corpus boundaries, exact source citations, current repository
symbols, deletion propagation, egress policy, local Apple Silicon performance, or provider
cost. An aggregate score can also hide a weak retrieval slice.

### CoIR for code

[CoIR](https://arxiv.org/abs/2407.02883) provides ten datasets spanning eight code-retrieval
tasks and seven domains with a BEIR/MTEB-compatible schema. It is a useful external code
gate.

It does not replace a Port Daddy corpus of stack traces, symbols, diffs, failing tests,
claims, ADR references, and natural-language implementation tasks. Code promotion requires
both.

### ViDoRe for visual documents

[ViDoRe V2](https://arxiv.org/abs/2505.17166) and
[ViDoRe V3](https://arxiv.org/abs/2601.08620) evaluate visually rich document retrieval,
multilingual queries, grounding, and harder cross-document tasks. They help evaluate a UI
or document-visual candidate.

They do not test Porthole consent, window identity, redaction, source lineage, UI-state
change, or cross-repo leakage. Those are mandatory Port Daddy slices.

### BRIGHT for reasoning-intensive retrieval

[BRIGHT](https://arxiv.org/abs/2407.12883) was created for realistic queries that require
reasoning beyond lexical overlap. It is useful as a stress slice for dense retrieval and
reranking.

It does not establish interactive latency, index economics, scope enforcement, or quality
on Port Daddy coordination artifacts.

### Reciprocal-rank fusion

The original [RRF paper](https://research.google/pubs/reciprocal-rank-fusion-outperforms-condorcet-and-individual-rank-learning-methods/)
showed a simple rank-based method for combining retrieval lists. Rank fusion avoids assuming
that BM25, dense similarity, lineage, or another retriever has a shared score calibration.

RRF is the initial baseline, not an exemption from evaluation. Port Daddy must measure
fusion against each component and preserve per-channel contributions in the query receipt.

## Port Daddy golden-corpus experiment

### Fixed inputs

- frozen source snapshot and source digests;
- frozen query/judgment set with a hidden test partition;
- exact corpus policy and allowed scopes;
- exact parser/chunker/preprocessing revision;
- identical lexical index and metadata/lineage rules;
- exact logical and execution profiles;
- pinned host/runtime or declared managed endpoint revision;
- cold and warm runs with repeated trials.

### Candidate matrix

| Role | Baseline | First candidate set | External context | Port Daddy decisive slices |
| --- | --- | --- | --- | --- |
| text | MiniLM | BGE Base, Qwen3 0.6B, Nomic v2, allowed managed text profiles | MTEB/MMTEB, BRIGHT | notes, roadmap, docs, citations, multilingual, hard negatives |
| code | MiniLM text path | Qwen3, allowed code-specific managed profile, Jina code adapter exploration | CoIR | symbols, errors, diffs, tests, ADR-to-code, repo isolation |
| UI/multimodal | OCR/text-only baseline | Jina v4, allowed managed multimodal profile | ViDoRe | sanitized Porthole derivatives, controls, state, OCR, privacy negatives |
| rerank | fused list without rerank | Qwen3 reranker, allowed managed reranker | MTEB reranking/BRIGHT context | end-to-end lift, citation accuracy, timeout/degraded behavior |

The table names candidates, not finalists. A first implementation may narrow the matrix for
cost, hardware, licensing, or integration reasons, but it must record the exclusion rather
than turn absence into a quality claim.

### Metrics and safety gates

- Recall@5/10/20, nDCG@5/10, MRR, and zero-result correctness;
- citation and lineage accuracy;
- privacy/cross-scope leakage (required zero);
- deleted/expired-source retrieval (required zero after policy deadline);
- reranker lift and regression by corpus slice;
- p50/p95/p99 end-to-end and per-stage latency;
- indexing throughput, index bytes, peak RAM, CPU/GPU time, and error rate;
- provider requests/tokens/pixels and actual billed or quoted usage cost;
- timeout, truncation, retry, partial-index, and degraded-mode rate.

Run paired comparisons on identical queries and report confidence intervals. Set promotion
thresholds before opening the hidden test partition. A candidate fails regardless of average
quality if it leaks scope, loses required citations, violates the corpus policy, or cannot
produce durable receipts.

## Research conclusions

1. There is no evidence for a single machine-wide model. Current primary sources expose
   materially different text, code, visual, local-footprint, and reranking tradeoffs.
2. MiniLM remains useful as a local-fast baseline, not as universal design authority.
3. PR #9982's immutable logical-space kernel is compatible with local and managed providers
   and should remain the foundation.
4. Qwen3 is a credible local text/code candidate; Nomic is a credible local multilingual
   text candidate; Jina is a credible heavier multimodal candidate. Managed Voyage and
   OpenAI profiles expand the comparison set where corpus policy allows egress. None is
   promoted by this research.
5. Embedding and reranking are separate roles. Their quality, latency, cost, and privacy
   evidence must be independently visible.
6. External benchmarks should seed, structure, and sanity-check evaluation. Only the
   versioned Port Daddy golden corpus can authorize a production policy.
7. Every candidate dimension, preprocessing/instruction recipe, adapter, precision, or
   quantization choice needs exact profile identity. "Same family" is provenance, not a
   license to mix coordinates.
