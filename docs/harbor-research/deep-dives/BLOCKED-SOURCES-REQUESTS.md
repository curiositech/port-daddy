# Blocked sources: what to pull, and what to say

Six sources across five dives cannot be retrieved from the authoring sandbox.
Each was probed by every route available — publisher, DOI, Unpaywall, Semantic
Scholar `openAccessPdf`, repository mirrors, author pages. **The routes are
closed, not untried**; do not re-run the search, just get the file.

Two of these can still change a paper's conclusions. The rest close open items.

---

## Part 1 — Institutional pulls (anyone with library access; ~30 minutes total)

Ordered by how much the answer can still change.

### 1. Lizzeri 1999 — could be *adverse* to Paper 5's Theorem 2b

> A. Lizzeri, "Information Revelation and Certification Intermediaries,"
> *RAND Journal of Economics* 30(2):214–231, 1999. DOI `10.2307/2556078`.

**Why it matters.** Paper 5's daemon is a monopoly certification intermediary,
and Theorem 2b assumes it publishes the **full engine id**. Lizzeri's abstract
says a monopoly certifier optimally reveals only **whether quality clears a
minimum standard** — a coarse pass/fail. If that holds in our setting it
collapses the `(principal, engine)` price keys Theorem 2b depends on and reopens
substitution *within* the certified band.

**What to extract:** the model's hypotheses (is the certifier's revelation policy
chosen ex ante or ex post? is certification voluntary for the seller?), the exact
statement of the minimal-standard result, and the competition result ("competition
among the intermediaries can lead to full information revelation" — if that is
the escape, Paper 5 should say the daemon market must be contestable).

**Not OA by any route.** Unpaywall `is_oa: false`; Semantic Scholar `CLOSED`.

### 2. Lazear 1979 — blocks a verb in Paper 5

> E. P. Lazear, "Why Is There Mandatory Retirement?"
> *Journal of Political Economy* 87(6):1261–1284, 1979. DOI `10.1086/260835`.

**Why it matters.** Paper 5 §cliff names Lazear as the foil Theorem 4 corrects.
Secondary sources agree Lazear's contract underpays the young and overpays the
old — i.e. the honest worker's implicit bond is **front-loaded**, the same
direction as the cliff. If so, Theorem 4 *agrees* with him and the paper is
knocking down a position he does not hold. The text has been softened to "the
kind one might import from" pending this check; restore a definite attribution
only after reading.

**What to extract:** the shape of the wage-productivity wedge over tenure, and
whether Lazear frames the young worker's underpayment as a bond posted against
later misconduct.

**Three mirrors returned 403/404.** JSTOR `stable/1833199` or the JPE archive.

### 3. Dastani, Sardina & Yazdanpanah 2017 — the remaining priority risk for Paper 2

> M. Dastani, S. Sardina, V. Yazdanpanah, "Norm Enforcement as Supervisory
> Control," PRIMA 2017, LNAI 10621, pp. 330–348.
> DOI `10.1007/978-3-319-69131-2_20`.

**Why it matters.** The title is Paper 2's thesis. Paper 2 now claims the
Ramadge–Wonham identification that Basin et al. left open; if this paper already
made it for normative multi-agent systems, that claim needs re-scoping to the
agent-runtime alphabet.

**What to extract:** whether they state an enforceability *characterization*
(iff) or only model three enforcement mechanisms in SCT terms; whether their
uncontrollable events are environment events or agent-internal ones; whether the
supremal controllable sublanguage appears.

**Route note:** the OpenAlex/Unpaywall "green OA" record at figshare `27343188`
is **metadata-only** — `files: []`, not embargoed. Both OA flags are wrong. Go to
SpringerLink, or email the authors (Sardina at RMIT, Yazdanpanah at Southampton);
a preprint request is entirely normal for a 2017 LNAI chapter.

### 4. Kofman & Lawarrée 1993 — published text, for Paper 3's citation numbers

> F. Kofman, J. Lawarrée, "Collusion in Hierarchical Agency,"
> *Econometrica* 61(3):629–656, 1993. JSTOR `stable/2951721`.
> **(Note: `2951722` in an earlier reading list was wrong.)**

