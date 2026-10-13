# Book reading routes: 24-persona review

18 September 2026 · editorial simulations, not user research

## The main finding

The Book is most convincing when it puts a reader in front of a particular failure and lets them inspect what changes: a process crash versus power loss, a misleading green summary, a narrowed permission, or a settlement whose balances can be checked. It becomes harder to trust when the surrounding prose generalizes beyond that case or makes the reader assemble the implementation boundary from another chapter.

Keep the technical depth. Shorten the distance between a question, its worked case, its assumptions and a sensible stopping point. Do not make every persona a target reader: Priya can correctly leave for operating instructions, Fatima can correctly withhold approval, and Sophie can correctly stop after one scene.

There is a specific unresolved contradiction worth fixing before another broad polish pass. The Chapter 4 taxonomy describes a file/region claim as advisory, then says a uniqueness constraint makes double-claiming impossible. Chapter 7's English model explicitly says file claims always succeed and only inform. These may refer to different resource types or mechanisms, but the text does not tell the reader that. An advisory claim, an exclusive lock and enforcement at the write boundary need separate names and examples. This review flags the conflict; it does not silently change the formal model. [E12, E10, E1]

## What was actually reviewed

The current assembled Book has **726 pages**, SHA-256 `5a01bc274bc1dd1a1d32e6e7607f39cbaf887b837810db323aa10d8ff9a6008b`. The audit covered the front matter, all eight chapter openings, the five-role reading map, the four course orders and the selected passages below. It is not a claim that 24 people independently read every page. The chapter plates were checked on the rendered contents pages; the full-book layout checks are separate from this reader simulation.

The four named skills guided this pass: `make_copy_and_media_human` for structural and semantic language review; `port-daddy-users` for the canonical profiles; `ux-friction-analyzer` for reading-task obstacles; and `product-appeal-analyzer` for identity, urgency and trust. Their requested catalog, persona and analysis references were read. Native subagent dispatch was attempted and refused by the isolation guard. These are one analyst's 24 simulations, not independent agent judgments or actual interviews. No Port Daddy runtime was started.

The follow-ups below deliberately test the initial interpretation: what would let the reader stop, what would they refuse to infer, and what evidence would change their decision? Responses are explicitly synthetic paraphrases, never participant quotations.

This is a fresh assessment, not a rescaling of the 17 September cohort reports. Those reports use differing rubrics and an older PDF. No improvement percentage is inferred from the edits made during this pass.

## Changes already made

- Made 67 logged prose edits across the front matter, chapter metadata and all eight chapter sources. Removed inflated claims, repeated announcements of rigor, opaque metaphor piles and unsupported anecdotal framing while retaining explicit assumptions and status qualifiers.
- Replaced the long front-matter chapter inventory with four question-led entry routes: coordination, crash recovery, permissions and trading. Each names a first example and a point at which the reader can stop or continue.
- Added each chapter's own plate to the single complete contents, linked to that chapter. Kept the existing part artwork and part/chapter opener pages. These are reused assets, not eight newly generated illustrations.

Those changes address part of the review. They do not resolve the claim/lock contradiction, make the role map match the new entry routes, validate a course or demonstrate a product feature.

## Reading-order assessment

| Existing route | What works | What still needs a change |
|---|---|---|
| Practitioner: skim 1–3, close reading of 4–5, then 6–8 | The oversight and continuity examples are relevant to recurring work. | It combines a solo developer, team lead, buyer and curious novice into one reader. Make the new question-led entry routes visible on the map and give each a stop. |
| Systems engineer: close reading of 1–4 and 6–8 | Dependency order supports a serious technical reading. | Mark which prerequisite is needed for a jump; distinguish one host from a team of hosts. |
| Security reviewer: close reading of 1–3 and 6–8 | It directs readers toward authority, confinement and transfer. | Put excluded adversaries and implementation gaps next to guarantees; add a claim/lock/write-boundary crosswalk. |
| Mechanism designer: emphasis on 6–8 | The three-sided worked settlement makes the accounting tangible. | Start with that calculation before asking a new reader to absorb the complete institutional vocabulary; make the dependency on Chapter 5 explicit. |
| Institutional theorist: emphasis on 5, with 4 and 6–8 | Continuity, consent and trade form a coherent conceptual route. | Separate normative argument, model consequence and observation in the adjacent prose; analogies cannot carry empirical claims. |

The four course orders remain useful proposals: 1–2–3–8 for distributed systems/security; 5–6–7 for economics; 1–4–7 for supervision/interfaces; and 1–2–7–8 for formal methods. They are not validated syllabi. Each needs a prerequisite note, a stated learning outcome and one checkable exercise at a stopping point. No student completion rate or teaching effectiveness was measured.

## Quantitative analysis, with its limits

