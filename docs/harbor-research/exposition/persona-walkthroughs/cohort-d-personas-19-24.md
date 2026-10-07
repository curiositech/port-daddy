# Cohort D: persona walkthroughs 19–24

Assessment date: 2026-09-17. Canonical order: Chris Whitfield, Morgan Reyes, Aisha Bello, Liam O'Connor, Sophie Turner, Victor Aldana.

## Scope, evidence, and scoring

This is a **SIMULATED reader study**, not interviews, observed task completion, or a product verification. It evaluates the assembled *The Harbor, the Person, and the Economy* as a reading experience. All dialogue, stopping behavior, scores, and proposed interventions are analyst judgments informed by the canonical personas. No local Port Daddy command, runtime, hook, service, daemon, or MCP was used. No chapter PDF was consulted. The analysis pass edited no Book source.

Primary artifact: a local proof build of the assembled Book, 661 pages, 504 × 720 points (7 × 10 inches), PDF creation timestamp 2026-09-17 02:12:42 PDT. SHA-256: `1d9d273470018b45f5e125a87bdf6de1fa706abaaec3b4239ae9bad6da1454e2`. Repository HEAD when inspected: `33fa6ddde026b909eefb5d1d3d2adbe5c4befb41`. The worktree already contained unrelated changes; HEAD does not certify the PDF's build inputs.

**Citation convention:** `p.` refers to the Book's printed Arabic page number; its PDF viewer page is `p. + 18`. Thus p. 179 is PDF page 197. Front-matter iv–ix corresponds to PDF pages 4–9. The title/colophon is PDF page 2. Some even appendix and solution pages display the chapter running head instead of an Arabic folio; PDF offsets still identify them. Findings below are about this artifact, not a later rebuild.

The required skills were read completely: repository skill [`harbor-book-rewriter`](../../../../skills/harbor-book-rewriter/SKILL.md), plus `port-daddy-users`, `ux-friction-analyzer`, and `product-appeal-analyzer`. Profiles 19–24 came from the canonical persona reference supplied by `port-daddy-users`. None of these six entries specifies a Book reading track. Routes are therefore explicitly inferred from their goals, the reader map on vi–vii, course paths on viii, contents, and chapter structure. Victor is evaluated last, against the favorable readings as well as the defects.

The Book rewriter skill supplies the scene → mechanism → claim → boundary lens. The friction skill supplies cognitive load, orientation, interruption recovery, and completion concerns. The appeal skill supplies identity fit, problem urgency, and trust. Its usual 1–10 scoring is replaced by the user's requested 1–5 scale; no conversion or precision beyond ordinal judgment is implied.

| Scale | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| Friction: higher is worse | Clear, little effort | Small recoverable obstacle | Substantial rereading or lookup | Assistance or a major detour likely | Likely abandonment of this reading task |
| Appeal: higher is better | Little reason to continue | Weak relevance or confidence | Conditional interest | Strong reason to continue | Compelling fit and payoff |

Each persona receives four friction dimensions and the three appeal vertices, with local evidence. Overall scores summarize the persona's task, not an arithmetic average. The opening test adapts the appeal skill's four questions: what is this, who is it for, what does it promise, and what next? It is a prediction, not an actual timed five-second test.

Text inspection covered the front matter; pp. 1–13, 18–25, 46–49, 69–71, 83–87, 106–108, 175–191, 257–260, 265–273, 541–542, 595–598, and 613–614. Rendered pages inspected successfully: PDF 2, 4, 6, 7, 41, 197, 207, 286, and 631, corresponding to the colophon, iv, vi, vii, and pp. 23, 179, 189, 268, 613. Raster previews retained the complete page proportions; they are not a physical print proof or exhaustive visual QA. PDF 1 text was read, but its attempted image display was unavailable and supplies no visual finding. Renders were streamed for inspection without creating additional files.

The friction skill's real-user, timing, error-rate, and accessibility gates remain unmeasured. Browser reflow/touch-target checks do not establish the quality of this fixed-page PDF, and this task changes no rendered Book page. No claim of passing those gates, testing hyperlinks, reproducing the Book's proofs, or verifying current implementation is made. “Implemented,” “verified,” and similar terms below describe what the Book says.

## Shared source observations

These are observations of the source artifact. Their reader consequences and proposed remedies appear separately below.

