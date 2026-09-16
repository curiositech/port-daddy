# Appeal in Technical Documents and Scientific Books

Load this when the thing being evaluated is a paper, a monograph, a textbook,
an API reference, or a technical whitepaper rather than a landing page.

## Why the triangle needs a fourth vertex

The Desirability Triangle in `SKILL.md` — identity fit, problem urgency, trust
signals — transfers to technical work almost unchanged. What does not transfer
is the **price**.

A landing page asks for thirty seconds and maybe a credit card. A monograph
asks for forty hours of the reader's scarcest resource, spent before they find
out whether it was worth it. Nothing in the triangle prices effort, so on
technical material the triangle systematically flatters documents that are
fascinating, rigorous, trustworthy, and never finished by anyone.

So for technical documents the triangle becomes a tetrahedron:

```
                  IDENTITY FIT
                "written for someone like me"
                        /|\
                       / | \
                      /  |  \
                     /   |   \
                    /  ★ | ★  \
                   / DESIRE    \
                  /   /     \   \
        PROBLEM  /___/_______\___\  TRUST
        URGENCY      \  ...  /       "this is correct
    "this matters"    \     /         and careful"
                       \   /
                        \ /
                  RETURN ON EFFORT
              "I can see what I get, and
               roughly what it costs me"
```

**Return on Effort** has three components, each scored 0–10:

| Component | Question | Failure looks like |
| --- | --- | --- |
| **Time to first insight** | How long until this pays me *anything*? | 200 pages of machinery before the first result you could use. |
| **Cost transparency** | Does it tell me what it will cost — length, difficulty, required background? | "Assumes only basic familiarity with measure theory." |
| **Payoff visibility** | Can I see the destination from where I'm standing? | A table of contents of nouns, with no indication which chapters carry the goods. |

The most actionable number in the whole analysis is **time to first insight
against the reader's patience budget**. `ux-friction-analyzer`'s surfer model
computes it exactly (`payoffReach[].expectedSecondsToReach`), for the readers
who actually arrive. A payoff outside the budget is one most readers buy on
credit and never collect.

## The 30-Second Shelf Test

The technical analogue of the 5-Second Test. A prospective reader picks the
book up in a shop, or opens the sample PDF, and gives it about half a minute.
Five questions, not four — because a technical reader has both a real
alternative (the standard reference) and a real cost.

1. **What is this about?** — the subject.
2. **Who is it for, and am I that person?** — level and prerequisites.
3. **What will I be able to do after?** — the promise, stated as a capability.
4. **What does it cost me?** — length, difficulty, assumed background.
5. **Why this one and not the standard reference?** — differentiation.

| Result | Score | Action |
| --- | --- | --- |
| All 5 clear | 9–10 | Ship it. |
| 4 of 5 | 7–8 | Fix the gap; usually (5). |
| 3 of 5 | 5–6 | The preface is doing a job the cover should do. |
| 2 or fewer | 0–4 | Nobody is choosing this on purpose. |

### The random-page test

Then open to a random page in the middle and give it fifteen seconds. Can you
tell what is going on? Is there a figure? Is the notation legible without
scrolling back? This is not a nicety — **most readers of searchable technical
material enter mid-document**, from a search hit or a shared link, and never
see page one. A book that only makes sense from the beginning has one entry
point in a world that will give it many.

## Figures are the hero image

Readers of scientific material go **abstract → figures → conclusions →
methods**, in roughly that order. The figures are not illustrations of the
argument; for a large fraction of readers they *are* the encounter with the
argument.

That relocates one of `SKILL.md`'s anti-patterns. "Screenshot Hero" said: do
not show a bare product screenshot, because strangers do not understand your
UI. The technical analogue is sharper, because here the figure genuinely is the
right hero — it just has to be **self-contained**:

- The caption states the finding, not the file name. "Figure 3: Throughput vs.
  concurrency" is a label. "Figure 3: Throughput saturates at 8 workers;
  beyond that, added workers cost latency without adding throughput" is a hero.