Friction uses five 1–5 judgments: **O** overwhelm, **C** context switching, **P** invisible progress, **M** accumulated obstacles, **X** expert obstruction. Higher is worse. A 4 denotes a serious obstacle to that persona's reading task; 5 predicts a likely stop. It is not an observed abandonment probability.

Appeal uses nine 1–10 judgments. **I** = visual fit / language fit / implied audience; **U** = pain recognition / emotional resonance / solution clarity; **T** = execution quality / social proof / risk reduction. Higher is stronger support for that reader's next decision. Each vertex is the mean of its three cells; an individual's total sums the nine cells, out of 90. Social proof here concerns evidence for the particular inference the persona wants to make. Missing ROI or delivery proof is not evidence that a research result is false.

| Persona | O/C/P/M/X | I: three cells | U: three cells | T: three cells | Total /90 |
|---|---|---|---|---|---:|
| 01 Priya Desai | 4/3/4/4/1 | 6/4/3 | 8/7/4 | 6/4/4 | 46 |
| 02 Marcus Webb | 3/4/4/3/1 | 6/5/4 | 8/6/4 | 6/4/4 | 47 |
| 03 Yuki Tanaka | 2/4/2/3/2 | 8/7/8 | 7/5/7 | 6/5/5 | 58 |
| 04 Jordan Ellis | 3/4/4/3/1 | 8/7/8 | 9/8/7 | 6/4/4 | 61 |
| 05 Sam Okafor | 3/4/4/4/1 | 7/6/7 | 8/6/5 | 6/4/4 | 53 |
| 06 Devon Cole | 2/3/3/3/1 | 8/8/8 | 7/7/7 | 6/4/4 | 59 |
| 07 Rachel Kim | 2/4/3/4/2 | 8/7/8 | 9/5/7 | 5/5/4 | 58 |
| 08 Tomás Herrera | 3/4/4/4/2 | 8/6/7 | 9/6/6 | 6/4/4 | 56 |
| 09 Angela Brooks | 2/3/3/3/1 | 7/8/8 | 9/7/8 | 6/5/5 | 63 |
| 10 David Chen | 4/4/5/4/1 | 6/4/3 | 8/5/4 | 6/3/3 | 42 |
| 11 Fatima Al-Sayed | 4/4/4/4/1 | 6/4/4 | 9/5/4 | 6/4/3 | 45 |
| 12 Grace Liu | 2/3/3/2/1 | 8/7/8 | 6/5/7 | 7/5/5 | 58 |
| 13 Ben Sorensen | 3/4/4/3/1 | 7/5/5 | 7/5/5 | 6/4/4 | 48 |
| 14 Priyanka Rao | 5/4/4/4/1 | 6/3/2 | 5/4/3 | 6/4/4 | 37 |
| 15 Jake Malone | 4/3/3/3/3 | 7/4/4 | 4/5/5 | 6/4/5 | 44 |
| 16 Dr. Elena Vasquez | 3/3/2/3/3 | 7/6/6 | 5/5/7 | 7/5/6 | 54 |
| 17 Theo Marsh | 2/3/4/3/1 | 8/8/9 | 9/8/8 | 6/4/4 | 64 |
| 18 Nadia Petrov | 3/3/4/3/2 | 8/7/7 | 7/7/6 | 6/4/4 | 56 |
| 19 Chris Whitfield | 2/3/3/3/2 | 8/7/8 | 7/6/7 | 7/5/5 | 60 |
| 20 Morgan Reyes | 5/4/4/4/4 | 6/3/3 | 6/5/4 | 6/4/4 | 41 |
| 21 Aisha Bello | 3/3/4/3/2 | 7/5/5 | 7/6/5 | 6/4/4 | 49 |
| 22 Liam O'Connor | 2/3/3/2/2 | 8/7/8 | 5/6/7 | 7/5/6 | 59 |
| 23 Sophie Turner | 5/5/4/4/4 | 6/2/2 | 3/4/3 | 6/4/4 | 34 |
| 24 Victor Aldana | 2/4/4/4/2 | 7/5/6 | 6/3/6 | 4/4/3 | 44 |

The following means summarize the assigned ordinal scores within each six-profile group. The decimal is arithmetic, not measurement precision. Cohorts overlap in real life; they are not samples from four populations.

| Review group (profile IDs) | Mean I /10 | Mean U /10 | Mean T /10 | O/C/P/M/X counts at 4 or 5, out of 6 |
|---|---:|---:|---:|---|
| operators (1, 2, 4, 5, 6, 17) | 6.7 | 7.0 | 4.7 | 1/3/5/2/0 |
| reviewers (3, 7, 8, 9, 11, 24) | 6.8 | 6.6 | 4.7 | 1/5/3/4/0 |
| learners (15, 16, 20, 21, 22, 23) | 5.3 | 5.1 | 5.2 | 3/2/3/2/2 |
| evaluators (10, 12, 13, 14, 18, 19) | 6.1 | 5.8 | 4.9 | 2/3/4/2/0 |

