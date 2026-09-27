# Agent Identity, Continuity & Reputation

Start in [SKILL.md](SKILL.md): record issuer, actor, key and session separately,
then attribute outcomes before selecting an estimator. The CLI checks supplied
declarations. It has no external access and does not prove a delivery,
credential, signature, calibration, or enforcement.

The tools require Node 20 or newer and Ajv 8. Install dependencies in this
bundle with your normal Node package workflow, then run:

    node scripts/reputation_soundness_audit.mjs --input examples/sample-input.json
    node --test tests/reputation_soundness_audit.test.mjs

The schema deliberately permits extra properties. It rejects missing required
declarations, blank required strings, and invalid enum values. CLI exit status is
zero for passing plans, including intentional medium scope findings; it is
nonzero for schema or high/critical consistency rejection.
