---
license: Apache-2.0
name: stanton-2006-hierarchical-task-analysis
description: Build and review a purpose-bounded hierarchical task analysis with goals, subgoals, plans, terminal markings, and source evidence. NOT for operating an incident response, certifying a design, or treating HTA as an error or allocation result.
metadata:
  category: Cognitive Science & Decision Making
  tags: [hta, task-analysis, hierarchical, methodology, human-factors]
  io-contract:
    kind: none
  recognition-cues: []
  expectancies: []
  decision-cues: []
  adaptive-workarounds: []
  execution-pattern: sequential
  needs-cdm: false
---

# Hierarchical task analysis (HTA)

HTA records an overall goal, included subgoals, and a **plan** that explains how the parent can be attained. Numbering alone does not impose a sequence: plans can be fixed, contingent, selection, free-order, parallel, or cyclic. Use it to make a bounded analysis reviewable. It does not turn the resulting hierarchy into an operating procedure, a safety case, an error prediction, or an automation decision.

## Source boundary and evidence

The primary source is Neville A. Stanton, “Hierarchical task analysis: Developments, applications, and extensions,” *Applied Ergonomics* 37(1) (2006), 55–79, [DOI](https://doi.org/10.1016/j.apergo.2005.06.003). A campaign audit records full-body reading of §§2–5, Figures 3 and 5–7, and Tables 1, 5–10, 15–16 through an [author-uploaded copy](https://www.researchgate.net/publication/7622539_Hierarchical_task_analysis_Developments_applications_and_extensions). This correction is limited to the source locations independently checked in the current primary-source review: §§1–2 (pp.56–58), p.60, Figure 6 (p.65), Figure 7 (p.66), and Table 10 (p.67). [Source ledger](references/01-primary-method.md) separates publication identity, access evidence, and supported claims.

The chemical incident material below is a short historical analysis excerpt from Stanton’s Figures 6–7 and the separately abridged Table 10. It is **not** an emergency-response instruction. The optional SGT vocabulary and SHERPA recipe are separately labelled methods, not HTA requirements.

## Core procedure

1. **Declare purpose and boundary.** Name the consumer and decision, included roles/artifacts, starting and ending condition, and excluded work.
2. **Collect labelled evidence.** Attach each goal or plan to observation, interview, manual, walkthrough, simulation, or another identified source. Record disagreement as a revision item.
3. **State the overall goal in real terms.** Give an observable completion criterion. Do not substitute a current interface gesture for the purpose it serves.
4. **Decompose one parent at a time.** Each child must contribute to the parent. Inclusion is hierarchical; it does not itself declare timing or actor authority.
5. **Write the parent plan.** State the actual order, branch condition, selection rule, join, repetition, and exit condition that evidence supports.
6. **Check adequacy and revise.** Ask an SME or independent source whether children, plan, evidence, and boundary explain parent attainment for the stated purpose. Preserve conflicting alternatives until resolved.
7. **Apply the stopping decision.** Continue redescription only while another level would change the declared analysis decision. Mark a terminal node `//` and record why that level is sufficient.
8. **Publish a traceable table.** Keep goal ID, parent, criterion, plan, evidence, terminal reason, unresolved condition, and revision together.

| ID | Constructed goal | Status |
|---|---|---|
| 0 | close a controlled change request | parent |
| 1 | establish request evidence | active |
| 2 | assess against stated criterion | active |
| 3 | record and communicate decision | `//` for communication-template review |

**Constructed Plan 0:** do 1, then 2. If assessment is unresolved, hold and redescribe the missing condition. Otherwise do 3 to record and communicate acceptance or rejection with its reason, then exit.

This fixture is constructed for documentation review. It is not from Stanton and does not establish a production workflow. Its evidence and failed-review branch appear in [the worked fixture](references/02-worked-fixture.md).

## Plan review

| Plan form | What to write | Do not infer |
|---|---|---|
| Fixed | `do 1, then 2, then 3; exit` | all HTA children are sequential |
| Contingent | `do 1; if condition, do 2; otherwise do 3; exit` | the branch outcome is certain |
| Selection | `choose 2a or 2b by stated criterion; then 3` | both alternatives run |
| Free order | `do 1, 2, and 3 in any order before exit` | simultaneous work |
| Parallel | `start 1 and 2; do 3 when both criteria hold` | independent-looking labels prove independence |
| Cyclic | `repeat 1 while condition holds; exit on stop condition` | an infinite loop or fixed period |

For every parent, hand-check that the plan identifies condition/order/selection and exit; that every child contributes; and that the supporting source is named. A bare indented list fails the plan check.

## Purpose-bounded stopping

Stanton discusses probability of failure × cost of failure (P×C) as a rough prompt. The paper also says P and C can be difficult to quantify; it supplies no numeric cutoff, risk-acceptance rule, or fixed depth. Keep purpose first.

| Candidate | Further detail that could change a decision | Evidence | Decision |
|---|---|---|---|
| assess request | exception-panel requirement | walkthroughs disagree on exception path | redescribe and resolve condition |
| communicate decision | wording only | approved message contract | `//` for communication-template review |

A high apparent consequence without evidence calls for investigation, not a score. A later function-allocation “no solution” rule is a separate proposal, not Stanton’s HTA stopping rule.

## Historical theoretical framing

Stanton §§1–2 describes HTA in relation to control-theory accounts of human behavior, Miller’s (1960) test–operate–test–exit (TOTE) unit, and a nested feedback hierarchy for goal-directed performance. That is historical framing for the method, not a performance theorem, a universal decomposition depth, or an automated controller specification.

**TOTE hand check (constructed).** For the declared goal “confirm the record is complete,” test the stated criterion. If achieved, exit this check. If not, perform the named evidence-gathering operation and retest. Record the criterion and evidence; do not infer a result merely because the loop was drawn.

## Chemical-incident source excerpt: read as an analysis, not a procedure

Stanton’s Figures 6–7 analyse the goal **“Deal with chemical incident”**. The source labels different parts with **Police Control, Fire Control, Hospital, and Police Officer**. Do not convert those labels into a current incident command model or infer responsibility beyond the displayed analysis.

| Source location | Historical numbering/text retained | Caution |
|---|---|---|
| Figures 6 (p.65) and 7 (p.66), Plan 0 | Wait until 1, then do 2, then 3. If there is a hazard, then 4, then 5, then exit; otherwise exit. | This is a source-paraphrased plan relation, not an emergency procedure. It differs from the abridged Table 10 plan. |
| Figure 7, Plan 2 | 2.1 may occur at any time **if appropriate**; separately, execute 2.2 followed by 2.3, then exit. This does not order 2.1 before 2.2. | “At any time” has the source condition and does not authorize a local interruption policy. |
| Table 10 (p.67), Plan 0 | Its abridged presentation retains 1 then 2; hazard → 3 then 4 → exit; otherwise exit. | Table 10 says its re-description is omitted to shorten the example. Preserve its abbreviated numbering; do not harmonize it with Figures 6–7. |

Figure 7 labels 3 as **Police Control: decide incident nature** and 4 as **Fire Control: cleanup**. The plan still includes 5; its displayed label is only **“etc…”**, so do not invent a Police Control resolution action for it. Table 10’s Hospital report is constrained to the **same incident**. [The source excerpt and review prompts](references/05-chemical-incident-and-sgt.md) retain these distinctions.

## Optional SGT prompts

Stanton’s Table 5 discusses Ormerod and Shepherd’s Sub-Goal Templates (SGTs), developed with process-control use in mind. They are optional prompts for an analyst, not an exhaustive ontology, mandatory taxonomy, or capability/authority model:

| Family | Source terms |
|---|---|
| Act | activate, adjust, deactivate |
| Exchange | enter, extract |
| Navigate | locate, move, explore |
| Monitor | detect, anticipate, transition |

Ask whether one term helps expose an omitted candidate subgoal; then verify it against local evidence and purpose. Do not label a node solely because it resembles a term.

## Downstream use: HTA is the input, not the result

An HTA can provide a stable node/plan/evidence record to later analysis. The later method owns its taxonomy, assumptions, validation, and findings.

For a **downstream SHERPA** pass, begin at bottom-level HTA steps; classify each as action, retrieval, checking, information communication, or selection; consider the corresponding error modes; keep only errors credible in the actual context; record error, consequence, and recovery; use the method’s ordinal likelihood/criticality ratings where the method calls for them; then propose remedies. This is SHERPA, not HTA, and it is not a calibrated probability model. See [the handoff recipe](references/06-sherpa-handoff.md).

I/F (input/feedback) and A (action) are two historical difficulty prompts, not a three-class error taxonomy and not SHERPA’s five task classes. A distinct Patrick (1986) training form reported by Stanton has three columns; do not use that fact to relabel I/F and A as three error classes. See [historical difficulty prompts](references/07-historical-difficulty-prompts.md).

## Diagrams

- [Goal, plan, and evidence procedure](diagrams/01-goal-plan-evidence.md)
- [Purpose-bounded stopping review](diagrams/02-stopping-review.md)
- [HTA-to-specialized-analysis handoff](diagrams/03-downstream-handoff.md)

## Historical provenance

The active bundle contains source-bounded teaching material. Byte-preserved original essays, diagrams, and raw response are outside it. [Archival material](provenance/ARCHIVAL-MATERIAL.md) gives a portable canonical commit/path/SHA mapping for every omitted unit; [the raw wrapper](_raw_response.md) identifies the historical raw preimage without reproducing its ASCII diagrams.

## Bundle navigation

[diagrams index](diagrams/INDEX.md), [provenance index](provenance/INDEX.md), [references index](references/INDEX.md).