Operators recognize the problem more readily than they can establish what to rely on. Reviewers are willing to read deeply, but they must reconcile scope and evidence. Learners need an example before the terminology; adding another abstract definition would not address that obstacle. Evaluators often want delivery, rollout or purchasing evidence that this research book should not pretend to supply.

Issue counts below mean “included in this analyst's profile assessment,” not independent votes, observed incidents or population prevalence. Tags overlap.

| Issue | Profiles tagged /24 | Profile IDs |
|---|---:|---|
| route | 15 | 1, 2, 4, 5, 8, 10, 14, 15, 16, 18, 19, 20, 21, 22, 23 |
| status | 11 | 3, 4, 6, 7, 9, 12, 13, 17, 18, 21, 24 |
| product fit | 10 | 1, 2, 5, 10, 11, 13, 14, 15, 21, 23 |
| evidence | 10 | 3, 6, 7, 9, 10, 11, 12, 13, 22, 24 |
| transfer | 9 | 2, 4, 5, 6, 8, 9, 17, 18, 19 |
| claim scope | 8 | 1, 3, 7, 8, 11, 16, 17, 24 |
| notation | 7 | 14, 15, 16, 19, 20, 22, 23 |
| accessibility | 1 | 20 |

There is no defensible combined Book score, confidence interval or before/after lift. The sample is fixed by the requested catalog, which heavily favors developer-tool and adjacent evaluators. Mechanism-design scholars, institutional theorists, assistive-technology readers and multilingual learners are not adequately represented.

## Persona walkthroughs and attentive follow-ups

Each route below is a guided checkpoint simulation, not proof that the reader would discover those pages unaided. A request for missing evidence is a legitimate endpoint.

### 01 · Priya Desai

Practitioner lane suggests a long detour for a reader who only wants her three local projects to stop colliding. Enter at the local-writer example and the resource boundary; skip the markets.

The port-conflict problem is immediately recognizable. The boundary between recording a reservation and controlling the process that actually listens is less easy to extract. Evidence: E0, E1, E12.

Main objections:

- A book must not become a prerequisite for ordinary use.
- An advisory file claim is not an exclusive port reservation.
- She cannot tell from the route where she has learned enough.

Follow-up: What would make this a useful five-minute read even if you never installed anything?

Synthetic response, paraphrased: She would leave once she could explain which collision is prevented, what remains outside the daemon, and where to find separate operational instructions.

Recommended change: Add a one-example local coordination route with an explicit exit to current documentation; do not direct her to the economics chapters.

### 02 · Marcus Webb

Start with the same-machine boundary, then one permission example. The systems-engineer lane is too broad for deciding whether four unrelated client repositories need changes.

The PID example makes inherited authority concrete, but it does not answer whether adopting conventions changes a client's existing setup. Evidence: E0, E1, E3.

Main objections:

- Examples assume a coherent work environment he does not own.
- He needs compatibility boundaries, not another repository convention.
- A copied terminal excerpt can be mistaken for a supported integration recipe.

Follow-up: What is the first detail you would check before bringing this near a client's repository?

Synthetic response, paraphrased: Whether the example requires changing the client's files, scripts, credentials, or process ownership; the Book does not establish that integration result.

Recommended change: State what the research example assumes about the host; link to a separate compatibility guide only when that guide and its claims are verified.

### 03 · Yuki Tanaka

Use the systems/security lanes, but jump directly from the local writer to attenuation and the file-claim model. Read the implementation boundary before treating an example as a guarantee.

Concrete definitions and a source path are persuasive. Conflicting uses of 'claim' would make him discount more polished claims elsewhere. Evidence: E1, E3, E10, E12.

Main objections:

- A test or model name is not revision-bound evidence.
- File claims switch between advisory and exclusive semantics.
- A model-to-runtime gap cannot be repaired by confident summary prose.

Follow-up: Which discrepancy would you investigate before any other?

Synthetic response, paraphrased: He would reconcile the taxonomy's impossible-double-claim statement with ClaimFile's always-successful behavior, then inspect the actual enforcement point.

Recommended change: Add a typed-resource crosswalk and a revision-bound evidence pointer beside each model-to-implementation claim.

### 04 · Jordan Ellis

Enter at Mara's afternoon, continue to consent and the implementation boundary, then stop. The practitioner lane should not require personhood or federation theory before that decision.

The falsely green report and constrained approval resemble demo-day problems. The reader still has to distinguish a proposed oversight mechanism from an available small-team workflow. Evidence: E0, E5, E6, E8.

Main objections:

- No dedicated operator can be assumed.
- Illustrated consent does not prove it exists in the current product.
- The reading route has no small-team stopping decision.

Follow-up: What would you take back to your team tomorrow?

Synthetic response, paraphrased: A rule for checking evidence before approving consequential work, not a promise that the proposed interface or enforcement path is already available.

