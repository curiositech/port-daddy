# Bibliography, citation register, and renamings

Three things in one file: what the first sweep got wrong, the candidate
citations the four dives will confirm or discard, and the register of terms the
papers coined that already have names in other fields.

Nothing here is cleared for a `.tex` file. Entries move into a paper only after
a dive marks them `verified` in its `findings.md`.

---

## Part 0 — What the first sweep got wrong

The seven literature scouts were briefed from
`website-v2/src/data/researchPapers.ts` — the website's one-line summary copy —
not from `docs/harbor-research/tex/*.tex`. They therefore searched against
marketing phrasing and reported, correctly given what they were shown, that the
claims appeared ungrounded in prior art.

That conclusion does not survive contact with the papers. Every one of the seven
already carries an explicit Related Work section, and several are unusually
careful about the imported/new split. For the record:

| Paper | Section | What it already cites |
|---|---|---|
| 1 | `\section{Related work}` | Dorfman 1943, Hwang 1972, Du–Hwang, Shannon, Cover–Thomas |
| 2 | `\section{Related work}` | Ramadge–Wonham 1987/1989, Lin–Wonham 1988, Schneider 2000, Anderson 1972, Rushby 1992, Goguen–Meseguer 1982 |
| 3 | `\section{Related work, and what is actually new}` | Becker 1968, Avenhaus–von Stengel–Zamir 2002, Kreps–Wilson 1982, Fudenberg–Levine 1989, Dorfman 1943, Micali–Rabin–Vadhan 1999 |
| 4 | Related work | noninterference and clean-room lineage |
| 5 | `\section{Related work, and what is actually new}` | Parfit, Akerlof, Spence, Friedman–Resnick, Douceur, Tadelis, Mailath–Samuelson, Lazear |
| 6 | `\section{Related work}` | Dowling–Gallier 1984, Cook 1971, Karp 1972, Erlang 1917, Halfin–Whitt 1981, Mitrany–Avi-Itzhak 1968, von Wright 1951, Chisholm 1963 |
| 7 | `\section{Related work: imported, adjacent, and new}` | Abramsky–Brandenburger 2011, Curry 2014, Hansen–Ghrist 2019, Robinson 2017, Carù 2017, Sheng et al. 2021, Spielman–Teng 2004, Bach 1999 |

Papers 2, 3, 6, and 7 additionally carry explicit "imported vs. new" paragraphs
that concede which machinery is not theirs, and papers 2 and 6 both state in
their own text that a final pre-submission sweep is owed and that "not found" is
not "proven nonexistent." The four dives are that sweep, narrowed to where it
actually bites.

**The distinct complaint that does survive**: a Related Work section written for
a referee is not exposition written for a general CS/engineering/mathematics
reader. The papers have dense, correct citations; they mostly lack the two or
three paragraphs that would let someone who has never read Ramadge–Wonham
understand what controllability *is* before the theorem lands on them. That is a
separate work item, tracked as Round 2B, and it is not what these four folders
are for.

---

## Part 1 — Candidate citations, by flag

Confidence labels: `verified` = primary source read in this program;
`probable` = bibliographic details consistent across two independent secondary
references but the paper itself not yet read here; `uncertain` = single
unverified mention, treat as possibly wrong or possibly nonexistent.

### Flag 1 — hierarchical monitoring and collusion (Paper 3)

