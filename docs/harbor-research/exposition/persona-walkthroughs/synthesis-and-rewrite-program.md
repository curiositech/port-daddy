# The Book: synthesis and rewrite program

Editorial/UX synthesis · 17 September 2026 · proposal, not an implemented rewrite

## 1. Editorial decision

Keep the research book. Make the path from a recognizable failure to a justified decision much shorter.

The four reports suggest that the central problem is not an absence of interesting developer stories, mathematical substance, or candor. All three already exist. It is the distance between them. A reader encounters an attractive mechanism, travels elsewhere to discover its implementation boundary, and travels again to find the evidence. Meanwhile, a novice meets the reference-monitor argument before understanding one ordinary collision. Neither problem is solved by indiscriminately simplifying the mathematics or adding more illustrations.

The program has three ordered commitments:

1. Repair checkable errors and conflicting guarantees before improving persuasion.
2. Give each reader a short, explicit route to an appropriate stopping decision, with status beside the mechanism that creates the expectation.
3. Carry a small number of concrete work units through failure, evidence, repair, and the next chapter. Preserve an unobstructed expert route to assumptions and proof.

The boldest change is to let the Book demonstrate its own accountability: a reader should be able to challenge a worked case, remove an assumption, inspect the resulting failure, and record a bounded decision. The current Book contains ingredients for this, but not this recurring, reader-operated apparatus.

Do not turn a research text into installation instructions, a procurement dossier, a hiring portfolio, or a conversion funnel. Priya leaving to solve a port conflict, Fatima marking an intake incomplete, and Victor withholding endorsement can all be successful outcomes of honest exposition.

### Evidence and scope

The synthesis uses all of [Cohort A, personas 01–06](cohort-a-personas-01-06.md), [Cohort B, 07–12](cohort-b-personas-07-12.md), [Cohort C, 13–18](cohort-c-personas-13-18.md), and [Cohort D, 19–24](cohort-d-personas-19-24.md). They were read completely, including the additive first-sitting routes in B. The dialogue below interrogates their findings; it is not an additional round of participant research.

The inspected object is a local proof build of the assembled Book: 661 pages, 504 × 720 points, 10,203,318 bytes; creation metadata 2026-09-17 02:12:42 PDT; SHA-256 `1d9d273470018b45f5e125a87bdf6de1fa706abaaec3b4239ae9bad6da1454e2`. The reports began at HEAD `33fa6ddde026b909eefb5d1d3d2adbe5c4befb41`. Another contributor's work advanced HEAD to `c8f64ce049b60ee0c813e92a976c6d14877cb86f` during synthesis; the PDF hash remained unchanged. Neither HEAD alone proves the PDF's build inputs. Subsequent uncommitted shared-style/pedagogy changes also appeared and were left untouched; Q13 explicitly accounts for the new sample environment in that concurrent work.

All page references below are printed Book pages. Arabic page *p* is one-based viewer page *p + 18*. Front-matter iv–ix is viewer 4–9. Some even appendix pages lack an Arabic folio; use the viewer offset. Page anchors identify the hashed artifact, not a future rebuild. Source anchors identify the inspected working files and must be relocated by section/label after concurrent edits.

Independent synthesis checks included the front matter, selected claim/status passages, worked arithmetic, the recovery example, the escrow gap, and canonical source. Direct rendered-page checks covered pp. 164, 179, 189, 215, 268, 475, and 598. This is targeted visual inspection, not an all-page, accessibility, print, or operator acceptance pass. The existing PDF is untagged; that fact is not a complete accessibility assessment. No proofs, CI runs, deployment behavior, or product adoption were reproduced.

Only this report was authored by the synthesis pass. No chapter, figure, generated artifact, or cohort report was edited by that analysis pass. The local Port Daddy runtime remained halted. Sample operations below are proposed paper cases, not instructions to execute local tooling.

## 2. Quantitative synthesis: 24 perspectives, not 24 participants

All scores are analyst-assigned ordinal judgments. Higher friction is worse; higher appeal is better. No measured timing, retention, error rate, conversion, or score improvement exists. The cohorts share a manuscript, persona catalog, and methodological framing; repeated concerns are correlated, not independent replications. There are no confidence intervals or population estimates.

### Preserve the native friction rubrics

The reports did not use one interchangeable friction measure. Do not manufacture one after the fact.

| Cohort | Native friction vector, in table order below | Overall F/A supplied? |
|---|---|---|
| A | O overwhelm; C context switching; P invisible progress; M accumulated obstacles; X expert obstruction | No |
| B | One overall friction judgment for the intended evaluation | Yes, both |
| C | E entry/route; L conceptual load; C context recovery; P payoff/progress; V visual reading | No |
| D | O orientation; L conceptual load; N navigation/recovery; T task completion/transfer | Yes, both |

I/U/T are identity fit, urgency, and trust, each 1–5. These shared labels permit a descriptive comparison, but trust still refers to each persona's different decision. Overall appeal in B/D is not the average of I/U/T. A dash means not supplied, not zero. Vectors below are transcriptions, not rescoring.

| ID | Persona | Cohort | Native friction vector | Overall F | Overall A | I | U | T |
|---|---|---|---|---:|---:|---:|---:|---:|
| 01 | Priya Desai | A | 5,3,4,4,2 | — | — | 2 | 2 | 3 |
| 02 | Marcus Webb | A | 4,4,4,4,2 | — | — | 3 | 3 | 3 |
| 03 | Yuki Tanaka | A | 2,4,2,3,2 | — | — | 5 | 4 | 4 |
| 04 | Jordan Ellis | A | 3,4,4,3,2 | — | — | 4 | 5 | 3 |
| 05 | Sam Okafor | A | 3,5,4,4,2 | — | — | 4 | 4 | 3 |
| 06 | Devon Cole | A | 2,3,3,3,1 | — | — | 5 | 4 | 3 |
| 07 | Rachel Kim | B | — | 4 | 4 | 5 | 5 | 3 |
| 08 | Tomás Herrera | B | — | 4 | 4 | 5 | 5 | 3 |
| 09 | Angela Brooks | B | — | 4 | 3 | 4 | 5 | 2 |
| 10 | David Chen | B | — | 5 | 2 | 2 | 4 | 2 |
| 11 | Fatima Al-Sayed | B | — | 5 | 2 | 2 | 5 | 2 |
| 12 | Grace Liu | B | — | 3 | 5 | 5 | 4 | 3 |
| 13 | Ben Sorensen | C | 3,3,4,5,2 | — | — | 3 | 4 | 4 |
| 14 | Priyanka Rao | C | 5,5,4,4,1 | — | — | 2 | 3 | 3 |
| 15 | Jake Malone | C | 3,4,3,2,3 | — | — | 3 | 2 | 3 |
| 16 | Dr. Elena Vasquez | C | 3,3,3,2,4 | — | — | 4 | 3 | 4 |
| 17 | Theo Marsh | C | 2,2,4,5,2 | — | — | 5 | 5 | 3 |
| 18 | Nadia Petrov | C | 3,2,4,5,3 | — | — | 4 | 4 | 3 |
| 19 | Chris Whitfield | D | 2,2,4,4 | 3 | 4 | 5 | 4 | 3 |
| 20 | Morgan Reyes | D | 5,5,4,4 | 5 | 2 | 2 | 3 | 3 |
| 21 | Aisha Bello | D | 3,3,4,4 | 3 | 4 | 3 | 4 | 3 |
| 22 | Liam O'Connor | D | 2,3,2,3 | 3 | 4 | 4 | 3 | 4 |
| 23 | Sophie Turner | D | 5,5,5,4 | 5 | 2 | 1 | 2 | 3 |
| 24 | Victor Aldana | D | 2,2,4,5 | 4 | 2 | 4 | 3 | 2 |

### What the numbers support

| Shared dimension | Score distribution: 1 / 2 / 3 / 4 / 5 | Median | Scores ≥4 |
|---|---|---:|---:|
| Identity fit | 1 / 5 / 4 / 7 / 7 | 4 | 14/24 |
| Urgency | 0 / 3 / 6 / 9 / 6 | 4 | 15/24 |
| Trust | 0 / 4 / 16 / 4 / 0 | 3 | 4/24 |

