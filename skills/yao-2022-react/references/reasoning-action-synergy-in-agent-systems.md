# Reasoning/action feedback: methods and evidence boundaries

## The architectural question

ReAct augments a task's environment actions with generated language that updates the prompt context. In the paper's model, a thought changes that context but does not itself act on the environment or produce an environment observation. A subsequent action may produce an observation used in the next decision. This is a useful architecture to compare with a fixed plan or a planner/executor interface; neither is universally required or ruled out.

Source: [Yao et al., arXiv v3](https://arxiv.org/html/2210.03629v3), §§2–4 and appendices. Results below refer to the authors' configurations. The human cooking analogy motivates the paper; it does not identify a model's private cognition.

## Reason to act: propose the next information-seeking step

In the Colorado-orogeny teaching trajectory, a first observation supplies High Plains as a bridge entity. The next proposed search follows that entity, then extracts the requested elevation range. The practical sequence is:

1. declare the missing relation or property;
2. propose an allowed query to resolve it;
3. retain the returned source and observation;
4. check the proposed bridge relation;
5. use a further query or stop with the supported claim and limitations.

The generated text makes the proposed subgoal inspectable. It neither establishes the bridge relation nor proves why the action was selected. An action-only system can also implement multi-hop search and retain useful state; the paper's trace is one example, not an impossibility result about that architecture.

In ALFWorld, a plan may propose finding, taking, cleaning and placing an object. A generated list of likely locations supplies a candidate ordering, not a verified location model. The application must still check location, held-object and other preconditions before an effect and update its state from the observation. Any claimed reduction in search cost needs a measured baseline and a fixed search budget.

## Act to reason: obtain observations and validate their use

The knowledge-task environment offers three specific actions: search a named Wikipedia entity (first five sentences or five suggested entities), look up a string in the current page (next matching sentence), and finish with an answer. This deliberately limited interface is not a general modern retrieval API.

The Coster-Waldau example retrieves text about a Fox film and proposes an inference about a Fox relationship. Keep the search receipt and the proposed inference separate: an appearance credit may not support a stronger employment claim. Empty results, stale pages, ambiguous entities and unsupported joins remain possible even when every tool call succeeds.

An application can record a claim-to-receipt link, source identity/date/scope, the exact inference being checked, and support/refute/unknown. These fields are engineering additions; ReAct does not implement source authority or factual verification by itself.

## What the numerical comparisons establish

Table 1 reports PaLM-540B HotpotQA exact-match scores of 29.4 for CoT, 25.7 for Act, 27.4 for ReAct, and 35.1 for ReAct followed by CoT self-consistency. These are dataset/prompt/interface results, not causal proof that Act cannot synthesize or that one policy dominates every task.

Table 2 uses a separately selected human-analysis sample: 50 correct and 50 incorrect trajectories per method, 200 total. Among the selected correct-answer examples, the reported false-positive categories are 14% for CoT and 6% for ReAct. They are not population false-positive rates. Among selected incorrect-answer examples, the reported reasoning/search/hallucination/ambiguity percentages differ; see [failure analysis](failure-modes-and-error-propagation.md) for the sampling and rounding boundary. A displayed zero hallucination category is not a prevention guarantee.

## Architectural implications for an application

Retain feedback when the task needs it. A planner/executor split can carry preconditions, observations and recovery information; a bounded ReAct-style controller can revise a next step after each observation. Compare these designs on the target task rather than requiring one universal topology.

For a DAG or conversation implementation:

- Edges carry the request, result, supporting observation and task context. A concise public decision summary may explain the intended subgoal; do not require private chain-of-thought disclosure.
- A controller accepts or rejects proposed actions using authority, schema, state and remaining budget. Language text is not the enforcement mechanism.
- State snapshots, attempted actions, failed preconditions and outcome receipts support diagnosis even without a generated rationale.
- An authorized reviewer may amend task context or constraints. Preserve who changed what, its scope/expiry, the subsequent allowed action and observed outcome; do not rewrite historical observations.

## Structure, flexibility and switching

The authors discuss flexibility as a possible explanation of their sampled errors. Their comparison does not isolate a general causal law about structural constraints. Prompt alternation can coexist with erroneous reasoning, and direct generation can have absent or false premises.

The paper's two hybrid procedures are concrete methods to preserve:

- ReAct to CoT-SC: after failure to answer within 7 HotpotQA or 5 FEVER steps, use the CoT-SC fallback in that experiment.
- CoT-SC to ReAct: switch if the most frequent answer occurs fewer than half of the sampled answers.

These are experiment-specific policies. Agreement measures agreement, not evidence or calibrated correctness. A production fallback needs its own source requirements, authority, cost, and unknown/abstention path. It must not assert unsupported facts merely because retrieval ran out of steps.

## Sparse and dense thought placement

In the ALFWorld study, Table 3 reports averages of 57% for ReAct and 48% for the IM-style variant. The best-of-six comparison differs from these averages. The IM-style condition reannotates task trajectories with a restricted dense-feedback pattern; it is not a test of every dense trace or the whole Inner Monologue framework.

The shown ReAct text performs several roles: proposed goal decomposition, declared progress, hypothesized object locations, and search reformulation. These labels can guide a review rubric. They do not establish internal state or that sparse text alone caused the score difference.

For a new controller, decide where a public summary is useful: a new subgoal, an uncertain choice, an observed failure, or an exception. Compare sparse summaries, denser summaries and action/state-only records with equal task and resource budgets. Measure task outcome and reviewer diagnosis separately; do not assume more or less text is inherently better.

## Failure recovery as a bounded procedure

The paper includes repetitive action loops and uninformative searches. A controller can normalize the attempted action, compare the state with the preceding failed attempt, record an unmet precondition, and select an authorized alternative or stop at its configured limit. Repetition is a signal for a policy, not proof that the model has lost an internal state.

Typed absence, candidates and retrieval limits can make failure explanations more inspectable. Whether an interface change improves outcomes needs evaluation. Grounding exposes an observation to checking; it does not guarantee that the observation is relevant or correct, or that the final inference follows.

## Learning the interaction procedure

The paper reports fine-tuning PaLM-8B/62B on 3,000 generated, correct-answer HotpotQA trajectories under its Wikipedia action space. Its comparisons favor the ReAct fine-tuning configuration over the named alternatives. They do not show general cross-domain transfer or that every smaller trained model beats a larger prompted model.

For a local study, distinguish procedure candidates (query selection, bridge extraction, source checking, stopping) from memorized facts. Preserve tool versions and trajectory filtering, independently check outcomes, hold out tasks and changed interfaces, and compare cost/error metrics against matched baselines. A correct final answer does not alone verify every intermediate claim. The [learning reference](learning-reasoning-acting-patterns.md) expands this workflow.

## Transfer checklist

1. State the task, permitted actions, observations and stopping conditions.
2. Preserve request/result/state evidence; add concise public summaries where useful.
3. Identify each policy as paper-specific or an application extension.
4. Check factual support and effect completion separately from language generation.
5. Evaluate routing, summary placement and recovery on held-out tasks with matched budgets.
6. Report failures and uncertain outcomes without turning a trace, receipt or benchmark score into a general guarantee.
