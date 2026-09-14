# Whitepaper source-tree consolidation — plan, not execution

**Status: plan only. No move happens in this PR.** `claude/retire-chapter-pdfs`
is mid-flight on `scripts/build-whitepapers.sh`,
`website-v2/src/data/whitePapers.ts`, and
`website-v2/scripts/check-whitepaper-metadata.ts` — the exact three files a
source move would touch first. Landing a tree move now guarantees a rebase
collision on all three. This document is the inventory and the sequencing so
that whoever executes the move (after `retire-chapter-pdfs` lands) does not
have to re-derive it from scratch.

Every count below was measured against the tree at the time of writing
(`find`, `diff -rq`, `du`, and reading the actual consumer source) — none of
it is estimated.

## 1. The inventory: what lives where

### `whitepaper/` (752 KB)

```
whitepaper/.gitignore
whitepaper/corpus.json                    # formal-artifact / research-program manifest
whitepaper/corpus.schema.json
whitepaper/legible-swarm.tex              # chapter source
whitepaper/single-writer-kernel.tex       # chapter source
whitepaper/standalone-figures.json
whitepaper/textbook.json                  # THE single TOC source (chapters, parts, slugs)
whitepaper/textbook.schema.json
whitepaper/figures/*.tex                  # 27 files
whitepaper/figures/src/legible-swarm-specialization.py
```

2 chapter `.tex`, 27 figure `.tex` fragments, 1 Python figure source, plus the
JSON registry pair (`corpus.json`/`.schema.json`) and the textbook registry
pair (`textbook.json`/`.schema.json`).

### `website-v2/public/whitepaper/` (64 MB after this PR's deletion, was 93 MB)

```
website-v2/public/whitepaper/*.tex                      # 15 files (top level)
website-v2/public/whitepaper/figures/*.tex               # 58 files
website-v2/public/whitepaper/*.pdf                        # 8 committed PDFs
website-v2/public/whitepaper/plates/**                    # cover/chapter/marginalia art
website-v2/public/whitepaper/art/collected-volume/        # REMOVED by this PR
website-v2/public/whitepaper/publication-digests.json      # SHA-256/pages/bytes per PDF
website-v2/public/whitepaper/manifesto.html
```

The 15 top-level `.tex`: 6 chapter sources (`agent-transactions-whitepaper.tex`,
`anchor-protocol-whitepaper.tex`, `federated-harbor-whitepaper.tex`,
`harbor-economy.tex`, `sealed-harbor.tex`, `spawn-to-person.tex`), the 8
`coordination-papers-mega-volume*.tex` fragments (the collected-volume driver
plus its `-appendices`/`-maritime`/`-preamble`/`-seams`/`-swiss`/
`-swiss-plates`/`-technical` parts), and `margin-apparatus-fixture.tex`.

**This entire directory is served to the internet as static files** — every
`.tex`, every plate `.jpg`, the manifesto — because it lives under
`website-v2/public/`, which Vite copies byte-for-byte into the deployed site.

### Not a mirror: `diff -rq` on the two figure directories

```
$ diff -rq whitepaper/figures website-v2/public/whitepaper/figures | wc -l
76
```

76 diff lines, almost entirely "Only in `website-v2/public/whitepaper/figures`:
`<file>`" — i.e. files that exist in one tree and not the other. This is one
figure corpus that got arbitrarily split across two directories, not two
copies of the same corpus. A consolidation is a **merge**, not a
de-duplication.

### The two source trees combine to 8 chapters, 4 parts

`node scripts/generate-mega-whitepaper.mjs /tmp/x` reads `whitepaper/textbook.json`
and reports `generated 8 chapters in 4 parts` — chapters spread across both
trees by `\input` path, driven entirely by the textbook registry, not by which
directory a chapter's `.tex` happens to sit in.

## 2. The twin files — measured, not guessed