Ten profiles have I ≥4, U ≥4, and T ≤3: 04, 05, 06, 07, 08, 09, 12, 17, 18, 19. This is the sharpest editorial opportunity: the subject already matters to these simulated readers, but the route does not establish enough confidence for their intended next action. It is not evidence of product demand or a causal effect of page design.

| Friction result, kept within its rubric | Count | Editorial implication to test |
|---|---:|---|
| A: context switching ≥4 | 4/6 | Put local status and one evidence pointer next to the attractive mechanism. |
| A: expert obstruction ≥4 | 0/6 | Do not solve novice trouble by deleting precise expert access. |
| B: overall friction ≥4 | 5/6 | Enterprise/evaluation tasks need an explicit incomplete-evidence exit, not more promotional exposition. |
| C: context recovery ≥4 | 4/6 | Short explanation routes currently require assembling distant material. |
| C: payoff/progress ≥4 | 4/6 | A delivery case, live demo, or productivity claim cannot be supplied by another hypothetical scene. |
| D: navigation/recovery ≥4 | 5/6 | Make stopping points and return paths local and visible. |
| D: completion/transfer ≥4 | 5/6 | Add a joined, portable case, while distinguishing unavailable operational outcomes. |

Do not pool these friction counts into a single rate. B and D supply overall F/A, but their task anchors differ; A and C do not supply them at all. No composite “Book score,” persona-weighted business case, or predicted lift is justified.

The arithmetic is reproducible from the table: count each I/U/T column by value; select the three explicit threshold predicates for the ten-profile group; select the stated position of each native vector for cohort friction counts. Threshold four is a reporting convention taken from the rubrics, not a discovered behavioral cutoff.

### Important blind spots

The catalog overrepresents contemporary developer-tool evaluation and adjacent audiences. The Book's mechanism-design and institutional-theory readers do not receive equally deep disciplinary coverage here. Disability, assistive-technology use, non-English reading, actual classroom learning, sustained mathematical study, and economic incentives of real adopters are not assessed. People may also occupy several of these roles. Treating every low-fit persona as a target would damage the book for its core scholarly audience.

## 3. Where the simulated readers stop

These are predicted, task-specific stops, not observations. An assisted rescue route is not evidence of unaided discoverability. Page choices condense the full reports; secondary optional excursions remain there.

| ID | Likely stop or unresolved decision | Productive endpoint the rewrite should make explicit |
|---|---|---|
| 01 Priya | iv–v before committing; optional pp. 18–23 | Understand reservation versus listening; leave for a separate operational guide. No need to read markets. |
| 02 Marcus | p. 23 changes from ports to a file-lock sample | Determine what remains unknown about four inherited client setups without restructuring them. |
| 03 Yuki | pp. 60, 99–108, then artifact lookup | State the precise claim and its exclusions; open revision-bound evidence rather than accept a generic status word. |
| 04 Jordan | pp. 185/192 require pp. 257–259 | Decide that the proposed consent flow is not yet a promised Friday workflow. |
| 05 Sam | pp. 57 and 480–483 leave team scope unresolved | Separate one-machine coordination from shared policy administration and choose the next evidence request. |
| 06 Devon | p. 189 and p. 272 explain; p. 259 limits a pitch | Give an accurate explanation to Sam; withhold a live capability claim. |
| 07 Rachel | pp. 60–61 versus p. 474 and p. 596 | Reject an adoption premise requiring unavailable compulsory mediation; investigate protocol evidence separately. |
| 08 Tomás | p. 189, pp. 257–259, p. 597 | Specify an evidence surface for 40 teams without mistaking event relay for central policy authority. |
| 09 Angela | pp. 57–58, 463, 475–476 | Enumerate failure classes, detection/recovery timing, and remaining tests; do not infer demonstrated recovery. |
| 10 David | pp. 188/205, 377, 381 | Explain the investment hypothesis; request a measured pilot and support/exit plan, not claim ROI. |
| 11 Fatima | pp. 143/164 and 596–597 | Mark missing current data-flow and control evidence; proposed secrecy is not a completed intake. |
| 12 Grace | pp. 57–58, 106–109, 598 | Leave with three architecture interview questions and exact evidence requests, not a hiring verdict. |
| 13 Ben | iv, p. 81, pp. 595–597 | Distinguish authored research from attributed, dated delivery. A real case study is still needed. |
| 14 Priyanka | iv–v | Obtain one accurate sentence about the publication and one boundary on delivery claims. |
| 15 Jake | p. 7 unaided; assisted pp. 180–192 and 272 | Retell a green summary hiding a bad diff, plus what accountability means. Stop without learning the entire stack. |
| 16 Elena | pp. 146–149; limits at p. 164 | Explain the finite model and excluded channels. This conceptual task can succeed without a deployed product. |
| 17 Theo | p. 192 then pp. 258–259 | Recognize a relevant design, then withhold an increased-capacity claim until measured. |
| 18 Nadia | p. 189 versus p. 259 | Approve a labeled illustrated explainer; do not approve a live demo without recording provenance and a tested reset. |
| 19 Chris | pp. 47–49, 191, 259 | Extract a vendor-independent recovery pattern with prerequisites and missing obligations. |
| 20 Morgan | pp. 7–9 unaided; assisted pp. 18, 21–23, 189 | Explain one collision, the losing request, and the direct-edit bypass without installation. |
| 21 Aisha | pp. 185/191 then p. 259 | Write an accurate stakeholder brief distinguishing desired behavior from current coverage. |
| 22 Liam | p. 70 exercises 1.10–1.12 → pp. 541–542 | Finish a small check/trace/solution loop; offer an offline artifact exercise as the next optional step. |
| 23 Sophie | iv–vi | Ask a developer what changed, what checked it, and what recovery would preserve. Leaving is appropriate. |
| 24 Victor | p. 268; pp. 185/259; vii/595 | Audit the contradictions and retain unresolved objections. Withholding endorsement is not failure to understand. |

Use four task exits in the front matter, alongside—not replacing—the existing disciplinary map: **understand one failure**, **audit one guarantee**, **evaluate an adoption premise**, and **study the argument**. Each gets an initial page, a concrete stopping test, and a return pointer. Do not add 24 persona lanes or require every reader to start at Chapter 1.

## 4. Interviewing the findings: a productive-discourse hearing

This is a single analyst's structured, simulated hearing of the reports. The voices below paraphrase tensions; they are not new quotations from people, fresh subagent judgments, or independent votes. Recursive synthesis here means preserve divergent reports → challenge their interpretations → consolidate only supported decisions → retain dissent and validation needs.

### Hearing A: Is this an onboarding failure, or the wrong reading task?

**Facilitator question.** What would make Priya's departure evidence of a bad book rather than a sensible choice?

**Practitioner case, steelmanned.** Priya and Marcus need a small answer before a general architecture. Morgan cannot know whether the terminology matters until one familiar edit goes wrong. An express route discovered only by the analyst does not solve discoverability.

**Scholarly challenge.** Yuki and Elena are using a textbook successfully precisely where it names assumptions and limits. The Book is not obliged to install a tool or satisfy procurement. Removing the reference-monitor argument because some readers do not need it confuses audience fit with poor exposition.

**Evidence and ruling.** The port race exists on pp. 21–23, the expert assurance bridge on pp. 99–108, and the exercise loop on pp. 70/541–542. Preserve all three. Add a one-spread failure route and explicit stopping tests; do not rewrite the entire book at a beginner level.

**Dissent retained / next test.** Core institutional readers may dislike a developer-first opening. Test the revised first spread with them as well as beginners. The criterion is more accurate orientation with no obstruction to the formal claim, not universal continued reading.

### Hearing B: Does local status spoil a good story?

**Facilitator question.** Why do Theo and Nadia want to continue yet hesitate to recommend or demonstrate?

**Story advocate, steelmanned.** Mara's afternoon makes the need visible. A status caveat on every sentence would destroy its momentum; the chapter already explicitly sends readers to Appendix 4.A.

**Security/operator challenge.** Jordan, Rachel, and Angela make decisions before reaching that appendix. A vivid successful action produces an expectation that an appendix 74 pages later cannot reliably undo. The p. 474 confinement language is stronger than a merely inconvenient status placement.