| ID | Book evidence | Observation |
|---|---|---|
| E1 | iv–v; vii–ix | The Book says it is ahead of the product, distinguishes models from implementation, explains the work unit as a case file, and gives evidence vocabulary. This is substantive candor, but the entry also introduces many terms before one complete everyday example. |
| E2 | vi–viii; rendered reader-map spread | Five named reader rows cover practitioner, systems engineer, security reviewer, mechanism designer, and institutional theorist. Stroke weights encode reading depth; the legend is on the right-hand page. Four course routes are also provided. There is no named beginner, PM, or business-owner route, nor a short task-specific stopping point. |
| E3 | pp. 6–10 | Six agents overwriting a file is a concrete opening, followed by the architecture stack, reference-monitor argument, maturity taxonomy, and seven subsystems. The actual two-agent port race arrives at pp. 21–23. P. 8 explicitly limits mediation to routed operations and names the same-user bypass. |
| E4 | pp. 18–25; rendered p. 23 | Claim granularity, the free/held/expired state machine, pseudocode, fencing epochs, Alice/Bob's race, and a terminal example provide multiple explanatory forms. The state machine says there is no fairness queue. The terminal example includes outputs and placeholders, but is labeled “AT THE TERMINAL,” without a visible SAMPLE/RECORDED provenance label. |
| E5 | pp. 47–49 | The continuity profile and replay diagram distinguish durable notes from execution state. Event-sourced rehydration is SPECIFIED; it does not restore a model's inference state. This is unusually useful negative guidance for adaptation. |
| E6 | pp. 176–181; rendered p. 179 | Chapter 4 supplies its own express route (§§4.1–4.3), a failure taxonomy, a three-edit settings.json figure, and Mara's six-agent afternoon. The scenario includes five PRs, a 600-line diff, ninety seconds of uninterrupted attention, a deleted failing test, and a proposed force-push. |
| E7 | pp. 183–191; rendered p. 189 | The suppressed-items table distinguishes a threshold, aging, and deduplication; the consent example scopes test-only changes; the two digests contrast artifact links with unsupported green. P. 190 expressly warns that model self-narration is not independent verification. P. 191 provides four design questions. |
| E8 | pp. 176, 185, 257–259 | Chapter 4 deliberately locates engineering status in Appendix 4.A. Mara's scoped-consent scene is on p. 185; the consent grant and unconditional override are marked proposed on p. 259. The attention queue is SPECIFIED and the console PARTIAL on p. 258. These are not undisclosed omissions, but their distance matters for selective readers. |
| E9 | pp. 266–273; rendered p. 268 | Alice's named agents supply a restart/attribution story; the role/person distinction has a two-track figure. The worked sanction calculation says max(90 − 30, 50) = 60, then says “he loses 10 by staying.” A fall from 90 to 60 loses 30; staying at 60 instead of restarting at 50 preserves 10. The arithmetic expression is correct; the verbal comparison is wrong. |
| E10 | pp. 84–87, 106–108, 595–598 | The PID-reuse example separates authentication from runtime identity. The protocol phases identify specific threats. P. 106 withdraws an earlier overbroad verification claim and names 32-byte inputs, stubbed cryptography, and the compiler gap. Appendix A/B repeats boundaries and names artifacts and checks. These remain documentary claims here. |
| E11 | pp. 69–71, 541–542 | Exercises are grouped by section, labeled CHECK/TRACE/OPEN, rated, and accompanied by solution page pointers. Solutions 1.10–1.12 explain retry behavior, the losing acquire, and conditional fairness. This supports a short learning loop without running anything. |
| E12 | v versus p. 176; vii versus p. 595; pp. 613–614 | Front matter promises no chapter-specific reader map, yet p. 176 gives “The route through this chapter.” Vii orders assurance modes by increasing enforcement; p. 595 says they are not a maturity staircase or totally ordered. The Result Atlas gives eight propositions and boundaries, with detailed verification artifacts delegated to a companion manifest. |

## 19. Chris Whitfield — reusable patterns for client work

**Persona anchor.** Independent prompt engineer and AI consultant; deep conceptual understanding of multi-agent workflows; wants patterns he can teach without requiring clients to adopt this product. His relevant alternative is extracting patterns from architecture documents and source; that alternative is inferred from his goal, not an observed workflow.

**Inferred reading path and stops.** Enter at v–vii to identify the practitioner route. Briefly visit §1.5, pp. 18–23, for claims and fencing; §1.8, pp. 46–49, for salvage limits. Read Chapter 4's own express route, pp. 176–191, especially the worked afternoon, consent, and verifiable digest. Check pp. 257–260 before treating any mechanism as available. Follow the practitioner route into Chapter 5, pp. 266–268 and 271–273, for persistent attribution and role/person separation. Stop before §5.4's philosophical development and defer market/federation chapters until a client actually needs cross-operator exchange. Successful stopping point: a teachable pattern with its assumptions and failure boundary, not a product recommendation.

