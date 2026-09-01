# Deep dives: prior-art and falsification audits of the harbor-research papers

Two kinds of dive live under this directory. The original four (`flag-N-*`) are
**planned dives**: open questions a literature sweep raised, each dispatched as
a self-contained work package — what the paper claims, what the competing
literature may already say, the sources to read, the questions a read has to
answer, the prompt to run it, and a `findings.md` the reader fills in. The later
two (`paperN-*`) are **direct dives**: a full read-plus-falsification pass run
in one session against a single paper, with no separate planning brief — see
"The two dive patterns" below for when each applies and what a folder needs to
have under it.

## Why these four and not the whole sweep

The first sweep was run against the website's summary copy
(`website-v2/src/data/researchPapers.ts`) rather than the papers themselves, so
its headline conclusion — "no prior art engagement" — was wrong. Every paper in
`whitepaper/research/tex/` already carries a substantive Related Work section
with real citations. That correction is on the record in
`BIBLIOGRAPHY.md` under "What the first sweep got wrong."

What survived the correction is these four. Each was re-checked by grepping the
actual source for the specific citation in question, and in each case the source
genuinely does not engage the work named:

| Flag | Paper | Missing engagement | Verified absent by |
|---|---|---|---|
| 1 | Paper 3, `paper3.tex` | Kofman & Lawarrée 1993 and the hierarchical-collusion line | `grep -i "kofman\|lawarr"` → no match |
| 2 | Paper 2, `paper2.tex` | A possible same-year, same-claim preprint | `grep -i "2607\|certified runtime"` → no match |
| 3 | Paper 6, `paper6.tex` | The complexity-of-compliance-checking line | `grep -i "halpern\|weissman\|robaldo"` → no match |
| 4 | Paper 7, `paper7.tex` | Combinatorial topology of distributed computing | `grep -i "herlihy\|rajsbaum\|kozlov"` → no match |

Flags 1–3 are novelty risks: prior work may already own the result. Flag 4 was
two things at once — a citation the sweep itself flagged as possibly fabricated,
and a real canon (Herlihy–Shavit and successors) that Paper 7 omits entirely.

## Status — all four complete

| Flag | Verdict | Summary |
|---|---|---|
| 1 | **CLEAR** on the flag; two internal defects found | Kofman & Lawarrée contains **no** unbounded-collateral result — the regress is an *open question in their conclusion*, almost verbatim the question Theorem 2 answers, making them a **supporting** citation. But the falsification pass found real defects in `paper3.tex` itself: the C=1 counter-case **does not fail** (53 levels / 2650 bond vs C=8's 27 / 1350 — a factor of two, not divergence), and the `G_k > CB` "iff" is only a one-level deviation test. Also: no hierarchical-collusion citation anywhere in the paper. |
| 2 | **NARROW** — the most consequential of the four | The preprint is **real** (arXiv:2607.22868, verified with a 404 control) but complementary, not competing. The real problem is **Basin et al., ACM TISSEC 2013** — same alphabet split, an iff characterization that specializes to Paper 2's exact criterion, Schneider named as the O=∅ case. Paper 2's surviving delta is the Ramadge–Wonham identification Basin explicitly leaves open. **Two correctness bugs**, independently re-verified: Paper 2 misstates Schneider's theorem, and its headline compound case is Schneider's own Figure 1. |
| 3 | **NARROW** | Results survive, framing does not. The tractable-then-NP-complete *shape* is already mapped by the **Colombo Tosatto / Governatori** compliance line, at the same literals-vs-formulae boundary. $\mathcal{L}_c$ **as a combination** survives as novel, as does conflict-freedom (vs. compliance) as the decision problem. Owes Dechter–Meiri–Pearl (the STN), Stergiou–Koubarakis (STP→DTP, the closest analogue to Thm 1b), and **Gaertner et al. 2007**, which proved design-time conflict-freedom intractable in general. |
| 4 | **CLEAR** | Suspect citation is **real but irrelevant** — excluded on relevance, not authenticity. Add Herlihy–Shavit, Saks–Zaharoglou, Herlihy–Kozlov–Rajsbaum, and PeerReview. All eight existing citations verified accurate; Bach 1999's *content* claim remains `probable` (paywalled) and is load-bearing. |

## What the four dives taught about the sweep that spawned them

These packages were written on the assumption that the earlier sweep had
fabricated a citation. **That assumption was wrong in both places it was
tested.** Flag 4's "suspiciously round numbers" paper is real (just weak), and
flag 2's arXiv preprint is real (just orthogonal), confirmed with a control:
`2607.22868` returns HTTP 200, a same-shaped fake `2607.99999` returns 404.

Three lessons carry forward, and they invert the packages' original framing:

1. **`uncertain` entries should be checked, not discounted.** The sweep's hit
   rate on unverified citations is better than assumed.
2. **A `WebFetch` block is not evidence a source does not exist.** `curl` through
   the agent proxy reaches hosts `WebFetch` refuses; flag 1's decisive source was
   found this way, via Semantic Scholar's `openAccessPdf` field pointing at a
   DSpace@MIT copy no search engine surfaced. Flag 4's unresolved Bach 1999 is
   worth retrying by that route.
3. **The control test is the transferable technique.** An arXiv `abs` 200 proves
   nothing on its own. One extra request settles it.

And the deeper lesson: **three of the four most valuable findings came from
places the packages did not point.** Flag 1's C=1 arithmetic defect and flag 2's
two Schneider bugs were found by hostile reading of our own papers, not by
literature search; flag 3's closest-on-problem citation (Gaertner et al.) came
from a survey fetched while chasing an unrelated open item. The flags were worth
running, but what they were *aimed at* was mostly not what they hit.

## The direct dives: paper 4 and paper 5

Run 2026-08-26, after the four flags closed. Rather than dispatch a planning
brief for a specific named risk, these two ran the same read-plus-falsification
discipline directly against a whole paper in one session pass, verdict scoped
per-theorem rather than per-flag. Each folder holds only `README.md` (this
index entry, one level down) and `findings.md` — see "The two dive patterns"
below for why that's the right shape for this kind, not a gap against the
flag-N layout.

| Dive | Paper | Verdict | Summary |
|---|---|---|---|
| `paper4-sealed-harbor` | 4, *The Sealed Harbor* (`paper4.tex`) | **NARROW**, one boxed corollary **CONTRADICTED** | Every theorem is a narrower-scoped instance of existing work (delimited/gradual release, a privacy filter, a Ryoan-style budget) that the paper mostly pre-concedes — but the ε-conservation corollary applies the DRV advanced-composition bound to an adaptively-parameterised filter, which Rogers–Roth–Ullman–Vadhan 2016 prove invalid for exactly that model. Fix before anything else in the paper. |
| `paper5-continuity-without-metaphysics` | 5, *Continuity Without Metaphysics* (`paper5.tex`) | **NARROW** | No literature proves the four theorems, but Theorem 2a is misnamed — it's Akerlof's lemons result (pooling/collapse), not Grossman–Milgrom unraveling (full disclosure) — and the falsification pass alone found ten internal defects, two contradicted by the paper's own arithmetic (starting with a γ>1/2 crossing claim the paper's own figure data puts at γ≈0.5437). |

