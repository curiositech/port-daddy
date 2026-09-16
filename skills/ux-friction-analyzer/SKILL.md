---
license: Apache-2.0
name: ux-friction-analyzer
description: Friction analysis for anything a person reads or drives - live web flows, wireframes, PDF documents, and LaTeX books - using cognitive psychology, Gestalt grouping, ADHD-friendly design, and a random-surfer reader model that computes where attention pools, where readers backtrack, and where they quit. Covers friction audits, journey and reading simulation, cognitive-load optimization, comprehension-debt auditing (unintroduced ideas, notation working set, entropy cliffs), and Fitts' Law application. Activate on "analyze UX", "friction audit", "user journey", "wireframe review", "is this document readable", "will anyone finish this", "reading flow", "ADHD-friendly", "reduce cognitive load", "UX audit". NOT for visual design execution (use web-design-expert), whether people WANT it (use product-appeal-analyzer), A/B testing implementation (use frontend-developer), or accessibility compliance auditing (use accessibility-auditor).
allowed-tools: Read,Write,Edit,WebFetch
metadata:
  category: Design & UX
  tags:
    - ux
    - accessibility
    - cognitive-load
    - adhd-friendly
    - user-research
    - gestalt
    - readability
    - technical-documents
  provenance:
    kind: first-party
    owners:
      - port-daddy
  pairs-with:
    - skill: port-daddy-users
      reason: Supplies the 24 concrete named personas whose journeys get simulated during a friction audit when the product being evaluated is Port Daddy itself.
    - skill: agentic-coding-ux-designer
      reason: Turns friction-audit findings into concrete AI-coding-agent product flows (prompt-to-diff, plan/apply/review, checkpoint rollback).
    - skill: human-gate-designer
      reason: Friction findings about approval/review moments feed directly into where and how a DAG places human-in-the-loop gates.
    - skill: agentic-app-architecture
      reason: Friction findings about hidden reasoning, missing state preservation, or ungated long operations surface architecture-level shape decisions this skill owns.
    - skill: product-appeal-analyzer
      reason: The complement, and the other readout of the same surfer chain - friction is the terms that raise the abandon hazard, appeal is the terms that lower it. Run both on the same graph.
    - skill: frame0-wireframing
      reason: Produces the wireframes this skill audits before any of them become code.
    - skill: latex-whitepaper-engineering
      reason: Owns the LaTeX source that scripts/latex_skeleton.mjs reads to build a book's surfer graph mechanically.
  io-contract:
    kind: deliverable
    consumes:
      - kind: ux-flow-description
        format: markdown
      - kind: friction-audit-input
        format: json
      - kind: surface-graph
        format: json
      - kind: latex-source
        format: tex
    produces:
      - kind: friction-audit
        format: markdown
      - kind: friction-audit-report
        format: json
      - kind: surfer-readout
        format: json
---
# UX Friction Analyzer

Friction analysis for anything a person has to get through: a live web flow, a
wireframe, a PDF report, or a 400-page technical book. Cognitive psychology,
Gestalt grouping, ADHD-friendly design, and a random-surfer reader model that
turns "this is hard to read" into a number you can rank.

**The question this skill answers is "can they get through it".** Whether they
*want* to is `product-appeal-analyzer` — and the two are readouts of the same
chain, because friction is the set of terms that raise the probability of
quitting and appeal is the set that lowers it. Run both on one graph.

## Surfaces

| Surface | A node is | Start here |
| --- | --- | --- |
| **Web flow (live)** | A screen or state | `scripts/friction_audit.mjs` for the mechanical gates, then the surfer model |
| **Wireframe** | A frame | `references/surface-adapters.md` — and read what a wireframe *cannot* tell you before you report anything |
| **PDF document** | A section or page spread | `references/surface-adapters.md` |
| **LaTeX book** | A `\section` (or `\chapter` for a first pass) | `scripts/latex_skeleton.mjs` builds most of the graph from source |

The arithmetic is identical across all four. What changes is what a node is and
which findings mean anything — the touch-target and reflow gates are about live
interactive surfaces and do not transfer to a book.

## Decision Points

Use this decision matrix when conflicting ADHD principles and cognitive load types collide:

### Cognitive Load vs ADHD Principle Conflicts

