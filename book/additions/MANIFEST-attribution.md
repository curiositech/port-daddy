# MANIFEST: attribution strand (skill attribution, licence split, system prompt)

All files are new. No existing `.tex` file was edited. Line numbers are from
the worktree at the time of writing (branch `book/research-agenda-additions`);
the anchor strings are unique in their files (checked with `grep -cF`).

## Ch6, `book/harbor-economy.tex` (prefix `he`)

### `additions/he-licence-split.tex` (new `\subsection{What the licence meter counts}`, label `sec:he-licence-split`)

Insert `\input{additions/he-licence-split}` AFTER this line (line 835):

```
\pdexercisepointer{\ref{ex:he-grossman-hart-roles}}{\ref{ex:he-portfolio-version-binding}}{\pageref{ex:he-grossman-hart-roles}}
```

This line closes `\S\ref{sec:one-settlement}`. I put the file here, not directly
after `\end{pdexample}` of "One trade, two sources of funds", so that the example
keeps its figure, its one-line check (`-458+400+50+8+0=0`) and its "Now you try"
paragraph. Numbers by Hand 6.3.1 is unchanged. The new subsection says that the
per-file count there is a cap and an illustration, and that its own rule replaces
it for settlement. The worked application gives `min(8,6)=6` and
`-456+400+50+6+0=0`.

New labels: `sec:he-licence-split`, `tab:he-billing-rules`,
`prop:he-meter-steering` (the chapter's existing `property` environment, as used at
`thm:lax`), `thm:he-licence-split`, `thm:he-loo-royalty`, `def:he-effect-royalty`.
The file also contains one `pdexample` ("Carol Splits Her Skill").
Cross-chapter refs use the chapter's `\ifpdbook` idiom:
`stp:thm:whitewash-cost` and `stp:sec:stp-skill-attribution`.

### `additions/he-bib-attribution.tex` (one `\bibitem`: `agarwal2019market`)

Insert `\input{additions/he-bib-attribution}` AFTER this line (line 3433, the last
entry before `\end{thebibliography}`):

```
Obligation is coNP-Complete.'' arXiv:2105.05431, 2021.
```

### `additions/he-exercises-attribution.tex` (starts with `\pdexercisesfor{\S\ref{sec:he-licence-split}}{...}`)

Contents: three exercises, `ex:he-meter-steering-edit` (Check, 1),
`ex:he-split-shapley` (Trace, 2) and `ex:he-sybil-licensor` (Open, 3).

Insert `\input{additions/he-exercises-attribution}` AFTER the `\end{pdsolution}`
at line 2489. That line directly follows the unique line (2488):

```
\input{figures/fig-he-skill-lineage}
```

Equivalently, insert immediately BEFORE the unique line (2490):

```
\pdexercisesfor{\S\ref{sec:deontic-decision}}{Checking whether commitments can coexist}
```

This places it at the end of the `sec:three-on-one` exercise group, matching
section order.

## Ch4, `book/legible-swarm.tex` (prefix `ls`)

### `additions/ls-fit-uplift.tex` (`\paragraph{Ranking skills: fit is not uplift.}` plus Theorem `thm:ls-fit-uplift`)

Insert `\input{additions/ls-fit-uplift}` AFTER this line (line 2505, in
`\S\ref{sec:relevance}` of `sec:discovery`, closing the comonotone discussion and
before `\paragraph{The regret head is derived, not designed.}`):

```
may serve both; their scores still need separate interpretations.
```

This is a paragraph, not a new section. It therefore has no exercise-group head
and no pointer of its own. Its exercise falls inside the range of the existing
`sec:discovery` pointer.

### `additions/ls-bib-attribution.tex` (one `\bibitem`: `li2026skillsbench`)

Insert AFTER this line (line 4360, the last entry before `\end{thebibliography}`):

```
\newblock \url{https://doi.org/10.14722/ndss.2014.23212}
```

### `additions/ls-exercises-attribution.tex` (one exercise, `ex:ls-fit-uplift-pair`, Check, 1; no group head)

Insert AFTER the `\end{pdsolution}` at line 3613. That line directly follows the
unique line (3612):

```
second item alone yields~$4$.
```

Equivalently, insert immediately BEFORE the unique line (3614):

```
\begin{pdexercise}[kind=Check,rating=1]{ex:ls-goodhart-exposure}
```

This keeps the exercise within the existing pointer range
`ex:ls-split-ranker-statement`--`ex:ls-decay-vs-summary`, so no pointer change is
needed.

## Ch5, `book/spawn-to-person.tex` (prefix `stp`)

### `additions/stp-skill-attribution.tex` (new `\subsection{Which part of a skill helped}`, label `sec:stp-skill-attribution`)

Insert `\input{additions/stp-skill-attribution}` AFTER this line (line 2062):

```
\pdexercisepointer{\ref{ex:stp-judge-competence}}{\ref{ex:stp-vector-disclosure}}{\pageref{ex:stp-judge-competence}}
```

This line follows Protocol 5.9.2 (`proto:skill`) and its "Use is not proof of
benefit" pitfall. I put the file after that subsection's pointer so the pointer
stays beside the text it belongs to.

New labels: `sec:stp-skill-attribution`, `proto:stp-masked-asset`,
`tab:stp-skill-estimands`. The file also contains the
`\keyidea[What the system prompt is responsible for]{...}` box. It refers to the
existing `tab:stp-not-bandit` and to `he:sec:he-licence-split` (`\ifpdbook`).

### `additions/stp-bib-attribution.tex` (nine `\bibitem`s)

Keys: `anthropic2026skills`, `zhang2026estimands`, `dong2026harmful`, `dudik2011dr`,
`lewontin1974`, `sclar2024`, `mizrahi2024`, `srinivasan2026ddr` and
`bordt2023shapley`.

Insert AFTER this line (line 3749, the last entry before `\end{thebibliography}`):

```
\newblock Microsoft Research Technical Report MSR-TR-2014-41, 2014.
```

### `additions/stp-exercises-attribution.tex` (starts with `\pdexercisesfor{\S\ref{sec:stp-skill-attribution}}{...}`)

Contents: two exercises, `ex:stp-opened-not-treatment` (Check, 1) and
`ex:stp-prompt-contrast` (Trace, 2).

Insert AFTER the `\end{pdsolution}` at line 3212. That line directly follows the
unique line (3211):

```
one universal target from becoming the asset itself.
```

Equivalently, insert immediately BEFORE the unique line (3214):

```
\pdexercisesfor{\S\ref{sec:oracle}}{The grading oracle's incentive-compatibility}
```

## Changes to existing text

None needed.

## Notes for the lead

- The exercise kinds are Check, Trace and Open only. `pd-pedagogy.tex` enforces
  `Check,Trace,Open`, although BRIEF.md lists more.
- The bib keys are new; no chapter cited these works before. Each bib entry
  carries the URL I opened. The Lewontin URL is the reprint PDF I read. I did not
  verify the 1974 AJHG volume and page numbers, so they are omitted.
- Every `\ref` in these files resolves. Every new label is defined exactly once
  across `book/*.tex` and `book/additions/*.tex`.
