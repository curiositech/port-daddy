# Phase Templates: Copy-Paste Prompt Templates
## Scope correction

This is a template library for the first-party document-synthesis workflow. Contributor counts, model/system choices, phase boundaries, timeboxes, word targets, ratings, and verdict labels are local options, not requirements or empirical findings. This process is distinct from Li et al. 2026 terminal-task RST; see `source-algorithm-and-verification.md` for that paper-specific algorithm and its limits.


This document preserves reusable prompts and handoff templates from a local document-synthesis process. Treat every count, role, model, date, verdict, timebox, word target, and deliverable as a placeholder to tailor or remove. Apply only the stages that answer a real evidence, representation, usability, or accountability need; synthesis remains a draft until the already-authorized decision owner disposes it.

---

## Phase 0: Setup Templates

### Problem Definition Template

```markdown
# Problem Definition

## The Question
[STATE THE CORE QUESTION IN ONE SENTENCE]

## Context
[BACKGROUND NEEDED TO UNDERSTAND THE QUESTION]

## Constraints
- [CONSTRAINT_1: e.g., "Must work within the named team and release window"]
- [CONSTRAINT_2: e.g., "Cannot require organizational restructuring"]
- [CONSTRAINT_3: e.g., "Must work across all product lines"]

## Success Criteria
The resulting document will be successful if:
1. [CRITERION_1: e.g., "Engineers can make daily decisions by consulting it"]
2. [CRITERION_2: e.g., "New hires understand our values within one reading"]
3. [CRITERION_3: e.g., "It resolves the current ambiguity about X"]

## Out of Scope
This document will NOT address:
- [EXCLUSION_1]
- [EXCLUSION_2]
- [EXCLUSION_3]

## Timeline and decision rights
- Target review dates or timeboxes, if useful: [LOCAL PLAN]
- Existing decision owner and delegated scope: [PERSON/BODY AND SCOPE]
- Choices requiring a route outside that scope: [ITEMS]
- Final artifact status: [DRAFT / REVIEWED / APPROVED UNDER NAMED PROCESS]
```

### Agent Roster Template

```markdown
# Agent Roster

## Selection Criteria
Contributors were selected to cover the evidence, affected perspectives, and expertise relevant to this document. Record why each role is included and any important perspective that is missing.

## Contributors (independent draft authors, if useful)

### Contributor: [NAME]
- **Perspective or evidence access**: [DOMAIN / EXPERIENCE]
- **Expertise**: [e.g., "Practical consequence-based reasoning"]
- **Method or system profile**: [OPTIONAL, APPROVED PROFILE AND REASON]
- **Why included**: [1-2 sentences]

### Additional contributor: [NAME]
- **Perspective or evidence access**: [DOMAIN / EXPERIENCE]
- **Expertise or method**: [RELEVANT KNOWLEDGE]
- **Method/system profile**: [OPTIONAL, approved profile and reason]
- **Why included**: [MATERIAL GAP ADDRESSED]

[Add contributors only when each addresses a material evidence or perspective gap.]

## Reviewers (include when their perspective is useful)

### Product or user representative (optional)
- **Perspective**: [USER VALUE / BUSINESS / STAKEHOLDER CONTEXT]
- **Independence plan**: [What material context is withheld or supplied, and why]

### Technical or operations reviewer (optional)
- **Perspective**: [FEASIBILITY / OPERATIONS / DELIVERY RISK]
- **Independence plan**: [What material context is withheld or supplied, and why]

### Affected-user or accessibility reviewer (optional)
- **Perspective**: [USER NEEDS / ACCESSIBILITY / CONTEXT]
- **Independence plan**: [What material context is withheld or supplied, and why]

## Editorial and synthesis roles

### Synthesizer (Phase 2)
- **Method/profile**: [Optional, approved and task-suitable]
- **Role**: Integrate the selected contributions into an evidence-linked outline

### Lead Architect (Phase 4)
- **Method/profile**: [Optional, approved and task-suitable]
- **Role**: Consolidate the reviewed draft while preserving claim scope and dissent

### Polymath Editor (Phase 6)
- **Method/profile**: [Optional, approved and task-suitable]
- **Role**: Prepare artifacts for disposition by the named owner
```

### Ground Rules Template