| Citation | Confidence | Why it matters |
|---|---|---|
| F. Kofman and J. Lawarrée. "Collusion in Hierarchical Agency." *Econometrica* 61(3):629–656, 1993. | `probable` | The named contradiction risk. Principal–supervisor–agent with a collusion-prone supervisor; the source of the claim that naive monitor-stacking needs unbounded collateral. |
| J. Tirole. "Hierarchies and Bureaucracies: On the Role of Collusion in Organizations." *Journal of Law, Economics, and Organization* 2(2):181–214, 1986. | `probable` | Founds the three-tier collusion model Paper 3's tower is a special case of. |
| J.-J. Laffont and D. Martimort. "Collusion under Asymmetric Information." *Econometrica* 65(4):875–911, 1997. | `probable` | The collusion-proofness principle — whether restricting to collusion-proof mechanisms is without loss. Bears directly on whether the tower's per-level analysis is the right object. |
| S. Baliga. "Monitoring and Collusion with Soft Information." *JLEO* 15(2):434–440, 1999. | `probable` | Monitoring hierarchies where the supervisor's information is unverifiable. |
| A. Faure-Grimaud, J.-J. Laffont, D. Martimort. "Collusion, Delegation and Supervision with Soft Information." *Review of Economic Studies* 70(2):253–279, 2003. | `probable` | The delegation-vs-supervision comparison Paper 3's "who audits the auditors" framing implicitly takes a side in. |
| R. Townsend. "Optimal Contracts and Competitive Markets with Costly State Verification." *JET* 21(2):265–293, 1979. | `probable` | Audit cost `a` as a primitive; the canonical costly-verification model. |
| D. Diamond. "Financial Intermediation and Delegated Monitoring." *RES* 51(3):393–414, 1984. | `probable` | Delegated monitoring with a finite-capital intermediary — the closest economics analogue to "finite bond capital certifies depth." |

### Flag 2 — runtime enforceability (Paper 2)

| Citation | Confidence | Why it matters |
|---|---|---|
| arXiv:2607.22868, "What Can Be Enforced? A Theory of Certified Runtime Safety for Tool-Using Agents" | `uncertain` | **Existence not established.** Reported by one scout, never retrieved. `2607` would be July 2026. Verify the identifier resolves before treating this as prior art at all; a non-resolving ID is itself the finding. |
| J. Ligatti, L. Bauer, D. Walker. "Edit Automata: Enforcement Mechanisms for Run-time Security Policies." *IJIS* 4(1–2):2–16, 2005. | `probable` | Extends Schneider's truncation-only monitors to insertion/suppression. Paper 2's "detect-and-compensate" is close to suppression/edit territory and the paper does not cite this line. |
| Y. Falcone, J.-C. Fernandez, L. Mounier. "What can you verify and enforce at runtime?" *STTT* 14(3):349–382, 2012. | `probable` | Titled almost exactly Paper 2's question; maps the safety-progress hierarchy to enforceability. A referee will ask about this one by name. |
| B. Alpern and F. Schneider. "Defining Liveness." *IPL* 21(4):181–185, 1985. | `verified` (canonical) | The safety/liveness decomposition Paper 2's prefix-closure assumption rests on. |
| K. Rudie and W. M. Wonham. "Think Globally, Act Locally: Decentralized Supervisory Control." *IEEE TAC* 37(11):1692–1708, 1992. | `probable` | Decentralized supervision — relevant if multiple daemons mediate disjoint alphabets. |

### Flag 3 — complexity of normative reasoning (Paper 6)

| Citation | Confidence | Why it matters |
|---|---|---|
| J. Halpern and V. Weissman. "Using First-Order Logic to Reason about Policies." *ACM TISSEC* 11(4):1–41, 2008 (earlier: CSFW 2003). | `probable` | The tractable-fragment-then-one-step-out pattern for policy languages, in close to Paper 6's exact shape. |
| X. Sun and L. Robaldo. "On the complexity of input/output logic." *Journal of Applied Logic* 25:69–88, 2017. | `probable` | Complexity classification for deontic input/output logic; the closest published home for a P/NP-complete frontier in deontic reasoning. |
| G. Governatori and A. Rotolo. "Logic of Violations: A Gentzen System for Reasoning with Contrary-To-Duty Obligations." *AJL* 4:193–215, 2006. | `probable` | Contrary-to-duty handling — the puzzle Paper 6 explicitly declines to represent. |
| T. Schaefer. "The Complexity of Satisfiability Problems." STOC 1978, 216–226. | `verified` (canonical) | The dichotomy template. Paper 6's Theorem 1a/1b pair is a dichotomy claim in all but name and should say so. |
| W. F. Dowling and J. H. Gallier, 1984. | `verified` (already cited) | Already in `paper6.tex`. Listed for completeness. |
| L. Cholvy and F. Cuppens. "Analyzing consistency of security policies." *IEEE S&P* 1997, 103–112. | `probable` | Normative conflict detection as an algorithmic problem, in the security-policy idiom. |

