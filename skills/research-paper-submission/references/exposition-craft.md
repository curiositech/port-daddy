# Explaining formal ideas to readers who are not specialists in them

**Read when** drafting a section that imports machinery from another field,
deciding where definitions go, stating a theorem, or writing an analogy.

Every quotation below is verbatim from a primary source that was fetched and
read. Where a claim could not be verified against primary text it is marked and
paraphrased, never quoted.

## The one thing each canonical source insists on

**Halmos, "How to Write Mathematics."** Organize before you write. The
placement rule for a result:

> "This is not to say that the theorem is to appear with no introductory
> comments, preliminary definitions, and helpful motivations. All that comes
> first; the statement comes next; and the proof comes last. The statement of a
> theorem should consist of one sentence whenever possible."

On notation, the line most often violated:

> "The best notation is no notation… A good attitude to the preparation of
> written mathematical exposition is to pretend that it is spoken. Pretend that
> you are explaining the subject to a friend on a long walk in the woods, with
> no paper available; fall back on symbolism only when it is really necessary."

And a diagnosis worth internalising — a bloated hypothesis list is a symptom:

> "A list of eight hypotheses… and a list of six conclusions do not a theorem
> make; they are a badly expounded theory… the hypotheses probably describe a
> general concept that deserves to be isolated, named, and studied."

**Knuth, Larrabee & Roberts, "Mathematical Writing."** Reduce burden per
sentence — "your sentences should flow smoothly when all but the simplest
formulas are replaced by 'blah'." Two rules people break constantly:

> "…formal definitions are not the way to explain something to a novice."

> [Ullman] "often sees a definition in Chapter 2 and its use in Chapter 5. This
> just isn't the way readers work; it's essential to keep definitions and uses
> close together. Don't be ashamed to repeat yourself if that's what it takes."

> "Numbering all displayed formulas is usually a bad idea; number the important
> ones only."

**Krantz, *A Primer of Mathematical Writing*.** The strongest case against
front-loading, grounded in learning theory rather than taste:

> "If the first couple of pages of the paper consist of technical definitions
> and technical statements of theorems, then I would wager that most potential
> readers will be discouraged."

> "In point of fact a good mathematics paper is not necessarily written in
> strict logical order… this is not the way that we learn."

> "You do not, all at once, attempt to spit out all these ideas in a single
> sentence… you build stepping stones leading to the key idea, so that the
> reader is given a chance to internalize idea *n* before going on to idea
> *(n+1)*."

**Tao.** Don't lean purely on symbols; "take advantage of the English language."
His larger contribution is the pre-rigorous / rigorous / post-rigorous framework
(below).

**Mermin, "What's Wrong with These Equations?"** Three named rules:

> "Rule 1 (Fisher's rule)… number all displayed equations. The most common
> violation… is the misguided practice of numbering only those displayed
> equations to which the text subsequently refers back."

> "Rule 2 (Good Samaritan rule)… When referring to an equation identify it by a
> phrase as well as a number. No compassionate and helpful person would herald
> the arrival of Eq. (7.38) by saying 'inserting (2.47) and (3.51) into
> (5.13)…'"

> "Rule 3 (Math Is Prose rule)… End a displayed equation with a punctuation
> mark… the equations you display are embedded in your prose and constitute an
> inseparable part of it."

**Peyton Jones, "How to Write a Great Research Paper."**

> "Conveying the intuition is primary, not secondary. Once your reader has the
> intuition, she can follow the details (but not vice versa). Even if she skips
> the details, she still takes away something valuable."

> "Introduce the problem, and your idea, using EXAMPLES and only then present
> the general case."

His diagnostic mock-example of the failure — "Consider a bifircuated
semi-lattice D, over a hyper-modulated signature S…" — which "sounds
impressive… but sends readers to sleep, and/or makes them feel stupid."

**Dreyer, "How to Write Papers So People Can Read Them."**

> "Name your baby: Give unique names to things and use them consistently…
> Just in time: Give information precisely when it is needed, not before."

**Tsitsiklis, "A Few Tips on Writing Papers with Mathematical Content."** The
closest primary source to control-theory and optimization writing:

> "Preliminaries (optional; avoid it if you can, because it increases the time
> until the reader gets to the core of the paper)"

> "Most definitions should appear right before or right after the first use of a
> symbol."