```markdown
# Ground Rules

## Ground rules to choose for this project

### 1. Steel-Man Requirement
Before critique, consider asking the reviewer to summarize the claim fairly, identify any supported contribution, then state evidence gaps, counterexamples, and a concrete correction. This is a prompt for accurate review, not a praise quota or validity test.

### 2. Independent input, when useful
If independent input is needed to reduce anchoring, limit access to other drafts during the initial contribution. Give all contributors the same necessary scope and evidence. Record shared sources, prompts, profiles, and context because separate identities alone do not establish independence. Coordinate later when it improves evidence or review.

### 3. Priority expression
If relative priority is needed, choose a transparent local method (ordered list, pairwise comparison, or explanation). Permit ties and abstentions where justified. Preserve the reasons; preference aggregation is not proof, consensus, or authority.

### 4. Dissenting Appendix for Irreconcilable Tensions
If a tension cannot be resolved, it goes in the Appendix:
- State the tension clearly
- Present both sides' strongest arguments
- Document the document's choice and why
- Acknowledge what's sacrificed

### 5. Independent review
A relevant reviewer may read a bounded draft without the process history to check clarity, feasibility, or affected-user concerns. State what context was withheld. Confusion is a signal to investigate, not a verdict; reviewers may also need source material to assess claims.

## Quality Gates

### Contributions → Synthesis
- [ ] Inputs relevant to the scope are accounted for, or missing/declined inputs are recorded
- [ ] Claims, sources, assumptions, and unknowns can be traced
- [ ] Materially different positions are represented without manufacturing differences

### Synthesis → Review
- [ ] Document structure and priorities have stated reasons
- [ ] Tensions and evidence gaps are visible
- [ ] Structure addresses the scoped question

### Review → Revision
- [ ] Planned review findings are received or their absence is recorded
- [ ] Material representation errors and counterexamples are dispositioned
- [ ] Critiques are specific and actionable

### Revision → Reality check
- [ ] Draft reads coherently for its intended audience
- [ ] Material positions are represented fairly
- [ ] Dissent or unresolved questions remain visible

### Reality check → Final disposition
- [ ] Relevant reviewer input is received or the gap is dispositioned
- [ ] Reviews state evidence, scope, material risks, and requested correction
- [ ] Findings are actionable and routed to the proper owner

### Final disposition
- [ ] Document is coherent, scoped, and labeled with its current status
- [ ] Practice guidance is actionable where included
- [ ] Material review findings are accepted, rejected, or deferred with reasons by the scoped owner

## Timeboxes

| Stage | Local timebox, if useful | Checkpoint or escalation owner |
|-------|--------------------------|-------------------------------|
| Setup | [ESTIMATE] | [ROLE / NONE] |
| Contributions and synthesis | [ESTIMATE] | [ROLE / NONE] |
| Review and revision | [ESTIMATE] | [ROLE / NONE] |
| Final disposition | [ESTIMATE] | [NAMED OWNER] |

An expired timebox does not imply consent or approval. Record what remains and use the authority already established for the work.
```

---

## Phase 1: Independent Contribution Prompts

### Generic Contribution Template

```markdown
You are [AGENT_NAME], asked to examine [DOMAIN / QUESTION] using the analytical lens and evidence access stated below. This prompt assigns a task; it does not establish a real-world identity, credential, school membership, or disciplinary consensus.

## Analytical lens and evidence access
- **Lens to apply:** [QUESTION SET OR METHOD, NOT A CLAIMED IDENTITY]
- **Sources or observations available:** [SPECIFIC MATERIAL / ACCESS LIMITS]
- **Assumptions to test:** [CANDIDATE ASSUMPTIONS]
- **Limits or relevant counterexamples:** [KNOWN LIMITS, OR STATE NOT CHECKED]

If a named tradition, scholar, or professional standard matters, cite a reliable source for the specific claim and state its scope. Do not invent beliefs or speak for a whole discipline.

## The Question
[PROBLEM_DEFINITION]

## Your Task
Write a scoped contribution addressing the question from your assigned perspective. Length is a local constraint; prioritize traceable claims, source quality, counterexamples, and uncertainty.

### Requirements
1. **State your important criteria or commitments**
   - What conditions materially affect your recommendation?
   - Which are values, evidence-based constraints, or personal judgments?

2. **Explain WHY these principles matter**
   - Through the selected analytical lens
   - With concrete examples labeled sourced, observed, or hypothetical
   - Including possible consequences, with evidence or assumptions identified

3. **Acknowledge potential tensions**
   - Where might others disagree?
   - What are the strongest counter-arguments?
   - Where is your position weakest?

4. **Propose concrete recommendations**
   - Specific structural elements
   - Decision-making processes
   - Evidence or success criteria appropriate to the question

5. **Include examples**
   - Identify whether each example is observed, sourced, or constructed
   - Do not present an illustration as an empirical case study

### Format
- Start with a concise summary if useful
- Use headers to organize the argument
- List priorities with rationale if relative order matters
- Follow any project-specific length limit without padding

### Constraints
- If independent contribution is part of the plan, do not inspect other drafts before your first submission.
- State evidence and uncertainty; do not exaggerate confidence to create contrast.
- Do not claim consensus before the inputs have been compared.

## Output
Produce a scoped contribution, for example `[contributor-id]-contribution.md`.
```