**Evidence and ruling.** At p. 185, add one adjacent line: “Synthetic design scene; the consent-grant and unconditional-override mechanisms are proposed; current boundary: Appendix 4.A.” Use the exact current vocabulary, verified at rewrite time. Repeat a status line at the resumption on p. 192, not on every paragraph. Correct the Chapter 7 guarantee separately; do not solve a false claim with a small-print disclaimer.

**Dissent retained / next test.** Some selective readers may still confuse a specified workflow with available software. Ask them to classify each action after the spread, without coaching. If they cannot, redesign the scene itself.

### Hearing C: Would more figures solve the problem?

**Facilitator question.** What information is missing, and what is already present but hard to read?

**Visual case, steelmanned.** Jake and Nadia find the two digest trees on p. 189 more useful than abstract exposition. Elena's limits page has visibly colliding captions. Exact evidence tables are hard to scan at p. 598.

**Counterargument.** A new architecture diagram cannot provide Ben's delivery history, David's ROI, or Fatima's current data handling. More margin material could make p. 164 worse. The three-agent settings scene is already drawn at p. 179.

**Evidence and ruling.** Fix the caption collision, split the dense settings story into failure and repair, and reflow exact artifact records. Add a figure only for an identified relation. Use a table for a few exact values. Do not add a second generic stack or decorative portrait.

**Dissent retained / next test.** A small-multiple repair can still overload the spread. Test whether an unfamiliar reader can point to the bypass and an expert can find the gate assumption. Neither a compile nor a five-second analyst glance substitutes for that test.

### Hearing D: Does distrust demand stronger claims or more modest ones?

**Facilitator question.** What would change Victor's mind without merely pleasing him?

**Skeptical case, steelmanned.** An arithmetic error in a hand-checkable example, incompatible assurance descriptions, and a crash timeline that cannot occur justify checking the rest. The author must not borrow credibility from a finite model for unavailable confinement.

**Constructive challenge.** Ben and Elena score trust highly because the Book admits limitations. An isolated correction is not grounds to discard every theorem. The existing verification withdrawal at p. 106 is a model for intellectual repair.

**Evidence and ruling.** Publish exact local corrections and retain a short correction/evidence trail. Separate four claim kinds, implementation status, and assurance mode. Do not predict that correcting these defects will produce a particular trust score.

**Dissent retained / next test.** Technical validity remains outside this editorial pass. A domain reviewer must check whether the newly scoped claims actually follow from the cited assumptions.

### Hearing E: Which missing outcomes belong outside the Book?

**Facilitator question.** What is the minimum honest answer to a buyer, recruiter, or prospective operator?

**Evaluation case, steelmanned.** David, Fatima, Grace, Ben, and Priyanka need a decision, not just more reading. They should not have to reconstruct the boundary between the author's research and delivered software.

**Editorial challenge.** A sales/support appendix and invented customer proof would distort the scholarly work. There may be no authorized, attributable case study to link.

**Evidence and ruling.** Supply a one-page “what this publication does and does not establish” exit. Link a delivery dossier or operational guide only when it actually exists and is verified. Otherwise say that the evidence is not supplied. Keep hiring, procurement, and ROI judgments outside the text.

**Dissent retained / next test.** These routes may remain unsatisfying to those readers. That is acceptable if the resulting decision is accurate and the Book's purpose is clear.

## 5. Corrections before expansion

These are not popularity votes. They are checkable textual/visual defects or evidence-scope inconsistencies. Source keys resolve to absolute files in §12. They do not assert the current runtime is broken.

| ID | Book/source anchor | Required editorial correction | Acceptance test |
|---|---|---|---|
| C01 | p. 268; SP:340–350, preview example | Replace “loses 10 by staying”: 90 → 60 loses 30; retaining 60 is 10 better than restarting at 50. Free reminting helps below the threshold 80, ties at 80, and does not help above it. | Recompute examples at 50, 80, 90; every verbal comparison names its baseline. Preserve the correct max expression. |
| C02 | pp. 474–476; BC:2127, 2143–2156; pp. 60–61 and 596 | A signed capability does not physically block every write by itself. Recast this as a conditional design trace requiring actual mediation/confinement; state that the Book's current availability boundary does not supply the whole trace. Scope “no information is lost” to records actually captured and durably committed. | Reader distinguishes token verification, effect interception, recorded artifacts, and unrecoverable inference/execution state. No unqualified end-to-end runtime promise remains in this example or its summary. |
| C03 | pp. 475–476; BC:2139–2145; worked-example figure:62, 67–69 | A crash at minute 12 detected after 90 seconds cannot yield the stated detected-and-resumed sequence at minute 13. Claim expiry at a 30-minute TTL also needs an explicit recovery/fencing rule. | One event table generates prose and diagram times. If detection begins at crash, earliest detection is 13:30; capability issuance, safe takeover, and completion are separately accounted for. A timeout is not proof the old process cannot act. |
| C04 | pp. 143 and 596; SH:374–394, APP:100–108 | “Backed by the implementation and its tests” is ambiguous against the stated unshipped sealed room. Identify the tested model/library and its scope, or describe the property as intended with the missing evidence. Correct both claim box and table caption. | Each of the six side properties has an artifact and boundary, or an explicit missing-evidence label. No model is silently promoted to deployment. |
| C05 | pp. 381–382; HE:1790–1804, 1831–1846 | The example says 560 CR remains conserved but stuck; the gap table then says orphaning stops the sum equaling supply. Change the orphaning threat to settlement progress/recoverability, unless an additional value-destroying transition is explicitly modeled. Reconcile the caption and “reaches conservation” sentence too. | Wallet + escrow + commons remains constant in the no-movement trace. Separate the amendment double-entry risk from the orphaning liveness risk. |
| C06 | vii versus p. 595; FRONT:227–233, APP:36–57 | Replace the assurance staircase with distinct effect/threat boundaries; Brokered and Confined are not globally ordered. Keep implementation maturity and evidence kind separate. | The same scenario can be brokered but not confined, and a reader can explain why stronger evidence does not create a missing gate. |
| C07 | p. 164; SH:1083–1097 | Figure 3.14 and Table 3.5 captions visibly overlap in the outer margin. Allocate separate vertical space; shorten captions and move necessary caveats into the body. | Render the assembled page and facing page at final size. No overlap or clipped text; limitations remain adjacent and readable. Check parity in all three editions. |
| C08 | p. 215; LS:1685–1694 | The text points to Figure 4.10's “right panel,” but the rendered figure has one panel showing a bit bound, not a measured solo-developer value curve. Delete the false panel reference; classify the solo-value claim as a hypothesis or support it separately. | Every referenced panel exists. No information-theoretic bound is labeled as measured productivity. Preserve the plotted model/provenance and units. |
| C09 | v versus p. 176; FRONT:201–207, LS chapter opening | Distinguish the single global reader map from permissible short local routes. The absolute “no chapter … reader's map” claim conflicts with the useful local route. | Global map appears once; local express routes are consistent with the stated policy. Do not delete the useful Chapter 4 route to satisfy wording. |
| C10 | p. 383 versus p. 355/status; HE:636, 1875, 2843 | Qualify the review's no-spawn-without-bond formulation with its design-invariant/partial implementation boundary. | Review cannot be excerpted as an unconditional current runtime guarantee; it matches the statement and status table it summarizes. |
| C11 | pp. 324–325 and 334–335; SP:2531, 3351; duplicate labels `sec:handoff`, `tab:handoff` | Merge the two market handoffs and repeated table into one authoritative closing handoff. Retain substantive differences, including the honest-root/measurement obligation. | One definition of each label, one table, no lost obligations, no stale references. Check the assembled destination of every handoff link. |
| C12 | pp. 427 and 476; BC:751, 2143, 2156 | Reconcile “commons loses no information” and “resumed at minute 12's state” with pp. 47–49 and 266–267: durable evidence is not a restored computation. | Recovery inventory distinguishes saved diff, committed note, saved test output, missing unsaved work, and unavailable model state. This wording agrees with C02/C03. |

The corrections take precedence over additional metaphors, portraits, or visual embellishment. In particular, the recovery clock must be repaired before it becomes the recurring teaching example.

## 6. Missing modern AI-developer scenes: exact briefs

