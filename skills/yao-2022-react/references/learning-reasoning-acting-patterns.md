# Learning reasoning-action procedures with source and evaluation boundaries

## Paper-specific fine-tuning result

ReAct reports a HotpotQA/Wikipedia fine-tuning experiment using 3,000 generated trajectories and named PaLM configurations. Its reported comparison is evidence for that model/data/tool/prompt setup. It is not a rule that smaller fine-tuned models generally beat larger prompted models, or that a procedure transfers to arbitrary tools and domains.

## Procedures and facts have different risks

Training data can separate reusable **procedural candidates** from source facts with freshness and coverage risks.

Procedural candidates include decomposing a multi-hop question, choosing an allowed lookup, extracting a bridge entity from an observation, recording insufficient evidence, and synthesizing receipt-bound observations. Facts can be learned or memorized; the concern here is that facts may be numerous, stale, incomplete, source-specific, or unsuitable for a target task. Neither category is automatically safe.

## What the experiment evaluated

The paper's new-question evidence concerns HotpotQA questions under a Wikipedia action space. A procedure such as “search entity, extract bridge, search bridge, extract property” may be a useful hypothesis for a target system. It is not evidence that the same method works for an IMDB, company, legal, medical, or other tool contract.

A target-domain evaluation should hold out tasks, preserve exact tool schemas and sources, validate outcomes independently, measure error/latency/cost, and compare a procedure-trained variant with a baseline. Record failures where a bridge entity, source, or action contract differs.

## Bootstrapping as a testable workflow

The paper's workflow can be adapted as a proposal:

1. generate candidate trajectories under a declared generator and tool environment;
2. check final outcomes independently, rather than trusting generated rationale;
3. preserve source, license, privacy, and filtering provenance;
4. train a selected model;
5. evaluate against held-out target tasks and a baseline.

The paper's PaLM-540B/62B/8B figures are historical experiment details. Do not use them as claims about current providers or model families.

## Structure and strategy

A prompt/action interface can fix permitted action syntax, observation shape, and result labels. Training may then target decisions such as when to query, how to extract, and when to stop. Whether that division improves a deployment is an empirical claim that needs a target-task evaluation.

## Source boundary

ReAct supports the HotpotQA/Wikipedia fine-tuning and bootstrap example. It does not support broad cross-domain transfer, modern model recommendations, or a claim that memorized facts cannot be learned.
