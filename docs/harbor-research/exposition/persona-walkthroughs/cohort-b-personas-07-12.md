# Cohort B: personas 07–12 — assembled Book walkthrough

SIMULATED research, prepared 2026-09-17. These are synthetic reading journeys grounded in the canonical persona profiles, not interviews, observed abandonment, usability measurements, or approval to adopt the product.

## Scope, evidence, and scoring

The reviewed artifact is a local proof build of *The Harbor, the Person, and the Economy*, version 4.0, September 2026, 661 PDF pages, 7 × 10 inches. PDF creation metadata: 2026-09-17 02:12:42 PDT. SHA-256: `1d9d273470018b45f5e125a87bdf6de1fa706abaaec3b4239ae9bad6da1454e2`. Worktree HEAD at inspection: `33fa6ddde026b909eefb5d1d3d2adbe5c4befb41`; this dirty worktree's PDF is identified by its own hash, not assumed to reproduce that commit.

Page citations below use **printed Book pagination**. Front matter iv–ix means PDF pages 4–9. For Arabic pages, add 18: p. 60 is PDF page 78; p. 474 is PDF page 492; p. 596 is PDF page 614. Even appendix leaves whose running header suppresses the numeral retain this sequence. No standalone chapter PDFs were inspected.

Method: read the assigned four skills completely and the full canonical profiles for Rachel Kim, Tomás Herrera, Angela Brooks, David Chen, Fatima Al-Sayed, and Grace Liu. Follow the Book's reader-map emphasis through selected chapter landmarks, inspect the associated text directly from the assembled PDF, and compare claims across chapters and appendices. This is a sampled walkthrough, not a claim to have read every page or checked the implementation. Source passages are described under **Book evidence**; predicted behavior and scores are **SIMULATED interpretation**; proposed edits are **Recommendations**. Absence claims mean “not answered at the inspected landmarks,” not “absent from the repository.”

The skills shape the review as follows: `harbor-book-rewriter` supplies concrete-scene, express-lane, claim/boundary, and printed-page criteria; `port-daddy-users` fixes the six reader profiles; `ux-friction-analyzer` supplies cognitive-load, context-recovery, and expert-navigation questions; `product-appeal-analyzer` separates identity fit, problem urgency, and trust. Its usual ten-point rubric is adapted to the user's requested five-point scale. No deterministic script can turn these judgments into observed user evidence.

**Friction:** 1 = independent, clear route; 2 = minor rereading; 3 = repeated cross-reference or interpretation work; 4 = substantial interruption requiring another artifact or expert; 5 = the reader cannot complete the intended evaluation from this route. **Appeal:** 1 = no reason to continue; 2 = weak/conditional interest; 3 = useful selective reference; 4 = strong desire to continue or share; 5 = unusually compelling for the reader's purpose. High friction is bad; high appeal is good. Overall appeal is an editorial judgment, not an arithmetic average. Identity/urgency/trust are separately scored 1–5, with 5 strongest. Trust means confidence for this reader's task, not certification of the system.

The “five-second” judgments are simulated first-glance assessments of pp. i–ii and the reader map, not timed tests. Real-user completion times, error rates, NASA-TLX, accessibility compliance, and conversion remain unmeasured. The friction skill's interactive-web gates do not establish anything about this existing PDF; this report does not ship a revised rendered surface.

### Tracks and coverage

The canonical persona file specifies goals and tolerance, not individual Book itineraries. Figure 1 on pp. vi–vii provides five Book tracks. The persona-to-track mapping below is an explicit analyst choice. “Closely/read/skim” follows the figure's heavy/medium/dashed lines; listed page stops are the inspected samples within that emphasis. A predicted early stop is followed by a clearly conditional continuation where useful, not silently treated as a completed journey.

| Persona | Adopted Book track | Emphasis and purpose |
|---|---|---|
| 07 Rachel | Security Reviewer | Closely I and IV; skim II and III. Determine the enforceable boundary and what evidence supports it. |
| 08 Tomás | Systems Engineer | Closely I, II, IV; read III. Determine whether local mechanisms compose into governable tooling for 40 teams. |
| 09 Angela | Systems Engineer, with security checkpoints | Closely I, II, IV; read III. Follow failure, evidence, recovery, and cross-machine boundaries. |
| 10 David | Practitioner, adapted for a decision-maker | Skim I; closely II and III; read IV. Translate attention, continuity, and exchange into an investment question. There is no executive track. |
| 11 Fatima | Security Reviewer, adapted for intake | Closely I and IV; skim II and III. Seek documented data handling and reviewable controls. There is no procurement track. |
| 12 Grace | Systems Engineer, with evidence appendices | Closely I, II, IV; read III. Assess architecture, tradeoffs, corrections, and the route from claims to artifacts. |

Rendered pages visually inspected: vi–vii; 16, 62, 100, 164, 189, 475, 598 at enlarged page resolution; 143, 354, 382, 474 also at 504 × 720 pixels/72 dpi to check the native page field. Additional cited pages were inspected as extracted PDF text. Renders were streamed for inspection; no additional repository artifacts were written. These checks are sampled visual evidence, not an operator's final visual acceptance or a whole-volume layout pass.

### Cohort scorecard — SIMULATED