The Book already has the port race, three concurrent settings edits, Mara's five-PR pile, Alice's restarted agents, and a layered login-bug example. Do not announce these as new. What is missing is a joined continuation with artifacts, rejected actions, and an explicit boundary. The following are proposed **SYNTHETIC** cases, not observed incidents, vendor behavior, performance measurements, or verified product features.

Use one small fictional repository for S02–S06. Work unit W-17 belongs to operator Mara; a formatter, a bug-fix agent, and a reviewer have distinct roles. Artifact IDs such as `base-a1c9`, `diff-d2`, `run-r4`, and `review-q7` are readable invented identifiers, not claims about real commits. Do not retrofit them onto existing scenes without reconciling actors and assumptions. S01 is a separate client-compatibility case; S07–S10 deliberately cross different boundaries.

| ID / insertion | Exact scene and consequential decision | Required artifact / observable read-out |
|---|---|---|
| S01: pp. 18–23, SWK resource claims | Three projects request a port; an unmanaged server already listens on one, one client script has a fixed port, and a stale reservation survives a process exit. Operator must avoid killing another client's work. | Six-row table: requested port, reservation answer, observed listener, configuration change needed, chosen action, unresolved behavior. Show reservation success and actual bind separately. No invented working commands. |
| S02: after p. 179, LS existing settings scene; return at SWK fencing | Continue the existing three-edit failure. All read the same base. A format change is benign, a syntax change fails quickly, an excluded-test change passes current checks but hides a later defect. Try cooperative claims, a bypassing direct write, and an effect gate as distinct counterfactuals. | Small multiples share the same base and edits. Track file digest, claimant, epoch, checked effect, and test coverage. The repair prevents only the failure its assumptions cover; it does not magically add a missing mutation test. |
| S03: pp. 188–192, LS digest/consent | A green CI result belongs to the old head. A later agent deletes the failing test and asks for a merge while Mara has ninety seconds. The reviewer must identify the exact checked revision before approving. | Diff/run/review records each name a head and scope. The decision is “hold for current-head evidence,” not “green means correct.” Add a direct artifact path and a counterfactual stale-link case. |
| S04: pp. 47–49 and 474–476, SWK/BC recovery | A provider timeout leaves an uncommitted diff, a captured failing test, an open obligation, and a possibly live predecessor. The successor gets a summary that omits “do not edit billing migration.” It must reconstruct obligations, inspect the diff, reacquire valid authority, and refuse a late predecessor effect. | Predecessor / durable record / successor sequence plus recovery inventory. Mark captured versus merely mentioned versus absent artifacts. Add a branch where the predecessor is partitioned, not dead. Never claim replay restores inference state. |
| S05: pp. 184–185 and 233 onward, LS permission/budget | Mara permits test-only work with a finite action/spend budget. A subagent delegates again; retrying a failed job risks continuing after cancellation. What can the operator actually stop? | Consent receipt: allowed paths/actions, expiry, budget interpretation, delegation rule, cancellation event, enforcement channel, unmediated effects. Two endings: cooperative stop and an ambient path that the stated mechanism cannot block. Numeric budget is illustrative, not a billing guarantee. |
| S06: p. 189/191, LS review | An agent changes a responsive settings panel. Unit tests pass, but the operator's narrow-window screenshot shows the save control clipped. A summary claiming visual completion lacks pixel evidence. | Side-by-side labeled fixture screenshots only when actually generated from a pinned specimen; until then use a schematic explicitly labeled synthetic. Record viewport, theme, head, capture owner, and acceptance observation. Tests and visual review answer different questions. |
| S07: pp. 136–149/164, SH release boundary | An agent reads a repository instruction embedded in untrusted content asking it to disclose a secret through a useful-looking diagnostic. The sealed-room model permits only an approved release; external provider logging and other out-of-model channels remain unresolved. | Data-flow table: owner, input, recipient, permitted release, retention unknown, evidence source. Pair two secrets with the same permitted release and ask whether observations differ. Do not imply this closes arbitrary natural-language exfiltration. |
| S08: pp. 483–496 and 519, FH | A local developer and a hosted CI agent share authenticated events. A grant is revoked while the remote party is disconnected; the stale agent later requests a schema change. | Four-message trace and a disconnected branch: signed evidence, local policy check, revocation age, expiry, possible effect, rejection/unknown outcome. Transport success is not authorization. Explicit clock/skew and delivery assumptions. |
| S09: pp. 348–352, 381–382, HE | A buyer funds a fix, a provider posts a bond, and a judge has not closed the result when one operator disappears. Compare conserved-but-stuck escrow with a separately modeled incorrect amendment. | Double-entry before/after table using the existing 560 CR total; who can settle/refund, elapsed time unknown, and which property fails. Never relabel this as measured buyer savings. |
| S10: pp. 191/257–259 and evaluation exit | A team considers a limited pilot. The default is no adoption claim. Define eligible tasks, baseline workflow, review minutes, escaped defects, abort conditions, support owner, and privacy exclusions before collecting results. | Blank evaluation card with “not measured” cells; later fill only with attributable observations. David gets an investment question, Tomás a governance question, Fatima a data question. No fabricated customer or ROI case. |

Scene acceptance is exact: a reader can name the actor, artifact, intended effect, decision point, evidence, and boundary. If those are absent, more dialogue is not progress. Sample records use one shared sample-paper environment: monospaced, labeled SYNTHETIC/SAMPLE or RECORDED SESSION as appropriate, subtle paper treatment, and provenance. No unlabeled invented terminal output.

## 7. Chapter-level pacing: cut, move, merge, retain

The current chapter intervals are pp. 5–82, 83–134, 135–174, 175–264, 265–342, 343–400, 401–478, and 479–538. Their 78/52/40/90/78/58/78/60 page spans include chapter apparatus and references; they are not measured prose density. Page counts below are provisional editorial budgets, not promised typeset savings.

Keep the eight-chapter dependency order. Change local entry and exit order before considering a new volume architecture. In each opening spread: concrete failure and number → one question → bounded claim and kind → three strongest objections → novice route and expert pointer → a hand-checkable instance before general definitions. Do not recreate chapter abstracts or full reader-map tables.

