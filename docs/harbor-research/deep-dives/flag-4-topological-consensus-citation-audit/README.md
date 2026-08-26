# Flag 4 — a suspect citation, and a canon that is missing

**Paper**: 7, *The Cohomology of Equivocation*
(`docs/harbor-research/tex/paper7.tex`)

**Risk**: two separate problems that happen to live in the same literature. The
second is more serious than the first.

## Problem A — the suspect citation

An earlier sweep surfaced a source titled **"A Homological Approach to Consensus
and Fault Tolerance,"** described as appearing in a general-audience Brazilian
mathematics bulletin, with performance figures the finding scout itself
described as suspiciously round.

The scout flagged its own find as low-confidence and possibly fabricated. That
is the right instinct and it should be honored: **this citation must not enter
any paper, any note, or any bibliography until the actual PDF has been obtained
and read.**

Two things make it suspect beyond the round numbers. A general-audience society
bulletin is an unusual venue for a technical consensus result. And the title is
close enough to plausible-sounding that it is the kind of string a language
model produces when interpolating between real literature — "homological
approach to X" is a real title pattern, and consensus/fault-tolerance really
does have a topological literature, so a fabrication would land in exactly this
uncanny valley.

Outcome required: either a resolving URL and a read, or an explicit "not found,
do not cite."

## Problem B — the canon Paper 7 omits

Independent of Problem A, and more important: **Paper 7 does not cite
Herlihy–Shavit.**

`paper7.tex`'s bibliography runs Abramsky–Brandenburger, Curry, Hansen–Ghrist,
Robinson, Carù, Sheng et al., Spielman–Teng, Bach. Verified absent by grep:
Herlihy, Rajsbaum, Kozlov, Saks, Zaharoglou — none appear.

That is a paper applying algebraic topology to a fault-tolerance problem in
distributed computing, which does not cite the founding result of algebraic
topology applied to fault tolerance in distributed computing. Herlihy–Shavit
(JACM 1999) and Saks–Zaharoglou (SICOMP 2000) shared the 2004 Gödel Prize for
exactly this. Herlihy–Kozlov–Rajsbaum's 2013 book is the standard text.

No referee in distributed computing will pass this. It is not a novelty risk —
the results are about a different problem, and the topology is used differently
(cellular sheaves over $\mathbb{R}$ on a gossip graph, versus simplicial
complexes of process states). It is a *scholarship* gap, and it is the easiest
of all four flags to fix.

## Problem C — the systems-side prior art

While in the neighborhood: Paper 7's scenario is relays cross-checking signed
logs to catch an equivocator. That is **PeerReview** (Haeberlen, Kouznetsov,
Druschel, SOSP 2007) almost exactly, at the systems level. Paper 7 cites Sheng
et al. on BFT forensics for the attribution side, which is good and correctly
positioned, but PeerReview is the closer systems ancestor of the actual setup
and does not appear.

## What a resolution looks like

`findings.md` opens with a determination on Problem A — found or not found, no
hedging — then:

- The Herlihy–Shavit citation with its correct bibliographic details, verified,
  plus one or two sentences positioning Paper 7 against it. The positioning is
  genuinely easy and genuinely favorable: combinatorial topology of distributed
  computing characterizes *what tasks are solvable* under failure models, using
  simplicial complexes of process views; Paper 7 asks *what an analyst can
  detect after the fact* from partial gossip evidence, using cellular sheaves
  with real coefficients. Different question, different machinery, same
  intellectual tradition — and saying so is a strength, not a concession.
- A determination on whether PeerReview belongs, and the sentence if so.
- A check that Paper 7's "three-tier visibility contract" (compared / relayed /
  severed) is not already named in the distributed-computing or sensor-fusion
  literature.
- Verification that the citations Paper 7 *does* carry are accurate — this is a
  cheap pass with real value, given that the paper's bibliography is the one
  artifact a referee checks mechanically.