Two independent enforcement mechanisms hold pieces of these trees in lockstep.
**They enforce different sets of files. A consolidation that only satisfies
one of them will pass one check and silently break the other.**

### 2a. Auto-synced (drift-checked, `--sync-shared` rewrites them)

From `scripts/generate-mega-whitepaper.mjs`:

```js
const sharedMapTargets = [
  'whitepaper/figures/pd-textbook-map.tex',
  'website-v2/public/whitepaper/figures/pd-textbook-map.tex',
];
const siteTextbookMirror = 'website-v2/src/data/textbook.json'; // mirrors whitepaper/textbook.json
```

`node scripts/generate-mega-whitepaper.mjs --check-shared` (run in
`library-checks.yml`) fails if either `pd-textbook-map.tex` copy drifts from
the other, or if `website-v2/src/data/textbook.json` is missing or stale
against `whitepaper/textbook.json`. `--sync-shared` regenerates both from the
one source of truth (`whitepaper/textbook.json` plus the rendered map).

### 2b. Hard-asserted, NOT auto-synced (a manual edit that forgets the twin breaks the test)

From `scripts/generate-mega-whitepaper.test.mjs`, line 190:

```js
test('the shared palette and hyperlink files are byte-identical in both source trees', () => {
  for (const name of ['pd-palette.tex', 'pd-hyperlinks.tex', 'pd-figure-language.tex', 'pd-pedagogy.tex']) {
    assert.equal(
      readFileSync(resolve(`whitepaper/figures/${name}`), 'utf8'),
      readFileSync(resolve(`website-v2/public/whitepaper/figures/${name}`), 'utf8'),
    );
  }
});
```

**Four files, not two.** The task brief that prompted this plan named only
`pd-pedagogy.tex` and `pd-figure-language.tex`; the actual assertion also
covers `pd-palette.tex` and `pd-hyperlinks.tex`. All four must stay
byte-identical across whichever new layout is chosen, or
`node --test scripts/generate-mega-whitepaper.test.mjs` (wired into
`library-checks.yml`) goes red. There is no `--fix` for this one — it is a
plain `assert.equal`, so the fix is either keep two copies in lockstep by
hand, or consolidate to one copy under a scheme where a single relative
`\input{figures/pd-pedagogy}` resolves from both chapter locations (see §4).

### 2c. A third, unrelated "twin" — do not conflate

`scripts/harbor-research/check_library_index.py`'s `check_twin_headers`
(the "twin-header checker") enforces a **different** twin relationship:
a whitepaper chapter that has "folded" a standalone research paper's theorem
must carry a `TWIN-LOCATION NOTICE` comment naming that paper and its
`docs/harbor-research/library-index.json` entry id. This has nothing to do
with the two-source-tree duplication in §2a/§2b — it links
`whitepaper/legible-swarm.tex` and `whitepaper/single-writer-kernel.tex` (the
only two chapters currently inside `whitepaper/` proper) to papers under
`docs/harbor-research/tex/`. It is listed here because it is a real consumer
of the **exact path string** `whitepaper/legible-swarm.tex` /
`whitepaper/single-writer-kernel.tex`:

```
$ grep -c '"file": "whitepaper/' docs/harbor-research/library-index.json
27
```

27 occurrences. Moving either chapter file requires a matching edit to all 27
entries in `docs/harbor-research/library-index.json`, or `check (a) existence`
and `check (d) twin header` in `check_library_index.py` go red.

## 3. Every consumer of these paths (measured)

