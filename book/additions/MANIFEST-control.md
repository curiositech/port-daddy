# MANIFEST: control strand (alignment / isolation / rationality)

Writer suffix: `control`. All files are new, under `book/additions/`. No existing
`.tex` file was edited.

Placement rule used throughout: "insert after line X" means a new line holding
`\input{additions/<file>}` goes immediately after X. Where X itself is not unique
(`\end{pdsolution}`, `\end{pdrecitation}`, `\end{pdclaim}`, `\end{table}`), the
anchor is given as a unique line plus the closing line that follows it. The lead's
WIP commit `aa60744dd` was checked: none of these anchors moved.

## Chapter 1: `book/single-writer-kernel.tex` (prefix `swk`)

### `swk-control-game.tex` (section, about 1,050 words)
- New `\subsubsection{The control game: what a gate leaves to evaluation}`,
  `\label{sec:swk-control-game}`, inside `\S\ref{sec:controllability}`.
  It holds Theorem `thm:swk-control-game` with its proof, a `pdexample`, a
  `\Vision{}` protocol, and the closing `\pdexercisepointer`.
- Insert after the unique line (end of the monitor-coverage paragraph that
  follows the controllability boundary and Recall block):
  ```
  subsystem, carrying a time-of-check-to-time-of-use surface.
  ```
  The section then sits before the open-font comment block and before
  `\subsection{Commitments: obligation with oracle-bound closure}`.

### `swk-exercises-control.tex` (2 exercises)
- Its first line is `\pdexercisesfor{\S\ref{sec:swk-control-game}}{...}`. It goes
  after the `sec:enforcement` group, which contains the new subsubsection.
- Insert after the `\end{pdsolution}` that follows the unique line starting
  ```
  A protected-run receipt: tree hash, a suite hash the principal controls,
  ```
  That is the solution of `ex:swk-op5-oracle`, immediately before the unique line
  `\pdexercisesfor{\S\ref{sec:continuity}}{The continuity subsystem: memory, checkpoint, and the foundation of the economy}`.
  The existing pointer at the end of `sec:enforcement` (`ex:swk-monitor-rules-precommit`
  to `ex:swk-op5-oracle`) keeps its range.

### `swk-bib-control.tex` (11 entries)
- Paste inside Ch1's `thebibliography`, immediately before `\end{thebibliography}`.
  New keys: `dastani2017normenforcement`, `hubinger2024sleeper`,
  `greenblatt2024control`, `griffin2024controlgames`, `bhatt2025ctrlz`,
  `zhong2025impossiblebench`, `murray2013sel4infoflow`, `lehmann2020wasm`,
  `chuang2026teefail`, `marchand2026sandboxescape`, `debenedetti2025camel`.
  Reused existing keys: `agache2020firecracker`, `young2019gvisor`, `klein2009sel4`.
  No other chapter has an entry for these works.

### Proposed edit to existing text (Ch1)
After Theorem "Regimentation Is Controllability", add one sentence at the end of the
"Two remarks on what the proof used" paragraph.
- old (unique):
  ```
  statement makes local database computability necessary for every safe protocol.
  ```
- new:
  ```
  statement makes local database computability necessary for every safe protocol.
  Dastani, Sardina and Yazdanpanah model three norm-enforcement mechanisms of
  normative multi-agent systems as supervisory control of discrete-event systems,
  which gives those mechanisms a formal-language semantics and lets enforcers be
  synthesized automatically for some classes of systems and
  properties~\pdcite{dastani2017normenforcement}.
  ```
  (Its bibitem is in `swk-bib-control.tex`. The summary was checked against the
  publication page at research.utwente.nl.)

## Chapter 5: `book/spawn-to-person.tex` (prefix `stp`)

### `stp-transmission.tex` (subsection, about 700 words)
- New `\subsection{Do the incentives reach the agent?}`, `\label{sec:stp-transmission}`.
  It holds Empirical hypothesis `hyp:stp-transmission`, Theorem
  `thm:stp-honeypot-recognition` with its proof, a `pdexample`, and an unstarred
  pointer.
- Insert after the `\end{pdrecitation}` that follows the unique line
  ```
  does not supply.
  ```
  This is the end of the `sec:oracle` Recall block, immediately before the
  `\ifdefined\pdswisslandmarkplate` plate block that precedes
  `\section{Revocation, tombstones, and bounded memory}`. The new subsection
  therefore closes `sec:oracle` without capturing that section's starred pointer or
  its Recall block.
- It uses the chapter's own symbols: $\rho$, $d$, $B$, $G_k$, and
  $\rho^\star = G_k/(dB) = 0.25$ at $G=10$, $d=0.8$, $B=50$.

### `stp-exercises-control.tex` (2 exercises)
- Its first line is `\pdexercisesfor{\S\ref{sec:stp-transmission}}{...}`.
- Insert after the `\end{pdsolution}` that follows the unique line
  ```
  does part of the deterring.
  ```
  That is the solution of `ex:stp-tower-amortization`, immediately before the unique
  line `\pdexercisesfor{\S\ref{sec:revoke}}{Revocation, tombstones, and bounded memory}`.