| Chapter and one obligation | Concrete structural program | Pacing budget and handoff |
|---|---|---|
| 1: A shared rule needs an effect boundary. Condition: competing agents. Cost: lost updates/false permission. Claim: stated coordination and controllability results. Boundary: only mediated paths and named failure classes. | Retain the six-agent opening and crash/power-loss distinction. Move the two-agent port instance from pp. 21–23 immediately after the p. 6 scene in abbreviated form; keep its full trace with the theorem. Reduce the seven-subsystem introduction at p. 9 to what the next proof needs; move subsystem inventory to reference material. Introduce “reference monitor” after the checked effect. Keep atomicity defects at pp. 57–58 prominent. | Rework the first two spreads; relocate about 2–3 pages of inventory/repeated orientation, reinvest at most two in S01/S02. End with exactly what Anchor must authenticate and attenuate—not a second stack tour. SWK:224, 319, 363, 728, 813, 2126. |
| 2: Authority must not grow through delegation. Condition: agents delegate. Cost: scope widening/PID confusion. Claim: attenuation in the stated model. Boundary: verifier and caller coverage. | Keep the PID-reuse scene. Before formal notation, use a three-hop capability with one rejected file path and one expired child. Bring the p. 99 assurance bridge forward as a compact local pointer. State the corrected claim first at pp. 106–108; move the longer history of its withdrawal into one named evidence-history interlude, preserving the correction. Keep full proof obligations accessible. | First spread yields one accepted and one rejected request. Compress/relocate 1–2 pages of historical setup, not proof. End with the gap between authenticated authority and a process that can still reach an ambient channel. AN:184, 234, 442, 538, 680, 912. |
| 3: A useful answer is also a release channel. Condition: mutually distrustful owners. Cost: secret leakage. Claim: finite checks and stated analytical bounds. Boundary: excluded channels and unavailable deployment. | Retain the four-secret/parity instance and paired observations. Move tuple-field details after one work order. Fix side-property evidence and the limits-page collision first. Use S07 to make the release policy concrete. Merge repeated broad assurance descriptions into one local assumption ledger; do not remove distinct release/timing caveats. | One work order before the large tuple; worked finite instance before general claim. Reallocate 1–2 pages, mainly redundant setup. Close with what an operator can observe and what remains unknown. SH:144, 267, 374, 460, 1085. |
| 4: Operators need evidence they can inspect at the available attention budget. Condition: six concurrent agents. Cost: falsely reassuring summaries. Claim: bounded information results and proposed control designs. Boundary: no measured productivity uplift or complete shipped console. | Keep the existing §§4.1–4.3 express route and Mara. Extend rather than replace p. 179; put status beside pp. 185 and 192. Merge repeated “summary versus evidence” explanation around pp. 188–191 into the paired figure plus one interpretive paragraph. Put indispensable philosophical reasoning in the main argument; consolidate nonessential genealogy into one skippable interlude. Separate core review/consent from discovery, paging, and market-dependent mechanisms. | A 12–16-page core route is a target to prototype, not an observed result; link the existing deep sections instead of summarizing them all. Relocate 4–6 pages of repeated setup/catalogs; spend at most four on S03/S05/S06 and status. End with the identity needed to owe a review or obligation after restart. LS:357, 410, 516, 656, 750, 809, 1238, 2456, 3890. |
| 5: Records and obligations can outlive a process without restoring its mind. Condition: restart/name change. Cost: lost attribution or reset sanctions. Claim: identity/continuity results under explicit assumptions. Boundary: cross-operator identity and semantic restoration. | Keep Alice and the role/person diagram. Correct p. 268. Move the role/person distinction at pp. 271–272 before the prior-art/estimator survey at pp. 268–270. Retain the philosophical distinction needed for continuity, but collect optional pp. 273–280 genealogy into one labeled interlude. Merge the two closing market handoffs. Bring recovery inventory next to the continuity distinction. | Recover roughly 2 pages from duplicate handoffs; move 4–6 pages out of the main reading lane, not out of the Book. Present sanction numbers → identity claim → proof → countercase. End once, with portable identity/reputation obligations owed to the market. SP:340, 359, 490, 589, 841, 1029, 2531, 3351. |
| 6: Payment, collateral, and closure are different obligations. Condition: strangers exchange work. Cost: unpaid or stuck work. Claim: accounting and conditional mechanism results. Boundary: custody, measurement, and judge assumptions. | Use the existing three-sided example, then one complete settlement before further taxonomy. Keep the impossibility/assumption discussion near the mechanism it constrains. Correct conserved-but-stuck escrow. Merge repeated market introductions; move long alternative-mechanism surveys to history/reference unless a later claim uses them. | One trade in first two spreads; 2–3 pages of repeated setup relocated. Give one before/after ledger before conservation notation. End with who can judge a disputed result and on what evidence. HE:350, 636, 1000, 1052, 1140, 1784. |
| 7: Evidence does not choose its own judge. Condition: incomplete or contested outcomes. Cost: ungrounded settlement. Claim: conditional governance/incentive and ledger results. Boundary: human judgment, sampled assumptions, actual mediation. | Pull a short, corrected version of the p. 474 login-bug case into the opening. Retain the full case as the concluding integration test. Compress repeated three-layer restatement, not the distinct Sen/allocation argument. Keep one optional intellectual-history interlude. Separate fault recovery from blame: a crash is not sabotage. | Prototype a 3–4-page scene/claim entry; relocate 3–5 pages of repeated architecture and legalistic setup only after checking their dependencies. S04 and S09 must share the same status vocabulary. End with which evidence/authority can cross an operator boundary. BC:238, 414, 603, 720, 737, 1544, 2106. |
| 8: Evidence can cross a boundary without transferring sovereignty. Condition: two operators. Cost: stale/overbroad remote action. Claim: stated transfer, revocation, consistency, settlement results. Boundary: delivery, timing, local authority, open conjectures. | Keep the two-machine opening and “not a shared database” boundary. Bring a short excerpt of the p. 519 schema task before the four-message ceremony. Use the disconnected/revoked branch before the convergence bound. Put a small graph with actual conflicting witnesses before sheaf terminology. Preserve the full topology argument and counterexample. | Move 1–2 pages of advance catalog/notation behind first use. One local/remote task precedes formalism; no invented universal offline-revocation guarantee. Close with a reader decision and explicitly unresolved institution, not a ninth architecture overview. FH:192, 240, 324, 380, 455, 518, 901. |

These budgets are not additive guaranteed cuts: relocating material changes the main lane without necessarily shortening the bound volume. First remove exact duplication, then measure the rebuilt pages. Do not impose a percentage cut that discards caveats or proofs.

Across chapters, aim for no more than three content kinds on an ordinary page and no run exceeding four body pages without a meaningful example, table, figure, or trace. These are editorial QA thresholds from the Book skill, not evidence of improved learning. Exemptions, such as a continuous proof, need a stated reason and an expert route. A tiny ornament does not reset the count. Keep mandatory cross-reference excursions to at most two per ordinary teaching page as a proposed testable target.

Close each chapter with Review of Key Ideas → section-grouped Exercises → History and references → explicit handoff. Keep solutions linked both ways. Do not place a new definition between a proof's indispensable assumption and its statement, or hide a necessary premise in optional marginalia.

## 8. Theorem and proof pedagogy

Preserve rigor; repair the order in which the reader earns the notation. Every major result needs ten identifiable beats: situation, failure, worked instance, intuition, local definitions, formal claim, proof idea, proof/evidence, read-out into the instance, and boundary. These need not become ten boxes or headings.

### Separate three independent classifications

| Axis | What must be visible | What it must not imply |
|---|---|---|
| Claim kind | Theorem; Design invariant; Model-checked property; Empirical hypothesis | A design invariant is not automatically proved; a finite check is not unrestricted verification. |
| Implementation status | The Book's defined grades, with missing parts and dated evidence where available | A theorem does not turn a specified mechanism into shipping code. |
| Assurance mode | Observed, Coordinated, Brokered, Confined, Attested, scoped to an effect/threat | Not a single universal maturity ladder; a credential does not itself mediate every effect. |

Use a compact result header: **Claim → assumptions → evidence object → boundary**, plus the appropriate kind/status/mode. The exact artifact, revision, checker configuration and bounds belong in the evidence record; unknown fields say unknown. Never label the manuscript's artifact counts or CURRENT flags as a fresh CI result.

| Result home | Teaching intervention | Hand-check and transfer test |
|---|---|---|
| SWK pp. 19–22, 33–37; `thm`/claim near source 813 and 1258 | Put a losing acquire and stale epoch before the general gate/controllability claim. Draw the uncontrolled direct-write channel as well as the guarded one. Say which assumption closes which path. | Learner predicts a cooperative conflict and a bypass, then explains why a database invariant alone cannot stop the latter. Expert finds the formal assumptions without reading the scene. |
| AN pp. 84–99, 106–108; AN:234, 442, 680 | Work a three-hop scope/TTL attenuation with an attempted widening. Explain protocol-model result, bounded Rust harness, and runtime caller obligation in separate sentences. | Reject the widening; identify what 32-byte inputs and stubbed cryptography do not establish. Do not infer cryptographic correctness from no-panic checking. |
| SH pp. 146–149; `sec:sealed-noninterference`, SH:460–563 | Retain the small secrets/release example. State the finite state space and depth-seven bound before the result. Turn the proof idea into paired-observation reasoning; distinguish a model-check report from a deductive theorem. | Two different secrets with the same allowed release produce the same modeled observation. Changing the release function or adding a timing channel is an explicit new obligation, not a covered case. |
| LS pp. 213–217; `sec:lowerbound`, LS:1698 onward | Precede the counting bound with a tiny identification problem. Four equally possible locations need at least two bits for guaranteed identification in the toy noiseless setting. Then define the actual event/flag model; do not pass the toy off as the full theorem. | Enumerate four cases and four distinguishable answers. Reader explains why this is not a prediction of review seconds or tool productivity. Preserve the reported failed formulation and missing channel. |
| SP pp. 268 and 287 onward; SP:340, 1060, 1106 | Work the three sanction regimes before naming the identity necessity. Define the comparison baseline. Place proof intuition between table and general statement. | At scores 50, 80, 90 with loss 30 and newcomer 50, accessible scores are 50, 50, 60. Staying advantages are −30, 0, 10 relative to restarting; losses from original records are 0, 30, 30 after the free-remint choice. Distinguish action comparison from realized loss. |
| HE pp. 367 and 381–382; HE:1140, 1790 | Use one double-entry transfer to teach conservation, then the unchanged 560 CR escrow to teach the safety/liveness distinction. Place the conditional economic assumptions beside their proposition. | A reader can make settlement stop without changing the total, and identify the separate omitted-debit case that changes it. No inference from conserved credits to enforceable custody. |
| BC pp. 426–427, 474–476; BC:720, 737, 2106 | Separate observed failure, culpability, admissible evidence, judgment, and settlement into named steps. Rewrite the recovery proof obligation before the integrated story. | A crash does not by itself justify slashing; a test result supports only its recorded revision/scope; a successor cannot infer missing state from a hash. |
| FH pp. 496 and 502 onward; FH:469, 518, 529 | Give the revocation bound its delivery and clock assumptions first. Use three witnesses and an explicit conflict before the sheaf/local-to-global terminology. Keep the counterexample where local agreement does not prove global consistency. | Learner identifies which bound fails under disconnection; expert can locate the exact topology and witness assumptions. Never “repair” an open conjecture by making its prose more certain. |

