# Context compaction: primary-method supplement

Retrieved2026-09-24. Root read the complete nine-file original context-economics bundle, the Luna economics report/errata, and the primary sections below. This supplements Luna research; no external benchmark is rerun. Local capacity-validator reproductions are in architecture-skill-drafts/B05/validation/context-root-audit.

## ACON v3: optimize the compressor using task feedback

[ACON arXiv2510.00615v3](https://arxiv.org/html/2510.00615v3), revised2026-06-01. Read abstract and §§3.1–3.3. Distinguishes threshold-triggered history compression from latest-observation compression conditioned on history. Compare uncompressed and compressed training trajectories, collect cases where the former succeeds and latter fails, diagnose lost information, aggregate feedback and refine natural-language compression instructions while holding the acting model fixed. The abstract reports evaluated AppWorld/OfficeBench/multi-objective QA results; this supplement does not repeat percentages without full evaluation-table audit. Neither the optimization objective nor selected examples proves globally optimal or universally sufficient summaries. Distillation is named in the paper but not substantively inspected here.

## Parallel compaction v1: block-level serving

[Parallel Context Compaction arXiv2605.23296v1](https://arxiv.org/html/2605.23296v1),2026-05-22. Read §§3–4 and adjacent measurement discussion. Snapshot and partition chronological history; worker k sees prefix blocks1..k with its target block last; concurrent summaries merge in original block order. This differs from independent chunks and from giving every worker the entire marked snapshot. Evaluated HotpotQA/LoCoMo flows, four specified backbones, vLLM prefix caching/chunked prefill and dedicated H100 configurations. Reported output control and latency are conditional on that setup. It does not establish arbitrary concurrency, context-preservation, API-billing savings, or permission to spawn. Count every worker's prefix, summary and merge work in a local cost model; provider cache price and actual cache hit remain separate.

## Slipstream v1: continuation-based validation

[Slipstream arXiv2605.08580v1](https://arxiv.org/html/2605.08580v1). Read §4 including4.1–4.3 and the adjacent experiment setup/results. The original-context agent continues while a summary is prepared; a judge checks facts and forward intent used in the next-k continuation. Adoption includes those intervening steps; rejection triggers a targeted correction. The continuation window is finite and timing-dependent. Reported SWE-bench error-locality coverage is incomplete; later dependencies can fall outside it. This is empirical validation, not semantic equivalence, an authorization proof or an error-free judge. The paper's access to model reasoning is not a portable API assumption: local designs should use authorized observable tool receipts, explicit plans and artifacts, not require protected/private reasoning.

## Anthropic engineering guidance

[Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents),2025-09-29. Read context/retrieval/long-horizon sections. Recommends compaction, structured notes, selective retrieval, and scoped workers; tune on complex traces and preserve important decisions and unresolved bugs. Treat its attention-budget metaphor and engineering observations as guidance. Quadratic pair counts alone do not prove a behavioral degradation mechanism; fixed tool-count caps and universal length thresholds are not established.

## Constructed local evaluation protocol

Make an immutable authorized trace containing a source digest, one unresolved constraint, one denied request, and a planned patch affecting one named function. Create candidate summaries that respectively omit the constraint, broaden the patch to every function, claim the denied request succeeded, and preserve all four. Compare permitted observable continuation plans and tool receipts; record omissions, inventions, intent drift, token/input/cache/output cost, latency, and success on held-out cases. Add a fifth case whose omitted constraint matters only after the finite continuation window. A pass on early steps must not certify that later case. This is a proposed inert evaluation, not an executed experiment or a claim that summaries must preserve private model reasoning.

Maintain atomic snapshot identity and append the intervening authorized trace once when adopting a candidate. Reject stale/conflicting source identity and unavailable/unauthorized pointers; do not replay external effects to reconstruct context. These are local design requirements, not guarantees attributed to the four sources. Preserve the original micro/macro strategy choice, tool-call/result pairing, audience-specific digest, role budgets, native capacity and accounting methods. Make heuristic budgets explicit measured policy inputs, not numerical laws.

Potential Book planning item: test delayed compaction omissions and adoption identity against the existing continuity/legibility chapter. Requires manuscript comparison; no novelty or placement decision yet. Existing papers already address task-conditioned compression, parallel summaries and trajectory validation.