Recommended change: Put implementation status beside the consent example and end the short route with a decision the team can make without adopting new software.

### 05 · Sam Okafor

Read local authority and the practitioner example. Consult federation only to understand what a collection of independent local installations does not provide.

The local coordination model could clarify team conventions. The reading map blurs sharing conventions across laptops with sharing authority across operators. Evidence: E0, E1, E11.

Main objections:

- Twelve independent laptops are not automatically a federated harbor.
- Nothing reviewed demonstrates cross-machine setup parity.
- A theory chapter does not supply rollout acceptance criteria.

Follow-up: What evidence would let three volunteers become a team-wide pilot?

Synthetic response, paraphrased: A documented environment matrix and a recovery record for a mismatch; those are external deployment evidence, not outcomes inferred from this Book.

Recommended change: Add a brief local-installations versus cross-operator-authority distinction. Keep pilot procedures outside the research argument.

### 06 · Devon Cole

Read Mara, compare the two summary rows, then check the status boundary before using the material in a team presentation.

The summary-to-artifact comparison is an effective explanation. Its vividness risks being mistaken for a demonstration of shipped behavior. Evidence: E5, E7, E8.

Main objections:

- He needs a presentable case with one clear result.
- A designed screen is not a recording of a working system.
- The same explanation must survive Sam's implementation questions.

Follow-up: What would make you comfortable showing this to Sam?

Synthetic response, paraphrased: A clearly labeled illustrated case, an explicit list of proposed parts, and a link to the evidence for anything described as running.

Recommended change: Package one explanatory spread as a concept demonstration, with no live-demo claim until an actual recording and reset procedure exist.

### 07 · Rachel Kim

Follow the security lane through the local enforcement boundary, attenuation and release-channel assumptions, then federated revocation. Skip operator psychology on the first pass.

Explicit hostile-operator and partition exclusions are valuable. Terminology drift around claims weakens confidence that the threat models stay separate. Evidence: E1, E3, E4, E11, E12.

Main objections:

- A shared database does not establish compulsory file mediation.
- Confinement depends on the named channel assumptions.
- Expected gossip time is not a hard deadline during partition.

Follow-up: Which sentence would you refuse to approve without a narrower scope?

Synthetic response, paraphrased: Any statement that implies an advisory claim prevents an actual conflicting edit, or that cross-operator revocation has a finite deadline without network assumptions.

Recommended change: Put each guarantee, excluded adversary and evidence class together; resolve the claim/lock vocabulary before broad visual polishing.

### 08 · Tomás Herrera

Start at local authority and consent, then read identity and federation boundaries. The map's systems-engineer row gives no team-scale governance stopping point.

He can see a useful decomposition of authority. The Book is less direct about how that decomposition constrains forty teams with different owners. Evidence: E0, E1, E6, E8, E11.

Main objections:

- A relay is not a shared policy authority.
- Different teams cannot be treated as one trusted operator.
- An architectural principle is not a rollout ownership model.

Follow-up: What is the smallest decision this reading should let you make?

Synthetic response, paraphrased: Identify which organization owns each enforcement point and where evidence crosses an authority boundary, without claiming a deployment design has been validated.

Recommended change: Add an ownership-boundary example with two teams and one refused request; keep operational scaling claims conditional.

### 09 · Angela Brooks

Take the crash route first, then recovery and revocation under delay. Stop when she can name the failure classes and unresolved recovery obligations.

The NORMAL/FULL table gives a useful comparison; the partition qualification prevents a misleading availability promise. Evidence: E2, E11.

Main objections:

- Durability, integrity and successful recovery are different outcomes.
- A negative control in a model is not a tested operational runbook.
- Actual recovery timing and observability remain unmeasured here.

Follow-up: What would you want next to the crash table?

Synthetic response, paraphrased: A small before/crash/restart record naming what persisted, what was checked, what refused service, and what remains unknown.

Recommended change: Attach a reproducible failure trace to one recovery case, with the tested runtime/version and explicit limits.

### 10 · David Chen

Use the coordination scenario for the problem and the settlement example for the institutional proposal. Leave before treating either as an investment case.

The failure costs are plausible and understandable. No inspected passage establishes measured return, adoption cost, support exposure or vendor continuity. Evidence: E0, E5, E9.

Main objections:

- A mathematically balanced settlement is not an ROI study.
- He needs operating cost and support/exit information.
- The reading lane does not distinguish strategic explanation from buying evidence.

Follow-up: What can this book responsibly change in a budget conversation?

Synthetic response, paraphrased: It can improve the questions for a measured pilot; it cannot establish a payback period from synthetic examples.

Recommended change: Give decision-makers a short concept-and-limit route and a separate list of evidence a pilot would have to collect.

### 11 · Fatima Al-Sayed

Read release-channel assumptions, consent and identity scope. Stop at an incomplete-evidence determination rather than attempting the full security lane.

