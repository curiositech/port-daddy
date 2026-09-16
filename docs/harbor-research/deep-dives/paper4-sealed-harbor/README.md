# `paper4-sealed-harbor` — index

**Paper**: 4, *The Sealed Harbor* (`docs/harbor-research/tex/paper4.tex`)

**Dive run**: 2026-08-26. Source read in full plus its four verification
scripts. Direct dive (Skeleton B) — no separate planning brief; see the parent
`README.md`'s "The two dive patterns."

**Verdict**: **NARROW** overall, with **one boxed corollary CONTRADICTED**.

The paper pre-concedes its theorems ("No single component theorem above is
ours"), which absorbs most prior-art pressure — Theorem 1 is delimited release
(Sabelfeld–Myers 2003), Theorem 2 inherits flag 2's Basin et al. exposure,
Theorem 3 is Rogers et al.'s privacy filter, Theorem 4 is standard statistics
correctly applied. What does not survive is the corollary to Theorem 3: it
applies the DRV advanced-composition bound to an adaptively-parameterised
budget filter, which Rogers–Roth–Ullman–Vadhan (NeurIPS 2016) prove invalid for
exactly that model — read in full, with a control test on the arXiv ID. That
corollary is claimed on a model strictly larger than the one it holds for; fix
it before anything else in the paper. A1 (severe): the falsification pass also
found Theorem 1's model has no channel for the laundering attack the prose
describes, so noninterference there is currently proved by having no attacker
to noninterfere against.

See `findings.md` for the full per-theorem verdict table, the corollary fix in
full with its source quoted verbatim, all six internal defects (A1, A2, A5, A6,
A4a/A4b, A7), and the open items list (Whitehouse et al. 2023 and van der
Meyden 2007 still `UNRESOLVED`).