| Consumer | What it reads | Path assumption that would break |
|---|---|---|
| `scripts/build-whitepapers.sh` | `whitepaper/legible-swarm.tex`, `whitepaper/single-writer-kernel.tex`; writes PDFs to `$PUB=website-v2/public/whitepaper/*.pdf` | Hard-codes `whitepaper` and `website-v2/public/whitepaper` as two distinct roots (`paper_sources "whitepaper" "..."`) |
| `scripts/generate-mega-whitepaper.mjs` | `whitepaper/textbook.json` (`textbookPath`), `whitepaper/figures/pd-cite-shortforms.tex` (`loadCiteShortforms` default), `sharedMapTargets`, `siteTextbookMirror` | All four constants above are literal path strings |
| `scripts/generate-mega-whitepaper.test.mjs`, `scripts/generate-mega-mechanized.test.mjs` | The 4 byte-identical figure files (§2b) plus everything the generator touches | The `assert.equal` in §2b reads both literal paths every run |
| `website-v2/scripts/check-whitepaper-metadata.ts` | `website-v2/public/whitepaper/*.pdf`, `publication-digests.json`, `website-v2/src/data/whitePapers.ts` | `publicDir` resolution and the `pdfPath` → on-disk-file mapping |
| `website-v2/src/data/whitePapers.ts` | `./textbook.json` mirror (§2a); every entry's `pdfPath: '/whitepaper/<file>.pdf'` | The web-absolute `/whitepaper/...` URLs assume `website-v2/public/whitepaper/` is the PDF's directory — Vite serves `public/` at the site root |
| `scripts/harbor-research/check_citations.py` | Scans 3 corpora by glob: `docs/harbor-research/tex/*.tex` (19), `whitepaper/*.tex` (2), `website-v2/public/whitepaper/*.tex` (15) | The three corpus globs are literal in the script header |
| `scripts/harbor-research/check_library_index.py` | `docs/harbor-research/library-index.json` against the two `whitepaper/*.tex` chapter files (§2c) | 27 `"file"` entries per §2c |
| The wider `scripts/harbor-research/check_*.py` family (`check_duplicate_figures`, `check_figure_register`, `check_marginalia_sidecars`, `check_maritime_gold_ink`, `check_plate_provenance`, `check_propagated_corrections`, `check_research_program`, `check_standalone_figures`, `check_tex_environments`) and the `build_*`/`promote_*`/`star_exercise_pointers.py`/`render_figure_audit.py` scripts | Various figure/plate/citation paths under both trees | Each has its own path assumptions; a mover must grep each individually before relying on a green run — this plan does not claim to have audited every one's internals, only that they exist and touch these trees |
| `.github/workflows/library-checks.yml` | Path-triggers on **both** `whitepaper/**` and `website-v2/public/whitepaper/**` explicitly (separate glob lines); runs `--check-shared`, the node test suite, `check_citations.py`, `check_maritime_gold_ink.py`, `check_propagated_corrections.py`, `check-figure-palette.mjs` | Two separate trigger globs; a merged tree needs one glob, not two |
| `.github/workflows/whitepaper-build.yml` | Path-triggers on `website-v2/public/whitepaper/**/*.tex` **and** `whitepaper/**/*.tex` as two separate lines; runs `run_pdf_checks.py` | Same two-glob pattern |
| `.github/workflows/whitepaper-metadata.yml` | Path-triggers on `website-v2/public/whitepaper/**`; runs `test:whitepaper-metadata`, figure-palette, `whitePapers.test.ts` | Single glob, only the public tree |
| `.github/workflows/proofs.yml` | Path-triggers include the **single literal file** `website-v2/public/whitepaper/agent-transactions-whitepaper.tex` (not a glob) | A rename of this one file silently drops it out of the proofs trigger unless the workflow is edited in the same commit |
| `.github/workflows/harbor-research-build.yml` | `docs/harbor-research/tex/**`, unrelated to the two whitepaper trees directly but shares the citation/library-index machinery | No direct path dependency on `whitepaper/` or `website-v2/public/whitepaper/`, listed for completeness since it runs the same `make -C docs/harbor-research docs` pipeline |
| The website build (Vite) | Everything under `website-v2/public/whitepaper/` is copied verbatim to the deployed site root at `/whitepaper/...` | Any path under `public/` is a public URL; moving files out of `public/` un-publishes them (correct for `.tex` sources, which arguably should not be served at all — see §5) |