**Opening-test prediction.** Category, audience, and promise are recognizable to him from the subtitle and v. The map suggests a destination, but does not provide the compact extraction route he needs. Next action is only partly clear.

| Friction dimension | Score | Evidence and predicted effect |
|---|---:|---|
| Orientation | 2 | E2 names a practitioner route; E6 adds an express lane. He can enter, but must infer which kernel prerequisites matter. |
| Conceptual load | 2 | Claims and salvage match his background. E5 usefully separates replayed inputs from recovered execution; maritime and philosophical names add translation work. |
| Navigation/recovery | 4 | E8 sends him from p. 185 to p. 259 to determine whether the client could actually use the consent mechanism. His teaching notes need two distant evidence locations. |
| Task completion/transfer | 4 | E4–E5 explain ingredients, but the inspected route does not carry one crashed agent's exact files, leases, notes, obligations, and successor decision through an entire portable recovery trace. |

| Appeal vertex | Score | Evidence and predicted effect |
|---|---:|---|
| Identity fit | 5 | E5 and E7 provide distinctions he can teach across products: notes versus execution, summary versus evidence, permission versus ability. |
| Problem urgency | 4 | Mara's lost edits and false green directly match the workflow risks a consultant must explain (E6). |
| Trust | 3 | Recovery limitations and the verification correction reward scrutiny (E5, E10); dispersed status and the incorrect sanction sentence make direct reuse require checking (E8–E9). |

Overall friction **3/5**; appeal **4/5**. He continues, but does not yet have a handout he can quote without qualification.

**SIMULATED interview response.** “The distinction between handing over notes and restoring work is useful. I could teach that tomorrow. I still have to build my own end-to-end example and check which parts are mechanisms on paper before I put this in a client deck.”

**Confusion, stuck points, and top objections.** (1) “Which parts of this recovery pattern are necessary, and which belong to this implementation?” stops transfer at pp. 47–48. (2) “Does the consent scene describe software I can recommend?” forces the appendix detour. (3) “Why do the worked numbers say ten?” interrupts confidence at p. 268. Repeated stack placement and the shift into a multi-literature survey at pp. 268–270 risk demotivation once his practical question is answered.

**Recommendations — not source text.** Add a clearly SYNTHETIC trace in which a review agent dies while editing `handlers/charge.go`, leaves an uncommitted diff and an open test obligation, and a successor must decide what to preserve, rerun, or refuse. Include an expired lease and a late effect from the predecessor; show the fencing decision. Do not claim prompt replay recreates inference state. The missing scene is the joined recovery case, not a generic agent story: the Book already has several good stories.

Desired figure: a predecessor / durable record / successor sequence diagram with artifact IDs and status on each step. Desired marginalia: “Portable requirement,” “Reference-system choice,” and the current implementation grade beside the consent example. Desired example: a vendor-independent pattern card containing trigger, assumptions, state, transitions, failure, and boundary. Reuse the existing continuity diagram rather than add another abstract stack.

## 20. Morgan Reyes — a first understandable success

**Persona anchor.** Bootcamp graduate six months into a first developer job; everyday development is familiar, ports/daemons/multi-agent coordination are not. The catalog prioritizes quick visible success and low tolerance for unexplained jargon. For this reading-only task, success is correctly explaining a tiny agent collision; executing the displayed terminal commands is neither necessary nor part of this audit. Asking a teammate is the inferred alternative.

**Inferred reading path and stops.** Start at v and attempt to select a route on vi–vii. With no beginner lane, follow the contents into Chapter 1, pp. 5–9. Predicted unaided stopping point: the reference-monitor/maturity discussion on pp. 7–9, before the port race. An analyst-assisted rescue route is §1.5's plain opening on p. 18 → Alice/Bob pp. 21–23 → the summary-to-evidence figure on p. 189. Stop after Morgan can say who got the claim, what the loser learns, and why a green sentence is insufficient. Do not describe the rescue as a route Morgan spontaneously discovered.

**Opening-test prediction.** “Textbook” is clear. Whether it is for someone at Morgan's level, how it connects to the screenshot that attracted them, and which first page produces a small win are unclear. The subtitle does not unpack accountable autonomous work.

| Friction dimension | Score | Evidence and predicted effect |
|---|---:|---|
| Orientation | 5 | E2 has no beginner row; choosing “practitioner” still presumes Morgan can navigate specialist chapter questions. |
| Conceptual load | 5 | E3 quickly requires reference monitor, SQLite/WAL, mediation, and maturity grades before the concrete race. |
| Navigation/recovery | 4 | The runnable-looking example is seventeen printed pages after the p. 6 opening; the useful digest picture is in another part (E4, E7). An interruption is likely to lose the thread. |
| Task completion/transfer | 4 | E4 includes outputs, which helps, but the terminal sample does not first show a before/after view of Morgan's own familiar problem. A named lock can be mistaken for protection of the actual file. |

