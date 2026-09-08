---
license: Apache-2.0
allowed-tools: Read,Write,Edit,Bash,Glob,Grep,WebSearch,WebFetch
name: transformers-js-onnx-pipelines
description: 'Use when integrating Hugging Face Transformers.js (`@huggingface/transformers`) for in-browser or in-Node inference, debugging model and dtype loading, building bi-encoder / cross-encoder / classification pipelines, configuring model cache directories, or bypassing high-level pipelines to read raw logits. Triggers: "model failed to load", cross-encoder scores all 1.0 (softmax-over-1 trap), env.allowLocalModels confusion, cacheDir overrides, ONNX runtime mismatch, ESM vs CJS pipeline imports, browser vs node feature gaps. NOT for full transformers Python (different SDK), TensorFlow.js, ONNX Runtime Web directly without Transformers.js, model training, or comparing embeddings whose space identities are missing or incompatible.'
metadata:
  category: AI & Machine Learning
  tags:
    - transformers-js
    - onnx
    - embeddings
    - cross-encoder
    - inference
    - huggingface
  provenance:
    kind: first-party
    owners: [port-daddy]
  pairs-with:
    - skill: llm-router
      reason: When a retrieval or classification cascade must decide between local ONNX inference and a hosted model call, llm-router owns that routing decision.
    - skill: cost-optimizer
      reason: Replacing hosted embedding/classification API calls with a local quantized model is a cost lever cost-optimizer tracks across a running budget.
  io-contract:
    kind: deliverable
    consumes:
      - kind: inference-requirement
        format: markdown
        description: A description of the inference need -- embeddings, reranking, classification -- with target environment (Node, browser, CI) and latency/size constraints.
      - kind: onnx-pipeline-plan
        format: json
        description: A structured plan naming the pipeline type, environment, caching and logits-access decisions, matching schemas/transformers-js-onnx-pipelines-plan.schema.json.
    produces:
      - kind: pipeline-implementation
        format: markdown
        description: The recommended pipeline wiring (bi-encoder, cross-encoder bypass, caching, corpus build) with the anti-patterns above ruled out.
      - kind: pipeline-audit-report
        format: json
        description: A deterministic pass/fail audit of the onnx-pipeline-plan against this skill's Quality Gates, as produced by scripts/transformers_js_onnx_pipelines_audit.mjs.
---

# Transformers.js ONNX Pipelines

Transformers.js runs Hugging Face models on ONNX Runtime in-browser or in-Node. The high-level `pipeline()` is convenient until it isn't — most non-trivial models need direct tokenizer + model use because the pipeline's task wrapping makes assumptions that don't hold (e.g., the cross-encoder softmax-over-1 trap).

## When to use

- Local embedding plumbing without an API. Current declarative profiles support
  diagnostics and quarantine only; search, RAG, and dedup wait for a separate
  verified producer-attestation path.
- Cross-encoder reranking for retrieval cascades.
- Browser-side inference (PII redaction, classification) without a server roundtrip.
- Evaluating whether a local model could replace remote embedding calls, without
  promoting declarative output into an index.
- Integrating with a Cloudflare Worker via Workers AI (different surface, but ONNX know-how transfers).

## Core capabilities

### Bi-encoder (sentence embeddings)

This integration skeleton is a Node service or corpus-build path. The application
receives one complete v2 profile from its canonical model registry. The service
does not construct, normalize, or hash that profile: `spaceId`,
`preprocessingDigest`, and every artifact digest are registry outputs and remain
opaque at this boundary. A declarative profile deliberately carries no
ResourceScope compatibility proof.

