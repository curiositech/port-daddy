---
name: hypertree-planning
description: >-
  Build and evaluate a rule-guided HTP planning outline before separate leaf-content
  work. Use when a planning problem has reusable decomposition rules and needs an
  explicit outline, pruning record, and integration checks. NOT for scheduling,
  multi-agent coordination protocols, or database hypertree decomposition.
license: FSL-1.1-MIT
allowed-tools: Read,Bash,Grep,Glob,Edit,Write
metadata:
  category: Planning
  tags: [planning, hierarchical-decomposition, rules, outlines]
  provenance:
    primary-source: https://arxiv.org/abs/2505.02322
    source-year: 2025
---

# HyperTree Planning

## Source boundary

This skill reconstructs **HyperTree Planning (HTP)** from Gui et al. (2025), [arXiv:2505.02322v1](https://arxiv.org/abs/2505.02322v1), especially §§3–5 and Algorithm 1. HTP is a rule-guided method for generating an LLM planning outline. It is distinct from database/query hypertree decomposition and from hierarchical task-network planning.

The source library is `L=(G,q,R)`: `G` is a task-node set, `q` is the query/root, and a rule in `R` maps one divisible start node to a **set** of child nodes. A generated rooted acyclic structure has rule-start non-leaves and leaves in `G`. A child set records a decomposition option; its shape does not establish child independence, a parallel schedule, message protocol, or effect authority.

Read [the primary-method reconstruction](references/htp-primary-method.md) for the complete Algorithm 1 procedure and benchmark scope. Read [the terminology boundary](references/hypertree-terminology-boundary.md) before using the word “hypertree” across disciplines.

## When to use

Use HTP when you can state reusable decomposition rules, need a reviewable outline before leaf work, and can record unresolved shared constraints explicitly. Do **not** use a number of reasoning steps as an automatic trigger: select this method because the rule representation and outline are useful for the specific planning task.

Do not infer from HTP that subproblems can be sent to independent workers. If an implementation assigns work to workers, separately declare inputs, shared constraints, readiness, authority, resources, and integration evidence.

## Procedure

### 1. State the task and rule library

Write `q`, enumerate task nodes `G`, and state `R` as rule-start to child-set mappings. For every rule, record the concern it covers and any known cross-child constraint.

**Hand check.** Let `G={Plan, Route, Lodging, Route-A, Route-B}`, `q=Plan`, and:

```text
Plan  -> {Route, Lodging}
Route -> {Route-A, Route-B}
```

The divisible set is `D={Plan,Route}`. Expanding `Plan` must attach *both* Route and Lodging as one child set; expanding Route attaches Route-A and Route-B beneath Route. The example is structurally valid and acyclic. It does not prove that route choice and lodging choice are independent: a total budget can couple them.

### 2. Construct candidate hyperchains

Follow Algorithm 1’s selection, expansion, construction, and decision stages:

1. Derive divisible nodes `D` from `R`; initialize the current structure at `q`.
2. For each configured depth, generate candidate hyperchains.
3. If the count exceeds width `W`, record one selection policy: width-based, confidence/probability-based, or LLM-guided filtering. The paper names those options but supplies no universal scoring equation.
4. **For each retained hyperchain**, identify divisible leaves in context and select an expandable leaf `g*`.
5. At that `g*`, retrieve or sample `P` applicable rules. **For each sampled rule**, ask the model to instantiate that rule’s complete child set and attach it as a distinct branch below `g*`.
6. Continue the per-rule loop, then the per-hyperchain loop, until the configured depth/no-divisible-leaf construction condition; select a final hyperchain as outline `O`.

A hyperchain fixes one alternative branch at a selection point. It does not discard the simultaneous members of that selected rule’s child set. Use the source procedure diagram in [04-htp-outline-procedure.md](diagrams/04-htp-outline-procedure.md). A local reviewer may reject a malformed or incomplete outline, but that review is an implementation layer, not a published Algorithm 1 transition.

**`P=2` hand check.** Let `G={Plan,Route,Flight,Lodging}`. At divisible leaf `Plan`, let the two sampled rules be `r_road: Plan -> {Route, Lodging}` and `r_air: Plan -> {Flight, Lodging}`. `P=2` creates two alternative branches below `Plan`; choosing `r_road` retains both `Route` and `Lodging` together in that branch. It does not choose Route as one alternative and Lodging as another, and it does not establish that the selected children are concurrently executable.

### 3. Keep outline, content, and final plan separate

The source distinguishes the outline `O`, self-guided leaf planning/content `C`, and final plan `P`. `O` is incomplete where leaves need external knowledge or deeper work. Give `O` and the permitted knowledge base to the content stage, record what leaf evidence was used, then generate `P` from the completed content.

A useful local integration check is: list shared budget, time, authority, and provenance constraints; test the combined candidate against them; send a failed check back to the affected leaf or rule application. This check is a proposed engineering control. [05-htp-coupling-integration.md](diagrams/05-htp-coupling-integration.md) makes that boundary explicit.

### 4. Evaluate the actual claim you make

The paper reports results under named model, dataset, baseline, and prompting setups. Preserve each denominator and setup. For example, its GPT-4o TravelPlanner ablation reports 20.0 for HTP, 6.1 without division, and 8.3 without self-guided planning. This is evidence about that ablation setup; it does not identify a universal causal mechanism, set a task-length cutoff, or validate a multi-agent architecture.

The arithmetic `1-(1-.02)^60≈.7024` is valid only for an illustrative constant, independent per-step error model. It is not an HTP measurement. Likewise `log₄(60)≈2.95` is a balanced-tree illustration, not a property of rule-derived HTP outlines.

## Worked diagnostic cases

| Observation | Check | Action |
|---|---|---|
| A leaf has no rule | Confirm it is not in `D` and state what leaf content may do. | Keep it as a leaf; do not invent a branch. |
| Candidate count exceeds `W` | Record candidate IDs and selected pruning policy. | Keep the selected set and preserve the rejection rationale. |
| Two child results conflict on budget or date | Identify the shared constraint and affected branches. | Revisit the leaf result or rule choice; do not call the shape “independent.” |
| Outline exists but a leaf needs current facts | Identify permitted knowledge and evidence source. | Run self-guided content work; do not return `O` as the final plan. |
| A comparison claim omits model/dataset/baseline | Recover the exact table/row or withdraw it. | Report only the scoped observation. |

## Reference guide

| Reference | Purpose and status |
|---|---|
| [htp-primary-method.md](references/htp-primary-method.md) | Source-labelled Algorithm 1, example, pruning, `O→C→P`, and result limits. |
| [hierarchical-thinking-through-hypertree-structures.md](references/hierarchical-thinking-through-hypertree-structures.md) | Formal rule/outline explanation and source versus proposal boundary. |
| [decomposition-rules-as-generalized-knowledge.md](references/decomposition-rules-as-generalized-knowledge.md) | Rule-library authoring and coverage checks. |
| [adaptation-through-rule-generalization.md](references/adaptation-through-rule-generalization.md) | Scoped rule-versus-example experiment reading. |
| [failure-modes-in-complex-reasoning-systems.md](references/failure-modes-in-complex-reasoning-systems.md) | Source-labelled ablation diagnostics and proposed mitigations. |
| [cognitive-cost-of-reasoning-chain-length.md](references/cognitive-cost-of-reasoning-chain-length.md) | Conditional arithmetic and measurement design, not causal proof. |
| [coordination-without-central-control.md](references/coordination-without-central-control.md) | A proposed multi-agent transfer with explicit assumptions. |
| [the-gap-between-planning-and-execution.md](references/the-gap-between-planning-and-execution.md) | Why `O` is not `P`, plus knowledge and integration contracts. |

## Common errors

- Treating `Plan -> {Route,Lodging}` as a proof of concurrent readiness.
- Hiding pruning selection behind an unexplained score.
- Treating an outline as completed content or a completed plan.
- Reporting paper benchmark values without the named table, model, baseline, and task.
- Calling illustrative error arithmetic the mechanism of HTP’s results.
- Reusing database hypertree-width terminology for an LLM planning outline.

## Historical material

[`_raw_response.md`](_raw_response.md) is a short non-operative provenance wrapper. The original byte-exact snapshot and its hash are under the validation evidence; it is not a source of active method claims. [`_book_identity.json`](_book_identity.json) records the corrected source-year metadata.
