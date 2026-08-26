# Deep dives: the four priority flags

Four open questions about the harbor-research papers that a literature sweep
raised and that direct inspection of the `.tex` sources could not close. Each
folder is a self-contained work package: what the paper claims, what the
competing literature may already say, the sources to read, the questions a read
has to answer, the prompt to run it, and a `findings.md` the reader fills in.

## Why these four and not the whole sweep

The first sweep was run against the website's summary copy
(`website-v2/src/data/researchPapers.ts`) rather than the papers themselves, so
its headline conclusion — "no prior art engagement" — was wrong. Every paper in
`docs/harbor-research/tex/` already carries a substantive Related Work section
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

## Status

| Flag | Verdict | Summary |
|---|---|---|
| 1 | running | — |
| 2 | running | — |
| 3 | running | — |
| 4 | **CLEAR** | Suspect citation is **real but irrelevant** — excluded on relevance, not authenticity. Add Herlihy–Shavit, Saks–Zaharoglou, Herlihy–Kozlov–Rajsbaum, and PeerReview. All eight existing citations verified accurate; Bach 1999's *content* claim remains `probable` (paywalled) and is load-bearing. |

One lesson already worth carrying into the remaining three: the round
performance figures that made flag 4's citation look fabricated did not
distinguish "fabricated" from "real but weak." Both were live hypotheses and the
second one won. Suspicion was the right instinct; the conclusion it pointed at
was not.

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

## Layout

```
flag-N-<slug>/
  README.md         the claim under test and what a resolution looks like
  reading-list.md   sources in priority tiers, with retrieval notes
  questions.md      the questions the read must answer, most decisive first
  prompt.md         the verbatim agent prompt
  skills.md         which skills apply to this dive and why
  findings.md       filled in by the dive; verdict first, then evidence
```

`BIBLIOGRAPHY.md` holds the consolidated citation register across all four, plus
the cross-disciplinary renaming register — terms the papers coined that already
have established names in other fields.
