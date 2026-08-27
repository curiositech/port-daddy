# Reading list — flag 4

## Tier 0 — the suspect citation

**"A Homological Approach to Consensus and Fault Tolerance"** — status
`uncertain`, existence unestablished, **do not cite under any circumstances
until resolved.**

Search, and record what each returns:

1. Exact title in quotes, general web search
2. Google Scholar / Semantic Scholar / DBLP, exact title
3. arXiv full-text search
4. Brazilian mathematics society venues, since that is the reported venue:
   *Matemática Contemporânea* (SBM), *Boletim da Sociedade Brasileira de
   Matemática*, *São Paulo Journal of Mathematical Sciences*
5. Title variants — "homological", "homology", "cohomological", paired with
   "consensus", "fault tolerance", "distributed"
6. Author-side search if the earlier sweep recorded any author name

If none resolve, the finding is **NOT FOUND — DO NOT CITE**, stated in exactly
those terms. Do not substitute a similar real paper and present it as the
resolution; if a real paper on the same topic turns up, that is a separate
finding listed separately.

## Tier 1 — the missing canon (this is the real work)

1. **Herlihy, M. and Shavit, N. "The Topological Structure of Asynchronous
   Computability."** *JACM* 46(6):858–923, 1999.
   Verify exact bibliographic details. Read enough to write two accurate
   sentences on what it proves and what machinery it uses (simplicial complexes
   of process views; the asynchronous computability theorem).

2. **Herlihy, M., Kozlov, D., Rajsbaum, S. *Distributed Computing Through
   Combinatorial Topology.*** Morgan Kaufmann, 2013.
   The standard text. If only one citation is added, it is probably this one.
   Verify publisher, year, ISBN.

3. **Saks, M. and Zaharoglou, F. "Wait-Free k-Set Agreement is Impossible: The
   Topology of Public Knowledge."** *SIAM Journal on Computing*
   29(5):1449–1483, 2000.
   Co-recipient of the 2004 Gödel Prize with Herlihy–Shavit. Verify details.

4. Optionally: **Borowsky, E. and Gafni, E.** on the same impossibility, and
   **Castañeda, A. and Rajsbaum, S.** on renaming — only if the dive has time
   and only to gauge how broad the citation should be.

## Tier 2 — the systems-side ancestor

5. **Haeberlen, A., Kouznetsov, P., Druschel, P. "PeerReview: Practical
   Accountability for Distributed Systems."** *SOSP* 2007, 175–188.
   Read for the equivocation-detection mechanism: witnesses, signed logs,
   cross-checking, and what it can and cannot detect. Compare to Paper 7's
   three-tier visibility model. The specific question: does PeerReview already
   characterize when an unchecked link can be convicted by surrounding evidence?

6. **Sheng, P. et al. "BFT Protocol Forensics."** CCS 2021, 1722–1743.
   Already cited in `paper7.tex` and correctly positioned. Verify the citation
   details are right; no need to re-read in depth.

## Tier 3 — verify what the paper already cites

A mechanical accuracy pass over `paper7.tex`'s existing bibliography. Cheap,
and the one thing a referee checks without thinking:

- Abramsky & Brandenburger, *New Journal of Physics* 13:113036, 2011
- Curry, J. M., PhD thesis, University of Pennsylvania, 2014
- Hansen & Ghrist, *J. Applied and Computational Topology* 3:315–358, 2019
- Robinson, M., *Information Fusion* 36:208–224, 2017
- Carù, G., QPL 2016, EPTCS 236, 21–39, 2017
- Spielman & Teng, STOC 2004, 81–90
- Bach, E., *Journal of Symbolic Computation* 27(4):429–433, 1999

For each: confirm the title, venue, volume, pages, and year. Report any
mismatch. Bach in particular is cited for a narrow purpose — to pre-empt a
category error about \#P-hardness — so confirm it actually says what the paper
says it says.

## Tier 4 — is the three-tier contract already named?

7. Search sensor fusion, data fusion, and network tomography for an existing
   name for the compared / relayed / severed visibility distinction. Robinson's
   sheaf-for-sensor-integration line is the most likely home. If a name exists,
   the renaming register should record it.

## Retrieval notes

- Herlihy–Shavit and Saks–Zaharoglou are widely mirrored; author pages and the
  ACM/SIAM DLs both work.
- PeerReview's PDF is on the MPI-SWS and Rice pages.
- Record the URL actually fetched for every source.
