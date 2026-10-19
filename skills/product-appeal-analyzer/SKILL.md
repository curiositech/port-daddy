---
license: Apache-2.0
name: product-appeal-analyzer
description: >-
  Evaluate desirability, positioning, and emotional resonance for products AND for technical documents - landing pages, wireframes, papers, monographs, textbooks, and whitepapers. Assess whether someone will WANT this (not just be able to use it) via identity fit, problem urgency, trust signals, and - for anything whose price is measured in hours rather than seconds - return on effort: time to first insight, cost transparency, payoff visibility. Activate on "will they like it", "market positioning", "appeal analysis", "product desirability", "value proposition", "why would someone choose this", "landing page review", "will anyone read this book", "is this paper compelling", "does the abstract sell the result", "wireframe appeal", "messaging strategy". NOT for UX friction analysis (use ux-friction-analyzer), visual design implementation (use web-design-expert), or A/B test setup (use frontend-developer).
allowed-tools: Read,Write,Edit,Bash,WebFetch
metadata:
  category: Content & Marketing
  tags:
    - product-analysis
    - appeal
    - market-fit
    - user-research
    - positioning
    - technical-documents
    - scientific-writing
  provenance:
    kind: first-party
    owners:
      - port-daddy
  pairs-with:
    - skill: port-daddy-users
      reason: Supplies the 24 concrete named personas (with segment, goals, friction tolerance, dealbreakers) that satisfy this skill's target-personas input when the product being evaluated is Port Daddy itself.
    - skill: agentic-coding-product-research
      reason: Supplies persona/audience research (user stories, unmet needs) this skill's per-persona desirability scoring depends on when the product is an agentic coding tool.
    - skill: agentic-coding-ux-designer
      reason: Turns this skill's appeal recommendations into concrete flows (prompt-to-diff, onboarding, checkpoint rollback) for agentic coding product surfaces.
    - skill: ux-friction-analyzer
      reason: The complement, and the other readout of the same random-surfer chain - friction is the terms that raise the abandon hazard, appeal is the terms that lower it. It also owns scripts/surfer_model.mjs, which computes the time-to-first-insight and payoff-reach numbers this skill's returnOnEffort and surfer blocks consume.
    - skill: textbook-craft
      reason: Executes the pedagogical structure this skill's technical-document findings call for - motivation before formalism, worked examples, honest prerequisites.
    - skill: latex-whitepaper-engineering
      reason: Owns the typographic craft that is the trust triangle's "professional execution" row on technical material.
    - skill: tufte-evidence-design
      reason: Figures are the hero image for scientific work; this is where self-contained, finding-stating figures get built.
    - skill: web-design-expert
      reason: Executes the visual identity and layout the desirability triangle's identity-fit vertex calls for.
  io-contract:
    kind: deliverable
    consumes:
      - kind: landing-page-or-product-page
        format: markdown
      - kind: technical-document
        format: pdf
      - kind: wireframe
        format: any
      - kind: target-personas
        format: markdown
      - kind: appeal-audit-spec
        format: json
      - kind: surfer-readout
        format: json
    produces:
      - kind: appeal-analysis-and-recommendations
        format: markdown
      - kind: appeal-scorecard
        format: json
---
# Product Appeal Analyzer

Evaluate whether users will *want* a product—not just use it. The complement to friction analysis.

**Core insight**: Users don't choose the best product—they choose the product that feels most like it was made for them.

## When to Use

✅ **Use for:**
- Evaluating landing pages, product pages, app store listings
- Evaluating **technical documents**: papers, monographs, textbooks, whitepapers, API references
- Evaluating **wireframes** — with the honesty guard below
- Positioning a product, or a book, against alternatives
- Crafting messaging, tone, visual identity direction
- Assessing emotional resonance with target personas
- Pre-launch "will this convert?" / pre-publication "will anyone finish this?" analysis

❌ **NOT for:**
- UX friction audits (→ use ux-friction-analyzer)
- Visual design execution (→ use web-design-expert)
- A/B test implementation (→ use frontend-developer)
- Market size estimation or financial forecasting
- Feature comparison matrices

---

## The Desirability Triangle