- Axes are labelled with units. Every series is distinguishable without colour.
- The figure can be understood without reading the surrounding prose — because
  it will be.

A document whose figures need the body text to make sense has thrown away its
best entry point and its strongest appeal signal at once.

## Trust signals, and their cheap fakes

Trust in technical work is not testimonials. It is evidence that the author
checked. Each of these has a counterfeit that costs nothing to produce, and
knowing the counterfeit is what makes the signal useful.

| Signal | Why it reads as credible | The cheap fake |
| --- | --- | --- |
| Released code **and** data | The claims are checkable by a stranger | A repository with a README, a licence, and no runnable code |
| Pinned versions and a reproduction script | Someone actually re-ran it | "Should work with recent versions of the usual libraries" |
| Uncertainty on every number | The author knows what they do not know | Three significant figures on an estimate with no error bar |
| A limitations section naming a real weakness | They went looking for the failure | A limitations section that only lists future work |
| Negative or null results reported | Not selecting for the story | — |
| Citations that engage with what they cite | Read, not padded | A citation wall: twelve references for one uncontroversial sentence |
| Consistent notation and proper mathematical setting | Care here predicts care elsewhere | — |

### Typography is a trust signal, and pretending otherwise does not help

A document with inconsistent notation, mis-set mathematics, default Word
styling, and figures screenshotted from a spreadsheet reads as less credible
than the same content set well — even to readers who would insist, correctly,
that it should not. This is the "Professional execution" row of the trust
triangle, and on technical material it is doing more work than anywhere else,
because the reader has no other cheap proxy for care.

Say this in the report plainly. The alternative is a revision that fixes the
argument and leaves the strongest available credibility signal unclaimed.

## Identity fit: the implied reader

The single most common appeal defect in technical writing is not being hard.
It is **refusing to say who it is for**.

- **"For researchers and practitioners alike"** is the technical version of
  homepage identity mismatch. It targets nobody. Practitioners want the
  recipe; researchers want the proof; a document that promises both usually
  delivers a diluted version of each.
- **Undeclared prerequisites** make readers self-select wrongly and then blame
  themselves. Declaring prerequisites honestly *raises* completion, because the
  readers who stay are the readers who can finish. It feels like turning people
  away. It is turning away the people who were going to abandon at Chapter 3.
- **Dishonest prerequisites** are worse than none. "Assumes only basic
  familiarity with X" where X is a graduate course is a promise the book breaks
  on page 40, and breaking it costs trust as well as readers.
- **Notation conventions signal field membership** the way visual identity does
  on a landing page. A reader from an adjacent field who cannot recognise the
  conventions concludes, correctly, that they are not the audience.

## The technical trust ladder

The rungs from `references/trust-ladder.md`, re-based. Each requires more than
the last, and asking for a later rung before earning the earlier ones is the
Trust Ladder Violation in its technical form.

| Rung | What the reader does | What earns it |
| --- | --- | --- |
| 1 | Recognises the subject | An honest title; an abstract that names the problem |
| 2 | Believes there is a result | An abstract that states the finding, not the organisation |
| 3 | Finds something they want | A TOC and figures that show where the goods are |
| 4 | Reads one page and follows it | Prose that introduces before it uses |
| 5 | Invests a chapter | A payoff inside the patience budget |
| 6 | **Stakes their own work on it** | Reproducibility, honest limitations, engaged citations |

Rung 6 is the one with no landing-page equivalent. Paying money is a smaller
commitment than building your next paper on someone's result, and technical
readers know it.

## Anti-patterns, mapped from the landing-page originals

Each of `SKILL.md`'s four anti-patterns has an exact technical analogue.

