# Declared identity / continuity / reputation plan

State source versions, access and whether every asserted fact is declared or
observed. Use a distinct issuer namespace, actor identifier, credential,
session, task/rubric, evaluator and receipt reference.

1. Lifecycle: bind credential, issue a bounded session, revoke/recover, and say
   whether an unlinked successor is new or unattributed.
2. Continuity: separately describe memory, checkpoint and outcome record.
3. Outcome: give oracle, evaluator, receipt and observation status.
4. Estimator: name topology, uncertainty/exploration field and calibration
   status. Elo/bandit require a declared exploration policy; TrueSkill requires a model-posterior status; none uses not-applicable states and representsUncertainty false.
5. Newcomer: compare reset and exclusion risk for the local policy.
6. Judge: run both orderings; retain rubric/version, result, and calibration.
7. Sanctions: state authority, appeal, and setting-specific incentives.

Use [sample-input.json](../examples/sample-input.json) as a constructed schema
example. A passing audit means declaration consistency only.