Explicit consent and evidence boundaries are useful concepts, but they do not supply a current data inventory or control record. Evidence: E4, E6, E8.

Main objections:

- Theoretical confinement is not a completed security intake.
- Local identity cannot stand in for cross-organization identity binding.
- Who retains, accesses and deletes data must be shown for the actual system.

Follow-up: What would keep you from rejecting this as irrelevant while still withholding approval?

Synthetic response, paraphrased: A clear statement of the threat model and a list of the current artifacts still required for intake, with no compliance claim attached to the theory.

Recommended change: Label the Book as explanatory research and point to a separately maintained operational evidence packet when one exists.

### 12 · Grace Liu

Use the local writer, a crash counterexample and the attenuation verification boundary as a technical interview route, not the complete systems lane.

Concrete tradeoffs offer stronger interview material than self-assessed novelty. Authorship and delivery attribution still need independent verification. Evidence: E1, E2, E3.

Main objections:

- A polished manuscript does not prove authorship of every implementation.
- Formal and runtime work must be distinguished.
- She wants choices and tradeoffs, not repeated claims of rigor.

Follow-up: What would you ask the author to explain without the manuscript?

Synthetic response, paraphrased: Why one writer helps, which crash claim it does not establish, and where the verified model stops matching runtime behavior.

Recommended change: Add a compact artifact-and-authorship index for the reviewed mechanisms; preserve the counterexamples and unresolved obligations.

### 13 · Ben Sorensen

Read one architecture problem, one explicit implementation boundary and the conclusion. The Book is supporting material for a delivery discussion, not delivery proof.

The clear limits help establish judgment. Repeated architectural ambition makes it harder to find a completed, attributed outcome. Evidence: E0, E1, E8.

Main objections:

- Research scope is not a completed client engagement.
- He needs the boundary of the author's contribution.
- The Book cannot replace a dated delivery case.

Follow-up: What would make this useful before a contract discussion?

Synthetic response, paraphrased: A short, separately evidenced case that identifies the starting problem, the author's contribution, the delivered result and the parts still open.

Recommended change: Provide a genuine delivery case outside the Book; do not manufacture a success anecdote to improve appeal.

### 14 · Priyanka Rao

Read the title, plain-language claim and one illustrated chapter entry. The five technical role lanes do not provide a recruiting-summary route.

The chapter plates make the publication easier to recognize, but vocabulary about institutions and enforcement can obscure the author's concrete technical area. Evidence: E0, E13.

Main objections:

- Two minutes is not enough to learn the Book's ontology.
- A memorable description must not overstate delivered work.
- She needs a one-sentence account she can repeat accurately.

Follow-up: What sentence could you forward without translating the terminology?

Synthetic response, paraphrased: The book studies how multiple software agents share resources, record their work and remain accountable, while separating working mechanisms from research proposals.

Recommended change: Keep that plain-language description near the opening and link to one representative chapter; let her stop there.

### 15 · Jake Malone

Enter at Mara's afternoon and the two summaries. None of the five named roles obviously fits a curious friend with no reason to study the complete machinery.

The deleted test and falsely green report can be retold without mathematical training. The Hobbes/Scott vocabulary introduces an avoidable second translation task. Evidence: E0, E5, E7.

Main objections:

- He needs an ordinary reason to care before the abstractions.
- Unexplained nouns can make confusion feel like a personal failure.
- He should not have to pretend to be a systems engineer.

Follow-up: What part would you retell to someone else?

Synthetic response, paraphrased: A reassuring summary can conceal a bad change; the useful summary lets someone inspect what actually happened.

Recommended change: Offer a clearly optional story-first route with a stop after that distinction; avoid an extra glossary detour.

### 16 · Dr. Elena Vasquez

Use the security route selectively: one authority example, the confined-release model and its assumptions. Do not presume familiarity with coding-tool acronyms.

Named assumptions and a worked bit-budget example provide an intellectually serious entry. The terminology makes disciplinary transfer harder than the mathematics itself. Evidence: E0, E3, E4.

Main objections:

- Which results are mathematical and which are empirical must remain visible.
- A metaphor is not evidence for a behavioral generalization.
- The finite model's excluded channels need plain-language explanation.

Follow-up: Where would an example help more than another definition?

Synthetic response, paraphrased: Immediately before the formal release model: show what can leave, what cannot, and one excluded channel that defeats the guarantee.

Recommended change: Keep the proof route intact and add a prerequisite/notation bridge for technically sophisticated readers outside software security.

### 17 · Theo Marsh

Start with Mara, consent and evidence-backed summaries, then inspect lifecycle semantics. He should not need the institutional-theory lane to judge the oversight idea.

The problem matches daily multi-agent work. The clearest missing distinction is what the interface proposes versus what an enforcement path actually rejects. Evidence: E5, E6, E7, E10.

Main objections:

- A useful oversight concept does not prove increased agent capacity.
- Advisory coordination must not masquerade as mandatory exclusion.
- He needs a task-level result with human review cost included.

Follow-up: What would make the next example convincing rather than merely familiar?

Synthetic response, paraphrased: The same task under stated conditions, including failed attempts, review effort and what the system refused; synthetic quantities must remain labeled.

Recommended change: Design a bounded comparison protocol for later measurement; do not add an unsupported productivity percentage.

### 18 · Nadia Petrov

Select the summary comparison as a visual explanation and check the status boundary. The illustrated contents help locate material but are not themselves a demo sequence.

The contrast between an assertion and inspectable evidence is visually teachable. Long captions and undefined side notes dilute a short explanation. Evidence: E5, E7, E13.

Main objections:

- One screen should make one change in understanding.
- She needs to know which visual is hypothetical.
- A live-demo promise requires reproducible behavior, not nicer artwork.

Follow-up: Which ninety-second story is worth making?

Synthetic response, paraphrased: One green report, the underlying bad diff, and the evidence view that exposes the difference, explicitly labeled as an illustrated case unless recorded from a working system.

Recommended change: Create a short explainer from a verified case; pair any eventual live recording with provenance and a reset procedure.

### 19 · Chris Whitfield

Use a crash example, attenuation and one settlement as separate lessons. The four proposed course orders need prerequisites and assessable endpoints, not just chapter sequences.

The small counterexamples and arithmetic can teach transferable patterns. Branded terminology can obscure what transfers beyond this project. Evidence: E0, E2, E3, E9.

Main objections:

- A chapter list is not a teaching plan.
- Learners need to know the prerequisite for each jump.
- One lesson should end in an answer they can check.

Follow-up: What would make one of these examples teachable next week?

Synthetic response, paraphrased: A short prerequisite statement, one worked case, one altered assumption and an answer or counterexample, without requiring the full Book.

Recommended change: Add a lesson-sized route for one existing check/trace exercise; do not claim the courses have been classroom-tested.

### 20 · Morgan Reyes

Read one collision or Mara's example first. The practitioner lane presupposes enough vocabulary that a new developer may not recognize it as the beginner route.

Named people and concrete events help. WAL, capability attenuation and identity vocabulary accumulate before the reader has a stable mental picture. Evidence: E0, E1, E3, E5.

Main objections:

- The first useful result is too far from the unfamiliar terms.
- She needs an explanation of why a losing request is refused.
- A long proof should be optional on the first encounter.

Follow-up: At what point would you know you had understood the example?

Synthetic response, paraphrased: When she can predict which request succeeds, what evidence records the result, and one action the system cannot prevent.

Recommended change: Add a no-install trace with three visible steps and a checkable answer before the formal vocabulary.

### 21 · Aisha Bello

Take the coordination entry route and the identity boundary. Neither mechanism designer nor institutional theorist precisely names her stakeholder-briefing task.

The consent example supports a useful discussion of who approves consequential work. It is easy to miss that design intent and available capability are different. Evidence: E0, E5, E6, E8.

Main objections:

- She needs consequences and ownership, not command syntax.
- A future mechanism must not enter a roadmap as a present feature.
- A brief needs a stopping conclusion.

Follow-up: What should a stakeholder understand after your summary?

Synthetic response, paraphrased: Who may authorize the action, what evidence they can inspect, and which enforcement or identity assumptions remain unresolved.

Recommended change: Provide a short stakeholder route ending with those three questions and a current-status pointer.

### 22 · Liam O'Connor

Read the fault-class example, then a check/trace exercise; use the settlement arithmetic or formal model as an optional second lesson.

Worked arithmetic and a counterexample offer a concrete learning payoff. A dense route map can conceal that a small exercise is enough for a first sitting. Evidence: E0, E2, E9, E10.

Main objections:

- He needs prerequisite hints before changing disciplines.
- Model syntax can arrive before an English state picture.
- A solution link should support checking, not replace the attempt.

Follow-up: What would make you come back for a second sitting?

Synthetic response, paraphrased: Successfully predict one failure or settle one small transaction, then see which changed assumption produces a different answer.

Recommended change: Promote one existing check/trace/solution loop as an optional first exercise and give a clear resume point.

### 23 · Sophie Turner

Read the opening plain-language claim and one worked incident. The five professional reading lanes offer no honest nontechnical exit.

The book can explain why evidence matters, but most of its technical depth is unrelated to her immediate reason for opening it. Evidence: E0, E5, E13.

Main objections:

- She cannot distinguish harmless jargon from a prerequisite.
- A full reading assignment would be inappropriate.
- A polished artifact alone does not establish the author's practical claims.

Follow-up: What would count as enough, without turning you into a specialist?

Synthetic response, paraphrased: Be able to ask what changed, what checked it and who is responsible, then leave with a more informed question for a developer.

Recommended change: Provide a one-scene general-interest route. Treat her decision not to continue as a valid outcome.