| Landing-page anti-pattern | Technical-document analogue | Detection |
| --- | --- | --- |
| **Feature Soup Headline** | **Theorem dump** — results listed with no intuition, no proof sketch, no reason to care | Abstract or chapter opening enumerates results rather than promising an understanding |
| **Screenshot Hero** | **Non-self-contained figure** — or no figures at all | Caption is a label, not a finding; figure cannot be read alone |
| **Trust Ladder Violation** | **Front-loaded formalism** — machinery demanded before the motivation that justifies it | The first payoff sits outside the patience budget |
| **Identity Mismatch** | **"For researchers and practitioners alike"** | No declared audience, or a declared audience of everyone |

And four with no landing-page ancestor:

- **Structural abstract.** "In Section 2 we introduce… In Section 3 we prove…"
  describes the document's organisation instead of its finding. It is the most
  common single appeal defect in academic writing, and it is free to fix: state
  the result.
- **The unlocatable contribution.** A reader cannot tell what is new here
  versus what is standard. Every reader who must ask is a reader deciding
  whether to trust you on it.
- **Definition avalanche.** A run of definitions with no example between them.
  It reads as rigour and signals "this will not reward you soon." (The friction
  cost is in `ux-friction-analyzer`'s `references/comprehension-debt.md`; the
  *appeal* cost is the promise it makes about the next hundred pages.)
- **Citation wall as social proof.** The technical version of logo soup: twelve
  references attached to one uncontroversial sentence. It signals anxiety, not
  authority.

## Reader maps: one route per vocational identity

A book that prints a Reader's Map — *practitioners read 1, 3, 7, 9; theorists
read 1, 2, 4–6* — has made a separate promise to each named kind of working
life. Score them separately, because they succeed and fail separately.

Match each of your personas to the route the document prints for them, then
ask four things of each pairing:

1. **Does this persona have a route at all?** A persona with no route will read
   the book in the order it happens to be printed, which is the order written
   for somebody else.
2. **Does the route reward *this* reader?** A practitioner track whose payoff
   is the existence proof has named a reader and rewarded a different one.
3. **Does it fit this reader's budget?** The book's overall patience budget is
   nobody's. A practitioner has an afternoon; the theorist has a term. Score
   time-to-first-insight per route, against per-route budgets.
4. **Does the route carry its own prerequisites?** This is friction's question,
   but it lands on appeal: a reader who trusted the map and hit a wall does not
   experience that as a navigation bug. They experience it as the book being
   above them, and they stop.

Record all of this in `technicalDocument.readerMap`. The numeric fields come
straight from `ux-friction-analyzer`'s per-route readout, so the two skills are
looking at the same routes rather than two reconstructions of them.

**Do not read route completion on its own.** A shorter route completes more and
teaches less; the highest-completion route in a book is often the broken one,
precisely because it skips the chapters that would have slowed people down and
also defined the terms.

## How to actually measure appeal here

Appeal on a landing page is measured by conversion. On a book there is no
conversion event, so use these, in order of how much they are worth:

| Measure | What it tells you | Honesty note |
| --- | --- | --- |
| **Payoff reach probability** (surfer model, `skim` mode) | What fraction of arrivals reach the thing worth reading | A model output, not a measurement. Say so. |
| **Time to first insight vs. patience budget** | Whether the payoff lands while anyone is still there | Same. The budget is usually an assumption — state where it came from. |
| **30-Second Shelf Test, run on a real stranger** | Whether the document sells itself without you in the room | The only item on this list that is a measurement. Do it. |
| **Random-page test on three random pages** | Whether mid-document entry works | Cheap, and the closest thing to how the document will be used. |
| **Downstream: citation, assignment, linking** | Whether anyone staked work on it | Real, but lagging by years and confounded by reputation. |

**The confound worth stating out loud in every report:** for scientific work, a
large share of appeal is determined outside the document — the author's
standing, the field's current attention, whether a course assigns it. A
well-built book by an unknown author in an unfashionable subfield will
underperform a badly-built one by a famous author, and no analysis in this
skill changes that. What this analysis can do is remove the reasons a reader
who *did* pick it up puts it down. Do not let a scorecard imply more.