| Persona | Friction /5 | Appeal /5 | Identity /5 | Urgency /5 | Trust /5 | Main evidence |
|---|---:|---:|---:|---:|---:|---|
| Rachel | 4 | 4 | 5 | 5 | 3 | Threat boundary pp. 59–65; assurance pp. 99–110; conflicting example p. 474 versus p. 596. |
| Tomás | 4 | 4 | 5 | 5 | 3 | Digest pp. 188–191; scaling pp. 213–215; local/federated split pp. 480, 483, 597. |
| Angela | 4 | 3 | 4 | 5 | 2 | Fault classes pp. 15–16; recovery pp. 281–283, 426–427, 475–476; restart boundary p. 463. |
| David | 5 | 2 | 2 | 4 | 2 | Attention objective pp. 204–205; cost attribution p. 234; illustrative money pp. 356, 377; stuck escrow pp. 381–382. |
| Fatima | 5 | 2 | 2 | 5 | 2 | Work order pp. 139–143; limits p. 164; current-status denial pp. 596–597. |
| Grace | 3 | 5 | 5 | 4 | 3 | Buildable defect pp. 57–58; withdrawn claim p. 106; model limits p. 110; evidence table p. 598. |

## 07. Rachel Kim — security review before adoption

**Profile and purpose.** Staff engineer in a 500+ engineer organization; deeply technical and willing to read for hours if the answers are precise. A team has asked her to assess agent coordination before approval. Her canonical dealbreaker is a central security promise the code does not support. Her likely current route is a security review assembled from architecture, source, and tests; this workaround is an inference, not an additional canonical biography.

### Reading path and stopping points

1. **Orient:** pp. iv–v, vi–vii. The up-front built/modelled/proposed distinction earns attention. First-glance interpretation: recognizable systems textbook and relevant subject, but no immediate security-review deliverable; the track map supplies a route later.
2. **Part I, closely:** pp. 6, 9, 59–67. Pause at Table 1.14 on p. 59; the same-user adversary is excluded and software authentication is distinguished from kernel peer credentials. At pp. 60–61 she stops the *adoption recommendation* for an adversarial-agent use case. The text explicitly leaves the compulsory boundary unbuilt. This is a legitimate negative answer, not merely difficult prose.
3. **Continue as architecture research:** pp. 84–86, 99–101, 106–110, 128; then pp. 136–143, 164. The PID-reuse example gives the protocol a concrete reason to exist. Table 2.2 and Figure 2.9 connect model, source, and binary without hiding the gaps. Stop to reconcile the sealed-room invariant's implementation language on p. 143 with Appendix A.
4. **Parts II–III, skim:** pp. 188–191 and 302–303. Retain the requirement for independently checkable artifacts and the distinction between a signed foreign history and a binding to its principal; skip extended philosophical exposition.
5. **Part IV, closely at security landmarks:** pp. 365–366, 463–464, 474–477, 488–490, 537. Hard trust interruption at p. 474's claim of physical write prevention. Finish with pp. 595–598 and 613–614 as an evidence reconciliation task, not an approval.

### Scores and evidence

**Friction 4/5.** Book evidence: pp. 60–61 say a same-user agent can bypass in-band guards; p. 474's worked example says the agent physically cannot write `database.ts` and gets an error before filesystem access. Appendix A, p. 596, says Confined mode is not available to any caller. These may describe different intended regimes, but the example does not carry that qualification locally. Rachel must supply the missing distinction herself. P. 143's “backed by the implementation and its tests” also needs an explicit model-versus-running-system qualifier beside the claim. She can understand the theory; she cannot approve the operational assertion from these pages.

**Appeal 4/5; identity 5, urgency 5, trust 3.** The concrete authorization problem on p. 84, the specification/deployment gaps on pp. 99–100, and the bounded Kani account on pp. 106–110 suit her unusually well. Trust is reduced by the later examples, not by the presence of candid limits. Figure 1.22 on p. 62 makes today's bypass visible; its DESIGNED/VISION vocabulary creates a small extra translation against p. 9's SPECIFIED/proposed vocabulary.

### Confusion, stuckness, and demotivation — SIMULATED interpretation

- **Confusion:** does “Design invariant” identify a desired property, a tested model, or a shipping enforcement path? Pp. 143 and 596 give her different immediate impressions.
- **Stuck:** she cannot trace the p. 474 filesystem refusal to an available assurance mode. This is the top objection; the remedy is a locally labeled conditional example plus a claim-to-artifact pointer, not a stronger adjective.
- **Demotivation:** the best caveats require memory across hundreds of pages. P. 164's overlapping Figure 3.14 and Table 3.5 captions visibly impair the page intended to clarify limits.

### Missing scene and desired apparatus — Recommendations

Carry the four agents from p. 84 through one synthetic attempt to upload a repository secret using an ambient credential. Show the attempted effect, the current cooperative path, the bypass that remains possible, and the proposed compulsory gate as separately labeled cases. This would connect the Book's existing scene to Rachel's actual approval question without inventing a successful containment demonstration.

Add a two-column “current mediated path / specified confinement path” sequence beside pp. 60–62, with actors, exact effect, refusal point, and remaining access. Put a one-line assurance-mode/status note beside the p. 474 example and link back to Appendix A. Preserve Figure 2.9's two gaps; add a sample evidence receipt naming build identity, scope, and test result, explicitly labeled SYNTHETIC. Separate the colliding captions on p. 164.

