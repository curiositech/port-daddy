# Task-overlap evaluation protocol

## Unit, labels, and adjudication

Compare current, authorized task records rather than prefixes or owner identities. A label uses objective, deliverable, acceptance conditions, scope, purpose, dependencies, and work version:

- `same_task`: same required deliverable and acceptance scope, including paraphrases;
- `partial_overlap`: shared invariant or prerequisite with material distinct work;
- `related_distinct`: shared topic/artifact but different deliverable, purpose, or acceptance;
- `insufficient_evidence`: missing, unauthorized, stale, or version-incompatible records.

Owner difference is not a hard negative. Preserve reviewer rationale and disagreement; reconcile a changed requirement first.

## Candidate recall before verdict precision

Candidate-generation recall is the number of labeled positive eligible pairs retrieved divided by all labeled positive eligible pairs in the stated evaluation frame. Report same-task and partial-overlap recall separately, rather than silently merging their positives. Adjudicator precision uses labeled true positives among predicted positive candidates. Report missing labels, sampling and unavailable comparisons separately; all eligible pairs are not the recall denominator. If all pairs cannot be labeled, state sampling frame, inclusion probabilities, and limits. Unknown and noncandidate outcomes are coverage limits, not proof of distinct work.

Split connected components of pair links and shared task records together; keep versions/paraphrases in one split. Tune representation, retrieval depth, fusion constant, and review workflow only on development data. Any policy changed after examining holdout consumes it.

| Claim | Evidence to retain |
| --- | --- |
| Candidate eligible | authorization, scope, current version, spaceId |
| Candidate retrieved | rank lists, ranks, policy/index version |
| Pair adjudicated | shown fields, label, rationale, disagreements |
| Coverage described | eligible, unknown, no-candidate counts |
| Cost described | measured local environment and results |

No universal threshold, precision, recall, token checkpoint, or latency is supplied. Shadow notifications leave effect authority outside this skill.

## Candidate Book material

A case study could distinguish “no candidate” from “no overlap” when scope, versions, and spaces gate comparison. It is an evaluation-design observation, not a novel empirical result.
