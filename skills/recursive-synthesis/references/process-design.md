# Process Design: Rationale and Limits of the Local Workflow

## Scope and source boundary

This reference preserves a first-party document-synthesis workflow and its design rationale. The phases, roles, prompts, timing and artifacts are adjustable local choices, not experimentally established requirements. The account below describes why an author might choose these practices and what to inspect; it does not claim that the practices guarantee better synthesis.

This document workflow is separate from Li et al. (2026), *Recursive Synthesis for Long-Horizon Terminal Tasks*. That paper defines an algorithm for extending verified terminal-task examples, not this collaboration process. See [the source-specific method note](source-algorithm-and-verification.md) for paper identity, inspected depth and limits.

## A staged workflow is a design option

The original local template separates problem setup, independent contributions, first synthesis, commentary, consolidation, outside review and final disposition. The sequence makes handoffs visible and gives the editor opportunities to compare a draft with its inputs. It does not establish that seven stages are optimal or that every document needs them.

A compact process can combine drafting, synthesis and review when the scope is narrow. A consequential document may benefit from keeping evidence collection, substantive review and decision disposition separate. Choose stages by the risks they control: source accuracy, omitted perspectives, misrepresentation, unclear authority, implementability, or erased dissent. Remove any stage that adds paperwork without a corresponding check.

### What different process shapes may trade off

A simple write-review-edit cycle has low overhead, but can miss a chance to compare alternatives before choosing language. Separating divergence from synthesis can make distinct views easier to see, but the parallel inputs may duplicate effort or share the same blind spots. Adding a later outside review can expose reader assumptions, but the reviewer may lack context needed to understand the evidence. A second synthesis pass can incorporate critique, but it can also introduce regression if the editor does not track changed claims.

These are design considerations, not measured effects. When choosing a compact or expanded flow, state which check is preserved, which is omitted, and what risk the omission creates. If you need an independent check, specify the target (for example, factual accuracy, source representation, implementability, or accessibility) rather than prescribing a phase count.

| Stage in the fuller template | Purpose to consider | Evidence to retain |
|---|---|---|
| Setup | Bound question, audience, authority, and evidence needs | Scope and decision-owner note |
| Divergence | Collect distinct contributions before a shared synthesis anchors them | Individually attributable claims and sources |
| Synthesis | Organize shared claims, conflicts, gaps, and candidate structure | Claim ledger and draft rationale |
| Commentary | Let contributors challenge representation and reasoning | Specific corrections and counterexamples |
| Consolidation | Revise for audience while retaining unresolved tensions | Changed-claim record and dissent |
| Reality check | Ask relevant reviewers to test usability and feasibility | Findings with scope and source |
| Final disposition | Incorporate, reject, or defer findings under existing authority | Owner, decision, rationale, and status |

The stages can repeat when a new material issue emerges. Set an explicit stopping condition such as “the scoped owner has a reviewable recommendation and remaining unknowns are recorded,” rather than promising full agreement.

## Independent contribution and critique

Independent drafting may reduce anchoring when contributors would otherwise respond only to the first proposal. It also costs time and can duplicate research. Decide whether to use it based on the importance of genuinely distinct inputs, whether contributors can work from a common scope, and the cost of missing an alternative. Independence is not guaranteed by separate prompts or separate agent names; shared sources, models, context, incentives, or assumptions can still produce correlated errors.

### Steel-manning as a review aid

The original template's steel-man prompt asks a reviewer to identify strengths in the draft, note where it changed their thinking, and consider connections among positions before critique. Those questions can slow a superficial dismissal and make the reviewer test their interpretation. They can also become ritual praise, especially when exact counts are required or critique is invalidated for omitting a section.

Use the practice selectively: ask the reviewer to restate the claim fairly, identify what the evidence supports, then challenge assumptions, omitted counterexamples, or implications. Invite a proposed correction. For a time-sensitive factual or safety correction, do not require a preamble that delays the report. The quality test is whether the critique is fair, specific, and supported, not how many acknowledgments it contains.