For proofs longer than roughly ten lines, use named hierarchical steps, normally four to ten at a level. Begin with a plain-language plan, name imported results, state what each case establishes, and finish by translating the conclusion back to the scene. Do not replace the proof with an analogy. If a proof depends on an unestablished premise, label the dependency; do not invent a lemma to smooth the exposition.

Exercise revisions should retain CHECK/TRACE/OPEN and add a visible progression: fully worked example → partially completed trace → novel transfer → optional open question. Give common wrong answers their own feedback: “valid signature therefore safe write,” “green test therefore current head,” and “conserved therefore recoverable.” Return to one earlier-chapter assumption in each later chapter. Pilot first with Liam's existing exercises 1.10–1.12; do not redesign a functioning exercise system wholesale.

## 9. Exact figure, marginalia, and table interventions

Each item below has one information job. Claim sentences are proposed caption leads, not claims of current implementation. Figure numbers are current Book numbers; retain stable labels when possible. Do not add a visual merely to satisfy a page-density quota.

| ID / anchor | Form and exact information difference | Caption or margin lead / acceptance |
|---|---|---|
| V01: pp. 21–23, SWK:813–879 | Six-row reservation/listener table plus the existing claim-state diagram. Add the unmanaged-process branch; remove duplicated prose narration of every transition. | “A recorded reservation and a listening server are different observations.” All values/outputs labeled synthetic unless recorded with provenance. |
| V02: p. 179, LS:338; S02 | Retain the three-edit failure; add a coordinated repair as a separate aligned small multiple using the same inputs. Use the full text-plus-margin field if needed. Do not cram repair into the already dense branches. | “The gate stops the stale effect; it does not supply the missing test.” Same time direction, consistent artifacts, explicit split/merge points; color is not the only outcome encoding. |
| V03: p. 189, LS:656–673; S03 | Preserve Figure 4.3's two evidence structures. Add revision tags to diff/run/review endpoints and a visibly stale endpoint, not a third decorative tree. Shorten caption; reduce excessive leading whitespace only after placement review. | “A useful summary names evidence for this revision.” Reader can trace every assertion to an endpoint or identify the missing one. |
| V04: p. 185/192, LS:588/809 | Compact status line plus a four-row consent table: requested action, authorized scope, checked channel, refused/unknown effect. Put it at first use and scene return. | Margin: “Permission is a policy; enforcement needs an effect boundary.” Proposed actions are visibly proposed without an appendix trip. |
| V05: p. 164, SH:1083–1097 | Separate figure/table caption slots; use one concise caption and body explanation for each. Keep the six exclusions in an exact table. | “These channels remain outside the modeled guarantee.” No caption overlaps; no excluded channel disappears during tightening. |
| V06: pp. 147–149, SH:460 | Preserve paired-secret small multiples. Add direct labels for secret, permitted release, modeled observation, and excluded observation. Put model size/depth in an adjacent evidence note. | “Equal permitted releases are indistinguishable in this finite model.” Check with the actual enumerated model; the sentence is not an unrestricted deployment claim. |
| V07: p. 268, SP:340/1106 | Three-row exact-value table at scores 50/80/90; optional tiny threshold strip only if it clarifies the crossover. No smooth fitted curve. | “Reminting helps only below the 80-point threshold in this example.” Show original, sanctioned, fresh, chosen score and comparison baseline. |
| V08: pp. 381–382, HE:1790/1831 | Two synchronized ledger rows: before outage and after outage. Balances unchanged; settlement authority unavailable. Add a separate amendment row only with a specified debit/credit error. | “The credits are conserved, but nobody can close the escrow.” Never encode inactivity as lost value. |
| V09: p. 475 and pp. 47–49, BC:2121; worked-example figure | Rebuild the three-lane timeline from one event table. Add detection, lease/epoch, durable-evidence, and successor-ready markers, using separate diagrams if four questions overcrowd one. | “A successor inherits recorded obligations, not the predecessor's execution.” Shared axis, valid times, open unknown intervals, late-effect branch, exact failure-class label. |
| V10: pp. 493–496, FH:380/455 | Four-message sequence with local authorization boundary and a disconnected revocation branch. A small table gives assumptions/bounds. | “A valid remote message still requires a local authority decision.” Remote transport and local effects are visually distinct; no invisible instant revocation. |
| V11: p. 598, APP generated mechanization tables; Generator:1258 | Replace the five narrow, heavily wrapped columns with a two-level record: claim/artifact/check/status header row, then a full-width evidence-policy row. Change `renderMechanizedClaims`, preserving the Corpus input; do not hand-edit generated cache output. Keep exact paths copyable; use continuation heads. | “This harness checks these inputs under these substitutions.” Path, configuration, bound, and caveat remain legible at printed size. A status flag alone is not the finding. |
| V12: vii/595 and first mechanism uses | A compact cross-classification example, not another five-rung ladder. Example rows distinguish cooperative file claim, selected credential broker, and actual process confinement; each has mechanism status and evidence kind. | “What is enforced, what exists, and what is proved are different questions.” No hue-only status. Do not imply an unavailable example is shipping. |

Use marginalia sparingly and consistently. Exact proposed first-use glosses: **claim**—a recorded cooperative reservation; **capability**—a credential naming permitted actions; **fencing epoch**—a generation checked before accepting an effect; **work unit**—the case file that survives an agent; **attestation**—evidence about a measured environment, not proof an answer is true. The body carries every indispensable assumption. A margin note may supply a gloss, an evidence pointer, a counterexample, or an exercise return; not all four beside the same paragraph.

The current shared pedagogy source already defines `pdgloss`; do not create a competing macro because an older reference calls it missing. During final readback another contributor also added `pdsampledata` around PED:1012–1055 in both shared copies. Reuse and validate that work rather than commission a duplicate; its presence in source is not proof of an accepted rendered Book treatment. Use outer margins: left on even pages, right on odd pages. Portraits are optional only where a person's specific idea is doing work, at most one per section; do not introduce them to repair prose density. A philosophical aside is bounded and skippable, with the analogy's failure point stated.

Preserve the edition's expressive hierarchy: white artifacts, quiet neutral states, outlined concepts, pale focus fields, categorical texture, and a reserved solid culmination. Do not flatten Swiss pages into identical solid boxes. Use readable labels, real arrow shafts, direct series labels and aligned scales; a broken edge or tiny text is not fixed by an aesthetically pleasing palette. New sample treatment belongs in shared machinery, not bespoke frames.

## 10. Ambitious additions the Book does not yet supply as a system

These are deliberately new reader experiences, not claims that the Book lacks all their ingredients. Existing counterexamples, result atlas, exercise solutions, and implementation appendices are foundations. Absence is scoped to the inspected Book's recurring apparatus, not every file in the repository. Prototype after P0 corrections; discard any that adds ceremony without improving a decision.

### N01. The adversarial reading edition

Give each chapter one “remove this assumption” fork, integrated with the running case. Remove mediation, current-head evidence, a durable record, a trustworthy oracle, or bounded delivery; ask the reader to choose the first claim that fails before revealing the countertrace. Begin with C02/S04, because it exposes a real manuscript overclaim. Experts get a direct counterexample link; novices get a partially completed trace. Acceptance: the removed premise genuinely supports the failed claim, and both branches agree with the formal statement. This is not an invented theorem or a game awarding trust points.