```ts
import os from 'node:os';
import path from 'node:path';
import { pipeline, env } from '@huggingface/transformers';
// Replace this illustrative import with the project's generated registry module.
import { embeddingProfileForModel } from './generated-model-registry.js';

env.allowLocalModels = false;
env.cacheDir = process.env.MODEL_CACHE
  ?? path.join(os.homedir(), '.cache', 'transformers-js');

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const embeddingProfile = embeddingProfileForModel(required('EMBEDDING_MODEL_ID'));
if (!embeddingProfile || embeddingProfile.version !== 2) {
  throw new Error('canonical embedding profile v2 is required');
}
if (
  embeddingProfile.quality !== 'degraded-fallback'
  || embeddingProfile.revisionBinding !== 'declared-upstream'
  || embeddingProfile.runtimeBinding !== 'declarative-only'
) {
  throw new Error('unexpected embedding profile binding; require an attestation-aware path');
}

// Model-loader weight dtype is a loader choice. It is deliberately not an
// alias for coordinatePrecision, coordinateQuantization, or storageQuantization.
const loaderDtype = 'fp32';
const loaderPooling = (() => {
  switch (embeddingProfile.pooling) {
    case 'mean-attention-mask-v1': return 'mean';
    case 'cls-last-hidden-state-v1': return 'cls';
    default: throw new Error(`unsupported pooling recipe: ${embeddingProfile.pooling}`);
  }
})();
const embed = await pipeline(embeddingProfile.task, embeddingProfile.modelId, {
  revision: embeddingProfile.modelRevision,
  dtype: loaderDtype,
});

const query = `${embeddingProfile.queryPrefix}the quick brown fox`;
const normalizedQuery = embeddingProfile.unicodeNormalization === 'nfc'
  ? query.normalize('NFC')
  : embeddingProfile.unicodeNormalization === 'nfkc'
    ? query.normalize('NFKC')
    : query;
const out = await embed(normalizedQuery, {
  pooling: loaderPooling,
  normalize: embeddingProfile.normalization === 'l2',
  truncation: true,
  max_length: embeddingProfile.maxTokens,
});
const vec = new Float32Array(out.data); // copy the tensor view
if (vec.length !== embeddingProfile.dimensions) {
  throw new Error(`embedding dimension mismatch for ${embeddingProfile.spaceId}`);
}
if (!vec.every(Number.isFinite)) {
  throw new Error('embedding output contains a non-finite coordinate');
}
// runtimeBinding=declarative-only authorizes no persistence or comparison.
// This diagnostic vector remains ephemeral-uncompared and is discarded.
vec.fill(0);
```

Choose the model by a representative retrieval eval, not familiarity or
download size alone. `Xenova/all-MiniLM-L6-v2` can still be a useful 384-dim
low-memory compatibility example, but the current registry correctly keeps it
`degraded-fallback` and `declarative-only`; it is not a universal default.
Prefer a materially stronger, independently evaluated model when the privacy
boundary, device capacity, latency, and cost allow it.

The profile contract is as important as the vector. A quarantine artifact must
carry the entire registry-produced record: serving and runtime identity; exact
model, model-config, tokenizer, and tokenizer-config artifacts plus revisions
and digests; task, prefixes, Unicode/truncation/token-limit recipe; pooling,
normalization, metric, dimensions; coordinate precision/quantization;
transport/storage representation; preprocessing digest; policy bindings; and
the opaque v2 `spaceId`. A config row cannot self-assert an approved state or
mint ResourceScope compatibility. Current profiles stay degraded/declarative;
their vectors must remain ephemeral-uncompared or explicitly
quarantined-uncompared. A separately verified producer-attestation path is
roadmap-only and is not defined by this skill.

`mean-attention-mask-v1` means attention-mask-aware mean pooling over the last
hidden state; `cls-last-hidden-state-v1` selects the CLS position from that
state. Map those recipes to the loader's `mean` and `cls` primitives only at
execution. Generic `mean` or `cls` profile values are rejected because they do
not identify the kernel version. In a future separately verified producer path,
`normalize: true` makes cosine equal dot product. This math helper is not
permission to compare declarative-only output:

```ts
function cosine(a: Float32Array, b: Float32Array) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}
```

### Cross-encoder reranking — bypass the pipeline

The MS MARCO MiniLM rerankers publish a single regression head (num_labels=1). Transformers.js's `text-classification` pipeline applies softmax to the logits. Softmax over a single value collapses to 1.0 — every score becomes 1.0.

Skip the pipeline. Tokenize and forward manually:

```ts
import { AutoTokenizer, AutoModelForSequenceClassification } from '@huggingface/transformers';

const modelId = 'Xenova/ms-marco-MiniLM-L-6-v2'; // constrained example
const modelRevision = process.env.RERANK_MODEL_REVISION; // immutable commit id
if (!modelRevision) throw new Error('RERANK_MODEL_REVISION is required');
const [tokenizer, model] = await Promise.all([
  AutoTokenizer.from_pretrained(modelId, { revision: modelRevision }),
  AutoModelForSequenceClassification.from_pretrained(modelId, {
    revision: modelRevision,
    dtype: 'q8',
  }),
]);

async function rerank(query: string, candidates: string[]) {
  const queries = new Array(candidates.length).fill(query);
  const inputs = tokenizer(queries, {
    text_pair: candidates,
    padding: true, truncation: true, max_length: 512,
  });
  const outputs = await model(inputs);
  const logits = outputs.logits;
  const dims = logits.dims;          // [batch, num_labels]
  const numLabels = dims[1] ?? 1;
  const data = logits.data;

  return candidates.map((text, i) => {
    const score = numLabels === 1
      ? data[i]
      : data[i * numLabels + 1];     // 2-class: positive logit
    return { text, score };
  }).sort((a, b) => b.score - a.score);
}
```

The raw logit isn't bounded — calibration is the user's problem. For relative ranking it's fine.

### Lazy loading + cache strategy

Model artifacts range from tens of megabytes to multiple gigabytes; download
and initialization are often the slow path. Cache aggressively:

```ts
let _embedderPromise: Promise<any> | null = null;
function getEmbedder() {
  if (!_embedderPromise) {
    _embedderPromise = pipeline(embeddingProfile.task, embeddingProfile.modelId, {
      revision: embeddingProfile.modelRevision,
      dtype: loaderDtype,
    });
  }
  return _embedderPromise;
}
```

Idempotent across concurrent calls — first call awaits the download, subsequent calls hit the in-memory model.

### Cache directory matters in CI

```ts
env.cacheDir = process.env.MODEL_CACHE
  ?? path.join(os.homedir(), '.cache', 'transformers-js');
```

In GitHub Actions, point this at a workspace-local path so `actions/cache` can persist it:

```yaml
env:
  MODEL_CACHE: ${{ github.workspace }}/.cache/transformers-js
- uses: actions/cache@v4
  with:
    path: ${{ env.MODEL_CACHE }}
    key: ${{ runner.os }}-tfjs-${{ hashFiles('embedding-profile.json') }}
```

Without this, every CI run re-downloads.

### Building a quarantined corpus fixture

A declarative-only profile cannot produce an ordinary search index. When exact
vector fixtures are needed for evaluation, persist them only in an explicit
quarantine that no search or ResourceScope path reads:

```ts
const embed = await pipeline(embeddingProfile.task, embeddingProfile.modelId, {
  revision: embeddingProfile.modelRevision,
  dtype: loaderDtype,
});
const items = loadCorpus();
const dim = embeddingProfile.dimensions;
const buf = new Float32Array(items.length * dim);
const vectorDisposition = 'quarantined-uncompared';
const similarityComparisonEnabled = false;

for (let i = 0; i < items.length; i++) {
  const text = `${embeddingProfile.documentPrefix}${items[i].text}`;
  const out = await embed(text, {
    pooling: loaderPooling,
    normalize: embeddingProfile.normalization === 'l2',
    truncation: true,
    max_length: embeddingProfile.maxTokens,
  });
  buf.set(out.data, i * dim);
}

if (
  embeddingProfile.storageEncoding !== 'json-number-array'
  || embeddingProfile.storageQuantization !== 'none'
) {
  throw new Error('this corpus codec only supports json-number-array with no storage quantization');
}
const vectorPath = 'data/embedding-quarantine/vectors.json';
fs.mkdirSync('data/embedding-quarantine', { recursive: true });
fs.writeFileSync(vectorPath, JSON.stringify(Array.from(buf)));
fs.writeFileSync('data/embedding-quarantine/metadata.json', JSON.stringify({
  embeddingProfile,
  vectorDisposition,
  similarityComparisonEnabled,
  vectorPath,
  count: items.length,
  ids: items.map((x) => x.id),
}, null, 2));
```