| Situation | If High Intrinsic Load | If High Extraneous Load | If High Germane Load |
|-----------|----------------------|------------------------|-------------------|
| **Progressive Disclosure vs Information Need** | Hide advanced features; show essentials only | Remove ALL decorative elements; show task steps linearly | Group related info; use expandable sections |
| **Context Preservation vs Working Memory** | Auto-save every keystroke; show current state banner | Clear all non-essential UI; focus on one input field | Save drafts; provide "where you left off" panels |
| **Chunked Progress vs Task Flow** | Break into micro-tasks (1-2 min each) | Show progress bar; hide future steps completely | Use card-based UI; each card = one concept |
| **Predictable Navigation vs Personalization** | Keep identical layout always; disable customization | Use breadcrumbs; limit to 3-level hierarchy max | Offer simple/advanced modes; user chooses complexity |

### Primary Decision Tree

```
User arrives → What's their cognitive state?

├─ FOCUSED & ENERGETIC
│  ├─ Goal: Complete complex task
│  │  → Use power-user shortcuts + batch operations
│  └─ Goal: Explore/learn
│     → Show advanced features + guided tour
│
├─ DISTRACTED/MULTITASKING  
│  ├─ On mobile
│  │  → Single-column layout + floating action button
│  └─ On desktop
│     → Minimize chrome + auto-save everything
│
├─ OVERWHELMED/ANXIOUS
│  ├─ First-time user
│  │  → Wizard flow + success celebrations
│  └─ Returning user hitting error
│     → Clear error recovery + undo options
│
└─ TIME-PRESSURED/URGENT
   ├─ Regular task
   │  → Smart defaults + keyboard shortcuts
   └─ Crisis situation
      → Emergency mode UI + direct contact options
```

### Friction vs Feature Trade-offs

When feature requests conflict with friction reduction:

- **If feature adds >2 seconds to primary flow**: Defer to advanced mode
- **If feature requires >4 mental chunks**: Break into wizard steps
- **If feature serves <20% of users**: Hide behind "More options"
- **If feature needs learning curve**: Provide in-context help only

## Failure Modes

### 1. Overwhelm Cascade
**Detection Rule**: If user abandons before completing first meaningful action
- **Symptom**: High bounce rate on landing page, users don't scroll
- **Diagnosis**: Too many choices presented simultaneously
- **Fix**: Progressive disclosure - show only 1-2 primary actions initially

### 2. Context Switch Death Spiral
**Detection Rule**: If user takes >23 minutes to complete familiar 5-minute task
- **Symptom**: Users losing place repeatedly, restarting workflows
- **Diagnosis**: Interface doesn't preserve context across interruptions
- **Fix**: Add "Continue where you left off" persistent banner

### 3. Invisible Progress Paralysis
**Detection Rule**: If users repeatedly ask "Is this working?" during long operations
- **Symptom**: Users refresh page during background processing
- **Diagnosis**: No feedback on system state or progress
- **Fix**: Real-time progress indicators + time estimates

### 4. Micro-Friction Accumulation
**Detection Rule**: If completion rates drop >15% despite no major UX changes
- **Symptom**: Users complete individual steps but abandon before final step
- **Diagnosis**: Small frictions compound into abandonment
- **Fix**: Remove one minor friction point per week systematically

### 5. Expert User Imprisonment
**Detection Rule**: If power users complain about "dumbed down" interface
- **Symptom**: Feature requests for keyboard shortcuts, batch operations
- **Diagnosis**: Optimized for beginners, frustrated experts
- **Fix**: Adaptive UI that reveals complexity based on user behavior

### 6. Comprehension Debt Cascade
**Detection Rule**: If a node requires concepts the surface introduced nowhere, or introduces only later
- **Symptom**: Readers backtrack repeatedly, then stop; "I don't know what half these words mean"
- **Diagnosis**: Ideas arrived with nowhere to land. The defect is never that an idea is hard — it is that it had no place to land
- **Fix**: Introduce before use, or declare the prerequisite honestly up front so readers self-select correctly
- Script findings: `unintroduced-prerequisite`, `forward-reference`, `working-set-overflow`

