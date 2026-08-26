# Findings — flag 4

**Status: complete.** Run 2026-08-26. Every entry below labelled `verified` was
checked against a primary source actually fetched, with the URL recorded.

## Verdict

**CLEAR**, with two required additions.

Nothing threatens Paper 7's results. The suspect citation turned out to be real
but irrelevant, and the genuine finding is the one that did not come from the
earlier sweep at all: Paper 7 omits the founding canon of topological methods in
distributed computing, and omits the systems-level ancestor of its own scenario.

## Job 1 — the suspect citation

**Determination: `FOUND`. Real, not fabricated. Do not cite anyway.**

| Field | Value |
|---|---|
| Full title | "A Homological Approach to Consensus and Fault Tolerance in **Decentralized Sensor Networks**" |
| Author | R. Poornima, Dept. of Mathematics (S&H), EASA College of Engineering and Technology, Coimbatore, India |
| Venue | *Boletim da Sociedade **Paranaense** de Matemática* (3s.) v. 2026 (44), no. 3, pp. 1–5 |
| DOI | 10.5269/bspm.80121 |
| Dates | submitted 2025-11-13, published 2026-02-22 |
| URL fetched | `https://periodicos.uem.br/ojs/index.php/BSocParanMat/article/download/80121/751375162007/` |

Read in full (5 pages). `verified`.

Three corrections to how this was described going in:

1. **It is not fabricated.** The scout's suspicion was reasonable practice and
   the conclusion it pointed at was wrong. Round performance numbers do not
   distinguish "fabricated" from "real but weak" — both were live hypotheses and
   the second one won.
2. **The earlier sweep dropped the subtitle.** "…in Decentralized Sensor
   Networks" is what makes the venue and framing make sense; without it the
   title reads as a consensus-theory paper, which is part of why it looked off.
3. **The venue guess in `reading-list.md` was wrong.** Sociedade *Paranaense* de
   Matemática is a Paraná state society, not the Sociedade *Brasileira* de
   Matemática this package told the dive to search. It was found anyway, by
   exact-title search rather than by venue.

**Why it still must not be cited**: it is a thin five-page piece (Rips complex
plus sheaf $H^1$ flagging outlier sensor readings, one simulation figure, a typo
in the Figure 1 caption). No theorems, no visibility contract, no
effective-resistance closed form, no localization result — nothing that bears on
Paper 7's contribution. Its own reference list cites Lamport–Shostak–Pease,
Castro–Liskov, Ghrist, Boyd et al., Hansen–Ghrist, and Robinson, and it too
omits the Herlihy canon. Citing it would associate Paper 7 with a much weaker
paper for no analytical gain.

The recommendation is therefore unchanged from what the package assumed, but the
*reason* is the opposite of what was assumed: irrelevance, not fabrication.

## Job 2 — the missing canon

### Q2 — What Herlihy–Shavit proves

`verified`. Fetched `https://cs.brown.edu/~mph/HerlihyS99/p858-herlihy.pdf` —
66-page PDF, matching pp. 858–923 exactly. *Journal of the ACM* 46(6):858–923,
November 1999.

First fully combinatorial characterization of wait-free task solvability in
shared-memory read/write systems: every task and protocol is associated with
simplicial complexes of process views, and solvability holds iff a
structure-preserving map exists between them. Yields impossibility for renaming
and $k$-set agreement by a "no holes" topological argument.

### Q3 — How Paper 7 differs

Confirmed accurate as drafted in `questions.md`. The distinction holds:

- **Herlihy–Shavit / Saks–Zaharoglou** ask which tasks are solvable *before*
  execution, over simplicial complexes of possible process views.
- **Paper 7** asks what an analyst can certify *after* one execution, from
  partial already-relayed evidence, over cellular sheaves with real coefficients
  on the gossip graph itself.

Same tradition — topology as the language for local consistency without a global
section — genuinely disjoint objects and questions.

### Q4 — Does that literature already contain equivocation detection?

`probable` negative, reasonably searched, not a proof. The closest recent work is
arXiv:2503.02556, "A Sheaf-Theoretic Characterization of Tasks in Distributed
Systems" (2025), which extends Herlihy–Shavit to cellular sheaves — but is still
about solvability (existence of global sections), not forensic detection. No work
combining cohomology, equivocation, and detection-from-partial-evidence surfaced.

### Q5 — Does PeerReview already characterize unchecked-link conviction?

**No — and the reason is the best positioning sentence this dive produced.**

`verified`. Fetched
`https://people.mpi-sws.org/~druschel/publications/peerreview-sosp07.pdf` in
full; SOSP'07 pp. 175–188, DOI 10.1145/1294261.1294279, confirmed against DBLP.

PeerReview's completeness rests on **Assumption 6**: every node's witness set
$w(i)$ is guaranteed to contain a correct node. Its §4.6 consistency protocol
catches a forked log because every authenticator a node issues is eventually
forwarded to a witness set that can compare both branches **directly**.

So PeerReview *manufactures a point of direct comparison by design*. Paper 7
characterizes exactly the case that assumption exists to avoid needing: when no
direct comparison point exists and only cycle-relayed reports remain. That is a
strong, favorable position — the systems work built the mechanism, the paper
characterizes its boundary — and it should be stated that way.