| Appeal vertex | Score | Evidence and predicted effect |
|---|---:|---|
| Identity fit | 2 | The specialist map and first-chapter terminology signal a more experienced reader (E2–E3). |
| Problem urgency | 3 | Losing a teammate's edit and trusting a false green are recognizable once E4/E6 is reached; operating a large swarm is not established as Morgan's current need. |
| Trust | 3 | Outputs and readable illustrations supply footholds, but placeholders and an unlabeled sample limit certainty about what Morgan is seeing (E4). |

Overall friction **5/5**; appeal **2/5** for unaided entry. The rescue route could improve the experience; no improved score is claimed without testing it.

**SIMULATED interview response.** “Alice gets the slot and Bob gets told who has it—that part makes sense. I thought putting a lock on a file meant nobody could change it. I would have needed someone to point me here before I gave up in the first chapter.”

**Confusion, stuck points, and top objections.** (1) “What is the background process doing for me?” arises on p. 6. (2) “Am I supposed to know all these guarantees already?” arises at pp. 7–9. (3) “If Bob is denied, why can a file still be overwritten?” requires connecting p. 8 to pp. 22–23. Demotivation comes from treating prerequisite vocabulary as a test of belonging before a first successful explanation.

**Recommendations — not source text.** Add a short, optional “Two helpers edit one file” entry with one familiar repository and no installation requirement. A formatting agent and a bug-fix agent both read the old `settings.json`; show the second full-file save overwriting a change, then a coordinated request returning the current holder. Explicitly include a direct edit bypass to distinguish a claim record from enforced protection. This extends the existing p. 179 scene with a beginner explanation; it does not replace it.

Desired figure: three before/after panels—original file, lost change, mediated decision—with one changed key highlighted per panel. Desired marginalia: “Daemon: a background program,” “Claim: a recorded intent to edit,” and “A claim alone does not block every write.” Desired example: one prediction question with the answer immediately available, followed by an explicit stopping point. Label terminal material SAMPLE or RECORDED with provenance, using the Book's shared sample treatment.

## 21. Aisha Bello — an accurate team briefing

**Persona anchor.** Non-engineering PM with strong product judgment; wants to understand the benefit well enough to raise it with her engineering team. She can read a sustained explanation but should not have to run a CLI. Her inferred alternative is asking an engineer to translate “agent orchestration” into a product risk and decision.

**Inferred reading path and stops.** Read iv–v, then use the practitioner emphasis on Part II to jump to Chapter 4. Follow its own express route: p. 177's problem → Mara at pp. 180–181 → scoped consent and override at pp. 183–186 → the two digests and design questions at pp. 187–191. Stop the conceptual route there, as p. 176 permits. Before recommending a product trial, add a required status check at pp. 257–259 and Appendix A, pp. 595–597. Without that last hop, her briefing can be conceptually correct yet imply unavailable controls. Defer the formal information bounds and the market chapters.

**Opening-test prediction.** She can infer accountable AI work as the category and promise after v. The reader map never names her role, and there is no obvious “prepare a team discussion” next step. Mara supplies the missing audience signal later.

| Friction dimension | Score | Evidence and predicted effect |
|---|---:|---|
| Orientation | 3 | The practitioner lane is a plausible proxy, and p. 176 supplies a stop, but neither directly matches a PM's decision (E2, E6). |
| Conceptual load | 3 | Mara and the suppressed-items table are accessible; the route also requires Hobbes, Scott, normative authority, and a grant tuple (E6–E7). |
| Navigation/recovery | 4 | The design story and availability table are separated by roughly seventy pages (E8), making an accurate brief depend on a non-obvious lookup. |
| Task completion/transfer | 4 | P. 191 gives concrete design questions, but they are not yet a small team-evaluation brief connecting controls, ownership, evidence, and unavailable features. |

| Appeal vertex | Score | Evidence and predicted effect |
|---|---:|---|
| Identity fit | 3 | Her work concerns review capacity and decision authority, which E6–E7 recognize; the map and formal framing do not acknowledge her directly. |
| Problem urgency | 4 | Five PRs, a deleted test, and ninety-second attention windows give a specific planning problem, not a vague promise of more automation. |
| Trust | 3 | The up-front caveat and appendix support an honest brief, but the p. 185 scene can easily outrun its proposed status at p. 259. |