> "Theorem or lemma statements should be as short and crisp as possible. To
> accomplish this, define relevant terms, concepts, symbols, properties, etc.,
> before the formal statement."

**Berndt, "How to Write Mathematical Papers"** — captures the tension in one
page: *"Get to the purpose of your paper as soon as possible. Don't begin with a
pile of notation,"* and yet *"one of the most common complaints of referees is
that authors forget to give definitions."* The resolution is sequencing, not
omission.

**Higham's *Handbook*** — could not be obtained. Its reputation is as a
comprehensive reference manual rather than a polemic. Treat any specific claim
about its contents as unverified.

## Where definitions go

Every verified source converges, in different vocabulary, on the same rule:
**define locally, immediately before what needs it, in the smallest scope that
keeps the next statement short.** Not "define everything up front."

**A separate front-loaded Preliminaries section is disfavoured by every
practitioner source that could be verified** — Tsitsiklis marks it optional and
says avoid it; Krantz says it discourages readers; Berndt says don't open with
notation; Dreyer's "just in time" is a structural argument against batching.

What is *not* disfavoured, and is required by Halmos, Krantz and Tsitsiklis
alike, is a tight local run of definitions immediately before the result they
serve — reusing standard terminology where it exists, and citing out anything
too large to re-derive. The difference is **scope and proximity**, not whether
definitions appear.

### The technique that makes a theorem readable cold

Krantz's worked demonstration is the single most actionable move in this file.
Take a theorem with ten hypotheses; cluster them into a few named predicates;
define the predicates in the two sentences immediately preceding; the theorem
collapses to:

> "Theorem: If f is a regular, amenable, smooth function, then it operates on
> L(H) in the sense of the functional calculus."

The names are not arbitrary labels — each groups properties that already travel
together because they are jointly needed by the argument, so the reader can feel
the cluster forming before it is named.

### Introducing a definition whose point is not yet visible

Knuth et al.: *"Motivate the reader for what follows… Definition 1 is motivated
only by decree; this is somewhat riskier."*

The technique: give the smallest concrete instance of the definition's **use** —
a worked case, a picture, a one-line consequence — in the same breath as the
definition, rather than defining first and motivating pages later.

## Concrete before abstract

**Tao's three stages:**

> "The 'pre-rigorous' stage, in which mathematics is taught in an informal,
> intuitive manner, based on examples, fuzzy notions, and hand-waving… The
> 'rigorous' stage… The 'post-rigorous' stage, in which one has grown
> comfortable with all the rigorous foundations… and is now ready to revisit and
> refine one's pre-rigorous intuition on the subject, but this time with the
> intuition solidly buttressed by rigorous theory."

> "The point of rigour is not to destroy all intuition; instead, it should be
> used to destroy bad intuition while clarifying and elevating good intuition."

**The implication for writing:** the paper should model the *post-rigorous*
stage, not the rigorous one. Formalism present and checkable, always alongside
its intuitive reading. A paper showing only rigorous formalism asks every reader
to redo the second-stage labour the author already did.

Sanderson's "concrete before abstract" — find the example that guides the
audience to rediscover the general result — is the same principle from teaching
practice. `probable`; primary transcript not obtained.

## The two cognitive-load effects, and what they jointly require

**Worked-example effect** (Sweller & Cooper 1985): studying a fully worked
solution beats solving cold, for novices, on retention and transfer. Mechanism:
unguided problem-solving spends working memory on means-ends search instead of
schema-building.

**Expertise-reversal effect** (Kalyuga et al. 2003):

> "instructional guidance, which may be essential for novices, may have negative
> consequences for more experienced learners."

Because high-knowledge readers already hold the schema, extra explanation forces
them to reconcile internal and external guidance — an *additional* working-memory
load.

**Together these two settle the split-audience question.** A newcomer to your
imported machinery genuinely needs the worked example; the specialist is taxed
by it. So: **the worked example should exist and be visibly skippable** — a
labelled box, a separate subsection, an aside — rather than woven irremovably
into the main argument. Each reader then takes exactly the load they need. This
is the formal justification for the express-lane pattern that good papers in
this genre use informally.

## Analogy that survives scrutiny

Gentner & Markman, "Structure Mapping in Analogy and Comparison," *American
Psychologist* 52(1), 1997.

> "Common relations are essential to analogy; common objects are not."

> "The difference between them is that in analogy, only relational predicates
> are shared, whereas in literal similarity, both relational predicates and
> object attributes are shared."