## 4. Proposed single home, and why

**Move everything into `whitepaper/`** (not `website-v2/public/whitepaper/`),
and have `scripts/build-whitepapers.sh` copy only the *build output* — the
committed PDFs, `publication-digests.json`, and the `plates/` art the reader
page displays — into `website-v2/public/whitepaper/` as a generated
publish step, the same way it already writes PDFs there today.

Reasoning:

- `website-v2/public/` is a **web-serving directory**. Every `.tex` currently
  under it is being served to the internet as a static text file with no
  reader use — nobody fetches `/whitepaper/spawn-to-person.tex` from a
  browser. LaTeX source has no business in a `public/` tree; only the
  compiled artifacts (PDF, plate images, the digest manifest) do.
- `whitepaper/` is already the tree that owns the single source of truth
  (`textbook.json`) that both the generator and the site's mirror
  (`website-v2/src/data/textbook.json`) read from. Consolidating source
  *into* the directory that already owns the registry is the smaller
  conceptual move — the registry does not need to move to meet its sources
  halfway.
- This makes `scripts/build-whitepapers.sh`'s existing `$PUB=website-v2/public/whitepaper`
  variable describe exactly what it should always have meant: a *publish
  target*, written only by the build, never hand-edited. Today it is
  simultaneously a source directory (chapters, figures) and a publish
  target (PDFs), which is the actual "mess nobody can name" the cleanup
  request pointed at.

### What does NOT move

- The 8 committed PDFs, `publication-digests.json`, and `plates/**` stay
  under `website-v2/public/whitepaper/` — they are the served artifacts,
  correctly placed.