### Constructed analytical-lens example: outcomes and consequences

Use these questions when outcomes and practical consequences matter. This is a constructed prompt, not a claim about a philosopher or an entire school.

```markdown
## Lens: consequences and testability
- What outcomes does each option aim to change, and for whom?
- What evidence links the proposed action to those outcomes?
- Which observations could disconfirm the explanation?
- What important values or outcomes are not captured by the available measures?
- What short- and long-term costs or side effects should be compared?
- Which examples below are documented, and which are hypothetical?
```

### Constructed analytical-lens example: systems feedback

Use these questions to map interactions that could affect a recommendation. They are an analysis task, not attributed beliefs of systems thinkers.

```markdown
## Lens: system boundary, feedback, and delay
- Which actors, resources, and outcomes are inside the stated system boundary?
- What evidence supports each proposed causal link?
- Which feedback loops, delays, or accumulations could change the outcome over time?
- What second-order effect is a hypothesis rather than an observed result?
- What boundary or missing actor could reverse the conclusion?
- Which intervention would distinguish competing explanations?
```

### Constructed analytical-lens example: threat analysis

Use these questions when the document makes security or trust-boundary claims. They do not assign an attacker identity or assert a universal security doctrine.

```markdown
## Lens: bounded threat analysis
- What assets and security properties are in scope?
- Which actors, capabilities, access paths, and trust boundaries are supported by the evidence?
- What misuse or failure scenario should be tested, and what source or model supports it?
- Which controls reduce the stated risk, and what residual risk remains?
- Could a control shift risk to another group, system, or workflow?
- What is unknown or not assessed?
```

---

## Phase 2: Synthesizer Agent Prompt

```markdown
You are the editor synthesizing the selected contributions into a reviewable document outline. Preserve source attribution, distinctions, and unresolved questions.

## The Question
[PROBLEM_DEFINITION]

## Your Inputs
You have received these in-scope contributions: [LIST ONLY ACTUAL INPUTS, INCLUDING MISSING OR DECLINED INPUTS].

## Your Task

### Part 1: Claim and recommendation extraction
For each in-scope contribution, extract material claims and their sources; summarize rather than ranking a fixed number of principles.

| Contributor/source | Material claim | Evidence and assumptions | Implication or recommendation |
|---------------------|----------------|--------------------------|-------------------------------|
| [NAME / SOURCE] | [CLAIM] | [BASIS, SCOPE, LIMIT] | [IMPLICATION] |

### Part 2: Convergence Analysis
For each proposed shared or disputed point, state which sources support it and whether that support is independent. Separate shared evidence, agreement in interpretation, contested assumptions, unique but relevant concerns, and unknowns. Do not infer truth from an agreement percentage; do not invent disagreement to populate categories.

### Part 3: Tension Mapping
For each material tension or apparent conflict:

| Principle A | Principle B | Tension Type | Resolution Strategy |
|-------------|-------------|--------------|---------------------|
| [CLAIM / VALUE / POLICY CHOICE A] | [CLAIM / VALUE / POLICY CHOICE B] | Evidence / definition / conditional / value / policy / unresolved | [Evidence to check, conditional scope, owner choice, or retained dissent] |

### Part 4: Candidate structure and priorities (if relevant)
If prioritization is needed, show whether each priority comes from evidence, a stated value, a risk, or the scoped owner's policy. Do not turn a ranking into a vote on factual correctness or authority.

**Claims or commitments needed for the document:**
- [ITEM] — basis, scope, and dependency, if applicable

**Derived guidance (if useful):**
- [ITEM] — derives from [BASIS], with limits

**Open choices:**
- [CHOICE] — alternatives, tradeoffs, and decision owner

### Part 5: Candidate structure
Propose a document structure for the intended audience; use only sections that serve the scope:

```
1. Preamble
   - Purpose
   - Scope
   - How to use this document

2. Foundational Principles
   - [SECTION_1]
   - [SECTION_2]
   - ...

3. Derived Principles
   - [SECTION_1]
   - [SECTION_2]
   - ...

4. Implementation Guidance
   - [DOMAIN_1]
   - [DOMAIN_2]
   - ...

5. Scope and Limitations
   - What this document covers
   - What it explicitly doesn't cover
   - Deferred decisions

6. Dissenting Appendix
   - [TENSION_1]
   - [TENSION_2]
   - ...

7. Glossary
   - [TERM_1]
   - [TERM_2]
   - ...