### `stp-bib-control.tex` (5 entries)
- Paste immediately before `\end{thebibliography}`. New keys:
  `chen2023gptrationality`, `akata2023repeated`, `zhou2026utilitybehavior`,
  `zhu2024incoherent`, `needham2025evalaware`.

## Chapter 6: `book/harbor-economy.tex` (prefix `he`)

### `he-effective-reviewers.tex` (remark, about 180 words)
- `\begin{remark}\label{rem:he-effective-reviewers}`, plus a
  `\pdexercisepointerone`.
- Insert after the `\end{pdclaim}` that follows the unique line
  ```
  bound applies only if the reporting and independence hypotheses hold.
  ```
  That is right after Theorem `thm:assurance` (Purchased Assurance Bound) and
  immediately before the unique line
  `\begin{pdclaim}{Theorem}{Becker Deterrence for the Panel}`.
- It uses only the abstract's figure, "about two" effective votes, and does not use
  2.2, 1.93 or 9.1%. The prescribed $k_{\mathrm{eff}}$ is defined from the measured
  all-miss rate. That keeps it consistent with the chapter's own pairwise
  counterexample (`\pdpairwisecounterexample` in `sec:assurance-correlation`), which
  forbids substituting a pairwise or variance-based effective size.

### `he-exercises-control.tex` (1 exercise)
- There is no `\pdexercisesfor` head. The remark is not a new section, so the
  exercise joins the existing `\pdexercisesfor{\S\ref{sec:adversarial-tests}}{Purchased assurance}` group.
- Insert after the `\end{pdsolution}` that follows the unique line
  ```
  its size; multiplying marginal miss probabilities is then invalid.
  ```
  immediately before the unique line `\section{Related work}\label{sec:related}`.

### `he-bib-control.tex` (1 entry)
- Paste immediately before `\end{thebibliography}`. New key: `kohli2026ninejudges`.
  The Ch6 house style (initials, quoted title) is used.

## Appendices: `book/coordination-papers-mega-volume-appendices.tex` (prefix `app`)

### `app-isolation.tex` (subsection A.3, about 1,000 words)
- `\subsection{What isolation supplies, and what it leaves}`, `\label{app:isolation}`,
  with Table `tab:app-isolation-primitives`.
- Insert after the unique line
  ```
  settlement institutions described in \pdchapref{fh}{The Federated Harbor}.
  ```
  That is the end of "What exists now". It becomes A.3, before the generated
  mechanized-claims block, and no existing appendix number changes.

### `app-players.tex` (new section, about 650 words)
- `\section{Testing whether the players exist}`, `\label{app:players}`, with Table
  `tab:app-players-battery`.
- Insert after the `\end{table}` that closes `tab:op-concordance`, immediately
  before the unique line
  ```
  \ifdefined\pdEnableMarginCitations\else
  ```
  It becomes the last lettered appendix, before References, and no existing
  appendix letter changes.

### Appendix citations: no bib file
The appendices are `\input` by the root and are not passed through
`generate-mega-whitepaper.mjs`. Chapter cite keys are rewritten to `megaNNN` only
inside chapters, so a `\pdcite` in an appendix would not resolve. Both appendix
files therefore name their sources in prose ("Agache and colleagues on
Firecracker", ...). Every one of those works is `\pdcite`d from
`swk-control-game.tex` (isolation) or from `stp-transmission.tex` and
`he-effective-reviewers.tex` (players), so all of them appear in the collected
references. There is no `app-bib-control.tex`.

Appendix cross-references use the generator's namespaced chapter labels, which
exist only in the Book build: `swk:thm:regimentation-controllability`,
`swk:thm:swk-control-game`, `swk:sec:merkle`, `swk:sec:swk-control-game`,
`sealed:sec:sealed-design`, `ls:thm:escalation-threshold`, `stp:thm:whitewash-cost`,
`stp:thm:stp-honeypot-recognition`, `stp:hyp:stp-transmission`,
`he:prop:becker-deterrence`, `he:thm:assurance`, `bonded:prop:claim-signaling-ic`.

Cross-chapter references inside chapter files sit inside `\ifpdbook ... \fi` with
the target's chapter prefix, the same pattern as Ch1's existing
`stp:thm:tower-imported`.

## Notes
- Exercise kinds: the brief lists Compute, Prove and Design, but
  `figures/pd-pedagogy.tex` accepts only `Check`, `Trace` and `Open`, and any other
  kind raises a PackageError. Only those three are used.
- Maturity: every mechanism and test is `\Vision{}`. Theorems are proved in place.
  The supremal-sublanguage usefulness bound (the middle case of the control game) is
  stated in prose as `\Open{}`, not as a Theorem.
- Self-checks run on all 11 files:
  - no non-ASCII bytes;
  - braces, environments and `$` balanced;
  - every `\ref`, `\pageref` and `\pdcite` resolves, with chapter namespacing taken
    into account;
  - no label clashes with `book/*.tex` or the other `additions/*.tex`;
  - `check-banned-phrases.mjs` passes on each file.
  No LaTeX build was run.