**All three must be present.** Missing any one kills conversion:

```
                    IDENTITY FIT
                    "This is for people like me"
                         /\
                        /  \
                       /    \
                      /  ★   \
                     / DESIRE \
                    /          \
                   /______________\
        PROBLEM               TRUST
        URGENCY               SIGNALS
   "I need this now"     "This will actually work"
```

| Missing Element | User Reaction |
|-----------------|---------------|
| Identity Fit | "Seems useful, but not for me" |
| Problem Urgency | "Cool, maybe someday" |
| Trust Signals | "Looks sketchy / too good to be true" |

**Decision tree**: When analyzing, score each vertex 1-10. If any is &lt;5, that's your priority fix.

---

## Quick Analysis: The 5-Second Test

Within 5 seconds of landing, a visitor should know:

1. **What is this?** (Category recognition)
2. **Who is it for?** (Identity signal)
3. **What's the core promise?** (Value proposition)
4. **What do I do next?** (Clear CTA)

**How to run it:**
- Show landing page to someone unfamiliar for exactly 5 seconds
- Hide it, then ask: "What was that? Who's it for? What would you do there?"
- Record verbatim—don't coach or clarify

**Scoring:**

| Result | Score | Action |
|--------|-------|--------|
| All 4 clear in &lt;3 sec | 9-10 | Ship it |
| All 4 clear in 3-5 sec | 7-8 | Minor polish |
| 3 of 4 clear | 5-6 | Fix the gap |
| 2 or fewer clear | 2-4 | Significant rework |
| Confusing/unclear | 0-1 | Start over |

---

## Technical Documents and Scientific Books

The triangle transfers to papers, monographs, and textbooks almost unchanged.
What does not transfer is the **price**. A landing page asks for thirty seconds
and maybe a credit card. A monograph asks for forty hours, spent before the
reader finds out whether it was worth it. Nothing in the triangle prices
effort, so on technical material it systematically flatters documents that are
fascinating, rigorous, trustworthy, and finished by nobody.

So the triangle grows a fourth vertex and becomes a tetrahedron:

```
                  IDENTITY FIT
              "written for someone like me"
                       /|                      / |                      /  |                      /  ★|★                     / DESIRE                     /  /      \          PROBLEM  /__/________\__\  TRUST
        URGENCY     \   ..   /      "correct, and careful"
   "this matters"    \      /
                      \    /
                 RETURN ON EFFORT
             "I can see what I get, and
              roughly what it costs me"
```

**Return on Effort**, scored 0-10 from three components:

| Component | Question | Failure looks like |
|---|---|---|
| Time to first insight | How long until this pays me *anything*? | 200 pages of machinery before the first usable result. |
| Cost transparency | Does it say what it costs — length, difficulty, background? | "Assumes only basic familiarity with measure theory." |
| Payoff visibility | Can I see the destination from here? | A table of contents of nouns, with no sign which chapters carry the goods. |

The single most actionable number is **time to first insight against the
patience budget**. `ux-friction-analyzer`'s `surfer_model.mjs` computes
it exactly, for the readers who actually arrive.

### The 30-Second Shelf Test

The technical analogue of the 5-Second Test. Five questions, not four, because
a technical reader has both a real alternative (the standard reference) and a
real cost.

1. **What is this about?** (subject)
2. **Who is it for, and am I that person?** (level and prerequisites)
3. **What will I be able to do after?** (the promise, as a capability)
4. **What does it cost me?** (length, difficulty, assumed background)
5. **Why this one and not the standard reference?** (differentiation)

| Result | Score | Action |
|---|---|---|
| All 5 clear | 9-10 | Ship it |
| 4 of 5 | 7-8 | Fix the gap — usually (5) |
| 3 of 5 | 5-6 | The preface is doing a job the cover should do |
| 2 or fewer | 0-4 | Nobody is choosing this on purpose |

Then the **random-page test**: open to a random middle page for fifteen
seconds. Can you tell what is going on? Most readers of searchable technical
material enter mid-document and never see page one.

### Anti-patterns, mapped from the originals