**Why it matters.** Flag 1's verdict — that they contain no unbounded-collateral
result, and that the regress is an open question in their conclusion — rests on
the 1990 MIT Sloan working paper, which is freely available and was read in full.
The verdict is not in doubt; the *numbering* is. Proposition and page references
must not be cited as Econometrica's until the published version is checked.

**What to extract:** confirm the proposition list still runs 1–6 with the same
content, and locate the published wording of the "police the police without
falling in an infinite regress" sentence with its page number.

### 5. Bach 1999 — load-bearing content check for Paper 7

> E. Bach, "Sheaf Cohomology is #P-hard," *Journal of Symbolic Computation*
> 27(4):429–433, 1999. DOI `10.1006/jsco.1998.0261`.

**Why it matters.** Paper 7 cites it specifically to pre-empt a referee's
category error — that #P-hardness of sheaf cohomology does not touch finite
cellular sheaves on graphs. The bibliographic record is verified twice
(Crossref + DBLP) and a summary generated from the paper confirms it concerns
"a coherent sheaf on projective space," so the claim is well supported. But the
primary PDF was never obtained, and a load-bearing pre-emption should rest on the
paper itself.

**What to extract:** one sentence — the category the hardness result is stated
over. Five pages.

**ScienceDirect 403s on every route** despite a bronze-OA flag.

### 6. Grossi, Aldewereld & Dignum — origin of "regimentation," for Paper 2

> D. Grossi, H. Aldewereld, F. Dignum, "Ubi Lex, Ibi Poena: Designing Norm
> Enforcement in E-Institutions," COIN II, pp. 101–114.
> DOI `10.1007/978-3-540-74459-7_7`.

**Why it matters.** Paper 2 now attributes the regimentation/enforcement
distinction to this paper on the strength of three independently-read secondary
attributions. That is enough to cite as origin, not enough to quote. A referee
from that community will expect it read.

**Semantic Scholar reports CLOSED** — no OA copy anywhere.

---

## Part 2 — Draft author request

For item 3, and adaptable to item 1. Short, specific, and says why — academics
answer these routinely.

> **Subject:** Reprint request — "Norm Enforcement as Supervisory Control" (PRIMA 2017)
>
> Dear Dr Sardina and Dr Yazdanpanah,
>
> I'm preparing a paper on enforceability boundaries for LLM agent runtimes, and
> your PRIMA 2017 chapter "Norm Enforcement as Supervisory Control" is the
> closest prior work I've been able to identify. I have not been able to obtain
> the full text — the record in the RMIT repository appears to hold metadata
> only, and I don't currently have institutional access to the LNAI volume.
>
> Would you be willing to share a copy? I want to make sure I position my own
> result correctly against yours rather than guessing from the abstract.
>
> For context on why it matters: I characterise which agent-governance policies a
> runtime can prevent (as opposed to detect) by identifying the condition with
> Ramadge–Wonham controllability, with the uncontrollable events being a
> generative model's own forward-pass steps rather than environment events. Basin
> et al. (TISSEC 2013) draw the controllable/observable distinction and
> explicitly leave the Ramadge–Wonham connection open; I'd like to know whether
> your paper already closes it for normative MAS, in which case my contribution
> is the instantiation rather than the identification.
>
> Happy to share a draft in return if that's of interest.
>
> With thanks,
> Erich Owens

---

## Part 3 — What each paper now says while these are open

So the papers are honest in the interim, each blocked item is disclosed in the
text rather than silently assumed:

| Paper | Disclosure now in the text |
|---|---|
| 2 | Related Work names the PRIMA 2017 paper and says the positioning must be revisited against it before submission. |
| 5 | §cliff softened to "the kind one might import from" for Lazear; Related Work states the citation is owed and unresolved, and that Theorem 4 may agree with him. |
| 5 | Theorem 2b's pricing hypothesis is now explicit, which is also where a Lizzeri-style coarse certificate would bite. |
| 7 | Bach's content claim is `probable` in the dive notes; the paper's own sentence is unchanged because the summary evidence supports it. |
| 3 | Flag 1's findings note that working-paper numbering must not be cited as Econometrica's. |