The original design intent can be stated as a set of questions rather than promises: did the reviewer understand the claim before rejecting it; did the review surface an implication the author missed; did it preserve a useful part of the proposal; did it connect evidence across viewpoints? These questions can improve a review's completeness, but the section alone does not ensure engagement, reduce polarization, or improve the final document.

### Fresh review and practitioner input

Practitioner or stakeholder review can occur at any point. A cold read after an initial draft can surface undefined terms and operational constraints; earlier participation can prevent a team from optimizing a document that cannot be used. Choose timing to match the question. A reviewer’s confusion is a signal to investigate, not proof of a defect; familiarity or unfamiliarity alone does not establish correctness.

A reviewer who has not seen earlier discussion may be better positioned to notice missing definitions, unspoken assumptions, and jargon that became familiar to the drafting group. But withholding background may also make sound claims look unsupported or hide relevant constraints. Record what the reviewer saw, what they did not see, and whether the finding changed after they received the missing source. There is no general requirement to exclude product, engineering, design, legal, or affected-user perspectives from earlier phases.

A deliberately fresh reviewer can be asked to mark undefined terms, implementation gaps, unaddressed stakeholders, inaccessible workflows, and assumptions that are invisible to insiders. Treat those findings as leads, then check them against the document's evidence and the reviewer’s missing context. A cold read is one perspective, not a substitute for subject-matter review or the affected owner's judgment.

## Prioritization is not truth-finding

Binary choices can obscure conditional support or abstention. Ratings can preserve intensity, but scores may be interpreted differently or influenced by scale anchors. Ranked lists make relative order explicit, but can hide how strongly a participant distinguishes adjacent items and can depend on the candidate set. Narrative deliberation retains reasons but may be harder to summarize. These are possible tradeoffs, not universal failures of any method.

The original template's ranked-choice option can force a participant to express relative priorities, but no aggregation rule turns a preference ranking into evidence that a principle is true, ethically justified, or authorized. Aggregated ranking also depends on the candidate list and scoring rule. Use such methods only when the question actually concerns preferences; keep votes and preference data separate from factual support and decision authority.

When a ranking is appropriate, document who supplied it, how ties and missing responses are treated, and whether the result is descriptive input or a binding rule under existing governance. Instant-runoff and Borda-style procedures produce different summaries. A Borda-style score can be illustrated by assigning points based on rank position and summing, but the point assignment embeds a choice about how much rank distance matters. Ties in aggregate scores should be reported; an editor should not quietly break them by claiming one item subsumes another. Ask the responsible owner to decide if a choice must be made.

For example, binary approval can record whether a participant accepts a proposal under a stated rule, but it can hide conditional acceptance, abstention, or the reason for an objection. An ordinal rating can record intensity, but averaging assumes the scale has comparable meaning across respondents and items. Ranked choice forces an order among the listed options; that may be useful for eliciting preference, but it can make incomparable claims look like substitutes and does not show the distance between adjacent ranks. A written rationale preserves conditions and evidence but takes more effort to review. Choose a method for the question being asked, retain the raw responses when appropriate, and explain its limits.

If using a ranking as a summary, make the aggregation reproducible. A simple illustrative Borda-style procedure for a fixed list of N options awards N points for first place, N-1 for second, and so on, then sums points. That rule treats positions as equally spaced and depends on which options were included. Instant-runoff instead removes the lowest-ranked option in successive rounds; its result can differ from the point sum. These are preference summaries, not methods for combining source evidence or settling delegated policy. Do not apply them to claims that have not been made comparable, or use the outcome to bypass the existing decision owner.

For a consequential document, keep these records distinct:

- What sources and observations support a claim?
- Which interpretations or value priorities differ?
- What does the scoped decision owner choose, and under what authority?
- What uncertainty, cost, or dissent remains?

A useful synthesis can report areas of shared support, contested interpretations, unique but relevant concerns, and unresolved evidence gaps without assigning agreement percentages. When a document must rank priorities, choose and document a method as a local decision aid; preserve the underlying responses and do not use it as a consensus gate.

