# Cohort A: personas 01–06 — assembled Book walkthrough

Date: 2026-09-17. Surface: *The Harbor, the Person, and the Economy*, Textbook Edition 4.0, September 2026. This is a synthetic editorial pressure test, not interviews, usability measurements, or a product certification.

## Findings at a glance

- The Book already has strong AI-development scenes: the port race, three concurrent `settings.json` edits, Mara's five-PR pile, and Alice's agents losing their histories. The gap for this cohort is a short path from those scenes to a bounded decision about their own work.
- Explicit implementation limits build trust, especially for Yuki. Their distance from the attractive Chapter 4 scenes makes Jordan, Sam, and Devon work harder to distinguish an explanatory design from something they could adopt or demonstrate.
- The cohort disagrees about depth. Priya and Marcus reasonably leave a research textbook to solve today's port problem; Yuki wants its proof boundaries; Jordan and Sam want operational scope; Devon wants a credible explanation to take to Sam. One universal simplified route would serve them poorly.

## Basis, provenance, and limits

**Source inspected:** a local proof build of the assembled Book, 661 pages, 504 × 720 points (7 × 10 inches), 10,203,318 bytes. PDF creation metadata: 2026-09-17 02:12:42 PDT. SHA-256: `1d9d273470018b45f5e125a87bdf6de1fa706abaaec3b4239ae9bad6da1454e2`. Worktree HEAD during review: `33fa6ddde026b909eefb5d1d3d2adbe5c4befb41`; the worktree was already dirty. The PDF hash, rather than HEAD alone, identifies the reviewed object. All statements about implementation below report what this PDF says; they are not a live source or runtime audit.

**Instructions applied:** the complete repository skill [`harbor-book-rewriter`](../../../../skills/harbor-book-rewriter/SKILL.md); the complete `port-daddy-users`, `ux-friction-analyzer`, and `product-appeal-analyzer` skills; canonical persona entries 1–6 from the users skill's `references/personas.md`; and the friction skill's `references/quality-gates.md`. The Book skill supplied the assembled-volume boundary, scene-to-claim test, and distinction between synthetic material and evidence. The persona skill supplied the actual motivations and disagreements. Friction and appeal are scored separately.

The assigned persona entries contain no Book-specific reading tracks. Routes below are **analyst-inferred**, using the reader map on printed pp. v–viii and the chapter structure in `whitepaper/textbook.json`. Practitioner emphasis is Chapters 4 and 5, with Part I skimmed; systems-engineer emphasis includes Part I. These are selective reading routes, not claims that the personas read whole chapters. Likely abandonment points and optional return visits are distinguished from the passages the analyst inspected.

**Page convention:** citations give printed pages; the parenthetical `PDF` number is the one-based viewer page. In the body, PDF page = printed page + 18. Roman front matter uses the same ordinal as the viewer: vi = PDF 6. No standalone chapter PDF was used. Text was extracted from the assembled PDF. Rendered pages inspected directly were vi, vii, 23, 179, 189, 268, and 272 (PDF 6, 7, 41, 197, 207, 286, 290), at 1400-pixel page height. These spot checks support the named visual observations, not an all-page or physical-print approval. Rendering was streamed in memory; no ancillary files were created.

**Evidence labels:** “Source” records text or a visible feature of the PDF. “Interpretation” is the analyst's predicted effect on this persona. “Recommendation” is new editorial work proposed here. Every interview response is explicitly **SIMULATED**. No real user's words, behavior, timing, conversion, or preference were measured. Workarounds marked “inferred” are modest extensions of the canonical profile, not additional persona research.

**Skill adaptation:** the subject is willingness and ability to read a textbook, not a landing-page conversion funnel. Scores use the requested 1–5 scale, replacing the appeal skill's 1–10 scale; no `/90` composite is reported. Its identity/urgency/trust dimensions remain intact. The five-second assessment is a predicted first impression, not a timed test. App-specific friction gates (touch targets, browser reflow, feedback latency) do not establish PDF reading quality. Real-user gates, NASA-TLX, completion-time reductions, and accessibility compliance are unmeasured. This report neither ships nor declares the PDF layout complete, so it does not claim a web overflow-checker pass or a successful usability study.

## Scoring key

Friction: **1** negligible obstacle; **2** small recoverable interruption; **3** repeated effort; **4** likely to prevent the persona's intended decision without help or another surface; **5** likely abandonment/blockage at that point. Higher is worse. The skill's five failure modes are adapted as follows:

