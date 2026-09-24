# Stanton HTA method-retention audit

**Disposition: corrected primary-source retention audit.** The previous audit misread the chemical-incident figures and incorrectly rejected Stanton’s explicit historical control-theory framing. This corrected audit retains that framing and the concrete figure/table method while continuing to reject unsupported P×C thresholds, 80/20 rules, fabricated error arithmetic, universal decomposition depths, and agent-performance claims.

## Source access and work boundary

Read the original bundle in the verified read-only worktree `codex/agent-skills-expansion-20260924` at `/Users/erichowens/coding/tmp/agent-skills-expansion-20260924` (Git root matches; linked gitdir `/Users/erichowens/coding/port-daddy/.git/worktrees/agent-skills-expansion-20260924`; clean against `origin/main`). Read all eight original reference essays, `SKILL.md`, and all three original diagrams. Read the completed H draft and its retention ledger, archive pointer, repair manifest, and source inventories. H is offline scratch, not a Git worktree. No edits were made to W, any skill, or Book content.

Primary method read: Neville A. Stanton, “Hierarchical task analysis: Developments, applications and extensions,” *Applied Ergonomics* 37(1) (2006), 55–79, [DOI](https://doi.org/10.1016/j.apergo.2005.06.003). Read the author-uploaded full text at [ResearchGate](https://www.researchgate.net/publication/7622539_Hierarchical_task_analysis_Developments_applications_and_extensions), including §§2–5, Figures 3, 5–7, Tables 1, 5–10, and 15–16. Cross-checked the Southampton institutional record and accepted-manuscript link ([record](https://eprints.soton.ac.uk/73988/)); live PDF opens returned 403 during this audit, so the ResearchGate full-text body is the actual read source, while Southampton is publication/access provenance. Read Ormerod & Shepherd’s 2004 SGT method description at [ResearchGate](https://www.researchgate.net/publication/250749406_Using_task_analysis_for_information_requirements_specification_The_SGT_method) and the 2004 HTA-for-armed-forces report [HFIDTC/WP1.3.2/1](https://bootcampmilitaryfitnessinstitute.com/wp-content/uploads/2015/11/hta-in-the-armed-forces-elsewhere-hfidtc-2004-03-30.pdf) for the optional template family and use limits.

## What the primary procedure supports

Stanton §§1–2 (pp.56–58) explicitly situates HTA in control-theory accounts of human behavior, Miller’s (1960) test–operate–test–exit (TOTE) unit, nested feedback hierarchy, and goal-directed performance. That is historical method framing, not a performance theorem or mandated decomposition depth. Stanton §2 also gives the three governing principles: define the operation by its objective in real terms; decompose into suboperations with goals and performance criteria; and treat hierarchy as inclusion while specifying attainment/order/conditions separately in plans. The active SKILL and `references/01-primary-method.md` preserve both distinctions. Figure 5 (§3, p.64) supplies the procedure: state overall goal; state subordinate goals; state plan; check adequacy of redescription; consider next subgoal and whether further redescription is warranted; terminate/repeat per goal; review the whole set and revise. The terminal `//` notation is source-consistent.

The source plan forms include fixed order, contingent conditions, parallel/time-sharing, free order, cyclical repetition, and selection (Tables 8–9). The active plan table accurately labels its encodings as constructed examples, and correctly warns that local evidence must justify them. Stanton §3 says to use multiple information sources, name analysis purpose, check the model, and revise; active steps 1–2 and 6–8 preserve these.

P×C is only a rough stopping heuristic. Stanton’s discussion (pp.60–63) explicitly treats probability and cost as difficult to quantify and says purpose governs fit-for-purpose depth. The active draft’s “no invented score or acceptable cutoff” correction is right. Keep it. Do not revive the original references’ numeric quadrant, 80/20 allocation, fixed thresholds, severity arithmetic, or assertions that error variance can be multiplied/aggregated up the hierarchy.

## Material restoration: chemical-incident worked example

The active source excerpt now retains the distinctive historical plan/role material in `references/05-chemical-incident-and-sgt.md` and the entrypoint. Stanton’s Figure 6 (p.65) and Figure 7 (p.66) Plan 0 is: wait until 1, then do 2, then 3; if hazard, then 4, then 5, then exit; otherwise exit. Figure 7 Plan 2 permits 2.1 at any time **if appropriate**, separately from the ordered 2.2 then 2.3 chain. It does not require 2.1 to precede 2.2. Figure 7 labels 3 Police Control deciding the incident nature and 4 Fire Control cleanup; the plan includes 5 although its displayed label is only “etc…”. Table 10 (p.67) is separately and expressly abridged: 1 → 2; hazard → 3 → 4 → exit; otherwise exit, and constrains the Hospital report to the same incident. The record preserves these source-specific distinctions without inventing a harmonized operational procedure. The separate change-request fixture remains constructed.

## Additional source-backed aid: SGT, optional and purpose-limited

Stanton §3, p.60 and Table 5 describe Ormerod & Shepherd’s proposed novice aid. The active reference `01-primary-method.md` currently omits it while the ledger does not record that omission. Preserve it as a short optional callout in `01-primary-method.md` or `04-downstream-use.md`: SGTs help novices redescribe subgoals; the stated groups are **Act** (activate, adjust, deactivate), **Exchange** (enter, extract), **Navigate** (locate, move, explore), and **Monitor** (detect, anticipate, transition). Stanton says the templates were developed with process control in mind and might need additions in other domains; they are not exhaustive ontology, mandatory taxonomy, or replacement for evidence-led HTA. Ormerod & Shepherd’s chapter frames SGT as an information-requirements specification method; keep that extension boundary explicit. Do not add the original reference’s unsupported universal claims that each template implies a specific agent capability.

## SHERPA and the alleged “three-column error framework”

The original `references/failure-modes-and-error-variance.md` is labelled in the active ledger as “active bounded” but only the generic downstream caveat survives in active SKILL §“What HTA can feed.” The useful method is real but is **downstream**, not part of HTA itself. Stanton §5, pp.70–72 and Table 15 describe the SHERPA sequence: start from bottom-level HTA task steps; classify the activity as action, retrieval, checking, information communication, or selection; consider type-appropriate error modes and retain those judged credible for the specific context; record the error, consequence and recovery; assess likelihood/criticality using the method’s ordinal ratings; propose remedies. Keep the error taxonomy and ratings inside a clearly labelled SHERPA handoff, and cite Stanton (2006) §§4–5 / Stanton & Young (1999); do not present it as HTA output or as a probability-calibrated risk score. Existing unsupported VCR remediation, chemical cascade arithmetic, “critical path,” mitigation ordering, and invented prediction-performance claims should stay archived.

The original file’s heading “Three-Column Error Framework (Original HTA)” is false when applied to I/F and A. Those are two difficulty prompts (input/feedback and action) for perception–action–feedback concerns, not a three-class error taxonomy and not SHERPA. Stanton p.60 separately reports Patrick’s (1986) three-column training form. The correction therefore preserves both historical facts: do not call I/F+A three error classes, and do not globally deny that a distinct three-column form exists.

## Complete original-unit disposition check

| Original unit | Useful unit and verdict against final draft |
|---|---|
| `SKILL.md` | Goal/inclusion/plan method, review, terminal marking, downstream boundary, and the source’s historical control-theory/TOTE/nested-feedback framing retained with explicit non-theorem boundary. |
| `references/three-governing-principles-of-goal-based-systems.md` | Three principles retained in `01-primary-method.md`; remove the source-unsupported compositional performance guarantees, universal exclusion claims, and agent-system extrapolation. |
| `references/plans-as-coordination-intelligence.md` | Conditions/order/exit distinction retained in SKILL Method step 5 and plan-form table. Preserve only source-supported plan description; no claim that plans encode generalized “expert intelligence” or agent orchestration. |
| `references/stopping-rule-and-analytical-economy.md` | Qualitative, purpose-dependent P×C retained and corrected in SKILL “Stopping.” Reject numeric quadrant/cutoff, risk acceptance, mitigation, or 80/20 claims. |
| `references/goal-decomposition-as-problem-solving-substrate.md` | Inclusion, source-labelled chemical example, and optional SGT aid are active in `references/05-chemical-incident-and-sgt.md`; operational/orchestration extrapolations remain archived. |
| `references/hta-as-springboard-for-specialized-analysis.md` | Input-to-specialized-analysis idea retained in `04-downstream-use.md` and diagram 03; good boundary correction. Keep each downstream method separate. |
| `references/failure-modes-and-error-variance.md` | Source-bounded HTA→SHERPA handoff is active in `references/06-sherpa-handoff.md`; I/F+A and Patrick’s separate three-column form are correctly distinguished in `references/07-historical-difficulty-prompts.md`. Invented VCR/error cascade/variance claims remain archived. |
| `references/the-gap-between-knowing-and-doing.md` | Correctly archived: its information-design theory and recommendations are not established by this HTA source. Keep only the active handoff statement that interface analysis needs another method. |
| `references/hierarchies-of-abstraction-enable-action.md` | Purpose-fit level/terminal decision survives in SKILL Method step 7 and stopping table. Do not claim universal abstract/concrete layers, fixed leaf criteria, or particular depth counts. |
| `diagrams/01_flowchart_goal_decomposition_&_plan_stru.md` | Replaced by source-faithful Figure 5 analysis loop, diagram 01. Correctly dropped invented “failure-mode” branch and P×C gates. |
| `diagrams/02_quadrantChart_p×c_stopping_rule-_analytical_.md` | Replaced by purpose-first decision review, diagram 02. Correctly discard numeric quadrant/case placements. |
| `diagrams/03_mindmap_hta_downstream_applications_&_.md` | Replaced by diagram 03 handoff contract. Keep as list of candidate downstream disciplines, not automatic annotations or HTA conclusions. |

## Archive provenance and path defect

The canonical preimage is commit `00ab2c9ab2197ff97e85edc173370b7446fdb2ef`. The 11 archived files are physically under `architecture-skill-drafts/B06/validation/hta-repair/original/stanton-2006-hierarchical-task-analysis/` in H. Their source-relative paths and exact source hashes (also inventoried in `hta-authoring/source-inventory.tsv`) are:

| Archived file below `original/stanton-2006-hierarchical-task-analysis/` | SHA-256 |
|---|---|
| `original-references/failure-modes-and-error-variance.md` | `c2425de7edc8b5e7a161fd72d42beba622bd38b9c0ea6918f6e4a6544995f297` |
| `original-references/goal-decomposition-as-problem-solving-substrate.md` | `2ff6d9f2f9cffb312a08a52f48dbe1f733e26b7611e58e651884774968782b21` |
| `original-references/hierarchies-of-abstraction-enable-action.md` | `850d36169ecaa3c090d1d30b142f4dc80552f70a070f6d171d625ca2cf2f410f` |
| `original-references/hta-as-springboard-for-specialized-analysis.md` | `7c6c40669f640b2a37add698aa8f168a59cd76023ecedf18ed95a2c4efdf870f` |
| `original-references/plans-as-coordination-intelligence.md` | `d9929604b1a5d771ca94abfd32b44e5ba38e1b031863bbc36a00c43b9d1b8a16` |
| `original-references/stopping-rule-and-analytical-economy.md` | `a4aa3de208d239161c7a7a07698127885cebc19048ccbbfa3c66ad53fbdaf9c9` |
| `original-references/the-gap-between-knowing-and-doing.md` | `5bbce99cd7abc4489e0fee1d31ea4b4fe6a28de1a19c016063ce5427df386dca` |
| `original-references/three-governing-principles-of-goal-based-systems.md` | `67951112bf3bd07703f2f774a3d6198db685c8e658e641830e97290e2f7480e1` |
| `original-diagrams/01_flowchart_goal_decomposition_&_plan_stru.md` | `69b6a340e6f06a5fa1f26bc5967112ff52023b2a4a8b03048b992ed7ca2b30f9` |
| `original-diagrams/02_quadrantChart_p×c_stopping_rule-_analytical_.md` | `4f83092c73e57671dadc4968d965fb3ab45cd920c7201f654eba05ef01b6b2c1` |
| `original-diagrams/03_mindmap_hta_downstream_applications_&_.md` | `c036fa8bd37596a6ab777ac5b7413cccd770e6f584db53ff6751d530bf9ba829` |

`references/03-access-and-limits.md` currently points to `../provenance/original-references/`, which does not exist. Correct it to the campaign archive location above (relative to the H project root, `architecture-skill-drafts/B06/validation/hta-repair/original/stanton-2006-hierarchical-task-analysis/original-references/` and `.../original-diagrams/`) or link the active `provenance/ARCHIVAL-MATERIAL.md` pointer. The active bundle’s `provenance/original-preimage.json` is not a manifest for those 11 references/diagrams; it records `_raw_response.md` and `_book_identity.json` only. The repair/source inventory is the exact per-file mapping.

## Corrected findings

1. The concrete chemical plan, labels, Plan 2 condition, same-incident scope, and Table 10 abridgment are active in `references/05-chemical-incident-and-sgt.md` and `SKILL.md`.
2. SGT remains optional and purpose-limited; it is not a requirement or capability taxonomy.
3. SHERPA remains a downstream recipe, while I/F+A and Patrick’s separate three-column form are distinguished.
4. `03-access-and-limits.md` points to portable active provenance rather than a stale archive path.
5. No Book candidate is asserted: this repair restores known HTA source material.

## Evidence fingerprints

- Original bundle: W paths `skills/stanton-2006-hierarchical-task-analysis/{SKILL.md,references/*,diagrams/*}`; source identities/hashes are in H `architecture-skill-drafts/B06/validation/hta-authoring/source-inventory.tsv`.
- Active draft SHA-256s are in H `architecture-skill-drafts/B06/validation/hta-authoring/final-bundle-manifest.tsv`; at read time `SKILL.md` was `1fa83c9cd1450909691254b0ba500804b693791eb3bf90f2259336bf47ce1e38`, `references/01-primary-method.md` was `a6ad7b079ce0fd700c882a57ac9f70360ac1be315ef1d0afc4f1e7beb2bb6018`, and `references/03-access-and-limits.md` was `e83145d3c24362d914a51e25bdecb01701464462ba5ab8bcfe019ea9ff115f8e`.
- No edits or validation executions were made in W. This audit is research evidence for Terra’s authorship; it does not modify or certify the skill.