```

## Output
Produce the requested review artifacts if separate files are useful, for example a claim analysis and proposed outline. Keep their links to the source contributions.

## Constraints
- Distinguish description from evaluation and recommendation.
- Do not use frequency labels unless the input set and measure are defined.
- Preserve unresolved tensions; do not assume all differences are fundamental.
- Be explicit about source coverage and uncertainty.
```

---

## Phase 3: Commentary Agent Prompts

### Generic Commentary Template

```markdown
You are [AGENT_NAME]. You submitted a contribution in the initial drafting stage addressing:

[PROBLEM_DEFINITION]

## Your Original Contribution
Link or quote the claims from your contribution that the draft relies on. Add as many or as few as are relevant; do not force the source into a fixed number of principles.

- [CLAIM, SOURCE/PASSAGE, AND SCOPE]
- [OPTIONAL ADDITIONAL CLAIMS]

## The Synthesis
You have now received the editor's draft and, if prepared, its claim map:
- Proposed claim grouping, if attached
- Candidate document structure, if attached

## Your Task

### Part 1: Fair representation check (recommended)
State what the synthesis captured correctly and any useful connection or revision it surfaced, if applicable. Then identify omissions or misreadings with source passages. This prompt does not set a quota or delay a time-sensitive factual correction.

### Part 2: Critique
You may critique the draft at this stage; raise a material factual, safety, or authority error as soon as it is noticed:

**Misrepresentations of your position:**
- [QUOTE from synthesis]: Misrepresents because [REASON]
- [QUOTE]: Misrepresents because [REASON]

**Priority or structure concerns (if relevant):**
- [CLAIM / SECTION] should be ordered or framed differently because [REASON AND SUPPORT]
- State whether this is an evidence issue, audience choice, preference, or authorized policy decision.

**Structural concerns:**
- [SECTION] fails to address [CONCERN] because [REASON]

**Wording issues:**
- [EXACT QUOTE] should say [ALTERNATIVE] because [REASON]

### Part 3: Constructive Amendments
Propose specific changes:

**Wording modifications:**
| Current | Proposed | Rationale |
|---------|----------|-----------|
| "[CURRENT]" | "[PROPOSED]" | [WHY] |

**Structural reorganization:**
- Move [SECTION] to [LOCATION] because [REASON]

**Additional sections needed:**
- [SECTION_NAME]: Should cover [CONTENT] because [REASON]

**Principle elevation/demotion:**
- Elevate [PRINCIPLE] from [CURRENT_LEVEL] to [PROPOSED_LEVEL] because [REASON]
- Demote [PRINCIPLE] from [CURRENT_LEVEL] to [PROPOSED_LEVEL] because [REASON]

### Part 4: Irreconcilable Tensions
If you believe a fundamental tension exists that CANNOT be resolved:

**The tension:**
[PRINCIPLE_A] vs. [PRINCIPLE_B]

**Why it's fundamental (not just difficult):**
[EXPLANATION]

**How the Dissenting Appendix should handle it:**
[PROPOSAL]

## Output
Produce one document: `[agent-name]-commentary.md`

## Constraints
- Represent the synthesis and source position fairly; no fixed acknowledgment count is required.
- Be specific. Reference line numbers, exact quotes.
- Propose solutions, not just problems.
- If you have no critiques in a category, say "No concerns."
```

---

## Phase 4: Lead Architect Prompt