### N02. A paper evidence capsule that can fail

For W-17, provide a small offline teaching packet: task scope, base/final identifiers, diff excerpt, test receipt, cancellation record, missing artifact, and successor decision. One packet deliberately pairs a green old-head result with a new diff. Readers audit it without installing or starting anything. An answer key identifies what can and cannot be concluded. This extends, rather than duplicates, Figure 4.3. Acceptance: every conclusion is traceable to a supplied record; unsupplied execution state remains unknowable. A future real capsule must be clearly separated from this synthetic one.

### N03. A decision receipt, not a completion badge

At the end of a short route, the reader records: question, claim understood, assumptions accepted, evidence inspected, unresolved requirement, decision, and reason to reopen. Valid decisions include “use the idea,” “audit the artifact,” “not enough evidence,” and “not my task.” The Book currently helps readers navigate; this would help them leave accurately and return after interruption. Acceptance: the receipt cannot be completed by copying a blanket “verified” label.

### N04. The no-adoption counterchapter

A two-page, explicitly optional case in which adding this coordination machinery is the wrong decision: one developer, infrequent collisions, no cross-operator exchange, and insufficient evidence for claimed savings. Compare manual coordination, a minimal existing workflow, and the proposed mechanism by required obligations—not invented benchmark bars. State what changed circumstance would justify revisiting the decision. This makes the research useful to Sophie, David, and Priya without redefining them as buyers. Acceptance: no fabricated cost data; the simplest option is allowed to win.

### N05. One failure, four policies, no concealed rescue

Replay S02 with observation only, cooperative coordination, one brokered effect, and a specified confined process. Keep actions and ordering fixed; mark what each policy prevents, detects, or cannot see. This is a controlled counterfactual teaching surface, not four benchmarked product modes. Explicitly show that categories are not a universal ladder. Acceptance: changes in outcome follow only from the changed assumption, not a silently smarter agent or newly available test.

### N06. Interruption-aware proof re-entry

At selected long proofs, place a small “resume here” marker containing the current subgoal, established facts, and the next dependency. Pair it with one delayed-retrieval exercise from a previous chapter. This addresses context recovery without forcing experts through another summary. Acceptance: a returning reader can name the outstanding proof obligation; the marker introduces no new premise and does not reproduce a page of prose.

No new feature is a promised learning improvement. N01/N02 are the highest-value prototypes because they test the Book's central distinction between a convincing narrative and inspectable evidence. N04 is a deliberate challenge to product-centered assumptions; keep that dissent even if it never becomes a full spread.

## 11. Prioritized implementation queue and gates

This is a future queue, not authorization to modify chapters in this pass. Roles describe review competencies, not agents actually spawned. P0 is correctness/claim integrity; P1 is the smallest coherent reader-route pilot; P2 is volume-scale expansion. No runtime-based validation is permitted while the operator's halt remains in force.

| Queue | Priority / owner competence | Exact scope and dependencies | Acceptance test / evidence |
|---|---|---|---|
| Q01 | P0 · mathematical editor | C01; p. 268; SP:340 and matching full worked table | Hand calculation for 50/80/90 agrees with both prose and table; baseline labels explicit; unchanged formal scope. |
| Q02 | P0 · systems + formal reviewer | C02/C03/C12; pp. 427, 474–476; BC:751, 2106; worked-example figure. Depends on no cosmetic redraw. | One coherent event/authority/recovery inventory; no successor-before-detection or unqualified lossless recovery; current product and hypothetical mediated design clearly separated. |
| Q03 | P0 · security/evidence editor | C04/C06/C10; pp. 143, 383, vii/595–596; SH:374, HE:1875, FRONT:227, APP:36/100 | Every local scope/status statement matches the relevant formal statement and implementation boundary; missing artifact remains explicit. Review excerpts in isolation. |
| Q04 | P0 · mechanism-design reviewer | C05; pp. 381–382; HE:1790/1831 | Conserved-but-stuck trace balances exactly; amendment threat separately specified; caption/table/body use the same property. |
| Q05 | P0 · Book compositor | C07/C08; pp. 164, 215; SH:1083, LS:1685 | Rendered caption collision removed in assembled Book; false panel reference removed or actually supplied; no invented productivity curve. |
| Q06 | P0 · structural editor | C09/C11; v/176, pp. 324–325/334–335; FRONT:201, SP:2531/3351 | One global map and one authoritative market handoff; unique labels and working link destinations; retain local express lane and unique obligations. |
| Q07 | P1 · evidence-information designer | V11/V12; pp. 99–108, 598, vii/595; AN:538/680, APP inclusion, Generator:1258 and Corpus | Exact claim/artifact/configuration/bound/status record legible at final size; no fresh-CI assertion; no maturity/assurance conflation. Keep manifest content stable unless separately correcting evidence. Depends on Q03. |
| Q08 | P1 · UX/editorial | Four exits in §3; iv–viii; FRONT:184–238; existing reader-map figure | A novice and an expert each find the appropriate initial page and stopping test without analyst routing. No installation or adoption implied. Depends on Q03/Q06 vocabulary. |
| Q09 | P1 · developer-experience writer | S01/S02, V01/V02; pp. 18–23/179; SWK:728/813, LS:338 | Same-input failure/repair/bypass trace; reservation versus listener distinguished; all fictional data labeled. Pilot before expanding the scene across chapters. |
| Q10 | P1 · operator-UX writer | S03/V03/V04; pp. 185–192 and 257–259; LS:588/656/809/3890 | The scene, evidence figure, and local status fit one short route; reader rejects old-head green and identifies proposed consent. No claimed ten-second measured win. |
| Q11 | P1 · recovery specialist + pedagogy | S04/V09/N02; pp. 47–49/474–476; SWK:1742, BC:2106 | Offline capsule differentiates committed/missing state and stale authority. Depends on Q02. At least one packet is undecidable from supplied evidence and answer key says so. |
| Q12 | P1 · textbook editor + domain reviewers | First formal-result pilots in §8: SWK gate, SH finite check, SP sanction | All ten teaching beats present without ten boxes; expert finds claim/assumptions directly; novice performs hand-check and novel countercase. Depends on Q01/Q03/Q09. |
| Q13 | P1 · shared LaTeX engineer/compositor | Reuse/validate the concurrently added `pdsampledata` and existing gloss apparatus; PED:370–409, 1012–1055 and shared twins | One reusable implementation; synthetic and recorded examples unmistakable; outer margins correct; real Book preamble; no A4 or separate chapter PDF. No chapter-specific frame proliferation or overwriting concurrent work. |
| Q14 | P2 · chapter editors | Eight pacing programs in §7, beginning Ch. 4 and Ch. 5 | Before/after outline names every moved/cut/merged block and where obligations survive. First-spread checks, proof access, and meaningful page rhythm pass. Depends on P0 and a reader pilot of Q08–Q12. |
| Q15 | P2 · security/federation writers | S05/S07/S08, V06/V10; LS:516/2456, SH:460/1085, FH:380/455/901 | Cancellation, release, and disconnected-revocation boundaries explicit; each new scene passes actor/artifact/effect/evidence/boundary test. No product behavior invented. |
| Q16 | P2 · visual-evidence writer | S06; pp. 189/191; LS:656/750 | Actual specimen capture metadata when available, otherwise labeled schematic; no visual-completion claim from tests alone. Operator-owned pixel review required for acceptance. |
| Q17 | P2 · adoption/evidence editor | S09/S10/N04; HE:1784; front-matter evaluation exit | Current versus hypothetical data separated; blank measurements stay blank; legitimate no-adoption outcome; no fabricated case study, cost saving, or testimonial. |
| Q18 | P2 · pedagogy + skeptical reviewer | N01/N03/N05/N06; first pilot at SP:1060, SWK:1258, BC:2106 | Correct failed-assumption branch; decision receipt admits uncertainty; fixed-input policy comparison; re-entry marker introduces no premises. Keep only prototypes readers actually use. |
| Q19 | Release gate · build/visual reviewer | Assembled Book, manifest/generator, affected shared figure twins | Generate/compile the Book in Swiss, maritime, technical; inspect affected pages and facing spreads at final size; no unresolved references, duplicate labels, clipping, tiny labels, caption/arrow collisions. Exact-head hosted checks and operator visual evidence required before declaring a later rewrite ready. |
| Q20 | Release gate · reader-study facilitator | Real-reader protocol below; hashed before/after artifacts | Record unaided/assisted routes, correct bounded decisions, evidence lookup, return after interruption, expert access, and observed failures. Report actual counts, not inferred population improvement. No simulated score uplift substituted for testing. |