| Landing-page anti-pattern | Technical-document analogue |
|---|---|
| Feature Soup Headline | **Theorem dump** — results listed with no intuition or reason to care |
| Screenshot Hero | **Non-self-contained figure** — a caption that labels instead of stating the finding |
| Trust Ladder Violation | **Front-loaded formalism** — machinery demanded before the motivation that justifies it |
| Identity Mismatch | **"For researchers and practitioners alike"** — an audience of everyone |

Four more have no landing-page ancestor: the **structural abstract** ("In
Section 2 we introduce…" instead of the result), the **unlocatable
contribution**, the **definition avalanche**, and the **citation wall** as
social proof. Full treatment of all of these, the technical trust ladder, the
trust-signal/cheap-fake table, and how to measure appeal here at all:
`references/technical-document-appeal.md`.

### Reader maps: does each persona have a route, and is it worth walking?

Many technical books print a **Reader's Map**: *practitioners read 1, 3, 7, 9;
theorists read 1, 2, 4-6.* Docs sites do it with role tiles. Every route is a
promise made to a named vocational identity, which makes it an appeal object,
not just a navigation aid.

Match your personas to the routes the document actually prints, then walk each
one. The two halves divide cleanly:

| Question | Skill |
|---|---|
| Does this route *work*? Does it carry its own prerequisites, reach a payoff, fit in this reader's budget? | `ux-friction-analyzer`, via `readerPaths` in the surface graph |
| Was it *worth walking*? Does what it delivers match what this persona came for? Does every persona even have one? | This skill, via `technicalDocument.readerMap` |

Four appeal findings come out of the matching:

- **`reader-map-persona-unserved`** — you are scoring a persona the map never
  routes. They will read the book in the order it happens to be printed, which
  is the order written for somebody else.
- **`reader-path-persona-unmatched`** — a route addressed to nobody you are
  targeting. It was invented because the structure suggested it, and it costs
  the map credibility for the routes that are real.
- **`reader-path-payoff-mismatch`** — the route names a reader and rewards a
  different one. A promise broken in public.
- **`reader-path-over-budget`** — the route pays off after this reader's
  attention runs out. **The book's overall budget is nobody's**: a practitioner
  track promising four hours to someone with one is broken even if every
  chapter on it is excellent.

Persona names are joined to routes as a **key**, not a search: `paths[].persona`
must correspond to a `personas[].name` exactly, up to case and whitespace. An
unmatched name is reported rather than guessed at.

The pairing produces the report sentence usually worth the whole audit:
*"The practitioner route is the one your practitioners will take, it skips the
two chapters that define what it needs, and it reaches the result twelve
minutes after their attention budget runs out."*

Where to score each field: `references/technical-document-appeal.md`. Full
doctrine on extracting a map and the four ways one breaks lives in
`ux-friction-analyzer`, in its `reader-maps.md` reference.

### Figures are the hero image

Readers of scientific material go **abstract → figures → conclusions →
methods**. For a large share of readers the figures *are* the encounter with
the argument, which makes a self-contained figure the strongest appeal signal
available — and a figure that needs the body text a discarded entry point.
Captions state the finding, not the file name.

---

## Wireframes

> **A wireframe can fail appeal. It cannot pass it.**

A structural appeal defect found in a wireframe is real and cheap to fix now.
A wireframe with no defects has told you nothing, because the three things that
most drive appeal — words, images, and craft — are not present.

| Vertex | Assessable from a wireframe? |
|---|---|
| Identity fit | **Structural signals only** (density, option count, complexity). Language, visual identity, and tone are not there to score. |
| Problem urgency | Whether a slot *exists* for the problem statement, and where it sits. Not whether the words land. |
| Trust signals | Whether trust slots exist and where. Not whether the proof convinces. |
| **Trust ladder** | **Fully assessable, and this is the wireframe's strongest signal.** Count the frames between arrival and the first ask, versus arrival and the first demonstration of value. |

**Score `null` for what you cannot see, never a guess.** A confident 7/10 on
"language resonance" for a page of lorem ipsum is a fabrication, and it is the
kind that survives into a summary slide. The audit script rejects a persona
with a missing sub-score rather than averaging an invented number into a
vertex; that rejection is the feature. Details and the wireframe checklist:
`references/surface-appeal-adapters.md`.

---

## Analysis Process

### Step 1: Identify Target Personas

For each persona, document:
- **Who**: One-sentence description
- **Problem**: What's broken + how it feels
- **Current workaround**: What they do today (and why it sucks)
- **Identity**: How they see themselves, who they want to become

### Step 2: Score the Desirability Triangle

For each persona:

```
PERSONA: [Name]

IDENTITY FIT                    [/10]
  Visual identity match         [/10]  "Does this look like my kind of tool?"
  Language resonance            [/10]  "Do they speak my language?"
  Implied user match            [/10]  "Are people like me shown?"

PROBLEM URGENCY                 [/10]
  Pain point acknowledged       [/10]  "They understand my problem"
  Emotional resonance           [/10]  "They get how frustrating it is"
  Solution clarity              [/10]  "I see how this fixes it"

TRUST SIGNALS                   [/10]
  Professional execution        [/10]  "This looks legitimate"
  Social proof                  [/10]  "Others like me use it"
  Risk reduction                [/10]  "What if it doesn't work?"

OVERALL APPEAL SCORE:           [/90]
```

### Step 3: Map Objections

| Objection | Type | How Addressed? |
|-----------|------|----------------|
| "Is this legit?" | Trust | [Answer] |
| "I've tried things before" | Skepticism | [Answer] |
| "Too expensive" | Value | [Answer] |
| "Too complicated" | Effort | [Answer] |
| "Not for people like me" | Identity | [Answer] |
| "What if it doesn't work?" | Risk | [Answer] |
| "I'll do it later" | Urgency | [Answer] |

### Step 4: Generate Recommendations

Use priority formula: `Impact = (Users Affected × Severity) / Fix Difficulty`

Categorize into:
- **Immediate** (ship this week)
- **Medium-term** (this sprint)
- **Long-term** (roadmap)

---

## Common Anti-Patterns

### Feature Soup Headline

**Novice thinking**: "List all capabilities to show value"

**Reality**: Visitors scan for 2-3 seconds. Feature lists feel generic.

**What to use instead**:
| Bad | Good |
|-----|------|
| "AI-Powered Recovery Planning Tool with Analytics" | "Know exactly what to do next in your recovery" |
| "Comprehensive Legal Document Platform" | "Find out in 2 minutes if your record can be expunged" |

**Detection**: Headline contains 3+ nouns or buzzwords like "AI-powered", "comprehensive", "platform"

### Screenshot Hero

**Novice thinking**: "Show the product interface so people know what they're getting"

**Reality**: Strangers don't understand your UI. They care about outcomes.

**What to use instead**:
- Person experiencing the benefit
- The outcome/result they'll get
- Abstract visualization of the transformation

**Detection**: Hero image is a product screenshot with no context

### Trust Ladder Violation

**Novice thinking**: "Get their email immediately, then convert them"

**Reality**: Trust builds in stages. Asking for too much too early kills conversion.

**The Trust Ladder** (each rung requires more trust):
1. Land on page → Professional design, no broken elements
2. Click/explore → Clear navigation, fast load
3. Spend &gt;2 min → Demonstrated value, clear progress
4. Enter info → Why you need it explained, no dark patterns
5. Create account → Privacy visible, minimal fields, clear benefit
6. Pay money → Guarantee, testimonials, recognizable processor

**Detection**: Asking for account creation before demonstrating value

### Identity Mismatch

**Novice thinking**: "Broad appeal = more users"

**Reality**: When everyone is the target, no one feels targeted.

**What to use instead**:
| Signal Type | How It Works |
|-------------|--------------|
| Visual identity | Dark mode = "power user"; Soft pastels = "wellness" |
| Language/tone | "Crush your goals" vs "Find your balance" |
| Social proof | Company logos vs individual testimonials |
| Complexity | Minimal = simplicity-seeker; Feature-rich = power user |

**Detection**: Homepage tries to appeal to 3+ different personas

---

## Self-Contained Tools

### Analysis Workflow

1. **Read** the landing page content and structure
2. **WebFetch** the target URL to analyze live content
3. **Write** analysis results to a markdown file
4. **Edit** recommendations into actionable copy changes

### Appeal Scorer Script (interactive, URL-driven)

Run: `python scripts/appeal_scorer.py <url>`

Produces a scoring template for a live URL that Claude then fills in during
the Analysis Process above; not a pass/fail gate on its own.

### Appeal Audit Script (deterministic, structured-spec-driven)

Once the Desirability Triangle scores, 5-second test result, and anti-pattern
flags from the Analysis Process are captured as a structured JSON spec
(matching `schemas/appeal-spec.schema.json`), run:

```
node scripts/appeal_audit.mjs --input <spec>.json
```

This is a deterministic complement to `appeal_scorer.py`, not a duplicate:
`appeal_scorer.py` interactively drafts the analysis from a live URL;
`appeal_audit.mjs` re-checks an already-scored, structured spec against this
skill's own gates (any triangle vertex &lt;5, a failed 5-second test,
trust-ladder violation, identity mismatch, feature-soup headline, screenshot
hero) and returns `{ pass, findings, recommendations, scorecard }` with no
text/keyword matching involved — every flag it checks is a number or boolean
the analyst already decided. See `examples/sample-input.json` for a passing
spec.