**Interview response — SIMULATED:** “The threat table is where I started trusting the author. It tells me which attacker this actually handles. Then the worked example says the filesystem write is physically impossible, and I have to go back to check what changed. If that's a future configuration, put that on the example. I can recommend further evaluation; I can't turn this into approval.”

**Cohort disagreement.** Grace may see the same admission of incompleteness as evidence of good judgment. Rachel agrees about the judgment but still withholds deployment approval. Tomás wants a compact rollout answer; Rachel needs the longer assurance chain retained as an accessible second layer.

## 08. Tomás Herrera — central governance across 40 teams

**Profile and purpose.** Platform lead standardizing inconsistent agent practices across roughly 40 teams. He wants observable, centrally governable tooling, with little tolerance for 40 independent setup negotiations. His likely workaround is team-specific conventions plus a central review/reporting layer; that is an analyst inference. His desired payoff is an introspection interface he can build upon.

### Reading path and stopping points

1. **Orient:** pp. iv–v, vi–vii. Systems Engineer is an obvious fit. Simulated first glance: subject and audience are clear by the subtitle/map, but “what would a team roll out first?” is not.
2. **Part I, closely:** pp. 6, 11, 14–16, 57–67; pp. 84–85, 99–100, 128; pp. 139–143, 164. Pause on p. 14: the six-step authority transfer is concrete, but explicitly a writer design invariant whose writer case is not yet checked. Do not promote it into a rollout procedure.
3. **Part II, closely:** pp. 187–191, 204–205, 213–216, 234–235. This is his strongest entry. Stop appreciatively at Figure 4.3, p. 189, then ask what one dashboard can actually retrieve across team boundaries.
4. **Part III, read selectively:** pp. 266–267, 271, 281–283, 302–303. Retain role versus durable identity, notes versus execution state, and the foreign-principal gap. Do not require the personal-identity discussion beginning p. 273 before this operational summary.
5. **Part IV, closely at composition seams:** pp. 353–357, 365–366, 402–403, 474–477, 480–483, 519–521, 537. Stop at pp. 480/483 to separate 40 teams under company policy from independent sovereign organizations. Finish pp. 596–597; defer rollout judgment pending an explicit management contract.

### Scores and evidence

**Friction 4/5.** The Book offers useful component contracts, but the sampled path never assembles policy ownership, enrollment, policy changes, exceptions, observability access, and rollback into his central-management task. P. 14's transfer is not dual writing; p. 483's federation authorizes no work through the witness rail; p. 597 says Relay neither orders nor authorizes local effects. He must work out which authority model a company with 40 teams should adopt. “Federated” alone does not answer “centrally managed.”

**Appeal 4/5; identity 5, urgency 5, trust 3.** Pp. 188–191 turn a reassuring green summary into three inspectable artifacts; this directly fits his platform dashboard goal. Pp. 213–215 make scaling the reading workload recognizable. However, the lower-bound plot on p. 215 is about bits under assumptions, not measured review time or the demonstrated capacity of a 40-team deployment. Trust requires keeping that distinction at the point where the figure might be reused in a rollout pitch.

### Confusion, stuckness, and demotivation — SIMULATED interpretation

- **Confusion:** which policies can the organization require centrally if each harbor is locally sovereign? Pp. 480–483 distinguish the mechanisms but do not answer this organizational question.
- **Stuck:** he can describe a good audit projection from p. 191 but cannot derive its cross-team access, export, or stale-state contract from that page. A stable introspection example would address this effort objection.
- **Demotivation:** the route shifts among local concurrency, normative governance, identity, and strangers' trade before giving a reusable rollout view. The p. 474 confinement promise also makes it hard to tell colleagues what is ready.

### Missing scene and desired apparatus — Recommendations

Use one policy update across three representative teams: a coding agent's credential is revoked while one laptop is offline and one CI job still has an older grant. Show who owns policy, which machine may refuse the next effect, what the dashboard can honestly report, and which acknowledgment is missing. Label it as a designed scenario; do not imply a demonstrated 40-team control plane.

Add a swimlane for platform owner, team owner, agent, and evidence reader. Beside it, place a small table mapping policy intent to enforcement point, available artifact, maturity, and rollback authority. Reuse the three-claim structure of Figure 4.3 with one inaccessible or stale artifact instead of adding another all-green schematic. Add a marginal distinction at p. 483: administrative policy distribution is a separate question from federation between distrustful operators.

**Interview response — SIMULATED:** “The digest chapter gives me something I could use in a platform review tomorrow. Every status needs a path to the diff or test run. But I still can't explain how policy changes reach forty teams, or what I see when one team is offline. Give me that rollout trace and the evidence interface. I don't need another tour of the market to start.”

**Cohort disagreement.** David would prefer a short benefit/cost answer; Tomás needs enough interface detail to test whether that benefit is deliverable. Rachel wants security boundaries explicit; Tomás wants those same boundaries connected to organizational ownership. Their needs can share a diagram but not a single undifferentiated assurance label.

## 09. Angela Brooks — explain the failure before recommending it