| Code | Reading friction |
|---|---|
| O | Overwhelm: too much conceptual setup before a useful result |
| C | Context switching: navigating between scene, definitions, status, and evidence |
| P | Invisible progress: uncertainty about what has been learned or whether there is enough to decide |
| M | Accumulated small obstacles: terminology, presentation, inconsistent local cues |
| X | Expert obstruction: difficulty reaching the precise claim, assumptions, or proof without tutorial detours |

Appeal: **1** no credible reason to invest reading time; **2** weak; **3** mixed/conditional; **4** strong; **5** directly compelling. Higher is better. **I** = identity fit, **U** = urgency/value of reading this material now, **T** = trust in the text as a basis for the persona's decision. A high T is not confidence that the depicted product is fully implemented. Visual/language fit, acknowledged pain/solution clarity, and execution/evidence/risk boundaries inform these three dimensions. No customer social proof is inferred from illustrative scenes.

| Persona, canonical order | O | C | P | M | X | I | U | T |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 01 Priya Desai | 5 | 3 | 4 | 4 | 2 | 2 | 2 | 3 |
| 02 Marcus Webb | 4 | 4 | 4 | 4 | 2 | 3 | 3 | 3 |
| 03 Yuki Tanaka | 2 | 4 | 2 | 3 | 2 | 5 | 4 | 4 |
| 04 Jordan Ellis | 3 | 4 | 4 | 3 | 2 | 4 | 5 | 3 |
| 05 Sam Okafor | 3 | 5 | 4 | 4 | 2 | 4 | 4 | 3 |
| 06 Devon Cole | 2 | 3 | 3 | 3 | 1 | 5 | 4 | 3 |

Scores are ordinal judgments, grounded below. They are not averaged into a cohort rating or interpreted as measured dropout probabilities.

## 01 — Priya Desai

**Canonical lens.** Full-stack indie developer, three side projects, parallel agent tabs, recurring `localhost:3000` collisions. Low tolerance; needing a whitepaper before value is an explicit dealbreaker. She wants the problem to disappear. Current workaround: manually remembering the project behind each port, as described in her profile. Identity: independent builder, not a coordination-system administrator.

**Inferred reading path and stops.** Enter at the opening implementation notice, pp. iv–v (PDF 4–5), then the practitioner row, pp. vi–vii. The realistic first stop is here: this is a substantial textbook, not her route to a working tool. If she voluntarily gives the explanation another chance, use the contents to jump to §1.5, pp. 18–23 (PDF 36–41): port problem → claim state machine → Alice/Bob race → terminal illustration. Stop on p. 23 before the specified ticket-lock extension. Check Appendix A, pp. 595–596 (PDF 613–614), before inferring protection of files or processes. Optional return: Mara's scene, pp. 177–180 (PDF 195–198). Chapters 2–3 and 5–8 are not necessary for her immediate question, despite the longer practitioner map.

**Source.** Page 18 explicitly introduces network-port collisions. Pages 21–22 explain two agents requesting port 7421 and the loser learning the holder's identity. Page 19 says there is no queued state or bounded-wait guarantee. Page 23 switches to a named file-lock transcript and then an unimplemented ticket-lock design. The opening, p. iv, says the Book is ahead of the product; Appendix A limits mediation and labels the local transaction authority PARTIAL.

**Friction evidence and interpretation.** O **5**: pp. iv–v ask for an architectural reading commitment before her recurring port problem appears; this directly meets her stated dealbreaker if presented as required onboarding. C **3**: the reader map, claim example, and global implementation boundary are far apart, though contents and cross-references offer recovery. P **4**: the port race explains mutual exclusion, but this route never demonstrates her three unrelated projects receiving stable ports and staying out of her way. M **4**: the move from port race to file-lock transcript to ticket-lock schema on pp. 21–24 changes the immediate task three times. X **2**: section headings make a targeted skim possible; proof access is not the main obstruction for her.

**Appeal evidence and interpretation.** I **2**: the multi-agent port scene fits, but the broad institutional argument exceeds the identity and need she brings. U **2**: understanding the race has value; reading consent, reputation, and markets does not relieve today's collision. T **3**: the explicit limits are credible, while an illustration containing successful terminal output is insufficient evidence of her zero-setup outcome.

**Predicted five-second impression.** Category: textbook, clear from the cover. Audience: autonomous-work designers, only loosely “me.” Promise: accountability, abstract relative to ports. Next reading action: unclear until the contents; a fast port-focused route is absent from the reader-map spread.

