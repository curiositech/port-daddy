#!/usr/bin/env python3
"""build_figure_desk.py -- regenerates the Harbor Figure Desk's data files from
committed repository sources.

The Figure Desk (a published Artifact) used to be fed by six hand-written
`data/*.js` files that nothing in the repository produced or checked. That is
the same "two lists that must agree, with nothing deriving either from the
other" defect this repository's own checkers keep finding in the Book -- only
committed, this time, in the review surface rather than in the Book. This
script removes it: every row the desk shows is now either DERIVED from a
committed source, or explicitly CURATED and named as such below.

  ==========================  DERIVED  ==========================
  Recomputed on every run; hand-editing the output is pointless because
  --check will call it stale.

  CHAPTERS.js   whitepaper/textbook.json
                Chapter number -> short title. The chapter list is NEVER
                hard-coded here; it is whatever textbook.json says, in
                textbook.json's own order.

  FIGS.js       the chapter sources named by textbook.json, their
                `figures/` directories, and the committed Book PDF.
                  id        the fragment stem (`\\input{figures/<stem>}`) or,
                            for an imported graphic, the file stem without
                            `.pdf`. This is the desk's primary key and the
                            key the author's saved rulings are stored under,
                            so it is derived from the one thing that cannot
                            drift: the filename the Book itself inputs.
                  ch        the chapter of the LAST site that inputs it (a
                            figure shared by two chapters belongs to the
                            later one, which is the rule the published desk
                            already used).
                  chapters  every chapter that inputs it, in order -- so a
                            shared figure is visible as shared.
                  caption   the fragment's own `\\caption{...}`, de-TeXed;
                            for an imported graphic, the `\\caption{...}` of
                            the `figure` environment that wraps the
                            `\\includegraphics`.
                  imported  true for `\\includegraphics{figures/*.pdf}` -- a
                            figure with no TikZ fragment, and therefore no
                            `tikz_precheck`, no `compile_fragment.sh` and no
                            figcheck row. Pixel judgment finding 1.4.
                  bookPage  the 1-based page of the COMMITTED Book PDF whose
                            text contains the caption. Derived, exact: every
                            one of the 56 TikZ captions matches exactly one
                            page, and every imported caption matches exactly
                            one page.
                  page      the page of the PDF BUILD THE PUBLISHED PAGE
                            IMAGES WERE RENDERED FROM. Curated -- see below.

  TRIAGE.js     FIGURE-TRIAGE.md -- the Wave 11 rows (num, idea, drawn,
                role, disposition, spec) and the shared-figure pairs from
                its "Shared figures" line.

  UNDRAWN.js    FIGURE-TRIAGE.md -- the rows whose fragment column is
                literally `add`, minus the ones that name a figure since
                drawn (matched to a FIGS id by the numbers in the spec).

  PIXEL.js      PIXEL-JUDGMENT.md -- the per-figure rows of its section 2
                (page, idea, role, rubric, measured, dataviz, verdict,
                pixels) plus, per row, whether it AGREES or DISAGREES with
                each of the three lenses and with the Wave 11 disposition.

  FINDINGS.js   PIXEL-JUDGMENT.md section 1 (the five cross-cutting
                findings), its counts table, its epigraph, and
                `blockers.json` (how many mechanical findings are waived),
                plus FIGURE-REGISTER.md's per-chapter summary table.

  ==========================  CURATED  ==========================
  Copied through verbatim. NOT derivable from anything committed; a human or
  an agent wrote these and only a human or an agent can change them. Editing
  them by hand is correct; --check compares the generated copy to the
  committed copy exactly as it does for the derived files, so an edit to a
  curated source is picked up on the next --write.

  CRIT.js       desk-curated/CRIT.json
                The three agent reviewers (lensA exposition / lensB drawing
                / lensC evidence): free prose verdicts and their reasons.
                Nothing in the repository produces these.

  RESEARCH.js   desk-curated/RESEARCH.json
                The fourth voice (diagram research): its verdict,
                disagreement note, verification, recommendation, sources.

  FIGS[].page   desk-curated/RENDER-PAGES.json
                The published desk's page JPGs (`pages/pNNN.jpg`) were
                rendered from ONE specific Book build, and the author's
                region boxes are stored in the artifact db against those
                exact filenames. Re-deriving `page` from today's PDF would
                silently repoint 49 of the 59 figures at a neighbouring page
                and orphan every region note on them. So `page` is pinned
                here, and the drift against the live `bookPage` is REPORTED
                (see --report) rather than applied. Re-render the JPGs and
                rewrite this file together, never one without the other.

  UNDRAWN[].id  desk-curated/UNDRAWN-IDS.json
                A triage `add` row has no identifier of its own -- its
                fragment column is an em dash -- but the desk stores the
                author's ruling on an undrawn candidate under an id. The id
                is therefore pinned against a derived natural key (chapter,
                section, the row's first six words). A row whose key lost its
                pin, or a pin whose key lost its row, is reported as an
                orphaned ruling rather than silently renumbered.
                `page`/`pageNote` on those rows are curated too: a page is
                given only where a checkable link to an existing figure's
                page justifies it.

Stdlib-only except PyMuPDF, which is already a dependency of the repository's
PDF checks. Deterministic and offline: two runs on the same tree produce
byte-identical output.

Usage:
    python3 scripts/harbor-research/build_figure_desk.py --check
    python3 scripts/harbor-research/build_figure_desk.py --write
    python3 scripts/harbor-research/build_figure_desk.py --write --bundle DIR
    python3 scripts/harbor-research/build_figure_desk.py --report

Exit status: --check exits 1 if any generated file is stale (does not match a
fresh render); --write always writes and exits 0. --report prints the
reconciliations (render-page drift, judged-vs-desk set difference, parse
gaps) and exits 0. Flags may be combined.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import figure_doctrine  # noqa: E402
import palette_check  # noqa: E402

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

FIGURES_DIR = "docs/harbor-research/exposition/figures"
CURATED_DIR = f"{FIGURES_DIR}/desk-curated"
DATA_DIR = f"{FIGURES_DIR}/desk-data"

TEXTBOOK_REL = "whitepaper/textbook.json"
BOOK_PDF_REL = "website-v2/public/whitepaper/coordination-papers-mega-volume.pdf"
TRIAGE_REL = f"{FIGURES_DIR}/FIGURE-TRIAGE.md"
PIXEL_REL = f"{FIGURES_DIR}/PIXEL-JUDGMENT.md"
REGISTER_REL = f"{FIGURES_DIR}/FIGURE-REGISTER.md"
BLOCKERS_REL = f"{FIGURES_DIR}/blockers.json"

CRIT_REL = f"{CURATED_DIR}/CRIT.json"
RESEARCH_REL = f"{CURATED_DIR}/RESEARCH.json"
RENDER_PAGES_REL = f"{CURATED_DIR}/RENDER-PAGES.json"
UNDRAWN_IDS_REL = f"{CURATED_DIR}/UNDRAWN-IDS.json"

# Collected while parsing; printed by --report. Anywhere the markdown did not
# yield what the schema wanted, it lands here rather than being papered over.
PARSE_GAPS: list[str] = []


def abspath(rel: str) -> str:
    return os.path.join(REPO_ROOT, rel)


def note_gap(msg: str) -> None:
    PARSE_GAPS.append(msg)


# ---------------------------------------------------------------------------
# TeX helpers
# ---------------------------------------------------------------------------

def balanced(s: str, open_idx: int) -> tuple[str, int]:
    """Return (inner, index_after_close) for the brace group starting at s[open_idx]."""
    depth = 0
    for j in range(open_idx, len(s)):
        if s[j] == "{":
            depth += 1
        elif s[j] == "}":
            depth -= 1
            if depth == 0:
                return s[open_idx + 1:j], j + 1
    return s[open_idx + 1:], len(s)


_DETEX_DROP_ARG = ("label", "ref", "autoref", "cref", "Cref", "index", "vspace", "hspace")


def detex(t: str) -> str:
    """Flatten a caption to the plain words that also appear in the rendered PDF."""
    t = re.sub(r"(?<!\\)%.*", "", t)
    for cmd in _DETEX_DROP_ARG:
        t = re.sub(r"\\" + cmd + r"\*?\{[^{}]*\}", "", t)
    t = re.sub(r"\\(?:emph|textit|textbf|textsc|texttt|code|mbox|text|footnotesize|small)\{", "{", t)
    t = re.sub(r"\$[^$]*\$", " ", t)
    t = re.sub(r"\\[a-zA-Z@]+\*?", "", t)
    t = t.replace("{", " ").replace("}", " ").replace("~", " ").replace("\\", "")
    t = re.sub(r"\s+", " ", t)
    return t.strip()


def first_caption(body: str, from_idx: int = 0) -> str | None:
    m = re.compile(r"\\caption(?:\[[^\]]*\])?\{").search(body, from_idx)
    if not m:
        return None
    inner, _ = balanced(body, m.end() - 1)
    return detex(inner)


# ---------------------------------------------------------------------------
# CHAPTERS  (derived from textbook.json)
# ---------------------------------------------------------------------------

def load_textbook() -> dict:
    with open(abspath(TEXTBOOK_REL), encoding="utf-8") as fh:
        return json.load(fh)


def short_title(title: str) -> str:
    return re.sub(r"^The\s+", "", title.strip())


def build_chapters(textbook: dict) -> dict:
    out = {}
    for c in textbook.get("chapters", []):
        out[str(c["number"])] = short_title(c["title"])
    if not out:
        note_gap("textbook.json yielded no chapters")
    return out


# ---------------------------------------------------------------------------
# FIGS  (derived from the chapter sources, their figure dirs, and the Book PDF)
# ---------------------------------------------------------------------------

_SITE_RE = re.compile(r"\\(input|includegraphics)(?:\[[^\]]*\])?\{figures/([^}]*)\}")


def enumerate_figures(textbook: dict) -> list[dict]:
    """Every figure site in the Book, in chapter order, deduplicated by id."""
    by_id: dict[str, dict] = {}
    for c in textbook.get("chapters", []):
        src_rel = c["source"]
        src_abs = abspath(src_rel)
        if not os.path.isfile(src_abs):
            note_gap(f"chapter {c['number']}: source {src_rel} is missing; its figures are absent")
            continue
        fig_dir_rel = os.path.join(os.path.dirname(src_rel), "figures")
        with open(src_abs, encoding="utf-8") as fh:
            chapter_tex = fh.read()

        for m in _SITE_RE.finditer(chapter_tex):
            kind, name = m.group(1), m.group(2)

            if kind == "includegraphics":
                fid = name[:-4] if name.lower().endswith(".pdf") else name
                rec = by_id.get(fid)
                if rec is None:
                    # The caption of an imported graphic lives in the chapter
                    # source, in the figure environment that wraps it.
                    cap = first_caption(chapter_tex, m.end())
                    if cap is None:
                        note_gap(f"{fid}: imported graphic has no caption after its \\includegraphics")
                    rec = by_id[fid] = {
                        "id": fid,
                        "src": f"{fig_dir_rel}/{name}",
                        "caption": cap or "",
                        "imported": True,
                        "chapters": [],
                    }
                rec["chapters"].append(c["number"])
                continue

            frag_rel = f"{fig_dir_rel}/{name}.tex"
            frag_abs = abspath(frag_rel)
            if not os.path.isfile(frag_abs):
                continue
            with open(frag_abs, encoding="utf-8") as fh:
                frag = fh.read()
            # A figure fragment is one that actually sets a figure with a
            # caption. Style files (pd-*) and terminal listings are not.
            if "\\begin{figure}" not in frag or "\\caption" not in frag:
                continue
            rec = by_id.get(name)
            if rec is None:
                cap = first_caption(frag)
                if cap is None:
                    note_gap(f"{name}: \\caption present but not parseable")
                rec = by_id[name] = {
                    "id": name,
                    "src": frag_rel,
                    "caption": cap or "",
                    "imported": False,
                    "chapters": [],
                }
            rec["chapters"].append(c["number"])

    figs = []
    for rec in by_id.values():
        chs = rec.pop("chapters")
        rec["ch"] = chs[-1] if chs else 0          # last site wins; see docstring
        rec["chapters"] = chs
        rec["shared"] = len(set(chs)) > 1
        figs.append(rec)
    figs.sort(key=lambda r: (r["ch"], r["id"]))
    return figs


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def attach_book_pages(figs: list[dict]) -> None:
    """bookPage: the page of the committed Book PDF whose text holds the caption."""
    try:
        import pymupdf  # type: ignore
    except ImportError:  # pragma: no cover - exercised only without the dep
        note_gap("PyMuPDF not installed: every bookPage is null")
        for f in figs:
            f["bookPage"] = None
        return

    pdf_abs = abspath(BOOK_PDF_REL)
    if not os.path.isfile(pdf_abs):
        note_gap(f"{BOOK_PDF_REL} is missing: every bookPage is null")
        for f in figs:
            f["bookPage"] = None
        return

    doc = pymupdf.open(pdf_abs)
    pages = [_norm(doc[i].get_text()) for i in range(doc.page_count)]
    doc.close()

    for f in figs:
        cap = _norm(f["caption"])
        words = cap.split()
        hits: list[int] = []
        for n in (14, 10, 7):
            if len(words) < 4:
                break
            key = " ".join(words[:n])
            hits = [i + 1 for i, p in enumerate(pages) if key in p]
            if len(hits) == 1:
                break
        if len(hits) == 1:
            f["bookPage"] = hits[0]
        else:
            f["bookPage"] = None
            note_gap(
                f"{f['id']}: caption matched {len(hits)} pages of the Book PDF "
                f"({hits[:5]}); bookPage is null"
            )


def attach_render_pages(figs: list[dict], render_pages: dict) -> list[str]:
    """page: pinned, because the published page JPGs and every region note use it."""
    pinned = render_pages.get("pages", {})
    missing = []
    for f in figs:
        p = pinned.get(f["id"])
        f["page"] = p
        if p is None:
            missing.append(f["id"])
    return missing


# ---------------------------------------------------------------------------
# FIGURE-TRIAGE.md  (derived)
# ---------------------------------------------------------------------------

_MD_ROW = re.compile(r"^\|(.+)\|\s*$")


def md_rows(block: str) -> list[list[str]]:
    rows = []
    for line in block.splitlines():
        m = _MD_ROW.match(line)
        if not m:
            continue
        cells = [c.strip() for c in m.group(1).split("|")]
        if all(re.fullmatch(r":?-{2,}:?", c) for c in cells if c):
            continue
        rows.append(cells)
    return rows


def strip_md(s: str) -> str:
    s = s.strip()
    s = re.sub(r"^\*\*(.*)\*\*$", r"\1", s).strip()
    return s


def unbold(s: str) -> str:
    return re.sub(r"\*\*(.+?)\*\*", r"\1", s).strip()


def parse_triage(text: str) -> tuple[dict, list[dict], dict]:
    """-> (triage rows by fragment id, add-rows, shared pairs by figure number)."""
    triage: dict[str, dict] = {}
    adds: list[dict] = []

    chapter = None
    ch_title = None
    for line in text.splitlines():
        h = re.match(r"^##\s+Chapter\s+(\d+)\s+—\s+(.+?)\s*\(", line)
        if h:
            chapter = int(h.group(1))
            ch_title = h.group(2).strip()
            continue
        m = _MD_ROW.match(line)
        if not m or chapter is None:
            continue
        cells = [c.strip() for c in m.group(1).split("|")]
        if len(cells) < 7:
            continue
        if all(re.fullmatch(r":?-{2,}:?", c) for c in cells if c):
            continue
        num, frag, idea, drawn, role, disp, spec = cells[:7]
        if num == "#" or frag == "fragment":
            continue
        disp = unbold(disp)
        spec_v = None if spec in ("—", "-", "") else spec

        # "fig-fh-xfer-ceremony (shared with 8.3)" -- the fragment cell carries
        # the sharing note inline, so the id has to be peeled out of it.
        inline_share = None
        sm2 = re.match(r"^(\S+)\s+\(shared with ([\d.]+)\)$", frag)
        if sm2:
            frag, inline_share = sm2.group(1), sm2.group(2)

        if num == "add" or frag in ("—", "-", ""):
            adds.append({
                "ch": chapter,
                "chTitle": ch_title,
                "raw_idea": idea,
                "disposition": disp,
                "spec": spec_v,
            })
            continue

        if idea.startswith("see ") or idea.startswith("shared with "):
            # a cross-reference row: chapter 8's "see 6.7". The primary row
            # already carries the content; record only the duplicate number.
            triage.setdefault("__xref__", {})[num] = idea
            continue

        triage[frag] = {
            "num": num,
            "ch": chapter,
            "idea": idea,
            "drawn": None if drawn in ("—", "-", "") else drawn,
            "role": None if role in ("—", "-", "") else role,
            "disposition": disp,
            "spec": spec_v,
            "inlineShare": inline_share,
        }

    shared: dict[str, str] = {}
    sm = re.search(r"^Shared figures \(([^)]*)\)", text, re.M)
    if sm:
        for pair in sm.group(1).split(","):
            pair = pair.strip()
            mm = re.fullmatch(r"([\d.]+)/([\d.]+)", pair)
            if mm:
                shared[mm.group(1)] = mm.group(2)
                shared[mm.group(2)] = mm.group(1)
    else:
        note_gap("FIGURE-TRIAGE.md: no 'Shared figures (...)' line found; sharedWith is empty")

    triage.pop("__xref__", None)
    return triage, adds, shared


_ADD_SECTION = re.compile(r"^§?([\d.]+|\d)\s+(.*)$")


def add_row_key(ch: int, section: str, idea: str) -> str:
    """A stable natural key for a triage add-row.

    The add-rows have no identifier of their own -- their fragment column is
    literally `—`. The desk needs one, because the author's rulings on undrawn
    candidates are stored under it. So the key is (chapter, section, the first
    six words of the idea), which is what a human would use to point at the
    row, and the published id is pinned against that key in
    desk-curated/UNDRAWN-IDS.json. Reword the row's opening six words and the
    key changes -- deliberately, and loudly (see --report).
    """
    words = re.sub(r"[^a-z0-9 ]+", " ", idea.lower()).split()
    return f"{ch}|{section}|{'-'.join(words[:6])}"


def shape_add_rows(adds: list[dict], figs: list[dict], pins: dict) -> tuple[list[dict], dict]:
    """Turn the triage's `add` rows into undrawn candidates.

    An add-row that names a figure since drawn is dropped from the undrawn set
    and recorded against that figure instead; the match is by the numbers and
    distinctive words the add-row's own idea/spec carry.
    """
    fig_ids = {f["id"] for f in figs}
    by_key = pins.get("byKey", {})
    # (add-row idea substring, figure id) -- the only curated bridge in a
    # derived file, and it is a *matching rule*, not a row: each pair says
    # "this triage sentence and this fragment are the same request", which no
    # committed file states. Both halves are checked to exist, so a rename on
    # either side is a loud failure, not a silent drop.
    FULFILLED = [
        ("stigmergic decay", "fig-swk-marker-decay"),
        ("R1 information floor", "legible-swarm-readpoverty"),
        ("B6 probation cliff", "fig-stp-probation-cliff"),
        ("R12 copy-fork attack", "fig-stp-nomint-lineage"),
        ("R6 consistency radius", "fig-fh-cycle-vs-cut"),
    ]
    fulfilled_by_fig: dict[str, str] = {}
    undrawn: list[dict] = []

    for a in adds:
        raw = a["raw_idea"]
        m = re.match(r"^§([\d.]+|\d)\s+(.*)$", raw)
        if m:
            section = "§" + m.group(1)
            idea = m.group(2).strip()
        else:
            section = f"§{a['ch']}"
            idea = raw
            note_gap(f"FIGURE-TRIAGE.md add-row in chapter {a['ch']}: no leading §section in {raw!r}")

        hit = None
        for needle, fid in FULFILLED:
            if needle.lower() in raw.lower():
                if fid not in fig_ids:
                    note_gap(f"add-row {raw!r} claims to be fulfilled by {fid}, which is not a figure")
                else:
                    hit = fid
                break
        if hit:
            fulfilled_by_fig[hit] = raw
            continue

        kind = ""
        if a["spec"]:
            km = re.findall(r"\*([^*]+)\*", a["spec"])
            kind = " + ".join(k.strip() for k in km)
        no_figure = bool(a["spec"] and "no figure" in a["spec"])

        key = add_row_key(a["ch"], section, idea)
        pin = by_key.get(key)
        if pin:
            uid = pin["id"]
        else:
            uid = "undrawn-" + re.sub(r"[^a-z0-9]+", "-", f"{a['ch']}-{idea}".lower()).strip("-")[:48]
            note_gap(
                f"add-row {key!r} has no pinned id in {UNDRAWN_IDS_REL}; "
                f"it was given the derived id {uid!r}, which is NOT the id any "
                f"existing ruling is stored under"
            )
        undrawn.append({
            "id": uid,
            "ch": a["ch"],
            "chTitle": a["chTitle"],
            "section": section,
            "idea": idea,
            "kind": kind or None,
            "spec": a["spec"],
            "noFigure": no_figure,
            # curated, and only ever a page a human could justify; see the pin file
            "page": (pin or {}).get("page"),
            "pageNote": (pin or {}).get("pageNote"),
            "key": key,
        })

    seen_keys = {u["key"] for u in undrawn}
    for key, pin in by_key.items():
        if key not in seen_keys:
            note_gap(
                f"pinned undrawn id {pin['id']!r} (key {key!r}) matches no add-row in "
                f"FIGURE-TRIAGE.md any more -- a ruling saved under it is now orphaned"
            )
    return undrawn, fulfilled_by_fig


# ---------------------------------------------------------------------------
# PIXEL-JUDGMENT.md  (derived)
# ---------------------------------------------------------------------------

def parse_pixel(text: str) -> tuple[dict, dict]:
    """-> (per-fragment pixel rows, the cross-cutting section)."""
    rows: dict[str, dict] = {}

    body = text
    sec2 = body.find("\n## 2. The triage")
    sec3 = body.find("\n## 3. Counts")
    if sec2 < 0 or sec3 < 0:
        note_gap("PIXEL-JUDGMENT.md: could not find '## 2. The triage' / '## 3. Counts'; PIXEL is empty")
        triage_block = ""
    else:
        triage_block = body[sec2:sec3]

    for cells in md_rows(triage_block):
        if len(cells) < 10:
            continue
        if cells[0] in ("fig", "") or cells[1] == "fragment":
            continue
        num, frag, page, idea, role, rubric, measured, dataviz, verdict, pixels = cells[:10]
        fid = frag.strip().strip("`")
        if fid.lower().endswith(".pdf"):
            fid = fid[:-4]
        if not fid or fid == "—":
            note_gap(f"PIXEL-JUDGMENT.md row {num!r}: no fragment id; row dropped")
            continue
        try:
            page_n = int(page.strip())
        except ValueError:
            page_n = None
        rubric_pts = {}
        for sign, name in re.findall(r"([+-])(fact|instance|anchored|contrast|collisions)", rubric):
            rubric_pts[name] = (sign == "+")
        if len(rubric_pts) not in (0, 5):
            note_gap(f"PIXEL-JUDGMENT.md {fid}: rubric parsed {len(rubric_pts)}/5 points from {rubric!r}")
        rows[fid] = {
            "num": re.sub(r"\s*\(new\)$", "", num).strip(),
            "isNew": "(new)" in num,
            "bookPage": page_n,
            "idea": idea,
            "role": role,
            "rubric": rubric_pts,
            "rubricRaw": rubric,
            "measured": measured,
            "dataviz": dataviz,
            "verdict": unbold(verdict).lower(),
            "pixels": pixels.strip(),
        }

    # --- section 1: the five cross-cutting findings -------------------------
    findings = []
    sec1 = body.find("\n## 1. Five findings")
    if sec1 < 0:
        note_gap("PIXEL-JUDGMENT.md: section 1 not found; there are no cross-cutting findings")
    else:
        block = body[sec1:sec2 if sec2 > 0 else len(body)]
        parts = re.split(r"\n### (\d+\.\d+)\s+(.*)\n", block)
        # parts = [preamble, num, title, body, num, title, body, ...]
        for i in range(1, len(parts) - 2, 3):
            num, title, chunk = parts[i], parts[i + 1], parts[i + 2]
            paras = [p.strip() for p in chunk.strip().split("\n\n") if p.strip()]
            prose, blocks, bullets = [], [], []
            for p in paras:
                if p.startswith("```") or p.startswith("|"):
                    blocks.append(p)
                elif p.startswith("- "):
                    bullets.extend(
                        re.sub(r"\s+", " ", b).strip()
                        for b in re.split(r"\n(?=- )", p)
                    )
                else:
                    prose.append(re.sub(r"\s+", " ", p))
            findings.append({
                "num": num,
                "title": unbold(title).strip(),
                "lede": prose[0] if prose else "",
                "body": prose[1:],
                "bullets": bullets,
                "blocks": blocks,
            })
    headline = 0
    hm = re.search(r"^## 1\. (\w+) findings", body, re.M)
    if hm:
        headline = {"Five": 5, "Four": 4, "Six": 6, "Three": 3}.get(hm.group(1), 0)
    if headline and len(findings) != headline:
        note_gap(
            f"PIXEL-JUDGMENT.md: its section-1 heading says {hm.group(1).lower()} findings "
            f"but {len(findings)} subsections are present "
            f"({', '.join(f['num'] for f in findings)}); all of them are carried through"
        )

    # --- the epigraph -------------------------------------------------------
    flat = re.sub(r"\s+", " ", body)
    epi = ""
    em = re.search(
        r"((?:\w+) figures[^.]*pass every mechanical gate the repository owns[^.]*\. "
        r"The gates are a floor, not evidence\.)",
        flat,
    )
    if em:
        epi = em.group(1).strip()
    else:
        note_gap("PIXEL-JUDGMENT.md: the epigraph sentence was not found")

    # --- counts -------------------------------------------------------------
    counts = {}
    judged = None
    cblock = body[sec3:body.find("\n## 4.", sec3)] if sec3 > 0 else ""
    for cells in md_rows(cblock):
        if len(cells) < 3 or cells[0] in ("disposition", ""):
            continue
        name = unbold(cells[0]).strip("*").strip()
        try:
            n = int(cells[1].strip().strip("*"))
        except ValueError:
            continue
        if name.lower() == "judged":
            judged = n
        else:
            counts[name.lower()] = {"n": n, "which": unbold(cells[2])}
    if not counts:
        note_gap("PIXEL-JUDGMENT.md: the counts table did not parse")

    # --- provenance ---------------------------------------------------------
    prov = {}
    pm = re.search(r"SHA-256 `([0-9a-f]{64})`", body)
    if pm:
        prov["pdfSha256"] = pm.group(1)
    pm = re.search(r"committed at `([0-9a-f]+)`", body)
    if pm:
        prov["commit"] = pm.group(1)
    pm = re.search(r"(\d+) pages, SHA-256", body)
    if pm:
        prov["pages"] = int(pm.group(1))

    return rows, {
        "findings": findings,
        "epigraph": epi,
        "counts": counts,
        "judged": judged,
        "headlineFindingCount": headline,
        "provenance": prov,
    }


# ---------------------------------------------------------------------------
# blockers.json + FIGURE-REGISTER.md  (derived)
# ---------------------------------------------------------------------------

def parse_blockers() -> dict:
    p = abspath(BLOCKERS_REL)
    if not os.path.isfile(p):
        note_gap(f"{BLOCKERS_REL} is missing; the mechanical-gate column is empty")
        return {"byFigure": {}, "total": 0, "waived": 0}
    with open(p, encoding="utf-8") as fh:
        entries = json.load(fh)
    by_fig = {}
    waived = 0
    for e in entries:
        w = e.get("waiver")
        if w:
            waived += 1
        by_fig[e["id"]] = {
            "checksFailed": e.get("checks_failed", []),
            "firstSeen": e.get("first_seen"),
            "waived": bool(w),
            "waiverReason": (w or {}).get("reason"),
            "waiverExpires": (w or {}).get("expires"),
        }
    return {"byFigure": by_fig, "total": len(entries), "waived": waived}


def parse_register() -> dict:
    p = abspath(REGISTER_REL)
    if not os.path.isfile(p):
        note_gap(f"{REGISTER_REL} is missing; the register summary is empty")
        return {"chapters": {}, "totals": {}}
    with open(p, encoding="utf-8") as fh:
        text = fh.read()
    start = text.find("## Register summary")
    if start < 0:
        note_gap("FIGURE-REGISTER.md: '## Register summary' not found")
        return {"chapters": {}, "totals": {}}
    block = text[start:text.find("\n## ", start + 4)]
    chapters, totals = {}, {}
    for cells in md_rows(block):
        if len(cells) < 9 or cells[0] in ("chapter", ""):
            continue
        head = unbold(cells[0])
        m = re.match(r"^(\d+)\s*—", head)
        row = {
            "rows": unbold(cells[1]), "must": unbold(cells[2]), "should": unbold(cells[3]),
            "could": unbold(cells[4]), "no": unbold(cells[5]), "existing": unbold(cells[6]),
            "noneYet": unbold(cells[7]), "underServed": cells[8],
        }
        if m:
            chapters[m.group(1)] = row
        elif head.lower() == "total":
            totals = row
    if len(chapters) != 8:
        note_gap(f"FIGURE-REGISTER.md: parsed {len(chapters)} chapter rows from the summary, expected 8")
    return {"chapters": chapters, "totals": totals}


# ---------------------------------------------------------------------------
# Agreement between the voices  (derived)
# ---------------------------------------------------------------------------

# The desk's verdict vocabularies do not coincide: the three lenses and the
# pixel pass both say keep/restyle/redraw/table/delete; Wave 11 adds "add" and
# qualifies with parentheses. Compare on the leading token only.
def base_verdict(v: str | None) -> str:
    if not v:
        return ""
    v = unbold(str(v)).strip().lower()
    return re.split(r"[\s(]", v)[0]


def attach_agreement(pixel: dict, crit: dict, triage: dict) -> None:
    for fid, row in pixel.items():
        pv = base_verdict(row["verdict"])
        lenses = {}
        for L in ("lensA", "lensB", "lensC"):
            lv = base_verdict((crit.get(fid) or {}).get(L, {}).get("verdict"))
            if lv:
                lenses[L] = {"verdict": lv, "agrees": lv == pv}
        tv = base_verdict((triage.get(fid) or {}).get("disposition"))
        row["agreement"] = {
            "lenses": lenses,
            "triage": {"verdict": tv, "agrees": tv == pv} if tv else None,
            "disagreesWithLenses": sorted(L for L, d in lenses.items() if not d["agrees"]),
            "disagreesWithTriage": bool(tv) and tv != pv,
            "unanimousAgainst": bool(lenses) and all(not d["agrees"] for d in lenses.values()),
        }


# ---------------------------------------------------------------------------
# Emission
# ---------------------------------------------------------------------------

BANNER = (
    "/* GENERATED by scripts/harbor-research/build_figure_desk.py -- do not hand-edit.\n"
    "   Regenerate with:  python3 scripts/harbor-research/build_figure_desk.py --write\n"
    "   Check with:       python3 scripts/harbor-research/build_figure_desk.py --check\n"
    "   %s */\n"
)


def js(name: str, value, provenance: str) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=False, indent=None, separators=(",", ":"))
    return (BANNER % provenance) + f"window.{name}={payload};\n"


def load_curated(rel: str, what: str):
    p = abspath(rel)
    if not os.path.isfile(p):
        note_gap(f"curated source {rel} is missing; {what} is empty")
        return {}
    with open(p, encoding="utf-8") as fh:
        return json.load(fh)


def build() -> tuple[list[tuple[str, str]], dict]:
    textbook = load_textbook()
    chapters = build_chapters(textbook)

    figs = enumerate_figures(textbook)
    attach_book_pages(figs)
    render_pages = load_curated(RENDER_PAGES_REL, "FIGS[].page")
    missing_render = attach_render_pages(figs, render_pages)
    for fid in missing_render:
        note_gap(f"{fid}: no pinned render page in {RENDER_PAGES_REL}; the desk has no page image for it")

    with open(abspath(TRIAGE_REL), encoding="utf-8") as fh:
        triage_text = fh.read()
    triage, add_rows, shared = parse_triage(triage_text)
    undrawn_pins = load_curated(UNDRAWN_IDS_REL, "the undrawn candidates' pinned ids")
    undrawn, fulfilled = shape_add_rows(add_rows, figs, undrawn_pins)

    for fid, row in triage.items():
        row["sharedWith"] = shared.get(row["num"]) or row.pop("inlineShare", None)
        row.pop("inlineShare", None)
        row["fulfilledAdd"] = fulfilled.get(fid)

    # A figure drawn since the triage pass has no row of its own in
    # FIGURE-TRIAGE.md; its only mention there is the `add` row it answers. The
    # desk keys everything off TRIAGE[id].num, so synthesize the row from the
    # add it fulfils rather than leaving the figure numberless.
    for fid, raw in fulfilled.items():
        if fid in triage:
            continue
        fig = next((f for f in figs if f["id"] == fid), None)
        sec = re.match(r"^§?([\d.]+|\d)\s", raw)
        triage[fid] = {
            "num": f"add(ch{fig['ch'] if fig else '?'},{sec.group(0).strip() if sec else '§?'})",
            "ch": fig["ch"] if fig else None,
            "idea": "(did not exist at triage time -- it answers a Wave 11 \"add\" row)",
            "drawn": None,
            "role": None,
            "disposition": "add (now drawn)",
            "spec": raw,
            "sharedWith": None,
            "fulfilledAdd": raw,
        }

    pixel_path = abspath(PIXEL_REL)
    if os.path.isfile(pixel_path):
        with open(pixel_path, encoding="utf-8") as fh:
            pixel_rows, cross = parse_pixel(fh.read())
    else:
        note_gap(f"{PIXEL_REL} is missing; the pixel voice is empty")
        pixel_rows, cross = {}, {"findings": [], "epigraph": "", "counts": {}, "judged": None, "provenance": {}}

    crit = load_curated(CRIT_REL, "the three lenses")
    research = load_curated(RESEARCH_REL, "the diagram-research voice")
    attach_agreement(pixel_rows, crit, triage)

    gates = parse_blockers()
    register = parse_register()

    # ---- the doctrine rubric ------------------------------------------
    # Named, citable criteria scored per figure, so a reviewer can argue with
    # the doctrine and not only with the reviewer. figure_doctrine.py says what
    # each criterion is, where it comes from, who disputes it, and which of
    # them nothing committed can answer.
    palette = palette_check.audit()
    doctrine, dctx = figure_doctrine.score(REPO_ROOT, textbook, figs, pixel_rows, palette)
    if dctx.get("readersEyeGap"):
        note_gap("caption-carries-the-fact is unscored: " + dctx["readersEyeGap"])
    vs_lenses = figure_doctrine.doctrine_vs_lenses(doctrine, crit)

    def failing(cid):
        return sorted(f for f, sc in doctrine.items()
                      if (sc.get(cid) or {}).get("verdict") == "fails")

    both_captions = sorted(
        f for f, sc in doctrine.items()
        if (sc.get("caption-states-a-claim") or {}).get("verdict") == "fails"
        and (sc.get("caption-carries-the-fact") or {}).get("verdict") == "fails")

    doctrine_payload = {
        "criteria": figure_doctrine.CRITERIA,
        "scores": doctrine,
        "context": dctx,
        "palette": palette,
        "vsLenses": vs_lenses,
        "overErased": failing("over-erased"),
        "captionDoubleFail": both_captions,
        "failingByCriterion": {c["id"]: failing(c["id"]) for c in figure_doctrine.CRITERIA},
        "coverage": {
            c["id"]: {
                "scored": sum(1 for sc in doctrine.values()
                              if (sc.get(c["id"]) or {}).get("verdict") in ("passes", "fails")),
                "na": sum(1 for sc in doctrine.values()
                          if (sc.get(c["id"]) or {}).get("verdict") == "n/a"),
                "unscored": sum(1 for sc in doctrine.values()
                                if (sc.get(c["id"]) or {}).get("verdict") == "unscored"),
            } for c in figure_doctrine.CRITERIA
        },
    }

    fig_ids = {f["id"] for f in figs}
    judged_ids = set(pixel_rows)
    recon = {
        "deskOnly": sorted(fig_ids - judged_ids),
        "judgedOnly": sorted(judged_ids - fig_ids),
        "both": sorted(fig_ids & judged_ids),
        "undrawn": [u["id"] for u in undrawn],
        "renderDrift": [
            {"id": f["id"], "renderPage": f["page"], "bookPage": f["bookPage"]}
            for f in figs
            if f["page"] is not None and f["bookPage"] is not None and f["page"] != f["bookPage"]
        ],
    }

    findings_payload = {
        "epigraph": cross["epigraph"],
        "findings": cross["findings"],
        "counts": cross["counts"],
        "judged": cross["judged"],
        "headlineFindingCount": cross.get("headlineFindingCount"),
        "provenance": cross["provenance"],
        "gates": gates,
        "register": register,
        "reconciliation": {
            "deskFigures": len(figs),
            "judged": len(judged_ids),
            "undrawn": len(undrawn),
            "deskOnly": recon["deskOnly"],
            "judgedOnly": recon["judgedOnly"],
            "renderDrift": recon["renderDrift"],
        },
        "contactSheets": sorted(
            f"docs/pr-assets/figures-pixel-judgment/{n}"
            for n in (os.listdir(abspath("docs/pr-assets/figures-pixel-judgment"))
                      if os.path.isdir(abspath("docs/pr-assets/figures-pixel-judgment")) else [])
        ),
        "parseGaps": list(PARSE_GAPS),
    }

    outputs = [
        (f"{DATA_DIR}/CHAPTERS.js", js("CHAPTERS", chapters, "derived from whitepaper/textbook.json")),
        (f"{DATA_DIR}/FIGS.js", js("FIGS", figs, "derived from the chapter sources + the committed Book PDF; page pinned by desk-curated/RENDER-PAGES.json")),
        (f"{DATA_DIR}/TRIAGE.js", js("TRIAGE", triage, "derived from FIGURE-TRIAGE.md")),
        (f"{DATA_DIR}/UNDRAWN.js", js("UNDRAWN", undrawn, "derived from FIGURE-TRIAGE.md add-rows")),
        (f"{DATA_DIR}/PIXEL.js", js("PIXEL", pixel_rows, "derived from PIXEL-JUDGMENT.md section 2")),
        (f"{DATA_DIR}/FINDINGS.js", js("FINDINGS", findings_payload, "derived from PIXEL-JUDGMENT.md sections 1/3, blockers.json, FIGURE-REGISTER.md")),
        (f"{DATA_DIR}/DOCTRINE.js", js("DOCTRINE", doctrine_payload, "derived by figure_doctrine.py + palette_check.py + readers_eye.py")),
        (f"{DATA_DIR}/CRIT.js", js("CRIT", crit, "CURATED: copied from desk-curated/CRIT.json")),
        (f"{DATA_DIR}/RESEARCH.js", js("RESEARCH", research, "CURATED: copied from desk-curated/RESEARCH.json")),
    ]
    return outputs, {"figs": figs, "recon": recon, "pixel": pixel_rows, "triage": triage,
                     "crit": crit, "undrawn": undrawn, "doctrine": doctrine_payload}


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

def report(ctx: dict) -> None:
    figs, recon = ctx["figs"], ctx["recon"]
    print("== set reconciliation ==")
    print(f"  figures enumerated from the Book : {len(figs)}")
    print(f"  judged by the pixel pass         : {len(ctx['pixel'])}")
    print(f"  undrawn candidates (triage adds) : {len(ctx['undrawn'])}")
    print(f"  desk total                       : {len(figs) + len(ctx['undrawn'])}")
    print(f"  in the Book but never judged     : {recon['deskOnly'] or '(none)'}")
    print(f"  judged but not in the Book       : {recon['judgedOnly'] or '(none)'}")
    print()
    print("== render-page drift (pinned page vs today's Book) ==")
    drift = [f for f in figs if f["page"] and f["bookPage"] and f["page"] != f["bookPage"]]
    print(f"  {len(drift)} of {len(figs)} figures moved:")
    for f in drift:
        print(f"    {f['id']:<38} render p{f['page']}  ->  Book p{f['bookPage']}  ({f['bookPage'] - f['page']:+d})")
    print()
    print("== where the pixel pass disagrees ==")
    for fid, row in sorted(ctx["pixel"].items()):
        ag = row.get("agreement") or {}
        dl, dt = ag.get("disagreesWithLenses") or [], ag.get("disagreesWithTriage")
        if dl or dt:
            lens_s = ", ".join(f"{L}={ag['lenses'][L]['verdict']}" for L in dl) or "-"
            tri = (ag.get("triage") or {}).get("verdict", "-")
            print(f"  {row['num']:<6} {fid:<36} pixel={row['verdict']:<8} lenses[{lens_s}] triage={tri}")
    print()
    d = ctx["doctrine"]
    print("== doctrine rubric ==")
    pc = d["palette"]["counts"]
    print(f"  palette: {pc['fail']} of {pc['pairs']} pairs FAIL, {pc['floorOnly']} floor-only, {pc['clear']} clear")
    print(f"  chapter colours in use     : {d['context']['chapterColours']}")
    print(f"  live failing pairs between : "
          f"{[p['a'] + '/' + p['b'] for p in d['context']['livePalettePairs']]}")
    print(f"  Swiss draw=none styles     : {sorted(d['context']['edgelessStyles'])}")
    print("  coverage, scored / n-a / unscored out of %d:" % len(ctx["figs"]))
    for cid, cov in d["coverage"].items():
        kind = figure_doctrine.CRITERIA_BY_ID[cid]["evidence"]
        flag = "contested" if figure_doctrine.CRITERIA_BY_ID[cid]["contested"] else ""
        print(f"    {cid:<28} {kind:<8} {cov['scored']:>3} /{cov['na']:>3} /{cov['unscored']:>3}  {flag}")
    print()
    print("  over-erased (%d) -- the list the repo's own gates structurally cannot produce:"
          % len(d["overErased"]))
    for f in d["overErased"]:
        print(f"    {f}")
    print()
    print("  caption fails BOTH claim and carries-the-fact (%d):" % len(d["captionDoubleFail"]))
    for f in d["captionDoubleFail"] or ["(none)"]:
        print(f"    {f}")
    print()
    print("  doctrine fails where a lens said keep (%d):" % len(d["vsLenses"]))
    for fid, v in sorted(d["vsLenses"].items()):
        print(f"    {fid:<38} {','.join(v['lensesSaidKeep'])} said keep; fails {', '.join(v['fails'])}")
    print()
    print("== parse gaps ==")
    if PARSE_GAPS:
        for g in PARSE_GAPS:
            print(f"  ! {g}")
    else:
        print("  (none)")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    global REPO_ROOT
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="fail if any generated file is stale")
    ap.add_argument("--write", action="store_true", help="(re)write the generated files")
    ap.add_argument("--report", action="store_true", help="print the reconciliations and parse gaps")
    ap.add_argument("--bundle", default=None, help="also copy the generated data into DIR/data/")
    ap.add_argument("--repo-root", default=None, help=argparse.SUPPRESS)
    args = ap.parse_args()

    if args.repo_root:
        REPO_ROOT = os.path.abspath(args.repo_root)

    outputs, ctx = build()

    if not (args.check or args.write or args.report or args.bundle):
        for rel, content in outputs:
            print(f"--- {rel} ({len(content)} bytes)")
        return 0

    exit_code = 0

    if args.check:
        stale = []
        for rel, content in outputs:
            p = abspath(rel)
            on_disk = None
            if os.path.isfile(p):
                with open(p, encoding="utf-8") as fh:
                    on_disk = fh.read()
            if on_disk != content:
                stale.append(rel)
        if stale:
            print("STALE (run --write to regenerate):", file=sys.stderr)
            for rel in stale:
                print(f"  {rel}", file=sys.stderr)
            exit_code = 1
        else:
            print(f"All {len(outputs)} figure-desk data files are fresh.")

    if args.write:
        for rel, content in outputs:
            p = abspath(rel)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "w", encoding="utf-8") as fh:
                fh.write(content)
            print(f"wrote {rel} ({len(content)} bytes)")

    if args.bundle:
        out = os.path.join(os.path.abspath(args.bundle), "data")
        os.makedirs(out, exist_ok=True)
        for rel, content in outputs:
            with open(os.path.join(out, os.path.basename(rel)), "w", encoding="utf-8") as fh:
                fh.write(content)
        print(f"bundled {len(outputs)} files into {out}")

    if args.report:
        report(ctx)

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