Overall friction **3/5**; appeal **4/5** for the ideas, with product adoption explicitly unresolved.

**SIMULATED interview response.** “I can bring back a useful requirement: a summary must let us open the change and the test result behind it. I can't yet tell my team that the approval and stop controls in the story are available. I need that distinction on the same page.”

**Confusion, stuck points, and top objections.** (1) “What can my team use now?” is not answered locally at the consent scene. (2) “Who approves a risky migration, and what happens if nobody is available?” remains a concrete decision question after the grant tuple. (3) “What evidence says this improves our review burden?” is empirical, not established by the narrative. Demotivation occurs when a practical meeting question detours through political theory before returning to an operator action.

**Recommendations — not source text.** Extend Mara's payments refactor through one release decision: an agent submits a migration, the engineer checks the diff and test evidence, the PM sees customer impact and unresolved uncertainty, and a named person chooses hold or proceed. Show what happens when that person is unavailable. Label the scene SYNTHETIC, and mark each control's implementation status. Do not invent measured time savings or imply the proposed override is installed.

Desired figure: an agent / engineer / PM decision swimlane, with evidence required at each handoff and an explicit hold branch. Desired marginalia: “Design rule, not current feature” beside proposed controls and a concise gloss of revocation. Desired example: a one-page team brief with the problem, one benefit, the current boundary, and questions for a bounded evaluation. Retain the existing p. 189 digest figure; it already communicates the key distinction well.

## 22. Liam O'Connor — a Saturday learning loop

**Persona anchor.** CS student seeking a worthwhile idea, something explainable to a classmate, and possibly a bounded contribution. Moderate technical background, high curiosity, and more patience than Morgan. His inferred alternative is reading a tutorial or implementing a small distributed-systems exercise; he wants intellectual payoff, not just a prestigious project name.

**Inferred reading path and stops.** Use viii's Distributed Systems and Security route (chapters 1, 2, 3, 8), but take only its shortest initial learning unit this session. Read Chapter 1's opening and §1.3.1, pp. 6–11; then §1.5, pp. 18–25. Complete Exercises 1.10–1.12 on p. 70 and compare pp. 541–542. Successful early stop: explain the losing request and why expiry alone does not guarantee fairness. Optional next unit: Chapter 2, pp. 84–87, then p. 106 to learn the boundary between a protocol argument and bounded code checks. Stop before protocol implementation detail; do not pretend he has completed the four-chapter course or earned contribution credit.

**Opening-test prediction.** The textbook category and course table fit his learning identity. The learning promise becomes clear, but the next action is a semester-sized route until he finds an exercise-sized destination.

| Friction dimension | Score | Evidence and predicted effect |
|---|---:|---|
| Orientation | 2 | Course routes, detailed contents, and section-grouped exercises support deliberate study (E2, E11). |
| Conceptual load | 3 | Fairness, linearizability, immediate transactions, and fencing are productive difficulty, but their relationship to the smaller acquire listing needs careful reading (E3–E4). |
| Navigation/recovery | 2 | Exercise/solution page pointers provide a recovery loop; a print reader still moves hundreds of pages between them (E11). Hyperlink functionality was not tested. |
| Task completion/transfer | 3 | He can hand-trace the race, but the route does not supply a small starter artifact and expected trace for a standalone learning contribution. |

| Appeal vertex | Score | Evidence and predicted effect |
|---|---:|---|
| Identity fit | 4 | The exercises and explicit proof limits treat him as a learner capable of checking an argument (E10–E11). |
| Problem urgency | 3 | This is elective exploration; novelty and a completed learning loop matter more than a current operational emergency. |
| Trust | 4 | The source credits fencing's predecessors and identifies missing fairness; p. 106 corrects overclaiming rather than hiding it (E4, E10). |

Overall friction **3/5**; appeal **4/5**. He is likely to continue if an afternoon has a defined endpoint.

**SIMULATED interview response.** “The interesting bit is that an expired lock doesn't stop the old worker unless the write checks its epoch. I can explain that. Give me a tiny trace to break and repair, and I have a Saturday project instead of a reading list.”

**Confusion, stuck points, and top objections.** (1) “Which assumptions does the short listing leave out?” arises when moving from Listing 1.1 to the stronger fencing/overlap theorem on p. 20. (2) “Is this novel, or an application of existing ideas?” is partly answered by the Chubby/Kleppmann attribution on pp. 19–21, a strength worth preserving. (3) “What small piece could I demonstrate without running the entire system?” is not locally resolved. Demotivation comes from an unbounded contribution ambition, not from encountering mathematical content itself.