**SIMULATED interview response.** “The two agents fighting over one port makes sense. But I'm already doing that all week. I don't want homework before my side projects run. I'd save the chapter for later if I could get the short answer first.”

**Confusion / stuck / demotivation.** Confusion: whether a successful reservation also proves an actual server can bind. Stuck: identifying the smallest applicable workflow without adopting the Book's whole architecture. Demotivation: a port example becoming a database-design lesson immediately after its useful result. Her leaving the Book for an operational guide is a legitimate outcome, not automatically an editorial failure.

**Recommendations — missing scene and desired apparatus.** Add an explicitly synthetic, one-page three-project trace: existing server, two new agent launches, requested versus assigned ports, a refused reservation, observed bind result, restart, and cleanup. State prerequisites and implementation status without inventing commands or claiming universal mediation. A small table is sufficient; another abstract architecture diagram is unnecessary. A margin gloss beside the port race should distinguish “reservation accepted” from “server listening,” with a stop-here pointer to the current operational guide. Do not turn reading the Book into an installation requirement.

## 02 — Marcus Webb

**Canonical lens.** Freelancer juggling four client repositories with inherited dev-server conventions. Solid, impatient, prone to copying a command before its explanation. One confusing step is tolerable; a second is not. He cannot restructure a client's repository for his own tooling. Inferred workaround: inspecting and restarting the wrong client's server until the port conflict is resolved. Identity: reliable contractor whose tooling should create no client obligations.

**Inferred reading path and stops.** Skim pp. iv–v, then §1.5, pp. 18–23 (PDF 36–41), using the contents rather than following the whole practitioner route. His first friction stop is the file-lock transcript on p. 23: it no longer answers which client's service owns which port. If he continues, read the mediation boundary on p. 8 (PDF 26) and §1.12.1, p. 60 (PDF 78), then Appendix A, pp. 595–596. Stop once he understands this is local coordination with explicit limits. The optional explanation to remember is the port race on pp. 21–22, not the proposed scheduler on pp. 23–24.

**Source.** The port race ends with Bob able to choose another port, wait, or message Alice (p. 21). The state machine says a denied acquisition is not scheduled a turn (p. 19). The terminal illustration (p. 23) uses a file-lock name, environment-variable actor switches, and placeholder owner/time values. Page 8 and p. 60 state that same-user agents can bypass advisory claims and that these claims are not OS-enforced filesystem isolation.

**Friction evidence and interpretation.** O **4**: claim granularity, lease fencing, and fairness introduce several new abstractions before his cross-repository decision is resolved. C **4**: the cooperative-client boundary requires returning from §1.5 to p. 8 or p. 60. P **4**: none of these selected pages shows whether four existing client conventions can remain intact. M **4**: an apparently copyable terminal panel with placeholder results invites his known copy-first behavior; the panel is labeled “AT THE TERMINAL,” not explicitly SAMPLE or RECORDED SESSION. X **2**: algorithm and theorem are reachable, but he wants compatibility evidence rather than deeper proof.

**Appeal evidence and interpretation.** I **3**: the familiar dev-server collision is strong, while a shared-repository swarm differs from his unrelated client repositories. U **3**: named ownership could reduce incident confusion, but reading does not yet answer the no-restructuring requirement. T **3**: the candid advisory boundary helps him avoid overpromising; the transcript has no visible execution provenance to establish his setup's behavior.

**Predicted five-second impression.** The cover identifies a book. “Harbor” and “economy” give him little reason to expect help for existing client repos. On p. 21 the problem and outcome become clear, but the next applicable action remains unspecified.

**SIMULATED interview response.** “Telling me who owns the port is useful. My clients already have their scripts, though. Show me two of those repos working unchanged. I'm not going to sell them a new architecture just to keep my laptop organized.”

**Confusion / stuck / demotivation.** Confusion: whether named file locks, edit-surface claims, and port reservations imply the same protection outside the database. Stuck: coexistence with an already-running unmanaged server and a client script with a fixed port. Demotivation: replacing immediate client support with schema and fairness research. This is a missing bridge from theory to his constraints, not evidence that the product actually requires restructuring.

**Recommendations — missing scene and desired apparatus.** Use four fictional client repos, two inherited fixed-port scripts, and one stale process. Show the observable conflict, which configuration changes are or are not needed, and how ownership is checked without killing another client's work. Mark every unverified behavior as a question to test. Prefer a compatibility table and a short actor/message trace. Add a margin distinction between a registered resource and an arbitrary process outside the mediated path. Classify the existing p. 23 panel as illustrative or recorded, and provide provenance appropriate to that classification.