Inspect the quarantine only after checking its declared space, disposition, and
exact codec:

```ts
const meta = JSON.parse(
  fs.readFileSync('data/embedding-quarantine/metadata.json', 'utf-8'),
);
if (meta.embeddingProfile?.spaceId !== embeddingProfile.spaceId) {
  throw new Error('different declared embedding space; keep the artifacts isolated');
}
if (
  meta.vectorDisposition !== 'quarantined-uncompared'
  || meta.similarityComparisonEnabled !== false
) {
  throw new Error('artifact is not an uncompared quarantine');
}
if (
  meta.embeddingProfile.storageEncoding !== 'json-number-array'
  || meta.embeddingProfile.storageQuantization !== 'none'
) {
  throw new Error('unsupported persisted embedding representation');
}
const expectedVectorPath = 'data/embedding-quarantine/vectors.json';
if (meta.vectorPath !== expectedVectorPath) {
  throw new Error('unexpected persisted embedding path');
}
const encodedVectors = JSON.parse(fs.readFileSync(expectedVectorPath, 'utf-8'));
const expectedValues = meta.count * meta.embeddingProfile.dimensions;
if (
  !Array.isArray(encodedVectors)
  || encodedVectors.length !== expectedValues
  || !encodedVectors.every(Number.isFinite)
) {
  throw new Error('invalid persisted embedding payload');
}
const vectors = Float32Array.from(encodedVectors);
// Hand `vectors` only to exact-fixture inspection. Never index or compare them.
```

Storage depends on the declared codec. JSON number arrays are deliberately
readable but larger than float32-le; add and test a different explicit codec
before accepting a different `storageEncoding` or `storageQuantization`.
Quarantine is not an index, and the opaque `spaceId` does not promote it into
one. A future producer-attestation verifier must land outside this skill before
any comparison or ordinary persistence path can consume these vectors.

### Browser-side inference

```ts
import { pipeline, env } from '@huggingface/transformers';
env.allowRemoteModels = true;
env.remoteHost = 'https://your-cdn.example.com';   // optional

const classifier = await pipeline(
  'text-classification',
  'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
  { device: 'webgpu', dtype: 'auto' },             // if available
);
```

Be honest about the download cost — show a progress bar.

## Anti-patterns

### Cross-encoder via `text-classification` pipeline

**Symptom:** Every candidate scores 1.0; ranking is degenerate.
**Diagnosis:** Pipeline softmaxes a single-logit head; softmax-over-1 = 1.
**Fix:** Use `AutoTokenizer` + `AutoModelForSequenceClassification` directly. Read `outputs.logits.data` as raw scores.

### `env.allowLocalModels = true` in CI

**Symptom:** Model downloads succeed locally, fail in CI: "model not found".
**Diagnosis:** With `allowLocalModels = true` the SDK looks for files on disk first; in CI, no disk model = fail.
**Fix:** `env.allowLocalModels = false` (default). Combine with a CI cache for the download.

### Importing the pipeline at module load

**Symptom:** Server startup blocks for 5s on first deploy.
**Diagnosis:** Top-level `await pipeline(...)` runs at import time.
**Fix:** Lazy-load inside a function. Cache the Promise so concurrent first calls share one load.

### Forgetting `normalize: true` for cosine

**Symptom:** Scores look right but order is subtly off.
**Diagnosis:** Vectors aren't unit-normalized; raw dot products bias toward longer strings.
**Fix:** In a separately verified producer path, map the exact registry pooling
recipe to the loader primitive and set `normalize: true`. This does not
authorize comparison of declarative-only output.

### Float32Array reuse across calls

**Symptom:** Stored vectors mysteriously change; cache looks corrupted.
**Diagnosis:** Some pipeline implementations return a view into a reused tensor buffer; the next call overwrites.
**Fix:** Copy on capture: `new Float32Array(out.data)`.

### Reranker on too-long documents

