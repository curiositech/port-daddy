# Human Interpretability and Controllability: What Explicit Reasoning Can Expose

## What the Paper Claims and What the Trace Shows

The ReAct paper presents human interpretability and controllability as motivations for its visible trajectories, and reports comparisons under its tested tasks and configurations. The traces expose generated text alongside actions and observations; whether that helps reviewers diagnose a target system is an empirical question.

Compare two trajectories on the same task:

**Act-only (no reasoning)**:
```
search[Colorado orogeny]
lookup[eastern sector]
search[High Plains]
search[High Plains (United States)]
finish[1,800 to 7,000 ft]
```

**ReAct (with reasoning)**:
```
think[I need to search Colorado orogeny, find the area that the eastern sector extends into, then find the elevation range]
search[Colorado orogeny]
think[It does not mention the eastern sector. So I need to look up eastern sector]
lookup[eastern sector]
think[The eastern sector extends into the High Plains. So I need to search High Plains and find its elevation range]
search[High Plains]
think[I need to instead search High Plains (United States)]
search[High Plains (United States)]
think[High Plains rise in elevation from around 1,800 to 7,000 ft, so the answer is 1,800 to 7,000 ft]
finish[1,800 to 7,000 ft]
```

The Act-only trace records the shown actions without a displayed rationale. A reviewer may form hypotheses about the sequence, for example:
- Why did it look up "eastern sector"? (Because initial search didn't mention it)
- Why did it search for "High Plains"? (Because that's where the eastern sector extends)
- Why "High Plains (United States)"? (Because "High Plains" was ambiguous)

These explanations are hypotheses, not facts recoverable from the action list alone. Missing rationale can make some questions harder to investigate, although requests, responses, state, and outcomes can also help diagnose failures.

The ReAct trajectory adds generated rationale text. Each displayed thought states a proposed rationale; reviewers can inspect it but it does not prove a private causal process:
- **Intent**: What the agent is trying to accomplish ("find the area that the eastern sector extends into")
- **Strategy**: How it plans to accomplish it ("search X, then search Y")
- **Interpretation**: What it learned from observations ("The eastern sector extends into the High Plains")
- **Adaptation**: Why it's changing approach ("I need to instead search High Plains (United States)")
- **Conclusion**: How it arrived at the answer ("High Plains rise in elevation from 1,800 to 7,000 ft, so the answer is...")

A reviewer can inspect the stated goal, tool calls, observations, and conclusion to form testable hypotheses about an error. The trace is useful diagnostic context, not a faithful causal account of model internals or a guarantee of exact error localization.

## Failure Diagnosis: Where Did It Go Wrong?

To illustrate one possible diagnostic use, consider the paper’s FEVER task and a hypothetical incorrect label for the claim "Soyuz was part of the American space program":

**ReAct trajectory**:
```
think[I need to search Soyuz and find if it was part of the American space program]
search[Soyuz]
observe[Soyuz is a transliteration...]
think[It does not mention the American space program, so I need to search "American space program"]
search[American space program]
observe[The space policy...]
think[It does not mention Soyuz, so I am not sure if this claim is true or not]
finish[NOT ENOUGH INFO]
```

The excerpted trajectory ends with NOT ENOUGH INFO. It is an example of that task label, not proof that the model found all relevant evidence. If a related run incorrectly finished with SUPPORTS, a reviewer could ask:

1. Did it search the right entities? (Yes—Soyuz and American space program)
2. Did the observations contain relevant information? (Check Wikipedia—are the observations accurate excerpts?)
3. Did it correctly interpret the observations? (Look at "think" steps—did it extract the right facts?)
4. Did it reason correctly from facts to conclusion? (Does "It does not mention Soyuz" logically lead to "SUPPORTS"? No—reasoning error.)

The declared trace can structure a diagnostic review, alongside inputs, state, tool receipts, and outcome checks.

Compare with Act-only:
```
search[Soyuz]
search[American space program]
finish[SUPPORTS]
```

An action-only trace does not answer these questions by itself. The missing displayed rationale may leave fewer hypotheses to inspect, but action-only runs can also be debugged with inputs, tool requests and responses, state snapshots, outcome tests, and effect receipts.

For agent systems, a generated rationale may be one debugging artifact. Log it with inputs, tool results, state, and outcome checks, and measure whether it improves diagnosis on representative failures.

## One bounded human intervention in the paper

Appendix A.3 and Figure 5 show a human editing prompt-context text in one ALFWorld trajectory; the paper presents this as a behavior-correction example, not a general controllability result.

**Original trajectory (fails)**:
- Finds keychain 3 in drawer 4, alongside watch 2
- Thinks: "Now I find the first keychain. Next, I need to take it. I can find the second keychain later in drawer 4."
- Puts first keychain in safe
- Thinks: "Now I put the first keychain in safe. Next, I need to find the second keychain. I can directly go to drawer 4."
- Goes to drawer 4
- Observes: just a watch (no keychain)
- Attempts to take keychain from drawer 4
- [Fails—no keychain there, gets stuck]

**Human-edited trajectory (succeeds)**:
- [Same initial steps]
- Edited thought: "Now I put the first keychain in safe. Next, I need to find the second keychain, which is more likely to appear in dresser, garbagecan, safe, sidetable, sofa, shelf."
- Goes to dresser
- Finds second keychain
- Takes it and puts in safe
- [Success]

The paper shows a human intervention that replaced two prompt-context thoughts:
1. Replaced a generated location expectation "I can find the second keychain later in drawer 4"
2. Added commonsense guidance about where keychains are likely to appear

In the paper's shown run, replacing the text supplied to the next prompt was followed by a different trajectory. That is an intervention on task context, not evidence that the text was the model's persistent belief state or that it controls every later behavior. The shown subsequent trajectory visits a dresser and obtains the item. This observed sequence does not establish a persistent belief, the edit’s private causal role, or a general control effect.

This is fundamentally different from editing actions. If a human edited the action sequence directly:
```
Original: go to drawer 4
Edited: go to dresser
```

This replaces one action in a constructed alternative. Neither variant reveals a verified belief state; both need state and outcome checks. Editing task context was followed by a changed trajectory in the reported run. That observation does not isolate the edit as the sole cause or establish that such an edit will reliably control another run. An application should validate each proposed next action and separately record whether the intended effect occurred.

## What the example contains

The paper’s example contains these observable properties; none guarantees a general control effect:

**1. Thoughts are generated trace text**: the displayed sentence is an input/output artifact that may guide a later prompt. It does not establish a belief state or knowledge update.

**2. Context is conditional**: later prompts may include earlier text and observations, but a model can ignore, reinterpret, or contradict them. Test an intervention against observed actions rather than assuming downstream control.

**3. Actions need an external gate**: a generated subgoal may inform action selection, while authorization, tool schemas, and outcome checks remain outside the language trace.

**4. The visible text is mechanically editable**: changing prompt text is a straightforward interface operation. Domain knowledge alone does not establish authority, correctness, or control; validate the proposed next action and outcome separately.

For agent systems, expose an editable **task-context proposal** with its author, scope, and expiry. A domain expert may provide authorized facts, constraints, or a review decision; medical and legal work additionally needs approved sources, domain policy, independent validation, and accountable review. Editing text is not professional authorization or a safety control.

## Visibility and its evidence limits

The authors present visible trajectories as an interpretability and trustworthiness motivation. A visible trace can support inspection; transparency alone does not establish trustworthiness or source provenance.

**Stated attribution versus verified provenance**: a generated quotation is a model’s stated attribution. Record a receipt-bound source ID, retrieval context, and validation separately. The cited observation may support only part of the Fox inference.

**Declared rationale**: reviewers can inspect stated steps and test their premises/inferences; visibility alone does not prove the inference or causal mechanism.

**Error evidence**: observations, actions, and declared rationale may reveal useful discrepancies; coverage and diagnosis remain incomplete. A recorded search failure or irrelevant result may be visible if the trajectory captures it. Reviewers still need to check coverage and relevance; absence of a useful observation does not prove that the agent recognized missing information.

**Intermediate outputs**: a recorded trajectory can support a task-specific review or partial-credit rubric, provided that the rubric names evidence and does not infer hidden cognition. ("the agent did 4 out of 5 steps correctly, failing only on the last search") rather than just binary success/failure.

For consequential applications, preserve an auditable record of inputs, sources, tool calls, approvals, and outcomes. A generated trace can be one review artifact, but it does not by itself establish why a model acted, compliance, or safety.

## Limitations of Interpretability: When Reasoning Is Still Opaque

The paper is honest about limitations. Not all reasoning is interpretable:

**1. Reasoning can be wrong**: Incorrect explicit reasoning may look authoritative and could mislead a reviewer. Measure reviewer performance rather than assuming visible text helps or harms.

**2. Trace length can affect review**: Compare reviewer accuracy and time across trace lengths and presentation formats; the paper does not establish a universal relationship between length and interpretability.

**3. Natural language is ambiguous**: A thought like "I need to find X" might mean "I need to search for X" or "I need to receive X as input" or "I need to create X." The intended interpretation isn't always clear.

**4. Model reasoning may not match human reasoning**: The model might generate reasoning traces that satisfy the prompt structure but don't reflect its actual "decision process" (to the extent language models have decision processes). The reasoning might be post-hoc rationalization rather than genuine deliberation.

**5. Selective reasoning**: ReAct shows only explicit thoughts. Implicit reasoning (in forward passes, attention patterns, hidden states) is still opaque. The explicit reasoning might not capture all factors influencing decisions.

For agent systems, these limitations suggest:

- Don't blindly trust explicit reasoning—verify it, especially for high-stakes decisions
- Summarize or hierarchically display long reasoning traces for human review
- Standardize reasoning language to reduce ambiguity
- Evaluate whether a bounded context edit changes observed behavior under a controlled fixture; a change is evidence of influence in that fixture, not proof of faithful causal explanation.
- Complement reasoning trace interpretability with other interpretability tools (attention visualization, feature attribution)

## Controllability: From Passive Observation to Active Direction

A visible trace can help a reviewer form hypotheses about behavior. A proposed intervention may influence a later action, but neither visibility nor an edit guarantees that the agent will do something different.

The ReAct paper reports one bounded thought-editing intervention. It does not establish general controllability. Other application control surfaces can be designed and tested:

**1. Goal proposal**: submit a typed, authorized task constraint such as `validate_inputs=true`; the controller records who supplied it and rejects unsupported or out-of-scope fields before the next tool call.

**2. Strategy proposal**: select an allowed search ordering and log its evidence basis; do not treat a generated preference as verified world knowledge.

**3. Constraint addition**: set a controller-owned request budget from configured service limits; a prose number is not an enforceable rate-limit policy.

**4. Evidence injection**: attach a source-qualified environment fact to the task context and mark it as a hypothesis until an observation supports it.

**5. Exception handling**: route an observed error through a typed recovery policy. A backup data source needs separate authority, compatibility checks, and an outcome receipt; a generated explanation cannot authorize it.

For agent orchestration, task-context amendments are a reviewed control surface: bind a proposer and expiry, validate the next permitted action, and retain an outcome receipt. They are not permission to infer hidden reasoning or to make an unapproved external change.

## Transferable Principles for WinDAGs

1. **Record inspectable operational evidence**: log task context, actions, observations, source IDs, approvals, and outcomes; retain a concise decision summary only when it helps review.

2. **Structure reasoning for reviewability**: Use consistent formats, hierarchical organization, clear intent statements.

3. **Enable bounded context amendments**: accept authorized, typed constraints or evidence additions, then validate the next tool call independently.

4. **Keep attribution separate from provenance**: a model-declared attribution is not a verified origin. Link external claims to retrieved source receipts and their validation; mark internal or unknown origin as declared/unknown rather than inventing a citation.

5. **Support reviewed context proposals**: let an authorized reviewer propose a context edit, then validate the next permitted action and record the outcome. Measure effects on the tested task; do not promise redirection.

6. **Design for diagnosable failures**: retain correlation IDs, inputs, tool responses, state transitions, and outcome checks so action-only and trace-bearing runs are both debuggable.

7. **Balance explicitness and conciseness**: Make reasoning clear but not so verbose it's unreadable.

8. **Test intervention effects carefully**: compare controlled fixtures and report the observed change; this is not proof that a public trace reveals hidden reasoning.

9. **Complement with other interpretability tools**: Reasoning traces are powerful but not sufficient—use multiple interpretability approaches.