## 03 — Yuki Tanaka

**Canonical lens.** Solo OSS maintainer reviewing contributors who use different coding agents. Deep technical reader, moderate setup tolerance, no tolerance for inflated claims. Wants tests, diffs, and code before trust; source inspection is the canonical workaround. Identity: steward accountable for what enters the repository.

**Inferred reading path and stops.** Follow a compressed systems-engineer route: opening status, pp. iv–v; kernel scope, pp. 7–9 (PDF 25–27); durability, pp. 14–17 (PDF 32–35); runtime parity and atomicity, pp. 57–60 (PDF 75–78). Stop after p. 60 to delimit the claim. Then inspect the Anchor assurance table and model/runtime distinction, pp. 99–102 (PDF 117–120), and shared-crate/bounded-harness explanation, pp. 106–108 (PDF 124–126). Finish with the kernel artifact map, pp. 80–81 (PDF 98–99), and global implementation boundary, pp. 595–596. Her terminal stop is to open the named source and artifacts; this report does not simulate that independent code review as completed. Optional later practitioner branch: pp. 266–268 and 271–272, which is where the arithmetic issue below matters.

**Source.** The kernel separates process crash from power loss and says which guarantee is absent (pp. 15–17). The runtime-parity discussion says a green test runtime can differ from deployment (p. 57). The Anchor table names specification and deployment gaps (p. 99); p. 106 explicitly withdraws an earlier stronger headline and bounds Kani's parser input to 32 bytes with cryptography stubbed. The kernel's artifact map calls its module names illustrative rather than a stable interface (p. 81). The front matter describes assurance modes as increasing enforcement (p. vii), whereas Appendix A says Brokered and Confined are not totally ordered (p. 595).

**Friction evidence and interpretation.** O **2**: the density largely serves her chosen task. C **4**: she must reconcile chapter-level status, global status, and artifact pointers across three distant locations. P **2**: the explicit fault classes and proof boundaries let her reach a bounded conclusion even without trusting the product. M **3**: “built, weakly” in the opening, IMPLEMENTED/PARTIAL labels, proof-status vocabulary, and the assurance-order tension require interpretation. X **2**: the assurance table is an effective expert entry, but the correction narrative at p. 106 takes space before the final claim and evidence.

**Appeal evidence and interpretation.** I **5**: counterexamples, named code, and bounded claims fit her evidence-first identity. U **4**: the same-user bypass and deployment gap directly affect how much trust to place in contributor claims. T **4**: explicit withdrawals and limitations are strong evidence of editorial honesty; inconsistent local formulations and non-exact module pointers stop short of a 5. This rating concerns the text's candor, not verified runtime safety.

**Predicted five-second impression.** A serious systems text is recognizable; the precise audience and accountability promise are plausible. The first operationally useful next step is the implementation notice, not the cover. On p. 99, the assurance table gives a much stronger expert first impression than the general reader map.

**SIMULATED interview response.** “The paragraph that tells me what the verifier doesn't prove is the one that makes me keep reading. Now give me an exact path from each claim to its test and revision. I also need the scope labels to mean the same thing in the front matter and the appendix.”

**Confusion / stuck / demotivation.** Confusion: whether assurance modes form an ordered ladder or distinct threat boundaries. Stuck: identifying the exact revision and executable artifact behind an illustrative module map. Demotivation: having to audit vocabulary before auditing the mechanism. On her optional Chapter 5 branch, p. 268 adds a concrete trust defect: the displayed calculation is `max(90 − 30, 50) = 60`, but the prose says the actor “loses 10 by staying.” The loss from 90 is 30; staying retains 10 more than the fresh score of 50. This is a visible prose/arithmetic inconsistency, not a claim that the theorem itself has been disproved.

**Recommendations — missing scene and desired apparatus.** Show a contributor agent presenting a green result for an older commit, the maintainer checking the artifact's revision, and acceptance or refusal under an explicit criterion. Another scene should carry one permitted verifier result through the actual effect boundary and show what remains possible through an ambient path. Use a compact claim → assumption → artifact/revision → counterexample table, building on Table 2.2 rather than duplicating its architecture. Add margin status at the attractive claim, link exact provenance from the appendix, reconcile the assurance-mode descriptions, and correct the p. 268 read-out.

## 04 — Jordan Ellis