### First implementation slice

Do Q01–Q06 before expanding content. Then prototype only the front-matter exit, the pp. 179–192 evidence route, and one corrected recovery capsule (Q08/Q10/Q11). Test that slice before commissioning eight complete chapter rewrites. This gives an evidence-backed decision about the proposed reading architecture without multiplying an untested apparatus throughout 661 pages.

### Real-reader validation, still unperformed

Recruit a small purposive pilot spanning beginners, experienced AI developers, proof-oriented systems/security readers, operators, nontechnical evaluators, and mechanism-design/institutional readers. A suggested first pass is two per group, twelve people, followed by targeted recruitment for observed failures. This is exploratory, not a powered study or a representative sample. Include accessibility needs deliberately; do not infer them from the persona catalog.

Use the same tasks on before/after excerpts with order counterbalanced where practical. Preserve page context and record the exact PDF hash. First observe unaided navigation; offer help only afterward and label assisted results. Ask each reader to:

1. Select a reading route and state when they would stop.
2. Explain one concrete failure and one relevant mechanism.
3. Distinguish design, implementation, proof/model evidence, and assurance boundary.
4. Find the artifact for a claim and identify the checked revision/scope—or accurately say it is absent.
5. Solve a small transfer case with one assumption removed.
6. Resume after an interruption and identify the outstanding decision or proof obligation.

Record time descriptively, wrong inferences, detours, assistance, subjective effort, and the reason for stopping. Proposed local acceptance gates: no participant is left believing the sample proves unavailable confinement or a measured productivity benefit; every observed serious scope misunderstanding triggers revision and retest; an expert can reach the formal statement without the tutorial; a novice can correctly explain the supplied small case after the intended route. These are design gates, not guarantees of zero misunderstanding in the population. Fix unclear task prompts before blaming the page.

Readability and correctness are separate gates. An elegant page with a wrong clock fails; a correct but unreadable table also fails. A real user who accurately declines adoption is not a failed conversion. A referee who disputes a theorem's premise is not merely experiencing UX friction.

## 12. Source routing and instruction provenance

### Canonical source key

Line anchors throughout are starting points, not frozen ranges. Use the named section/label and the hashed PDF together. The canonical manifest, not a similarly named twin, determines chapter input. The front matter is authored in the orchestration root; generated body/map/manifest material must be changed at its generator or authoritative input, not patched only in a cache.

| Key | Canonical source |
|---|---|
| SWK | [Single-Writer Kernel](../../../../whitepaper/single-writer-kernel.tex) |
| AN | [Anchor Protocol](../../../../website-v2/public/whitepaper/anchor-protocol-whitepaper.tex) |
| SH | [Sealed Harbor](../../../../website-v2/public/whitepaper/sealed-harbor.tex) |
| LS | [Legible Swarm](../../../../whitepaper/legible-swarm.tex) |
| SP | [Spawn to Person](../../../../website-v2/public/whitepaper/spawn-to-person.tex) |
| HE | [Harbor Economy](../../../../website-v2/public/whitepaper/harbor-economy.tex) |
| BC | [Bonded Commons / agent transactions](../../../../website-v2/public/whitepaper/agent-transactions-whitepaper.tex) |
| FH | [Federated Harbor](../../../../website-v2/public/whitepaper/federated-harbor-whitepaper.tex) |
| FRONT | [Book orchestration root and front matter](../../../../website-v2/public/whitepaper/coordination-papers-mega-volume.tex) |
| APP | [Book-owned appendices](../../../../website-v2/public/whitepaper/coordination-papers-mega-volume-appendices.tex) |
| PED | [Shared pedagogy source](../../../../whitepaper/figures/pd-pedagogy.tex) |
| Manifest | [Canonical chapter order and source mapping](../../../../whitepaper/textbook.json) |
| Generator | [Assembled Book generator](../../../../scripts/generate-mega-whitepaper.mjs) |
| Corpus | [Proof-estate manifest used by generated evidence tables](../../../../whitepaper/corpus.json) |
| Worked-example figure | [Three-lane recovery timeline](../../../../website-v2/public/whitepaper/figures/fig-worked-example.tex) |

### Required reading completed and how it changed this program

All ten named skills were read completely. The required references were read completely, not delegated or replaced by summaries. The three research-submission references below are the only references selected for that skill; technical-writer was read as SKILL.md only. The four complete cohort reports are linked in §1.

| Skill / selected references | Material influence |
|---|---|
| [`harbor-book-rewriter`](../../../../skills/harbor-book-rewriter/SKILL.md) | Assembled 7×10 Book is the unit; two reading lanes, scene-to-claim teaching, sample provenance, shared visual grammar, explicit status, and final-size visual acceptance. Re-read after the concurrent commit. |
| `agentic-coding-ux-designer` | Entry intent, progress, review, control/recovery, and evidence translated into reading tasks. No web-interface score or browser-layout test claimed for a PDF. |
| `productive-discourse-facilitator` | Steelman opposing readings, ask what evidence changes the decision, preserve dissent, and distinguish clarification from agreement. |
| `recursive-synthesis` | Divergence from four cohorts, structured challenge, consolidation, and bounded next validation. Product/engineering/design perspectives were analytical lenses, not newly convened reviewers. One-file scope overrides multi-document or spawned-review defaults. |
| `tufte-evidence-design`; references: `doctrines.md`, `critiques-and-limits.md`, `margin-apparatus.md`, `sources.md`, `web-application.md` | Choose the relation before the drawing; exact tables where appropriate; direct labels, common scales, evidence integrity, accessible redundant encodings, restrained marginalia. All five references read. |
| `research-paper-submission`; references: `exemplar-structures.md`, `exposition-craft.md`, `figures-and-examples.md` | Condition/cost/claim, worked example before formal generality, precise contribution/boundary, explanatory captions, community-sensitive exposition. Submission formatting is not applied to this Book. |
| `textbook-craft`; references: `chapter-template.md`, `exercise-design.md`, `learning-science.md`, `canon.md`, `sources.md` | Chapter obligations, first-spread structure, worked/faded/transfer practice, expert access, proof plans, section-grouped exercises, return pointers. All five references read. |
| `high-quality-latex-whitepaper` | Shared semantic macros, robust links/labels and tables, inspect warnings and rendered pages. No imported standalone/A4 preamble. |
| `port-daddy-expository-writer`; references: `analogy-toolkit.md`, `verifier-cheat-sheet.md`, `voice-references.md` | Warm concrete explanation, explicit analogy limits, correct verifier vocabulary, independent checking of current claims. All three references and its required voice note read; older verifier summaries are not current evidence. |
| `technical-writer` | Separate explanation/reference from how-to/tutorial; define first-use terms; give the reader a clear next decision. No additional references loaded for this skill. |

Conflicts are resolved explicitly: the Book's current outer-margin parity overrides an older always-right-margin suggestion; its shared sample-paper treatment overrides a blanket no-fill preference for that material; current source overrides a stale note that `pdgloss` is missing. Analogy quotas and decorative suggestions do not override mathematical accuracy or pacing. The user's one-file, no-chapter-edit, no-commit, runtime-halted scope overrides any skill's normal implementation/commit ritual.

Report-only validation: all 24 native friction/I/U/T rows were checked programmatically against the cohort tables, the reported distributions and threshold counts were recomputed, and local links were checked for existing targets. The report contains 12 correction briefs, 10 scene briefs, 12 visual interventions, six new-apparatus proposals, and 20 queued items. These checks validate transcription and report structure, not the correctness of the Book's proofs or the effectiveness of the proposed rewrite.

The handoff is therefore a program with verified defects, simulated reader hypotheses, concrete intervention briefs, and tests—not a claim that the Book has been rewritten or that any reader outcome has improved.
