# Provider-Neutral Retrieval Fabric

**Status:** Accepted direction; architecture and research only, not runtime proof.
**Roadmap:** `provider-neutral-retrieval-fabric` (`1f8336b1-9212-4979-9734-7a6edfbab299`)
**Responsible agent:** `cli-93505`, session `session-implement-canonical-embedding-profile-registry-a-b336157cc04f`
**Published:** 2026-09-01

Port Daddy needs retrieval that can improve without changing the meaning of existing
vectors, sending protected corpora to an unapproved provider, or treating a public
leaderboard as product evidence. This proposal defines that control plane.

The core decision is simple: preserve the immutable vector-space identity and execution
provenance kernel audited in [PR #9982](https://github.com/curiositech/port-daddy/pull/9982),
then compose selection, evaluation, indexing, retrieval, privacy, and migration around it
as separate contracts. A model registry is necessary. It is not, by itself, a retrieval
architecture.

This document supersedes the machine-wide "one embedding model for everything" rule. The
installed MiniLM path remains truthful transitional runtime behavior until the slices
below ship and are proven by source, compiled artifacts, live runtime read-back, and
retrieval receipts.

---

## Decision summary

1. Keep one provider-neutral, versioned profile registry. The registry describes immutable
   logical spaces, executable implementations, retrieval roles, and conformance evidence.
2. Select profiles through a versioned corpus policy. Privacy, egress authority, quality,
   latency, and cost decide whether a local or remote tier may run.
3. Separate text, code, UI/multimodal, and reranking roles. No profile earns a role from
   marketing claims or from doing well on a different role.
4. Retrieve with hard scope filters followed by lexical and dense candidates, metadata and
   lineage-aware fusion, then an optional bounded reranker.
5. Promote profiles only through Port Daddy's versioned golden corpus. External benchmarks
   identify candidates; they do not authorize production.
6. Emit production, query, benchmark, and migration receipts with exact profile, scope,
   provider, revision, latency, cost, and quality evidence.
7. Migrate with separate old and new indexes. Dual-write and shadow-read are allowed;
   comparing or pooling vectors from different spaces is not.
8. Treat Porthole and the Universal Cooperative Stage as evidence producers, not retrieval
   authority. Only provenance-bound sanitized derivatives may be indexed.
9. Treat the Harbor Agent Runtime as a consumer of retrieval capabilities, not the owner of
   memory identity or corpus policy.

## Foundation verdict: preserve PR #9982

The exact-head audit of PR #9982 used commit
`9f3844ad88583b722fa28dddf5e9a2aedcf4ac7a`. Its generated registry check, 293 focused
tests, TypeScript typecheck, skill audit, and diff check passed. Conventional GitHub CI was
green at audit time. Port Daddy Fleet was terminal `NEUTRAL` because the Purser sandbox
setup failed in infrastructure, so this proposal does not call the PR merged or shipped.

The audited kernel gets the following boundaries right and must survive later work:

- Logical space identity is a fixed-order, length-framed, domain-separated digest over the
  exact model and model-config digests, preprocessing digest, dimensions, normalization,
  pooling recipe, metric, coordinate precision, and quantization.
- Provider, alias, runtime binding, upstream names, artifact paths, and lossless transport
  encodings are execution provenance. They do not change mathematical space identity.
- A forced `degraded-fallback` quality label is honest about today's MiniLM path.
- A declarative runtime binding does not claim producer conformance.
- Resource-scope authority is withheld until a signed producer-conformance contract exists.

Those are not incidental implementation details. They are invariants for every role and
tier described below. Extensions must compose with the kernel rather than weaken or
reinterpret it.

## Terms and control-plane objects

### Logical space profile

A logical space profile answers: "Which coordinates are mathematically comparable?" It is
immutable after publication. Its canonical identity includes at least:

```text
model artifact digest
model configuration digest
tokenizer and preprocessing digest
query/document instruction or adapter digest
pooling and postprocessing recipe
output dimensions
normalization
distance metric
coordinate precision
quantization recipe
```

Any change to one of those fields creates a new `spaceId`. Provider claims that two model
aliases or dimensions are compatible do not waive the exact profile match. Compatibility
can be recorded as provenance or evaluated as a migration candidate, never assumed at
query time.

### Execution profile

An execution profile answers: "Which implementation produced these coordinates?" It binds
a logical space to a provider and runtime revision without altering the logical `spaceId`.
It includes:

- `executionProfileId` and immutable revision;
- provider class (`local`, `self_hosted`, or `remote`) and provider/model identifiers;
- artifact or endpoint revision, tokenizer/runtime versions, device and precision;
- supported batch/input limits and declared task roles;
- actual model and configuration digests where inspectable;
- a signed conformance receipt proving deterministic agreement with the logical profile;
- data-use, residency, retention, and egress policy references for remote execution;
- current health and measured latency/cost envelopes.

An execution profile without conformance evidence remains `declarative-only`. It cannot
produce authoritative vectors for an index that claims the corresponding logical space.

### Retrieval role

The registry recognizes separate roles:

| Role | Inputs | Output | Required evidence |
| --- | --- | --- | --- |
| `text_dense` | notes, docs, messages, roadmap prose | dense vector | domain-sliced text retrieval corpus |
| `code_dense` | symbols, code, diffs, issue-to-code queries | dense vector | repository and language-sliced code corpus |
| `ui_multimodal_dense` | sanitized screenshots, regions, OCR text, UI queries | dense or versioned late-interaction representation | visual grounding and leakage corpus |
| `rerank` | query plus bounded authorized candidates | ordered candidates and scores | end-to-end lift, latency, and privacy corpus |

Lexical BM25, metadata filters, and lineage rules are retrieval components but not embedding
roles. A model may implement several roles only when each role has its own profile binding
and promotion receipt. A reranker never supplies vectors to an embedding index.

### Quality tier

Tiers describe an operational promise, not a provider brand:

| Tier | Typical execution | Intended use | Non-negotiable condition |
| --- | --- | --- | --- |
| `local_fast` | small cached local model | offline or tight interactive latency | visibly degraded unless it passes the corpus target |
| `local_quality` | larger local/self-hosted model | protected corpora and batch indexing | host capacity plus measured quality/latency |
| `remote_quality` | approved managed endpoint | eligible corpora needing higher quality or modalities | explicit egress grant, provider policy, cost cap, and receipt |

The names deliberately avoid "best" and "premium." A `local_fast` candidate can win a
corpus if it meets the target. A remote candidate can lose promotion on privacy, cost,
latency, or empirical quality.

### Corpus policy

A versioned corpus policy binds a corpus to authorized retrieval behavior:

```yaml
corpusId: port-daddy:roadmap
harborId: port-daddy
repoId: curiositech/port-daddy
classification: internal
allowedRoles: [text_dense, rerank]
allowedTiers: [local_fast, local_quality]
remoteEgress: deny
redactionPolicyId: pd.redaction.internal.v1
retentionPolicyId: pd.retention.roadmap.v1
latencyBudgetMs: { p50: 80, p95: 250 }
costCap: { currency: USD, perThousandQueries: 0 }
promotionPolicyId: pd.retrieval-promotion.roadmap.v1
```

This is illustrative, not a shipped schema. The stored policy must be immutable by revision,
attributable, and referenced by every indexing and query receipt. The selected profile is a
policy output, not a global environment variable.

## Privacy and corpus firewalls

Authorization happens before ranking. Port Daddy must not retrieve a broad candidate set
and remove unauthorized rows afterward; that leaks counts, timing, rank positions, and
possibly reranker egress.

Every index partition and row carries:

- account/team scope;
- `harborId`, `repoId`, `corpusId`, and source authority;
- classification and disclosure-policy revision;
- redaction/sanitization receipt id;
- source digest, derivative digest, and lineage head;
- retention and deletion policy revision;
- logical `spaceId`, role, and production receipt id.

The query envelope carries the same scope plus the requesting principal and attributable
authorization receipt. A mismatch is a hard rejection. Cross-repo, cross-harbor, or
cross-account retrieval is default-deny and needs an explicit bounded grant that names all
participating corpora.

Remote execution has an additional firewall:

1. classify the source and query;
2. apply the versioned redaction policy locally;
3. verify the corpus policy permits this provider, role, and data class;
4. emit an egress intent with input digests and bounded size, never raw logging;
5. invoke the endpoint;
6. record the provider request/usage receipt and sanitized response metadata;
7. reject persistence if conformance, scope, or receipt checks fail.

Secrets, credentials, private keys, raw provider transcripts, and raw Porthole evidence are
never embedding inputs. Retrieval storage must honor deletion and retention events even
when an older physical index remains during a migration.

## Universal Cooperative Stage and Porthole boundary

[PR #9970](https://github.com/curiositech/port-daddy/pull/9970) is the adjacent Universal
Cooperative Stage/Porthole evidence slice. It remains draft and was conflicting at this
proposal's audit point, so this document uses a narrow integration contract rather than
claiming its implementation is stable.

The Stage owns capture consent, source identity, local encryption, evidence lineage,
redaction, and disclosure. The retrieval fabric owns validation of index eligibility,
profile selection, production receipts, index isolation, ranking, and retrieval receipts.

The only admissible Stage input is a sanitized derivative envelope containing:

- opaque source-evidence id and digest;
- derivative digest and media/text kind;
- capture source and consent/disclosure-policy revision;
- redaction transform id and receipt;
- authorized account/team, harbor, repo, and corpus scopes;
- retention/deletion policy;
- explicit eligible retrieval roles.

Raw encrypted frames, recordings, transcripts, and keys stay under the Stage's local
authority. Retrieval never receives a decryption capability. A future multimodal profile
may index a sanitized screenshot derivative, but it cannot make the source frame broadly
discoverable or reconstruct a less-redacted artifact.

## Harbor Agent Runtime boundary

[PR #9991](https://github.com/curiositech/port-daddy/pull/9991) proposes a provider-neutral
durable Harbor Agent Runtime. The two designs meet at a capability boundary:

- the runtime requests retrieval with principal, scope, purpose, query, role, and budgets;
- the retrieval fabric resolves policy and executes authorized retrievers;
- the runtime receives cited results plus a retrieval receipt;
- the runtime provider or harness does not choose the index's logical space;
- changing the agent body, backend, or execution host does not change memory identity;
- durable agent identity can be a policy input, but it is not authorization by itself.

The retrieval fabric does not become an agent scheduler, session store, or conversation
authority. The Harbor Agent Runtime does not become a vector database or model registry.

## Index and lineage envelope

Each physical row needs enough information to prove how it was derived:

```text
indexId / indexGeneration
spaceId / executionProfileId / retrievalRole
corpusId / harborId / repoId / accountTeamScope
sourceId / sourceVersion / sourceDigest
chunkerId / chunkerRevision / chunkOrdinal / characterOrRegionBounds
derivativeDigest / redactionReceiptId / lineageHead
productionReceiptId / createdAt / retentionPolicyId
vector or late-interaction payload
```

The source digest, chunker revision, preprocessing recipe, and `spaceId` make idempotent
re-indexing possible. Lineage makes citations and deletion propagation possible. Metadata
is not optional decoration: rows without required scope or lineage fields are quarantined,
not searched.

## Retrieval pipeline

The default pipeline is intentionally explicit:

```text
authorized query envelope
  -> corpus/repo/harbor/account filters
  -> query normalization and injection/secret screening
  -> lexical retrieval (BM25)
  -> dense retrieval in exactly one compatible space per role
  -> metadata and lineage constraints
  -> reciprocal-rank fusion over document/chunk identities
  -> optional bounded reranker over already-authorized candidates
  -> citation and lineage assembly
  -> retrieval receipt
```

RRF is the initial fusion default because it combines rankings without pretending lexical,
dense, and lineage scores share calibration. It is a baseline, not permanent doctrine. A
learned fusion method may replace it only after the golden corpus shows repeatable lift and
the new ranker receives its own versioned profile and promotion receipt.

Metadata participates in two different ways and must not blur them:

- authorization, retention, and disclosure fields are hard filters;
- recency, source authority, exact symbol/file match, and lineage distance may be bounded
  ranking features after authorization.

Deduplicate on canonical source/chunk identity after each retriever and again after fusion.
Return the ranking contribution of each channel in the receipt so an operator can explain
why a result appeared.

## Golden corpus and promotion gate

External benchmarks are candidate discovery. Port Daddy's golden corpus is promotion
authority.

The corpus is versioned, reviewable, and split by job:

- coordination notes, decisions, commitments, and roadmap prose;
- architecture/docs and exact citation lookup;
- natural-language-to-code, symbol, diff, test, and error retrieval;
- UI screenshots, controls, OCR, state changes, and visual evidence;
- multilingual and long-context cases where Port Daddy actually has demand;
- hard negatives with overlapping vocabulary but wrong source, repo, or time;
- privacy negatives that must return zero results;
- deletion, retention, stale-lineage, and cross-harbor isolation cases;
- degraded/offline and partial-index behavior.

Each item records query, allowed scope, relevance judgments, hard negatives, source lineage,
required citations, and whether zero results is correct. Human review owns the test set;
generated queries may expand training or development sets but do not silently rewrite the
promotion set.

Required metrics include:

- Recall@5/10/20, nDCG@5/10, MRR, and zero-result correctness;
- reranker precision/lift over the fused candidate set;
- citation/source/lineage correctness;
- cross-scope and redaction leakage rate (must be zero);
- deletion and retention propagation correctness;
- indexing throughput plus query p50/p95/p99 latency;
- local CPU/GPU/RAM/energy envelope where measurable;
- provider tokens/pixels/requests and actual cost per indexed unit and query;
- availability, timeout, retry, truncation, and degraded-mode rates.

Promotion compares a candidate against the current profile on the same frozen corpus,
hardware/runtime class, index configuration, and query set. Report paired deltas and
confidence intervals, not only averages. A promotion policy sets per-slice floors and
allowed regressions; an overall average cannot hide a privacy leak or collapse on code or
visual retrieval.

## Receipts

### Embedding production receipt

One batch receipt binds inputs to outputs:

- corpus policy revision and authorized principal;
- source/derivative digests and item counts;
- logical `spaceId`, execution profile, model/runtime/artifact revisions;
- chunker/preprocessing revisions and output dimensions/encoding;
- provider request identifiers, usage, measured latency, retries, and cost;
- redaction and egress receipts;
- output/index generation digests and conformance verdict.

### Retrieval query receipt

A query receipt records:

- query digest, principal, purpose, scope, and policy revision;
- selected role/tier/profile and why policy selected it;
- lexical, dense, metadata/lineage, and reranker candidate counts;
- truncation, timeout, degraded-mode, and fallback events;
- per-stage and end-to-end latency, provider usage, and cost;
- returned source/chunk/lineage ids and rank-channel contributions;
- golden-corpus promotion receipt for every active model/ranker.

Raw protected query text does not need to enter the receipt. The query digest and separately
governed transcript/evidence path provide attribution without creating a second plaintext
archive.

### Benchmark promotion receipt

The promotion receipt binds candidate and baseline profiles to:

- golden corpus and judgment-set digests;
- harness, code, dependency, hardware, and index-configuration revisions;
- slice metrics, paired deltas, confidence intervals, failures, and exclusions;
- privacy/security verdict;
- latency, resource, and cost envelopes;
- reviewer identity, policy thresholds, decision, and activation policy revision.

### Index migration receipt

The migration receipt records source and destination `spaceId`s, corpus policy, source
generation, expected/processed/skipped/error counts, dual-write interval, shadow-query
comparison, cutover pointer, rollback pointer, retention deadline, and final deletion or
archive proof.

## Dual-index migration without vector-space mixing

A new `spaceId` always gets a new physical or logically isolated index generation. The
migration state machine is:

1. **Provision:** create the destination generation with its exact profile and corpus
   policy; reject writes carrying any other `spaceId`.
2. **Backfill:** re-derive embeddings from authorized source text or sanitized derivatives.
   Never synthesize a new-space vector from an old-space vector.
3. **Dual-write:** new/changed sources write independently to old and new generations,
   with separate production receipts.
4. **Shadow-read:** run the same authorized queries against each generation, compare ranked
   identities and golden-corpus metrics, but never concatenate their vectors or nearest-
   neighbor scores.
5. **Cutover:** atomically change the versioned corpus-policy pointer after a promotion
   receipt passes. New queries use one generation.
6. **Bake and rollback:** retain the old generation read-only for a bounded interval.
   Rollback changes the pointer; it does not translate vectors.
7. **Retire:** prove retention/deletion requirements, remove the old generation, and close
   the migration receipt.

If a source derivative is no longer available or authorized, mark the row un-migratable.
Do not preserve it by copying opaque coordinates. A learned projection between spaces would
itself be a new immutable model/profile and is out of scope for the first implementation.

## Failure and degraded behavior

- Missing local model: return an explicit degraded lexical result only where policy allows;
  point the agent surface at `pd doctor` and keep the receipt degraded.
- Remote provider unavailable: use an approved alternate execution profile for the same
  logical space only when conformance is proven, or use a separately promoted lower tier
  and label the space/result change. Never relabel fallback coordinates as the requested
  space.
- Partial index: return generation coverage and stale/backfill counts with every result;
  do not present partial recall as healthy.
- Policy or scope mismatch: fail closed before provider invocation or candidate retrieval.
- Receipt persistence failure: the operation is not authoritative. Do not publish vectors,
  activate a policy, or return an apparently durable success.
- Reranker timeout: return the fused pre-rerank list only if the policy allows it, with a
  degraded receipt and unchanged authorization filter.
- Vector dimension/space mismatch: quarantine the row or query and emit a typed finding.

## Operator surface

FleetBar and the dashboard should expose corpus-centric control, not a raw provider form:

- active role/profile/tier and logical `spaceId` per corpus;
- privacy classification, remote-egress state, provider allowlist, and cost cap;
- index generation, coverage, freshness, migration phase, and rollback window;
- golden-corpus promotion and last benchmark deltas;
- p50/p95 latency, provider/local resource use, cost, and degraded-rate receipts;
- quarantined rows, privacy failures, deletions pending, and conformance failures;
- explicit actions to benchmark, approve policy, cut over, roll back, or repair.

Attention and status are not authorization. Remote egress, policy activation, cutover, and
retention exceptions require attributable authority and an explicit recent approval where
their policy demands it.

## Implementation sequence

Each slice is independently reviewable and produces source, tests, receipts, and operator
truth. None should be folded into this design-only PR.

1. **Land the identity kernel.** Resolve PR #9982's Fleet infrastructure gate and land the
   exact audited invariants without broadening its claims.
2. **Extend registry contracts.** Add retrieval roles, execution profiles, corpus policies,
   conformance receipts, and generated parity across daemon and Workers.
3. **Build the golden corpus harness.** Version judgments, privacy negatives, repeatable
   index fixtures, metrics, comparison reports, and promotion receipts.
4. **Pilot text retrieval.** Migrate one bounded corpus from MiniLM using separate indexes,
   BM25+dense RRF, citations, receipts, and rollback.
5. **Pilot code retrieval.** Add language/repo slices, symbol/lineage features, and code-
   specific candidates only after CoIR plus Port Daddy corpus evaluation.
6. **Add reranking.** Benchmark local and approved remote candidates over already-authorized
   fused results; promote independently of embeddings.
7. **Integrate Stage derivatives.** Index one sanitized UI-evidence corpus with consent,
   redaction, lineage, deletion, and leakage tests before adding multimodal candidates.
8. **Add remote tiers.** Implement egress policy, provider adapters, request/cost receipts,
   residency/retention metadata, and fail-closed data-class enforcement.
9. **Ship operator controls.** Make policy, evidence, migration, rollback, cost, latency,
   quality, and privacy failures inspectable in FleetBar/dashboard.

## Rejected alternatives

- **Keep MiniLM as the universal model:** low operational cost is useful, but it does not
  establish quality for code, multilingual, long-context, or visual retrieval.
- **Pick one newer universal model immediately:** current primary sources identify credible
  candidates, not Port Daddy corpus winners. It also repeats the global-model coupling.
- **Let each feature choose an arbitrary model:** this creates undeclared spaces, duplicate
  caches, inconsistent privacy behavior, and migrations with no authority.
- **Make provider/model alias the vector-space id:** aliases and endpoints drift; they omit
  preprocessing, dimensions, normalization, precision, and artifact identity.
- **Use vector-only search:** exact identifiers, rare terms, symbols, errors, and citations
  need lexical retrieval; security and lineage need metadata.
- **Search globally, then remove unauthorized results:** post-filtering leaks and can send
  protected candidates to a reranker.
- **Re-embed in place:** readers can observe mixed coordinate systems and corrupt rankings.
- **Copy or project old vectors into the new index:** opaque coordinates are not source
  evidence; any learned projection is another model that needs its own profile and corpus.
- **Promote from MTEB or a vendor table alone:** those results do not cover Port Daddy's
  corpora, privacy boundaries, latency, cost, or failure behavior.

## Coordination and publication receipts

- The roadmap item was upserted and read back through the live daemon under harbor
  `port-daddy`; no retired roadmap snapshot was edited.
- The PR #9991 boundary was sent durably to `cli-87957`: agent runtime consumes retrieval
  receipts but does not own vector identity or corpus authority.
- The PR #9970 boundary was sent durably to `agent-porthole-contract-9970-20260831` and
  `cli-46597`: raw Stage evidence stays local and retrieval accepts only scoped,
  provenance-bound sanitized derivatives.
- Primary-source candidate research is published in
  [`docs/research/embedding-retrieval-model-landscape-2026.md`](../research/embedding-retrieval-model-landscape-2026.md).
- Landing requires an independent manager verdict against the final exact head.

## Acceptance conditions for the program

The roadmap epic is complete only when all of these are true:

- every active index and query proves exact logical-space compatibility;
- every corpus has a versioned scope/privacy/egress policy and deletion path;
- text, code, UI/multimodal, and reranking profiles have independent golden-corpus evidence;
- hybrid retrieval exposes channel contributions and lineage citations;
- promotion, production, query, and migration receipts are durable and inspectable;
- a full dual-index migration and rollback have been proven without mixed spaces;
- remote calls are impossible without corpus-level egress authority and cost caps;
- FleetBar/dashboard exposes health, quality, cost, latency, privacy, and migration truth;
- the current MiniLM path is either promoted for a named corpus/tier or remains explicitly
  degraded, never universal by convention.