**Recommendations — not source text.** Add a runtime-free exercise using two coding agents editing `auth.ts`: A acquires epoch 7, pauses, B receives epoch 8, then A submits a late write. Give the initial state and candidate events; ask the learner to mark accept/refuse before showing the answer. Extend it with one failed test still owed after takeover. Clearly separate the hypothetical exercise from the current product.

Desired figure: a two-agent timeline with the active epoch shown at each effect. Desired marginalia: prerequisite links for atomicity, retry-safe operations, and liveness; a pointer from the simplified listing to omitted checks. Desired example: a small language-neutral trace table and expected output, plus a “you are done when you can explain these two refusals” criterion. Keep the existing solution loop and OPEN exercise; the goal is a bounded entrance, not removal of challenging material.

## 23. Sophie Turner — confidence in her developer's choice

**Persona anchor.** Nontechnical small-business owner whose hired developer mentioned the tool. She is evaluating legitimacy and whether her developer can explain the work, not choosing an agent platform or studying its internals. Her likely alternative is simply asking that developer. Surface polish matters to her, but the analyst must not mistake polish for product assurance.

**Inferred reading path and stops.** Read the cover/title text and PDF page 2's authorship/contact information, skim iv's implementation disclaimer, and glance at the map on vi–vii. Predicted unaided stopping point: iv–vi, once the technical vocabulary and specialist reader labels establish that this is not her document. A short assisted route can use Mara's customer-facing failure on p. 180 and the evidence contrast on p. 189. Stop after one question she can ask her developer about her own website. Requiring her to reach Appendix A would defeat the task.

**Opening-test prediction.** She recognizes a professionally presented technical book and a named author/company. The metaphorical title and subtitle do not explain the benefit to her website. Intended audience and next action are unclear for her; identifying a textbook is not equivalent to understanding the product.

| Friction dimension | Score | Evidence and predicted effect |
|---|---:|---|
| Orientation | 5 | None of E2's routes represents her task. The PDF is a reference work, not a short explanation of what her developer is doing. |
| Conceptual load | 5 | Even the useful disclosure on iv contains single-writer SQLite/WAL, attenuation, and model-checking terminology (E1). |
| Navigation/recovery | 5 | The concrete business-adjacent failure is at p. 180 and requires assistance to find; no brief owner route joins it to a stop. |
| Task completion/transfer | 4 | P. 189 can suggest asking for evidence, but references to a diff and test run still need translation into her website's acceptance checks. |

| Appeal vertex | Score | Evidence and predicted effect |
|---|---:|---|
| Identity fit | 1 | The specialist reader map does not imply a small-business owner should read this Book. That audience mismatch is not itself a flaw in the technical content. |
| Problem urgency | 2 | Her curiosity is mild; the text does not establish an immediate need for her to understand fleet coordination. |
| Trust | 3 | The inspected title page and iv have deliberate typography, identifiable authorship, and candid limits. Those support perceived professionalism, not confidence that her website is protected. |

Overall friction **5/5**; appeal **2/5**. A graceful, informed exit is a better outcome than forcing her through a specialist track.

**SIMULATED interview response.** “It looks like a serious technical book. I still don't know what this changes for my shop. I'd ask my developer to show me what was checked and what happens if the checkout stops working.”

**Confusion, stuck points, and top objections.** (1) “Is this the software, or a book about software?” begins at the title. (2) “Does ‘not built’ mean my developer is using an experiment?” can arise from the honest but technical disclosure. (3) “Who fixes my site if this goes wrong?” is outside the Book's opening answer. Demotivation is immediate when mild curiosity turns into apparent homework.

**Recommendations — not source text.** Provide an optional owner-facing paragraph linked from the reader map: a developer uses two coding assistants to change a shop's checkout; one edits the form and another changes tax calculation. Show the developer checking a sample order, reviewing changes, and retaining a recovery plan before release. This is a proposed explanatory scene, not a claim that the current product guarantees those steps or provides refunds/support.

Desired figure: a small “request → developer's checks → approved website change” sequence using plain labels. Desired marginalia: “Your developer remains responsible for reviewing the work.” Desired example: three questions—what changed, how was it checked, how would we recover? Her path should explicitly end there, with deeper technical material optional. Do not turn every chapter into business-owner copy or add unsupported testimonials to compensate for a missing explanation.

## 24. Victor Aldana — claims tested against their limits

**Persona anchor.** Veteran engineer deliberately invoked last to challenge enthusiasm. Deep technical expertise, low tolerance for aspirational features presented as current, and strong sensitivity to maintenance/evidence gaps. His inferred alternative is inspecting tests, source, and release history; this assignment evaluates whether the Book earns that next step, without conducting it.

