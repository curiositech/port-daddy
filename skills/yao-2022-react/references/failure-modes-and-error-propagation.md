# Failure modes and evidence-preserving recovery

## What Table 2 actually supports

Yao et al. report a human study of **50 correct and 50 incorrect trajectories for each method**—ReAct and CoT—so 100 trajectories per method and 200 total. Table 2 reports author-labelled percentages in selected correct-answer and incorrect-answer subsets; the displayed 47/23/0/29 and 16/—/56/28 values are category percentages, not reconstructed raw counts or deployment rates. Because some values are not multiples of two, this reference does not infer counts.

For the selected **incorrect-answer** examples, the paper reports ReAct reasoning-error, uninformative-search, hallucination, and label-ambiguity categories as 47%, 23%, 0%, and 29%; it reports CoT reasoning, hallucination, and ambiguity categories as 16%, 56%, and 28% (no uninformative-search category is listed). For selected **correct-answer** examples, the paper reports false-positive categories of 6% for ReAct and 14% for CoT. These are paper-specific human-study results, not proof that a prompting pattern prevents hallucination.

## A failure-review record

Retain enough data to test a hypothesis about a wrong outcome:

| Field | Why it matters |
| --- | --- |
| task input and policy scope | identifies the requested claim and authorized actions |
| action request and tool receipt | separates attempted action from returned observation |
| source identity and retrieval context | supports later source checking |
| declared decision summary | records the model's public stated rationale, not private cause |
| state/precondition snapshot | lets an action-only run be debugged |
| final claim and validation result | shows whether the evidence actually supports the inference |

A generated quotation is a stated attribution. It becomes provenance only after a receipt-bound source is preserved and checked against the claim. The paper's Coster-Waldau/Fox trajectory may illustrate multi-step retrieval, but appearance in a Fox film alone does not establish every claimed employment relationship.

## Loop and search recovery

The ALFWorld action trace shows a failure to use available action/observation context: the agent takes a knife, attempts cleaning while not at a sink, and later repeats attempts. It does not establish that action-only systems have no memory or cannot be debugged. Inputs, state snapshots, tool responses, tests, and effect receipts can support diagnosis without generated rationale.

A controller can treat repeated equivalent actions with unchanged failed preconditions as a **candidate** recovery signal. A bounded procedure is:

1. normalize the attempted action and observed state;
2. compare it with the last failed attempt;
3. record the unmet precondition or unknown cause;
4. select an authorized alternative, request configured review, or stop at an application-owned budget.

The public ReAct-style progress statement can help a reviewer see the proposed next subgoal. It does not enforce the precondition; the controller does.

The paper's Front Row example illustrates that an uninformative search can derail a trajectory. This motivates a design hypothesis: an interface that returns typed absence, candidates, and retrieval limits may make recovery easier than one that returns opaque failure. Measure that hypothesis on the named interface; no API shape guarantees higher success.

## Evidence checking has residual risk

In the paper's Wikipedia action space, a prompted ReAct trajectory interleaves generated thoughts, search/lookup actions, and observations. An approved evidence path can expose unsupported factual claims, but an observation can be incomplete, stale, wrong, irrelevant, or support only part of an inference. Neither a CoT answer nor a ReAct trace guarantees that an error is visible.

For consequential claims, bind a claim to a source receipt, check entailment at the stated scope, and define conflict/unavailable/abstention handling. This is an application control around a model, not a result guaranteed by ReAct.

## Structure and flexibility

The paper discusses a tradeoff in its evaluated prompting settings: interleaving can make observation-driven revisions available while constraining how generated text is formatted. Do not convert the reported category percentages into a general reliability law. Compare a bounded interleaved policy and another policy on the same tasks, prompts, tools, sources, budgets, and validation metric.

## Review signals and limits

Signals such as repeated failures, empty observations, missing receipts, or contradiction between a claim and a receipt can trigger a separately specified response. Monitoring supplies a signal; it does not itself prevent propagation or repair the error. Report the observed signal, response, and outcome.

## Source boundary

This reference relies on ReAct arXiv v3 §3.3/Table 2 and its task examples. It does not provide current provider behavior, universal error rates, or a general hallucination-elimination mechanism.