### 24 · Victor Aldana

Challenge the attractive routes after the other profiles: compare the file-claim statements, inspect the local/cross-operator split and remove the revocation network assumption.

Explicit negative controls and unresolved boundaries are the strongest material. Rhetorical certainty or a clean diagram cannot compensate for mismatched scopes. Evidence: E0, E8, E10, E11, E12.

Main objections:

- Terminology contradicts the later model.
- Named scripts do not establish current successful execution.
- A compelling scenario is not evidence that its mechanism is deployed.

Follow-up: What would change your view without asking you to trust the author?

Synthetic response, paraphrased: A reconciled scope statement, a reproducible revision-bound witness and a deliberately failing case when a required assumption is removed.

Recommended change: Resolve contradictions before claiming broad usability gains; keep the failure case adjacent to the positive result.

## What to do next, in order

1. **Resolve the claim/lock ambiguity.** Trace the Chapter 4 taxonomy to the Chapter 7 model and the actual resource-specific enforcement paths. Define advisory file claims, exclusive reservations/locks and write mediation separately. Acceptance: a reader can predict which second request is merely reported, refused, or prevented from taking effect. The formal model must not be edited merely to agree with a slogan.
2. **Join attractive examples to their status.** Put the applicable threat model, current implementation boundary and revision-bound evidence pointer beside the consent, release and transfer examples. Acceptance: no reader needs a later appendix to learn that the central mechanism in a vivid scene is proposed or only modeled.
3. **Unify the route map with the new short entries.** Preserve the deeper professional routes, but add the same four questions and explicit stopping decisions used in the front matter. Acceptance: a new reader can find an example and a resume point without translating a professional identity label.
4. **Use one altered-assumption case per route.** Reuse the crash, attenuation, misleading-summary and settlement examples. Change one condition and ask for the predicted outcome, with an answer available separately. Acceptance: the negative case exposes a genuine limit rather than making the example easier to “pass.”
5. **Move the remaining institutional and philosophical analogies behind the concrete case.** Keep those arguments where they add explanatory value; remove unsupported moves from a sandbox observation to a universal claim. Acceptance: deleting the metaphor does not delete the statement of the mechanism or its evidence.
6. **Keep external evaluation evidence separate.** Real installation, compatibility, support, compliance, ROI, authorship and delivery records need their own maintained artifacts. Acceptance: the Book can identify what is missing without fabricating a case study or pretending a theorem supplies it.

A new illustration is justified when it makes one of these distinctions inspectable: an advisory announcement versus a refused exclusive lock; two equally short summaries with different evidence; a trace of what remains after three fault classes; a settlement with collateral returned separately from income. Do not add boxes merely to break up prose. All captions remain in the margin and the actual page must be checked, not just the figure in isolation.

## Language-review record and remaining work

The [67-edit record](book-human-language-2026-09-18.json) retains before/after text and reasons. The humanizing skill's structural scan was run before and after; both produced one “four one-line paragraphs” warning in the federation source. Manual inspection found TeX structural lines (an input, an exercise pointer and a subsection boundary), not a run of prose fragments. It is retained as a documented false positive, not “fixed” by damaging the TeX.

A low structural finding count is not a clean bill of health. Raw TeX hides prose from simple density heuristics, and the semantic review was targeted. The rest of the Book still needs a section-by-section line edit. In particular, some long analogies, internal references to chapters as papers, repeated “honest”/“whole story” assertions, and headings about the writing process remain. The selected substantive contradiction also remains unresolved. No claim of “all AIisms removed” is warranted, and stylistic patterns do not establish authorship by a model.

Useful additions to the skill's catalog from this manuscript:

- **Qualification theater:** praising a claim as honest or rigorous instead of stating its scope once. Preserve the scope and cut the praise.
- **Metaphor accumulation:** stacking harbor, floor, keystone, rent and legal-person metaphors before naming the operation. Use the operation first; keep a metaphor only if it explains a relationship.
- **Route without an exit:** providing an elaborate reading map that never tells a reader when they have enough to answer their question. Name a stopping decision and a return point.
- **Unsupported empirical framing:** describing a worked scene as real, typical or universal without identifying observations. Mark it as an illustrative case or provide evidence.

The findings file also records ordinary consistency corrections. It is an editorial change log, not a claim that every corrected sentence is uniquely characteristic of AI writing. This report was reviewed for invented participant speech, unearned certainty, repeated sales framing and unsupported claims of effectiveness.

## Checks and limits

