# Problem Decomposition Through Explicit Subgoaling: How Thoughts Create Structure

## The Decomposition Challenge in Complex Multi-Step Tasks

A central challenge in agent systems is decomposition: how do you break a complex task into tractable subtasks? Traditional approaches use hierarchical planning (generate a high-level plan, then refine each step) or learned decomposition (train models to predict subtask sequences). The paper illustrates one way to use explicit language in a task-solving trajectory: state a proposed subgoal, act, and then use the next observation to continue or revise. The shown trace is an example, not evidence that this pattern always tracks progress or causes success.

Consider the ALFWorld task: "put a clean knife in countertop." This requires finding a knife, taking it, cleaning it in a sinkbasin, navigating back to a countertop, and placing it. The shown act-only trajectory runs into trouble—the agent finds a knife, tries to clean it before reaching the sinkbasin ("clean knife 1 with sinkbasin 1" while standing at countertop 2), gets "Nothing happens," and enters a failure loop.

The paper's shown ReAct trajectory uses explicit subgoal text:
- **Initial decomposition**: "To solve the task, I need to find and take a knife, then clean it with sinkbasin, then put it in countertop."
- **Subgoal instantiation**: "First I need to find a knife. A knife is more likely to appear in cabinet (1-6), drawer (1-3), countertop (1-3)..."
- **Progress tracking**: "Now I find a knife (1). Next, I need to take it."
- **Subgoal transition**: "Now I take a knife (1). Next, I need to go to sinkbasin (1) and clean it."
- **Completion recognition**: "Now I clean a knife (1). Next, I need to put it in/on countertop 1."

In this shown trajectory, the text labels an intended subgoal and the subsequent actions and observations can be inspected against it. A generated marker does not establish the environment state, that the marker caused the action, or that every trace tracks progress.

## What the shown trajectory illustrates about subgoal context

In the paper’s shown Act-only trajectory, after taking the knife the agent attempts to clean it before moving to the sinkbasin; the environment responds “Nothing happens.” The action/observation context is present, but this particular run does not use it to select the needed navigation step. This trace does not identify the model’s private cause for the error.

The failure cascades: after "Nothing happens," the agent goes to countertop 3, tries to take knife 2 (which it doesn't need, and which fails because it's already holding knife 1), goes back to countertop 2, tries to take knife 1 again (fails—already holding it), returns to countertop 1, attempts to clean knife 1 with sinkbasin 1 again (fails—wrong location). This loop repeats until timeout.

In the shown ReAct trajectory, the text says “Next, I need to go to sinkbasin (1) and clean it,” and the following actions visit the sinkbasin before cleaning. This one sequence does not isolate why the later action was selected. In an application, treat the sentence as a plan proposal: check location and task preconditions against controller-owned state before authorizing the action.

## Commonsense Reasoning as Search Space Reduction

A powerful form of decomposition in ReAct is using commonsense knowledge to prune search spaces. When looking for a knife, rather than exhaustively searching every location, the agent reasons: "A knife is more likely to appear in cabinet (1-6), drawer (1-3), countertop (1-3), fridge (1), garbagecan (1), shelf (1-3), sinkbasin (1), stoveburner (1-4), toaster (1)."

The quoted ordering is the model’s proposed search preference in this example, not an observed location fact or verified world model. The controller may use it as a bounded search order only if the task permits; observations must update that order, and an exhausted list means unknown rather than “not present.”

As an application design, a generated location preference can be a hypothesis for a bounded search order. Validate the result against observations, record what was not searched, and do not treat a proposed order as a verified fact or as a substitute for controller constraints.

## Multi-Hop Reasoning as Sequential Subgoal Refinement

In HotpotQA, decomposition takes the form of **sequential information-seeking subgoals**. Consider: "What is the elevation range for the area that the eastern sector of the Colorado orogeny extends into?"

