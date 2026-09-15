# Comprehension Debt

Load this when auditing a technical document, a scientific book, or any
surface where the question is not "can they click it" but "can they follow
it". This is where `requiresConcepts`, `newConcepts`, and the comprehension
load term in the surfer model come from.

## Entropy is not the enemy; unintroduced entropy is

A document that surprises you constantly is exhausting. A document that never
surprises you is not worth reading. What separates the two is not the *amount*
of new information but whether each new thing arrives with somewhere to put it.

Borrowing the information-theoretic framing: reading is a stream of surprisal.
A well-built document holds surprisal inside a band — high enough that the
reader is learning, low enough that each surprise resolves against something
already in memory. Both edges of the band are failures:

| Condition | Reader's experience | Surfer-model consequence |
| --- | --- | --- |
| Surprisal too **low** | "I already knew this. Skipping." | Teleport and skim dominate; the reader leaves before the part that was new. |
| Surprisal in band | "This is dense but I'm getting it." | Low hazard, low regression. |
| Surprisal too **high**, *scaffolded* | "Hard, but I can see where it's going." | Higher `costSeconds`, moderate hazard. Acceptable. |
| Surprisal too **high**, *unscaffolded* | "I don't know what half these words mean." | Dangling prerequisites, working-set overflow, regression churn, abandonment. |

The last row is what "bombarded by high-entropy writing that doesn't introduce
its ideas" means precisely, and it is what the model charges for. **The defect
is never that an idea is hard. It is that the idea arrived without a place to
land.**

## The introduction ladder

"Introduced" is not binary. A term can be introduced at six different
strengths, and the right strength depends on how load-bearing the term is.

| Level | What the document did | Sufficient for |
| --- | --- | --- |
| **L0** | Used the concept without naming it at all. | Nothing. This is a defect. |
| **L1 — Named** | The word appears; no definition. | A term mentioned once in passing, *with an inline gloss*. |
| **L2 — Defined** | A formal or explicit definition is given. | A term used a few times in a narrow region. |
| **L3 — Motivated** | Why it exists / what problem it solves is given, before or with the definition. | Any term the reader must *remember* past the section that defines it. |
| **L4 — Exemplified** | At least one concrete instance, worked example, or figure. | Any term on the path to a payoff node. |
| **L5 — Contrasted** | The nearest confusable thing is explicitly distinguished. | Any term readers are known to confuse with a neighbour. |

**The rule worth enforcing:** every concept in `requiresConcepts` for a payoff
node should have been introduced at **L3 or higher**, and anything the reader
must actively *use* rather than merely recognise needs **L4**. A book whose
central objects are defined at L2 and never exemplified is a book that will be
described as "rigorous but impenetrable", which is a polite way of saying most
people stopped.

When you record a concept in `newConcepts`, record its ladder level in your
notes. The surfer model only knows *whether* a concept was introduced; the
ladder is how you catch a document that technically introduced everything and
still cannot be read.

## The measurable defects

| Defect | Definition | Why it costs | Script finding |
| --- | --- | --- | --- |
| **Dangling prerequisite** | Concept is required somewhere and introduced nowhere in the document. | The reader must leave to resolve it, and most leaving is permanent. | `unintroduced-prerequisite` |
| **Forward reference** | Concept is used before the node that introduces it. | "As we will see in Chapter 7" is a promissory note the reader cannot cash now. | `forward-reference` |
| **Working-set overflow** | More than ~4 freshly-introduced concepts in play at once. | Cowan's limit. Past it, the reader is not holding the argument, only the last piece of it. | `working-set-overflow` |
| **Definition distance** | The gap between where a concept is introduced and where it is used. | Long distance means regression: scrolling back, searching, losing place. | feeds `regression-churn` |
| **Entropy cliff** | Comprehension load jumps sharply from one node to the next. | The page where a reader stops feeling slow and starts feeling stupid. Abandonment concentrates here. | `entropy-cliff` |
| **Undeclared background** | The document assumes a body of knowledge it never states. | Readers self-select wrongly, then blame themselves. Honest prerequisites are a kindness *and* raise completion, because the people who stay are the people who can finish. | reported via dangling prerequisites |