**Profile and purpose.** Fortune 500 SRE assessing laptop software that manages ports and background processes. She reads supervision and allocation logic deeply and has very low tolerance for unexplained instability. Her likely existing evaluation relies on runbooks, logs, and controlled failure tests. Here she is limited to Book evidence; no live kill, restart, or daemon test was performed.

### Reading path and stopping points

1. **Orient:** pp. iv–v, vi–vii, then the Systems Engineer track with security checkpoints. First glance suggests relevant systems architecture; safe failure is not evident until the chapter landmarks.
2. **Part I, closely:** pp. 11, 14–17, 57–67; pp. 84–85, 99–100, 128; pp. 139–143, 164. First positive stop: the same commit under two fault classes on pp. 15–16. First operational pause: p. 66 delegates daemon availability to a supervisor but does not specify its restart behavior.
3. **Part II, closely at operational landmarks:** pp. 188–191, 204–205, 213–215. A summary with inspectable logs is attractive; she asks for the failure state, not just the successful link.
4. **Part III, read:** pp. 266–267 and 281–283. Stop to retain the explicit distinction between inherited notes and restored execution state. This changes what “recover” can promise.
5. **Part IV, closely:** pp. 381–382, 426–427, 463, 474–477, 488–490, 519–521, 531–533, 537. P. 463 is the practical stopping point for a recommendation: automatic restart is described as not formally bounded. Reading the illustrative recovery trace is a conditional follow-up, not a passed operational check. Return to pp. 595–597 for status.

### Scores and evidence

**Friction 4/5.** P. 476 says the crash is at minute 12 and abandonment follows 90 seconds of unresponsiveness; Figure 7.16 on p. 475 puts the successor capability at minute 13. On the stated timing, detection alone reaches minute 13:30. The illustration needs a rounding explanation or a corrected timeline. P. 427's “None” crash severity and no-information-loss wording also require reconciliation with pp. 281–283, which explicitly deny restoration of execution state. These are sources of operational ambiguity, not observed runtime failures.

**Appeal 3/5; identity 4, urgency 5, trust 2.** The fault-class table and fork on pp. 15–16 provide a good model of precise failure teaching. The explicit runtime-parity gap on p. 57 and the unbounded restart caveat on p. 463 are useful honesty signals. They do not supply the logs, readiness conditions, or recovery envelope Angela needs to recommend laptop deployment. Figure 7.16 is a strong three-layer teaching device whose timing and status need repair.

### Confusion, stuckness, and demotivation — SIMULATED interpretation

- **Confusion:** does recovery mean restored coordination records, preserved partial files, or equivalent agent execution? Pp. 282 and 426 are relatively careful; pp. 427 and 476 become broader.
- **Stuck:** what happens between process death, detection, restart, readiness, stale claims, and a still-bound port? Pp. 66 and 463 identify dependency and risk but do not close that sequence. Her top objection is explainable failure, not an objection to mathematical depth.
- **Demotivation:** sample precision that fails its own clock is worse for her than an explicitly unknown recovery time. The $5 operator-hour assumption on p. 474 is labeled illustrative but is still a poor anchor for her cleanup-cost context.

### Missing scene and desired apparatus — Recommendations

Continue Alice's pp. 15–16 failure through a developer laptop sleep/wake or process death while a preview server remains bound. Show preserved ledger rows, lost execution state, live child processes, claim expiry, and the condition for declaring the system ready. Include a repeated-failure branch that remains stopped and names the human decision required. This is a proposed teaching scene, not permission to run the local runtime.

Add a timeline with separate clocks for process death, heartbeat detection, claim expiration, supervisor retry, and readiness. Pair it with a compact failure matrix: agent crash / daemon crash / OS crash / power loss / partition; what persists, what stops, what remains unknown. Use visibly labeled SYNTHETIC log excerpts and expected postconditions, or archived recorded evidence with provenance if available. Keep the failure-class fork on p. 16; qualify the severity table on p. 427 and correct the minute-12-to-13 trace.

**Interview response — SIMULATED:** “The WAL example is useful. Same write, different fault, different guarantee—that is how I want this explained. Then the later recovery diagram gets a successor going before the stated detection delay has elapsed. I'd stop there and ask for the actual failure sequence. I need to know what is still alive, what owns the port, and what makes recovery complete.”

**Cohort disagreement.** Grace can learn from a well-scoped unresolved failure; Angela must keep the recommendation pending. David may see a short restart delay as acceptable friction; Angela cannot accept an unmeasured bound merely because it looks small in an example.

## 10. David Chen — an investment case he can repeat upward

**Profile and purpose.** VP Engineering at a roughly 200-person company; formerly an engineer, now responsible for spend, support, and vendor risk. He delegates protocol depth to specialists. The canonical desired payoff is a believable time-saved-per-engineer number; the key objections are support, maintainer continuity, and commercial-use clarity. His likely workaround is a director's proposal reviewed with platform and security staff.

### Reading path and stopping points