## Q6 — Accuracy pass on Paper 7's existing bibliography

**No inaccuracies found in any of the eight.**

| Citation | Verified via | Result |
|---|---|---|
| Abramsky & Brandenburger | `iopscience.iop.org/article/10.1088/1367-2630/13/11/113036` | `verified`, exact |
| Curry | `arxiv.org/abs/1303.3255` (comment field confirms UPenn doctoral thesis) | `verified`, exact |
| Hansen & Ghrist | `link.springer.com/article/10.1007/s41468-019-00038-7` | `verified`, exact |
| Robinson | DBLP structured record | `verified`, exact |
| Carù | DBLP structured record | `verified`, exact |
| Sheng et al. | DBLP + `arxiv.org/abs/2010.06785` | `verified`, exact |
| Spielman & Teng | DBLP + `arxiv.org/abs/cs/0310051` | `verified`, exact |
| Bach | DBLP structured record | details `verified`; **content claim `probable`** |

**Bach 1999 content check — the one open item.** Bibliographic details verified
(*J. Symb. Comput.* 27(4):429–433, 1999). The *content* claim Paper 7 makes about
it — that its \#P-hardness result concerns coherent sheaves on projective space
and so does not touch finite cellular sheaves on graphs — is `probable`, not
`verified`. ScienceDirect returned HTTP 403 on every route (PDF and abstract,
with and without UA header), the Wayback snapshot also 403'd, and Bach's homepage
does not list the paper. A search-surfaced abstract excerpt describes the result
as about "the dimensions of the cohomology groups of a coherent sheaf on
projective space" being \#P-hard, which supports the claim and is consistent with
what "sheaf cohomology" means in classical algebraic geometry. But the primary
PDF was never obtained.

This matters more than a normal citation check because the Bach citation is
load-bearing: it exists specifically to pre-empt a category error a referee might
raise. It should be closed with institutional access before submission.

## Q7 — Is the three-tier visibility contract already named?

`probable` negative, non-exhaustive. No standard name found in sensor fusion,
data fusion, or network tomography, including Robinson's sensor-integration line.
No renaming needed; the register entry stands as "genuinely new as far as this
register knows."

## Proposed text for `paper7.tex`

For the "Adjacent, and honestly positioned" paragraph. **Drafted, not applied.**

> Herlihy and Shavit \cite{herlihy-shavit} and, independently, Saks and
> Zaharoglou \cite{saks-zaharoglou} founded the topological line in distributed
> computing --- co-recipients of the 2004 Gödel Prize --- by characterizing which
> tasks have wait-free protocols via a structure-preserving map between the
> protocol's and the task's simplicial complexes of process views; Herlihy,
> Kozlov, and Rajsbaum \cite{herlihy-kozlov-rajsbaum} is the standard text. We
> inherit their conviction that topology is the right language for what a
> distributed system can and cannot know, but we ask a different question of a
> different object: not which tasks are solvable before execution, but what an
> analyst can certify \emph{after} one execution from partial, already-relayed
> evidence --- cellular sheaves with real coefficients on the gossip graph
> itself, not simplicial complexes of possible process states. PeerReview
> \cite{peerreview} is the systems-level ancestor of the exact scenario:
> witnesses cross-check signed logs, and a node that forks its log is caught
> because every authenticator it issues is eventually forwarded to a witness set
> that can compare them directly. But that guarantee rests on PeerReview's
> witness-set assumption --- that some correct node eventually obtains both sides
> of any comparison --- which is precisely the assumption our three-tier contract
> drops for the relayed tier: we characterize detection when no such direct
> comparison point exists and only cycle-relayed reports remain.

```latex
\bibitem{herlihy-shavit} M.~Herlihy and N.~Shavit. The topological structure
of asynchronous computability. \emph{Journal of the ACM}, 46(6):858--923, 1999.
\bibitem{saks-zaharoglou} M.~Saks and F.~Zaharoglou. Wait-free $k$-set
agreement is impossible: the topology of public knowledge. \emph{SIAM Journal
on Computing}, 29(5):1449--1483, 2000.
\bibitem{herlihy-kozlov-rajsbaum} M.~Herlihy, D.~Kozlov, and S.~Rajsbaum.
\emph{Distributed Computing Through Combinatorial Topology}. Morgan Kaufmann,
2013.
\bibitem{peerreview} A.~Haeberlen, P.~Kouznetsov, and P.~Druschel. PeerReview:
practical accountability for distributed systems. In \emph{Proc.\ 21st ACM
Symposium on Operating Systems Principles (SOSP)}, pp.~175--188, 2007.
```

## Open items

1. **Bach 1999 content claim** — `probable`, needs institutional access to
   *J. Symbolic Computation* to reach `verified`. Load-bearing; close before
   submission.
2. **Herlihy–Kozlov–Rajsbaum book details** — `probable`. Three independent
   bookseller listings agree (Morgan Kaufmann, 2013, ISBN 978-0-12-404578-1) but
   no publisher or library-catalog page was fetched; ScienceDirect blocked.
   Close with a WorldCat fetch.
3. **Q4 and Q7 negatives** — reasonably-searched `probable`, not proofs.
