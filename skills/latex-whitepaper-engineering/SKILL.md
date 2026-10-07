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
pdflatex -halt-on-error -interaction=nonstopmode paper.tex >/dev/null 2>&1   # pass 1: refs
pdflatex -halt-on-error -interaction=nonstopmode paper.tex >/dev/null 2>&1   # pass 2: resolve
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

## Reproducible committed PDFs

Use the repository's pinned hosted TeX toolchain for published bytes. Export
`SOURCE_DATE_EPOCH` from the maximum Git author timestamp of the actual source
inputs and `FORCE_SOURCE_DATE=1`; include the build recipe and toolchain pin,
but exclude generated PDFs, catalog metadata, and review receipts. Author times
survive rebases. A clock time or HEAD timestamp makes unrelated commits change
PDF dates and identifiers.

Prove determinism with two clean builds and compare every output hash. Bind a
hosted build to its event SHA. Before replaying a generated commit onto a moved
branch, confirm its source inputs and epoch remain unchanged. Do not decide
freshness from a commit-message prefix. After a bot publication, verify the
actual PR head and its checks; a successful source-parent run does not validate
a later artifact commit. GitHub's built-in-token PR updates can leave runs
requiring approval, which may be absent from the ordinary check summary. Inspect
the Actions runs for the exact head and follow the normal approval path; see the [event rules](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).

## Source → published naming is NOT 1:1

Check the registry's `pdfPath`/`filename` before copying. In port-daddy, a
chapter's `.tex` source (e.g. `harbor-economy.tex`) does NOT publish a PDF of
its own — that was retired (an A4 render of the same words with no margin
column, a worse layout of the Book's 7x10in trim). Only two things are
individually published PDFs:

| Source | Published PDF |
|---|---|
| `whitepaper/textbook.json` + every chapter (via `scripts/generate-mega-whitepaper.mjs`) | `coordination-papers-mega-volume.pdf` (the Book — `pdfPath`/`pages`/`sizeKb` in `website-v2/src/data/whitePapers.ts`'s `COLLECTED_VOLUME`) |
| `docs/harbor-research/tex/paper1.tex` … `paper8.tex` (the eight standalone research papers) | `website-v2/public/research/paper1.pdf` … `paper8.pdf` (registry: `website-v2/src/data/researchPapers.ts`) |

A chapter entry in `WHITE_PAPERS` carries no `pdfPath`/`filename`/`pages`/
`sizeKb` at all; any "read" or "download" affordance for a chapter points at
`COLLECTED_VOLUME`.

After building: `cp build.pdf published-name.pdf`, then delete the stray
build PDF and `*.log`. **Some aux artifacts are tracked, some are not** — run
`git status` and only stage what was already tracked (`git ls-files` tells
you). Never `git add -A` here (coordination guard blocks it anyway).

## Registry sync (the CI drift check)

`website-v2/scripts/check-whitepaper-metadata.ts` compares each registry entry
to the on-disk PDF:

- `pages`: record the actual count. The current checker uses an absolute floor
  and a `max(5%, 4 pages)` drift band; passing the band is not exact metadata.
- `sizeKb`: `Math.round(bytes / 1024)` with tolerance `max(2%, 4 KB)` — but
  set it exact anyway. Use the registry generator to avoid rounding differences
  between language runtimes.
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
   Before adding a citation, verify the work's title, authors, venue, year, and
   the claim it actually supports against a primary record. A recognizable
   author name does not validate a fabricated title. Cite foundational theory
   beside the mathematical construction and empirical work beside its measured
   result; do not attribute this paper's new claims to either. An orphaned
   bibliography item needs a supported citation or removal, never a dummy
   citation or a blanket `\nocite{*}` to satisfy CI. Record unverifiable
   entries and their disposition in the research audit.
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

- The whitepaper pages on the site: `/whitepaper` is canonical and `/library`
  REDIRECTS to it (the redirect used to run the other way) — the routed
  papers page is `website-v2/src/pages/whitepaper/index.tsx`, and the chapter
  page is `website-v2/src/pages/whitepaper/PaperDetailPage.tsx`. There is no
  `pages/library` directory any more; the routes are in
  `website-v2/src/main.tsx`.
- PRs touching `public/whitepaper/**` trigger the metadata-drift workflow;
  PRs with visual changes need committed screenshots + a recording under
  `docs/pr-assets/pr-NNN/` embedded via SHA-pinned raw URLs.
- Doc-citation guard: repo paths cited in changed docs must exist — no
  brace-globs (`{a,b}.ts`); future files need a marker ("unbuilt",
  "doesn't exist yet") on the same line.
- `pdflatex` lives at `/Library/TeX/texbin/pdflatex` (BasicTeX); no
  latexmk/tectonic — hence the manual two-pass.
