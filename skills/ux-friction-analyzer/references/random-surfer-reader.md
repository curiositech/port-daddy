# The Random-Surfer Reader Model

Load this when you need to know *what the surfer model actually computes*,
what its numbers mean, and how much to trust them. `scripts/surfer_model.mjs`
implements it; `schemas/surface-graph.schema.json` is its input shape.

## Why a surfer, and why not a funnel

A funnel assumes everyone walks forward through the same numbered steps. Real
readers do not. They arrive in the middle, flip to the figures, give up
halfway, jump back three pages to find a symbol's definition, and skip the
proof. A funnel cannot express any of that, so it silently reports the
behaviour of the minority who behaved.

PageRank's random surfer (Brin & Page, 1998) models a web user as a Markov
chain: follow a link with probability *d*, teleport to a random page with
probability *1 − d*. The stationary distribution is where attention pools.
That is the right shape for reading, but it is missing the two behaviours that
dominate difficult documents. So this model gives the surfer four moves:

| Move | What it is | Why it earns its place |
| --- | --- | --- |
| **Continue** | Follow a link forward: next section, next screen. | The baseline. |
| **Regress** | Jump *backwards* to find something they needed and did not have. | Regressive saccades are ~10–15% of saccades even in fluent reading (Rayner, 1998) and rise sharply with difficulty. Without this term, an unintroduced idea is free. With it, an unintroduced idea costs reading time, which is the actual currency. |
| **Teleport** | Jump anywhere: skim, flip to a figure, use the index, click nav. | PageRank's damping term. Distinguishes a skimmer from a studier. |
| **Abandon** | Stop. Absorbing state. | The outcome we are actually trying to predict. |

Plus one absorbing state for success: reaching the end of a terminal node is
**DONE**.

## The chain

States are the graph's nodes plus `{DONE, ABANDON}`. This is an **absorbing
Markov chain**, so every readout is exact linear algebra on the fundamental
matrix `N = (I − Q)⁻¹` (Kemeny & Snell), not a sampled simulation. The same
input produces the same numbers every time — which is the point of putting it
in a script rather than in a vibe.

At each node *i* the row is:

```
P(abandon)  = hazard(i)                       -> ABANDON
P(regress)  = regression(i)                   -> split over earlier nodes that
                                                 introduced concepts i needs
P(teleport) = mode.teleport                   -> uniform over all nodes
P(continue) = 1 - the above                   -> split over i's outgoing links
                                                 by weight, or -> DONE if i is
                                                 terminal
```

If regression and teleport would overrun the row, they are scaled back
proportionally. `hazard` is never scaled: **giving up always wins**, because it
does in life.

### Hazard — the probability of quitting here

```
hazard(i) = clamp( baseAbandon(mode)
                 + 0.35 · comprehensionLoad(i)
                 + 0.20 · perceptualLoad(i)
                 − hookWeight(mode)   · hook(i)
                 − payoffWeight(mode) · payoff(i),
                 0.005, 0.85 )
```

Two things raise it (you are confused; you cannot see what to look at) and two
things lower it (you have been promised something; you are being paid). That
symmetry is the whole thesis of running friction and appeal on one model:
**friction is the positive terms, appeal is the negative ones.**

### Comprehension load — the "is this bombarding me" term

```
comprehensionLoad(i) = 0.45 · min(1, danglingPrereqs(i) / 3)
                     + 0.35 · min(1, newConceptsPerMinute(i) / 4)
                     + 0.20 · min(1, max(0, workingSet(i) − 4) / 4)
```

- **Dangling prerequisites** — concepts the node leans on that the document
  never introduces, *or* introduces only later (a forward reference). These are
  the reader's "wait, what is that?" moments.
- **New-concept rate** — ideas introduced per minute of reading. Past the
  saturation rate the reader is transcribing, not understanding.
- **Working-set overflow** — distinct new ideas across the recent window still
  in play, against Cowan's (2001) ~4-chunk limit rather than Miller's 7±2.

Full treatment, including how to count concepts without kidding yourself:
`references/comprehension-debt.md`.

### Perceptual load — the Gestalt term

```
perceptualLoad(i) = 0.35 · (1 − groupingClarity/10)
                  + 0.25 · (1 − figureGroundClarity/10)
                  + 0.40 · min(1, max(0, attentionElements − 4) / 4)
```

Weak grouping means the eye does segmentation work the layout should have done.
Detection rules for each score: `references/gestalt-operators.md`.

### Regression — the pull backwards

```
regression(i) = clamp( baseRegression(mode)
                     + 0.30 · normalisedMeanDistanceToPrerequisites(i),
                     0, 0.60 )
```

A definition three pages back is cheap to re-find. One in Chapter 1 of a book
you are reading in Chapter 9 is expensive, and the expense is exactly why
readers stop. If a node needs a concept that was *never* introduced, there is
nothing to regress *to*, so that pressure shows up as abandonment instead —
which is the correct and rather brutal behaviour.

## Reader modes are parameter presets, not separate models