1. **Orient:** pp. i–ii, iv–v, vi–vii. Simulated first glance: a textbook about accountable autonomous work, not an identifiable investment brief. Practitioner is the closest map row, but it never names his decision.
2. **Part I, skim:** pp. 6, 9, 15–16, 60–62, 84–85, 136, 164. Take away the distinction between cooperative coordination and compulsory containment; delegate detailed proofs.
3. **Part II, closely at decision landmarks:** pp. 188–191, 204–205, 213–215, 234–235. The human-attention objective and outcome-keyed token ledger engage him. Pause at p. 205: the arithmetic is a model illustration, not observed savings. A realistic first sitting can end here with a request for a pilot measurement plan.
4. **Conditional continuation, Part III closely:** pp. 266–267, 271, 281–283, 302–303. The deleted-test story explains why completion counts are insufficient; the incomplete continuity substrate limits the immediate business story.
5. **Part IV, read selectively:** pp. 344–346, 353–357, 365–366, 377–383, 474, 480–483, 519–521. A second stop occurs at p. 377: platform transaction revenue is not the buyer's cost or return. Finish pp. 595–597 only if preparing questions for specialists. No purchase recommendation follows.

### Scores and evidence

**Friction 5/5.** He cannot complete his spend/risk decision from these stops. P. 234 proposes attributing 84K input and 12K output tokens to a landed change, but does not provide a measured comparative savings study. P. 377's 2–5% fee band and 8–20 CR example explain platform incentives, not a vendor quote or the buyer's total cost. P. 381 explicitly leaves operator-exit handling unspecified. These are useful research boundaries but do not answer support or continuity of service.

**Appeal 2/5; identity 2, urgency 4, trust 2.** The p. 266 deleted-test failure and p. 205 attention-cost contrast describe a problem he recognizes. The audience then shifts toward market construction. There is also a confidence-damaging local inconsistency: p. 381 says 560 CR can remain conserved but stuck; Table 6.2 on p. 382 says the orphaned escrow makes wallet + escrow + commons stop summing to supply. Conservation and ability to settle are different questions in the Book's own example. He cannot safely reuse that table in a decision memo without clarification.

### Confusion, stuckness, and demotivation — SIMULATED interpretation

- **Confusion:** is the economic subject the customer's engineering budget, a hypothetical agent marketplace, or the platform's revenue? Pp. 234, 344–346, and 377 move among these perspectives.
- **Stuck:** no repeatable time-saved, support-owner, or maintainer-unavailability answer emerges from the selected route. The top objection is a missing decision artifact, not a demand that a theorem become a guarantee.
- **Demotivation:** “numbers by hand” can initially feel like the desired quantitative business evidence, then turn out to be illustrative CR transfers or assumed loss values. Keep those examples, but name their use locally.

### Missing scene and desired apparatus — Recommendations

Add a designed pilot scene: a small team uses agents on a bounded repository change, and the director compares it with the existing process using landed changes, reverted changes, review minutes, incidents, and inference spend. Show the measurement template with empty fields or explicitly hypothetical values. Include what happens if the maintainer is unavailable: who owns data, who can export the evidence, what internal fallback is planned, and which questions are still unanswered. Do not invent an SLA, licensing conclusion, or savings percentage.

Add an optional one-page executive route linking the attention example, the actual implementation boundary, and a decision checklist. Use a cost table separating engineering time, inference, operations, and loss exposure; place “illustrative unit, not a commercial quote” beside CR examples. A companion procurement/support document can hold changing product facts. The Book should link to it rather than present research economics as commercial terms. Correct pp. 381–382 before polishing that route.

**Interview response — SIMULATED:** “I understand why a green test result can be a bad measure of progress. That is useful. But the fee example tells me how this platform might earn money, not what adopting it saves my teams. I'd send the technical chapters to platform and security. For me, I need a pilot result and a clear answer about who supports the thing if its maintainer disappears.”

**Cohort disagreement.** Grace finds ambitious, carefully bounded unfinished work attractive as a portfolio signal. David may admire it while declining to budget for it. Tomás is willing to build a dashboard from an interface; David wants that engineering cost included rather than treated as free.

## 11. Fatima Al-Sayed — finish an intake checklist without chasing engineers

**Profile and purpose.** Procurement/security officer fluent in data handling, licenses, audit trails, and assurance documentation, but not a protocol specialist. Her canonical rule is “no for now” if essential answers cannot be found within five minutes. That is a persona constraint, not a measured reading time. Her current task is a vendor-intake ticket; the desired outcome is an answer she can cite, not a mathematical proof she must interpret.

### Reading path and stopping points

1. **Orient:** pp. i–ii, iv–v, vi–vii. Simulated first glance: category and broad promise are legible, but neither the intended procurement audience nor a next step for intake is clear. The Security Reviewer row sounds relevant but assumes more technical depth than hers.
2. **Part I, closely at accessible review landmarks:** pp. 59–65, 84–85, 99–100, 136–143, 164. The confidential-data scenario holds interest. P. 139 names recipients, retention, validators, and liability in a work order, but these are a proposed architecture's fields rather than answers to the current vendor ticket.
3. **Likely first-sitting stop:** p. 143 or the limitations page, p. 164. She cannot determine what data leaves the currently available product simply from the sealed-room description. She requests a current data-handling document; she does not read several hundred pages to infer it.
4. **Conditional second pass if directed:** skim Parts II–III at pp. 190–191, 281–283, 302–303; inspect Part IV at pp. 366, 463–464, 480, 483, 537. Go directly to pp. 595–597. P. 596 supplies the decisive qualifier: no shipping harbor runs the sealed work order. P. 597 narrows Relay's role but does not turn this into a completed data-flow or license review.