## Preserve disagreement without making disagreement a goal

A dissenting appendix or decision log helps when a real conflict remains after evidence and scope are examined. For each unresolved issue:

1. State the competing propositions in terms their proponents recognize.
2. Give the strongest relevant reason and evidence for each, including limits.
3. Identify whether the conflict is factual, interpretive, conditional, or a value/policy choice.
4. Name any choice already made by an authorized owner, its scope, and the cost accepted.
5. State what new evidence, changed condition, or authority could reopen the issue.

This preserves the original template's treatment of tradeoffs: explain the choice without pretending the unchosen concern is worthless. For example, a document may prefer faster change over strict stability for a bounded area while documenting the breakage risk, mitigation, and conditions that would reverse that choice. The example is illustrative; the owner supplies the actual rationale.

Not every difference is irreconcilable. Some are factual questions that need evidence, terms that need definition, or alternatives that apply under different conditions. Conversely, a decision owner may choose among valid alternatives without claiming that the choice resolved the underlying value conflict. Do not force consensus or manufacture minority status to make the appendix look balanced.

Illustrative tensions from the original template include speed versus reliability, centralized control versus distributed autonomy, and user benefit versus revenue. These pairs do not always conflict: system boundaries, staged rollout, or a changed business model may alter the tradeoff. Use them to ask what the actual options mean in this document, not as default labels for every disagreement.

## Match effort to the problem

Instead of staffing from a complexity table, estimate the work from the document's scope and risks:

- Independence and coverage of the material evidence sources.
- Which affected groups or domains can change the recommendation.
- Consequence and reversibility of the document's guidance.
- Need for independent validation, qualified review, or implementation tests.
- Coordination overhead, access constraints, and cost of delay.

A narrow charter may need only an editor plus focused input from the people who understand its consequences. A broader policy may need multiple domain contributors, a source-aware synthesizer, and targeted reviewers. The design does not follow mechanically from subject size: a short policy can carry high consequence, and a long reference may be low-risk. Add contributors only for identifiable evidence or perspective gaps. A lead editor or subgroup structure may help when ownership, handoff records, and source traceability are clear; otherwise it can create another synthesis layer with its own loss risk.

Estimate staffing, timeboxes, word lengths, and artifact counts locally. The original small/large-document examples are not scheduling data or scaling laws. If useful, preserve them as local scenarios with the assumptions and actual completion time recorded. Revise a local plan when it impairs source quality, useful dissent, or delivery.

Use the following qualitative distinctions when planning, rather than a staffing quota:

| Work shape | Questions to ask | Possible adjustment |
|---|---|---|
| Narrow/local document | Are there only a few material claims and one owner? Which source or stakeholder could change the recommendation? | Combine synthesis and editing; request only targeted review |
| Cross-domain document | Do terms, evidence, or implementation constraints differ by domain? Are affected groups missing? | Separate source collection from consolidation and invite reviewers for specific gaps |
| Broad or multi-organization document | Are there multiple decision owners, incompatible policies, or distinct evidence corpora? Can a subgroup synthesize without hiding lineage? | Partition by scope, name handoff owners, and keep cross-group conflicts explicit |

These are planning prompts, not an inference that broader subject matter needs more agents or more phases. Estimate the coordination burden from actual dependencies, access limits, and decision rights.

The previous template contained small-document and large-document scenarios with contributor, artifact, and time estimates. Keep those only as project-local estimates backed by a task breakdown and actual observations. For a pilot, record the scope, contributors, review dependencies, elapsed time, and what changed in the draft. A later team may reuse the estimate as a starting hypothesis, not as a staffing rule or scaling law. If parallel work is added, account for coordination and integration effort; additional contributors do not automatically increase useful coverage.

## Failure signals and possible responses

These are diagnostic hypotheses, not causal diagnoses. Check source records and work products before deciding what happened.

### Echoing language

**Signal:** Contributions repeat the same framing or cite the same evidence without independent reasoning. Check whether inputs, prompts, model families, or incentives were shared. If it matters, add a missing evidence source or affected perspective. Restarting all work is rarely justified without a specific reason.