**Inferred reading path and stops.** Read iv–v's built/modelled/proposed disclosure first. Use the security-reviewer emphasis from vi–vii to inspect pp. 8–9 and 106–108, then jump to Appendix A/B, pp. 595–598, and the Result Atlas, pp. 613–614. Adversarially check the favorable findings above: the lock example pp. 20–23, the consent scene p. 185 against pp. 257–259, and the sanction example p. 268. Stop at these contradictions or ambiguities for clarification; defer full security/federation reading until claim wording is reconciled. His successful endpoint is a bounded assessment of which ideas deserve further inspection, not a blanket dismissal or product approval.

**Opening-test prediction.** Category, technical audience, and thesis are clear to him. The up-front admission that the Book exceeds the product is a strong reason to continue. Next action is evidence inspection, for which the appendices and atlas give a route.

| Friction dimension | Score | Evidence and predicted effect |
|---|---:|---|
| Orientation | 2 | E1, E2, and E10 make the evidence-oriented route findable. |
| Conceptual load | 2 | The mathematics and systems vocabulary fit his background. Resolving the Book's own conflicting wording, rather than technical depth, consumes effort. |
| Navigation/recovery | 4 | E8 requires correlating a scene with a remote status table; E12 requires comparing front matter with Appendix A. |
| Task completion/transfer | 5 | The source can support conceptual interest, but he cannot responsibly repeat a stronger claim until the sanction comparison and status/assurance wording are reconciled. No current runtime or proof execution was verified here. |

| Appeal vertex | Score | Evidence and predicted effect |
|---|---:|---|
| Identity fit | 4 | Named assumptions, explicit scope, prior-art credit, and a withdrawn overclaim meet his preferred mode of argument (E4, E10). |
| Problem urgency | 3 | The failure mechanisms are real evaluation concerns for him, but the Book has not established why he must adopt this implementation now. |
| Trust | 2 | E9's checkable wording error and E8/E12's reconciliation burden undermine easy reuse. P. 106's unusually precise limitations keep the score above outright rejection. |

Overall friction **4/5**; appeal **2/5**. He grants the ideas more credit than the current wording and would withhold endorsement.

**SIMULATED interview response.** “The 32-byte parser caveat is the kind of admission that gets me to keep reading. Then I hit a worked example where ninety becomes sixty and the prose says ten. Fix that, and put ‘proposed’ beside the consent story. I don't want to infer the boundary from an appendix.”

**Confusion, stuck points, and top objections.** (1) “Are the promised controls implemented?” is answered, but remotely, by p. 259. (2) “Which assurance ordering should I use?” is unsettled by vii's increasing-order description versus p. 595's explicit non-total ordering. (3) “Can I quote the numbers?” fails at p. 268: the formula yields 60, the decrement is 30, and the advantage over a fresh 50 is 10. The internal evidence supports correcting the sentence, not rejecting the entire model. A further precision concern is p. 22's “Nothing here is advisory”: it is scoped in that paragraph to the locks row, but an isolated excerpt can be mistaken for filesystem exclusion despite p. 8's correct caveat.

**Recommendations — not source text.** First repair the p. 268 verbal comparison: staying retains 60, a loss of 30 from 90 and an advantage of 10 over restarting at 50. Next mark the consent/override scene locally as proposed. Reconcile assurance vocabulary once and cross-reference it. Avoid claiming a broken link, invalid proof, or current implementation defect: this walkthrough did not test those.

The missing adversarial AI-developer scene is an agent holding a valid claim while a same-user process edits the file directly, followed by a resumed old holder attempting a stale write. Show separately what the claim database prevents, what a mediated effect gate refuses, and what remains outside mediation. Desired figure: paired event traces for mediated and bypassing writes, with observed evidence and unknowns. Desired marginalia: claim kind, assurance mode, implementation status, and artifact pointer adjacent to each consequential example. Desired example: an exact assertion → assumption → bounded check → uncovered case table, preserving the candor already present in p. 106.

## Cohort synthesis: preserve the disagreements

- The Book already has concrete scenes and honest boundaries. The largest shared obstacle is reaching the right scene and carrying its boundary into a selective reading, not the total absence of examples.
- There are two distinct improvements to make: help newcomers finish a tiny reading task, and help experts carry a claim safely into another setting. More simplification alone will not accomplish both.
- Repair the directly checkable wording defect before treating persona preference as a mandate for broad restructuring. Simulated reactions are hypotheses; the p. 268 comparison is an inspectable source error.