**Canonical lens.** CTO and sole technical hire at a four-person pre-seed startup, parallel agents running before a demo deadline, no SRE, tight budget. Will invest setup effort if it scales, but needs the platform outcome without staffing a platform team. Inferred workaround: personally monitoring terminal tabs and reviewing the queue between other responsibilities. Identity: pragmatic generalist protecting the demo and the budget.

**Inferred reading path and stops.** Start at pp. iv–v and the practitioner map. Skim the local scope on pp. 7–8, then enter Chapter 4's own route on p. 176 (PDF 194). Follow its explicit express lane, §§4.1–4.3, pp. 177–192 (PDF 195–210), emphasizing Mara (pp. 180–181), the scoped grant (pp. 184–186), and verifiable zoom (pp. 188–192). The chapter explicitly permits stopping after §4.3. For Jordan's adoption decision, first detour to Appendix 4.A, pp. 257–259 (PDF 275–277). This is the decisive stop: consent/override are proposed and other controls remain specified or partial. Optional cost follow-up is §4.8's entry, pp. 233–236 (PDF 251–254); stop before treating the information-floor calculations as a budget forecast. No market chapters are needed to make this small-team decision.

**Source.** Mara receives a 600-line “fix tests” PR with only ninety seconds of uninterrupted attention (pp. 180–181). A scoped grant separates low-stakes test changes from migrations and a force-push (p. 185). Verifiable zoom reveals the removed migration test (p. 192). Appendix 4.A grades consent/override proposed, the console partial, and merge ordering partial/unwired (pp. 258–259). The cost discussion gives 84K input plus 12K output tokens as an outcome-linked example (p. 234), then turns to distinct continuation and oversight losses (pp. 235–236).

**Friction evidence and interpretation.** O **3**: the scene fits immediately, but §§4.1–4.3 interleave political-theory exposition with the operational argument. C **4**: the adoption status sits roughly seventy printed pages after the grant scene. P **4**: understanding why oversight is necessary does not tell him how much staffed work or running machinery a four-person team would need today. M **3**: “Leviathan,” “mêtis,” grants, rankers, and compaction add vocabulary he must translate into costs and responsibilities. X **2**: p. 176 supplies a clear express lane and stop, although he must discover its implementation-status qualification.

**Appeal evidence and interpretation.** I **4**: Mara's overloaded afternoon closely resembles his situation. U **5**: a falsely green test and an unreviewable migration threaten the demo now. T **3**: the appendix is candid, but discovering that the most attractive authority mechanisms are proposed changes what he can act on after reading the scene.

**Predicted five-second impression.** The cover's institutional scale may look larger than his company. At Mara's scene, audience, problem, and desired result are clear. The missing first-impression element is a bounded next decision for a small team.

**SIMULATED interview response.** “Mara's afternoon is exactly the problem. I'd pay attention to that. But I need to know which part I can rely on before Friday and who maintains it. A two-hour grant with an override sounds great; finding later that it's proposed changes the conversation.”

**Confusion / stuck / demotivation.** Confusion: whether the operator scene illustrates a presently usable surface. Stuck: translating token accounting into a total budget including review, retries, and setup. Demotivation: an apparent lightweight oversight solution becoming another system that needs an owner. The Book does not supply a measured small-team ROI on this route; none is inferred here.

**Recommendations — missing scene and desired apparatus.** Carry one four-person demo-day case through a fixed task, two agent retries, review time, inference spend, a blocked migration, and a manual fallback. Mark all proposed numbers as synthetic unless measured. Show “what the human still does” in a swimlane, and give a table separating measured/assumed costs, implementation status, and stop conditions. Put a one-line status note beside the consent scene and a stop-here decision box after §4.3. Preserve the deeper attention theory as an optional continuation.

## 05 — Sam Okafor

**Canonical lens.** Team lead for twelve engineers after a three-day onboarding failure caused partly by undocumented port/environment conventions. Will pilot with two or three volunteers; inconsistent behavior across laptops is a dealbreaker. Inferred workaround: senior engineers walking new hires through local conventions. Identity: steward of team adoption, not simply an enthusiastic individual user.