```markdown
You are the drafting editor. Consolidate the reviewed inputs into a coherent draft without claiming authority not delegated to you.

## The Question
[PROBLEM_DEFINITION]

## Your Inputs
1. **Selected contributions** (from the input stage)
2. **Proposed claim grouping or document structure** (if produced)
3. **Source and uncertainty record** (if produced)
4. **Review comments and dispositions** (from the review stage)

## Your Task

### Part 1: Commentary Integration

For each material review finding:

| Contributor or reviewer | Finding | Disposition | Rationale / owner |
|-------------------------|---------|-------------|-------------------|
| [NAME / ROLE] | [MATERIAL FINDING] | [ACCEPT / REVISE / REJECT / DEFER] | [BASIS; OWNER IF A POLICY CHOICE] |
[Add one row for each material finding; omit routine comments or track them separately.]

**Critiques that revealed synthesis flaws:**
- [CRITIQUE]: Revealed [FLAW]

### Part 2: Soul Document

Create a single, coherent document that:

1. **Uses a clear organization**
   - Order claims for the intended reader and explain material dependencies
   - Distinguish supported claims, proposed policy, and implementation advice
   - Do not treat an editor's hierarchy or ranking as evidence or authorization

2. **Reads coherently without fabricating agreement**
   - Use consistent terms and direct wording
   - Retain qualifications, competing claims, and unresolved choices where material
   - Use active voice where it improves clarity

3. **Is actionable**
   - Each principle has "In practice, this means..."
   - Edge cases are addressed
   - Decision-making guidance is explicit

4. **Is honest about limitations**
   - Scope is clearly defined
   - What's NOT covered is stated
   - Deferred decisions are flagged

### Part 3: Dissenting Appendix

For each tension that could NOT be reconciled:

**Tension: [NAME]**

*The conflict:*
[PRINCIPLE_A] and [PRINCIPLE_B] cannot both be fully honored because [REASON].

*Strongest argument for Principle A:*
[STEEL-MANNED ARGUMENT]

*Strongest argument for Principle B:*
[STEEL-MANNED ARGUMENT]

*Proposed or authorized disposition:*
[The authorized owner chose A/B within this scope because REASON, or the draft recommends A/B for owner review.]

*What we sacrifice:*
This means we accept [COST], which advocates of [B/A] correctly value.

*Conditions for revisitation:*
If [CONDITION], this choice should be reconsidered.

### Part 4: Scope Documentation

**This document proposes guidance about:**
- [SCOPE_1]
- [SCOPE_2]

**Existing authority or delegation covering it:**
- [PERSON/BODY, SCOPE, SOURCE, AND LIMITS]

**This document explicitly does NOT address:**
- [EXCLUSION_1]
- [EXCLUSION_2]

**Decisions deferred to future work:**
- [DECISION_1]: Deferred because [REASON]
- [DECISION_2]: Deferred because [REASON]

**Phased implementation notes:**
- [PRINCIPLE]: May be phased in starting with [APPROACH]

## Output
If separate artifacts help the intended audience, produce the selected documents, for example:
1. `soul-document.md`: The proposed guidance
2. `dissenting-appendix.md`: Material unresolved tensions

## Constraints
- Follow the existing decision owner and delegated scope; editor role does not create authority.
- Record why material review findings were accepted, rejected, or deferred.
- Make the draft understandable to its intended audience; retain citations or references needed to verify claims.
- Include dissent in the document or an attached record when it matters to use or governance.
```

---

## Phase 5: Reality Check Agent Prompts

### Product Manager Reality Check

```markdown
You are a [RELEVANT PRODUCT / USER / BUSINESS REVIEWER]. Review the document from the perspective and evidence access described below; the title is a role prompt, not an authority grant.

## Review context
State whether you participated earlier and which drafts, sources, or process records you reviewed. If this is a cold read, say what material context was withheld and why. Use your relevant experience and the supplied evidence to test the text; unfamiliarity alone is not a quality test. For stakeholder claims, state the source, affected group, collection method/date/scope, and whether the item is observed, reported, predicted, hypothetical, or not assessed. Never present a predicted objection as testimony. For anticipated objections, separate your forecast from statements actually collected from affected people or stakeholder records.

## The Document
[SOUL_DOCUMENT]

## Your Task

### Part 1: Initial read (optional)
Before detailed review, note initial impressions if they help identify unclear terms or reader assumptions. Treat them as prompts for investigation, not evidence on their own.

**Immediate reaction:**
[1-2 sentences]

**What's clear:**
- [ITEM]
- [ITEM]

**What's confusing:**
- [ITEM]
- [ITEM]

**What's missing that I expected:**
- [ITEM]
- [ITEM]

**What's present that surprises me:**
- [ITEM]
- [ITEM]

### Part 2: Product Manager Audit

**Can this be implemented?**
- [ ] Yes, as written
- [ ] Yes, with modifications
- [ ] Partially
- [ ] No
Explanation: [DETAILS]

**What timeline is plausible?**
[ESTIMATE OR NOT ASSESSED], with assumptions and basis: [SOURCE / DEPENDENCIES / EXPERIENCE / UNKNOWN]

**What resources would this require?**
- People: [ESTIMATE OR NOT ASSESSED; BASIS]
- Budget: [ESTIMATE OR NOT ASSESSED; BASIS]
- Technology: [REQUIREMENTS, SOURCE, OR UNKNOWN]

**Which existing constraints are supported by evidence, and which need checking?**
| Constraint or concern | Source / access / date / scope | Status | Follow-up or “not assessed” |
|-----------------------|-----------------------------|--------|----------------------------|
| [OBSERVED / REPORTED CONSTRAINT OR LABELED HYPOTHESIS] | [SOURCE, COLLECTION METHOD, DATE, SCOPE] | [OBSERVED / REPORTED / PREDICTED / HYPOTHESIS / UNKNOWN] | [CHECK NEEDED OR NOT ASSESSED] |

**What evidence indicates a stakeholder concern or possible objection?**
| Stakeholder or affected group | Concern / objection | Source and access basis | Status / confidence | Follow-up or “not assessed” | Project-defined severity and basis |
|------------------------------|-----------------------|------------------------|--------------------|------------------------------------|---------------------------------------|
| [GROUP] | [OBSERVED / REPORTED CONCERN OR LABELED HYPOTHESIS] | [SOURCE, METHOD, DATE, SCOPE] | [OBSERVED / REPORTED / PREDICTED / HYPOTHESIS / UNKNOWN] | [CHECK NEEDED OR NOT ASSESSED] | [PRIORITY AND WHY] |

### Part 3: Jargon Check
Flag undefined or circular terms:

| Term | Issue | Suggested Fix |
|------|-------|---------------|
| "[TERM]" | Undefined / Circular / Insider jargon | [FIX] |

### Part 4: Gap Analysis
What's missing?

**Processes needed but not defined:**
- [PROCESS]

**Responsibilities unclear:**
- [RESPONSIBILITY]

**Metrics undefined:**
- [METRIC]

**Edge cases not addressed:**
- [EDGE_CASE]

### Part 5: Verdict
Optional local status: [READY FOR OWNER REVIEW / NEEDS REVISION / DEFERRED / OTHER]. Explain the evidence, scope, and remaining decision owner; status labels do not approve the document.

**My demands for upgrading my verdict:**

*Highest-consequence finding (define the project's severity scale if used):*
- [FINDING AND WHY]

*Other material findings:*
- [FINDING AND WHY]

*Optional improvements:*
- [FINDING AND WHY]

## Output
Produce a named review artifact if the project needs one, for example `product-reality-report.md`.

## Constraints
- Be DIRECT. This is not the time for diplomacy.
- Use concrete examples from documented sources or label them hypothetical; do not invent stakeholder testimony.
- Distinguish urgent risks from useful improvements using the project-defined scale; state the reason for each label.
- Propose solutions, not just problems.
```