The first-party template suggested distinct prompts and traditions, limited early cross-talk, and independent initial work as possible mitigations. Use these only if they address a specific anchoring concern. Avoid personas that caricature a discipline or pressure contributors to perform disagreement. If later shared discussion produces a common answer, inspect sources and counterexamples; similarity by itself does not show groupthink.

### Context loss

**Signal:** A later draft drops a material qualification, source, or dissent from earlier work. Keep claims linked to source passages and summarize changes at handoffs. Review the final text against those links; do not assume summaries preserve every nuance.

A targeted recovery is to reopen the exact source passage, identify which handoff omitted it, and correct the dependent claim or add a traceable qualification. Summaries and length limits can make handoffs easier to navigate, but impose no correctness guarantee; keep source access and author/provenance metadata where permitted. Restart only the affected review if a changed claim invalidates it.

The original template proposed structured summaries, targeted excerpts, and concise phase artifacts as ways to reduce overload. These methods can themselves omit nuance. Keep the full source available, identify the summary's scope and author, and check the final use against source passages rather than using a summary as the only record. Word limits are local ergonomics choices, not a correctness guarantee.

### Stalled review

**Signal:** Work waits for a person or decision without a clear owner or next action. Possible causes include a missing owner, an oversized request, an unclear deadline, or a review step that does not map to any decision. Name the responsible role, requested response, and deadline if the project has one. An expired timebox does not imply approval. The existing owner can defer, narrow, or proceed within existing authority while making unresolved risks visible.

### Complexity theater

**Signal:** Process artifacts multiply without improving the document's evidence, fairness, usability, or accountability. Remove low-value steps; preserve only records needed to trace material choices and obligations. Document length alone is not the test: a long source appendix can be useful, and a short document can hide a complicated unsupported decision.

Useful checks include asking after each stage what claim, gap, reader need, or authority decision changed. If a recurring artifact has no consumer, remove or merge it. Do not impose a rule that the final document must be shorter than all process records; source traceability may appropriately require more detail than a reader-facing charter.

### Late-stage regression

**Signal:** Final editing changes the meaning of a supported claim, removes a meaningful qualification, or erases unresolved dissent. Compare the final draft with the last reviewed version and the claim ledger. Make the narrow correction or rerun only the review affected by the change.

A limited editorial mandate can reduce accidental rewriting: identify which comments change substance, which improve clarity, and which require an owner choice. Keep a recoverable reviewed version as comparison material. It is a local control against drift, not a reason to prevent an authorized owner from changing substance.

## Meta-risk: process becomes the product

A coordination process can consume more effort than the document warrants. Warning signs include participants debating templates instead of the scoped question, a reader needing the process history to understand the result, or review cycles that do not change a claim or surface new evidence. Ask whether each step improves the draft or its accountability. If not, simplify. A raw comparison between process-document length and final-document length is only a prompt: source records may appropriately be longer than the decision document.

The final document should state what it covers, what supports its material claims, what remains uncertain, and who has authority within the declared scope. Whether it can stand alone is a useful readability test, but no format is inherently authoritative just because it is called a constitution or charter.

## Reusable design principles

The original workflow's compact summary remains useful as a set of review questions: collect perspectives before choosing a synthesis; make critique specific and constructive; use more than one integration pass only when it addresses a real risk; seek an outside perspective when it can add evidence; keep tensions visible; choose output forms for actual readers; and track failure signals with concrete mitigations. None of these steps guarantees a result, and no document type automatically needs the entire template.

- Separate evidence, interpretation, preference, and authorized decision.
- Seek independent contributions when they address a real anchoring or coverage risk.
- Invite specific critique and counterexamples; do not require disagreement or agreement quotas.
- Retain source links, material revisions, and dissent that could matter later.
- Match coordination effort to consequence, scope, and reversibility.
- Give review findings a responsible owner and explicit disposition.
- Treat this process as a tool for producing a reviewable document, not as evidence that the result is correct or binding.
