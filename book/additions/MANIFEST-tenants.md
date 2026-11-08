# MANIFEST: tenants (Ch3, `book/sealed-harbor.tex`, prefix `sealed`)

All files target `book/sealed-harbor.tex`. Line numbers refer to `main` at `1e84ff4`.

## 1. `additions/sealed-person-ledger.tex`

- **What it is:** `\subsection{The ledger keyed by person}\label{sec:sealed-person-ledger}`. About 620 words.
- **Where it goes:** at the end of the conservation section.
- **Insert after:** the `\end{pdboundary}` on line 1133.
  - That line is not unique in the file (there are 4 copies), so use this two-line anchor instead.
  - Old:
    ```
    \end{pdboundary}

    \section{Canaries with a power curve and a clock}\label{sec:sealed-detection}
    ```
  - New:
    ```
    \end{pdboundary}

    \input{additions/sealed-person-ledger}

    \section{Canaries with a power curve and a clock}\label{sec:sealed-detection}
    ```

## 2. `additions/sealed-canary-audit.tex`

- **What it is:** `\subsection{Canaries that audit a declaration}\label{sec:sealed-canary-audit}`. About 500 words.
- **Where it goes:** at the end of the canaries section.
- **Insert after:** the `\end{pdboundary}` on line 1345.
  - Old:
    ```
    \end{pdboundary}

    \section{The leakage budget: $q\cdot b$ bits, before timing}\label{sec:sealed-budget}
    ```
  - New:
    ```
    \end{pdboundary}

    \input{additions/sealed-canary-audit}

    \section{The leakage budget: $q\cdot b$ bits, before timing}\label{sec:sealed-budget}
    ```

## 3. `additions/sealed-tenants.tex`

- **What it is:** `\section{Many tenants, one harbor}\label{sec:sealed-tenants}`. About 1,850 words, including two `tabularx` tables.
- **Insert after this unique line (1429):**
  ```
  \input{figures/fig-sealed-leakage-ledger}
  ```
  That line is the last line of the leakage-budget section, immediately before `\section{Limitations and boundaries}\label{sec:sealed-limitations}`.

## 4. `additions/sealed-exercises-tenants.tex`

- **What it is:** six exercises with solutions, under three `\pdexercisesfor` heads in section order:
  - person ledger: 1 exercise
  - canary audit: 1 exercise
  - tenants: 4 exercises
- **Insert after this unique line (1519), inside `\section{Exercises}`:**
  ```
  \label{sec:sealed-exercises}
  ```
  It then sits before `\pdexercisesfor{\S\ref{sec:sealed-limitations}}{Limitations and boundaries}`.
- **Section order is preserved by head:** 3.5 subsection, 3.6 subsection, new section, then Limitations. The chapter's existing exercises for 3.1-3.7 all sit under the Limitations head, so that head stays last.

## 5. `additions/sealed-bib-tenants.tex`

- **What it is:** 24 new `\bibitem`s. None duplicates an existing key in the Book. Existing keys reused: `wrrw23`, plus the chapter's own labels.
- **Insert after this unique line (2009), before `\end{thebibliography}`:**
  ```
  (Common Criteria, CC:2022). International Organization for Standardization, 2022.
  ```

## Suggested changes to existing text (lead decides)

1. **Review of key ideas:** add one item after line 1515.
   - Old:
     ```
     \item The whole channel is priced before timing: \textbf{$q \cdot b$ bits} may leave through $q$ queries of $b$ bits each, and the room's guarantee is that budget, not silence.
     ```
   - New:
     ```
     \item The whole channel is priced before timing: \textbf{$q \cdot b$ bits} may leave through $q$ queries of $b$ bits each, and the room's guarantee is that budget, not silence.
     \item \textbf{A shared store needs labels, not a budget}: retrieval releases records exactly, so it has no finite $\varepsilon$; training can release through a ledger keyed by person, and scrubbing removes no owner's label.
     ```
2. **No edit is needed to the Whitehouse warning** (lines 1022-1026). The new subsection quotes it verbatim and qualifies it.

## Notes for integration

- **Renumbering:** Limitations becomes Sec. 3.9, Exercises Sec. 3.10 and History Sec. 3.11. Every existing cross-reference uses labels, so nothing breaks.
- **Twin-location notice:** the file header lists `docs/harbor-research/tex/paper4.tex` as a twin home. The new material exists only in the chapter. Check whether the drift checker needs a twin entry or an exemption.
- **Exercise kinds:** I used Check, Trace and Open. `figures/pd-pedagogy.tex` enforces exactly those three. The brief's Compute, Prove and Design would fail the build.
- **Proof style:** I used `\paragraph{Proof.}` ... `\qed`. That is Ch3's local habit (see Theorem `thm:sealed-conservation`), not `\begin{proof}`.
- **New labels:**
  - sections: `sec:sealed-tenants`, `sec:sealed-person-ledger`, `sec:sealed-canary-audit`
  - tables: `tab:sealed-tenant-channels`, `tab:sealed-tenant-policy`
  - design invariants: `inv:sealed-label-keyed`, `inv:sealed-scrub-not-declass`
  - theorems: `thm:sealed-no-scrubber`, `thm:sealed-person-ledger`, `thm:sealed-canary-falsify`
  - exercises: `ex:sealed-person-budget`, `ex:sealed-canary-refute`, `ex:sealed-tenant-route`, `ex:sealed-tenant-random-scrub`, `ex:sealed-tenant-cache`, `ex:sealed-tenant-persistent`
- **Not compiled.** The standalone chapter no longer compiles on its own: it needs the Book preamble's `\ifpdswiss` and `\keyidea`. The files passed:
  - the non-ASCII grep
  - the banned-phrase lint
  - brace, environment and `$` balance
  - a check that every label, ref and cite resolves

  The Book build is still needed to confirm.