**Inferred reading path and stops.** Read pp. iv–v and the practitioner/systems rows, then the local authority boundary, pp. 7–9 (PDF 25–27). Sample claims, pp. 18–23, and deliberately check runtime parity, p. 57 (PDF 75). Take the practical half of the practitioner route through Mara and the digest, pp. 180–192 (PDF 198–210), followed by Appendix 4.A, pp. 257–259. Stop here for a same-machine pilot-scope decision. Because the canonical dealbreaker explicitly concerns different machines, inspect the opening federation boundary and contributions, pp. 480–483 (PDF 498–501), plus verification status, pp. 537–538 (PDF 555–556). Final stop: do not turn a local-reader success into a twelve-laptop rollout claim. The broader federation machinery is reference material, not a prerequisite for standardizing ordinary local environments.

**Source.** The kernel bounds its authority to one local writer (pp. 7–8). Page 57 explicitly names the mismatch between test and deployed SQLite bindings and labels differential fuzzing specified. The federation opener says the current relay carries scoped events without replicating daemon state or establishing consensus (p. 480). Its Alice/Bob demo has a refused foreign card, a missed revocation, and a settlement mismatch (pp. 480–481). The status table has multiple PARTIAL or open federation results (pp. 537–538).

**Friction evidence and interpretation.** O **3**: the mechanisms are understandable, but his practical pilot question spans distinct architectural levels. C **5**: the shortest evidence-based answer to the canonical cross-machine concern crosses Chapters 1, 4, and 8 and their appendices. P **4**: the route does not supply a volunteer-pilot checklist, new-hire success criterion, or machine-comparison record. M **4**: “team,” local swarm, and mutually distrustful operators can sound adjacent while naming materially different deployment cases. X **2**: the chapter questions and verification tables enable targeted expert skims; the missing item is a team-sized synthesis.

**Appeal evidence and interpretation.** I **4**: explicit conventions, ownership, and reasons for refusals match his standardization role. U **4**: recurring onboarding waste makes a reusable model valuable. T **3**: naming runtime parity and federation limits earns confidence in the author; it leaves laptop consistency and rollout readiness unestablished.

**Predicted five-second impression.** The title does not immediately say “team onboarding.” The local-kernel promise is recognizable once reached. The reader map does not distinguish “all teammates use the same local conventions” from “teammates share authority across machines,” so the next reading action is ambiguous.

**SIMULATED interview response.** “I can see a pilot with three volunteers. What I can't take to the team yet is the promise that it works the same on everybody's laptop. Tell me what is local, what is shared, and what the new hire sees when one machine behaves differently.”

**Confusion / stuck / demotivation.** Confusion: whether team standardization requires federation at all. Stuck: deciding which observations would let a pilot graduate to rollout. Demotivation: discovering a market-and-trust-boundary detour while trying to replace tribal local setup knowledge. The underlying deployment distinction is real; the recommendation is to expose it earlier, not pretend federation is complete.

**Recommendations — missing scene and desired apparatus.** Add a new-hire/three-volunteer pilot with explicitly named operating-system/runtime combinations, existing scripts, one mismatch, one stale ownership record, and a recorded recovery. These are proposed cases, not observations made in this review. A two-column deployment diagram should contrast independent local installations sharing conventions with actual cross-machine authorization. A small acceptance table should name expected output, owner, refusal/recovery path, and evidence to collect; avoid an invented success-rate claim. Add marginalia at “one machine” that sends team leads to this distinction before Chapter 8.

## 06 — Devon Cole

**Canonical lens.** Mid-level engineer who enjoys exploring tools and wants a credible demo to take to Sam. High personal exploration tolerance, low tolerance for embarrassment in the team meeting; a solo success that fails for a second teammate is a dealbreaker. Inferred workaround: experimenting alone and assembling a write-up before asking for a pilot. Identity: useful early discoverer who can explain why a tool matters.

**Inferred reading path and stops.** Skim the opening status and practitioner map; enter Chapter 4 at its route, p. 176. Read §§4.1–4.3, pp. 177–192, saving Figure 4.1 (p. 179) and Figure 4.3 (p. 189) as candidate explanatory moments. Stop before treating Mara's successful intervention as a demo script; check Appendix 4.A, pp. 257–259. For the practitioner's second emphasis, sample §5.1, pp. 266–268 (PDF 284–286), then §5.3, pp. 271–272 (PDF 289–290). Stop before the longer philosophical treatment in §5.4. Finish by checking the two-machine boundary on pp. 480–483. He can now pitch the ideas and a bounded pilot question; a live-demo claim still needs separate evidence.