Two optional blocks extend it beyond landing pages, and are simply absent for
one:

- **`technicalDocument`** — the 30-Second Shelf Test, Return on Effort,
  declared audience and prerequisites, structural abstract, figure
  self-containment, reproducibility artifacts, limitations, typographic craft,
  and the reader map with its per-route persona matching.
  See `examples/technical-book-spec.json` for a monograph that fails on most of
  them, and `references/technical-document-appeal.md` for what each field
  means.
- **`surfer`** — paste `payoffReachProbability` and `completion` straight from
  `ux-friction-analyzer`'s `surfer_model.mjs` run on the same surface.
  Appeal cannot be fixed downstream of where people stop, so a payoff reached
  by under half of arrivals gates here too.

Setting `surfaceKind: "wireframe"` adds the honesty guard to the
recommendations: a clean result means "no structural appeal defect found",
never "this will appeal".

### Reference Files (See for deep dives)

| File | When to Use |
|------|-------------|
| `references/technical-document-appeal.md` | Evaluating a paper, monograph, textbook, or whitepaper: the fourth vertex, the shelf test, the technical trust ladder, trust signals and their cheap fakes, and how to measure appeal here at all |
| `references/surface-appeal-adapters.md` | Evaluating a wireframe, prototype, or deck: what you may score and what you must leave `null` |
| `references/scoring-templates.md` | Full scoring matrices and templates |
| `references/trust-ladder.md` | Deep dive on trust building stages |
| `references/identity-signals.md` | Visual/verbal identity signal catalog |
| `references/objection-catalog.md` | Common objections by product type |
| `schemas/appeal-spec.schema.json` | Validate a structured appeal-audit input programmatically |
| `examples/sample-input.json` | A complete spec that `appeal_audit.mjs` scores `pass: true` |
| `examples/technical-book-spec.json` | A monograph spec exercising every technical-document and surfer gate — it fails, loudly |
| `examples/expected-output.md` | Shape of a finished appeal analysis + scorecard |
| `templates/output-template.md` | Reusable appeal-analysis template to fill in |
| `agents/openai.yaml` | Subagent descriptor for delegated appeal analysis |

