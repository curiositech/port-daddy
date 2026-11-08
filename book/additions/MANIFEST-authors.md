# MANIFEST -- writer "authors" (multi-principal / many-authors strand)

Six new files. No existing file was edited. All anchors below were checked to be
unique in the worktree's current chapter files (after the lead's WIP commit
aa60744dd).

## 1. `ls-many-authors.tex` -> `book/legible-swarm.tex` (Ch4)

New `\section{Many authors, one sovereign}\label{sec:ls-many-authors}`, after
`sec:consent-canon`, before `\section*{Review of the key ideas}`.

Insert `\input{additions/ls-many-authors}` on its own line AFTER this exact line:

```
\pdexercisepointer{\ref{ex:ls-hobbes-mapping}}{\ref{ex:ls-ranker-political-organ}}{\pageref{ex:ls-hobbes-mapping}}
```

## 2. `ls-exercises-authors.tex` -> `book/legible-swarm.tex` (Ch4 Exercises)

Four exercises (`ex:ls-many-authors-tree`, `-cycle`, `-bets`, `-pause`); first line
is the `\pdexercisesfor` head for `sec:ls-many-authors`. It goes last in the
Exercises section, after the consent-canon group.

Insert `\input{additions/ls-exercises-authors}` AFTER the `\end{pdsolution}` line
that directly follows this unique line (the solution of
`ex:ls-ranker-political-organ`):

```
Same construction as Exercise~\ref{ex:ls-ranker-counter-surface}: one complete, append-only decision ledger recording every candidate, its ranking decision, reason codes, and a counterfactual, queryable directly and sampled independently of the production ranker rather than re-ranked by a second dashboard. The regress terminates at completeness plus direct sampling --- the base ledger already records every candidate and decision, and the counter-surface is a deterministic query over it, so no further ranker is needed to audit the ranker's omissions. The remaining trust assumption is the completeness of the event-capture boundary itself; that assumption should be tested and externally anchored, not hidden behind another summary.
```

Equivalently: before the comment rule that precedes the unique line
`\section{Related work and prior art}\label{sec:related}`.

## 3. `ls-bib-authors.tex` -> `book/legible-swarm.tex` (Ch4 thebibliography)

15 `\bibitem`s. Paste the CONTENTS (not an `\input`) inside Ch4's
`thebibliography`, e.g. AFTER the currently last line before
`\end{thebibliography}`:

```
\newblock \url{https://arxiv.org/abs/2602.12670}
```

- `sen1970impossibility` is a deliberate reuse of Ch7's key. Its body is
  byte-identical to `agent-transactions-whitepaper.tex`, so the generator
  collates the two into one reference (checked: no near-duplicate error).
- `macaroons2014` already exists in Ch4 and is reused; no new entry.

## 4. `he-principal-commitments.tex` -> `book/harbor-economy.tex` (Ch6)

New `\subsection{Principal-tagged commitments}\label{sec:he-principal-commitments}`
at the end of `sec:deontic-decision`, after the reachable-future theorem, its
boundary and its pointer. Insert `\input{additions/he-principal-commitments}`
AFTER this exact line:

```
\pdexercisepointerone{\ref{ex:he-deontic-conflict-checker}}{\pageref{ex:he-deontic-conflict-checker}}
```

## 5. `he-exercises-authors.tex` -> `book/harbor-economy.tex` (Ch6 Exercises)

Two exercises (`ex:he-blame-order`, `ex:he-new-direction-check`); first line is
the `\pdexercisesfor` head for `sec:he-principal-commitments`. Insert
`\input{additions/he-exercises-authors}` AFTER the `\end{pdsolution}` that closes
`ex:he-deontic-conflict-checker`, i.e. immediately BEFORE this unique line:

```
\pdexercisesfor{\S\ref{sec:keystone}}{The keystone the market rests on --- and does not yet have}
```

## 6. `he-bib-authors.tex` -> `book/harbor-economy.tex` (Ch6 thebibliography)

3 `\bibitem`s. Paste contents inside Ch6's `thebibliography`, e.g. AFTER the
currently last line before `\end{thebibliography}`:

```
\url{https://arxiv.org/abs/2605.29800}
```

## Required follow-ups for the lead

1. **Short forms.** Every new key needs a `\pdciteshort` row, or the generator
   throws "Margin reference ... has no short form". After pasting the bibitems,
   run `python3 scripts/harbor-research/build_cite_shortforms.py`. Checked in a
   scratch copy: it produces rows for all 17 new keys (e.g. `FEMA 2017`,
   `Mediratta et al. 2026`, `Rohloff \& Lafortune 2005`).
2. **Existing integration bug (not from these files).** Comment lines such as
   `% Bibliography entries for he-licence-split.tex (attribution strand).` inside
   `thebibliography` become part of the preceding entry's body. In the current
   worktree this (a) fails the generator with
   `Stale or invalid edited margin entry: mega229` (Ch6 `ctgvb2021`), and
   (b) after that is fixed, makes XeLaTeX fail with a runaway
   `\pdbookreference` (Ch5 Gordon-Roth entry), because the `%` comments out the
   argument's closing braces. Reproduced on an untouched copy of the worktree.
   Fix: delete those comment lines (harbor-economy.tex, spawn-to-person.tex,
   legible-swarm.tex). With them deleted, the generator and a two-pass XeLaTeX
   build of Ch4 and Ch6 including these additions completed with no errors and
   no undefined references to any label in these files.

## Suggested small changes to existing text (lead decides)

A. Ch4 `Review of the key ideas` (legible-swarm.tex). old:

```
not comprehension or arbitrary pinning policies.
\end{enumerate}
```

new:

```
not comprehension or arbitrary pinning policies.
\item \textbf{Several authors, one sovereign.} Many principals keep the single
writer; what they add is one charter, one owner per scope, and a delegation
tree. Escalation has a well-defined path exactly when delegation is a tree.
\end{enumerate}
```

B. Ch4 status table (`app:honest`, legible-swarm.tex). old:

```
O & Consent grant + inalienable override & \Vision & Invariant~\ref{def:consent}, Invariant~\ref{prop:override} \\
```

new (add one row after it):

```
O & Consent grant + inalienable override & \Vision & Invariant~\ref{def:consent}, Invariant~\ref{prop:override} \\
O & Many-author charter, owner table and escalation routing & \Vision & Invariant~\ref{def:ls-many-authors}; no implementation \\
```

## Notes on choices

- **Exercise kinds.** The brief lists Compute/Prove/Design, but `pdexercise`
  accepts only `Check`, `Trace`, `Open` (figures/pd-pedagogy.tex errors
  otherwise). Used those.
- **T3 (Arrow) is prose, not a Theorem.** Ch0's `thm:arrow` is not namespaced
  in the Book, and a `\ref` from a chapter is rewritten to `ls:thm:arrow`, which
  nothing defines. No chapter currently references Ch0 labels. The text says
  "Arrow's theorem, as stated in Chapter~0" instead.
- **Cross-chapter refs** (swk, anchor, bonded, he, ls) are all inside
  `\ifpdbook ... \fi`, following the existing pattern, so the prose reads
  correctly in either build.
- **NIMS URL omitted from the bibitem.** The opened document's URL contains
  spaces:
  `https://training.fema.gov/EMIWeb/IS/IS700b/Handouts/National_Incident_Management System_Third Edition_October_2017.pdf`.
  Encoding them as `%20` breaks `\pdbookreference` arguments, so the entry
  (`fema2017nims`) carries no `\url`. Add one if a space-free official URL is
  found.
- **Conflict table split in two** (`tab:ls-conflict-classes`,
  `tab:ls-conflict-classes-code`). One 9-row table, with or without margin
  citations, failed `pd-margin-layout`: "Exhibit exceeds the Book text height".
  Citations moved from cells into the prose after the tables.
- **Left out, as instructed or unverified:** ParallACT's 29%->61% ownership
  figure and its 61%-still-conflicted figure; all "Worse Together" numbers;
  Crystal's 33%; Muses-Bench numbers; Gibbard's waivable-rights resolution of
  Sen (not opened); a minimum-cardinality blame set (complexity not claimed,
  stated as not claimed).
