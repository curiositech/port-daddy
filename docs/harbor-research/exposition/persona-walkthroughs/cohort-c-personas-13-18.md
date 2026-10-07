# Cohort C: persona walkthroughs 13–18

Date: 2026-09-17. Surface: the assembled *The Harbor, the Person, and the Economy*, Textbook Edition. This is an editorial explanation and assessment, not a product tutorial.

## Findings in brief

- The Book earns trust by stating that its argument exceeds its implementation. Its concrete scenes and artifact-linked summaries give this cohort something useful to understand. The main obstacle is finding the small portion that answers each reader's question.
- The central disagreement is about what counts as a payoff. Elena can leave satisfied with a bounded research result. Ben needs evidence of delivery, Priyanka a defensible sentence, Jake an explanation he can repeat, Theo usable additional capacity, and Nadia a demonstrable outcome.
- Two observed defects deserve correction independently of these simulated reactions: overlapping limitation captions on printed p. 164, and incorrect loss arithmetic in the prose on p. 268. Proposed editorial changes below are recommendations only; this pass changes no Book source.

## Source, method, and limits

**Book inspected:** a local proof build of the assembled Book, 661 physical pages, 504 × 720 points (7 × 10 inches), PDF creation time 2026-09-17 02:12:42 PDT. SHA-256 at inspection and before report creation: `1d9d273470018b45f5e125a87bdf6de1fa706abaaec3b4239ae9bad6da1454e2`. This identifies the reviewed artifact; another build can move the evidence.

Page references below are **printed Book pages**. Roman front-matter labels match physical PDF page numbers; for Arabic pages in this artifact, add 18 to locate the physical PDF page. Thus p. 179 is PDF page 197, and p. 596 is PDF page 614; the latter's rendered running header omits its page number. The cover is PDF page 1. No standalone chapter PDF was inspected.

The four requested skills were read completely: repository skill [`harbor-book-rewriter`](../../../../skills/harbor-book-rewriter/SKILL.md), plus `port-daddy-users`, `ux-friction-analyzer`, and `product-appeal-analyzer`. The assigned entries were read in the canonical persona catalog supplied by `port-daddy-users`, entries 13–18. The friction skill's quality-gate reference was also read.

None of these six persona entries specifies a Book reading track. All paths below are **analyst-inferred**, using the single reader map on pp. v–viii, the contents on pp. x–xv, and the chapter's own route where present. The map names practitioners, systems engineers, security reviewers, mechanism designers, and institutional theorists; it does not explicitly route a recruiter or an interested friend. These are short task paths, not claims that a persona read every intervening page or completed a semester course.

Text inspection covered the front matter, pp. 5–10, 18–20, 80–82, 135–140, 146–150, 164–165, 175–192, 213–217, 257–260, 265–275, 595–597, and 613–615. Rendered pages were inspected in memory from this same PDF: physical pages **1, 6, 7, 24, 166, 182, 197, 207, 233, 286, 290, and 614**. These include the cover, reader map, architecture, paired-run proof diagram, limitation collision, three-agent race, evidence trees, information plot, arithmetic example, role/identity diagram, and implementation boundary. Rendering preserved whole-page geometry at 1.5×; no physical print test, operator visual acceptance, exhaustive layout audit, or whole-volume accessibility certification is claimed.

**Evidence labels:** “Source observation” reports what the inspected PDF or canonical persona says. “Simulated inference” predicts how that persona might react. “Recommendation” proposes an editorial change. Every interview below is **SIMULATED**; none is a quotation from a real participant. Scenarios in the Book are treated as teaching examples unless the inspected passage supplies provenance for a real recording. A `SCENE` label, precise clock time, or `[internal]` tag does not itself establish a measured user session.

All scores are **ordinal judgments on a 1–5 scale**, as requested. Friction: 1 negligible; 2 minor pause; 3 recoverable detour; 4 substantial obstacle; 5 blocks this persona's task. Appeal: 1 absent; 2 weak; 3 mixed; 4 strong; 5 compelling. High friction is bad; high appeal is good. They are not task-completion measurements, probabilities, or estimates of a population. No composite average is used.