### Scores and evidence

**Friction 5/5.** The needed output is a current checklist, and the path delivers design objects and boundaries. Pp. 139–143 do contain recipients, retention, release channels, and signed receipts; therefore the problem is not a total absence of relevant concepts. The problem is translating them into today's deployed behavior, responsible party, and supporting document. P. 164's caption collision is a direct visual obstruction precisely where she looks for exclusions. Pp. 596–597 clarify status but do not supply the remaining intake answers.

**Appeal 2/5; identity 2, urgency 5, trust 2.** The Derek/Erin scene on p. 136 and the work-order grouping on pp. 139–140 recognize her concerns. The separation between what a receipt reports and whether the answer is true on p. 143 is valuable. The technical route is still a poor fit for a short intake review. Honesty about missing implementation increases author credibility while reducing the scope of what she can approve.

### Confusion, stuckness, and demotivation — SIMULATED interpretation

- **Confusion:** does “retention fixes key destruction” on p. 139 describe present handling, a contract parameter, or the architecture's intended behavior? A diagram cannot substitute for a current handling statement.
- **Stuck:** she needs the current egress destinations, data classes, retention/deletion behavior, hosting options, license reference, and accountable contact. These are not answered together at the inspected landmarks. This is a documentation fit finding, not a legal conclusion or a claim that those documents do not exist elsewhere.
- **Demotivation:** the route asks her to parse attestation, declassification, and symbolic notation before she can mark a checklist row. Asking Rachel to translate every row defeats her goal of independent review.

### Missing scene and desired apparatus — Recommendations

Use a synthetic intake ticket: an AI coding assistant reads `customer-export.csv`, calls an inference endpoint, writes a patch, and emits logs and a receipt. For each step, show who can see what and whether it is a current product path or a specified sealed-room path. End with a deletion/retention question whose answer is either documented or explicitly unknown. The third-party inference boundary already stated on pp. 139 and 142 should be the pivotal decision, not a footnote.

Add a plain-language data-flow figure with named trust boundaries and current/specification labels. Pair it with a checklist table: question, current answer, evidence/document, owner, and unresolved item. Use marginal glosses for “attestation” (evidence about the measured environment) and “declassification” (an authorized release under a policy), referring to the Book's own pp. 139–143. Keep formal guarantees on the expert route. Move the competing margin captions on p. 164 apart. Link to actual current commercial/security documentation only when verified; do not manufacture compliance badges or license assurances.

**Interview response — SIMULATED:** “I can see that you've thought about who receives the data. But I need the answer for the version the team wants to use. Is this sealed room available, or is it the design you want to build? Tell me what leaves the machine, where the retention policy is, and which license applies. Until I can cite those answers, the intake stays open.”

**Cohort disagreement.** Rachel values the proof assumptions Fatima needs translated. David needs risk summarized; Fatima needs each answer attributable. A short executive summary helps neither if it erases the current-versus-designed distinction.

## 12. Grace Liu — assess Staff/Principal-level systems judgment

**Profile and purpose.** Technically deep hiring manager assessing Erich's architecture and iteration. She reads code, ADRs, and history rather than taking presentation at face value. Her key test is whether ambition is matched by honest scope and concrete decisions. Her likely workaround is triangulating the repository's implementation, design records, and commits. This walkthrough assesses the Book as a route into that evaluation; it does not independently inspect commit history or establish individual authorship.

### Reading path and stopping points

1. **Orient:** pp. i–ii, iv–v, vi–vii, then Systems Engineer. Simulated first glance: ambitious systems work with an identifiable author; the subtitle gives a category, but the portfolio-evaluation path arrives through status and artifacts rather than the title.
2. **Part I, closely:** pp. 6, 9, 15–16, 57–65, 80–81; pp. 84–85, 99–110, 128; pp. 136–143, 164. Positive stop at pp. 57–58: the missing local transaction wrapper is called a buildable defect. Strongest positive stop at p. 106: the earlier verified-code headline is withdrawn and replaced by a narrower claim.
3. **Part II, closely:** pp. 188–191, 204–205, 213–216, 234–235. Ask whether the evidence-linked projection is a design rule she could apply elsewhere. The distinction between a bound and a measured human result is part of the assessment.
4. **Part III, read:** pp. 266–267, 271–273, 281–283, 302–303, 320–322. Retain the incomplete continuity chain and proposed cross-operator identity; sample the philosophical bridge without treating it as implementation evidence.
5. **Part IV, closely at decision/evidence seams:** pp. 353–357, 365–366, 381–383, 402–404, 426–427, 474–477, 480–483, 488–490, 531–537. Finish pp. 595–599 and 613–614. The exit is a focused architecture interview and artifact check, not a hiring verdict.

### Scores and evidence

**Friction 3/5.** Grace can complete a useful first-pass assessment, but turning it into evidence takes work. Table 1.16 on p. 81 says its module names are illustrative, not a stable public interface. Table A.9 on p. 598 gives real artifact paths and CI names, but narrow columns split identifiers into many fragments; the rendered page is visibly hard to scan. P. 106's correction is highly useful, while pp. 474 and 383 require renewed skepticism about local overstatement.

