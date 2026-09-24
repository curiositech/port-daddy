# Digest-with-Zoom: Argumentative Lineage as the Operator's Two-Level View

The "Legible Swarm" paper (`docs/research/north-star/legibility-leviathan.md`) names digest-with-zoom as the one rule that keeps swarm legibility honest: **every summary is a lens onto the real artifact, never a replacement for it.** Argumentative lineage is the data structure that makes this rule mechanically enforceable for multi-agent reasoning outputs — it is what turns an agent's self-narration from an opaque node into a traversable graph with a verifiable ground-truth leaf at every zoom path.

## The Two-Level Contract

**Digest level.** The operator sees one line per agent output: `[agent] —[relationship]→ "thesis" (ToulminRole)`. This is computed by `SwarmTracer.getArgumentChain(messageId)` and rendered by `digestWithZoom()` in the skill's implementation pattern. The entire swarm's discourse collapses to N lines the operator can scan in bounded time.

**Zoom level.** On any line the operator finds suspicious, `digestWithZoom()` expands the full six-element Toulmin breakdown — Claim, Data, Warrant (probed), Backing/Resolution, Qualifier, Rebuttal — by traversing the `LineageEdge` graph back to the seed message. Crucially, the zoom target is the `messageId` and `spanId` recorded in `SwarmSpan`, not the agent's own narration of what it did. This is the paper's **verifiable-zoom rule** (§4.2): the agent's chain-of-thought may be unfaithful (Turpin et al. 2023, NeurIPS — LLM reasoning traces can be systematically post-hoc rationalisations that don't reflect what actually drove the output). Lineage edges point at immutable recorded messages; they cannot be rewritten after the fact.

## Why the Data Structure Matters

A lineage graph without the Toulmin annotation layer is opaque to operators: they see an edge `m3 → m7` but cannot assess whether m7's claim is well-grounded without reading every message. A Toulmin annotation without a lineage graph is unverifiable: the agent declares "this is Data for my Claim" with no machine-traversable path to check it. Argumentative lineage fuses both:

- `LineageEdge.relationship` (supports / contradicts / qualifies / synthesises) maps directly to Toulmin roles without a separate annotation step.
- `SwarmSpan.spanId` ties every edge to the exact executor invocation that produced it — timestamps, `promptHash`, `outputHash`, `durationMs` are all on the span. The operator can inspect not just *what* was claimed but *when*, *by whom*, and *how long it took*.
- `SwarmTrace.stats.contradictionCount` and `maxLineageDepth` are the digest-level health signals: if `contradictionCount > 0` after `synthesisCount` is accounted for, `unresolvedContradictions()` surfaces the specific rebuttals that were never resolved — the operator zooms those first, not the green paths.

## Potemkin Digest vs. Legible Lineage

The Legible Swarm paper's central failure mode (§8) is the **Potemkin digest** — a dashboard whose tiles assert a reality nobody can check, having paraphrased away the diff or reasoning that constituted the actual work. Without argumentative lineage, a swarm synthesiser produces a conclusion and the operator has exactly one artifact to inspect: the synthesiser's own narration of why it reached that conclusion. Two LLMs agreeing (one acting, one summarising) is not two checks; it may be one error reported twice.

With lineage, the graph exposes every `contradicts` edge that was overridden, every `qualifies` edge that introduced uncertainty, and every `synthesise` edge that claimed resolution. The operator's zoom path ends at recorded messages — artifacts the operator owns — not at model-generated prose. This is Scott's *Seeing Like a State* warning (§6) operationalised: the schema references verbatim messages, never replaces them.

## Stakes-Proportional Friction

The paper's **in-the-loop rule** (§5, citing Bainbridge 1983 and Endsley & Kiris 1995) warns that a digest too smooth to scrutinise manufactures out-of-the-loop operators. The lineage stats surface this: high `maxLineageDepth` with zero `contradictionCount` is suspicious — it means a long chain of supports with no challenge, which is either a genuinely robust argument or an echo chamber. Force a zoom on anomalies, not just throughput. Treat `contradictionCount > synthesisCount` as a mandatory zoom gate before any irreversible downstream action (merge, deploy, delete).

## Key Points

- Argumentative lineage is what gives digest-with-zoom mechanical teeth: the digest is computed over `LineageEdge` records owned by the operator, not over the agent's self-report.
- The zoom target is always a `messageId`/`spanId` tuple — an immutable recorded artifact — never the agent's chain-of-thought narration, which may be unfaithful (Turpin et al. 2023).
- `SwarmTrace.stats` (`contradictionCount`, `synthesisCount`, `maxLineageDepth`) is the operator's first-pass triage; `unresolvedContradictions()` is the mandatory zoom gate before irreversible action.
- Relationship labels (`supports`, `contradicts`, `qualifies`, `synthesises`) are the Toulmin mapping without a separate annotation step — they are recorded at message-publication time, not inferred post-hoc.
- A lineage graph with zero rebuttals in a long chain is a red flag, not a green light — it means either no agent challenged any claim or the challenges were silently dropped.

## See Also

- `docs/research/north-star/legibility-leviathan.md` — Full Legible Swarm paper: §4 (digest-with-zoom), §4.2 (verifiable-zoom rule), §5 (in-the-loop), §8 (Potemkin digest failure mode).
- `workgroup-ai/packages/core/src/topologies/swarm-tracer.ts` — `SwarmTracer`, `SwarmSpan`, `LineageEdge`, `SwarmTrace`, `SwarmTraceStats` source. Read before extending the lineage model.
- `windags/skills/toulmin-argument-analysis/SKILL.md` — Single-argument Toulmin breakdown; use when auditing one agent's output in isolation rather than a multi-agent discourse graph.