- Whole Book rebuilt, not separate chapter editions.
- Eight contents chapter images match their source plates and point to their own chapter opener. All eight rendered chapter-entry pages were visually inspected. The complete contents remains a single 15-page sequence.
- Seven focused generator/contents tests passed, including missing source/citation rejection, cyclic import rejection and namespacing. Shared manifest outputs match.
- All 886 registered margin objects were placed once, with zero reported bounds/collision failures. All 230 captions passed the outer-margin placement check. Full-page checking reported zero off-page loss and zero footer intrusions.
- The page check still lists 25 wide-content advisories; the whitespace review queue contains 80 pages. These counts are not design failures by themselves and are not visual acceptance of every page. Prior full-book layout work and the figures the user rejected are not declared finished by these tests.
- No real timing, task-completion rate, NASA-TLX, five-second comprehension test, retention, ROI or adoption experiment occurred. UI autosave, latency and touch-target gates are not applicable to this static PDF. Accessibility/tagging and sustained mathematical comprehension need separate testing.
- The humanizer's referenced `layout-overflow-guard` skill was unavailable at its recorded path. Its HTML report was instead checked directly at 1440, 768 and 320 pixels: no horizontal overflow or clipped finding cells, and a 14-pixel minimum for the checked text roles. Desktop/mobile screenshots were inspected. The only browser console error was an absent favicon; the temporary loopback preview was stopped. These checks concern the review report, not responsive behavior of the Book PDF.

For a real reading study, invite representative readers with consent; assign the same bounded questions without hints; record navigation, mistaken inferences and stopping decisions; ask what evidence changed their answer; then compare revised pages on those same tasks. Do not present the simulations above as that study.

## Source checkpoints

- **E0: Entry routes and evidence/status vocabulary.** [Source](/Users/erichowens/coding/tmp/book-figures-reconciled/website-v2/public/whitepaper/coordination-papers-mega-volume.tex:142). Front matter, how-to-use text, five-lane reading map and four course orders.
- **E1: Local writer, authority and deployment boundary.** [Source](/Users/erichowens/coding/tmp/book-figures-reconciled/whitepaper/single-writer-kernel.tex:245). Opening stack, reference-monitor discussion, maturity distinctions and conclusion.
- **E2: Durability by fault class.** [Source](/Users/erichowens/coding/tmp/book-figures-reconciled/whitepaper/single-writer-kernel.tex:564). NORMAL/FULL table, process crash versus OS/power loss, recovery example.
- **E3: Delegated permission and its limits.** [Source](/Users/erichowens/coding/tmp/book-figures-reconciled/website-v2/public/whitepaper/anchor-protocol-whitepaper.tex:184). PID example, phase overview, attenuation and qualified verification conclusion.
- **E4: Confined release and channel assumptions.** [Source](/Users/erichowens/coding/tmp/book-figures-reconciled/website-v2/public/whitepaper/sealed-harbor.tex:164). Opening work order, Derek/Erin gates, zero/one/two-bit release example and empirical taint assumption.
- **E5: Mara's six-agent afternoon.** [Source](/Users/erichowens/coding/tmp/book-figures-reconciled/whitepaper/legible-swarm.tex:351). Worked failure scenario; not evidence of a deployed interface.
- **E6: Scoped, expiring consent.** [Source](/Users/erichowens/coding/tmp/book-figures-reconciled/whitepaper/legible-swarm.tex:505). Grant tuple, stakes/reversibility conditions, example and revocation.
- **E7: Summary and inspectable evidence.** [Source](/Users/erichowens/coding/tmp/book-figures-reconciled/whitepaper/legible-swarm.tex:613). Scott analogy and two summary rows with equal compression but different artifact access.
- **E8: Local identity versus cross-operator attestation.** [Source](/Users/erichowens/coding/tmp/book-figures-reconciled/website-v2/public/whitepaper/spawn-to-person.tex:1712). Two definitions, partial local implementation and unresolved cross-operator binding.
- **E9: A complete three-sided settlement.** [Source](/Users/erichowens/coding/tmp/book-figures-reconciled/website-v2/public/whitepaper/harbor-economy.tex:983). Bob, Alice, Dana and Carol; 460 escrow, 100 bond, conditional transfers and refunds.
- **E10: Advisory ClaimFile in the formal model.** [Source](/Users/erichowens/coding/tmp/book-figures-reconciled/website-v2/public/whitepaper/agent-transactions-whitepaper.tex:1285). English action overview and TLA+ state/actions.
- **E11: Federated revocation under delay/partition.** [Source](/Users/erichowens/coding/tmp/book-figures-reconciled/website-v2/public/whitepaper/federated-harbor-whitepaper.tex:470). Reliable-round expectation, partition boundary, attack window and rollback negative control.
- **E12: Taxonomy's conflicting file-claim description.** [Source](/Users/erichowens/coding/tmp/book-figures-reconciled/whitepaper/legible-swarm.tex:290). Advisory file/region announcement described as preventing double claims by uniqueness.
- **E13: Complete illustrated contents.** [Source](/Users/erichowens/coding/tmp/book-figures-reconciled/website-v2/public/whitepaper/coordination-papers-mega-volume-preamble.tex:824). Actual full-book contents pages with all eight chapter plates and part plates.