### Engineering Manager Reality Check

```markdown
You are a [RELEVANT ENGINEERING / OPERATIONS REVIEWER]. Review the document from the perspective and evidence access described below; the title is a role prompt, not an authority grant.

## Review context
State whether you participated earlier and which drafts, sources, or process records you reviewed. If this is a cold read, say what material context was withheld and why. Use role-specific knowledge to test the text; unfamiliarity alone is not a quality test.

## The Document
[SOUL_DOCUMENT]

## Your Task

### Part 1: Initial read (optional)
[Use the PM template's initial-read prompts if helpful; impressions are leads to investigate.]

### Part 2: Engineering Manager Audit

**Is this technically feasible?**
- [ ] Yes, as written
- [ ] Yes, with modifications
- [ ] Partially
- [ ] No
Explanation: [DETAILS]

**What timeline is plausible?**
[ESTIMATE OR NOT ASSESSED], with assumptions and basis: [SOURCE / DEPENDENCIES / EXPERIENCE / UNKNOWN]

**What resources would this require?**
- Engineers: [COUNT] at [LEVEL]
- Infrastructure: [REQUIREMENTS]
- Technical debt: [IMPLICATIONS]

**What team dynamics may affect this proposal?**
- [OBSERVED / REPORTED DYNAMIC OR LABELED HYPOTHESIS; SOURCE / DATE / SCOPE]
- [FOLLOW-UP OR NOT ASSESSED]

**What delivery risks exist?**
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| [RISK] | High/Med/Low | High/Med/Low | [MITIGATION] |

**What would break if we shipped this tomorrow?**
- [BREAKAGE]
- [BREAKAGE]

### Part 3: Jargon Check
[Use the PM template's jargon table if helpful.]

### Part 4: Gap Analysis
What's missing?

**Technical processes needed:**
- [PROCESS]

**Ownership unclear:**
- [AREA]

**Metrics undefined:**
- [METRIC]

**Failure modes not addressed:**
- [FAILURE_MODE]

### Part 5: Verdict
[Same structure as PM template]

## Output
Produce a named review artifact if the project needs one, for example `engineering-reality-report.md`.
```

### Design Lead Reality Check

