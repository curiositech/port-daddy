---
name: task-analysis-of-pier-side-ship-handling
description: >-
  Reconstruct and review Grassi's bounded simulator task-analysis procedure: GOMS-like goals/methods/selection rules, critical cue inventories, and five-participant CDM review. NOT for live ship handling, operational navigation, or general claims about expert cognition.
license: Apache-2.0
allowed-tools: [Read, Write, Edit, Glob, Grep]
metadata:
  category: Cognitive Science & Decision Making
  tags: [cognitive-task-analysis, goms, critical-decision-method, expertise, simulation, perception]
  pairs-with:
    - skill: task-decomposer
      reason: CTA improves decomposition when branch points depend on real cues rather than tidy procedures.
    - skill: mermaid-graph-writer
      reason: Use diagrams to expose goal-plan and cue-validation paths.
---

# Pier-side ship-handling task analysis

This skill documents a **bounded historical simulator-analysis method**, not navigation or ship-handling instruction. Grassi analyzes two evolutions—getting underway from a pier and mooring to a pier—using a GOMS-like procedural model plus Critical Cue Inventories (CCIs), then revises it through Critical Decision Method (CDM) interviews. The method makes the cue-to-goal relationship inspectable; it does not establish universal expert behavior, cue reliability, or operational adequacy.

## Source and access boundary