**Source.** Figure 4.1 already shows scheduled/prototype agents racing on `.vscode/settings.json`, an immediate parse failure, and a later hidden-fixture failure despite a 98% mutation-test label (p. 179, tagged internal). Figure 4.3 compares claims resolving to diff/run/comment artifacts with claims resolving to nothing (p. 189). Figure 5.1 distinguishes a replaceable role slot from one identity accumulating outcomes across roles (p. 272). Pages 266–267 explicitly state the continuity substrate is incomplete and the restart subsystem forwards a summary rather than execution state.

**Friction evidence and interpretation.** O **2**: concrete scenes and visual contrasts reward his willingness to explore. C **3**: the figure → appendix → second-laptop boundary jumps are manageable privately but awkward to reproduce in a short pitch. P **3**: he can explain the ideas, but the route does not tell him which complete demonstration can be promised today. M **3**: Figure 4.1's timeline must also carry three outcomes and delayed failure; the [internal] caption needs a plain explanation for colleagues. The p. 268 arithmetic read-out is another avoidable interruption. X **1**: chapter entry instructions, numbered mechanisms, and explicit figures give him useful selective access.

**Appeal evidence and interpretation.** I **5**: scenes plus systems ideas give him material he can learn and teach. U **4**: his pitch benefits immediately from distinguishing a green assertion from a checkable result. T **3**: the figures are explanatory evidence, not proof that an available demo survives a second user; the implementation tables properly limit the claim.

**Predicted five-second impression.** The cover suggests an ambitious conceptual project, which interests him. Figure 4.3 supplies a more immediate and repeatable promise: a summary should lead to artifacts. The next action should be a bounded explanatory walkthrough, with a separately evidenced live demo only when available.

**SIMULATED interview response.** “I could explain the two digests to Sam in a minute. That feels worth bringing back. I need the slide to say which parts are examples and which parts run, though. I don't want to discover the second-laptop limitation in the meeting.”

**Confusion / stuck / demotivation.** Confusion: whether [internal] means a worked illustration, a local derivation, or an executed product trace in this particular figure. Stuck: choosing a complete, reproducible demo from mechanisms with different implementation states. Demotivation: a compelling pitch collapsing under Sam's reasonable “show it on my machine” follow-up.

**Recommendations — missing scene and desired apparatus.** Extend the existing Mara example through a second reviewer: Devon presents the summary; Sam opens the specific diff and test run; a stale or missing artifact forces a visible refusal; they agree what was and was not established. Use an explicitly SYNTHETIC storyboard until a dated, revision-bound recorded run exists. Retain Figure 4.3 as the explanatory core. Add a compact status/provenance strip and an optional rehearsal checklist with the failure path. Extend Figure 4.1 with the evidence that detects the delayed fixture error rather than adding another introductory collision picture. Give Figure 5.1 one concrete handoff record as an adjacent example.

## Cohort synthesis: preserve the disagreements

| Tension | Where the personas disagree | Editorial consequence — recommendation |
|---|---|---|
| Immediate relief versus explanation | Priya and Marcus may exit before the useful theory; Yuki and Devon actively seek it. | Offer a short operational-reading exit and a precise expert route. Do not remove proof boundaries to manufacture a universal quick read. |
| Candor versus readiness | Yuki values the correction on p. 106; Jordan hears “cannot depend on this by Friday.” | Keep candor and place a local status note at the scene where a deployment inference is likely. Candor does not itself satisfy adoption needs. |
| Solo success versus team success | Devon sees a strong explanatory demo; Sam asks for comparable behavior across machines. | Separate “can explain the invariant,” “observed one implementation,” and “validated the pilot across environments.” |
| Background coordination versus visible control | Priya wants fewer interruptions; Jordan needs to know why an action was refused; Sam needs a repeatable explanation for everyone. | Show ordinary success quietly, but give exceptional refusals an owner, reason, and recovery path. Explain the attention tradeoff through one case. |
| Conceptual breadth versus scene continuity | Devon welcomes role/identity ideas; Marcus needs to stay with client repos; Jordan stops at the local oversight decision. | Preserve the Book's larger argument while naming legitimate stopping points. Reuse actors/artifacts where it reduces reorientation. |

### Top three objections and grounded responses