### Definition latency, in both directions

Distance between introduction and first real use is bad at **both** ends:

- **Too long** → the reader has forgotten it. Costs a regression.
- **Too short (zero)** → defined and immediately used with no beat in between.
  Nothing was consolidated; the definition was transcribed, not learned. This is
  the **definition avalanche** — a run of definitions with no example between
  them. It reads as rigorous and teaches nothing.

The healthy shape is: motivate → define → exemplify → *then* use. The
avalanche skips the middle two and the reader pays for it three pages later.

## Counting concepts without kidding yourself

The model's inputs are concept lists, so this procedure is the actual work.
Do it in this order:

1. **Read in `skim` mode first.** Go through at the speed of someone deciding
   whether to bother. Note every term that makes you pause. That list is your
   candidate set, and it is generated *before* you have learned the document —
   which is the only time you can still see it the way a reader will.
2. **Then read properly**, and for each candidate record: where it is first
   introduced, at what ladder level, and every node that requires it.
3. **Add the ones you didn't pause on.** This is the hard part, and it is the
   curse of knowledge: you cannot feel the absence of a definition for
   something you already know. Two defences that actually work:
   - Ask *"where in this document is this defined?"* for every technical term
     in a payoff node, and require yourself to name the node. "It's standard"
     is not an answer; it is a dangling prerequisite with a defence.
   - Check the document's own declared audience. Every term outside that
     audience's stated background is either a dangling prerequisite or an
     admission the declared audience is wrong.
4. **Use stable labels.** The concept strings are arbitrary; only identity
   across nodes matters. Pick one spelling per concept and keep it.
5. **Do not count synonyms as separate concepts** — but *do* note when a
   document uses two names for one thing without saying so. That is a genuine
   defect (a similarity-cue conflict, in Gestalt terms) even though it does not
   show up in the arithmetic.

## Prose tells worth pausing on

These are instructions for *you*, reading the document — not pattern-matching
rules for a script. This skill's scripts deliberately perform no lexical
matching over unstructured content; judgement stays with the analyst.

- **"Clearly", "obviously", "it is easy to see", "trivially".** In technical
  writing these mark the exact places the author stopped explaining. Check each
  one: is the step actually easy, or did the author's familiarity erase it?
  A reader who does not find it obvious now has two problems, and the second
  one is about themselves.
- **"Recall that…"** — check whether the document ever said it. "Recall"
  introducing something for the first time is a dangling prerequisite wearing
  a disguise.
- **"As we will see in §N"** — a forward reference. Count it.
- **A symbol appearing in a display equation that appears nowhere else.**
  Either it needed defining or it needed removing.
- **An analogy to an unnamed field.** "This is just the Fourier picture" is L1
  for a reader who knows, and L0 for one who doesn't.

## What this model deliberately does not do

**It does not compute language-model surprisal.** You could, in principle,
score a document's per-token surprisal under an LM and get a genuine
information-theoretic curve. That would be a much better calibration
instrument than the proxies here, and it is a reasonable future direction.

It is not what this skill does today, for two reasons worth stating plainly:
a raw surprisal curve cannot distinguish *unscaffolded* novelty (a defect) from
*scaffolded* novelty (the point of the book), which is the distinction the whole
file is about; and this repository bans keyword and substring lists for
classification over unstructured content, so the cheap lexical approximation is
off the table by policy as well as by merit. The concept lists are an analyst's
structured judgement, and the script does arithmetic on them. Do not describe
the output as an information-theoretic measurement. It is a model with an
information-theoretic motivation.

## Citations

- Cowan, N. (2001). *The magical number 4 in short-term memory.*
- Sweller, J. — cognitive load theory; intrinsic vs. extraneous load is exactly
  the distinction between "this idea is hard" and "this page made it harder".
- Shannon, C. (1948). — surprisal and entropy, as the framing borrowed above.
- Loewenstein, G. (1994). *The psychology of curiosity* — the information-gap
  account of why the surprisal band has a lower edge as well as an upper one.
- Camerer, Loewenstein & Weber (1989). — the curse of knowledge, the reason
  step 3 above needs a procedure rather than good intentions.
