# Abstract Plan Sketches as Hashable Strings: Structural Similarity and Deduplication Patterns

The SKILL.md flags plan-sketch hashing as "aspirational" and defers to dense embeddings. This document fills in why the concept is appealing, where the structural similarity literature actually sits, and what CAMEL and MetaGPT do (and don't) contribute — so an agent can reason about the trade-offs without conflating distinct mechanisms.

## What a Plan Sketch Is

A plan sketch is the tuple `(goal_statement, action_sequence, constraint_set)` extracted from an agent's declared or inferred intent, as distinct from the agent's output tokens. Concretely: given an agent instructed to "refactor the auth module to use JWT", a plan sketch might be `("refactor auth", ["read_file(auth.py)", "identify_coupling", "rewrite_function(login)", "write_file"], {"module": "auth", "target": "JWT"})`. The goal is goal-operator decomposition at a coarser granularity than STRIPS-style planning — closer to HTN task networks (Erol et al., 1994) but without formal semantics.

The appeal of hashing: if two agents' plan sketches hash to the same (or near-same) value, they're doing the same work regardless of surface instruction phrasing. This would be O(1) lookup instead of O(N) embedding + ANN query.

## Why Exact Hashing Fails

Canonical string hashing collapses on paraphrase. `"read the login function"` and `"inspect auth.py::login"` have cosine similarity ~0.87 (BGE-large) but zero hash overlap. Even within a single LLM, the same plan elicited twice produces lexically distinct action labels. You need structural normalization before hashing is useful.

**Structural normalization approaches** (engineering, not published for this domain):

1. **Verb lemmatization + object canonicalization**: map `("read_file", "auth.py")` and `("inspect", "auth.py")` to `(READ, FILE:"auth.py")`. Requires a controlled vocabulary for action verbs and entity types — brittle outside the vocabulary.

2. **Abstract action type sequences**: discard arguments, hash only the type sequence: `[FILE_READ, CODE_ANALYZE, FILE_WRITE]`. Two agents with identical type sequences but different target files are "structurally similar but not equivalent." This reduces to task-shape detection, not plan identity.

3. **SimHash over action n-grams**: treat the action sequence as a document, compute a locality-sensitive hash (Charikar, 2002). Hamming distance <= 3 bits signals structural similarity. This is MinHash-LSH applied to plan sequences rather than token sets — approximately correct, not exact.

## What CAMEL and MetaGPT Actually Do

**CAMEL** (Li et al., arXiv:2303.17760) uses a role-playing dyad (AI User + AI Assistant) with explicit task decomposition: the AI User issues sub-instructions, the AI Assistant completes them, and the loop terminates on a CAMEL-specific `<CAMEL_TASK_DONE>` token. There is no deduplication mechanism in CAMEL. Two CAMEL sessions given semantically identical tasks run fully independently. What CAMEL provides relevant to this domain: structured message turn format (role + content), which makes plan extraction from conversation logs tractable. The action sequence is recoverable from the AI User's instruction stream.

**MetaGPT** (Hong et al., arXiv:2308.00352) introduces a "subscription + deduplication" layer in its message routing, but the deduplication is structural-by-design: each `Role` registers a `_watch` set of `Action` types it subscribes to. `RoleContext.memory` deduplicates on `(cause_by, content_hash)` — a tuple of the Action class that caused the message and a hash of the message content string. This is exact-string deduplication of messages, not semantic deduplication of plans. Two agents receiving differently-phrased instructions to do equivalent work will both receive their messages. MetaGPT's mechanism is valuable for message storm prevention in publish-subscribe architectures, not for detecting semantic equivalence across agents.

The takeaway: neither CAMEL nor MetaGPT provides a model for plan-sketch structural similarity. CAMEL gives recoverable action sequences; MetaGPT gives exact-string message dedup. Both are building blocks, not solutions.

## Closest Published Analogues

**Plan recognition** (Geib & Goldman, 2009; Ramírez & Geffner, 2009) inverts planning: given observed actions, infer the goal. If two agents' observed action prefixes are explained by the same goal hypothesis under a shared domain theory, they're semantically equivalent. This works but requires a domain theory (action preconditions/effects) — unavailable in open-domain LLM agent settings.

**Semantic plan distance** in AI planning research measures plan similarity via edit distance over grounded action sequences (Srivastava et al., 2007). Normalized edit distance (NED) on abstract action type sequences is implementable without a domain theory: `NED(plan_A, plan_B) = edit_distance(types_A, types_B) / max(len(types_A), len(types_B))`. Values < 0.25 indicate high structural similarity. This is the strongest defensible structural similarity measure for plan sketches without embedding.

**In practice**, the embedding approach in the SKILL.md (dense encode of the output prefix) implicitly captures plan-sketch similarity because LLM outputs correlated with the same plan sketch will be close in embedding space. Plan-sketch hashing adds nothing over embedding unless you have a controlled action vocabulary and need O(1) exact lookup — a narrow use case.

## Key Points

- Exact plan-sketch hashing requires structural normalization (verb lemmatization, entity canonicalization, type abstraction) before any hash is computed; without normalization it degrades to string comparison.
- MetaGPT's deduplication is exact-string message dedup keyed on `(Action_class, content_hash)` — it does not detect semantic equivalence between differently-phrased tasks assigned to different roles.
- CAMEL provides recoverable action sequences (the AI User instruction stream) but has no deduplication mechanism of any kind.
- Normalized edit distance over abstract action type sequences (`NED < 0.25`) is the most principled structural similarity measure available without a domain theory or embeddings.
- Dense embeddings over output prefixes subsume plan-sketch similarity in open-domain settings; add structural hashing only if you have a controlled action vocabulary and need sub-millisecond lookup at N > 500 concurrent agents.

## See Also

- SKILL.md §"Implementation Pattern" — the embedding + ANN approach that renders plan-sketch hashing optional
- `references/early-exit-partial-outputs.md` — checkpoint-based encoding of partial outputs (the stream from which plan sketches would be extracted)
- CREDENCE (arXiv:2606.19819) — the most rigorous published benchmark of cosine similarity thresholds for semantic claim deduplication, applicable to plan-sketch embeddings
