# 0059. LLM semantic response cache — extend the existing client, reuse the existing embedder

## Status

Accepted

## Context

The operator asked for an LLM response caching layer (exact + semantic) to cut
cost and latency. The reflex — and the `llm-response-caching-layer` skill's default
— is a new two-tier Redis + vector-DB (Pinecone/Qdrant) service. For Port Daddy
that would be **inventing what already exists**, which the operator explicitly
forbade ("that already exists, stop inventing new things").

What already exists:

- **`createLLMClient` (`lib/llm-call.ts`)** — a shared client factory with an
  exact-match cache (`Map` keyed by `cacheKey`), TTL eviction, rate-limit, hard
  timeout, and fallback-deny. It was deliberately lifted out of the judge so future
  request-shape callers reuse it. It already exposed `cacheKey` / `cached`.
- **`lib/semantic-resolver.ts`** — the operator's local embedding stack
  (`Xenova/all-MiniLM-L6-v2`, normalized vectors, on-disk model cache) plus a
  `cosineSimilarity` metric. No external service, no vector DB.

The only gaps were: (1) no *semantic* tier on the exact-match cache, and (2) almost
nothing routes through the shared client yet (only the judge).

## Decision

**Add a semantic tier to the existing `createLLMClient`, reusing the existing local
embedder and cosine metric. Build no new cache service and no external vector DB.**

- `lib/semantic-resolver.ts` exports `cosineSimilarity` and a standalone
  `createLocalEmbedder()` (the same MiniLM pipeline, without needing the full
  resolver or a DB).
- `createLLMClient` gains two options: `embedder?: LocalEmbedder` and
  `semanticThreshold?` (default **0.95** — high precision; returning the wrong
  neighbour's answer is worse than a miss). When an embedder is present, an
  exact-match miss falls through to: embed the prompt → cosine-compare against
  cached entries **of the same model + maxTokens** → serve the best match at/above
  the threshold. Cross-model reuse is impossible by construction (a Sonnet answer
  never satisfies a Haiku call). Per-call opt-out via `req.semantic = false`.
- The tier is **best-effort**: an embed failure (model not yet downloaded, etc.)
  returns null and the call falls through to the adapter — it never blocks or
  throws. Stats gain `semanticHits`. With no embedder configured, behaviour is
  byte-identical to before (exact-match only).
- **Caller wiring:** `lib/shipwright/survey.ts` — a deterministic, request-shape
  prompt — now passes a `cacheKey` (sha256 of model + prompt), enrolling it in the
  exact-match cache and the semantic tier. The change is inert if the injected
  client wasn't built with caching, so it is safe regardless of daemon wiring.

### Why not Redis + a vector DB

Port Daddy is a local, single-operator SQLite daemon. An in-process `Map` LRU + a
local embedding model is the right weight; standing up Redis and Pinecone would add
two external dependencies and an operational surface for a tool that runs on one
machine. The skill's two-tier cloud pattern is for multi-tenant API gateways, not
this.

## Consequences

- **Positive.** Every consumer of the shared client can now get semantic caching by
  passing the operator's existing embedder — zero new infrastructure. Near-miss
  prompts (re-surveying a barely-changed project, re-judging a reworded conflict)
  reuse a cached answer.
- **Cost / honesty.** The semantic tier loads the local MiniLM model on first use
  (one-time, then on-disk cached) — so it's opt-in per client via the `embedder`
  option, never forced on.
- **Follow-up (tracked, not silent).** The cost win only lands once callers actually
  run through a cache-configured shared client. Today `server.ts` wires **no** shared
  `llmClient` (the judge builds its own; the shipwright route's `deps.llmClient` is
  unwired). The next step is constructing one shared cached `createLLMClient`
  (adapter from the backend resolver + `createLocalEmbedder()` + a TTL) at the daemon
  and injecting it into the request-shape consumers (shipwright survey, future
  suggesters). That is a deliberate daemon-construction change, called out here so it
  is not mistaken for done.

## Related

- `lib/llm-call.ts` — the shared client this extends.
- `lib/semantic-resolver.ts` — the local embedder + cosine metric this reuses.
- ADR-0057 — declarative model registry (the model a cache entry is scoped to).
