# State, memory, ancestry, and context

## State types and lineage

Keep conversation transcript, durable task state, user memory, and provenance/evidence distinct. State retention/deletion, restoration, fork identity, and replay boundaries. A durable record is not proof that a process remains live.

## Forking alternatives

**Copy-on-fork** duplicates current history. It is simple, but needs an explicit ancestor ID if later review must reconstruct lineage. **Append-only log plus branch pointer** shares the prefix and appends divergent tails; it preserves ancestry and can reduce duplicate storage. Select either based on workload, retention, and review needs; do not claim one is universally required.

## Episodic promotion procedure

1. Confirm the applicable permission and data/retention scope, then identify a candidate decision, fact, outcome, or artifact reference.
2. Record source/provenance and a short, reviewable summary.
3. Assign a TTL or retention tier based on freshness and purpose.
4. Store large material as a stable blob/reference rather than prompt-copying it.
5. Recall only under an evaluated relevance policy and preserve source/version in the retrieved result.

This is a design procedure, not a claim that any retrieval implementation is calibrated.

## Context and provider cache

Use bounded input, provider cache, eviction/summary, and memory promotion according to workload. Caching can reduce repeated-prefix cost; it does not shrink a context window. State an input/retention bound separately. Anthropic’s [prompt caching documentation](https://platform.claude.com/docs/en/build-with-claude/prompt-caching), checked 2026-09-24 in the inherited research, documents default five-minute TTL behavior refreshed by use and optional one-hour behavior with separate constraints/cost. Pin provider/model/docs/date and measure hit/miss/cost; do not turn it into a universal cadence or threshold.
