# SHERPA handoff: a separate downstream method

SHERPA is not HTA. Stanton (2006) §5/Table 15 describes it as an analysis that starts from bottom-level HTA steps. A compact, reviewable handoff is:

1. Select a bottom-level HTA step and retain its plan/context.
2. Classify it as **action, retrieval, checking, information communication, or selection**.
3. Consult that class’s error modes; retain only errors credible in the actual context.
4. Record the credible error, consequence, and recovery.
5. Use the method’s ordinal likelihood and criticality assessments where appropriate.
6. Propose a remedy and validate it separately.

| HTA input | SHERPA work | Required result boundary |
|---|---|---|
| `2.2 resolve exception path`, with a missing branch condition | classify a *specified* bottom-level step only after HTA redescription | No error result while the step remains underspecified. |
| a documented step and plan condition | consider task-class error modes and record credible cases | “Credible” is analyst/context judgement, not a probability output. |
| error/consequence/recovery record | assess ordinal likelihood/criticality and propose remedy | Remedy requires later design validation. |

A failed handoff occurs if an analyst treats a parent goal, an unverified branch, or a task dispatch as an analysed step. It also fails if ordinal labels are reported as calibrated probabilities.

**Sources.** Stanton (2006) §§4–5 and Table 15; Stanton, N. A., & Young, M. S. (1999), *A Guide to Methodology in Ergonomics*, cited by Stanton for SHERPA. This reference describes the source-bounded recipe; it does not reproduce a complete SHERPA taxonomy.