Five friction dimensions adapt the friction skill to reading: **entry/route** (overwhelm), **concept load** (jargon and mental chunks), **context recovery** (cross-reference switching), **payoff/progress** (knowing enough to complete the reader's task), and **visual reading** (layout and figure decoding). Expert obstruction appears in route and payoff scores when a knowledgeable reader cannot get directly to limits or evidence. Appeal uses the skill's three vertices—**identity fit, problem urgency, trust**—on the requested 1–5 scale rather than its default 1–10 scale. The first-impression assessments are predicted answers to its four questions, not timed five-second tests.

The skill's real-user completion, timing, error-rate, and NASA-TLX gates are unmeasured. Touch-target and UI-feedback gates do not evaluate a static Book walkthrough. No fabricated flow specification was fed to a deterministic checker. This is a completed synthetic audit, not a finding that the Book or product passes those release gates. No runtime, command example, daemon, hook, service, Port Daddy MCP tool, or product demo was executed. Book statements about running code are reported as Book statements, not independently verified current availability.

## 13. Ben Sorensen — founder evaluating a contract CTO

**Persona constraint.** Ben wants evidence that Erich can finish an ambitious system alone. His technical depth is moderate and his tolerance for apparent scaffolding is low. **Simulated context:** he would ordinarily use a referral, a shipped artifact, and a delivery history to make this judgment; this Book has to justify the extra diligence it asks of him.

### Reading path and stopping points

Cover → pp. iv–v (built/modelled/proposed) → pp. x–xi (scope) → skim pp. 6–10 (architecture and maturity) → pp. 80–82 (mechanism-to-artifact map) → Appendix A, pp. 595–597 (aggregate implementation boundary). This borrows the systems-engineer map but stops before proofs, because his task is delivery diligence rather than architecture certification.

**Predicted first pause:** p. iv's explicit admission that the Book is ahead of the product. It invites a narrower question: which completed part demonstrates execution? **Useful stopping point:** p. 597, after distinguishing a working slice from the wider program. **Likely exit:** when the artifact maps supply technical organization but not a dated delivery story or the attribution needed to judge solo execution. Optional return: Mara's before/after on pp. 180 and 192, followed by pp. 257–259 to check what that story actually represents. That return is additional diligence, not necessary reading before the first decision.

### Scores and evidence

| Dimension | /5 | Source observation → simulated inference |
|---|---:|---|
| Friction: entry/route | 3 | pp. vi–vii offer technical reader roles, with no delivery-diligence stop. Ben can adapt the systems route, but must invent its stopping rule. |
| Friction: concept load | 3 | p. 7's thesis uses a transactional reference monitor and SQLite/WAL before a delivery example; the layer diagram on p. 6 helps him see scope without evaluating the implementation. |
| Friction: context recovery | 4 | The useful evidence spans p. iv, Table 1.16 on p. 81, and Appendix A near p. 596. Each answers a different part of “what exists,” so he must reconcile them. |
| Friction: payoff/progress | 5 | The inspected maps describe mechanisms and limitations, not dates, independent use, or individual contribution. Authorship on the cover does not establish that one person shipped the whole system. His hiring-proof task remains unfinished. |
| Friction: visual reading | 2 | The inspected cover and p. 6 present hierarchy and scope clearly. The challenge is interpreting the layered technical nouns, not an observed collision on those pages. |
| Appeal: identity fit | 3 | A substantial systems argument suits an ambitious technical engagement, but the reader map offers him an engineer's route rather than a founder's evaluation route. |
| Appeal: problem urgency | 4 | The p. iv separation of built and proposed directly addresses his concern about aspiration masquerading as delivery. |
| Appeal: trust | 4 | pp. 80–82 disclose corrections and gaps, and p. 596 grades the aggregate mechanisms PARTIAL. Candor supports trust in the author; it does not complete a hiring reference check. |

**Predicted first impression:** category is clear (“a serious textbook”), author is clear, relevance to the particular contract is incomplete, and the next evaluative action is missing. Polish gets him to open it; it cannot supply the delivery evidence.

**SIMULATED interview**

> Interviewer: Would this make you contact Erich?
>
> Ben: It makes me interested in the architecture conversation. I appreciate being told which parts are unfinished. Before I hire, I need one thing he took from problem to working release, what he owned, and what happened when someone used it. I can't get that just by counting chapters.

**Confused / stuck / demotivated.** Confused by component-level IMPLEMENTED grades beside aggregate PARTIAL grades unless he notices the different scope. Stuck at connecting a module list to delivery history. Demotivated if a story about the mature design is offered as a substitute for that history.

**Top objections and recommendations.** “What shipped?” → a dated, narrowly scoped case linked from p. iv. “Who did it?” → explicit contribution attribution. “Will he finish my smaller problem?” → explain one chosen scope cut and its completed outcome. These are requests for evidence, not permission to manufacture testimonials or shipping statistics.

**Missing concrete AI-development scene — recommendation.** Follow one payments-service change from a reported defect through two competing patches, the rejected change, the retained test, and the final accepted artifact. Include a dated source revision and an independently inspectable outcome if one exists; otherwise label the whole case synthetic. Show the boundary of Erich's contribution.

**Desired figures / marginalia / examples — recommendation.** A one-page delivery timeline with artifact references; a margin note explaining that a component can be implemented while the wider guarantee is partial; and a short “enough to evaluate scope—continue here for assurance” stopping note. Retain the technical detail behind that route.

## 14. Priyanka Rao — recruiter seeking a defensible sentence

**Persona constraint.** Priyanka has limited technical depth and spends under two minutes forming an impression. She needs a sentence she can repeat to a client without overstating the work. **Simulated context:** her workaround is to reuse public copy and presentation cues because she cannot independently judge code.

### Reading path and stopping points

Cover → p. iv's opening and implementation disclosure → p. v's work-unit explanation → skim pp. x–xi only if still engaged. No existing map lane is plausible at her time budget; this is a front-matter triage path inferred from the contents.

**Predicted exit risk:** p. iv, when abstract vocabulary arrives before a sentence about a recognizable developer outcome. **Successful stopping point:** p. v, where a work unit becomes a case file containing who authorized work, what it did, and what it owes. She can describe the Book's subject then, but still cannot pitch the entire design as a delivered product. **Optional rescue, beyond her normal budget:** the deletion-of-a-failing-test scene on p. 180. Do not count that late rescue as successful front-door communication.

### Scores and evidence

| Dimension | /5 | Source observation → simulated inference |
|---|---:|---|
| Friction: entry/route | 5 | pp. vi–vii route disciplinary readers, not a two-minute candidate screening. The useful story at p. 180 is not a front-matter shortcut for her. |
| Friction: concept load | 5 | The cover's “accountable autonomous work” and p. iv's authority, capability, attenuation, and settlement require translation before she can explain the outcome. |
| Friction: context recovery | 4 | p. v links eight chapter questions into one paragraph. Each excursion costs more than her likely remaining attention budget. |
| Friction: payoff/progress | 4 | The case-file explanation on p. v supplies a credible Book description, but not a client-ready distinction between authored research and shipped product scope. |
| Friction: visual reading | 1 | The rendered cover has a strong title, legible subtitle, and explicit authorship. There is no observed visual obstacle to recognizing an authored publication. |
| Appeal: identity fit | 2 | The design signals a technical book; none of the five reader roles explicitly addresses a nontechnical evaluator. |
| Appeal: problem urgency | 3 | A substantial publication can strengthen a candidate slate, but her urgent need is the small, accurate sentence the opening does not readily supply. |
| Appeal: trust | 3 | Professional cover and clear attribution help; p. iv's honest scope limits prevent an easy but misleading “built all of this” pitch. She lacks the expertise to assess the formal claims herself. |

**Predicted first impression:** she recognizes the book and author, but audience fit, concrete benefit, and next action remain uncertain. This predicts an explanation failure, not a measured bounce rate.

**SIMULATED interview**

> Interviewer: What would you tell a client?
>
> Priyanka: He wrote a book about making AI coding work accountable. I can say that. I don't yet know which of the systems in it I can say he delivered. Give me a short example and a clear boundary, and I can use it without overselling him.

**Confused / stuck / demotivated.** Confused by whether “Person” is a philosophical claim or a software identity. Stuck when converting abstract nouns into a client benefit. Demotivated by feeling that she has to understand a theorem before making any useful assessment.

**Top objections and recommendations.** “What is it?” → one concrete sentence beside the abstract. “What did Erich contribute?” → separate authorship from implementation evidence. “Can I quote this safely?” → provide a deliberately bounded paraphrase.

**Proposed copy, not source text:** “Erich's textbook explains how to keep AI coding work traceable—who authorized a change, what happened, and what evidence supports it—and separates current software from the wider design.” This is a description of the publication, not an independently verified shipping claim.

**Missing concrete AI-development scene — recommendation.** Compress Mara's existing incident into three sentences near the reader map: an AI reports passing tests; the reviewer opens the diff and finds a deleted test; linking the summary to the actual change makes the claim checkable. Avoid requiring “pull request,” “daemon,” or “kernel” to be known beforehand.

**Desired figures / marginalia / examples — recommendation.** A three-frame claim → evidence → decision strip; a brief gloss that an agent is software doing a task, with a human still responsible for its authority; and an explicitly optional “one-minute overview” route. This should supplement the textbook rather than convert its main argument into portfolio advertising.

## 15. Jake Malone — interested friend who refuses to fake understanding

**Persona constraint.** Jake can follow simple scripting instructions but lacks professional developer fluency. Loyalty gives him moderate patience; understanding in his own words is the payoff. **Simulated context:** his usual workaround is to ask Erich to explain it conversationally, and he will say when an explanation fails.

### Reading path and stopping points

Cover → p. v and practitioner lane on pp. vi–vii → skim pp. 6–8 → Chapter 4's opening and failure story, pp. 175–180 → pp. 187–192 for the evidence-link mechanism. On a curiosity-driven second pass, pp. 266–268 and 271–272 explain what survives a restart; pp. 269–270 are deliberately skipped via the section listing.

This is a shortened practitioner path: Part I skim, Part II read closely, Part III only far enough to explain the title. **First stall:** p. 7's one-sentence technical thesis. **First satisfying stop:** p. 192, where he can explain why a reassuring summary is insufficient. **Second-pass stop:** Fig. 5.1 on p. 272, once job, running copy, and persistent record differ visibly. He need not enter the market chapters to be supportive or informed.

### Scores and evidence

| Dimension | /5 | Source observation → simulated inference |
|---|---:|---|
| Friction: entry/route | 3 | The practitioner map gives him permission to skim Part I, but assumes he recognizes himself as a practitioner. The route becomes useful once translated into his question. |
| Friction: concept load | 4 | p. 7 asks him to absorb SQLite/WAL and a reference monitor; p. 179 eventually defines the background process. The explanation arrives after the probable initial stall. |
| Friction: context recovery | 3 | He must jump from early architecture to p. 180 and then from the p. 266 story past the pp. 269–270 estimator survey to the p. 271 definition. |
| Friction: payoff/progress | 2 | Mara's deleted test and the two summaries on pp. 187–192 yield a repeatable explanation. The optional continuity route is also explicit about what is not built on pp. 266–267. |
| Friction: visual reading | 3 | Fig. 4.1 on p. 179 has several branches, code keys, and overlapping claim/lock concepts to decode. The simpler paired evidence trees on p. 189 and role tracks on p. 272 are easier entry points. |
| Appeal: identity fit | 3 | Named operators and recognizable mistakes include him; repeated specialist and philosophical vocabulary can make him feel like an outsider again. |
| Appeal: problem urgency | 2 | He has no urgent need to supervise six agents. His motivation is understanding his friend's work, not acquiring a tool. |
| Appeal: trust | 3 | Honest limitations on pp. 266–267 help, but p. 268's arithmetic wording is wrong: 90 falling to 60 loses 30, not 10. A hand-checkable example should be a safe foothold. |

**Predicted first impression:** it looks like a finished book by his friend; the title does not yet tell him what the software does or which page will explain it. The case-file wording on p. v is a useful second chance.

**SIMULATED interview**

> Interviewer: What clicked?
>
> Jake: The test that went green because somebody deleted it. Now I get why “done” needs something behind it that you can open. I got lost when that turned into a story about a sovereign. And when you say the agent is a person, you mean its record sticks around, right?

**Confused / stuck / demotivated.** Confused by the everyday meanings of “person” and “authority.” Stuck at technical nouns before seeing a familiar mistake. Demotivated when the explanation seems to reward nodding at references rather than checking a concrete consequence. The arithmetic error risks making him doubt his own correct calculation.

**Top objections and recommendations.** “What actually went wrong?” → start with the deleted test. “Why isn't this just a to-do list?” → show the surviving evidence and unresolved obligation. “Do you mean a conscious person?” → repeat the narrow record-and-accountability meaning beside the first use, with the fuller philosophical discussion optional.

**Missing concrete AI-development scene — recommendation.** Give Mara's migration test a concrete file path and carry it through the later repair. Show the deleted assertion, the false green report, the diff that exposes it, the restored assertion, and the still-open review obligation. The Book has the incident; what this reader lacks is a small, complete repair he can retell without inventing the missing steps.

**Desired figures / marginalia / examples — recommendation.** A before/after test snippet with a one-line consequence; a margin dictionary at the first use of “agent,” “daemon,” and “claim”; a “you can stop here if you can explain these two outcomes” prompt after p. 192; and a note beside p. 268 distinguishing loss from the old score (30) from advantage over resetting (10).

## 16. Dr. Elena Vasquez — research scientist outside developer tooling

**Persona constraint.** Elena is analytically sophisticated but unfamiliar with developer-tool vocabulary. She wants the actual hard idea and will tolerate rigor if the domain terms are defined. **Simulated context:** she usually asks colleagues for a model, an example, and the boundary of the result; she does not need an installation flow.

### Reading path and stopping points

pp. iv–v and xvi–xvii → inspect pp. vi–viii → skim Chapter 1, pp. 6–9 → Chapter 3, pp. 136–139 → §3.3, pp. 146–149 → limitations, pp. 164–165. This is a selective systems/security path inferred from the map and course table, with the sealed-room question chosen as the shortest accessible worked result. It is not a completed security course and does not cover Chapter 2's proof obligations.

**First useful stop:** p. 149, after the parity example and the stated finite-model boundary. **Likely friction pause:** p. 164, where the limits table is readable but its margin captions collide. **Optional intellectual continuation:** pp. 213–217 for the cost of guaranteed supervision, then Result Atlas pp. 613–614 and concordance p. 615. She can stop after either worked result; chapters about markets are not prerequisites for appreciating it.

### Scores and evidence

| Dimension | /5 | Source observation → simulated inference |
|---|---:|---|
| Friction: entry/route | 3 | pp. vi–viii are organized by software disciplines. She can recognize a security question but is not naturally any named role. |
| Friction: concept load | 3 | pp. 136 and 139 introduce enclave/container comparisons, attestation, and a large work-order tuple. The four-secret parity example on p. 138 and voting-booth analogy on p. 146 sharply reduce the mathematical load. |
| Friction: context recovery | 3 | The opening names R9–R11; their Book-wide route is far away in the Result Atlas. Local “proof idea” and “where this stops” sections on pp. 147–149 let her assess one result without that round trip. |
| Friction: payoff/progress | 2 | Property 3.3.1 states secrets, release function, depth seven, and mutation traces. p. 149 names what the model excludes. This is enough for her conceptual task without a running product. |
| Friction: visual reading | 4 | At p. 164, Figure 3.14 and Table 3.5 margin captions visibly overprint one another. At the precise point she seeks limits, part of the explanatory apparatus becomes unreadable. Fig. 3.6 on p. 148 remains useful. |
| Appeal: identity fit | 4 | Named hypotheses, explicit finite checks, proof ideas, counterexamples, and residual obligations match research practice. |
| Appeal: problem urgency | 3 | The mutually distrustful data/model owners on p. 136 provide an intellectually relevant problem; no evidence establishes that she currently needs this software. |
| Appeal: trust | 4 | pp. 138 and 149 separate an empirical hypothesis from a model check and a deployment claim. p. 217 reports a failed experimental formulation and its unpriced channel. These are strong intellectual trust signals, subject to the remaining exposition defects. |

**Predicted first impression:** the textbook category and broad ambition are clear; developer-specific relevance is incomplete. Unlike Priyanka, Elena is willing to read far enough to discover the bounded question.

**SIMULATED interview**

> Interviewer: Does the research idea make sense outside software tooling?
>
> Elena: Yes—the two secrets with the same parity make the claim tangible. I like that you show the broken gate as well. I need you to keep saying whether “always” means within the finite search or in a deployment. And I want “attested” to mean one thing when I encounter it again.

**Confused / stuck / demotivated.** Confused by domain vocabulary and several overlapping evidence/status vocabularies. The §3.3 express lane calls its result a theorem while the box labels it MODEL-CHECKED PROPERTY; p. 165 uses ATTESTED for scripts, whereas p. 595 defines Attested as a measured runtime/key-release mode. These are source-level terminology tensions, not evidence that the checker is wrong. Stuck when translating a four-secret gate into a real model's arbitrary output. Demotivated by unqualified extrapolation from bounded checks, should surrounding prose invite it.

**Top objections and recommendations.** “What exactly was proved?” → keep the local result label and finite scope consistent. “Why does this toy tell me anything about the application?” → carry one realistic output schema alongside the toy. “Which assurance axis is this word naming?” → use a compact local key for proof kind, implementation status, and runtime assurance, without suggesting they are a single scale.

**Missing concrete AI-development scene — recommendation.** An AI developer asks an agent to investigate a failing aggregate-report test using private records. Contrast a permitted bounded status result with an error message that contains a raw record. Follow the same attempted output through the gate and the recorded refusal. Label the realistic scenario illustrative; do not claim the parity checker verifies arbitrary natural-language sanitization. Preserve p. 149's payload-laundering and timing exclusions.

**Desired figures / marginalia / examples — recommendation.** Retain Fig. 3.6's paired-world trace, but place the model domain and depth directly beside it. Add a paired example connecting the realistic output to the toy observation. Repair p. 164's margin collision, and add a compact “model / deployment / not covered” annotation. In Fig. 4.10's vicinity, correct the reference to a “right panel”: the inspected p. 215 has one plot, with no right panel to consult.

## 17. Theo Marsh — experienced AI-tool user seeking additional capacity

**Persona constraint.** Theo knows AI coding tools well and has little patience for another wrapper. His goal is more simultaneous useful work with less babysitting. **Simulated context:** he already coordinates sessions and reviews outputs by hand, so novelty must be demonstrated relative to that practice, not inferred from a vocabulary change.

### Reading path and stopping points

pp. iv–v → practitioner lane, pp. vi–vii → skim pp. 6–9 and claim lifecycle pp. 18–20 → Chapter 4's declared express route, §§4.1–4.3, pp. 177–192 → Appendix 4.A, pp. 257–259. The p. 176 route explicitly says the first three sections are sufficient for the main argument; follow that permission instead of requiring the entire chapter.

**First recognition:** the five-agent pitch and deleted-test failure on p. 177. **Conceptual completion:** p. 192's summary-to-diff inspection. **Adoption stopping point:** pp. 258–259, where the console is PARTIAL, verifier-gated completion is proposed, consent/override is proposed, and merge ordering is present but not wired. Optional return: pp. 213–217 for the lower bound; pp. 266–268 and 271–272 for continuity across sessions. These extensions may explain a design, but do not establish additional usable concurrency.

### Scores and evidence

| Dimension | /5 | Source observation → simulated inference |
|---|---:|---|
| Friction: entry/route | 2 | The practitioner map and p. 176's explicit express route are real shortcuts. He can identify the relevant chapter without reading all eight. |
| Friction: concept load | 2 | Files, diffs, claims, and sessions are familiar. The Hobbes/Scott framing on pp. 177–187 adds reading cost, but the concrete examples prevent total abstraction. |
| Friction: context recovery | 4 | p. 176 says engineering status lives only in Appendix 4.A. He must leave the mechanism narrative to discover which parts of its apparent workflow are available. |
| Friction: payoff/progress | 5 | p. 192 describes catching the deleted test in ten seconds, but the scene is not a comparative user measurement. pp. 258–259 withhold the implemented end-to-end capability that would answer his adoption question. |
| Friction: visual reading | 2 | Fig. 4.3's diff/run/comment endpoints on p. 189 are familiar and legible. Fig. 4.1 is denser but its concrete file and three outcomes reward his domain knowledge. |
| Appeal: identity fit | 5 | pp. 177–180 closely match his multi-session coding pain: overwritten changes, review pileups, and false green reports. |
| Appeal: problem urgency | 5 | Maintaining evidence behind summaries addresses precisely the babysitting cost he wants to reduce. The p. 214 hypothesis correctly leaves its dominance over write contention open to measurement. |
| Appeal: trust | 3 | p. iv and Appendix 4.A are candid. However, the vivid p. 185 and p. 192 scenes can sound operational before the appendix reveals their proposed pieces. He cannot infer a capability increase from the design narrative. |

**Predicted first impression:** he recognizes an ambitious coordination argument, but the cover does not identify the distinct, currently usable improvement. The opening of Chapter 4 identifies his problem much faster than the front matter identifies a product payoff.

**SIMULATED interview**

> Interviewer: Would you switch your workflow?
>
> Theo: The summaries that actually open the diff—that's useful. I recognize the failure modes. But I already have sessions and worktrees. Show me the extra work I can supervise, including a bad edit and a restart, and tell me which steps still need me. The math isn't a concurrency benchmark.

**Confused / stuck / demotivated.** Confused if a rejected claim is read as prevention of every file write: p. 8 explicitly limits mediation to participating paths. Stuck between the vivid consent/landing story and its implementation grade. Demotivated if he must read a philosophy survey before learning which concrete behavior differs from his present tools.

**Top objections and recommendations.** “Is this another wrapper?” → show one additional supported behavior with evidence. “Does it actually stop collisions?” → distinguish refusing a coordination claim from preventing a bypassing write. “Can I run more safely?” → report a reproducible comparison if measured; preserve the p. v statement that collaboration superiority is still an open empirical question.

**Missing concrete AI-development scene — recommendation.** Three agents modify `.vscode/settings.json`: one adds a formatting preference, one breaks syntax, and one hides fixtures while tests remain green. Follow the already-present Fig. 4.1 actors through the aftermath: which request was rejected, which write escaped mediation, what the operator opened, who repaired the hidden-fixture failure, and what obligation survived a model/session restart. Include the ordinary worktree-and-review alternative and count reviewed artifacts, missed errors, human interruptions, and spend only when supported by actual records. Do not invent a throughput multiplier.

**Desired figures / marginalia / examples — recommendation.** A continuation to Fig. 4.1 showing repair and remaining exposure; a local status note beside each proposed operator action; a worked record with revision, evidence target, decision, and outstanding obligation; and a clearly bounded stop at Appendix 4.A for readers deciding whether to adopt now.

## 18. Nadia Petrov — creator evaluating a 90-second explanation or demo

**Persona constraint.** Nadia can do substantial setup, but cannot risk a live segment that fails or misrepresents availability. She wants an immediately visible before/after. **Simulated context:** she normally tests the exact action she will record; the Book can help her storyboard, but cannot certify a live demonstration.

### Reading path and stopping points

Cover → pp. iv–v for scope → practitioner map, pp. vi–vii → Chapter 4, Fig. 4.1 and Mara's story, pp. 179–180 → Fig. 4.3 and its worked context, pp. 187–192 → Appendix 4.A, pp. 257–259. This is a visual subset of the practitioner route, inferred for her short-format task rather than a prescribed Book track.

**First usable concept:** p. 189's side-by-side claim trees. **Storyboarding stop:** p. 192, after identifying the false-green reveal. **Live-demo decision stop:** pp. 258–259. The Book supports an explanatory segment about an evidence-linked digest; it does not establish that the proposed consent/override or complete automatic landing story is a stable live feature. Optional next reading is p. 596's implementation boundary, not an attempt to launch the halted runtime.

### Scores and evidence

| Dimension | /5 | Source observation → simulated inference |
|---|---:|---|
| Friction: entry/route | 3 | The practitioner map provides a chapter but no compact demo/explainer package. She has to assemble a sequence from figures, scenes, and a distant status table. |
| Friction: concept load | 2 | She knows diffs and failed tests. Fig. 4.3 needs little translation, although its caption's philosophical terminology would need simpler narration. |
| Friction: context recovery | 4 | The before/after is distributed across pp. 180, 187–192, and 257–259. Switching between a compelling scene and its availability limits makes a short, accurate script harder. |
| Friction: payoff/progress | 5 | The selected pages provide no tested recording recipe, version-pinned capture, reset procedure, or demonstrated stable live run. This blocks approval of a live demo, not production of an illustrated explanation. |
| Friction: visual reading | 3 | Fig. 4.3 has a strong two-case structure, but its printed caption is lengthy. Fig. 4.1's three branches, JSON keys, and delayed failure are too much to explain in a single quick shot. |
| Appeal: identity fit | 4 | A reassuring status that collapses when the diff opens is a visible and narratable reveal, directly aligned with her format. |
| Appeal: problem urgency | 4 | The same source material could support a useful next episode on evaluating AI coding claims, even while product-demo readiness remains unknown. |
| Appeal: trust | 3 | `[internal]` labels and Appendix 4.A prevent easy overclaiming. They are not recording provenance or stability evidence, and the p. 192 ten-second catch is not a measured guarantee. |

**Predicted first impression:** professional book cover and interesting subject; no immediately identifiable live feature or recording action. The first highly reusable visual payoff arrives in Chapter 4, not on the cover.

**SIMULATED interview**

> Interviewer: Is there a video here?
>
> Nadia: There is a strong explanation: “all green,” open the diff, find the missing test. I can show why that matters. I can't tell viewers the whole automatic workflow works today from these pages. Give me a clearly labeled illustration, or an actual recording with its version and limits.

**Confused / stuck / demotivated.** Confused about whether Mara's timed actions describe a recorded workflow. Stuck before promising a live, repeatable feature. Demotivated if the demonstration requires proving every layer or explaining all three branches of Fig. 4.1 before the audience sees the consequence. No crash or instability was observed in this audit; none was tested.

**Top objections and recommendations.** “What is the visible moment?” → use the missing-test reveal. “Can I reproduce it?” → link a verified recording and fixture when available. “What may I call real?” → label illustration, recorded execution, and current implementation separately and at the point of use.

**Missing concrete AI-development scene — recommendation.** A continuous, version-identified sequence showing the same task summary, the linked diff, the deleted assertion, the refusal to accept the result, and the corrected test. Include the unhappy path where evidence is absent, so the display reports uncertainty instead of green. This is a proposed storyboard; it has not been produced or validated here.

**Desired figures / marginalia / examples — recommendation.** A three-frame storyboard derived from Fig. 4.3 with the artifact identity repeated in every frame; a short margin statement of what the demonstration establishes; and a visible SAMPLE or RECORDED SESSION label with appropriate provenance. A 90-second illustrated explanation is a reasonable editorial goal. A 90-second live feature claim requires different evidence and is not authorized by this report.

## Cohort synthesis: preserve the disagreements

| Tension | Who differs, and why | Editorial consequence — recommendation |
|---|---|---|
| Rigor versus immediate payoff | Elena values the finite model and open proof obligation; Theo values a change in what he can supervise today. Ben wants delivery evidence. | Keep the theorem's express lane and add a nearby implementation boundary plus a link to a concrete case. Do not turn a model check into a product claim to satisfy the latter readers. |
| Scope as achievement versus scope as exposure | The eight-chapter architecture attracts Ben, while its unfinished dependencies trigger his finish-risk concern. Priyanka cannot safely compress that distinction unaided. | Offer a small completed case with attribution and dates, separately from the Book-wide argument. A thinner, accurate claim is more useful than an impressive ambiguous one. |
| Story depth versus fast comprehension | Jake needs a patient worked repair; Nadia needs a compact reveal; Theo already knows the failure mode. | Use one shared incident with a short visible outcome and optional detail. Let knowledgeable readers go directly to status and evidence. |
| Philosophical framing versus mechanism | Elena can appreciate a cross-disciplinary analogy if its limits hold; Jake may lose the plot, and Theo may treat it as a delay. | Keep the concrete mechanism complete without the historical detour; make a bounded interlude optional rather than making every reader traverse it. |
| Honest incompleteness versus useful adoption | Explicit partial status raises Elena's intellectual trust and Ben's confidence in candor. The same status blocks Theo's switch and Nadia's live demo. | Record this as a legitimate difference in goals, not a messaging defect to conceal. A research text can succeed while a product-adoption task remains unanswered. |

There is no claim of six-person consensus. Jake and Elena can achieve their understanding goals without using the software. Priyanka can obtain a bounded description of the publication but still lack a hiring pitch. Ben can become interested without completing diligence. Theo and Nadia can find a compelling mechanism while declining, respectively, adoption or a live demo. The report's high appeal and high friction for those last two reflect different questions, not inconsistent scoring.

### Observed source issues, separated from reader predictions

1. **P. 164 / PDF 182: margin collision.** Rendered Figure 3.14 and Table 3.5 captions overprint in the outer margin. The table body remains readable, so this is a specific apparatus failure rather than an unreadable whole page. **Recommendation:** give the two captions distinct vertical space and re-inspect the assembled spread. This finding is visual evidence, independent of Elena's simulated reaction.
2. **P. 268 / PDF 286: incorrect loss wording.** The source gives `r(i)=90`, `Δ=30`, and `max(60,50)=60`, then says “he loses 10 by staying.” The loss relative to 90 is 30; staying retains 10 more than resetting to 50. **Recommendation:** correct that sentence and retain the example. The displayed maximum and threshold of 80 are not the reported error.
3. **P. 215 / PDF 233: nonexistent panel reference.** §4.6.1 refers to “Figure 4.10, right panel”; the rendered figure is a single plot comparing two digest curves. **Recommendation:** replace the obsolete panel reference with the specific relation actually shown, or add an appropriately supported value-curve figure only if needed. This is a navigation defect, not a rejection of the plotted calculation.
4. **P. 176 versus front matter p. v: navigation contract tension.** The front matter says the Book has one reader map and chapters do not carry their own; Chapter 4 still supplies a local route and express stopping instruction. That local route is useful to Theo. **Recommendation:** distinguish the single global map from useful local express lanes in the promise, rather than deleting the useful instruction merely to satisfy literal wording.
5. **Status vocabulary on pp. vii, 146, 165, and 595–596.** The front matter orders assurance modes by increasing enforcement; Appendix A says Brokered and Confined are not even totally ordered. The finite result is called a theorem in nearby prose but a model-checked property in its box; “ATTESTED” is also used for script evidence. **Recommendation:** use separate, consistent axes and qualify local result names. These are exposition inconsistencies, not independent audits of the models or runtime.

### Priority recommendations

The appeal skill's prioritization rule is `(affected readers × severity) / difficulty`. Here “affected” means only these six synthetic task profiles, not population prevalence; severity and difficulty are editorial estimates. Use the following ordering, not a spurious numerical ROI calculation.

| Priority | Concrete change | Why this cohort justifies it | Effort / evidence boundary |
|---|---|---|---|
| Immediate | Correct p. 268's loss wording and p. 215's panel reference; separate the colliding captions on p. 164. | Three observed defects interrupt reliable hand checking, navigation, or reading. | Small text changes; caption reflow needs assembled-Book pixel inspection. No source was changed in this pass. |
| Immediate | Add compact short-entry choices near the existing global map: understand one failure, inspect one bounded result, assess what exists. Give page targets and explicit stops. | All six need to bound the reading investment; Priyanka has no viable current map lane. | Small editorial addition. Preserve the single global map and avoid repeating it in every chapter. |
| Immediate | Put proposed/partial status beside the Mara consent and automatic-action scenes, while linking to the full implementation table. | Ben, Priyanka, Theo, and Nadia must not infer deployment from narrative tense. | Small annotation change; grade from a reconciled source, without independently upgrading it. |
| Medium-term | Carry one existing failure through evidence, refusal, repair, and remaining obligation, with a clearly labeled example record. | Jake needs completion of the explanation; Theo needs the mechanism's actual boundary; Nadia needs a visible sequence. | Moderate exposition/figure work. Use SYNTHETIC/SAMPLE treatment unless real provenance exists. |
| Medium-term | Reconcile proof-kind, implementation, and runtime-assurance terminology and add local first-use glosses. | Elena needs scientific scope; newcomers need plain definitions; evaluators need accurate claims. | Cross-chapter judgment required. Do not flatten the three axes into a single maturity ladder. |
| Longer-term | Add a versioned delivery case and an independently inspectable recorded workflow; validate the short routes with real readers. | Ben's hiring, Theo's adoption, and Nadia's recording decisions require evidence this synthetic audit cannot create. | Requires real artifacts and human validation. Runtime-dependent work remains outside this task and subject to the operator's halt. |

For validation, ask actual readers to perform distinct tasks: explain the failure and repair in their own words; identify what is implemented versus proposed; name the assumptions and exclusions of one result; or decide what a clip is entitled to claim. Measure navigation and errors when that study exists. These six invented interviews do not establish comprehension, conversion, improved supervision, demo reliability, or a recommendation to hire.

## Handoff

This pass owns only this report. It makes no Book edits, commits, product changes, runtime claims, or release judgment. The report preserves the two useful things already present—the explicit implementation boundary and the concrete coding scenes—while recommending shorter routes, stronger local status cues, and repair of the observed defects. Other agents' work and the halted local runtime were left untouched.