### 7. Entropy Cliff
**Detection Rule**: If comprehension load jumps sharply from one node to the next
- **Symptom**: A specific page where readers stop feeling slow and start feeling stupid; abandonment concentrates there
- **Diagnosis**: A difficulty wall instead of a ramp — typically a chapter of formalism dropped in front of the motivation
- **Fix**: Insert a bridging node: a motivating example, a worked instance, an explicit "what you need before this" box
- Script finding: `entropy-cliff`

### 8. Buried Payoff
**Detection Rule**: If the node that delivers the promised value is reached by under half of arrivals, or arrives after the patience budget
- **Symptom**: "Great book, never finished it." Enthusiastic early reviews, no citations of the actual result
- **Diagnosis**: The thing worth reading sits behind more machinery than anyone budgeted
- **Fix**: State the result, show the figure, or give the worked example *before* the machinery that earns it
- Script findings: `payoff-unreachable`, `payoff-buried`, `time-to-first-insight-exceeds-budget`

See `references/worked-examples.md` for two full journey simulations (an
ADHD-user checkout audit and a SaaS dashboard report-building audit) showing
these failure modes diagnosed and fixed step by step.

## The Random Surfer Reader Model

PageRank's random surfer follows a link or teleports. A *reader* does two more
things, and those two are where documents actually fail: they **regress** —
jump backwards to find a definition they needed and did not have — and they
**abandon**. Model all four and you get an absorbing Markov chain whose
readouts are exact linear algebra, not a simulation: where attention pools,
where people backtrack, and the specific node where the median arrival quits.

```
hazard(node) = base(readerMode)
             + 0.35 · comprehensionLoad   ← unintroduced ideas, new-concept rate, working set
             + 0.20 · perceptualLoad      ← Gestalt grouping, attention crowding
             − hookWeight   · hook        ← does its ending pull you onward?
             − payoffWeight · payoff      ← is the reader being paid yet?
```

Two terms raise it, two lower it. **That symmetry is why friction and appeal
are one model:** friction is the positive terms, appeal is the negative ones.

### Running it

```bash
node scripts/surfer_model.mjs --input graph.json --mode skim
```

Input shape: `schemas/surface-graph.schema.json`. Worked examples:
`examples/surfer-wireframe.json` (clean, passes) and
`examples/surfer-latex-book.json` (a monograph that front-loads its formalism
and buries its theorem — it fails, loudly, and names the chapter).

For a LaTeX book, build most of the graph mechanically first:

```bash
node scripts/latex_skeleton.mjs --input book.tex --level section --wpm 120 > graph.json
```

That extracts sections, word counts, reading-time estimates, float and
equation counts, and — the valuable part — the author's own cross-reference
graph, so definition distance and forward references fall out of the source
before you have read a word. Then fill in the `_todo` items it emits;
`payoff` and `hook` are left at 0 deliberately so an unfilled skeleton reads as
obviously-unfilled rather than plausibly-wrong.

### Always run more than one mode

The most useful diagnostic this model produces is the *difference* between
reader modes:

| Result | Diagnosis |
| --- | --- |
| Passes in `study`, fails in `skim` | **Acquisition problem.** The content is fine; nobody gets far enough to find out. Nobody starts in study mode. |
| Passes in `skim`, fails in `study` | **Depth problem.** Looks good, does not survive a reader who wants the details. |
| `regression-churn` only in `study` | Definitions sit too far from their use. Skimmers never notice because skimmers never look things up. |

### Before you quote a number

The model's constants are **priors, not measurements** — set so its qualitative
behaviour matches evidenced things (working-memory limits, regression rates),
not fitted to a corpus of documents with known abandonment. Rank nodes with it,
compare revisions with it, and say *"the model ranks Chapter 2 as the biggest
shedding point"* — never *"62% of readers quit at Chapter 2."* The full
calibration discussion, and the list of ways the model is knowingly wrong
(memorylessness, no learning, subjective scoring, uniform teleport), is in
`references/random-surfer-reader.md`. Put the relevant parts in the report.

### Reader maps: following the routes the document prescribes

Many technical books open with a "Reader's Map": *practitioners read 1, 3, 7, 9;
theorists read 1, 2, 4-6.* Docs sites do the same thing with role tiles. Each
route is a **promise made to a named kind of person**, and it is the only part
of a document that can be broken without any single page being wrong.

