# Questions — flag 4

## Q1. Does "A Homological Approach to Consensus and Fault Tolerance" exist?

FOUND (with URL and venue) or NOT FOUND. No hedging, no "something similar
exists" as a substitute answer.

If NOT FOUND: state it as **NOT FOUND — DO NOT CITE** and note that this is the
second suspected fabricated citation from the earlier sweep (flag 2 is
investigating the first). Two independent fabrications from one sweep is a
finding about the sweep, not about these two papers, and it should be recorded
as such.

If FOUND: read it, and answer whether it bears on Paper 7's results at all.

## Q2. What exactly does Herlihy–Shavit prove, in two sentences?

Needed to write the positioning sentence. Be accurate about the machinery:
simplicial complexes of process views, the asynchronous computability theorem,
and what "topological obstruction to a task's solvability" means there.

## Q3. How does Paper 7 differ from the combinatorial-topology line?

Draft the actual positioning. The honest version, which is also the favorable
one:

- **They ask**: which distributed tasks are solvable under a failure model.
  Machinery: simplicial complexes of process states, connectivity obstructions.
- **Paper 7 asks**: what an analyst can detect after the fact from partial
  gossip evidence about who lied. Machinery: cellular sheaves with real
  coefficients on a gossip graph, least-squares completion residual.

Same intellectual tradition — topology as the right language for what
distributed systems can and cannot know — different question and different
machinery. Confirm this framing is accurate before writing it; do not assert a
difference that does not hold.

## Q4. Does the combinatorial-topology literature already contain an
equivocation-detection result?

The real novelty question. Topological methods in distributed computing are
mostly about *solvability under crash and Byzantine failures*, not about
*forensic detection from partial evidence*. Confirm that, or find the exception.
If someone has already done cohomological equivocation detection, that changes
Paper 7's contribution materially and this dive is the last chance to find out
cheaply.

## Q5. Does PeerReview already characterize when an unchecked link can be
convicted?

PeerReview detects equivocation by having witnesses cross-check signed logs.
Paper 7's contribution is specifically about links that were *never* checked.
Answer whether PeerReview's witness-set construction already covers this — e.g.
whether its witness sets are chosen precisely to close the loops Paper 7's
cycles describe. If so, Paper 7's theorem may be the formal characterization of
a mechanism PeerReview built without proving, which is a good result and needs
saying that way.

## Q6. Are Paper 7's existing citations accurate?

Mechanical pass over all eight. Report any mismatch in title, venue, volume,
pages, or year. Confirm Bach 1999 says what the paper claims it says (that
\#P-hardness of sheaf cohomology concerns coherent sheaves on projective space,
not finite cellular sheaves on graphs) — this is a load-bearing pre-emption and
a mischaracterization would be embarrassing.

## Q7. Is the three-tier visibility contract already named?

Compared / relayed / severed. Check sensor fusion, data fusion, network
tomography, and Robinson's line. If a standard name exists, record it in the
renaming register.

## Q8. Drafted citation text

For `paper7.tex`'s `\section{Related work: imported, adjacent, and new}`, which
already has an "Adjacent, and honestly positioned" paragraph — the natural home
for both Herlihy–Shavit and PeerReview. Draft the sentences and the `\bibitem`
entries with verified details.
