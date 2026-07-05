# State, Memory & Context

Use this when deciding what persists beyond the current turn, what gets promoted to durable memory, and how the context window and prompt cache interact economically.

## The conversation is not the only state

A working agentic app needs at least three separable layers:

| Layer | Lifetime | Example |
| --- | --- | --- |
| Turn-local scratch | This request only | Tool call arguments, intermediate reasoning |
| Session/thread state | Until the thread is closed or archived | Full transcript, working files, open plan |
| Durable memory | TTL'd or permanent, cross-session | Promoted facts, user preferences, prior decisions |

Treating layer 2 as the only layer is the "transcript-only-state" failure: no forking (can't explore an alternate without destroying the original), no rename/organize (unusable at scale), and no memory (every new session starts from zero even when the same facts matter again).

## Forking

Forking a thread means branching the state at a chosen point and continuing independently — the pre-fork history is shared, post-fork history diverges. Two implementation shapes:

- **Copy-on-fork**: duplicate the transcript at fork time. Simple, but expensive for long threads and loses the "shared ancestor" relationship unless you track it explicitly.
- **Append-only log + branch pointer**: store one append-only event log per thread; a fork is a new branch pointer into the same log up to the fork point, then a divergent tail. Cheaper, and gives you a real DAG of exploration for free — this is the shape Port Daddy's session/salvage model assumes.

Forking is not optional polish. Without it, "let me try a different approach" means starting over and losing everything useful from the first attempt.

## Episodic memory: TTL and blob-promotion

Episodic memory is not "dump everything into a vector store." It is a deliberate promotion pipeline:

1. **Candidate detection**: something in the current turn looks durable — a decision, a fact about the user/project, a completed task outcome. Detect this with a real classifier or an LLM judge call, never a keyword list (keyword lists have catastrophic recall on open-ended text).
2. **TTL assignment**: not all promoted facts live forever. A "the user prefers dark mode" fact might be permanent; "the build is currently red because of flaky test X" should expire in hours, not persist as stale truth next month. Assign a TTL at promotion time, not as an afterthought.
3. **Blob-promotion**: large artifacts (a generated document, a long analysis) get stored once as a blob with a stable reference, and the memory record is a pointer plus a short summary — not the blob's full contents re-embedded into every future prompt.
4. **Recall by relevance**: memory is retrieved by relevance to the current turn (embeddings/BM25 — see `episodic-memory-algorithms` skill for the retrieval mechanics), not injected wholesale. Recalling everything defeats the purpose of having a separate memory layer instead of just a bigger context window.
5. **Working context vs. long-term memory**: working context is what's in the window right now; memory is what's retrievable on demand. Conflating them means either the window grows unbounded (cost blowup) or memory never actually gets consulted (dead feature).

## Context-window budgeting and caching economics

Unbounded context with no strategy produces two failures at once: cost blowup (paying full price to re-send a growing prefix every turn) and latency growth (larger prompts, slower first-token time).

- **Prompt caching**: Anthropic's prompt cache has a roughly 5-minute TTL on a cached prefix. This has real architecture consequences, not just a performance footnote:
  - Keep the cached region (system prompt, tool schemas, pinned reference docs) byte-identical across calls — any edit invalidates the cache from that point forward.
  - Poll/sleep cadence for background or long-running agents should stay inside the 5-minute window if you want to keep the cache warm; a 10-minute poll interval pays full price every single call.
  - Put volatile content (current turn, recent tool results) *after* the stable cached prefix, never interleaved with it.
- **Eviction/summarization**: once the window approaches its budget, either summarize old turns into a compact recap or drop turns that are no longer relevant to the current task. Decide the trigger point (e.g., 70% of window budget) up front rather than reacting to failures.
- **Promotion out of the window**: durable facts belong in episodic memory, not in an ever-growing "context I keep re-sending." If a fact needs to survive past the current session, promote it — don't just keep re-including it in every prompt because it's already there.

## Shibboleth

Unbounded context with no caching/eviction/memory strategy is a cost and latency blowup, not a distant scaling concern — it shows up in the first week of real usage once sessions run longer than a few dozen turns. The fix is never "buy a bigger context window"; it's picking at least one of caching, eviction, or memory promotion before shipping.