### Flag 4 — topology and distributed computing (Paper 7)

| Citation | Confidence | Why it matters |
|---|---|---|
| R. Poornima. "A Homological Approach to Consensus and Fault Tolerance in Decentralized Sensor Networks." *Boletim da Sociedade Paranaense de Matemática* (3s.) 2026(44), no. 3, 1–5. DOI 10.5269/bspm.80121. | `verified` — **real, but do not cite** | **Resolved: not fabricated.** Read in full. Thin five-page piece (Rips complex + sheaf $H^1$ flagging outlier sensor readings); no theorems, nothing bearing on Paper 7. Excluded for irrelevance, not for authenticity. Note the earlier sweep dropped the subtitle and misidentified the society (Paranaense, not Brasileira). |
| M. Herlihy and N. Shavit. "The Topological Structure of Asynchronous Computability." *JACM* 46(6):858–923, 1999. | `verified` — **add** | Fetched and read (`cs.brown.edu/~mph/HerlihyS99/p858-herlihy.pdf`). The founding result of topological methods in distributed computing; Paper 7 omits it and a referee will not accept that. |
| M. Saks and F. Zaharoglou. "Wait-Free k-Set Agreement is Impossible: The Topology of Public Knowledge." *SICOMP* 29(5):1449–1483, 2000. | `verified` — **add** | Co-recipient of the 2004 Gödel Prize; the other half of the founding pair. |
| M. Herlihy, D. Kozlov, S. Rajsbaum. *Distributed Computing Through Combinatorial Topology.* Morgan Kaufmann, 2013. ISBN 978-0-12-404578-1. | `probable` — **add** | The standard text. Three independent bookseller listings agree; no publisher or library-catalog page fetched (ScienceDirect blocked). Close with WorldCat before submission. |
| A. Haeberlen, P. Kouznetsov, P. Druschel. "PeerReview: Practical Accountability for Distributed Systems." *SOSP* 2007, 175–188. DOI 10.1145/1294261.1294279. | `verified` — **add** | Read in full. The systems-level ancestor of Paper 7's exact scenario. Its Assumption 6 — every witness set contains a correct node — is precisely what Paper 7's relayed tier drops, which makes the positioning favorable rather than defensive. |
| E. Buchman, J. Kwon, Z. Milosevic. "The latest gossip on BFT consensus." arXiv:1807.04938, 2018. | `uncertain` | Not investigated by the dive; retained as an optional situating reference only. Verify before use. |

---

## Part 2 — Renaming register

Terms the papers coined where an established name already exists. Adopting the
established name costs nothing and buys the referee's recognition; keeping a
coined term is defensible but should then be explicitly glossed to the standard
one on first use.