**Appeal 5/5; identity 5, urgency 4, trust 3.** Her task rewards systems judgment under constraints. Pp. 57–58 distinguish a tractable engineering defect from a research problem; pp. 106–110 say exactly what the proof harness does not cover; pp. 532–533 give an open conjecture a falsifier and admit there is no run behind it. These are strong reasons to continue into a technical interview. Appeal is high despite incomplete implementation because her purpose differs from adoption. Trust remains qualified by internal status inconsistencies and the lack of independently checked history in this walkthrough.

### Confusion, stuckness, and demotivation — SIMULATED interpretation

- **Confusion:** which sentences describe a tested implementation and which are teaching idealizations? P. 354 depicts a required running-state transition; p. 355 calls its runtime enforcement PARTIAL; p. 383 summarizes it as unconditional. The correction process is not consistently propagated into recaps and examples.
- **Stuck:** the Book can name an artifact or CI job, but she still needs a revision-bound route to the decision, change, test, and counterexample. No printed “CURRENT” cell establishes the present remote CI state.
- **Demotivation:** recurring inherited “paper” framing and isolated overclaims can make an assembled textbook feel insufficiently reconciled. Repairing the summaries has higher value than adding another layer of visual polish.

### Missing scene and desired apparatus — Recommendations

Add one evidence-backed engineering decision narrative: an agent makes tests green by deleting a migration test; an independent reviewer follows the diff, rejects the completion claim, and changes the acceptance condition. The Book already has the seeds on pp. 187–190 and 266. Carry one case through decision, changed artifact, validation, and residual limitation. If historical evidence is not available, label the entire case SYNTHETIC rather than implying it is an author accomplishment.

Give one chapter a compact “decision → implementation → counterexample → revision → evidence” trail with verified revision identifiers when available. Reformat the p. 598 table as shorter entries or a wider artifact appendix so paths survive reading. Keep Figure 2.9; attach a sample record to one gap explaining who checked the correspondence and what remains assumed. Make the p. 383 recap preserve p. 355's PARTIAL status. The purpose is to make technical judgment inspectable, not to add résumé claims.

**Interview response — SIMULATED:** “Calling the missing transaction a straightforward defect, and withdrawing the broad proof claim, are good signals. I would ask about those decisions in an interview. Then I'd pick one and follow it into the actual change and test. The book gives me strong questions to ask. It still needs the worked examples and recaps to respect the same limits as the careful sections.”

**Cohort disagreement.** Grace's appeal score is the highest precisely where David's and Angela's remain low: unresolved but clearly framed problems can be valuable evidence of judgment, while still being barriers to purchase or operational approval. Rachel shares her interest in exact proof boundaries but needs a stronger outcome before recommending use.

## Cross-cohort synthesis and recommendations

- The strongest shared appeal is inspectable evidence: the fault-class fork (p. 16), assurance bridge (p. 100), and artifact-linked digest (p. 189). Preserve these and connect them to a recurring developer case.
- The most consequential shared friction is inconsistent local claim strength. A careful front matter or appendix cannot repair an unconditional worked example in the reader's immediate field of view.
- The cohort does not want one shorter, averaged book. Rachel and Grace want depth; Tomás wants composition; Angela wants failure sequences; David and Fatima need short routes to decision documents with explicit unresolved items.

### Three dominant objections and how to answer them

| Objection | Readers most affected | Book evidence | Recommendation |
|---|---|---|---|
| “Which of these guarantees applies to the available system?” | Rachel, Angela, Fatima; also Grace | pp. 60–61 versus 474/596; pp. 354–355 versus 383 | Label assurance mode, maturity, and assumptions beside each example/recap; link to the corresponding implementation-boundary entry. |
| “Can I complete my organization's decision from this route?” | Tomás, David, Fatima | pp. vi–vii, 191, 377, 483, 597 | Add optional organizational routes and verified companion-document links: rollout, pilot economics/support, and current data handling. Preserve the expert route. |
| “Does the concrete example survive its own failure case?” | Angela, Rachel, Grace; David for financial interpretation | pp. 475–476 timing; pp. 381–382 accounting; p. 143 status | Correct clocks and scope, distinguish preserved balances from settlement progress, and clearly identify model-backed versus shipping behavior. |

### Recommended sequence; no Book edits made by this pass

**Immediate editorial repair.** Reconcile p. 474 with pp. 60–61/596; pp. 143/596; pp. 354–355/383; and pp. 381–382. Fix the p. 475/476 recovery clock and narrow the p. 427 no-loss wording against pp. 281–283. Separate the overlapping captions on p. 164. These have high leverage because they affect several readers and can change what a reader believes is safe or ready. Validate each correction against the actual source/model before rewriting; this report does not settle implementation truth.

**Next exposition pass.** Thread one recognizable AI-development case through authorization, shared edits, evidence review, failure, succession, and closure. The Book already has strong scenes: forgotten local session (p. 84), misleading green PR (pp. 187–190), deleted integration test (p. 266), two agents on auth middleware (pp. 402–403), login fix (pp. 474–477), and delayed staging-schema mismatch (pp. 519–521). The missing element is continuity between them, plus the organizational scenes specified above. Keep the expert express lane; make scene, worked values, claim, boundary, and handoff locally adjacent. Any sample transcript should be visibly SYNTHETIC and use the shared sample treatment rather than impersonating a recorded session.

