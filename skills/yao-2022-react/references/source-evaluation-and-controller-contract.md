# Source evaluation and controller contract

## The contract around a ReAct-style prompt

The paper's Wikipedia `search`, `lookup`, and `finish` actions are a task-specific environment. A production controller must separately define tool authority, accepted request schema, source scope, receipt retention, claim validation, and abstention or escalation behavior.

A minimal record has a task ID, allowed action, request, source/observation receipt, declared decision summary, claim, validation outcome, and effect outcome if an action changes external state. A decision summary is public generated text; it is not a source or privileged evidence of private model reasoning.

## Source evaluation

For each external claim, check:
- identity and publisher of the source;
- retrieval time, query, scope, and access status;
- whether the quoted observation entails the stated claim;
- whether a conflict, missing result, or stale source requires limitation or abstention.

A model may state that an answer came from its knowledge. Logging that statement does not establish the origin of the assertion. External provenance requires a retained receipt and a claim-to-receipt validation link.

## Routing evaluation

The paper's two switching configurations are study settings: ReAct to CoT-SC after its step limits (7 for HotpotQA, 5 for FEVER), and CoT-SC to ReAct when the majority occurs fewer than n/2 times. An application may test alternative signals, but must label them local, calibrate them on held-out tasks, and define source authority, cost, and a stopping condition.

## Worked controller sequence

1. receive a factual task and choose an authorized source scope;
2. accept or reject the proposed action against schema and budget;
3. store the returned observation with source identity;
4. require a claim to identify its supporting receipt;
5. validate support, report limitations/conflict, or abstain;
6. for an external effect, record a separate outcome receipt.

This is an engineering contract inspired by the paper's interleaved pattern, not a protocol supplied by ReAct.
