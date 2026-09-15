# Visual Proof — PR #10162 (`claude/design-ledger-defects`)

Provenance manifest for the page-scale figure renders in this directory, per the
`agent-visual-evidence-manifest` skill. Every artefact carries the six required
fields and an **honest** `sourceLabel`.

> **Two SHAs, on purpose** — the same convention as `docs/pr-assets/pr-729/`.
> Each artefact's `commit` field is `7e081741a`, the **figure source under
> review** whose pixels these are. The PNG bytes are hosted in the asset-only
> commit `409cee679`, so the raw URLs pin to that commit — the commit where the
> file bytes actually exist. No figure source changed between the two.

## What these artefacts show

This PR changes a style file and twenty figures, so a contact sheet of twenty
thumbnails would prove nothing at thumbnail size. Six fragments are shown at
full page scale instead, each picked because it exercises one of the three
changes harder than any other fragment does.

**The new `pd danger` family** (`pderror` rule / arrow / fill / datum): shown on
`fig-fh-settlement` and `fig-anchor-delegation-inline`, the two largest
conversions in the diff (18 and 16 changed lines). Between them they cover every
member of the family — rule, arrow, fill and datum.

**Amber annotation text moved to `pdinkmuted`**: shown on `fig-worked-example`,
which carries the longest run of small amber text in the corpus (the
"cleanup exposure remains funded through the crash" note, plus `bond $6` and
`CRASH`). Measured off the PDF's own content stream, that text goes from
`#6B4500` (7.33:1 on cream) to `#403B34` (9.59:1).

**The three captions that named a colour the figure does not draw**: shown on
`fig-he-assurance` before/after, and then — this is the part a before/after alone
cannot show — the same HEAD fragment under the Book preamble beside the chapter
preamble, because the colour those captions name is *edition-dependent*.

## How they were made (reproduce)

```bash
# BEFORE — the same fragment at this PR's merge-base
git worktree add --detach /tmp/before c92efaa5c
cd /tmp/before && bash skills/harbor-chartwork/scripts/compile_fragment.sh \
    <fragment>.tex --preamble book --out /tmp/before-pdf

# AFTER — the same fragment at this PR's head
git worktree add --detach /tmp/after 7e081741a
cd /tmp/after && bash skills/harbor-chartwork/scripts/compile_fragment.sh \
    <fragment>.tex --preamble book --out /tmp/after-pdf

# 1.0x / 150 dpi raster of page 1 of each, then composed side by side
python3 -c "import pymupdf; d=pymupdf.open('<pdf>'); \
  d[0].get_pixmap(matrix=pymupdf.Matrix(150/72,150/72), alpha=False).save('<png>')"
```

**Scale discipline.** `Matrix(150/72, 150/72)` is exactly 1.0× at 150 dpi — the
page as a phone PDF viewer shows it at 100%. Nothing here is a zoomed crop or a
magnified detail. Blank page area *below the last inked row* is dropped so the
pair fits a PR body; the full page **width** is always kept, so the column measure
the figure has to live inside stays visible, and **no pixel is rescaled**. The
only ink added is the grey caption band naming each panel.

---

## Artefact 1 — `fh-settlement-danger-family-book-1x-150dpi.png`

- File: `docs/pr-assets/pr-10162/fh-settlement-danger-family-book-1x-150dpi.png` (182 KiB)
  - raw: `https://raw.githubusercontent.com/curiositech/port-daddy/409cee679b99233044de2fad43c8a227c519eb76/docs/pr-assets/pr-10162/fh-settlement-danger-family-book-1x-150dpi.png`
- What it shows: BEFORE | AFTER of `fig-fh-settlement` (Book preamble). The hand-rolled amber refusal marks become the `pd danger` family: annotation text amber -> red, terminal mark red square -> red diamond.
- Daemon port: `none` — a `tectonic` fragment compile opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a `.tex` blob in git
- Transcript head hash: `n/a (print render)` — no event stream to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `7e081741a10c27ad4be42a0712903546fcf27952` (figure source under review)
- Source: `live` — the real committed fragment compiled by the real house preamble; nothing mocked, seeded or hand-drawn

## Artefact 2 — `anchor-delegation-inline-danger-family-book-1x-150dpi.png`

- File: `docs/pr-assets/pr-10162/anchor-delegation-inline-danger-family-book-1x-150dpi.png` (152 KiB)
  - raw: `https://raw.githubusercontent.com/curiositech/port-daddy/409cee679b99233044de2fad43c8a227c519eb76/docs/pr-assets/pr-10162/anchor-delegation-inline-danger-family-book-1x-150dpi.png`