**Later validation.** Test the revised routes with real security reviewers, platform leads, SREs, decision-makers, procurement staff, and hiring managers. Ask them to locate a current claim, name its limit, and find the evidence or identify the unresolved question. Observe where they stop and whether they confuse model status with runtime availability. Until then these six predictions remain triage hypotheses, not evidence of market demand, compliance, usability gains, or hiring outcomes.

No local Port Daddy command, MCP tool, hook, service, daemon, or application was run. No runtime or hosted-CI claim was independently verified. Only this assigned report was authored; no commit was made.

## Additive readback: shortest first sitting and remaining exposition seams

This section preserves the concurrent revision of the report above and adds independently checked observations against the same assembled-PDF SHA-256. The additional rendered checks include pp. 58 and 215 at 144 dpi; pp. vi–vii, 16, 164, 189, and 598 were also independently rendered. The textual comparisons below were read directly from the assembled PDF. They are exposition findings, not live implementation findings.

### Shortest plausible first sitting — SIMULATED recommendations

The fuller routes above represent conditional investigation through the chosen reader track. For these time-constrained readers, the following first sittings give a defensible exit before that investigation. These are analyst recommendations, not routes explicitly printed for these personas.

| Persona | Minimal path after the opening disclosure on pp. iv–v | Useful stopping condition |
|---|---|---|
| 07 Rachel | Threat-model table and mediation caveat, pp. 59–61 → implementation boundary, p. 596 | She can distinguish cooperative coordination from unavailable compulsory confinement. Stop an adoption request that requires the latter; continue to pp. 106–109 only to investigate proof coverage. |
| 08 Tomás | Artifact-linked PR, pp. 188–191 → mechanism/status table, pp. 257–259 → Relay boundary, p. 597 | He can specify a dashboard evidence requirement and identify that centralized policy administration still needs a separate answer. Continue to pp. 483–486 if the organizational authority model is the unresolved question. |
| 09 Angela | Fault table and crash fork, pp. 15–18 → admission behavior, pp. 49–50 → parity/partial-write gaps, pp. 57–58 | She can write the remaining failure-evaluation questions without mistaking durable rows for a demonstrated recovery. No runtime test follows from this reading assignment. |
| 10 David | Misleading green PR, p. 188 → fee example, p. 377 → orphaned escrow, p. 381 | He can explain the intended benefit and identify that neither ROI nor vendor continuity has been established. Hand the technical work to specialists and request measured pilot/support evidence. |
| 11 Fatima | Current implementation boundary, pp. 596–597 → external-provider and leakage exclusions, p. 164 | She can mark unavailable confinement and unanswered operational data-handling questions accurately. Stop the intake as incomplete; read the proposed contract on pp. 139–143 only if needed for context. |
| 12 Grace | Local architectural choice, pp. 7–8 → buildable defect, pp. 57–58 → corrected verification claim, pp. 106–109 | She has three concrete interview questions. Exit to revision-bound ADR/code/test history; use pp. 598 and 613–614 to choose evidence, not to infer a hiring verdict. |

### Additional source observations and recommendations

| Source observation | Reader consequence — SIMULATED interpretation | Recommendation |
|---|---|---|
| P. vii describes the five assurance modes in increasing enforcement order. Appendix A.1, p. 595, explicitly says they are not totally ordered and that Brokered and Confined defeat different adversaries. | Rachel must reconcile two models of assurance; Fatima may mistake the modes for a simple certification ladder. | Use one consistent account in the front matter and appendix. Distinguish runtime threat coverage from implementation maturity and independent evaluation. |
| Figure 1.4 on p. 18 uses BUILTWEAK/BUILT where adjacent recovery prose uses PARTIAL/IMPLEMENTED. | Angela must translate labels while deciding what recovery claim is actually available. | Normalize the figure to the Book's implementation vocabulary, keeping its explicit incomplete-recovery qualification. |
| On rendered p. 215, §4.6.1 directs the reader to Figure 4.10's “right panel.” The rendered figure is a single flat-versus-split digest plot; there is no separate right-hand value-curve panel. | Tomás follows a pointer that cannot deliver the promised value-curve explanation. | Correct the pointer or restore the intended distinct evidence. Do not turn the information bound into measured review-time savings. |
| The rendered p. 58 transaction comparison places the orphaned two-commit state beside the proposed wrapped transaction with one commit point. | Angela can locate the failure gap and Grace can assess why a local transaction is the proposed repair. | Preserve this comparison and extend it with an explicitly synthetic AI-developer trace if needed; additional visual ornament would not answer a new question. |

The following central comparisons in the retained revision were also textually rechecked: p. 143's implementation/test wording against p. 596's SPECIFIED sealed execution; p. 474's physical file-write refusal against pp. 60–61; the minute-13 successor on p. 475 against the minute-12 crash plus 90-second detection on p. 476; the p. 382 orphaned-escrow conservation assertion against p. 381's conserved-but-stuck example; p. 383's unconditional no-spawn recap against p. 355's PARTIAL runtime gate; and p. 427's no-information-loss statement against pp. 281–282's record-versus-execution distinction. These support editorial reconciliation, not a conclusion that a runtime experiment failed.