| Persona | Overall friction | Overall appeal | Valuable endpoint | Predicted refusal or exit |
|---|---:|---:|---|---|
| 19 Chris | 3 | 4 | Teach a portable coordination/recovery pattern | Cannot yet lift a complete example with local implementation boundaries |
| 20 Morgan | 5 | 2 | Explain one collision and one refusal | Jargon and route choice before a first success |
| 21 Aisha | 3 | 4 | Give an accurate team brief | Unclear which controls exist now |
| 22 Liam | 3 | 4 | Complete and explain one trace exercise | Learning task expands into a course or unbounded contribution |
| 23 Sophie | 5 | 2 | Ask her developer one informed question | Specialist document does not answer her website concern |
| 24 Victor | 4 | 2 | Identify claims worth deeper verification | Checkable error and distant/conflicting qualification |

These ordinal summaries are not a population average, conversion forecast, or measurement of the Book's general quality.

### Where preferences conflict

| Tension | Disagreement | Editorial decision recommended |
|---|---|---|
| Proof depth | Liam wants productive difficulty; Morgan needs terms and a small win; Victor wants precise conditions. | Add a short entry and explicit stop while retaining proofs and section-linked exercises. Do not replace them with simplified summaries. |
| Philosophy | Chris can reuse conceptual distinctions; Aisha values governance consequences but needs meeting language; Sophie has no reason to traverse the theory. | Keep argumentative philosophy available, but place the concrete decision first and identify optional detours. The report does not infer that every philosophical passage is decorative. |
| Status detail | Victor and Chris need local grades; Sophie would be overwhelmed by a full assurance taxonomy; Aisha needs only the distinction affecting her recommendation. | Use one plain local sentence for availability with a precise status pointer. Preserve deeper tables for readers who need them. |
| Visual density | Chris can decode p. 179's three timelines and outcomes; Morgan must also learn the file vocabulary; Sophie needs a different question answered. | Retain the rich settings example and add a small novice entry to it. Do not demand that one figure serve every audience. |
| Professional appearance | Sophie reads polish as legitimacy; Victor refuses to treat it as evidence. | Preserve the coherent typography, but bind claims to evidence and do not use aesthetic quality as a substitute for it. |
| Completion | Chris wants a reusable teaching artifact; Liam wants an exercise; Aisha wants a briefing; Sophie wants permission to stop. | Name distinct completion conditions. Reading all eight chapters is not the success metric for this cohort. |

### Prioritized recommendations, distinct from Book content

| Priority | Recommendation | Evidence and affected readers | Reviewable acceptance condition |
|---|---|---|---|
| Immediate; small | Correct the sanction sentence and reconcile the assurance-mode wording. | E9/E12; especially Chris, Liam, Victor. | The verbal comparisons match 90 → 60 and 60 versus 50; front matter and Appendix A express the same relationship between modes. |
| Immediate; small | Add local availability language to the consent/override scene and provenance labels to terminal samples. | E4/E8; Morgan, Aisha, Chris, Victor. | A reader can identify proposed versus available from the example page, and can distinguish illustrative transcript from recorded session. |
| Immediate; moderate | Add task-based entry pointers and explicit stopping points to the single front reader map. | E2; all six, with the largest benefit for Morgan/Aisha/Sophie. | The map points to a first concrete page and an end condition for “understand one collision,” “brief my team,” “study one mechanism,” and “inspect evidence.” Avoid adding another map inside each chapter. |
| Next exposition pass; moderate | Carry one named work item from concurrent edit through failed test, evidence review, crash, and handoff. | E4–E7; Chris, Morgan, Aisha, Liam. | Paths, actors, artifact IDs, and obligations persist across the trace; every invented record is labeled SYNTHETIC; unimplemented transitions remain marked. |
| Next exposition pass; moderate | Couple that trace to the existing exercise/solution loop and one bypass counterexample. | E3/E4/E11; Liam and Victor, with a smaller beginner entry for Morgan. | A reader can predict a refusal, locate the answer, and state why an unmediated file edit escapes the claim guarantee. |
| Later; requires actual readers | Test the proposed short routes with people resembling these goals. | All persona judgments; no empirical validation yet. | Observe unaided route choice, ask readers to distinguish claim from file protection and proposed control from available feature, and record where they stop. Do not count fluency or favorable comments as proof of comprehension. |

Scope remains the report. No suggested chapter, figure, marginalia, code, or runtime change above was implemented. The existing settings.json scene, digest/evidence comparison, recovery limitation, and exercise loop should survive any rewrite; their accessibility, continuity, and nearby status are the improvement targets.
