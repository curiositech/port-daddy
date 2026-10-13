# Failure modes and hand checks

| failure | diagnostic | hand-checkable procedure | boundary |
| --- | --- | --- | --- |
| Sybil/reset | new credential silently receives old reputation | reject k3 unless issuer recovery binds it to agent-17; record issuer namespace and multi-mint assumptions | issuer-policy continuity is not global uniqueness |
| revoked-key replay | s1 is used after k1 revocation | revoke k1, reject s1 before action admission, then issue s2 for k2 | declared test is not observed control |
| note-only succession | handoff note is called durable outcome record | list memory, checkpoint and attributed outcome record separately | persistence does not prove honest execution |
| self-graded outcome | agent text closes its own success | require task, rubric, evaluator and receipt reference | receipt must be independently inspected |
| estimator mismatch | score summarizes wrong observation type | Elo only for pairwise; TrueSkill for game model; bandit logs context/action/reward | score is not competence or calibration |
| newcomer exclusion/reset | policy makes reentry cheap or excludes first entrants | compare reset and exclusion for probation, exposure, dues, fee, or issuer rule | source does not select one policy |
| judge disagreement | A wins one order and B reverse order | record tie/abstention after both orders | swap does not remove other judge bias |
| collusion/selection | one cohort/evaluator drives observations | preserve cohort, evaluator, pairing/selection policy and review plan | no universal audit fraction or collusion cure |

## Tiny judge trace

Under rubric R7, A beats B in the A,B presentation and B beats A after reversal.
Record a tie or abstention, not a winner. If A wins both orders, record A as the
pairwise result and retain judge family, answer lengths and human-labeled
calibration status.
