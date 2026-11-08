# MANIFEST (memory): consolidation, memory and identity, Ch5

Target chapter for every file: `book/spawn-to-person.tex` (prefix `stp`).

## 1. `additions/stp-consolidation.tex`

New subsection `\subsection{Consolidation compacts the view, never the record}`
(`\label{sec:stp-consolidation}`), closing `\S\ref{sec:organs}`.

Insert `\input{additions/stp-consolidation}` AFTER this exact line (unique; it
ends sec:organs, just before the `\section{Identity: ...}` banner):

```
\pdexercisepointer{\ref{ex:stp-weak-organ}}{\ref{ex:stp-death-taxonomy}}{\pageref{ex:stp-weak-organ}}
```

New labels: `sec:stp-consolidation`, `tab:stp-memory-survey`,
`def:stp-memory-view`, `thm:stp-consolidation-separation`,
`inv:stp-ledger-faithful`, `thm:stp-coverage-ledger`, `ex:stp-lunches-only`.
Existing labels used: `thm:engine-swap`, `thm:resurrection-soundness`,
`tab:stp-organs`, `def:oracle`, `def:principal`, `prop:tombstone`,
`sec:parfit-lineage-map`, `sec:identity`, `fig:stp-handoff-coverage`.

## 2. `additions/stp-exercises-memory.tex`

Three exercises with solutions: `ex:stp-consolidation-f4` (Check),
`ex:stp-lunches-trace` (Trace), `ex:stp-bounded-coverage` (Open). The first
line is the `\pdexercisesfor{\S\ref{sec:stp-consolidation}}{...}` head.

Insert `\input{additions/stp-exercises-memory}` AFTER the `\end{pdsolution}`
that directly follows this exact line (unique; end of the sec:organs
exercises), i.e. immediately BEFORE the unique line
`\pdexercisesfor{\S\ref{sec:identity}}{Identity: the root the whole chain hangs from}`:

```
provider. Checkpoint guarantees should state which tier they provide.
```

## 3. `additions/stp-bib-memory.tex`

Fifteen new `\bibitem`s (no key exists elsewhere in `book/*.tex` or
`book/additions/*.tex`). Insert inside `thebibliography`, AFTER this exact line
(unique; last entry before `\end{thebibliography}`):

```
\newblock Microsoft Research Technical Report MSR-TR-2014-41, 2014.
```

## 4. Changes to existing Ch5 text (old -> new; the lead decides)

### E1. Reid's evidence line and the Lockean exculpation point (sec:continuity)

Old (unique):
```
\emph{not} be the boy --- a contradiction.
```
New:
```
\emph{not} be the boy --- a contradiction. Reid draws the moral himself: ``What
makes it the case that I was the person who did such-and-such is not my
remembering doing it''~\pdcite{reid1785memory}. Locke, who calls ``person'' a
``Forensick Term'', also holds that ``Socrates waking and sleeping is not the
same Person''~\pdcite{gordonroth2019locke}; read as a rule for agents, that
criterion would let an agent that forgot a debt stop owing it, so the ledger
keeps Locke's forensic purpose and rejects his criterion
(\S\ref{sec:stp-consolidation}).
```

### E2. The consolidation receipt as the missing witness (sec:parfit-lineage-map)

Old (unique):
```
This chapter specifies no such witness.
```
New:
```
This chapter specifies no such witness for checkpoints or ledger positions; for
notes, \S\ref{sec:stp-consolidation} proposes one, the consolidation receipt.
```

### E3. "Forgetting is not resetting" (Reset and identity-replication attacks)

Old (unique, second line of the Sybil item, copied verbatim with its two leading spaces):
```
  reputation or quorum mechanism counts each as an independent participant. Rate-limited issuance and bonded admission are candidate safeguards. Their effect depends on enforceable principal linkage and issuance limits; naming a daemon as issuer does not itself prevent one principal from collecting aliases.
```
New (same line, plus one new item):
```
  reputation or quorum mechanism counts each as an independent participant. Rate-limited issuance and bonded admission are candidate safeguards. Their effect depends on enforceable principal linkage and issuance limits; naming a daemon as issuer does not itself prevent one principal from collecting aliases.
  \item \textbf{Forgetting is not resetting.} An agent that consolidates a debt out of its notes has not shed it: under the premises of Theorem~\ref{thm:stp-consolidation-separation} the debt is a function of the ledger, and it stays open against the same principal until a ledger operation closes it (\S\ref{sec:stp-consolidation}).
```

## Notes for the lead

- Numbers used are only those the coordinator marked verified. The
  endogenous-authorization-laundering figures (50.2%, 98.6%) are from the arXiv
  abstract page of 2609.01836 (the bib entry cites v1). An alphaXiv copy labelled
  v2 reads 45.4% and 99.0%; the 23.5% to 4.9% rebuild figure is omitted.
- Zhang et al.: the text uses the abstract's "failed on 54%". The paper's body
  says repeated consolidation left about 46% of previously solved problems
  unsolved (accuracy 100% to about 54%). Worth a look before publication.
- The Letta quote "Prioritize the new information over existing memories" is
  given as the coordinator specified; the extracted PDF text reads "overy", a
  typo in the source. Consider [sic] or keep the silent correction.
- The counterexample cases are named, not numbered, in the book (the research
  labels C1, C2, C4, C6 would print with gaps).
- Exercise kinds: the pedagogy macros accept only Check, Trace and Open, so the
  three exercises use those.
- Reid's sentence is from Essay III, ch. 4 of Jonathan Bennett's version (the
  URL in the bib entry); Locke's phrases are quoted from the SEP entry, which
  quotes Locke.