| Mode | teleport | baseAbandon | baseRegression | Who this is |
| --- | --- | --- | --- | --- |
| `skim` | 0.35 | 0.10 | 0.02 | Deciding whether to invest at all (Keshav pass 1). |
| `scan` | 0.25 | 0.08 | 0.05 | Hunting one specific answer. Ctrl-F with eyes. |
| `study` | 0.02 | 0.03 | 0.22 | Committed linear reading, willing to re-read (Keshav pass 3). |
| `task` | 0.05 | 0.12 | 0.10 | Driving a UI toward a goal. Abandons fast, teleports little. |

**Always run more than one mode.** The single most useful diagnostic this model
produces is the *difference* between modes:

- Passes in `study`, fails in `skim` → **an acquisition problem.** The content
  is fine; nobody gets far enough to find out. Nobody starts in study mode.
- Passes in `skim`, fails in `study` → **a depth problem.** It looks good and
  does not survive contact with a reader who actually wants the details.
- `regression-churn` appears only in `study` → the definitions are too far from
  their use. Skimmers never notice because skimmers never look things up.

## What comes out

| Readout | Meaning | How it is computed |
| --- | --- | --- |
| `completion` | Share of arrivals that reach a terminal node. | Absorption probability in DONE. |
| `medianExitNode` | Where the median arrival gives up, in reading order. | First node where cumulative abandonment mass crosses 0.5. `null` if most people finish. |
| `nodes[].reachProbability` | P(this node is ever seen). | `expectedVisits[j] / N[j][j]` — exact. |
| `nodes[].attentionMass` | Share of total expected reading **time**, not visits. | `visits · costSeconds`, normalised. Time is what readers spend. |
| `payoffReach[].expectedSecondsToReach` | **Time to first insight**: seconds of reading before the readers who *do* arrive, arrive. | Doob *h*-transform of the chain conditioned on reaching the payoff; expected absorption time on the conditioned chain. Excludes the payoff node's own reading cost. |
| `regressionsPerVisit` | Backward jumps per node visited. | Expected regressions / expected visits. Above ~0.25 the reader is re-finding, not reading. |

### The two questions worth asking of a readout

1. **Where does the median reader quit, and what is the first thing they miss?**
   Everything downstream of `medianExitNode` is being written for a minority.
   Fix that node before touching anything after it.
2. **Is `expectedSecondsToReach` for the payoff inside the patience budget?**
   A payoff outside the budget is one most readers buy on credit and never
   collect.

## Calibration — read this before quoting a number

**The constants in `scripts/surfer_model.mjs` are priors, not measurements.**
They are set so the model's *qualitative* behaviour matches things that are
evidenced — working-memory limits, regression rates, the fact that skimmers
abandon faster than studiers. They are not fitted to a corpus of documents with
known abandonment rates, because no such corpus was used here.

What that licenses, and what it does not:

| Use | OK? |
| --- | --- |
| Ranking nodes within one surface by where it hurts | **Yes.** This is what it is for. |
| Comparing a before/after revision of the same surface, same parameters | **Yes.** The deltas are meaningful even when the levels are not. |
| Comparing two different surfaces analysed by the same analyst | **Cautiously.** Node granularity and scoring habits dominate. |
| Quoting "this page converts at 47%" to anyone | **No.** That number is a model output, not a measurement. Say so. |
| Comparing graphs scored by different analysts | **No.** The subjective inputs are not calibrated between people. |

To calibrate properly: instrument the real surface (scroll depth, dwell, exit
node, search-within-document events), fit `baseAbandon` and the load weights so
predicted `medianExitNode` and `completion` match observed data, then re-run.
Until someone does that, the honest sentence is *"the model ranks Chapter 2 as
the biggest shedding point"*, never *"62% of readers quit at Chapter 2."*

### Where the model is knowingly wrong

Say these out loud in the report rather than letting a reader assume otherwise.

- **Memorylessness.** A real reader who has regressed three times is more
  likely to quit than one who has not. A Markov chain has no such memory. The
  model therefore *understates* the cost of repeated confusion.
- **No learning.** A concept introduced once is treated as known forever
  afterwards. Real readers forget. The model *understates* the value of
  repetition and worked examples.
- **Scoring is subjective.** `hook`, `payoff`, and the Gestalt scores are an
  analyst's judgement. Two analysts will disagree. Record who scored it.
- **Uniform teleport.** Real jumps are structured (to figures, to the index,
  to the conclusion), not uniform. Model an important jump as an explicit link
  with a weight rather than relying on teleport to represent it.
- **Node granularity drives working-set findings.** The window is counted in
  nodes. Size a node to one reading sitting — a section, a screen, a page
  spread — not a chapter.

## Citations

- Brin, S. & Page, L. (1998). *The Anatomy of a Large-Scale Hypertextual Web
  Search Engine.* — the random surfer and damping.
- Kemeny, J. & Snell, J. L. (1976). *Finite Markov Chains.* — absorbing chains,
  the fundamental matrix.
- Rayner, K. (1998). *Eye movements in reading and information processing.* —
  fixation durations, saccade lengths, regression rates.
- Cowan, N. (2001). *The magical number 4 in short-term memory.* — the
  working-memory limit used throughout this skill.
- Sweller, J. — cognitive load theory; the intrinsic/extraneous/germane split
  used in `SKILL.md`'s decision matrix.
- Keshav, S. (2007). *How to Read a Paper.* — the three-pass reading method the
  reader modes are built on.