Primary source: Charles R. Grassi, *A Task Analysis of Pier Side Ship-Handling for Virtual Environment Ship-Handling Simulator Scenario Development*, M.S. thesis, Naval Postgraduate School, September 2000; advisors Rudolph P. Darken and Barry Peterson. The public [scan](https://upload.wikimedia.org/wikipedia/commons/c/cc/A_task_analysis_of_pier_side_ship-handling_for_virtual_environment_ship-handling_simulator_scenario_development_%28IA_taskanalysisofpi00gras%29.pdf) was read for §§II.D-F, IV-VI, Appendix A, and Appendix B. Appendix A is “Standard Commands”; the CCI tables are in Chapter V.C (printed pp. 102–112), including Table 6 on p. 106. Appendix B contains validation forms. The thesis concerns generic/simple simulator scenarios, not all vessels, crews, ports, or conditions. `references/01-primary-method.md` gives page/section pointers.

## Reconstruct the source procedure

1. **State the evolution and simulator question.** Select one of the two source evolutions; name the start/end condition and the simulator behavior to be represented. Do not generalize this to a live operating checklist.
2. **Review documented procedures and standing orders.** Grassi used general procedure/training material and two ships' commanding-officer standing orders. Record document identity/version and scenario constraints, including tug availability where relevant.
3. **Make a provisional GOMS-like model.** After the document review, one experienced practitioner refined the provisional model with detail missing from the documents (IV.A–B). For each evolution, state Goals, Operators, Methods, and Selection rules at unit, functional, and detailed levels. A goal such as maintaining a picture of motion/distance may recur; do not turn every hierarchy edge into a strict temporal order.
4. **Prepare a cue-to-subgoal record.** During the elicitation in step 5, collect what is seen/heard, what it indicates, and the goal/method/selection point it informs. Construct and map CCIs from the interview evidence; do not assume a complete inventory existed before validation (IV.A). The inventory supplements the procedural model.
5. **Elicit a walk-through, populate cues, then format the account.** The study-specific IV.C process says “three phases” but enumerates four steps; preserve the four listed steps rather than conflating them with generic CDM phases: (a) familiarize the participant with the scenario in advance; (b) obtain an initial uninterrupted account; (c) probe the evolution phase by phase for decisions, cues, and their meanings; (d) later review the model with the participant. Grassi used a foam-core ship/pier aid and formatted the initial interview account to resemble the GOMS model before the later comparison. This is the thesis implementation, not a universal CDM protocol.
6. **Review with the bounded panel and revise visibly.** Five selected SWOs met stated experience criteria. The initial GOMS model assumed no tug was available and omitted tug procedures even though each scenario made use of an optional tug. At final model review all five chose the offered tug, found the no-tug model inaccurate without tug procedures, and agreed that pier-side handling without a tug was very rare because of damage consequences. Grassi revised the model to include tug procedures. This finding applies to these five selected officers and the two modeled scenarios; it is not a universal operating rule or estimate of population reliability.
7. **Validate the simulator-model handoff.** Check that every claimed display/sound cue has a goal linkage and an observable representation. Mark a missing or ambiguous cue as unresolved rather than asserting redundant sensing or a response prediction.

## Worked CCI card

Chapter V.C, Table 6 (printed p. 106) includes a goal equivalent to **determine whether an engine order was executed**. Its CCI rows list stern-water churning, stack smoke plume, engine acceleration sound, and an EOT acknowledgement as relevant observations. Appendix A is the thesis's standard-commands appendix, not the source of these CCI tables. Use a review card such as:

| GOMS link | Cue | Observable form | What it supports | Boundary |
|---|---|---|---|---|
| goal: determine whether engine order was executed | water churning at stern | visual change | evidence for checking execution | does not prove the vessel's later response |
| same goal | stack smoke plume | visual change | evidence for checking execution | scenario/vessel dependent |
| same goal | engine acceleration sound | audible change | evidence for checking execution | not a quantified independent channel |
| same goal | EOT acknowledgement | instrument/communication indication | evidence for checking execution | does not replace observation of movement |

This table is a source-grounded **review fixture**, not a statement that these cues are sufficient, independent, or applicable outside the thesis scenario. `references/02-worked-fixture.md` includes its five-panel audit and negative cases.

## Decision and validation gates

| Gate | Evidence required | Block when |
|---|---|---|
| Evolution scope | named evolution, scenario boundary, documents | “ship handling” is the only scope |
| GOMS linkage | goal, method/selection point and subgoal ID | a cue is listed without a decision/use |
| Cue representation | sensory form and intended indication | a cue is claimed to guarantee outcome |
| Panel record | five participant records, questions, additions/disagreement | a generic “expert validation” claim replaces the record |
| Simulator handoff | display/audio/interaction requirement tied to cue | a general architecture recommendation has no source cue |
| Limit statement | vessel, context and study limits shown | result is exported as universal operational guidance |

## Cues, disagreement, and tugs

The thesis's cue inventory is not a general redundant-sensor architecture. A cue may be visual, audible, or communicative, but the thesis does not quantify reliability, correlation, or a fusion rule. Treat independence as a separate testable claim that would require its own evidence.

The initial model assumed that no tug would be available, although each scenario made tug use optional. In IV.C.3's final comparison, all five selected validators chose the available tug, found the no-tug model inaccurate without tug procedures, and the author revised the model accordingly. Record this as a source-backed discrepancy for this scenario and sample, not as evidence that every ship or operation must use a tug. The source describes no-tug pier handling as very rare because of damage consequences; that bounded finding is not a universal rule.

## Constructed adaptation boundary

A design team may adapt this pattern to another simulator or an agent workflow, but it must label the adaptation as constructed and supply its own procedures, participant criteria, cue evidence and validation. A GOMS hierarchy plus CCI card is not isomorphic to an orchestration tree, and it does not establish a runtime control policy. [The constructed adaptation worksheet](references/04-constructed-adaptation.md) preserves practical elicitation prompts, disagreement records and a software-evidence example without attributing them to the thesis.

## Diagrams

- [Source procedure and review loop](diagrams/01-source-procedure.md)
- [Cue-to-goal validation card](diagrams/02-cue-validation.md)
- [Scenario/tug-condition boundary](diagrams/03-scenario-boundary.md)

## Historical material and provenance

Historical generated raw material, reference essays, and the prior diagram are kept outside this active bundle. `provenance/original-raw-response.md` identifies the canonical raw-response path, baseline commit, and SHA-256 without embedding archival ASCII diagrams. `provenance/original-archive-manifest.tsv` lists every archived original reference and diagram by canonical commit, source path, and SHA-256; the external campaign archive path is only a convenience pointer. `provenance.json` is a non-operative wrapper for historical import metadata; its original relative source path is unavailable here and its claimed $0.00 cost is not audited. The broad rarity, universality, “actual inputs,” and universal-redundancy claims in historical material are not active. The bounded five-validator tug discrepancy stated above is source-backed by IV.C.3.

## Bundle navigation

[diagrams index](diagrams/INDEX.md), [provenance index](provenance/INDEX.md), [references index](references/INDEX.md).