Encode each route as a `readerPaths` entry - the ordered nodes exactly as
printed, the vocational persona it addresses, and *that reader's* patience
budget and reading mode, which are usually not the book's. Each route is then
evaluated as its own surface: the same chain, restricted to the prescribed
nodes in the prescribed order.

The finding this exists for:

> **Broken-by-map prerequisite** - the route skips the chapter that introduces
> a concept a later chapter on the route needs. The book reads perfectly in
> order, so nobody reading linearly will ever notice, the author least of all.
> Every reader who trusted the map hits a wall and concludes the book is over
> their head.

The model separates that from a concept nothing introduces anywhere, because
the fixes differ: one needs new material, the other needs the map fixed - or a
boxed gloss for readers arriving by that route.

**A shorter route completes more and teaches less.** In
`examples/surfer-latex-book.json` the practitioner route completes at 61% and
the full theorist route at 36%, and the practitioner route is the broken one.
Read a route in this order: does it reach a payoff, does it carry its own
prerequisites, does it fit this reader's budget - *then* how many finish.

Full doctrine, the four failure modes, and how to hand routes to the appeal
side: `references/reader-maps.md`.

## Gestalt Grouping

The visual system decides what belongs with what *before* anyone reads a word.
That makes Gestalt the right vocabulary for wireframes — which have no colour
and no copy, so form is all there is — and for document pages, where the same
laws decide whether a definition box reads as one idea or three.

**Gestalt grouping is the transition prior in the surfer model.** Grouping does
not merely make a layout pretty; it determines where the eye goes next, which
is a probability, which is a row in the chain. A layout whose grouping
contradicts its content structure routes readers to the wrong place.

Nearly every real defect is **two cues disagreeing** — proximity groups A+B
while similarity groups A+C — because the visual system must pick a winner and
the reader experiences the loss as vague unease rather than a locatable bug.
The detection procedure is one line: write down the groups the *content* has,
squint at the layout and write down the groups the *form* has, and report every
mismatch. Per-principle detection rules, scoring guidance for the `gestalt`
block, and per-surface notes: `references/gestalt-operators.md`.

## Comprehension Debt

For documents, the dominant friction is not clicks — it is ideas arriving with
nowhere to land. Entropy is not the enemy; *unintroduced* entropy is.

| Defect | Definition |
| --- | --- |
| **Dangling prerequisite** | Required somewhere, introduced nowhere. |
| **Forward reference** | Used before the node that introduces it. |
| **Working-set overflow** | More than ~4 freshly-introduced concepts in play at once (Cowan, 2001). |
| **Definition distance** | The gap between introduction and use. Costly at *both* ends — too far and it is forgotten, too close and nothing consolidated. |
| **Entropy cliff** | Load jumps sharply between adjacent nodes. |
| **Undeclared background** | The document assumes a body of knowledge it never states, so readers self-select wrongly and then blame themselves. |

"Introduced" is not binary. The **introduction ladder** — named, defined,
motivated, exemplified, contrasted — is the tool for catching a document that
technically introduced everything and still cannot be read. Anything on the path
to a payoff needs to be *exemplified*, not merely defined. Full ladder, the
procedure for counting concepts without falling for the curse of knowledge, and
the prose tells worth pausing on: `references/comprehension-debt.md`.

## Quality Gates

Before considering a UX friction audit complete, verify the quantitative
metrics, user-experience validation, and design-system compliance checklists
in `references/quality-gates.md`. The mechanical subset of those gates
(touch-target size, 320px reflow, sub-100ms feedback) is also enforced by
`scripts/friction_audit.mjs` below.

## Deterministic Audit (live flows and wireframes)

`scripts/friction_audit.mjs` checks the per-step flow gates. It is about
*interactive* surfaces - its touch-target, reflow, and feedback-latency gates
have no meaning for a book. For documents, use the surfer model above.

Encode a candidate flow as a JSON object (`steps[]` each with `label`,
`cognitiveState`, `timeSeconds`, `chunks`, `autoSaves`, `showsProgress`,
`contextPreserved`, plus flow-level `primaryActionObviousWithin3s`,
`touchTargetsMinPx`, `worksAt320pxNoHscroll`, `feedbackWithin100ms`,
`simultaneousAttentionElements`, and optional `hasPowerUserPath`) and run:

```
node scripts/friction_audit.mjs --input examples/sample-input.json
```

`auditFrictionFlow(flow)` checks the flow against all 5 failure modes above
plus the mobile/touch/feedback quality gates and returns
`{ pass, findings, recommendations }`. Use it to gate whether a flow
description is ready to ship or needs another pass — it will not catch
subjective taste issues, only the mechanical failure-mode triggers.

## NOT-FOR Boundaries

**Do NOT use this skill for:**

- **Visual design execution** → Use [web-design-expert] instead
  - Creating mockups, choosing colors, typography decisions
  - Pixel-perfect layout implementation

- **A/B testing setup or statistical analysis** → Use [frontend-developer] + [data-analyst] instead
  - Test implementation, traffic splitting, conversion tracking
  - Statistical significance calculations, test result interpretation

- **Accessibility compliance auditing** → Use [accessibility-auditor] instead
  - WCAG checklist verification, screen reader testing
  - Legal compliance documentation, remediation prioritization

- **Technical performance optimization** → Use [frontend-developer] instead
  - Code optimization, bundle splitting, caching strategies
  - Database query optimization, API response times

- **User research methodology** → Use [user-researcher] instead
  - Interview guide creation, survey design, usability testing protocols
  - Qualitative data analysis, persona development from research

**Boundary Decision Rule**: If the task requires specialized domain expertise beyond UX psychology and cognitive principles, delegate to the appropriate specialist skill.

## References

| File | Load When |
| --- | --- |
| `references/random-surfer-reader.md` | Need what the surfer model computes, what its numbers mean, how to calibrate it, and where it is knowingly wrong. **Read before quoting any number it produces.** |
| `references/reader-maps.md` | The document tells readers how to read it - a Reader's Map, role tracks, "if you are a practitioner start at Chapter 7". |
| `references/surface-adapters.md` | Auditing a wireframe, PDF, or LaTeX book - how to encode it, and what that surface cannot tell you. |
| `references/gestalt-operators.md` | Scoring a node's `gestalt` block, or need to say *why* a layout feels cluttered in terms someone can act on. |
| `references/comprehension-debt.md` | Auditing a technical document: the introduction ladder, counting concepts, entropy cliffs, definition distance. |
| `references/reading-models.md` | Estimating `costSeconds`, choosing reader modes, or predicting scanpaths and entry points. |
| `references/worked-examples.md` | Need the two full journey-simulation worked examples (ADHD checkout, SaaS dashboard report). |
| `references/quality-gates.md` | Need the full quantitative/UX/design-system checklist before declaring an audit complete. |
| `examples/sample-input.json` | Need a passing flow spec to copy as a starting point. |
| `examples/surfer-wireframe.json` | Need a clean surface graph to copy - a four-frame wireframe that passes. |
| `examples/surfer-latex-book.json` | Need a failing surface graph - a monograph that front-loads formalism and buries its theorem. |
| `examples/expected-output.md` | Need the shape of a finished friction-audit report. |
| `templates/output-template.md` | Need a reusable audit-report template to fill in. |
| `schemas/flow-audit.schema.json` | Need to validate a flow spec's structure programmatically. |
| `schemas/surface-graph.schema.json` | Need to validate a surface graph's structure, or need the per-field guidance for building one. |
| `scripts/friction_audit.mjs` | Need deterministic scoring of an interactive flow spec against the 5 flow failure modes and the mobile/touch/feedback gates. |
| `scripts/surfer_model.mjs` | Need attention mass, reach probability, time-to-first-insight, regression churn, and the median exit node for any surface. |
| `scripts/latex_skeleton.mjs` | Need to build a book's surface graph from LaTeX source instead of by hand. |
| `agents/openai.yaml` | Need a subagent descriptor for delegated friction auditing. |

## Layout QA gate (mechanical — run before shipping)

Before calling any rendered page, artifact, dashboard, deck, or component done,
run the mechanical overflow/collision checker. It renders the page headlessly and
flags text-vs-text collisions, clipped/ellipsis-truncated elements, text escaping
its container, and horizontal page scroll — the visual defects a screenshot hides
and that only appear at a specific width or in one theme.

Resolve `layout-overflow-guard` from the active skill catalog before running it.
The command below shows the standard Claude install path; use the path reported
by your harness. If the skill is absent, install or sync it instead of skipping
this gate.

