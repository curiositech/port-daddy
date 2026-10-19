# The Gap Between Knowing and Doing: ReAct Examples of Reasoning and Action

## The Two Knowledge Sources: Internal Models vs External Environments

One useful way to analyze the paper’s examples is to distinguish model-generated content from observations returned by an external environment. These sources have different access and validation properties:

**Internal generation (model parameters)**: Produces text without an external retrieval call in these prompting examples. Its contents may be stale, incomplete, or wrong for a given claim; temporal coverage and error behavior are model- and task-specific.

**External observations (environments, APIs, databases)**: Require an action to access and may add latency or be limited in scope. They can provide attributable observations, subject to source authority, retrieval time, access scope, and validation. A tool response is not automatically ground truth or necessarily current.

The paper compares specific prompting methods and reports sampled error categories; those results do not establish a universal knowledge deficit or that Act lacks reasoning in general. In the shown HotpotQA trace, the Act baseline retrieves information but does not produce the needed final synthesis. Evaluate that failure mode on the target task instead of inferring it from the method label.

## Case Study: Outdated Knowledge and Temporal Grounding

Figure 4 provides one historical example used by the authors to illustrate a knowledge/action difference. The question: "How many rooms are in the hotel that is home to the Cirque du Soleil show Mystere?"

**CoT's approach** (pure internal knowledge):
"Let's think step by step. The hotel that is home to the Cirque du Soleil show Mystere is Treasure Island. Treasure Island has 2,885 rooms, so the answer is 2,885."

This is a historical paper example. Its apparent answer and source snapshot should not be treated as current hotel information.

The paper shows the CoT answer differs from the ReAct trace’s retrieved room count. The cause is not established by that example; a stale premise is one possible explanation. Neither number should be treated as current without checking an authoritative source and its retrieval date.

**Act’s shown approach** (action-only prompting):
The paper’s trace searches for the show and hotel, then does not make the final connection needed for the answer in that example. The Wikipedia API returns text from the paper’s historical experiment; this does not establish that the information is up to date now or that action-only prompting generally cannot synthesize.

**ReAct's shown approach** (interleaved generated text and external observations):
1. Internal reasoning: "I need to search Cirque du Soleil show Mystere, find the hotel it is in, then find the number of rooms in the hotel."
2. External action: Search[Mystere Cirque du Soleil]
3. Observation: "Mystère... Held in a custom theatre at the Treasure Island Hotel and Casino..."
4. Internal reasoning: "Mystere is held in a custom theatre at the Treasure Island Hotel and Casino. So I need to search Treasure Island Hotel and Casino next and find the number of rooms in the hotel."
5. External action: Search[Treasure Island Hotel and Casino]
6. Observation: "Treasure Island Hotel and Casino... with 2,884 rooms and suites..."
7. Internal reasoning: "Treasure Island Hotel and Casino has 2,884 rooms and suites. So the answer is 2,884."

In the shown ReAct trace, the model proposes a search target, receives a Wikipedia observation, proposes another search, and then states an answer. This illustrates one combined trajectory. It does not show that either reasoning or retrieval is universally necessary or sufficient; check source authority, date, and support for each factual claim.

## The Confidence-Based Switching Strategy

The paper evaluates two switching procedures; the following describes their paper-specific form, not a universal confidence threshold:

**CoT-SC → ReAct**: "When the majority answer among n CoT-SC samples occurs less than n/2 times (i.e. internal knowledge might not support the task confidently), back off to ReAct."

This can be used as a routing signal after calibration; sample agreement is not a factual-confidence guarantee. In the paper configuration, a majority below n/2 triggers a switch. Agreement is a routing feature that needs task calibration; it does not show internal knowledge is reliable or unreliable.

**ReAct → CoT-SC**: "When ReAct fails to return an answer within given steps, back off to CoT-SC."

This is the paper’s tested routing rule, not a guarantee that the internal fallback has adequate evidence. If retrieval is incomplete or unavailable, an application may try a separately authorized route or return unknown/abstain; do not convert fallback generation into factual verification.

