# Positioning worksheet

Fill this in **before** writing the contribution paragraph, not after. Every
question here corresponds to a real failure that survived multiple careful
readings of a finished paper and was caught only by an adversarial prior-art
audit. The cost of answering them early is an hour; the cost of answering them
late is a rewritten contribution paragraph, and the cost of not answering them
is a referee doing it for you.

Copy this file per paper. Answer in prose, not checkboxes — the value is in
being forced to write the sentence.

---

## 1. The result, stated without vocabulary

State the result in one sentence, using **no term of art from the field you are
importing from**. If you cannot, you do not yet know which field owns it.

> _Result, in plain words:_

Now list every technical term you had to avoid. These are your import list, and
each one is a search key for §3.

> _Terms avoided:_

## 2. What is actually new

Complete these three sentences honestly. The third is the one that matters.

> _The machinery I import unchanged is:_
>
> _The application that is new is:_
>
> _The thing that is new **as a theorem**, if any, is:_

If the third sentence is empty, that is fine and common — say so in the paper.
A paper whose contribution is "we applied X to Y and here is what it cost" is
publishable. A paper that implies a new theorem and does not have one is not.

## 3. The vocabulary check

For each coined or repurposed term in your paper, answer:

| Your term | Does it already mean something in an adjacent field? | Same meaning, or different? | Decision |
|---|---|---|---|
| | | | adopt / gloss / rename |

**The failure this prevents.** One paper used "regimentation" as if coining it;
it is an established term of art in normative multi-agent systems meaning
exactly what the paper meant, and nobody had searched that community. Another
named a theorem "unraveling", which in information economics names a result with
the **opposite** conclusion. A referee who knows the field reads the name, forms
an expectation, and is then confused or annoyed.

Rule: if the term is taken and means the same thing, **adopt it and cite**. If
taken and means something else, **rename**. Only coin when neither applies.

## 4. Which fields could own this?

List every field whose vocabulary could describe your result, including ones you
have never read. For each, name its review article or handbook chapter, and say
whether you searched it.

| Field | Their likely word for your idea | Survey/handbook consulted? | Result |
|---|---|---|---|

**The failure this prevents.** A paper applying algebraic topology to
distributed fault tolerance cited none of the founding, Gödel-Prize-winning work
in exactly that intersection, because the search used the paper's own vocabulary
rather than that community's.

Minimum: for a result at an intersection of *n* fields, this table has at
least *n* rows, and usually *n+2* — the fields either side of your own count too.

## 5. The nearest neighbour

Name the single closest piece of prior work. Then:

> _Its main theorem, quoted verbatim with its hypotheses:_
>
> _The hypothesis on which we differ:_
>
> _If a referee says "isn't this just X?", the one-sentence answer is:_

If you cannot quote the theorem verbatim, you have not read it closely enough to
position against it. An abstract is not enough — the difference between two
results almost always lives in a hypothesis, and hypotheses are rarely in
abstracts.

**The failure this prevents.** A paper claimed a characterization as its
contribution; a 2013 paper had already given the same characterization on the
same alphabet split, and even identified the same classical result as its
degenerate case. It was found only because a third paper's related-work section
mentioned it in passing.

## 6. What the nearest neighbour left open

Often the honest contribution is not "we proved something new" but "we closed a
question they explicitly left open". That is a strong claim **when it is true and
quoted**.

> _Verbatim, what they say is open:_
>
> _Do we in fact close it? Fully, or in one direction?_

## 7. Degenerate cases

For every "iff", "exactly", "unique", "optimal", "always", "never" in your
abstract, name the degenerate case and confirm the claim survives it.

| Claim | Degenerate case (empty, zero, singleton, trivial) | Survives? |
|---|---|---|

**The failure this prevents.** A boxed "iff" was false at the empty set — the
nonemptiness hypothesis was missing. Another theorem's stated optimum was
infeasible under the paper's own definition of its variables, because a bound
implied by the definition was never written down.

## 8. Arithmetic that the prose promises

List every quantitative or asymptotic word in the abstract and contributions,
and confirm the proof delivers exactly that word.

| Word used | What the proof actually gives | Match? |
|---|---|---|

**The failure this prevents.** "Finite bond capital certifies a tower of
**unbounded depth**" appeared in five places in a paper whose own proof gives a
finite, logarithmic depth. And a claimed counter-case ("a homogeneous pool
*provably does not* supply the contraction") was contradicted by running the
paper's own recursion — it does, just twice as slowly.

Run the numbers yourself. Do not trust the sweep: a verification sweep that
restates the inequality it is testing cannot fail, and several did.

## 9. The venue

> _Target venue:_
>
> _What that community expects in the first two pages:_
>
> _The most likely desk-reject reason, and what I did about it:_

## 10. Sign-off

Before the contribution paragraph is written, confirm:

- [ ] §2's third sentence is either substantiated or explicitly conceded in the paper
- [ ] Every row of §3 has a decision, and the paper acts on it
- [ ] §4 has a row for every field, and each row says what was searched
- [ ] §5's theorem is quoted from the source, not from an abstract
- [ ] §7 and §8 have no unresolved rows
- [ ] `submission_lint.py` reports zero errors and every claim-to-confirm is answered
