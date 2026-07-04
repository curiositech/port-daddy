---
name: latex-whitepaper-engineering
description: "Author, revise, and ship LaTeX whitepapers in repos that publish committed PDFs behind a metadata registry. Covers the full loop: editing .tex with thebibliography discipline, two-pass pdflatex builds, catching undefined citations/references from the log, source→published PDF naming, version/date title blocks bumped in lockstep with the site registry, and Math.round(bytes/1024) size sync against metadata drift checks in CI. Use when editing website-v2/public/whitepaper/*.tex in port-daddy or any repo where PDFs are committed artifacts with a registry (pages/sizeKb) test. NOT for prose voice (use port-daddy-expository-writer), NOT for resume/CV typesetting (use cv-creator), NOT for HTML/MDX document generation (use document-generation-pdf)."
license: FSL-1.1-MIT
allowed-tools: Read,Write,Edit,Bash,Grep,Glob
metadata:
  category: Writing
  tags: [latex, pdflatex, whitepaper, bibliography, ci, metadata-drift, port-daddy]
  pairs-with: [port-daddy-expository-writer, game-theoretic-agent-incentives, nisan-et-al-2007-algorithmic-game-theory]
  provenance:
    kind: first-party
    owners: [erichowens]
---

# LaTeX Whitepaper Engineering

Repos like port-daddy commit both the `.tex` source AND the built PDF, with a
registry (`website-v2/src/data/whitePapers.ts`) pinning `pages` and `sizeKb`,
enforced by a CI drift check. Editing the prose is a third of the job; the
other two thirds are rebuilding correctly and keeping three surfaces — tex
title block, PDF bytes, registry entry — in lockstep. Skipping any leg ships
a red build or, worse, a silently stale PDF.

## The ship loop (never skip a step)

```bash
cd website-v2/public/whitepaper
pdflatex -interaction=nonstopmode paper.tex >/dev/null 2>&1   # pass 1: refs
pdflatex -interaction=nonstopmode paper.tex >/dev/null 2>&1   # pass 2: resolve
grep "Output written" paper.log        # → "(NN pages, BBBBBB bytes)"
grep -c "LaTeX Error" paper.log        # must be 0
grep "Warning: Citation" paper.log     # every hit = a \cite with no \bibitem
grep "Warning: Reference" paper.log    # dangling \ref — check if pre-existing
```

- **Always two passes.** Pass 1 writes the `.aux`; pass 2 resolves `\ref`/`\cite`.
  One pass looks fine and ships `??` in the PDF.
- **Read the log, not the exit code.** `pdflatex -interaction=nonstopmode`
  exits 0 through many warnings; undefined citations are warnings.
- **Pre-existing dangling refs happen** when papers share content lineage
  (e.g. labels living in a sibling paper). Note them in the PR; don't chase
  labels that belong to another document.

## Source → published naming is NOT 1:1

Check the registry's `pdfPath`/`filename` before copying. In port-daddy:

| Source | Published PDF |
|---|---|
| `harbor-economy.tex` | `harbor-economy-whitepaper.pdf` |
| `spawn-to-person.tex` | `spawn-to-person-whitepaper.pdf` |
| `agent-transactions-whitepaper.tex` | same name `.pdf` |

After building: `cp build.pdf published-name.pdf`, then delete the stray
build PDF and `*.log`. **Some aux artifacts are tracked, some are not** — run
`git status` and only stage what was already tracked (`git ls-files` tells
you). Never `git add -A` here (coordination guard blocks it anyway).

## Registry sync (the CI drift check)

`scripts/check-whitepaper-metadata.ts` compares each registry entry to the
on-disk PDF:

- `pages`: **exact match required.** Adding a section that spills a page
  means bumping the registry.
- `sizeKb`: `Math.round(bytes / 1024)` with tolerance `max(2%, 4 KB)` — but
  set it exact anyway; drift-within-tolerance rots. Beware shell arithmetic:
  `$(( (bytes + 512) / 1024 ))` FLOORS after the add and disagrees with
  `Math.round` near .5 boundaries. Compute with node/python if unsure.
- Run the real test when deps exist: `vitest run src/data/whitePapers.test.ts`.
  In a fresh worktree, symlink the main checkout's `node_modules` first —
  and `rm` the symlink before committing.

## Version & date discipline

The `\date{...}` title block carries both date and version, and the registry
duplicates them (`date`, `status`). Bump BOTH in the same commit:

```latex
\date{July 2026\\Version 1.1 (Harbor Volume, L3 bridge)}
```

- Content-touching change → bump minor (1.0→1.1); adversarial-review wave on
  a pre-print → 2.5→2.6; patch-scale on a pre-print → 0.9→0.9.1.
- If a version pins a software release (`Port Daddy v3.23.0`), read the
  CURRENT `package.json` version — don't carry the stale pin forward.

## Bibliography & citations

These papers use inline `thebibliography`, not BibTeX. To add citations:

1. Add `\cite{key}` in prose; add the matching `\bibitem{key}` before
   `\end{thebibliography}` — copy the neighbor entries' exact `\newblock`
   style (it differs per paper; match the file you're in).
2. Keep bibitem keys identical across the paper suite (`ucp2026`,
   `ap2mandates2026`) so cross-paper grafts stay greppable.
3. URLs in bibitems: `\texttt{https://...}` — bare URLs break line-wrapping.
4. After adding, the two-pass build + `Warning: Citation` grep is the ONLY
   verification that counts.

## Related-work grafts across a paper suite

When adding the same theme to several papers, write each in the register of
the paper's thesis — never paste one paragraph N times. A proofs paper gets a
subsection noting which proof obligations the change adds; an economics paper
gets a positioning paragraph + prior-art table row; an honesty-driven paper
gets the caveat stated harder than the claim. Match `\paragraph{}` vs
`\subsection{}` to what the target's related-work section already uses.

## Repo gotchas (port-daddy specific)

- The whitepaper pages on the site: `/whitepaper` REDIRECTS to `/library` —
  the routed papers page is `website-v2/src/pages/library/index.tsx`;
  `pages/whitepaper/index.tsx` is unrouted legacy. Edit the routed one.
- PRs touching `public/whitepaper/**` trigger the metadata-drift workflow;
  PRs with visual changes need committed screenshots + a recording under
  `docs/pr-assets/pr-NNN/` embedded via SHA-pinned raw URLs.
- Doc-citation guard: repo paths cited in changed docs must exist — no
  brace-globs (`{a,b}.ts`); future files need a marker ("unbuilt",
  "doesn't exist yet") on the same line.
- `pdflatex` lives at `/Library/TeX/texbin/pdflatex` (BasicTeX); no
  latexmk/tectonic — hence the manual two-pass.