```markdown
You are a [RELEVANT DESIGN / ACCESSIBILITY / AFFECTED-USER REVIEWER]. Review the document from the perspective and evidence access described below; the title is a role prompt, not an authority grant.

## Review context
State whether you participated earlier and which drafts, sources, or process records you reviewed. If this is a cold read, say what material context was withheld and why. For every user-need, accessibility, journey, or confusion claim, identify the affected group, source, research/collection method, date and scope. Mark it as observed, directly reported, predicted, hypothetical, unknown, or not assessed. Do not invent user testimony or present predictions as research findings; leave an explicit “not assessed” entry where evidence is unavailable.

## The Document
[SOUL_DOCUMENT]

## Your Task

### Part 1: Initial read (optional)
[Use the PM template's initial-read prompts if helpful; impressions are leads to investigate.]

### Part 2: Design Lead Audit

**Does this work for users?**
- [ ] Yes, as written
- [ ] Yes, with modifications
- [ ] Partially
- [ ] No
Explanation: [OBSERVED / REPORTED / PREDICTED / HYPOTHETICAL / NOT ASSESSED; SOURCE OR ASSUMPTIONS; SCOPE]

**Which user needs are supported by evidence, and where might a gap exist?**
| Need or possible gap | Affected group | Source / method / date / scope | Status | Follow-up or “not assessed” |
|----------------------|----------------|--------------------------------|--------|----------------------------|
| [OBSERVED / REPORTED NEED OR LABELED HYPOTHESIS] | [GROUP / UNKNOWN] | [RESEARCH, TESTIMONY, RECORD, OR NONE] | [OBSERVED / REPORTED / PREDICTED / HYPOTHESIS / UNKNOWN] | [VALIDATION NEEDED OR NOT ASSESSED] |

**What accessibility concerns exist?**
| Concern | Affected users | Source and evidence status | Follow-up / not assessed | Project-defined severity and basis |
|---------|----------------|----------------------------|--------------------------|---------------------------------------|
| [OBSERVED / REPORTED CONCERN OR LABELED HYPOTHESIS] | [GROUP / UNKNOWN] | [SOURCE, METHOD, DATE, SCOPE; STATUS] | [CHECK NEEDED OR NOT ASSESSED] | [PRIORITY AND WHY] |

**What design-system implications are evidenced or hypothesized?**
- [IMPLICATION; SOURCE / BASIS / STATUS, OR NOT ASSESSED]

**What user confusion is observed, reported, or only predicted?**
- [FINDING OR HYPOTHESIS; SOURCE / METHOD / DATE / SCOPE; STATUS]
- [FOLLOW-UP NEEDED, OR NOT ASSESSED]

### Part 3: Jargon Check
[Use the PM template's jargon table, focusing on language the intended users encounter.]

### Part 4: Gap Analysis
What's missing?

**User journeys not addressed:**
- [JOURNEY]

**Feedback loops not defined:**
- [LOOP]

**Onboarding not considered:**
- [ONBOARDING_GAP]

**Error states not addressed:**
- [ERROR_STATE]

### Part 5: Verdict
[Same structure as PM template]

## Output
Produce a named review artifact if the project needs one, for example `design-reality-report.md`.
```

---

## Phase 6: Final Editor Prompt

```markdown
You are the final editor preparing the selected deliverables for disposition by the existing decision owner.

## Your Inputs
1. **Reviewed draft** (from the consolidation step)
2. **Dissent or decision log**, if used
3. **Selected reviewer reports** (from the reality-check step)

## Your Task

### Part 1: Address Reality Check Demands

For each material finding in the selected reviews:

| Source | Finding and evidence | Disposition | Rationale / owner |
|--------|----------------------|-------------|-------------------|
| [ROLE / REVIEW] | [FINDING] | Accepted / revised / rejected / deferred | [WHY; OWNER IF A POLICY CHOICE] |

Severity labels such as P0/P1 are local. Define them if used; do not assume a reviewer or editor can impose them on the decision owner. Record the basis and route for unresolved material findings.

### Part 2: Constitution

Prepare a proposed founding document for disposition by the existing authorized owner:

**Writing guidelines:**
- Write for the intended readers and likely maintenance horizon
- State firm commitments, conditional guidance, and unresolved choices distinctly
- Identify scope and the source of any authority
- Include a dissent record when it helps preserve unresolved tradeoffs
- Provide enough context to use the document and links to verify material claims

**Structure:**
```
[TITLE] Constitution

Preamble
- Why this document exists
- Its scope and authority
- How to use it

Article I: [Foundational Principles]
- Section 1.1: [Principle]
- Section 1.2: [Principle]
...

Article II: [Derived Principles]
...

Article III: [Implementation Guidance]
...

Article IV: [Governance]
- How this document is amended
- Who has authority to interpret it
- Dispute resolution

Article V: [Scope and Limitations]
- What this covers
- What it doesn't cover

Dissenting Appendix
- [Tension 1]
- [Tension 2]
...

Glossary
- [Terms]
```

### Part 3: Practitioner's Guide

Create a PRACTICAL implementation guide:

**Writing guidelines:**
- Written for someone starting TODAY
- Outside-in structure (start with "what do I do?")
- Examples and templates throughout
- FAQ section addressing common questions
- Phased rollout plan if applicable

**Structure:**
```
[TITLE] Practitioner's Guide

