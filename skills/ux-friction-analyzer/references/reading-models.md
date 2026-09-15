# Reading Models

Load this when you need to estimate *how a surface will actually be read*
before encoding it as a surfer graph — where the eye lands, what gets skipped,
and what `costSeconds` to put on a node.

The mistake this file exists to prevent: assuming readers read. They mostly do
not. They sample, and the sampling has structure.

## Scanpath patterns

Named patterns from eye-tracking work (Nielsen, 2006, and the Nielsen Norman
Group's later pattern catalogue). Which one a page produces is a **property of
the layout**, and it tells you what the layout is teaching people to ignore.

| Pattern | Shape | What produced it | Consequence for the graph |
| --- | --- | --- | --- |
| **F-pattern** | Two horizontal sweeps, then a vertical scan down the left. | Undifferentiated text with no visual hierarchy. | Anything on the right or below the second sweep has low effective reach. Weight links out of the top-left region higher. |
| **Layer-cake** | Eye moves heading → heading, dipping into body text selectively. | Good headings, meaningful subheads. | The *headings* are the real nodes. Body text is only read when a heading earns it. Model the heading's `hook` as what controls entry into the body. |
| **Spotted** | Fixations scattered on links, numbers, bolded words. | Reader is hunting a specific fact. | This is `scan` mode. Findability beats prose quality. |
| **Marking** | Eye holds position while scrolling, as a placeholder. | Long single-column content. | Continuity matters more than grouping here. |
| **Bypassing** | Deliberately skipping first words of lines. | Repetitive line openings in a list. | Vary list-item openings, or the list is not read. |
| **Commitment** | Genuine full reading, fixation by fixation. | High motivation *and* low friction. | The only mode where dense prose is actually absorbed. Rare. Never assume it. |

**The F-pattern is a symptom, not a target.** A page that produces an F-pattern
is a page whose hierarchy failed. The fix is not "put things in the F"; it is
headings and grouping strong enough to produce layer-cake instead.

## Serial position

Within any list, sequence, or set of options, the first and last items get
disproportionate attention and recall (primacy and recency); the middle is
where things go to be ignored. This applies to nav items, pricing tiers, list
items, chapter sequences, and the sections of a paper.

**Practical rule:** never put the thing you most need read in the middle of a
list of five. If your surfer readout shows a payoff node with low
`attentionMass` despite high `reachProbability`, check whether it is sitting in
a serial-position trough.

## Estimating `costSeconds`

Reading rate is the single input most often set wrong, and it drives
time-to-first-insight, patience-budget findings, and attention mass.

| Material | Rule-of-thumb rate | Notes |
| --- | --- | --- |
| Ordinary non-fiction prose, silent | ~200–250 wpm | Well-established for adult silent reading. |
| Technical prose with defined terms | ~100–150 wpm | Each new term costs a beat. |
| Mathematics, dense notation, proofs | ~30–100 wpm | Unreliable to estimate; prefer timing yourself on a representative page. |
| Code listing | Do not use wpm | Estimate per line, or per logical block. |
| Figure with a self-contained caption | 10–30 s | A figure people actually stop at is a payoff node. |
| UI screen, familiar pattern | 3–10 s | Add form-filling time separately. |
| UI screen, novel pattern | 15–45 s | Orientation cost is the bulk of it. |

The rates above are rules of thumb, not measurements from a study of your
document. When a finding hinges on `costSeconds`, time a representative page
yourself and say so in the report.

## Reader modes as reading occasions

The four modes in `scripts/surfer_model.mjs` are the four occasions on which
someone opens a technical surface. The three-pass method from Keshav's *How to
Read a Paper* (2007) maps almost exactly:

| Occasion | Mode | Keshav pass | Question being answered |
| --- | --- | --- | --- |
| "Is this even relevant to me?" | `skim` | Pass 1 — title, abstract, headings, conclusions, ~5–10 min | Should I spend more time here? |
| "I need one specific fact." | `scan` | — | Where is the thing? |
| "I am going to actually learn this." | `study` | Pass 3 — reconstruct the argument | Do I believe it, and can I use it? |
| "I am trying to get something done." | `task` | — | What do I click next? |

**Every technical surface is judged in `skim` mode first, by someone who has
not decided to care yet.** A book, paper, or docs site that only performs well
in `study` mode has not failed at teaching — it has failed at acquisition, and
the teaching never gets tested. Run `skim` first, always.

## Entry points: readers do not start at page one

Modelling a book as entered only at its cover is usually wrong. Real entry
distributions for technical material:

- **Search hit mid-document.** The reader lands in section 6.3 with no context
  and every prerequisite dangling. This is the single most common entry for
  documentation and for any book with a searchable PDF — and it is the entry
  under which "we defined that in Chapter 2" is a dead end.
- **Figure-first.** Readers of scientific papers routinely go
  abstract → figures → conclusions → methods, in that order. The figures are an
  entry point, not an illustration. A figure whose caption does not stand alone
  is therefore a broken entry point, not a style nit.
- **Table of contents / index.** A structured teleport. Model it as explicit
  links with weights rather than leaving it to uniform teleport.
- **Someone sent a link to one section.** Same as the search hit, but with
  social pressure to persist. Slightly lower `baseAbandon`.

Put these in `entryNodes` with weights. The finding that falls out is often the
most actionable one in the whole audit: *"entered mid-document, 4 of your 9
sections have dangling prerequisites and no local escape hatch."*

## Where this changes the graph

| Observation | Graph consequence |
| --- | --- |
| Layout produces F-pattern, not layer-cake | Lower `groupingClarity`; raise `attentionElements`; expect low reach for late nodes. |
| Content is figure-heavy and figures are self-contained | Add the figures as their own nodes with real `payoff` — they are where value lands. |
| Readers arrive from search | Add mid-document `entryNodes`; dangling prerequisites become far more expensive. |
| Headings are generic ("Background", "Discussion") | Low `hook` on those nodes: a generic heading cannot pull anyone in. |
| The document has no self-contained captions | Figures cannot serve as entry points; do not model them as ones. |

## Citations

- Nielsen, J. (2006). *F-Shaped Pattern For Reading Web Content* — and the
  Nielsen Norman Group's subsequent scanning-pattern catalogue.
- Keshav, S. (2007). *How to Read a Paper.*
- Rayner, K. (1998). *Eye movements in reading and information processing* —
  fixation and saccade behaviour underlying all of the above.
- Brysbaert, M. (2019). *How many words do we read per minute? A review and
  meta-analysis of reading rate.* — the prose figures above.