**Symptom:** `RangeError: Tokenized inputs exceeded 512 tokens`.
**Diagnosis:** Cross-encoders truncate at 512 tokens jointly across (query, candidate). Long candidates lose context.
**Fix:** Truncate candidate text to ~400 tokens. Description + name only; skip body.

## Quality gates

- [ ] First-load Promise cached so concurrent calls don't double-download.
- [ ] `env.cacheDir` set to a CI-cacheable path.
- [ ] Any future separately attested cosine path uses normalized vectors;
      declarative-only vectors never reach similarity comparison.
- [ ] Cross-encoder scores read from `outputs.logits.data` directly, not via pipeline.
- [ ] Declarative-only embeddings are ephemeral-uncompared or stored solely in
      an explicit quarantined-uncompared artifact; ordinary indexing fails closed.
- [ ] A quarantine uses the exact codec named by `storageEncoding` and
      `storageQuantization`; unsupported codecs fail closed.
- [ ] Model selection uses a representative domain eval, but a plan flag never
      promotes registry quality. Promotion requires separate runtime attestation.
- [ ] Every quarantine persists the complete registry-produced v2 profile,
      including model/config/tokenizer/config artifacts and digests,
      preprocessing, coordinate/transport/storage representation, bindings,
      and opaque `spaceId`.
- [ ] Pooling uses the exact versioned registry recipe; generic `mean` or `cls`
      never appears as a profile or plan coordinate.
- [ ] The declared `spaceId` stays opaque and never mints ResourceScope
      compatibility or comparison authority.
- [ ] Model revisions are pinned in code; never "latest" or mutable `main`.
- [ ] Transformers.js v4 uses an explicit loader `dtype` (`q8`, `q4`, etc.);
      this stays separate from coordinate and storage quantization. Full
      precision requires measured justification. Do not use the removed
      `quantized: true` option from older package generations.
- [ ] Smoke test runs 3 known inputs, checks load/dimensions/finiteness, then
      discards or quarantines output without similarity comparison.

Primary API checks: Hugging Face documents the `@huggingface/transformers`
package plus `dtype` and `revision` pipeline options in the
[pipeline API](https://huggingface.co/docs/transformers.js/en/pipelines), and
documents the replacement of the legacy `quantized` boolean in the
[dtype guide](https://huggingface.co/docs/transformers.js/v3.8.1/en/guides/dtypes).

## Deterministic Audit

Before wiring (or reviewing) a Transformers.js integration, write the decisions as a JSON
plan matching `schemas/transformers-js-onnx-pipelines-plan.schema.json` and run the
deterministic auditor:

```bash
node scripts/transformers_js_onnx_pipelines_audit.mjs --input examples/sample-input.json
```

`auditTransformersJsOnnxPipelines(plan)` (in `scripts/transformers_js_onnx_pipelines_audit.mjs`)
turns this skill's anti-patterns and Quality Gates into machine-checkable rules over
structured fields: a cross-encoder routed through the `text-classification` pipeline
instead of raw logits (the softmax-over-1 trap), un-normalized bi-encoder vectors fed to
cosine, `allowLocalModels: true` in CI, a missing CI model cache, an uncached first-load
Promise, persisted vectors that were never copied out of the reused tensor buffer,
unpinned model versions, incomplete or inconsistent explicit quality metadata, legacy
fallback booleans, incomplete v2 or legacy profiles, loader/profile mismatches, and
reranker inputs past the 512-token joint limit. It also blocks ordinary persistence,
similarity comparison, and self-asserted producer proof for declarative-only vectors.
The auditor validates the
registry-provided profile but deliberately does not compute its digests or
`spaceId`, and it does not invent an attestation verifier. It returns
`{ pass, score, findings, recommendations }`. `examples/sample-input.json` is a correctly
configured bi-encoder plan (`pass: true`). Changes are tracked in `CHANGELOG.md`.

## NOT for

- **Python `transformers`** — different SDK; don't transfer assumptions.
- **TensorFlow.js** — different runtime, different model formats.
- **ONNX Runtime Web directly** without Transformers.js — lower-level; use only if you need custom ops.
- **Workers AI / Vertex AI** — managed inference; use the platform SDK.
- **Model training** — Transformers.js is inference-only.