- What it shows: BEFORE | AFTER of `fig-anchor-delegation-inline` (Book preamble). The splice-attack crossing adopts `pd danger arrow`/`pd danger rule`. Measured off the PDF: the stroke drops from 1.993 pt to 1.046 pt.
- Daemon port: `none` — a `tectonic` fragment compile opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a `.tex` blob in git
- Transcript head hash: `n/a (print render)` — no event stream to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `7e081741a10c27ad4be42a0712903546fcf27952` (figure source under review)
- Source: `live` — the real committed fragment compiled by the real house preamble; nothing mocked, seeded or hand-drawn

## Artefact 3 — `worked-example-amber-text-book-1x-150dpi.png`

- File: `docs/pr-assets/pr-10162/worked-example-amber-text-book-1x-150dpi.png` (128 KiB)
  - raw: `https://raw.githubusercontent.com/curiositech/port-daddy/409cee679b99233044de2fad43c8a227c519eb76/docs/pr-assets/pr-10162/worked-example-amber-text-book-1x-150dpi.png`
- What it shows: BEFORE | AFTER of `fig-worked-example` (Book preamble). `bond $6`, `CRASH` and the cleanup-exposure note move from `hhamber` #6B4500 to `pdinkmuted` #403B34; the amber rule and diamond they annotate stay amber.
- Daemon port: `none` — a `tectonic` fragment compile opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a `.tex` blob in git
- Transcript head hash: `n/a (print render)` — no event stream to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `7e081741a10c27ad4be42a0712903546fcf27952` (figure source under review)
- Source: `live` — the real committed fragment compiled by the real house preamble; nothing mocked, seeded or hand-drawn

## Artefact 4 — `he-assurance-caption-book-1x-150dpi.png`

- File: `docs/pr-assets/pr-10162/he-assurance-caption-book-1x-150dpi.png` (149 KiB)
  - raw: `https://raw.githubusercontent.com/curiositech/port-daddy/409cee679b99233044de2fad43c8a227c519eb76/docs/pr-assets/pr-10162/he-assurance-caption-book-1x-150dpi.png`
- What it shows: BEFORE | AFTER of `fig-he-assurance` (Book preamble). The caption changes "Each teal point" -> "Each gold point" and "dashed amber" -> "dashed red"; the drawing is byte-identical.
- Daemon port: `none` — a `tectonic` fragment compile opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a `.tex` blob in git
- Transcript head hash: `n/a (print render)` — no event stream to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `7e081741a10c27ad4be42a0712903546fcf27952` (figure source under review)
- Source: `live` — the real committed fragment compiled by the real house preamble; nothing mocked, seeded or hand-drawn

## Artefact 5 — `he-assurance-caption-vs-editions-1x-150dpi.png`

- File: `docs/pr-assets/pr-10162/he-assurance-caption-vs-editions-1x-150dpi.png` (228 KiB)
  - raw: `https://raw.githubusercontent.com/curiositech/port-daddy/409cee679b99233044de2fad43c8a227c519eb76/docs/pr-assets/pr-10162/he-assurance-caption-vs-editions-1x-150dpi.png`
- What it shows: The SAME fragment at HEAD under the **Book** preamble (left) and the **chapter** preamble (right). Both carry the new caption. Read the colour word against the marks.
- Daemon port: `none` — a `tectonic` fragment compile opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a `.tex` blob in git
- Transcript head hash: `n/a (print render)` — no event stream to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `7e081741a10c27ad4be42a0712903546fcf27952` (figure source under review)
- Source: `live` — the real committed fragment compiled by the real house preamble; nothing mocked, seeded or hand-drawn

## Artefact 6 — `fh-revocation-gossip-caption-vs-editions-1x-150dpi.png`

- File: `docs/pr-assets/pr-10162/fh-revocation-gossip-caption-vs-editions-1x-150dpi.png` (207 KiB)
  - raw: `https://raw.githubusercontent.com/curiositech/port-daddy/409cee679b99233044de2fad43c8a227c519eb76/docs/pr-assets/pr-10162/fh-revocation-gossip-caption-vs-editions-1x-150dpi.png`
- What it shows: `fig-fh-revocation-gossip` at HEAD, Book preamble (left) beside chapter preamble (right), for the second of the three changed captions.
- Daemon port: `none` — a `tectonic` fragment compile opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a `.tex` blob in git
- Transcript head hash: `n/a (print render)` — no event stream to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `7e081741a10c27ad4be42a0712903546fcf27952` (figure source under review)
- Source: `live` — the real committed fragment compiled by the real house preamble; nothing mocked, seeded or hand-drawn