---

## Output Format

When running this skill, produce:

1. **Executive Summary** - 3 bullet key findings
2. **Desirability Triangle Scores** - Per persona (four vertices for a technical document)
3. **5-Second Test Assessment** — or, for a technical document, the **30-Second Shelf Test** and the random-page test
4. **Top 3 Objections** - And how to address them
5. **Priority Recommendations** - Immediate / Medium / Long-term

For a technical document, also report **time to first insight against the
patience budget**, and say where the budget number came from. For a wireframe,
state which vertices are unscored and why — "a wireframe can fail appeal but
cannot pass it" belongs in the summary, not a footnote. Any number taken from
the surfer model is a model output, not a measurement; say so in the sentence
that uses it.

---

## Integration with ux-friction-analyzer

**Appeal + Friction = Complete picture**

| This Skill Answers | ux-friction-analyzer Answers |
|--------------------|------------------------------|
| "Do they want it?" | "Can they use it?" |
| Will they choose this over alternatives? | Can they complete the task? |
| Does it feel made for them? | Does the flow make sense? |
| Is the promise compelling? | Is the experience smooth? |

**Run both**: High appeal + high friction = frustrated users. Low friction + low appeal = abandoned product.

### They are two readouts of one chain

This is not just a slogan about complementary skills. In the random-surfer
reader model that `ux-friction-analyzer` owns, the per-node probability of
quitting is:

```
hazard = base + load·(comprehension) + load·(perceptual)   ← friction raises it
              − hook − payoff                              ← appeal lowers it
```

Friction is the positive terms; appeal is the negative ones. Build **one**
surface graph, run `ux-friction-analyzer`'s `surfer_model.mjs` on it, and both skills read the
same output for different purposes: friction reads the median exit node and the
regression churn, appeal reads the payoff reach probability and the time to
first insight. Paste the latter two into this skill's `surfer` block.

The practical consequence is a rule worth remembering: **appeal cannot be fixed
downstream of where people stop.** A brilliant Chapter 9 in a book whose median
reader quits in Chapter 2 is not an appeal asset. Fix the shedding point first,
then the promise.

---

**Philosophy**: A product with low friction but low appeal gets abandoned. A product with high appeal but high friction gets frustrated users. You need both.

<!-- BEGIN BUNDLE INDEX (auto: index_references.py) -->

## Skill Bundle Index

*Every file in this skill, and when to open it. Auto-generated; run `scripts/index_references.py --fix`.*

**root**
- [`CHANGELOG.md`](CHANGELOG.md) — Changelog — All notable changes to this skill will be documented here.
- [`README.md`](README.md) — Product Appeal Analyzer — Evaluate whether someone will *want* this — not just whether they can use it.

**`agents/`**
- [`agents/openai.yaml`](agents/openai.yaml) — openai (data/schema)

**`examples/`**
- [`examples/expected-output.md`](examples/expected-output.md) — Example Output: Product Appeal Analysis — **Scenario**: Reviewing a developer-tools landing page ahead of launch, for two personas — a solo indie hacker and a staff engineer evaluati
- [`examples/sample-input.json`](examples/sample-input.json) — sample input (data/schema)
- [`examples/technical-book-spec.json`](examples/technical-book-spec.json) — technical book spec (data/schema)

**`references/`**
- [`references/identity-signals.md`](references/identity-signals.md) — Identity Signals Catalog — People choose products that reinforce who they are or want to be.
- [`references/objection-catalog.md`](references/objection-catalog.md) — Objection Catalog — Every user has objections.
- [`references/scoring-templates.md`](references/scoring-templates.md) — Scoring Templates — Detailed templates for comprehensive product appeal analysis.
- [`references/surface-appeal-adapters.md`](references/surface-appeal-adapters.md) — Surface Appeal Adapters — Load this when the thing to evaluate is not a finished live page — a wireframe, a prototype, a deck — and you need to know which parts of th
- [`references/technical-document-appeal.md`](references/technical-document-appeal.md) — Appeal in Technical Documents and Scientific Books — Load this when the thing being evaluated is a paper, a monograph, a textbook, an API reference, or a technical whitepaper rather than a land
- [`references/trust-ladder.md`](references/trust-ladder.md) — The Trust Ladder — Trust builds in predictable stages.

**`schemas/`**
- [`schemas/appeal-spec.schema.json`](schemas/appeal-spec.schema.json) — appeal spec.schema (data/schema)

**`scripts/`**
- [`scripts/appeal_audit.mjs`](scripts/appeal_audit.mjs)
- [`scripts/appeal_scorer.py`](scripts/appeal_scorer.py) — Product Appeal Scorer - Structured analysis of product desirability

**`templates/`**
- [`templates/output-template.md`](templates/output-template.md) — Product Appeal Analysis Template — [One-sentence description of the product/page being analyzed and who it's for.] - [Key finding 1] - [Key finding 2] - [Key finding 3] | Pers

<!-- END BUNDLE INDEX -->