| Paper | Coined term | Established name | Recommendation |
|---|---|---|---|
| 2 | "regimentable" | *controllable* (Ramadge–Wonham) | Keep — the paper's whole point is that the two coincide, and it says so. Gloss on first use, which it already does. |
| 2 | "detect-and-compensate" | *runtime enforcement by suppression/insertion* (edit automata, Ligatti et al.) | Gloss. The coined term is clearer for the audience; add "in the edit-automata sense" once. |
| 3 | "the tower" | *hierarchical agency* / *supervision hierarchy* (Tirole 1986) | Gloss to "hierarchical monitoring" on first use. Economists will not find "tower" searchable. |
| 3 | "sealed sampling from C disjoint cliques" | *random monitor selection from independent pools*; cf. *collusion-proof mechanism* (Laffont–Martimort) | Gloss. "Clique" collides with its graph-theoretic meaning, which is a live confusion in a program that also does graph cohomology. Consider *pool* or *bench*. |
| 3 | "reputation is amortized verification" | *delegated monitoring* (Diamond 1984); *costly state verification* (Townsend 1979) | Keep as the title claim — it is the paper's framing contribution — but position it against these two explicitly. |
| 3 | "finite bond capital certifies a tower of unbounded depth" | — | **Restate.** The proof gives ⌈log G₀ / log(1/(1−ρd))⌉ levels, which is finite and logarithmic. The honest claim is "logarithmic depth suffices to drive corrupt value below any fixed threshold, at finite total bond." As written a referee will read "unbounded depth" as a stronger claim than the theorem supports. This is a wording fix, not a result fix, and it is independent of how flag 1 resolves. |
| 6 | "the fragment $\mathcal{L}_c$ / one step outside" | *tractable fragment and dichotomy* (Schaefer template) | Add the word *dichotomy*. Theorem 1a/1b is a dichotomy pair and naming it that makes it legible instantly. |
| 6 | "the lookout is a subroutine" | *normative conflict detection* / *compliance checking* | Gloss to the standard term once so the result is findable by people searching the deontic-logic literature. |
| 7 | "completion residual" | *consistency radius* (Robinson 2017), least-squares form | Already glossed in the paper. No change. |
| 7 | "three-tier visibility contract" | — | Genuinely new as far as this register knows. Keep. Flag 4's dive should confirm nothing in the combinatorial-topology literature already names it. |
| 1 | "zoom advantage" | *adaptive group testing* / *generalized binary splitting* (Hwang 1972) | Gloss on first use; the paper already cites Hwang, so this is one clause of work. |

---

## Part 2b — The absence checks, reproducibly

Every "the paper does not cite X" claim in these packages was produced by
running grep against the source, not by reading and remembering. Run from
`docs/harbor-research/tex/`, case-insensitive, extended regex:

| Command | Result |
|---|---|
| `grep -Eic "kofman\|lawarr" paper3.tex` | 0 |
| `grep -Eic "2607\|certified runtime\|tool-using agent" paper2.tex` | 0 |
| `grep -Eic "halpern\|weissman\|robaldo" paper6.tex` | 0 |
| `grep -Eic "herlihy\|rajsbaum\|kozlov\|saks\|zaharoglou" paper7.tex` | 0 |
| `grep -Eic "peerreview\|haeberlen" paper7.tex` | 0 |
| `grep -Eic "ligatti\|falcone\|edit automata" paper2.tex` | 0 |
| `grep -Eic "dechter\|simple temporal" paper6.tex` | 0 |
| `grep -Eic "schaefer\|dichotom" paper6.tex` | 0 |
| `grep -Eic "diamond\|townsend" paper3.tex` | 0 |

A row of zeros proves nothing on its own — it is equally consistent with a
broken pattern or the wrong file. Controls, run at the same time against
citations the papers demonstrably do carry:

| Control | Result |
|---|---|
| `grep -Eic "ramadge" paper2.tex` | 9 |
| `grep -Eic "becker" paper3.tex` | 3 |
| `grep -Eic "chisholm" paper6.tex` | 2 |
| `grep -Eic "robinson" paper7.tex` | 4 |

Two of the absence rows are worth calling out because they are not about the
four flags and were found while checking them. `paper6.tex` contains no
occurrence of "dichotom" in any form, which is the direct evidence for the
renaming recommendation below — the result is a dichotomy and the paper never
says the word. And `paper3.tex` cites neither Diamond nor Townsend, so the
costly-state-verification and delegated-monitoring lineages are absent from a
paper whose title claim is about amortizing verification cost.

## Part 3 — Standing rules for anything added to a `.tex`

1. Only `verified` entries. `probable` and `uncertain` stay in this file.
2. Every added citation gets a "how we differ" sentence in the same paragraph.
   A citation with no positioning sentence reads as padding and invites the
   referee to do the comparison you declined to do.
3. Additions go in the paper's existing Related Work section, in its existing
   imported/adjacent/new structure. Do not add a new section.
4. If a dive returns SUBSUMED or CONTRADICTED, the fix is not a citation. Stop
   and re-scope the contribution paragraph before touching anything else.