Quick Start
- [FIRST ACTIONS APPROPRIATE TO THE SCOPE]
- [RISKS OR ACTIONS TO AVOID, WITH REASONS]

Part 1: Daily Decisions
- [Common scenario 1]: What to do
- [Common scenario 2]: What to do
...

Part 2: Weekly Rhythms
- [Process 1]
- [Process 2]
...

Part 3: Handling Edge Cases
- [Edge case 1]: How to handle
- [Edge case 2]: How to handle
...

Part 4: Escalation Paths
- When to escalate
- To whom
- How

Appendix A: Templates
- [Template 1]
- [Template 2]

Appendix B: FAQ
- Q: [Common question 1]
  A: [Answer]
- Q: [Common question 2]
  A: [Answer]
...

Appendix C: Phased Rollout (if applicable)
- Phase 1: [Actions] by [Date]
- Phase 2: [Actions] by [Date]
...
```

### Part 4: Editorial Notes

Document your process for future editors:

```
Editorial Notes

What Changed from Soul Document to Constitution
- [CHANGE_1]: Changed because [REASON]
- [CHANGE_2]: Changed because [REASON]
...

Reality Check Demands: Disposition
- Accepted: [LIST]
- Rejected: [LIST with reasons]

Editor's Assessment: Most Important Principles
1. [PRINCIPLE]: Most important because [REASON]
2. [PRINCIPLE]: Second most important because [REASON]
3. [PRINCIPLE]: Third most important because [REASON]

Editor's Assessment: Biggest Risks
1. [RISK]: Could manifest as [SCENARIO]
2. [RISK]: Could manifest as [SCENARIO]
3. [RISK]: Could manifest as [SCENARIO]

Advice for Future Editors
- [ADVICE_1]
- [ADVICE_2]
- [ADVICE_3]

Open Questions (for future iterations)
- [QUESTION_1]
- [QUESTION_2]
```

## Output
Produce only the artifacts requested by the existing owner and useful to their readers. Possible outputs are `constitution.md`, `practitioners-guide.md`, and `editorial-notes.md`.

## Constraints
- Document status and authority must match the existing governance record; editor role alone creates no authority.
- Keep each artifact useful to its intended reader and preserve evidence needed to verify claims.
- Give material review findings a reasoned disposition; route unresolved choices to their scoped owner.
- Any severity labels are local and should have a defined meaning.
- Test whether an intended reader can understand the document; use confusion to locate a question, not as an automatic verdict.
```

---

## Bonus: Constitution Author Template (Phase 6b)

Optional author prompt for a project whose existing owner requested a constitutional-style document:

```markdown
You are a document editor preparing a proposed charter or constitution for review under an existing governance process.

## Your Inputs
1. **Soul Document** (the raw content)
2. **Dissenting Appendix** (the tensions)
3. **Editorial Notes from Polymath Editor** (the priorities)

## Your Task
Transform the reviewed draft into a proposed charter or constitution that:

1. States scope, audience, status, and governing authority precisely.
2. Defines terms that affect interpretation and distinguishes requirements from recommendations.
3. Preserves evidence, qualifications, counterexamples, and unresolved tradeoffs.
4. Includes interpretation, amendment, and dispute processes only when the existing owner has specified them.
5. Remains understandable to intended readers and acknowledges its limits.

## Style Guide

**Do:**
- Prefer active voice and define terms that affect interpretation
- Use modal verbs consistently with the intended force and governing conventions
- Seek qualified legal or governance review when the document is meant to create binding obligations
- Number sections when it helps stable citation

**Avoid:**
- Ambiguous authority or scope
- Presenting proposals as adopted policy
- Removing qualifications, citations, or dissent merely to sound decisive

## Output
Produce one document: `constitution.md`

The output remains a proposal unless and until the existing authorized process adopts it. If adopted, record its status, owner, scope, and effective date.
```

---

## Usage Notes

### Customization Points

These are templates, not required forms. Select and tailor the `[BRACKETED]` fields that matter to the project; remove fields that do not apply and explain material omissions:
- `[AGENT_NAME]`: Replace with specific agent name
- `[DOMAIN]`: Replace with domain of expertise
- `[PROBLEM_DEFINITION]`: Replace with actual problem statement
- etc.

### Method and system selection

Choose a method or system profile only under the project's approved policy for data sensitivity, capability, quality target, latency, and cost. Record the selected profile/revision and material shared context if reproducibility matters. This template makes no vendor, model, or role-to-model recommendation.

### Parallel or independent execution

Run tasks in parallel only when they do not depend on each other and each has sufficient shared scope and evidence. Initial contributions may be independent; synthesis depends on contributions; review depends on a draft. List actual tasks and dependencies. Use `dag-planner` when an execution graph would help.
