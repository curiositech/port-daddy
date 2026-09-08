---
license: Apache-2.0
name: product-appeal-analyzer
description: Evaluate product desirability, market positioning, and emotional resonance—the complement to friction analysis. Assess whether users will WANT a product (not just use it), identity fit, trust signals, and value proposition clarity. Activate on "will they like it", "market positioning", "appeal analysis", "product desirability", "value proposition", "why would someone choose this", "landing page review", "conversion optimization", "messaging strategy". NOT for UX friction analysis (use ux-friction-analyzer), visual design implementation (use web-design-expert), or A/B test setup (use frontend-developer).
allowed-tools: Read,Write,Edit,Bash,WebFetch
metadata:
  category: Content & Marketing
  tags:
    - product-analysis
    - appeal
    - market-fit
    - user-research
    - positioning
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
      reason: The complement — appeal answers "do they want it", friction answers "can they use it"; run both on the same surface.
    - skill: web-design-expert
      reason: Executes the visual identity and layout the desirability triangle's identity-fit vertex calls for.
  io-contract:
    kind: deliverable
    consumes:
      - kind: landing-page-or-product-page
        format: markdown
      - kind: target-personas
        format: markdown
      - kind: appeal-audit-spec
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
- Positioning a product against alternatives
- Crafting messaging, tone, visual identity direction
- Assessing emotional resonance with target personas
- Pre-launch "will this convert?" analysis

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
hero) and returns `{ pass, findings, recommendations }` with no text/keyword
matching involved — every flag it checks is a number or boolean the analyst
already decided. See `examples/sample-input.json` for a passing spec.

### Reference Files (See for deep dives)

| File | When to Use |
|------|-------------|
| `references/scoring-templates.md` | Full scoring matrices and templates |
| `references/trust-ladder.md` | Deep dive on trust building stages |
| `references/identity-signals.md` | Visual/verbal identity signal catalog |
| `references/objection-catalog.md` | Common objections by product type |
| `schemas/appeal-spec.schema.json` | Validate a structured appeal-audit input programmatically |
| `examples/sample-input.json` | A complete spec that `appeal_audit.mjs` scores `pass: true` |
| `examples/expected-output.md` | Shape of a finished appeal analysis + scorecard |
| `templates/output-template.md` | Reusable appeal-analysis template to fill in |
| `agents/openai.yaml` | Subagent descriptor for delegated appeal analysis |

---

## Output Format

When running this skill, produce:

1. **Executive Summary** - 3 bullet key findings
2. **Desirability Triangle Scores** - Per persona
3. **5-Second Test Assessment** - What's clear, what's not
4. **Top 3 Objections** - And how to address them
5. **Priority Recommendations** - Immediate / Medium / Long-term

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

---

**Philosophy**: A product with low friction but low appeal gets abandoned. A product with high appeal but high friction gets frustrated users. You need both.

<!-- BEGIN BUNDLE INDEX (auto: index_references.py) -->

## Skill Bundle Index

*Every file in this skill, and when to open it. Auto-generated; run `scripts/index_references.py --fix`.*

**root**
- [`CHANGELOG.md`](CHANGELOG.md) — Changelog — All notable changes to this skill will be documented here.
- [`README.md`](README.md) — Product Appeal Analyzer — Evaluate whether users will *want* a product — not just whether they can use it.

**`agents/`**
- [`agents/openai.yaml`](agents/openai.yaml) — openai (data/schema)

**`examples/`**
- [`examples/expected-output.md`](examples/expected-output.md) — Example Output: Product Appeal Analysis — **Scenario**: Reviewing a developer-tools landing page ahead of launch, for two personas — a solo indie hacker and a staff engineer evaluati
- [`examples/sample-input.json`](examples/sample-input.json) — sample input (data/schema)

**`references/`**
- [`references/identity-signals.md`](references/identity-signals.md) — Identity Signals Catalog — People choose products that reinforce who they are or want to be.
- [`references/objection-catalog.md`](references/objection-catalog.md) — Objection Catalog — Every user has objections.
- [`references/scoring-templates.md`](references/scoring-templates.md) — Scoring Templates — Detailed templates for comprehensive product appeal analysis.
- [`references/trust-ladder.md`](references/trust-ladder.md) — The Trust Ladder — Trust builds in predictable stages.

**`schemas/`**
- [`schemas/appeal-spec.schema.json`](schemas/appeal-spec.schema.json) — appeal spec.schema (data/schema)

**`scripts/`**
- [`scripts/appeal_audit.mjs`](scripts/appeal_audit.mjs)
- [`scripts/appeal_scorer.py`](scripts/appeal_scorer.py) — Product Appeal Scorer - Structured analysis of product desirability

**`templates/`**
- [`templates/output-template.md`](templates/output-template.md) — Product Appeal Analysis Template — [One-sentence description of the product/page being analyzed and who it's for.] - [Key finding 1] - [Key finding 2] - [Key finding 3] | Pers

<!-- END BUNDLE INDEX -->