## Severity, and what each outcome means

Each dive ends in one of four verdicts. Write the verdict at the top of
`findings.md`, before the evidence.

- **CLEAR** — the prior work is genuinely different. Add a citation and one
  honest "how we differ" sentence. No result changes.
- **NARROW** — the prior work covers part of the claim. The claim survives but
  must be restated with the narrower scope stated up front.
- **SUBSUMED** — the prior work already proves this. The contribution becomes
  the application, not the theorem. Rewrite the contribution paragraph and say
  so plainly.
- **CONTRADICTED** — the prior work proves something incompatible. Stop. This is
  an error to fix, not a citation to add.

Flag 1 is the only one where CONTRADICTED is a live possibility, which is why it
is first.

## The rules every dive runs under

1. **Read the primary source.** Not the abstract, not a summary, not another
   paper's characterization of it. If the PDF cannot be obtained, the verdict is
   `UNRESOLVED — source not obtained`, never an inference from the abstract.
2. **Quote the competing theorem verbatim**, with its own hypotheses, into
   `findings.md`. Most apparent conflicts dissolve on the hypotheses, and the
   only way to see that is side by side.
3. **Never invent a citation.** Every entry needs a DOI, arXiv ID, or stable
   URL that resolves. A source you cannot find is reported as not found.
4. **Label confidence on every claim**: `verified` (primary source read),
   `probable` (secondary source consistent across two independent references),
   `uncertain` (single unverified mention). Only `verified` entries may enter a
   `.tex` file.
5. **A negative result is a result.** "Read it, it is genuinely different, here
   is the distinguishing hypothesis" is the most valuable outcome and the one to
   expect most often.

## The two dive patterns

**Planned dive** (`flag-N-<slug>/`) — use when the risk is narrow and specific
enough to hand to a separately-dispatched agent (or a future session) with no
other context: a single named competing result, a single suspect citation. The
brief has to stand alone, so it needs all six files.

```
flag-N-<slug>/
  README.md         the claim under test and what a resolution looks like
  reading-list.md   sources in priority tiers, with retrieval notes
  questions.md      the questions the read must answer, most decisive first
  prompt.md         the verbatim agent prompt
  skills.md         which skills apply to this dive and why
  findings.md       filled in by the dive; verdict first, then evidence
```

**Direct dive** (`paperN-<slug>/`) — use when the calling session runs the
read-plus-falsification pass itself, in one sitting, against a whole paper
rather than one named risk. There is no separate brief to write because nothing
is being handed off — `prompt.md`/`questions.md`/`reading-list.md`/`skills.md`
would just restate what `findings.md` already answers. Two files are correct
here, not a gap against the planned-dive layout:

```
paperN-<slug>/
  README.md         one-paragraph index entry: paper, verdict, one-line summary
  findings.md       verdict first (per claim, if the paper has several), then evidence
```

Write `TEMPLATE.md` in this directory before starting a new dive of either
kind — it has copy-pasteable skeletons for both patterns and the rule for
choosing between them.

`BIBLIOGRAPHY.md` holds the consolidated citation register across the four
planned dives, plus the cross-disciplinary renaming register — terms the papers
coined that already have established names in other fields. A citation
surfaced by a direct dive that should move into the register goes there too;
`BIBLIOGRAPHY.md` is corpus-wide, not per-flag.