The reasoning unfolds:
1. **Initial decomposition**: "I need to search Colorado orogeny, find the area that the eastern sector extends into, then find the elevation range of the area."
2. **First observation processing**: "It does not mention the eastern sector. So I need to look up eastern sector." (Refining the search strategy based on what's missing)
3. **Information extraction and next subgoal**: "The eastern sector of Colorado orogeny extends into the High Plains. So I need to search High Plains and find its elevation range."
4. **Search refinement**: When "High Plains" returns ambiguous results, the agent reasons: "I need to instead search High Plains (United States)."
5. **Answer synthesis**: "High Plains rise in elevation from around 1,800 to 7,000 ft, so the answer is 1,800 to 7,000 ft."

In this shown HotpotQA trajectory, a missing detail in the first observation leads to a reformulated lookup; a later observation supplies “High Plains,” which becomes the next search target. This demonstrates one example of adapting a proposed subgoal to returned text. It does not establish that the observation is authoritative or that this strategy generalizes.

## Contrast with Inner Monologue: Dense feedback and subgoal text

The paper compares ReAct with an Inner Monologue (IM)-style prompt in its ALFWorld experiments. In the shown IM-style example, the text repeatedly restates the top-level goal: "I need to find a clean knife." -> observation -> "I need to find a clean knife." -> observation -> "I need to find a clean knife."

In this excerpt, the text repeats the goal instead of naming a changed subgoal. This describes the displayed example; it is not a general characterization of every IM run.

The paper’s shown ReAct trace, by comparison, contains these elements:

1. **States an intended order**: the shown text moves from finding and taking a knife to visiting the sinkbasin, cleaning, and placing it. The order remains a proposal until state checks pass.

2. **Names a next step**: for example, “Now I take a knife (1). Next, I need to go to sinkbasin (1).” Compare that declaration with the following observation rather than treating the declaration as ground truth.

3. **Proposes a search preference**: the knife-location list suggests a search order; the environment observation, not the preference, determines whether an item was found.

The paper reports these results for its ALFWorld setup. They do not isolate one universal cause or establish that a future dense trace will fail; compare prompt, model, tool interface, and evaluation conditions.

## Implications for Task Decomposition in Agent Systems

For a DAG-based application, the following are design options to evaluate:

**1. Explicit subgoals as node annotations**: In a task execution DAG, nodes shouldn't just represent actions ("search X", "click Y"). They should be annotated with their subgoal purpose: "Find entity X to extract attribute Y for final goal Z." This context helps downstream nodes understand why an action was taken and what to do with its results.

**2. Progress annotations**: A generated note such as “Subgoal 1 proposed complete” can help reviewers, but should supplement a controller-owned state record. Mark the evidence or observation that supports a completion update.

**3. Candidate search order**: A model may propose likely locations, but test the ordering against environment observations and a declared search budget; the paper does not establish reduced effort for a new environment.

**4. Adaptive decomposition**: Don't fix the entire task structure upfront. Allow subgoals to emerge from observations. After each action, ask: "Given what we observed, what should we do next?" rather than rigidly following a predetermined plan.

**5. Repeated-step review**: Repeated text or actions can be a local loop signal. If an application uses a repetition threshold, define it as a local policy and compare against the controller’s state and observations; repetition alone does not prove failure.

## When Explicit Decomposition Fails

The paper identifies failure modes that constrain decomposition's effectiveness:

**Reasoning-error category (paper’s sampled analysis)**: the paper includes repetitive action loops among categorized errors. An explicit subgoal can be followed by a different action; neither the text nor the controller should mark progress without checking the resulting state.

For an application, decomposition is one input to action selection. A controller may constrain candidates using a validated current state and declared goal; do not derive permission solely from the generated subgoal sentence.

**Search-result category (paper’s sampled analysis)**: empty or uninformative results were counted separately. Such results may leave the next subgoal unresolved; retain the observation and allow reformulation, another authorized source, or an unknown outcome.

For a new system, test whether its observations contain the fields needed to revise a subgoal. Low-signal results can make revision harder, but the effect depends on the task and available alternatives.

**Observed tradeoff in the sampled analysis**: Table 2 reports different reasoning-error categories for ReAct and CoT in the authors’ selected trajectory sample. The paper discusses structure/flexibility as a possible tradeoff; it does not show that ReAct prevents creative reasoning in general. Compare the procedures on the target task.

Whether to use explicit subgoals is an application choice. Compare it with a suitable baseline on the same task instances, outcome checks, and resource budget.

## Scaling Decomposition: From Few-Shot to Fine-Tuning

In the paper’s few-shot experiments, ReAct prompt performance varies by task, model, and baseline; the authors discuss difficulty learning both reasoning and acting from demonstrations. Do not infer a general causal law from the selected comparison.

In one HotpotQA fine-tuning comparison, the authors report that ReAct-trained smaller models performed better than the prompting baselines they tested. Their explanation is that training information-access behavior may generalize better than memorizing facts; this is the authors’ interpretation, not a transfer result across tasks.

For an application, compare annotations that teach reusable retrieval/subgoal procedures with answer-only supervision. Measure transfer on held-out tasks and interfaces; the paper’s single HotpotQA fine-tuning comparison does not establish that decomposition annotations transfer better.

## Transferable Principles for WinDAGs

1. **Record proposed subgoals** alongside the controller-owned state and supporting observation.

2. **Use hypotheses to prioritize search**: label a generated location preference as a hypothesis and revise it from observations.

3. **Allow adaptive decomposition**: Let subgoals emerge from observations rather than fixing them upfront.

4. **Measure declared progress** against state transitions; repeated wording can trigger review under a tested local policy, not an automatic failure verdict.

5. **Choose structure from task evidence**: compare explicit subgoals, fixed plans, and bounded exploration against a defined task metric.

6. **Evaluate decomposition supervision** against answer-only or other baselines on held-out tasks; no transfer advantage is assumed.