**Systematicity** is the test:

> "Analogies tend to match connected systems of relations… A matching set of
> relations interconnected by higher order constraining relations makes a better
> analogical match than an equal number of matching relations that are
> unconnected to each other… We are not much interested in analogies that
> capture a series of coincidences, even if there are a great many of them."

And the operational consequence — an analogy earns its place by producing a
**candidate inference**:

> "Given an alignment of structure, further inferences can often be made from
> the analogy… further statements (candidate inferences) connected to the base
> system in the base can be projected into the target. These candidate
> inferences are only guesses: Their factual correctness must be checked
> separately."

Kepler used his light/motive-power analogy to generate new testable claims, and
used a *disanalogy* (does motive power undergo eclipse, as light does?) to bound
its validity.

**The failure mode** is the mere-appearance match — "comparing a planet with a
round ball" shares the attribute *round*, shares no causal structure, and is
"sharply limited in… predictive utility."

### The three-step test for a draft analogy

1. List the **relations** the analogy claims are shared. Not the objects.
2. Check systematicity: do those relations form a connected system, or a
   scattered list of one-off resemblances?
3. Derive one candidate inference from the base that you did **not** already
   know, and check whether it holds in the target.

If step 3 produces nothing non-trivial, or the inference fails, the analogy is
decoration — cut it, or label it explicitly as illustration rather than
structure.

## A genuine disagreement, preserved

Dreyer explicitly rejects Peyton Jones's opening move:

> "Alternative approach (SPJ): Eliminate Context — Start with a concrete
> example, e.g. 'Consider this Haskell code…' — If this works, it can be
> effective, but I find it often doesn't work — It assumes reader already knows
> context."

Two SIGPLAN heavyweights disagree on whether to open with a concrete example or
with motivating context. There is no consensus to report. Draft both and test on
a reader rather than assuming either wins.

## Moves that help

**Stating a theorem cold.** Under ten lines, preferably five (Krantz); one
sentence where possible (Halmos). Cluster hypotheses into named predicates.
*"Leave the chit-chat out: 'Without loss of generality we may assume…' … do not
belong in the statement of a theorem"* (Halmos). Never narrate into a theorem
and then announce "thus we have proved" — state first, prove after.

**Signposting.** Forward-reference every important part from the introduction
rather than writing "the rest of this paper is organized as follows" (SPJ). Bold
your results so page-flippers can navigate (Knuth). Order sentences old-to-new:
begin with what the reader already has, end with the new thing, which places it
in the position of emphasis (Dreyer). One paragraph, one point, point-sentence
first.

**The reader who skips.** Accept it as the default. Knuth, from watching readers
in bookstores: *"there's really nothing much you can do about the reader who
insists on starting at a random point in the middle of a text."* SPJ's
declining-readership structure makes it machinery — "Abstract (4 sentences, 100
readers)… The details (5 pages, 3 readers)". Each section should be a
self-sufficient stopping point. Label what is skippable rather than forcing
everyone through it.

**Limitations.** SPJ's principle generalises: a referee who spots an unstated
weakness concludes either that you did not know (bad) or that you knew and hid
it (worse). Name the boundary condition, name at least one regime where the
result fails or is untested, in your own voice, before a reviewer forces it.
That is the difference between a limitations section that reads as command of
the result and one that reads as a hedge.

**Notation.** No letter used only once. Don't start a sentence with a symbol.
Don't put two unrelated symbols adjacent with no word between. Don't invent
notation to compete with an existing standard — "swallow your pride" (Berndt).

## Checklist

1. Organise before writing — decide the dependency tree before the linear order.
2. State the one idea the reader should leave with, before drafting.
3. No monolithic Preliminaries. If background is unavoidable, mark it skippable.
4. Define locally, immediately before use.
5. Cluster many hypotheses into named predicates so the theorem is one sentence.
6. Intuition and a concrete example before, or braided with, the formalism.
7. Make the worked example skippable so it doesn't tax the specialist.
8. Test every analogy for systematicity; derive one candidate inference and
   check it. If none, cut or downgrade to illustration.
9. Punctuate equations as sentences; refer back by phrase, not bare number.
10. Resist symbols; never compete with standard notation.
11. Forward-reference from the introduction; bold results for scanners.
12. Write the limitations in your own voice, naming a failing regime.
13. Structure for the declining-readership curve — every section a stopping
    point.