- `website-v2/src/data/whitePapers.ts` and its `textbook.json` mirror stay in
  `website-v2/src/` — TypeScript only sees `website-v2/src/**`
  (`siteTextbookMirror`'s own comment says so), so the mirror mechanism in
  §2a is not itself something to consolidate away, only to keep pointed at
  the new single `whitepaper/textbook.json` location (unchanged, since
  `whitepaper/` is not moving).

## 5. Ordered move sequence, with the check that must pass after each step

Do not batch these. Each step is small enough to bisect if a check goes red.

1. **Wait for `claude/retire-chapter-pdfs` to land** and rebase this work on
   top of it. Re-diff `scripts/build-whitepapers.sh`,
   `website-v2/src/data/whitePapers.ts`, and
   `website-v2/scripts/check-whitepaper-metadata.ts` against the post-merge
   `main` before starting — that PR is expected to change exactly these
   files.
2. **Move the 58 figure `.tex` fragments** (and `render_montecarlo.py`, the 3
   `.pdf` figure includes) from `website-v2/public/whitepaper/figures/` into
   `whitepaper/figures/`, resolving the 76-line `diff -rq` overlap by hand
   (files present in both keep the `whitepaper/figures/` copy as canonical;
   files present only in one side simply move). Do this BEFORE moving any
   chapter `.tex`, so every chapter's `\input{figures/...}` keeps resolving.
   **Check:** `python3 scripts/harbor-research/check_duplicate_figures.py` and
   `check_standalone_figures.py` — both must report zero new duplicates or
   orphans.
3. **Update the four byte-identical files (§2b) to exist once**, at
   `whitepaper/figures/{pd-palette,pd-hyperlinks,pd-figure-language,pd-pedagogy}.tex`,
   and rewrite the `scripts/generate-mega-whitepaper.test.mjs` assertion from
   an equality check between two files to an existence check on the one file
   (or, if standalone chapter builds still need the file to physically
   resolve from a second relative root, add that root to the pair
   `sharedMapTargets` tracks instead of deleting the second copy — **do not
   delete the second copy without first proving no standalone `pdflatex`
   build depends on finding it at that relative path**; that is exactly the
   "naive consolidation" this plan was asked to warn against).
   **Check:** `node --test scripts/generate-mega-whitepaper.test.mjs`.
4. **Move the 6 chapter `.tex` files**
   (`agent-transactions-whitepaper.tex`, `anchor-protocol-whitepaper.tex`,
   `federated-harbor-whitepaper.tex`, `harbor-economy.tex`,
   `sealed-harbor.tex`, `spawn-to-person.tex`) and the 8
   `coordination-papers-mega-volume*.tex` fragments from
   `website-v2/public/whitepaper/` into `whitepaper/`.
   **Check:** `node scripts/generate-mega-whitepaper.mjs /tmp/x` still prints
   `8 chapters in 4 parts`.
5. **Update `scripts/build-whitepapers.sh`** so its `paper_sources` calls read
   every chapter from `whitepaper/` and it writes PDFs to
   `website-v2/public/whitepaper/*.pdf` as before (this becomes purely a
   publish step, per §4).
   **Check:** run the script locally; diff the regenerated PDFs' page counts
   and SHA-256 against `publication-digests.json` (expect a legitimate digest
   update from the source move's line-ending/whitespace normalization, if
   any — verify byte-for-byte content is otherwise unchanged).
6. **Update `docs/harbor-research/library-index.json`**'s 27 `"file":
   "whitepaper/..."` entries only if the chapter *filenames* changed during
   the move (they should not, per this plan — only their directory does, and
   `whitepaper/legible-swarm.tex` / `whitepaper/single-writer-kernel.tex`
   were already inside `whitepaper/` and are not moving). If a future
   revision of this plan also relocates those two files, this step becomes
   mandatory.
   **Check:** `python3 scripts/harbor-research/check_library_index.py` — all
   5 checks (existence, coverage, drift, twin header, chapter prefix) at 0
   failures.
7. **Update `scripts/harbor-research/check_citations.py`**'s corpus glob list
   from `[docs/harbor-research/tex/*.tex, whitepaper/*.tex,
   website-v2/public/whitepaper/*.tex]` to the merged single glob.
   **Check:** `python3 scripts/harbor-research/check_citations.py` — 0
   orphaned bibitems, 0 dangling cites (same as today).
8. **Update the CI path triggers**: collapse the two-glob pattern in
   `library-checks.yml` and `whitepaper-build.yml` to the single
   `whitepaper/**` glob, and rename the literal
   `website-v2/public/whitepaper/agent-transactions-whitepaper.tex` line in
   `proofs.yml` to its new path.
   **Check:** open a throwaway PR touching only a chapter file and confirm
   all three workflows still trigger.
9. **Update `website-v2/scripts/check-whitepaper-metadata.ts`** if its
   `publicDir`/source-resolution logic assumed chapter `.tex` lived beside
   the PDFs (verify by reading it post-`retire-chapter-pdfs`, since that PR
   is actively editing this exact file).
   **Check:** `npx tsx website-v2/scripts/check-whitepaper-metadata.ts`
   (check-only mode).
10. **Full regression pass**: `node scripts/check-doc-citations.mjs --all`,
    `node scripts/generate-mega-whitepaper.mjs /tmp/x`,
    `python3 scripts/harbor-research/check_citations.py`,
    `python3 scripts/harbor-research/check_library_index.py`,
    `cd website-v2 && npx tsc --noEmit && npm test`, and a full
    `npm run build` with a grep of the build output for any now-404 asset
    path (a missing `public/` asset does not fail a Vite build).

## 6. Open question this plan does not resolve

Whether `whitepaper/figures/src/legible-swarm-specialization.py` and
`website-v2/public/whitepaper/figures/render_montecarlo.py` are themselves
part of the "one corpus" or belong in `scripts/whitepaper-plates/` alongside
the other figure-rendering Python (`swiss_prompts.py`, `plates_pipeline.py`)
is a judgment call for whoever executes this move, not a fact this plan
measured. Flag it to the author before step 2.