1. **“Is this the book I must read before the tool helps?” — effort/identity; Priya and Marcus.** Source: the Book calls itself a textbook and invites question-based entry (p. v), but the reader map is organized by discipline and part. Recommendation: explicitly distinguish optional understanding from operational onboarding, with a compact port/problem route and a stop after the worked instance.
2. **“Can I actually rely on the controls in the scene?” — readiness/risk; Jordan and Devon.** Source: the Chapter 4 route sends status to Appendix 4.A; the consent scene is p. 185, while consent/override are proposed on p. 259. Recommendation: attach a short local status pointer to that scene and preserve the full appendix for evidence. Do not present a simulated ten-second catch on p. 192 as a measured latency.
3. **“Does the claim survive my environment and another person's machine?” — trust/adoption; Yuki and Sam.** Source: test/deployment runtime mismatch on p. 57, model/source/binary gaps on p. 99, local-only authority on p. 480. Recommendation: one decision table linking deployment case, authority boundary, available evidence, and the pilot observation still owed.

### Visual and teaching evidence

The rendered reader-map spread (vi–vii) gives visible route weights, but only at part/chapter scale. It cannot itself tell Marcus where to stop after the port example. This is a granularity limitation, not a claim that the map is absent or unreadable. Figure 4.3 (p. 189) is a particularly strong visual sentence: each claim either reaches an artifact or ends without one. Figure 5.1 (p. 272) makes the stable-role versus persistent-identity distinction with two coordinated timelines. Preserve both.

Figure 4.1 (p. 179) supplies the concrete AI-developer scene this cohort needs, including a delayed failure; it should not be reported as missing. Its rendered page asks the reader to connect a timeline, three outcome boxes, a mutation-test annotation, and a later release failure. Recommendation: make the delayed-failure read order explicit and connect the trace to one repair/evidence step. This is a teaching improvement, not a claim of clipping or a whole-volume visual defect.

The p. 23 terminal panel visibly has monospace commands and placeholder results, but no explicit SAMPLE/RECORDED SESSION classification or recording provenance. Recommendation: use the Book skill's shared sample treatment and mark its evidence kind. Printed p. 268's “loses 10” mismatch was checked in the rendered page, not inferred from text-extraction damage.

### Priorities — recommendations only

| Priority | Concrete action | Benefit and boundary |
|---|---|---|
| Immediate | Correct the p. 268 arithmetic read-out; reconcile the front-matter ordered assurance description with Appendix A's non-total ordering. | Cheap trust repairs for Yuki and Devon. Preserve the correctly displayed arithmetic and distinguish mode from maturity. |
| Immediate | Put a brief status/provenance note beside the p. 185 consent scene, p. 192 intervention, and p. 23 terminal panel. | Reduces Jordan/Devon's readiness confusion and Marcus's copy-first ambiguity. Does not upgrade any implementation claim. |
| Immediate | Add a short optional route index naming question, exact sections, and a stop: port conflict; review a swarm; audit a guarantee; scope a team pilot. | Benefits all six without another full reader-map spread or six competing chapter introductions. Priya may still correctly choose an operational guide. |
| Medium | Carry one small-team incident from artifact change through refusal, evidence, human review, restart, and second-user handoff. | Fills the cohort's shared transfer gap. Reuse Mara and the existing settings/digest figures; label new dialogue and numbers synthetic. |
| Medium | Add the independent-local-installations versus cross-machine-authority comparison and a three-volunteer pilot evidence table. | Answers Sam's deployment question without requiring ordinary local standardization to adopt the market/federation design. |
| Medium | Add a concise claim-to-artifact table with exact revision/provenance and explicit gaps. | Gives Yuki a reliable exit into code review and Devon a defensible explanation. Requires actual evidence collection when implemented. |
| Longer term | Test these routes with real readers from the relevant segments, including an impatient solo developer and a team pilot owner. | Measure comprehension of boundaries, ability to locate evidence, and the decision each can make. Synthetic scores cannot establish those outcomes. |

Priority is qualitative: cross-cohort benefit, severity, and editorial effort inform the ordering. There is no defensible measured “users affected” count or numeric impact estimate here. The strongest shared opportunity is connecting an existing vivid scene to its implementation boundary and a useful stopping decision; adding more introductory scenes alone will not do that.

## Completion and remaining uncertainty

All six canonical profiles were evaluated in order, with inferred reading paths, stopping points, five friction scores, three appeal scores, evidence, simulated responses, confusion/stuck/demotivation points, proposed concrete scenes, and desired figures/marginalia/examples. The assembled PDF was selectively read and visually spot-checked. Product behavior, cited research results, link-click behavior, the entire PDF's accessibility/layout, and real-reader response were not independently verified. Missing-scene findings refer to the inspected routes, not a claim that no related example exists anywhere in 661 pages.

Only this report was edited. No commit, source rewrite, PDF rebuild, operational command, service, hook, daemon, or Port Daddy MCP call was performed.