In the paper’s Table 1 configurations, each combined route scores above the corresponding standalone methods on these task metrics:
- HotpotQA: ReAct alone (27.4), CoT-SC alone (33.4), ReAct→CoT-SC (35.1), CoT-SC→ReAct (34.2)
- FEVER: ReAct alone (60.9), CoT-SC alone (60.4), CoT-SC→ReAct (64.6), ReAct→CoT-SC (62.0)

These reported comparisons are specific to the paper's prompts, models, retrieval environment, datasets, and metric. They motivate an ablation, not an expected deployment result.

## What This Means for Agent Architectures

A possible application is to treat the paper’s switching signals as candidate routing features, then evaluate them locally:

**Candidate routing features to evaluate by confidence and task characteristics**:
- Deduction from explicit checked premises → compare direct derivation and a suitable checker; agreement does not certify the premises
- Unresolved factual claim → compare an authorized evidence query with an unknown/abstention response
- High-consequence factual claims → use an authorized, fit-for-purpose evidence process and an independently defined review or abstention path
- Freshness-sensitive claims → use a fit-for-purpose authorized evidence process where available, with conflict/unavailable/abstention paths
- Multi-source synthesis → retain source-specific receipts and check the proposed joins

This isn't a fixed architecture but an adaptive routing decision. The system must assess:
1. **How confident is internal knowledge?** (via self-consistency, calibration, or uncertainty estimation)
2. **What does the task require?** (fact retrieval vs logical deduction vs synthesis)
3. **What are the stakes?** (exploratory vs high-consequence decisions)
4. **What's the cost of external interaction?** (latency, API costs, rate limits)

For WinDAGs orchestration, one design option is to declare evidence requirements and uncertainty status separately. A skill can request an authorized source when freshness matters and report a locally evaluated uncertainty signal; neither declaration establishes evidence or calibrated confidence.

## The Provenance Problem: Tracking Knowledge Sources

The Nikolaj Coster-Waldau example distinguishes a generated attribution from its supporting evidence. The trace itself does not provide a verified provenance record. It states:

Claim: "Nikolaj Coster-Waldau worked with the Fox Broadcasting Company."

ReAct reasoning: "Because he 'appeared in the 2009 Fox television film Virtuality', he should have worked with the Fox Broadcasting Company."

Quotation marks show stated attribution in generated text. Verified provenance additionally needs the retrieved source, identifier, scope, and a check that it supports the claimed inference. A system could parse this to extract: 
- Claim: "worked with Fox Broadcasting Company"
- Evidence: "appeared in the 2009 Fox television film Virtuality"
- Source: Wikipedia search for "Nikolaj Coster-Waldau"

If an application stores claim-to-receipt links and validation results, reviewers can use them to:

**Verification**: A human or another agent can check the source. Does Wikipedia actually say this? Is the inference valid?

**Updating**: If the source information changes, dependent conclusions can be invalidated and revised.

**Trust assessment**: Different sources have different reliability. Record the actual source identity, publisher, version or retrieval time, access authority, and any validation performed. Source category alone does not establish reliability for a particular claim.

**Debugging**: When an answer is wrong, trace back through provenance to identify where the error originated. Was the source wrong? Was the extraction wrong? Was the reasoning wrong?

For agent systems, make provenance an explicit, queryable record: Store a claim-to-receipt link with source identity, retrieval context, and validation result. A generated citation alone is not provenance.

## The Synthesis Challenge: Combining Multiple External Sources

The paper’s Colorado orogeny example shows one multi-hop trajectory using two Wikipedia observations. The question in that example is answered by:
1. Search "Colorado orogeny" → extract "eastern sector extends into High Plains"
2. Search "High Plains (United States)" → extract "rise in elevation from 1,800 to 7,000 ft"
3. Synthesize: "High Plains rise in elevation from 1,800 to 7,000 ft, so the answer is 1,800 to 7,000 ft."