```bash
python3 ~/.claude/skills/layout-overflow-guard/scripts/check_layout.py <file-or-url> \
  --widths 1280,1100,860,720,390 --themes light,dark
```

You do **not** need to read `check_layout.py` — invoke it with the Bash tool and
act on its report and exit code (non-zero = a defect). The script's source never
enters your context; only its findings do. Drive it to zero violations across
every width and both themes before you ship. Full detail: the
`layout-overflow-guard` skill.

<!-- BEGIN BUNDLE INDEX (auto: index_references.py) -->

## Skill Bundle Index

*Every file in this skill, and when to open it. Auto-generated; run `scripts/index_references.py --fix`.*

**root**
- [`CHANGELOG.md`](CHANGELOG.md) — UX Friction Analyzer — Changelog — Extends the skill from live web flows to **any surface a person has to get through**: wireframes, PDF documents, and LaTeX books.
- [`README.md`](README.md) — UX Friction Analyzer — Friction analysis for anything a person has to get through: a live web flow, a wireframe, a PDF report, or a 400-page technical book.

**`agents/`**
- [`agents/openai.yaml`](agents/openai.yaml) — openai (data/schema)

**`examples/`**
- [`examples/expected-output.md`](examples/expected-output.md) — Example Output: UX Friction Audit — Scenario: auditing the optimized 3-step checkout flow in `references/worked-examples.md` (Example 1) — the flow *after* the friction fixes w
- [`examples/sample-input.json`](examples/sample-input.json) — sample input (data/schema)
- [`examples/surfer-latex-book.json`](examples/surfer-latex-book.json) — surfer latex book (data/schema)
- [`examples/surfer-wireframe.json`](examples/surfer-wireframe.json) — surfer wireframe (data/schema)

**`references/`**
- [`references/comprehension-debt.md`](references/comprehension-debt.md) — Comprehension Debt — Load this when auditing a technical document, a scientific book, or any surface where the question is not "can they click it" but "can they 
- [`references/gestalt-operators.md`](references/gestalt-operators.md) — Gestalt Operators — Load this when scoring a node's `gestalt` block, or when a surface "feels cluttered" and you need to say *why* in terms someone can act on.
- [`references/quality-gates.md`](references/quality-gates.md) — Quality Gates — Use this when you need the full checklist before declaring a UX friction audit complete.
- [`references/random-surfer-reader.md`](references/random-surfer-reader.md) — The Random-Surfer Reader Model — Load this when you need to know *what the surfer model actually computes*, what its numbers mean, and how much to trust them.
- [`references/reader-maps.md`](references/reader-maps.md) — Reader Maps and Vocational Paths — Load this when the document tells its readers how to read it — a "Reader's Map", a "How to use this book", a role-based docs track, a "if yo
- [`references/reading-models.md`](references/reading-models.md) — Reading Models — Load this when you need to estimate *how a surface will actually be read* before encoding it as a surfer graph — where the eye lands, what g
- [`references/surface-adapters.md`](references/surface-adapters.md) — Surface Adapters — Load this when you have a surface in front of you and need to turn it into a graph for `scripts/surfer_model.mjs` — and, just as importantly
- [`references/worked-examples.md`](references/worked-examples.md) — Worked Examples — Two full journey simulations showing the failure modes and decision points from `SKILL.md` diagnosed and fixed step by step.

**`schemas/`**
- [`schemas/flow-audit.schema.json`](schemas/flow-audit.schema.json) — flow audit.schema (data/schema)
- [`schemas/surface-graph.schema.json`](schemas/surface-graph.schema.json) — surface graph.schema (data/schema)

**`scripts/`**
- [`scripts/friction_audit.mjs`](scripts/friction_audit.mjs)
- [`scripts/latex_skeleton.mjs`](scripts/latex_skeleton.mjs)
- [`scripts/surfer_model.mjs`](scripts/surfer_model.mjs)

**`templates/`**
- [`templates/output-template.md`](templates/output-template.md) — Friction Audit: [Flow Name] — [One-sentence description of the flow being audited and the user intent it serves.] **Verdict**: [PASS | FAIL] — [one-line summary of why, r

<!-- END BUNDLE INDEX -->