In this example, the final response combines two observations: one names High Plains as the relevant area; another gives its elevation range. The trace shows a proposed connection between them. A real application still needs to check that both receipts are authoritative, current enough, and actually support the final inference.

In the paper’s example, the action-only trace does not produce that synthesis. This single trajectory does not show that Act generally fails at synthesis or that a visible reasoning trace is required; compare methods and synthesis checks on the target workload.

For an application, keep claim-to-receipt links and make the inference between sources explicit enough to review. A written reasoning step is a proposal; validate the source relation and final claim independently.

## When Internal Knowledge Is Actually Better

The paper’s HotpotQA prompting results report CoT at 29.4 and ReAct at 27.4 under its metric and setup. This comparison shows that retrieval did not improve that score in this configuration; it does not prove a general reason for the difference.

1. **Possible explanation from the paper**: the authors discuss flexibility as a tradeoff of interleaving actions and reasoning. Treat it as a hypothesis about this setup, not a universal causal account.

2. **No retrieval call in this procedure**: CoT avoids retrieval-specific latency or empty-result failures, but its premises may be absent, stale, or wrong. Availability of generated text is not availability or correctness of the facts it states.

3. **Efficiency**: CoT requires no external calls, reducing latency and cost.

In the paper’s selected HotpotQA trajectory sample, the authors report different hallucination and reasoning-error categories for CoT and ReAct. These hand-coded categories characterize that sample; they do not establish that CoT is better for all deductions or that its premises are well established.

A local test may compare direct reasoning over explicit premises with retrieval-assisted methods. Do not assume a premise is in the model’s training data or correct because it is familiar, and use an exact solver or proof checker when the task admits one.

The appropriate evidence route depends on the claim, task, and authority policy. Freshness-sensitive or consequential claims may require a designated source, review, or abstention path. A deduction is only as sound as its premises and inference; “common knowledge” is not an evidence class that guarantees correctness.

## The Fine-Tuning Reversal: Learning to Bridge the Gap

An interesting finding: while ReAct underperforms CoT and Act in few-shot prompting with smaller models, the paper’s 3,000-trajectory HotpotQA/Wikipedia fine-tuning comparison favored ReAct in that setting (Figure 3).

The paper's explanation: "teaching models to memorize (potentially hallucinated) knowledge facts" (CoT/Standard) is less generalizable than teaching "how to (reason and) act to access information" (Act/ReAct).

This is a result in the paper’s 3,000-trajectory HotpotQA/Wikipedia fine-tuning comparison, not a general transfer study. The authors hypothesize that training access behavior may generalize better than memorized facts. For a new system, treat that as a hypothesis and evaluate on held-out tasks, interfaces, and distributions.

For agent systems, training data can distinguish retrieval, extraction, and synthesis from source facts. A medical workflow also requires governed sources, task-specific evaluation, and clinical oversight; a trace pattern does not establish medical correctness or authorization.

## Transferable Principles for WinDAGs

1. **Evaluate routing features locally**: use task signals, evidence authority, cost, and stopping conditions; agreement is not factual confidence by itself.

2. **Separate attribution from provenance**: record a model-declared source attribution as such. For external evidence, bind a source receipt to each supported claim and record validation; internal generation does not create an external receipt.

3. **Design for multi-source synthesis**: Record how a proposed conclusion relates to each source, then check the relation and conclusion.

4. **Use fit-for-purpose evidence for claims whose freshness or consequence warrants it**: document source authority, retrieval scope, validation, and abstention or review conditions.

5. **Expose uncertainty status carefully**: If an agent reports a confidence-related signal, identify how it was produced and whether it was evaluated; a declaration alone is not evidence.

6. **Separate reusable procedures from source facts**: train and evaluate each with provenance, applicability limits, and a task-specific test set.

7. **Expose evidence status**: show whether a claim has a linked, checked external receipt, only a declared attribution, or no source record. Do not present inferred origin as known provenance.
